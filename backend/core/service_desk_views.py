from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID

from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    ServiceDeskSlaPolicy,
    Ticket,
    TicketComment,
    TicketRating,
    TicketPublicAccess,
    TicketTemplate,
)
from core.service_desk_serializers import (
    PublicTicketCreateSerializer,
    TicketCommentCreateSerializer,
    TicketCreateSerializer,
    TicketRatingCreateSerializer,
    TicketTemplateCreateSerializer,
    TicketUpdateSerializer,
)


def _get_user_orgs(request) -> list[UUID]:
    return list(request.user.memberships.values_list("organization_id", flat=True))  # type: ignore[attr-defined]


def _get_default_sla_policy(org_id):
    policy = ServiceDeskSlaPolicy.objects.filter(organization_id=org_id).order_by("-created_at").first()
    if policy:
        return policy
    return ServiceDeskSlaPolicy.objects.create(organization_id=org_id)


def _assert_ticket_org_access(request, ticket: Ticket) -> None:
    org_ids = _get_user_orgs(request)
    if str(ticket.organization_id) not in {str(x) for x in org_ids}:
        raise PermissionDenied("Нет доступа к тикету")


def _consume_and_rotate_public_access(public_access: TicketPublicAccess) -> TicketPublicAccess:
    public_access.consumed_at = timezone.now()
    public_access.save(update_fields=["consumed_at"])

    # PIN генерируем простым псевдо-диапазоном; для MVP достаточно.
    import random
    new_pin = str(random.randint(1000, 9999))

    return TicketPublicAccess.objects.create(
        organization_id=public_access.organization_id,
        ticket=public_access.ticket,
        pin_code=new_pin,
        is_one_time=True,
    )


def _ticket_to_dict(ticket: Ticket) -> dict[str, Any]:
    return {
        "id": str(ticket.id),
        "title": ticket.title,
        "description": ticket.description,
        "status": ticket.status,
        "priority": ticket.priority,
        "requester_name": ticket.requester_name,
        "requester_email": ticket.requester_email,
        "assigned_to_id": str(ticket.assigned_to_id) if ticket.assigned_to_id else None,
        "first_response_due_at": ticket.first_response_due_at,
        "resolution_due_at": ticket.resolution_due_at,
        "resolved_at": ticket.resolved_at,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
    }


class TemplatesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        org_ids = _get_user_orgs(request)
        templates = TicketTemplate.objects.filter(organization_id__in=org_ids).order_by("-created_at")
        return Response(
            [
                {"id": str(t.id), "name": t.name, "body": t.body, "organization_id": str(t.organization_id)}
                for t in templates
            ]
        )

    def post(self, request):
        serializer = TicketTemplateCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        org_ids = _get_user_orgs(request)
        if not org_ids:
            return Response({"detail": "Нет организации"}, status=403)

        org_id = org_ids[0]
        template = TicketTemplate.objects.create(organization_id=org_id, name=validated["name"], body=validated["body"])
        return Response({"id": str(template.id), "name": template.name, "body": template.body}, status=201)


class TicketsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        org_ids = _get_user_orgs(request)
        status_q = request.query_params.get("status")

        qs = Ticket.objects.filter(organization_id__in=org_ids).order_by("-updated_at")
        if status_q:
            qs = qs.filter(status=status_q)

        return Response([_ticket_to_dict(t) for t in qs])

    def post(self, request):
        serializer = TicketCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        org_ids = _get_user_orgs(request)
        if not org_ids:
            return Response({"detail": "Нет организации"}, status=403)

        org_id = org_ids[0]
        policy = _get_default_sla_policy(org_id)
        now = timezone.now()

        ticket = Ticket.objects.create(
            organization_id=org_id,
            title=validated["title"],
            description=validated.get("description", ""),
            priority=validated.get("priority", 0),
            requester_name=validated.get("requester_name", "") or "",
            requester_email=validated.get("requester_email", "") or "",
            created_by=request.user,
            assigned_to_id=validated.get("assigned_to_id"),
            sla_policy=policy,
            first_response_due_at=now + timedelta(minutes=policy.response_due_minutes),
            resolution_due_at=now + timedelta(minutes=policy.resolution_due_minutes),
        )

        return Response(_ticket_to_dict(ticket), status=201)


class TicketDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def patch(self, request, ticket_id: str):
        ticket = Ticket.objects.select_related("organization").filter(id=ticket_id).first()
        if not ticket:
            return Response({"detail": "Тикет не найден"}, status=404)
        _assert_ticket_org_access(request, ticket)

        serializer = TicketUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        ticket.status = validated["status"]
        ticket.assigned_to_id = validated.get("assigned_to_id")

        if ticket.status in {Ticket.Status.RESOLVED, Ticket.Status.CLOSED} and not ticket.resolved_at:
            ticket.resolved_at = timezone.now()

        ticket.save(update_fields=["status", "assigned_to_id", "resolved_at", "updated_at"])
        return Response(_ticket_to_dict(ticket))


class TicketCommentsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, ticket_id: str):
        ticket = Ticket.objects.filter(id=ticket_id).first()
        if not ticket:
            return Response({"detail": "Тикет не найден"}, status=404)
        _assert_ticket_org_access(request, ticket)

        serializer = TicketCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        body = validated["body"]
        if validated.get("template_id"):
            template = TicketTemplate.objects.filter(id=validated["template_id"], organization_id=ticket.organization_id).first()
            if not template:
                raise ValidationError("Шаблон не найден")
            body = template.body + "\n\n" + body

        comment = TicketComment.objects.create(
            organization_id=ticket.organization_id,
            ticket=ticket,
            body=body,
            created_by=request.user,
        )
        return Response({"id": str(comment.id), "created_at": comment.created_at, "body": comment.body}, status=201)


class PublicTicketsView(APIView):
    """
    Внешний портал: создаём тикет без регистрации и получаем `public_token` + `pin_code`.
    """

    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = PublicTicketCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        org_id = validated["organization_id"]
        policy = _get_default_sla_policy(org_id)
        now = timezone.now()

        ticket = Ticket.objects.create(
            organization_id=org_id,
            title=validated["title"],
            description=validated.get("description", ""),
            requester_name=validated.get("requester_name", "") or "",
            requester_email=validated.get("requester_email", "") or "",
            created_by=None,
            assigned_to_id=None,
            sla_policy=policy,
            first_response_due_at=now + timedelta(minutes=policy.response_due_minutes),
            resolution_due_at=now + timedelta(minutes=policy.resolution_due_minutes),
        )

        import random
        pin_code = str(random.randint(1000, 9999))
        access = TicketPublicAccess.objects.create(organization_id=org_id, ticket=ticket, pin_code=pin_code, is_one_time=True)

        return Response(
            {
                "ticket": {"id": str(ticket.id), "status": ticket.status},
                "public_token": str(access.token),
                "pin_code": access.pin_code,
                "expires_at": access.expires_at,
            },
            status=201,
        )


class PublicTicketDetailView(APIView):
    permission_classes = [permissions.AllowAny]

    def _get_public_access(self, request, ticket_id: str) -> TicketPublicAccess:
        token_raw = request.headers.get("X-Public-Token")
        if not token_raw:
            raise ValidationError("Нужен заголовок `X-Public-Token`.")
        access = TicketPublicAccess.objects.select_related("ticket").filter(
            token=token_raw,
            ticket_id=ticket_id,
            consumed_at__isnull=True,
        ).first()
        if not access:
            raise PermissionDenied("Токен недействителен или уже использован")
        if access.expires_at and access.expires_at < timezone.now():
            raise PermissionDenied("Токен истёк")
        return access

    def get(self, request, ticket_id: str):
        access = self._get_public_access(request, ticket_id)
        ticket = access.ticket

        next_access = _consume_and_rotate_public_access(access)

        return Response(
            {
                "ticket": _ticket_to_dict(ticket),
                "next_public_token": str(next_access.token),
                "next_pin_code": next_access.pin_code,
            }
        )


class PublicTicketCommentsView(APIView):
    permission_classes = [permissions.AllowAny]

    def _get_public_access(self, request, ticket_id: str) -> TicketPublicAccess:
        token_raw = request.headers.get("X-Public-Token")
        if not token_raw:
            raise ValidationError("Нужен заголовок `X-Public-Token`.")
        access = TicketPublicAccess.objects.select_related("ticket").filter(
            token=token_raw,
            ticket_id=ticket_id,
            consumed_at__isnull=True,
        ).first()
        if not access:
            raise PermissionDenied("Токен недействителен или уже использован")
        if access.expires_at and access.expires_at < timezone.now():
            raise PermissionDenied("Токен истёк")
        return access

    def post(self, request, ticket_id: str):
        access = self._get_public_access(request, ticket_id)
        ticket = access.ticket

        serializer = TicketCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        body = validated["body"]
        if validated.get("template_id"):
            template = TicketTemplate.objects.filter(id=validated["template_id"], organization_id=ticket.organization_id).first()
            if not template:
                raise ValidationError("Шаблон не найден")
            body = template.body + "\n\n" + body

        comment = TicketComment.objects.create(
            organization_id=ticket.organization_id,
            ticket=ticket,
            body=body,
            created_by=None,
            external_author_name=ticket.requester_name,
            external_author_email=ticket.requester_email,
        )

        next_access = _consume_and_rotate_public_access(access)

        return Response(
            {
                "comment": {"id": str(comment.id), "created_at": comment.created_at, "body": comment.body},
                "ticket": _ticket_to_dict(ticket),
                "next_public_token": str(next_access.token),
                "next_pin_code": next_access.pin_code,
            },
            status=201,
        )


class TicketRatingView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, ticket_id: str):
        ticket = Ticket.objects.select_related("organization").filter(id=ticket_id).first()
        if not ticket:
            return Response({"detail": "Тикет не найден"}, status=404)
        _assert_ticket_org_access(request, ticket)

        serializer = TicketRatingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        requester_email = request.user.email
        rating, _created = TicketRating.objects.get_or_create(
            organization_id=ticket.organization_id,
            ticket=ticket,
            requester_email=requester_email,
            defaults={
                "score": validated["score"],
                "comment": validated.get("comment", ""),
                "created_by": request.user,
            },
        )
        rating.score = validated["score"]
        rating.comment = validated.get("comment", "")
        rating.created_by = request.user
        rating.save(update_fields=["score", "comment", "created_by"])

        return Response({"id": str(rating.id), "score": rating.score, "comment": rating.comment}, status=201)


class PublicTicketRatingView(APIView):
    permission_classes = [permissions.AllowAny]

    def _get_public_access(self, request, ticket_id: str) -> TicketPublicAccess:
        token_raw = request.headers.get("X-Public-Token")
        if not token_raw:
            raise ValidationError("Нужен заголовок `X-Public-Token`.")
        access = TicketPublicAccess.objects.select_related("ticket").filter(
            token=token_raw,
            ticket_id=ticket_id,
            consumed_at__isnull=True,
        ).first()
        if not access:
            raise PermissionDenied("Токен недействителен или уже использован")
        if access.expires_at and access.expires_at < timezone.now():
            raise PermissionDenied("Токен истёк")
        return access

    def post(self, request, ticket_id: str):
        access = self._get_public_access(request, ticket_id)
        ticket = access.ticket

        serializer = TicketRatingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        requester_email = ticket.requester_email
        rating, _created = TicketRating.objects.get_or_create(
            organization_id=ticket.organization_id,
            ticket=ticket,
            requester_email=requester_email,
            defaults={"score": validated["score"], "comment": validated.get("comment", ""), "created_by": None},
        )
        rating.score = validated["score"]
        rating.comment = validated.get("comment", "")
        rating.save(update_fields=["score", "comment"])

        next_access = _consume_and_rotate_public_access(access)

        return Response(
            {
                "rating": {"id": str(rating.id), "score": rating.score, "comment": rating.comment},
                "next_public_token": str(next_access.token),
                "next_pin_code": next_access.pin_code,
            },
            status=201,
        )

