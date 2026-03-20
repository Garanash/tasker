/**
 * Базовый URL API и WebSocket.
 * NEXT_PUBLIC_API_URL: пустая строка = same-origin (прокси на 8001 или 8000).
 */
const API_BASE = typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL != null
  ? process.env.NEXT_PUBLIC_API_URL
  : "";

export function getApiBase(): string {
  return API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
}

export function getApiUrl(path: string): string {
  const base = API_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return base ? `${base.replace(/\/$/, "")}${p}` : p;
}

export function getWsUrl(path: string): string {
  if (typeof window === "undefined") return "";
  const p = path.startsWith("/") ? path : `/${path}`;
  if (API_BASE) {
    const base = new URL(API_BASE);
    const wsOrigin = base.protocol === "https:" ? `wss://${base.host}` : `ws://${base.host}`;
    return `${wsOrigin}${p}`;
  }
  const url = new URL(window.location.href);
  url.protocol = url.protocol.replace("http", "ws");
  return `${url.origin}${p}`;
}
