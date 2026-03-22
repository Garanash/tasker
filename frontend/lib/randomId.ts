/**
 * Идентификатор для UI (блоки документа и т.д.).
 * crypto.randomUUID() есть только в secure context (HTTPS или localhost);
 * на http://IP/ падает — используем запасной вариант.
 */
export function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
