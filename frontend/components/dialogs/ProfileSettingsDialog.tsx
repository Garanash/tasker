"use client";

import { useEffect, useRef, useState, useMemo } from "react";
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
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
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

function resolveAvatarDisplayUrl(avatarUrl: string): string | undefined {
  const u = avatarUrl.trim();
  if (!u) return undefined;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return getApiUrl(u.startsWith("/") ? u : `/${u}`);
}

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
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const t =
    language === "en"
      ? {
          title: "Profile settings",
          name: "Display name",
          changeAvatarAction: "Click avatar to choose a photo from your device",
          cancel: "Cancel",
          save: "Save",
          nameRequired: "Enter a display name",
          urlTooLong: "Avatar URL is too long",
          uploadFailed: "Could not upload avatar",
          invalidType: "Use JPEG, PNG, WebP or GIF",
          fileTooLarge: "File is too large (max 5 MB)",
        }
      : {
          title: "Настройки профиля",
          name: "Отображаемое имя",
          changeAvatarAction: "Нажмите на аватар, чтобы выбрать фото с компьютера",
          cancel: "Отмена",
          save: "Сохранить",
          nameRequired: "Укажите имя",
          urlTooLong: "Слишком длинный URL аватара",
          uploadFailed: "Не удалось загрузить аватар",
          invalidType: "Допустимы JPEG, PNG, WebP или GIF",
          fileTooLarge: "Файл слишком большой (максимум 5 МБ)",
        };

  useEffect(() => {
    if (!open) return;
    setFullName(initialFullName);
    setAvatarUrl(initialAvatarUrl);
    setError(null);
  }, [open, initialFullName, initialAvatarUrl]);

  const avatarSrc = useMemo(() => resolveAvatarDisplayUrl(avatarUrl), [avatarUrl]);

  const uploadAvatarRequest = async (accessToken: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetch(getApiUrl("/api/auth/me/avatar"), {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: fd,
    });
  };

  const mapUploadError = (detail: unknown): string => {
    if (detail === "invalid_file_type") return t.invalidType;
    if (detail === "file_too_large") return t.fileTooLarge;
    if (detail === "empty_file") return t.uploadFailed;
    if (typeof detail === "string") return detail;
    return t.uploadFailed;
  };

  const handleAvatarFile = async (file: File | undefined | null) => {
    if (!file || avatarUploading) return;
    setAvatarUploading(true);
    setError(null);
    try {
      let accessToken = token;
      let res = await uploadAvatarRequest(accessToken, file);
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
        accessToken = refreshData.access;
        res = await uploadAvatarRequest(accessToken, file);
        data = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        throw new Error(mapUploadError(data?.detail));
      }
      const u = data?.user;
      const nextUrl = u ? String(u.avatar_url ?? "") : "";
      if (nextUrl) {
        setAvatarUrl(nextUrl);
        onSaved({
          full_name: fullName.trim(),
          avatar_url: nextUrl,
        });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
  const busy = loading || avatarUploading;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
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
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif"
        style={{ display: "none" }}
        aria-hidden
        onChange={(e) => void handleAvatarFile(e.target.files?.[0])}
      />
      <DialogTitle sx={{ fontWeight: 800, letterSpacing: "-0.02em" }}>{t.title}</DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 1 }}>
          <Box
            role="button"
            tabIndex={0}
            aria-label={t.changeAvatarAction}
            aria-busy={avatarUploading}
            onClick={(e) => {
              e.stopPropagation();
              if (busy) return;
              fileInputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (busy) return;
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              fileInputRef.current?.click();
            }}
            sx={{
              position: "relative",
              borderRadius: "50%",
              cursor: busy ? "default" : "pointer",
              flexShrink: 0,
              "&:hover .avatar-edit-overlay": { opacity: avatarUploading ? 0 : 1 },
            }}
          >
            <Avatar
              src={avatarSrc}
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
            {avatarUploading ? (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  bgcolor: "rgba(0,0,0,0.5)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <CircularProgress size={28} sx={{ color: "#fff" }} />
              </Box>
            ) : (
              <Box
                className="avatar-edit-overlay"
                sx={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "50%",
                  bgcolor: "rgba(0,0,0,0.45)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 0,
                  transition: "opacity 0.2s ease",
                  pointerEvents: "none",
                }}
              >
                <EditOutlinedIcon sx={{ color: "#fff", fontSize: 20 }} />
              </Box>
            )}
          </Box>
          <Typography variant="body2" sx={{ color: "var(--k-text-muted, #A0A0A0)" }}>
            {t.changeAvatarAction}
          </Typography>
        </Box>
        <TextField label={t.name} value={fullName} onChange={(e) => setFullName(e.target.value)} fullWidth autoFocus disabled={busy} />
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button onClick={onClose} disabled={busy} sx={{ color: "var(--k-text-muted, #A0A0A0)" }}>
          {t.cancel}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={busy}
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
