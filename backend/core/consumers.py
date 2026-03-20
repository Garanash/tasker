import json

from channels.generic.websocket import AsyncWebsocketConsumer


class BoardConsumer(AsyncWebsocketConsumer):
    """
    Минимальный consumer для realtime-обновлений доски.
    Логику вещания/событий добавим в модуле Kanban.
    """

    async def connect(self):
        self.board_id = self.scope["url_route"]["kwargs"]["board_id"]
        self.group_name = f"board_{self.board_id}"

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.group_name, self.channel_name)
        return

    async def receive(self, text_data=None, bytes_data=None):
        # Протокол для фронтенда на MVP минимальный.
        if not text_data:
            return
        try:
            payload = json.loads(text_data)
        except json.JSONDecodeError:
            await self.send(text_data=json.dumps({"type": "error", "message": "invalid_json"}))
            return

        if payload.get("type") == "ping":
            await self.send(text_data=json.dumps({"type": "pong"}))
            return

        # Иначе игнорируем (карта меняется через REST, а сюда шлём только события).

    async def card_moved(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "card_moved",
                    "payload": event.get("payload", {}),
                }
            )
        )

