from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken


User = get_user_model()


class JWTAuthMiddleware(BaseMiddleware):
    """
    WebSocket JWT-аутентификация через query string: ws://... ?token=<access>
    """

    async def process_token(self, token: str | None) -> Any:
        if not token:
            return None
        try:
            access = AccessToken(token)
            user_id = access.get("user_id")
            if not user_id:
                return None
            return await self.get_user(user_id)
        except Exception:
            return None

    @database_sync_to_async
    def get_user(self, user_id: str):
        return User.objects.filter(id=user_id).first()

    async def __call__(self, scope, receive, send):
        query_string = scope.get("query_string", b"")
        params = parse_qs(query_string.decode("utf-8"))
        token = params.get("token", [None])[0]

        scope["user"] = await self.process_token(token)
        if scope["user"] is None:
            # Для анонимного пользователя Django Channels ожидает AnonymousUser,
            # но для нашего раннего прототипа достаточно None/подмена.
            scope["user"] = type("AnonymousUser", (), {"is_authenticated": False})()
        return await super().__call__(scope, receive, send)

