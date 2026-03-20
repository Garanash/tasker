"""
Нативная авторизация: register, login, refresh, me, spaces, groups.
Без Django, только asyncpg + passlib + jose.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from jose import JWTError, jwt
from passlib.hash import pbkdf2_sha256

from .deps import require_admin_role, require_authenticated_user_id, ROLE_PRIORITY, get_effective_role
from . import state

router = APIRouter(prefix="/api/auth", tags=["auth"])

# JWT: access 1h, refresh 7d
ACCESS_EXP = timedelta(hours=1)
REFRESH_EXP = timedelta(days=7)
ALLOWED_ROLES = {"user", "manager", "lead", "admin"}

AVATAR_URL_MAX_LEN = 2048


async def _ensure_user_avatar_url_column(conn: asyncpg.Connection) -> None:
    """Миграция для существующих БД без колонки avatar_url."""
    await conn.execute(
        "ALTER TABLE core_user ADD COLUMN IF NOT EXISTS avatar_url varchar(2048) NOT NULL DEFAULT ''"
    )


def _hash_password(password: str) -> str:
    return pbkdf2_sha256.hash(password)


def _verify_password(plain: str, hashed: str) -> bool:
    if hashed.startswith("pbkdf2_sha256$"):
        return _verify_django_password(plain, hashed)
    return pbkdf2_sha256.verify(plain, hashed)


def _verify_django_password(plain: str, hashed: str) -> bool:
    """Verify password hashed in Django format: pbkdf2_sha256$iterations$salt$hash."""
    import base64
    import hashlib
    parts = hashed.split("$")
    if len(parts) != 4:
        return False
    algorithm, iterations, salt, hash_b64 = parts
    if algorithm != "pbkdf2_sha256":
        return False
    try:
        iterations_int = int(iterations)
        expected_hash = base64.b64decode(hash_b64)
        derived = hashlib.pbkdf2_hmac(
            "sha256",
            plain.encode("utf-8"),
            salt.encode("utf-8"),
            iterations_int,
            dklen=len(expected_hash),
        )
        return derived == expected_hash
    except Exception:
        return False


def _create_tokens(user_id: str) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    access = jwt.encode(
        {"user_id": user_id, "exp": now + ACCESS_EXP, "type": "access"},
        state.SECRET_KEY,
        algorithm="HS256",
    )
    refresh = jwt.encode(
        {"user_id": user_id, "exp": now + REFRESH_EXP, "type": "refresh"},
        state.SECRET_KEY,
        algorithm="HS256",
    )
    return {"access": access, "refresh": refresh}


@router.post("/register")
async def register(request: Request) -> dict[str, Any]:
    """Регистрация: email, password, organization_name, full_name (optional). Возвращает access + refresh."""
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")
    org_name = (body.get("organization_name") or "").strip()
    full_name = (body.get("full_name") or "").strip()
    if not email or not password or len(password) < 8:
        raise HTTPException(status_code=400, detail="email and password (min 8) required")
    if not org_name:
        raise HTTPException(status_code=400, detail="organization_name required")

    async with state.pg_pool.acquire() as conn:
        existing = await conn.fetchval(
            "SELECT id FROM core_user WHERE email = $1", email
        )
        if existing:
            raise HTTPException(status_code=400, detail="Пользователь с таким email уже существует")

        user_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        member_id = str(uuid.uuid4())
        space_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        hashed = _hash_password(password)

        await conn.execute(
            """
            INSERT INTO core_user (id, email, full_name, password, is_staff, is_active, is_superuser, created_at)
            VALUES ($1::uuid, $2, $3, $4, false, true, false, $5)
            """,
            user_id,
            email,
            full_name,
            hashed,
            now,
        )
        await conn.execute(
            "INSERT INTO core_organization (id, name, created_at) VALUES ($1::uuid, $2, $3)",
            org_id,
            org_name,
            now,
        )
        await conn.execute(
            """
            INSERT INTO core_organizationmember (id, organization_id, user_id, role, created_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'admin', $4)
            """,
            member_id,
            org_id,
            user_id,
            now,
        )
        await conn.execute(
            "INSERT INTO core_space (id, organization_id, name, created_at) VALUES ($1::uuid, $2::uuid, $3, $4)",
            space_id,
            org_id,
            "Основное пространство",
            now,
        )

    tokens = _create_tokens(user_id)
    return {"ok": True, "user_id": user_id, **tokens}


@router.post("/login")
async def login(request: Request) -> dict[str, Any]:
    """Вход: email, password. Возвращает access + refresh."""
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    email = (body.get("email") or "").strip().lower()
    password = body.get("password")
    if not email or not password:
        raise HTTPException(status_code=400, detail="email and password required")

    async with state.pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, password FROM core_user WHERE email = $1 AND is_active = true",
            email,
        )
    if not row:
        raise HTTPException(status_code=401, detail="Неверный email или пароль")
    user_id = str(row["id"])
    hashed = row["password"]
    if not hashed or not _verify_password(password, hashed):
        raise HTTPException(status_code=401, detail="Неверный email или пароль")

    tokens = _create_tokens(user_id)
    return {"access": tokens["access"], "refresh": tokens["refresh"]}


@router.post("/refresh")
async def refresh(request: Request) -> dict[str, Any]:
    """Обновление токена: refresh. Возвращает access (+ refresh)."""
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    token = body.get("refresh")
    if not token:
        raise HTTPException(status_code=400, detail="refresh required")
    try:
        payload = jwt.decode(token, state.SECRET_KEY, algorithms=["HS256"])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="invalid_token")
        user_id = str(payload.get("user_id", ""))
        if not user_id:
            raise HTTPException(status_code=401, detail="invalid_token")
    except JWTError:
        raise HTTPException(status_code=401, detail="invalid_token")

    tokens = _create_tokens(user_id)
    return {"access": tokens["access"], "refresh": tokens["refresh"]}


@router.get("/me")
async def me(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> dict[str, Any]:
    """Текущий пользователь и memberships."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    user_id = _user_id
    async with state.pg_pool.acquire() as conn:
        await _ensure_user_avatar_url_column(conn)
        u = await conn.fetchrow(
            """
            SELECT id, email, full_name, COALESCE(avatar_url, '') AS avatar_url
            FROM core_user WHERE id = $1::uuid
            """,
            user_id,
        )
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        memberships = await conn.fetch(
            """
            SELECT om.organization_id, om.role, o.name AS organization_name
            FROM core_organizationmember om
            JOIN core_organization o ON o.id = om.organization_id
            WHERE om.user_id = $1::uuid
            """,
            user_id,
        )
    effective_role = ""
    if memberships:
        effective_role = await get_effective_role(_user_id, str(memberships[0]["organization_id"]))
    return {
        "user": {
            "id": str(u["id"]),
            "email": u["email"],
            "full_name": u["full_name"] or "",
            "avatar_url": (u["avatar_url"] or "") if u["avatar_url"] is not None else "",
        },
        "effective_role": effective_role,
        "memberships": [
            {
                "organization_id": str(m["organization_id"]),
                "role": m["role"],
                "organization_name": m["organization_name"],
            }
            for m in memberships
        ],
    }


@router.patch("/me")
async def patch_me(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> dict[str, Any]:
    """Обновить имя и URL аватара текущего пользователя."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_json")

    sets: list[str] = []
    vals: list[Any] = []
    param_i = 1

    if "full_name" in body:
        fn = str(body.get("full_name") or "").strip()
        if not fn:
            raise HTTPException(status_code=400, detail="full_name cannot be empty")
        if len(fn) > 255:
            raise HTTPException(status_code=400, detail="full_name too long")
        sets.append(f"full_name = ${param_i}")
        vals.append(fn)
        param_i += 1

    if "avatar_url" in body:
        url = str(body.get("avatar_url") or "").strip()
        if len(url) > AVATAR_URL_MAX_LEN:
            raise HTTPException(status_code=400, detail="avatar_url too long")
        sets.append(f"avatar_url = ${param_i}")
        vals.append(url)
        param_i += 1

    if not sets:
        raise HTTPException(status_code=400, detail="no fields to update")

    user_id = _user_id
    async with state.pg_pool.acquire() as conn:
        await _ensure_user_avatar_url_column(conn)
        vals.append(user_id)
        await conn.execute(
            f"UPDATE core_user SET {', '.join(sets)} WHERE id = ${param_i}::uuid",
            *vals,
        )
        u = await conn.fetchrow(
            """
            SELECT id, email, full_name, COALESCE(avatar_url, '') AS avatar_url
            FROM core_user WHERE id = $1::uuid
            """,
            user_id,
        )
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "user": {
            "id": str(u["id"]),
            "email": u["email"],
            "full_name": u["full_name"] or "",
            "avatar_url": (u["avatar_url"] or "") if u["avatar_url"] is not None else "",
        }
    }


@router.get("/spaces")
async def spaces(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> list[dict[str, Any]]:
    """Список пространств по организациям пользователя."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.name, s.organization_id
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE om.user_id = $1::uuid
            ORDER BY s.name
            """,
            _user_id,
        )
    return [{"id": str(r["id"]), "name": r["name"], "organization_id": str(r["organization_id"])} for r in rows]


@router.get("/groups")
async def groups(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> list[dict[str, Any]]:
    """Группы пользователей по организациям."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT g.id, g.name, g.organization_id, g.role
            FROM core_usergroup g
            JOIN core_organizationmember om ON om.organization_id = g.organization_id
            WHERE om.user_id = $1::uuid
            ORDER BY g.name
            """,
            _user_id,
        )
    return [
        {"id": str(r["id"]), "name": r["name"], "organization_id": str(r["organization_id"]), "role": r["role"]}
        for r in rows
    ]


@router.get("/users")
async def list_users(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> list[dict[str, Any]]:
    """Список пользователей активной организации."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    space_id = request.headers.get("x-space-id")
    if not space_id:
        raise HTTPException(status_code=400, detail="X-Space-Id required")
    async with state.pg_pool.acquire() as conn:
        org_row = await conn.fetchrow(
            """
            SELECT s.organization_id
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE s.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            space_id,
            _user_id,
        )
        if not org_row:
            raise HTTPException(status_code=403, detail="space_forbidden")
        org_id = str(org_row["organization_id"])
        rows = await conn.fetch(
            """
            SELECT u.id, u.email, u.full_name, om.role
            FROM core_organizationmember om
            JOIN core_user u ON u.id = om.user_id
            WHERE om.organization_id = $1::uuid
            ORDER BY u.email
            """,
            org_id,
        )
    return [
        {
            "id": str(r["id"]),
            "email": r["email"],
            "full_name": r["full_name"] or "",
            "role": r["role"],
        }
        for r in rows
    ]


@router.post("/users")
async def create_user_in_org(
    request: Request,
    _role: str = Depends(require_admin_role),
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Создать пользователя и добавить в активную организацию."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    full_name = (body.get("full_name") or "").strip()
    role = (body.get("role") or "user").strip().lower()
    if not email or len(password) < 8:
        raise HTTPException(status_code=400, detail="email and password (min 8) required")
    if role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")
    space_id = request.headers.get("x-space-id")
    if not space_id:
        raise HTTPException(status_code=400, detail="X-Space-Id required")

    async with state.pg_pool.acquire() as conn:
        org_row = await conn.fetchrow(
            """
            SELECT s.organization_id
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE s.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            space_id,
            _user_id,
        )
        if not org_row:
            raise HTTPException(status_code=403, detail="space_forbidden")
        org_id = str(org_row["organization_id"])
        exists = await conn.fetchrow("SELECT id FROM core_user WHERE email = $1", email)
        now = datetime.now(timezone.utc)
        if exists:
            created_user_id = str(exists["id"])
        else:
            created_user_id = str(uuid.uuid4())
            await conn.execute(
                """
                INSERT INTO core_user (id, email, full_name, password, is_staff, is_active, is_superuser, created_at)
                VALUES ($1::uuid, $2, $3, $4, false, true, false, $5)
                """,
                created_user_id,
                email,
                full_name,
                _hash_password(password),
                now,
            )
        member = await conn.fetchrow(
            "SELECT id FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid",
            org_id,
            created_user_id,
        )
        if member:
            await conn.execute(
                "UPDATE core_organizationmember SET role = $1 WHERE id = $2::uuid",
                role,
                str(member["id"]),
            )
        else:
            await conn.execute(
                """
                INSERT INTO core_organizationmember (id, organization_id, user_id, role, created_at)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
                """,
                str(uuid.uuid4()),
                org_id,
                created_user_id,
                role,
                now,
            )
    return {"id": created_user_id, "email": email, "full_name": full_name, "role": role}


@router.patch("/users/{target_user_id}/role")
async def update_user_role_in_org(
    request: Request,
    target_user_id: str,
    _role: str = Depends(require_admin_role),
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Изменить роль пользователя в активной организации."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    new_role = (body.get("role") or "").strip().lower()
    if new_role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")
    space_id = request.headers.get("x-space-id")
    if not space_id:
        raise HTTPException(status_code=400, detail="X-Space-Id required")
    async with state.pg_pool.acquire() as conn:
        org_row = await conn.fetchrow(
            """
            SELECT s.organization_id
            FROM core_space s
            JOIN core_organizationmember om ON om.organization_id = s.organization_id
            WHERE s.id = $1::uuid AND om.user_id = $2::uuid
            LIMIT 1
            """,
            space_id,
            _user_id,
        )
        if not org_row:
            raise HTTPException(status_code=403, detail="space_forbidden")
        org_id = str(org_row["organization_id"])
        actor_role = await get_effective_role(_user_id, org_id)
        if ROLE_PRIORITY.get(new_role, 0) > ROLE_PRIORITY.get(actor_role, 0):
            raise HTTPException(status_code=403, detail="insufficient_role")
        member = await conn.fetchrow(
            "SELECT id FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid",
            org_id,
            target_user_id,
        )
        if not member:
            raise HTTPException(status_code=404, detail="member_not_found")
        await conn.execute(
            "UPDATE core_organizationmember SET role = $1 WHERE id = $2::uuid",
            new_role,
            str(member["id"]),
        )
    return {"ok": True, "user_id": target_user_id, "role": new_role}
