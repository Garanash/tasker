from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from core.documents_serializers import (
    DocumentCreateSerializer,
    DocumentDetailSerializer,
    DocumentMiniSerializer,
)
from core.models import Card, Document, Space
from core.permissions import HasSpaceAccess, get_active_space_id


class DocumentsView(APIView):
    permission_classes = [permissions.IsAuthenticated, HasSpaceAccess]

    def get(self, request):
        space_id = get_active_space_id(request)
        if not space_id:
            # если header не задан — берем первый space пользователя.
            space = request.user.memberships.first().organization.spaces.order_by("created_at").first()
        else:
            space = Space.objects.filter(id=space_id).first()

        if not space:
            return Response({"detail": "Space not found"}, status=status.HTTP_404_NOT_FOUND)

        qs = Document.objects.filter(space=space).order_by("-updated_at")
        return Response(DocumentMiniSerializer(qs, many=True).data)

    def post(self, request):
        serializer = DocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        space_id = get_active_space_id(request)
        if not space_id:
            space = request.user.memberships.first().organization.spaces.order_by("created_at").first()
        else:
            space = Space.objects.filter(id=space_id).first()

        if not space:
            return Response({"detail": "Space not found"}, status=status.HTTP_404_NOT_FOUND)

        card = None
        card_id = serializer.validated_data.get("card_id")
        if card_id:
            card = Card.objects.filter(id=card_id, board__space=space).first()
            if not card:
                return Response({"detail": "Card not found"}, status=status.HTTP_404_NOT_FOUND)

        doc = Document.objects.create(
            organization=space.organization,
            space=space,
            card=card,
            doc_type=serializer.validated_data["doc_type"],
            title=serializer.validated_data["title"],
            content=serializer.validated_data["content"],
        )
        return Response(DocumentMiniSerializer(doc).data, status=status.HTTP_201_CREATED)


class DocumentDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, HasSpaceAccess]

    def get(self, request, document_id: str):
        space_id = get_active_space_id(request)
        doc = Document.objects.filter(id=document_id).select_related("space").first()
        if not doc:
            return Response({"detail": "Document not found"}, status=status.HTTP_404_NOT_FOUND)

        if space_id and str(doc.space_id) != space_id:
            return Response({"detail": "Document outside active space"}, status=status.HTTP_403_FORBIDDEN)

        return Response(DocumentDetailSerializer(doc).data)

    def patch(self, request, document_id: str):
        serializer = DocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        doc = Document.objects.filter(id=document_id).first()
        if not doc:
            return Response({"detail": "Document not found"}, status=status.HTTP_404_NOT_FOUND)

        doc.doc_type = serializer.validated_data["doc_type"]
        doc.title = serializer.validated_data["title"]
        doc.content = serializer.validated_data["content"]
        doc.save(update_fields=["doc_type", "title", "content", "updated_at"])
        return Response(DocumentDetailSerializer(doc).data)

