import uuid
from typing import Optional

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class Organization(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    def __str__(self) -> str:
        return self.name


class UserManager(BaseUserManager):
    def create_user(self, email: str, password: Optional[str] = None, **extra_fields):
        if not email:
            raise ValueError("Email must be set")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        if password is not None:
            user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(email=email, password=password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=255, blank=True)
    is_staff = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    def __str__(self) -> str:
        return self.email


class OrganizationMember(models.Model):
    """
    Участник организации.
    Роли/группы и модель прав будут расширены в модуле RBAC.
    """

    class Role(models.TextChoices):
        ADMIN = "admin", "Admin"
        USER = "user", "User"
        SUPPORT = "support", "Support"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=32, choices=Role.choices, default=Role.USER)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("organization", "user")


class UserGroup(models.Model):
    """
    Группа пользователей для массового управления доступами.
    В следующих итерациях расширим модель прав на уровне полей/действий.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="groups")
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=32, choices=OrganizationMember.Role.choices, default=OrganizationMember.Role.USER)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("organization", "name")


class GroupMembership(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="group_memberships")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="group_memberships")
    group = models.ForeignKey(UserGroup, on_delete=models.CASCADE, related_name="members")
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("group", "user")


class Space(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="spaces")
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    def __str__(self) -> str:
        return self.name


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    space = models.ForeignKey(Space, on_delete=models.CASCADE, related_name="projects")
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=timezone.now, editable=False)


class Board(models.Model):
    """
    Kanban board в терминах Kaiten.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    space = models.ForeignKey(Space, on_delete=models.CASCADE, related_name="boards")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="boards")
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=timezone.now, editable=False)


class Column(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="columns")
    name = models.CharField(max_length=255)
    order_index = models.IntegerField(default=0)

    # Тип колонки (например, "Готово") для логики ограничений/переходов
    is_done = models.BooleanField(default=False)

    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("board", "order_index")
        ordering = ["order_index"]


class Track(models.Model):
    """
    Дорожка (lane) внутри доски — используется для приоритизации/разделения потока.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="tracks")
    name = models.CharField(max_length=255)
    order_index = models.IntegerField(default=0)

    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("board", "order_index")
        ordering = ["order_index"]


class Card(models.Model):
    class CardType(models.TextChoices):
        TASK = "task", "Task"
        BUG = "bug", "Bug"
        REQUEST = "request", "Request"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="cards")
    column = models.ForeignKey(Column, on_delete=models.PROTECT, related_name="cards")
    track = models.ForeignKey(Track, on_delete=models.PROTECT, null=True, blank=True, related_name="cards")
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    card_type = models.CharField(max_length=32, choices=CardType.choices, default=CardType.TASK)
    due_at = models.DateTimeField(null=True, blank=True)

    # Планирование для Gantt/Resource planning (MVP: опционально).
    planned_start_at = models.DateTimeField(null=True, blank=True)
    planned_end_at = models.DateTimeField(null=True, blank=True)

    # Точки/оценка для burndown (если NULL — считаем 1 очко за карточку).
    estimate_points = models.PositiveIntegerField(null=True, blank=True)

    # Базовые связи "родитель/дочерние"
    parent = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children")

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    def move_to(self, *, column: Column, track: Optional[Track]) -> None:
        self.column = column
        self.track = track


class Tag(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    space = models.ForeignKey(Space, on_delete=models.CASCADE, related_name="tags")
    name = models.CharField(max_length=64)


class CardTag(models.Model):
    """
    Через промежуточную модель удобнее расширять метаданные тегов (опционально).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="card_tags")
    tag = models.ForeignKey(Tag, on_delete=models.CASCADE, related_name="tag_cards")

    class Meta:
        unique_together = ("card", "tag")


class Checklist(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="checklists")
    title = models.CharField(max_length=255)


class ChecklistItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    checklist = models.ForeignKey(Checklist, on_delete=models.CASCADE, related_name="items")
    title = models.CharField(max_length=255)
    is_done = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now, editable=False)


class Attachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="attachments")

    # В файлах пока держим только метаданные (URL/путь). Подключение MinIO/S3 добавим в следующих итерациях.
    uploaded_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="attachments",
    )
    file_name = models.CharField(max_length=255)
    file_url = models.URLField(max_length=2048, blank=True, default="")
    content_type = models.CharField(max_length=127, blank=True, default="")
    size_bytes = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)


class Document(models.Model):
    """
    Документы / Базы знаний (в MVP: текст).

    Важно: принадлежность жестко по space/organization (как и у остальных сущностей).
    """

    class DocType(models.TextChoices):
        DOCUMENT = "document", "Document"
        KNOWLEDGE_BASE = "knowledge_base", "Knowledge base"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="documents")
    space = models.ForeignKey(Space, on_delete=models.CASCADE, related_name="documents")
    # Необязательная привязка к карточке (чтобы документы жили рядом с задачами).
    card = models.ForeignKey("Card", on_delete=models.CASCADE, related_name="documents", null=True, blank=True)

    doc_type = models.CharField(max_length=32, choices=DocType.choices, default=DocType.DOCUMENT)
    title = models.CharField(max_length=255)
    content = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)



class CardFieldDefinition(models.Model):
    """
    Кастомные поля карточек (аналог "кастомных полей" на сайте).
    """

    class FieldType(models.TextChoices):
        TEXT = "text", "Text"
        NUMBER = "number", "Number"
        DATE = "date", "Date"
        JSON = "json", "JSON"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    space = models.ForeignKey(Space, on_delete=models.CASCADE, related_name="field_definitions")
    key = models.CharField(max_length=64)
    name = models.CharField(max_length=255)
    field_type = models.CharField(max_length=16, choices=FieldType.choices, default=FieldType.TEXT)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("space", "key")


class CardFieldValue(models.Model):
    """
    Значение кастомного поля на конкретной карточке.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="field_values")
    definition = models.ForeignKey(
        CardFieldDefinition,
        on_delete=models.CASCADE,
        related_name="values",
    )
    value = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("card", "definition")


class CardRelation(models.Model):
    """
    Связи задач: зависимости, связанные карточки и т.п.
    Для MVP используем унифицированную модель.
    """

    class RelationType(models.TextChoices):
        DEPENDS_ON = "depends_on", "Depends on"
        RELATED_TO = "related_to", "Related to"
        BLOCKED_BY = "blocked_by", "Blocked by"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="card_relations")
    from_card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="out_relations")
    to_card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="in_relations")
    relation_type = models.CharField(max_length=32, choices=RelationType.choices, default=RelationType.RELATED_TO)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("from_card", "to_card", "relation_type")


class CardBlock(models.Model):
    """
    Блокировки карточек с указанием причины.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="blocks")
    blocked_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True)
    reason = models.CharField(max_length=500, blank=True, default="")
    is_resolved = models.BooleanField(default=False)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)


class CardComment(models.Model):
    """
    Комментарии к карточке.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="card_comments")
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name="card_comments")
    body = models.TextField(max_length=5000)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        ordering = ["created_at"]


class CardMovementEvent(models.Model):
    """
    Audit log событий движения карточки по колонкам/дорожкам.
    Это основа для отчётов Lead/Cycle/Block time.
    """

    class EventType(models.TextChoices):
        MOVED = "moved", "Moved"
        CREATED = "created", "Created"
        UPDATED = "updated", "Updated"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="card_movement_events")
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="movement_events")
    actor = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="card_events")
    event_type = models.CharField(max_length=16, choices=EventType.choices, default=EventType.MOVED)

    from_column = models.ForeignKey(
        Column,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="from_events",
    )
    to_column = models.ForeignKey(
        Column,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="to_events",
    )

    from_track = models.ForeignKey(
        Track,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="from_events",
    )
    to_track = models.ForeignKey(
        Track,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="to_events",
    )

    metadata = models.JSONField(default=dict, blank=True)
    happened_at = models.DateTimeField(default=timezone.now, editable=False)


class Sprint(models.Model):
    """
    MVP: спринт привязан к доске.
    Метрики burndown/velocity считаются из CardMovementEvent (когда карточка попадает в Done-колонку).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="sprints")
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="sprints")

    name = models.CharField(max_length=255)
    goal = models.CharField(max_length=1000, blank=True, default="")

    start_at = models.DateTimeField()
    end_at = models.DateTimeField()

    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        indexes = [models.Index(fields=["organization", "board", "start_at", "end_at"])]
        unique_together = ("organization", "board", "name", "start_at", "end_at")


class SprintCapacity(models.Model):
    """
    MVP: емкость (загрузка) исполнителя на спринт.
    Сейчас это отдельная сущность, без привязки карточек к исполнителям.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    sprint = models.ForeignKey(Sprint, on_delete=models.CASCADE, related_name="capacities")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sprint_capacities")
    allocated_points = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("sprint", "user")


class WipLimit(models.Model):
    """
    WIP-лимиты для строгого workflow.
    """

    class ScopeType(models.TextChoices):
        COLUMN = "column", "Column"
        TRACK = "track", "Track"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="wip_limits")
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="wip_limits")
    scope_type = models.CharField(max_length=16, choices=ScopeType.choices)

    column = models.ForeignKey(Column, on_delete=models.CASCADE, null=True, blank=True)
    track = models.ForeignKey(Track, on_delete=models.CASCADE, null=True, blank=True)

    limit = models.PositiveIntegerField()
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("organization", "board", "scope_type", "column", "track")


class RestrictionRule(models.Model):
    """
    Модуль "Ограничения" (MVP):
    правило действует при попытке выполнить действие (move/create) и проверяет набор условий.
    """

    class ConditionType(models.TextChoices):
        PREVIOUS_PATH = "previous_path", "Previous path"
        NOT_COMPLETED_CHECKLISTS = "not_completed_checklists", "Not completed checklists"
        UNFINISHED_CHILDREN = "unfinished_children", "Unfinished children"
        EXCEEDED_WIP = "exceeded_wip", "Exceeded WIP"

    class DenyAction(models.TextChoices):
        MOVE_CARD = "move_card", "Deny moving card"
        CREATE_CARD = "create_card", "Deny creating card"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="restriction_rules")
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="restriction_rules")

    # Ограничение применяется при перемещении карточки В destination-column.
    to_column = models.ForeignKey(Column, on_delete=models.CASCADE, related_name="as_destination_restrictions")

    condition_type = models.CharField(max_length=64, choices=ConditionType.choices)
    deny_action = models.CharField(max_length=32, choices=DenyAction.choices, default=DenyAction.MOVE_CARD)
    params = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        indexes = [models.Index(fields=["board", "to_column", "condition_type"])]


class AutomationRule(models.Model):
    """
    If-Then правила (MVP):
    сейчас поддерживаем только триггер "card moved" + действие "move card to column".
    """

    class TriggerType(models.TextChoices):
        CARD_MOVED = "card_moved", "Card moved"
        DEADLINE = "deadline", "Deadline"

    class ActionType(models.TextChoices):
        MOVE_CARD_TO_COLUMN = "move_card_to_column", "Move card to column"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="automation_rules")
    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="automation_rules")

    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)

    trigger_type = models.CharField(max_length=64, choices=TriggerType.choices)
    trigger_params = models.JSONField(default=dict, blank=True)

    # В MVP храним действия в JSON, чтобы быстро расширять формат.
    actions = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(default=timezone.now, editable=False)


class AutomationExecution(models.Model):
    """
    Идемпотентность: правило не должно выполняться повторно на одном и том же событии.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="automation_executions")
    rule = models.ForeignKey(AutomationRule, on_delete=models.CASCADE, related_name="executions")
    event_id = models.UUIDField()
    status = models.CharField(max_length=32, default="ok")
    error_message = models.TextField(blank=True, default="")
    executed_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("rule", "event_id")


class TimeEntry(models.Model):
    """
    Треккинг времени по карточкам (MVP):
    - старт таймера создаёт запись с `ended_at = NULL`
    - стоп фиксирует `ended_at` и пересчитывает `duration_seconds`
    - редактирование позволяет править интервал задним числом
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="time_entries")
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="time_entries")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="time_entries")

    note = models.CharField(max_length=1000, blank=True, default="")

    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=["organization", "user", "started_at"])]

    def save(self, *args, **kwargs):
        if self.started_at and self.ended_at:
            delta = self.ended_at - self.started_at
            self.duration_seconds = max(0, int(delta.total_seconds()))
        elif self.ended_at is None:
            self.duration_seconds = 0
        super().save(*args, **kwargs)


class ServiceDeskSlaPolicy(models.Model):
    """
    MVP: простые SLA политики по времени реакции/закрытия.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="service_desk_sla_policies")

    response_due_minutes = models.PositiveIntegerField(default=24 * 60)  # 24h
    resolution_due_minutes = models.PositiveIntegerField(default=72 * 60)  # 72h

    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("organization", "response_due_minutes", "resolution_due_minutes")


class Ticket(models.Model):
    class Status(models.TextChoices):
        NEW = "new", "New"
        IN_PROGRESS = "in_progress", "In progress"
        RESOLVED = "resolved", "Resolved"
        CLOSED = "closed", "Closed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="tickets")

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")

    status = models.CharField(max_length=32, choices=Status.choices, default=Status.NEW)
    priority = models.PositiveIntegerField(default=0)

    requester_name = models.CharField(max_length=255, blank=True, default="")
    requester_email = models.EmailField(blank=True, default="")

    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_tickets")
    assigned_to = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_tickets")

    sla_policy = models.ForeignKey(
        ServiceDeskSlaPolicy,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tickets",
    )

    first_response_due_at = models.DateTimeField(null=True, blank=True)
    resolution_due_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)


class TicketComment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="ticket_comments")
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="comments")

    body = models.TextField()
    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="ticket_comments")

    external_author_name = models.CharField(max_length=255, blank=True, default="")
    external_author_email = models.EmailField(blank=True, default="")

    created_at = models.DateTimeField(default=timezone.now, editable=False)


class TicketTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="ticket_templates")
    name = models.CharField(max_length=255)
    body = models.TextField()
    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("organization", "name")


class TicketRating(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="ticket_ratings")
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="ratings")

    score = models.PositiveSmallIntegerField()  # 1..5
    comment = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="ticket_ratings")
    requester_email = models.EmailField(blank=True, default="")

    created_at = models.DateTimeField(default=timezone.now, editable=False)

    class Meta:
        unique_together = ("ticket", "requester_email")


class TicketPublicAccess(models.Model):
    """
    Доступ к тикету с внешней стороны без регистрации.
    Для MVP используем токен и PIN.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="ticket_public_access")
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="public_access")

    token = models.UUIDField(unique=True, default=uuid.uuid4, editable=False)
    pin_code = models.CharField(max_length=4)

    expires_at = models.DateTimeField(null=True, blank=True)
    is_one_time = models.BooleanField(default=True)
    consumed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(default=timezone.now, editable=False)

