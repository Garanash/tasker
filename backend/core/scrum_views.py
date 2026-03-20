from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from django.db.models import Min, Sum
from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    Board,
    Card,
    CardRelation,
    Column,
    OrganizationMember,
    Sprint,
    SprintCapacity,
)
from core.analytics_scrum import compute_sprint_metrics
from core.scrum_serializers import (
    GanttCardSerializer,
    SprintCapacityCreateSerializer,
    SprintCreateSerializer,
    SprintMiniSerializer,
)


def _assert_board_access(request, board: Board) -> None:
    org = board.space.organization
    if not OrganizationMember.objects.filter(user=request.user, organization=org).exists():
        raise PermissionDenied("Нет доступа к доске")


class ScrumSprintsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        board_id = request.query_params.get("board_id")

        org_ids = list(request.user.memberships.values_list("organization_id", flat=True))  # type: ignore[attr-defined]
        qs = Sprint.objects.filter(organization_id__in=org_ids).order_by("-created_at")
        if board_id:
            qs = qs.filter(board_id=board_id)

        return Response(SprintMiniSerializer(qs, many=True).data)

    def post(self, request):
        serializer = SprintCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        board = Board.objects.select_related("space__organization").get(id=validated["board_id"])
        _assert_board_access(request, board)

        sprint = Sprint.objects.create(
            organization=board.space.organization,
            board=board,
            name=validated["name"],
            goal=validated.get("goal", ""),
            start_at=validated["start_at"],
            end_at=validated["end_at"],
        )

        # Чтобы Gantt/Resource planning имели хоть какой-то смысл в MVP:
        # если у карточек нет плановых дат — ставим их в рамки текущего спринта.
        Card.objects.filter(board=board, planned_start_at__isnull=True).update(planned_start_at=validated["start_at"])
        Card.objects.filter(board=board, planned_end_at__isnull=True).update(planned_end_at=validated["end_at"])

        return Response(SprintMiniSerializer(sprint).data, status=201)


class SprintMetricsView(APIView):
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


class SprintCapacitiesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, sprint_id: str):
        sprint = Sprint.objects.select_related("board__space__organization").filter(id=sprint_id).first()
        if not sprint:
            return Response({"detail": "Спринт не найден"}, status=404)
        _assert_board_access(request, sprint.board)

        qs = SprintCapacity.objects.filter(sprint=sprint).select_related("user").order_by("user__full_name", "user__email")
        data = [
            {
                "user_id": str(c.user_id),
                "full_name": c.user.full_name or c.user.email,
                "allocated_points": c.allocated_points,
            }
            for c in qs
        ]
        return Response(data)

    def post(self, request, sprint_id: str):
        sprint = Sprint.objects.select_related("board__space__organization").filter(id=sprint_id).first()
        if not sprint:
            return Response({"detail": "Спринт не найден"}, status=404)
        _assert_board_access(request, sprint.board)

        serializer = SprintCapacityCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        org = sprint.organization
        if not OrganizationMember.objects.filter(user_id=validated["user_id"], organization=org).exists():
            raise PermissionDenied("Нет доступа к пользователю в рамках организации")

        capacity, _created = SprintCapacity.objects.update_or_create(
            sprint=sprint,
            user_id=validated["user_id"],
            defaults={"allocated_points": validated["allocated_points"]},
        )
        return Response(
            {
                "user_id": str(capacity.user_id),
                "full_name": capacity.user.full_name or capacity.user.email,
                "allocated_points": capacity.allocated_points,
            },
            status=201,
        )


class GanttBoardPlanView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, board_id: str):
        board = Board.objects.select_related("space__organization").filter(id=board_id).first()
        if not board:
            return Response({"detail": "Доска не найдена"}, status=404)
        _assert_board_access(request, board)

        org = board.space.organization

        cards_qs = Card.objects.filter(board=board).select_related("column").order_by("-updated_at")
        tasks = GanttCardSerializer(cards_qs, many=True).data

        dependencies_qs = (
            CardRelation.objects.filter(
                organization=org,
                from_card__board=board,
                to_card__board=board,
                relation_type=CardRelation.RelationType.DEPENDS_ON,
            )
            .values("from_card_id", "to_card_id")
        )
        dependencies = [
            {"from_card_id": str(dep["from_card_id"]), "to_card_id": str(dep["to_card_id"])}
            for dep in dependencies_qs
        ]

        # MVP: time range выводим по доступным planned_* / due_at / created_at
        min_ts = None
        max_ts = None
        for t in tasks:
            for k in ["planned_start_at", "planned_end_at", "due_at"]:
                val = t.get(k)
                if not val:
                    continue
                try:
                    ts = datetime.fromisoformat(val.replace("Z", "+00:00"))
                except Exception:
                    continue
                if min_ts is None or ts < min_ts:
                    min_ts = ts
                if max_ts is None or ts > max_ts:
                    max_ts = ts

        time_range = None
        if min_ts and max_ts:
            time_range = {"start": min_ts.isoformat(), "end": max_ts.isoformat()}

        return Response({"board_id": str(board.id), "tasks": tasks, "dependencies": dependencies, "time_range": time_range})

