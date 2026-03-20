from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time, timedelta
from typing import Any

from django.db.models import Min, Sum
from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from core.analytics_kanban import compute_kanban_metrics
from core.analytics_scrum import compute_sprint_metrics
from core.models import Board, Card, CardBlock, CardMovementEvent, Column, OrganizationMember, Sprint


def _get_accessible_boards(request) -> list[Board]:
    org_ids = list(request.user.memberships.values_list("organization_id", flat=True))  # type: ignore[attr-defined]
    return list(Board.objects.filter(space__organization_id__in=org_ids))


def _get_local_day_range(days: int) -> list[datetime]:
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


class KanbanAnalyticsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, board_id: str):
        try:
            board = Board.objects.select_related("space__organization").get(id=board_id)
        except Board.DoesNotExist:
            return Response({"detail": "Доска не найдена"}, status=404)

        org = board.space.organization
        if not OrganizationMember.objects.filter(user=request.user, organization=org).exists():
            raise PermissionDenied("Нет доступа к доске")

        days = int(request.query_params.get("days") or 14)
        return Response(compute_kanban_metrics(board=board, days=days))


class SummaryAnalyticsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        days = int(request.query_params.get("days") or 14)
        days = max(1, min(days, 90))
        boundaries = _get_local_day_range(days)
        dates = [timezone.localtime(b).date().isoformat() for b in boundaries]

        boards = _get_accessible_boards(request)
        if not boards:
            return Response(
                {
                    "summary": {
                        "lead_time_avg_hours": 0.0,
                        "cycle_time_avg_hours": 0.0,
                        "block_time_avg_hours": 0.0,
                        "done_cards_total": 0,
                    },
                    "throughput": [{"date": d, "done_cards": 0} for d in dates],
                }
            )

        board_ids = [b.id for b in boards]
        done_column_ids = set(Column.objects.filter(board__in=board_ids, is_done=True).values_list("id", flat=True))

        done_events = (
            CardMovementEvent.objects.filter(card__board__in=board_ids, to_column__is_done=True)
            .values("card_id")
            .annotate(done_at=Min("happened_at"))
        )
        done_at_map: dict[str, datetime] = {str(row["card_id"]): row["done_at"] for row in done_events}

        first_move_events = (
            CardMovementEvent.objects.filter(card__board__in=board_ids, event_type=CardMovementEvent.EventType.MOVED)
            .values("card_id")
            .annotate(first_move_at=Min("happened_at"))
        )
        first_move_at_map: dict[str, datetime] = {str(row["card_id"]): row["first_move_at"] for row in first_move_events}

        cards = list(Card.objects.filter(board__in=board_ids).values("id", "created_at", "column_id"))
        for c in cards:
            card_id = str(c["id"])
            if card_id in done_at_map:
                continue
            if c["column_id"] in done_column_ids:
                done_at_map[card_id] = c["created_at"]

        lead_seconds: list[float] = []
        cycle_seconds: list[float] = []

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

        block_seconds: list[float] = []
        for b in CardBlock.objects.filter(card__board__in=board_ids, is_resolved=True).values("created_at", "resolved_at"):
            if not b.get("resolved_at"):
                continue
            block_seconds.append((b["resolved_at"] - b["created_at"]).total_seconds())

        lead_avg_hours = (sum(lead_seconds) / len(lead_seconds) / 3600) if lead_seconds else 0.0
        cycle_avg_hours = (sum(cycle_seconds) / len(cycle_seconds) / 3600) if cycle_seconds else 0.0
        block_avg_hours = (sum(block_seconds) / len(block_seconds) / 3600) if block_seconds else 0.0

        # throughput по дням
        done_day_counts = {d: 0 for d in dates}
        for _card_id, done_at in done_at_map.items():
            done_day = timezone.localtime(done_at).date().isoformat()
            if done_day in done_day_counts:
                done_day_counts[done_day] += 1

        throughput = [{"date": d, "done_cards": done_day_counts[d]} for d in dates]

        return Response(
            {
                "summary": {
                    "lead_time_avg_hours": lead_avg_hours,
                    "cycle_time_avg_hours": cycle_avg_hours,
                    "block_time_avg_hours": block_avg_hours,
                    "done_cards_total": len(done_at_map),
                },
                "throughput": throughput,
            }
        )


class ScrumAnalyticsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, sprint_id: str):
        sprint = (
            Sprint.objects.select_related("board__space__organization")
            .filter(id=sprint_id)
            .first()
        )
        if not sprint:
            return Response({"detail": "Спринт не найден"}, status=404)

        return Response(compute_sprint_metrics(request, sprint))

