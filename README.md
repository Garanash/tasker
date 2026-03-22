# AGBTasker

Монорепозиторий: **Next.js** (фронт) + **асинхронный FastAPI** (API) + **PostgreSQL**. Фоновые задачи — **Celery** с брокером **Redis**; в проде **nginx** как единая точка входа; ежедневные **бэкапы PostgreSQL** с хранением **14 дней**.

## Локальная разработка

```bash
cp .env.example .env
docker compose up -d db redis backend
```

API: `http://localhost:8000`. Redis (опционально): `localhost:6379`.

Фронт отдельно:

```bash
cd frontend && npm install && npm run dev
```

Переменная `NEXT_PUBLIC_API_URL=http://localhost:8000` (см. `frontend/.env.example`).

## Продакшен (Docker)

```bash
cp .env.example .env
# Заполните SECRET_KEY и POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

Откройте `http://localhost:${HTTP_PORT:-8080}` — nginx отдаёт Next.js и проксирует `/api/`, `/ws/`, `/media/`, `/health/` на FastAPI.

Проверка после подъёма:

```bash
curl -sf "http://localhost:${HTTP_PORT:-8080}/health/ready"
```

HTTPS: ориентир по настройке сертификатов — [deploy/nginx/snippets/ssl.conf.example](deploy/nginx/snippets/ssl.conf.example).

Сервисы:

| Сервис        | Назначение                                      |
|---------------|-------------------------------------------------|
| `db`          | PostgreSQL 16                                   |
| `redis`       | Celery + Pub/Sub для WS-событий с воркера       |
| `backend`     | Uvicorn, `USE_CELERY_BEAT=1`, APScheduler выкл. |
| `celery_worker` | SMTP (через очередь), deadline-автоматизации |
| `celery_beat` | Расписание (deadline каждую минуту)             |
| `frontend`    | Next.js standalone                              |
| `nginx`       | Reverse proxy                                   |
| `db_backup`   | `pg_dump` **2× в сутки** (03:00 и 15:00 UTC), хранение **14 дней** |

Дампы лежат в volume `kaiten_pg_backups`. Пример восстановления:

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U kaiten -d kaiten < backup.sql
```

(уточните пользователя/БД из `.env`.)

Перенос данных БД с локальной машины на сервер: [docs/DATABASE_MIGRATION.md](docs/DATABASE_MIGRATION.md).

## Деплой на удалённый сервер одной командой

Скрипт [`scripts/deploy-remote.sh`](scripts/deploy-remote.sh) копирует проект через **rsync** и на сервере выполняет `docker compose -f docker-compose.prod.yml build` и `up -d`.

**На сервере:** доступ по SSH под **root** (или пользователь с `sudo` — тогда скрипт нужно доработать). Если Docker ещё нет, деплой **сам** запускает официальный установщик `https://get.docker.com` (отключить: `DEPLOY_INSTALL_DOCKER=0`). Файл `.env` **не обязателен до первого деплоя**: скрипт при отсутствии `.env` скопирует `.env.example` → `.env` и подставит случайные `SECRET_KEY` и `POSTGRES_PASSWORD`, если в файле ещё стоят плейсхолдеры из примера. Почту (SMTP) при необходимости отредактируйте в `.env` на сервере после деплоя.

**У вас на машине:** установите `sshpass` (пароль спрашивается один раз и не передаётся аргументом в `ssh`):

- Debian/Ubuntu: `sudo apt-get install -y sshpass`
- macOS: `brew install hudochenkov/sshpass/sshpass`

Запуск из **корня репозитория**:

```bash
chmod +x scripts/deploy-remote.sh
./scripts/deploy-remote.sh root@ВАШ_IP_или_домен
```

Другой путь на сервере (по умолчанию `/opt/kaiten_copy`):

```bash
DEPLOY_PATH=/opt/agbtasker ./scripts/deploy-remote.sh root@example.com
```

Файл `.env` **не копируется** с вашего ПК (он в `.gitignore`); на сервере он создаётся автоматически из `.env.example`, если отсутствует.

Пароль из переменной окружения (удобно для CI, но менее безопасно): `SSH_PASSWORD='...' ./scripts/deploy-remote.sh user@host`.

Рекомендация: после первого деплоя настройте **SSH-ключ** и отключите вход по паролю на сервере.

**Базовые образы** в `Dockerfile` и `docker-compose*.yml` указаны как [AWS Public ECR (каталог Docker Official Images)](https://gallery.ecr.aws/docker/library/) — `public.ecr.aws/docker/library/...`. Для `docker pull` этих образов **логин не нужен**. При сетевых сбоях сборка повторяется до 3 раз с паузой 30 с (`DEPLOY_BUILD_RETRIES`, `DEPLOY_BUILD_RETRY_SLEEP`).

**Проверка снаружи:** в проде nginx слушает **внутри** контейнера порт 80, наружу он проброшен как **`HTTP_PORT` из `.env` (по умолчанию 8080)**. То есть запрос идёт на `http://СЕРВЕР:8080/...`, а не на `:443`, пока вы сами не повесите TLS (см. `deploy/nginx/snippets/ssl.conf.example` или внешний балансировщик). Шаблон из коробки **HTTPS на 443 не поднимает**.

Эндпоинты: **`/health/live`** — процесс API поднят; **`/health/ready`** — ещё и отвечает PostgreSQL (пока БД недоступна, будет **503**, и `curl -f` завершится с ошибкой — это ожидаемо). Если nginx отдаёт **502** на `/api/` и `/health/`, а главная страница открывается — до backend не достучались (логи: `docker compose -f docker-compose.prod.yml logs backend`). После деплоя перезапустите стек с обновлённым `default.conf`, чтобы nginx не залипал на старом IP контейнера `backend`.

## Версионирование образов

Через Compose (переменные `IMAGE_TAG`, `BACKEND_IMAGE_NAME`, `FRONTEND_IMAGE_NAME` в `.env`):

```bash
export IMAGE_TAG=$(git describe --tags --always)
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Или вручную:

```bash
export TAG=$(git describe --tags --always)
docker build -t kaiten-backend:$TAG backend
docker build -t kaiten-frontend:$TAG frontend
```

## Стек

- Только **PostgreSQL** как СУБД.
- Legacy-код на Django из репозитория удалён; API — **только FastAPI**.

Подробнее по API: [backend/README.md](backend/README.md).
