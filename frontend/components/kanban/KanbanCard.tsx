"use client";

import { useEffect, useState, memo, useCallback, useMemo, type ReactNode } from "react";
import type { CSSProperties } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { getApiUrl } from "@/lib/api";
import {
  Box,
  IconButton,
  Menu,
  MenuItem,
  Typography,
  Chip,
  Tooltip,
} from "@mui/material";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import FlagIcon from "@mui/icons-material/Flag";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import StarIcon from "@mui/icons-material/Star";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import ParkOutlinedIcon from "@mui/icons-material/ParkOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import { normalizeTaskCardType } from "./cardTaskTypes";
import { normalizeKanbanPriority } from "@/lib/kanbanPriority";

type Card = {
  id: string;
  title: string;
  description: string;
  card_type: string;
  due_at: string | null;
  planned_end_at?: string | null;
  track_id?: string | null;
  column_id: string;
};

type TimeEntry = {
  id: string;
  card_id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  note: string;
};

let isTimeApiAvailable: boolean | null = null;

function formatSeconds(totalSeconds: number) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Убирает остатки JSON/массива: ["тег → тег */
function sanitizeKanbanTagLabel(tag: string): string {
  let s = tag.trim();
  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/^[\[\s]+/, "")
      .replace(/[\]\s]+$/, "")
      .replace(/^["'`]+/, "")
      .replace(/["'`]+$/, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

/** Теги из API/jsonb могут прийти массивом, JSON-строкой или строкой с запятыми — всегда плоский список под чипы. */
function normalizeKanbanTags(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    const out: string[] = [];
    for (const v of raw) {
      if (typeof v === "string" && v.trim().startsWith("[")) {
        out.push(...normalizeKanbanTags(v));
      } else {
        const cleaned = sanitizeKanbanTagLabel(String(v));
        if (cleaned) out.push(cleaned);
      }
    }
    return out;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const parsed = JSON.parse(s) as unknown;
        if (Array.isArray(parsed)) {
          return normalizeKanbanTags(parsed).map(sanitizeKanbanTagLabel).filter(Boolean);
        }
      } catch {
        // неполный/битый JSON — разбираем вручную
      }
      const inner = s.replace(/^\s*\[\s*/, "").replace(/\s*\]\s*$/, "");
      return inner
        .split(",")
        .map((x) => sanitizeKanbanTagLabel(x))
        .filter(Boolean);
    }
    return s
      .split(",")
      .map((x) => sanitizeKanbanTagLabel(x))
      .filter(Boolean);
  }
  return [];
}

function CardFaceTypeIcon({ cardType }: { cardType: string }) {
  const t = normalizeTaskCardType(cardType);
  const sx = { fontSize: 18 };
  if (t === "bug") return <BugReportOutlinedIcon sx={{ ...sx, color: "#e53935" }} />;
  if (t === "feature") return <LightbulbOutlinedIcon sx={{ ...sx, color: "#1e88e5" }} />;
  return <MenuBookOutlinedIcon sx={{ ...sx, color: "#9e9e9e" }} />;
}

function formatDueDate(due_at: string | null, locale: "ru" | "en") {
  if (!due_at) return null;
  const date = new Date(due_at);
  const now = new Date();
  const isOverdue = date < now;
  const day = date.getDate();
  const month = date.toLocaleDateString(locale === "en" ? "en-US" : "ru-RU", { month: "short" });
  return { text: `${day} ${month}`, isOverdue };
}

type Props = {
  card: Card;
  token: string;
  locale?: "ru" | "en";
  onOpen: (cardId: string) => void;
  onEdit?: (cardId: string) => void;
  onDelete?: (cardId: string) => void;
  onDuplicate?: (cardId: string) => void;
  onArchive?: (cardId: string) => void;
  commentsCount?: number;
  attachmentsCount?: number;
  isFavorite?: boolean;
  priority?: "Терпит" | "Средний" | "Срочно" | string | null;
  tags?: string[];
  assigneeName?: string | null;
  blockedCount?: number;
  blockingCount?: number;
  plannedEndAt?: string | null;
};

function KanbanCardComponent({
  card,
  token,
  locale = "ru",
  onOpen,
  onEdit,
  onDelete,
  onDuplicate,
  onArchive,
  commentsCount = 0,
  attachmentsCount = 0,
  isFavorite = false,
  priority = null,
  tags = [],
  assigneeName = null,
  blockedCount = 0,
  blockingCount = 0,
  plannedEndAt = null,
}: Props) {
  const draggable = useDraggable({
    id: `card:${card.id}`,
  });
  const droppable = useDroppable({
    id: `card:${card.id}`,
  });
  const { attributes, listeners, transform, isDragging } = draggable;
  const setCombinedNodeRef = useCallback(
    (node: HTMLElement | null) => {
      draggable.setNodeRef(node);
      droppable.setNodeRef(node);
    },
    [draggable, droppable]
  );

  const style: CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 1000 : 1,
  };

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [activeEntry, setActiveEntry] = useState<TimeEntry | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  async function fetchActiveEntry() {
    if (isTimeApiAvailable === false) {
      setActiveEntry(null);
      setElapsedSeconds(0);
      return;
    }
    try {
      const res = await fetch(getApiUrl(`/api/time/entries?card_id=${encodeURIComponent(card.id)}`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) {
        isTimeApiAvailable = false;
        setActiveEntry(null);
        setElapsedSeconds(0);
        return;
      }
      if (!res.ok) return;
      isTimeApiAvailable = true;
      const data = (await res.json()) as TimeEntry[];
      const active = data.find((e) => e.ended_at === null) ?? null;
      setActiveEntry(active);
      if (active?.started_at) {
        const startedMs = new Date(active.started_at).getTime();
        setElapsedSeconds(Math.max(0, (Date.now() - startedMs) / 1000));
      } else {
        setElapsedSeconds(0);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchActiveEntry();
  }, [card.id, token]);

  useEffect(() => {
    if (!activeEntry) return;
    const interval = window.setInterval(() => {
      const startedMs = new Date(activeEntry.started_at).getTime();
      setElapsedSeconds(Math.max(0, (Date.now() - startedMs) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [activeEntry]);

  async function startTimer(e: React.MouseEvent) {
    e.stopPropagation();
    if (isTimeApiAvailable === false) return;
    try {
      const res = await fetch(getApiUrl("/api/time/entries/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ card_id: card.id, note: "" }),
      });
      if (res.status === 404) {
        isTimeApiAvailable = false;
        return;
      }
      if (!res.ok) return;
      isTimeApiAvailable = true;
      await fetchActiveEntry();
    } catch {
      // ignore
    }
  }

  async function stopTimer(e: React.MouseEvent) {
    e.stopPropagation();
    if (isTimeApiAvailable === false) return;
    try {
      const res = await fetch(getApiUrl("/api/time/entries/stop"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ card_id: card.id }),
      });
      if (res.status === 404) {
        isTimeApiAvailable = false;
        return;
      }
      if (!res.ok) return;
      isTimeApiAvailable = true;
      await fetchActiveEntry();
    } catch {
      // ignore
    }
  }

  const handleMenuOpen = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const dueInfo = formatDueDate(plannedEndAt ?? card.due_at, locale);
  const displayTags = useMemo(() => normalizeKanbanTags(tags), [tags]);
  const displayPriority = useMemo(() => normalizeKanbanPriority(priority), [priority]);
  const daysLeft = useMemo(() => {
    if (!plannedEndAt && !card.due_at) return null;
    const target = new Date((plannedEndAt ?? card.due_at) as string);
    if (Number.isNaN(target.getTime())) return null;
    const diffMs = target.getTime() - Date.now();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days < 0) return `${Math.abs(days)}д проср`;
    return `${days}д`;
  }, [plannedEndAt, card.due_at]);
  const priorityStyle = useMemo((): { bgcolor: string; icon: ReactNode } => {
    if (displayPriority === "Срочно") {
      return {
        bgcolor: "#EF4444",
        icon: <LocalFireDepartmentIcon sx={{ fontSize: 14, color: "#fff" }} />,
      };
    }
    if (displayPriority === "Средний") {
      return {
        bgcolor: "#2563EB",
        icon: <TimerOutlinedIcon sx={{ fontSize: 14, color: "#fff" }} />,
      };
    }
    if (displayPriority === "Терпит") {
      return {
        bgcolor: "#15803d",
        icon: <ParkOutlinedIcon sx={{ fontSize: 14, color: "#DCFCE7" }} />,
      };
    }
    return { bgcolor: "#475569", icon: <FlagIcon sx={{ fontSize: 14, color: "#fff" }} /> };
  }, [displayPriority]);

  return (
    <Box
      ref={setCombinedNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => {
        if (isDragging) return;
        onOpen(card.id);
      }}
      sx={{
        bgcolor: "rgba(127,127,127,0.12)",
        border: "1px solid #202124",
        borderRadius: 1.5,
        p: 1.5,
        cursor: "grab",
        transition: "box-shadow 0.15s, border-color 0.15s",
        position: "relative",
        touchAction: "none",
        userSelect: "none",
        borderColor: droppable.isOver && !isDragging ? "#9C27B0" : "#202124",
        "&:hover": {
          borderColor: "#D1D5DB",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        },
        "&:active": {
          cursor: "grabbing",
        },
      }}
    >
      {/* Верхняя строка: ID + Кнопка меню */}
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", mb: 0.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography
            sx={{
              fontSize: 11,
              color: "#8A8A8A",
              fontWeight: 500,
            }}
          >
            #{card.id.slice(0, 8)}
          </Typography>
          {isFavorite ? <StarIcon sx={{ fontSize: 14, color: "#FBC02D" }} /> : null}
        </Box>
        
        <IconButton
          size="small"
          onClick={handleMenuOpen}
          sx={{
            p: 0.25,
            opacity: isHovered || menuAnchor ? 1 : 0,
            transition: "opacity 0.15s",
            color: "var(--k-text-muted)",
            "&:hover": { bgcolor: "var(--k-text)" },
          }}
        >
          <MoreHorizIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      {/* Название + тип (иконка) */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75, mb: 1 }}>
        <Box sx={{ flexShrink: 0, pt: 0.125, lineHeight: 0 }} aria-hidden>
          <CardFaceTypeIcon cardType={card.card_type} />
        </Box>
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 500,
            color: "var(--k-text)",
            lineHeight: 1.4,
            wordBreak: "break-word",
            flex: 1,
            minWidth: 0,
          }}
        >
          {card.title}
        </Typography>
      </Box>

      {(displayPriority || displayTags.length > 0) && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", mb: 1 }}>
          {displayPriority ? (
            <Tooltip
              title={
                displayPriority === "Срочно"
                  ? locale === "en"
                    ? "Urgent priority"
                    : "Срочный приоритет"
                  : displayPriority === "Средний"
                    ? locale === "en"
                      ? "Medium priority"
                      : "Средний приоритет"
                    : displayPriority === "Терпит"
                      ? locale === "en"
                        ? "Low priority"
                        : "Низкий приоритет"
                      : displayPriority
              }
            >
              <Box
                sx={{
                  px: 1,
                  py: 0,
                  height: 24,
                  minWidth: 72,
                  gap: 0.5,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 0,
                  bgcolor: priorityStyle.bgcolor,
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                {priorityStyle.icon}
                <span>{displayPriority}</span>
              </Box>
            </Tooltip>
          ) : null}
          {displayTags.slice(0, 3).map((tag, idx) => (
            <Box
              key={`${tag}-${idx}`}
              sx={{
                px: 1,
                py: 0.25,
                borderRadius: 0,
                bgcolor: "rgba(138,43,226,0.18)",
                color: "var(--k-text)",
                fontSize: 11,
                border: "1px solid rgba(138,43,226,0.35)",
              }}
            >
              {tag}
            </Box>
          ))}
        </Box>
      )}

      {/* Описание (если есть) */}
      {card.description && (
        <Typography
          sx={{
            fontSize: 12,
            color: "var(--k-text-muted)",
            lineHeight: 1.4,
            mb: 1,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {card.description}
        </Typography>
      )}

      {/* Нижняя строка: метаданные */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 1 }}>
        {daysLeft && (
          <Tooltip
            title={
              dueInfo?.isOverdue
                ? locale === "en"
                  ? "Overdue (days past deadline)"
                  : "Просрочено (дней после дедлайна)"
                : locale === "en"
                  ? "Days until deadline"
                  : "Дней до дедлайна"
            }
          >
            <Box
              component="button"
              type="button"
              aria-label={locale === "en" ? "Days until deadline" : "Дней до дедлайна"}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 0.35,
                border: "1px solid rgba(255,255,255,0.22)",
                bgcolor: dueInfo?.isOverdue ? "#7f1d1d" : "#dc2626",
                color: "#fff",
                height: 24,
                minWidth: 50,
                px: 0.65,
                borderRadius: 0.5,
                fontSize: 11,
                fontWeight: 700,
                cursor: "default",
                lineHeight: 1,
                fontFamily: "inherit",
                "&:hover": {
                  filter: "brightness(1.08)",
                },
              }}
            >
              <TimerOutlinedIcon sx={{ fontSize: 14, color: "#fff", flexShrink: 0 }} aria-hidden />
              <span>{daysLeft}</span>
            </Box>
          </Tooltip>
        )}
        {/* Срок */}
        {dueInfo && (
          <Chip
            icon={<AccessTimeIcon sx={{ fontSize: 14 }} />}
            label={dueInfo.text}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              bgcolor: dueInfo.isOverdue ? "#FFEBEE" : "#E3F2FD",
              color: dueInfo.isOverdue ? "#C62828" : "#1565C0",
              "& .MuiChip-icon": {
                color: "inherit",
              },
            }}
          />
        )}

        {/* Комментарии */}
        {commentsCount > 0 && (
          <Tooltip title={locale === "en" ? "Comments" : "Комментарии"}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, color: "var(--k-text-muted)" }}>
              <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: 11 }}>{commentsCount}</Typography>
            </Box>
          </Tooltip>
        )}

        {/* Вложения */}
        {attachmentsCount > 0 && (
          <Tooltip title={locale === "en" ? "Attachments" : "Вложения"}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, color: "var(--k-text-muted)" }}>
              <AttachFileIcon sx={{ fontSize: 14 }} />
              <Typography sx={{ fontSize: 11 }}>{attachmentsCount}</Typography>
            </Box>
          </Tooltip>
        )}

        <Box sx={{ flex: 1 }} />

        {/* Таймер */}
        <Tooltip title={activeEntry ? (locale === "en" ? "Stop timer" : "Остановить таймер") : (locale === "en" ? "Start timer" : "Запустить таймер")}>
          <Box
            onClick={activeEntry ? stopTimer : startTimer}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.5,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              cursor: "pointer",
              bgcolor: activeEntry ? "#E8F5E9" : "transparent",
              color: activeEntry ? "#2E7D32" : "var(--k-text-muted)",
              "&:hover": { bgcolor: activeEntry ? "#C8E6C9" : "var(--k-text)" },
            }}
          >
            {activeEntry ? (
              <>
                <StopIcon sx={{ fontSize: 14 }} />
                <Typography sx={{ fontSize: 11, fontWeight: 500 }}>
                  {formatSeconds(elapsedSeconds)}
                </Typography>
              </>
            ) : (
              <PlayArrowIcon sx={{ fontSize: 14 }} />
            )}
          </Box>
        </Tooltip>

        {/* Аватар исполнителя */}
        <Box
          sx={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            bgcolor: "var(--k-text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <PersonOutlineIcon sx={{ fontSize: 14, color: "var(--k-text-muted)" }} />
        </Box>
      </Box>
      {(blockingCount > 0 || blockedCount > 0 || assigneeName) && (
        <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
          {blockingCount > 0 ? (
            <Box sx={{ px: 1, py: 0.5, borderRadius: 0, bgcolor: "rgba(239,68,68,0.12)", fontSize: 11, color: "#F97316" }}>
              {`🚧 Блокирует ${blockingCount} карточку`}
            </Box>
          ) : null}
          {blockedCount > 0 ? (
            <Box sx={{ px: 1, py: 0.5, borderRadius: 0, bgcolor: "rgba(251,191,36,0.14)", fontSize: 11, color: "#FBBF24" }}>
              {`✋ ${blockedCount} блокировка`}
            </Box>
          ) : null}
          {assigneeName ? (
            <Box sx={{ fontSize: 11, color: "var(--k-text-muted)" }}>{assigneeName}</Box>
          ) : null}
        </Box>
      )}

      {/* Контекстное меню */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        PaperProps={{
          sx: {
            minWidth: 180,
            bgcolor: "var(--k-surface-bg)",
            border: "1px solid #202124",
            boxShadow: "0 8px 30px rgba(0,0,0,0.45)",
          },
        }}
      >
        <MenuItem
          onClick={() => {
            handleMenuClose();
            onOpen(card.id);
          }}
          sx={{ fontSize: 13 }}
        >
          <OpenInNewIcon sx={{ fontSize: 18, mr: 1.5, color: "var(--k-text-muted)" }} />
          {locale === "en" ? "Open" : "Открыть"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleMenuClose();
            onEdit?.(card.id);
          }}
          sx={{ fontSize: 13 }}
        >
          <EditOutlinedIcon sx={{ fontSize: 18, mr: 1.5, color: "var(--k-text-muted)" }} />
          {locale === "en" ? "Edit" : "Редактировать"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleMenuClose();
            onDuplicate?.(card.id);
          }}
          sx={{ fontSize: 13 }}
        >
          <ContentCopyIcon sx={{ fontSize: 18, mr: 1.5, color: "var(--k-text-muted)" }} />
          {locale === "en" ? "Duplicate" : "Дублировать"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleMenuClose();
            onArchive?.(card.id);
          }}
          sx={{ fontSize: 13 }}
        >
          <ArchiveOutlinedIcon sx={{ fontSize: 18, mr: 1.5, color: "var(--k-text-muted)" }} />
          {locale === "en" ? "Archive" : "В архив"}
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleMenuClose();
            onDelete?.(card.id);
          }}
          sx={{ fontSize: 13, color: "#C62828" }}
        >
          <DeleteOutlineIcon sx={{ fontSize: 18, mr: 1.5 }} />
          {locale === "en" ? "Delete" : "Удалить"}
        </MenuItem>
      </Menu>
    </Box>
  );
}

export const KanbanCard = memo(KanbanCardComponent);
