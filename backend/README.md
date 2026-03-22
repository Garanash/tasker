# AGBTasker API (FastAPI)

Асинхронный FastAPI, PostgreSQL (asyncpg), JWT, WebSocket, опционально Celery + Redis.

## Запуск

```bash
# Локально (нужен PostgreSQL)
export DATABASE_URL=postgresql://kaiten:kaiten@localhost:5432/kaiten
export SECRET_KEY=your-secret-key
uvicorn fastapi_app.main:app --reload --port 8000
```

Через Docker:

```bash
docker-compose up -d db backend
```

## Схема БД

При первом запуске база должна содержать таблицы `core_*`. Варианты:

1. **Уже есть БД с таблицами `core_*`** — укажите `DATABASE_URL` на PostgreSQL.
2. **Новая БД** — примените схему из `schema/init.sql`:
   ```bash
   psql "$DATABASE_URL" -f schema/init.sql
   ```

## Переменные окружения

- `DATABASE_URL` — PostgreSQL (например `postgresql://user:pass@host:5432/dbname`).
- `SECRET_KEY` — секрет для JWT.
- `MEDIA_ROOT` — каталог для загружаемых файлов (по умолчанию `/tmp/kaiten_media`).
- `MEDIA_URL` — префикс URL для медиа (по умолчанию `/media/`).
- `CORS_ORIGINS` — (опционально, продакшен) список разрешённых origin через запятую, например `https://app.example.com`. Если не задано, разрешены только `localhost` / `127.0.0.1`.
- `REDIS_URL` — Redis для Pub/Sub событий WebSocket с воркеров (например `redis://redis:6379/0`).
- `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` — если заданы (часто совпадают с Redis), почта уходит через Celery; иначе SMTP в потоке (`asyncio.to_thread`).
- `USE_CELERY_BEAT=1` — отключить встроенный APScheduler и запускать deadline-автоматизации только через Celery Beat (как в `docker-compose.prod.yml`).

Зависимость **`python-multipart`** обязательна для `POST .../attachments` с загрузкой файла (`multipart/form-data`); она указана в `requirements.txt`.

Продакшен-сборка: см. корневой [README.md](../README.md) и `docker-compose.prod.yml`.

Образ backend: [Dockerfile](Dockerfile) + `docker-entrypoint.sh` — процесс под пользователем `app` (uid 1000), если файлы в `/app` читаемы им; при bind-mount dev с «чужим» uid остаётся root (только для локальной разработки).

## API

- `POST /api/auth/register` — регистрация (email, password, organization_name, full_name).
- `POST /api/auth/login` — вход (email, password).
- `POST /api/auth/refresh` — обновление токена (refresh).
- `GET /api/auth/me` — текущий пользователь (Authorization: Bearer).
- `GET /api/auth/spaces` — пространства пользователя.
- `GET /api/auth/groups` — группы.
- `GET /api/kanban/boards` — список досок.
- `POST /api/kanban/bootstrap` — создать демо-доску.
- `POST /api/kanban/spaces` — создать пространство (lead/admin).
- `PATCH /api/kanban/spaces/{id}` — переименовать (lead/admin).
- `DELETE /api/kanban/spaces/{id}` — удалить пространство и всё содержимое (lead/admin); нельзя удалить последнее пространство организации.
- `GET /api/kanban/boards/{id}/grid` — сетка доски.
- `GET /api/kanban/cards/{id}` — карточка.
- `POST /api/kanban/cards/{id}/move` — переместить карточку.
- `POST /api/kanban/cards/{id}/comments` — добавить комментарий.
- `POST /api/kanban/cards/{id}/attachments` — вложение (multipart или JSON с file_url).
- `WS /ws/boards/{board_id}/?token=...` — realtime по доске.

Остальные пути под `/api/*` без отдельного роутера возвращают 404 (catch-all в `main.py`).
