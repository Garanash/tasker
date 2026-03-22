"use client";

import { useMemo } from "react";
import {
  Box,
  Menu,
  MenuItem,
  Typography,
  Divider,
  Avatar,
} from "@mui/material";
import { getApiUrl } from "@/lib/api";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";

/** Синхронизировано с MuiThemeProvider / AppShell — корректно в светлой и тёмной теме */
const K_TEXT = "var(--k-text, #202124)";
const K_TEXT_MUTED = "var(--k-text-muted, #5F6368)";
const K_SURFACE = "var(--k-surface-bg, #FFFFFF)";
const K_BORDER = "var(--k-border, #E0E0E0)";
const K_HOVER = "var(--k-hover, rgba(0,0,0,0.04))";
const ACCENT_PURPLE = "#9C27B0";

function resolveProfileAvatarSrc(avatarUrl: string | undefined): string | undefined {
  const u = (avatarUrl || "").trim();
  if (!u) return undefined;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return getApiUrl(u.startsWith("/") ? u : `/${u}`);
}

export type ColorTheme = "light" | "dark" | "system";
export type ProfileLanguage = "ru" | "en";

type Props = {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  userName?: string;
  userEmail?: string;
  userHandle?: string;
  avatarUrl?: string;
  colorTheme?: ColorTheme;
  onThemeChange?: (theme: ColorTheme) => void;
  language?: ProfileLanguage;
  onLanguageChange?: (language: ProfileLanguage) => void;
  onSettingsClick?: () => void;
  onLogout: () => void;
  appVersion?: string;
};

export default function ProfileMenu({
  anchorEl,
  open,
  onClose,
  userName = "Пользователь",
  userEmail = "user@example.com",
  userHandle = "@user",
  avatarUrl,
  colorTheme = "system",
  onThemeChange,
  language = "ru",
  onLanguageChange,
  onSettingsClick,
  onLogout,
  appVersion = "1.0.0",
}: Props) {
  const avatarSrc = useMemo(() => resolveProfileAvatarSrc(avatarUrl), [avatarUrl]);

  const t =
    language === "en"
      ? {
          profileSettings: "PROFILE SETTINGS",
          logout: "LOG OUT",
          version: "version",
        }
      : {
          profileSettings: "НАСТРОЙКИ ПРОФИЛЯ",
          logout: "ВЫХОД",
          version: "версия",
        };
  return (
    <Menu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      transformOrigin={{ vertical: "top", horizontal: "right" }}
      slotProps={{
        paper: {
          sx: {
            width: 320,
            borderRadius: 2,
            bgcolor: K_SURFACE,
            color: K_TEXT,
            border: `1px solid ${K_BORDER}`,
            boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
            overflow: "visible",
            mt: 1,
            backgroundImage: "none",
          },
        },
        list: {
          sx: {
            py: 0,
            bgcolor: K_SURFACE,
            color: K_TEXT,
            "& .MuiMenuItem-root": {
              color: K_TEXT,
              "&:hover": { bgcolor: K_HOVER },
              "&.Mui-focusVisible": { bgcolor: K_HOVER },
            },
          },
        },
      }}
    >
      {/* Информация о пользователе */}
      <Box sx={{ px: 2, py: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Avatar
            src={avatarSrc}
            sx={{
              width: 48,
              height: 48,
              bgcolor: ACCENT_PURPLE,
              fontSize: 20,
              fontWeight: 600,
            }}
          >
            {userName.charAt(0).toUpperCase()}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: 15,
                fontWeight: 600,
                color: K_TEXT,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {userName}
            </Typography>
            <Typography
              sx={{
                fontSize: 13,
                color: K_TEXT_MUTED,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {userHandle}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Divider sx={{ borderColor: K_BORDER }} />

      {/* Настройки профиля */}
      <MenuItem
        onClick={() => {
          onClose();
          onSettingsClick?.();
        }}
        sx={{ py: 1.5, gap: 1.5 }}
      >
        <SettingsOutlinedIcon sx={{ color: K_TEXT_MUTED, fontSize: 20 }} />
        <Typography sx={{ fontSize: 14, color: K_TEXT }}>{t.profileSettings}</Typography>
      </MenuItem>

      <Divider sx={{ my: 1, borderColor: K_BORDER }} />

      {/* Выход */}
      <MenuItem
        onClick={() => {
          onClose();
          onLogout();
        }}
        sx={{ py: 1.5, gap: 1.5 }}
      >
        <LogoutIcon sx={{ color: K_TEXT_MUTED, fontSize: 20 }} />
        <Typography sx={{ fontSize: 14, color: K_TEXT }}>{t.logout}</Typography>
      </MenuItem>

      <Divider sx={{ borderColor: K_BORDER }} />

      {/* Версия */}
      <Box sx={{ px: 2, py: 1.5 }}>
        <Typography sx={{ fontSize: 12, color: K_TEXT_MUTED }}>
          AGB Tasks {t.version} {appVersion}
        </Typography>
      </Box>
    </Menu>
  );
}
