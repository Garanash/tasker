"use client";

import { useEffect, useState } from "react";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import { getApiUrl } from "@/lib/api";
import type { AppLanguage } from "@/lib/preferences";

const AVATAR_URL_MAX_LEN = 2048;

type Props = {
  open: boolean;
  onClose: () => void;
  language: AppLanguage;
  initialFullName: string;
  initialAvatarUrl: string;
  token: string;
  refreshToken?: string;
  onTokensUpdated?: (tokens: { access: string; refresh?: string }) => void;
  onAuthExpired?: () => void;
  onSaved: (next: { full_name: string; avatar_url: string }) => void;
};

export default function ProfileSettingsDialog({
  open,
  onClose,
  language,
  initialFullName,
  initialAvatarUrl,
  token,
  refreshToken,
  onTokensUpdated,
  onAuthExpired,
  onSaved,
}: Props) {
  const [fullName, setFullName] = useState(initialFullName);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const t =
    language === "en"
      ? {
          title: "Profile settings",
          name: "Display name",
          avatarHint: "Avatar image URL (https://…)",
          cancel: "Cancel",
          save: "Save",
          nameRequired: "Enter a display name",
          urlTooLong: "Avatar URL is too long",
        }
      : {
          title: "Настройки профиля",
          name: "Отображаемое имя",
          avatarHint: "URL картинки аватара (https://…)",
          cancel: "Отмена",
          save: "Сохранить",
          nameRequired: "Укажите имя",
          urlTooLong: "Слишком длинный URL аватара",
        };

  useEffect(() => {
    if (!open) return;
    setFullName(initialFullName);
    setAvatarUrl(initialAvatarUrl);
    setError(null);
  }, [open, initialFullName, initialAvatarUrl]);

  const patchProfile = async (accessToken: string) =>
    fetch(getApiUrl("/api/auth/me"), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        full_name: fullName.trim(),
        avatar_url: avatarUrl.trim(),
      }),
    });

  const handleSave = async () => {
    if (!fullName.trim()) {
      setError(t.nameRequired);
      return;
    }
    if (avatarUrl.trim().length > AVATAR_URL_MAX_LEN) {
      setError(t.urlTooLong);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let res = await patchProfile(token);
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
        res = await patchProfile(refreshData.access);
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        throw new Error(
          typeof data?.detail === "string" ? data.detail : language === "en" ? "Failed to save" : "Не удалось сохранить",
        );
      }
      const u = data?.user;
      if (u) {
        onSaved({
          full_name: String(u.full_name ?? fullName.trim()),
          avatar_url: String(u.avatar_url ?? avatarUrl.trim()),
        });
      } else {
        onSaved({ full_name: fullName.trim(), avatar_url: avatarUrl.trim() });
      }
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const previewLetter = (fullName.trim() || "?").charAt(0).toUpperCase();

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (loading) return;
        onClose();
      }}
      fullWidth
      maxWidth="sm"
      slotProps={{
        paper: {
          sx: {
            borderRadius: 3,
            bgcolor: "var(--k-surface-bg, #111111)",
            color: "var(--k-text, #E0E0E0)",
            border: "1px solid var(--k-border, #2A2A2A)",
            backgroundImage: "none",
          },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>{t.title}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 1 }}>
          <Avatar
            src={avatarUrl.trim() || undefined}
            sx={{
              width: 72,
              height: 72,
              fontSize: 28,
              fontWeight: 700,
              background: "linear-gradient(90deg, #8A2BE2, #4B0082)",
            }}
          >
            {previewLetter}
          </Avatar>
          <Typography variant="body2" sx={{ color: "var(--k-text-muted, #A0A0A0)" }}>
            {language === "en" ? "Preview updates as you type the image URL." : "Превью обновляется при вводе URL картинки."}
          </Typography>
        </Box>
        <TextField label={t.name} value={fullName} onChange={(e) => setFullName(e.target.value)} fullWidth autoFocus disabled={loading} />
        <TextField label={t.avatarHint} value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} fullWidth disabled={loading} />
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={loading} sx={{ color: "var(--k-text-muted, #A0A0A0)" }}>
          {t.cancel}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={loading}
          sx={{
            borderRadius: 999,
            px: 3,
            fontWeight: 600,
            background: "linear-gradient(90deg, #8A2BE2, #4B0082)",
            boxShadow: "0 0 24px rgba(138, 43, 226, 0.35)",
            "&:hover": {
              background: "linear-gradient(90deg, #9B4DEB, #5A1092)",
              transform: "scale(1.02)",
            },
            transition: "all 0.2s ease",
          }}
        >
          {loading ? <CircularProgress size={22} color="inherit" /> : t.save}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
