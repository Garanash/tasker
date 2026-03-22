"""Общее состояние приложения: pool, manager, config. Устанавливается в main при startup."""
from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import asyncpg

DATABASE_URL = os.environ.get("DATABASE_URL")
REDIS_URL = os.environ.get("REDIS_URL", "").strip() or None
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")

pg_pool: "asyncpg.Pool | None" = None
manager: Any = None  # WsBoardConnectionManager, set in main
dm_manager: Any = None  # WsDmConnectionManager, set in main
