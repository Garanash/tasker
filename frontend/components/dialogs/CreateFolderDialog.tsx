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
  refreshToken?: string;
  spaceId: string;
  onTokensUpdated?: (tokens: { access: string; refresh?: string }) => void;
  onAuthExpired?: () => void;
  onCreated: (project: { id: string; name: string; space_id: string }) => void;
};

export default function CreateFolderDialog({
  open,
  onClose,
  token,
  refreshToken,
  spaceId,
  onTokensUpdated,
  onAuthExpired,
  onCreated,
}: Props) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Введите название папки");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const createProject = async (accessToken: string) =>
        fetch(getApiUrl("/api/kanban/projects"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            "X-Space-Id": spaceId,
          },
          body: JSON.stringify({ name: name.trim(), space_id: spaceId }),
        });

      let res = await createProject(token);
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
        res = await createProject(refreshData.access);
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) throw new Error(data?.detail || "Ошибка создания папки");
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
      <DialogTitle>Создать папку</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Название папки"
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
