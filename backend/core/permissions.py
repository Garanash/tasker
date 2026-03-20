from rest_framework.permissions import BasePermission
from rest_framework.request import Request
from rest_framework.exceptions import PermissionDenied

from core.models import OrganizationMember, Space


def get_active_space_id(request: Request) -> str | None:
    """
    В Kaiten активный контекст обычно задается выбором space/project.
    Для backend клона используем заголовок, чтобы не тащить space_id в каждый payload.
    """

    return request.headers.get("X-Space-Id")


class HasSpaceAccess(BasePermission):
    """
    Проверка, что пользователь состоит в организации активного space.
    """

    def has_permission(self, request: Request, _view) -> bool:
        space_id = get_active_space_id(request)
        if not space_id:
            # Если endpoints пока не используют space-контекст, позволяем.
            return True

        space = Space.objects.filter(id=space_id).first()
        if not space:
            raise PermissionDenied("Space not found")

        return OrganizationMember.objects.filter(
            user=request.user,
            organization=space.organization,
        ).exists()


class IsOrgAdmin(BasePermission):
    def has_permission(self, request: Request, _view) -> bool:
        space_id = get_active_space_id(request)
        if not space_id:
            return False
        space = Space.objects.filter(id=space_id).first()
        if not space:
            raise PermissionDenied("Space not found")
        return OrganizationMember.objects.filter(
            user=request.user,
            organization=space.organization,
            role=OrganizationMember.Role.ADMIN,
        ).exists()

