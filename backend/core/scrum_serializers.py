from rest_framework import serializers

from core.models import Card, CardRelation, Sprint


class SprintCreateSerializer(serializers.ModelSerializer):
    board_id = serializers.UUIDField(write_only=True)

    class Meta:
        model = Sprint
        fields = ["board_id", "name", "goal", "start_at", "end_at"]


class SprintMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Sprint
        fields = ["id", "name", "goal", "start_at", "end_at", "created_at"]


class SprintCapacityCreateSerializer(serializers.Serializer):
    user_id = serializers.UUIDField()
    allocated_points = serializers.IntegerField(min_value=0)


class SprintCapacityMiniSerializer(serializers.Serializer):
    user_id = serializers.UUIDField()
    full_name = serializers.CharField()
    allocated_points = serializers.IntegerField()


class GanttCardSerializer(serializers.ModelSerializer):
    # Поле модели уже называется `column_id`, без `source`, чтобы избежать DRF AssertionError.
    column_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = Card
        fields = [
            "id",
            "title",
            "card_type",
            "due_at",
            "planned_start_at",
            "planned_end_at",
            "estimate_points",
            "column_id",
        ]


class CardDependencySerializer(serializers.Serializer):
    from_card_id = serializers.UUIDField()
    to_card_id = serializers.UUIDField()

