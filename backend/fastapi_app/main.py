"""
Kaiten Clone API — только FastAPI, без Django.
"""
from __future__ import annotations

import json
import os
from typing import Any

import asyncpg
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request, Response as FastAPIResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from starlette import status

from . import state
from .auth import router as auth_router
from .deps import _decode_jwt_user_id, _get_bearer_token
from .docs import router as docs_router
from .kanban import router as kanban_router
from .notifications import ensure_notifications_table, router as notifications_router

app = FastAPI(title="Kaiten Clone API")

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
_scheduler: AsyncIOScheduler | None = None


async def _run_deadline_automations_job() -> None:
    from .deadline_automations import run_deadline_automations
    if state.pg_pool and state.manager:
        try:
            await run_deadline_automations(state.pg_pool, state.manager)
        except Exception:
            pass


@app.on_event("startup")
async def _startup() -> None:
    global _scheduler
    if state.DATABASE_URL:
        state.pg_pool = await asyncpg.create_pool(
            state.DATABASE_URL.replace("postgres://", "postgresql://", 1),
            min_size=1,
            max_size=4,
        )
        await ensure_notifications_table()
    state.manager = manager
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_run_deadline_automations_job, "interval", minutes=1, id="deadline_automations")
    _scheduler.start()


@app.on_event("shutdown")
async def _shutdown() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
    if state.pg_pool:
        await state.pg_pool.close()
    state.pg_pool = None
    state.manager = None


app.include_router(auth_router)
app.include_router(kanban_router)
app.include_router(docs_router)
app.include_router(notifications_router)


@app.get("/health/live")
async def health_live() -> dict[str, Any]:
    return {"ok": True, "status": "live"}


@app.get("/health/ready")
async def health_ready() -> FastAPIResponse:
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
    return {"ok": True}


from fastapi import WebSocket, WebSocketDisconnect


@app.websocket("/ws/boards/{board_id}/")
async def board_ws(websocket: WebSocket, board_id: str) -> None:
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


# Остальные /api/* — заглушки (без Django).
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
