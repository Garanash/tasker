#!/usr/bin/env bash
# Деплой на удалённый сервер: rsync кода + docker compose -f docker-compose.prod.yml up -d --build
#
# На сервере: Linux с root по SSH. Docker при отсутствии — get.docker.com (DEPLOY_INSTALL_DOCKER=0 отключает).
# Образы приложения тянутся с AWS Public ECR (library), логин в registry не нужен.
#
# Локально: sshpass (пароль SSH в интерактиве не в argv):
#   Debian/Ubuntu: apt install sshpass
#   macOS: brew install hudochenkov/sshpass/sshpass
#
# Использование (из корня репозитория):
#   ./scripts/deploy-remote.sh user@host
#   DEPLOY_PATH=/opt/agbtasker ./scripts/deploy-remote.sh root@194.87.226.99
#
# Вместо ввода пароля (менее безопасно — видно в env процесса):
#   SSH_PASSWORD='...' ./scripts/deploy-remote.sh user@host
#
# Рекомендуется позже перейти на SSH-ключи и убрать sshpass.
#
# DEPLOY_INSTALL_DOCKER=0 — не ставить Docker автоматически (только сообщение об ошибке).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TARGET="${1:-${DEPLOY_TARGET:-}}"
if [[ -z "$TARGET" ]]; then
  echo "Укажите user@host, например: ./scripts/deploy-remote.sh root@example.com" >&2
  exit 1
fi

REMOTE_PATH="${DEPLOY_PATH:-/opt/kaiten_copy}"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30"
RSYNC_SSH="sshpass -e ssh ${SSH_OPTS}"
RSYNC_FLAGS=(-avz)
if [[ "${DEPLOY_RSYNC_DELETE:-1}" == "1" ]]; then
  RSYNC_FLAGS+=(--delete)
fi

if ! command -v sshpass &>/dev/null; then
  echo "Не найден sshpass. Установите:" >&2
  echo "  Debian/Ubuntu: sudo apt-get install -y sshpass" >&2
  echo "  macOS:         brew install hudochenkov/sshpass/sshpass" >&2
  exit 1
fi

if [[ -z "${SSH_PASSWORD:-}" ]]; then
  read -r -s -p "SSH password для ${TARGET}: " SSH_PASSWORD
  echo "" >&2
fi

if [[ -z "$SSH_PASSWORD" ]]; then
  echo "Пароль пустой — выход." >&2
  exit 1
fi

export SSHPASS="$SSH_PASSWORD"
unset SSH_PASSWORD

echo "==> Синхронизация ${ROOT} -> ${TARGET}:${REMOTE_PATH}" >&2
sshpass -e ssh ${SSH_OPTS} "${TARGET}" "mkdir -p '${REMOTE_PATH}'"

# Не оборачивать rsync во внешний sshpass: он «кормит» пароль не ssh, из-за чего
# у вложенного `sshpass -e ssh` в -e пропадает SSHPASS. Достаточно export SSHPASS выше.
rsync "${RSYNC_FLAGS[@]}" \
  -e "$RSYNC_SSH" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=frontend/node_modules \
  --exclude=.next \
  --exclude=backend/.venv \
  --exclude=__pycache__ \
  --exclude='*.pyc' \
  --exclude=.env \
  --exclude=.env.local \
  --exclude='**/.env.*' \
  --exclude=backend/media \
  --exclude=frontend/test-results \
  --exclude=.DS_Store \
  ./ "${TARGET}:${REMOTE_PATH}/"

echo "==> Сборка и запуск Docker на сервере..." >&2
# Heredoc в одинарных кавычках — команды вроде \$(openssl) выполняются на сервере, не локально.
sshpass -e ssh ${SSH_OPTS} "${TARGET}" \
  env REMOTE_PATH="${REMOTE_PATH}" "DEPLOY_INSTALL_DOCKER=${DEPLOY_INSTALL_DOCKER:-1}" \
  "DEPLOY_BUILD_RETRIES=${DEPLOY_BUILD_RETRIES:-3}" "DEPLOY_BUILD_RETRY_SLEEP=${DEPLOY_BUILD_RETRY_SLEEP:-30}" \
  bash -s <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$REMOTE_PATH"
if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    echo "==> Создан .env из .env.example на сервере"
  else
    echo "Нет .env и нет .env.example в $REMOTE_PATH" >&2
    exit 1
  fi
fi
# Плейсхолдеры из .env.example → случайные значения (первый деплой)
if grep -qF 'SECRET_KEY=замените' .env 2>/dev/null; then
  sed -i '/^SECRET_KEY=/d' .env
  printf 'SECRET_KEY=%s\n' "$(openssl rand -hex 32)" >> .env
  echo "==> Сгенерирован SECRET_KEY"
fi
if grep -qF 'POSTGRES_PASSWORD=надёжный' .env 2>/dev/null; then
  sed -i '/^POSTGRES_PASSWORD=/d' .env
  printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >> .env
  echo "==> Сгенерирован POSTGRES_PASSWORD"
fi
if ! command -v docker &>/dev/null; then
  if [[ "${DEPLOY_INSTALL_DOCKER:-1}" != "1" ]]; then
    echo "Docker не установлен. На сервере выполните: curl -fsSL https://get.docker.com | sh" >&2
    exit 1
  fi
  if ! command -v curl &>/dev/null; then
    echo "Нет docker и нет curl. Установите: apt-get update && apt-get install -y curl && curl -fsSL https://get.docker.com | sh" >&2
    exit 1
  fi
  echo "==> Docker не найден — установка через https://get.docker.com (нужен root)..."
  curl -fsSL https://get.docker.com | sh
fi
if ! docker compose version &>/dev/null; then
  echo "Команда «docker compose» недоступна. Перезапустите сессию или установите плагин compose (get.docker.com ставит его на Ubuntu/Debian)." >&2
  exit 1
fi

export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-2}"

compose_build_retry() {
  local max="${DEPLOY_BUILD_RETRIES:-3}"
  local pause="${DEPLOY_BUILD_RETRY_SLEEP:-30}"
  local i=1
  while [[ "$i" -le "$max" ]]; do
    if docker compose -f docker-compose.prod.yml --env-file .env build; then
      return 0
    fi
    if [[ "$i" -ge "$max" ]]; then
      echo "==> Сборка не удалась после $max попыток." >&2
      return 1
    fi
    echo "==> Пауза ${pause}s, повтор сборки ($((i + 1))/$max)..." >&2
    sleep "$pause"
    i=$((i + 1))
  done
}

compose_build_retry
docker compose -f docker-compose.prod.yml --env-file .env up -d --remove-orphans
docker compose -f docker-compose.prod.yml ps
REMOTE_SCRIPT

echo "==> Готово. Проверка health (порт из HTTP_PORT в .env на сервере, по умолчанию 8080; TLS только если настроен снаружи):" >&2
echo '    curl -sf "http://127.0.0.1:${HTTP_PORT:-8080}/health/ready"   # на самом сервере' >&2
echo '    curl -sf "http://ВАШ_IP:${HTTP_PORT:-8080}/health/ready"       # с вашей машины' >&2

unset SSHPASS 2>/dev/null || true
