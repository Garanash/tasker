"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Image from "next/image";
import { useSearchParams, useRouter } from "next/navigation";
import { Button, IconButton, useTheme } from "@mui/material";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import { getApiUrl, getWsUrl } from "@/lib/api";
import { KanbanBoard, type KanbanFilters } from "../../components/kanban/KanbanBoard";
import AppShell, { type AppNotification, type AppRole, type ViewMode } from "../../components/kaiten/AppShell";
import FiltersPopover from "../../components/kaiten/FiltersPopover";
import ListView from "../../components/views/ListView";
import TableView from "../../components/views/TableView";
import TimelineView from "../../components/views/TimelineView";
import CalendarView from "../../components/views/CalendarView";
import CreateSpaceDialog from "../../components/dialogs/CreateSpaceDialog";
import CreateBoardDialog from "../../components/dialogs/CreateBoardDialog";
import CreateTaskDialog from "../../components/dialogs/CreateTaskDialog";
import CreateFolderDialog from "../../components/dialogs/CreateFolderDialog";
import ProfileSettingsDialog from "../../components/dialogs/ProfileSettingsDialog";
import DirectMessageDrawer, { type DmPeer } from "../../components/dialogs/DirectMessageDrawer";
import { CardModal, type CardDetail } from "../../components/kanban/CardModal";
import {
  getStoredLanguage,
  getStoredTheme,
  setStoredLanguage,
  setStoredTheme,
  type AppLanguage,
} from "@/lib/preferences";
import { randomId } from "@/lib/randomId";
import type { ColorTheme } from "../../components/kaiten/ProfileMenu";

type AuthToken = { access: string; refresh?: string };
const ACCESS_STORAGE_KEY = "kaiten_access";
const REFRESH_STORAGE_KEY = "kaiten_refresh";
const ONBOARDING_TOUR_STORAGE_KEY = "kaiten_onboarding_tour_seen";
const LAST_ACTIVE_SPACE_STORAGE_KEY = "kaiten_last_active_space_id";
const LAST_ACTIVE_ORG_STORAGE_KEY = "kaiten_last_active_org_id";

type Space = { id: string; name: string; organization_id: string };
type Project = { id: string; name: string; space_id: string };
type Board = { id: string; name: string; space_id?: string; project_id?: string };
type OrgUser = {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  last_login?: string | null;
  avatar_url?: string;
  /** Все членства, видимые вызывающему admin (как в GET /users/{id}/memberships). */
  memberships?: Array<{ organization_id: string; organization_name: string; role: string }>;
};
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
  estimate_points?: number | null;
};

type BoardGrid = {
  board: { id: string; name: string };
  tracks: Array<{ id: string; name: string }>;
  columns: Array<Column & { cards: Card[] }>;
};
type ArchivedCardItem = {
  id: string;
  title: string;
  board_name: string;
  column_name: string;
  archived_at?: string | null;
  total_effort_seconds?: number;
};

function formatEffortSeconds(seconds: number | undefined, language: AppLanguage): string {
  const safe = Math.max(0, Math.round(Number(seconds || 0)));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return language === "en" ? `${s}s` : `${s}с`;
}

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
          id: String(b.id || randomId()),
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
        blocks: blocks.length ? blocks : [{ id: randomId(), type: "text", content: "" }],
      };
    }
  } catch {
    // fallback to plain text format
  }
  return {
    icon: "",
    blocks: [{ id: randomId(), type: "text", content: raw || "" }],
  };
}

function serializeDocumentContent(icon: string, blocks: DocBlock[]): string {
  return JSON.stringify({
    icon,
    blocks: blocks.map((b) => ({ id: b.id, type: b.type, content: b.content, checked: b.checked ?? false })),
  });
}

/** Сравнение UUID организаций без учёта регистра (localStorage / разные источники). */
function normalizeOrgIdKey(id: string | null | undefined): string {
  return (id || "").trim().toLowerCase();
}

function normalizeOrgDisplayName(name: string | null | undefined): string {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Основная рабочая организация: при автоматическом выборе — после last space / localStorage. */
function isAlmazgeoburOrganizationName(name: string | null | undefined): boolean {
  const k = normalizeOrgDisplayName(name);
  return (
    k === "almazgeobur" ||
    k === "алмазгеобур" ||
    k.includes("almazgeobur") ||
    k.includes("алмазгеобур")
  );
}

function formatOrgMemberRoleLabel(role: string, lang: AppLanguage): string {
  const r = (role || "executor").toLowerCase();
  if (lang === "en") {
    if (r === "admin") return "Admin";
    if (r === "manager") return "Manager";
    if (r === "executor") return "Executor";
    return "Executor";
  }
  if (r === "admin") return "Администратор";
  if (r === "manager") return "Менеджер";
  if (r === "executor") return "Исполнитель";
  return "Исполнитель";
}

function normalizeOrgUserFromApi(raw: any): OrgUser {
  const mraw = raw?.memberships;
  const memberships: NonNullable<OrgUser["memberships"]> = [];
  if (Array.isArray(mraw)) {
    for (const x of mraw) {
      const oid = String(x?.organization_id ?? x?.organizationId ?? "").trim();
      if (!oid) continue;
      memberships.push({
        organization_id: oid,
        organization_name: String(x?.organization_name ?? x?.organizationName ?? "").trim(),
        role: String(x?.role ?? "executor"),
      });
    }
  }
  return {
    id: String(raw?.id ?? ""),
    email: String(raw?.email ?? ""),
    full_name: String(raw?.full_name ?? ""),
    role: (raw?.role as OrgUser["role"]) ?? "executor",
    last_login: raw?.last_login ?? null,
    avatar_url: raw?.avatar_url ? String(raw.avatar_url) : undefined,
    memberships: memberships.length > 0 ? memberships : undefined,
  };
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

/** Как в шапке AppShell: язык — флаг + название, тема — переключение иконкой светлая/тёмная */
function AuthScreenControls({
  language,
  onLanguage,
  onTheme,
}: {
  language: AppLanguage;
  onLanguage: (l: AppLanguage) => void;
  onTheme: (t: ColorTheme) => void;
}) {
  const muiTheme = useTheme();
  const isDarkTheme = muiTheme.palette.mode === "dark";
  const languageLabel = language === "ru" ? "🇷🇺 Русский" : "🇬🇧 English";
  const languageTitle = language === "ru" ? "Switch to English" : "Переключить на русский";
  const themeTitle =
    language === "en"
      ? isDarkTheme
        ? "Dark theme"
        : "Light theme"
      : isDarkTheme
        ? "Тёмная"
        : "Светлая";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-end p-3 sm:p-4">
      <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-1">
        <Button
          type="button"
          id="auth-localization-select-trigger"
          onClick={() => onLanguage(language === "ru" ? "en" : "ru")}
          title={languageTitle}
          sx={{
            textTransform: "none",
            minWidth: "auto",
            px: 1.25,
            py: 0.5,
            borderRadius: 1.5,
            color: "var(--k-text)",
            fontSize: 13,
            fontWeight: 500,
            border: "1px solid var(--k-border)",
            bgcolor: "var(--k-surface-bg)",
            "&:hover": { bgcolor: "var(--k-hover)", color: "var(--k-text)" },
          }}
        >
          {languageLabel}
        </Button>
        <IconButton
          type="button"
          onClick={() => {
            const nextTheme: ColorTheme = isDarkTheme ? "light" : "dark";
            onTheme(nextTheme);
          }}
          title={themeTitle}
          aria-label={themeTitle}
          sx={{
            borderRadius: 1.5,
            color: "var(--k-text)",
            border: "1px solid var(--k-border)",
            bgcolor: "var(--k-surface-bg)",
            "&:hover": { bgcolor: "var(--k-hover)", color: "var(--k-text)" },
          }}
        >
          {isDarkTheme ? <DarkModeOutlinedIcon fontSize="small" /> : <LightModeOutlinedIcon fontSize="small" />}
        </IconButton>
      </div>
    </div>
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
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);

  const [boards, setBoards] = useState<Board[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const deepLinkCardHandledRef = useRef<string | null>(null);

  const [kaitenTab, setKaitenTab] = useState<string>("lists");
  const [viewMode, setViewMode] = useState<ViewMode>("board");

  const [filters, setFilters] = useState<KanbanFilters>({
    query: "",
    titleOnly: false,
    status: "all",
    assigneeUserId: null,
    priority: "all",
    due: "all",
  });
  const [filtersAnchorEl, setFiltersAnchorEl] = useState<HTMLElement | null>(null);
  const [filterAssigneeOptions, setFilterAssigneeOptions] = useState<Array<{ id: string; label: string }>>([]);

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

  const recoverTokenParam = searchParams.get("recover");

  const [docs, setDocs] = useState<DocumentMini[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [createBusy, setCreateBusy] = useState(false);
  const [docIcon, setDocIcon] = useState("");
  const [docBlocks, setDocBlocks] = useState<DocBlock[]>([{ id: randomId(), type: "text", content: "" }]);
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

  const [email, setEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [recoverNewPassword, setRecoverNewPassword] = useState("");
  const [recoverConfirmPassword, setRecoverConfirmPassword] = useState("");
  const [recoverBusy, setRecoverBusy] = useState(false);
  const [requestLoginCodeBusy, setRequestLoginCodeBusy] = useState(false);
  const [requestLoginCodeMsg, setRequestLoginCodeMsg] = useState<string | null>(null);
  const [adminEditUser, setAdminEditUser] = useState<OrgUser | null>(null);
  const [adminEditFullName, setAdminEditFullName] = useState("");
  const [adminEditEmail, setAdminEditEmail] = useState("");
  const [adminEditBusy, setAdminEditBusy] = useState(false);
  const [adminUserMemberships, setAdminUserMemberships] = useState<
    Array<{ organization_id: string; organization_name: string; role: OrgUser["role"] }>
  >([]);
  const [adminMembershipsLoading, setAdminMembershipsLoading] = useState(false);
  const [adminAddMembershipOrgId, setAdminAddMembershipOrgId] = useState("");
  const [adminAddMembershipRole, setAdminAddMembershipRole] = useState<OrgUser["role"]>("executor");
  const [adminAddMembershipBusy, setAdminAddMembershipBusy] = useState(false);
  const [adminMembershipRoleBusyOrgId, setAdminMembershipRoleBusyOrgId] = useState<string | null>(null);
  const [userCodeBusyId, setUserCodeBusyId] = useState<string | null>(null);
  const [userDeleteBusyId, setUserDeleteBusyId] = useState<string | null>(null);
  const [createBsvrOrgBusy, setCreateBsvrOrgBusy] = useState(false);
  const [archiveCards, setArchiveCards] = useState<ArchivedCardItem[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);

  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [createBoardOpen, setCreateBoardOpen] = useState(false);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskColumnId, setCreateTaskColumnId] = useState<string | null>(null);
  const [createTaskTrackId, setCreateTaskTrackId] = useState<string | null>(null);
  const [uiLanguage, setUiLanguage] = useState<AppLanguage>("ru");
  const [uiTheme, setUiTheme] = useState<ColorTheme>("system");
  const [selectedCard, setSelectedCard] = useState<CardDetail | null>(null);
  const [selectedCardError, setSelectedCardError] = useState<string | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [sidebarOrgMembers, setSidebarOrgMembers] = useState<
    Array<{ id: string; full_name: string; email: string; avatar_url?: string; role: string }>
  >([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [dmPeer, setDmPeer] = useState<DmPeer | null>(null);
  const [dmOpen, setDmOpen] = useState(false);
  const [sidebarOrgMembersLoading, setSidebarOrgMembersLoading] = useState(false);
  const [orgUsersLoading, setOrgUsersLoading] = useState(false);
  const [orgUsersError, setOrgUsersError] = useState<string | null>(null);
  const [orgUsersSuccess, setOrgUsersSuccess] = useState<string | null>(null);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserFullName, setNewUserFullName] = useState("");
  const [newUserRole, setNewUserRole] = useState<OrgUser["role"]>("executor");
  const [newUserBusy, setNewUserBusy] = useState(false);
  const [newUserOrganizationId, setNewUserOrganizationId] = useState<string | null>(null);
  const [orgMemberships, setOrgMemberships] = useState<
    Array<{ organization_id: string; role: AppRole; organization_name: string }>
  >([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);
  const [dmUnreadCount, setDmUnreadCount] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const [profileFullName, setProfileFullName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);

  /** После первого завершения /api/auth/me — иначе нельзя угадывать org по spaces[0] (порядок ≠ «моя» организация). */
  const profileMeLoadedRef = useRef(false);

  const access = token?.access;

  const effectiveRole = useMemo((): AppRole => {
    if (!activeOrganizationId) return "executor";
    const key = normalizeOrgIdKey(activeOrganizationId);
    const m = orgMemberships.find((x) => normalizeOrgIdKey(x.organization_id) === key);
    return (m?.role as AppRole) ?? "executor";
  }, [activeOrganizationId, orgMemberships]);

  const canManageBoard = effectiveRole === "manager" || effectiveRole === "admin";
  const isAdmin = effectiveRole === "admin";
  const canManageCurrentSpace = useMemo(() => {
    if (!activeSpaceId || !activeOrganizationId) return false;
    const activeSpace = spaces.find((space) => space.id === activeSpaceId);
    if (!activeSpace?.organization_id || normalizeOrgIdKey(activeSpace.organization_id) !== normalizeOrgIdKey(activeOrganizationId))
      return false;
    const membership = orgMemberships.find((m) => normalizeOrgIdKey(m.organization_id) === normalizeOrgIdKey(activeOrganizationId));
    return membership?.role === "manager" || membership?.role === "admin";
  }, [activeSpaceId, spaces, orgMemberships, activeOrganizationId]);

  const visibleSpaces = useMemo(() => {
    if (!activeOrganizationId) return spaces;
    const key = normalizeOrgIdKey(activeOrganizationId);
    return spaces.filter((s) => normalizeOrgIdKey(s.organization_id) === key);
  }, [spaces, activeOrganizationId]);

  const visibleBoards = useMemo(() => {
    if (!activeOrganizationId) return boards;
    const key = normalizeOrgIdKey(activeOrganizationId);
    const spaceIds = new Set(spaces.filter((s) => normalizeOrgIdKey(s.organization_id) === key).map((s) => s.id));
    return boards.filter((b) => !b.space_id || spaceIds.has(b.space_id));
  }, [boards, spaces, activeOrganizationId]);

  const visibleProjects = useMemo(() => {
    if (!activeOrganizationId) return projects;
    const key = normalizeOrgIdKey(activeOrganizationId);
    const spaceIds = new Set(spaces.filter((s) => normalizeOrgIdKey(s.organization_id) === key).map((s) => s.id));
    return projects.filter((p) => spaceIds.has(p.space_id));
  }, [projects, spaces, activeOrganizationId]);

  const sidebarOrganizations = useMemo(
    () =>
      orgMemberships.map((m) => ({
        id: m.organization_id,
        name: m.organization_name || m.organization_id.slice(0, 8),
      })),
    [orgMemberships],
  );

  const activeOrganizationName = useMemo(() => {
    if (!activeOrganizationId) return "";
    const key = normalizeOrgIdKey(activeOrganizationId);
    const m = orgMemberships.find((x) => normalizeOrgIdKey(x.organization_id) === key);
    return (m?.organization_name || "").trim() || activeOrganizationId;
  }, [activeOrganizationId, orgMemberships]);

  const adminOrganizations = useMemo(() => orgMemberships.filter((m) => m.role === "admin"), [orgMemberships]);

  const orgsAvailableToAddForAdminEdit = useMemo(() => {
    const membershipOrgKeys = new Set(adminUserMemberships.map((m) => normalizeOrgIdKey(m.organization_id)));
    return adminOrganizations.filter((o) => !membershipOrgKeys.has(normalizeOrgIdKey(o.organization_id)));
  }, [adminUserMemberships, adminOrganizations]);

  const hasBsvrOrganization = useMemo(
    () => adminOrganizations.some((m) => (m.organization_name || "").trim() === "БСВР"),
    [adminOrganizations],
  );

  useEffect(() => {
    if (!adminOrganizations.length) {
      setNewUserOrganizationId(null);
      return;
    }
    if (adminOrganizations.length === 1) {
      setNewUserOrganizationId(adminOrganizations[0].organization_id);
      return;
    }
    setNewUserOrganizationId((prev) => {
      if (prev && adminOrganizations.some((m) => m.organization_id === prev)) return prev;
      if (activeOrganizationId && adminOrganizations.some((m) => m.organization_id === activeOrganizationId))
        return activeOrganizationId;
      return adminOrganizations[0].organization_id;
    });
  }, [adminOrganizations, activeOrganizationId]);

  useEffect(() => {
    if (!adminEditUser) {
      setAdminUserMemberships([]);
      setAdminMembershipsLoading(false);
      setAdminAddMembershipOrgId("");
      return;
    }
    if (!token?.access || !activeOrganizationId) {
      setAdminMembershipsLoading(false);
      return;
    }
    let cancelled = false;
    setAdminMembershipsLoading(true);
    (async () => {
      try {
        const res = await fetch(getApiUrl(`/api/auth/users/${adminEditUser.id}/memberships`), {
          headers: {
            Authorization: `Bearer ${token.access}`,
            "X-Organization-Id": activeOrganizationId,
            ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
          },
        });
        const data = (await res.json().catch(() => ({}))) as { detail?: string } | unknown[];
        if (!res.ok) {
          const msg =
            typeof (data as { detail?: string })?.detail === "string"
              ? (data as { detail: string }).detail
              : "Не удалось загрузить организации пользователя";
          throw new Error(msg);
        }
        const list = Array.isArray(data)
          ? (data as Array<{ organization_id: string; organization_name: string; role: string }>)
          : [];
        if (!cancelled) {
          setAdminUserMemberships(
            list.map((x) => ({
              organization_id: x.organization_id,
              organization_name: x.organization_name,
              role: (x.role as OrgUser["role"]) ?? "executor",
            })),
          );
        }
      } catch {
        if (!cancelled) setAdminUserMemberships([]);
      } finally {
        if (!cancelled) setAdminMembershipsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminEditUser, token?.access, activeOrganizationId, activeSpaceId]);

  useEffect(() => {
    if (!adminEditUser) {
      setAdminAddMembershipOrgId("");
      return;
    }
    const available = orgsAvailableToAddForAdminEdit;
    setAdminAddMembershipOrgId((prev) => {
      if (available.length === 0) return "";
      const ok =
        prev &&
        available.some((o) => normalizeOrgIdKey(o.organization_id) === normalizeOrgIdKey(prev));
      return ok ? prev : available[0].organization_id;
    });
  }, [adminEditUser?.id, orgsAvailableToAddForAdminEdit]);

  const handleRenameOrganization = useCallback(async (organizationId: string, newName: string): Promise<boolean> => {
    if (!token?.access) return false;
    try {
      const res = await fetch(getApiUrl(`/api/auth/organizations/${organizationId}`), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token.access}`,
          "Content-Type": "application/json",
          "X-Organization-Id": organizationId,
        },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.detail === "string" ? data.detail : "Не удалось переименовать");
      }
      setOrgMemberships((prev) =>
        prev.map((m) => (m.organization_id === organizationId ? { ...m, organization_name: newName } : m)),
      );
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка переименования организации";
      setAuthError(msg);
      return false;
    }
  }, [token?.access]);

  const displayUserName = useMemo(
    () => profileFullName.trim() || email.split("@")[0] || "Пользователь",
    [profileFullName, email],
  );
  const tourSteps = useMemo(
    () =>
      uiLanguage === "en"
        ? [
            {
              title: "Task board",
              body: "Main work happens on the board. Drag cards between columns, open cards for details, and use multiple views.",
              actionLabel: "Open tasks",
              onAction: () => setKaitenTab("lists"),
            },
            {
              title: "Views and filters",
              body: "Switch between board/list/table/timeline/calendar in the top panel. Use Filters to find cards by assignee, priority, and due date.",
              actionLabel: "Open tasks",
              onAction: () => setKaitenTab("lists"),
            },
            {
              title: "Team messenger",
              body: "Use the envelope button in the header to open messenger. Contacts are on the left, active chat is on the right.",
              actionLabel: "Open messenger",
              onAction: () => setDmOpen(true),
            },
            {
              title: "Wiki and docs",
              body: "Open wiki from the help button for process examples and quick onboarding. Keep docs close to tasks.",
              actionLabel: "Open wiki",
              onAction: () => router.push("/wiki"),
            },
          ]
        : [
            {
              title: "Работа с задачами",
              body: "Основной сценарий — доска задач. Перетаскивайте карточки между колонками, открывайте карточку для деталей и используйте разные виды.",
              actionLabel: "Открыть задачи",
              onAction: () => setKaitenTab("lists"),
            },
            {
              title: "Виды и фильтры",
              body: "В верхней панели переключайте доску/список/таблицу/таймлайн/календарь. Через «Фильтры» находите карточки по ответственному, приоритету и сроку.",
              actionLabel: "Открыть задачи",
              onAction: () => setKaitenTab("lists"),
            },
            {
              title: "Мессенджер команды",
              body: "Кнопка с конвертом в шапке открывает мессенджер: слева контакты, справа активный чат.",
              actionLabel: "Открыть мессенджер",
              onAction: () => setDmOpen(true),
            },
            {
              title: "Вики и документация",
              body: "Через кнопку справки открывается вики с примерами рабочих сценариев и быстрым стартом.",
              actionLabel: "Открыть вики",
              onAction: () => router.push("/wiki"),
            },
          ],
    [uiLanguage, router]
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
        setTourStep(0);
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
      setActiveOrganizationId(null);
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
      setActiveOrganizationId(null);
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

  async function fetchSpaces(nextAccess: string): Promise<Space[]> {
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
    fetchSpaces(token.access).catch((e: any) => setAuthError(e?.message ?? "Ошибка загрузки"));
  }, [token]);

  useEffect(() => {
    if (!token || !spaces.length) return;
    const membershipIds = new Set(orgMemberships.map((m) => normalizeOrgIdKey(m.organization_id)));
    if (orgMemberships.length > 0 && activeOrganizationId) {
      const match = orgMemberships.find((m) => normalizeOrgIdKey(m.organization_id) === normalizeOrgIdKey(activeOrganizationId));
      if (!match) {
        setActiveOrganizationId(null);
        return;
      }
      if (normalizeOrgIdKey(match.organization_id) !== normalizeOrgIdKey(activeOrganizationId)) {
        setActiveOrganizationId(match.organization_id);
        return;
      }
    }

    let orgId = activeOrganizationId;
    if (!orgId || (membershipIds.size > 0 && !membershipIds.has(normalizeOrgIdKey(orgId)))) {
      try {
        const saved = localStorage.getItem(LAST_ACTIVE_ORG_STORAGE_KEY);
        if (saved && (membershipIds.size === 0 || membershipIds.has(normalizeOrgIdKey(saved)))) orgId = saved;
        else orgId = null;
      } catch {
        orgId = null;
      }
    }
    if (!orgId && activeSpaceId) {
      const sid = spaces.find((s) => s.id === activeSpaceId)?.organization_id;
      if (sid && (membershipIds.size === 0 || membershipIds.has(normalizeOrgIdKey(sid)))) orgId = sid;
    }
    if (!orgId && membershipIds.size > 0) {
      const almaz = orgMemberships.find((m) => isAlmazgeoburOrganizationName(m.organization_name));
      if (almaz) orgId = almaz.organization_id;
    }
    if (!orgId && membershipIds.size > 0) {
      const keys = [...membershipIds];
      const adminKeys = keys.filter((k) => {
        const m = orgMemberships.find((om) => normalizeOrgIdKey(om.organization_id) === k);
        return m?.role === "admin";
      });
      const findOrgIdForKey = (k: string) =>
        orgMemberships.find((om) => normalizeOrgIdKey(om.organization_id) === k)?.organization_id ?? null;
      const pickKeyWithSpace = (candidates: string[]) =>
        candidates.find((k) => spaces.some((s) => normalizeOrgIdKey(s.organization_id) === k));
      if (adminKeys.length) {
        const preferred = pickKeyWithSpace(adminKeys);
        if (preferred) orgId = findOrgIdForKey(preferred);
      }
      if (!orgId) {
        const firstWithSpace = pickKeyWithSpace(keys);
        if (firstWithSpace) orgId = findOrgIdForKey(firstWithSpace);
      }
      if (!orgId) {
        orgId = orgMemberships.find((m) => m.role === "admin")?.organization_id ?? orgMemberships[0]?.organization_id ?? null;
      }
    }
    if (!orgId && membershipIds.size === 0 && spaces.length) {
      if (!profileMeLoadedRef.current) {
        return;
      }
      orgId = spaces[0].organization_id;
    }

    if (orgId !== activeOrganizationId) {
      setActiveOrganizationId(orgId);
      return;
    }

    const inOrg = spaces.filter((s) => normalizeOrgIdKey(s.organization_id) === normalizeOrgIdKey(orgId));
    if (!inOrg.length) {
      setActiveSpaceId(null);
      setActiveBoardId(null);
      setActiveProjectId(null);
      return;
    }
    if (activeSpaceId && inOrg.some((s) => s.id === activeSpaceId)) return;

    let preferred = inOrg[0].id;
    try {
      const saved = localStorage.getItem(LAST_ACTIVE_SPACE_STORAGE_KEY);
      if (saved && inOrg.some((s) => s.id === saved)) preferred = saved;
    } catch {
      // ignore
    }
    setActiveSpaceId(preferred);
  }, [token, spaces, orgMemberships, activeOrganizationId, activeSpaceId]);

  useEffect(() => {
    if (!activeOrganizationId) return;
    try {
      localStorage.setItem(LAST_ACTIVE_ORG_STORAGE_KEY, activeOrganizationId);
    } catch {
      // ignore
    }
  }, [activeOrganizationId]);

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
    if (!token) {
      profileMeLoadedRef.current = false;
      return;
    }
    profileMeLoadedRef.current = false;
    fetchCurrentUser(token.access).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchNotifications(token.access).catch(() => {});
  }, [token, activeSpaceId]);

  useEffect(() => {
    if (!token?.access || !activeOrganizationId) {
      setDmUnreadCount(0);
      return;
    }
    fetchDmUnread(token.access, activeOrganizationId).catch(() => {});
  }, [token?.access, activeOrganizationId]);

  useEffect(() => {
    if (!token?.access || !currentUserId) return;
    const ws = new WebSocket(getWsUrl(`/ws/messages/?token=${encodeURIComponent(token.access)}`));
    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as {
          type?: string;
          payload?: { recipient_id?: string; organization_id?: string };
        };
        if (parsed.type !== "direct_message" || !parsed.payload) return;
        const p = parsed.payload;
        if (p.recipient_id !== currentUserId) return;
        if (activeOrganizationId && p.organization_id && p.organization_id !== activeOrganizationId) return;
        void fetchDmUnread(token.access, activeOrganizationId);
      } catch {
        // ignore
      }
    };
    return () => {
      ws.close();
    };
  }, [token?.access, currentUserId, activeOrganizationId]);

  useEffect(() => {
    if (!token || !activeBoardId) return;
    fetchBoardGrid(activeBoardId, token.access);
  }, [token, activeBoardId, fetchBoardGrid]);

  useEffect(() => {
    if (!token?.access || !activeSpaceId) {
      setFilterAssigneeOptions([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getApiUrl("/api/auth/users"), {
          headers: {
            Authorization: `Bearer ${token.access}`,
            "X-Space-Id": activeSpaceId,
            ...(activeOrganizationId ? { "X-Organization-Id": activeOrganizationId } : {}),
          },
        });
        const data = (await res.json().catch(() => [])) as unknown;
        if (cancelled || !res.ok) return;
        const arr = Array.isArray(data) ? data : [];
        setFilterAssigneeOptions(
          arr.map((u: { id: string; email: string; full_name: string }) => ({
            id: u.id,
            label: (u.full_name || "").trim() || u.email,
          })),
        );
      } catch {
        if (!cancelled) setFilterAssigneeOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token?.access, activeSpaceId, activeOrganizationId]);

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

  async function fetchOrganizationUsers(
    nextAccess: string,
    opts: { spaceId?: string | null; organizationId?: string | null },
  ) {
    setOrgUsersLoading(true);
    setOrgUsersError(null);
    setOrgUsersSuccess(null);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${nextAccess}` };
      if (opts.organizationId) headers["X-Organization-Id"] = opts.organizationId;
      else if (opts.spaceId) headers["X-Space-Id"] = opts.spaceId;
      else throw new Error("Нет контекста организации");
      const res = await fetch(getApiUrl("/api/auth/users"), { headers });
      const data = (await res.json().catch(() => [])) as any;
      if (!res.ok) throw new Error(data?.detail ?? "Не удалось загрузить пользователей");
      const list = Array.isArray(data) ? data.map((u: any) => normalizeOrgUserFromApi(u)) : [];
      setOrgUsers(list);
      if (opts.organizationId) {
        setSidebarOrgMembers(
          list.map((u) => ({
            id: String(u.id),
            full_name: String(u.full_name ?? ""),
            email: String(u.email ?? ""),
            avatar_url: (u.avatar_url && String(u.avatar_url).trim()) || undefined,
            role: String(u.role ?? "executor"),
          })),
        );
      }
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
      setOrgMemberships(Array.isArray(me.memberships) ? me.memberships : []);
      const u = me.user;
      if (u) {
        setCurrentUserId(u.id);
        setProfileFullName(u.full_name || "");
        setProfileAvatarUrl(u.avatar_url || "");
      } else {
        setCurrentUserId(null);
      }
    } catch {
      setOrgMemberships([]);
      setCurrentUserId(null);
    } finally {
      profileMeLoadedRef.current = true;
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

  async function fetchDmUnread(nextAccess: string, organizationId: string | null) {
    if (!organizationId) return;
    try {
      const res = await fetch(getApiUrl("/api/messages/unread-count"), {
        headers: { Authorization: `Bearer ${nextAccess}`, "X-Organization-Id": organizationId },
      });
      const data = (await res.json().catch(() => ({}))) as { unread_count?: number };
      if (res.ok) setDmUnreadCount(Math.max(0, Number(data.unread_count ?? 0)));
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
    if (!token || !activeOrganizationId) return;
    if (kaitenTab !== "administration") return;
    if (!isAdmin) {
      setKaitenTab("lists");
      setOrgUsersError(uiLanguage === "en" ? "Administration is available for admins only" : "Администрирование доступно только администратору");
      return;
    }
    fetchOrganizationUsers(token.access, { organizationId: activeOrganizationId, spaceId: activeSpaceId }).catch(() => {});
  }, [token, activeOrganizationId, activeSpaceId, kaitenTab, isAdmin, uiLanguage]);

  useEffect(() => {
    if (!token?.access || !activeOrganizationId) {
      setSidebarOrgMembers([]);
      setSidebarOrgMembersLoading(false);
      return;
    }
    let cancelled = false;
    setSidebarOrgMembersLoading(true);
    (async () => {
      try {
        const res = await fetch(getApiUrl("/api/auth/users"), {
          headers: {
            Authorization: `Bearer ${token.access}`,
            "X-Organization-Id": activeOrganizationId,
          },
        });
        const data = (await res.json().catch(() => [])) as unknown;
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data)) {
          setSidebarOrgMembers([]);
          return;
        }
        setSidebarOrgMembers(
          data.map((u: { id: string; full_name?: string; email?: string; avatar_url?: string; role?: string }) => ({
            id: String(u.id),
            full_name: String(u.full_name ?? ""),
            email: String(u.email ?? ""),
            avatar_url: (u.avatar_url && String(u.avatar_url).trim()) || undefined,
            role: String(u.role ?? "executor"),
          })),
        );
      } catch {
        if (!cancelled) setSidebarOrgMembers([]);
      } finally {
        if (!cancelled) setSidebarOrgMembersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token?.access, activeOrganizationId]);

  useEffect(() => {
    if (kaitenTab !== "archive" || !token?.access || !activeSpaceId) {
      if (kaitenTab !== "archive") setArchiveCards([]);
      return;
    }
    const boardsInSpace = boards.filter((b) => b.space_id === activeSpaceId);
    if (!boardsInSpace.length) {
      setArchiveCards([]);
      setArchiveLoading(false);
      return;
    }
    let cancelled = false;
    setArchiveLoading(true);
    (async () => {
      try {
        const results = await Promise.all(
          boardsInSpace.map((b) =>
            fetch(getApiUrl(`/api/kanban/boards/${b.id}/archive`), {
              headers: { Authorization: `Bearer ${token.access}`, "X-Space-Id": activeSpaceId },
            }).then((r) => (r.ok ? r.json() : [])),
          ),
        );
        const items: ArchivedCardItem[] = [];
        for (const data of results) {
          if (!Array.isArray(data)) continue;
          for (const raw of data) {
            items.push({
              id: String(raw?.id ?? ""),
              title: String(raw?.title ?? "—"),
              board_name: String(raw?.board_name ?? ""),
              column_name: String(raw?.column_name ?? ""),
              archived_at: raw?.archived_at ? String(raw.archived_at) : null,
              total_effort_seconds:
                typeof raw?.total_effort_seconds === "number"
                  ? raw.total_effort_seconds
                  : Number(raw?.total_effort_seconds || 0),
            });
          }
        }
        if (!cancelled) setArchiveCards(items);
      } catch {
        if (!cancelled) setArchiveCards([]);
      } finally {
        if (!cancelled) setArchiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kaitenTab, token?.access, activeSpaceId, boards]);

  useEffect(() => {
    setDmPeer(null);
    setDmOpen(false);
  }, [activeOrganizationId]);

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
          content: serializeDocumentContent("", [{ id: randomId(), type: "text", content: "" }]),
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
    const nextId = randomId();
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
      return next.length ? next : [{ id: randomId(), type: "text", content: "" }];
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
    const nextId = randomId();
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

  const authTitle = useMemo(() => (uiLanguage === "en" ? "Sign in" : "Вход"), [uiLanguage]);

  async function submitAuth() {
    setAuthLoading(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      const res = await fetch(getApiUrl("/api/auth/login-otp"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: otpCode.replace(/\s/g, "") }),
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

  async function submitRecoverPassword(token: string) {
    if (recoverNewPassword.length < 8) {
      setAuthError(uiLanguage === "en" ? "Password must be at least 8 characters" : "Пароль — не менее 8 символов");
      return;
    }
    if (recoverNewPassword !== recoverConfirmPassword) {
      setAuthError(uiLanguage === "en" ? "Passwords do not match" : "Пароли не совпадают");
      return;
    }
    setRecoverBusy(true);
    setAuthError(null);
    try {
      const res = await fetch(getApiUrl("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: recoverNewPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const d = data?.detail;
        throw new Error(
          typeof d === "string"
            ? d
            : uiLanguage === "en"
              ? "Invalid or expired link"
              : "Ссылка недействительна или истекла",
        );
      }
      setRecoverNewPassword("");
      setRecoverConfirmPassword("");
      router.replace("/app", { scroll: false });
      setAuthError(null);
      setAuthNotice(
        uiLanguage === "en"
          ? "Password updated. Sign in with the code from your email."
          : "Пароль обновлён. Войдите по коду из письма.",
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : uiLanguage === "en" ? "Error" : "Ошибка";
      setAuthError(msg);
    } finally {
      setRecoverBusy(false);
    }
  }

  async function submitRequestLoginCode() {
    setRequestLoginCodeBusy(true);
    setRequestLoginCodeMsg(null);
    setAuthError(null);
    try {
      const res = await fetch(getApiUrl("/api/auth/request-login-code"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail ?? (uiLanguage === "en" ? "Request failed" : "Не удалось отправить"));
      setRequestLoginCodeMsg(
        uiLanguage === "en"
          ? "If this email is registered, we sent a 6-digit code. Check your inbox."
          : "Если аккаунт с таким email есть, мы отправили 6-значный код на почту.",
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : uiLanguage === "en" ? "Error" : "Ошибка";
      setAuthError(msg);
    } finally {
      setRequestLoginCodeBusy(false);
    }
  }

  const handleSpaceCreated = async (space: { id: string; name: string }) => {
    if (!token) {
      setSpaces((prev) => [...prev, { ...space, organization_id: "" }]);
      setActiveSpaceId(space.id);
      return;
    }
    try {
      const refreshed = await fetchSpaces(token.access);
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
            const refreshed = await fetchSpaces(token.access);
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
        await fetchSpaces(token.access);
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

  const handleRenameBoard = async (boardId: string, newName: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(getApiUrl(`/api/kanban/boards/${boardId}`), {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token.access}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data.detail === "string"
            ? data.detail
            : uiLanguage === "en"
              ? "Could not rename board"
              : "Не удалось переименовать доску";
        setAuthError(msg);
        return false;
      }
      setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, name: newName } : b)));
      if (activeBoardId === boardId && boardGrid) {
        setBoardGrid((prev) => (prev ? { ...prev, board: { ...prev.board, name: newName } } : prev));
      }
      return true;
    } catch {
      setAuthError(uiLanguage === "en" ? "Could not rename board" : "Не удалось переименовать доску");
      return false;
    }
  };

  const handleDeleteBoard = async (boardId: string): Promise<boolean> => {
    if (!token) return false;
    try {
      const res = await fetch(getApiUrl(`/api/kanban/boards/${boardId}`), {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token.access}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          typeof data.detail === "string"
            ? data.detail
            : uiLanguage === "en"
              ? "Could not delete board"
              : "Не удалось удалить доску";
        setAuthError(msg);
        return false;
      }
      if (activeSpaceId) {
        await fetchBoardsForSpace(token.access, activeSpaceId);
      } else {
        setBoards((prev) => prev.filter((b) => b.id !== boardId));
      }
      if (activeBoardId === boardId) {
        setActiveBoardId(null);
        setBoardGrid(null);
      }
      return true;
    } catch {
      setAuthError(uiLanguage === "en" ? "Network error while deleting board" : "Ошибка сети при удалении доски");
      return false;
    }
  };

  const handleCreateCardInColumn = (columnId: string, options?: { trackId?: string }) => {
    if (!canManageBoard) {
      setAuthError(uiLanguage === "en" ? "Only manager and above can create cards" : "Создавать карточки могут только менеджер и выше");
      return;
    }
    setCreateTaskColumnId(columnId);
    setCreateTaskTrackId(options?.trackId ?? null);
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
    setCreateTaskColumnId(null);
    setCreateTaskTrackId(null);
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
        if (data.space_id) setActiveSpaceId(data.space_id);
        if (data.board_id) setActiveBoardId(data.board_id);
        setSelectedCard(data);
      } catch (e: any) {
        setSelectedCardError(e?.message ?? "Не удалось загрузить карточку");
      }
    },
    [token]
  );

  const cardIdFromUrl = searchParams.get("card");
  useEffect(() => {
    if (!token?.access || !cardIdFromUrl) {
      if (!cardIdFromUrl) deepLinkCardHandledRef.current = null;
      return;
    }
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(cardIdFromUrl)) return;
    if (deepLinkCardHandledRef.current === cardIdFromUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getApiUrl(`/api/kanban/cards/${cardIdFromUrl}`), {
          headers: { Authorization: `Bearer ${token.access}` },
        });
        const data = (await res.json()) as CardDetail & { detail?: string };
        if (cancelled) return;
        if (!res.ok) {
          setSelectedCardError(
            data.detail ?? (uiLanguage === "en" ? "Could not open shared card" : "Не удалось открыть карточку по ссылке"),
          );
          return;
        }
        deepLinkCardHandledRef.current = cardIdFromUrl;
        if (data.space_id) setActiveSpaceId(data.space_id);
        if (data.board_id) setActiveBoardId(data.board_id);
        setKaitenTab("lists");
        setSelectedCard(data);
        setSelectedCardError(null);
      } catch (e: any) {
        if (!cancelled) setSelectedCardError(e?.message ?? "Ошибка ссылки на карточку");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token?.access, cardIdFromUrl, uiLanguage]);

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

  const newBoardDefaultName = useMemo(
    () => (uiLanguage === "en" ? `Board ${visibleBoards.length + 1}` : `Доска ${visibleBoards.length + 1}`),
    [visibleBoards.length, uiLanguage],
  );

  const newBoardProjectId = useMemo(() => {
    if (!activeSpaceId) return null;
    const activeProjects = projects.filter((project) => project.space_id === activeSpaceId);
    return activeProjectId && activeProjects.some((project) => project.id === activeProjectId)
      ? activeProjectId
      : activeProjects[0]?.id ?? null;
  }, [activeSpaceId, activeProjectId, projects]);

  const openCreateBoardDialog = useCallback(() => {
    if (!canManageBoard) {
      setAuthError(uiLanguage === "en" ? "Only manager and above can create boards" : "Создавать доски могут только менеджер и выше");
      return;
    }
    if (!token || !activeSpaceId) return;
    setCreateBoardOpen(true);
  }, [canManageBoard, token, activeSpaceId, uiLanguage]);

  const handleBoardCreated = async (board: { id: string; name: string }, accessToken: string) => {
    if (!activeSpaceId) return;
    try {
      await fetchBoardsForSpace(accessToken, activeSpaceId);
      setActiveBoardId(board.id);
    } catch (e: unknown) {
      const msg =
        e instanceof Error
          ? e.message
          : uiLanguage === "en"
            ? "Could not refresh boards"
            : "Не удалось обновить список досок";
      setAuthError(msg);
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

  const reportStats = useMemo(() => {
    if (!boardGrid) return null;
    let total = 0;
    let estimateSum = 0;
    const byColumn: Array<{ name: string; count: number; is_done: boolean }> = [];
    for (const col of boardGrid.columns) {
      const n = col.cards.length;
      total += n;
      for (const c of col.cards) {
        const p = c.estimate_points;
        if (typeof p === "number" && !Number.isNaN(p)) estimateSum += p;
      }
      byColumn.push({ name: col.name, count: n, is_done: col.is_done });
    }
    return { boardName: boardGrid.board.name, total, estimateSum, byColumn };
  }, [boardGrid]);

  const commitAuthLanguage = useCallback((l: AppLanguage) => {
    setUiLanguage(l);
    setStoredLanguage(l);
  }, []);
  const commitAuthTheme = useCallback((t: ColorTheme) => {
    setUiTheme(t);
    setStoredTheme(t);
  }, []);

  if (!token || !access) {
    const recoverLabels =
      uiLanguage === "en"
        ? {
            header: "Sign in",
            title: "New password",
            hint: "Enter a new password for your account (at least 8 characters).",
            newPass: "New password",
            confirm: "Confirm password",
            submit: "Set password",
            back: "Back to sign in",
            wait: "Please wait…",
          }
        : {
            header: "Вход",
            title: "Новый пароль",
            hint: "Придумайте новый пароль для аккаунта (не менее 8 символов).",
            newPass: "Новый пароль",
            confirm: "Повторите пароль",
            submit: "Установить пароль",
            back: "Назад ко входу",
            wait: "Подождите…",
          };

    if (recoverTokenParam && recoverTokenParam.length >= 20) {
      return (
        <>
          <AuthScreenControls language={uiLanguage} onLanguage={commitAuthLanguage} onTheme={commitAuthTheme} />
          <div className="min-h-screen flex items-center justify-center p-6" style={{ background: uiColors.pageBg }}>
            <div className="w-full max-w-md px-4 py-8 flex flex-col items-center">
            <div className="mb-6 flex justify-center">
              <Image src="/almazgeobur-logo.svg" alt="Almazgeobur" width={72} height={72} priority />
            </div>
            <div className="font-bold text-2xl tracking-tight text-center w-full" style={{ color: uiColors.text }}>
              {recoverLabels.title}
            </div>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: uiColors.textMuted }}>
              {recoverLabels.hint}
            </p>
            <div className="mt-5 space-y-4">
              <label className="block">
                <div className="text-[var(--k-text-muted)] text-sm mb-2">{recoverLabels.newPass}</div>
                <input
                  value={recoverNewPassword}
                  onChange={(e) => setRecoverNewPassword(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  className="w-full text-center rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] text-[var(--k-text)] px-3 py-2 outline-none focus:border-[#8A2BE2]"
                />
              </label>
              <label className="block">
                <div className="text-[var(--k-text-muted)] text-sm mb-2">{recoverLabels.confirm}</div>
                <input
                  value={recoverConfirmPassword}
                  onChange={(e) => setRecoverConfirmPassword(e.target.value)}
                  type="password"
                  autoComplete="new-password"
                  className="w-full text-center rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] text-[var(--k-text)] px-3 py-2 outline-none focus:border-[#8A2BE2]"
                />
              </label>
              {authError ? <div className="text-red-500 text-sm">{authError}</div> : null}
              <GreyButton
                onClick={() => submitRecoverPassword(recoverTokenParam)}
                disabled={recoverBusy}
                variant="primary"
              >
                {recoverBusy ? recoverLabels.wait : recoverLabels.submit}
              </GreyButton>
              <button
                type="button"
                className="w-full text-center text-sm font-medium py-2 rounded-xl transition-colors hover:opacity-90"
                style={{ color: uiColors.textMuted }}
                onClick={() => {
                  setAuthError(null);
                  router.replace("/app", { scroll: false });
                }}
              >
                {recoverLabels.back}
              </button>
            </div>
          </div>
        </div>
        </>
      );
    }

    return (
      <>
        <AuthScreenControls language={uiLanguage} onLanguage={commitAuthLanguage} onTheme={commitAuthTheme} />
        <div className="min-h-screen flex items-center justify-center p-6" style={{ background: uiColors.pageBg }}>
        <div className="w-full max-w-md px-4 py-8 flex flex-col items-center">
          <div className="mb-6 flex justify-center">
            <Image src="/almazgeobur-logo.svg" alt="Almazgeobur" width={72} height={72} priority />
          </div>

          <div className="font-bold text-2xl tracking-tight text-center w-full" style={{ color: uiColors.text }}>
            {authTitle}
          </div>
          <div className="mt-2 text-sm text-center w-full" style={{ color: uiColors.textMuted }}>
            {uiLanguage === "en" ? "Sign in with the code from your email" : "Вход по коду из письма"}
          </div>

          <div className="mt-6 w-full space-y-4">
            <label className="block">
              <div className="text-[var(--k-text-muted)] text-sm mb-2 text-center">
                {uiLanguage === "en" ? "Email" : "Эл. почта"}
              </div>
              <input
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setRequestLoginCodeMsg(null);
                }}
                type="email"
                className="w-full text-center rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] text-[var(--k-text)] px-3 py-2 outline-none focus:border-[#8A2BE2]"
              />
            </label>
            <label className="block">
              <div className="text-[var(--k-text-muted)] text-sm mb-2 text-center">
                {uiLanguage === "en" ? "Code from email (6 digits)" : "Код из письма (6 цифр)"}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="000000"
                  className="min-w-[7rem] flex-1 text-center rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] text-[var(--k-text)] px-3 py-2 outline-none focus:border-[#8A2BE2] tracking-widest text-lg"
                />
                <GreyButton
                  variant="soft"
                  disabled={requestLoginCodeBusy || !email.trim()}
                  onClick={() => submitRequestLoginCode()}
                >
                  {requestLoginCodeBusy
                    ? uiLanguage === "en"
                      ? "Sending…"
                      : "Отправляем…"
                    : uiLanguage === "en"
                      ? "Get code"
                      : "Запросить код"}
                </GreyButton>
              </div>
              {requestLoginCodeMsg ? (
                <div className="text-emerald-600 text-sm mt-2 text-center">{requestLoginCodeMsg}</div>
              ) : null}
            </label>

            {authNotice ? <div className="text-emerald-600 text-sm text-center">{authNotice}</div> : null}
            {authError ? <div className="text-red-500 text-sm text-center">{authError}</div> : null}

            <div className="flex w-full justify-center pt-1">
              <GreyButton
                onClick={() => submitAuth()}
                disabled={
                  authLoading || otpCode.replace(/\s/g, "").length < 6 || !email.trim()
                }
                variant="primary"
              >
                {authLoading
                  ? uiLanguage === "en"
                    ? "Please wait…"
                    : "Подождите…"
                  : uiLanguage === "en"
                    ? "Sign in with code"
                    : "Войти по коду"}
              </GreyButton>
            </div>

            <div className="flex w-full justify-center pt-4">
              <a
                href={getApiUrl("/docs")}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--k-text-muted)] underline-offset-2 transition-colors hover:text-[var(--k-text)] hover:underline"
              >
                {uiLanguage === "en" ? "API documentation (Swagger)" : "Документация API (Swagger)"}
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
    );
  }

  return (
    <>
    <AppShell
      organizations={sidebarOrganizations}
      activeOrganizationId={activeOrganizationId}
      onSelectOrganization={(orgId) => {
        setActiveOrganizationId(orgId);
        setActiveBoardId(null);
        setKaitenTab("lists");
      }}
      canRenameOrganization={(organizationId) => {
        const m = orgMemberships.find((x) => normalizeOrgIdKey(x.organization_id) === normalizeOrgIdKey(organizationId));
        return m?.role === "manager" || m?.role === "admin";
      }}
      onRenameOrganization={handleRenameOrganization}
      organizationMembers={sidebarOrgMembers}
      organizationMembersLoading={sidebarOrgMembersLoading}
      currentUserId={currentUserId}
      onOpenDirectMessage={(m) =>
        {
          setDmPeer({
            id: m.id,
            full_name: m.full_name,
            email: m.email,
            role: m.role,
            avatar_url: m.avatar_url,
          });
          setDmOpen(true);
        }
      }
      spaces={visibleSpaces}
      projects={visibleProjects}
      boards={visibleBoards}
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
      onRenameBoard={handleRenameBoard}
      onDeleteSpace={handleDeleteSpace}
      onDeleteBoard={handleDeleteBoard}
      activeTabId={kaitenTab}
      onTabChange={setKaitenTab}
      notificationCount={unreadNotificationsCount}
      directMessageUnreadCount={dmUnreadCount}
      onDirectMessagesClick={() => {
        if (token?.access && activeOrganizationId) fetchDmUnread(token.access, activeOrganizationId).catch(() => {});
        setDmOpen(true);
      }}
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
      onCreateBoardClick={canManageBoard ? openCreateBoardDialog : undefined}
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
          if (!(effectiveRole === "manager" || effectiveRole === "admin")) {
            setAuthError(uiLanguage === "en" ? "Only manager/admin can create spaces" : "Создавать пространства могут только менеджер и администратор");
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
          openCreateBoardDialog();
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
          openCreateBoardDialog();
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
      onOpenTaskFilters={(el) => {
        setKaitenTab("lists");
        setFiltersAnchorEl(el);
      }}
      onLogout={() => {
        setToken(null);
        setActiveSpaceId(null);
        setActiveOrganizationId(null);
        setActiveProjectId(null);
        setActiveBoardId(null);
        localStorage.removeItem(ACCESS_STORAGE_KEY);
        localStorage.removeItem(REFRESH_STORAGE_KEY);
        try {
          localStorage.removeItem(LAST_ACTIVE_ORG_STORAGE_KEY);
        } catch {
          // ignore
        }
        setCurrentUserId(null);
        setDmPeer(null);
        setDmOpen(false);
      }}
    >
      <div
        className="kaiten-app-content flex flex-col flex-1 min-h-0"
        style={{ background: uiColors.pageBg }}
        role="region"
        aria-label="Контент приложения"
      >
        {kaitenTab === "reports" && (
          <div
            className="flex flex-col flex-1 min-h-0 rounded-2xl shadow-sm p-4 overflow-auto m-4"
            style={{ background: uiColors.cardBg, border: `1px solid ${uiColors.border}` }}
          >
            <div className="font-bold text-[var(--k-text)] text-lg mb-1">
              {uiLanguage === "en" ? "Reports" : "Отчёты"}
            </div>
            <p className="text-[var(--k-text-muted)] text-sm mb-4">
              {uiLanguage === "en"
                ? "Summary for the board selected in the sidebar (Tasks tab)."
                : "Сводка по доске, выбранной в левом меню (вкладка «Задачи»)."}
            </p>
            {!activeBoardId || !reportStats ? (
              <div className="text-[var(--k-text-muted)] text-sm">
                {uiLanguage === "en" ? "Select a board in the left menu." : "Выберите доску в меню слева."}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-4">
                  <div className="text-xs uppercase tracking-wide text-[var(--k-text-muted)] mb-1">
                    {uiLanguage === "en" ? "Board" : "Доска"}
                  </div>
                  <div className="text-[var(--k-text)] font-semibold text-lg">{reportStats.boardName}</div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-[var(--k-text-muted)]">{uiLanguage === "en" ? "Cards total" : "Всего карточек"}: </span>
                      <span className="text-[var(--k-text)] font-medium">{reportStats.total}</span>
                    </div>
                    <div>
                      <span className="text-[var(--k-text-muted)]">{uiLanguage === "en" ? "Story points (sum)" : "СП (сумма)"}: </span>
                      <span className="text-[var(--k-text)] font-medium">{reportStats.estimateSum}</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-4 overflow-x-auto">
                  <div className="text-xs uppercase tracking-wide text-[var(--k-text-muted)] mb-2">
                    {uiLanguage === "en" ? "By column" : "По колонкам"}
                  </div>
                  <table className="w-full text-sm text-left">
                    <thead>
                      <tr className="border-b border-[var(--k-border)] text-[var(--k-text-muted)]">
                        <th className="py-2 pr-2">{uiLanguage === "en" ? "Column" : "Колонка"}</th>
                        <th className="py-2 pr-2">{uiLanguage === "en" ? "Cards" : "Карточек"}</th>
                        <th className="py-2">{uiLanguage === "en" ? "Type" : "Тип"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportStats.byColumn.map((row, colIdx) => (
                        <tr key={`${row.name}-${colIdx}`} className="border-b border-[var(--k-border)]/60">
                          <td className="py-2 pr-2 text-[var(--k-text)]">{row.name}</td>
                          <td className="py-2 pr-2 text-[var(--k-text)]">{row.count}</td>
                          <td className="py-2 text-[var(--k-text-muted)]">
                            {row.is_done ? (uiLanguage === "en" ? "Done" : "Готово") : uiLanguage === "en" ? "Active" : "Активные"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {kaitenTab === "archive" && (
          <div
            className="flex flex-col flex-1 min-h-0 rounded-2xl shadow-sm p-4 overflow-auto m-4"
            style={{ background: uiColors.cardBg, border: `1px solid ${uiColors.border}` }}
          >
            <div className="font-bold text-[var(--k-text)] text-lg mb-1">
              {uiLanguage === "en" ? "Archive" : "Архив"}
            </div>
            <p className="text-[var(--k-text-muted)] text-sm mb-4">
              {uiLanguage === "en"
                ? "Cards archived by manager/admin across all boards in this space."
                : "Карточки, отправленные в архив менеджером/админом, на всех досках текущего пространства."}
            </p>
            {!activeSpaceId ? (
              <div className="text-[var(--k-text-muted)] text-sm">
                {uiLanguage === "en" ? "No space selected." : "Пространство не выбрано."}
              </div>
            ) : archiveLoading ? (
              <div className="text-[var(--k-text-muted)] text-sm">{uiLanguage === "en" ? "Loading…" : "Загрузка…"}</div>
            ) : archiveCards.length === 0 ? (
              <div className="text-[var(--k-text-muted)] text-sm">
                {uiLanguage === "en" ? "No archived cards." : "Нет карточек в архиве."}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-[var(--k-border)] text-[var(--k-text-muted)]">
                      <th className="py-2 px-3">{uiLanguage === "en" ? "Card" : "Карточка"}</th>
                      <th className="py-2 px-3">{uiLanguage === "en" ? "Board" : "Доска"}</th>
                      <th className="py-2 px-3">{uiLanguage === "en" ? "Column" : "Колонка"}</th>
                      <th className="py-2 px-3">{uiLanguage === "en" ? "Effort" : "Трудозатраты"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archiveCards.map((c) => (
                      <tr key={c.id} className="border-b border-[var(--k-border)]/60 hover:bg-[var(--k-page-bg)]">
                        <td className="py-2 px-3">
                          <button
                            type="button"
                            className="text-left text-[var(--k-text)] underline-offset-2 hover:underline"
                            onClick={() => {
                              setKaitenTab("lists");
                              void openCardDetails(c.id);
                            }}
                          >
                            {c.title}
                          </button>
                        </td>
                        <td className="py-2 px-3 text-[var(--k-text-muted)]">{c.board_name}</td>
                        <td className="py-2 px-3 text-[var(--k-text-muted)]">{c.column_name}</td>
                        <td className="py-2 px-3 text-[var(--k-text-muted)]">
                          {formatEffortSeconds(c.total_effort_seconds, uiLanguage)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
                {viewMode === "board" && access && (
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
            {orgUsersSuccess ? <div className="text-emerald-600 dark:text-emerald-400 text-sm mb-3">{orgUsersSuccess}</div> : null}

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
                  <option value="executor">{uiLanguage === "en" ? "Executor" : "Исполнитель"}</option>
                  <option value="manager">{uiLanguage === "en" ? "Manager" : "Менеджер"}</option>
                  <option value="admin">{uiLanguage === "en" ? "Admin" : "Администратор"}</option>
                </select>
                {adminOrganizations.length >= 1 ? (
                  <label className="md:col-span-2 flex flex-col gap-1">
                    <span className="text-xs text-[var(--k-text-muted)]">
                      {uiLanguage === "en" ? "Organization" : "Организация"}
                    </span>
                    <select
                      value={newUserOrganizationId ?? ""}
                      onChange={(e) => setNewUserOrganizationId(e.target.value || null)}
                      className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-[var(--k-text)] outline-none"
                    >
                      {adminOrganizations.map((m) => (
                        <option key={m.organization_id} value={m.organization_id}>
                          {m.organization_name || m.organization_id}
                        </option>
                      ))}
                    </select>
                    {!hasBsvrOrganization && token ? (
                      <div className="mt-2">
                      <GreyButton
                        variant="soft"
                        disabled={createBsvrOrgBusy}
                        onClick={async () => {
                          if (!token) return;
                          setCreateBsvrOrgBusy(true);
                          setOrgUsersError(null);
                          setOrgUsersSuccess(null);
                          try {
                            const res = await fetch(getApiUrl("/api/auth/organizations"), {
                              method: "POST",
                              headers: {
                                Authorization: `Bearer ${token.access}`,
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({ name: "БСВР" }),
                            });
                            const data = (await res.json().catch(() => ({}))) as { id?: string; detail?: string };
                            if (!res.ok) {
                              throw new Error(
                                typeof data.detail === "string" ? data.detail : "Не удалось создать организацию",
                              );
                            }
                            await fetchCurrentUser(token.access);
                            await fetchSpaces(token.access);
                            if (data.id) {
                              setNewUserOrganizationId(data.id);
                              setActiveOrganizationId(data.id);
                            }
                            setOrgUsersSuccess(
                              uiLanguage === "en" ? "Organization «BSVR» has been created" : "Организация «БСВР» создана",
                            );
                          } catch (e: any) {
                            setOrgUsersError(e?.message ?? "Ошибка создания организации");
                          } finally {
                            setCreateBsvrOrgBusy(false);
                          }
                        }}
                      >
                        {createBsvrOrgBusy
                          ? uiLanguage === "en"
                            ? "Creating…"
                            : "Создание…"
                          : uiLanguage === "en"
                            ? "Add organization «BSVR» to the list"
                            : "Добавить организацию «БСВР» в список"}
                      </GreyButton>
                      </div>
                    ) : null}
                  </label>
                ) : null}
              </div>
              <div className="mt-3 flex justify-end">
                <GreyButton
                  variant="primary"
                  disabled={
                    newUserBusy ||
                    !newUserEmail.trim() ||
                    newUserPassword.trim().length < 8 ||
                    !newUserOrganizationId
                  }
                  onClick={async () => {
                    if (!token || !newUserOrganizationId) return;
                    setNewUserBusy(true);
                    setOrgUsersError(null);
                    setOrgUsersSuccess(null);
                    try {
                      const res = await fetch(getApiUrl("/api/auth/users"), {
                        method: "POST",
                        headers: {
                          Authorization: `Bearer ${token.access}`,
                          "X-Organization-Id": newUserOrganizationId,
                          "Content-Type": "application/json",
                          ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                        },
                        body: JSON.stringify({
                          email: newUserEmail.trim(),
                          password: newUserPassword,
                          full_name: newUserFullName.trim(),
                          role: newUserRole,
                          organization_id: newUserOrganizationId,
                        }),
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data?.detail ?? "Не удалось создать пользователя");
                      setNewUserEmail("");
                      setNewUserPassword("");
                      setNewUserFullName("");
                      setNewUserRole("executor");
                      await fetchOrganizationUsers(token.access, {
                        organizationId: newUserOrganizationId || activeOrganizationId,
                        spaceId: activeSpaceId,
                      });
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
                  <div
                    key={u.id}
                    className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-3 flex flex-col gap-3"
                  >
                    <div className="flex flex-col md:flex-row md:items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--k-text)] font-semibold truncate">{u.full_name || u.email}</div>
                        <div className="text-[var(--k-text-muted)] text-sm truncate">{u.email}</div>
                        {u.memberships && u.memberships.length > 0 ? (
                          <div className="text-[var(--k-text-muted)] text-xs mt-1.5">
                            <div className="font-medium text-[var(--k-text)] mb-0.5">
                              {uiLanguage === "en" ? "Organizations" : "Организации"}
                            </div>
                            <ul className="space-y-0.5 list-none pl-0 m-0">
                              {u.memberships.map((m) => (
                                <li key={m.organization_id} className="flex flex-wrap gap-x-1.5 gap-y-0 items-baseline">
                                  <span className="text-[var(--k-text)] font-medium">
                                    {m.organization_name?.trim() || m.organization_id}
                                  </span>
                                  <span className="text-[var(--k-text-muted)]">
                                    ({formatOrgMemberRoleLabel(m.role, uiLanguage)})
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : activeOrganizationName ? (
                          <div className="text-[var(--k-text-muted)] text-xs mt-1">
                            {uiLanguage === "en" ? "Organization: " : "Организация: "}
                            <span className="text-[var(--k-text)] font-medium">{activeOrganizationName}</span>
                          </div>
                        ) : null}
                        <div className="text-[var(--k-text-muted)] text-xs mt-1">
                          {u.last_login
                            ? (uiLanguage === "en" ? "Last sign-in: " : "Последний вход: ") +
                              new Date(u.last_login).toLocaleString(uiLanguage === "en" ? "en-US" : "ru-RU")
                            : uiLanguage === "en"
                              ? "No sign-in recorded yet"
                              : "Входов по паролю/коду ещё не было"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <GreyButton
                          variant="soft"
                          onClick={() => {
                            setAdminEditUser(u);
                            setAdminEditFullName(u.full_name || "");
                            setAdminEditEmail(u.email);
                            setAdminAddMembershipRole("executor");
                            setOrgUsersError(null);
                            setOrgUsersSuccess(null);
                          }}
                        >
                          {uiLanguage === "en" ? "Edit" : "Редактировать"}
                        </GreyButton>
                        {currentUserId && u.id !== currentUserId ? (
                          <GreyButton
                            variant="soft"
                            disabled={userDeleteBusyId === u.id}
                            onClick={async () => {
                              if (!token || !activeOrganizationId) return;
                              const ok = window.confirm(
                                uiLanguage === "en"
                                  ? `Permanently delete account ${u.email}? This cannot be undone. The user will be removed from all organizations and all related data will be deleted or unlinked.`
                                  : `Полностью удалить учётную запись ${u.email}? Это действие необратимо: пользователь будет удалён из всех организаций, связанные данные будут удалены или отвязаны.`,
                              );
                              if (!ok) return;
                              setUserDeleteBusyId(u.id);
                              setOrgUsersError(null);
                              setOrgUsersSuccess(null);
                              try {
                                const res = await fetch(getApiUrl(`/api/auth/users/${u.id}`), {
                                  method: "DELETE",
                                  headers: {
                                    Authorization: `Bearer ${token.access}`,
                                    "X-Organization-Id": activeOrganizationId,
                                    ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                                  },
                                });
                                const data = await res.json().catch(() => ({}));
                                if (!res.ok) {
                                  throw new Error(
                                    typeof data?.detail === "string"
                                      ? data.detail
                                      : uiLanguage === "en"
                                        ? "Could not delete user"
                                        : "Не удалось удалить пользователя",
                                  );
                                }
                                setOrgUsersSuccess(
                                  uiLanguage === "en" ? "User account deleted" : "Учётная запись пользователя удалена",
                                );
                                await fetchOrganizationUsers(token.access, {
                                  organizationId: activeOrganizationId,
                                  spaceId: activeSpaceId,
                                });
                              } catch (e: any) {
                                setOrgUsersError(e?.message ?? "Ошибка удаления");
                              } finally {
                                setUserDeleteBusyId(null);
                              }
                            }}
                          >
                            {userDeleteBusyId === u.id
                              ? uiLanguage === "en"
                                ? "Deleting…"
                                : "Удаление…"
                              : uiLanguage === "en"
                                ? "Delete account"
                                : "Удалить учётную запись"}
                          </GreyButton>
                        ) : null}
                        <GreyButton
                          variant="soft"
                          disabled={userCodeBusyId === u.id}
                          onClick={async () => {
                            if (!token || !activeOrganizationId) return;
                            setUserCodeBusyId(u.id);
                            setOrgUsersError(null);
                            setOrgUsersSuccess(null);
                            try {
                              const res = await fetch(getApiUrl(`/api/auth/users/${u.id}/request-login-code`), {
                                method: "POST",
                                headers: {
                                  Authorization: `Bearer ${token.access}`,
                                  "X-Organization-Id": activeOrganizationId,
                                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                                },
                              });
                              const data = await res.json().catch(() => ({}));
                              if (!res.ok) {
                                throw new Error(
                                  typeof data?.detail === "string"
                                    ? data.detail
                                    : uiLanguage === "en"
                                      ? "Could not send code"
                                      : "Не удалось отправить код",
                                );
                              }
                              setOrgUsersSuccess(
                                uiLanguage === "en"
                                  ? `Login code sent to ${u.email}`
                                  : `Код входа отправлен на ${u.email}`,
                              );
                            } catch (e: any) {
                              setOrgUsersError(e?.message ?? "Ошибка отправки кода");
                            } finally {
                              setUserCodeBusyId(null);
                            }
                          }}
                        >
                          {userCodeBusyId === u.id
                            ? uiLanguage === "en"
                              ? "Sending…"
                              : "Отправка…"
                            : uiLanguage === "en"
                              ? "Send login code"
                              : "Код на почту"}
                        </GreyButton>
                        <select
                          value={u.role}
                          onChange={async (e) => {
                            if (!token || !activeOrganizationId) return;
                            const nextRole = e.target.value as OrgUser["role"];
                            try {
                              const res = await fetch(getApiUrl(`/api/auth/users/${u.id}/role`), {
                                method: "PATCH",
                                headers: {
                                  Authorization: `Bearer ${token.access}`,
                                  "X-Organization-Id": activeOrganizationId,
                                  ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
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
                          className="rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-[var(--k-text)] outline-none min-w-[160px]"
                        >
                          <option value="executor">{uiLanguage === "en" ? "Executor" : "Исполнитель"}</option>
                          <option value="manager">{uiLanguage === "en" ? "Manager" : "Менеджер"}</option>
                          <option value="admin">{uiLanguage === "en" ? "Admin" : "Администратор"}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
                {!orgUsers.length && !orgUsersLoading ? (
                  <div className="text-[var(--k-text-muted)] text-sm">{uiLanguage === "en" ? "No users found" : "Пользователи не найдены"}</div>
                ) : null}
              </div>
            </div>

            {adminEditUser ? (
              <div
                className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-black/50"
                onClick={() =>
                  !adminEditBusy && !adminAddMembershipBusy && !adminMembershipRoleBusyOrgId && setAdminEditUser(null)
                }
                role="presentation"
              >
                <div
                  className="w-full max-w-lg rounded-2xl border border-[var(--k-border)] p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
                  style={{ background: uiColors.cardBg }}
                  onClick={(e) => e.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="admin-edit-user-title"
                >
                  <div id="admin-edit-user-title" className="font-bold text-[var(--k-text)] mb-3">
                    {uiLanguage === "en" ? "Edit user" : "Редактирование пользователя"}
                  </div>
                  <div className="space-y-3">
                    <label className="block">
                      <div className="text-xs text-[var(--k-text-muted)] mb-1">{uiLanguage === "en" ? "Name" : "Имя"}</div>
                      <input
                        value={adminEditFullName}
                        onChange={(e) => setAdminEditFullName(e.target.value)}
                        className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-[var(--k-text)] outline-none focus:border-[#8A2BE2]"
                      />
                    </label>
                    <label className="block">
                      <div className="text-xs text-[var(--k-text-muted)] mb-1">Email</div>
                      <input
                        value={adminEditEmail}
                        onChange={(e) => setAdminEditEmail(e.target.value)}
                        type="email"
                        className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] px-3 py-2 text-[var(--k-text)] outline-none focus:border-[#8A2BE2]"
                      />
                    </label>
                  </div>
                  <div className="rounded-xl border border-[var(--k-border)] bg-[var(--k-page-bg)] p-3 space-y-2 mt-3">
                    <div className="text-xs font-semibold text-[var(--k-text)]">
                      {uiLanguage === "en" ? "Organizations (where you are admin)" : "Организации (где вы администратор)"}
                    </div>
                    {adminMembershipsLoading ? (
                      <div className="text-sm text-[var(--k-text-muted)]">
                        {uiLanguage === "en" ? "Loading…" : "Загрузка…"}
                      </div>
                    ) : (
                      <ul className="space-y-1.5 text-sm">
                        {adminUserMemberships.map((m) => (
                          <li
                            key={m.organization_id}
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-2 py-1.5"
                          >
                            <span className="text-[var(--k-text)] truncate min-w-0 text-sm">
                              {m.organization_name || m.organization_id}
                            </span>
                            <select
                              value={m.role}
                              disabled={
                                Boolean(adminMembershipRoleBusyOrgId) ||
                                adminAddMembershipBusy ||
                                adminEditBusy ||
                                !token ||
                                !activeOrganizationId
                              }
                              onChange={async (e) => {
                                const next = e.target.value as OrgUser["role"];
                                if (next === m.role || !token || !activeOrganizationId || !adminEditUser) return;
                                setAdminMembershipRoleBusyOrgId(m.organization_id);
                                setOrgUsersError(null);
                                setOrgUsersSuccess(null);
                                try {
                                  const res = await fetch(
                                    getApiUrl(`/api/auth/users/${adminEditUser.id}/memberships`),
                                    {
                                      method: "POST",
                                      headers: {
                                        Authorization: `Bearer ${token.access}`,
                                        "X-Organization-Id": activeOrganizationId,
                                        ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        organization_id: m.organization_id,
                                        role: next,
                                      }),
                                    },
                                  );
                                  const data = (await res.json().catch(() => ({}))) as { detail?: string };
                                  if (!res.ok) throw new Error(data?.detail ?? "Не удалось изменить роль");
                                  const reload = await fetch(
                                    getApiUrl(`/api/auth/users/${adminEditUser.id}/memberships`),
                                    {
                                      headers: {
                                        Authorization: `Bearer ${token.access}`,
                                        "X-Organization-Id": activeOrganizationId,
                                        ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                                      },
                                    },
                                  );
                                  const list = (await reload.json().catch(() => [])) as Array<{
                                    organization_id: string;
                                    organization_name: string;
                                    role: string;
                                  }>;
                                  if (reload.ok && Array.isArray(list)) {
                                    setAdminUserMemberships(
                                      list.map((x) => ({
                                        organization_id: x.organization_id,
                                        organization_name: x.organization_name,
                                        role: (x.role as OrgUser["role"]) ?? "executor",
                                      })),
                                    );
                                  }
                                  setOrgUsersSuccess(
                                    uiLanguage === "en" ? "Role updated" : "Роль обновлена",
                                  );
                                  if (
                                    normalizeOrgIdKey(m.organization_id) === normalizeOrgIdKey(activeOrganizationId)
                                  ) {
                                    await fetchOrganizationUsers(token.access, {
                                      organizationId: activeOrganizationId,
                                      spaceId: activeSpaceId,
                                    }).catch(() => {});
                                  }
                                } catch (err: unknown) {
                                  setOrgUsersError(err instanceof Error ? err.message : "Ошибка");
                                } finally {
                                  setAdminMembershipRoleBusyOrgId(null);
                                }
                              }}
                              className="shrink-0 min-w-[160px] rounded-lg border border-[var(--k-border)] bg-[var(--k-page-bg)] px-2 py-1.5 text-[var(--k-text)] outline-none text-xs"
                            >
                              <option value="executor">{uiLanguage === "en" ? "Executor" : "Исполнитель"}</option>
                              <option value="manager">{uiLanguage === "en" ? "Manager" : "Менеджер"}</option>
                              <option value="admin">{uiLanguage === "en" ? "Admin" : "Администратор"}</option>
                            </select>
                          </li>
                        ))}
                        {!adminUserMemberships.length ? (
                          <li className="text-[var(--k-text-muted)] text-xs">
                            {uiLanguage === "en"
                              ? "No shared organizations yet, or the user is only in orgs where you are not admin."
                              : "Пока нет общих организаций или пользователь только там, где вы не администратор."}
                          </li>
                        ) : null}
                      </ul>
                    )}
                    {orgsAvailableToAddForAdminEdit.length > 0 ? (
                      <div className="pt-2 border-t border-[var(--k-border)] space-y-2">
                        <div className="text-xs text-[var(--k-text-muted)]">
                          {uiLanguage === "en" ? "Add user to organization" : "Добавить пользователя в организацию"}
                        </div>
                        <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-end">
                          <label className="flex-1 min-w-[140px]">
                            <div className="text-[10px] text-[var(--k-text-muted)] mb-0.5">
                              {uiLanguage === "en" ? "Organization" : "Организация"}
                            </div>
                            <select
                              value={adminAddMembershipOrgId}
                              onChange={(e) => setAdminAddMembershipOrgId(e.target.value)}
                              disabled={Boolean(adminMembershipRoleBusyOrgId)}
                              className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-[var(--k-text)] outline-none text-sm disabled:opacity-60"
                            >
                              {orgsAvailableToAddForAdminEdit.map((o) => (
                                <option key={o.organization_id} value={o.organization_id}>
                                  {o.organization_name || o.organization_id}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="min-w-[140px]">
                            <div className="text-[10px] text-[var(--k-text-muted)] mb-0.5">
                              {uiLanguage === "en" ? "Role" : "Роль"}
                            </div>
                            <select
                              value={adminAddMembershipRole}
                              onChange={(e) => setAdminAddMembershipRole(e.target.value as OrgUser["role"])}
                              disabled={Boolean(adminMembershipRoleBusyOrgId)}
                              className="w-full rounded-xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] px-3 py-2 text-[var(--k-text)] outline-none text-sm disabled:opacity-60"
                            >
                              <option value="executor">{uiLanguage === "en" ? "Executor" : "Исполнитель"}</option>
                              <option value="manager">{uiLanguage === "en" ? "Manager" : "Менеджер"}</option>
                              <option value="admin">{uiLanguage === "en" ? "Admin" : "Администратор"}</option>
                            </select>
                          </label>
                          <GreyButton
                            variant="soft"
                            disabled={
                              adminAddMembershipBusy ||
                              adminEditBusy ||
                              Boolean(adminMembershipRoleBusyOrgId) ||
                              !adminAddMembershipOrgId ||
                              !token ||
                              !activeOrganizationId
                            }
                            onClick={async () => {
                              if (!token || !activeOrganizationId || !adminEditUser || !adminAddMembershipOrgId) return;
                              setAdminAddMembershipBusy(true);
                              setOrgUsersError(null);
                              setOrgUsersSuccess(null);
                              try {
                                const res = await fetch(
                                  getApiUrl(`/api/auth/users/${adminEditUser.id}/memberships`),
                                  {
                                    method: "POST",
                                    headers: {
                                      Authorization: `Bearer ${token.access}`,
                                      "X-Organization-Id": activeOrganizationId,
                                      ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                                      "Content-Type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      organization_id: adminAddMembershipOrgId,
                                      role: adminAddMembershipRole,
                                    }),
                                  },
                                );
                                const data = (await res.json().catch(() => ({}))) as { detail?: string };
                                if (!res.ok) throw new Error(data?.detail ?? "Не удалось добавить в организацию");
                                const reload = await fetch(
                                  getApiUrl(`/api/auth/users/${adminEditUser.id}/memberships`),
                                  {
                                    headers: {
                                      Authorization: `Bearer ${token.access}`,
                                      "X-Organization-Id": activeOrganizationId,
                                      ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                                    },
                                  },
                                );
                                const list = (await reload.json().catch(() => [])) as Array<{
                                  organization_id: string;
                                  organization_name: string;
                                  role: string;
                                }>;
                                if (reload.ok && Array.isArray(list)) {
                                  setAdminUserMemberships(
                                    list.map((x) => ({
                                      organization_id: x.organization_id,
                                      organization_name: x.organization_name,
                                      role: (x.role as OrgUser["role"]) ?? "executor",
                                    })),
                                  );
                                }
                                setOrgUsersSuccess(
                                  uiLanguage === "en" ? "Membership updated" : "Участие в организации обновлено",
                                );
                                if (normalizeOrgIdKey(adminAddMembershipOrgId) === normalizeOrgIdKey(activeOrganizationId)) {
                                  await fetchOrganizationUsers(token.access, {
                                    organizationId: activeOrganizationId,
                                    spaceId: activeSpaceId,
                                  }).catch(() => {});
                                }
                              } catch (e: unknown) {
                                setOrgUsersError(e instanceof Error ? e.message : "Ошибка");
                              } finally {
                                setAdminAddMembershipBusy(false);
                              }
                            }}
                          >
                            {adminAddMembershipBusy
                              ? uiLanguage === "en"
                                ? "Adding…"
                                : "Добавление…"
                              : uiLanguage === "en"
                                ? "Add"
                                : "Добавить"}
                          </GreyButton>
                        </div>
                      </div>
                    ) : !adminMembershipsLoading && adminOrganizations.length > 1 ? (
                      <div className="text-xs text-[var(--k-text-muted)] pt-1">
                        {uiLanguage === "en"
                          ? "User is already a member of all organizations you administer."
                          : "Пользователь уже состоит во всех организациях, где вы администратор."}
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-4 flex justify-end gap-2 flex-wrap">
                    <GreyButton
                      variant="soft"
                      disabled={adminEditBusy || adminAddMembershipBusy || Boolean(adminMembershipRoleBusyOrgId)}
                      onClick={() => setAdminEditUser(null)}
                    >
                      {uiLanguage === "en" ? "Cancel" : "Отмена"}
                    </GreyButton>
                    <GreyButton
                      variant="primary"
                      disabled={
                        adminEditBusy ||
                        adminAddMembershipBusy ||
                        Boolean(adminMembershipRoleBusyOrgId) ||
                        !adminEditFullName.trim() ||
                        !adminEditEmail.trim()
                      }
                      onClick={async () => {
                        if (!token || !activeOrganizationId || !adminEditUser) return;
                        setAdminEditBusy(true);
                        setOrgUsersError(null);
                        setOrgUsersSuccess(null);
                        try {
                          const res = await fetch(getApiUrl(`/api/auth/users/${adminEditUser.id}`), {
                            method: "PATCH",
                            headers: {
                              Authorization: `Bearer ${token.access}`,
                              "X-Organization-Id": activeOrganizationId,
                              ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              full_name: adminEditFullName.trim(),
                              email: adminEditEmail.trim().toLowerCase(),
                            }),
                          });
                          const data = (await res.json().catch(() => ({}))) as Partial<OrgUser> & { detail?: string };
                          if (!res.ok) throw new Error(data?.detail ?? "Не удалось сохранить");
                          setOrgUsers((prev) =>
                            prev.map((it) =>
                              it.id === adminEditUser.id
                                ? {
                                    ...it,
                                    full_name: (data.full_name as string) ?? adminEditFullName.trim(),
                                    email: (data.email as string) ?? adminEditEmail.trim().toLowerCase(),
                                    last_login: (data.last_login as string | null | undefined) ?? it.last_login,
                                    role: (data.role as OrgUser["role"]) ?? it.role,
                                  }
                                : it,
                            ),
                          );
                          setOrgUsersSuccess(uiLanguage === "en" ? "User updated" : "Пользователь обновлён");
                          setAdminEditUser(null);
                        } catch (e: any) {
                          setOrgUsersError(e?.message ?? "Ошибка сохранения");
                        } finally {
                          setAdminEditBusy(false);
                        }
                      }}
                    >
                      {adminEditBusy
                        ? uiLanguage === "en"
                          ? "Saving…"
                          : "Сохранение…"
                        : uiLanguage === "en"
                          ? "Save"
                          : "Сохранить"}
                    </GreyButton>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        )}

        <FiltersPopover
          anchorEl={filtersAnchorEl}
          open={Boolean(filtersAnchorEl)}
          onClose={() => setFiltersAnchorEl(null)}
          filters={filters}
          onChangeFilters={setFilters}
          assigneeOptions={filterAssigneeOptions}
          language={uiLanguage}
        />
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
            <div className="text-2xl font-bold text-[var(--k-text)] mb-1">
              {tourSteps[tourStep]?.title}
            </div>
            <div className="text-sm text-[var(--k-text-muted)] mb-4">
              {tourSteps[tourStep]?.body}
            </div>
            <div className="mb-4 grid grid-cols-4 gap-2">
              {tourSteps.map((_, idx) => (
                <div
                  key={`tour-step-${idx}`}
                  className="h-1.5 rounded-full"
                  style={{
                    background: idx <= tourStep ? "linear-gradient(90deg, #8A2BE2 0%, #4B0082 100%)" : "var(--k-border)",
                  }}
                />
              ))}
            </div>
            <div className="rounded-2xl border border-[var(--k-border)] bg-[var(--k-surface-bg)] p-4">
              <div className="text-xs uppercase tracking-wide text-[var(--k-text-muted)] mb-2">
                {uiLanguage === "en"
                  ? `Step ${tourStep + 1} of ${tourSteps.length}`
                  : `Шаг ${tourStep + 1} из ${tourSteps.length}`}
              </div>
              <div className="text-sm text-[var(--k-text-muted)]">
                {uiLanguage === "en"
                  ? "Use quick action to open the section right now."
                  : "Используйте быстрое действие, чтобы сразу открыть нужный раздел."}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <GreyButton
                  variant="soft"
                  onClick={() => {
                    if (tourStep > 0) setTourStep((prev) => Math.max(0, prev - 1));
                  }}
                  disabled={tourStep === 0}
                >
                  {uiLanguage === "en" ? "Back" : "Назад"}
                </GreyButton>
                <GreyButton
                  variant="soft"
                  onClick={() => {
                    tourSteps[tourStep]?.onAction();
                  }}
                >
                  {tourSteps[tourStep]?.actionLabel}
                </GreyButton>
              </div>
              <div className="flex items-center gap-2">
                {tourStep < tourSteps.length - 1 ? (
                  <GreyButton
                    variant="primary"
                    onClick={() => setTourStep((prev) => Math.min(tourSteps.length - 1, prev + 1))}
                  >
                    {uiLanguage === "en" ? "Next" : "Далее"}
                  </GreyButton>
                ) : null}
                <GreyButton
                  variant="primary"
                  onClick={() => {
                    setTourOpen(false);
                    setTourStep(0);
                    try {
                      localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
                    } catch {
                      // ignore
                    }
                  }}
                >
                  {uiLanguage === "en" ? "Finish" : "Завершить"}
                </GreyButton>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <GreyButton
                variant="soft"
                onClick={() => {
                  setTourOpen(false);
                  setTourStep(0);
                  try {
                    localStorage.setItem(ONBOARDING_TOUR_STORAGE_KEY, "1");
                  } catch {
                    // ignore
                  }
                }}
              >
                {uiLanguage === "en" ? "Skip tour" : "Пропустить тур"}
              </GreyButton>
            </div>
          </div>
        </div>
      ) : null}

      {selectedCard ? (
        <CardModal
          card={selectedCard}
          locale={uiLanguage}
          currentUserRole={effectiveRole}
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
          onDeleteAttachment={
            effectiveRole === "manager" || effectiveRole === "admin"
              ? async (attachmentId) => {
                  if (!token || !selectedCard) return;
                  const res = await fetch(
                    getApiUrl(`/api/kanban/cards/${selectedCard.id}/attachments/${attachmentId}`),
                    {
                      method: "DELETE",
                      headers: {
                        Authorization: `Bearer ${token.access}`,
                        "X-Space-Id": activeSpaceId || "",
                      },
                    },
                  );
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data?.detail ?? "Не удалось удалить вложение");
                  await refreshSelectedCard();
                }
              : undefined
          }
          onClose={() => {
            setSelectedCard(null);
            setSelectedCardError(null);
            deepLinkCardHandledRef.current = null;
            if (typeof window !== "undefined") {
              const params = new URLSearchParams(window.location.search);
              if (params.has("card")) {
                params.delete("card");
                params.delete("board");
                const q = params.toString();
                router.replace(q ? `/app?${q}` : "/app", { scroll: false });
              }
            }
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
        activeOrganizationId={activeOrganizationId}
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
        <CreateBoardDialog
          open={createBoardOpen}
          onClose={() => setCreateBoardOpen(false)}
          token={access}
          spaceId={activeSpaceId}
          projectId={newBoardProjectId}
          refreshToken={token?.refresh}
          defaultName={newBoardDefaultName}
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
          onCreated={handleBoardCreated}
        />
      ) : null}

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
            setCreateTaskTrackId(null);
          }}
          token={access}
          refreshToken={token?.refresh}
          boardId={activeBoardId}
          columns={columns}
          defaultColumnId={createTaskColumnId}
          defaultTrackId={createTaskTrackId}
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
    {access && activeOrganizationId ? (
      <DirectMessageDrawer
        open={dmOpen}
        onClose={() => setDmOpen(false)}
        peers={sidebarOrgMembers.map((m) => ({
          id: m.id,
          full_name: m.full_name,
          email: m.email,
          role: m.role,
          avatar_url: m.avatar_url,
        }))}
        initialPeerId={dmPeer?.id ?? null}
        token={access}
        organizationId={activeOrganizationId}
        currentUserId={currentUserId}
        language={uiLanguage}
        onConversationRead={() => {
          if (token?.access && activeOrganizationId) fetchDmUnread(token.access, activeOrganizationId).catch(() => {});
        }}
      />
    ) : null}
    </>
  );
}
