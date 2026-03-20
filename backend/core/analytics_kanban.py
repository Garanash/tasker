from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta
from typing import Any

from django.db.models import Avg, Min
from django.utils import timezone

from core.models import Board, Card, CardBlock, CardMovementEvent, Column, WipLimit


def _get_local_day_range(days: int) -> list[datetime]:
    """
    Возвращает список datetime на конец каждого дня в локальном времени.
    Для CFD/throughput нам нужен "срез" состояния на конец дня.
    """

    local_now = timezone.localtime(timezone.now())
    tz = local_now.tzinfo
    end_date = local_now.date()
    start_date = end_date - timedelta(days=days - 1)

    boundaries: list[datetime] = []
    for i in range(days):
        d = start_date + timedelta(days=i)
        boundaries.append(datetime.combine(d, time(23, 59, 59), tzinfo=tz))
    return boundaries


def _day_iso(d: datetime) -> str:
    return timezone.localtime(d).date().isoformat()


def compute_kanban_metrics(board: Board, days: int = 14) -> dict[str, Any]:
    """
    Канбан-аналитика на базе CardMovementEvent:
    - lead time: created_at -> первое попадание в Done-колонку
    - cycle time: первое перемещение -> попадание в Done-колонку
    - block time: (CardBlock resolved_at - created_at) по resolved блокировкам
    - throughput: количество завершений (попаданий в Done) по дням
    - CFD: срез "последней известной колонки" по каждому дню на конец дня
    """

    days = max(1, min(days, 90))
    boundaries = _get_local_day_range(days)
    dates = [b.date() for b in boundaries]

    done_columns = list(board.columns.filter(is_done=True).order_by("order_index"))
    done_column_ids = {c.id for c in done_columns}

    cards = list(Card.objects.filter(board=board).values("id", "column_id", "created_at", "estimate_points"))
    card_column = {str(c["id"]): c["column_id"] for c in cards}

    # Все перемещения карточек по доске.
    movements = (
        CardMovementEvent.objects.filter(card__board=board, event_type=CardMovementEvent.EventType.MOVED)
        .order_by("card_id", "happened_at")
        .values("card_id", "from_column_id", "to_column_id", "happened_at")
    )

    events_by_card: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in movements:
        events_by_card[str(m["card_id"])].append(m)

    # done_at (первое попадание в Done) и first_move_at
    done_at_map: dict[str, datetime] = {}
    first_move_at_map: dict[str, datetime] = {}
    for card in cards:
        card_id = str(card["id"])
        events = events_by_card.get(card_id, [])
        if events:
            first_move_at_map[card_id] = events[0]["happened_at"]
        if events:
            for ev in events:
                if ev["to_column_id"] in done_column_ids:
                    done_at_map[card_id] = ev["happened_at"]
                    break
        # Если карточка "живёт" в Done, но перемещений в Done не было (например, после bootstrap) —
        # считаем done_at как created_at для MVP.
        if card["column_id"] in done_column_ids and card_id not in done_at_map:
            done_at_map[card_id] = card["created_at"]

    # lead/cycle/block
    lead_seconds: list[float] = []
    cycle_seconds: list[float] = []
    block_seconds: list[float] = []

    # estimate_points -> для расширяемости; сейчас метрики возвратим в часах/карточках отдельно
    for c in cards:
        card_id = str(c["id"])
        if card_id not in done_at_map:
            continue
        created_at = c["created_at"]
        done_at = done_at_map[card_id]
        lead_seconds.append((done_at - created_at).total_seconds())

        first_move_at = first_move_at_map.get(card_id)
        if first_move_at:
            cycle_seconds.append((done_at - first_move_at).total_seconds())

    for b in CardBlock.objects.filter(card__board=board, is_resolved=True).values("created_at", "resolved_at"):
        if not b.get("resolved_at"):
            continue
        block_seconds.append((b["resolved_at"] - b["created_at"]).total_seconds())

    lead_avg_hours = (sum(lead_seconds) / len(lead_seconds) / 3600) if lead_seconds else 0.0
    cycle_avg_hours = (sum(cycle_seconds) / len(cycle_seconds) / 3600) if cycle_seconds else 0.0
    block_avg_hours = (sum(block_seconds) / len(block_seconds) / 3600) if block_seconds else 0.0

    # throughput: completions per day по done_at
    done_day_counts = {d.isoformat(): 0 for d in dates}
    for _card_id, done_at in done_at_map.items():
        done_day = timezone.localtime(done_at).date().isoformat()
        if done_day in done_day_counts:
            done_day_counts[done_day] += 1

    throughput = [
        {"date": d.isoformat(), "done_cards": done_day_counts[d.isoformat()]} for d in dates
    ]

    # CFD: last known column at each day boundary
    column_list = list(board.columns.order_by("order_index"))
    column_name = {c.id: c.name for c in column_list}

    # готовим итоговые счетчики
    cfd_counts: dict[Any, list[int]] = {c.id: [0 for _ in range(days)] for c in column_list}

    # для каждого card считаем "текущее" направление на каждый boundary
    for card in cards:
        card_id = str(card["id"])
        initial_column_id = card["column_id"]
        events = events_by_card.get(card_id, [])

        # Если событий нет — карточка всегда в её текущей колонке.
        if not events:
            for i in range(days):
                cfd_counts[initial_column_id][i] += 1
            continue

        # Иначе используем от первого движения: до первого события карточка в from_column первого события.
        current_idx = -1
        # events отсортированы по happened_at asc
        for day_idx, boundary in enumerate(boundaries):
            # подвигаем pointer до последнего события <= boundary
            while current_idx + 1 < len(events) and events[current_idx + 1]["happened_at"] <= boundary:
                current_idx += 1

            if current_idx >= 0:
                col_id = events[current_idx]["to_column_id"]
            else:
                col_id = events[0]["from_column_id"]

            cfd_counts[col_id][day_idx] += 1

    cfd = {
        "days": [d.isoformat() for d in dates],
        "columns": [
            {"id": str(col.id), "name": col.name, "counts": cfd_counts[col.id]}
            for col in column_list
        ],
    }

    return {
        "board": {"id": str(board.id), "name": board.name},
        "metrics": {
            "lead_time_avg_hours": lead_avg_hours,
            "cycle_time_avg_hours": cycle_avg_hours,
            "block_time_avg_hours": block_avg_hours,
            "done_cards_total": len(done_at_map),
        },
        "throughput": throughput,
        "cfd": cfd,
    }

