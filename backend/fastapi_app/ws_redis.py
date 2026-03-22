"""
Fan-out событий WebSocket через Redis Pub/Sub (воркеры Celery → процесс API).
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

WS_FANOUT_CHANNEL = "kaiten:ws:fanout"


def publish_board_ws_sync(redis_url: str, board_id: str, envelope: dict[str, Any]) -> None:
    """Синхронная публикация; вызывается из Celery-воркера."""
    import redis

    payload = json.dumps({"board_id": board_id, "envelope": envelope}, default=str)
    client = redis.from_url(redis_url)
    try:
        client.publish(WS_FANOUT_CHANNEL, payload)
    finally:
        client.close()
