#!/usr/bin/env python3
"""
Полный сброс данных приложения (все core_* таблицы) и создание одного пользователя.

Использование (из корня репозитория с Docker):
  docker compose exec backend python scripts/reset_single_admin.py

Переменные окружения:
  DATABASE_URL     — обязательно (в контейнере уже задан)
  ADMIN_EMAIL      — по умолчанию admin@agbtasker.ru
  ADMIN_PASSWORD   — по умолчанию AdminTasker
  ADMIN_FULL_NAME  — по умолчанию «Администратор»
  ADMIN_ORG_NAME   — по умолчанию AGB Tasks

ВНИМАНИЕ: необратимо удаляет пользователей, доски, карточки и связанные данные.
"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone

import psycopg
from passlib.hash import pbkdf2_sha256

# Порядок не критичен: PostgreSQL сам уложит TRUNCATE с учётом FK.
_TABLES = [
    "core_notification",
    "core_groupmembership",
    "core_usergroup",
    "core_commentattachmentlink",
    "core_cardcomment",
    "core_cardcommentreadstate",
    "core_cardassignment",
    "core_automationexecution",
    "core_automationrule",
    "core_cardmovementevent",
    "core_wiplimit",
    "core_checklistitem",
    "core_checklist",
    "core_attachment",
    "core_cardfieldvalue",
    "core_cardfielddefinition",
    "core_card",
    "core_track",
    "core_column",
    "core_board",
    "core_project",
    "core_space",
    "core_organizationmember",
    "core_organization",
    "core_user",
]


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("Задайте DATABASE_URL", file=sys.stderr)
        sys.exit(1)

    email = (os.environ.get("ADMIN_EMAIL") or "admin@agbtasker.ru").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD") or "AdminTasker"
    full_name = (os.environ.get("ADMIN_FULL_NAME") or "Администратор").strip()
    org_name = (os.environ.get("ADMIN_ORG_NAME") or "AGB Tasks").strip()

    if len(password) < 8:
        print("Пароль не короче 8 символов", file=sys.stderr)
        sys.exit(1)

    hashed = pbkdf2_sha256.hash(password)
    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())
    member_id = str(uuid.uuid4())
    space_id = str(uuid.uuid4())

    truncate_sql = "TRUNCATE TABLE " + ", ".join(_TABLES) + " RESTART IDENTITY CASCADE"

    with psycopg.connect(url, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute(truncate_sql)
            cur.execute(
                """
                INSERT INTO core_user (
                    id, email, full_name, password, is_staff, is_active, is_superuser,
                    created_at, last_login, avatar_url, login_otp_hash, login_otp_expires_at
                )
                VALUES (
                    %s::uuid, %s, %s, %s, true, true, true, %s, NULL, '', NULL, NULL
                )
                """,
                (user_id, email, full_name, hashed, now),
            )
            cur.execute(
                "INSERT INTO core_organization (id, name, created_at) VALUES (%s::uuid, %s, %s)",
                (org_id, org_name, now),
            )
            cur.execute(
                """
                INSERT INTO core_organizationmember (id, organization_id, user_id, role, created_at)
                VALUES (%s::uuid, %s::uuid, %s::uuid, 'admin', %s)
                """,
                (member_id, org_id, user_id, now),
            )
            cur.execute(
                """
                INSERT INTO core_space (id, organization_id, name, created_at)
                VALUES (%s::uuid, %s::uuid, %s, %s)
                """,
                (space_id, org_id, "Основное пространство", now),
            )
        conn.commit()

    print("Готово.")
    print(f"  email:    {email}")
    print(f"  user_id:  {user_id}")
    print(f"  org_id:   {org_id}")
    print(f"  space_id: {space_id}")
    print("  роль в организации: admin, is_superuser: true")


if __name__ == "__main__":
    main()
