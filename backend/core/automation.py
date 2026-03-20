from __future__ import annotations

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from core.kanban_serializers import CardLiteSerializer
from core.models import (
    AutomationExecution,
    AutomationRule,
    Card,
    CardMovementEvent,
    Column,
)
from core.restrictions import validate_card_move


MAX_AUTOMATION_DEPTH = 5


def _send_card_moved_ws(*, movement: CardMovementEvent) -> None:
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    payload = {
        "card": CardLiteSerializer(movement.card).data,
        "from_column_id": str(movement.from_column_id) if movement.from_column_id else None,
        "to_column_id": str(movement.to_column_id) if movement.to_column_id else None,
    }
    group_name = f"board_{movement.card.board_id}"
    async_to_sync(channel_layer.group_send)(group_name, {"type": "card_moved", "payload": payload})


@transaction.atomic
def _record_execution(*, rule: AutomationRule, event: CardMovementEvent) -> AutomationExecution | None:
    # Idempotency: if already executed for this (rule, event) => skip.
    try:
        return AutomationExecution.objects.create(
            organization_id=rule.organization_id,
            rule=rule,
            event_id=event.id,
            status="ok",
        )
    except Exception:
        # unique_together violated
        return None


def run_automation_for_card_movement(*, movement: CardMovementEvent, depth: int = 0) -> None:
    if depth >= MAX_AUTOMATION_DEPTH:
        return

    card: Card = movement.card

    rules = AutomationRule.objects.filter(
        organization_id=movement.organization_id,
        board_id=card.board_id,
        is_active=True,
        trigger_type=AutomationRule.TriggerType.CARD_MOVED,
    )

    for rule in rules:
        # MVP: match by destination column
        to_column_id_rule = rule.trigger_params.get("to_column_id")
        if to_column_id_rule and str(movement.to_column_id) != str(to_column_id_rule):
            continue

        execution = _record_execution(rule=rule, event=movement)
        if execution is None:
            continue

        actions = rule.actions or []
        for action in actions:
            action_type = action.get("type")
            if action_type != "move_card_to_column":
                continue

            to_column_id = action.get("to_column_id")
            if not to_column_id:
                continue

            try:
                to_column = Column.objects.get(id=to_column_id)
            except Column.DoesNotExist:
                continue

            from_column = card.column
            violation = validate_card_move(card=card, from_column=from_column, to_column=to_column)
            if violation:
                continue

            from_column_id = card.column_id

            # Выполняем move (MVP: track сбрасываем, чтобы не усложнять).
            card.column = to_column
            card.track = None
            card.save(update_fields=["column", "track", "updated_at"])

            new_movement = CardMovementEvent.objects.create(
                organization=card.board.space.organization,
                card=card,
                actor=None,
                event_type=CardMovementEvent.EventType.MOVED,
                from_column_id=from_column_id,
                to_column_id=to_column.id,
                from_track_id=movement.to_track_id,
                to_track_id=None,
                metadata={"source": "automation_engine"},
            )

            _send_card_moved_ws(movement=new_movement)
            run_automation_for_card_movement(movement=new_movement, depth=depth + 1)

