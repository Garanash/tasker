"""
Нативная авторизация: register, login, refresh, me, spaces, groups.
Без Django, только asyncpg + passlib + jose.
"""
from __future__ import annotations

import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from jose import JWTError, jwt
from passlib.hash import pbkdf2_sha256

from .deps import require_admin_role, require_authenticated_user_id, ROLE_PRIORITY, get_effective_role
from . import state
from .mailout import build_login_otp_email, build_registration_welcome, send_html_mail

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)

# JWT: access 1h, refresh 7d
ACCESS_EXP = timedelta(hours=1)
REFRESH_EXP = timedelta(days=7)
LOGIN_OTP_EXP = timedelta(minutes=15)
ALLOWED_ROLES = {"user", "executor", "manager", "lead", "admin"}

AVATAR_URL_MAX_LEN = 2048
MEDIA_ROOT = os.environ.get("MEDIA_ROOT", "/tmp/kaiten_media")
MEDIA_URL = os.environ.get("MEDIA_URL", "/media/")
AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_CONTENT_TYPES: dict[str, str] = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


async def _ensure_user_avatar_url_column(conn: asyncpg.Connection) -> None:
    """Миграция для существующих БД без колонки avatar_url."""
    await conn.execute(
        "ALTER TABLE core_user ADD COLUMN IF NOT EXISTS avatar_url varchar(2048) NOT NULL DEFAULT ''"
    )


async def _ensure_user_login_otp_columns(conn: asyncpg.Connection) -> None:
    await conn.execute("ALTER TABLE core_user ADD COLUMN IF NOT EXISTS login_otp_hash varchar(256)")
    await conn.execute("ALTER TABLE core_user ADD COLUMN IF NOT EXISTS login_otp_expires_at timestamptz")


async def _issue_login_code_and_email(conn: asyncpg.Connection, user_id: str) -> tuple[bool, str | None]:
    """Генерирует OTP, сохраняет хэш, шлёт письмо. Возвращает (ok, error_detail)."""
    await _ensure_user_login_otp_columns(conn)
    row = await conn.fetchrow(
        "SELECT email, full_name FROM core_user WHERE id = $1::uuid AND is_active = true",
        user_id,
    )
    if not row:
        return False, "user_not_found"
    to_email = row["email"]
    full_name = row["full_name"] or ""
    code = f"{secrets.randbelow(10**6):06d}"
    otp_hash = pbkdf2_sha256.hash(code)
    now = datetime.now(timezone.utc)
    expires = now + LOGIN_OTP_EXP
    await conn.execute(
        "UPDATE core_user SET login_otp_hash = $1, login_otp_expires_at = $2 WHERE id = $3::uuid",
        otp_hash,
        expires,
        user_id,
    )
    subj, html_body, text = build_login_otp_email(full_name, to_email, code)
    ok, err = await send_html_mail(to_email, subj, html_body, text)
    if not ok:
        logger.warning("Не удалось отправить код входа: %s", err)
        return False, err or "mail_failed"
    return True, None


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
        await _ensure_user_login_otp_columns(conn)
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
    subj, html_body, text_body = build_registration_welcome(full_name, email, org_name)
    mail_ok, mail_err = await send_html_mail(email, subj, html_body, text_body)
    if not mail_ok and mail_err != "mail_not_configured":
        logger.warning("Письмо после регистрации не отправлено: %s", mail_err)
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
        now = datetime.now(timezone.utc)
        await conn.execute("UPDATE core_user SET last_login = $1 WHERE id = $2::uuid", now, user_id)

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


@router.post("/me/avatar")
async def upload_me_avatar(
    user_id: str = Depends(require_authenticated_user_id),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Загрузить аватар с диска; сохраняет файл и обновляет avatar_url пользователя."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    raw_ct = (file.content_type or "").split(";")[0].strip().lower()
    ext = AVATAR_CONTENT_TYPES.get(raw_ct)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="invalid_file_type",
        )
    body = await file.read()
    if not body:
        raise HTTPException(status_code=400, detail="empty_file")
    if len(body) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=400, detail="file_too_large")

    media_dir = Path(MEDIA_ROOT) / "avatars" / user_id
    media_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    path = media_dir / stored_name
    path.write_bytes(body)

    avatar_url = f"{MEDIA_URL.rstrip('/')}/avatars/{user_id}/{stored_name}"
    if len(avatar_url) > AVATAR_URL_MAX_LEN:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="avatar_url too long")

    async with state.pg_pool.acquire() as conn:
        await _ensure_user_avatar_url_column(conn)
        await conn.execute(
            "UPDATE core_user SET avatar_url = $1 WHERE id = $2::uuid",
            avatar_url,
            user_id,
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
            SELECT u.id, u.email, u.full_name, om.role, u.last_login
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
            "last_login": r["last_login"].isoformat() if r["last_login"] else None,
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
        await _ensure_user_login_otp_columns(conn)
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


@router.post("/login-otp")
async def login_with_otp(request: Request) -> dict[str, Any]:
    """Вход по одноразовому коду из письма (без пароля)."""
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip().replace(" ", "")
    if not email or not code:
        raise HTTPException(status_code=400, detail="email_and_code_required")
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")

    async with state.pg_pool.acquire() as conn:
        await _ensure_user_login_otp_columns(conn)
        row = await conn.fetchrow(
            """
            SELECT id, login_otp_hash, login_otp_expires_at
            FROM core_user
            WHERE lower(email) = lower($1) AND is_active = true
            """,
            email,
        )
        if not row or not row["login_otp_hash"]:
            raise HTTPException(status_code=401, detail="invalid_or_expired_code")
        now = datetime.now(timezone.utc)
        exp = row["login_otp_expires_at"]
        if exp is None or exp < now:
            raise HTTPException(status_code=401, detail="invalid_or_expired_code")
        if not pbkdf2_sha256.verify(code, row["login_otp_hash"]):
            raise HTTPException(status_code=401, detail="invalid_or_expired_code")
        uid = str(row["id"])
        await conn.execute(
            """
            UPDATE core_user
            SET login_otp_hash = NULL, login_otp_expires_at = NULL, last_login = $1
            WHERE id = $2::uuid
            """,
            now,
            uid,
        )

    tokens = _create_tokens(uid)
    return {"access": tokens["access"], "refresh": tokens["refresh"]}


@router.post("/me/request-login-code")
async def request_my_login_code(_user_id: str = Depends(require_authenticated_user_id)) -> dict[str, Any]:
    """Отправить текущему пользователю код для входа на email (смена пароля / вход с другого устройства)."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        ok, err = await _issue_login_code_and_email(conn, _user_id)
    if not ok:
        if err == "mail_not_configured":
            raise HTTPException(status_code=503, detail="mail_not_configured")
        raise HTTPException(status_code=500, detail=err or "mail_failed")
    return {"ok": True}


@router.post("/users/{target_user_id}/request-login-code")
async def admin_request_user_login_code(
    request: Request,
    target_user_id: str,
    _role: str = Depends(require_admin_role),
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Админ: отправить пользователю организации одноразовый код для входа."""
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
        member = await conn.fetchrow(
            "SELECT 1 FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid",
            org_id,
            target_user_id,
        )
        if not member:
            raise HTTPException(status_code=404, detail="member_not_found")
        ok, err = await _issue_login_code_and_email(conn, target_user_id)

    if not ok:
        if err == "mail_not_configured":
            raise HTTPException(status_code=503, detail="mail_not_configured")
        raise HTTPException(status_code=500, detail=err or "mail_failed")
    return {"ok": True}


@router.patch("/users/{target_user_id}")
async def patch_org_user(
    request: Request,
    target_user_id: str,
    _role: str = Depends(require_admin_role),
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Админ: изменить имя и/или email пользователя в организации (по активному space)."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_json")

    full_name = body.get("full_name")
    email_raw = body.get("email")
    if full_name is None and email_raw is None:
        raise HTTPException(status_code=400, detail="no_fields_to_update")

    space_id = request.headers.get("x-space-id")
    if not space_id:
        raise HTTPException(status_code=400, detail="X-Space-Id required")

    next_name: str | None = None
    if full_name is not None:
        next_name = str(full_name).strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="full_name cannot be empty")
        if len(next_name) > 255:
            raise HTTPException(status_code=400, detail="full_name too long")

    next_email: str | None = None
    if email_raw is not None:
        next_email = str(email_raw).strip().lower()
        if not next_email:
            raise HTTPException(status_code=400, detail="email cannot be empty")
        if len(next_email) > 254:
            raise HTTPException(status_code=400, detail="email too long")

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
        member = await conn.fetchrow(
            "SELECT 1 FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid",
            org_id,
            target_user_id,
        )
        if not member:
            raise HTTPException(status_code=404, detail="member_not_found")

        if next_email is not None:
            taken = await conn.fetchval(
                "SELECT id FROM core_user WHERE lower(email) = lower($1) AND id <> $2::uuid",
                next_email,
                target_user_id,
            )
            if taken:
                raise HTTPException(status_code=400, detail="email_taken")

        sets: list[str] = []
        vals: list[Any] = []
        pi = 1
        if next_name is not None:
            sets.append(f"full_name = ${pi}")
            vals.append(next_name)
            pi += 1
        if next_email is not None:
            sets.append(f"email = ${pi}")
            vals.append(next_email)
            pi += 1
        vals.append(target_user_id)
        await conn.execute(
            f"UPDATE core_user SET {', '.join(sets)} WHERE id = ${pi}::uuid",
            *vals,
        )
        u = await conn.fetchrow(
            """
            SELECT id, email, full_name, last_login
            FROM core_user WHERE id = $1::uuid
            """,
            target_user_id,
        )
        om = await conn.fetchrow(
            "SELECT role FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid",
            org_id,
            target_user_id,
        )

    if not u or not om:
        raise HTTPException(status_code=404, detail="user_not_found")
    return {
        "id": str(u["id"]),
        "email": u["email"],
        "full_name": u["full_name"] or "",
        "role": om["role"],
        "last_login": u["last_login"].isoformat() if u["last_login"] else None,
    }
