"""
Documents API приложения AGBTasker: список, создание, просмотр и правка документов пространства.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request

from . import state
from .deps import require_authenticated_user_id, require_manager_role, require_space_access

router = APIRouter(prefix="/api/docs", tags=["docs"])

DOC_TYPE_DOCUMENT = "document"
DOC_TYPE_KNOWLEDGE_BASE = "knowledge_base"
ALLOWED_DOC_TYPES = {DOC_TYPE_DOCUMENT, DOC_TYPE_KNOWLEDGE_BASE}


def _doc_mini(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "title": row["title"] or "",
        "doc_type": row["doc_type"] or DOC_TYPE_DOCUMENT,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
    }


def _doc_detail(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "title": row["title"] or "",
        "content": row["content"] or "",
        "doc_type": row["doc_type"] or DOC_TYPE_DOCUMENT,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else None,
        "card_id": str(row["card_id"]) if row.get("card_id") else None,
    }


@router.get("")
async def docs_list(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> list[dict[str, Any]]:
    """Список документов пространства.

    С заголовком `X-Space-Id` — документы этого space; без него — первое доступное пространство пользователя.
    Возвращает краткие записи: id, title, doc_type, updated_at. Требуется Bearer.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    space_id = request.headers.get("x-space-id")
    async with state.pg_pool.acquire() as conn:
        if space_id:
            rows = await conn.fetch(
                """
                SELECT d.id, d.title, d.doc_type, d.updated_at
                FROM core_document d
                JOIN core_space s ON s.id = d.space_id
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE om.user_id = $1::uuid AND d.space_id = $2::uuid
                ORDER BY d.updated_at DESC
                """,
                user_id,
                space_id,
            )
        else:
            first_space = await conn.fetchrow(
                """
                SELECT s.id
                FROM core_space s
                JOIN core_organizationmember om ON om.organization_id = s.organization_id
                WHERE om.user_id = $1::uuid
                ORDER BY s.created_at
                LIMIT 1
                """,
                user_id,
            )
            if not first_space:
                return []
            rows = await conn.fetch(
                """
                SELECT d.id, d.title, d.doc_type, d.updated_at
                FROM core_document d
                WHERE d.space_id = $1::uuid
                ORDER BY d.updated_at DESC
                """,
                str(first_space["id"]),
            )
    return [_doc_mini(r) for r in rows]


@router.post("")
async def docs_create(
    request: Request,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Создать документ в пространстве.

    Обязателен `X-Space-Id`. Тело: title, content, doc_type (`document` | `knowledge_base`), опционально card_id.
    Роль manager+. Возвращает краткую запись созданного документа.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    title = (body.get("title") or "").strip()
    content = body.get("content") or ""
    doc_type = body.get("doc_type") or DOC_TYPE_DOCUMENT
    card_id = body.get("card_id")
    space_id = request.headers.get("x-space-id")
    if not space_id:
        raise HTTPException(status_code=400, detail="space_id required via X-Space-Id")
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="invalid doc_type")

    async with state.pg_pool.acquire() as conn:
        space_row = await conn.fetchrow(
            """
            SELECT s.id, s.organization_id
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE s.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            space_id,
            user_id,
        )
        if not space_row:
            raise HTTPException(status_code=404, detail="Space not found")

        card_id_to_store = None
        if card_id:
            card_row = await conn.fetchrow(
                """
                SELECT c.id
                FROM core_card c
                JOIN core_board b ON b.id = c.board_id
                WHERE c.id = $1::uuid AND b.space_id = $2::uuid
                LIMIT 1
                """,
                card_id,
                space_id,
            )
            if not card_row:
                raise HTTPException(status_code=404, detail="Card not found")
            card_id_to_store = str(card_row["id"])

        doc_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        row = await conn.fetchrow(
            """
            INSERT INTO core_document (id, organization_id, space_id, card_id, doc_type, title, content, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $8)
            RETURNING id, title, doc_type, updated_at
            """,
            doc_id,
            str(space_row["organization_id"]),
            str(space_row["id"]),
            card_id_to_store,
            doc_type,
            title,
            content,
            now,
        )
    return _doc_mini(row)


@router.get("/{document_id}")
async def docs_detail(
    request: Request,
    document_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
) -> dict[str, Any]:
    """Получить документ по id: заголовок, контент (JSON блоков), тип, даты, привязка к карточке.

    При переданном `X-Space-Id` документ должен принадлежать этому space, иначе 403.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    space_id = request.headers.get("x-space-id")
    async with state.pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT d.id, d.title, d.content, d.doc_type, d.created_at, d.updated_at, d.card_id, d.space_id
            FROM core_document d
            JOIN core_space s ON s.id = d.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE d.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            document_id,
            user_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    if space_id and str(row["space_id"]) != space_id:
        raise HTTPException(status_code=403, detail="Document outside active space")
    return _doc_detail(row)


@router.patch("/{document_id}")
async def docs_patch(
    request: Request,
    document_id: str,
    user_id: str = Depends(require_authenticated_user_id),
    _: None = Depends(require_space_access),
    _role: str = Depends(require_manager_role),
) -> dict[str, Any]:
    """Обновить документ (title, content, doc_type).

    Роль manager+. PATCH JSON перезаписывает указанные поля. Возвращает обновлённый объект как при GET.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    title = (body.get("title") or "").strip()
    content = body.get("content") or ""
    doc_type = body.get("doc_type") or DOC_TYPE_DOCUMENT
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(status_code=400, detail="invalid doc_type")

    async with state.pg_pool.acquire() as conn:
        existing = await conn.fetchrow(
            """
            SELECT d.id
            FROM core_document d
            JOIN core_space s ON s.id = d.space_id
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE d.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            document_id,
            user_id,
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Document not found")
        now = datetime.now(timezone.utc)
        row = await conn.fetchrow(
            """
            UPDATE core_document
            SET doc_type = $1, title = $2, content = $3, updated_at = $4
            WHERE id = $5::uuid
            RETURNING id, title, content, doc_type, created_at, updated_at, card_id
            """,
            doc_type,
            title,
            content,
            now,
            document_id,
        )
    return _doc_detail(row)
