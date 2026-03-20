from __future__ import annotations

from celery import shared_task
from django.utils import timezone

from core.automation import _send_card_moved_ws, run_automation_for_card_movement
from core.models import AutomationExecution, AutomationRule, Card, CardMovementEvent, Column
from core.restrictions import validate_card_move


@shared_task(name="core.process_deadline_automations")
def process_deadline_automations() -> None:
    """
    MVP время-триггер:
    - Для правил trigger_type=deadline берем карточки с due_at <= now.
    - Идемпотентность: event_id = card.id.
    """

    now = timezone.now()
    rules = AutomationRule.objects.filter(is_active=True, trigger_type=AutomationRule.TriggerType.DEADLINE)

    for rule in rules:
        board_cards = Card.objects.filter(board_id=rule.board_id, due_at__isnull=False, due_at__lte=now)
        for card in board_cards:
            execution_created = False
            try:
                # Idempotency: unique_together (rule, event_id)
                AutomationExecution.objects.create(
                    organization=rule.organization,
                    rule=rule,
                    event_id=card.id,
                    status="ok",
                )
                execution_created = True
            except Exception:
                continue

            if not execution_created:
                continue

            for action in rule.actions or []:
                if action.get("type") != "move_card_to_column":
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
                card.column = to_column
                card.track = None
                card.save(update_fields=["column", "track", "updated_at"])

                movement = card.movement_events.create(
                    organization=card.board.space.organization,
                    actor=None,
                    event_type=CardMovementEvent.EventType.MOVED,
                    from_column_id=from_column_id,
                    to_column_id=to_column.id,
                    from_track_id=None,
                    to_track_id=None,
                    metadata={"source": "automation_deadline"},
                )
                _send_card_moved_ws(movement=movement)
                run_automation_for_card_movement(movement=movement)

