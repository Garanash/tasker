"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Chip,
  Typography,
  Divider,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { getApiUrl } from "@/lib/api";

type Column = {
  id: string;
  name: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  refreshToken?: string;
  boardId: string;
  columns: Column[];
  onCreated: () => void;
  defaultColumnId?: string | null;
  /** Дорожка при создании из ячейки сетки; не отправляется, если пользователь сменил колонку в форме */
  defaultTrackId?: string | null;
  language?: "ru" | "en";
  onTokensUpdated?: (tokens: { access: string; refresh?: string }) => void;
  onAuthExpired?: () => void;
};

const DIALOG_PAPER_SX = {
  borderRadius: 3,
  bgcolor: "var(--k-surface-bg, #111111)",
  color: "var(--k-text, #E0E0E0)",
  border: "1px solid var(--k-border, #2A2A2A)",
  backgroundImage: "none",
} as const;

const FIELD_SX = {
  "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border, #2A2A2A)" },
  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(160,160,160,0.35)" },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#9C27B0" },
  "& label": { color: "var(--k-text-muted, #A0A0A0)" },
  "& label.Mui-focused": { color: "#CE93D8" },
  "& .MuiInputBase-input.Mui-disabled": { WebkitTextFillColor: "var(--k-text-muted, #A0A0A0)" },
} as const;

const SELECT_MENU_PROPS = {
  PaperProps: {
    sx: {
      bgcolor: "var(--k-surface-bg, #111111)",
      color: "var(--k-text, #E0E0E0)",
      border: "1px solid var(--k-border, #2A2A2A)",
      backgroundImage: "none",
      mt: 0.5,
    },
  },
} as const;

const SECTION_LABEL_SX = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase" as const,
  color: "var(--k-text-muted, #A0A0A0)",
  mt: 0.5,
  mb: 0.25,
};

export default function CreateTaskDialog({
  open,
  onClose,
  token,
  refreshToken,
  boardId,
  columns,
  onCreated,
  defaultColumnId,
  defaultTrackId = null,
  language = "ru",
  onTokensUpdated,
  onAuthExpired,
}: Props) {
  const theme = useTheme();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [columnId, setColumnId] = useState(defaultColumnId || columns[0]?.id || "");
  const [dueAt, setDueAt] = useState("");
  const [startAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [priority, setPriority] = useState<"" | "Терпит" | "Средний" | "Срочно">("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [checklistTitle, setChecklistTitle] = useState("");
  const [checklistMode, setChecklistMode] = useState<"checkbox" | "poll">("checkbox");
  const [checklistItemsRaw, setChecklistItemsRaw] = useState("");
  const [linksRaw, setLinksRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Снимок контекста открытия: дорожку не шлём, если колонку поменяли в диалоге */
  const [creationContext, setCreationContext] = useState<{ columnId: string | null; trackId: string | null }>({
    columnId: null,
    trackId: null,
  });

  const t =
    language === "en"
      ? {
          title: "Create task",
          main: "Basics",
          dates: "Schedule",
          extra: "Details",
          taskTitle: "Task title",
          description: "Description",
          column: "Column",
          startDate: "Start date",
          endDate: "End date",
          priority: "Priority",
          priorityUnset: "Not set",
          tag: "Tag",
          addTag: "Add tag",
          checklistTitle: "Checklist question / title",
          checklistType: "Checklist type",
          checklistCheckboxes: "Checkboxes",
          checklistPoll: "Poll options",
          checklistItems: "Items / options (one per line)",
          links: "Links (one per line)",
          cancel: "Cancel",
          create: "Create",
          enterTitle: "Enter task title",
          selectColumn: "Select a column",
          createFailed: "Task creation failed",
          errGeneric: "Error",
        }
      : {
          title: "Создать задачу",
          main: "Основное",
          dates: "Сроки",
          extra: "Дополнительно",
          taskTitle: "Название задачи",
          description: "Описание",
          column: "Колонка",
          startDate: "Дата начала",
          endDate: "Дата окончания",
          priority: "Приоритет",
          priorityUnset: "Не задан",
          tag: "Метка",
          addTag: "Добавить метку",
          checklistTitle: "Вопрос / название чек-листа",
          checklistType: "Тип чек-листа",
          checklistCheckboxes: "Чекбоксы",
          checklistPoll: "Опрос (варианты)",
          checklistItems: "Варианты / пункты (по одному в строке)",
          links: "Ссылки (по одной в строке)",
          cancel: "Отмена",
          create: "Создать",
          enterTitle: "Введите название задачи",
          selectColumn: "Выберите колонку",
          createFailed: "Ошибка создания задачи",
          errGeneric: "Ошибка",
        };

  useEffect(() => {
    if (!open) return;
    setColumnId(defaultColumnId || columns[0]?.id || "");
    setCreationContext({
      columnId: defaultColumnId ?? null,
      trackId: defaultTrackId ?? null,
    });
  }, [open, defaultColumnId, defaultTrackId, columns]);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError(t.enterTitle);
      return;
    }
    if (!columnId) {
      setError(t.selectColumn);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let effectiveAccess = token;
      const includeTrackId =
        Boolean(creationContext.trackId) &&
        Boolean(creationContext.columnId) &&
        columnId === creationContext.columnId;
      const payload = {
        title: title.trim(),
        description: description.trim(),
        column_id: columnId,
        board_id: boardId,
        due_at: dueAt || null,
        planned_start_at: startAt ? `${startAt}T00:00:00` : null,
        planned_end_at: dueAt ? `${dueAt}T23:59:59` : null,
        ...(includeTrackId && creationContext.trackId ? { track_id: creationContext.trackId } : {}),
      };
      const createCard = async (accessToken: string) =>
        fetch(getApiUrl("/api/kanban/cards"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });

      let res = await createCard(token);
      let data: any = await res.json().catch(() => ({}));
      if (!res.ok && res.status === 401 && data?.detail === "invalid_token") {
        if (!refreshToken) {
          onAuthExpired?.();
          throw new Error(language === "en" ? "Session expired. Sign in again." : "Сессия истекла. Войдите заново.");
        }
        const refreshRes = await fetch(getApiUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: refreshToken }),
        });
        const refreshData: any = await refreshRes.json().catch(() => ({}));
        if (!refreshRes.ok || !refreshData?.access) {
          onAuthExpired?.();
          throw new Error(language === "en" ? "Session expired. Sign in again." : "Сессия истекла. Войдите заново.");
        }
        onTokensUpdated?.({ access: refreshData.access, refresh: refreshData.refresh });
        effectiveAccess = refreshData.access;
        res = await createCard(refreshData.access);
        data = await res.json().catch(() => ({}));
      }
      if (!res.ok) throw new Error(data?.detail || t.createFailed);
      const createdCardId = data?.id as string | undefined;
      if (createdCardId) {
        const writeField = async (payload: { key: string; name: string; value: unknown; field_type?: string }) => {
          await fetch(getApiUrl(`/api/kanban/cards/${createdCardId}/field-values`), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${effectiveAccess}`,
            },
            body: JSON.stringify(payload),
          });
        };
        if (priority) {
          await writeField({
            key: "priority",
            name: language === "en" ? "Priority" : "Приоритет",
            value: priority,
            field_type: "text",
          });
        }
        if (tags.length) {
          await writeField({
            key: "tags",
            name: language === "en" ? "Tags" : "Теги",
            value: tags,
            field_type: "text",
          });
        }
        const listTitle = checklistTitle.trim();
        const checklistItems = checklistItemsRaw
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        if (listTitle) {
          const checklistRes = await fetch(getApiUrl(`/api/kanban/cards/${createdCardId}/checklists`), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${effectiveAccess}`,
            },
            body: JSON.stringify({ title: listTitle }),
          });
          const checklistData = await checklistRes.json().catch(() => ({}));
          if (checklistRes.ok && checklistData?.id) {
            await writeField({
              key: `checklist_mode:${checklistData.id}`,
              name: language === "en" ? "Checklist mode" : "Тип чек-листа",
              value: checklistMode,
              field_type: "text",
            });
            if (checklistItems.length) {
              for (const itemTitle of checklistItems) {
                await fetch(getApiUrl(`/api/kanban/checklists/${checklistData.id}/items`), {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${effectiveAccess}`,
                  },
                  body: JSON.stringify({ title: itemTitle }),
                });
              }
            }
          }
        }
        const links = linksRaw
          .split("\n")
          .map((x) => x.trim())
          .filter(Boolean);
        for (const link of links) {
          await fetch(getApiUrl(`/api/kanban/cards/${createdCardId}/attachments`), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${effectiveAccess}`,
            },
            body: JSON.stringify({ file_url: link }),
          });
        }
      }
      onCreated();
      setTitle("");
      setDescription("");
      setDueAt("");
      setPriority("");
      setTags([]);
      setTagInput("");
      setChecklistTitle("");
      setChecklistMode("checkbox");
      setChecklistItemsRaw("");
      setLinksRaw("");
      onClose();
    } catch (e: any) {
      setError(e?.message || t.errGeneric);
    } finally {
      setLoading(false);
    }
  };

  const inputSlotProps = {
    input: { sx: { color: "var(--k-text, #E0E0E0)" } },
  } as const;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (loading) return;
        onClose();
      }}
      maxWidth="sm"
      fullWidth
      scroll="paper"
      slotProps={{
        paper: { sx: DIALOG_PAPER_SX },
      }}
    >
      <DialogTitle
        sx={{
          fontWeight: 800,
          letterSpacing: "-0.02em",
          fontSize: "1.25rem",
          pb: 0.5,
          /* Синхронно с MuiThemeProvider: светлая тема — тёмный текст, тёмная — светлый (--k-text) */
          color: "var(--k-text)",
          ...(theme.palette.mode === "dark"
            ? { textShadow: "0 1px 2px rgba(0,0,0,0.45)" }
            : { textShadow: "none" }),
        }}
      >
        {t.title}
      </DialogTitle>
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          pt: 2,
          pb: 1,
          maxHeight: "min(70vh, 640px)",
          overflowY: "auto",
        }}
      >
        <Typography sx={SECTION_LABEL_SX}>{t.main}</Typography>
        <TextField
          autoFocus
          fullWidth
          label={t.taskTitle}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (error) setError(null);
          }}
          error={!!error}
          helperText={error}
          disabled={loading}
          slotProps={inputSlotProps}
          FormHelperTextProps={{ sx: { color: error ? "error.main" : "var(--k-text-muted)" } }}
          sx={FIELD_SX}
        />
        <TextField
          fullWidth
          label={t.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={3}
          disabled={loading}
          slotProps={inputSlotProps}
          sx={FIELD_SX}
        />
        <FormControl fullWidth sx={FIELD_SX}>
          <InputLabel id="create-task-column-label" sx={{ color: "var(--k-text-muted)" }}>
            {t.column}
          </InputLabel>
          <Select
            labelId="create-task-column-label"
            value={columnId}
            label={t.column}
            onChange={(e) => setColumnId(e.target.value)}
            disabled={loading}
            MenuProps={SELECT_MENU_PROPS}
            sx={{
              color: "var(--k-text)",
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
              "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(160,160,160,0.35)" },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#9C27B0" },
            }}
          >
            {columns.map((col) => (
              <MenuItem key={col.id} value={col.id} sx={{ "&:hover": { bgcolor: "rgba(138,43,226,0.12)" } }}>
                {col.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Divider sx={{ borderColor: "var(--k-border)", my: 0.5 }} />
        <Typography sx={SECTION_LABEL_SX}>{t.dates}</Typography>
        <TextField
          fullWidth
          label={t.startDate}
          type="date"
          value={startAt}
          InputLabelProps={{ shrink: true }}
          disabled
          slotProps={inputSlotProps}
          sx={FIELD_SX}
        />
        <TextField
          fullWidth
          label={t.endDate}
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          disabled={loading}
          slotProps={inputSlotProps}
          sx={FIELD_SX}
        />

        <Divider sx={{ borderColor: "var(--k-border)", my: 0.5 }} />
        <Typography sx={SECTION_LABEL_SX}>{t.extra}</Typography>
        <FormControl fullWidth sx={FIELD_SX}>
          <InputLabel id="create-task-priority-label" sx={{ color: "var(--k-text-muted)" }}>
            {t.priority}
          </InputLabel>
          <Select
            labelId="create-task-priority-label"
            value={priority}
            label={t.priority}
            onChange={(e) => setPriority((e.target.value as "" | "Терпит" | "Средний" | "Срочно") || "")}
            disabled={loading}
            MenuProps={SELECT_MENU_PROPS}
            sx={{
              color: "var(--k-text)",
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
              "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(160,160,160,0.35)" },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#9C27B0" },
            }}
          >
            <MenuItem value="">{t.priorityUnset}</MenuItem>
            <MenuItem value="Терпит">Терпит</MenuItem>
            <MenuItem value="Средний">Средний</MenuItem>
            <MenuItem value="Срочно">Срочно</MenuItem>
          </Select>
        </FormControl>
        <Box>
          <TextField
            fullWidth
            label={t.tag}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            disabled={loading}
            slotProps={inputSlotProps}
            sx={FIELD_SX}
          />
          <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap", alignItems: "center" }}>
            <Button
              variant="outlined"
              size="small"
              disabled={loading || !tagInput.trim()}
              onClick={() => {
                const value = tagInput.trim();
                if (!value) return;
                setTags((prev) => (prev.includes(value) ? prev : [...prev, value]));
                setTagInput("");
              }}
              sx={{
                textTransform: "none",
                borderColor: "var(--k-border)",
                color: "var(--k-text-muted)",
                borderRadius: 999,
                "&:hover": { borderColor: "#9C27B0", color: "var(--k-text)", bgcolor: "rgba(138,43,226,0.08)" },
              }}
            >
              {t.addTag}
            </Button>
            {tags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                onDelete={() => setTags((prev) => prev.filter((x) => x !== tag))}
                size="small"
                sx={{
                  bgcolor: "rgba(138,43,226,0.15)",
                  color: "var(--k-text)",
                  border: "1px solid rgba(138,43,226,0.35)",
                  "& .MuiChip-deleteIcon": { color: "var(--k-text-muted)", "&:hover": { color: "#f87171" } },
                }}
              />
            ))}
          </Box>
        </Box>
        <TextField
          fullWidth
          label={t.checklistTitle}
          value={checklistTitle}
          onChange={(e) => setChecklistTitle(e.target.value)}
          disabled={loading}
          slotProps={inputSlotProps}
          sx={FIELD_SX}
        />
        <FormControl fullWidth sx={FIELD_SX}>
          <InputLabel id="create-task-checklist-type-label" sx={{ color: "var(--k-text-muted)" }}>
            {t.checklistType}
          </InputLabel>
          <Select
            labelId="create-task-checklist-type-label"
            value={checklistMode}
            label={t.checklistType}
            onChange={(e) => setChecklistMode((e.target.value as "checkbox" | "poll") || "checkbox")}
            disabled={loading}
            MenuProps={SELECT_MENU_PROPS}
            sx={{
              color: "var(--k-text)",
              "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--k-border)" },
              "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "rgba(160,160,160,0.35)" },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#9C27B0" },
            }}
          >
            <MenuItem value="checkbox">{t.checklistCheckboxes}</MenuItem>
            <MenuItem value="poll">{t.checklistPoll}</MenuItem>
          </Select>
        </FormControl>
        <TextField
          fullWidth
          label={t.checklistItems}
          value={checklistItemsRaw}
          onChange={(e) => setChecklistItemsRaw(e.target.value)}
          multiline
          rows={3}
          disabled={loading}
          slotProps={inputSlotProps}
          sx={FIELD_SX}
        />
        <TextField
          fullWidth
          label={t.links}
          value={linksRaw}
          onChange={(e) => setLinksRaw(e.target.value)}
          multiline
          rows={2}
          disabled={loading}
          slotProps={inputSlotProps}
          sx={FIELD_SX}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, gap: 1, borderTop: "1px solid var(--k-border)" }}>
        <Button onClick={onClose} disabled={loading} sx={{ color: "var(--k-text-muted, #A0A0A0)", textTransform: "none" }}>
          {t.cancel}
        </Button>
        <Button
          onClick={() => void handleCreate()}
          variant="contained"
          disabled={loading}
          sx={{
            textTransform: "none",
            borderRadius: 999,
            px: 3,
            minWidth: 120,
            fontWeight: 600,
            background: "linear-gradient(90deg, #8A2BE2, #4B0082)",
            boxShadow: "0 0 24px rgba(138, 43, 226, 0.35)",
            "&:hover": {
              background: "linear-gradient(90deg, #9B4DEB, #5A1092)",
              transform: "scale(1.02)",
            },
            transition: "all 0.2s ease",
            "&.Mui-disabled": {
              background: "rgba(138,43,226,0.35)",
              color: "rgba(255,255,255,0.7)",
            },
          }}
        >
          {loading ? <CircularProgress size={22} sx={{ color: "inherit" }} /> : t.create}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
