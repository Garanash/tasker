#!/bin/sh
# pg_dump 2 раза в сутки в /backups, ротация старше 14 дней. .pgpass — cron не тянет env в job.
set -eu
apk add --no-cache --quiet postgresql-client

# Пустая строка из .env ломала :? и обрывала контейнер с кодом 1.
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-kaiten}"
U="${POSTGRES_USER:-kaiten}"
printf '*:*:*:%s:%s\n' "$U" "$POSTGRES_PASSWORD" >/root/.pgpass
chmod 600 /root/.pgpass

cat >/usr/local/bin/pg-backup.sh <<'EOS'
#!/bin/sh
set -eu
export PGHOST="${POSTGRES_HOST:-db}"
export PGPORT="${POSTGRES_PORT:-5432}"
export PGDATABASE="${POSTGRES_DB:-kaiten}"
export PGUSER="${POSTGRES_USER:-kaiten}"
mkdir -p /backups
fn="/backups/dump_$(date +%Y-%m-%d_%H%M%S).sql.gz"
pg_dump | gzip >"$fn"
find /backups -maxdepth 1 -name 'dump_*.sql.gz' -mtime +14 -delete
EOS
chmod +x /usr/local/bin/pg-backup.sh

mkdir -p /etc/crontabs
# 03:00 и 15:00 UTC (настройте под часовой пояс сервера при необходимости)
printf '%s\n' "0 3,15 * * * /usr/local/bin/pg-backup.sh" >/etc/crontabs/root

# Пакет dcron + «crond -l 2» давал exit 1 и Restarting в Compose. Оставляем только busybox crond из базового Alpine.
exec busybox crond -f
