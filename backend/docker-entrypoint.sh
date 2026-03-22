#!/bin/sh
set -e
if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi
mkdir -p /app/media
chown -R app:app /app/media 2>/dev/null || true
# Bind-mount dev: файлы на хосте могут быть не uid 1000 — тогда остаёмся root.
if gosu app test -r /app/fastapi_app/main.py 2>/dev/null; then
  exec gosu app "$@"
fi
exec "$@"
