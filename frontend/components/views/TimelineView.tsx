"use client";

import { Box, Typography, Select, MenuItem, FormControl, Tooltip } from "@mui/material";
import { useState, useMemo } from "react";
import { getTimelineBarVisuals, normalizeKanbanPriority } from "@/lib/kanbanPriority";

type Card = {
  id: string;
  title: string;
  description?: string;
  board_name?: string;
  column_name?: string;
  track_name?: string;
  due_at?: string | null;
  planned_start_at?: string | null;
  planned_end_at?: string | null;
  created_at?: string;
  priority?: string | null;
  tags?: string[];
  assignee_name?: string | null;
};

type Props = {
  cards: Card[];
  onCardClick?: (cardId: string) => void;
  locale?: "ru" | "en";
};

const MONTHS_RU = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."];
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const DESCRIPTION_TOOLTIP_MAX = 240;

function formatCardDate(raw: string | null | undefined, loc: "ru" | "en"): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(loc === "en" ? "en-US" : "ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function TimelineCardTooltip({ card, locale }: { card: Card; locale: "ru" | "en" }) {
  const priority = normalizeKanbanPriority(card.priority);
  const desc = (card.description || "").trim();
  const shortDesc =
    desc.length > DESCRIPTION_TOOLTIP_MAX ? `${desc.slice(0, DESCRIPTION_TOOLTIP_MAX - 1)}…` : desc;

  const metaLines: { label: string; value: string }[] = [];
  if (priority) {
    metaLines.push({ label: locale === "en" ? "Urgency" : "Срочность", value: priority });
  }
  if (card.column_name) {
    metaLines.push({ label: locale === "en" ? "Column" : "Колонка", value: card.column_name });
  }
  if (card.board_name) {
    metaLines.push({ label: locale === "en" ? "Board" : "Доска", value: card.board_name });
  }
  if (card.track_name) {
    metaLines.push({ label: locale === "en" ? "Track" : "Дорожка", value: card.track_name });
  }
  const start = formatCardDate(card.planned_start_at || card.due_at, locale);
  const end = formatCardDate(card.planned_end_at || card.due_at, locale);
  if (start || end) {
    metaLines.push({
      label: locale === "en" ? "Dates" : "Даты",
      value: [start, end].filter(Boolean).join(" — "),
    });
  }
  if (card.assignee_name) {
    metaLines.push({ label: locale === "en" ? "Assignee" : "Исполнитель", value: card.assignee_name });
  }
  const tagList = Array.isArray(card.tags) ? card.tags.filter(Boolean) : [];
  if (tagList.length) {
    metaLines.push({
      label: locale === "en" ? "Tags" : "Теги",
      value: tagList.slice(0, 10).join(", "),
    });
  }

  return (
    <Box>
      <Typography sx={{ fontWeight: 700, fontSize: 14, lineHeight: 1.35, mb: shortDesc ? 0.75 : 0 }}>{card.title}</Typography>
      {shortDesc ? (
        <Typography
          sx={{
            fontSize: 12,
            color: "rgba(255,255,255,0.88)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.45,
            mb: metaLines.length ? 1 : 0,
          }}
        >
          {shortDesc}
        </Typography>
      ) : null}
      {metaLines.map((line, idx) => (
        <Typography key={`${line.label}-${idx}`} sx={{ fontSize: 11, color: "rgba(255,255,255,0.78)", mt: 0.35 }}>
          <Box component="span" sx={{ color: "rgba(255,255,255,0.5)", mr: 0.75 }}>
            {line.label}:
          </Box>
          {line.value}
        </Typography>
      ))}
    </Box>
  );
}

export default function TimelineView({ cards, onCardClick, locale = "ru" }: Props) {
  const [projectFilter, setProjectFilter] = useState("all");
  const t =
    locale === "en"
      ? {
          noBoard: "No board",
          projects: "PROJECTS",
          downloadFull: "DOWNLOAD DETAILED REPORT",
          download: "DOWNLOAD",
          settings: "SETTINGS",
          title: "Title",
          addCard: "Add card",
          today: "Today",
          resource: "▲ Resource planning",
        }
      : {
          noBoard: "Без доски",
          projects: "ПРОЕКТЫ",
          downloadFull: "СКАЧАТЬ РАЗВЁРНУТЫЙ ОТЧЁТ",
          download: "СКАЧАТЬ",
          settings: "НАСТРОЙКИ",
          title: "Название",
          addCard: "Добавить карточку",
          today: "Сегодня",
          resource: "▲ Ресурсное планирование",
        };
  const escapeCsv = (value: unknown): string => {
    const raw = value == null ? "" : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
  };
  const downloadTimelineCsv = (detailed: boolean) => {
    const headers = detailed
      ? [
          locale === "en" ? "Title" : "Название",
          "ID",
          locale === "en" ? "Board" : "Доска",
          locale === "en" ? "Track" : "Дорожка",
          locale === "en" ? "Column" : "Колонка",
          locale === "en" ? "Assignee" : "Ответственный",
          locale === "en" ? "Start" : "Старт",
          locale === "en" ? "End" : "Финиш",
          locale === "en" ? "Priority" : "Приоритет",
          locale === "en" ? "Tags" : "Теги",
        ]
      : [
          locale === "en" ? "Title" : "Название",
          "ID",
          locale === "en" ? "Board" : "Доска",
          locale === "en" ? "Dates" : "Даты",
          locale === "en" ? "Assignee" : "Ответственный",
        ];
    const lines = [
      headers.map(escapeCsv).join(","),
      ...cards.map((c) => {
        const start = formatCardDate(c.planned_start_at || c.due_at, locale) || "—";
        const end = formatCardDate(c.planned_end_at || c.due_at, locale) || "—";
        const row = detailed
          ? [
              c.title,
              c.id.slice(0, 8),
              c.board_name || "—",
              c.track_name || "—",
              c.column_name || "—",
              c.assignee_name || "—",
              start,
              end,
              normalizeKanbanPriority(c.priority) || "—",
              (c.tags || []).join(", "),
            ]
          : [c.title, c.id.slice(0, 8), c.board_name || "—", `${start} — ${end}`, c.assignee_name || "—"];
        return row.map(escapeCsv).join(",");
      }),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = detailed
      ? locale === "en"
        ? "timeline-detailed-report.csv"
        : "timeline-развернутый-отчет.csv"
      : locale === "en"
        ? "timeline-report.csv"
        : "timeline-отчет.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const openTimelinePrintForm = () => {
    const title = locale === "en" ? "Timeline Report" : "Отчет по таймлайну";
    const generatedAt = new Date().toLocaleString(locale === "en" ? "en-US" : "ru-RU");
    const rows = cards
      .map((c) => {
        const start = formatCardDate(c.planned_start_at || c.due_at, locale) || "—";
        const end = formatCardDate(c.planned_end_at || c.due_at, locale) || "—";
        return `<tr><td>${c.title}</td><td>${c.id.slice(0, 8)}</td><td>${c.board_name || "—"}</td><td>${c.track_name || "—"}</td><td>${c.column_name || "—"}</td><td>${c.assignee_name || "—"}</td><td>${start} — ${end}</td></tr>`;
      })
      .join("");
    const win = window.open("", "_blank", "noopener,noreferrer,width=1280,height=900");
    if (!win) return;
    win.document.write(`
      <!doctype html><html><head><meta charset="utf-8"/><title>${title}</title>
      <style>
        body{font-family:Inter,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#111}
        h1{margin:0 0 8px;font-size:24px}.meta{margin:0 0 16px;color:#555;font-size:12px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #cfd2d7;padding:8px;text-align:left;vertical-align:top}
        th{background:#f3f4f6;font-weight:700}tr:nth-child(even) td{background:#fafafa}
      </style></head><body>
      <h1>${title}</h1><div class="meta">${generatedAt}</div>
      <table><thead><tr>
      <th>${locale === "en" ? "Title" : "Название"}</th><th>ID</th><th>${locale === "en" ? "Board" : "Доска"}</th><th>${locale === "en" ? "Track" : "Дорожка"}</th><th>${locale === "en" ? "Column" : "Колонка"}</th><th>${locale === "en" ? "Assignee" : "Ответственный"}</th><th>${locale === "en" ? "Dates" : "Даты"}</th>
      </tr></thead><tbody>${rows}</tbody></table>
      </body></html>`);
    win.document.close();
    win.focus();
  };

  const today = new Date();
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const months = useMemo(() => {
    const result = [];
    for (let i = -2; i < 10; i++) {
      const d = new Date(currentYear, currentMonth + i, 1);
      const monthLabel = locale === "en" ? MONTHS_EN[d.getMonth()] : MONTHS_RU[d.getMonth()];
      result.push({ month: d.getMonth(), year: d.getFullYear(), label: monthLabel });
    }
    return result;
  }, [currentMonth, currentYear]);

  const groupedCards = useMemo(() => {
    const groups: Record<string, Card[]> = {};
    cards.forEach((card) => {
      const boardName = card.board_name || t.noBoard;
      if (!groups[boardName]) groups[boardName] = [];
      groups[boardName].push(card);
    });
    return groups;
  }, [cards, t.noBoard]);

  const timelineBars = useMemo(() => {
    const firstMonthDate = new Date(months[0].year, months[0].month, 1);
    const lastMonthDate = new Date(months[months.length - 1].year, months[months.length - 1].month + 1, 0);
    const totalDays = Math.max(1, Math.round((lastMonthDate.getTime() - firstMonthDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const pxPerDay = (months.length * 100) / totalDays;

    return cards
      .map((card, index) => {
        const start = card.planned_start_at ? new Date(card.planned_start_at) : card.due_at ? new Date(card.due_at) : null;
        const end = card.planned_end_at ? new Date(card.planned_end_at) : card.due_at ? new Date(card.due_at) : start;
        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
        const normalizedStart = start < firstMonthDate ? firstMonthDate : start;
        const normalizedEnd = end > lastMonthDate ? lastMonthDate : end;
        if (normalizedEnd < firstMonthDate || normalizedStart > lastMonthDate) return null;
        const startOffsetDays = Math.max(0, Math.round((normalizedStart.getTime() - firstMonthDate.getTime()) / (1000 * 60 * 60 * 24)));
        const endOffsetDays = Math.max(startOffsetDays + 1, Math.round((normalizedEnd.getTime() - firstMonthDate.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const now = new Date();
        const isDoneLike = normalizedEnd < now;
        return {
          card,
          top: 20 + index * 36,
          left: startOffsetDays * pxPerDay,
          width: Math.max(30, (endOffsetDays - startOffsetDays) * pxPerDay),
          isDoneLike,
        };
      })
      .filter((x): x is { card: Card; top: number; left: number; width: number; isDoneLike: boolean } => Boolean(x));
  }, [cards, months]);

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", bgcolor: "rgba(127,127,127,0.12)" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 2, borderBottom: "1px solid var(--k-border)" }}>
        <FormControl size="small">
          <Select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            sx={{ minWidth: 120, fontSize: 13 }}
          >
            <MenuItem value="all">{t.projects} ▼</MenuItem>
          </Select>
        </FormControl>
        <Box sx={{ flex: 1 }} />
        <Box
          component="button"
          onClick={() => downloadTimelineCsv(true)}
          sx={{ px: 2, py: 1, bgcolor: "var(--k-surface-bg)", color: "var(--k-text)", border: "1px solid var(--k-border)", borderRadius: 1, fontSize: 13, cursor: "pointer" }}
        >
          ⬇ {t.downloadFull}
        </Box>
        <Box
          component="button"
          onClick={() => downloadTimelineCsv(false)}
          sx={{ px: 2, py: 1, bgcolor: "var(--k-surface-bg)", color: "var(--k-text)", border: "1px solid var(--k-border)", borderRadius: 1, fontSize: 13, cursor: "pointer" }}
        >
          ⬇ {t.download}
        </Box>
        <Box
          component="button"
          onClick={openTimelinePrintForm}
          sx={{ px: 2, py: 1, bgcolor: "var(--k-surface-bg)", color: "var(--k-text)", border: "1px solid var(--k-border)", borderRadius: 1, fontSize: 13, cursor: "pointer" }}
        >
          ⚙ {t.settings}
        </Box>
      </Box>

      <Box sx={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Левая часть — список задач */}
        <Box sx={{ width: 400, borderRight: "1px solid var(--k-border)", overflow: "auto", bgcolor: "var(--k-surface-bg)" }}>
            <Box sx={{ display: "flex", bgcolor: "rgba(127,127,127,0.12)", borderBottom: "1px solid var(--k-border)" }}>
            <Box sx={{ flex: 1, p: 1, fontSize: 12, fontWeight: 600, color: "var(--k-text-muted)" }}>{t.title}</Box>
            <Box sx={{ width: 80, p: 1, fontSize: 12, fontWeight: 600, color: "var(--k-text-muted)" }}>ID</Box>
          </Box>
          {Object.entries(groupedCards).map(([boardName, boardCards]) => (
            <Box key={boardName}>
              <Box sx={{ p: 1, bgcolor: "rgba(127,127,127,0.12)", borderBottom: "1px solid var(--k-border)" }}>
                <Typography sx={{ color: "#9C27B0", fontWeight: 600, fontSize: 14 }}>{boardName}</Typography>
              </Box>
              {boardCards.map((card) => (
                <Box
                  key={card.id}
                  onClick={() => onCardClick?.(card.id)}
                  sx={{
                    display: "flex",
                    borderBottom: "1px solid var(--k-border)",
                    cursor: "pointer",
                    "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
                  }}
                >
                  <Box sx={{ flex: 1, p: 1, fontSize: 13 }}>
                    <Typography sx={{ fontSize: 13, color: "var(--k-text)", display: "flex", alignItems: "center", gap: 1 }}>
                      <Box
                        component="span"
                        sx={{ width: 16, height: 16, bgcolor: "#9C27B0", borderRadius: 0.5, display: "inline-block" }}
                      />
                      {card.title}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: "var(--k-text-muted)", mt: 0.25 }}>
                      {(locale === "en" ? "Assignee" : "Ответственный") + ": " + (card.assignee_name || "—")}
                    </Typography>
                  </Box>
                  <Box sx={{ width: 80, p: 1, fontSize: 12, color: "var(--k-text-muted)" }}>{card.id.slice(0, 8)}</Box>
                </Box>
              ))}
              <Box
                sx={{ p: 1, color: "var(--k-text-muted)", fontSize: 12, cursor: "pointer", "&:hover": { bgcolor: "rgba(127,127,127,0.12)" } }}
              >
                {t.addCard}
              </Box>
            </Box>
          ))}
        </Box>

        {/* Правая часть — временная шкала */}
        <Box sx={{ flex: 1, overflow: "auto" }}>
          <Box sx={{ display: "flex", minWidth: months.length * 100 }}>
            {/* Заголовки месяцев */}
            <Box sx={{ display: "flex", borderBottom: "1px solid var(--k-border)", bgcolor: "rgba(127,127,127,0.12)" }}>
              {months.map((m, idx) => (
                <Box
                  key={idx}
                  sx={{
                    width: 100,
                    p: 1,
                    textAlign: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--k-text-muted)",
                    borderRight: "1px solid var(--k-border)",
                  }}
                >
                  {m.label}
                  <Box sx={{ fontSize: 10, color: "var(--k-text-muted)" }}>{m.year}</Box>
                </Box>
              ))}
            </Box>
          </Box>
          {/* Линия "Сегодня" */}
          <Box sx={{ position: "relative", minHeight: Math.max(420, 60 + cards.length * 36) }}>
            <Box
              sx={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 2 * 100 + (today.getDate() / 30) * 100,
                width: 2,
                bgcolor: "#9C27B0",
                zIndex: 1,
              }}
            />
            <Box
              sx={{
                position: "absolute",
                top: -20,
                left: 2 * 100 + (today.getDate() / 30) * 100 - 30,
                bgcolor: "#F3E5F5",
                color: "#9C27B0",
                px: 1,
                py: 0.25,
                fontSize: 11,
                borderRadius: 0.5,
              }}
            >
              {t.today}
            </Box>
            {/* Сетка */}
            <Box sx={{ display: "flex", minWidth: months.length * 100, position: "relative" }}>
              {months.map((_, idx) => (
                <Box
                  key={idx}
                  sx={{
                    width: 100,
                    minHeight: 400,
                    borderRight: "1px solid var(--k-border)",
                    bgcolor: idx % 2 === 0 ? "var(--k-surface-bg)" : "rgba(127,127,127,0.08)",
                  }}
                />
              ))}
            </Box>
            <Box sx={{ position: "absolute", left: 0, top: 0, width: months.length * 100, height: "100%", pointerEvents: "none" }}>
              {timelineBars.map((bar) => {
                const vis = getTimelineBarVisuals(bar.card.priority, bar.isDoneLike);
                return (
                  <Tooltip
                    key={bar.card.id}
                    enterDelay={320}
                    enterNextDelay={200}
                    disableInteractive
                    title={<TimelineCardTooltip card={bar.card} locale={locale} />}
                    slotProps={{
                      tooltip: {
                        sx: {
                          bgcolor: "rgba(17, 17, 17, 0.97)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          maxWidth: 340,
                          p: 1.25,
                          boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
                        },
                      },
                    }}
                  >
                    <Box
                      onClick={() => onCardClick?.(bar.card.id)}
                      sx={{
                        pointerEvents: "auto",
                        position: "absolute",
                        top: bar.top,
                        left: bar.left,
                        width: bar.width,
                        height: 30,
                        borderRadius: 0,
                        background: vis.background,
                        color: "#fff",
                        px: 1.25,
                        fontSize: 12,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        cursor: "pointer",
                        border: `1px solid ${vis.borderColor}`,
                        boxShadow: vis.boxShadow,
                        transition: "transform 0.2s ease, box-shadow 0.2s ease",
                        "&:hover": {
                          transform: "translateY(-1px)",
                          boxShadow: vis.hoverBoxShadow,
                        },
                      }}
                    >
                      {bar.card.title}
                    </Box>
                  </Tooltip>
                );
              })}
            </Box>
          </Box>
      <Box sx={{ p: 2, borderTop: "1px solid var(--k-border)", color: "var(--k-text-muted)", fontSize: 12 }}>
            {t.resource}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
