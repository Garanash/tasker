export type AppTheme = "light" | "dark" | "system";
export type AppLanguage = "ru" | "en";

const THEME_KEY = "kaiten_theme";
const LANGUAGE_KEY = "kaiten_language";

export const THEME_EVENT = "kaiten-theme-changed";
export const LANGUAGE_EVENT = "kaiten-language-changed";

export function getStoredTheme(): AppTheme {
  if (typeof window === "undefined") return "system";
  const value = window.localStorage.getItem(THEME_KEY);
  if (value === "light" || value === "dark" || value === "system") return value;
  return "system";
}

export function setStoredTheme(theme: AppTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_KEY, theme);
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme } }));
}

export function getStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") return "ru";
  const value = window.localStorage.getItem(LANGUAGE_KEY);
  if (value === "ru" || value === "en") return value;
  return "ru";
}

export function setStoredLanguage(language: AppLanguage) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LANGUAGE_KEY, language);
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: { language } }));
}
