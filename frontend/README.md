# Frontend (Next.js)

## E2E (Playwright)

Тесты с **реальным API** требуют запущенный бэкенд на `http://localhost:8000` и PostgreSQL со схемой `backend/schema/init.sql`.

### Вариант 1 — только фронт (бэкенд уже запущен)

```bash
export NEXT_PUBLIC_API_URL=http://localhost:8000
npm run test:e2e
```

### Вариант 2 — Docker (БД + API) и затем тесты

Из каталога `frontend`:

```bash
npm run test:e2e:docker
```

(скрипт `../scripts/e2e.sh`: `docker compose up -d db backend`, ожидание `/health/live`, затем `playwright test`.)

Перед прогоном `playwright.global-setup.ts` пытается зарегистрировать пользователя `e2e@test.com` / `password123` (если API доступен).
