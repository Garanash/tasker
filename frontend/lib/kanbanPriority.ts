/**
 * Приоритеты карточек канбана (поле custom priority) и отображение срочности.
 */

export function normalizeKanbanPriority(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  let s = String(raw).trim();
  if (s.length >= 2 && s[0] === s[s.length - 1] && (s[0] === '"' || s[0] === "'")) {
    s = s.slice(1, -1).trim();
  }
  return s || null;
}

export function getTimelineBarVisuals(
  priorityRaw: unknown,
  isDoneLike: boolean,
): {
  background: string;
  boxShadow: string;
  hoverBoxShadow: string;
  borderColor: string;
} {
  if (isDoneLike) {
    return {
      background: "linear-gradient(90deg, #334155 0%, #475569 100%)",
      boxShadow: "0 8px 18px rgba(71,85,105,0.35)",
      hoverBoxShadow: "0 12px 26px rgba(71,85,105,0.45)",
      borderColor: "rgba(255,255,255,0.12)",
    };
  }
  const p = normalizeKanbanPriority(priorityRaw);
  if (p === "Срочно") {
    return {
      background: "linear-gradient(90deg, #ef4444 0%, #b91c1c 100%)",
      boxShadow: "0 10px 24px rgba(239,68,68,0.4)",
      hoverBoxShadow: "0 14px 30px rgba(239,68,68,0.5)",
      borderColor: "rgba(255,255,255,0.18)",
    };
  }
  if (p === "Средний") {
    return {
      background: "linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)",
      boxShadow: "0 10px 24px rgba(59,130,246,0.38)",
      hoverBoxShadow: "0 14px 30px rgba(59,130,246,0.5)",
      borderColor: "rgba(255,255,255,0.18)",
    };
  }
  if (p === "Терпит") {
    return {
      background: "linear-gradient(90deg, #22c55e 0%, #15803d 100%)",
      boxShadow: "0 10px 24px rgba(34,197,94,0.35)",
      hoverBoxShadow: "0 14px 30px rgba(34,197,94,0.48)",
      borderColor: "rgba(255,255,255,0.18)",
    };
  }
  return {
    background: "linear-gradient(90deg, #64748b 0%, #475569 100%)",
    boxShadow: "0 10px 24px rgba(100,116,139,0.35)",
    hoverBoxShadow: "0 14px 30px rgba(100,116,139,0.45)",
    borderColor: "rgba(255,255,255,0.12)",
  };
}

/** Компактные чипы событий в календаре (те же уровни, что и таймлайн). */
export function getCalendarCardChipColors(priorityRaw: unknown): {
  background: string;
  color: string;
  hoverBackground: string;
} {
  const p = normalizeKanbanPriority(priorityRaw);
  if (p === "Срочно") {
    return { background: "#dc2626", color: "#ffffff", hoverBackground: "#b91c1c" };
  }
  if (p === "Средний") {
    return { background: "#2563eb", color: "#ffffff", hoverBackground: "#1d4ed8" };
  }
  if (p === "Терпит") {
    return { background: "#16a34a", color: "#ffffff", hoverBackground: "#15803d" };
  }
  return { background: "#64748b", color: "#ffffff", hoverBackground: "#475569" };
}
