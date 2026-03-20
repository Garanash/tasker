from __future__ import annotations

from datetime import datetime
from collections import defaultdict
from typing import Any

from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Card, OrganizationMember, TimeEntry, User
from core.time_serializers import (
    TimeEntryStartSerializer,
    TimeEntryStopSerializer,
    TimeEntryUpdateSerializer,
)


def _assert_card_access(request, card: Card) -> None:
    org = card.board.space.organization
    if not OrganizationMember.objects.filter(user=request.user, organization=org).exists():
        raise PermissionDenied("Нет доступа к карточке")


def _active_entry_for_user(user: User, card: Card) -> TimeEntry | None:
    return TimeEntry.objects.filter(user=user, card=card, ended_at__isnull=True).first()


def _entries_qs(request, *, from_dt: Any | None, to_dt: Any | None, card_id: str | None):
    qs = TimeEntry.objects.filter(user=request.user)
    if card_id:
        qs = qs.filter(card_id=card_id)
    if from_dt:
        qs = qs.filter(ended_at__isnull=False, ended_at__gte=from_dt)
    if to_dt:
        qs = qs.filter(ended_at__isnull=False, ended_at__lte=to_dt)
    return qs.order_by("-started_at")


class TimeEntryStartView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = TimeEntryStartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        card = Card.objects.select_related("board__space__organization").filter(id=data["card_id"]).first()
        if not card:
            return Response({"detail": "Карточка не найдена"}, status=404)

        _assert_card_access(request, card)

        existing = _active_entry_for_user(request.user, card)
        if existing:
            return Response({"detail": "Таймер уже запущен для этой карточки"}, status=400)

        entry = TimeEntry.objects.create(
            organization=card.board.space.organization,
            card=card,
            user=request.user,
            note=data.get("note", ""),
            started_at=timezone.now(),
            ended_at=None,
            duration_seconds=0,
        )
        return Response(
            {
                "id": str(entry.id),
                "card_id": str(entry.card_id),
                "started_at": entry.started_at,
                "ended_at": entry.ended_at,
                "duration_seconds": entry.duration_seconds,
                "note": entry.note,
            },
            status=status.HTTP_201_CREATED,
        )


class TimeEntryStopView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = TimeEntryStopSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        entry: TimeEntry | None = None
        if validated.get("entry_id"):
            entry = TimeEntry.objects.select_related("card__board__space__organization").filter(
                id=validated["entry_id"], user=request.user
            ).first()
        else:
            card = Card.objects.select_related("board__space__organization").filter(id=validated["card_id"]).first()
            if not card:
                return Response({"detail": "Карточка не найдена"}, status=404)
            _assert_card_access(request, card)
            entry = _active_entry_for_user(request.user, card)

        if not entry:
            return Response({"detail": "Активная запись не найдена"}, status=404)
        if entry.ended_at is not None:
            return Response({"detail": "Запись уже завершена"}, status=400)

        entry.ended_at = timezone.now()
        entry.save(update_fields=["ended_at", "duration_seconds", "updated_at"])

        return Response(
            {
                "id": str(entry.id),
                "card_id": str(entry.card_id),
                "started_at": entry.started_at,
                "ended_at": entry.ended_at,
                "duration_seconds": entry.duration_seconds,
                "note": entry.note,
            }
        )


class TimeEntryDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, entry_id: str):
        entry = TimeEntry.objects.select_related("card__board__space__organization").filter(
            id=entry_id, user=request.user
        ).first()
        if not entry:
            return Response({"detail": "Запись не найдена"}, status=404)

        _assert_card_access(request, entry.card)

        serializer = TimeEntryUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        if "started_at" in validated:
            entry.started_at = validated["started_at"]
        if "ended_at" in validated:
            entry.ended_at = validated["ended_at"]
        if "note" in validated:
            entry.note = validated["note"]

        if entry.ended_at is not None and entry.started_at > entry.ended_at:
            raise ValidationError("`ended_at` не может быть раньше `started_at`.")

        entry.save()

        return Response(
            {
                "id": str(entry.id),
                "card_id": str(entry.card_id),
                "started_at": entry.started_at,
                "ended_at": entry.ended_at,
                "duration_seconds": entry.duration_seconds,
                "note": entry.note,
            }
        )

    def get(self, request, entry_id: str):
        entry = TimeEntry.objects.select_related("card").filter(id=entry_id, user=request.user).first()
        if not entry:
            return Response({"detail": "Запись не найдена"}, status=404)
        return Response(
            {
                "id": str(entry.id),
                "card_id": str(entry.card_id),
                "started_at": entry.started_at,
                "ended_at": entry.ended_at,
                "duration_seconds": entry.duration_seconds,
                "note": entry.note,
            }
        )


class TimeEntriesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from_raw = request.query_params.get("from")
        to_raw = request.query_params.get("to")
        card_id = request.query_params.get("card_id")

        from_dt = None
        to_dt = None
        if from_raw:
            from_dt = datetime.fromisoformat(from_raw.replace("Z", "+00:00"))
        if to_raw:
            to_dt = datetime.fromisoformat(to_raw.replace("Z", "+00:00"))

        qs = _entries_qs(request, from_dt=from_dt, to_dt=to_dt, card_id=card_id)

        data = [
            {
                "id": str(e.id),
                "card_id": str(e.card_id),
                "started_at": e.started_at,
                "ended_at": e.ended_at,
                "duration_seconds": e.duration_seconds,
                "note": e.note,
            }
            for e in qs
        ]
        return Response(data)


class TimeReportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        from_raw = request.query_params.get("from")
        to_raw = request.query_params.get("to")
        group_by = request.query_params.get("group_by") or "card"

        # group_by: card | project | user
        if group_by not in {"card", "project", "user"}:
            return Response({"detail": "Неверный group_by"}, status=400)

        from_dt = None
        to_dt = None
        if from_raw:
            from_dt = datetime.fromisoformat(from_raw.replace("Z", "+00:00"))
        if to_raw:
            to_dt = datetime.fromisoformat(to_raw.replace("Z", "+00:00"))

        org_ids = list(request.user.memberships.values_list("organization_id", flat=True))  # type: ignore[attr-defined]

        qs = (
            TimeEntry.objects.select_related("card__board__project", "user")
            .filter(ended_at__isnull=False)
            .filter(organization_id__in=org_ids)
        )
        if from_dt:
            qs = qs.filter(ended_at__gte=from_dt)
        if to_dt:
            qs = qs.filter(ended_at__lte=to_dt)

        by_key: dict[str, dict[str, Any]] = {}

        items: list[dict[str, Any]] = []
        for e in qs:
            if group_by == "card":
                key = str(e.card_id)
                label = e.card.title
            elif group_by == "project":
                key = str(e.card.board.project_id)
                label = e.card.board.project.name
            else:
                key = str(e.user_id)
                label = e.user.full_name or e.user.email

            if key not in by_key:
                by_key[key] = {"key": key, "label": label, "total_seconds": 0, "entries_count": 0}

            by_key[key]["total_seconds"] += e.duration_seconds
            by_key[key]["entries_count"] += 1

        items = list(by_key.values())
        for it in items:
            it["total_hours"] = it["total_seconds"] / 3600
            del it["total_seconds"]

        return Response(
            {
                "from": from_raw,
                "to": to_raw,
                "group_by": group_by,
                "items": sorted(items, key=lambda x: x["total_hours"], reverse=True),
            }
        )

