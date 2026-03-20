import { test, expect } from "@playwright/test";

/**
 * Интерфейс в стиле Kaiten: двойной хедер, левый drawer, правый rail, вкладки, #app-container.
 */
test("Kaiten UI: хедер, drawer, rail, вкладки (реальный API)", async ({ page }) => {
  await page.goto("http://localhost:3000/app");

  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');

  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.getByRole("button", { name: "Вход" }).first().click();
    await emailInput.fill("e2e@test.com");
    await passwordInput.fill("password123");
    await page.getByRole("button", { name: "Вход" }).nth(1).click();
    await expect(page.getByTestId("app-brand")).toBeVisible({ timeout: 30_000 });
  }

  await expect(page.getByTestId("app-brand")).toContainText("Almazgeobur tasks");
  await expect(page.getByTestId("menu-button")).toBeVisible();
  await expect(page.getByTestId("header-buttons")).toBeVisible();
  await expect(page.getByTestId("header-search")).toBeVisible();
  await expect(page.getByTestId("right-rail")).toBeVisible();

  await page.getByTestId("menu-button").click();
  await expect(page.getByTestId("left-navigation-drawer")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("header-btn-lists")).toBeVisible();
  await expect(page.getByText("Списки")).toBeVisible();
  await expect(page.getByText("Отчёты")).toBeVisible();
  await expect(page.getByText("Архив")).toBeVisible();
  await expect(page.getByText("Фильтры")).toBeVisible();

  await expect(page.locator("#app-container")).toBeVisible();
  await expect(page.locator("#boardsContainer, #app-container").first()).toBeVisible();

  await page.getByTestId("header-btn-reports").click();
  await expect(page.getByText("Отчёты будут доступны")).toBeVisible({ timeout: 5_000 });
});
