import { test, expect } from "@playwright/test";

/**
 * Интерфейс в стиле Kaiten: двойной хедер, левый drawer, правый rail, вкладки, #app-container.
 */
test("Kaiten UI: хедер, drawer, rail, вкладки (реальный API)", async ({ page }) => {
  await page.goto("http://localhost:3000/app");

  const emailInput = page.locator('input[type="email"]');

  /** Вход только по OTP; без кода из письма автологин недоступен — подставьте JWT через E2E_ACCESS_TOKEN. */
  if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    const token = process.env.E2E_ACCESS_TOKEN;
    if (token) {
      await page.evaluate((t) => localStorage.setItem("kaiten_access", t), token);
      await page.reload();
      await expect(page.getByTestId("app-brand")).toBeVisible({ timeout: 30_000 });
    } else {
      test.skip(true, "Задайте E2E_ACCESS_TOKEN или войдите вручную — форма входа только по коду из письма");
    }
  }

  await expect(page.getByTestId("app-brand")).toContainText("AGB Tasks");
  await expect(page.getByTestId("menu-button")).toBeVisible();
  await expect(page.getByTestId("header-search")).toBeVisible();
  await expect(page.getByTestId("header-messages")).toBeVisible();
  await expect(page.getByTestId("right-rail")).toBeVisible();

  await page.getByTestId("menu-button").click();
  await expect(page.getByTestId("left-navigation-drawer")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByText("Фильтры")).toBeVisible();

  await expect(page.locator("#app-container")).toBeVisible();
  await expect(page.locator("#boardsContainer, #app-container").first()).toBeVisible();
});
