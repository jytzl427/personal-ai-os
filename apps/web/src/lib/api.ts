const API_PREFIX = window.location.protocol === "tauri:" || window.location.hostname === "tauri.localhost"
  ? "http://127.0.0.1:4738/api/v1"
  : "/api/v1";

let uiSession: string | null = null;
let uiSessionPromise: Promise<string | null> | null = null;

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
  if (uiSession) return uiSession;
  if (!uiSessionPromise) {
    uiSessionPromise = (async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const response = await fetch(API_PREFIX + "/system/ui-session", { headers: { Accept: "application/json" } });
          if (!response.ok) return null;
          const result = await response.json() as { session?: unknown };
          uiSession = typeof result.session === "string" && result.session ? result.session : null;
          return uiSession;
        } catch {
          if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
      return null;
    })().finally(() => { uiSessionPromise = null; });
  }
  return uiSessionPromise;
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 8 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const headers = new Headers(init?.headers);
      if (needsUiSession(path, method)) {
        const session = await loadUiSession();
        if (session) headers.set("X-PAIOS-UI-Session", session);
      }
      return await fetch(API_PREFIX + path, { ...init, headers });
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
