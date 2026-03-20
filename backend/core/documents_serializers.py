from rest_framework import serializers

from core.models import Document


class DocumentMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = ["id", "title", "doc_type", "updated_at"]


class DocumentCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    content = serializers.CharField(allow_blank=True, required=False, default="")
    doc_type = serializers.ChoiceField(choices=Document.DocType.choices, default=Document.DocType.DOCUMENT)
    card_id = serializers.UUIDField(required=False, allow_null=True)


class DocumentDetailSerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = ["id", "title", "content", "doc_type", "created_at", "updated_at", "card_id"]

