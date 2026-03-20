"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputBase,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
  Tooltip,
  useTheme,
} from "@mui/material";
import StarOutlineIcon from "@mui/icons-material/StarOutline";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import AddIcon from "@mui/icons-material/Add";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import GridViewIcon from "@mui/icons-material/GridView";
import MapOutlinedIcon from "@mui/icons-material/MapOutlined";
import DashboardOutlinedIcon from "@mui/icons-material/DashboardOutlined";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";

const TEXT_GRAY = "var(--k-text-muted)";
const TEXT_DARK = "var(--k-text)";
const BORDER_GRAY = "var(--k-border)";
const ACCENT_PURPLE = "#9C27B0";
const HOVER_BG = "rgba(127,127,127,0.12)";
const SELECTED_BG = "rgba(127,127,127,0.22)";

export type SidebarSpace = { id: string; name: string };
export type SidebarBoard = { id: string; name: string; space_id?: string; project_id?: string };
export type SidebarProject = { id: string; name: string; space_id?: string };

type AddMenuAction =
  | "folder"
  | "space"
  | "storymap"
  | "document"
  | "board";

type Props = {
  spaces: SidebarSpace[];
  projects?: SidebarProject[];
  boards: SidebarBoard[];
  language?: "ru" | "en";
  activeSpaceId: string | null;
  activeProjectId?: string | null;
  activeBoardId: string | null;
  onSelectSpace: (spaceId: string) => void;
  onSelectProject?: (projectId: string) => void;
  onSelectBoard: (boardId: string) => void;
  onCreateSpace: () => void;
  onRenameSpace?: (spaceId: string, newName: string) => void | Promise<boolean>;
  /** false = ошибка (диалог не закрываем). void / true = успех. */
  onDeleteSpace?: (spaceId: string) => boolean | Promise<boolean> | void | Promise<void>;
  onLogout: () => void;
  onClose?: () => void;
  onAddAction?: (action: AddMenuAction) => void;
  onOpenAdministration?: () => void;
  onOpenTemplates?: () => void;
  canOpenAdministration?: boolean;
  canCreateEntities?: boolean;
  canCreateSpace?: boolean;
  /** lead/admin: переименование и удаление пространств */
  canManageSpaces?: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
};

export default function LeftSidebar({
  spaces,
  projects = [],
  boards,
  language = "ru",
  activeSpaceId,
  activeProjectId,
  activeBoardId,
  onSelectSpace,
  onSelectProject,
  onSelectBoard,
  onCreateSpace,
  onRenameSpace,
  onDeleteSpace,
  onLogout,
  onClose,
  onAddAction,
  onOpenAdministration,
  onOpenTemplates,
  canOpenAdministration = false,
  canCreateEntities = true,
  canCreateSpace = false,
  canManageSpaces = false,
  isPinned = false,
  onTogglePin,
}: Props) {
  const theme = useTheme();
  const [menuExpanded, setMenuExpanded] = useState(true);
  const [personalExpanded, setPersonalExpanded] = useState(true);
  const [spacesExpanded, setSpacesExpanded] = useState(true);

  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null);
  const [spaceMenuAnchor, setSpaceMenuAnchor] = useState<null | HTMLElement>(null);
  const [spaceMenuForId, setSpaceMenuForId] = useState<string | null>(null);
  const [deleteDialogSpace, setDeleteDialogSpace] = useState<{ id: string; name: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const t =
    language === "en"
      ? {
          menu: "Menu",
          pin: "Pin menu",
          unpin: "Unpin menu",
          personal: "Personal",
          favorites: "Favorites(0)",
          firstDocument: "First document",
          boards: "Boards",
          folders: "Folders",
          add: "Add",
          folder: "Folder",
          space: "Space",
          storyMap: "Story map",
          document: "Document",
          forSpace: "For space",
          board: "Board",
          templates: "Space templates",
          administration: "Administration",
          logout: "Logout",
          renameHint: "Double-click or menu to rename",
          spacesSection: "Spaces",
          renameSpace: "Rename",
          deleteSpace: "Delete space",
          deleteSpaceTitle: "Delete space?",
          deleteSpaceBody: "All boards, cards and data in this space will be permanently removed.",
          cancel: "Cancel",
          confirmDelete: "Delete",
          spaceActions: "Space actions",
        }
      : {
          menu: "Меню",
          pin: "Закрепить меню",
          unpin: "Открепить меню",
          personal: "Личное",
          favorites: "Избранное(0)",
          firstDocument: "Первый документ",
          boards: "Доски",
          folders: "Папки",
          add: "Добавить",
          folder: "Папку",
          space: "Пространство",
          storyMap: "Карта историй",
          document: "Документ",
          forSpace: "На пространство",
          board: "Доску",
          templates: "Шаблоны пространств",
          administration: "Администрирование",
          logout: "Выйти",
          renameHint: "Двойной клик или меню — переименовать",
          spacesSection: "Пространства",
          renameSpace: "Переименовать",
          deleteSpace: "Удалить пространство",
          deleteSpaceTitle: "Удалить пространство?",
          deleteSpaceBody:
            "Все доски, карточки и данные в этом пространстве будут безвозвратно удалены.",
          cancel: "Отмена",
          confirmDelete: "Удалить",
          spaceActions: "Действия с пространством",
        };

  const activeBoards = boards.filter((b) => !b.space_id || b.space_id === activeSpaceId);
  const activeProjects = projects.filter((p) => !p.space_id || p.space_id === activeSpaceId);
  const activeBoardsUngrouped = activeBoards.filter((b) => !b.project_id || !activeProjects.some((p) => p.id === b.project_id));

  const startRenaming = (spaceId: string, currentName: string) => {
    setEditingSpaceId(spaceId);
    setEditingName(currentName);
  };

  const saveRename = async () => {
    if (!editingSpaceId || !editingName.trim()) {
      setEditingSpaceId(null);
      setEditingName("");
      return;
    }
    if (onRenameSpace) {
      const ok = await Promise.resolve(onRenameSpace(editingSpaceId, editingName.trim()));
      if (ok === false) return;
    }
    setEditingSpaceId(null);
    setEditingName("");
  };

  const closeSpaceMenu = () => {
    setSpaceMenuAnchor(null);
    setSpaceMenuForId(null);
  };

  const confirmDeleteSpace = async () => {
    if (!deleteDialogSpace || !onDeleteSpace) return;
    setDeleteBusy(true);
    try {
      const result = await Promise.resolve(onDeleteSpace(deleteDialogSpace.id));
      if (result !== false) {
        setDeleteDialogSpace(null);
      }
    } catch {
      /* не бросаем наружу — избегаем сбоев портала Next.js / необработанного rejection */
    } finally {
      setDeleteBusy(false);
    }
  };

  const cancelRename = () => {
    setEditingSpaceId(null);
    setEditingName("");
  };

  const handleAddMenuClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setAddMenuAnchor(e.currentTarget);
  };

  const handleAddMenuClose = () => {
    setAddMenuAnchor(null);
  };

  const handleAddAction = (action: AddMenuAction) => {
    handleAddMenuClose();
    if (action === "space") {
      onCreateSpace();
    } else {
      onAddAction?.(action);
    }
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "var(--k-surface-bg)",
      }}
    >
      {/* ===== ЗАГОЛОВОК МЕНЮ С КНОПКОЙ ЗАКРЕПЛЕНИЯ ===== */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: `1px solid ${BORDER_GRAY}`,
        }}
      >
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 600,
            color: TEXT_DARK,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {t.menu}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Tooltip title={isPinned ? t.unpin : t.pin}>
            <IconButton
              size="small"
              onClick={onTogglePin}
              sx={{
                p: 0.5,
                color: isPinned ? ACCENT_PURPLE : TEXT_GRAY,
                "&:hover": { bgcolor: HOVER_BG },
              }}
            >
              {isPinned ? (
                <PushPinIcon sx={{ fontSize: 18 }} />
              ) : (
                <PushPinOutlinedIcon sx={{ fontSize: 18 }} />
              )}
            </IconButton>
          </Tooltip>
          {!isPinned && (
            <IconButton
              size="small"
              onClick={onClose}
              sx={{ p: 0.5, color: TEXT_GRAY, "&:hover": { bgcolor: HOVER_BG } }}
            >
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* ===== ЛИЧНОЕ ===== */}
      <Box sx={{ px: 1, pt: 1 }}>
        <ListItemButton
          onClick={() => setPersonalExpanded(!personalExpanded)}
          sx={{ borderRadius: 1, py: 0.5, "&:hover": { bgcolor: HOVER_BG } }}
        >
          <ListItemText
              primary={t.personal}
            primaryTypographyProps={{
              fontSize: 13,
              fontWeight: 600,
              color: TEXT_DARK,
            }}
          />
          {personalExpanded ? (
            <ExpandLessIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
          ) : (
            <ExpandMoreIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
          )}
        </ListItemButton>
      </Box>

      <Collapse in={personalExpanded}>
        <List dense disablePadding sx={{ px: 1 }}>
          <ListItemButton sx={{ borderRadius: 1, py: 0.5, "&:hover": { bgcolor: HOVER_BG } }}>
            <ListItemIcon sx={{ minWidth: 32 }}>
              <StarOutlineIcon sx={{ color: TEXT_GRAY, fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText
              primary={t.favorites}
              primaryTypographyProps={{ fontSize: 13, color: TEXT_DARK }}
            />
          </ListItemButton>
          <ListItemButton sx={{ borderRadius: 1, py: 0.5, "&:hover": { bgcolor: HOVER_BG } }}>
            <ListItemIcon sx={{ minWidth: 32 }}>
              <DescriptionOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText
              primary={t.firstDocument}
              primaryTypographyProps={{ fontSize: 13, color: TEXT_DARK }}
            />
          </ListItemButton>
        </List>
      </Collapse>

      <Divider sx={{ my: 0.5, borderColor: BORDER_GRAY }} />

      {/* ===== ПРОСТРАНСТВА ===== */}
      <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        <Box sx={{ px: 1 }}>
          <ListItemButton
            onClick={() => setSpacesExpanded(!spacesExpanded)}
            sx={{ borderRadius: 1, py: 0.5, "&:hover": { bgcolor: HOVER_BG } }}
          >
            <ListItemText
              primary={t.spacesSection}
              primaryTypographyProps={{
                fontSize: 11,
                fontWeight: 700,
                color: TEXT_GRAY,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            />
            {spacesExpanded ? (
              <ExpandLessIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            ) : (
              <ExpandMoreIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            )}
          </ListItemButton>
        </Box>

        <Collapse in={spacesExpanded}>
          <List dense disablePadding sx={{ px: 1 }}>
            {spaces.map((space) => (
              <Box key={space.id}>
                {editingSpaceId === space.id ? (
                  <Box sx={{ display: "flex", alignItems: "center", px: 1, py: 0.5, gap: 0.5 }}>
                    <Box
                      sx={{
                        width: 20,
                        height: 20,
                        bgcolor: ACCENT_PURPLE,
                        borderRadius: 0.5,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {space.name.charAt(0).toUpperCase()}
                    </Box>
                    <InputBase
                      autoFocus
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename();
                        if (e.key === "Escape") cancelRename();
                      }}
                      sx={{
                        flex: 1,
                        fontSize: 13,
                        px: 1,
                        py: 0.25,
                        bgcolor: "#F5F5F5",
                        borderRadius: 0.5,
                        "& input": { p: 0 },
                      }}
                    />
                    <IconButton size="small" onClick={saveRename} sx={{ p: 0.25 }}>
                      <CheckIcon sx={{ fontSize: 16, color: "#4CAF50" }} />
                    </IconButton>
                    <IconButton size="small" onClick={cancelRename} sx={{ p: 0.25 }}>
                      <CloseIcon sx={{ fontSize: 16, color: TEXT_GRAY }} />
                    </IconButton>
                  </Box>
                ) : (
                  <ListItem
                    disablePadding
                    secondaryAction={
                      canManageSpaces && (onRenameSpace || onDeleteSpace) ? (
                        <Tooltip title={t.spaceActions}>
                          <IconButton
                            edge="end"
                            size="small"
                            aria-label={t.spaceActions}
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              setSpaceMenuAnchor(e.currentTarget);
                              setSpaceMenuForId(space.id);
                            }}
                            sx={{ mr: 0.5 }}
                          >
                            <MoreVertIcon sx={{ fontSize: 18, color: TEXT_GRAY }} />
                          </IconButton>
                        </Tooltip>
                      ) : undefined
                    }
                    sx={{
                      "& .MuiListItemSecondaryAction-root": { right: 4 },
                      pr: canManageSpaces && (onRenameSpace || onDeleteSpace) ? 4 : 0,
                    }}
                  >
                    <ListItemButton
                      selected={space.id === activeSpaceId}
                      onClick={() => onSelectSpace(space.id)}
                      sx={{
                        borderRadius: 1,
                        py: 0.5,
                        pr: 1,
                        "&.Mui-selected": { bgcolor: SELECTED_BG },
                        "&:hover": { bgcolor: HOVER_BG },
                      }}
                    >
                      <Box
                        sx={{
                          width: 20,
                          height: 20,
                          bgcolor: ACCENT_PURPLE,
                          borderRadius: 0.5,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#fff",
                          fontSize: 10,
                          fontWeight: 700,
                          mr: 1,
                          flexShrink: 0,
                        }}
                      >
                        {space.name.charAt(0).toUpperCase()}
                      </Box>
                      <ListItemText
                        primary={space.name}
                        primaryTypographyProps={{
                          fontSize: 13,
                          color: TEXT_DARK,
                          noWrap: true,
                          sx: { cursor: canManageSpaces && onRenameSpace ? "pointer" : "default" },
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (!canManageSpaces || !onRenameSpace) return;
                          startRenaming(space.id, space.name);
                        }}
                        title={canManageSpaces && onRenameSpace ? t.renameHint : undefined}
                      />
                      {canManageSpaces && onRenameSpace ? (
                        <Tooltip title={t.renameSpace}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              startRenaming(space.id, space.name);
                            }}
                            sx={{ p: 0.25, ml: 0.5 }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 14, color: TEXT_GRAY }} />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                    </ListItemButton>
                  </ListItem>
                )}
              </Box>
            ))}
          </List>

          {/* Доски текущего пространства */}
          {activeProjects.length > 0 && (
            <Box sx={{ px: 2, py: 0.5 }}>
              <Typography
                sx={{ fontSize: 11, fontWeight: 700, color: TEXT_GRAY, textTransform: "uppercase", mb: 0.5 }}
              >
                {t.folders}
              </Typography>
              <List dense disablePadding>
                {activeProjects.map((project) => {
                  const projectBoards = activeBoards.filter((b) => b.project_id === project.id);
                  return (
                    <Box key={project.id}>
                      <ListItemButton
                        selected={project.id === activeProjectId}
                        onClick={() => onSelectProject?.(project.id)}
                        sx={{
                          borderRadius: 1,
                          py: 0.5,
                          "&.Mui-selected": { bgcolor: SELECTED_BG },
                          "&:hover": { bgcolor: HOVER_BG },
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 28 }}>
                          <FolderOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 16 }} />
                        </ListItemIcon>
                        <ListItemText
                          primary={project.name}
                          primaryTypographyProps={{ fontSize: 13, color: TEXT_DARK }}
                        />
                      </ListItemButton>
                      {projectBoards.map((board) => (
                        <ListItemButton
                          key={board.id}
                          selected={board.id === activeBoardId}
                          onClick={() => {
                            onSelectBoard(board.id);
                            if (!isPinned) onClose?.();
                          }}
                          sx={{
                            ml: 2.5,
                            borderRadius: 1,
                            py: 0.35,
                            "&.Mui-selected": { bgcolor: SELECTED_BG },
                            "&:hover": { bgcolor: HOVER_BG },
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 24 }}>
                            <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 14 }} />
                          </ListItemIcon>
                          <ListItemText
                            primary={board.name}
                            primaryTypographyProps={{ fontSize: 12, color: TEXT_DARK }}
                          />
                        </ListItemButton>
                      ))}
                    </Box>
                  );
                })}
              </List>
            </Box>
          )}

          {activeBoardsUngrouped.length > 0 && (
            <Box sx={{ px: 2, py: 0.5 }}>
              <Typography
                sx={{ fontSize: 11, fontWeight: 700, color: TEXT_GRAY, textTransform: "uppercase", mb: 0.5 }}
              >
                {t.boards}
              </Typography>
              <List dense disablePadding>
                {activeBoardsUngrouped.map((board) => (
                  <ListItemButton
                    key={board.id}
                    selected={board.id === activeBoardId}
                    onClick={() => {
                      onSelectBoard(board.id);
                      if (!isPinned) onClose?.();
                    }}
                    sx={{
                      borderRadius: 1,
                      py: 0.5,
                      "&.Mui-selected": { bgcolor: SELECTED_BG },
                      "&:hover": { bgcolor: HOVER_BG },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 28 }}>
                      <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 16 }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={board.name}
                      primaryTypographyProps={{ fontSize: 13, color: TEXT_DARK }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          )}
        </Collapse>
      </Box>

      <Divider sx={{ borderColor: BORDER_GRAY }} />

      {canCreateEntities && (
        <Box sx={{ p: 1 }}>
          <ListItemButton
            onClick={handleAddMenuClick}
            data-testid="add-button-space-entity"
            sx={{
              borderRadius: 1,
              py: 1,
              bgcolor: "var(--k-hover, #F5F5F5)",
              "&:hover": { bgcolor: "var(--k-active, #E8E8E8)" },
            }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <AddIcon sx={{ color: ACCENT_PURPLE, fontSize: 20 }} />
            </ListItemIcon>
            <ListItemText
              primary={t.add}
              primaryTypographyProps={{ fontSize: 13, fontWeight: 500, color: TEXT_DARK }}
            />
          </ListItemButton>
        </Box>
      )}

      {/* Меню добавления */}
      <Menu
        anchorEl={addMenuAnchor}
        open={canCreateEntities && Boolean(addMenuAnchor)}
        onClose={handleAddMenuClose}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        PaperProps={{
          sx: {
            minWidth: 240,
            bgcolor: "var(--k-surface-bg, #FFFFFF)",
            color: "var(--k-text, #202124)",
            border: "1px solid var(--k-border, #E0E0E0)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            borderRadius: 2,
          },
        }}
      >
        <Typography sx={{ px: 2, py: 1, fontSize: 12, color: TEXT_GRAY, fontWeight: 500 }}>
          {t.add}
        </Typography>
        <MenuItem onClick={() => handleAddAction("folder")} sx={{ py: 1, gap: 1.5 }}>
          <FolderOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
          <Typography sx={{ fontSize: 14 }}>{t.folder}</Typography>
        </MenuItem>
        {canCreateSpace && (
          <MenuItem onClick={() => handleAddAction("space")} sx={{ py: 1, gap: 1.5 }}>
            <GridViewIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
            <Typography sx={{ fontSize: 14 }}>{t.space}</Typography>
          </MenuItem>
        )}
        <MenuItem onClick={() => handleAddAction("storymap")} sx={{ py: 1, gap: 1.5 }}>
          <MapOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
          <Typography sx={{ fontSize: 14 }}>{t.storyMap}</Typography>
        </MenuItem>
        <MenuItem onClick={() => handleAddAction("document")} sx={{ py: 1, gap: 1.5 }}>
          <DescriptionOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
          <Typography sx={{ fontSize: 14 }}>{t.document}</Typography>
        </MenuItem>

        <Divider sx={{ my: 1 }} />

        <Typography sx={{ px: 2, py: 0.5, fontSize: 12, color: TEXT_GRAY, fontWeight: 500 }}>
          {t.forSpace}
        </Typography>
        <MenuItem onClick={() => handleAddAction("board")} sx={{ py: 1, gap: 1.5 }}>
          <DashboardOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 20 }} />
          <Typography sx={{ fontSize: 14 }}>{t.board}</Typography>
        </MenuItem>
      </Menu>

      <Menu
        anchorEl={spaceMenuAnchor}
        open={Boolean(spaceMenuAnchor) && Boolean(spaceMenuForId)}
        onClose={closeSpaceMenu}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        container={typeof document !== "undefined" ? document.body : undefined}
        slotProps={{
          root: {
            sx: { zIndex: 13500 },
          },
          paper: {
            sx: {
              minWidth: 200,
              bgcolor: "var(--k-surface-bg, #FFFFFF)",
              color: "var(--k-text, #202124)",
              border: "1px solid var(--k-border, #E0E0E0)",
              borderRadius: 2,
            },
          },
        }}
      >
        {onRenameSpace ? (
          <MenuItem
            onClick={() => {
              const sid = spaceMenuForId;
              const sp = sid ? spaces.find((s) => s.id === sid) : undefined;
              closeSpaceMenu();
              if (sp) startRenaming(sp.id, sp.name);
            }}
            sx={{ py: 1, gap: 1 }}
          >
            <EditOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 18 }} />
            <Typography sx={{ fontSize: 14 }}>{t.renameSpace}</Typography>
          </MenuItem>
        ) : null}
        {onDeleteSpace ? (
          <MenuItem
            onClick={() => {
              const sid = spaceMenuForId;
              const sp = sid ? spaces.find((s) => s.id === sid) : undefined;
              closeSpaceMenu();
              if (!sp) return;
              const payload = { id: sp.id, name: sp.name };
              if (!isPinned) {
                onClose?.();
                // После закрытия Drawer его backdrop исчезает — иначе конфликт слоёв с Dialog
                window.setTimeout(() => setDeleteDialogSpace(payload), 220);
              } else {
                setDeleteDialogSpace(payload);
              }
            }}
            sx={{ py: 1, gap: 1, color: "error.main" }}
          >
            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: 14 }}>{t.deleteSpace}</Typography>
          </MenuItem>
        ) : null}
      </Menu>

      <Dialog
        open={Boolean(deleteDialogSpace)}
        onClose={() => !deleteBusy && setDeleteDialogSpace(null)}
        fullWidth
        maxWidth="xs"
        container={typeof document !== "undefined" ? document.body : undefined}
        sx={{
          // Выше Drawer (1200) и стандартного modal (1300), без инверсии backdrop/paper
          zIndex: theme.zIndex.modal + 2,
        }}
        slotProps={{
          paper: {
            sx: {
              position: "relative",
              zIndex: 1,
              bgcolor: "var(--k-surface-bg, #FFFFFF)",
              color: "var(--k-text, #202124)",
              border: "1px solid var(--k-border, #E0E0E0)",
              borderRadius: 2,
            },
          },
        }}
      >
        <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>{t.deleteSpaceTitle}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: TEXT_GRAY, mb: 1 }}>
            <strong>{deleteDialogSpace?.name}</strong>
          </Typography>
          <Typography variant="body2" sx={{ color: TEXT_GRAY }}>
            {t.deleteSpaceBody}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, pb: 2 }}>
          <Button onClick={() => setDeleteDialogSpace(null)} disabled={deleteBusy} sx={{ color: TEXT_GRAY }}>
            {t.cancel}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void confirmDeleteSpace()}
            disabled={deleteBusy || !onDeleteSpace}
          >
            {deleteBusy ? "…" : t.confirmDelete}
          </Button>
        </DialogActions>
      </Dialog>

      <Divider sx={{ borderColor: BORDER_GRAY }} />

      {/* ===== ШАБЛОНЫ И АДМИНИСТРИРОВАНИЕ ===== */}
      <List dense disablePadding sx={{ px: 1, py: 1 }}>
        <ListItemButton
          onClick={onOpenTemplates}
          sx={{ borderRadius: 1, py: 0.5, "&:hover": { bgcolor: HOVER_BG } }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <DescriptionOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText
            primary={t.templates}
            primaryTypographyProps={{ fontSize: 13, color: TEXT_DARK }}
          />
        </ListItemButton>
        {canOpenAdministration && (
          <ListItemButton
            onClick={onOpenAdministration}
            sx={{ borderRadius: 1, py: 0.5, "&:hover": { bgcolor: HOVER_BG } }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <SettingsOutlinedIcon sx={{ color: TEXT_GRAY, fontSize: 18 }} />
            </ListItemIcon>
            <ListItemText
              primary={t.administration}
              primaryTypographyProps={{ fontSize: 13, color: TEXT_DARK }}
            />
          </ListItemButton>
        )}
        <ListItemButton
          onClick={onLogout}
          sx={{ borderRadius: 1, py: 0.5, "&:hover": { bgcolor: HOVER_BG } }}
        >
          <ListItemIcon sx={{ minWidth: 32 }}>
            <LogoutIcon sx={{ color: TEXT_GRAY, fontSize: 18 }} />
          </ListItemIcon>
          <ListItemText
            primary={t.logout}
            primaryTypographyProps={{ fontSize: 13, color: TEXT_DARK }}
          />
        </ListItemButton>
      </List>
    </Box>
  );
}
