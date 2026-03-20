"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@mui/material";
import { getApiUrl } from "@/lib/api";
import { KanbanBoard, type KanbanFilters } from "../../components/kanban/KanbanBoard";
import AppShell, { type AppNotification, type AppRole, type ViewMode } from "../../components/kaiten/AppShell";
import FiltersPopover from "../../components/kaiten/FiltersPopover";
import ListView from "../../components/views/ListView";
import TableView from "../../components/views/TableView";
import TimelineView from "../../components/views/TimelineView";
import CalendarView from "../../components/views/CalendarView";
import CreateSpaceDialog from "../../components/dialogs/CreateSpaceDialog";
import CreateTaskDialog from "../../components/dialogs/CreateTaskDialog";
import CreateFolderDialog from "../../components/dialogs/CreateFolderDialog";
import ProfileSettingsDialog from "../../components/dialogs/ProfileSettingsDialog";
import { CardModal, type CardDetail } from "../../components/kanban/CardModal";
import { getStoredLanguage, getStoredTheme, type AppLanguage } from "@/lib/preferences";
import type { ColorTheme } from "../../components/kaiten/ProfileMenu";

type AuthToken = { access: string; refresh?: string };
const ACCESS_STORAGE_KEY = "kaiten_access";
const REFRESH_STORAGE_KEY = "kaiten_refresh";
const ONBOARDING_TOUR_STORAGE_KEY = "kaiten_onboarding_tour_seen";
const LAST_ACTIVE_SPACE_STORAGE_KEY = "kaiten_last_active_space_id";

type Space = { id: string; name: string; organization_id: string };
type Project = { id: string; name: string; space_id: string };
type Board = { id: string; name: string; space_id?: string; project_id?: string };
type OrgUser = { id: string; email: string; full_name: string; role: "user" | "manager" | "lead" | "admin" };
type CurrentUserMe = {
  user: { id: string; email: string; full_name: string; avatar_url?: string };
  effective_role: AppRole | "";
  memberships: Array<{ organization_id: string; role: AppRole; organization_name: string }>;
};

type Column = { id: string; name: string; order_index: number; is_done: boolean };
type Card = {
  id: string;
  title: string;
  description: string;
  column_id: string;
  due_at: string | null;
  planned_start_at?: string | null;
  planned_end_at?: string | null;
  track_id?: string | null;
  card_type?: string;
  priority?: string | null;
  tags?: string[];
  assignee_name?: string | null;
  blocked_count?: number;
  blocking_count?: number;
  is_favorite?: boolean;
};

type BoardGrid = {
  board: { id: string; name: string };
  tracks: Array<{ id: string; name: string }>;
  columns: Array<Column & { cards: Card[] }>;
};

type DocumentMini = { id: string; title: string; doc_type: string; updated_at: string };
type DocumentDetail = {
  id: string;
  title: string;
  content: string;
  doc_type: string;
  created_at: string;
  updated_at: string;
  card_id: string | null;
};

type DocBlock = {
  id: string;
  type: "text" | "comment" | "heading" | "bulleted" | "numbered" | "todo" | "quote" | "divider" | "callout";
  content: string;
  checked?: boolean;
};

function parseDocumentContent(raw: string): { icon: string; blocks: DocBlock[] } {
  try {
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.blocks)) {
      const blocks = data.blocks
        .map((b: any) => ({
          id: String(b.id || crypto.randomUUID()),
          type:
            b.type === "comment" ||
            b.type === "heading" ||
            b.type === "bulleted" ||
            b.type === "numbered" ||
            b.type === "todo" ||
            b.type === "quote" ||
            b.type === "divider" ||
            b.type === "callout"
              ? b.type
              : "text",
          content: String(b.content || ""),
          checked: Boolean(b.checked),
        }))
        .filter((b: DocBlock) => b.content.length > 0 || b.type === "text" || b.type === "todo" || b.type === "divider");
      return {
        icon: typeof data.icon === "string" ? data.icon : "",
        blocks: blocks.length ? blocks : [{ id: crypto.randomUUID(), type: "text", content: "" }],
      };
    }
  } catch {
    // fallback to plain text format
  }
  return {
    icon: "",
    blocks: [{ id: crypto.randomUUID(), type: "text", content: raw || "" }],
  };
}

function serializeDocumentContent(icon: string, blocks: DocBlock[]): string {
  return JSON.stringify({
    icon,
    blocks: blocks.map((b) => ({ id: b.id, type: b.type, content: b.content, checked: b.checked ?? false })),
  });
}

/** Только чтение: режим просмотра документа */
function DocBlockReadonlyPreview({ block, locale }: { block: DocBlock; locale: "ru" | "en" }) {
  const isEmptyText =
    !block.content.trim() && block.type !== "divider" && block.type !== "todo" && block.type !== "text";
  if (isEmptyText) return null;

  switch (block.type) {
    case "divider":
      return (
        <div className="py-3">
          <div className="h-px bg-[var(--k-border)]" />
        </div>
      );
    case "heading":
      if (!block.content.trim()) return null;
      return (
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--k-text)] mt-5 mb-2">
          {block.content}
        </h2>
      );
    case "todo":
      if (!block.content.trim() && !block.checked) return null;
      return (
        <div className="flex items-start gap-2 py-1">
          <span className="mt-0.5 text-[var(--k-text-muted)] select-none" aria-hidden>
            {block.checked ? "☑" : "☐"}
          </span>
          <span
            className={
              "whitespace-pre-wrap flex-1 text-base leading-relaxed " +
              (block.checked ? "line-through text-[var(--k-text-muted)]" : "text-[var(--k-text)]")
            }
          >
            {block.content}
          </span>
        </div>
      );
    case "bulleted": {
      const items = block.content.split("\n").filter((line) => line.trim());
      if (items.length === 0) return null;
      return (
        <ul className="list-disc pl-5 my-2 space-y-1 text-[var(--k-text)]">
          {items.map((line, i) => (
            <li key={i} className="whitespace-pre-wrap leading-relaxed">
              {line}
            </li>
          ))}
        </ul>
      );
    }
    case "numbered": {
      const items = block.content.split("\n").filter((line) => line.trim());
      if (items.length === 0) return null;
      return (
        <ol className="list-decimal pl-5 my-2 space-y-1 text-[var(--k-text)]">
          {items.map((line, i) => (
            <li key={i} className="whitespace-pre-wrap leading-relaxed">
              {line}
            </li>
          ))}
        </ol>
      );
    }
    case "quote":
      if (!block.content.trim()) return null;
      return (
        <blockquote className="border-l-4 border-[#8A2BE2]/55 pl-4 my-3 text-[var(--k-text-muted)] italic whitespace-pre-wrap leading-relaxed">
          {block.content}
        </blockquote>
      );
    case "callout":
      if (!block.content.trim()) return null;
      return (
        <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-4 my-3 flex gap-3">
          <span className="text-xl leading-none shrink-0">💡</span>
          <div className="text-sm text-[var(--k-text)] whitespace-pre-wrap leading-relaxed">{block.content}</div>
        </div>
      );
    case "comment":
      if (!block.content.trim()) return null;
      return (
        <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-4 my-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--k-text-muted)] mb-2">
            {locale === "en" ? "Comment" : "Комментарий"}
          </div>
          <div className="text-sm text-[var(--k-text)] whitespace-pre-wrap leading-relaxed">{block.content}</div>
        </div>
      );
    default:
      if (!block.content.trim()) return null;
      return (
        <div className="text-[var(--k-text)] text-base leading-relaxed whitespace-pre-wrap py-0.5">{block.content}</div>
      );
  }
}

const DOC_ICON_COLLECTION = [
  "📄", "📝", "📌", "📚", "✅", "🚀", "💡", "📊", "📎", "🧩",
  "🎯", "🧠", "🔧", "🗂️", "📅", "🔥", "⭐", "🎨", "🔒", "⚙️",
  "📦", "💬", "🧪", "📈", "🛠️", "💼", "🌟", "🏁", "🗒️", "📋",
];

function GreyButton({
  children,
  onClick,
  disabled,
  variant = "primary",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "soft";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        variant === "primary"
          ? "rounded-xl px-4 py-2 bg-gradient-to-r from-[#8A2BE2] to-[#4B0082] text-white font-semibold hover:bg-gray-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          : "rounded-xl px-4 py-2 bg-transparent text-[var(--k-text)] border border-[var(--k-border)] hover:bg-[var(--k-page-bg)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      }
    >
      {children}
    </button>
  );
}

export default function AppHomePageImplGray() {
  const muiTheme = useTheme();
  const isDarkTheme = muiTheme.palette.mode === "dark";
  const uiColors = useMemo(
    () => ({
      pageBg: isDarkTheme ? "#0A0A0A" : "#F5F6F7",
      cardBg: isDarkTheme ? "#111111" : "#FFFFFF",
      cardBgSoft: isDarkTheme ? "#1A1A1A" : "#F9FAFB",
      border: isDarkTheme ? "#2A2A2A" : "#E5E7EB",
      text: isDarkTheme ? "#E0E0E0" : "#111827",
      textMuted: isDarkTheme ? "#A0A0A0" : "#6B7280",
    }),
    [isDarkTheme]
  );
  const [token, setToken] = useState<AuthToken | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);

  const [boards, setBoards] = useState<Board[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const searchParams = useSearchParams();

  const [kaitenTab, setKaitenTab] = useState<string>("lists");
  const [viewMode, setViewMode] = useState<ViewMode>("board");

  const [filters, setFilters] = useState<KanbanFilters>({ query: "", titleOnly: false, status: "all" });
  const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);

  const [boardGrid, setBoardGrid] = useState<BoardGrid | null>(null);
  const [allCards, setAllCards] = useState<Card[]>([]);
  const [kanbanRefreshTick, setKanbanRefreshTick] = useState(0);

  const kanbanHighlightColumnId = useMemo(() => {
    const col = searchParams.get("column");
    const b = searchParams.get("board");
    if (!activeBoardId || !col) return null;
    if (b && b !== activeBoardId) return null;
    return col;
  }, [searchParams, activeBoardId]);

  const [docs, setDocs] = useState<DocumentMini[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [createBusy, setCreateBusy] = useState(false);
  const [docIcon, setDocIcon] = useState("");
  const [docBlocks, setDocBlocks] = useState<DocBlock[]>([{ id: crypto.randomUUID(), type: "text", content: "" }]);
  const [docSaveBusy, setDocSaveBusy] = useState(false);
  const [newDocBlockType, setNewDocBlockType] = useState<DocBlock["type"]>("text");
  const [docIconPickerOpen, setDocIconPickerOpen] = useState(false);
  const [slashMenu, setSlashMenu] = useState<{ blockId: string; query: string } | null>(null);
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [draggedDocBlockId, setDraggedDocBlockId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ blockId: string; position: "before" | "after" } | null>(null);
  const [blockMenuOpenId, setBlockMenuOpenId] = useState<string | null>(null);
  const [pendingFocusBlockId, setPendingFocusBlockId] = useState<string | null>(null);
  const docEditorRef = useRef<HTMLDivElement | null>(null);
  /** После «Новый документ» — редактор на весь контент (как Notion). */
  const [docImmersiveMode, setDocImmersiveMode] = useState(false);
  const [docViewMode, setDocViewMode] = useState<"edit" | "preview">("edit");

  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskColumnId, setCreateTaskColumnId] = useState<string | null>(null);
  const [uiLanguage, setUiLanguage] = useState<AppLanguage>("ru");
  const [uiTheme, setUiTheme] = useState<ColorTheme>("system");
  const [selectedCard, setSelectedCard] = useState<CardDetail | null>(null);
  const [selectedCardError, setSelectedCardError] = useState<string | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [orgUsersError, setOrgUsersError] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserFullName, setNewUserFullName] = useState("");
  const [newUserRole, setNewUserRole] = useState<OrgUser["role"]>("user");
  const [newUserBusy, setNewUserBusy] = useState(false);
  const [effectiveRole, setEffectiveRole] = useState<AppRole>("user");
  const [orgMemberships, setOrgMemberships] = useState<Array<{ organization_id: string; role: AppRole }>>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [profileFullName, setProfileFullName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  const access = token?.access;
  const canManageBoard = effectiveRole !== "user";
  const isAdmin = effectiveRole === "admin";
  const canManageCurrentSpace = useMemo(() => {
    if (!activeSpaceId) return false;
    const activeSpace = spaces.find((space) => space.id === activeSpaceId);
    if (!activeSpace?.organization_id) return false;
    const membership = orgMemberships.find((m) => m.organization_id === activeSpace.organization_id);
    return membership?.role === "lead" || membership?.role === "admin";
  }, [activeSpaceId, spaces, orgMemberships]);

  const displayUserName = useMemo(
    () => profileFullName.trim() || email.split("@")[0] || "Пользователь",
    [profileFullName, email],
  );

  const docEditorImmersive = kaitenTab === "settings" && docImmersiveMode && selectedDoc !== null;
  const docPreviewMode = Boolean(selectedDoc && docViewMode === "preview");

  useEffect(() => {
    try {
      const access = localStorage.getItem(ACCESS_STORAGE_KEY);
      const refresh = localStorage.getItem(REFRESH_STORAGE_KEY) || undefined;
      if (access) setToken({ access, refresh });
      setUiLanguage(getStoredLanguage());
      setUiTheme(getStoredTheme());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = uiLanguage;
  }, [uiLanguage]);

  useEffect(() => {
    if (!access) return;
    try {
      const wasSeen = localStorage.getItem(ONBOARDING_TOUR_STORAGE_KEY);
      if (!wasSeen) {
        setTourOpen(true);
      }
    } catch {
      // ignore
    }
  }, [access]);

  async function refreshAccessTokenOrLogout() {
    if (!token?.refresh) {
      setToken(null);
      setActiveSpaceId(null);
      setActiveProjectId(null);
      setActiveBoardId(null);
      localStorage.removeItem(ACCESS_STORAGE_KEY);
      localStorage.removeItem(REFRESH_STORAGE_KEY);
      throw new Error("Сессия истекла. Войдите заново.");
    }
    const refreshRes = await fetch(getApiUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: token.refresh }),
    });
    const refreshData: any = await refreshRes.json().catch(() => ({}));
    if (!refreshRes.ok || !refreshData?.access) {
      setToken(null);
      setActiveSpaceId(null);
      setActiveProjectId(null);
      setActiveBoardId(null);
      localStorage.removeItem(ACCESS_STORAGE_KEY);
      localStorage.removeItem(REFRESH_STORAGE_KEY);
      throw new Error("Сессия истекла. Войдите заново.");
    }
    const nextTokens = { access: refreshData.access as string, refresh: refreshData.refresh as string | undefined };
    setToken(nextTokens);
    localStorage.setItem(ACCESS_STORAGE_KEY, nextTokens.access);
    if (nextTokens.refresh) localStorage.setItem(REFRESH_STORAGE_KEY, nextTokens.refresh);
    return nextTokens.access;
  }

  async function fetchSpaces(nextAccess: string, options?: { keepActiveIfPossible?: boolean }): Promise<Space[]> {
    let accessToken = nextAccess;
    let res = await fetch(getApiUrl("/api/auth/spaces"), { headers: { Authorization: `Bearer ${accessToken}` } });
    let data: any = await res.json().catch(() => ({}));
    if (!res.ok && res.status === 401 && data?.detail === "invalid_token") {
      accessToken = await refreshAccessTokenOrLogout();
      res = await fetch(getApiUrl("/api/auth/spaces"), { headers: { Authorization: `Bearer ${accessToken}` } });
      data = await res.json().catch(() => ({}));
    }
    if (!res.ok) throw new Error(data?.detail ?? "Не удалось загрузить пространства");
    const list: Space[] = Array.isArray(data) ? data : [];
    setSpaces(list);
    if (!list.length) {
      setActiveSpaceId(null);
      setActiveBoardId(null);
      setActiveProjectId(null);
      try {
        localStorage.removeItem(LAST_ACTIVE_SPACE_STORAGE_KEY);
      } catch {
        // ignore
      }
      return [];
    }
    let preferred = list[0].id;
    try {
      const saved = localStorage.getItem(LAST_ACTIVE_SPACE_STORAGE_KEY);
      if (saved && list.some((s: Space) => s.id === saved)) preferred = saved;
    } catch {
      // ignore
    }
    if (options?.keepActiveIfPossible) {
      setActiveSpaceId((prev) => (prev && list.some((s: Space) => s.id === prev) ? prev : preferred));
    } else {
      setActiveSpaceId(preferred);
    }
    return list;
  }

  async function fetchBoardsForSpace(nextAccess: string, spaceId: string) {
    let accessToken = nextAccess;
    let res = await fetch(getApiUrl("/api/kanban/boards"), {
      headers: { Authorization: `Bearer ${accessToken}`, "X-Space-Id": spaceId },
    });
    let list: any = await res.json().catch(() => ({}));
    if (!res.ok && res.status === 401 && list?.detail === "invalid_token") {
      accessToken = await refreshAccessTokenOrLogout();
      res = await fetch(getApiUrl("/api/kanban/boards"), {
        headers: { Authorization: `Bearer ${accessToken}`, "X-Space-Id": spaceId },
      });
      list = await res.json().catch(() => ({}));
    }
    if (!res.ok) throw new Error(list?.detail ?? "Не удалось загрузить доски");
    const boardsList = Array.isArray(list) ? (list as Board[]) : [];
    setBoards(boardsList);
    if (boardsList.length) {
      setActiveBoardId((prev) => (prev && boardsList.some((b) => b.id === prev) ? prev : boardsList[0].id));
    } else {
      setActiveBoardId(null);
    }
  }

  async function fetchProjectsForSpace(nextAccess: string, spaceId: string) {
    let accessToken = nextAccess;
    let res = await fetch(getApiUrl("/api/kanban/projects"), {
      headers: { Authorization: `Bearer ${accessToken}`, "X-Space-Id": spaceId },
    });
    let list: any = await res.json().catch(() => ({}));
    if (!res.ok && res.status === 401 && list?.detail === "invalid_token") {
      accessToken = await refreshAccessTokenOrLogout();
      res = await fetch(getApiUrl("/api/kanban/projects"), {
        headers: { Authorization: `Bearer ${accessToken}`, "X-Space-Id": spaceId },
      });
      list = await res.json().catch(() => ({}));
    }
    if (res.ok) {
      setProjects(list);
      if (!activeProjectId && list.length) setActiveProjectId(list[0].id);
    }
  }

  const fetchBoardGrid = useCallback(async (boardId: string, nextAccess: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/kanban/boards/${boardId}/grid`), {
        headers: { Authorization: `Bearer ${nextAccess}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as BoardGrid;
      setBoardGrid(data);
      const cards: Card[] = [];
      data.columns.forEach((col) => {
        col.cards.forEach((card) => {
          cards.push({ ...card, column_id: col.id });
        });
      });
      setAllCards(cards);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    if (activeSpaceId) return;
    fetchSpaces(token.access).catch((e: any) => setAuthError(e?.message ?? "Ошибка загрузки"));
  }, [token]);

  useEffect(() => {
    if (!token || !activeSpaceId) return;
    fetchBoardsForSpace(token.access, activeSpaceId).catch((e: any) => setAuthError(e?.message ?? "Ошибка загрузки"));
    fetchProjectsForSpace(token.access, activeSpaceId).catch(() => {});
  }, [token, activeSpaceId]);

  useEffect(() => {
    if (!activeSpaceId) return;
    try {
      localStorage.setItem(LAST_ACTIVE_SPACE_STORAGE_KEY, activeSpaceId);
    } catch {
      // ignore
    }
  }, [activeSpaceId]);

  useEffect(() => {
    if (!token) return;
    fetchCurrentUser(token.access).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchNotifications(token.access).catch(() => {});
  }, [token, activeSpaceId]);

  useEffect(() => {
    if (!token || !activeBoardId) return;
    fetchBoardGrid(activeBoardId, token.access);
  }, [token, activeBoardId, fetchBoardGrid]);

  async function fetchDocs(nextAccess: string, spaceId: string) {
    setDocsLoading(true);
    setDocsError(null);
    try {
      const res = await fetch(getApiUrl("/api/docs"), {
        headers: { Authorization: `Bearer ${nextAccess}`, "X-Space-Id": spaceId },
      });
      const data = (await res.json()) as DocumentMini[];
      if (!res.ok) throw new Error((data as any)?.detail ?? "Не удалось загрузить документы");
      setDocs(data);
      setSelectedDoc(null);
    } catch (e: any) {
      setDocsError(e?.message ?? "Ошибка загрузки документов");
    } finally {
      setDocsLoading(false);
    }
  }

  async function fetchOrganizationUsers(nextAccess: string, spaceId: string) {
    setOrgUsersLoading(true);
    setOrgUsersError(null);
    try {
      const res = await fetch(getApiUrl("/api/auth/users"), {
        headers: { Authorization: `Bearer ${nextAccess}`, "X-Space-Id": spaceId },
      });
      const data = (await res.json().catch(() => [])) as any;
      if (!res.ok) throw new Error(data?.detail ?? "Не удалось загрузить пользователей");
      setOrgUsers(Array.isArray(data) ? (data as OrgUser[]) : []);
    } catch (e: any) {
      setOrgUsersError(e?.message ?? "Ошибка загрузки пользователей");
    } finally {
      setOrgUsersLoading(false);
    }
  }

  async function fetchCurrentUser(nextAccess: string) {
    try {
      const res = await fetch(getApiUrl("/api/auth/me"), {
        headers: { Authorization: `Bearer ${nextAccess}` },
      });
      const data = (await res.json().catch(() => ({}))) as CurrentUserMe | { detail?: string };
      if (!res.ok) throw new Error((data as { detail?: string }).detail ?? "Не удалось загрузить профиль");
      const me = data as CurrentUserMe;
      const role = me.effective_role || "user";
      setEffectiveRole(role);
      setOrgMemberships(Array.isArray(me.memberships) ? me.memberships : []);
      const u = me.user;
      if (u) {
        setProfileFullName(u.full_name || "");
        setProfileAvatarUrl(u.avatar_url || "");
      }
    } catch {
      setEffectiveRole("user");
      setOrgMemberships([]);
    }
  }

  async function fetchNotifications(nextAccess: string) {
    try {
      const [countRes, listRes] = await Promise.all([
        fetch(getApiUrl("/api/notifications/unread-count"), {
          headers: { Authorization: `Bearer ${nextAccess}`, ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}) },
        }),
        fetch(getApiUrl("/api/notifications?limit=15"), {
          headers: { Authorization: `Bearer ${nextAccess}`, ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}) },
        }),
      ]);
      const countData = (await countRes.json().catch(() => ({}))) as { unread_count?: number };
      const listData = (await listRes.json().catch(() => [])) as AppNotification[] | { detail?: string };
      if (countRes.ok) setUnreadNotificationsCount(Math.max(0, Number(countData.unread_count ?? 0)));
      if (listRes.ok && Array.isArray(listData)) {
        setNotifications(listData);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!token || !activeSpaceId) return;
    if (kaitenTab !== "settings") return;
    fetchDocs(token.access, activeSpaceId).catch(() => {});
  }, [token, activeSpaceId, kaitenTab]);

  useEffect(() => {
    if (kaitenTab !== "settings") setDocImmersiveMode(false);
  }, [kaitenTab]);

  useEffect(() => {
    setDocViewMode("edit");
  }, [selectedDoc?.id]);

  useEffect(() => {
    if (!token || !activeSpaceId) return;
    if (kaitenTab !== "administration") return;
    if (!isAdmin) {
      setKaitenTab("lists");
      setOrgUsersError(uiLanguage === "en" ? "Administration is available for admins only" : "Администрирование доступно только администратору");
      return;
    }
    fetchOrganizationUsers(token.access, activeSpaceId).catch(() => {});
  }, [token, activeSpaceId, kaitenTab, isAdmin, uiLanguage]);

  async function fetchDocDetail(nextAccess: string, docId: string) {
    const res = await fetch(getApiUrl(`/api/docs/${docId}`), {
      headers: { Authorization: `Bearer ${nextAccess}`, "X-Space-Id": activeSpaceId ?? "" },
    });
    const data = (await res.json()) as DocumentDetail;
    if (!res.ok) throw new Error((data as any)?.detail ?? "Не удалось загрузить документ");
    return data;
  }

  async function createDocument() {
    if (!token || !activeSpaceId) return;
    setCreateBusy(true);
    setDocsError(null);
    try {
      const untitledTitle = uiLanguage === "en" ? "Untitled document" : "Безымянный документ";
      const res = await fetch(getApiUrl("/api/docs"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token.access}`, "X-Space-Id": activeSpaceId, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: untitledTitle,
          content: serializeDocumentContent("", [{ id: crypto.randomUUID(), type: "text", content: "" }]),
          doc_type: "document",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; detail?: string };
      if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать документ");
      await fetchDocs(token.access, activeSpaceId);
      if (data?.id) {
        const detail = await fetchDocDetail(token.access, data.id);
        setSelectedDoc(detail);
        const parsed = parseDocumentContent(detail.content || "");
        setDocIcon(parsed.icon);
        setDocBlocks(parsed.blocks);
        setDocImmersiveMode(true);
      }
    } catch (e: any) {
      setDocsError(e?.message ?? "Ошибка создания документа");
    } finally {
      setCreateBusy(false);
    }
  }

  const addDocBlock = (type: DocBlock["type"] = "text", afterId?: string) => {
    const nextId = crypto.randomUUID();
    const newBlock: DocBlock = { id: nextId, type, content: "", checked: false };
    setDocBlocks((prev) => {
      if (!afterId) return [...prev, newBlock];
      const idx = prev.findIndex((b) => b.id === afterId);
      if (idx < 0) return [...prev, newBlock];
      return [...prev.slice(0, idx + 1), newBlock, ...prev.slice(idx + 1)];
    });
    setPendingFocusBlockId(nextId);
    setSlashMenu(null);
    setSlashMenuIndex(0);
  };

  const updateDocBlock = (id: string, content: string) => {
    setDocBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, content } : b)));
    const trimmed = content.trim();
    if (trimmed.startsWith("/")) {
      setSlashMenu({ blockId: id, query: trimmed.slice(1).toLowerCase() });
      setSlashMenuIndex(0);
    } else if (slashMenu?.blockId === id) {
      setSlashMenu(null);
      setSlashMenuIndex(0);
    }
  };

  const updateDocBlockChecked = (id: string, checked: boolean) => {
    setDocBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, checked } : b)));
  };

  const removeDocBlock = (id: string) => {
    setDocBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      const next = prev.filter((b) => b.id !== id);
      if (idx > 0 && prev.length > 1) {
        setPendingFocusBlockId(prev[idx - 1].id);
      }
      return next.length ? next : [{ id: crypto.randomUUID(), type: "text", content: "" }];
    });
    if (slashMenu?.blockId === id) setSlashMenu(null);
    setSlashMenuIndex(0);
  };

  const setDocBlockType = (id: string, type: DocBlock["type"]) => {
    setDocBlocks((prev) =>
      prev.map((b) =>
        b.id === id
          ? {
              ...b,
              type,
              content: b.content.trim().startsWith("/") ? "" : b.content,
              checked: type === "todo" ? b.checked ?? false : undefined,
            }
          : b
      )
    );
    setSlashMenu(null);
    setSlashMenuIndex(0);
  };

  const moveDocBlock = (fromId: string, toId: string, position: "before" | "after" = "before") => {
    if (fromId === toId) return;
    setDocBlocks((prev) => {
      const fromIndex = prev.findIndex((b) => b.id === fromId);
      const toIndex = prev.findIndex((b) => b.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      const targetIndex = next.findIndex((b) => b.id === toId);
      const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
      next.splice(insertIndex < 0 ? next.length : insertIndex, 0, item);
      return next;
    });
  };

  const duplicateDocBlock = (id: string) => {
    const nextId = crypto.randomUUID();
    setDocBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0) return prev;
      const src = prev[idx];
      const copy: DocBlock = { ...src, id: nextId };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
    setPendingFocusBlockId(nextId);
    setBlockMenuOpenId(null);
  };

  const getSlashItems = useCallback(
    (query: string) =>
      [
        { id: "text", label: uiLanguage === "en" ? "Text" : "Текст", icon: "Aa" },
        { id: "heading", label: uiLanguage === "en" ? "Heading 1" : "Заголовок 1", icon: "H1" },
        { id: "bulleted", label: uiLanguage === "en" ? "Bulleted list" : "Маркированный список", icon: "•" },
        { id: "numbered", label: uiLanguage === "en" ? "Numbered list" : "Нумерованный список", icon: "1." },
        { id: "todo", label: "To-do", icon: "☐" },
        { id: "quote", label: uiLanguage === "en" ? "Quote" : "Цитата", icon: "❝" },
        { id: "callout", label: uiLanguage === "en" ? "Callout" : "Выделение", icon: "💡" },
        { id: "divider", label: uiLanguage === "en" ? "Divider" : "Разделитель", icon: "—" },
        { id: "comment", label: uiLanguage === "en" ? "Comment" : "Комментарий", icon: "💬" },
      ].filter((item) => item.label.toLowerCase().includes(query)),
    [uiLanguage]
  );

  const handleDocBlockKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, block: DocBlock) => {
    const currentValue = e.currentTarget.value;
    const textControl = e.currentTarget;
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "7") {
      e.preventDefault();
      setDocBlockType(block.id, "numbered");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "8") {
      e.preventDefault();
      setDocBlockType(block.id, "bulleted");
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      const start = textControl.selectionStart ?? 0;
      const end = textControl.selectionEnd ?? start;
      const selected = currentValue.slice(start, end) || (uiLanguage === "en" ? "bold" : "жирный");
      const wrapped = `**${selected}**`;
      textControl.setRangeText(wrapped, start, end, "end");
      updateDocBlock(block.id, textControl.value);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      const start = textControl.selectionStart ?? 0;
      const end = textControl.selectionEnd ?? start;
      const selected = currentValue.slice(start, end) || (uiLanguage === "en" ? "italic" : "курсив");
      const wrapped = `_${selected}_`;
      textControl.setRangeText(wrapped, start, end, "end");
      updateDocBlock(block.id, textControl.value);
      return;
    }
    if ((block.type === "bulleted" || block.type === "numbered" || block.type === "todo") && e.key === "Tab") {
      e.preventDefault();
      const caret = textControl.selectionStart ?? 0;
      const lineStart = currentValue.lastIndexOf("\n", Math.max(0, caret - 1)) + 1;
      if (e.shiftKey) {
        if (currentValue.slice(lineStart, lineStart + 2) === "  ") {
          textControl.setRangeText("", lineStart, lineStart + 2, "end");
        }
      } else {
        textControl.setRangeText("  ", lineStart, lineStart, "end");
      }
      updateDocBlock(block.id, textControl.value);
      return;
    }
    if (e.key === " " && !e.shiftKey) {
      const trimmed = currentValue.trim();
      if (trimmed === "#") {
        e.preventDefault();
        setDocBlockType(block.id, "heading");
        updateDocBlock(block.id, "");
        return;
      }
      if (trimmed === "-" || trimmed === "*") {
        e.preventDefault();
        setDocBlockType(block.id, "bulleted");
        updateDocBlock(block.id, "");
        return;
      }
      if (trimmed === "1." || trimmed === "1)") {
        e.preventDefault();
        setDocBlockType(block.id, "numbered");
        updateDocBlock(block.id, "");
        return;
      }
      if (trimmed === ">") {
        e.preventDefault();
        setDocBlockType(block.id, "quote");
        updateDocBlock(block.id, "");
        return;
      }
      if (trimmed === "[]" || trimmed === "[ ]") {
        e.preventDefault();
        setDocBlockType(block.id, "todo");
        updateDocBlock(block.id, "");
        return;
      }
    }
    if (slashMenu?.blockId === block.id) {
      const items = getSlashItems(slashMenu.query);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashMenuIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashMenuIndex((prev) => (items.length ? (prev - 1 + items.length) % items.length : 0));
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashMenu(null);
        setSlashMenuIndex(0);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && items.length) {
        e.preventDefault();
        setDocBlockType(block.id, items[Math.min(slashMenuIndex, items.length - 1)].id as DocBlock["type"]);
        return;
      }
    }
    if ((block.type === "bulleted" || block.type === "numbered") && e.key === "Enter" && !e.shiftKey) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addDocBlock("text", block.id);
      return;
    }
    if (e.key === "Backspace" && !block.content.trim() && docBlocks.length > 1) {
      e.preventDefault();
      removeDocBlock(block.id);
    }
  };

  useEffect(() => {
    if (!pendingFocusBlockId) return;
    const root = docEditorRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-doc-input-id="${pendingFocusBlockId}"]`);
    if (el) {
      el.focus();
      setPendingFocusBlockId(null);
    }
  }, [pendingFocusBlockId, docBlocks]);

  useEffect(() => {
    if (!blockMenuOpenId) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-doc-block-menu]")) return;
      setBlockMenuOpenId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [blockMenuOpenId]);

  async function saveSelectedDocument() {
    if (!token || !activeSpaceId || !selectedDoc) return;
    setDocSaveBusy(true);
    setDocsError(null);
    try {
      const res = await fetch(getApiUrl(`/api/docs/${selectedDoc.id}`), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token.access}`,
          "X-Space-Id": activeSpaceId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: selectedDoc.title,
          doc_type: selectedDoc.doc_type,
          content: serializeDocumentContent(docIcon, docBlocks),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail ?? "Не удалось сохранить документ");
      const detail = await fetchDocDetail(token.access, selectedDoc.id);
      setSelectedDoc(detail);
      const parsed = parseDocumentContent(detail.content || "");
      setDocIcon(parsed.icon);
      setDocBlocks(parsed.blocks);
      await fetchDocs(token.access, activeSpaceId);
    } catch (e: any) {
      setDocsError(e?.message ?? "Ошибка сохранения документа");
    } finally {
      setDocSaveBusy(false);
    }
  }

  const authTitle = useMemo(() => (mode === "register" ? "Создать аккаунт" : "Вход"), [mode]);

  async function submitAuth() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const url = getApiUrl(`/api/auth/${mode === "register" ? "register" : "login"}`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          mode === "register"
            ? JSON.stringify({ email, password, organization_name: orgName, full_name: "" })
            : JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ?? "Ошибка авторизации");

      const accessToken = data.access as string;
      const refreshToken = data.refresh as string | undefined;
      setToken({ access: accessToken, refresh: refreshToken });
      localStorage.setItem(ACCESS_STORAGE_KEY, accessToken);
      if (refreshToken) localStorage.setItem(REFRESH_STORAGE_KEY, refreshToken);
    } catch (e: any) {
      setAuthError(e?.message ?? "Ошибка");
    } finally {
      setAuthLoading(false);
    }
  }

  const handleSpaceCreated = async (space: { id: string; name: string }) => {
    if (!token) {
      setSpaces((prev) => [...prev, { ...space, organization_id: "" }]);
      setActiveSpaceId(space.id);
      return;
    }
    try {
      const refreshed = await fetchSpaces(token.access, { keepActiveIfPossible: true });
      const createdExists = refreshed.some((s) => s.id === space.id);
      setActiveSpaceId(createdExists ? space.id : refreshed[0]?.id ?? null);
    } catch {
      setSpaces((prev) => [...prev, { ...space, organization_id: "" }]);
      setActiveSpaceId(space.id);
    }
  };

  const handleRenameSpace = async (spaceId: string, newName: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(getApiUrl(`/api/kanban/spaces/${spaceId}`), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token.access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 404) {
          try {
            const refreshed = await fetchSpaces(token.access, { keepActiveIfPossible: true });
            if (!refreshed.some((s) => s.id === spaceId)) {
              // Пространство уже удалено (или недоступно) — синхронизируем UI и считаем операцию завершённой.
              return true;
            }
          } catch {
            // Ниже покажем исходную ошибку DELETE
          }
        }
        const msg =
          typeof data.detail === "string"
            ? data.detail
            : uiLanguage === "en"
              ? "Could not rename space"
              : "Не удалось переименовать пространство";
        setAuthError(msg);
        return false;
      }
      setSpaces((prev) => prev.map((s) => (s.id === spaceId ? { ...s, name: newName } : s)));
      return true;
    } catch {
      setAuthError(uiLanguage === "en" ? "Could not rename space" : "Не удалось переименовать пространство");
      return false;
    }
  };

  const handleDeleteSpace = async (spaceId: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(getApiUrl(`/api/kanban/spaces/${spaceId}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token.access}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data.detail === "string"
            ? data.detail
            : uiLanguage === "en"
              ? "Could not delete space"
              : "Не удалось удалить пространство";
        setAuthError(msg);
        return false;
      }
      try {
        await fetchSpaces(token.access, { keepActiveIfPossible: true });
      } catch (e: any) {
        const nextSpaces = spaces.filter((s) => s.id !== spaceId);
        setSpaces(nextSpaces);
        if (activeSpaceId === spaceId) {
          setActiveBoardId(null);
          setActiveProjectId(null);
          setActiveSpaceId(nextSpaces[0]?.id ?? null);
        }
        setAuthError(
          e?.message ?? (uiLanguage === "en" ? "Could not refresh spaces" : "Не удалось обновить список пространств")
        );
      }
      return true;
    } catch {
      setAuthError(
        uiLanguage === "en" ? "Network error while deleting space" : "Ошибка сети при удалении пространства"
      );
      return false;
    }
  };

  const handleCreateCardInColumn = (columnId: string) => {
    if (!canManageBoard) {
      setAuthError(uiLanguage === "en" ? "Only manager and above can create cards" : "Создавать карточки могут только менеджер и выше");
      return;
    }
    setCreateTaskColumnId(columnId);
    setCreateTaskOpen(true);
  };

  const handleOpenCreateTask = () => {
    if (!canManageBoard) {
      setAuthError(uiLanguage === "en" ? "Only manager and above can create cards" : "Создавать карточки могут только менеджер и выше");
      return;
    }
    if (!activeBoardId || columns.length === 0) {
      setAuthError("Сначала выберите доску, чтобы создать карточку.");
      return;
    }
    setCreateTaskOpen(true);
  };

  const openCardDetails = useCallback(
    async (cardId: string) => {
      if (!token) return;
      setSelectedCardError(null);
      try {
        const res = await fetch(getApiUrl(`/api/kanban/cards/${cardId}`), {
          headers: { Authorization: `Bearer ${token.access}` },
        });
        const data = (await res.json()) as CardDetail;
        if (!res.ok) throw new Error((data as any)?.detail ?? "Не удалось загрузить карточку");
        setSelectedCard(data);
      } catch (e: any) {
        setSelectedCardError(e?.message ?? "Не удалось загрузить карточку");
      }
    },
    [token]
  );

  const refreshSelectedCard = useCallback(async () => {
    if (!token || !selectedCard?.id) return;
    const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCard.id}`), {
      headers: { Authorization: `Bearer ${token.access}` },
    });
    const data = (await res.json()) as CardDetail;
    if (!res.ok) throw new Error((data as any)?.detail ?? "Не удалось обновить карточку");
    setSelectedCard(data);
  }, [token, selectedCard?.id]);

  const handleTaskCreated = () => {
    if (token && activeBoardId) {
      fetchBoardGrid(activeBoardId, token.access);
      setKanbanRefreshTick((v) => v + 1);
    }
  };

  const handleCreateBoard = async () => {
    if (!canManageBoard) {
      setAuthError(uiLanguage === "en" ? "Only manager and above can create boards" : "Создавать доски могут только менеджер и выше");
      return;
    }
    if (!token || !activeSpaceId) return;
    try {
      let accessToken = token.access;
      const name =
        uiLanguage === "en"
          ? `Board ${boards.length + 1}`
          : `Доска ${boards.length + 1}`;
      const createBoardRequest = async (accessToken: string) =>
        fetch(getApiUrl("/api/kanban/boards"), {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Space-Id": activeSpaceId,
          },
          body: JSON.stringify({ name, space_id: activeSpaceId, project_id: activeProjectId || projects[0]?.id || null }),
        });
      let res = await createBoardRequest(accessToken);
      let data: any = await res.json().catch(() => ({}));
      if (!res.ok && res.status === 401 && data?.detail === "invalid_token") {
        if (!token.refresh) {
          throw new Error("Сессия истекла. Войдите заново.");
        }
        const refreshRes = await fetch(getApiUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: token.refresh }),
        });
        const refreshData: any = await refreshRes.json().catch(() => ({}));
        if (!refreshRes.ok || !refreshData?.access) {
          throw new Error("Сессия истекла. Войдите заново.");
        }
        const nextTokens = { access: refreshData.access as string, refresh: refreshData.refresh as string | undefined };
        setToken(nextTokens);
        localStorage.setItem(ACCESS_STORAGE_KEY, nextTokens.access);
        if (nextTokens.refresh) localStorage.setItem(REFRESH_STORAGE_KEY, nextTokens.refresh);
        accessToken = nextTokens.access;
        res = await createBoardRequest(accessToken);
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать доску");
      await fetchBoardsForSpace(accessToken, activeSpaceId);
    } catch (e: any) {
      setAuthError(e?.message ?? "Ошибка создания доски");
    }
  };

  const columns = useMemo(() => boardGrid?.columns || [], [boardGrid]);

  const cardsWithMeta = useMemo(() => {
    if (!boardGrid) return [];
    const colMap = new Map(boardGrid.columns.map((c) => [c.id, c.name]));
    const trackMap = new Map(boardGrid.tracks.map((t) => [t.id, t.name]));
    return allCards.map((card) => ({
      ...card,
      column_name: colMap.get(card.column_id) || "",
      board_name: boardGrid.board.name,
      track_name: card.track_id ? trackMap.get(card.track_id) ?? "" : "",
    }));
  }, [allCards, boardGrid]);

  const boardsForListView = useMemo(() => {
    if (!boardGrid) return [];
    return [
      {
        id: boardGrid.board.id,
        name: boardGrid.board.name,
        columns: boardGrid.columns.map((col) => ({
          id: col.id,
          name: col.name,
          cards: col.cards,
        })),
      },
    ];
  }, [boardGrid]);

  if (!token || !access) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: uiColors.pageBg }}>
        <div
          className="w-full max-w-md rounded-3xl shadow-sm p-6"
          style={{ border: `1px solid ${uiColors.border}`, background: uiColors.cardBg }}
        >
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="font-extrabold text-lg" style={{ color: uiColors.text }}>AGB Tasks</div>
            <div className="text-sm" style={{ color: uiColors.textMuted }}>Вход</div>
          </div>

          <div className="font-bold text-2xl tracking-tight" style={{ color: uiColors.text }}>{authTitle}</div>
          <div className="mt-2 text-sm" style={{ color: uiColors.textMuted }}>Простая регистрация и авторизация</div>

          <div className="mt-5 flex gap-2">
            <GreyButton variant={mode === "register" ? "primary" : "soft"} onClick={() => setMode("register")}>
              Регистрация
            </GreyButton>
            <GreyButton variant={mode === "login" ? "primary" : "soft"} onClick={() => setMode("login")}>
              Вход
            </GreyButton>
          </div>

          <div className="mt-5 space-y-4">
            <label className="block">
              <div className="text-[var(--k-text-muted)] text-sm mb-2">Эл. почта</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] text-[var(--k-text)] px-3 py-2 outline-none focus:border-[#8A2BE2]"
              />
            </label>
            <label className="block">
              <div className="text-[var(--k-text-muted)] text-sm mb-2">Пароль</div>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] text-[var(--k-text)] px-3 py-2 outline-none focus:border-[#8A2BE2]"
              />
            </label>
            {mode === "register" ? (
              <label className="block">
                <div className="text-[var(--k-text-muted)] text-sm mb-2">Организация</div>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  type="text"
                  className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] text-[var(--k-text)] px-3 py-2 outline-none focus:border-[#8A2BE2]"
                />
              </label>
            ) : null}

            {authError ? <div className="text-red-500 text-sm">{authError}</div> : null}

            <GreyButton onClick={() => submitAuth()} disabled={authLoading} variant="primary">
              {authLoading ? "Подождите..." : authTitle}
            </GreyButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      spaces={spaces}
      projects={projects}
      boards={boards}
      activeSpaceId={activeSpaceId}
      activeProjectId={activeProjectId}
      activeBoardId={activeBoardId}
      onSelectSpace={(spaceId) => {
        setActiveSpaceId(spaceId);
        setActiveBoardId(null);
        setKaitenTab("lists");
      }}
      onSelectBoard={(boardId) => {
        setActiveBoardId(boardId);
        setKaitenTab("lists");
      }}
      onSelectProject={(projectId) => {
        setActiveProjectId(projectId);
      }}
      onRenameSpace={handleRenameSpace}
      onDeleteSpace={handleDeleteSpace}
      activeTabId={kaitenTab}
      onTabChange={setKaitenTab}
      notificationCount={unreadNotificationsCount}
      notifications={notifications}
      onOpenNotifications={() => {
        if (!token) return;
        fetchNotifications(token.access).catch(() => {});
      }}
      onReadNotification={async (notificationId) => {
        if (!token) return;
        await fetch(getApiUrl(`/api/notifications/${notificationId}/read`), {
          method: "POST",
          headers: { Authorization: `Bearer ${token.access}`, ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}) },
        }).catch(() => {});
        fetchNotifications(token.access).catch(() => {});
      }}
      onReadAllNotifications={async () => {
        if (!token) return;
        await fetch(getApiUrl("/api/notifications/read-all"), {
          method: "POST",
          headers: { Authorization: `Bearer ${token.access}`, ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}) },
        }).catch(() => {});
        fetchNotifications(token.access).catch(() => {});
      }}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onCreateClick={canManageBoard ? handleOpenCreateTask : undefined}
      onCreateSpaceClick={() => setCreateSpaceOpen(true)}
      onCreateBoardClick={canManageBoard ? handleCreateBoard : undefined}
      onAddAction={(action) => {
        if (action === "folder") {
          if (!canManageBoard) {
            setAuthError(uiLanguage === "en" ? "Only manager and above can create folders" : "Создавать папки могут только менеджер и выше");
            return;
          }
          setCreateFolderOpen(true);
          return;
        }
        if (action === "space") {
          if (!(effectiveRole === "lead" || effectiveRole === "admin")) {
            setAuthError(uiLanguage === "en" ? "Only lead/admin can create spaces" : "Создавать пространства могут только lead/admin");
            return;
          }
          setCreateSpaceOpen(true);
          return;
        }
        if (action === "storymap") {
          if (!canManageBoard) {
            setAuthError(uiLanguage === "en" ? "Only manager and above can create boards" : "Создавать доски могут только менеджер и выше");
            return;
          }
          handleCreateBoard();
          return;
        }
        if (action === "document") {
          setKaitenTab("settings");
          createDocument();
          return;
        }
        if (action === "board") {
          if (!canManageBoard) {
            setAuthError(uiLanguage === "en" ? "Only manager and above can create boards" : "Создавать доски могут только менеджер и выше");
            return;
          }
          handleCreateBoard();
          return;
        }
      }}
      userName={displayUserName}
      userEmail={email}
      avatarUrl={profileAvatarUrl || undefined}
      onProfileSettingsClick={() => setProfileDialogOpen(true)}
      language={uiLanguage}
      onLanguageChange={setUiLanguage}
      colorTheme={uiTheme}
      onColorThemeChange={setUiTheme}
      currentUserRole={effectiveRole}
      canManageCurrentSpace={canManageCurrentSpace}
      onOpenAdministration={() => {
        if (!isAdmin) return;
        setKaitenTab("administration");
      }}
      onOpenTemplates={() => setKaitenTab("settings")}
      onLogout={() => {
        setToken(null);
        setActiveSpaceId(null);
        setActiveProjectId(null);
        setActiveBoardId(null);
        localStorage.removeItem(ACCESS_STORAGE_KEY);
        localStorage.removeItem(REFRESH_STORAGE_KEY);
      }}
    >
      <div
        className="kaiten-app-content flex flex-col flex-1 min-h-0"
        style={{ background: uiColors.pageBg }}
        role="region"
        aria-label="Контент приложения"
      >
        {kaitenTab === "reports" && (
          <div className="flex items-center justify-center flex-1 text-[var(--k-text-muted)] text-sm">
            Отчёты будут доступны в следующей версии.
          </div>
        )}

        {kaitenTab === "archive" && (
          <div className="flex items-center justify-center flex-1 text-[var(--k-text-muted)] text-sm">
            Архив карточек будет доступен в следующей версии.
          </div>
        )}

        {kaitenTab === "filters" && (
          <div
            className="flex flex-col flex-1 min-h-0 rounded-2xl shadow-sm p-4 overflow-auto m-4"
            style={{ background: uiColors.cardBg, border: `1px solid ${uiColors.border}` }}
          >
            <div className="text-[var(--k-text-muted)] text-xs font-semibold uppercase tracking-wide mb-3">Сохранённые фильтры</div>
            <p className="text-[var(--k-text-muted)] text-sm">Пока сохранённых фильтров нет. Создавайте фильтры из панели доски.</p>
          </div>
        )}

        {kaitenTab === "lists" && (
          <div id="boardsContainer" className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {!activeBoardId ? (
              <div className="flex-1 flex items-center justify-center text-[var(--k-text-muted)] min-h-[320px]">
                Выберите доску из меню слева
              </div>
            ) : (
              <>
                {/* Канбан-доска */}
                {viewMode === "board" && (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <KanbanBoard
                      boardId={activeBoardId}
                      token={access}
                      activeSpaceId={activeSpaceId}
                      refreshToken={kanbanRefreshTick}
                      locale={uiLanguage}
                      filters={filters}
                      onCreateCard={canManageBoard ? handleCreateCardInColumn : undefined}
                      highlightColumnId={kanbanHighlightColumnId}
                    />
                  </div>
                )}

                {/* Вид списком */}
                {viewMode === "list" && <ListView boards={boardsForListView} onCardClick={openCardDetails} locale={uiLanguage} />}

                {/* Таблица */}
                {viewMode === "table" && <TableView cards={cardsWithMeta} onCardClick={openCardDetails} locale={uiLanguage} />}

                {/* Timeline */}
                {viewMode === "timeline" && <TimelineView cards={cardsWithMeta} onCardClick={openCardDetails} locale={uiLanguage} />}

                {/* Календарь */}
                {viewMode === "calendar" && <CalendarView cards={cardsWithMeta} onCardClick={openCardDetails} locale={uiLanguage} />}
              </>
            )}

            <FiltersPopover
              anchorEl={filtersAnchorEl}
              open={Boolean(filtersAnchorEl)}
              onClose={() => setFiltersAnchorEl(null)}
              filters={filters}
              onChangeFilters={setFilters}
            />
          </div>
        )}

        {kaitenTab === "settings" && (
          <div
            id="docsContainer"
            className={
              docEditorImmersive
                ? "flex flex-col flex-1 min-h-0 overflow-hidden m-0 rounded-none shadow-none"
                : "flex flex-col flex-1 min-h-0 rounded-2xl shadow-sm p-4 overflow-auto m-4"
            }
            style={
              docEditorImmersive
                ? { background: uiColors.pageBg }
                : { background: uiColors.cardBg, border: `1px solid ${uiColors.border}` }
            }
          >
            <div
              className={
                docEditorImmersive ? "flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden" : "flex items-start justify-between gap-6"
              }
            >
              <div className={docEditorImmersive ? "w-full flex flex-col flex-1 min-h-0 min-w-0" : "w-full"}>
                {!docEditorImmersive && docsLoading ? (
                  <div className="text-[var(--k-text-muted)]">Загрузка документов...</div>
                ) : null}
                {!docEditorImmersive && docsError ? (
                  <div className="text-red-500 text-sm mb-2">
                    {String(docsError).toLowerCase().includes("not implemented")
                      ? uiLanguage === "en"
                        ? "Documents API is being connected. Try again in a few seconds."
                        : "API документов подключается. Попробуйте еще раз через несколько секунд."
                      : docsError}
                  </div>
                ) : null}

                <div
                  className={
                    docEditorImmersive
                      ? "flex flex-col flex-1 min-h-0 min-w-0 gap-0"
                      : "grid grid-cols-1 lg:grid-cols-[minmax(0,200px)_1fr] gap-4"
                  }
                >
                  {!docEditorImmersive ? (
                  <div id="docsList" className="border border-[var(--k-border)] rounded-2xl p-2 shrink-0">
                    <div className="mb-1.5 flex items-center justify-between gap-1">
                      <div className="font-bold text-[var(--k-text)] text-xs uppercase tracking-wide">
                        {uiLanguage === "en" ? "Documents" : "Документы"}
                      </div>
                      <GreyButton variant="soft" disabled={createBusy} onClick={() => createDocument()}>
                        {createBusy
                          ? uiLanguage === "en"
                            ? "Creating..."
                            : "Создание..."
                          : uiLanguage === "en"
                            ? "New"
                            : "Новый"}
                      </GreyButton>
                    </div>
                    <div className="space-y-2">
                      {docs.length ? (
                        docs.map((d) => (
                          <button
                            key={d.id}
                            onClick={async () => {
                              if (!access || !activeSpaceId) return;
                              setDocImmersiveMode(false);
                              const detail = await fetchDocDetail(access, d.id);
                              setSelectedDoc(detail);
                              const parsed = parseDocumentContent(detail.content || "");
                              setDocIcon(parsed.icon);
                              setDocBlocks(parsed.blocks);
                            }}
                            className={
                              "w-full text-left rounded-lg px-2 py-1.5 border transition-colors " +
                              (selectedDoc?.id === d.id
                                ? "bg-[var(--k-page-bg)] border-[var(--k-border)]"
                                : "bg-[var(--k-surface-bg)] border-[var(--k-border)] hover:bg-[var(--k-page-bg)]")
                            }
                          >
                            <div className="text-[var(--k-text)] font-semibold text-xs truncate leading-tight">{d.title}</div>
                            <div className="text-[var(--k-text-muted)] text-[10px] mt-0.5 tabular-nums">
                              {new Date(d.updated_at).toLocaleDateString(uiLanguage === "en" ? "en-US" : "ru-RU")}
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="text-[var(--k-text-muted)] text-sm">
                          {uiLanguage === "en" ? "No documents yet" : "Документов пока нет"}
                        </div>
                      )}
                    </div>
                  </div>
                  ) : null}

                  <div
                    id="docsDetail"
                    className={
                      docEditorImmersive
                        ? "flex flex-col flex-1 min-h-0 min-w-0 overflow-hidden border-0 rounded-none bg-transparent p-0"
                        : "border border-[var(--k-border)] rounded-2xl p-3"
                    }
                  >
                    {selectedDoc ? (
                      <>
                        {docEditorImmersive ? (
                          <div className="flex-shrink-0 flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-5 py-2.5 border-b border-[var(--k-border)] bg-[var(--k-surface-bg)]">
                            <button
                              type="button"
                              onClick={() => setDocImmersiveMode(false)}
                              className="text-sm font-semibold text-[var(--k-text)] px-2 py-1 rounded-lg hover:bg-[var(--k-page-bg)] transition-colors"
                            >
                              {uiLanguage === "en" ? "← Documents" : "← Документы"}
                            </button>
                            <span className="hidden md:block flex-1 min-w-0 truncate text-sm text-[var(--k-text-muted)]">
                              {selectedDoc.title}
                            </span>
                            <div className="flex rounded-lg border border-[var(--k-border)] bg-[var(--k-page-bg)] p-0.5 text-xs shrink-0">
                              <button
                                type="button"
                                onClick={() => setDocViewMode("edit")}
                                className={
                                  "rounded-md px-2.5 py-1 font-medium transition-colors " +
                                  (docViewMode === "edit"
                                    ? "bg-[var(--k-surface-bg)] text-[var(--k-text)] shadow-sm"
                                    : "text-[var(--k-text-muted)] hover:text-[var(--k-text)]")
                                }
                              >
                                {uiLanguage === "en" ? "Edit" : "Редактирование"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDocViewMode("preview")}
                                className={
                                  "rounded-md px-2.5 py-1 font-medium transition-colors " +
                                  (docViewMode === "preview"
                                    ? "bg-[var(--k-surface-bg)] text-[var(--k-text)] shadow-sm"
                                    : "text-[var(--k-text-muted)] hover:text-[var(--k-text)]")
                                }
                              >
                                {uiLanguage === "en" ? "View" : "Просмотр"}
                              </button>
                            </div>
                            <span className="text-[11px] sm:text-xs px-2.5 py-1 rounded-full bg-[var(--k-page-bg)] border border-[var(--k-border)] text-[var(--k-text-muted)] tabular-nums whitespace-nowrap">
                              {uiLanguage === "en" ? "Updated at" : "Обновлен в"}{" "}
                              {new Date(selectedDoc.updated_at).toLocaleTimeString(
                                uiLanguage === "en" ? "en-US" : "ru-RU",
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </span>
                            {docViewMode === "edit" ? (
                              <GreyButton variant="primary" disabled={docSaveBusy} onClick={saveSelectedDocument}>
                                {docSaveBusy
                                  ? uiLanguage === "en"
                                    ? "Saving..."
                                    : "Сохранение..."
                                  : uiLanguage === "en"
                                    ? "Save"
                                    : "Сохранить"}
                              </GreyButton>
                            ) : null}
                          </div>
                        ) : null}
                        {!docEditorImmersive ? (
                          <div className="mb-3 flex items-center justify-between gap-2">
                            {!docPreviewMode ? (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setDocIconPickerOpen((prev) => !prev)}
                                  className="rounded-xl px-3 py-1.5 text-sm border border-[var(--k-border)] hover:bg-[var(--k-page-bg)]"
                                >
                                  {uiLanguage === "en" ? "Add icon" : "Добавить иконку"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => addDocBlock("comment")}
                                  className="rounded-xl px-3 py-1.5 text-sm border border-[var(--k-border)] hover:bg-[var(--k-page-bg)]"
                                >
                                  {uiLanguage === "en" ? "Add comment" : "Добавить комментарий"}
                                </button>
                              </div>
                            ) : (
                              <div />
                            )}
                            <div className="flex items-center gap-2 flex-wrap justify-end">
                              <div className="flex rounded-lg border border-[var(--k-border)] bg-[var(--k-page-bg)] p-0.5 text-xs">
                                <button
                                  type="button"
                                  onClick={() => setDocViewMode("edit")}
                                  className={
                                    "rounded-md px-2 py-1 font-medium transition-colors " +
                                    (docViewMode === "edit"
                                      ? "bg-[var(--k-surface-bg)] text-[var(--k-text)] shadow-sm"
                                      : "text-[var(--k-text-muted)] hover:text-[var(--k-text)]")
                                  }
                                >
                                  {uiLanguage === "en" ? "Edit" : "Редактирование"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocViewMode("preview")}
                                  className={
                                    "rounded-md px-2 py-1 font-medium transition-colors " +
                                    (docViewMode === "preview"
                                      ? "bg-[var(--k-surface-bg)] text-[var(--k-text)] shadow-sm"
                                      : "text-[var(--k-text-muted)] hover:text-[var(--k-text)]")
                                  }
                                >
                                  {uiLanguage === "en" ? "View" : "Просмотр"}
                                </button>
                              </div>
                              <button
                                type="button"
                                onClick={() => setDocImmersiveMode(true)}
                                className="rounded-xl px-3 py-1.5 text-sm border border-[var(--k-border)] text-[var(--k-text)] hover:bg-[var(--k-page-bg)] whitespace-nowrap"
                              >
                                {uiLanguage === "en" ? "Full screen" : "На весь экран"}
                              </button>
                              {docViewMode === "edit" ? (
                                <GreyButton variant="primary" disabled={docSaveBusy} onClick={saveSelectedDocument}>
                                  {docSaveBusy
                                    ? uiLanguage === "en"
                                      ? "Saving..."
                                      : "Сохранение..."
                                    : uiLanguage === "en"
                                      ? "Save"
                                      : "Сохранить"}
                                </GreyButton>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        <div
                          style={docEditorImmersive ? undefined : { display: "contents" }}
                          className={docEditorImmersive ? "flex-1 min-h-0 overflow-y-auto w-full" : undefined}
                        >
                          <div
                            style={docEditorImmersive ? undefined : { display: "contents" }}
                            className={
                              docEditorImmersive
                                ? "max-w-3xl mx-auto w-full px-4 sm:px-10 py-8 pb-28 box-border"
                                : undefined
                            }
                          >
                        {docIconPickerOpen && !docPreviewMode ? (
                          <div className="mb-3 rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3">
                            <div className="grid grid-cols-10 gap-2">
                              {DOC_ICON_COLLECTION.map((icon) => (
                                <button
                                  key={icon}
                                  type="button"
                                  onClick={() => {
                                    setDocIcon(icon);
                                    setDocIconPickerOpen(false);
                                  }}
                                  className="h-8 w-8 rounded-lg border border-[var(--k-border)] hover:bg-[var(--k-page-bg)]"
                                  title={icon}
                                >
                                  {icon}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className={docEditorImmersive ? "flex items-start gap-3" : "flex items-center gap-3"}>
                          {docEditorImmersive ? (
                            <button
                              type="button"
                              onClick={() => !docPreviewMode && setDocIconPickerOpen((p) => !p)}
                              disabled={docPreviewMode}
                              title={
                                docPreviewMode
                                  ? undefined
                                  : uiLanguage === "en"
                                    ? "Choose icon"
                                    : "Выбрать иконку"
                              }
                              className={
                                "w-14 h-14 shrink-0 rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] flex items-center justify-center text-2xl transition-colors " +
                                (docPreviewMode
                                  ? "cursor-default opacity-90"
                                  : "hover:bg-[var(--k-page-bg)] cursor-pointer active:scale-[0.98]")
                              }
                            >
                              {docIcon || "📄"}
                            </button>
                          ) : (
                            <div className="w-12 h-12 rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] flex items-center justify-center text-xl">
                              {docIcon || "📄"}
                            </div>
                          )}
                          {docPreviewMode ? (
                            <h1 className="w-full py-2 text-[var(--k-text)] font-bold text-3xl sm:text-4xl tracking-tight leading-tight">
                              {selectedDoc.title?.trim() ||
                                (uiLanguage === "en" ? "Untitled document" : "Безымянный документ")}
                            </h1>
                          ) : (
                            <input
                              value={selectedDoc.title}
                              onChange={(e) => setSelectedDoc({ ...selectedDoc, title: e.target.value })}
                              placeholder={
                                uiLanguage === "en" ? "Untitled document" : "Безымянный документ"
                              }
                              className={
                                docEditorImmersive
                                  ? "w-full bg-transparent border-0 border-b border-transparent focus:border-[var(--k-border)] rounded-none px-0 py-2 text-[var(--k-text)] font-bold text-3xl sm:text-4xl tracking-tight outline-none placeholder:text-[var(--k-text-muted)] placeholder:opacity-60"
                                  : "w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-[var(--k-text)] font-bold text-lg outline-none focus:border-[var(--k-border)]"
                              }
                            />
                          )}
                        </div>
                        {!docEditorImmersive ? (
                          <div className="text-[var(--k-text-muted)] text-xs mt-1">
                            {uiLanguage === "en" ? "Updated" : "Обновлено"}:{" "}
                            {new Date(selectedDoc.updated_at).toLocaleString(uiLanguage === "en" ? "en-US" : "ru-RU")}
                          </div>
                        ) : docPreviewMode ? (
                          <hr className="border-0 border-t border-[var(--k-border)] my-5" />
                        ) : (
                          <>
                            <hr className="border-0 border-t border-[var(--k-border)] my-5" />
                            <p className="text-sm text-[var(--k-text-muted)] mb-4">
                              {uiLanguage === "en"
                                ? "Enter text, press + for a block or / for commands"
                                : "Введите текст, нажмите + для блока или / для команд"}
                            </p>
                          </>
                        )}

                        {!docEditorImmersive && !docPreviewMode ? (
                          <div className="mt-4 flex items-center gap-2">
                            <select
                              value={newDocBlockType}
                              onChange={(e) => setNewDocBlockType((e.target.value as DocBlock["type"]) || "text")}
                              className="rounded-xl px-3 py-1.5 text-sm border border-[var(--k-border)] bg-[var(--k-surface-bg)] text-[var(--k-text)]"
                            >
                              <option value="text">{uiLanguage === "en" ? "Text" : "Текст"}</option>
                              <option value="heading">{uiLanguage === "en" ? "Heading" : "Заголовок"}</option>
                              <option value="bulleted">{uiLanguage === "en" ? "Bulleted list" : "Список"}</option>
                              <option value="numbered">{uiLanguage === "en" ? "Numbered list" : "Нумерованный список"}</option>
                              <option value="todo">{uiLanguage === "en" ? "To-do" : "To-do"}</option>
                              <option value="quote">{uiLanguage === "en" ? "Quote" : "Цитата"}</option>
                              <option value="callout">{uiLanguage === "en" ? "Callout" : "Выделение"}</option>
                              <option value="divider">{uiLanguage === "en" ? "Divider" : "Разделитель"}</option>
                              <option value="comment">{uiLanguage === "en" ? "Comment" : "Комментарий"}</option>
                            </select>
                            <button
                              type="button"
                              onClick={() => addDocBlock(newDocBlockType)}
                              className="rounded-xl px-3 py-1.5 text-sm border border-[var(--k-border)] hover:bg-[var(--k-page-bg)]"
                            >
                              {uiLanguage === "en" ? "Add block" : "Добавить блок"}
                            </button>
                          </div>
                        ) : null}

                        {docPreviewMode ? (
                          <div className="mt-6 space-y-0">
                            {docBlocks.map((block) => (
                              <DocBlockReadonlyPreview key={block.id} block={block} locale={uiLanguage} />
                            ))}
                          </div>
                        ) : (
                        <div ref={docEditorRef} className="mt-4 space-y-1">
                          {docBlocks.map((block, index) => (
                            <div
                              key={block.id}
                              onDragOver={(e) => {
                                e.preventDefault();
                                if (draggedDocBlockId) {
                                  const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                                  const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
                                  setDropIndicator({ blockId: block.id, position });
                                }
                              }}
                              onDragLeave={() => {
                                if (dropIndicator?.blockId === block.id) setDropIndicator(null);
                              }}
                              onDrop={() => {
                                if (!draggedDocBlockId) return;
                                moveDocBlock(draggedDocBlockId, block.id, dropIndicator?.position ?? "before");
                                setDraggedDocBlockId(null);
                                setDropIndicator(null);
                              }}
                              className={
                                block.type === "comment"
                                  ? "rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3"
                                  : "group rounded-xl px-2 py-1 hover:bg-[var(--k-surface-bg)] relative"
                              }
                              style={
                                draggedDocBlockId && dropIndicator?.blockId === block.id
                                  ? {
                                      boxShadow:
                                        dropIndicator.position === "before"
                                          ? "inset 0 3px 0 0 rgba(138,43,226,0.9)"
                                          : "inset 0 -3px 0 0 rgba(138,43,226,0.9)",
                                    }
                                  : undefined
                              }
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <button
                                  type="button"
                                  onClick={() => addDocBlock("text", block.id)}
                                  className="text-xs text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                  title={uiLanguage === "en" ? "Add block" : "Добавить блок"}
                                >
                                  +
                                </button>
                                <button
                                  type="button"
                                  draggable
                                  onDragStart={(e) => {
                                    e.dataTransfer.effectAllowed = "move";
                                    setDraggedDocBlockId(block.id);
                                  }}
                                  onDragEnd={() => {
                                    setDraggedDocBlockId(null);
                                    setDropIndicator(null);
                                  }}
                                  className="text-xs text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity cursor-grab"
                                  title={uiLanguage === "en" ? "Drag block" : "Перетащить блок"}
                                >
                                  ⋮⋮
                                </button>
                                <span className="text-[10px] text-[var(--k-text-muted)] uppercase">
                                  {block.type === "comment"
                                    ? uiLanguage === "en"
                                      ? "Comment"
                                      : "Комментарий"
                                    : block.type === "heading"
                                      ? uiLanguage === "en"
                                        ? "Heading"
                                        : "Заголовок"
                                      : block.type === "bulleted"
                                        ? uiLanguage === "en"
                                          ? "List"
                                          : "Список"
                                      : block.type === "numbered"
                                        ? uiLanguage === "en"
                                          ? "Numbered"
                                          : "Нумерованный"
                                      : block.type === "todo"
                                        ? "To-do"
                                      : block.type === "quote"
                                        ? uiLanguage === "en"
                                          ? "Quote"
                                          : "Цитата"
                                      : block.type === "callout"
                                        ? uiLanguage === "en"
                                          ? "Callout"
                                          : "Выделение"
                                      : block.type === "divider"
                                        ? uiLanguage === "en"
                                          ? "Divider"
                                          : "Разделитель"
                                        : uiLanguage === "en"
                                          ? "Text"
                                          : "Текст"}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "text")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  text
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "heading")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  h1
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "bulleted")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  list
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "numbered")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  num
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "todo")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  todo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "quote")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  quote
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "callout")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  callout
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "divider")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  div
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDocBlockType(block.id, "comment")}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  note
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setBlockMenuOpenId((prev) => (prev === block.id ? null : block.id))}
                                  className="text-[10px] text-[var(--k-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
                                  title={uiLanguage === "en" ? "More" : "Еще"}
                                >
                                  ...
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeDocBlock(block.id)}
                                  className="ml-auto text-xs text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  {uiLanguage === "en" ? "Delete" : "Удалить"}
                                </button>
                              </div>
                              {blockMenuOpenId === block.id ? (
                                <div
                                  data-doc-block-menu
                                  className="absolute right-6 top-7 z-20 w-52 rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] shadow-2xl p-1"
                                >
                                  <button
                                    type="button"
                                    onClick={() => duplicateDocBlock(block.id)}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Duplicate" : "Дублировать"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "text");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into Text" : "Преобразовать в текст"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "heading");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into Heading" : "Преобразовать в заголовок"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "bulleted");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into List" : "Преобразовать в список"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "numbered");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into Numbered list" : "Преобразовать в нумерованный"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "todo");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into To-do" : "Преобразовать в To-do"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "quote");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into Quote" : "Преобразовать в цитату"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "callout");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into Callout" : "Преобразовать в выделение"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDocBlockType(block.id, "divider");
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm"
                                  >
                                    {uiLanguage === "en" ? "Turn into Divider" : "Преобразовать в разделитель"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      removeDocBlock(block.id);
                                      setBlockMenuOpenId(null);
                                    }}
                                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-[var(--k-page-bg)] text-sm text-red-500"
                                  >
                                    {uiLanguage === "en" ? "Delete" : "Удалить"}
                                  </button>
                                </div>
                              ) : null}
                              {block.type === "divider" ? (
                                <div className="py-2">
                                  <div className="h-px bg-[var(--k-border)]" />
                                </div>
                              ) : block.type === "heading" ? (
                                <input
                                  data-doc-input-id={block.id}
                                  value={block.content}
                                  onKeyDown={(e) => handleDocBlockKeyDown(e, block)}
                                  onChange={(e) => updateDocBlock(block.id, e.target.value)}
                                  placeholder={uiLanguage === "en" ? "Heading" : "Заголовок"}
                                  className="w-full bg-transparent text-2xl font-bold tracking-tight text-[var(--k-text)] outline-none"
                                />
                              ) : block.type === "todo" ? (
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(block.checked)}
                                    onChange={(e) => updateDocBlockChecked(block.id, e.target.checked)}
                                    className="mt-1"
                                  />
                                  <textarea
                                    data-doc-input-id={block.id}
                                    value={block.content}
                                    onKeyDown={(e) => handleDocBlockKeyDown(e, block)}
                                    onChange={(e) => updateDocBlock(block.id, e.target.value)}
                                    placeholder={uiLanguage === "en" ? "To-do item" : "Пункт задачи"}
                                    rows={Math.max(1, Math.min(6, block.content.split("\n").length + 1))}
                                    className={
                                      "w-full resize-none border-0 bg-transparent p-0 text-sm outline-none focus:outline-none " +
                                      (block.checked ? "line-through text-[var(--k-text-muted)]" : "text-[var(--k-text)]")
                                    }
                                  />
                                </div>
                              ) : block.type === "callout" ? (
                                <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-3 flex gap-2">
                                  <span className="text-lg leading-none">💡</span>
                                  <textarea
                                    data-doc-input-id={block.id}
                                    value={block.content}
                                    onKeyDown={(e) => handleDocBlockKeyDown(e, block)}
                                    onChange={(e) => updateDocBlock(block.id, e.target.value)}
                                    placeholder={uiLanguage === "en" ? "Callout..." : "Выделение..."}
                                    rows={Math.max(1, Math.min(6, block.content.split("\n").length + 1))}
                                    className="w-full resize-none border-0 bg-transparent p-0 text-sm outline-none focus:outline-none"
                                  />
                                </div>
                              ) : block.type === "quote" ? (
                                <div className="border-l-2 border-[var(--k-border)] pl-3">
                                  <textarea
                                    data-doc-input-id={block.id}
                                    value={block.content}
                                    onKeyDown={(e) => handleDocBlockKeyDown(e, block)}
                                    onChange={(e) => updateDocBlock(block.id, e.target.value)}
                                    placeholder={uiLanguage === "en" ? "Quote..." : "Цитата..."}
                                    rows={Math.max(1, Math.min(6, block.content.split("\n").length + 1))}
                                    className="w-full resize-none border-0 bg-transparent p-0 text-sm italic outline-none focus:outline-none"
                                  />
                                </div>
                              ) : (
                                <textarea
                                  data-doc-input-id={block.id}
                                  value={block.content}
                                  onKeyDown={(e) => handleDocBlockKeyDown(e, block)}
                                  onChange={(e) => updateDocBlock(block.id, e.target.value)}
                                  placeholder={
                                    block.type === "comment"
                                      ? uiLanguage === "en"
                                        ? "Comment..."
                                        : "Комментарий..."
                                      : block.type === "bulleted" || block.type === "numbered"
                                        ? uiLanguage === "en"
                                          ? "One item per line"
                                          : "Каждый пункт с новой строки"
                                      : uiLanguage === "en"
                                        ? "Type '/' for commands or start writing..."
                                        : "Введите '/' для команд или начните писать..."
                                  }
                                  rows={Math.max(2, Math.min(10, block.content.split("\n").length + 1))}
                                  className={
                                    block.type === "comment"
                                      ? "w-full resize-none rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-3 text-sm outline-none focus:border-[var(--k-border)]"
                                      : "w-full resize-none border-0 bg-transparent p-0 text-sm outline-none focus:outline-none"
                                  }
                                />
                              )}
                              {slashMenu?.blockId === block.id ? (
                                <div className="absolute left-8 top-9 z-20 w-56 rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] shadow-2xl p-1">
                                  {getSlashItems(slashMenu.query).map((item, idx) => (
                                      <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setDocBlockType(block.id, item.id as DocBlock["type"])}
                                        onMouseEnter={() => setSlashMenuIndex(idx)}
                                        className={
                                          "w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center gap-2 " +
                                          (idx === slashMenuIndex ? "bg-[var(--k-page-bg)]" : "hover:bg-[var(--k-page-bg)]")
                                        }
                                      >
                                        <span className="text-xs text-[var(--k-text-muted)] w-5 inline-flex justify-center">{item.icon}</span>
                                        <span>/{item.label}</span>
                                      </button>
                                    ))}
                                </div>
                              ) : null}
                              {index < docBlocks.length - 1 ? <div className="mt-2 border-b border-dashed border-[var(--k-border)]" /> : null}
                            </div>
                          ))}
                        </div>
                        )}

                        {!docPreviewMode ? (
                        <div className="mt-4 text-[var(--k-text-muted)] text-xs">
                          {uiLanguage === "en" ? "Type" : "Тип"}:{" "}
                          {selectedDoc.doc_type === "knowledge_base"
                            ? uiLanguage === "en"
                              ? "Knowledge base"
                              : "База знаний"
                            : uiLanguage === "en"
                              ? "Document"
                              : "Документ"}
                        </div>
                        ) : null}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center">
                        <div className="text-xl mb-2">📄</div>
                        <div className="text-[var(--k-text)] font-semibold mb-1">
                          {uiLanguage === "en" ? "No document selected" : "Документ не выбран"}
                        </div>
                        <div className="text-[var(--k-text-muted)] text-sm mb-4">
                          {uiLanguage === "en"
                            ? "Create a new document and start writing like in Notion."
                            : "Создайте новый документ и начните писать как в Notion."}
                        </div>
                        <GreyButton variant="primary" disabled={createBusy} onClick={() => createDocument()}>
                          {createBusy
                            ? uiLanguage === "en"
                              ? "Creating..."
                              : "Создание..."
                            : uiLanguage === "en"
                              ? "Create document"
                              : "Создать документ"}
                        </GreyButton>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {kaitenTab === "administration" && (
          <div
            className="flex flex-col flex-1 min-h-0 rounded-2xl shadow-sm p-4 overflow-auto m-4"
            style={{ background: uiColors.cardBg, border: `1px solid ${uiColors.border}` }}
          >
            <div className="font-bold text-[var(--k-text)] text-lg mb-3">
              {uiLanguage === "en" ? "Administration" : "Администрирование"}
            </div>
            {orgUsersLoading ? <div className="text-[var(--k-text-muted)] text-sm">{uiLanguage === "en" ? "Loading users..." : "Загрузка пользователей..."}</div> : null}
            {orgUsersError ? <div className="text-red-500 text-sm mb-3">{orgUsersError}</div> : null}

            <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3 mb-4">
              <div className="font-semibold text-[var(--k-text)] mb-2">{uiLanguage === "en" ? "Create user" : "Создать пользователя"}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  placeholder={uiLanguage === "en" ? "Email" : "Email"}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-[var(--k-text)] outline-none"
                />
                <input
                  value={newUserFullName}
                  onChange={(e) => setNewUserFullName(e.target.value)}
                  placeholder={uiLanguage === "en" ? "Full name" : "Имя"}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-[var(--k-text)] outline-none"
                />
                <input
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  type="password"
                  placeholder={uiLanguage === "en" ? "Password (min 8)" : "Пароль (мин. 8)"}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-[var(--k-text)] outline-none"
                />
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value as OrgUser["role"])}
                  className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-[var(--k-text)] outline-none"
                >
                  <option value="user">{uiLanguage === "en" ? "User" : "Пользователь"}</option>
                  <option value="manager">{uiLanguage === "en" ? "Manager" : "Менеджер"}</option>
                  <option value="lead">{uiLanguage === "en" ? "Lead" : "Руководитель"}</option>
                  <option value="admin">{uiLanguage === "en" ? "Admin" : "Администратор"}</option>
                </select>
              </div>
              <div className="mt-3 flex justify-end">
                <GreyButton
                  variant="primary"
                  disabled={newUserBusy || !newUserEmail.trim() || newUserPassword.trim().length < 8}
                  onClick={async () => {
                    if (!token || !activeSpaceId) return;
                    setNewUserBusy(true);
                    setOrgUsersError(null);
                    try {
                      const res = await fetch(getApiUrl("/api/auth/users"), {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${token.access}`,
                          "X-Space-Id": activeSpaceId,
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                          email: newUserEmail.trim(),
                          password: newUserPassword,
                          full_name: newUserFullName.trim(),
                          role: newUserRole,
                        }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать пользователя");
                      setNewUserEmail("");
                      setNewUserPassword("");
                      setNewUserFullName("");
                      setNewUserRole("user");
                      await fetchOrganizationUsers(token.access, activeSpaceId);
                    } catch (e: any) {
                      setOrgUsersError(e?.message ?? "Ошибка создания пользователя");
                    } finally {
                      setNewUserBusy(false);
                    }
                  }}
                >
                  {newUserBusy
                    ? uiLanguage === "en"
                      ? "Creating..."
                      : "Создание..."
                    : uiLanguage === "en"
                      ? "Create user"
                      : "Создать пользователя"}
                </GreyButton>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3">
              <div className="font-semibold text-[var(--k-text)] mb-2">{uiLanguage === "en" ? "Users and roles" : "Пользователи и роли"}</div>
              <div className="space-y-2">
                {orgUsers.map((u) => (
                  <div key={u.id} className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-3 flex flex-col md:flex-row md:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--k-text)] font-semibold truncate">{u.full_name || u.email}</div>
                      <div className="text-[var(--k-text-muted)] text-sm truncate">{u.email}</div>
                    </div>
                    <select
                      value={u.role}
                      onChange={async (e) => {
                        if (!token || !activeSpaceId) return;
                        const nextRole = e.target.value as OrgUser["role"];
                        try {
                          const res = await fetch(getApiUrl(`/api/auth/users/${u.id}/role`), {
                            method: "PATCH",
                            headers: {
                              Authorization: `Bearer ${token.access}`,
                              "X-Space-Id": activeSpaceId,
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({ role: nextRole }),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) throw new Error(data?.detail ?? "Не удалось обновить роль");
                          setOrgUsers((prev) => prev.map((it) => (it.id === u.id ? { ...it, role: nextRole } : it)));
                        } catch (e: any) {
                          setOrgUsersError(e?.message ?? "Ошибка обновления роли");
                        }
                      }}
                      className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-[var(--k-text)] outline-none"
                    >
                      <option value="user">{uiLanguage === "en" ? "User" : "Пользователь"}</option>
                      <option value="manager">{uiLanguage === "en" ? "Manager" : "Менеджер"}</option>
                      <option value="lead">{uiLanguage === "en" ? "Lead" : "Руководитель"}</option>
                      <option value="admin">{uiLanguage === "en" ? "Admin" : "Администратор"}</option>
                    </select>
                  </div>
                ))}
                {!orgUsers.length && !orgUsersLoading ? (
                  <div className="text-[var(--k-text-muted)] text-sm">{uiLanguage === "en" ? "No users found" : "Пользователи не найдены"}</div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {tourOpen ? (
        <div className="fixed inset-0 z-[140] bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div
            className="w-full max-w-2xl rounded-3xl border p-6 shadow-2xl"
            style={{ background: uiColors.cardBg, borderColor: uiColors.border }}
          >
            <div className="text-[var(--k-text-muted)] text-xs uppercase tracking-wide mb-2">
              {uiLanguage === "en" ? "Platform tour" : "Тур по платформе"}
            </div>
            <div className="text-2xl font-bold text-[var(--k-text)] mb-3">
              {uiLanguage === "en" ? "Start faster with AGB Tasks" : "Быстрый старт в AGB Tasks"}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3">
                <div className="font-semibold text-[var(--k-text)] mb-1">{uiLanguage === "en" ? "Boards" : "Доски"}</div>
                <div className="text-sm text-[var(--k-text-muted)]">
                  {uiLanguage === "en" ? "Plan work in kanban, list and calendar views." : "Планируйте задачи в канбане, списке и календаре."}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3">
                <div className="font-semibold text-[var(--k-text)] mb-1">{uiLanguage === "en" ? "Documents" : "Документы"}</div>
                <div className="text-sm text-[var(--k-text-muted)]">
                  {uiLanguage === "en" ? "Keep process docs near tasks." : "Ведите документацию рядом с задачами."}
                </div>
              </div>
              <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-3">
                <div className="font-semibold text-[var(--k-text)] mb-1">{uiLanguage === "en" ? "Notifications" : "Уведомления"}</div>
                <div className="text-sm text-[var(--k-text-muted)]">
                  {uiLanguage === "en" ? "Track card changes and comments in real time." : "Отслеживайте изменения карточек и комментарии в реальном времени."}
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <GreyButton
                variant="primary"
                onClick={() => {
                  setTourOpen(false);
                  try {
                    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
                  } catch {
                    // ignore
                  }
                }}
              >
                {uiLanguage === "en" ? "Got it" : "Понятно"}
              </GreyButton>
            </div>
          </div>
        </div>
      ) : null}

      {selectedCard ? (
        <CardModal
          card={selectedCard}
          locale={uiLanguage}
          onAddChecklist={async (title) => {
            if (!token || !selectedCard) return;
            const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCard.id}/checklists`), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.access}`,
                "X-Space-Id": activeSpaceId || "",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ title }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать чек-лист");
            await refreshSelectedCard();
            if (data && typeof data === "object" && "id" in data && typeof data.id === "string") {
              return { id: data.id };
            }
          }}
          onAddChecklistItem={async (checklistId, title) => {
            if (!token || !selectedCard) return;
            const res = await fetch(getApiUrl(`/api/kanban/checklists/${checklistId}/items`), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.access}`,
                "X-Space-Id": activeSpaceId || "",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ title }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать пункт");
            await refreshSelectedCard();
          }}
          onToggleChecklistItem={async (itemId, isDone) => {
            if (!token || !selectedCard) return;
            const res = await fetch(getApiUrl(`/api/kanban/checklist-items/${itemId}`), {
              method: "PATCH",
              headers: {
                Authorization: `Bearer ${token.access}`,
                "X-Space-Id": activeSpaceId || "",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ is_done: isDone }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось обновить пункт");
            await refreshSelectedCard();
          }}
          onAddComment={async (body) => {
            if (!token || !selectedCard) return;
            const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCard.id}/comments`), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.access}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ body }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось отправить комментарий");
            await refreshSelectedCard();
          }}
          onUploadAttachment={async (file) => {
            if (!token || !selectedCard) return;
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCard.id}/attachments`), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.access}`,
                "X-Space-Id": activeSpaceId || "",
              },
              body: form,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось загрузить файл");
            await refreshSelectedCard();
          }}
          onAddAttachmentUrl={async ({ file_url, file_name }) => {
            if (!token || !selectedCard) return;
            const res = await fetch(getApiUrl(`/api/kanban/cards/${selectedCard.id}/attachments`), {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.access}`,
                "X-Space-Id": activeSpaceId || "",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ file_url, file_name: file_name || undefined }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data?.detail ?? "Не удалось добавить ссылку");
            await refreshSelectedCard();
          }}
          onClose={() => {
            setSelectedCard(null);
            setSelectedCardError(null);
          }}
        />
      ) : null}

      {selectedCardError ? (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[120] rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-4 text-red-500 text-sm">
          {selectedCardError}
        </div>
      ) : null}

      {/* Диалоги создания */}
      <CreateSpaceDialog
        open={createSpaceOpen}
        onClose={() => setCreateSpaceOpen(false)}
        token={access}
        activeSpaceId={activeSpaceId}
        refreshToken={token?.refresh}
        onTokensUpdated={(nextTokens) => {
          setToken(nextTokens);
          localStorage.setItem(ACCESS_STORAGE_KEY, nextTokens.access);
          if (nextTokens.refresh) localStorage.setItem(REFRESH_STORAGE_KEY, nextTokens.refresh);
        }}
        onAuthExpired={() => {
          setToken(null);
          setActiveSpaceId(null);
          setActiveBoardId(null);
          localStorage.removeItem(ACCESS_STORAGE_KEY);
          localStorage.removeItem(REFRESH_STORAGE_KEY);
          setAuthError("Сессия истекла. Войдите заново.");
        }}
        onCreated={handleSpaceCreated}
      />

      {access && activeSpaceId ? (
        <CreateFolderDialog
          open={createFolderOpen}
          onClose={() => setCreateFolderOpen(false)}
          token={access}
          refreshToken={token?.refresh}
          spaceId={activeSpaceId}
          onTokensUpdated={(nextTokens) => {
            setToken(nextTokens);
            localStorage.setItem(ACCESS_STORAGE_KEY, nextTokens.access);
            if (nextTokens.refresh) localStorage.setItem(REFRESH_STORAGE_KEY, nextTokens.refresh);
          }}
          onAuthExpired={() => {
            setToken(null);
            setActiveSpaceId(null);
            setActiveBoardId(null);
            localStorage.removeItem(ACCESS_STORAGE_KEY);
            localStorage.removeItem(REFRESH_STORAGE_KEY);
            setAuthError("Сессия истекла. Войдите заново.");
          }}
          onCreated={(project) => {
            setProjects((prev) => [...prev, project]);
            setActiveProjectId(project.id);
            setCreateFolderOpen(false);
          }}
        />
      ) : null}

      {activeBoardId && columns.length > 0 && (
        <CreateTaskDialog
          open={createTaskOpen}
          onClose={() => {
            setCreateTaskOpen(false);
            setCreateTaskColumnId(null);
          }}
          token={access}
          refreshToken={token?.refresh}
          boardId={activeBoardId}
          columns={columns}
          defaultColumnId={createTaskColumnId}
          language={uiLanguage}
          onTokensUpdated={(nextTokens) => {
            setToken(nextTokens);
            localStorage.setItem(ACCESS_STORAGE_KEY, nextTokens.access);
            if (nextTokens.refresh) localStorage.setItem(REFRESH_STORAGE_KEY, nextTokens.refresh);
          }}
          onAuthExpired={() => {
            setToken(null);
            setActiveSpaceId(null);
            setActiveBoardId(null);
            localStorage.removeItem(ACCESS_STORAGE_KEY);
            localStorage.removeItem(REFRESH_STORAGE_KEY);
            setAuthError("Сессия истекла. Войдите заново.");
          }}
          onCreated={handleTaskCreated}
        />
      )}

      {token ? (
        <ProfileSettingsDialog
          open={profileDialogOpen}
          onClose={() => setProfileDialogOpen(false)}
          language={uiLanguage}
          initialFullName={profileFullName}
          initialAvatarUrl={profileAvatarUrl}
          token={token.access}
          refreshToken={token.refresh}
          onTokensUpdated={(nextTokens) => {
            setToken(nextTokens);
            localStorage.setItem(ACCESS_STORAGE_KEY, nextTokens.access);
            if (nextTokens.refresh) localStorage.setItem(REFRESH_STORAGE_KEY, nextTokens.refresh);
          }}
          onAuthExpired={() => {
            setToken(null);
            setActiveSpaceId(null);
            setActiveBoardId(null);
            localStorage.removeItem(ACCESS_STORAGE_KEY);
            localStorage.removeItem(REFRESH_STORAGE_KEY);
            setAuthError("Сессия истекла. Войдите заново.");
          }}
          onSaved={(next) => {
            setProfileFullName(next.full_name);
            setProfileAvatarUrl(next.avatar_url);
          }}
        />
      ) : null}
    </AppShell>
  );
}
