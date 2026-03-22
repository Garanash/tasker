"""
Личные сообщения AGBTasker между участниками организации: REST и доставка по WebSocket `/ws/messages/`.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from . import state
from .deps import require_authenticated_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/messages", tags=["messages"])

CREATE_DM_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS core_directmessage (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT core_directmessage_no_self CHECK (sender_id <> recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_org_sender_recipient ON core_directmessage (organization_id, sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_org_recipient_sender ON core_directmessage (organization_id, recipient_id, sender_id, created_at DESC);
"""

CREATE_DM_READ_STATE_SQL = """
CREATE TABLE IF NOT EXISTS core_dm_read_state (
    user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES core_organization(id) ON DELETE CASCADE,
    peer_user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
    last_read_at timestamptz NOT NULL DEFAULT to_timestamp(0),
    PRIMARY KEY (user_id, organization_id, peer_user_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_read_state_org_user ON core_dm_read_state (organization_id, user_id);
"""


async def ensure_direct_messages_table() -> None:
    if not state.pg_pool:
        return
    try:
        async with state.pg_pool.acquire() as conn:
            await conn.execute(CREATE_DM_TABLE_SQL)
            await conn.execute(CREATE_DM_READ_STATE_SQL)
            await conn.execute(
                """
                INSERT INTO core_dm_read_state (user_id, organization_id, peer_user_id, last_read_at)
                SELECT recipient_id, organization_id, sender_id, MAX(created_at)
                FROM core_directmessage
                GROUP BY recipient_id, organization_id, sender_id
                ON CONFLICT (user_id, organization_id, peer_user_id) DO NOTHING
                """
            )
    except Exception:
        logger.exception("ensure_direct_messages_table failed")


async def _both_in_org(conn: Any, organization_id: str, user_a: str, user_b: str) -> bool:
    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (WHERE user_id = $2::uuid) AS ca,
            COUNT(*) FILTER (WHERE user_id = $3::uuid) AS cb
        FROM core_organizationmember
        WHERE organization_id = $1::uuid AND user_id IN ($2::uuid, $3::uuid)
        """,
        organization_id,
        user_a,
        user_b,
    )
    if not row:
        return False
    return int(row["ca"] or 0) >= 1 and int(row["cb"] or 0) >= 1


def _ws_envelope(msg: dict[str, Any]) -> dict[str, Any]:
    return {"type": "direct_message", "payload": msg}


async def _broadcast_dm(msg: dict[str, Any]) -> None:
    env = _ws_envelope(msg)
    sender_id = str(msg["sender_id"])
    recipient_id = str(msg["recipient_id"])
    mgr = getattr(state, "dm_manager", None)
    if mgr is None:
        return
    await mgr.send_to_users([sender_id, recipient_id], env)


@router.get("/history/{peer_user_id}")
async def get_history(
    request: Request,
    peer_user_id: str,
    _user_id: str = Depends(require_authenticated_user_id),
    limit: int = 200,
) -> dict[str, Any]:
    """История личных сообщений с пользователем `peer_user_id` в организации.

    Заголовок `X-Organization-Id` обязателен. Query `limit` (по умолчанию 200, макс. 500). Оба пользователя должны быть в org.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = (request.headers.get("x-organization-id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="X-Organization-Id required")
    if peer_user_id == _user_id:
        raise HTTPException(status_code=400, detail="invalid_peer")
    lim = max(1, min(limit, 500))

    async with state.pg_pool.acquire() as conn:
        ok = await _both_in_org(conn, org_id, _user_id, peer_user_id)
        if not ok:
            raise HTTPException(status_code=403, detail="forbidden")
        rows = await conn.fetch(
            """
            SELECT id, sender_id, recipient_id, body, created_at
            FROM core_directmessage
            WHERE organization_id = $1::uuid
              AND (
                (sender_id = $2::uuid AND recipient_id = $3::uuid)
                OR (sender_id = $3::uuid AND recipient_id = $2::uuid)
              )
            ORDER BY created_at ASC
            LIMIT $4
            """,
            org_id,
            _user_id,
            peer_user_id,
            lim,
        )
    return {
        "messages": [
            {
                "id": str(r["id"]),
                "sender_id": str(r["sender_id"]),
                "recipient_id": str(r["recipient_id"]),
                "body": r["body"],
                "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in rows
        ]
    }


@router.get("/unread-count")
async def unread_count(
    request: Request,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Счётчик непрочитанных входящих ЛС для текущего пользователя в организации.

    Сравнивает `created_at` сообщений с `core_dm_read_state`. Нужен `X-Organization-Id`.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = (request.headers.get("x-organization-id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="X-Organization-Id required")

    async with state.pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT COUNT(*)::bigint AS c
            FROM core_directmessage dm
            LEFT JOIN core_dm_read_state rs
              ON rs.user_id = $2::uuid
             AND rs.organization_id = dm.organization_id
             AND rs.peer_user_id = dm.sender_id
            WHERE dm.organization_id = $1::uuid
              AND dm.recipient_id = $2::uuid
              AND dm.created_at > COALESCE(rs.last_read_at, to_timestamp(0))
            """,
            org_id,
            _user_id,
        )
    n = int(row["c"] or 0) if row else 0
    return {"unread_count": n}


@router.get("/conversations-summary")
async def conversations_summary(
    request: Request,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Сводка диалогов пользователя в организации.

    Возвращает по каждому `peer_user_id`:
    - `unread_count` (непрочитанные входящие от peer),
    - `last_message_at`, `last_message_body`, `last_sender_id` (последнее сообщение в диалоге).
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = (request.headers.get("x-organization-id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="X-Organization-Id required")

    async with state.pg_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            WITH my_conversations AS (
                SELECT
                    CASE
                        WHEN dm.sender_id = $2::uuid THEN dm.recipient_id
                        ELSE dm.sender_id
                    END AS peer_user_id,
                    dm.id,
                    dm.sender_id,
                    dm.recipient_id,
                    dm.body,
                    dm.created_at
                FROM core_directmessage dm
                WHERE dm.organization_id = $1::uuid
                  AND (dm.sender_id = $2::uuid OR dm.recipient_id = $2::uuid)
            ),
            last_message AS (
                SELECT DISTINCT ON (peer_user_id)
                    peer_user_id,
                    id AS last_message_id,
                    sender_id AS last_sender_id,
                    body AS last_message_body,
                    created_at AS last_message_at
                FROM my_conversations
                ORDER BY peer_user_id, created_at DESC, id DESC
            ),
            unread AS (
                SELECT
                    dm.sender_id AS peer_user_id,
                    COUNT(*)::int AS unread_count
                FROM core_directmessage dm
                LEFT JOIN core_dm_read_state rs
                  ON rs.user_id = $2::uuid
                 AND rs.organization_id = dm.organization_id
                 AND rs.peer_user_id = dm.sender_id
                WHERE dm.organization_id = $1::uuid
                  AND dm.recipient_id = $2::uuid
                  AND dm.created_at > COALESCE(rs.last_read_at, to_timestamp(0))
                GROUP BY dm.sender_id
            )
            SELECT
                lm.peer_user_id,
                lm.last_message_id,
                lm.last_sender_id,
                lm.last_message_body,
                lm.last_message_at,
                COALESCE(u.unread_count, 0) AS unread_count
            FROM last_message lm
            LEFT JOIN unread u ON u.peer_user_id = lm.peer_user_id
            ORDER BY lm.last_message_at DESC, lm.peer_user_id
            """,
            org_id,
            _user_id,
        )

    return {
        "conversations": [
            {
                "peer_user_id": str(r["peer_user_id"]),
                "last_message_id": str(r["last_message_id"]) if r.get("last_message_id") else None,
                "last_sender_id": str(r["last_sender_id"]) if r.get("last_sender_id") else None,
                "last_message_body": r["last_message_body"] or "",
                "last_message_at": r["last_message_at"].isoformat() if r.get("last_message_at") else None,
                "unread_count": int(r["unread_count"] or 0),
            }
            for r in rows
        ]
    }


@router.post("/mark-read")
async def mark_read(
    request: Request,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Отметить диалог с `peer_user_id` прочитанным до последнего сообщения.

    Тело: `peer_user_id`. Обновляет `last_read_at` в `core_dm_read_state`.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = (request.headers.get("x-organization-id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="X-Organization-Id required")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    peer_user_id = str(body.get("peer_user_id") or "").strip()
    if not peer_user_id or peer_user_id == _user_id:
        raise HTTPException(status_code=400, detail="invalid_peer")

    async with state.pg_pool.acquire() as conn:
        ok = await _both_in_org(conn, org_id, _user_id, peer_user_id)
        if not ok:
            raise HTTPException(status_code=403, detail="forbidden")
        row = await conn.fetchrow(
            """
            SELECT MAX(created_at) AS mx
            FROM core_directmessage
            WHERE organization_id = $1::uuid
              AND (
                (sender_id = $2::uuid AND recipient_id = $3::uuid)
                OR (sender_id = $3::uuid AND recipient_id = $2::uuid)
              )
            """,
            org_id,
            _user_id,
            peer_user_id,
        )
        mx = row["mx"] if row and row["mx"] else datetime.now(timezone.utc)
        await conn.execute(
            """
            INSERT INTO core_dm_read_state (user_id, organization_id, peer_user_id, last_read_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::timestamptz)
            ON CONFLICT (user_id, organization_id, peer_user_id)
            DO UPDATE SET last_read_at = GREATEST(core_dm_read_state.last_read_at, EXCLUDED.last_read_at)
            """,
            _user_id,
            org_id,
            peer_user_id,
            mx,
        )
    return {"ok": True}


@router.post("/send")
async def send_message(
    request: Request,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Отправить личное сообщение участнику той же организации.

    Заголовок `X-Organization-Id`, тело: `peer_user_id`, `body` (до 8000 символов). Рассылается получателю и отправителю по WebSocket.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = (request.headers.get("x-organization-id") or "").strip()
    if not org_id:
        raise HTTPException(status_code=400, detail="X-Organization-Id required")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    peer_user_id = str(body.get("peer_user_id") or "").strip()
    text = (body.get("body") or "").strip()
    if not peer_user_id or peer_user_id == _user_id:
        raise HTTPException(status_code=400, detail="invalid_peer")
    if not text:
        raise HTTPException(status_code=400, detail="body required")
    if len(text) > 8000:
        raise HTTPException(status_code=400, detail="body too long")

    msg_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    async with state.pg_pool.acquire() as conn:
        ok = await _both_in_org(conn, org_id, _user_id, peer_user_id)
        if not ok:
            raise HTTPException(status_code=403, detail="forbidden")
        await conn.execute(
            """
            INSERT INTO core_directmessage (id, organization_id, sender_id, recipient_id, body, created_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)
            """,
            msg_id,
            org_id,
            _user_id,
            peer_user_id,
            text,
            now,
        )

    out = {
        "id": msg_id,
        "organization_id": org_id,
        "sender_id": _user_id,
        "recipient_id": peer_user_id,
        "body": text,
        "created_at": now.isoformat(),
    }
    try:
        await _broadcast_dm(out)
    except Exception:
        logger.exception("dm ws broadcast failed")
    return out
