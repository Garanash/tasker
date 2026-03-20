"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  OutlinedInput,
  Typography,
  useTheme,
} from "@mui/material";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import NotificationsIcon from "@mui/icons-material/Notifications";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import FilterListIcon from "@mui/icons-material/FilterList";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonth";
import AddIcon from "@mui/icons-material/Add";
import TimelineIcon from "@mui/icons-material/Timeline";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import CheckBoxOutlineBlankIcon from "@mui/icons-material/CheckBoxOutlineBlank";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import AlmazLogo from "./AlmazLogo";
import LeftSidebar from "./LeftSidebar";
import RightRail from "./RightRail";
import ProfileMenu, { type ColorTheme } from "./ProfileMenu";
import { setStoredLanguage, setStoredTheme, type AppLanguage } from "@/lib/preferences";

export type AppShellSpace = { id: string; name: string };
export type AppShellBoard = { id: string; name: string; space_id?: string; project_id?: string };
export type AppShellProject = { id: string; name: string; space_id?: string };
export type AddAction = "folder" | "space" | "storymap" | "document" | "board";
export type AppRole = "user" | "manager" | "lead" | "admin";
export type AppNotification = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
};

export const VIEW_MODES = [
  { id: "board", icon: <GridViewIcon fontSize="small" /> },
  { id: "list", icon: <ViewListIcon fontSize="small" /> },
  { id: "table", icon: <TableChartOutlinedIcon fontSize="small" /> },
  { id: "timeline", icon: <TimelineIcon fontSize="small" /> },
  { id: "calendar", icon: <CalendarMonthIcon fontSize="small" /> },
] as const;

export type ViewMode = (typeof VIEW_MODES)[number]["id"];

const LEFT_DRAWER_WIDTH = 300;

const DARK_TOP = "var(--k-top-bg)";
const LIGHT_BG = "var(--k-page-bg)";
const WHITE_BG = "var(--k-surface-bg)";
const BORDER_GRAY = "var(--k-border)";
const TEXT_GRAY = "var(--k-text-muted)";
const TEXT_DARK = "var(--k-text)";
const ACCENT_PURPLE = "#9C27B0";

type Props = {
  children: ReactNode;

  spaces: AppShellSpace[];
  projects?: AppShellProject[];
  boards: AppShellBoard[];
  activeSpaceId: string | null;
  activeProjectId?: string | null;
  activeBoardId: string | null;

  onSelectSpace: (spaceId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onSelectBoard: (boardId: string) => void;
  /** true если переименование на сервере прошло успешно */
  onRenameSpace?: (spaceId: string, newName: string) => void | Promise<boolean>;
  /** Удаление пространства (lead/admin). Вернуть false при ошибке — диалог останется открытым. */
  onDeleteSpace?: (spaceId: string) => boolean | Promise<boolean> | void | Promise<void>;

  onLogout: () => void;

  activeTabId?: string;
  onTabChange?: (tabId: string) => void;

  notificationCount?: number;
  notifications?: AppNotification[];
  onOpenNotifications?: () => void;
  onReadNotification?: (notificationId: string) => void;
  onReadAllNotifications?: () => void;

  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;

  onCreateClick?: () => void;
  onCreateSpaceClick?: () => void;
  onCreateBoardClick?: () => void;
  onAddAction?: (action: AddAction) => void;
  onOpenAdministration?: () => void;
  onOpenTemplates?: () => void;
  currentUserRole?: AppRole;
  canManageCurrentSpace?: boolean;

  userName?: string;
  userEmail?: string;
  avatarUrl?: string;
  onProfileSettingsClick?: () => void;
  language?: AppLanguage;
  onLanguageChange?: (language: AppLanguage) => void;
  colorTheme?: ColorTheme;
  onColorThemeChange?: (theme: ColorTheme) => void;
};

export default function AppShell({
  children,
  spaces,
  projects = [],
  boards,
  activeSpaceId,
  activeProjectId,
  activeBoardId,
  onSelectSpace,
  onSelectProject,
  onSelectBoard,
  onRenameSpace,
  onDeleteSpace,
  onLogout,
  activeTabId = "lists",
  onTabChange,
  notificationCount = 0,
  notifications = [],
  onOpenNotifications,
  onReadNotification,
  onReadAllNotifications,
  viewMode = "board",
  onViewModeChange,
  onCreateClick,
  onCreateSpaceClick,
  onCreateBoardClick,
  onAddAction,
  onOpenAdministration,
  onOpenTemplates,
  currentUserRole = "user",
  canManageCurrentSpace,
  userName = "Пользователь",
  userEmail = "user@example.com",
  avatarUrl,
  onProfileSettingsClick,
  language = "ru",
  onLanguageChange,
  colorTheme = "system",
  onColorThemeChange,
}: Props) {
  const theme = useTheme();
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [profileAnchorEl, setProfileAnchorEl] = useState<null | HTMLElement>(null);
  const [notificationAnchorEl, setNotificationAnchorEl] = useState<null | HTMLElement>(null);
  const [searchValue, setSearchValue] = useState("");
  const [viewModeAnchor, setViewModeAnchor] = useState<null | HTMLElement>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const t = useMemo(
    () =>
      language === "en"
        ? {
            search: "Search",
            lists: "Lists",
            reports: "Reports",
            archive: "Archive",
            filters: "Filters",
            folder: "Folder",
            space: "Space",
            storyMap: "Story map",
            document: "Document",
            card: "Card",
            board: "Board",
            viewModes: {
              board: "Board",
              list: "List",
              table: "Table",
              timeline: "Timeline",
              calendar: "Calendar",
            } as Record<ViewMode, string>,
          }
        : {
            search: "Найти",
            lists: "Списки",
            reports: "Отчёты",
            archive: "Архив",
            filters: "Фильтры",
            folder: "Папку",
            space: "Пространство",
            storyMap: "Карту историй",
            document: "Документ",
            card: "Карточку",
            board: "Доску",
            viewModes: {
              board: "Доска",
              list: "Списки",
              table: "Таблица",
              timeline: "Таймлайн",
              calendar: "Календарь",
            } as Record<ViewMode, string>,
          },
    [language]
  );

  const activeSpaceName = spaces.find((s) => s.id === activeSpaceId)?.name ?? "Первое пространство";
  const currentViewMode = VIEW_MODES.find((v) => v.id === viewMode) || VIEW_MODES[0];
  const canCreateEntities = currentUserRole !== "user";
  const canCreateSpace = currentUserRole === "lead" || currentUserRole === "admin";
  const canManageSpaces = canManageCurrentSpace ?? canCreateSpace;
  const canOpenAdministration = currentUserRole === "admin";

  const handleToggleSidebarPin = () => {
    setSidebarPinned(!sidebarPinned);
    if (!sidebarPinned) {
      setLeftDrawerOpen(true);
    }
  };

  const handleCloseSidebar = () => {
    if (!sidebarPinned) {
      setLeftDrawerOpen(false);
    }
  };

  const isDarkTheme = theme.palette.mode === "dark";
  const languageLabel = language === "ru" ? "🇷🇺 Русский" : "🇬🇧 English";
  const languageTitle = language === "ru" ? "Switch to English" : "Переключить на русский";
  const themeTitle = isDarkTheme ? "Тёмная" : "Светлая";

  return (
    <Box
      id="reactContent"
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        bgcolor: LIGHT_BG,
        "--k-top-bg": isDarkTheme ? "#0A0A0A" : "#1E1E1E",
        "--k-page-bg": isDarkTheme ? "#0A0A0A" : "#F5F5F5",
        "--k-surface-bg": isDarkTheme ? "#111111" : "#FFFFFF",
        "--k-border": isDarkTheme ? "#2A2A2A" : "#E0E0E0",
        "--k-text": isDarkTheme ? "#E0E0E0" : "#202124",
        "--k-text-muted": isDarkTheme ? "#A0A0A0" : "#5F6368",
      }}
    >
      {/* ===== ВЕРХНЯЯ ТЁМНАЯ ПОЛОСА: Логотип + Поиск + Уведомления + Профиль ===== */}
      <Box
        component="header"
        className="nonprintable"
        sx={{
          height: 48,
          bgcolor: DARK_TOP,
          display: "flex",
          alignItems: "center",
          px: 2,
          gap: 2,
          flexShrink: 0,
        }}
      >
        {/* Бренд в шапке */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <AlmazLogo size={28} />
          <Typography
            variant="h6"
            component="div"
            data-testid="app-brand"
            sx={{ fontWeight: 700, color: "#FFFFFF", fontSize: 16, letterSpacing: "-0.01em" }}
          >
            AGB Tasks
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* Поле поиска */}
        <OutlinedInput
          size="small"
          placeholder={t.search}
          data-testid="header-search"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          endAdornment={
            <InputAdornment position="end">
              <SearchIcon sx={{ color: "rgba(255,255,255,0.5)" }} fontSize="small" />
            </InputAdornment>
          }
          sx={{
            width: 280,
            bgcolor: "rgba(255,255,255,0.1)",
            borderRadius: 1,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "transparent" },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.3)" },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(255,255,255,0.5)" },
            "& input": { color: "#fff", fontSize: 14, py: 0.75 },
            "& input::placeholder": { color: "rgba(255,255,255,0.5)", opacity: 1 },
          }}
        />

        {/* Справка */}
        <Button
          type="button"
          id="localization-select-trigger"
          onClick={() => {
            const next = language === "ru" ? "en" : "ru";
            onLanguageChange?.(next);
            setStoredLanguage(next);
          }}
          title={languageTitle}
          sx={{
            textTransform: "none",
            minWidth: "auto",
            px: 1.25,
            py: 0.5,
            borderRadius: 1.5,
            color: "rgba(255,255,255,0.8)",
            fontSize: 13,
            fontWeight: 500,
            "&:hover": { bgcolor: "rgba(255,255,255,0.12)", color: "#fff" },
          }}
        >
          {languageLabel}
        </Button>

        <IconButton
          type="button"
          onClick={() => {
            const nextTheme: ColorTheme = isDarkTheme ? "light" : "dark";
            onColorThemeChange?.(nextTheme);
            setStoredTheme(nextTheme);
          }}
          title={themeTitle}
          aria-label={themeTitle}
          sx={{
            borderRadius: 1.5,
            color: "rgba(255,255,255,0.8)",
            "&:hover": { bgcolor: "rgba(255,255,255,0.12)", color: "#fff" },
          }}
        >
          {isDarkTheme ? <DarkModeOutlinedIcon fontSize="small" /> : <LightModeOutlinedIcon fontSize="small" />}
        </IconButton>

        <IconButton size="small" aria-label="Справка" sx={{ color: "rgba(255,255,255,0.8)" }}>
          <HelpOutlineIcon fontSize="small" />
        </IconButton>

        {/* Уведомления с бейджем */}
        <IconButton
          size="small"
          aria-label="Уведомления"
          data-testid="notification-control"
          onClick={(e) => {
            setNotificationAnchorEl(e.currentTarget);
            onOpenNotifications?.();
          }}
          sx={{ color: "rgba(255,255,255,0.8)" }}
        >
          <Badge badgeContent={notificationCount > 0 ? notificationCount : undefined} color="error">
            <NotificationsIcon fontSize="small" />
          </Badge>
        </IconButton>

        {/* Профиль */}
        <IconButton
          size="small"
          aria-label="Профиль"
          onClick={(e) => setProfileAnchorEl(e.currentTarget)}
          sx={{ color: "rgba(255,255,255,0.8)" }}
        >
          <AccountCircleIcon />
        </IconButton>
      </Box>

      {/* ===== ВТОРАЯ СВЕТЛО-СЕРАЯ ПОЛОСА ===== */}
      <Box
        component="nav"
        className="nonprintable"
        sx={{
          height: 48,
          bgcolor: LIGHT_BG,
          borderBottom: `1px solid ${BORDER_GRAY}`,
          display: "flex",
          alignItems: "center",
          px: 0,
          flexShrink: 0,
        }}
      >
        {/* Кнопка меню */}
        <IconButton
          size="large"
          onClick={() => setLeftDrawerOpen(true)}
          edge="start"
          aria-label="Открыть боковое меню"
          data-testid="menu-button"
          sx={{ width: 48, height: 48, color: TEXT_GRAY }}
        >
          <MenuIcon />
        </IconButton>

        {/* Название пространства */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            cursor: "pointer",
            "&:hover": { bgcolor: "var(--k-hover, #F5F5F5)" },
          }}
          onClick={() => setLeftDrawerOpen(true)}
        >
          <Box
            sx={{
              width: 24,
              height: 24,
              bgcolor: ACCENT_PURPLE,
              borderRadius: 0.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {activeSpaceName.charAt(0).toUpperCase()}
          </Box>
          <Typography
            variant="subtitle1"
            noWrap
            role="button"
            tabIndex={0}
            aria-label="Переименовать пространство"
            sx={{ fontWeight: 500, color: TEXT_DARK, fontSize: 14, maxWidth: 200 }}
          >
            {activeSpaceName}
          </Typography>
          <KeyboardArrowDownIcon sx={{ color: TEXT_GRAY, fontSize: 18 }} />
        </Box>

        <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: BORDER_GRAY }} />

        {/* Выпадающий селектор вида */}
        <Button
          size="small"
          onClick={(e) => setViewModeAnchor(e.currentTarget)}
          endIcon={<KeyboardArrowDownIcon />}
          startIcon={currentViewMode.icon}
          sx={{
            textTransform: "none",
            fontWeight: 500,
            fontSize: 13,
            color: TEXT_DARK,
            bgcolor: "var(--k-hover, #F5F5F5)",
            borderRadius: 1,
            px: 1.5,
            "&:hover": { bgcolor: "var(--k-active, #E8E8E8)" },
          }}
        >
          {t.viewModes[currentViewMode.id]}
        </Button>

        <Menu
          anchorEl={notificationAnchorEl}
          open={Boolean(notificationAnchorEl)}
          onClose={() => setNotificationAnchorEl(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          PaperProps={{
            sx: {
              minWidth: 320,
              maxWidth: 420,
              bgcolor: "var(--k-surface-bg, #FFFFFF)",
              color: "var(--k-text, #202124)",
              border: "1px solid var(--k-border, #E0E0E0)",
              boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
              borderRadius: 2,
            },
          }}
        >
          {!notifications.length ? (
            <MenuItem disabled sx={{ py: 1.5, opacity: 0.8 }}>
              {language === "en" ? "No notifications" : "Нет уведомлений"}
            </MenuItem>
          ) : (
            notifications.map((item) => (
              <MenuItem
                key={item.id}
                onClick={() => onReadNotification?.(item.id)}
                sx={{
                  py: 1.25,
                  borderLeft: item.is_read ? "2px solid transparent" : "2px solid #9C27B0",
                  alignItems: "flex-start",
                  whiteSpace: "normal",
                }}
              >
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 600, color: "var(--k-text)" }}>{item.title}</Typography>
                  <Typography sx={{ fontSize: 12, color: "var(--k-text-muted)", mt: 0.25 }}>{item.body}</Typography>
                  <Typography sx={{ fontSize: 11, color: "var(--k-text-muted)", mt: 0.5 }}>
                    {new Date(item.created_at).toLocaleString(language === "en" ? "en-US" : "ru-RU")}
                  </Typography>
                </Box>
              </MenuItem>
            ))
          )}
          {notifications.some((item) => !item.is_read) && (
            <>
              <Divider />
              <MenuItem
                onClick={() => onReadAllNotifications?.()}
                sx={{ py: 1.25, justifyContent: "center", fontSize: 13, color: "#9C27B0", fontWeight: 600 }}
              >
                {language === "en" ? "Mark all as read" : "Отметить все прочитанными"}
              </MenuItem>
            </>
          )}
        </Menu>

        <Menu
          anchorEl={viewModeAnchor}
          open={Boolean(viewModeAnchor)}
          onClose={() => setViewModeAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
          PaperProps={{
            sx: {
              bgcolor: "var(--k-surface-bg, #FFFFFF)",
              color: "var(--k-text, #202124)",
              border: "1px solid var(--k-border, #E0E0E0)",
            },
          }}
        >
          {VIEW_MODES.map((mode) => (
            <MenuItem
              key={mode.id}
              onClick={() => {
                onViewModeChange?.(mode.id);
                setViewModeAnchor(null);
              }}
              selected={viewMode === mode.id}
              sx={{ fontSize: 13, gap: 1 }}
            >
              {mode.icon}
              {t.viewModes[mode.id]}
            </MenuItem>
          ))}
        </Menu>

        <Divider orientation="vertical" flexItem sx={{ mx: 1, borderColor: BORDER_GRAY }} />

        {/* Кнопки навигации: Списки, Отчёты, Архив */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }} data-testid="header-buttons">
          {[
            { id: "lists", label: t.lists },
            { id: "reports", label: t.reports },
            { id: "archive", label: t.archive },
          ].map((btn) => (
            <Button
              key={btn.id}
              size="small"
              onClick={() => onTabChange?.(btn.id)}
              data-testid={`header-btn-${btn.id}`}
              sx={{
                textTransform: "none",
                fontWeight: 500,
                fontSize: 13,
                color: activeTabId === btn.id ? TEXT_DARK : TEXT_GRAY,
                bgcolor: activeTabId === btn.id ? "var(--k-active, #E8E8E8)" : "transparent",
                borderRadius: 1,
                px: 1.5,
                minWidth: "auto",
                "&:hover": { bgcolor: "var(--k-hover, #F5F5F5)" },
              }}
            >
              {btn.label}
            </Button>
          ))}
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* Кнопка Фильтры */}
        <Button
          size="small"
          startIcon={<FilterListIcon fontSize="small" />}
          onClick={() => onTabChange?.("filters")}
          data-testid="header-btn-filters"
          sx={{
            textTransform: "none",
            fontWeight: 500,
            fontSize: 13,
            color: activeTabId === "filters" ? TEXT_DARK : TEXT_GRAY,
            bgcolor: activeTabId === "filters" ? "var(--k-active, #E8E8E8)" : "transparent",
            borderRadius: 1,
            px: 1.5,
            mr: 1,
            "&:hover": { bgcolor: "var(--k-hover, #F5F5F5)" },
          }}
        >
          {t.filters}
        </Button>

        {/* Кнопка + (создать) с выпадающим меню */}
        <IconButton
          size="small"
          aria-label="Создать"
          data-testid="add-button-space-entity"
          disabled={!canCreateEntities}
          onClick={(e) => setAddMenuAnchor(e.currentTarget)}
          sx={{
            width: 32,
            height: 32,
            bgcolor: ACCENT_PURPLE,
            color: "#fff",
            borderRadius: 1,
            mr: 1,
            "&:hover": { bgcolor: "#7B1FA2" },
            "&.Mui-disabled": { bgcolor: "var(--k-border)", color: "var(--k-text-muted)" },
          }}
        >
          <AddIcon fontSize="small" />
        </IconButton>

        {/* Меню добавления */}
        <Menu
          anchorEl={addMenuAnchor}
          open={Boolean(addMenuAnchor)}
          onClose={() => setAddMenuAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          PaperProps={{
            sx: {
              minWidth: 260,
              borderRadius: 2,
              bgcolor: "var(--k-surface-bg, #FFFFFF)",
              color: "var(--k-text, #202124)",
              border: "1px solid var(--k-border, #E0E0E0)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            },
          }}
        >
          <MenuItem
            onClick={() => {
              setAddMenuAnchor(null);
              onAddAction?.("folder");
            }}
            sx={{ py: 1.5, gap: 1.5 }}
          >
            <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            <Typography sx={{ fontSize: 14 }}>{t.folder}</Typography>
          </MenuItem>
          {canCreateSpace && (
            <MenuItem
              onClick={() => {
                setAddMenuAnchor(null);
                onAddAction?.("space");
              }}
              sx={{ py: 1.5, gap: 1.5 }}
            >
              <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
              <Typography sx={{ fontSize: 14 }}>{t.space}</Typography>
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              setAddMenuAnchor(null);
              onAddAction?.("storymap");
            }}
            sx={{ py: 1.5, gap: 1.5 }}
          >
            <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            <Typography sx={{ fontSize: 14 }}>{t.storyMap}</Typography>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setAddMenuAnchor(null);
              onAddAction?.("document");
            }}
            sx={{ py: 1.5, gap: 1.5 }}
          >
            <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            <Typography sx={{ fontSize: 14 }}>{t.document}</Typography>
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => {
              setAddMenuAnchor(null);
              onCreateClick?.();
            }}
            sx={{ py: 1.5, gap: 1.5 }}
          >
            <CheckBoxOutlineBlankIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            <Typography sx={{ fontSize: 14 }}>{t.card}</Typography>
          </MenuItem>
          <MenuItem
            onClick={() => {
              setAddMenuAnchor(null);
              onCreateBoardClick?.();
              onAddAction?.("board");
            }}
            sx={{ py: 1.5, gap: 1.5 }}
          >
            <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            <Typography sx={{ fontSize: 14 }}>{t.board}</Typography>
          </MenuItem>
        </Menu>
      </Box>

      {/* ===== ОСНОВНАЯ ОБЛАСТЬ: левый drawer/sidebar + центр + правый rail ===== */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Закреплённый sidebar или выдвижной drawer */}
        {sidebarPinned ? (
          <Box
            sx={{
              width: LEFT_DRAWER_WIDTH,
              flexShrink: 0,
              borderRight: `1px solid ${BORDER_GRAY}`,
              bgcolor: WHITE_BG,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <LeftSidebar
              spaces={spaces}
              projects={projects}
              boards={boards}
              language={language}
              activeSpaceId={activeSpaceId}
              activeProjectId={activeProjectId}
              activeBoardId={activeBoardId}
              onSelectSpace={onSelectSpace}
              onSelectProject={onSelectProject}
              onSelectBoard={onSelectBoard}
              onCreateSpace={() => onCreateSpaceClick?.()}
              onRenameSpace={onRenameSpace}
              onDeleteSpace={onDeleteSpace}
              onLogout={onLogout}
              isPinned={sidebarPinned}
              onTogglePin={handleToggleSidebarPin}
              onAddAction={onAddAction}
              onOpenAdministration={onOpenAdministration}
              onOpenTemplates={onOpenTemplates}
              canOpenAdministration={canOpenAdministration}
              canCreateEntities={canCreateEntities}
              canCreateSpace={canCreateSpace}
              canManageSpaces={canManageSpaces}
            />
          </Box>
        ) : (
          <Drawer
            anchor="left"
            open={leftDrawerOpen}
            onClose={handleCloseSidebar}
            ModalProps={{ keepMounted: true }}
            PaperProps={{
              "data-testid": "left-navigation-drawer",
              sx: {
                width: LEFT_DRAWER_WIDTH,
                boxSizing: "border-box",
                bgcolor: "var(--k-surface-bg, #FFFFFF)",
                borderRight: `1px solid ${BORDER_GRAY}`,
              },
            }}
          >
            <LeftSidebar
              spaces={spaces}
              projects={projects}
              boards={boards}
              language={language}
              activeSpaceId={activeSpaceId}
              activeProjectId={activeProjectId}
              activeBoardId={activeBoardId}
              onSelectSpace={(spaceId) => {
                onSelectSpace(spaceId);
              }}
              onSelectBoard={(boardId) => {
                onSelectBoard(boardId);
                handleCloseSidebar();
              }}
              onSelectProject={onSelectProject}
              onCreateSpace={() => {
                onCreateSpaceClick?.();
                handleCloseSidebar();
              }}
              onRenameSpace={onRenameSpace}
              onDeleteSpace={onDeleteSpace}
              onLogout={() => {
                handleCloseSidebar();
                onLogout();
              }}
              onClose={handleCloseSidebar}
              isPinned={sidebarPinned}
              onTogglePin={handleToggleSidebarPin}
              onAddAction={onAddAction}
              onOpenAdministration={onOpenAdministration}
              onOpenTemplates={onOpenTemplates}
              canOpenAdministration={canOpenAdministration}
              canCreateEntities={canCreateEntities}
              canCreateSpace={canCreateSpace}
              canManageSpaces={canManageSpaces}
            />
          </Drawer>
        )}

        {/* Центральный контент */}
        <Box
          component="main"
          id="app-container"
          sx={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            bgcolor: LIGHT_BG,
          }}
        >
          {children}
        </Box>

        {/* Правый тонкий rail */}
        <RightRail
          activeTabId={activeTabId}
          onTabChange={onTabChange}
          unreadNotificationsCount={notificationCount}
          language={language}
        />
      </Box>

      {/* Меню профиля */}
      <ProfileMenu
        anchorEl={profileAnchorEl}
        open={Boolean(profileAnchorEl)}
        onClose={() => setProfileAnchorEl(null)}
        userName={userName}
        userEmail={userEmail}
        userHandle={`@${userEmail.split("@")[0]}`}
        avatarUrl={avatarUrl}
        colorTheme={colorTheme}
        onThemeChange={(theme) => {
          onColorThemeChange?.(theme);
          setStoredTheme(theme);
        }}
        language={language}
        onLanguageChange={(nextLanguage) => {
          onLanguageChange?.(nextLanguage);
          setStoredLanguage(nextLanguage);
        }}
        onSettingsClick={() => {
          if (onProfileSettingsClick) onProfileSettingsClick();
          else onTabChange?.("settings");
        }}
        onLogout={onLogout}
        appVersion="1.0.0"
      />
    </Box>
  );
}
