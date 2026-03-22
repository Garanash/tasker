# Перенос PostgreSQL с локальной машины на сервер

Цель: после деплоя на сервере та же схема и данные, что у вас локально.

## 1. Снимок базы локально (Docker)

Из корня репозитория, пока поднят `db`:

```bash
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-kaiten}" -d "${POSTGRES_DB:-kaiten}" --no-owner --clean --if-exists | gzip > kaiten_dump.sql.gz
```

Или без compose, если БД на хосте — используйте свой `pg_dump` с теми же параметрами.

## 2. Копирование на сервер

```bash
scp kaiten_dump.sql.gz user@your-server:/tmp/
```

## 3. Восстановление на сервере

Остановите трафик к приложению (опционально), затем:

```bash
gunzip -c /tmp/kaiten_dump.sql.gz | docker compose -f docker-compose.prod.yml exec -T db \
  psql -U "${POSTGRES_USER:-kaiten}" -d "${POSTGRES_DB:-kaiten}"
```

Переменные `POSTGRES_*` должны совпадать с `.env` на сервере.

## 4. Резервные копии на проде

Сервис `db_backup` в `docker-compose.prod.yml` пишет дампы в volume `kaiten_pg_backups` **два раза в сутки** (cron в `deploy/backup/entrypoint.sh`), хранит файлы **14 дней**.

После миграции перезапустите приложение:

```bash
docker compose -f docker-compose.prod.yml up -d
```

## Важно

- Не коммитьте файлы `.sql` / `.sql.gz` с реальными данными в git.
- Перед восстановлением на проде сделайте бэкап текущей БД на сервере.
