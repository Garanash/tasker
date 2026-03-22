"use client";

import { useState, memo, useCallback, useMemo, type ReactNode } from "react";
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
  Avatar,
} from "@mui/material";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import FlagIcon from "@mui/icons-material/Flag";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ArchiveOutlinedIcon from "@mui/icons-material/ArchiveOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import StarIcon from "@mui/icons-material/Star";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import TimerOutlinedIcon from "@mui/icons-material/TimerOutlined";
import ParkOutlinedIcon from "@mui/icons-material/ParkOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import BugReportOutlinedIcon from "@mui/icons-material/BugReportOutlined";
import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import { normalizeTaskCardType } from "./cardTaskTypes";
import { normalizeKanbanPriority } from "@/lib/kanbanPriority";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Card = {
  id: string;
  title: string;
  description: string;
  card_type: string;
  due_at: string | null;
  planned_end_at?: string | null;
  track_id?: string | null;
  column_id: string;
  unread_comments_count?: number;
  comments_count?: number;
  attachments_count?: number;
};

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

function extractFirstImageUrl(markdown: string): string | null {
  const mdMatch = markdown.match(/!\[[^\]]*]\((?:<)?([^)\s>]+)(?:>)?(?:\s+["'][^"']*["'])?\)/i);
  if (mdMatch?.[1]) return mdMatch[1];

  const htmlImgMatch = markdown.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
  if (htmlImgMatch?.[1]) return htmlImgMatch[1];

  return null;
}

function toCardPreviewImageUrl(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (rawUrl.startsWith("/")) return getApiUrl(rawUrl);
  return rawUrl;
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
  unreadCommentsCount?: number;
  attachmentsCount?: number;
  isFavorite?: boolean;
  priority?: "Терпит" | "Средний" | "Срочно" | string | null;
  tags?: string[];
  assigneeName?: string | null;
  blockedCount?: number;
  blockingCount?: number;
  plannedEndAt?: string | null;
  currentUserRole?: "executor" | "manager" | "admin";
};

function KanbanCardComponent({
  card,
  token: _token,
  locale = "ru",
  onOpen,
  onEdit,
  onDelete,
  onDuplicate,
  onArchive,
  commentsCount = 0,
  unreadCommentsCount = 0,
  attachmentsCount = 0,
  isFavorite = false,
  priority = null,
  tags = [],
  assigneeName = null,
  assigneeAvatarUrl = null,
  blockedCount = 0,
  blockingCount = 0,
  plannedEndAt = null,
  currentUserRole,
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
    /* Полупрозрачная копия уходит под соседние ячейки grid; визуал только в DragOverlay (портал) */
    opacity: isDragging ? 0 : 1,
    pointerEvents: isDragging ? "none" : undefined,
  };

  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [isHovered, setIsHovered] = useState(false);

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
  const coverImageUrl = useMemo(() => {
    const rawImageUrl = extractFirstImageUrl(card.description);
    return rawImageUrl ? toCardPreviewImageUrl(rawImageUrl) : null;
  }, [card.description]);
  const descriptionWithoutImages = useMemo(
    () =>
      card.description
        .replace(/!\[[^\]]*]\((?:<)?([^)\s>]+)(?:>)?(?:\s+["'][^"']*["'])?\)/gi, "")
        .replace(/<img[^>]*>/gi, "")
        .trim(),
    [card.description]
  );
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
  const assigneeDisplayName = useMemo(() => {
    const raw = (assigneeName || "").trim();
    if (!raw) return "";
    return raw.replace(/^["']+/, "").replace(/["']+$/, "");
  }, [assigneeName]);
  const assigneeInitial = assigneeDisplayName ? assigneeDisplayName.charAt(0).toUpperCase() : "?";
  const assigneeAvatarSrc = useMemo(() => {
    const u = (assigneeAvatarUrl || "").trim();
    if (!u) return undefined;
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return getApiUrl(u.startsWith("/") ? u : `/${u}`);
  }, [assigneeAvatarUrl]);

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

      {coverImageUrl ? (
        <Box
          sx={{
            mb: 1,
            borderRadius: 1,
            overflow: "hidden",
            border: "1px solid var(--k-border)",
            height: 150,
            bgcolor: "var(--k-page-bg)",
          }}
        >
          <Box
            component="img"
            src={coverImageUrl}
            alt=""
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        </Box>
      ) : null}

      {/* Описание в markdown (до 5 строк) */}
      {descriptionWithoutImages ? (
        <Box
          sx={{
            mb: 1,
            color: "var(--k-text-muted)",
            fontSize: 12,
            lineHeight: 1.4,
            overflow: "hidden",
            maxHeight: "calc(1.4em * 5)",
            "& p": { m: 0 },
            "& p + p": { mt: 0.5 },
            "& ul, & ol": { m: 0, pl: 2 },
            "& li": { mb: 0.25 },
            "& a": { color: "#A020F0", textDecoration: "underline" },
            "& strong": { color: "var(--k-text)", fontWeight: 700 },
            "& img": { display: "none" },
          }}
        >
          <Markdown remarkPlugins={[remarkGfm]}>{descriptionWithoutImages}</Markdown>
        </Box>
      ) : null}

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
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, color: "var(--k-text-muted)", position: "relative" }}>
              <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
              <Typography
                sx={{
                  fontSize: 11,
                  ...(currentUserRole === "executor" && unreadCommentsCount > 0
                    ? {
                        minWidth: 18,
                        height: 18,
                        px: 0.5,
                        borderRadius: "999px",
                        border: "1px solid #ef4444",
                        color: "#ef4444",
                        fontWeight: 700,
                        lineHeight: "16px",
                        textAlign: "center",
                      }
                    : {}),
                }}
              >
                {commentsCount}
              </Typography>
              {unreadCommentsCount > 0 && currentUserRole !== "executor" ? (
                <Box
                  sx={{
                    minWidth: 16,
                    height: 16,
                    px: 0.5,
                    borderRadius: "999px",
                    bgcolor: "#dc2626",
                    color: "#fff",
                    fontSize: 10,
                    lineHeight: "16px",
                    textAlign: "center",
                    fontWeight: 700,
                  }}
                >
                  {unreadCommentsCount}
                </Box>
              ) : null}
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
      </Box>
      {(blockingCount > 0 || blockedCount > 0 || assigneeDisplayName) && (
        <Box sx={{ mt: 1, display: "flex", flexDirection: "column", gap: 0.5 }}>
          {blockingCount > 0 ? (
            <Box sx={{ px: 1, py: 0.5, borderRadius: 0, bgcolor: "rgba(239,68,68,0.12)", fontSize: 11, color: "#F97316" }}>
              {`🚧 Блокирует ${blockingCount} карточку`}
            </Box>
          ) : null}
          {blockedCount > 0 ? (
            blockedCount > 1 ? (
              <Box
                component="button"
                type="button"
                sx={{
                  px: 1,
                  py: 0.5,
                  borderRadius: 0.5,
                  bgcolor: "rgba(251,191,36,0.14)",
                  fontSize: 11,
                  color: "#FBBF24",
                  border: "1px solid rgba(251,191,36,0.35)",
                  textAlign: "left",
                }}
              >
                {`✋ ${blockedCount} блокировки`}
              </Box>
            ) : (
              <Box sx={{ px: 1, py: 0.5, borderRadius: 0, bgcolor: "rgba(251,191,36,0.14)", fontSize: 11, color: "#FBBF24" }}>
                {"✋ 1 блокировка"}
              </Box>
            )
          ) : null}
          {assigneeDisplayName ? (
            <Box
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: 0.75,
                px: 0.75,
                py: 0.5,
                borderRadius: 1,
                border: "1px solid var(--k-border)",
                bgcolor: "rgba(127,127,127,0.1)",
                width: "fit-content",
                maxWidth: "100%",
              }}
            >
              <Avatar
                src={assigneeAvatarSrc}
                sx={{
                  width: 18,
                  height: 18,
                  fontSize: 10,
                  fontWeight: 700,
                  flexShrink: 0,
                  background: "linear-gradient(90deg, #8A2BE2, #4B0082)",
                  color: "#fff",
                }}
              >
                {assigneeInitial}
              </Avatar>
              <Box sx={{ fontSize: 11, color: "var(--k-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {assigneeDisplayName}
              </Box>
            </Box>
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
