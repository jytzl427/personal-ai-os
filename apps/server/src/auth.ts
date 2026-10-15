import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { PaiosDatabase } from "@paios/db";

export type AgentScope = string;

export type AgentAuth = {
  kind: "agent";
  tokenId: string;
  name: string;
  scopes: Set<AgentScope>;
};

export type RequestActor = AgentAuth | { kind: "user" };

type TokenRow = {
  id: string;
  name: string;
  token_hash: string;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
};

const LEGACY_READ = "read";
const LEGACY_WRITE = "write";
const AGENT_HEADER = "X-PAIOS-Agent-Transport";

export const AGENT_SCOPE_PRESETS: Record<string, string[]> = {
  readonly: ["read"],
  tasks_projects: ["tasks:read", "tasks:write", "projects:read", "projects:write"],
  finance_health: ["finance:read", "finance:write", "health:read", "health:write"],
  ordinary: [
    "tasks:read", "tasks:write", "projects:read", "projects:write", "ideas:read", "ideas:write",
    "finance:read", "finance:write", "health:read", "health:write", "reviews:read", "reviews:write",
    "conversations:read", "conversations:write", "system:read"
  ]
};

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function parseScopes(value: string): Set<string> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    // Invalid stored scopes are treated as no permissions.
  }
  return new Set();
}

function tokenIsActive(row: TokenRow, timestamp = new Date().toISOString()): boolean {
  return !row.revoked_at && (!row.expires_at || row.expires_at > timestamp);
}

export function bearerToken(context: Context): string | null {
  const value = context.req.header("Authorization") ?? "";
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(value);
  return match?.[1] ?? null;
}

export function authenticateAgent(database: PaiosDatabase, token: string | null): AgentAuth | null {
  if (!token) return null;
  const row = database.prepare("SELECT id, name, token_hash, scopes_json, expires_at, revoked_at FROM api_tokens WHERE token_hash = ?").get(createHash("sha256").update(token).digest("hex")) as TokenRow | undefined;
  if (!row || !tokenIsActive(row)) return null;
  const expected = Buffer.from(row.token_hash, "hex");
  const actual = hashToken(token);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  database.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return { kind: "agent", tokenId: row.id, name: row.name, scopes: parseScopes(row.scopes_json) };
}

export function requestAgentAuth(database: PaiosDatabase, context: Context): { auth: AgentAuth | null; error?: "missing" | "invalid" } {
  const token = bearerToken(context);
  const transport = context.req.header(AGENT_HEADER);
  if (transport && transport !== "mcp") return { auth: null, error: "invalid" };
  if (transport === "mcp" && !token) return { auth: null, error: "missing" };
  if (!token) return { auth: null };
  const auth = authenticateAgent(database, token);
  return auth ? { auth } : { auth: null, error: "invalid" };
}

function domainForPath(path: string): string {
  if (/\/(tasks|task-recurrences|plans|deps)(\/|$)/.test(path)) return "tasks";
  if (/\/(projects|milestones|issues|project-links)(\/|$)/.test(path)) return "projects";
  if (/\/ideas(\/|$)/.test(path)) return "ideas";
  if (/\/finance(\/|$)/.test(path)) return "finance";
  if (/\/health(\/|$)/.test(path)) return "health";
  if (/\/reviews(\/|$)/.test(path)) return "reviews";
  if (/\/(conversations|butler)(\/|$)/.test(path)) return "conversations";
  if (/\/audit(\/|$)/.test(path)) return "audit";
  return "system";
}

export function requiredScope(context: Context): string {
  const permission = context.req.method === "GET" || context.req.method === "HEAD" ? "read" : "write";
  return `${domainForPath(context.req.path)}:${permission}`;
}

export function hasScope(auth: AgentAuth, scope: string): boolean {
  if (auth.scopes.has("admin")) return true;
  const [domain = "", permission = ""] = scope.split(":");
  if (auth.scopes.has(scope)) return true;
  if (permission === "read" && auth.scopes.has(LEGACY_READ)) return true;
  if (permission === "write" && auth.scopes.has(LEGACY_WRITE)) return true;
  if (permission === "read" && auth.scopes.has(`${domain}:write`)) return true;
  return false;
}

export function isAgentTransport(context: Context): boolean {
  return context.req.header(AGENT_HEADER) === "mcp" || Boolean(context.req.header("Authorization"));
}

export function isForbiddenAgentOperation(context: Context): boolean {
  const path = context.req.path;
  return (
    context.req.method === "DELETE" ||
    /\/confirmations\/[^/]+\/approve$/.test(path) ||
    /\/system\/(restore|backup)$/.test(path) ||
    /\/imports\/(commit|preview)$/.test(path) ||
    /\/archive\//.test(path) ||
    /\/(tasks|ideas|projects|conversations)\/[^/]+\/(archive|restore)$/.test(path) ||
    /\/plans\/[^/]+\/confirm$/.test(path) ||
    /\/reviews\/[^/]+\/finalize$/.test(path) ||
    (/\/workflows\//.test(path) && !/^GET$|^HEAD$/.test(context.req.method)) ||
    /\/workflows\/[^/]+\/(apply|rollback)$/.test(path) ||
    /\/batch$/.test(path) ||
    (/\/settings(\/|$)/.test(path) && !/^GET$|^HEAD$/.test(context.req.method))
  );
}

export function createAgentToken(): string {
  return `paios_${randomBytes(32).toString("hex")}`;
}

export function scopePreset(name: unknown): string[] | null {
  if (typeof name !== "string") return null;
  const value = AGENT_SCOPE_PRESETS[name];
  return value ? [...value] : null;
}

export function scopeLabel(scopes: string[]): string {
  return scopes.includes("read") && scopes.includes("write") ? "旧版读写" : scopes.join(", ");
}
