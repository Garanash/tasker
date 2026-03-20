/** Тип задачи в API и UI: task (карточка), bug, feature */
export type TaskCardTypeId = "task" | "bug" | "feature";

export function normalizeTaskCardType(raw: string | undefined | null): TaskCardTypeId {
  const s = (raw || "task").toLowerCase().trim();
  if (s === "bug" || s === "feature") return s;
  return "task";
}
