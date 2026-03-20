from django.contrib.auth import get_user_model
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from core.models import Organization, OrganizationMember, Space


User = get_user_model()


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    organization_name = serializers.CharField(max_length=255)
    full_name = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate(self, attrs):
        # Простая базовая валидация.
        if Organization.objects.filter(name=attrs["organization_name"]).exists() is False:
            return attrs
        return attrs

    def create(self, validated_data):
        email = validated_data["email"].lower().strip()
        org_name = validated_data["organization_name"].strip()
        full_name = validated_data.get("full_name", "")

        from rest_framework.exceptions import ValidationError

        if Organization.objects.filter(name=org_name).exists() is False:
            # Организация может быть новой или нет — это не критично для UX,
            # но оставим понятную валидацию по пользователю.
            pass

        if User.objects.filter(email=email).exists():
            raise ValidationError({"email": "Пользователь с таким email уже существует"})

        organization = Organization.objects.create(name=org_name)
        user = User.objects.create_user(email=email, password=validated_data["password"], full_name=full_name)
        OrganizationMember.objects.create(
            organization=organization,
            user=user,
            role=OrganizationMember.Role.ADMIN,
        )

        # Стартовый space для удобства интерфейса.
        Space.objects.create(organization=organization, name="Основное пространство")
        return user


class MeSerializer(serializers.Serializer):
    user = serializers.SerializerMethodField()
    memberships = serializers.SerializerMethodField()

    def get_user(self, _obj):
        request = self.context.get("request")
        user = request.user
        return {
            "id": str(user.id),
            "email": user.email,
            "full_name": user.full_name,
        }

    def get_memberships(self, _obj):
        user = self.context["request"].user
        memberships = OrganizationMember.objects.filter(user=user).select_related("organization")
        return [
            {
                "organization_id": str(m.organization_id),
                "role": m.role,
                "organization_name": m.organization.name,
            }
            for m in memberships
        ]


# Входные параметры для логина: { email, password }
class LoginSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        return super().get_token(user)


class SpaceMiniSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    organization_id = serializers.UUIDField()


class GroupMiniSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    role = serializers.CharField()

