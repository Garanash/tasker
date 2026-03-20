import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ACCESS_STORAGE_KEY = "kaiten_access";
const REFRESH_STORAGE_KEY = "kaiten_refresh";

async function authRequest(
  request: APIRequestContext,
  method: "GET" | "POST" | "PATCH",
  path: string,
  token: string,
  body?: Record<string, unknown>,
  spaceId?: string
) {
  return request.fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(spaceId ? { "X-Space-Id": spaceId } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    data: body,
  });
}

async function login(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API_BASE}/api/auth/login`, {
    headers: { "Content-Type": "application/json" },
    data: { email, password },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { access: string; refresh?: string };
}

async function bootstrapRoleFixture(request: APIRequestContext) {
  const seed = Date.now().toString(36);
  const ownerEmail = `owner-${seed}@e2e.test`;
  const leadEmail = `lead-${seed}@e2e.test`;
  const executorEmail = `exec-${seed}@e2e.test`;
  const password = "password123";

  const register = await request.post(`${API_BASE}/api/auth/register`, {
    headers: { "Content-Type": "application/json" },
    data: {
      email: ownerEmail,
      password,
      organization_name: `E2E Org ${seed}`,
      full_name: "E2E Owner",
    },
  });
  expect(register.ok()).toBeTruthy();
  const owner = (await register.json()) as { access: string };

  const spacesRes = await authRequest(request, "GET", "/api/auth/spaces", owner.access);
  expect(spacesRes.ok()).toBeTruthy();
  const spaces = (await spacesRes.json()) as Array<{ id: string; name: string }>;
  const activeSpaceId = spaces[0]?.id;
  expect(activeSpaceId).toBeTruthy();

  const createLead = await authRequest(
    request,
    "POST",
    "/api/auth/users",
    owner.access,
    {
      email: leadEmail,
      password,
      full_name: "E2E Lead",
      role: "user",
    },
    activeSpaceId
  );
  expect(createLead.ok()).toBeTruthy();
  const leadUser = (await createLead.json()) as { id: string };

  const createExecutor = await authRequest(
    request,
    "POST",
    "/api/auth/users",
    owner.access,
    {
      email: executorEmail,
      password,
      full_name: "E2E Executor",
      role: "user",
    },
    activeSpaceId
  );
  expect(createExecutor.ok()).toBeTruthy();
  const executorUser = (await createExecutor.json()) as { id: string };

  const setLeadRole = await authRequest(
    request,
    "PATCH",
    `/api/auth/users/${leadUser.id}/role`,
    owner.access,
    { role: "lead" },
    activeSpaceId
  );
  expect(setLeadRole.ok()).toBeTruthy();

  const setExecutorRole = await authRequest(
    request,
    "PATCH",
    `/api/auth/users/${executorUser.id}/role`,
    owner.access,
    { role: "executor" },
    activeSpaceId
  );
  expect(setExecutorRole.ok()).toBeTruthy();

  const leadTokens = await login(request, leadEmail, password);
  const executorTokens = await login(request, executorEmail, password);

  const boardRes = await authRequest(
    request,
    "POST",
    "/api/kanban/boards",
    leadTokens.access,
    { name: `Board ${seed}`, space_id: activeSpaceId },
    activeSpaceId
  );
  expect(boardRes.ok()).toBeTruthy();
  const board = (await boardRes.json()) as { id: string };

  const gridRes = await authRequest(
    request,
    "GET",
    `/api/kanban/boards/${board.id}/grid`,
    leadTokens.access,
    undefined,
    activeSpaceId
  );
  expect(gridRes.ok()).toBeTruthy();
  const grid = (await gridRes.json()) as { columns: Array<{ id: string; name: string }> };
  const backlog = grid.columns.find((col) => col.name === "Задачи");
  expect(backlog).toBeTruthy();

  const cardRes = await authRequest(
    request,
    "POST",
    "/api/kanban/cards",
    leadTokens.access,
    {
      title: "E2E Assigned Task",
      description: "Role workflow task",
      board_id: board.id,
      column_id: backlog!.id,
    },
    activeSpaceId
  );
  expect(cardRes.ok()).toBeTruthy();
  const card = (await cardRes.json()) as { id: string };

  const assignRes = await authRequest(
    request,
    "POST",
    `/api/kanban/cards/${card.id}/assignees`,
    leadTokens.access,
    { user_id: executorUser.id },
    activeSpaceId
  );
  expect(assignRes.ok()).toBeTruthy();

  const trackRes = await authRequest(
    request,
    "POST",
    `/api/kanban/boards/${board.id}/tracks`,
    leadTokens.access,
    { name: "E2E row" },
    activeSpaceId
  );
  expect(trackRes.ok()).toBeTruthy();

  return { activeSpaceId, boardId: board.id, leadTokens, executorTokens };
}

async function openAs(page: Page, access: string, refresh?: string) {
  await page.addInitScript(
    ({ accessToken, refreshToken }) => {
      localStorage.setItem(ACCESS_STORAGE_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_STORAGE_KEY, refreshToken);
    },
    { accessToken: access, refreshToken: refresh || "" }
  );
  await page.goto("http://localhost:3000/app");
}

test("Lead and executor role UI + tracks endpoint", async ({ request, page, browser }) => {
  const fixture = await bootstrapRoleFixture(request);

  await openAs(page, fixture.leadTokens.access, fixture.leadTokens.refresh);
  await page.waitForTimeout(1500);
  await expect(page.locator("#boardsWrapper")).toBeVisible();
  await expect(page.getByText("Задачи")).toBeVisible();
  await expect(page.getByText("Добавить дорожку")).toBeVisible();

  const executorContext = await browser.newContext();
  const executorPage = await executorContext.newPage();
  await openAs(executorPage, fixture.executorTokens.access, fixture.executorTokens.refresh);
  await executorPage.waitForTimeout(1500);
  await expect(executorPage.locator("#boardsWrapper")).toBeVisible();
  await expect(executorPage.getByText("Задачи")).toHaveCount(0);
  await expect(executorPage.getByTestId("add-button-space-entity")).toBeDisabled();
  await executorContext.close();
});
