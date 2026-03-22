"""
Авторизация и пользователи AGBTasker: JWT, OTP, профиль, организации, админ-операции.
Стек: asyncpg, passlib, jose.
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

from .deps import require_authenticated_user_id, ROLE_PRIORITY, get_effective_role, normalize_org_role
from . import state
from .mailout import build_login_otp_email, build_password_reset_email, build_registration_welcome, send_html_mail

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


async def _resolve_org_id_for_member_request(request: Request, user_id: str) -> str:
    """Организация из заголовка X-Organization-Id (участник) или X-Space-Id."""
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_hdr = (request.headers.get("x-organization-id") or "").strip()
    if org_hdr:
        row = await state.pg_pool.fetchrow(
            "SELECT 1 FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid",
            org_hdr,
            user_id,
        )
        if not row:
            raise HTTPException(status_code=403, detail="organization_forbidden")
        return org_hdr
    space_id = request.headers.get("x-space-id")
    if not space_id:
        raise HTTPException(status_code=400, detail="X-Space-Id or X-Organization-Id required")
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
            user_id,
        )
    if not org_row:
        raise HTTPException(status_code=403, detail="space_forbidden")
    return str(org_row["organization_id"])


# JWT: access 1h, refresh 7d
ACCESS_EXP = timedelta(hours=1)
REFRESH_EXP = timedelta(days=7)
LOGIN_OTP_EXP = timedelta(minutes=15)
PASSWORD_RESET_EXP = timedelta(hours=1)
ALLOWED_ROLES = {"executor", "manager", "admin"}

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


async def _ensure_password_reset_columns(conn: asyncpg.Connection) -> None:
    await conn.execute("ALTER TABLE core_user ADD COLUMN IF NOT EXISTS password_reset_token varchar(256)")
    await conn.execute("ALTER TABLE core_user ADD COLUMN IF NOT EXISTS password_reset_expires_at timestamptz")


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
        return _verify_pbkdf2_dollar_format(plain, hashed)
    return pbkdf2_sha256.verify(plain, hashed)


def _verify_pbkdf2_dollar_format(plain: str, hashed: str) -> bool:
    """Проверка хэша вида pbkdf2_sha256$iterations$salt$hash (совместимость со старыми аккаунтами)."""
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
    """Регистрация нового пользователя и организации.

    Тело JSON: email, password (≥8), organization_name, опционально full_name. Создаётся org, membership admin,
    пространство по умолчанию. Ответ: access, refresh, user_id. Ошибка 400 при занятом email. Письмо-приветствие при настроенной почте.
    """
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
    """Вход по email и паролю.

    Тело: email, password. Ответ: access и refresh JWT. 401 при неверных учётных данных. Обновляет last_login.
    """
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


@router.post("/forgot-password")
async def forgot_password(request: Request) -> dict[str, Any]:
    """Запрос письма со ссылкой сброса пароля.

    Тело: email. Ответ всегда `{\"ok\": true}` при валидном формате (не раскрывает наличие пользователя). Письмо с токеном
    при активном пользователе и настроенной почте.
    """
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return {"ok": True}

    async with state.pg_pool.acquire() as conn:
        await _ensure_password_reset_columns(conn)
        row = await conn.fetchrow(
            "SELECT id, email, full_name FROM core_user WHERE email = $1 AND is_active = true",
            email,
        )
        if not row:
            return {"ok": True}

        user_id = str(row["id"])
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc)
        expires = now + PASSWORD_RESET_EXP
        await conn.execute(
            """
            UPDATE core_user
            SET password_reset_token = $1, password_reset_expires_at = $2
            WHERE id = $3::uuid
            """,
            token,
            expires,
            user_id,
        )

    base = (os.environ.get("PUBLIC_APP_URL") or "http://localhost:3000").strip().rstrip("/")
    reset_link = f"{base}/app?recover={token}"
    full_name = (row["full_name"] or "") if row else ""
    to_email = str(row["email"])
    subj, html_body, text_body = build_password_reset_email(full_name, to_email, reset_link)
    ok, mail_err = await send_html_mail(to_email, subj, html_body, text_body)
    if not ok and mail_err != "mail_not_configured":
        logger.warning("Письмо сброса пароля не отправлено: %s", mail_err)

    return {"ok": True}


@router.post("/reset-password")
async def reset_password(request: Request) -> dict[str, Any]:
    """Установить новый пароль по токену из письма (сброс).

    Тело: token (длинная строка из ссылки), new_password (≥8). Инвалидирует OTP-поля входа. 400 при просроченном токене.
    """
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    token = str(body.get("token") or "").strip()
    new_password = str(body.get("new_password") or "")
    if not token or len(token) < 16:
        raise HTTPException(status_code=400, detail="invalid_token")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="new_password too short (min 8)")

    now = datetime.now(timezone.utc)
    new_hashed = _hash_password(new_password)
    async with state.pg_pool.acquire() as conn:
        await _ensure_password_reset_columns(conn)
        row = await conn.fetchrow(
            """
            SELECT id FROM core_user
            WHERE password_reset_token = $1
              AND password_reset_expires_at IS NOT NULL
              AND password_reset_expires_at > $2
              AND is_active = true
            """,
            token,
            now,
        )
        if not row:
            raise HTTPException(status_code=400, detail="invalid_or_expired_token")
        user_id = str(row["id"])
        await conn.execute(
            """
            UPDATE core_user
            SET password = $1,
                password_reset_token = NULL,
                password_reset_expires_at = NULL,
                login_otp_hash = NULL,
                login_otp_expires_at = NULL
            WHERE id = $2::uuid
            """,
            new_hashed,
            user_id,
        )

    return {"ok": True}


@router.post("/refresh")
async def refresh(request: Request) -> dict[str, Any]:
    """Обновить пару JWT по refresh-токену.

    Тело: refresh. Возвращает новые access и refresh. 401 при невалидном или просроченном refresh.
    """
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
    """Профиль текущего пользователя и список членств в организациях.

    Требуется Bearer. Возвращает user (id, email, full_name, avatar_url), effective_role для первой org, memberships[].
    """
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
                "role": normalize_org_role(str(m["role"])),
                "organization_name": m["organization_name"],
            }
            for m in memberships
        ],
    }


@router.patch("/me")
async def patch_me(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> dict[str, Any]:
    """Частично обновить профиль: full_name и/или avatar_url (строка URL).

    PATCH JSON. Нельзя передать пустое full_name. Требуется Bearer.
    """
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


@router.post("/me/change-password")
async def change_my_password(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> dict[str, Any]:
    """Сменить пароль, зная текущий.

    Тело: current_password, new_password (≥8, должен отличаться от старого). Требуется Bearer.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_json")
    current_password = str(body.get("current_password") or "")
    new_password = str(body.get("new_password") or "")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="new_password too short (min 8)")
    if current_password == new_password:
        raise HTTPException(status_code=400, detail="new_password must differ from current")

    user_id = _user_id
    async with state.pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT password FROM core_user WHERE id = $1::uuid AND is_active = true",
            user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        hashed = row["password"]
        if not hashed or not _verify_password(current_password, hashed):
            raise HTTPException(status_code=400, detail="invalid_current_password")
        new_hashed = _hash_password(new_password)
        await conn.execute(
            "UPDATE core_user SET password = $1 WHERE id = $2::uuid",
            new_hashed,
            user_id,
        )
    return {"ok": True}


@router.post("/me/avatar")
async def upload_me_avatar(
    user_id: str = Depends(require_authenticated_user_id),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Загрузить файл аватара (multipart, поле file).

    Допустимые типы: jpeg, png, webp, gif; до 5 МБ. Файл кладётся в MEDIA_ROOT; в ответе — обновлённый user.
    """
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
    """Список пространств (spaces), в которых состоит пользователь.

    Требуется Bearer. Элементы: id, name, organization_id.
    """
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
    """Список групп пользователей (user groups) в организациях текущего пользователя.

    Поля: id, name, organization_id, role.
    """
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
        {
            "id": str(r["id"]),
            "name": r["name"],
            "organization_id": str(r["organization_id"]),
            "role": normalize_org_role(str(r["role"])),
        }
        for r in rows
    ]


@router.get("/organizations")
async def list_my_organizations(_user_id: str = Depends(require_authenticated_user_id)) -> list[dict[str, Any]]:
    """Список организаций, в которых состоит пользователь.

    Для каждой: id, name, membership_role.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    async with state.pg_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT o.id, o.name, om.role AS membership_role
            FROM core_organizationmember om
            JOIN core_organization o ON o.id = om.organization_id
            WHERE om.user_id = $1::uuid
            ORDER BY o.name
            """,
            _user_id,
        )
    return [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "membership_role": normalize_org_role(str(r["membership_role"])),
        }
        for r in rows
    ]


@router.post("/organizations")
async def create_organization(
    request: Request,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Создать новую организацию.

    Тело: name. Пользователь становится admin; создаётся пространство «Основное пространство». Ответ: id, name.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if len(name) > 255:
        raise HTTPException(status_code=400, detail="name too long")

    org_id = str(uuid.uuid4())
    member_id = str(uuid.uuid4())
    space_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    async with state.pg_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO core_organization (id, name, created_at) VALUES ($1::uuid, $2, $3)",
            org_id,
            name,
            now,
        )
        await conn.execute(
            """
            INSERT INTO core_organizationmember (id, organization_id, user_id, role, created_at)
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'admin', $4)
            """,
            member_id,
            org_id,
            _user_id,
            now,
        )
        await conn.execute(
            "INSERT INTO core_space (id, organization_id, name, created_at) VALUES ($1::uuid, $2::uuid, $3, $4)",
            space_id,
            org_id,
            "Основное пространство",
            now,
        )

    return {"id": org_id, "name": name}


@router.patch("/organizations/{organization_id}")
async def rename_organization(
    organization_id: str,
    request: Request,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Переименовать организацию по organization_id.

    PATCH: name. Требуется роль менеджера или администратора в этой организации.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name required")
    if len(name) > 255:
        raise HTTPException(status_code=400, detail="name too long")

    role = await get_effective_role(_user_id, organization_id)
    if ROLE_PRIORITY.get(role, 0) < ROLE_PRIORITY["manager"]:
        raise HTTPException(status_code=403, detail="insufficient_role")

    async with state.pg_pool.acquire() as conn:
        exists = await conn.fetchrow("SELECT id FROM core_organization WHERE id = $1::uuid", organization_id)
        if not exists:
            raise HTTPException(status_code=404, detail="organization_not_found")
        await conn.execute("UPDATE core_organization SET name = $1 WHERE id = $2::uuid", name, organization_id)

    return {"id": organization_id, "name": name}


@router.get("/users")
async def list_users(request: Request, _user_id: str = Depends(require_authenticated_user_id)) -> list[dict[str, Any]]:
    """Список пользователей организации с ролями и членствами.

    Контекст org через заголовок `X-Organization-Id` или `X-Space-Id`. Для админов добавляются memberships в других org.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = await _resolve_org_id_for_member_request(request, _user_id)
    async with state.pg_pool.acquire() as conn:
        await _ensure_user_avatar_url_column(conn)
        rows = await conn.fetch(
            """
            SELECT u.id, u.email, u.full_name, om.role, u.last_login,
                   COALESCE(u.avatar_url, '') AS avatar_url
            FROM core_organizationmember om
            JOIN core_user u ON u.id = om.user_id
            WHERE om.organization_id = $1::uuid
            ORDER BY lower(COALESCE(NULLIF(trim(u.full_name), ''), u.email))
            """,
            org_id,
        )
        if not rows:
            return []

        user_ids = [r["id"] for r in rows]
        mem_rows = await conn.fetch(
            """
            SELECT om.user_id::text AS user_id, om.organization_id::text AS organization_id,
                   COALESCE(o.name, '') AS organization_name, om.role::text AS role
            FROM core_organizationmember om
            JOIN core_organization o ON o.id = om.organization_id
            WHERE om.user_id = ANY($1::uuid[])
              AND (
                EXISTS (
                  SELECT 1 FROM core_organizationmember v
                  WHERE v.organization_id = $2::uuid
                    AND v.user_id = $3::uuid
                    AND v.role = 'admin'
                )
                OR om.organization_id IN (
                  SELECT organization_id FROM core_organizationmember
                  WHERE user_id = $3::uuid AND role = 'admin'
                )
                OR om.organization_id = $2::uuid
              )
            ORDER BY om.user_id, lower(COALESCE(o.name, ''))
            """,
            user_ids,
            org_id,
            _user_id,
        )

    by_user: dict[str, list[dict[str, Any]]] = {}
    for m in mem_rows:
        uid = str(m["user_id"])
        by_user.setdefault(uid, []).append(
            {
                "organization_id": str(m["organization_id"]),
                "organization_name": (m["organization_name"] or "").strip(),
                "role": normalize_org_role(str(m["role"] or "executor")),
            }
        )

    out: list[dict[str, Any]] = []
    for r in rows:
        uid = str(r["id"])
        out.append(
            {
                "id": uid,
                "email": r["email"],
                "full_name": r["full_name"] or "",
                "role": normalize_org_role(str(r["role"])),
                "last_login": r["last_login"].isoformat() if r["last_login"] else None,
                "avatar_url": (r["avatar_url"] or "").strip(),
                "memberships": by_user.get(uid, []),
            }
        )
    return out


@router.post("/users")
async def create_user_in_org(
    request: Request,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Создать пользователя или привязать существующего к организации (только admin).

    Тело: email, password (≥8), full_name, role. organization_id в теле или из заголовков. Обновляет роль, если уже был в org.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    full_name = (body.get("full_name") or "").strip()
    role = (body.get("role") or "executor").strip().lower()
    if not email or len(password) < 8:
        raise HTTPException(status_code=400, detail="email and password (min 8) required")
    if role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")

    body_org = (body.get("organization_id") or "").strip() or (request.headers.get("x-organization-id") or "").strip()
    if body_org:
        org_id = body_org
        actor = await get_effective_role(_user_id, org_id)
        if actor != "admin":
            raise HTTPException(status_code=403, detail="insufficient_role")
    else:
        org_id = await _resolve_org_id_for_member_request(request, _user_id)
        actor = await get_effective_role(_user_id, org_id)
        if actor != "admin":
            raise HTTPException(status_code=403, detail="insufficient_role")

    async with state.pg_pool.acquire() as conn:
        await _ensure_user_login_otp_columns(conn)
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
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Изменить роль участника в организации.

    PATCH: role. Только admin org; нельзя назначить роль выше своей. Контекст через X-Organization-Id / X-Space-Id.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    new_role = (body.get("role") or "").strip().lower()
    if new_role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")
    org_id = await _resolve_org_id_for_member_request(request, _user_id)
    actor_role = await get_effective_role(_user_id, org_id)
    if actor_role != "admin":
        raise HTTPException(status_code=403, detail="insufficient_role")
    async with state.pg_pool.acquire() as conn:
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
    """Вход по 6-значному коду из письма (без пароля).

    Тело: email, code. Код одноразовый, срок ~15 минут. Ответ: access, refresh. После успеха OTP сбрасывается.
    """
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


@router.post("/request-login-code")
async def request_login_code_by_email(request: Request) -> dict[str, Any]:
    """Запросить код входа на email (без авторизации).

    Тело: email. Если пользователь существует — отправляется OTP; ответ всегда `{\"ok\": true}` для защиты от перечисления.
    """
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    email = (body.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return {"ok": True}

    async with state.pg_pool.acquire() as conn:
        await _ensure_user_login_otp_columns(conn)
        row = await conn.fetchrow(
            "SELECT id FROM core_user WHERE lower(email) = lower($1) AND is_active = true",
            email,
        )
        if not row:
            return {"ok": True}
        user_id = str(row["id"])
        ok, err = await _issue_login_code_and_email(conn, user_id)

    if not ok and err != "mail_not_configured":
        logger.warning("Публичный запрос кода входа: письмо не отправлено: %s", err)

    return {"ok": True}


@router.post("/me/request-login-code")
async def request_my_login_code(_user_id: str = Depends(require_authenticated_user_id)) -> dict[str, Any]:
    """Отправить код входа на email самому себе (авторизованный пользователь).

    Для входа с другого устройства или при утере пароля. Ошибка 503 если почта не настроена.
    """
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
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Админ: отправить одноразовый код входа другому пользователю организации.

    Требуется роль admin и членство target в org. Используется для помощи сотруднику с входом.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = await _resolve_org_id_for_member_request(request, _user_id)
    if await get_effective_role(_user_id, org_id) != "admin":
        raise HTTPException(status_code=403, detail="insufficient_role")

    async with state.pg_pool.acquire() as conn:
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
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Админ: изменить full_name и/или email пользователя в организации.

    PATCH JSON. Проверка уникальности email. Контекст org через X-Organization-Id / X-Space-Id.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="invalid_json")

    full_name = body.get("full_name")
    email_raw = body.get("email")
    if full_name is None and email_raw is None:
        raise HTTPException(status_code=400, detail="no_fields_to_update")

    org_id = await _resolve_org_id_for_member_request(request, _user_id)
    if await get_effective_role(_user_id, org_id) != "admin":
        raise HTTPException(status_code=403, detail="insufficient_role")

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
        "role": normalize_org_role(str(om["role"])),
        "last_login": u["last_login"].isoformat() if u["last_login"] else None,
    }


@router.get("/users/{target_user_id}/memberships")
async def list_user_memberships_for_admin(
    request: Request,
    target_user_id: str,
    _user_id: str = Depends(require_authenticated_user_id),
) -> list[dict[str, Any]]:
    """Список организаций и ролей для target-пользователя в зоне видимости текущего админа.

    Используется в UI администрирования для редактирования членств.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    await _resolve_org_id_for_member_request(request, _user_id)
    async with state.pg_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT om.organization_id, om.role, o.name AS organization_name
            FROM core_organizationmember om
            JOIN core_organization o ON o.id = om.organization_id
            WHERE om.user_id = $1::uuid
              AND om.organization_id IN (
                SELECT organization_id FROM core_organizationmember
                WHERE user_id = $2::uuid AND role = 'admin'
              )
            ORDER BY lower(o.name)
            """,
            target_user_id,
            _user_id,
        )
    return [
        {
            "organization_id": str(r["organization_id"]),
            "organization_name": r["organization_name"] or "",
            "role": normalize_org_role(str(r["role"])),
        }
        for r in rows
    ]


@router.post("/users/{target_user_id}/memberships")
async def add_or_update_user_membership(
    request: Request,
    target_user_id: str,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Добавить пользователя в организацию или обновить роль в ней.

    Тело: organization_id, role. Только admin целевой организации. Создаёт membership при отсутствии.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    target_org = (body.get("organization_id") or "").strip()
    role = (body.get("role") or "executor").strip().lower()
    if not target_org:
        raise HTTPException(status_code=400, detail="organization_id required")
    if role not in ALLOWED_ROLES:
        raise HTTPException(status_code=400, detail="invalid_role")

    actor_role = await get_effective_role(_user_id, target_org)
    if actor_role != "admin":
        raise HTTPException(status_code=403, detail="insufficient_role")

    now = datetime.now(timezone.utc)
    async with state.pg_pool.acquire() as conn:
        exists_user = await conn.fetchrow("SELECT id FROM core_user WHERE id = $1::uuid", target_user_id)
        if not exists_user:
            raise HTTPException(status_code=404, detail="user_not_found")
        exists_org = await conn.fetchrow("SELECT id FROM core_organization WHERE id = $1::uuid", target_org)
        if not exists_org:
            raise HTTPException(status_code=404, detail="organization_not_found")

        member = await conn.fetchrow(
            "SELECT id FROM core_organizationmember WHERE organization_id = $1::uuid AND user_id = $2::uuid",
            target_org,
            target_user_id,
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
                target_org,
                target_user_id,
                role,
                now,
            )

    return {"ok": True, "organization_id": target_org, "role": role}


@router.delete("/users/{target_user_id}")
async def delete_org_user(
    request: Request,
    target_user_id: str,
    _user_id: str = Depends(require_authenticated_user_id),
) -> dict[str, Any]:
    """Полностью удалить пользователя из БД (только admin).

    Цель должна быть участником org из контекста; нельзя удалить последнего admin и суперпользователя. Нельзя удалить себя.
    """
    if not state.pg_pool:
        raise HTTPException(status_code=503, detail="Database not available")
    org_id = await _resolve_org_id_for_member_request(request, _user_id)
    if await get_effective_role(_user_id, org_id) != "admin":
        raise HTTPException(status_code=403, detail="insufficient_role")
    if target_user_id == _user_id:
        raise HTTPException(status_code=400, detail="cannot_remove_self")

    async with state.pg_pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, role
            FROM core_organizationmember
            WHERE organization_id = $1::uuid AND user_id = $2::uuid
            """,
            org_id,
            target_user_id,
        )
        if not row:
            raise HTTPException(status_code=404, detail="member_not_found")
        if str(row["role"]) == "admin":
            cnt = await conn.fetchval(
                """
                SELECT COUNT(*)::int
                FROM core_organizationmember
                WHERE organization_id = $1::uuid AND role = 'admin'
                """,
                org_id,
            )
            if int(cnt or 0) <= 1:
                raise HTTPException(status_code=400, detail="last_admin")
        urow = await conn.fetchrow(
            "SELECT id, is_superuser FROM core_user WHERE id = $1::uuid",
            target_user_id,
        )
        if not urow:
            raise HTTPException(status_code=404, detail="user_not_found")
        if bool(urow.get("is_superuser")):
            raise HTTPException(status_code=403, detail="cannot_delete_superuser")
        await conn.execute("DELETE FROM core_user WHERE id = $1::uuid", target_user_id)
    return {"ok": True}
