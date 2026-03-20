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
} from "@mui/material";
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
  language?: "ru" | "en";
  onTokensUpdated?: (tokens: { access: string; refresh?: string }) => void;
  onAuthExpired?: () => void;
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
  language = "ru",
  onTokensUpdated,
  onAuthExpired,
}: Props) {
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

  useEffect(() => {
    if (!open) return;
    setColumnId(defaultColumnId || columns[0]?.id || "");
  }, [open, defaultColumnId, columns]);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError(language === "en" ? "Enter task title" : "Введите название задачи");
      return;
    }
    if (!columnId) {
      setError(language === "en" ? "Select a column" : "Выберите колонку");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let effectiveAccess = token;
      const payload = {
        title: title.trim(),
        description: description.trim(),
        column_id: columnId,
        board_id: boardId,
        due_at: dueAt || null,
        planned_start_at: startAt ? `${startAt}T00:00:00` : null,
        planned_end_at: dueAt ? `${dueAt}T23:59:59` : null,
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
      if (!res.ok) throw new Error(data?.detail || (language === "en" ? "Task creation failed" : "Ошибка создания задачи"));
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
      setError(e?.message || (language === "en" ? "Error" : "Ошибка"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{language === "en" ? "Create task" : "Создать задачу"}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <TextField
          autoFocus
          fullWidth
          label={language === "en" ? "Task title" : "Название задачи"}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={!!error}
          helperText={error}
          disabled={loading}
        />
        <TextField
          fullWidth
          label={language === "en" ? "Description" : "Описание"}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={3}
          disabled={loading}
        />
        <FormControl fullWidth>
          <InputLabel>{language === "en" ? "Column" : "Колонка"}</InputLabel>
          <Select
            value={columnId}
            label={language === "en" ? "Column" : "Колонка"}
            onChange={(e) => setColumnId(e.target.value)}
            disabled={loading}
          >
            {columns.map((col) => (
              <MenuItem key={col.id} value={col.id}>
                {col.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          fullWidth
          label={language === "en" ? "Start date" : "Дата начала"}
          type="date"
          value={startAt}
          InputLabelProps={{ shrink: true }}
          disabled
        />
        <TextField
          fullWidth
          label={language === "en" ? "End date" : "Дата окончания"}
          type="date"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          InputLabelProps={{ shrink: true }}
          disabled={loading}
        />
        <FormControl fullWidth>
          <InputLabel>{language === "en" ? "Priority" : "Приоритет"}</InputLabel>
          <Select
            value={priority}
            label={language === "en" ? "Priority" : "Приоритет"}
            onChange={(e) => setPriority((e.target.value as any) || "")}
            disabled={loading}
          >
            <MenuItem value="">{language === "en" ? "Not set" : "Не задан"}</MenuItem>
            <MenuItem value="Терпит">Терпит</MenuItem>
            <MenuItem value="Средний">Средний</MenuItem>
            <MenuItem value="Срочно">Срочно</MenuItem>
          </Select>
        </FormControl>
        <Box>
          <TextField
            fullWidth
            label={language === "en" ? "Tag" : "Метка"}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            disabled={loading}
          />
          <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
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
            >
              {language === "en" ? "Add tag" : "Добавить метку"}
            </Button>
            {tags.map((tag) => (
              <Chip key={tag} label={tag} onDelete={() => setTags((prev) => prev.filter((x) => x !== tag))} size="small" />
            ))}
          </Box>
        </Box>
        <TextField
          fullWidth
          label={language === "en" ? "Checklist question/title" : "Вопрос/название чек-листа"}
          value={checklistTitle}
          onChange={(e) => setChecklistTitle(e.target.value)}
          disabled={loading}
        />
        <FormControl fullWidth>
          <InputLabel>{language === "en" ? "Checklist type" : "Тип чек-листа"}</InputLabel>
          <Select
            value={checklistMode}
            label={language === "en" ? "Checklist type" : "Тип чек-листа"}
            onChange={(e) => setChecklistMode((e.target.value as "checkbox" | "poll") || "checkbox")}
            disabled={loading}
          >
            <MenuItem value="checkbox">{language === "en" ? "Checkboxes" : "Чекбоксы"}</MenuItem>
            <MenuItem value="poll">{language === "en" ? "Poll options" : "Опрос (варианты)"}</MenuItem>
          </Select>
        </FormControl>
        <TextField
          fullWidth
          label={language === "en" ? "Checklist options (one per line)" : "Варианты/пункты (по одному в строке)"}
          value={checklistItemsRaw}
          onChange={(e) => setChecklistItemsRaw(e.target.value)}
          multiline
          rows={3}
          disabled={loading}
        />
        <TextField
          fullWidth
          label={language === "en" ? "Links (one per line)" : "Ссылки (по одной в строке)"}
          value={linksRaw}
          onChange={(e) => setLinksRaw(e.target.value)}
          multiline
          rows={2}
          disabled={loading}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          {language === "en" ? "Cancel" : "Отмена"}
        </Button>
        <Button onClick={handleCreate} variant="contained" color="success" disabled={loading}>
          {loading ? <CircularProgress size={20} /> : language === "en" ? "Create" : "Создать"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
