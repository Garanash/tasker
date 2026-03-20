from rest_framework import permissions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.views import TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import AutomationRule, RestrictionRule, Space, UserGroup
from core.serializers import MeSerializer, RegisterSerializer, SpaceMiniSerializer, GroupMiniSerializer


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        # Сразу возвращаем токены, чтобы фронтенд мог продолжить поток без отдельного вызова логина.
        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "ok": True,
                "user_id": str(user.id),
                "access": str(refresh.access_token),
                "refresh": str(refresh),
            },
            status=status.HTTP_201_CREATED,
        )


class AuthHealthView(APIView):
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({"ok": True})


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        serializer = MeSerializer(instance=request.user, context={"request": request})
        return Response(serializer.data)


class SpacesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        # Для MVP отдаем все space'ы, где пользователь состоит в организации.
        org_ids = list(
            request.user.memberships.values_list("organization_id", flat=True)  # type: ignore[attr-defined]
        )
        spaces = Space.objects.filter(organization_id__in=org_ids).order_by("name")
        serializer = SpaceMiniSerializer(
            spaces,
            many=True,
        )
        return Response(serializer.data)


class GroupsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        org_ids = list(request.user.memberships.values_list("organization_id", flat=True))  # type: ignore[attr-defined]
        groups = UserGroup.objects.filter(organization_id__in=org_ids).order_by("name")
        serializer = GroupMiniSerializer(groups, many=True)
        return Response(serializer.data)


# Переиспользуем стандартные JWT эндпоинты simplejwt.
class LoginView(TokenObtainPairView):
    # TODO: расширим сериализатор/валидацию при реализации full-RBAC.
    pass


class RefreshView(TokenRefreshView):
    pass


class RestrictionRuleMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = RestrictionRule
        fields = ["id", "condition_type", "deny_action", "params", "to_column_id", "board_id", "created_at"]


class RestrictionRuleCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = RestrictionRule
        fields = ["condition_type", "deny_action", "params", "to_column", "board"]


class RestrictionsRulesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        board_id = request.query_params.get("board_id")
        to_column_id = request.query_params.get("to_column_id")
        org = request.user.memberships.first().organization

        qs = RestrictionRule.objects.filter(organization=org)
        if board_id:
            qs = qs.filter(board_id=board_id)
        if to_column_id:
            qs = qs.filter(to_column_id=to_column_id)

        return Response(RestrictionRuleMiniSerializer(qs, many=True).data)

    def post(self, request):
        org = request.user.memberships.first().organization
        serializer = RestrictionRuleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = serializer.save(organization=org)
        return Response(RestrictionRuleMiniSerializer(rule).data, status=status.HTTP_201_CREATED)


class AutomationRuleMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationRule
        fields = ["id", "name", "is_active", "trigger_type", "trigger_params", "actions", "board_id", "created_at"]


class AutomationRuleCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationRule
        fields = ["name", "is_active", "trigger_type", "trigger_params", "actions", "board"]


class AutomationsRulesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        org = request.user.memberships.first().organization
        rules = AutomationRule.objects.filter(organization=org).order_by("-created_at")
        return Response(AutomationRuleMiniSerializer(rules, many=True).data)

    def post(self, request):
        org = request.user.memberships.first().organization
        serializer = AutomationRuleCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = serializer.save(organization=org)
        return Response(AutomationRuleMiniSerializer(rule).data, status=status.HTTP_201_CREATED)

