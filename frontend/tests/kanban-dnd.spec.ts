import { test, expect } from "@playwright/test";

test("Kanban DnD: перемещение карточки между колонками (реальный API)", async ({ page }) => {
  await page.goto("http://localhost:3000/e2e/kanban");

  // Ждём загрузки доски (подзаголовок) или ошибки
  const loaded = page.getByText("Реальная доска через API");
  const errorMsg = page.getByText("Ошибка");
  const loadedOrError = await Promise.race([
    loaded.waitFor({ state: "visible", timeout: 35_000 }).then(() => "loaded"),
    errorMsg.waitFor({ state: "visible", timeout: 35_000 }).then(() => "error"),
  ]).catch(() => "timeout");
  if (loadedOrError === "error") {
    throw new Error("Страница показала ошибку — убедитесь, что бэкенд запущен на http://localhost:8000 и БД инициализирована (schema/init.sql)");
  }
  if (loadedOrError === "timeout") {
    throw new Error("Таймаут загрузки доски (35s) — проверьте бэкенд и консоль браузера");
  }
  await expect(loaded).toBeVisible();

  // Первая карточка с бутстрапа — «Собрать требования»
  const cardTitle = "Собрать требования";
  const card = page.getByText(cardTitle);
  await expect(card).toBeVisible({ timeout: 15_000 });

  const todoHeader = page.getByText("ToDo");
  const doneHeader = page.getByText("Done");

  const startBox = await card.boundingBox();
  const todoColumn = todoHeader.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const doneColumn = doneHeader.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const doneBox = await doneColumn.boundingBox();
  if (!startBox || !doneBox) throw new Error("Не удалось получить boundingBox");

  await expect(todoColumn).toContainText(cardTitle);
  await expect(doneColumn).not.toContainText(cardTitle);

  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2, { steps: 15 });
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.mouse.move(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2, { steps: 25 });
  await page.mouse.up();

  await expect(doneColumn).toContainText(cardTitle, { timeout: 15_000 });
  await expect(todoColumn).not.toContainText(cardTitle, { timeout: 5_000 });
});
