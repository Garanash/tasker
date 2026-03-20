import type { FullConfig } from "@playwright/test";

/**
 * Перед тестами: если бэкенд доступен — регистрируем e2e-пользователя (игнорируем «уже существует»).
 */
export default async function globalSetup(_config: FullConfig) {
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  try {
    const health = await fetch(`${api}/health/live`, { signal: AbortSignal.timeout(5000) });
    if (!health.ok) {
      console.warn(`[e2e] ${api}/health/live не OK — поднимите: docker compose up -d db backend`);
      return;
    }
  } catch {
    console.warn(`[e2e] Бэкенд недоступен (${api}) — для API-тестов: docker compose up -d db backend`);
    return;
  }

  try {
    const res = await fetch(`${api}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "e2e@test.com",
        password: "password123",
        organization_name: "E2E Org",
        full_name: "E2E User",
      }),
    });
    if (!res.ok && res.status !== 400) {
      const t = await res.text();
      console.warn("[e2e] register:", res.status, t.slice(0, 200));
    }
  } catch (e) {
    console.warn("[e2e] register failed:", e);
  }
}
