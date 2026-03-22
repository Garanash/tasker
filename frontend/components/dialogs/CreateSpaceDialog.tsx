"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  CircularProgress,
} from "@mui/material";
import { getApiUrl } from "@/lib/api";

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  activeSpaceId?: string | null;
  /** Организация для нового пространства (если нет активного space). */
  activeOrganizationId?: string | null;
  refreshToken?: string;
  onTokensUpdated?: (tokens: { access: string; refresh?: string }) => void;
  onAuthExpired?: () => void;
  onCreated: (space: { id: string; name: string }) => void;
};

export default function CreateSpaceDialog({
  open,
  onClose,
  token,
  activeSpaceId,
  activeOrganizationId,
  refreshToken,
  onTokensUpdated,
  onAuthExpired,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Введите название пространства");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const createSpace = async (accessToken: string) =>
        fetch(getApiUrl("/api/kanban/spaces"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            ...(activeSpaceId ? { "X-Space-Id": activeSpaceId } : {}),
            ...(!activeSpaceId && activeOrganizationId ? { "X-Organization-Id": activeOrganizationId } : {}),
          },
          body: JSON.stringify({ name: name.trim() }),
        });

      let res = await createSpace(token);
      let data: any = await res.json().catch(() => ({}));

      if (!res.ok && res.status === 401 && data?.detail === "invalid_token") {
        if (!refreshToken) {
          onAuthExpired?.();
          throw new Error("Сессия истекла. Войдите заново.");
        }

        const refreshRes = await fetch(getApiUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh: refreshToken }),
        });
        const refreshData: any = await refreshRes.json().catch(() => ({}));
        if (!refreshRes.ok || !refreshData?.access) {
          onAuthExpired?.();
          throw new Error("Сессия истекла. Войдите заново.");
        }

        onTokensUpdated?.({ access: refreshData.access, refresh: refreshData.refresh });
        res = await createSpace(refreshData.access);
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) throw new Error(data?.detail || "Ошибка создания пространства");

      onCreated(data);
      setName("");
      onClose();
    } catch (e: any) {
      setError(e?.message || "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Создать пространство</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Название пространства"
          value={name}
          onChange={(e) => setName(e.target.value)}
          margin="dense"
          error={!!error}
          helperText={error}
          disabled={loading}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Отмена
        </Button>
        <Button onClick={handleCreate} variant="contained" disabled={loading}>
          {loading ? <CircularProgress size={20} /> : "Создать"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
