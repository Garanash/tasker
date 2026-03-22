"""
Celery: брокер Redis, задачи в fastapi_app.tasks.
"""
from __future__ import annotations

import os

from celery import Celery


def _broker_url() -> str:
    return (os.environ.get("CELERY_BROKER_URL") or os.environ.get("REDIS_URL") or "redis://127.0.0.1:6379/0").strip()


def _result_backend() -> str:
    return (os.environ.get("CELERY_RESULT_BACKEND") or _broker_url()).strip()


app = Celery(
    "kaiten",
    broker=_broker_url(),
    backend=_result_backend(),
    include=["fastapi_app.tasks"],
)

app.conf.update(
    timezone="UTC",
    task_default_queue="default",
    beat_schedule={
        "deadline-automations-minute": {
            "task": "fastapi_app.tasks.run_deadline_automations_task",
            "schedule": 60.0,
        },
    },
)
