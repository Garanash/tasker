"""
Kanban API приложения AGBTasker: доски, колонки, дорожки, карточки, вложения и комментарии.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from starlette import status

from .deps import (
    ROLE_PRIORITY,
    get_effective_role,
    require_authenticated_user_id,
    require_manager_role,
    require_space_access,
)
from .notifications import create_notification_for_org_members, ensure_notifications_table
from .auth import _ensure_user_avatar_url_column
from . import state

router = APIRouter(prefix="/api/kanban", tags=["kanban"])

MEDIA_ROOT = os.environ.get("MEDIA_ROOT", "/tmp/kaiten_media")
DEFAULT_TRACK_NAME = "Основной поток"
WORKFLOW_COLUMNS: list[tuple[str, bool]] = [
    ("Задачи", False),
    ("К выполнению", False),
    ("В работе", False),
    ("Проверка", False),
    ("Размещение", False),
    ("Выполнено", True),
]
WORKFLOW_COLUMN_NAMES = {name for name, _ in WORKFLOW_COLUMNS}
DEFAULT_BACKLOG_COLUMN_NAME = WORKFLOW_COLUMNS[0][0]
WORKFLOW_TODO_COLUMN_NAME = "К выполнению"
WORKFLOW_IN_PROGRESS_COLUMN_NAME = "В работе"
WORKFLOW_REVIEW_COLUMN_NAME = "Проверка"
WORKFLOW_PUBLISH_COLUMN_NAME = "Размещение"
WORKFLOW_DONE_COLUMN_NAME = "Выполнено"
ARCHIVED_FIELD_KEY = "is_archived"
ARCHIVED_AT_FIELD_KEY = "archived_at"
ARCHIVED_EFFORT_SECONDS_FIELD_KEY = "archive_total_labor_seconds"


async def _ensure_kanban_extensions(conn: asyncpg.Connection) -> None:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS core_cardassignment (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
            assigned_by_id uuid REFERENCES core_user(id) ON DELETE SET NULL,
            assigned_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(card_id, user_id)
        )
        """
    )
    await conn.execute("CREATE INDEX IF NOT EXISTS core_cardassignment_user_idx ON core_cardassignment(user_id)")
    await conn.execute("CREATE INDEX IF NOT EXISTS core_cardassignment_card_idx ON core_cardassignment(card_id)")
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS core_cardcommentreadstate (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            card_id uuid NOT NULL REFERENCES core_card(id) ON DELETE CASCADE,
            user_id uuid NOT NULL REFERENCES core_user(id) ON DELETE CASCADE,
            last_seen_comment_at timestamptz NOT NULL DEFAULT to_timestamp(0),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(card_id, user_id)
        )
        """
    )
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS core_commentattachmentlink (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            comment_id uuid NOT NULL REFERENCES core_cardcomment(id) ON DELETE CASCADE,
            attachment_id uuid NOT NULL REFERENCES core_attachment(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE(comment_id, attachment_id)
        )
        """
    )


async def _ensure_board_workflow(conn: asyncpg.Connection, board_id: str) -> None:
    # Сериализуем операции по одной доске, чтобы не ловить race-condition
    # на уникальном индексе (board_id, order_index).
    await conn.execute("SELECT id FROM core_board WHERE id = $1::uuid FOR UPDATE", board_id)
    existing = await conn.fetch(
        "SELECT id, name FROM core_column WHERE board_id = $1::uuid ORDER BY order_index, created_at, id FOR UPDATE",
        board_id,
    )
    by_name = {str(r["name"]): str(r["id"]) for r in existing}
    now = datetime.now(timezone.utc)

    for idx, (column_name, is_done) in enumerate(WORKFLOW_COLUMNS, start=1):
        col_id = by_name.get(column_name)
        if not col_id:
            col_id = str(uuid.uuid4())
            # Ставим во временную область order_index, чтобы не конфликтовать с существующими.
            await conn.execute(
                """
                INSERT INTO core_column (id, board_id, name, order_index, is_done, created_at)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
                """,
                col_id,
                board_id,
                column_name,
                1000 + idx,
                is_done,
                now,
            )
        by_name[column_name] = col_id

    required_ids = [by_name[name] for name, _ in WORKFLOW_COLUMNS]
    for idx, col_id in enumerate(required_ids, start=1):
        await conn.execute(
            "UPDATE core_column SET order_index = $1, is_done = $2 WHERE id = $3::uuid",
            2000 + idx,
            WORKFLOW_COLUMNS[idx - 1][1],
            col_id,
        )

    stale_rows = [r for r in existing if str(r["name"]) not in WORKFLOW_COLUMN_NAMES]
    for idx, stale in enumerate(stale_rows, start=1):
        await conn.execute(
            "UPDATE core_column SET order_index = $1 WHERE id = $2::uuid",
            3000 + idx,
            str(stale["id"]),
        )

    for idx, col_id in enumerate(required_ids, start=1):
        await conn.execute(
            "UPDATE core_column SET order_index = $1, is_done = $2 WHERE id = $3::uuid",
            idx,
            WORKFLOW_COLUMNS[idx - 1][1],
            col_id,
        )

    track_exists = await conn.fetchrow("SELECT id FROM core_track WHERE board_id = $1::uuid LIMIT 1", board_id)
    if not track_exists:
        await conn.execute(
            """
            INSERT INTO core_track (id, board_id, name, order_index, created_at)
            VALUES ($1::uuid, $2::uuid, $3, 1, $4)
            """,
            str(uuid.uuid4()),
            board_id,
            DEFAULT_TRACK_NAME,
            now,
        )


async def _can_executor_work_with_card(conn: asyncpg.Connection, user_id: str, card_id: str) -> bool:
    assigned = await conn.fetchrow(
        "SELECT 1 FROM core_cardassignment WHERE card_id = $1::uuid AND user_id = $2::uuid LIMIT 1",
        card_id,
        user_id,
    )
    if assigned:
        return True
    assignee = await conn.fetchrow(
        """
        SELECT 1
        FROM core_cardfieldvalue fv
        JOIN core_cardfielddefinition fd ON fd.id = fv.definition_id
        WHERE fv.card_id = $1::uuid AND fd.key = 'assignee_user_id' AND fv.value::text = to_jsonb($2::text)::text
        LIMIT 1
        """,
        card_id,
        user_id,
    )
    return bool(assignee)


def _jsonish_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        s = value.strip().lower()
        return s in {"1", "true", "yes", "y", "on"}
    return False


async def _upsert_card_field_value_by_key(
    conn: asyncpg.Connection,
    *,
    card_id: str,
    space_id: str,
    key: str,
    name: str,
    value: Any,
    field_type: str = "text",
) -> None:
    definition = await conn.fetchrow(
        """
        SELECT id
        FROM core_cardfielddefinition
        WHERE space_id = $1::uuid AND key = $2
        LIMIT 1
        """,
        space_id,
        key,
    )
    definition_id = str(definition["id"]) if definition else str(uuid.uuid4())
    if not definition:
        await conn.execute(
            """
            INSERT INTO core_cardfielddefinition (id, space_id, key, name, field_type, created_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
            """,
            definition_id,
            space_id,
            key,
            name,
            field_type,
            datetime.now(timezone.utc),
        )
    await conn.execute(
        """
        INSERT INTO core_cardfieldvalue (id, card_id, definition_id, value, updated_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5)
        ON CONFLICT (card_id, definition_id)
        DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        """,
        str(uuid.uuid4()),
        card_id,
        definition_id,
        json.dumps(value),
        datetime.now(timezone.utc),
    )


async def _require_manager_for_space_org(space_id: str, user_id: str) -> tuple[str, str]:
    """
    Доступ к операции с пространством: членство в org пространства + роль менеджера или администратора.
    Не зависит от X-Space-Id (важно при нескольких организациях).
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT s.id, s.organization_id FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id AND om.user_id = $2::uuid
            WHERE s.id = $1::uuid
            LIMIT 1
            """,
            space_id,
            user_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Пространство не найдено или нет доступа")
    org_id = str(row["organization_id"])
    role = await get_effective_role(user_id, org_id)
    if ROLE_PRIORITY.get(role, 0) < ROLE_PRIORITY["manager"]:
        raise HTTPException(status_code=403, detail="insufficient_role")
    return str(row["id"]), org_id


async def _require_manager_for_board(board_id: str, user_id: str) -> tuple[str, str]:
    """
    Доступ к операции с доской: членство в org доски + роль manager+ (без зависимости от X-Space-Id).
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT b.id, s.organization_id
            FROM core_board b
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id AND om.user_id = $2::uuid
            WHERE b.id = $1::uuid
            LIMIT 1
            """,
            board_id,
            user_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Доска не найдена или нет доступа")
    org_id = str(row["organization_id"])
    role = await get_effective_role(user_id, org_id)
    if ROLE_PRIORITY.get(role, 0) < ROLE_PRIORITY["manager"]:
        raise HTTPException(status_code=403, detail="insufficient_role")
    return str(row["id"]), org_id


MEDIA_URL = os.environ.get("MEDIA_URL", "/media/")


def _delete_local_attachment_file(file_url: str) -> None:
    """Удаляет файл на диске, если URL указывает на загруженное вложение под MEDIA_ROOT."""
    if not file_url or "/attachments/" not in file_url:
        return
    tail = file_url.split("/attachments/", 1)[1]
    if not tail or ".." in tail.replace("\\", "/"):
        return
    path = Path(MEDIA_ROOT) / "attachments" / tail
    try:
        root = Path(MEDIA_ROOT).resolve()
        resolved = path.resolve()
        if not str(resolved).startswith(str(root)):
            return
        if resolved.is_file():
            resolved.unlink()
    except OSError:
        pass


async def _purge_card_dependencies(conn: asyncpg.Connection, card_id: str) -> None:
    """
    Удаляет строки, зависящие от карточки, до DELETE FROM core_card.
    В схемах без ON DELETE CASCADE (старые миграции БД) иначе будет ForeignKeyViolation.
    """
    await conn.execute("UPDATE core_card SET parent_id = NULL WHERE parent_id = $1::uuid", card_id)
    await conn.execute(
        "DELETE FROM core_checklistitem WHERE checklist_id IN (SELECT id FROM core_checklist WHERE card_id = $1::uuid)",
        card_id,
    )
    await conn.execute("DELETE FROM core_checklist WHERE card_id = $1::uuid", card_id)
    await conn.execute("DELETE FROM core_attachment WHERE card_id = $1::uuid", card_id)
    await conn.execute("DELETE FROM core_cardfieldvalue WHERE card_id = $1::uuid", card_id)
    await conn.execute("DELETE FROM core_cardcomment WHERE card_id = $1::uuid", card_id)
    await conn.execute("DELETE FROM core_cardmovementevent WHERE card_id = $1::uuid", card_id)
    for sql in (
        "DELETE FROM core_cardtag WHERE card_id = $1::uuid",
        "DELETE FROM core_document WHERE card_id = $1::uuid",
        "DELETE FROM core_cardrelation WHERE from_card_id = $1::uuid OR to_card_id = $1::uuid",
        "DELETE FROM core_cardblock WHERE card_id = $1::uuid",
        "DELETE FROM core_timeentry WHERE card_id = $1::uuid",
    ):
        try:
            await conn.execute(sql, card_id)
        except asyncpg.exceptions.UndefinedTableError:
            pass


# Подзапрос: id карточек, принадлежащих доскам пространства
_CARDS_IN_SPACE_SQL = (
    "SELECT c.id FROM core_card c JOIN core_board b ON b.id = c.board_id WHERE b.space_id = $1::uuid"
)
_BOARDS_IN_SPACE_SQL = "SELECT id FROM core_board WHERE space_id = $1::uuid"


async def _purge_space_before_delete(conn: asyncpg.Connection, space_id: str) -> None:
    """
    Удаляет данные внутри пространства так, чтобы сработал DELETE core_space,
    даже если в БД нет ON DELETE CASCADE (как у core_cardmovementevent → core_card).
    """
    await conn.execute(
        f"UPDATE core_card SET parent_id = NULL WHERE parent_id IN ({_CARDS_IN_SPACE_SQL})",
        space_id,
    )
    await conn.execute(
        f"""DELETE FROM core_checklistitem WHERE checklist_id IN (
            SELECT id FROM core_checklist WHERE card_id IN ({_CARDS_IN_SPACE_SQL}))""",
        space_id,
    )
    await conn.execute(f"DELETE FROM core_checklist WHERE card_id IN ({_CARDS_IN_SPACE_SQL})", space_id)
    await conn.execute(f"DELETE FROM core_attachment WHERE card_id IN ({_CARDS_IN_SPACE_SQL})", space_id)
    await conn.execute(f"DELETE FROM core_cardfieldvalue WHERE card_id IN ({_CARDS_IN_SPACE_SQL})", space_id)
    await conn.execute(f"DELETE FROM core_cardcomment WHERE card_id IN ({_CARDS_IN_SPACE_SQL})", space_id)
    await conn.execute(f"DELETE FROM core_cardmovementevent WHERE card_id IN ({_CARDS_IN_SPACE_SQL})", space_id)
    for sql in (
        f"DELETE FROM core_cardtag WHERE card_id IN ({_CARDS_IN_SPACE_SQL})",
        f"DELETE FROM core_document WHERE card_id IN ({_CARDS_IN_SPACE_SQL})",
        f"DELETE FROM core_cardrelation WHERE from_card_id IN ({_CARDS_IN_SPACE_SQL}) OR to_card_id IN ({_CARDS_IN_SPACE_SQL})",
        f"DELETE FROM core_cardblock WHERE card_id IN ({_CARDS_IN_SPACE_SQL})",
        f"DELETE FROM core_timeentry WHERE card_id IN ({_CARDS_IN_SPACE_SQL})",
    ):
        try:
            await conn.execute(sql, space_id)
        except asyncpg.exceptions.UndefinedTableError:
            pass

    await conn.execute(
        f"DELETE FROM core_card WHERE board_id IN ({_BOARDS_IN_SPACE_SQL})",
        space_id,
    )

    for sql in (
        """DELETE FROM core_sprintcapacity WHERE sprint_id IN (
            SELECT id FROM core_sprint WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid))""",
        "DELETE FROM core_sprint WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid)",
        """DELETE FROM core_automationexecution WHERE rule_id IN (
            SELECT id FROM core_automationrule WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid))""",
        "DELETE FROM core_automationrule WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid)",
        "DELETE FROM core_restrictionrule WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid)",
        "DELETE FROM core_wiplimit WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid)",
        "DELETE FROM core_column WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid)",
        "DELETE FROM core_track WHERE board_id IN (SELECT id FROM core_board WHERE space_id = $1::uuid)",
    ):
        try:
            await conn.execute(sql, space_id)
        except asyncpg.exceptions.UndefinedTableError:
            pass

    await conn.execute("DELETE FROM core_board WHERE space_id = $1::uuid", space_id)
    await conn.execute("DELETE FROM core_project WHERE space_id = $1::uuid", space_id)
    await conn.execute("DELETE FROM core_cardfielddefinition WHERE space_id = $1::uuid", space_id)
    try:
        await conn.execute("DELETE FROM core_document WHERE space_id = $1::uuid", space_id)
    except asyncpg.exceptions.UndefinedTableError:
        pass


async def _purge_board_before_delete(conn: asyncpg.Connection, board_id: str) -> None:
    cards_sql = "SELECT id FROM core_card WHERE board_id = $1::uuid"
    await conn.execute(
        f"UPDATE core_card SET parent_id = NULL WHERE parent_id IN ({cards_sql})",
        board_id,
    )
    await conn.execute(
        f"""DELETE FROM core_checklistitem WHERE checklist_id IN (
            SELECT id FROM core_checklist WHERE card_id IN ({cards_sql}))""",
        board_id,
    )
    await conn.execute(f"DELETE FROM core_checklist WHERE card_id IN ({cards_sql})", board_id)
    await conn.execute(f"DELETE FROM core_attachment WHERE card_id IN ({cards_sql})", board_id)
    await conn.execute(f"DELETE FROM core_cardfieldvalue WHERE card_id IN ({cards_sql})", board_id)
    await conn.execute(f"DELETE FROM core_cardcomment WHERE card_id IN ({cards_sql})", board_id)
    await conn.execute(f"DELETE FROM core_cardmovementevent WHERE card_id IN ({cards_sql})", board_id)
    for sql in (
        f"DELETE FROM core_cardtag WHERE card_id IN ({cards_sql})",
        f"DELETE FROM core_document WHERE card_id IN ({cards_sql})",
        f"DELETE FROM core_cardrelation WHERE from_card_id IN ({cards_sql}) OR to_card_id IN ({cards_sql})",
        f"DELETE FROM core_cardblock WHERE card_id IN ({cards_sql})",
        f"DELETE FROM core_timeentry WHERE card_id IN ({cards_sql})",
    ):
        try:
            await conn.execute(sql, board_id)
        except asyncpg.exceptions.UndefinedTableError:
            pass

    await conn.execute("DELETE FROM core_card WHERE board_id = $1::uuid", board_id)
    for sql in (
        "DELETE FROM core_sprintcapacity WHERE sprint_id IN (SELECT id FROM core_sprint WHERE board_id = $1::uuid)",
        "DELETE FROM core_sprint WHERE board_id = $1::uuid",
        "DELETE FROM core_automationexecution WHERE rule_id IN (SELECT id FROM core_automationrule WHERE board_id = $1::uuid)",
        "DELETE FROM core_automationrule WHERE board_id = $1::uuid",
        "DELETE FROM core_restrictionrule WHERE board_id = $1::uuid",
        "DELETE FROM core_wiplimit WHERE board_id = $1::uuid",
    ):
        try:
            await conn.execute(sql, board_id)
        except asyncpg.exceptions.UndefinedTableError:
            pass
    await conn.execute("DELETE FROM core_column WHERE board_id = $1::uuid", board_id)
    await conn.execute("DELETE FROM core_track WHERE board_id = $1::uuid", board_id)


def _coerce_priority_display(value: Any) -> str | None:
    """Убирает лишние кавычки из jsonb/строк (чтобы не показывать \"Срочно\")."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if len(s) >= 2 and s[0] in "\"'" and s[-1] == s[0]:
            s = s[1:-1].strip()
        return s or None
    return str(value).strip() or None


def _sanitize_tag_label(t: str) -> str:
    """Убирает мусор вроде [\", \", скобок у частично записанного JSON."""
    s = t.strip()
    for _ in range(6):
        prev = s
        s = s.lstrip(" \t[\"'`").rstrip(" \t]\"'`").strip()
        if s == prev:
            break
    return s


def _coerce_tags_list(value: Any) -> list[str]:
    """
    Теги в jsonb могут прийти как list, как JSON-строка '[\"a\",\"b\"]', или как одна строка с запятыми.
    Всегда отдаём плоский список строк для фронта.
    """
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for v in value:
            if isinstance(v, str) and v.strip().startswith("["):
                out.extend(_coerce_tags_list(v))
            else:
                s = _sanitize_tag_label(str(v))
                if s:
                    out.append(s)
        return out
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return []
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    return _coerce_tags_list(parsed)
            except Exception:
                pass
            inner = s.removeprefix("[").removesuffix("]").strip()
            return [_sanitize_tag_label(p) for p in inner.split(",") if _sanitize_tag_label(p)]
        return [_sanitize_tag_label(x) for x in s.split(",") if _sanitize_tag_label(x)]
    return []


def _card_lite(row: Any, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = meta or {}
    return {
        "id": str(row["id"]),
        "title": row["title"] or "",
        "description": row["description"] or "",
        "card_type": row["card_type"] or "task",
        "due_at": row["due_at"].isoformat() if row.get("due_at") else None,
        "planned_start_at": row["planned_start_at"].isoformat() if row.get("planned_start_at") else None,
        "planned_end_at": row["planned_end_at"].isoformat() if row.get("planned_end_at") else None,
        "track_id": str(row["track_id"]) if row.get("track_id") else None,
        "column_id": str(row["column_id"]),
        "priority": _coerce_priority_display(meta.get("priority")),
        "tags": _coerce_tags_list(meta.get("tags")),
        "assignee_name": meta.get("assignee_name"),
        "assignee_user_id": meta.get("assignee_user_id"),
        "assignee_avatar_url": meta.get("assignee_avatar_url"),
        "blocked_count": int(meta.get("blocked_count") or 0),
        "blocking_count": int(meta.get("blocking_count") or 0),
        "comments_count": int(meta.get("comments_count") or 0),
        "unread_comments_count": int(meta.get("unread_comments_count") or 0),
        "attachments_count": int(meta.get("attachments_count") or 0),
        "estimate_points": int(row["estimate_points"]) if row.get("estimate_points") is not None else None,
    }


@router.get("/boards")
async def boards_list(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
) -> list[dict[str, Any]]:
    """Список досок, доступных текущему пользователю.

    Заголовок `Authorization: Bearer` обязателен. Если передан `X-Space-Id`, возвращаются только доски этого пространства;
    иначе — все доски по всем организациям пользователя. Ответ: массив объектов с полями id, name, space_id, project_id.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    space_id = request.headers.get("x-space-id")
    async with state.pg_pool.acquire() as conn:
        if space_id:
            rows = await conn.fetch(
                """
                SELECT b.id, b.name, b.space_id, b.project_id
                FROM core_board b
                JOIN core_space s ON s.id = b.space_id
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE om.user_id = $1::uuid AND b.space_id = $2::uuid
                ORDER BY b.name
                """,
                user_id,
                space_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT b.id, b.name, b.space_id, b.project_id
                FROM core_board b
                JOIN core_space s ON s.id = b.space_id
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE om.user_id = $1::uuid
                ORDER BY b.name
                """,
                user_id,
            )
    return [
        {"id": str(r["id"]), "name": r["name"], "space_id": str(r["space_id"]), "project_id": str(r["project_id"])}
        for r in rows
    ]


@router.get("/projects")
async def projects_list(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
) -> list[dict[str, Any]]:
    """Список проектов (папок) в доступных пространствах.

    С `X-Space-Id` — только проекты выбранного space. Иначе — по всем space пользователя. Поля: id, name, space_id.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    space_id = request.headers.get("x-space-id")
    async with state.pg_pool.acquire() as conn:
        if space_id:
            rows = await conn.fetch(
                """
                SELECT p.id, p.name, p.space_id
                FROM core_project p
                JOIN core_space s ON s.id = p.space_id
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE om.user_id = $1::uuid AND p.space_id = $2::uuid
                ORDER BY p.name
                """,
                user_id,
                space_id,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT p.id, p.name, p.space_id
                FROM core_project p
                JOIN core_space s ON s.id = p.space_id
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE om.user_id = $1::uuid
                ORDER BY p.name
                """,
                user_id,
            )
    return [{"id": str(r["id"]), "name": r["name"], "space_id": str(r["space_id"])} for r in rows]


@router.post("/projects")
async def create_project(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Создать проект в пространстве.

    Тело: `name`, `space_id` (или берётся из `X-Space-Id`). Требуется роль manager или выше. Ответ: id, name, space_id.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    space_id = body.get("space_id") or request.headers.get("x-space-id")
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if not space_id:
        raise HTTPException(status_code=400, detail="space_id required")

    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        access = await conn.fetchrow(
            """
            SELECT 1
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE s.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            space_id,
            user_id,
        )
        if not access:
            raise HTTPException(status_code=403, detail="space_forbidden")
        project_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await conn.execute(
            "INSERT INTO core_project (id, space_id, name, created_at) VALUES ($1::uuid, $2::uuid, $3, $4)",
            project_id,
            space_id,
            name,
            now,
        )
    return {"id": project_id, "name": name, "space_id": str(space_id)}


@router.post("/boards")
async def create_board(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Создать канбан-доску.

    Тело: `name`, `space_id` / заголовок space, опционально `project_id`. Роль manager+. Возвращает id и метаданные доски.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    space_id = body.get("space_id") or request.headers.get("x-space-id")
    project_id = body.get("project_id")

    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if not space_id:
        raise HTTPException(status_code=400, detail="space_id required")

    async with state.pg_pool.acquire() as conn:
        access = await conn.fetchrow(
            """
            SELECT 1
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE s.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            space_id,
            user_id,
        )
        if not access:
            raise HTTPException(status_code=403, detail="space_forbidden")

        board_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        project_id_to_use = project_id
        if project_id_to_use:
            project_access = await conn.fetchrow(
                """
                SELECT 1
                FROM core_project p
                JOIN core_space s ON s.id = p.space_id
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE p.id = $1::uuid AND p.space_id = $2::uuid AND om.user_id = $3::uuid
                LIMIT 1
                """,
                project_id_to_use,
                space_id,
                user_id,
            )
            if not project_access:
                raise HTTPException(status_code=403, detail="project_forbidden")
        else:
            project_id_to_use = str(uuid.uuid4())
            await conn.execute(
                "INSERT INTO core_project (id, space_id, name, created_at) VALUES ($1::uuid, $2::uuid, $3, $4)",
                project_id_to_use,
                space_id,
                f"Проект {name}",
                now,
            )
        await conn.execute(
            """
            INSERT INTO core_board (id, space_id, project_id, name, created_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
            """,
            board_id,
            space_id,
            project_id_to_use,
            name,
            now,
        )

        await _ensure_board_workflow(conn, board_id)

    return {"id": board_id, "name": name, "space_id": str(space_id)}


@router.patch("/boards/{board_id}")
async def rename_board(
    request: Request,
    board_id: str,
    user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Переименовать доску по `board_id`.

    PATCH: `{\"name\": \"...\"}`. Проверяется членство и `X-Space-Id`. Роль manager+.
    """
    await _require_manager_for_board(board_id, user_id)
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    async with state.pg_pool.acquire() as conn:
        await conn.execute("UPDATE core_board SET name = $1 WHERE id = $2::uuid", name, board_id)
    return {"id": board_id, "name": name}


@router.delete("/boards/{board_id}")
async def delete_board(
    board_id: str,
    user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Удалить доску и связанные сущности (колонки, карточки — согласно каскадам БД).

    Роль менеджера/админа в зависимости от политики. Требуется доступ к space доски.
    """
    await _require_manager_for_board(board_id, user_id)
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        async with conn.transaction():
            await _purge_board_before_delete(conn, board_id)
            await conn.execute("DELETE FROM core_board WHERE id = $1::uuid", board_id)
    return {"ok": True, "board_id": board_id}


@router.post("/boards/{board_id}/columns")
async def create_column(
    request: Request,
    board_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Добавить колонку на доску.

    Тело: `name`, опционально `order_index`, `is_done`. Роль manager+. Используется для кастомизации воронки.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    is_done = bool(body.get("is_done", False))
    if not name:
        raise HTTPException(status_code=400, detail="name required")

    async with state.pg_pool.acquire() as conn:
        board = await conn.fetchrow(
            """
            SELECT b.id, b.space_id
            FROM core_board b
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE b.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            board_id,
            user_id,
        )
        if not board:
            raise HTTPException(status_code=404, detail="Доска не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(board["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="space_forbidden")

        max_order = await conn.fetchval(
            "SELECT COALESCE(MAX(order_index), 0) FROM core_column WHERE board_id = $1::uuid",
            board_id,
        )
        column_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await conn.execute(
            """
            INSERT INTO core_column (id, board_id, name, order_index, is_done, created_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
            """,
            column_id,
            board_id,
            name,
            int(max_order) + 1,
            is_done,
            now,
        )
    return {"id": column_id, "board_id": board_id, "name": name, "is_done": is_done}


@router.post("/boards/{board_id}/tracks")
async def create_track(
    request: Request,
    board_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Добавить дорожку (swimlane) на доску.

    Тело: `name`. Порядок — в конец списка дорожек. Роль manager+.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        board = await conn.fetchrow(
            """
            SELECT b.id, b.space_id
            FROM core_board b
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE b.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            board_id,
            user_id,
        )
        if not board:
            board_exists = await conn.fetchrow("SELECT id FROM core_board WHERE id = $1::uuid", board_id)
            if board_exists:
                raise HTTPException(status_code=403, detail="board_forbidden")
            raise HTTPException(status_code=404, detail="Доска не найдена")
        max_order = await conn.fetchval(
            "SELECT COALESCE(MAX(order_index), 0) FROM core_track WHERE board_id = $1::uuid",
            board_id,
        )
        track_id = str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO core_track (id, board_id, name, order_index, created_at)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5)
            """,
            track_id,
            board_id,
            name,
            int(max_order) + 1,
            datetime.now(timezone.utc),
        )
    return {"id": track_id, "board_id": board_id, "name": name}


@router.patch("/tracks/{track_id}")
async def rename_track(
    request: Request,
    track_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Переименовать дорожку (swimlane) доски.

    Тело JSON: `{\"name\": \"...\"}`. Требуется `Authorization: Bearer`, заголовок `X-Space-Id`
    (согласован с дорожкой) и роль manager или выше. Ошибки: 400 (пустое имя), 403 (другой space), 404.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    async with state.pg_pool.acquire() as conn:
        track = await conn.fetchrow(
            """
            SELECT t.id, t.board_id, b.space_id
            FROM core_track t
            JOIN core_board b ON b.id = t.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE t.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            track_id,
            user_id,
        )
        if not track:
            raise HTTPException(status_code=404, detail="Дорожка не найдена")
        active_space_id = request.headers.get("x-space-id")
        if active_space_id and str(track["space_id"]) != active_space_id:
            raise HTTPException(status_code=403, detail="space_forbidden")
        await conn.execute("UPDATE core_track SET name = $1 WHERE id = $2::uuid", name, track_id)
    return {"ok": True, "id": track_id, "name": name}


@router.delete("/tracks/{track_id}")
async def delete_track(
    request: Request,
    track_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Удалить дорожку доски.

    Карточки на дорожке получают `track_id = null`. Требуется Bearer, `X-Space-Id`, роль manager+.
    Ответ: `{\"ok\": true, \"id\": \"...\"}`. Ошибки: 403, 404.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        track = await conn.fetchrow(
            """
            SELECT t.id, t.board_id, b.space_id
            FROM core_track t
            JOIN core_board b ON b.id = t.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE t.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            track_id,
            user_id,
        )
        if not track:
            raise HTTPException(status_code=404, detail="Дорожка не найдена")
        active_space_id = request.headers.get("x-space-id")
        if active_space_id and str(track["space_id"]) != active_space_id:
            raise HTTPException(status_code=403, detail="space_forbidden")
        cards_in_track = await conn.fetchval("SELECT COUNT(*)::int FROM core_card WHERE track_id = $1::uuid", track_id)
        if int(cards_in_track or 0) > 0:
            await conn.execute("UPDATE core_card SET track_id = NULL WHERE track_id = $1::uuid", track_id)
        await conn.execute("DELETE FROM core_track WHERE id = $1::uuid", track_id)
    return {"ok": True, "id": track_id}


@router.patch("/columns/{column_id}")
async def update_column(
    request: Request,
    column_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Обновить колонку: имя и/или признак «колонка завершения» (`is_done`).

    PATCH: хотя бы одно из полей `name`, `is_done`. Роль manager+. Используется для финальных стадий канбана.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}

    name_in = body.get("name")
    is_done_in = body.get("is_done")

    if name_in is None and is_done_in is None:
        raise HTTPException(status_code=400, detail="Укажите name и/или is_done")

    next_name: str | None = None
    if name_in is not None:
        next_name = str(name_in).strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="name required")

    next_is_done: bool | None = None
    if is_done_in is not None:
        next_is_done = bool(is_done_in)

    async with state.pg_pool.acquire() as conn:
        col = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, b.space_id
            FROM core_column c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            column_id,
            user_id,
        )
        if not col:
            raise HTTPException(status_code=404, detail="Колонка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(col["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="space_forbidden")

        if next_name is not None and next_is_done is not None:
            await conn.execute(
                "UPDATE core_column SET name = $1, is_done = $2 WHERE id = $3::uuid",
                next_name,
                next_is_done,
                column_id,
            )
        elif next_name is not None:
            await conn.execute("UPDATE core_column SET name = $1 WHERE id = $2::uuid", next_name, column_id)
        else:
            await conn.execute("UPDATE core_column SET is_done = $1 WHERE id = $2::uuid", next_is_done, column_id)

        updated = await conn.fetchrow(
            "SELECT id, board_id, name, order_index, is_done FROM core_column WHERE id = $1::uuid",
            column_id,
        )
    return {
        "id": str(updated["id"]),
        "board_id": str(updated["board_id"]),
        "name": updated["name"],
        "order_index": int(updated["order_index"]),
        "is_done": bool(updated["is_done"]),
    }


@router.delete("/columns/{column_id}")
async def delete_column(
    request: Request,
    column_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Удалить колонку доски.

    Ограничения:
    - нельзя удалить последнюю колонку доски;
    - нельзя удалить непустую колонку (сначала переместите карточки).
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")

    async with state.pg_pool.acquire() as conn:
        col = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, b.space_id
            FROM core_column c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            column_id,
            user_id,
        )
        if not col:
            raise HTTPException(status_code=404, detail="Колонка не найдена")

        space_id = request.headers.get("x-space-id")
        if space_id and str(col["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="space_forbidden")

        board_id = str(col["board_id"])
        columns_total = await conn.fetchval(
            "SELECT COUNT(*)::int FROM core_column WHERE board_id = $1::uuid",
            board_id,
        )
        if int(columns_total or 0) <= 1:
            raise HTTPException(status_code=400, detail="cannot_delete_last_column")

        cards_total = await conn.fetchval(
            "SELECT COUNT(*)::int FROM core_card WHERE column_id = $1::uuid",
            column_id,
        )
        if int(cards_total or 0) > 0:
            raise HTTPException(status_code=400, detail="column_not_empty")

        await conn.execute("DELETE FROM core_column WHERE id = $1::uuid", column_id)

    return {"ok": True, "id": column_id}


@router.post("/columns/{column_id}/reorder")
async def reorder_column(
    request: Request,
    column_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Изменить порядок колонки относительно соседей.

    Тело: `direction` — `left` или `right`. Меняет `order_index` местами с соседней колонкой. Роль manager+.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    direction = (body.get("direction") or "").strip().lower()
    if direction not in ("left", "right"):
        raise HTTPException(status_code=400, detail="direction must be left or right")

    async with state.pg_pool.acquire() as conn:
        col = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, c.order_index, b.space_id
            FROM core_column c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            column_id,
            user_id,
        )
        if not col:
            raise HTTPException(status_code=404, detail="Колонка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(col["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="space_forbidden")

        board_id = str(col["board_id"])
        rows = await conn.fetch(
            "SELECT id, order_index FROM core_column WHERE board_id = $1::uuid ORDER BY order_index ASC, id ASC",
            board_id,
        )
        ids = [str(r["id"]) for r in rows]
        if column_id not in ids:
            raise HTTPException(status_code=404, detail="Колонка не найдена")
        idx = ids.index(column_id)
        if direction == "left" and idx <= 0:
            raise HTTPException(status_code=400, detail="already_first")
        if direction == "right" and idx >= len(ids) - 1:
            raise HTTPException(status_code=400, detail="already_last")

        j = idx - 1 if direction == "left" else idx + 1
        id_a, id_b = ids[idx], ids[j]
        oa = int(rows[idx]["order_index"])
        ob = int(rows[j]["order_index"])

        async with conn.transaction():
            await conn.execute("UPDATE core_column SET order_index = $1 WHERE id = $2::uuid", ob, id_a)
            await conn.execute("UPDATE core_column SET order_index = $1 WHERE id = $2::uuid", oa, id_b)

    return {"ok": True, "board_id": board_id}


@router.patch("/columns/{column_id}/wip-limit")
async def set_column_wip_limit(
    request: Request,
    column_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Задать или снять лимит WIP для колонки.

    PATCH: `limit` — целое число или `null` (удалить лимит). Применяется к колонке доски; при переполнении `move` вернёт ошибку.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    limit_raw = body.get("limit")

    async with state.pg_pool.acquire() as conn:
        col = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, b.space_id, s.organization_id
            FROM core_column c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            column_id,
            user_id,
        )
        if not col:
            raise HTTPException(status_code=404, detail="Колонка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(col["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="space_forbidden")

        board_id = str(col["board_id"])
        org_id = str(col["organization_id"])

        if limit_raw is None:
            await conn.execute(
                """
                DELETE FROM core_wiplimit
                WHERE board_id = $1::uuid AND column_id = $2::uuid AND scope_type = 'column'
                """,
                board_id,
                column_id,
            )
            return {"ok": True, "limit": None}

        try:
            lim = int(limit_raw)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="limit must be integer")
        if lim < 0:
            raise HTTPException(status_code=400, detail="limit must be >= 0")

        existing = await conn.fetchrow(
            """
            SELECT id FROM core_wiplimit
            WHERE board_id = $1::uuid AND column_id = $2::uuid AND scope_type = 'column'
            LIMIT 1
            """,
            board_id,
            column_id,
        )
        now = datetime.now(timezone.utc)
        if existing:
            await conn.execute(
                'UPDATE core_wiplimit SET "limit" = $1 WHERE id = $2::uuid',
                lim,
                str(existing["id"]),
            )
        else:
            await conn.execute(
                """
                INSERT INTO core_wiplimit (id, organization_id, board_id, scope_type, column_id, "limit", created_at)
                VALUES ($1::uuid, $2::uuid, $3::uuid, 'column', $4::uuid, $5, $6)
                """,
                str(uuid.uuid4()),
                org_id,
                board_id,
                column_id,
                lim,
                now,
            )

        return {"ok": True, "limit": lim}


@router.post("/bootstrap")
async def bootstrap(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Инициализировать пространство демо-данными (проект, доска, колонки workflow, карточки, дорожка, WIP, чеклист, поля).

    Вызывается при первом входе в пустое пространство. Идемпотентность не гарантируется при повторных вызовах — создаёт новые сущности.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    space_id = request.headers.get("x-space-id")
    async with state.pg_pool.acquire() as conn:
        if not space_id:
            row = await conn.fetchrow(
                """
                SELECT s.id FROM core_space s
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE om.user_id = $1::uuid
                ORDER BY s.created_at
                LIMIT 1
                """,
                user_id,
            )
            if not row:
                raise HTTPException(status_code=400, detail="Нет пространства. Создайте организацию и space.")
            space_id = str(row["id"])
        else:
            r = await conn.fetchrow(
                "SELECT 1 FROM core_space s JOIN core_organizationmember om ON om.organization_id = s.organization_id WHERE om.user_id = $1::uuid AND s.id = $2::uuid",
                user_id,
                space_id,
            )
            if not r:
                raise HTTPException(status_code=403, detail="space_forbidden")

        now = datetime.now(timezone.utc)
        project_id = str(uuid.uuid4())
        board_id = str(uuid.uuid4())
        col_ids = [str(uuid.uuid4()) for _ in range(3)]
        track_id = str(uuid.uuid4())
        card1_id = str(uuid.uuid4())
        card2_id = str(uuid.uuid4())
        checklist_id = str(uuid.uuid4())
        item1_id = str(uuid.uuid4())
        item2_id = str(uuid.uuid4())
        def_priority_id = str(uuid.uuid4())
        def_est_id = str(uuid.uuid4())
        val_priority_id = str(uuid.uuid4())
        val_est_id = str(uuid.uuid4())
        wip1_id = str(uuid.uuid4())
        wip2_id = str(uuid.uuid4())
        org_id_row = await conn.fetchrow("SELECT organization_id FROM core_space WHERE id = $1::uuid", space_id)
        org_id = str(org_id_row["organization_id"])

        await conn.execute(
            "INSERT INTO core_project (id, space_id, name, created_at) VALUES ($1::uuid, $2::uuid, $3, $4)",
            project_id, space_id, "Демо-проект", now,
        )
        await conn.execute(
            "INSERT INTO core_board (id, space_id, project_id, name, created_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)",
            board_id, space_id, project_id, "Демо-доска", now,
        )
        await conn.execute(
            "INSERT INTO core_column (id, board_id, name, order_index, is_done, created_at) VALUES ($1::uuid, $2::uuid, $3, 0, false, $4), ($5::uuid, $2::uuid, $6, 1, false, $4), ($7::uuid, $2::uuid, $8, 2, true, $4)",
            col_ids[0], board_id, "ToDo", now, col_ids[1], "InProgress", col_ids[2], "Done",
        )
        await conn.execute(
            "INSERT INTO core_track (id, board_id, name, order_index, created_at) VALUES ($1::uuid, $2::uuid, $3, 0, $4)",
            track_id, board_id, "Основной поток", now,
        )
        await conn.execute(
            """INSERT INTO core_card (id, board_id, column_id, track_id, title, description, card_type, created_at, updated_at)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'task', $7, $7), ($8::uuid, $2::uuid, $9::uuid, $4::uuid, $10, $11, 'task', $7, $7)""",
            card1_id, board_id, col_ids[0], track_id, "Собрать требования", "Описание задачи для демо.", now,
            card2_id, col_ids[1], "Реализовать Kanban", "Через REST + realtime.", now,
        )
        await conn.execute(
            "INSERT INTO core_checklist (id, card_id, title) VALUES ($1::uuid, $2::uuid, $3)",
            checklist_id, card1_id, "Чек-лист требований",
        )
        await conn.execute(
            "INSERT INTO core_checklistitem (id, checklist_id, title, is_done, created_at) VALUES ($1::uuid, $2::uuid, $3, false, $4), ($5::uuid, $2::uuid, $6, false, $4)",
            item1_id, checklist_id, "Собрать input от команды", now, item2_id, "Проверить scope и допущения", now,
        )
        await conn.execute(
            "INSERT INTO core_cardfielddefinition (id, space_id, key, name, field_type, created_at) VALUES ($1::uuid, $2::uuid, $3, $4, 'text', $5), ($6::uuid, $2::uuid, $7, $8, 'number', $5)",
            def_priority_id, space_id, "priority", "Приоритет", now, def_est_id, "customer_value", "Ценность для заказчика", now,
        )
        await conn.execute(
            "INSERT INTO core_cardfieldvalue (id, card_id, definition_id, value, updated_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5), ($6::uuid, $2::uuid, $7::uuid, $8::jsonb, $5)",
            val_priority_id, card1_id, def_priority_id, json.dumps("Высокий"), now, val_est_id, def_est_id, json.dumps(10), now,
        )
        await conn.execute(
            "INSERT INTO core_wiplimit (id, organization_id, board_id, scope_type, column_id, \"limit\", created_at) VALUES ($1::uuid, $2::uuid, $3::uuid, 'column', $4::uuid, 5, $5), ($6::uuid, $2::uuid, $3::uuid, 'column', $7::uuid, 5, $5)",
            wip1_id, org_id, board_id, col_ids[0], now, wip2_id, col_ids[1], now,
        )

    return {"board_id": board_id}


@router.get("/boards/{board_id}/grid")
async def board_grid(
    board_id: str,
    user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Получить полное состояние канбан-доски для UI.

    Возвращает объект `board`, список `columns` (с карточками внутри), `tracks`, `effective_role`.
    Гарантирует наличие стандартного workflow колонок.
    Доступ: членство в организации доски (`get_effective_role`). Заголовок `X-Space-Id` намеренно
    не проверяется здесь: устаревший или «чужой» space из UI иначе давал 403 при загрузке сетки.
    Включает метаданные карточек: поля, счётчики комментариев/вложений, WIP-лимиты колонок.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        board = await conn.fetchrow(
            "SELECT id, name FROM core_board WHERE id = $1::uuid", board_id
        )
        if not board:
            raise HTTPException(status_code=404, detail="Доска не найдена")
        await _ensure_board_workflow(conn, board_id)
        org_id = await conn.fetchval(
            "SELECT s.organization_id FROM core_board b JOIN core_space s ON s.id = b.space_id WHERE b.id = $1::uuid",
            board_id,
        )
        effective_role = await get_effective_role(user_id, str(org_id))

        columns = await conn.fetch(
            """
            SELECT c.id, c.name, c.order_index, c.is_done, w."limit" AS wip_limit
            FROM core_column c
            LEFT JOIN core_wiplimit w
              ON w.column_id = c.id AND w.board_id = c.board_id AND w.scope_type = 'column'
            WHERE c.board_id = $1::uuid
            ORDER BY c.order_index
            """,
            board_id,
        )
        cards = await conn.fetch(
            "SELECT id, title, description, card_type, due_at, planned_start_at, planned_end_at, track_id, column_id, estimate_points FROM core_card WHERE board_id = $1::uuid ORDER BY updated_at DESC",
            board_id,
        )
        tracks = await conn.fetch(
            "SELECT id, name FROM core_track WHERE board_id = $1::uuid ORDER BY order_index",
            board_id,
        )

        card_ids = [str(c["id"]) for c in cards]
        card_meta: dict[str, dict[str, Any]] = {}
        executor_assigned_card_ids: set[str] = set()
        if card_ids:
            rows = await conn.fetch(
                """
                SELECT fv.card_id, fd.key, fv.value
                FROM core_cardfieldvalue fv
                JOIN core_cardfielddefinition fd ON fd.id = fv.definition_id
                WHERE fv.card_id = ANY($1::uuid[])
                """,
                card_ids,
            )
            for r in rows:
                cid = str(r["card_id"])
                meta = card_meta.setdefault(cid, {})
                key = str(r["key"] or "")
                value = r["value"]
                if key == "priority":
                    meta["priority"] = value if isinstance(value, str) else None
                elif key == "tags":
                    if isinstance(value, list):
                        meta["tags"] = [str(v) for v in value]
                    elif isinstance(value, str):
                        parts = [x.strip() for x in value.split(",") if x.strip()]
                        meta["tags"] = parts
                elif key == "assignee_name":
                    meta["assignee_name"] = value if isinstance(value, str) else None
                elif key == "assignee_user_id":
                    meta["assignee_user_id"] = value if isinstance(value, str) else None
                elif key == ARCHIVED_FIELD_KEY:
                    meta["is_archived"] = _jsonish_bool(value)
                elif key == ARCHIVED_AT_FIELD_KEY:
                    meta["archived_at"] = str(value).strip() if value is not None else None
                elif key == ARCHIVED_EFFORT_SECONDS_FIELD_KEY:
                    try:
                        meta["archive_total_labor_seconds"] = float(value)
                    except Exception:
                        meta["archive_total_labor_seconds"] = 0.0
                elif key == "blocked_count":
                    try:
                        meta["blocked_count"] = int(value)
                    except Exception:
                        meta["blocked_count"] = 0
                elif key == "blocking_count":
                    try:
                        meta["blocking_count"] = int(value)
                    except Exception:
                        meta["blocking_count"] = 0

            comments_stat = await conn.fetch(
                """
                SELECT c.id AS card_id,
                       COUNT(cc.id)::int AS comments_count,
                       COUNT(*) FILTER (WHERE cc.created_at > COALESCE(rs.last_seen_comment_at, to_timestamp(0)))::int AS unread_comments_count
                FROM core_card c
                LEFT JOIN core_cardcomment cc ON cc.card_id = c.id
                LEFT JOIN core_cardcommentreadstate rs ON rs.card_id = c.id AND rs.user_id = $2::uuid
                WHERE c.id = ANY($1::uuid[])
                GROUP BY c.id, rs.last_seen_comment_at
                """,
                card_ids,
                user_id,
            )
            for row in comments_stat:
                cid = str(row["card_id"])
                meta = card_meta.setdefault(cid, {})
                meta["comments_count"] = int(row["comments_count"] or 0)
                meta["unread_comments_count"] = int(row["unread_comments_count"] or 0)

            attachments_stat = await conn.fetch(
                "SELECT card_id, COUNT(*)::int AS attachments_count FROM core_attachment WHERE card_id = ANY($1::uuid[]) GROUP BY card_id",
                card_ids,
            )
            for row in attachments_stat:
                cid = str(row["card_id"])
                meta = card_meta.setdefault(cid, {})
                meta["attachments_count"] = int(row["attachments_count"] or 0)

            assignee_ids: list[str] = []
            for meta in card_meta.values():
                aid = meta.get("assignee_user_id")
                if aid and str(aid).strip():
                    assignee_ids.append(str(aid).strip())
            if assignee_ids:
                unique_assignees = list({x for x in assignee_ids})
                await _ensure_user_avatar_url_column(conn)
                avatar_rows = await conn.fetch(
                    """
                    SELECT id::text AS id, COALESCE(NULLIF(trim(avatar_url), ''), '') AS avatar_url
                    FROM core_user WHERE id = ANY($1::uuid[])
                    """,
                    unique_assignees,
                )
                id_to_avatar = {str(r["id"]): (r["avatar_url"] or "").strip() for r in avatar_rows}
                for meta in card_meta.values():
                    aid = meta.get("assignee_user_id")
                    if not aid:
                        continue
                    au = id_to_avatar.get(str(aid).strip())
                    if au:
                        meta["assignee_avatar_url"] = au

            if effective_role == "executor":
                assigned_rows = await conn.fetch(
                    "SELECT card_id::text AS card_id FROM core_cardassignment WHERE user_id = $1::uuid",
                    user_id,
                )
                executor_assigned_card_ids = {str(r["card_id"]) for r in assigned_rows}

    col_name_by_id = {str(c["id"]): str(c["name"] or "") for c in columns}
    col_id_by_name = {str(c["name"] or ""): str(c["id"]) for c in columns}
    todo_col_id = col_id_by_name.get(WORKFLOW_TODO_COLUMN_NAME)
    in_progress_col_id = col_id_by_name.get(WORKFLOW_IN_PROGRESS_COLUMN_NAME)

    by_col = {str(c["id"]): [] for c in columns}
    valid_col_ids = set(by_col.keys())
    fallback_column_id: str | None = None
    if columns:
        backlog_id = col_id_by_name.get(DEFAULT_BACKLOG_COLUMN_NAME)
        fallback_column_id = str(backlog_id) if backlog_id and backlog_id in valid_col_ids else str(columns[0]["id"])

    for card in cards:
        cid = str(card["id"])
        meta = card_meta.get(cid, {})
        if _jsonish_bool(meta.get("is_archived")):
            continue
        if effective_role == "executor" and cid not in executor_assigned_card_ids:
            continue

        original_column_id = str(card["column_id"])
        target_column_id = original_column_id
        if (
            effective_role in {"manager", "admin"}
            and meta.get("assignee_user_id")
            and todo_col_id
            and in_progress_col_id
            and original_column_id == todo_col_id
        ):
            # Для manager/admin назначенная задача визуально считается «В работе».
            target_column_id = in_progress_col_id

        if target_column_id not in valid_col_ids:
            # Карточка ссылается на удалённую/чужую колонку — без падения сетки кладём в запасную.
            if fallback_column_id and fallback_column_id in valid_col_ids:
                target_column_id = fallback_column_id
            else:
                continue

        card_payload = _card_lite(card, meta)
        card_payload["column_id"] = target_column_id
        card_payload["source_column_id"] = original_column_id
        card_payload["source_column_name"] = col_name_by_id.get(original_column_id, "")
        by_col[target_column_id].append(card_payload)

    visible_columns = columns
    if effective_role == "executor":
        visible_columns = [c for c in columns if str(c["name"] or "").strip() != DEFAULT_BACKLOG_COLUMN_NAME]
    return {
        "board": {"id": str(board["id"]), "name": board["name"]},
        "effective_role": effective_role,
        "tracks": [{"id": str(t["id"]), "name": t["name"]} for t in tracks],
        "columns": [
            {
                "id": str(c["id"]),
                "name": c["name"],
                "order_index": c["order_index"],
                "is_done": c["is_done"],
                "wip_limit": int(c["wip_limit"]) if c["wip_limit"] is not None else None,
                "cards": by_col[str(c["id"])],
            }
            for c in visible_columns
        ],
    }


async def _validate_wip(conn, board_id: str, to_column_id: str, card_id: str, org_id: str) -> str | None:
    """Возвращает сообщение об ошибке или None."""
    r = await conn.fetchrow(
        """SELECT c.is_done, w."limit" FROM core_column c
           LEFT JOIN core_wiplimit w ON w.column_id = c.id AND w.board_id = c.board_id AND w.scope_type = 'column'
           WHERE c.id = $1::uuid AND c.board_id = $2::uuid
           LIMIT 1""",
        to_column_id,
        board_id,
    )
    if not r or r["is_done"] or r["limit"] is None:
        return None
    limit_val = int(r["limit"])
    cnt = await conn.fetchval(
        "SELECT COUNT(*) FROM core_card WHERE board_id = $1::uuid AND column_id = $2::uuid AND id != $3::uuid",
        board_id,
        to_column_id,
        card_id,
    )
    if cnt >= limit_val:
        col_name = await conn.fetchval("SELECT name FROM core_column WHERE id = $1::uuid", to_column_id)
        return f"WIP лимит превышен для колонки {col_name}"
    return None


@router.post("/cards/{card_id}/move")
async def card_move(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> dict[str, Any]:
    """Переместить карточку в другую колонку и/или дорожку.

    Тело JSON: `to_column_id` (обязательно), опционально `to_track_id`. Проверяется WIP-лимит целевой колонки,
    права исполнителя/менеджера. Может обновлять порядок в колонке. Ошибки: 400, 403, 404, 409 (WIP).
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    to_column_id = body.get("to_column_id")
    to_track_id = body.get("to_track_id")
    if not to_column_id:
        raise HTTPException(status_code=400, detail="to_column_id required")

    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        card = await conn.fetchrow(
            "SELECT id, board_id, column_id, track_id FROM core_card WHERE id = $1::uuid",
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        space = await conn.fetchrow(
            """
            SELECT b.space_id, s.organization_id
            FROM core_board b
            JOIN core_space s ON s.id = b.space_id
            WHERE b.id = $1::uuid
            """,
            str(card["board_id"]),
        )
        if not space:
            raise HTTPException(status_code=404, detail="Доска не найдена")
        role = await get_effective_role(user_id, str(space["organization_id"]))
        space_id_h = request.headers.get("x-space-id")
        if space_id_h and str(space["space_id"]) != space_id_h:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        to_col = await conn.fetchrow("SELECT id, board_id FROM core_column WHERE id = $1::uuid", str(to_column_id))
        if not to_col or str(to_col["board_id"]) != str(card["board_id"]):
            raise HTTPException(status_code=400, detail="Некорректный переход: колонка не принадлежит доске")
        from_col_name = (await conn.fetchval("SELECT name FROM core_column WHERE id = $1::uuid", card["column_id"]) or "").strip()
        to_col_name = (await conn.fetchval("SELECT name FROM core_column WHERE id = $1::uuid", str(to_column_id)) or "").strip()

        if role == "executor":
            allowed = await _can_executor_work_with_card(conn, user_id, card_id)
            if not allowed:
                raise HTTPException(status_code=403, detail="executor_card_forbidden")
            allowed_transitions = {
                (WORKFLOW_TODO_COLUMN_NAME, WORKFLOW_IN_PROGRESS_COLUMN_NAME),
                (WORKFLOW_IN_PROGRESS_COLUMN_NAME, WORKFLOW_REVIEW_COLUMN_NAME),
            }
            if str(card["column_id"]) != str(to_column_id) and (from_col_name, to_col_name) not in allowed_transitions:
                raise HTTPException(status_code=403, detail="executor_transition_forbidden")

        wip_err = await _validate_wip(conn, str(card["board_id"]), str(to_column_id), card_id, str(space["organization_id"]))
        if wip_err:
            raise HTTPException(status_code=400, detail=wip_err)

        from_column_id = card["column_id"]
        from_track_id = card["track_id"]
        now = datetime.now(timezone.utc)
        await conn.execute(
            "UPDATE core_card SET column_id = $1::uuid, track_id = $2::uuid, updated_at = $3 WHERE id = $4::uuid",
            to_column_id,
            to_track_id if to_track_id else None,
            now,
            card_id,
        )
        movement_id = str(uuid.uuid4())
        await conn.execute(
            """INSERT INTO core_cardmovementevent (id, organization_id, card_id, actor_id, event_type, from_column_id, to_column_id, from_track_id, to_track_id, metadata, happened_at)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'moved', $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9::jsonb, $10)""",
            movement_id,
            space["organization_id"],
            card_id,
            user_id,
            from_column_id,
            to_column_id,
            from_track_id,
            to_track_id if to_track_id else None,
            json.dumps({"source": "kanban_move"}),
            now,
        )
        await ensure_notifications_table(conn=conn)
        card_title = await conn.fetchval("SELECT title FROM core_card WHERE id = $1::uuid", card_id)
        await create_notification_for_org_members(
            conn=conn,
            organization_id=str(space["organization_id"]),
            actor_user_id=user_id,
            kind="card_moved",
            title="Карточка перемещена",
            body=f"{card_title or 'Карточка'}: {from_col_name or '-'} -> {to_col_name or '-'}",
            metadata={
                "card_id": card_id,
                "board_id": str(card["board_id"]),
                "from_column_id": str(from_column_id),
                "to_column_id": str(to_column_id),
            },
        )
        updated = await conn.fetchrow(
            "SELECT id, title, description, card_type, due_at, planned_start_at, planned_end_at, track_id, column_id FROM core_card WHERE id = $1::uuid",
            card_id,
        )

    payload = {"card": _card_lite(updated), "from_column_id": str(from_column_id), "to_column_id": str(to_column_id)}
    if state.manager:
        await state.manager.broadcast(str(card["board_id"]), {"type": "card_moved", "payload": payload})
    return {"ok": True, "movement_id": movement_id, "payload": payload}


async def _column_dwell_times_for_card(conn: Any, card_id: str) -> list[dict[str, Any]]:
    """Суммарное время нахождения карточки в каждой колонке по событиям перемещения."""
    card = await conn.fetchrow(
        "SELECT created_at, column_id, board_id FROM core_card WHERE id = $1::uuid",
        card_id,
    )
    if not card:
        return []
    created = card["created_at"]
    if created is not None and getattr(created, "tzinfo", None) is None:
        created = created.replace(tzinfo=timezone.utc)
    board_id = str(card["board_id"])
    rows = await conn.fetch(
        """
        SELECT from_column_id, to_column_id, happened_at
        FROM core_cardmovementevent
        WHERE card_id = $1::uuid AND event_type = 'moved'
        ORDER BY happened_at ASC
        """,
        card_id,
    )
    now = datetime.now(timezone.utc)
    acc: dict[str, float] = {}

    def _norm_dt(dt: Any) -> datetime | None:
        if dt is None:
            return None
        if getattr(dt, "tzinfo", None) is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt

    def add_seg(col_id: Any, t0: Any, t1: Any) -> None:
        if col_id is None or t0 is None or t1 is None:
            return
        t0n = _norm_dt(t0)
        t1n = _norm_dt(t1)
        if t0n is None or t1n is None or t1n <= t0n:
            return
        cid = str(col_id)
        acc[cid] = acc.get(cid, 0.0) + (t1n - t0n).total_seconds()

    if not rows:
        add_seg(card["column_id"], created, now)
    else:
        add_seg(rows[0]["from_column_id"], created, rows[0]["happened_at"])
        for i in range(len(rows) - 1):
            add_seg(rows[i]["to_column_id"], rows[i]["happened_at"], rows[i + 1]["happened_at"])
        add_seg(rows[-1]["to_column_id"], rows[-1]["happened_at"], now)

    if not acc:
        return []

    col_ids = list(acc.keys())
    name_rows = await conn.fetch(
        "SELECT id, name, order_index FROM core_column WHERE board_id = $1::uuid AND id = ANY($2::uuid[])",
        board_id,
        col_ids,
    )
    names = {str(r["id"]): (r["name"] or "") for r in name_rows}
    order_map = {str(r["id"]): int(r["order_index"]) for r in name_rows}
    out = [
        {
            "column_id": cid,
            "column_name": names.get(cid, ""),
            "seconds": round(acc[cid], 1),
        }
        for cid in col_ids
    ]
    out.sort(key=lambda x: (order_map.get(x["column_id"], 999), x["column_name"]))
    return out


async def _card_detail_dict(conn, card_id: str) -> dict[str, Any]:
    """Собрать полный ответ карточки по card_id (требует открытый conn)."""
    card = await conn.fetchrow(
        """SELECT c.id, c.title, c.description, c.card_type, c.due_at, c.track_id, c.column_id,
                 c.planned_start_at, c.planned_end_at, c.estimate_points, c.created_at,
                 b.id AS board_id, b.name AS board_name, b.space_id,
                 s.name AS space_name,
                 col.name AS column_name, col.is_done AS column_is_done
          FROM core_card c
          JOIN core_board b ON b.id = c.board_id
          JOIN core_space s ON s.id = b.space_id
          JOIN core_column col ON col.id = c.column_id
          WHERE c.id = $1::uuid""",
        card_id,
    )
    if not card:
        return None
    checklists = await conn.fetch("SELECT cl.id, cl.title FROM core_checklist cl WHERE cl.card_id = $1::uuid", card_id)
    checklist_items: dict[str, list] = {str(cl["id"]): [] for cl in checklists}
    for cl in checklists:
        items = await conn.fetch("SELECT id, title, is_done FROM core_checklistitem WHERE checklist_id = $1::uuid ORDER BY created_at", cl["id"])
        checklist_items[str(cl["id"])] = [{"id": str(i["id"]), "title": i["title"], "is_done": i["is_done"]} for i in items]
    attachments = await conn.fetch("SELECT id, file_name, file_url, content_type, size_bytes, created_at FROM core_attachment WHERE card_id = $1::uuid ORDER BY created_at", card_id)
    field_values = await conn.fetch(
        """SELECT fv.id, fv.definition_id, fd.key, fd.name, fv.value, fv.updated_at
           FROM core_cardfieldvalue fv JOIN core_cardfielddefinition fd ON fd.id = fv.definition_id WHERE fv.card_id = $1::uuid""",
        card_id,
    )
    comments = await conn.fetch(
        """SELECT cc.id, cc.author_id, u.full_name, u.email, cc.body, cc.created_at
           FROM core_cardcomment cc JOIN core_user u ON u.id = cc.author_id WHERE cc.card_id = $1::uuid ORDER BY cc.created_at""",
        card_id,
    )
    def val(v):
        if v is None:
            return None
        if isinstance(v, dict):
            return v
        try:
            return json.loads(v) if isinstance(v, str) else v
        except Exception:
            return v
    return {
        "id": str(card["id"]),
        "title": card["title"],
        "description": card["description"] or "",
        "card_type": card["card_type"] or "task",
        "created_at": card["created_at"].isoformat() if card.get("created_at") else None,
        "due_at": card["due_at"].isoformat() if card.get("due_at") else None,
        "track_id": str(card["track_id"]) if card.get("track_id") else None,
        "board_id": str(card["board_id"]),
        "board_name": card["board_name"] or "",
        "space_id": str(card["space_id"]),
        "space_name": card["space_name"] or "",
        "column_id": str(card["column_id"]),
        "column_name": card["column_name"] or "",
        "column_is_done": bool(card["column_is_done"]),
        "planned_start_at": card["planned_start_at"].isoformat() if card.get("planned_start_at") else None,
        "planned_end_at": card["planned_end_at"].isoformat() if card.get("planned_end_at") else None,
        "estimate_points": card["estimate_points"],
        "checklists": [{"id": str(cl["id"]), "title": cl["title"], "items": checklist_items[str(cl["id"])]} for cl in checklists],
        "attachments": [{"id": str(a["id"]), "file_name": a["file_name"], "file_url": a["file_url"], "content_type": a["content_type"] or "", "size_bytes": a["size_bytes"], "created_at": a["created_at"].isoformat() if a.get("created_at") else None} for a in attachments],
        "field_values": [{"id": str(f["id"]), "definition_id": str(f["definition_id"]), "key": f["key"], "name": f["name"], "value": val(f["value"]), "updated_at": f["updated_at"].isoformat() if f.get("updated_at") else None} for f in field_values],
        "comments": [{"id": str(c["id"]), "author_id": str(c["author_id"]), "author_full_name": c["full_name"] or "", "author_email": c["email"], "body": c["body"], "created_at": c["created_at"].isoformat() if c.get("created_at") else None} for c in comments],
        "column_dwell_times": await _column_dwell_times_for_card(conn, card_id),
    }


@router.get("/cards/{card_id}")
async def card_detail(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> dict[str, Any]:
    """Полная карточка для модального окна: поля, чеклисты, вложения, комментарии, мета.

    Требуется Bearer и `X-Space-Id`, совпадающий с пространством карточки. В ответе — `unread_comments_count`,
    `column_dwell_times` (только для ролей manager и admin), связи с доской/пространством. Ошибки: 403, 404, 503.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        card = await conn.fetchrow(
            """SELECT c.id, b.space_id, s.organization_id
               FROM core_card c
               JOIN core_board b ON b.id = c.board_id
               JOIN core_space s ON s.id = b.space_id
               WHERE c.id = $1::uuid""",
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(card["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        out = await _card_detail_dict(conn, card_id)
        role = await get_effective_role(user_id, str(card["organization_id"]))
        if role not in ("manager", "admin") and out is not None:
            out.pop("column_dwell_times", None)
        unread_count = await conn.fetchval(
            """
            SELECT COUNT(*)::int
            FROM core_cardcomment cc
            LEFT JOIN core_cardcommentreadstate rs ON rs.card_id = cc.card_id AND rs.user_id = $2::uuid
            WHERE cc.card_id = $1::uuid AND cc.created_at > COALESCE(rs.last_seen_comment_at, to_timestamp(0))
            """,
            card_id,
            user_id,
        )
        if out is not None:
            out["unread_comments_count"] = int(unread_count or 0)
    if not out:
        raise HTTPException(status_code=404, detail="Карточка не найдена")
    return out


async def _blocked_seconds_for_card(conn: asyncpg.Connection, card_id: str, ended_at: datetime) -> float:
    try:
        rows = await conn.fetch(
            """
            SELECT created_at, resolved_at, is_resolved
            FROM core_cardblock
            WHERE card_id = $1::uuid
            """,
            card_id,
        )
    except Exception:
        return 0.0
    total = 0.0
    for row in rows:
        started = row["created_at"]
        if started is None:
            continue
        if getattr(started, "tzinfo", None) is None:
            started = started.replace(tzinfo=timezone.utc)
        finished = row["resolved_at"] if row["is_resolved"] else ended_at
        if finished is None:
            finished = ended_at
        if getattr(finished, "tzinfo", None) is None:
            finished = finished.replace(tzinfo=timezone.utc)
        if finished > started:
            total += (finished - started).total_seconds()
    return max(total, 0.0)


@router.post("/cards/{card_id}/archive")
async def archive_card(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Архивировать карточку и сохранить трудозатраты.

    Доступ: manager/admin. Карточка должна быть в колонке «Выполнено».
    Формула: (архивация - старт карточки) - время блокировок.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        card = await conn.fetchrow(
            """
            SELECT c.id, c.title, c.created_at, c.planned_start_at, c.column_id, c.board_id, b.space_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            card_id,
            user_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        active_space_id = request.headers.get("x-space-id")
        if active_space_id and str(card["space_id"]) != active_space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")

        column_name = await conn.fetchval("SELECT name FROM core_column WHERE id = $1::uuid", str(card["column_id"]))
        if (column_name or "").strip() != WORKFLOW_DONE_COLUMN_NAME:
            raise HTTPException(status_code=400, detail="archive_allowed_only_from_done")

        archived_at = datetime.now(timezone.utc)
        started_at = card["planned_start_at"] or card["created_at"] or archived_at
        if getattr(started_at, "tzinfo", None) is None:
            started_at = started_at.replace(tzinfo=timezone.utc)
        gross_seconds = max((archived_at - started_at).total_seconds(), 0.0)
        blocked_seconds = await _blocked_seconds_for_card(conn, card_id, archived_at)
        total_effort_seconds = max(gross_seconds - blocked_seconds, 0.0)

        await _upsert_card_field_value_by_key(
            conn,
            card_id=card_id,
            space_id=str(card["space_id"]),
            key=ARCHIVED_FIELD_KEY,
            name="В архиве",
            value=True,
            field_type="json",
        )
        await _upsert_card_field_value_by_key(
            conn,
            card_id=card_id,
            space_id=str(card["space_id"]),
            key=ARCHIVED_AT_FIELD_KEY,
            name="Дата архивации",
            value=archived_at.isoformat(),
            field_type="text",
        )
        await _upsert_card_field_value_by_key(
            conn,
            card_id=card_id,
            space_id=str(card["space_id"]),
            key=ARCHIVED_EFFORT_SECONDS_FIELD_KEY,
            name="Трудозатраты (сек)",
            value=round(total_effort_seconds, 1),
            field_type="number",
        )
    return {
        "ok": True,
        "card_id": card_id,
        "archived_at": archived_at.isoformat(),
        "total_effort_seconds": round(total_effort_seconds, 1),
    }


@router.get("/boards/{board_id}/archive")
async def board_archive_list(
    board_id: str,
    user_id: str = Depends(require_authenticated_user_id),
) -> list[dict[str, Any]]:
    """Список архивных карточек доски с рассчитанными трудозатратами."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        role_row = await conn.fetchrow(
            """
            SELECT s.organization_id
            FROM core_board b
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE b.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            board_id,
            user_id,
        )
        if not role_row:
            return []
        role = await get_effective_role(user_id, str(role_row["organization_id"]))
        if role == "executor":
            return []

        rows = await conn.fetch(
            """
            SELECT c.id::text AS id, c.title, b.name AS board_name, col.name AS column_name
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_column col ON col.id = c.column_id
            WHERE c.board_id = $1::uuid
            ORDER BY c.updated_at DESC
            """,
            board_id,
        )
        if not rows:
            return []
        card_ids = [r["id"] for r in rows]
        field_rows = await conn.fetch(
            """
            SELECT fv.card_id::text AS card_id, fd.key, fv.value
            FROM core_cardfieldvalue fv
            JOIN core_cardfielddefinition fd ON fd.id = fv.definition_id
            WHERE fv.card_id = ANY($1::uuid[])
              AND fd.key IN ($2, $3, $4)
            """,
            card_ids,
            ARCHIVED_FIELD_KEY,
            ARCHIVED_AT_FIELD_KEY,
            ARCHIVED_EFFORT_SECONDS_FIELD_KEY,
        )
        by_card: dict[str, dict[str, Any]] = {}
        for fr in field_rows:
            cid = str(fr["card_id"])
            meta = by_card.setdefault(cid, {})
            k = str(fr["key"] or "")
            v = fr["value"]
            if k == ARCHIVED_FIELD_KEY:
                meta["is_archived"] = _jsonish_bool(v)
            elif k == ARCHIVED_AT_FIELD_KEY:
                meta["archived_at"] = str(v).strip() if v is not None else None
            elif k == ARCHIVED_EFFORT_SECONDS_FIELD_KEY:
                try:
                    meta["total_effort_seconds"] = float(v)
                except Exception:
                    meta["total_effort_seconds"] = 0.0

        out: list[dict[str, Any]] = []
        for r in rows:
            cid = str(r["id"])
            meta = by_card.get(cid, {})
            if not _jsonish_bool(meta.get("is_archived")):
                continue
            out.append(
                {
                    "id": cid,
                    "title": (r["title"] or "").strip() or "—",
                    "board_name": (r["board_name"] or "").strip(),
                    "column_name": (r["column_name"] or "").strip(),
                    "archived_at": meta.get("archived_at"),
                    "total_effort_seconds": round(float(meta.get("total_effort_seconds") or 0.0), 1),
                }
            )
    return out


@router.post("/cards/{card_id}/checklists")
async def create_checklist(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Создать чеклист на карточке.

    Тело: `{\"title\": \"...\"}`. Роль manager+. Возвращает id чеклиста и пустой список items.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        card = await conn.fetchrow(
            "SELECT c.id, c.board_id, b.space_id FROM core_card c JOIN core_board b ON b.id = c.board_id WHERE c.id = $1::uuid",
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(card["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        checklist_id = str(uuid.uuid4())
        await conn.execute(
            "INSERT INTO core_checklist (id, card_id, title) VALUES ($1::uuid, $2::uuid, $3)",
            checklist_id,
            card_id,
            title,
        )
    return {"id": checklist_id, "title": title, "items": []}


@router.post("/checklists/{checklist_id}/items")
async def create_checklist_item(
    request: Request,
    checklist_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Добавить пункт в чеклист.

    Тело: `{\"title\": \"...\"}`. Проверяется принадлежность чеклиста к карточке в текущем space.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    async with state.pg_pool.acquire() as conn:
        checklist = await conn.fetchrow(
            """
            SELECT cl.id, cl.card_id, b.space_id
            FROM core_checklist cl
            JOIN core_card c ON c.id = cl.card_id
            JOIN core_board b ON b.id = c.board_id
            WHERE cl.id = $1::uuid
            """,
            checklist_id,
        )
        if not checklist:
            raise HTTPException(status_code=404, detail="Чек-лист не найден")
        space_id = request.headers.get("x-space-id")
        if space_id and str(checklist["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Чек-лист вне активного space")
        item_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await conn.execute(
            "INSERT INTO core_checklistitem (id, checklist_id, title, is_done, created_at) VALUES ($1::uuid, $2::uuid, $3, false, $4)",
            item_id,
            checklist_id,
            title,
            now,
        )
    return {"id": item_id, "title": title, "is_done": False}


@router.patch("/checklist-items/{item_id}")
async def update_checklist_item(
    request: Request,
    item_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Обновить пункт чеклиста (текст и/или `is_done`).

    PATCH JSON: опционально `title`, `is_done`. Роль manager+.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    patch_title = body.get("title")
    patch_done = body.get("is_done")
    async with state.pg_pool.acquire() as conn:
        item = await conn.fetchrow(
            """
            SELECT ci.id, ci.title, ci.is_done, cl.id AS checklist_id, b.space_id
            FROM core_checklistitem ci
            JOIN core_checklist cl ON cl.id = ci.checklist_id
            JOIN core_card c ON c.id = cl.card_id
            JOIN core_board b ON b.id = c.board_id
            WHERE ci.id = $1::uuid
            """,
            item_id,
        )
        if not item:
            raise HTTPException(status_code=404, detail="Пункт чек-листа не найден")
        space_id = request.headers.get("x-space-id")
        if space_id and str(item["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Пункт чек-листа вне активного space")
        new_title = item["title"] if patch_title is None else str(patch_title).strip()
        if not new_title:
            raise HTTPException(status_code=400, detail="title required")
        new_is_done = item["is_done"] if patch_done is None else bool(patch_done)
        await conn.execute(
            "UPDATE core_checklistitem SET title = $1, is_done = $2 WHERE id = $3::uuid",
            new_title,
            new_is_done,
            item_id,
        )
    return {"id": str(item_id), "title": new_title, "is_done": new_is_done}


@router.post("/cards/{card_id}/comments")
async def card_comments(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> list[dict[str, Any]]:
    """Добавить комментарий к карточке и вернуть полный список комментариев.

    Тело: `body` (текст, до 5000 символов), опционально `attachment_ids` для привязки уже загруженных вложений.
    Исполнитель может комментировать только «свои» карточки по правилам ACL. Создаёт уведомления участникам орг.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    comment_body = (body.get("body") or "").strip()
    if not comment_body or len(comment_body) > 5000:
        raise HTTPException(status_code=400, detail="body required, max 5000")

    async with state.pg_pool.acquire() as conn:
        card = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, b.space_id, s.organization_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            WHERE c.id = $1::uuid
            """,
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(card["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        role = await get_effective_role(user_id, str(card["organization_id"]))
        if role == "executor":
            allowed = await _can_executor_work_with_card(conn, user_id, card_id)
            if not allowed:
                raise HTTPException(status_code=403, detail="executor_card_forbidden")

        comment_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await conn.execute(
            """INSERT INTO core_cardcomment (id, organization_id, card_id, author_id, body, created_at)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6)""",
            comment_id,
            card["organization_id"],
            card_id,
            user_id,
            comment_body,
            now,
        )
        attachment_ids = body.get("attachment_ids") if isinstance(body.get("attachment_ids"), list) else []
        for att_id in attachment_ids:
            try:
                await conn.execute(
                    """
                    INSERT INTO core_commentattachmentlink (id, comment_id, attachment_id, created_at)
                    VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
                    ON CONFLICT (comment_id, attachment_id) DO NOTHING
                    """,
                    str(uuid.uuid4()),
                    comment_id,
                    str(att_id),
                    now,
                )
            except Exception:
                continue

        await conn.execute(
            """
            INSERT INTO core_cardcommentreadstate (id, card_id, user_id, last_seen_comment_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4)
            ON CONFLICT (card_id, user_id)
            DO UPDATE SET last_seen_comment_at = EXCLUDED.last_seen_comment_at, updated_at = EXCLUDED.updated_at
            """,
            str(uuid.uuid4()),
            card_id,
            user_id,
            now,
        )
        await ensure_notifications_table(conn=conn)
        card_title = await conn.fetchval("SELECT title FROM core_card WHERE id = $1::uuid", card_id)
        await create_notification_for_org_members(
            conn=conn,
            organization_id=str(card["organization_id"]),
            actor_user_id=user_id,
            kind="card_comment",
            title="Новый комментарий",
            body=f"{card_title or 'Карточка'}: {comment_body[:160]}",
            metadata={"card_id": card_id, "board_id": str(card["board_id"]), "comment_id": comment_id},
        )
        comments = await conn.fetch(
            """SELECT cc.id, cc.author_id, u.full_name, u.email, cc.body, cc.created_at
               FROM core_cardcomment cc JOIN core_user u ON u.id = cc.author_id
               WHERE cc.card_id = $1::uuid ORDER BY cc.created_at""",
            card_id,
        )
    return [
        {"id": str(c["id"]), "author_id": str(c["author_id"]), "author_full_name": c["full_name"] or "", "author_email": c["email"], "body": c["body"], "created_at": c["created_at"].isoformat() if c.get("created_at") else None}
        for c in comments
    ]


@router.post("/cards/{card_id}/comments/mark-read")
async def mark_card_comments_read(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> dict[str, Any]:
    """Отметить все комментарии карточки прочитанными для текущего пользователя.

    Обновляет `core_cardcommentreadstate`. Используется UI после просмотра треда.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        card = await conn.fetchrow(
            """
            SELECT c.id, b.space_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            WHERE c.id = $1::uuid
            """,
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(card["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        now = datetime.now(timezone.utc)
        await conn.execute(
            """
            INSERT INTO core_cardcommentreadstate (id, card_id, user_id, last_seen_comment_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $4)
            ON CONFLICT (card_id, user_id)
            DO UPDATE SET last_seen_comment_at = EXCLUDED.last_seen_comment_at, updated_at = EXCLUDED.updated_at
            """,
            str(uuid.uuid4()),
            card_id,
            user_id,
            now,
        )
    return {"ok": True, "card_id": card_id, "read_at": now.isoformat()}


@router.post("/cards/{card_id}/attachments")
async def card_attachments(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> dict[str, Any]:
    """Добавить вложение: загрузка файла (multipart, поле `file`) или ссылка (JSON: `file_url`, опционально `comment_id`).

    Файлы сохраняются под `MEDIA_ROOT`. Ответ — актуальный объект карточки (`_card_detail_dict`) с `last_attachment`.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    request_content_type = request.headers.get("content-type") or ""
    is_multipart = "multipart/form-data" in request_content_type
    link_payload: dict[str, Any] = {}

    async with state.pg_pool.acquire() as conn:
        card = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, b.space_id, s.organization_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            WHERE c.id = $1::uuid
            """,
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(card["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        role = await get_effective_role(user_id, str(card["organization_id"]))
        if role == "executor":
            allowed = await _can_executor_work_with_card(conn, user_id, card_id)
            if not allowed:
                raise HTTPException(status_code=403, detail="executor_card_forbidden")
        org_id = str(card["organization_id"])

    if is_multipart:
        form = await request.form()
        file = form.get("file")
        if not file or not hasattr(file, "read"):
            raise HTTPException(status_code=400, detail="Передайте поле file (файл)")
        upload: UploadFile = file
        filename = (upload.filename or "file").strip() or "file"
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in filename)[:200]
        ext = Path(safe_name).suffix
        stored_name = f"{uuid.uuid4().hex}{ext}"
        media_dir = Path(MEDIA_ROOT) / "attachments" / org_id
        media_dir.mkdir(parents=True, exist_ok=True)
        path = media_dir / stored_name
        content = await upload.read()
        path.write_bytes(content)
        file_url = f"{MEDIA_URL.rstrip('/')}/attachments/{org_id}/{stored_name}"
        file_name = filename
        content_type = upload.content_type or ""
        size_bytes = len(content)
    else:
        link_payload = await request.json() if request_content_type.startswith("application/json") else {}
        file_url = link_payload.get("file_url")
        if not file_url:
            raise HTTPException(status_code=400, detail="Для добавления по ссылке передайте file_url")
        file_name = (link_payload.get("file_name") or Path(urlparse(file_url).path).name or "link").strip()[:255]
        content_type = link_payload.get("content_type") or ""
        size_bytes = None
    is_preview = (content_type or "").startswith("image/")

    async with state.pg_pool.acquire() as conn:
        att_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await conn.execute(
            """INSERT INTO core_attachment (id, card_id, uploaded_by_id, file_name, file_url, content_type, size_bytes, created_at)
               VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8)""",
            att_id,
            card_id,
            user_id,
            file_name,
            file_url,
            content_type,
            size_bytes,
            now,
        )
        comment_id = None
        if not is_multipart:
            comment_id = link_payload.get("comment_id")
        if comment_id:
            await conn.execute(
                """
                INSERT INTO core_commentattachmentlink (id, comment_id, attachment_id, created_at)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
                ON CONFLICT (comment_id, attachment_id) DO NOTHING
                """,
                str(uuid.uuid4()),
                str(comment_id),
                att_id,
                now,
            )
        detail = await _card_detail_dict(conn, card_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Карточка не найдена")
    if detail:
        detail["last_attachment"] = {"id": att_id, "is_preview": is_preview}
    return detail


@router.delete("/cards/{card_id}/attachments/{attachment_id}")
async def delete_card_attachment(
    request: Request,
    card_id: str,
    attachment_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> dict[str, bool]:
    """Удалить вложение карточки. Доступно только ролям **manager** и **admin** (не исполнителю)."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        card = await conn.fetchrow(
            """SELECT c.id, b.space_id, s.organization_id
               FROM core_card c
               JOIN core_board b ON b.id = c.board_id
               JOIN core_space s ON s.id = b.space_id
               WHERE c.id = $1::uuid""",
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        space_id = request.headers.get("x-space-id")
        if space_id and str(card["space_id"]) != space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        role = await get_effective_role(user_id, str(card["organization_id"]))
        if role not in ("manager", "admin"):
            raise HTTPException(status_code=403, detail="insufficient_role")
        row = await conn.fetchrow(
            "SELECT id, file_url FROM core_attachment WHERE id = $1::uuid AND card_id = $2::uuid",
            attachment_id,
            card_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Вложение не найдено")
        file_url = str(row["file_url"] or "")
        await conn.execute("DELETE FROM core_commentattachmentlink WHERE attachment_id = $1::uuid", attachment_id)
        await conn.execute("DELETE FROM core_attachment WHERE id = $1::uuid AND card_id = $2::uuid", attachment_id, card_id)
    _delete_local_attachment_file(file_url)
    return {"ok": True}


@router.patch("/cards/{card_id}")
async def update_card(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Частично обновить карточку: заголовок, описание, сроки, колонку, тип (`task`/`bug`/`feature`), оценку.

    PATCH JSON — только передаваемые поля. Исполнитель ограничен (нельзя переносить в бэклог и т.д.). Возвращает полный detail.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}

    async with state.pg_pool.acquire() as conn:
        card = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, b.space_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            card_id,
            user_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        org_id = await conn.fetchval(
            "SELECT s.organization_id FROM core_board b JOIN core_space s ON s.id = b.space_id WHERE b.id = $1::uuid",
            str(card["board_id"]),
        )
        role = await get_effective_role(user_id, str(org_id))
        if role == "executor":
            allowed = await _can_executor_work_with_card(conn, user_id, card_id)
            if not allowed:
                raise HTTPException(status_code=403, detail="executor_card_forbidden")
        active_space_id = request.headers.get("x-space-id")
        if active_space_id and str(card["space_id"]) != active_space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")

        patch: dict[str, Any] = {}
        if "title" in body:
            patch["title"] = (body.get("title") or "").strip()
            if not patch["title"]:
                raise HTTPException(status_code=400, detail="title required")
        if "description" in body:
            patch["description"] = (body.get("description") or "").strip()
        if "estimate_points" in body:
            estimate_raw = body.get("estimate_points")
            patch["estimate_points"] = int(estimate_raw) if estimate_raw not in ("", None) else None
        if "column_id" in body:
            next_column_id = body.get("column_id")
            if not next_column_id:
                raise HTTPException(status_code=400, detail="column_id required")
            col = await conn.fetchrow(
                "SELECT id FROM core_column WHERE id = $1::uuid AND board_id = $2::uuid",
                str(next_column_id),
                str(card["board_id"]),
            )
            if not col:
                raise HTTPException(status_code=400, detail="column_not_found_or_outside_board")
            if role == "executor":
                col_name = await conn.fetchval("SELECT name FROM core_column WHERE id = $1::uuid", str(next_column_id))
                if (col_name or "").strip() == DEFAULT_BACKLOG_COLUMN_NAME:
                    raise HTTPException(status_code=403, detail="executor_cannot_move_to_backlog")
            patch["column_id"] = str(col["id"])

        def _parse_iso(value: Any) -> datetime | None:
            if value in (None, ""):
                return None
            try:
                return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            except Exception:
                return None

        if "planned_start_at" in body:
            patch["planned_start_at"] = _parse_iso(body.get("planned_start_at"))
        if "planned_end_at" in body:
            patch["planned_end_at"] = _parse_iso(body.get("planned_end_at"))
        if "due_at" in body:
            patch["due_at"] = _parse_iso(body.get("due_at"))

        if "card_type" in body:
            ct = str(body.get("card_type") or "").strip().lower()
            allowed_types = {"task", "bug", "feature"}
            if ct not in allowed_types:
                raise HTTPException(
                    status_code=400,
                    detail="card_type must be one of: task, bug, feature",
                )
            patch["card_type"] = ct

        if patch:
            set_parts: list[str] = []
            values: list[Any] = []
            idx = 1
            for key, value in patch.items():
                if key in {"column_id"}:
                    set_parts.append(f"{key} = ${idx}::uuid")
                else:
                    set_parts.append(f"{key} = ${idx}")
                values.append(value)
                idx += 1
            set_parts.append(f"updated_at = ${idx}")
            values.append(datetime.now(timezone.utc))
            idx += 1
            values.append(card_id)
            await conn.execute(
                f"UPDATE core_card SET {', '.join(set_parts)} WHERE id = ${idx}::uuid",
                *values,
            )

        detail = await _card_detail_dict(conn, card_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Карточка не найдена")
    return detail


@router.post("/cards/{card_id}/field-values")
async def upsert_card_field_value(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Создать или обновить значение пользовательского поля карточки.

    Тело: `key`, `name`, `field_type`, `value` (JSON). При отсутствии определения поля в space — создаётся определение.
    Возвращает полный detail карточки.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    key = (body.get("key") or "").strip()
    name = (body.get("name") or key).strip()
    field_type = (body.get("field_type") or "text").strip()
    value = body.get("value")
    if not key:
        raise HTTPException(status_code=400, detail="key required")
    if not name:
        raise HTTPException(status_code=400, detail="name required")

    async with state.pg_pool.acquire() as conn:
        card = await conn.fetchrow(
            """
            SELECT c.id, b.space_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            card_id,
            user_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        active_space_id = request.headers.get("x-space-id")
        if active_space_id and str(card["space_id"]) != active_space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")

        definition = await conn.fetchrow(
            "SELECT id FROM core_cardfielddefinition WHERE space_id = $1::uuid AND key = $2 LIMIT 1",
            str(card["space_id"]),
            key,
        )
        if definition:
            definition_id = str(definition["id"])
        else:
            definition_id = str(uuid.uuid4())
            await conn.execute(
                """
                INSERT INTO core_cardfielddefinition (id, space_id, key, name, field_type, created_at)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
                """,
                definition_id,
                str(card["space_id"]),
                key,
                name,
                field_type,
                datetime.now(timezone.utc),
            )

        serialized = json.dumps(value, ensure_ascii=False)
        now = datetime.now(timezone.utc)
        existing = await conn.fetchrow(
            "SELECT id FROM core_cardfieldvalue WHERE card_id = $1::uuid AND definition_id = $2::uuid",
            card_id,
            definition_id,
        )
        if existing:
            await conn.execute(
                "UPDATE core_cardfieldvalue SET value = $1::jsonb, updated_at = $2 WHERE id = $3::uuid",
                serialized,
                now,
                str(existing["id"]),
            )
        else:
            await conn.execute(
                """
                INSERT INTO core_cardfieldvalue (id, card_id, definition_id, value, updated_at)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5)
                """,
                str(uuid.uuid4()),
                card_id,
                definition_id,
                serialized,
                now,
            )
        detail = await _card_detail_dict(conn, card_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Карточка не найдена")
    return detail


@router.delete("/cards/{card_id}")
async def delete_card(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Удалить карточку и зависимые сущности (каскадно в транзакции).

    Роль manager+. Ответ: `{\"ok\": true, \"card_id\": \"...\"}`.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        card = await conn.fetchrow(
            """
            SELECT c.id, b.space_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE c.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            card_id,
            user_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        active_space_id = request.headers.get("x-space-id")
        if active_space_id and str(card["space_id"]) != active_space_id:
            raise HTTPException(status_code=403, detail="Карточка вне активного space")
        async with conn.transaction():
            await _purge_card_dependencies(conn, card_id)
            await conn.execute("DELETE FROM core_card WHERE id = $1::uuid", card_id)
    return {"ok": True, "card_id": card_id}


@router.post("/cards")
async def create_card(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Создать карточку на доске.

    Тело: `title`, `column_id`, опционально `board_id`, `track_id`, `description`, `due_at`, `planned_*`.
    Роль менеджера или выше. После создания рассылается уведомление организации. Возвращает detail карточки.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    title = (body.get("title") or "").strip()
    description = (body.get("description") or "").strip()
    column_id = body.get("column_id")
    board_id = body.get("board_id")
    track_id_raw = body.get("track_id")
    due_at = body.get("due_at")
    planned_start_at = body.get("planned_start_at")
    planned_end_at = body.get("planned_end_at")

    if not title:
        raise HTTPException(status_code=400, detail="title required")
    async with state.pg_pool.acquire() as conn:
        if not board_id and column_id:
            col_row = await conn.fetchrow("SELECT board_id FROM core_column WHERE id = $1::uuid", column_id)
            if col_row:
                board_id = str(col_row["board_id"])
        if not board_id:
            raise HTTPException(status_code=400, detail="board_id required or column not found")
        await _ensure_board_workflow(conn, str(board_id))
        backlog_column_id = await conn.fetchval(
            """
            SELECT id FROM core_column
            WHERE board_id = $1::uuid AND name = $2
            ORDER BY order_index
            LIMIT 1
            """,
            board_id,
            DEFAULT_BACKLOG_COLUMN_NAME,
        )
        if not backlog_column_id:
            raise HTTPException(status_code=400, detail="backlog_column_not_found")
        column_id = str(backlog_column_id)

        track_uuid: str | None = None
        if track_id_raw:
            tid = str(track_id_raw).strip()
            if tid:
                tr = await conn.fetchrow(
                    "SELECT id FROM core_track WHERE id = $1::uuid AND board_id = $2::uuid",
                    tid,
                    board_id,
                )
                if not tr:
                    raise HTTPException(status_code=400, detail="invalid_track_id")
                track_uuid = tid

        card_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        due_at_val = None
        if due_at:
            try:
                due_at_val = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
            except Exception:
                pass

        planned_start_at_val = None
        if planned_start_at:
            try:
                planned_start_at_val = datetime.fromisoformat(planned_start_at.replace("Z", "+00:00"))
            except Exception:
                planned_start_at_val = None

        planned_end_at_val = None
        raw_end = planned_end_at or due_at
        if raw_end:
            try:
                planned_end_at_val = datetime.fromisoformat(str(raw_end).replace("Z", "+00:00"))
            except Exception:
                planned_end_at_val = None

        if planned_end_at_val and not planned_start_at_val:
            planned_start_at_val = now

        await conn.execute(
            """
            INSERT INTO core_card (id, board_id, column_id, track_id, title, description, card_type, due_at, planned_start_at, planned_end_at, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'task', $7, $8, $9, $10, $10)
            """,
            card_id,
            board_id,
            column_id,
            track_uuid,
            title,
            description,
            due_at_val,
            planned_start_at_val,
            planned_end_at_val,
            now,
        )
        board_org = await conn.fetchrow(
            "SELECT organization_id FROM core_space WHERE id = (SELECT space_id FROM core_board WHERE id = $1::uuid)",
            board_id,
        )
        if board_org:
            await ensure_notifications_table(conn=conn)
            await create_notification_for_org_members(
                conn=conn,
                organization_id=str(board_org["organization_id"]),
                actor_user_id=user_id,
                kind="card_created",
                title="Создана карточка",
                body=title,
                metadata={"card_id": card_id, "board_id": str(board_id), "column_id": str(column_id)},
            )

        detail = await _card_detail_dict(conn, card_id)
    return detail or {"id": card_id, "title": title}


@router.post("/cards/{card_id}/assignees")
async def assign_card_executor(
    request: Request,
    card_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Назначить исполнителя карточки (участник организации).

    Тело: `user_id`. Таблица `core_cardassignment` (upsert). Роль менеджера или выше.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    assignee_user_id = body.get("user_id")
    if not assignee_user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    async with state.pg_pool.acquire() as conn:
        await _ensure_kanban_extensions(conn)
        card = await conn.fetchrow(
            """
            SELECT c.id, c.board_id, b.space_id, s.organization_id
            FROM core_card c
            JOIN core_board b ON b.id = c.board_id
            JOIN core_space s ON s.id = b.space_id
            WHERE c.id = $1::uuid
            """,
            card_id,
        )
        if not card:
            raise HTTPException(status_code=404, detail="Карточка не найдена")
        exists = await conn.fetchrow(
            "SELECT role FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid LIMIT 1",
            str(card["organization_id"]),
            str(assignee_user_id),
        )
        if not exists:
            raise HTTPException(status_code=400, detail="user_not_in_organization")
        assignee_role = str(exists["role"] or "").strip().lower()
        if assignee_role != "executor":
            raise HTTPException(status_code=400, detail="assignee_must_be_executor")
        assignee_row = await conn.fetchrow(
            "SELECT full_name, email FROM core_user WHERE id = $1::uuid",
            str(assignee_user_id),
        )
        assignee_name = (assignee_row["full_name"] or "").strip() if assignee_row else ""
        if not assignee_name and assignee_row:
            assignee_name = (assignee_row["email"] or "").strip()
        now = datetime.now(timezone.utc)
        await conn.execute("DELETE FROM core_cardassignment WHERE card_id = $1::uuid", card_id)
        await conn.execute(
            """
            INSERT INTO core_cardassignment (id, card_id, user_id, assigned_by_id, assigned_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)
            ON CONFLICT (card_id, user_id) DO UPDATE
            SET assigned_by_id = EXCLUDED.assigned_by_id, assigned_at = EXCLUDED.assigned_at
            """,
            str(uuid.uuid4()),
            card_id,
            str(assignee_user_id),
            user_id,
            now,
        )
        todo_column_id = await conn.fetchval(
            """
            SELECT id FROM core_column
            WHERE board_id = $1::uuid AND name = $2
            ORDER BY order_index
            LIMIT 1
            """,
            str(card["board_id"]),
            WORKFLOW_TODO_COLUMN_NAME,
        )
        if todo_column_id:
            await conn.execute(
                "UPDATE core_card SET column_id = $1::uuid, updated_at = $2 WHERE id = $3::uuid",
                str(todo_column_id),
                now,
                card_id,
            )
        await _upsert_card_field_value_by_key(
            conn,
            card_id=card_id,
            space_id=str(card["space_id"]),
            key="assignee_user_id",
            name="Ответственный (ID)",
            value=str(assignee_user_id),
            field_type="text",
        )
        await _upsert_card_field_value_by_key(
            conn,
            card_id=card_id,
            space_id=str(card["space_id"]),
            key="assignee_name",
            name="Ответственный",
            value=assignee_name,
            field_type="text",
        )
    return {"ok": True, "card_id": card_id, "user_id": str(assignee_user_id)}


@router.post("/spaces")
async def create_space(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Создать пространство в организации.

    Тело: `name`. Текущий пользователь должен быть менеджером или админом. Контекст организации из `X-Space-Id` существующего space или тела запроса.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")

    active_space_id = request.headers.get("x-space-id")
    async with state.pg_pool.acquire() as conn:
        if active_space_id:
            org_row = await conn.fetchrow(
                """
                SELECT s.organization_id
                FROM core_space s
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE s.id = $1::uuid AND om.user_id = $2::uuid
                LIMIT 1
                """,
                active_space_id,
                user_id,
            )
        else:
            org_row = await conn.fetchrow(
                "SELECT organization_id FROM core_organizationmember WHERE user_id = $1::uuid LIMIT 1",
                user_id,
            )
        if not org_row:
            raise HTTPException(status_code=400, detail="У пользователя нет организации")
        org_id = str(org_row["organization_id"])
        space_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        await conn.execute(
            "INSERT INTO core_space (id, organization_id, name, created_at) VALUES ($1::uuid, $2::uuid, $3, $4)",
            space_id,
            org_id,
            name,
            now,
        )
    return {"id": space_id, "name": name, "organization_id": org_id}


@router.patch("/spaces/{space_id}")
async def rename_space(
    request: Request,
    space_id: str,
    user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Переименовать пространство по `space_id`.

    PATCH: `{\"name\": \"...\"}`. Права менеджера или выше. Проверяется принадлежность space к организации пользователя.
    """
    await _require_manager_for_space_org(space_id, user_id)
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")

    async with state.pg_pool.acquire() as conn:
        await conn.execute(
            "UPDATE core_space SET name = $1 WHERE id = $2::uuid",
            name,
            space_id,
        )
    return {"id": space_id, "name": name}


@router.delete("/spaces/{space_id}")
async def delete_space(
    request: Request,
    space_id: str,
    user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Удалить пространство и всё содержимое (доски, карточки, вложения и т.д. по каскаду).

    Нельзя удалить последнее пространство организации. Только менеджер/админ. Долгая операция — выполняется в транзакции.
    """
    _, org_id = await _require_manager_for_space_org(space_id, user_id)
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        async with conn.transaction():
            spaces_count = await conn.fetchval(
                "SELECT COUNT(*)::int FROM core_space WHERE organization_id = $1::uuid",
                org_id,
            )
            if int(spaces_count or 0) <= 1:
                # Для последнего пространства сначала удаляем его содержимое и сам space,
                # затем уже организацию (иначе FK core_space -> core_organization блокирует COMMIT).
                await _purge_space_before_delete(conn, space_id)
                await conn.execute("DELETE FROM core_space WHERE id = $1::uuid", space_id)
                await conn.execute("DELETE FROM core_organization WHERE id = $1::uuid", org_id)
                return {"ok": True, "id": space_id, "deleted_organization": True}
            await _purge_space_before_delete(conn, space_id)
            await conn.execute("DELETE FROM core_space WHERE id = $1::uuid", space_id)
    return {"ok": True, "id": space_id, "deleted_organization": False}
