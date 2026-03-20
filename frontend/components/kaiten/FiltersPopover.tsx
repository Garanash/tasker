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
import type { KanbanFilters, KanbanStatusFilter } from "../kanban/KanbanBoard";

type Props = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;

  filters: KanbanFilters;
  onChangeFilters: (next: KanbanFilters) => void;
};

export default function FiltersPopover({ anchorEl, open, onClose, filters, onChangeFilters }: Props) {
  const statusOptions = useMemo(
    () =>
      [
        { value: "all", label: "Все" },
        { value: "todo", label: "В работе" },
        { value: "done", label: "Готово" },
      ] as Array<{ value: KanbanStatusFilter; label: string }>,
    []
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

  function reset() {
    onChangeFilters({ query: "", titleOnly: false, status: "all" });
  }

  function handleQueryChange(e: ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
  }

  function handleStatusChange(e: any) {
    setStatus(e.target.value as KanbanStatusFilter);
  }

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      PaperProps={{ sx: { width: 340, borderRadius: "16px" } }}
      disablePortal
    >
      <Box sx={{ p: 2 }}>
        <Typography sx={{ fontWeight: 800, color: "grey.900", mb: 1 }}>Фильтры</Typography>

        <Stack spacing={2}>
          <TextField
            size="small"
            label="Поиск"
            value={filters.query}
            onChange={handleQueryChange}
          />

          <FormControlLabel
            control={
              <Checkbox
                checked={filters.titleOnly}
                onChange={(e) => setTitleOnly(Boolean(e.target.checked))}
                sx={{ color: "grey.900" }}
              />
            }
            label="Искать только в названии"
          />

          <Box>
            <Typography sx={{ fontSize: 12, color: "grey.600", fontWeight: 700, textTransform: "uppercase", mb: 0.5 }}>
              Статус
            </Typography>
            <Select size="small" value={filters.status} onChange={handleStatusChange} fullWidth>
              {statusOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, pt: 1 }}>
            <Button variant="outlined" onClick={reset}>
              Сбросить
            </Button>
            <Button
              variant="contained"
              onClick={onClose}
              sx={{
                background: "grey.900",
                "&:hover": { background: "grey.800" },
              }}
            >
              Готово
            </Button>
          </Box>
        </Stack>
      </Box>
    </Popover>
  );
}

