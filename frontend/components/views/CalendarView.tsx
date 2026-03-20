"use client";

import { Box, Typography, IconButton, ToggleButton, ToggleButtonGroup } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { useState, useMemo } from "react";
import { getCalendarCardChipColors } from "@/lib/kanbanPriority";

type Card = {
  id: string;
  title: string;
  due_at?: string | null;
  planned_start_at?: string | null;
  planned_end_at?: string | null;
  priority?: string | null;
};

type Props = {
  cards: Card[];
  onCardClick?: (cardId: string) => void;
  locale?: "ru" | "en";
};

const WEEKDAYS_RU = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const WEEKDAYS_EN = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MONTHS = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"
];
const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export default function CalendarView({ cards, onCardClick, locale = "ru" }: Props) {
  const t =
    locale === "en"
      ? { today: "TODAY", due: "DUE DATE", month: "MONTH", week: "WEEK", day: "DAY", more: "more" }
      : { today: "СЕГОДНЯ", due: "СРОК", month: "МЕСЯЦ", week: "НЕДЕЛЯ", day: "ДЕНЬ", more: "ещё" };
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"month" | "week" | "day">("month");

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];

    for (let i = startOffset - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: d, isCurrentMonth: false });
    }

    for (let i = 1; i <= lastDay.getDate(); i++) {
      days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ date: new Date(year, month + 1, i), isCurrentMonth: false });
    }

    return days;
  }, [year, month]);

  const cardsByDate = useMemo(() => {
    const map: Record<string, Card[]> = {};
    const addCardForDate = (dateKey: string, card: Card) => {
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(card);
    };

    cards.forEach((card) => {
      const startRaw = card.planned_start_at || card.due_at;
      const endRaw = card.planned_end_at || card.due_at;
      if (!startRaw || !endRaw) return;
      const startDate = new Date(startRaw);
      const endDate = new Date(endRaw);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;

      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        addCardForDate(cursor.toISOString().split("T")[0], card);
        cursor.setDate(cursor.getDate() + 1);
      }
    });
    return map;
  }, [cards]);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", bgcolor: "rgba(127,127,127,0.12)" }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          p: 2,
          borderBottom: "1px solid var(--k-border)",
        }}
      >
        <IconButton size="small" onClick={prevMonth}>
          <ChevronLeftIcon />
        </IconButton>
        <IconButton size="small" onClick={nextMonth}>
          <ChevronRightIcon />
        </IconButton>
        <Box
          component="button"
          onClick={goToday}
          sx={{
            px: 2,
            py: 0.5,
            border: "1px solid var(--k-border)",
            borderRadius: 1,
            bgcolor: "var(--k-surface-bg)",
            color: "var(--k-text)",
            fontSize: 13,
            cursor: "pointer",
            "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
          }}
        >
          {t.today}
        </Box>
        <Box
          component="button"
          sx={{
            px: 2,
            py: 0.5,
            border: "1px solid var(--k-border)",
            borderRadius: 1,
            bgcolor: "var(--k-surface-bg)",
            color: "var(--k-text)",
            fontSize: 13,
            cursor: "pointer",
            "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
          }}
        >
          {t.due}
        </Box>

        <Box sx={{ flex: 1 }} />

        <Typography sx={{ fontSize: 18, fontWeight: 500, color: "var(--k-text)" }}>
          {locale === "en" ? `${MONTHS_EN[month]} ${year}` : `${MONTHS[month]} ${year} г.`}
        </Typography>

        <Box sx={{ flex: 1 }} />

        <ToggleButtonGroup
          size="small"
          value={viewMode}
          exclusive
          onChange={(_, v) => v && setViewMode(v)}
        >
          <ToggleButton value="month" sx={{ textTransform: "none", fontSize: 12 }}>{t.month}</ToggleButton>
          <ToggleButton value="week" sx={{ textTransform: "none", fontSize: 12 }}>{t.week}</ToggleButton>
          <ToggleButton value="day" sx={{ textTransform: "none", fontSize: 12 }}>{t.day}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Заголовки дней недели */}
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--k-border)" }}>
        {(locale === "en" ? WEEKDAYS_EN : WEEKDAYS_RU).map((day) => (
          <Box
            key={day}
            sx={{
              p: 1,
              textAlign: "center",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--k-text-muted)",
              textTransform: "lowercase",
            }}
          >
            {day}
          </Box>
        ))}
      </Box>

      {/* Сетка календаря */}
      <Box sx={{ flex: 1, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", overflow: "auto" }}>
        {calendarDays.map((day, idx) => {
          const dateStr = day.date.toISOString().split("T")[0];
          const dayCards = cardsByDate[dateStr] || [];
          const isToday = dateStr === todayStr;

          return (
            <Box
              key={idx}
              sx={{
                minHeight: 100,
                p: 0.5,
                borderRight: "1px solid var(--k-border)",
                borderBottom: "1px solid var(--k-border)",
                bgcolor: isToday ? "#FFFDE7" : day.isCurrentMonth ? "var(--k-surface-bg)" : "rgba(127,127,127,0.08)",
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: isToday ? 700 : 400,
                  color: day.isCurrentMonth ? "var(--k-text)" : "var(--k-text-muted)",
                  textAlign: "right",
                  pr: 1,
                }}
              >
                {day.date.getDate()}
              </Typography>
              {dayCards.slice(0, 3).map((card) => {
                const chip = getCalendarCardChipColors(card.priority);
                return (
                  <Box
                    key={`${dateStr}-${card.id}`}
                    onClick={() => onCardClick?.(card.id)}
                    sx={{
                      fontSize: 11,
                      fontWeight: 600,
                      bgcolor: chip.background,
                      color: chip.color,
                      px: 0.5,
                      py: 0.25,
                      borderRadius: 0.5,
                      mb: 0.25,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      transition: "background-color 0.15s ease, filter 0.15s ease",
                      border: "1px solid rgba(0,0,0,0.08)",
                      "&:hover": {
                        bgcolor: chip.hoverBackground,
                        filter: "brightness(1.06)",
                      },
                    }}
                  >
                    {card.title}
                  </Box>
                );
              })}
              {dayCards.length > 3 && (
                <Typography sx={{ fontSize: 10, color: "var(--k-text-muted)" }}>
                  +{dayCards.length - 3} {t.more}
                </Typography>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
