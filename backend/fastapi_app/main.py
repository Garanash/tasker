"""
AGBTasker — REST и WebSocket API (FastAPI).
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from collections.abc import Awaitable, Callable
from typing import Any

import asyncpg
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request, Response as FastAPIResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.staticfiles import StaticFiles
from jose import JWTError, jwt
from starlette import status
from starlette.responses import Response

from . import state
from .auth import router as auth_router
from .deps import _decode_jwt_user_id, _get_bearer_token
from .docs import router as docs_router
from .kanban import router as kanban_router
from .notifications import ensure_notifications_table, router as notifications_router
from .direct_messages import ensure_direct_messages_table, router as direct_messages_router

logger = logging.getLogger(__name__)
app = FastAPI(
    title="AGBTasker",
    version="0.1.0",
    description=(
        "Публичное HTTP и WebSocket API приложения AGBTasker: авторизация, канбан, документы, "
        "уведомления и личные сообщения. Для вызовов с браузера используйте заголовок "
        "`Authorization: Bearer <access_token>` после входа."
    ),
    openapi_tags=[
        {
            "name": "auth",
            "description": (
                "Регистрация, вход по паролю и по коду из письма, обновление токенов, профиль, организации, "
                "списки пользователей и админ-операции. Большинство методов требуют `Authorization: Bearer` и при необходимости "
                "`X-Organization-Id` или `X-Space-Id`."
            ),
        },
        {
            "name": "kanban",
            "description": "Доски, колонки, дорожки, карточки, чеклисты, комментарии и вложения AGBTasker.",
        },
        {
            "name": "docs",
            "description": "Документы пространства (база знаний и обычные документы), привязка к карточкам.",
        },
        {
            "name": "notifications",
            "description": "In-app уведомления пользователя (события по карточкам и орг.).",
        },
        {
            "name": "messages",
            "description": "Личные сообщения между участниками одной организации (REST; доставка также через WebSocket).",
        },
    ],
)

# Секунды на установление TCP-сессии к PostgreSQL при create_pool (иначе зависание → Docker healthcheck «unhealthy»).
_DB_CONNECT_TIMEOUT_S = 120


LOCAL_FRONTEND_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# Прод: CORS_ORIGINS="https://app.example.com" (через запятую для нескольких).
_cors_env = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_env:
    _allow_origins = [o.strip() for o in _cors_env.split(",") if o.strip()]
    _allow_origin_regex: str | None = None
else:
    _allow_origins = LOCAL_FRONTEND_ORIGINS
    _allow_origin_regex = r"https?://(localhost|127\.0\.0\.1)(:\d+)?"


@app.middleware("http")
async def _guard_api_until_db(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Пока пул БД не поднят, Uvicorn уже слушает порт — без этого API отдаёт 500 вместо 503."""
    if request.method == "OPTIONS":
        return await call_next(request)
    path = request.url.path
    if (
        path.startswith("/health/")
        or path.startswith("/docs")
        or path.startswith("/redoc")
        or path.startswith("/openapi")
        or path.startswith("/ws/")
        or path.startswith("/media/")
    ):
        return await call_next(request)
    if state.DATABASE_URL and state.pg_pool is None:
        return JSONResponse({"detail": "service starting"}, status_code=503)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_origin_regex=_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    allow_headers=["*"],
)


class WsBoardConnectionManager:
    def __init__(self) -> None:
        self._by_board: dict[str, set[Any]] = {}

    async def connect(self, board_id: str, websocket: Any) -> None:
        await websocket.accept()
        self._by_board.setdefault(board_id, set()).add(websocket)

    def disconnect(self, board_id: str, websocket: Any) -> None:
        conns = self._by_board.get(board_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            self._by_board.pop(board_id, None)

    async def broadcast(self, board_id: str, payload: dict[str, Any]) -> None:
        conns = self._by_board.get(board_id) or set()
        for ws in list(conns):
            try:
                await ws.send_json(payload)
            except Exception:
                continue


manager = WsBoardConnectionManager()


class WsDmConnectionManager:
    """WebSocket-подключения по user_id для личных сообщений."""

    def __init__(self) -> None:
        self._by_user: dict[str, set[Any]] = {}

    async def connect(self, user_id: str, websocket: Any) -> None:
        await websocket.accept()
        self._by_user.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: str, websocket: Any) -> None:
        conns = self._by_user.get(user_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            self._by_user.pop(user_id, None)

    async def send_to_users(self, user_ids: list[str], payload: dict[str, Any]) -> None:
        for uid in user_ids:
            for ws in list(self._by_user.get(uid, set())):
                try:
                    await ws.send_json(payload)
                except Exception:
                    continue


dm_manager = WsDmConnectionManager()
_scheduler: AsyncIOScheduler | None = None
_ws_fanout_task: asyncio.Task[None] | None = None


def _use_celery_beat() -> bool:
    return os.environ.get("USE_CELERY_BEAT", "").lower() in ("1", "true", "yes")


async def _run_deadline_automations_job() -> None:
    from .deadline_automations import run_deadline_automations
    if state.pg_pool and state.manager:
        try:
            await run_deadline_automations(state.pg_pool, state.manager)
        except Exception:
            logger.exception("deadline automations job failed")


async def _ws_fanout_listener(redis_url: str) -> None:
    import redis.asyncio as aioredis

    from .ws_redis import WS_FANOUT_CHANNEL

    r = aioredis.from_url(redis_url)
    pubsub = r.pubsub()
    try:
        await pubsub.subscribe(WS_FANOUT_CHANNEL)
        async for raw in pubsub.listen():
            if raw["type"] != "message":
                continue
            try:
                body = json.loads(raw["data"])
                bid = body["board_id"]
                env = body["envelope"]
                if state.manager:
                    await state.manager.broadcast(bid, env)
            except Exception:
                logger.exception("ws fanout: bad message or broadcast failed")
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("ws fanout listener stopped")
    finally:
        try:
            await pubsub.unsubscribe(WS_FANOUT_CHANNEL)
            await pubsub.close()
        except Exception:
            pass
        await r.aclose()


async def _bootstrap_database() -> None:
    if not state.DATABASE_URL:
        return
    try:
        state.pg_pool = await asyncpg.create_pool(
            state.DATABASE_URL.replace("postgres://", "postgresql://", 1),
            min_size=1,
            max_size=4,
            timeout=_DB_CONNECT_TIMEOUT_S,
        )
        await ensure_notifications_table()
        await ensure_direct_messages_table()
    except Exception:
        logger.exception("database bootstrap failed")


@app.on_event("startup")
async def _startup() -> None:
    global _scheduler, _ws_fanout_task
    if state.DATABASE_URL:
        asyncio.create_task(_bootstrap_database())
    state.manager = manager
    state.dm_manager = dm_manager
    if not _use_celery_beat():
        _scheduler = AsyncIOScheduler()
        _scheduler.add_job(_run_deadline_automations_job, "interval", minutes=1, id="deadline_automations")
        _scheduler.start()
    if state.REDIS_URL:
        _ws_fanout_task = asyncio.create_task(_ws_fanout_listener(state.REDIS_URL))


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _scheduler, _ws_fanout_task
    if _ws_fanout_task:
        _ws_fanout_task.cancel()
        try:
            await _ws_fanout_task
        except asyncio.CancelledError:
            pass
        _ws_fanout_task = None
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
    if state.pg_pool:
        await state.pg_pool.close()
    state.pg_pool = None
    state.manager = None
    state.dm_manager = None


app.include_router(auth_router)
app.include_router(kanban_router)
app.include_router(docs_router)
app.include_router(notifications_router)
app.include_router(direct_messages_router)

# Раздача загруженных файлов (аватары, вложения): /media/...
_media_root = os.environ.get("MEDIA_ROOT", "/tmp/kaiten_media")
Path(_media_root).mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=_media_root), name="media")


@app.get("/health/live")
async def health_live() -> dict[str, Any]:
    """Liveness: процесс жив. Используется оркестраторами (Kubernetes, Docker) без проверки БД."""
    return {"ok": True, "status": "live"}


@app.get("/health/ready")
async def health_ready() -> FastAPIResponse:
    """Readiness: пул PostgreSQL подключён и отвечает. При неготовности возвращает HTTP 503."""
    if not state.pg_pool:
        return FastAPIResponse(content='{"ok": false, "status":"not_ready"}', status_code=503)
    try:
        async with state.pg_pool.acquire() as conn:
            await conn.fetchrow("SELECT 1")
        return FastAPIResponse(content='{"ok": true, "status":"ready"}')
    except Exception:
        return FastAPIResponse(content='{"ok": false, "status":"not_ready"}', status_code=503)


@app.get("/api/auth/health")
async def auth_health() -> dict[str, Any]:
    """Простая проверка доступности слоя API (без проверки БД). Удобна для быстрых health-check."""
    return {"ok": True}


from fastapi import WebSocket, WebSocketDisconnect


@app.websocket("/ws/messages/")
async def messages_ws(websocket: WebSocket) -> None:
    """WebSocket личных сообщений.

    Подключение: `GET /ws/messages/?token=<JWT access>`. После accept сервер рассылает события
    direct_message пользователю. Клиент может слать ping-текст для удержания соединения.
    """
    token = websocket.query_params.get("token")
    user_id = _decode_jwt_user_id(token)
    if not user_id:
        await websocket.close(code=1008)
        return
    await dm_manager.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        dm_manager.disconnect(user_id, websocket)
    except Exception:
        dm_manager.disconnect(user_id, websocket)


@app.websocket("/ws/boards/{board_id}/")
async def board_ws(websocket: WebSocket, board_id: str) -> None:
    """WebSocket обновлений канбан-доски.

    Подключение: `GET /ws/boards/{board_id}/?token=<JWT access>`. События — изменения карточек и колонок
    для real-time синхронизации UI.
    """
    token = websocket.query_params.get("token")
    _ = _decode_jwt_user_id(token)
    await manager.connect(board_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(board_id, websocket)
    except Exception:
        manager.disconnect(board_id, websocket)


# Остальные /api/* — заглушки для непокрытых путей.
# Важно: без DELETE — иначе catch-all съедает DELETE /api/kanban/... раньше конкретных маршрутов роутеров.
@app.api_route(
    "/api/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "OPTIONS", "HEAD"],
    include_in_schema=False,
)
async def api_not_implemented(request: Request, path: str) -> JSONResponse:
    return JSONResponse(
        status_code=404,
        content={"detail": "Not found", "path": path},
    )
