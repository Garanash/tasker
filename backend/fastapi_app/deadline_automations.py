"""
Deadline-автоматизации: APScheduler в dev или Celery Beat в проде.
Использует asyncpg; broadcast через WsBoardConnectionManager или Redis Pub/Sub (воркер).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import asyncpg

DEADLINE_TRIGGER_TYPE = "deadline"


async def _check_wip_limit(
    conn: asyncpg.Connection,
    *,
    board_id: str,
    to_column_id: str,
    card_id: str,
    org_id: str,
) -> bool:
    """True если перемещение разрешено по WIP (или лимита нет)."""
    wip = await conn.fetchrow(
        """
        SELECT wl.limit AS lim
        FROM core_wiplimit wl
        JOIN core_column c ON c.id = wl.column_id AND c.is_done = false
        WHERE wl.organization_id = $1::uuid AND wl.board_id = $2::uuid
          AND wl.scope_type = 'column' AND wl.column_id = $3::uuid
        ORDER BY wl.created_at
        LIMIT 1
        """,
        org_id,
        board_id,
        to_column_id,
    )
    if not wip or wip["lim"] is None:
        return True
    limit_val = int(wip["lim"])
    count = await conn.fetchval(
        """
        SELECT COUNT(*) FROM core_card
        WHERE board_id = $1::uuid AND column_id = $2::uuid AND id != $3::uuid
        """,
        board_id,
        to_column_id,
        card_id,
    )
    return count < limit_val


def _card_row_to_payload(row: asyncpg.Record) -> dict[str, Any]:
    """Минимальный payload карточки для WS card_moved (аналог CardLiteSerializer)."""
    return {
        "id": str(row["id"]),
        "title": row["title"] or "",
        "description": row["description"] or "",
        "card_type": row["card_type"] or "task",
        "due_at": row["due_at"].isoformat() if row.get("due_at") else None,
        "track_id": str(row["track_id"]) if row.get("track_id") else None,
        "column_id": str(row["column_id"]),
    }


async def run_deadline_automations(
    pool: asyncpg.Pool,
    manager: Any,
    *,
    redis_url: str | None = None,
) -> None:
    """
    Для правил trigger_type=deadline: карточки с due_at <= now перемещаем по action.
    Идемпотентность: (rule_id, event_id=card_id) — одна execution на карточку.
    """
    if not pool:
        return
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        rules = await conn.fetch(
            """
            SELECT id, organization_id, board_id, actions
            FROM core_automationrule
            WHERE is_active = true AND trigger_type = $1
            """,
            DEADLINE_TRIGGER_TYPE,
        )
        for rule in rules:
            rule_id = rule["id"]
            org_id = rule["organization_id"]
            board_id = rule["board_id"]
            actions = rule["actions"]
            if not actions:
                continue
            if not isinstance(actions, list):
                continue

            cards = await conn.fetch(
                """
                SELECT c.id, c.board_id, c.column_id, c.track_id, c.title, c.description, c.card_type, c.due_at
                FROM core_card c
                WHERE c.board_id = $1 AND c.due_at IS NOT NULL AND c.due_at <= $2
                """,
                board_id,
                now,
            )
            for card in cards:
                card_id = card["id"]
                from_column_id = card["column_id"]
                try:
                    inserted = await conn.fetchval(
                        """
                        INSERT INTO core_automationexecution (id, organization_id, rule_id, event_id, status)
                        VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, 'ok')
                        ON CONFLICT (rule_id, event_id) DO NOTHING
                        RETURNING id
                        """,
                        org_id,
                        rule_id,
                        card_id,
                    )
                except Exception:
                    continue
                if not inserted:
                    continue

                for action in actions:
                    if not isinstance(action, dict) or action.get("type") != "move_card_to_column":
                        continue
                    to_column_id = action.get("to_column_id")
                    if not to_column_id:
                        continue
                    try:
                        to_column_id = str(to_column_id)
                    except Exception:
                        continue

                    ok = await _check_wip_limit(
                        conn,
                        board_id=str(board_id),
                        to_column_id=to_column_id,
                        card_id=str(card_id),
                        org_id=str(org_id),
                    )
                    if not ok:
                        continue

                    await conn.execute(
                        """
                        UPDATE core_card
                        SET column_id = $1::uuid, track_id = NULL, updated_at = $2
                        WHERE id = $3::uuid
                        """,
                        to_column_id,
                        now,
                        card_id,
                    )

                    org_id_uuid = org_id
                    await conn.execute(
                        """
                        INSERT INTO core_cardmovementevent
                        (id, organization_id, card_id, actor_id, event_type, from_column_id, to_column_id, from_track_id, to_track_id, metadata, happened_at)
                        VALUES (gen_random_uuid(), $1::uuid, $2::uuid, NULL, 'moved', $3::uuid, $4::uuid, $5::uuid, NULL, $6::jsonb, $7)
                        """,
                        org_id_uuid,
                        card_id,
                        from_column_id,
                        to_column_id,
                        card.get("track_id"),
                        json.dumps({"source": "automation_deadline"}),
                        now,
                    )

                    updated = await conn.fetchrow(
                        """
                        SELECT id, title, description, card_type, due_at, track_id, column_id
                        FROM core_card WHERE id = $1::uuid
                        """,
                        card_id,
                    )
                    if updated:
                        payload = {
                            "type": "card_moved",
                            "payload": {
                                "card": _card_row_to_payload(updated),
                                "from_column_id": str(from_column_id),
                                "to_column_id": to_column_id,
                            },
                        }
                        if manager:
                            await manager.broadcast(str(board_id), payload)
                        elif redis_url:
                            from .ws_redis import publish_board_ws_sync

                            publish_board_ws_sync(redis_url, str(board_id), payload)
                    break
