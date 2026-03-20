"use client";

import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import type { PaletteMode } from "@mui/material";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { getStoredTheme, THEME_EVENT, type AppTheme } from "@/lib/preferences";

function resolveThemeMode(theme: AppTheme): PaletteMode {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window !== "undefined") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

export default function MuiThemeProvider({ children }: { children: ReactNode }) {
  const [themeSetting, setThemeSetting] = useState<AppTheme>("system");

  useEffect(() => {
    setThemeSetting(getStoredTheme());
    const onThemeChanged = () => setThemeSetting(getStoredTheme());
    const onSystemThemeChanged = () => setThemeSetting(getStoredTheme());
    window.addEventListener(THEME_EVENT, onThemeChanged as EventListener);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", onSystemThemeChanged);
    return () => {
      window.removeEventListener(THEME_EVENT, onThemeChanged as EventListener);
      media.removeEventListener("change", onSystemThemeChanged);
    };
  }, []);

  const mode = resolveThemeMode(themeSetting);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isDark = mode === "dark";
    const root = document.documentElement;
    root.style.setProperty("--k-top-bg", isDark ? "#0A0A0A" : "#1E1E1E");
    root.style.setProperty("--k-page-bg", isDark ? "#0A0A0A" : "#F5F5F5");
    root.style.setProperty("--k-surface-bg", isDark ? "#111111" : "#FFFFFF");
    root.style.setProperty("--k-border", isDark ? "#2A2A2A" : "#E0E0E0");
    root.style.setProperty("--k-text", isDark ? "#E0E0E0" : "#202124");
    root.style.setProperty("--k-text-muted", isDark ? "#A0A0A0" : "#5F6368");
    root.style.setProperty("--k-hover", isDark ? "rgba(255,255,255,0.08)" : "#F5F5F5");
    root.style.setProperty("--k-active", isDark ? "rgba(255,255,255,0.14)" : "#E8E8E8");
  }, [mode]);
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          background:
            mode === "dark"
              ? {
                  default: "#0A0A0A",
                  paper: "#111111",
                }
              : {
                  default: "#F5F6F7",
                  paper: "#FFFFFF",
                },
        },
        typography: {
          fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        },
      }),
    [mode]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

