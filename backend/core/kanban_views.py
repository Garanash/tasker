from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.kanban_serializers import CardCommentCreateSerializer, CardDetailSerializer, CardLiteSerializer, MoveCardSerializer
from core.models import (
    Board,
    Card,
    CardFieldDefinition,
    CardFieldValue,
    CardMovementEvent,
    Checklist,
    ChecklistItem,
    Column,
    Project,
    Space,
    Track,
    WipLimit,
)
from core.permissions import get_active_space_id, HasSpaceAccess
from core.restrictions import validate_card_move
from core.automation import run_automation_for_card_movement
from core.models import Attachment

from django.conf import settings
from django.utils.text import get_valid_filename
from pathlib import Path
import uuid
from urllib.parse import urlparse


class BoardsView(APIView):
    """
    GET /api/kanban/boards
    Возвращает доски в рамках доступных space'ов пользователя.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        space_id = get_active_space_id(request)
        if space_id:
            boards = Board.objects.filter(space_id=space_id).order_by("name")
        else:
            org_ids = list(request.user.memberships.values_list("organization_id", flat=True))
            boards = Board.objects.filter(space__organization_id__in=org_ids).order_by("name")
        return Response(
            [
                {"id": str(b.id), "name": b.name, "space_id": str(b.space_id), "project_id": str(b.project_id)}
                for b in boards
            ]
        )


class BootstrapKanbanView(APIView):
    """
    Создает минимальный демо-board: 1 project, 1 board, 3 колонki (ToDo/InProgress/Done) и 1-2 карточки.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        space_id = get_active_space_id(request) or str(
            request.user.memberships.first().organization.spaces.order_by("created_at").first().id
        )

        space = Space.objects.get(id=space_id)
        project = Project.objects.create(space=space, name="Демо-проект")
        board = Board.objects.create(space=space, project=project, name="Демо-доска")

        columns = [
            Column.objects.create(board=board, name="ToDo", order_index=0, is_done=False),
            Column.objects.create(board=board, name="InProgress", order_index=1, is_done=False),
            Column.objects.create(board=board, name="Done", order_index=2, is_done=True),
        ]

        # Track не обязателен, но чтобы UI мог показать дорожки.
        track_main = Track.objects.create(board=board, name="Основной поток", order_index=0)

        first_card = Card.objects.create(
            board=board,
            column=columns[0],
            track=track_main,
            title="Собрать требования",
            description="Описание задачи для демо.",
        )
        checklist = Checklist.objects.create(card=first_card, title="Чек-лист требований")
        ChecklistItem.objects.create(checklist=checklist, title="Собрать input от команды", is_done=False)
        ChecklistItem.objects.create(checklist=checklist, title="Проверить scope и допущения", is_done=False)

        # Демо-кастомные поля карточки.
        priority_def = CardFieldDefinition.objects.create(
            space=space,
            key="priority",
            name="Приоритет",
            field_type=CardFieldDefinition.FieldType.TEXT,
        )
        CardFieldValue.objects.create(card=first_card, definition=priority_def, value="Высокий")

        estimate_def = CardFieldDefinition.objects.create(
            space=space,
            key="customer_value",
            name="Ценность для заказчика",
            field_type=CardFieldDefinition.FieldType.NUMBER,
        )
        CardFieldValue.objects.create(card=first_card, definition=estimate_def, value=10)

        Card.objects.create(
            board=board,
            column=columns[1],
            track=track_main,
            title="Реализовать Kanban",
            description="Через REST + realtime.",
        )

        # Небольшой дефолтный WIP: для Done не нужно, только для активных колонок.
        WipLimit.objects.create(organization=space.organization, board=board, scope_type="column", column=columns[0], limit=5)
        WipLimit.objects.create(organization=space.organization, board=board, scope_type="column", column=columns[1], limit=5)

        return Response({"board_id": str(board.id)}, status=status.HTTP_201_CREATED)


class BoardGridView(APIView):
    permission_classes = [permissions.IsAuthenticated, HasSpaceAccess]

    def get(self, request, board_id: str):
        board = Board.objects.select_related("space", "project").get(id=board_id)

        columns = board.columns.select_related(None).order_by("order_index")
        cards = (
            Card.objects.filter(board=board)
            .select_related("column", "track")
            .order_by("-updated_at")
        )

        by_column = {str(c.id): [] for c in columns}
        for card in cards:
            by_column[str(card.column_id)].append(CardLiteSerializer(card).data)

        response = {
            "board": {"id": str(board.id), "name": board.name},
            "tracks": [{"id": str(t.id), "name": t.name} for t in board.tracks.order_by("order_index")],
            "columns": [
                {"id": str(col.id), "name": col.name, "order_index": col.order_index, "is_done": col.is_done, "cards": by_column[str(col.id)]}
                for col in columns
            ],
        }
        return Response(response)


class MoveCardView(APIView):
    permission_classes = [permissions.IsAuthenticated, HasSpaceAccess]

    def post(self, request, card_id: str):
        serializer = MoveCardSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        card = Card.objects.select_related("board", "column", "track").get(id=card_id)

        to_column_id = serializer.validated_data["to_column_id"]
        to_track_id = serializer.validated_data.get("to_track_id")

        to_column = Column.objects.get(id=to_column_id)
        if to_column.board_id != card.board_id:
            return Response({"detail": "Некорректный переход: колонка не принадлежит доске"}, status=400)

        to_track = None
        if to_track_id:
            to_track = Track.objects.get(id=to_track_id)
            if to_track.board_id != card.board_id:
                return Response({"detail": "Некорректный переход: дорожка не принадлежит доске"}, status=400)

        from_column_id = card.column_id
        from_track_id = card.track_id

        # Проверяем ограничения перед перемещением.
        violation = validate_card_move(card=card, from_column=card.column, to_column=to_column)
        if violation:
            return Response(
                {"detail": violation.message, "code": violation.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Корректируем позиционирование (MVP: просто меняем колонку/дорожку).
        card.column = to_column
        card.track = to_track
        card.save(update_fields=["column", "track", "updated_at"])

        movement = CardMovementEvent.objects.create(
            organization=card.board.space.organization,
            card=card,
            actor=request.user,
            event_type=CardMovementEvent.EventType.MOVED,
            from_column_id=from_column_id,
            to_column_id=to_column_id,
            from_track_id=from_track_id,
            to_track_id=to_track_id,
            metadata={"source": "kanban_move"},
            happened_at=timezone.now(),
        )

        # Автоматизации могут выполнить цепочки действий и создать дополнительные movement events.
        run_automation_for_card_movement(movement=movement)

        payload = {
            "card": CardLiteSerializer(card).data,
            "from_column_id": str(from_column_id),
            "to_column_id": str(to_column_id),
        }

        # realtime вещаем на группу доски
        channel_layer = get_channel_layer()
        group_name = f"board_{card.board_id}"
        async_to_sync(channel_layer.group_send)(
            group_name,
            {"type": "card_moved", "payload": payload},
        )

        return Response({"ok": True, "movement_id": str(movement.id), "payload": payload})


class CardDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, HasSpaceAccess]

    def get(self, request, card_id: str):
        space_id = get_active_space_id(request)
        card = Card.objects.select_related("board__space", "track", "column").filter(id=card_id).first()
        if not card:
            return Response({"detail": "Карточка не найдена"}, status=status.HTTP_404_NOT_FOUND)

        if space_id and str(card.board.space_id) != space_id:
            return Response({"detail": "Карточка вне активного space"}, status=status.HTTP_403_FORBIDDEN)

        serializer = CardDetailSerializer(card, context={"request": request})
        return Response(serializer.data)


class CardCommentsView(APIView):
    permission_classes = [permissions.IsAuthenticated, HasSpaceAccess]

    def post(self, request, card_id: str):
        serializer = CardCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        card = Card.objects.select_related("board__space__organization").filter(id=card_id).first()
        if not card:
            return Response({"detail": "Карточка не найдена"}, status=status.HTTP_404_NOT_FOUND)

        space_id = get_active_space_id(request)
        if space_id and str(card.board.space_id) != space_id:
            return Response({"detail": "Карточка вне активного space"}, status=status.HTTP_403_FORBIDDEN)

        comment = card.comments.create(
            organization=card.board.space.organization,
            author=request.user,
            body=serializer.validated_data["body"],
        )
        out = CardDetailSerializer(comment.card, context={"request": request})
        return Response(out.data.get("comments", []), status=status.HTTP_201_CREATED)


class CardAttachmentsView(APIView):
    permission_classes = [permissions.IsAuthenticated, HasSpaceAccess]

    def post(self, request, card_id: str):
        # Вложения принимаем как:
        # 1) multipart/form-data: поле `file` (загрузка файла)
        # 2) JSON: `file_url` + (опционально) `file_name` (вложение по ссылке)
        uploaded = request.FILES.get("file")

        card = Card.objects.select_related("board__space__organization").filter(id=card_id).first()
        if not card:
            return Response({"detail": "Карточка не найдена"}, status=status.HTTP_404_NOT_FOUND)

        # Привязка к активному space (если задан header).
        space_id = get_active_space_id(request)
        if space_id and str(card.board.space_id) != space_id:
            return Response({"detail": "Карточка вне активного space"}, status=status.HTTP_403_FORBIDDEN)

        # Проверяем членство в организации.
        if not card.board.space.organization.members.filter(user=request.user).exists():
            return Response({"detail": "Нет доступа"}, status=status.HTTP_403_FORBIDDEN)

        org_id = str(card.board.space.organization_id)

        if uploaded:
            media_dir = Path(settings.MEDIA_ROOT) / "attachments" / org_id
            media_dir.mkdir(parents=True, exist_ok=True)

            original_name = get_valid_filename(uploaded.name) or "file"
            suffix = Path(original_name).suffix
            stored_name = f"{uuid.uuid4().hex}{suffix}"
            stored_path = media_dir / stored_name

            with stored_path.open("wb") as f:
                for chunk in uploaded.chunks():
                    f.write(chunk)

            file_url = f"{settings.MEDIA_URL}attachments/{org_id}/{stored_name}"

            Attachment.objects.create(
                card=card,
                uploaded_by=request.user,
                file_name=original_name,
                file_url=file_url,
                content_type=getattr(uploaded, "content_type", "") or "",
                size_bytes=uploaded.size if hasattr(uploaded, "size") else None,
            )
        else:
            file_url = request.data.get("file_url")
            if not file_url:
                return Response(
                    {"detail": "Для добавления по ссылке передайте `file_url`"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            parsed = urlparse(file_url)
            basename = Path(parsed.path).name
            original_name = get_valid_filename(request.data.get("file_name") or basename) or "link"

            Attachment.objects.create(
                card=card,
                uploaded_by=request.user,
                file_name=original_name,
                file_url=file_url,
                content_type=request.data.get("content_type") or "",
                size_bytes=None,
            )

        # Возвращаем карточку целиком (attachments уже внутри CardDetailSerializer).
        serializer = CardDetailSerializer(card, context={"request": request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

