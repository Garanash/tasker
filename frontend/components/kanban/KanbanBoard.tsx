"use client";

import { useEffect, useMemo, useRef, useState, useCallback, memo, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  MeasuringStrategy,
  pointerWithin,
  closestCorners,
  type CollisionDetection,
} from "@dnd-kit/core";
import { getApiUrl, getWsUrl } from "@/lib/api";
import { CardDetail, CardModal } from "./CardModal";
import { KanbanCard } from "./KanbanCard";
import {
  Box,
  Typography,
  IconButton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  ListSubheader,
  FormControlLabel,
  Switch,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import LinkIcon from "@mui/icons-material/Link";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import SpeedIcon from "@mui/icons-material/Speed";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import RuleFolderOutlinedIcon from "@mui/icons-material/RuleFolderOutlined";
import ListAltOutlinedIcon from "@mui/icons-material/ListAltOutlined";
import DoneAllOutlinedIcon from "@mui/icons-material/DoneAllOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

type Card = {
  id: string;
  title: string;
  description: string;
  card_type: string;
  due_at: string | null;
  planned_end_at?: string | null;
  track_id?: string | null;
  column_id: string;
  is_favorite?: boolean;
  priority?: "Терпит" | "Средний" | "Срочно" | string | null;
  tags?: string[];
  assignee_name?: string | null;
  assignee_user_id?: string | null;
  blocked_count?: number;
  blocking_count?: number;
  comments_count?: number;
  unread_comments_count?: number;
  attachments_count?: number;
};
type OrgMember = { id: string; email: string; full_name: string; role: "user" | "executor" | "manager" | "lead" | "admin" };

type Column = {
  id: string;
  name: string;
  order_index: number;
  is_done: boolean;
  wip_limit?: number | null;
  cards: Card[];
};

type BoardGrid = {
  board: { id: string; name: string };
  effective_role?: "user" | "executor" | "manager" | "lead" | "admin";
  tracks: Array<{ id: string; name: string }>;
  columns: Column[];
};

export type KanbanStatusFilter = "all" | "todo" | "done";

export type KanbanFilters = {
  query: string;
  titleOnly: boolean;
  status: KanbanStatusFilter;
};

const BORDER_GRAY = "var(--k-text)";
const TEXT_GRAY = "var(--k-text-muted)";
const TEXT_DARK = "var(--k-text)";

/** Горизонтальный канбан: сначала зона под курсором, иначе ближайшие углы колонок. */
const kanbanCollisionDetection: CollisionDetection = (args) => {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length > 0) return pointerHits;
  return closestCorners(args);
};

/** Выше ячеек сетки и MUI Modal (~1300): overlay внутри layout с transform/overflow даёт неверный stacking */
const BOARD_DRAG_OVERLAY_Z = 10_000;

function BoardDragOverlayPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

const NOTIFY_STORAGE_PREFIX = "kaiten_notify_column_";

export function columnNotifyStorageKey(boardId: string, columnId: string) {
  return `${NOTIFY_STORAGE_PREFIX}${boardId}_${columnId}`;
}

const ColumnDroppable = memo(function ColumnDroppable({
  column,
  children,
  onAddCard,
  onRenameColumn,
  onOpenColumnMenu,
  locale = "ru",
}: {
  column: Column;
  children: React.ReactNode;
  onAddCard?: () => void;
  onRenameColumn?: (columnId: string) => void;
  /** Меню «⋯» (Kaiten-style), не путать с переименованием по клику на заголовок */
  onOpenColumnMenu?: (anchorEl: HTMLElement, columnId: string) => void;
  locale?: "ru" | "en";
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` });

  return (
    <Box
      ref={setNodeRef}
      data-column-id={column.id}
      sx={{
        minWidth: 280,
        maxWidth: 320,
        bgcolor: "var(--k-surface-bg)",
        borderRadius: 2,
        display: "flex",
        flexDirection: "column",
        maxHeight: "100%",
        border: isOver ? "2px solid #9C27B0" : "2px solid transparent",
        transition: "border-color 0.15s",
      }}
    >
      {/* Заголовок колонки */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 1,
          borderBottom: `1px solid ${BORDER_GRAY}`,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
          <Typography
            className="boardTitle"
            component={onRenameColumn ? "button" : "p"}
            type={onRenameColumn ? "button" : undefined}
            onClick={onRenameColumn ? () => onRenameColumn(column.id) : undefined}
            onKeyDown={
              onRenameColumn
                ? (e: KeyboardEvent) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRenameColumn(column.id);
                    }
                  }
                : undefined
            }
            tabIndex={onRenameColumn ? 0 : undefined}
            title={
              onRenameColumn
                ? locale === "en"
                  ? "Click to rename column"
                  : "Нажмите, чтобы переименовать колонку"
                : undefined
            }
            sx={{
              fontSize: 14,
              fontWeight: 600,
              color: TEXT_DARK,
              m: 0,
              p: 0,
              border: "none",
              background: "none",
              font: "inherit",
              textAlign: "left",
              cursor: onRenameColumn ? "pointer" : "default",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              ...(onRenameColumn
                ? {
                    "&:hover": { color: "var(--k-text)", textDecoration: "underline", textUnderlineOffset: 3 },
                    "&:focus-visible": { outline: "2px solid #9C27B0", outlineOffset: 2, borderRadius: 0.5 },
                  }
                : {}),
            }}
          >
            {column.name}
          </Typography>
          <Typography
            sx={{
              fontSize: 12,
              color: TEXT_GRAY,
              bgcolor: "rgba(127,127,127,0.12)",
              px: 0.75,
              py: 0.125,
              borderRadius: 1,
              fontWeight: 500,
            }}
          >
            {column.cards.length}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
          <IconButton
            size="small"
            onClick={onAddCard}
            sx={{ p: 0.5, color: TEXT_GRAY, "&:hover": { bgcolor: "var(--k-border)" } }}
          >
            <AddIcon sx={{ fontSize: 18 }} />
          </IconButton>
          <IconButton
            size="small"
            aria-label={locale === "en" ? "Column menu" : "Меню колонки"}
            onClick={(e) => {
              e.stopPropagation();
              onOpenColumnMenu?.(e.currentTarget, column.id);
            }}
            sx={{ p: 0.5, color: TEXT_GRAY, "&:hover": { bgcolor: "var(--k-border)" } }}
          >
            <MoreHorizIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>

      {/* Карточки */}
      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          p: 1,
          display: "flex",
          flexDirection: "column",
          gap: 1,
          minHeight: 100,
        }}
      >
        {children}
      </Box>

      {/* Кнопка добавления */}
      <Box sx={{ p: 1, pt: 0 }}>
        <Button
          fullWidth
          size="small"
          startIcon={<AddIcon />}
          onClick={onAddCard}
          sx={{
            justifyContent: "flex-start",
            textTransform: "none",
            color: TEXT_GRAY,
            fontSize: 13,
            py: 0.75,
            "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
          }}
        >
          {locale === "en" ? "Add card" : "Добавить карточку"}
        </Button>
      </Box>
    </Box>
  );
});

const TrackCellDroppable = memo(function TrackCellDroppable({
  droppableId,
  children,
  onAddCard,
  locale = "ru",
}: {
  droppableId: string;
  children: React.ReactNode;
  onAddCard?: () => void;
  locale?: "ru" | "en";
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  return (
    <Box
      ref={setNodeRef}
      sx={{
        p: 1,
        borderRadius: 1.5,
        border: isOver ? "2px solid #9C27B0" : "1px solid var(--k-border)",
        bgcolor: "var(--k-surface-bg)",
        minHeight: 120,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        transition: "border-color 0.15s",
        minWidth: 0,
      }}
    >
      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 1,
          minHeight: 48,
          pb: onAddCard ? 0.5 : 0,
        }}
      >
        {children}
      </Box>
      {onAddCard ? (
        <Box sx={{ pt: 0.5 }}>
          <Button
            fullWidth
            size="small"
            startIcon={<AddIcon />}
            onClick={onAddCard}
            sx={{
              justifyContent: "flex-start",
              textTransform: "none",
              color: TEXT_GRAY,
              fontSize: 13,
              py: 0.75,
              "&:hover": { bgcolor: "rgba(127,127,127,0.12)" },
            }}
          >
            {locale === "en" ? "Add card" : "Добавить карточку"}
          </Button>
        </Box>
      ) : null}
    </Box>
  );
});

export function KanbanBoard({
  boardId,
  token,
  activeSpaceId,
  refreshToken,
  filters,
  onCreateCard,
  locale = "ru",
  highlightColumnId,
}: {
  boardId: string;
  token: string;
  activeSpaceId?: string | null;
  refreshToken?: number;
  filters?: KanbanFilters;
  onCreateCard?: (columnId: string, options?: { trackId: string }) => void;
  locale?: "ru" | "en";
  /** Подсветка и прокрутка к колонке (например из ?column=uuid в URL) */
  highlightColumnId?: string | null;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const canManageColumns = Boolean(onCreateCard);

  const [grid, setGrid] = useState<BoardGrid | null>(null);
  const [loading, setLoading] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const wsUrl = getWsUrl(`/ws/boards/${boardId}/?token=${encodeURIComponent(token)}`);

  const fetchGrid = useCallback(
    async (nextBoardId: string) => {
      const res = await fetch(getApiUrl(`/api/kanban/boards/${nextBoardId}/grid`), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as BoardGrid;
      setGrid(data);
      setLoading(false);
    },
    [token]
  );

  useEffect(() => {
    fetchGrid(boardId);
  }, [boardId, fetchGrid, refreshToken]);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [boardNotice, setBoardNotice] = useState<string | null>(null);
  const lastOverIdRef = useRef<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<CardDetail | null>(null);
  const [favoriteCardIds, setFavoriteCardIds] = useState<string[]>([]);
  const [boardMembers, setBoardMembers] = useState<OrgMember[]>([]);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const [createColumnBusy, setCreateColumnBusy] = useState(false);
  const [createTrackBusy, setCreateTrackBusy] = useState(false);
  const [hiddenTrackIds, setHiddenTrackIds] = useState<string[]>([]);
  /** prompt() в Cursor/встроенном браузере часто неблокирующий и сразу даёт null — переименование через Dialog */
  const [renameColumnDialog, setRenameColumnDialog] = useState<{ columnId: string; name: string } | null>(null);
  const [renameColumnBusy, setRenameColumnBusy] = useState(false);
  const [renameTrackDialog, setRenameTrackDialog] = useState<{ trackId: string; name: string } | null>(null);
  const [renameTrackBusy, setRenameTrackBusy] = useState(false);

  const [columnMenuAnchor, setColumnMenuAnchor] = useState<null | HTMLElement>(null);
  const [columnMenuColumnId, setColumnMenuColumnId] = useState<string | null>(null);
  const [typeMenuAnchor, setTypeMenuAnchor] = useState<null | HTMLElement>(null);
  const [notifyColumnEnabled, setNotifyColumnEnabled] = useState(false);
  const [wipDialogOpen, setWipDialogOpen] = useState(false);
  const [wipDraft, setWipDraft] = useState("");
  const [wipBusy, setWipBusy] = useState(false);
  const [cardsDialogColumnId, setCardsDialogColumnId] = useState<string | null>(null);
  const [rulesDialogColumnId, setRulesDialogColumnId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("kaiten_favorite_cards");
      const parsed = raw ? (JSON.parse(raw) as string[]) : [];
      if (Array.isArray(parsed)) setFavoriteCardIds(parsed);
    } catch {
      // ignore
    }
  }, []);

  const activeCard = useMemo(() => {
    if (!grid || !activeCardId) return null;
    const plainCardId = activeCardId.startsWith("card:") ? activeCardId.slice("card:".length) : activeCardId;
    for (const c of grid.columns) {
      const found = c.cards.find((x) => x.id === plainCardId);
      if (found) return found;
    }
    return null;
  }, [grid, activeCardId]);

  const normalizedFilters = useMemo(() => {
    return {
      query: (filters?.query ?? "").trim().toLowerCase(),
      titleOnly: Boolean(filters?.titleOnly),
      status: filters?.status ?? "all",
    };
  }, [filters]);

  const visibleColumns = useMemo(() => {
    if (!grid) return [];

    const query = normalizedFilters.query;
    const titleOnly = normalizedFilters.titleOnly;
    const status = normalizedFilters.status;

    const hasQuery = query.length > 0;
    const hasStatusFilter = status !== "all";

    const sourceColumns =
      grid.effective_role === "executor"
        ? grid.columns.filter((col) => col.name.trim() !== "Задачи")
        : grid.columns;
    if (!hasQuery && !hasStatusFilter) return sourceColumns;

    return sourceColumns.map((col) => {
      let cards = col.cards;

      if (hasStatusFilter) {
        const colMatches = status === "done" ? col.is_done : !col.is_done;
        if (!colMatches) cards = [];
      }

      if (hasQuery) {
        cards = cards.filter((card) => {
          const titleMatch = card.title.toLowerCase().includes(query);
          if (titleOnly) return titleMatch;
          const descMatch = (card.description ?? "").toLowerCase().includes(query);
          return titleMatch || descMatch;
        });
      }

      return { ...col, cards };
    });
  }, [grid, normalizedFilters]);

  const createTrack = useCallback(async () => {
    if (createTrackBusy || !grid) return;
    const name = window.prompt(locale === "en" ? "Track name" : "Название дорожки", locale === "en" ? "New track" : "Новая дорожка");
    if (!name || !name.trim()) return;
    setCreateTrackBusy(true);
    try {
      const res = await fetch(getApiUrl(`/api/kanban/boards/${grid.board.id}/tracks`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
        },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { detail?: string } | null;
      if (!res.ok) throw new Error(data?.detail ?? (locale === "en" ? "Could not create track" : "Не удалось создать дорожку"));
      await fetchGrid(grid.board.id);
    } catch (e: any) {
      setBoardNotice(e?.message ?? (locale === "en" ? "Could not create track" : "Не удалось создать дорожку"));
    } finally {
      setCreateTrackBusy(false);
    }
  }, [createTrackBusy, grid, token, activeSpaceId, locale, fetchGrid]);

  const loadCardDetails = useCallback(
    async (cardId: string) => {
      setSelectedLoading(true);
      setSelectedError(null);
      try {
        const res = await fetch(getApiUrl(`/api/kanban/cards/${cardId}`), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as CardDetail;
        if (!res.ok) throw new Error((data as any)?.detail ?? "Не удалось загрузить карточку");
        setSelectedCard({ ...data, is_favorite: favoriteCardIds.includes(cardId) });
        setSelectedCardId(cardId);
        await fetch(getApiUrl(`/api/kanban/cards/${cardId}/comments/mark-read`), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
          },
        }).catch(() => null);
        await fetchGrid(boardId);
      } catch (e: any) {
        setSelectedError(e?.message ?? "Ошибка загрузки карточки");
      } finally {
        setSelectedLoading(false);
      }
    },
    [token, favoriteCardIds, activeSpaceId, fetchGrid, boardId]
  );

  const toggleFavorite = useCallback((cardId: string) => {
    setFavoriteCardIds((prev) => {
      const exists = prev.includes(cardId);
      const next = exists ? prev.filter((id) => id !== cardId) : [...prev, cardId];
      try {
        localStorage.setItem("kaiten_favorite_cards", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!selectedCardId || !activeSpaceId) return;
    fetch(getApiUrl("/api/auth/users"), {
      headers: { Authorization: `Bearer ${token}`, "X-Space-Id": activeSpaceId },
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => [])) as OrgMember[] | { detail?: string };
        if (!res.ok || !Array.isArray(data)) return;
        setBoardMembers(data);
      })
      .catch(() => {
        // ignore
      });
  }, [selectedCardId, activeSpaceId, token]);

  const createColumn = useCallback(async () => {
    if (createColumnBusy || !grid) return;
    const name = window.prompt(locale === "en" ? "Column name" : "Название колонки", locale === "en" ? "New column" : "Новая колонка");
    if (!name || !name.trim()) return;
    setCreateColumnBusy(true);
    try {
      const res = await fetch(getApiUrl(`/api/kanban/boards/${grid.board.id}/columns`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
        },
        body: JSON.stringify({ name: name.trim(), is_done: false }),
      });
      const data = (await res.json().catch(() => null)) as { detail?: string } | null;
      if (!res.ok) throw new Error(data?.detail ?? (locale === "en" ? "Could not create column" : "Не удалось создать колонку"));
      await fetchGrid(grid.board.id);
    } catch (e: any) {
      setBoardNotice(e?.message ?? (locale === "en" ? "Could not create column" : "Не удалось создать колонку"));
    } finally {
      setCreateColumnBusy(false);
    }
  }, [createColumnBusy, grid, token, activeSpaceId, locale, fetchGrid]);

  const openRenameColumnDialog = useCallback(
    (columnId: string) => {
      if (!grid) return;
      const col = grid.columns.find((c) => c.id === columnId);
      setBoardNotice(null);
      setRenameColumnDialog({ columnId, name: col?.name ?? "" });
    },
    [grid]
  );

  const submitRenameColumn = useCallback(async () => {
    if (!renameColumnDialog || !grid) return;
    const nextName = renameColumnDialog.name.trim();
    if (!nextName) return;
    const columnId = renameColumnDialog.columnId;
    setRenameColumnBusy(true);
    try {
      const res = await fetch(getApiUrl(`/api/kanban/columns/${columnId}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
        },
        body: JSON.stringify({ name: nextName }),
      });
      const data = (await res.json().catch(() => null)) as { detail?: string } | null;
      if (!res.ok) {
        throw new Error(data?.detail ?? (locale === "en" ? "Could not rename column" : "Не удалось переименовать колонку"));
      }
      setRenameColumnDialog(null);
      await fetchGrid(grid.board.id);
    } catch (e: any) {
      setBoardNotice(e?.message ?? (locale === "en" ? "Could not rename column" : "Не удалось переименовать колонку"));
    } finally {
      setRenameColumnBusy(false);
    }
  }, [renameColumnDialog, grid, locale, token, activeSpaceId, fetchGrid]);

  const openRenameTrackDialog = useCallback((trackId: string, currentName: string) => {
    setBoardNotice(null);
    setRenameTrackDialog({ trackId, name: currentName });
  }, []);

  const submitRenameTrack = useCallback(async () => {
    if (!renameTrackDialog || !grid) return;
    const nextName = renameTrackDialog.name.trim();
    if (!nextName) return;
    const trackId = renameTrackDialog.trackId;
    setRenameTrackBusy(true);
    try {
      const res = await fetch(getApiUrl(`/api/kanban/tracks/${trackId}`), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
        },
        body: JSON.stringify({ name: nextName }),
      });
      const data = (await res.json().catch(() => null)) as { detail?: string } | null;
      if (!res.ok) {
        throw new Error(data?.detail ?? (locale === "en" ? "Could not rename track" : "Не удалось переименовать дорожку"));
      }
      setRenameTrackDialog(null);
      await fetchGrid(grid.board.id);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setBoardNotice(msg || (locale === "en" ? "Could not rename track" : "Не удалось переименовать дорожку"));
    } finally {
      setRenameTrackBusy(false);
    }
  }, [renameTrackDialog, grid, locale, token, activeSpaceId, fetchGrid]);

  const closeColumnMenu = useCallback(() => {
    setColumnMenuAnchor(null);
    setColumnMenuColumnId(null);
    setTypeMenuAnchor(null);
  }, []);

  const openColumnMenu = useCallback(
    (anchor: HTMLElement, columnId: string) => {
      setBoardNotice(null);
      setColumnMenuAnchor(anchor);
      setColumnMenuColumnId(columnId);
      setTypeMenuAnchor(null);
      try {
        setNotifyColumnEnabled(localStorage.getItem(columnNotifyStorageKey(boardId, columnId)) === "1");
      } catch {
        setNotifyColumnEnabled(false);
      }
    },
    [boardId]
  );

  const patchColumnIsDone = useCallback(
    async (columnId: string, is_done: boolean) => {
      if (!grid) return;
      try {
        const res = await fetch(getApiUrl(`/api/kanban/columns/${columnId}`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
          },
          body: JSON.stringify({ is_done }),
        });
        const data = (await res.json().catch(() => null)) as { detail?: string } | null;
        if (!res.ok) {
          throw new Error(
            data?.detail ?? (locale === "en" ? "Could not update column" : "Не удалось обновить колонку")
          );
        }
        closeColumnMenu();
        await fetchGrid(grid.board.id);
      } catch (e: any) {
        setBoardNotice(e?.message ?? (locale === "en" ? "Could not update column" : "Не удалось обновить колонку"));
      }
    },
    [grid, token, activeSpaceId, locale, fetchGrid, closeColumnMenu]
  );

  const reorderColumn = useCallback(
    async (direction: "left" | "right") => {
      if (!grid || !columnMenuColumnId) return;
      const cid = columnMenuColumnId;
      try {
        const res = await fetch(getApiUrl(`/api/kanban/columns/${cid}/reorder`), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
          },
          body: JSON.stringify({ direction }),
        });
        const data = (await res.json().catch(() => null)) as { detail?: string } | null;
        if (!res.ok) {
          const d = data?.detail;
          if (d === "already_first" || d === "already_last") {
            closeColumnMenu();
            return;
          }
          throw new Error(
            typeof d === "string" ? d : locale === "en" ? "Could not reorder column" : "Не удалось переместить колонку"
          );
        }
        closeColumnMenu();
        await fetchGrid(grid.board.id);
      } catch (e: any) {
        setBoardNotice(e?.message ?? (locale === "en" ? "Could not reorder column" : "Не удалось переместить колонку"));
      }
    },
    [grid, columnMenuColumnId, token, activeSpaceId, locale, fetchGrid, closeColumnMenu]
  );

  const copyColumnLink = useCallback(async () => {
    if (!columnMenuColumnId || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("board", boardId);
      url.searchParams.set("column", columnMenuColumnId);
      await navigator.clipboard.writeText(url.toString());
      setBoardNotice(locale === "en" ? "Link copied to clipboard" : "Ссылка скопирована в буфер");
      closeColumnMenu();
    } catch {
      setBoardNotice(locale === "en" ? "Could not copy link" : "Не удалось скопировать ссылку");
    }
  }, [columnMenuColumnId, boardId, locale, closeColumnMenu]);

  const openWipDialog = useCallback(() => {
    if (!grid || !columnMenuColumnId) return;
    const col = grid.columns.find((c) => c.id === columnMenuColumnId);
    setWipDraft(col?.wip_limit != null ? String(col.wip_limit) : "");
    setWipDialogOpen(true);
    closeColumnMenu();
  }, [grid, columnMenuColumnId, closeColumnMenu]);

  const submitWipLimit = useCallback(
    async (limit: number | null) => {
      if (!grid || !columnMenuColumnId) return;
      setWipBusy(true);
      try {
        const res = await fetch(getApiUrl(`/api/kanban/columns/${columnMenuColumnId}/wip-limit`), {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
          },
          body: JSON.stringify({ limit }),
        });
        const data = (await res.json().catch(() => null)) as { detail?: string } | null;
        if (!res.ok) {
          throw new Error(
            data?.detail ?? (locale === "en" ? "Could not save WIP limit" : "Не удалось сохранить лимит WIP")
          );
        }
        setWipDialogOpen(false);
        await fetchGrid(grid.board.id);
      } catch (e: any) {
        setBoardNotice(e?.message ?? (locale === "en" ? "Could not save WIP limit" : "Не удалось сохранить лимит WIP"));
      } finally {
        setWipBusy(false);
      }
    },
    [grid, columnMenuColumnId, token, activeSpaceId, locale, fetchGrid]
  );

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as {
          type?: string;
          payload?: { from_column_id?: string; to_column_id?: string; card?: { title?: string } };
        };
        if (payload.type === "card_moved") {
          const inner = payload.payload;
          if (inner) {
            const { from_column_id: from, to_column_id: to, card } = inner;
            let alerted = false;
            try {
              for (const colId of [from, to]) {
                if (
                  colId &&
                  typeof window !== "undefined" &&
                  localStorage.getItem(columnNotifyStorageKey(boardId, colId)) === "1"
                ) {
                  alerted = true;
                  break;
                }
              }
            } catch {
              // ignore
            }
            if (alerted) {
              const t = card?.title?.trim() || "";
              setBoardNotice(
                locale === "en"
                  ? `Card moved${t ? `: ${t}` : ""}`
                  : `Карточка перемещена${t ? `: ${t}` : ""}`
              );
            }
          }
          fetchGrid(boardId);
        }
      } catch {
        // ignore
      }
    };
    return () => {
      ws.close();
    };
  }, [wsUrl, boardId, fetchGrid, locale]);

  useEffect(() => {
    if (!highlightColumnId || loading || !grid) return;
    const handle = window.setTimeout(() => {
      document.querySelector(`[data-column-id="${highlightColumnId}"]`)?.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [highlightColumnId, loading, grid]);

  const optimisticMoveCard = useCallback(
    async (cardId: string, toColumnId: string, toTrackId: string | null = null) => {
      if (!grid) return;

      const prev = structuredClone(grid) as BoardGrid;

      setGrid({
        ...grid,
        columns: grid.columns.map((col) => {
          if (col.id === toColumnId) {
            const card = prev.columns.flatMap((c) => c.cards).find((x) => x.id === cardId);
            if (!card) return col;
            return { ...col, cards: [{ ...card, column_id: toColumnId, track_id: toTrackId }, ...col.cards] };
          }
          return { ...col, cards: col.cards.filter((x) => x.id !== cardId) };
        }),
      });

      try {
        const res = await fetch(getApiUrl(`/api/kanban/cards/${cardId}/move`), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
          },
          body: JSON.stringify({ to_column_id: toColumnId, to_track_id: toTrackId }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { detail?: string } | null;
          const msg =
            typeof data?.detail === "string"
              ? data.detail
              : locale === "en"
                ? "Could not move card"
                : "Не удалось переместить карточку";
          setBoardNotice(msg);
          setGrid(prev);
          return;
        }
        await fetchGrid(grid.board.id);
      } catch {
        setBoardNotice(locale === "en" ? "Could not move card" : "Не удалось переместить карточку");
        setGrid(prev);
      }
    },
    [grid, token, activeSpaceId, locale, fetchGrid]
  );

  const menuColumn = useMemo(() => {
    if (!columnMenuColumnId || !grid) return undefined;
    return grid.columns.find((c) => c.id === columnMenuColumnId);
  }, [grid, columnMenuColumnId]);

  const cardsDialogColumn = useMemo(() => {
    if (!cardsDialogColumnId || !grid) return undefined;
    return grid.columns.find((c) => c.id === cardsDialogColumnId);
  }, [grid, cardsDialogColumnId]);

  const rulesDialogColumn = useMemo(() => {
    if (!rulesDialogColumnId || !grid) return undefined;
    return grid.columns.find((c) => c.id === rulesDialogColumnId);
  }, [grid, rulesDialogColumnId]);

  const menuPaperSx = {
    bgcolor: "var(--k-surface-bg)",
    color: "var(--k-text)",
    border: "1px solid var(--k-border)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  } as const;

  const hasTracksLayout = (grid?.tracks?.length ?? 0) > 0;
  const firstTrackId = grid?.tracks?.[0]?.id ?? null;
  const getCardsForTrackColumn = useCallback(
    (column: Column, trackId: string) => {
      return column.cards.filter((card) => {
        if (card.track_id) return card.track_id === trackId;
        return trackId === firstTrackId;
      });
    },
    [firstTrackId]
  );

  const toggleTrackVisibility = useCallback((trackId: string) => {
    setHiddenTrackIds((prev) => (prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]));
  }, []);

  const removeTrack = useCallback(
    async (trackId: string) => {
      if (!grid) return;
      const ok = window.confirm(locale === "en" ? "Delete track?" : "Удалить дорожку?");
      if (!ok) return;
      const res = await fetch(getApiUrl(`/api/kanban/tracks/${trackId}`), {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
        },
      });
      const data = (await res.json().catch(() => null)) as { detail?: string } | null;
      if (!res.ok) throw new Error(data?.detail ?? (locale === "en" ? "Could not delete track" : "Не удалось удалить дорожку"));
      setHiddenTrackIds((prev) => prev.filter((id) => id !== trackId));
      await fetchGrid(grid.board.id);
    },
    [grid, token, activeSpaceId, locale, fetchGrid]
  );

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Dialog
        open={Boolean(renameColumnDialog)}
        onClose={() => {
          if (!renameColumnBusy) setRenameColumnDialog(null);
        }}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: { bgcolor: "var(--k-surface-bg)", color: "var(--k-text)", border: "1px solid var(--k-border)" },
        }}
      >
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
          {locale === "en" ? "Rename column" : "Переименовать колонку"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={locale === "en" ? "Column name" : "Название колонки"}
            value={renameColumnDialog?.name ?? ""}
            onChange={(e) =>
              setRenameColumnDialog((prev) => (prev ? { ...prev, name: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && renameColumnDialog?.name.trim() && !renameColumnBusy) {
                e.preventDefault();
                void submitRenameColumn();
              }
            }}
            disabled={renameColumnBusy}
            slotProps={{
              input: { sx: { color: "var(--k-text)" } },
            }}
            sx={{
              mt: 0.5,
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
              "& label": { color: "var(--k-text-muted)" },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setRenameColumnDialog(null)}
            disabled={renameColumnBusy}
            sx={{ color: "var(--k-text-muted)" }}
          >
            {locale === "en" ? "Cancel" : "Отмена"}
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitRenameColumn()}
            disabled={!renameColumnDialog?.name.trim() || renameColumnBusy}
            sx={{
              bgcolor: "#9C27B0",
              "&:hover": { bgcolor: "#7B1FA2" },
            }}
          >
            {renameColumnBusy
              ? locale === "en"
                ? "Saving..."
                : "Сохранение..."
              : locale === "en"
                ? "Save"
                : "Сохранить"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(renameTrackDialog)}
        onClose={() => {
          if (!renameTrackBusy) setRenameTrackDialog(null);
        }}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: { bgcolor: "var(--k-surface-bg)", color: "var(--k-text)", border: "1px solid var(--k-border)" },
        }}
      >
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
          {locale === "en" ? "Rename track" : "Переименовать дорожку"}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={locale === "en" ? "Track name" : "Название дорожки"}
            value={renameTrackDialog?.name ?? ""}
            onChange={(e) =>
              setRenameTrackDialog((prev) => (prev ? { ...prev, name: e.target.value } : null))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && renameTrackDialog?.name.trim() && !renameTrackBusy) {
                e.preventDefault();
                void submitRenameTrack();
              }
            }}
            disabled={renameTrackBusy}
            slotProps={{
              input: { sx: { color: "var(--k-text)" } },
            }}
            sx={{
              mt: 0.5,
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
              "& label": { color: "var(--k-text-muted)" },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setRenameTrackDialog(null)}
            disabled={renameTrackBusy}
            sx={{ color: "var(--k-text-muted)" }}
          >
            {locale === "en" ? "Cancel" : "Отмена"}
          </Button>
          <Button
            variant="contained"
            onClick={() => void submitRenameTrack()}
            disabled={!renameTrackDialog?.name.trim() || renameTrackBusy}
            sx={{
              bgcolor: "#9C27B0",
              "&:hover": { bgcolor: "#7B1FA2" },
            }}
          >
            {renameTrackBusy
              ? locale === "en"
                ? "Saving..."
                : "Сохранение..."
              : locale === "en"
                ? "Save"
                : "Сохранить"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={wipDialogOpen}
        onClose={() => !wipBusy && setWipDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { ...menuPaperSx } }}
      >
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
          {locale === "en" ? "WIP limit" : "Ограничение НЗП (WIP)"}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "var(--k-text-muted)", mb: 1.5 }}>
            {locale === "en"
              ? "Max cards in this column (excluding done columns). Empty + Remove = no limit."
              : "Максимум карточек в колонке (не действует для колонок «завершено»). Пусто + «Снять» — без лимита."}
          </Typography>
          <TextField
            fullWidth
            type="number"
            inputProps={{ min: 0 }}
            label={locale === "en" ? "Card limit" : "Лимит карточек"}
            value={wipDraft}
            onChange={(e) => setWipDraft(e.target.value)}
            disabled={wipBusy}
            slotProps={{ input: { sx: { color: "var(--k-text)" } } }}
            sx={{
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
              "& label": { color: "var(--k-text-muted)" },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, flexWrap: "wrap", gap: 1 }}>
          <Button onClick={() => setWipDialogOpen(false)} disabled={wipBusy} sx={{ color: "var(--k-text-muted)" }}>
            {locale === "en" ? "Cancel" : "Отмена"}
          </Button>
          <Button
            onClick={() => void submitWipLimit(null)}
            disabled={wipBusy}
            sx={{ color: "var(--k-text-muted)" }}
          >
            {locale === "en" ? "Remove limit" : "Снять лимит"}
          </Button>
          <Button
            variant="contained"
            disabled={wipBusy}
            onClick={() => {
              const t = wipDraft.trim();
              if (!t) {
                setBoardNotice(locale === "en" ? "Enter a number" : "Введите число");
                return;
              }
              const n = parseInt(t, 10);
              if (Number.isNaN(n) || n < 0) {
                setBoardNotice(locale === "en" ? "Invalid number" : "Некорректное число");
                return;
              }
              void submitWipLimit(n);
            }}
            sx={{ bgcolor: "#9C27B0", "&:hover": { bgcolor: "#7B1FA2" } }}
          >
            {wipBusy
              ? locale === "en"
                ? "Saving..."
                : "Сохранение..."
              : locale === "en"
                ? "Save"
                : "Сохранить"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(cardsDialogColumn)}
        onClose={() => setCardsDialogColumnId(null)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { ...menuPaperSx } }}
      >
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
          {locale === "en" ? "Cards in column" : "Управление карточками"}
          {cardsDialogColumn ? ` — ${cardsDialogColumn.name}` : ""}
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          {cardsDialogColumn && cardsDialogColumn.cards.length === 0 ? (
            <Typography sx={{ color: "var(--k-text-muted)", py: 2 }}>
              {locale === "en" ? "No cards" : "Нет карточек"}
            </Typography>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxHeight: 360, overflow: "auto", pt: 1 }}>
              {cardsDialogColumn?.cards.map((card) => (
                <Button
                  key={card.id}
                  fullWidth
                  onClick={() => {
                    setCardsDialogColumnId(null);
                    void loadCardDetails(card.id);
                  }}
                  sx={{
                    justifyContent: "flex-start",
                    textTransform: "none",
                    color: "var(--k-text)",
                    border: "1px solid var(--k-border)",
                    borderRadius: 1,
                    py: 1,
                    px: 1.5,
                    "&:hover": { bgcolor: "rgba(156,39,176,0.12)" },
                  }}
                >
                  <Typography sx={{ fontSize: 14, fontWeight: 500, textAlign: "left", width: "100%" }}>
                    {card.title}
                  </Typography>
                </Button>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCardsDialogColumnId(null)} sx={{ color: "var(--k-text-muted)" }}>
            {locale === "en" ? "Close" : "Закрыть"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(rulesDialogColumn)}
        onClose={() => setRulesDialogColumnId(null)}
        fullWidth
        maxWidth="sm"
        PaperProps={{ sx: { ...menuPaperSx } }}
      >
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
          {locale === "en" ? "Column rules" : "Правила колонки"}
          {rulesDialogColumn ? ` — ${rulesDialogColumn.name}` : ""}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 14, color: "var(--k-text-muted)", mb: 1.5 }}>
            {locale === "en" ? "WIP limit" : "Лимит WIP"}:{" "}
            <strong style={{ color: "var(--k-text)" }}>
              {rulesDialogColumn?.wip_limit != null ? rulesDialogColumn.wip_limit : locale === "en" ? "none" : "не задан"}
            </strong>
          </Typography>
          <Typography sx={{ fontSize: 14, color: "var(--k-text-muted)", mb: 1.5 }}>
            {locale === "en" ? "Column type" : "Тип"}:{" "}
            <strong style={{ color: "var(--k-text)" }}>
              {rulesDialogColumn?.is_done
                ? locale === "en"
                  ? "Done (WIP not enforced)"
                  : "Завершение (лимит WIP не применяется)"
                : locale === "en"
                  ? "Working (WIP enforced if set)"
                  : "Рабочая (лимит WIP учитывается при переносе)"}
            </strong>
          </Typography>
          <Typography sx={{ fontSize: 13, color: "var(--k-text-muted)" }}>
            {locale === "en"
              ? "Moving a card via drag checks the target column limit. Card automation rules can be extended on the server."
              : "При переносе карточки проверяется лимит целевой колонки. Расширенные правила автоматизаций можно добавить на сервере."}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRulesDialogColumnId(null)} sx={{ color: "var(--k-text-muted)" }}>
            {locale === "en" ? "Close" : "Закрыть"}
          </Button>
        </DialogActions>
      </Dialog>

      <Menu
        anchorEl={columnMenuAnchor}
        open={Boolean(columnMenuAnchor)}
        onClose={closeColumnMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 300,
              maxWidth: 400,
              maxHeight: "min(520px, 82vh)",
              overflow: "auto",
              ...menuPaperSx,
            },
          },
        }}
      >
        <ListSubheader
          sx={{
            bgcolor: "var(--k-surface-bg)",
            color: "var(--k-text)",
            fontSize: 15,
            fontWeight: 800,
            lineHeight: 1.3,
            py: 1.25,
          }}
        >
          {menuColumn?.name ?? "—"}
        </ListSubheader>
        <Typography
          component="div"
          variant="caption"
          sx={{ px: 2, pb: 1, pt: 0, color: "var(--k-text-muted)", display: "block" }}
        >
          {menuColumn?.is_done
            ? locale === "en"
              ? "Done column"
              : "Колонка завершения"
            : locale === "en"
              ? "Working column (queue)"
              : "Рабочая колонка (очередь)"}
        </Typography>
        <Divider sx={{ borderColor: "var(--k-border)" }} />

        {canManageColumns ? (
          <MenuItem
            onClick={() => {
              if (columnMenuColumnId) openRenameColumnDialog(columnMenuColumnId);
              closeColumnMenu();
            }}
          >
            <ListItemIcon>
              <EditOutlinedIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
            </ListItemIcon>
            <ListItemText primary={locale === "en" ? "Rename" : "Переименовать"} />
          </MenuItem>
        ) : null}

        <MenuItem onClick={() => void copyColumnLink()}>
          <ListItemIcon>
            <LinkIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
          </ListItemIcon>
          <ListItemText primary={locale === "en" ? "Copy link" : "Скопировать ссылку"} />
        </MenuItem>

        <MenuItem
          onClick={() => {
            if (columnMenuColumnId) setCardsDialogColumnId(columnMenuColumnId);
            closeColumnMenu();
          }}
        >
          <ListItemIcon>
            <ViewColumnIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
          </ListItemIcon>
          <ListItemText primary={locale === "en" ? "Manage cards" : "Управление карточками"} />
        </MenuItem>

        {canManageColumns ? (
          <MenuItem onClick={openWipDialog}>
            <ListItemIcon>
              <SpeedIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
            </ListItemIcon>
            <ListItemText
              primary={locale === "en" ? "Set WIP limit" : "Установить ограничение НЗП (WIP)"}
            />
          </MenuItem>
        ) : null}

        {canManageColumns ? (
          <>
            <MenuItem onClick={() => void reorderColumn("left")}>
              <ListItemIcon>
                <ChevronLeftIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
              </ListItemIcon>
              <ListItemText primary={locale === "en" ? "Move left" : "Переместить влево"} />
            </MenuItem>
            <MenuItem onClick={() => void reorderColumn("right")}>
              <ListItemIcon>
                <ChevronRightIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
              </ListItemIcon>
              <ListItemText primary={locale === "en" ? "Move right" : "Переместить вправо"} />
            </MenuItem>
          </>
        ) : null}

        <Divider sx={{ borderColor: "var(--k-border)", my: 0.5 }} />

        <Box
          sx={{ px: 2, py: 1 }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <FormControlLabel
            control={
              <Switch
                checked={notifyColumnEnabled}
                onChange={(_, v) => {
                  setNotifyColumnEnabled(v);
                  if (columnMenuColumnId) {
                    try {
                      localStorage.setItem(columnNotifyStorageKey(boardId, columnMenuColumnId), v ? "1" : "0");
                    } catch {
                      // ignore
                    }
                  }
                }}
                sx={{
                  "& .MuiSwitch-switchBase.Mui-checked": { color: "#9C27B0" },
                  "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { bgcolor: "rgba(156,39,176,0.5)" },
                }}
              />
            }
            label={locale === "en" ? "Notify me about moves" : "Информировать меня о перемещениях"}
            sx={{
              m: 0,
              width: "100%",
              alignItems: "center",
              "& .MuiFormControlLabel-label": { fontSize: 14, color: "var(--k-text)" },
            }}
          />
        </Box>

        {canManageColumns ? (
          <MenuItem
            onClick={(e) => {
              setTypeMenuAnchor(e.currentTarget);
            }}
          >
            <ListItemIcon>
              <CategoryOutlinedIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
            </ListItemIcon>
            <ListItemText primary={locale === "en" ? "Column type" : "Тип колонки"} />
            <Typography variant="caption" sx={{ color: "var(--k-text-muted)", ml: 1 }}>
              ›
            </Typography>
          </MenuItem>
        ) : null}

        <MenuItem
          onClick={() => {
            if (columnMenuColumnId) setRulesDialogColumnId(columnMenuColumnId);
            closeColumnMenu();
          }}
        >
          <ListItemIcon>
            <RuleFolderOutlinedIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
          </ListItemIcon>
          <ListItemText primary={locale === "en" ? "Rules" : "Правила"} />
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={typeMenuAnchor}
        open={Boolean(typeMenuAnchor)}
        onClose={() => setTypeMenuAnchor(null)}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              minWidth: 220,
              ...menuPaperSx,
            },
          },
        }}
      >
        <MenuItem
          disabled={menuColumn?.is_done === false}
          onClick={() => {
            if (menuColumn) void patchColumnIsDone(menuColumn.id, false);
            setTypeMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <ListAltOutlinedIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
          </ListItemIcon>
          <ListItemText primary={locale === "en" ? "Working column" : "Рабочая колонка"} />
        </MenuItem>
        <MenuItem
          disabled={menuColumn?.is_done === true}
          onClick={() => {
            if (menuColumn) void patchColumnIsDone(menuColumn.id, true);
            setTypeMenuAnchor(null);
          }}
        >
          <ListItemIcon>
            <DoneAllOutlinedIcon sx={{ fontSize: 20, color: "var(--k-text-muted)" }} />
          </ListItemIcon>
          <ListItemText primary={locale === "en" ? "Done column" : "Колонка завершения"} />
        </MenuItem>
      </Menu>

      {loading || !grid ? (
        <Box
          sx={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: TEXT_GRAY,
          }}
        >
          {locale === "en" ? "Loading board..." : "Загрузка доски..."}
        </Box>
      ) : hasTracksLayout ? (
        <DndContext
          sensors={sensors}
          collisionDetection={kanbanCollisionDetection}
          measuring={{
            droppable: { strategy: MeasuringStrategy.Always },
          }}
          onDragStart={(e) => {
            setActiveCardId(String(e.active.id));
            lastOverIdRef.current = null;
          }}
          onDragOver={(e) => {
            const overId = e.over?.id ? String(e.over.id) : null;
            if (overId) {
              lastOverIdRef.current = overId;
            }
          }}
          onDragEnd={(e) => {
            const overId = e.over?.id ? String(e.over.id) : lastOverIdRef.current;
            const activeIdStr = String(e.active.id);
            setActiveCardId(null);
            lastOverIdRef.current = null;

            if (!overId || !grid) return;
            if (!activeIdStr.startsWith("card:")) return;
            const cardId = activeIdStr.slice("card:".length);

            let toColumnId: string | null = null;
            let toTrackId: string | null = null;
            if (overId.startsWith("trackcol:")) {
              const [, trackId, columnId] = overId.split(":");
              toColumnId = columnId || null;
              toTrackId = trackId || null;
            } else if (overId.startsWith("card:")) {
              const overCardId = overId.slice("card:".length);
              const hostColumn = grid.columns.find((col) => col.cards.some((c) => c.id === overCardId));
              const overCard = grid.columns.flatMap((col) => col.cards).find((c) => c.id === overCardId);
              toColumnId = hostColumn?.id || null;
              toTrackId = overCard?.track_id ?? firstTrackId ?? null;
            } else if (overId.startsWith("col:")) {
              toColumnId = overId.slice("col:".length);
              toTrackId = firstTrackId ?? null;
            }
            if (!toColumnId) return;

            const movingCard = grid.columns.flatMap((col) => col.cards).find((c) => c.id === cardId);
            const fromColumn = grid.columns.find((col) => col.cards.some((c) => c.id === cardId));
            const fromTrackId = movingCard?.track_id ?? firstTrackId ?? null;
            if (fromColumn?.id === toColumnId && fromTrackId === toTrackId) return;

            setBoardNotice(null);
            optimisticMoveCard(cardId, toColumnId, toTrackId);
          }}
          onDragCancel={() => {
            setActiveCardId(null);
            lastOverIdRef.current = null;
          }}
        >
        <Box
          id="boardsWrapper"
          sx={{
            p: 2,
            overflow: "auto",
            flex: 1,
            bgcolor: "var(--k-page-bg)",
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              minWidth: Math.max(980, visibleColumns.length * 280 + (canManageColumns ? 260 : 0)),
              flex: 1,
              minHeight: 0,
            }}
          >
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns:
                  visibleColumns.map(() => "minmax(260px, 1fr)").join(" ") +
                  (canManageColumns ? " minmax(220px, 280px)" : ""),
                gap: 1,
                mb: 1,
              }}
            >
              {visibleColumns.map((column) => (
                <Box
                  key={`head-${column.id}`}
                  sx={{
                    p: 2,
                    minHeight: 88,
                    borderRadius: 1.5,
                    border: "1px solid var(--k-border)",
                    bgcolor: "var(--k-surface-bg)",
                    color: "var(--k-text)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: { xs: 16, sm: 18 },
                      fontWeight: 800,
                      letterSpacing: "-0.02em",
                      lineHeight: 1.25,
                      textAlign: "center",
                      wordBreak: "break-word",
                      hyphens: "auto",
                    }}
                  >
                    {column.name}
                  </Typography>
                </Box>
              ))}
              {canManageColumns ? (
                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: 1.5,
                    border: "1px dashed var(--k-border)",
                    bgcolor: "var(--k-surface-bg)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 1,
                    justifyContent: "center",
                    minHeight: "100%",
                  }}
                >
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => void createColumn()}
                    disabled={createColumnBusy}
                    startIcon={<AddIcon />}
                    sx={{ textTransform: "none", color: "var(--k-text)", fontWeight: 600, justifyContent: "flex-start" }}
                  >
                    {createColumnBusy
                      ? locale === "en"
                        ? "Creating..."
                        : "Создание..."
                      : locale === "en"
                        ? "Add column"
                        : "Добавить колонку"}
                  </Button>
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => void createTrack()}
                    disabled={createTrackBusy}
                    startIcon={<AddIcon />}
                    sx={{ textTransform: "none", color: "var(--k-text)", fontWeight: 600, justifyContent: "flex-start" }}
                  >
                    {createTrackBusy
                      ? locale === "en"
                        ? "Creating..."
                        : "Создание..."
                      : locale === "en"
                        ? "Add row"
                        : "Добавить дорожку"}
                  </Button>
                </Box>
              ) : null}
            </Box>

            {grid!.tracks.map((track) => {
              const isHidden = hiddenTrackIds.includes(track.id);
              const cardsTotal = visibleColumns.reduce((sum, col) => sum + getCardsForTrackColumn(col, track.id).length, 0);
              return (
                <Box key={track.id} sx={{ mb: 1.25 }}>
                  <Box
                    sx={{
                      height: 42,
                      borderRadius: 1.25,
                      border: "1px solid var(--k-border)",
                      bgcolor: "var(--k-surface-bg)",
                      px: 1.5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Typography sx={{ fontSize: 13, fontWeight: 700, color: "var(--k-text)" }}>
                      {track.name} {cardsTotal}
                    </Typography>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <IconButton size="small" onClick={() => toggleTrackVisibility(track.id)} title={locale === "en" ? "Hide/show track" : "Скрыть/показать дорожку"}>
                        <VisibilityOffOutlinedIcon sx={{ fontSize: 17, color: "var(--k-text-muted)" }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => openRenameTrackDialog(track.id, track.name)}
                        title={locale === "en" ? "Rename track" : "Переименовать дорожку"}
                      >
                        <EditIcon sx={{ fontSize: 17, color: "var(--k-text-muted)" }} />
                      </IconButton>
                      <IconButton size="small" onClick={() => void removeTrack(track.id)} title={locale === "en" ? "Delete track" : "Удалить дорожку"}>
                        <DeleteOutlineIcon sx={{ fontSize: 17, color: "#d32f2f" }} />
                      </IconButton>
                    </Box>
                  </Box>
                  {!isHidden ? (
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns:
                          visibleColumns.map(() => "minmax(260px, 1fr)").join(" ") +
                          (canManageColumns ? " minmax(220px, 280px)" : ""),
                        gap: 1,
                        mt: 0.75,
                      }}
                    >
                      {visibleColumns.map((column) => {
                        const trackCards = getCardsForTrackColumn(column, track.id);
                        return (
                          <TrackCellDroppable
                            key={`${track.id}-${column.id}`}
                            droppableId={`trackcol:${track.id}:${column.id}`}
                            locale={locale}
                            onAddCard={
                              onCreateCard ? () => onCreateCard(column.id, { trackId: track.id }) : undefined
                            }
                          >
                            {trackCards.map((card) => (
                              <KanbanCard
                                key={card.id}
                                card={card}
                                token={token}
                                locale={locale}
                                onOpen={loadCardDetails}
                                isFavorite={favoriteCardIds.includes(card.id)}
                                priority={card.priority}
                                tags={card.tags}
                                assigneeName={card.assignee_name}
                                blockedCount={card.blocked_count}
                                blockingCount={card.blocking_count}
                                commentsCount={card.comments_count}
                                unreadCommentsCount={card.unread_comments_count}
                                attachmentsCount={card.attachments_count}
                                plannedEndAt={card.planned_end_at || card.due_at}
                              />
                            ))}
                          </TrackCellDroppable>
                        );
                      })}
                      {canManageColumns ? (
                        <Box
                          aria-hidden
                          sx={{
                            minHeight: 120,
                            borderRadius: 1.5,
                            border: "1px solid transparent",
                            bgcolor: "transparent",
                          }}
                        />
                      ) : null}
                    </Box>
                  ) : null}
                </Box>
              );
            })}
          </Box>
        </Box>
          <BoardDragOverlayPortal>
            <DragOverlay dropAnimation={null} zIndex={BOARD_DRAG_OVERLAY_Z}>
              {activeCard ? (
                <Box
                  sx={{
                    bgcolor: "var(--k-surface-bg)",
                    border: "1px solid #9C27B0",
                    borderRadius: 1.5,
                    p: 1.5,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                    maxWidth: 280,
                    transform: "rotate(3deg)",
                  }}
                >
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: TEXT_DARK }}>
                    {activeCard.title}
                  </Typography>
                </Box>
              ) : null}
            </DragOverlay>
          </BoardDragOverlayPortal>
        </DndContext>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={kanbanCollisionDetection}
          measuring={{
            droppable: { strategy: MeasuringStrategy.Always },
          }}
          onDragStart={(e) => {
            setActiveCardId(String(e.active.id));
            lastOverIdRef.current = null;
          }}
          onDragOver={(e) => {
            const overId = e.over?.id ? String(e.over.id) : null;
            if (overId) {
              lastOverIdRef.current = overId;
            }
          }}
          onDragEnd={(e) => {
            const overId = e.over?.id ? String(e.over.id) : lastOverIdRef.current;
            const activeIdStr = String(e.active.id);
            setActiveCardId(null);
            lastOverIdRef.current = null;

            if (!overId || !grid) return;
            if (!activeIdStr.startsWith("card:")) return;
            const cardId = activeIdStr.slice("card:".length);

            let toColumnId: string | null = null;
            if (overId.startsWith("col:")) {
              toColumnId = overId.slice("col:".length);
            } else if (overId.startsWith("card:")) {
              const overCardId = overId.slice("card:".length);
              const hostColumn = grid.columns.find((col) => col.cards.some((c) => c.id === overCardId));
              toColumnId = hostColumn?.id || null;
            }
            if (!toColumnId) return;

            const fromColumn = grid.columns.find((col) => col.cards.some((c) => c.id === cardId));
            if (fromColumn?.id === toColumnId) return;

            setBoardNotice(null);
            optimisticMoveCard(cardId, toColumnId);
          }}
          onDragCancel={() => {
            setActiveCardId(null);
            lastOverIdRef.current = null;
          }}
        >
          <Box
            id="boardsWrapper"
            sx={{
              display: "flex",
              gap: 2,
              p: 2,
              overflowX: "auto",
              overflowY: "hidden",
              flex: 1,
              alignItems: "flex-start",
            }}
          >
            {visibleColumns.map((column) => (
              <ColumnDroppable
                key={column.id}
                column={column}
                onAddCard={() => onCreateCard?.(column.id)}
                onRenameColumn={canManageColumns ? openRenameColumnDialog : undefined}
                onOpenColumnMenu={openColumnMenu}
                locale={locale}
              >
                {column.cards.map((card) => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    token={token}
                    locale={locale}
                    onOpen={loadCardDetails}
                    isFavorite={favoriteCardIds.includes(card.id)}
                    priority={card.priority}
                    tags={card.tags}
                    assigneeName={card.assignee_name}
                    blockedCount={card.blocked_count}
                    blockingCount={card.blocking_count}
                    commentsCount={card.comments_count}
                    unreadCommentsCount={card.unread_comments_count}
                    attachmentsCount={card.attachments_count}
                    plannedEndAt={card.planned_end_at || card.due_at}
                  />
                ))}
              </ColumnDroppable>
            ))}
            {onCreateCard ? (
              <Box
                sx={{
                  minWidth: 280,
                  maxWidth: 320,
                  minHeight: 140,
                  borderRadius: 2,
                  border: "1px dashed var(--k-border)",
                  bgcolor: "var(--k-surface-bg)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  p: 2,
                }}
              >
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%" }}>
                  <Button
                    variant="text"
                    onClick={createColumn}
                    disabled={createColumnBusy}
                    startIcon={<AddIcon />}
                    sx={{ textTransform: "none", color: "var(--k-text)", fontWeight: 600 }}
                  >
                    {createColumnBusy ? (locale === "en" ? "Creating..." : "Создание...") : locale === "en" ? "Add column" : "Добавить колонку"}
                  </Button>
                  <Button
                    variant="text"
                    onClick={createTrack}
                    disabled={createTrackBusy}
                    startIcon={<AddIcon />}
                    sx={{ textTransform: "none", color: "var(--k-text)", fontWeight: 600 }}
                  >
                    {createTrackBusy ? (locale === "en" ? "Creating..." : "Создание...") : locale === "en" ? "Add row" : "Добавить дорожку"}
                  </Button>
                </Box>
              </Box>
            ) : null}
          </Box>

          <BoardDragOverlayPortal>
            <DragOverlay dropAnimation={null} zIndex={BOARD_DRAG_OVERLAY_Z}>
              {activeCard ? (
                <Box
                  sx={{
                    bgcolor: "var(--k-surface-bg)",
                    border: "1px solid #9C27B0",
                    borderRadius: 1.5,
                    p: 1.5,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
                    maxWidth: 280,
                    transform: "rotate(3deg)",
                  }}
                >
                  <Typography sx={{ fontSize: 14, fontWeight: 500, color: TEXT_DARK }}>
                    {activeCard.title}
                  </Typography>
                </Box>
              ) : null}
            </DragOverlay>
          </BoardDragOverlayPortal>
        </DndContext>
      )}

      {selectedCard && (
        <CardModal
          card={selectedCard}
          isFavorite={favoriteCardIds.includes(selectedCard.id)}
          onToggleFavorite={() => toggleFavorite(selectedCard.id)}
          onCreateRelatedCard={() =>
            onCreateCard?.(
              selectedCard.column_id,
              selectedCard.track_id ? { trackId: selectedCard.track_id } : undefined
            )
          }
          users={boardMembers}
          availableColumns={grid?.columns.map((c) => ({ id: c.id, name: c.name, is_done: c.is_done })) || []}
          onUpdateCard={async (patch) => {
            if (!selectedCardId) return;
            const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCardId}`), {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
              },
              body: JSON.stringify(patch),
            });
            const data = (await res.json().catch(() => null)) as { detail?: string } | null;
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось обновить карточку");
            await loadCardDetails(selectedCardId);
            await fetchGrid(boardId);
          }}
          onDeleteCard={async () => {
            if (!selectedCardId) return;
            const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCardId}`), {
              method: "DELETE",
              headers: {
                Authorization: `Bearer ${token}`,
                ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
              },
            });
            const data = (await res.json().catch(() => null)) as { detail?: string } | null;
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось удалить карточку");
            setSelectedCard(null);
            setSelectedCardId(null);
            await fetchGrid(boardId);
          }}
          onUpsertFieldValue={async (payload) => {
            if (!selectedCardId) return;
            const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCardId}/field-values`), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
              },
              body: JSON.stringify(payload),
            });
            const data = (await res.json().catch(() => null)) as { detail?: string } | null;
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось обновить поле");
            await loadCardDetails(selectedCardId);
            await fetchGrid(boardId);
          }}
          onClose={() => {
            setSelectedCard(null);
            setSelectedCardId(null);
            setSelectedError(null);
          }}
          onAddChecklist={async (title) => {
            if (!selectedCardId) return;
            setSelectedError(null);
            try {
              const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCardId}/checklists`), {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                },
                body: JSON.stringify({ title }),
              });
              const data = await res.json().catch(() => null);
              if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать чек-лист");
              await loadCardDetails(selectedCardId);
              await fetchGrid(boardId);
              if (data && typeof data === "object" && "id" in data && typeof data.id === "string") {
                return { id: data.id };
              }
            } catch (e: any) {
              setSelectedError(e?.message ?? "Не удалось создать чек-лист");
            }
          }}
          onAddChecklistItem={async (checklistId, title) => {
            if (!selectedCardId) return;
            setSelectedError(null);
            try {
              const res = await fetch(getApiUrl(`/api/kanban/checklists/${checklistId}/items`), {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                },
                body: JSON.stringify({ title }),
              });
              const data = await res.json().catch(() => null);
              if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать пункт");
              await loadCardDetails(selectedCardId);
              await fetchGrid(boardId);
            } catch (e: any) {
              setSelectedError(e?.message ?? "Не удалось создать пункт");
            }
          }}
          onToggleChecklistItem={async (itemId, isDone) => {
            if (!selectedCardId) return;
            setSelectedError(null);
            try {
              const res = await fetch(getApiUrl(`/api/kanban/checklist-items/${itemId}`), {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                },
                body: JSON.stringify({ is_done: isDone }),
              });
              const data = await res.json().catch(() => null);
              if (!res.ok) throw new Error(data?.detail ?? "Не удалось обновить пункт");
              await loadCardDetails(selectedCardId);
              await fetchGrid(boardId);
            } catch (e: any) {
              setSelectedError(e?.message ?? "Не удалось обновить пункт");
            }
          }}
          onAddComment={async (body) => {
            if (!selectedCardId) return;
            setSelectedError(null);
            try {
              const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCardId}/comments`), {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                },
                body: JSON.stringify({ body }),
              });
              if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail ?? "Не удалось отправить комментарий");
              }
              await loadCardDetails(selectedCardId);
            } catch (e: any) {
              setSelectedError(e?.message ?? "Не удалось отправить комментарий");
            }
          }}
          onUploadAttachment={async (file) => {
            if (!selectedCardId) return;
            setSelectedError(null);
            try {
              const form = new FormData();
              form.append("file", file);
              const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCardId}/attachments`), {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                },
                body: form,
              });
              if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail ?? "Не удалось загрузить файл");
              }
              await loadCardDetails(selectedCardId);
            } catch (e: any) {
              setSelectedError(e?.message ?? "Не удалось загрузить файл");
            }
          }}
          onAddAttachmentUrl={async ({ file_url, file_name }) => {
            if (!selectedCardId) return;
            setSelectedError(null);
            try {
              const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCardId}/attachments`), {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                },
                body: JSON.stringify({
                  file_url,
                  file_name: file_name || undefined,
                }),
              });
              if (!res.ok) {
                const data = await res.json().catch(() => null);
                throw new Error(data?.detail ?? "Не удалось добавить вложение по ссылке");
              }
              await loadCardDetails(selectedCardId);
            } catch (e: any) {
              setSelectedError(e?.message ?? "Не удалось добавить вложение по ссылке");
            }
          }}
        />
      )}

      {selectedLoading && (
        <Box
          sx={{
            position: "fixed",
            inset: 0,
            zIndex: 99,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(0,0,0,0.1)",
          }}
        >
          <Box sx={{ bgcolor: "var(--k-surface-bg)", borderRadius: 2, p: 3, boxShadow: 3, color: "var(--k-text)", border: "1px solid var(--k-border)" }}>Загрузка...</Box>
        </Box>
      )}

      {selectedError && (
        <Box
          sx={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 110,
            bgcolor: "var(--k-surface-bg)",
            borderRadius: 2,
            p: 2,
            boxShadow: 3,
            border: "1px solid var(--k-border)",
            color: "#C62828",
            fontSize: 14,
          }}
        >
          {selectedError}
        </Box>
      )}

      {boardNotice && (
        <Box
          role="alert"
          onClick={() => setBoardNotice(null)}
          sx={{
            position: "fixed",
            bottom: selectedError ? 88 : 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 109,
            bgcolor: "var(--k-surface-bg)",
            borderRadius: 2,
            p: 2,
            boxShadow: 3,
            border: "1px solid var(--k-border)",
            color: "#C62828",
            fontSize: 14,
            maxWidth: "min(90vw, 480px)",
            cursor: "pointer",
          }}
        >
          {boardNotice}
        </Box>
      )}
    </Box>
  );
}
