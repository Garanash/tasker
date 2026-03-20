from rest_framework import serializers


class TimeEntryStartSerializer(serializers.Serializer):
    card_id = serializers.UUIDField()
    note = serializers.CharField(required=False, allow_blank=True, default="")


class TimeEntryStopSerializer(serializers.Serializer):
    entry_id = serializers.UUIDField(required=False)
    card_id = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if not attrs.get("entry_id") and not attrs.get("card_id"):
            raise serializers.ValidationError("Нужно указать `entry_id` или `card_id`.")
        return attrs


class TimeEntryUpdateSerializer(serializers.Serializer):
    started_at = serializers.DateTimeField(required=False)
    ended_at = serializers.DateTimeField(required=False, allow_null=True)
    note = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs):
        started_at = attrs.get("started_at", None)
        ended_at = attrs.get("ended_at", None)

        # ended_at=None разрешено (создаём/оставляем активную запись).
        if started_at and ended_at and ended_at < started_at:
            raise serializers.ValidationError("`ended_at` не может быть раньше `started_at`.")
        return attrs

