from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.db.models import Min, Sum
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from core.models import (
    Card,
    CardMovementEvent,
    Column,
    OrganizationMember,
    Sprint,
    SprintCapacity,
)


def assert_board_access(request, sprint: Sprint) -> None:
    org = sprint.board.space.organization
    if not OrganizationMember.objects.filter(user=request.user, organization=org).exists():
        raise PermissionDenied("Нет доступа к доске")


def compute_sprint_metrics(request, sprint: Sprint) -> dict[str, Any]:
    """
    Считаем velocity/добавляем burndown.
    MVP логика уже работает в `SprintMetricsView`, переносим вычисления сюда, чтобы:
    - переиспользовать для analytics endpoint
    - не дублировать код
    """

    assert_board_access(request, sprint)

    board = sprint.board
    done_column_ids = list(Column.objects.filter(board=board, is_done=True).values_list("id", flat=True))
    if not done_column_ids:
        return {
            "sprint": {
                "id": str(sprint.id),
                "name": sprint.name,
                "goal": sprint.goal,
                "start_at": sprint.start_at,
                "end_at": sprint.end_at,
                "created_at": sprint.created_at,
            },
            "velocity_cards": 0,
            "velocity_points": 0,
            "burndown": [],
            "capacity_points": 0,
        }

    capacity_sum = SprintCapacity.objects.filter(sprint=sprint).aggregate(total=Sum("allocated_points"))
    capacity_points = int(capacity_sum.get("total") or 0)

    cards = list(Card.objects.filter(board=board).values("id", "created_at", "estimate_points"))
    card_estimate = {str(c["id"]): int(c["estimate_points"] or 1) for c in cards}

    done_events = (
        CardMovementEvent.objects.filter(card__board=board, to_column_id__in=done_column_ids)
        .values("card_id")
        .annotate(done_at=Min("happened_at"))
    )
    done_at_map: dict[str, Any] = {str(row["card_id"]): row["done_at"] for row in done_events}

    start_at = sprint.start_at
    end_at = sprint.end_at

    done_between = [
        card_id
        for card_id, done_at in done_at_map.items()
        if done_at and start_at <= done_at <= end_at
    ]
    velocity_cards = len(done_between)
    velocity_points = sum(card_estimate.get(card_id, 1) for card_id in done_between)

    start_date = timezone.localtime(start_at).date()
    end_date = timezone.localtime(end_at).date()
    days_count = (end_date - start_date).days
    dates = [start_date + timedelta(days=i) for i in range(days_count + 1)]

    # burndown: активность определяем через created_at, done — первым попаданием в Done-колонку.
    burndown = []
    for d in dates:
        active_cards: list[Any] = []
        done_cards: list[Any] = []
        for card in cards:
            card_id = str(card["id"])
            created_date = timezone.localtime(card["created_at"]).date()
            if created_date <= d:
                active_cards.append(card_id)
                done_at = done_at_map.get(card_id)
                if done_at and timezone.localtime(done_at).date() <= d:
                    done_cards.append(card_id)

        remaining_cards = len(active_cards) - len(done_cards)
        remaining_points = sum(card_estimate.get(cid, 1) for cid in active_cards) - sum(
            card_estimate.get(cid, 1) for cid in done_cards
        )

        burndown.append(
            {
                "date": d.isoformat(),
                "remaining_cards": remaining_cards,
                "remaining_points": remaining_points,
                "done_cards": len(done_cards),
            }
        )

    return {
        "sprint": {
            "id": str(sprint.id),
            "name": sprint.name,
            "goal": sprint.goal,
            "start_at": sprint.start_at,
            "end_at": sprint.end_at,
            "created_at": sprint.created_at,
        },
        "velocity_cards": velocity_cards,
        "velocity_points": velocity_points,
        "capacity_points": capacity_points,
        "burndown": burndown,
    }

