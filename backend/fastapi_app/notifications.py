"""
Сервис in-app уведомлений AGBTasker: хранение, выдача, отметка прочитанными.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from . import state
from .deps import require_authenticated_user_id

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

CREATE_NOTIFICATIONS_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS core_notification (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    kind varchar(64) NOT NULL,
    title varchar(255) NOT NULL,
    body text NOT NULL,
    metadata jsonb,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_core_notification_user_created ON core_notification (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_notification_user_unread ON core_notification (user_id, is_read);
"""


async def ensure_notifications_table(conn: Any | None = None) -> None:
    if conn is not None:
        await conn.execute(CREATE_NOTIFICATIONS_TABLE_SQL)
        return
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as acquired:
        await acquired.execute(CREATE_NOTIFICATIONS_TABLE_SQL)


async def create_notification_for_user(
    *,
    conn: Any,
    organization_id: str,
    user_id: str,
    kind: str,
    title: str,
    body: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    notification_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    await conn.execute(
        """
        INSERT INTO core_notification (id, organization_id, user_id, kind, title, body, metadata, is_read, created_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, false, $8)
        """,
        notification_id,
        organization_id,
        user_id,
        kind,
        title,
        body,
        json.dumps(metadata or {}),
        now,
    )


async def create_notification_for_org_members(
    *,
    conn: Any,
    organization_id: str,
    actor_user_id: str | None,
    kind: str,
    title: str,
    body: str,
    metadata: dict[str, Any] | None = None,
) -> None:
    recipients = await conn.fetch(
        """
        SELECT user_id
        FROM core_organizationmember
        WHERE organization_id = $1::uuid
        """,
        organization_id,
    )
    for row in recipients:
        recipient_id = str(row["user_id"])
        if actor_user_id and recipient_id == actor_user_id:
            continue
        await create_notification_for_user(
            conn=conn,
            organization_id=organization_id,
            user_id=recipient_id,
            kind=kind,
            title=title,
            body=body,
            metadata=metadata,
        )


@router.get("")
async def list_notifications(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    limit: int = Query(default=20, ge=1, le=100),
    unread_only: bool = Query(default=False),
) -> list[dict[str, Any]]:
    """Список уведомлений текущего пользователя.

    Query: `limit` (1–100), `unread_only` — только непрочитанные. Поля: kind, title, body, metadata, is_read, created_at, read_at.
    """
    await ensure_notifications_table()
    async with state.pg_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, kind, title, body, metadata, is_read, created_at, read_at
            FROM core_notification
            WHERE user_id = $1::uuid
              AND ($2::boolean = false OR is_read = false)
            ORDER BY created_at DESC
            LIMIT $3
            """,
            user_id,
            unread_only,
            limit,
        )
    return [
        {
            "id": str(r["id"]),
            "kind": r["kind"],
            "title": r["title"],
            "body": r["body"],
            "metadata": r["metadata"] or {},
            "is_read": bool(r["is_read"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "read_at": r["read_at"].isoformat() if r["read_at"] else None,
        }
        for r in rows
    ]


@router.get("/unread-count")
async def unread_count(request: Request, user_id: str = Depends(require_authenticated_user_id)) -> dict[str, int]:
    """Количество непрочитанных уведомлений для шапки UI.

    Ответ: `{\"unread_count\": N}`.
    """
    await ensure_notifications_table()
    async with state.pg_pool.acquire() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM core_notification WHERE user_id = $1::uuid AND is_read = false",
            user_id,
        )
    return {"unread_count": int(count or 0)}


@router.post("/{notification_id}/read")
async def read_notification(
    request: Request,
    notification_id: str,
    user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Отметить одно уведомление прочитанным.

    Чужие уведомления недоступны (404). Устанавливается read_at.
    """
    await ensure_notifications_table()
    now = datetime.now(timezone.utc)
    async with state.pg_pool.acquire() as conn:
        updated = await conn.fetchrow(
            """
            UPDATE core_notification
            SET is_read = true, read_at = $1
            WHERE id = $2::uuid AND user_id = $3::uuid
            RETURNING id
            """,
            now,
            notification_id,
            user_id,
        )
    if not updated:
        raise HTTPException(status_code=404, detail="notification_not_found")
    return {"ok": True, "id": notification_id}


@router.post("/read-all")
async def read_all_notifications(request: Request, user_id: str = Depends(require_authenticated_user_id)) -> dict[str, Any]:
    """Отметить все уведомления пользователя прочитанными.

    Массовый сброс счётчика непрочитанных.
    """
    await ensure_notifications_table()
    now = datetime.now(timezone.utc)
    async with state.pg_pool.acquire() as conn:
        await conn.execute(
            """
            UPDATE core_notification
            SET is_read = true, read_at = $1
            WHERE user_id = $2::uuid AND is_read = false
            """,
            now,
            user_id,
        )
    return {"ok": True}
