from rest_framework import serializers


class TicketCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    priority = serializers.IntegerField(required=False, default=0)
    requester_name = serializers.CharField(required=False, allow_blank=True, default="")
    requester_email = serializers.EmailField(required=False, allow_blank=True, default="")
    assigned_to_id = serializers.UUIDField(required=False, allow_null=True)


class TicketUpdateSerializer(serializers.Serializer):
    status = serializers.CharField()
    assigned_to_id = serializers.UUIDField(required=False, allow_null=True)


class TicketCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField()
    template_id = serializers.UUIDField(required=False, allow_null=True)


class TicketTemplateCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    body = serializers.CharField()


class PublicTicketCreateSerializer(serializers.Serializer):
    organization_id = serializers.UUIDField()
    requester_name = serializers.CharField(required=False, allow_blank=True, default="")
    requester_email = serializers.EmailField(required=False, allow_blank=True, default="")
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")


class TicketRatingCreateSerializer(serializers.Serializer):
    score = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(required=False, allow_blank=True, default="")

