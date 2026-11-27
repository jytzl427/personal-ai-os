const DESKTOP = window.location.protocol === "tauri:" || window.location.hostname === "tauri.localhost";
const API_PREFIX = DESKTOP
  ? "http://127.0.0.1:4738/api/v1"
  : "/api/v1";

const desktopSessionKey = "paios_account_session";
let desktopSession: string | null = null;
if (DESKTOP) {
  try { desktopSession = sessionStorage.getItem(desktopSessionKey); } catch {}
}
let authGeneration = 0;
export const sessionExpiredEvent = "paios-session-expired";

export function updateAccountSession(token?: string): void {
  authGeneration += 1;
  if (!DESKTOP) return;
  desktopSession = token ?? null;
  try {
    if (token) sessionStorage.setItem(desktopSessionKey, token);
    else sessionStorage.removeItem(desktopSessionKey);
  } catch {}
}

function needsUiSession(path: string, method: string): boolean {
  if (method === "GET" || method === "HEAD") return false;
    return /\/confirmations\/[^/]+\/(approve|reject)$/.test(path)
      || /\/system\/(restore|export)$/.test(path)
      || /\/system\/archive-retention\/check$/.test(path)
      || /\/archive\/(restore|delete|delete-batch|purge-request)(\/|$)/.test(path)
      || /\/conversations\/[^/]+\/archive$/.test(path)
      || (method === "DELETE" && /\/task-recurrences\/[^/]+$/.test(path));
}

async function loadUiSession(): Promise<string | null> {
  const response = await apiFetch("/system/ui-session");
  if (!response.ok) return null;
  const result = await response.json() as { session?: unknown };
  return typeof result.session === "string" ? result.session : null;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 8 : 1;
  const generation = authGeneration;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const headers = new Headers(init?.headers);
      if (desktopSession) headers.set("X-PAIOS-Account-Session", desktopSession);
      if (needsUiSession(path, method)) {
        const session = await loadUiSession();
        if (session) headers.set("X-PAIOS-UI-Session", session);
      }
      const response = await fetch(API_PREFIX + path, { ...init, headers, cache: "no-store" });
      if (response.status === 401 && !path.startsWith("/account/") && generation === authGeneration) {
        window.dispatchEvent(new Event(sessionExpiredEvent));
      }
      return response;
    } catch (reason: unknown) {
      lastError = reason;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("无法连接本机服务");
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(result.error?.message ?? "请求失败（HTTP " + response.status + "）");
  }
  return result;
}

export function jsonRequest(method: "POST" | "PATCH" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}
