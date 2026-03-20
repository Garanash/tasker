from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

from core.models import Card, ChecklistItem, Column, RestrictionRule, WipLimit


@dataclass(frozen=True)
class RestrictionViolation:
    code: str
    message: str


def _get_org_id(card: Card) -> Any:
    return card.board.space.organization_id


def _validate_wip_limit(*, card: Card, to_column: Column) -> Optional[RestrictionViolation]:
    """
    WIP-лимит действует на destination-column.
    """

    org = _get_org_id(card)

    # Для MVP: WIP применяется только если колонка не "done"
    if to_column.is_done:
        return None

    limits = WipLimit.objects.filter(organization_id=org, board_id=card.board_id, scope_type="column", column_id=to_column.id)
    if not limits.exists():
        return None

    # Если правил несколько — берем первое (MVP).
    limit = limits.order_by("created_at").first()
    assert limit is not None

    dest_count = Card.objects.filter(board_id=card.board_id, column_id=to_column.id).exclude(id=card.id).count()
    if dest_count >= limit.limit:
        return RestrictionViolation(
            code="wip_exceeded",
            message=f"WIP лимит превышен для колонки {to_column.name}",
        )
    return None


def _validate_previous_path(*, card: Card, from_column: Column, to_column: Column, rule: RestrictionRule) -> Optional[RestrictionViolation]:
    allowed = rule.params.get("allowed_previous_column_ids") or []
    # params может прийти строками/UUID; приводим к str
    allowed_str = {str(x) for x in allowed}
    if allowed_str and str(from_column.id) not in allowed_str:
        return RestrictionViolation(
            code="previous_path_violation",
            message="Нельзя выполнить действие: не соответствует предыдущий путь",
        )
    return None


def _validate_not_completed_checklists(*, card: Card) -> Optional[RestrictionViolation]:
    not_done = ChecklistItem.objects.filter(checklist__card_id=card.id, is_done=False).exists()
    if not_done:
        return RestrictionViolation(
            code="checklists_not_completed",
            message="Нельзя переместить карточку: не выполнены чек-листы",
        )
    return None


def _validate_unfinished_children(*, card: Card) -> Optional[RestrictionViolation]:
    # Card.children через related_name="children"
    unfinished_child = card.children.filter(column__is_done=False).exists()
    if unfinished_child:
        return RestrictionViolation(
            code="unfinished_children",
            message="Нельзя переместить карточку: есть незавершенные дочерние задачи",
        )
    return None


def validate_card_move(
    *,
    card: Card,
    from_column: Column,
    to_column: Column,
) -> Optional[RestrictionViolation]:
    """
    Проверка ограничений для перемещения карточки по Kanban.
    Возвращает причину нарушения либо None.
    """

    # 1) WIP-лимит (как базовая защита)
    wip_violation = _validate_wip_limit(card=card, to_column=to_column)
    if wip_violation:
        return wip_violation

    # 2) Декларативные RestrictionRule
    org_id = _get_org_id(card)
    rules = RestrictionRule.objects.filter(
        organization_id=org_id,
        board_id=card.board_id,
        to_column_id=to_column.id,
        deny_action=RestrictionRule.DenyAction.MOVE_CARD,
    )

    for rule in rules:
        if rule.condition_type == RestrictionRule.ConditionType.PREVIOUS_PATH:
            violation = _validate_previous_path(card=card, from_column=from_column, to_column=to_column, rule=rule)
        elif rule.condition_type == RestrictionRule.ConditionType.NOT_COMPLETED_CHECKLISTS:
            violation = _validate_not_completed_checklists(card=card)
        elif rule.condition_type == RestrictionRule.ConditionType.UNFINISHED_CHILDREN:
            violation = _validate_unfinished_children(card=card)
        else:
            violation = None

        if violation:
            return violation

    return None

