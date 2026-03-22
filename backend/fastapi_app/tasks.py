"""
Задачи Celery (синхронные; БД через asyncpg в asyncio.run).
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from .celery_app import app

logger = logging.getLogger(__name__)


@app.task(name="fastapi_app.tasks.send_html_mail_task")
def send_html_mail_task(to_addr: str, subject: str, html_body: str, text_body: str) -> dict[str, Any]:
    from .mailout import _send_smtp_sync, is_smtp_configured

    if not is_smtp_configured():
        return {"ok": False, "err": "mail_not_configured"}
    try:
        _send_smtp_sync(to_addr, subject, html_body, text_body)
        return {"ok": True, "err": None}
    except Exception as e:
        logger.exception("send_html_mail_task failed")
        return {"ok": False, "err": str(e)}


@app.task(name="fastapi_app.tasks.run_deadline_automations_task")
def run_deadline_automations_task() -> None:
    import asyncpg

    from .deadline_automations import run_deadline_automations

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        logger.warning("run_deadline_automations_task: DATABASE_URL not set")
        return
    db_url = db_url.replace("postgres://", "postgresql://", 1)
    redis_url = (os.environ.get("REDIS_URL") or "").strip() or None

    async def _run() -> None:
        pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
        try:
            await run_deadline_automations(pool, manager=None, redis_url=redis_url)
        finally:
            await pool.close()

    asyncio.run(_run())
