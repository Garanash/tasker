from rest_framework import serializers

from core.models import (
    Attachment,
    Card,
    CardComment,
    CardFieldDefinition,
    CardFieldValue,
    Checklist,
    ChecklistItem,
    Column,
    Track,
)


class CardLiteSerializer(serializers.ModelSerializer):
    track_id = serializers.UUIDField(required=False, allow_null=True)
    column_id = serializers.UUIDField()

    class Meta:
        model = Card
        fields = ["id", "title", "description", "card_type", "due_at", "track_id", "column_id"]


class ColumnLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Column
        fields = ["id", "name", "order_index", "is_done"]


class MoveCardSerializer(serializers.Serializer):
    to_column_id = serializers.UUIDField()
    to_track_id = serializers.UUIDField(required=False, allow_null=True)


class BootstrapResponseSerializer(serializers.Serializer):
    board_id = serializers.UUIDField()


class ChecklistItemLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChecklistItem
        fields = ["id", "title", "is_done"]


class ChecklistLiteSerializer(serializers.ModelSerializer):
    items = ChecklistItemLiteSerializer(many=True, read_only=True)

    class Meta:
        model = Checklist
        fields = ["id", "title", "items"]


class AttachmentLiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Attachment
        fields = ["id", "file_name", "file_url", "content_type", "size_bytes", "created_at"]


class CardFieldValueLiteSerializer(serializers.ModelSerializer):
    definition_id = serializers.UUIDField(source="definition.id", read_only=True)
    key = serializers.CharField(source="definition.key", read_only=True)
    name = serializers.CharField(source="definition.name", read_only=True)

    class Meta:
        model = CardFieldValue
        fields = ["id", "definition_id", "key", "name", "value", "updated_at"]


class CardDetailSerializer(serializers.ModelSerializer):
    checklists = ChecklistLiteSerializer(many=True, read_only=True)
    attachments = AttachmentLiteSerializer(many=True, read_only=True)
    field_values = CardFieldValueLiteSerializer(many=True, read_only=True)
    comments = serializers.SerializerMethodField()

    planned_start_at = serializers.DateTimeField(allow_null=True, required=False)
    planned_end_at = serializers.DateTimeField(allow_null=True, required=False)
    estimate_points = serializers.IntegerField(allow_null=True, required=False)

    class Meta:
        model = Card
        fields = [
            "id",
            "title",
            "description",
            "card_type",
            "due_at",
            "track_id",
            "column_id",
            "planned_start_at",
            "planned_end_at",
            "estimate_points",
            "field_values",
            "checklists",
            "attachments",
            "comments",
        ]

    def get_comments(self, obj: Card):
        request = self.context.get("request")
        qs = CardComment.objects.filter(card=obj).select_related("author").order_by("created_at")
        # Консистентно с другими endpoints: возвращаем всё, авторизацию отсекает доступ.
        return [
            {
                "id": str(c.id),
                "author_id": str(c.author_id),
                "author_full_name": c.author.full_name,
                "author_email": c.author.email,
                "body": c.body,
                "created_at": c.created_at.isoformat(),
            }
            for c in qs
        ]


class CardCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000)

