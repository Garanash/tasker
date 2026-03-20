#!/usr/bin/env bash
# Полный прогон e2e: PostgreSQL + FastAPI + Playwright (из корня репозитория).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Запуск db + backend (Docker)..."
docker compose up -d db backend

echo "==> Ожидание API..."
for i in $(seq 1 40); do
  if curl -sf "http://localhost:8000/health/live" >/dev/null; then
    echo "==> Backend готов."
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "Таймаут ожидания http://localhost:8000/health/live" >&2
    exit 1
  fi
  sleep 1
done

cd "$ROOT/frontend"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:8000}"
echo "==> Playwright (NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL)..."
npx playwright test "$@"
