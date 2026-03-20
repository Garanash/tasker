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
          sx={{ px: 2, py: 1, bgcolor: "var(--k-surface-bg)", color: "var(--k-text)", border: "1px solid var(--k-border)", borderRadius: 1, fontSize: 13, cursor: "pointer" }}
        >
          ⬇ {t.downloadFull}
        </Box>
        <Box
          component="button"
          sx={{ px: 2, py: 1, bgcolor: "var(--k-surface-bg)", color: "var(--k-text)", border: "1px solid var(--k-border)", borderRadius: 1, fontSize: 13, cursor: "pointer" }}
        >
          ⬇ {t.download}
        </Box>
        <Box
          component="button"
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
