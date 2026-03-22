"use client";

import type { ChangeEvent } from "react";
import { useMemo } from "react";

import {
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Popover,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { KanbanDueFilter, KanbanFilters, KanbanPriorityFilter, KanbanStatusFilter } from "../kanban/KanbanBoard";

type AssigneeOption = { id: string; label: string };

type Props = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;

  filters: KanbanFilters;
  onChangeFilters: (next: KanbanFilters) => void;
  assigneeOptions?: AssigneeOption[];
  language?: "ru" | "en";
};

export default function FiltersPopover({
  anchorEl,
  open,
  onClose,
  filters,
  onChangeFilters,
  assigneeOptions = [],
  language = "ru",
}: Props) {
  const en = language === "en";

  const statusOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: en ? "All" : "Все" },
        { value: "todo" as const, label: en ? "In progress" : "В работе" },
        { value: "done" as const, label: en ? "Done" : "Готово" },
      ] satisfies Array<{ value: KanbanStatusFilter; label: string }>,
    [en]
  );

  const priorityOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: en ? "Any priority" : "Любой приоритет" },
        { value: "Терпит" as const, label: en ? "Low" : "Терпит" },
        { value: "Средний" as const, label: en ? "Medium" : "Средний" },
        { value: "Срочно" as const, label: en ? "Urgent" : "Срочно" },
      ] satisfies Array<{ value: KanbanPriorityFilter; label: string }>,
    [en]
  );

  const dueOptions = useMemo(
    () =>
      [
        { value: "all" as const, label: en ? "Any deadline" : "Любой срок" },
        { value: "overdue" as const, label: en ? "Overdue" : "Просрочено" },
        { value: "today" as const, label: en ? "Due today" : "Сегодня" },
        { value: "week" as const, label: en ? "Due in the next 7 days" : "Срок в ближайшие 7 дней" },
        { value: "no_due" as const, label: en ? "No deadline" : "Без срока" },
      ] satisfies Array<{ value: KanbanDueFilter; label: string }>,
    [en]
  );

  function setQuery(v: string) {
    onChangeFilters({ ...filters, query: v });
  }

  function setTitleOnly(v: boolean) {
    onChangeFilters({ ...filters, titleOnly: v });
  }

  function setStatus(v: KanbanStatusFilter) {
    onChangeFilters({ ...filters, status: v });
  }

  function setAssignee(v: string) {
    onChangeFilters({ ...filters, assigneeUserId: v === "" ? null : v });
  }

  function setPriority(v: KanbanPriorityFilter) {
    onChangeFilters({ ...filters, priority: v });
  }

  function setDue(v: KanbanDueFilter) {
    onChangeFilters({ ...filters, due: v });
  }

  function reset() {
    onChangeFilters({
      query: "",
      titleOnly: false,
      status: "all",
      assigneeUserId: null,
      priority: "all",
      due: "all",
    });
  }

  function handleQueryChange(e: ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: {
            width: 360,
            maxWidth: "calc(100vw - 24px)",
            borderRadius: "16px",
            bgcolor: "var(--k-surface-bg, #fff)",
            border: "1px solid var(--k-border, #e0e0e0)",
            color: "var(--k-text, #202124)",
            zIndex: 1400,
          },
        },
      }}
    >
      <Box sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 800, mb: 1, color: "var(--k-text)" }}>
          {en ? "Task filters" : "Фильтры задач"}
        </Typography>

        <Stack spacing={2}>
          <TextField
            size="small"
            label={en ? "Search" : "Поиск"}
            value={filters.query}
            onChange={handleQueryChange}
            fullWidth
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={filters.titleOnly}
                onChange={(e) => setTitleOnly(Boolean(e.target.checked))}
                sx={{ color: "var(--k-text-muted)" }}
              />
            }
            label={en ? "Search in title only" : "Искать только в названии"}
            sx={{ color: "var(--k-text-muted)", "& .MuiFormControlLabel-label": { fontSize: 14 } }}
          />

          <Box>
            <Typography sx={{ fontSize: 12, color: "var(--k-text-muted)", fontWeight: 700, textTransform: "uppercase", mb: 0.5 }}>
              {en ? "Status" : "Статус"}
            </Typography>
            <Select size="small" value={filters.status} onChange={(e) => setStatus(e.target.value as KanbanStatusFilter)} fullWidth>
              {statusOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 12, color: "var(--k-text-muted)", fontWeight: 700, textTransform: "uppercase", mb: 0.5 }}>
              {en ? "Assignee" : "Ответственный"}
            </Typography>
            <Select
              size="small"
              value={filters.assigneeUserId ?? ""}
              onChange={(e) => setAssignee(e.target.value as string)}
              displayEmpty
              fullWidth
            >
              <MenuItem value="">{en ? "Anyone" : "Любой"}</MenuItem>
              {assigneeOptions.map((opt) => (
                <MenuItem key={opt.id} value={opt.id}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 12, color: "var(--k-text-muted)", fontWeight: 700, textTransform: "uppercase", mb: 0.5 }}>
              {en ? "Priority" : "Приоритет"}
            </Typography>
            <Select size="small" value={filters.priority} onChange={(e) => setPriority(e.target.value as KanbanPriorityFilter)} fullWidth>
              {priorityOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 12, color: "var(--k-text-muted)", fontWeight: 700, textTransform: "uppercase", mb: 0.5 }}>
              {en ? "Deadline" : "Срок"}
            </Typography>
            <Select size="small" value={filters.due} onChange={(e) => setDue(e.target.value as KanbanDueFilter)} fullWidth>
              {dueOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, pt: 1 }}>
            <Button variant="outlined" onClick={reset} sx={{ textTransform: "none", borderColor: "var(--k-border)", color: "var(--k-text)" }}>
              {en ? "Reset" : "Сбросить"}
            </Button>
            <Button
              variant="contained"
              onClick={onClose}
              sx={{
                textTransform: "none",
                background: "linear-gradient(90deg, #8A2BE2, #4B0082)",
                "&:hover": { background: "linear-gradient(90deg, #9B4DEB, #5A1092)" },
              }}
            >
              {en ? "Done" : "Готово"}
            </Button>
          </Box>
        </Stack>
      </Box>
    </Popover>
  );
}
