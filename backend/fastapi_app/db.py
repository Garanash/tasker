from __future__ import annotations

from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from . import state

DATABASE_URL = state.DATABASE_URL


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """
    Синхронный engine используется только для быстрой автозагрузки таблиц (reflection).
    Для реальной async-работы endpoints'ов на следующем шаге добавим async engine.
    """
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is required for FastAPI SQLAlchemy reflection")

    # sqlalchemy по умолчанию использует совместимый драйвер из sqlalchemy/DIALECT.
    # В контейнере доступен psycopg (Alembic / SQLAlchemy).
    url = DATABASE_URL
    # Compose/хостинг: `postgres://` или `postgresql://` без драйвера → используем psycopg3 (пакет psycopg), не psycopg2.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://") and "+psycopg" not in url.split("://", 1)[0]:
        url = "postgresql+psycopg://" + url.split("://", 1)[1]

    return create_engine(url, pool_pre_ping=True, future=True)

