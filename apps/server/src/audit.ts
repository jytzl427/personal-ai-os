import type { PaiosDatabase } from "@paios/db";
import { randomUUID } from "node:crypto";

const SENSITIVE_KEY = /(api[_-]?key|token|authorization|password|secret|credential|private[_-]?key)/i;
const MAX_AUDIT_TEXT = 20_000;

export type AuditActor = "user" | "agent" | "system";

export type AuditTarget = {
  entityType: string;
  table: string;
  whereColumn: string;
  entityId?: string;
};

export type AuditInput = {
  actor: AuditActor;
  agentTokenId?: string | null;
  agentName?: string | null;
  toolName?: string | null;
  action: string;
  target?: AuditTarget;
  request?: unknown;
  before?: unknown;
  after?: unknown;
  result: "ok" | "error";
  ip?: string | null;
};

const TARGETS: Array<{ pattern: RegExp; entityType: string; table: string; whereColumn?: string }> = [
  { pattern: /^\/api\/v1\/tasks\/([^/]+)(?:\/|$)/, entityType: "task", table: "tasks" },
  { pattern: /^\/api\/v1\/task-recurrences\/([^/]+)(?:\/|$)/, entityType: "task_recurrence", table: "task_recurrences" },
  { pattern: /^\/api\/v1\/projects\/([^/]+)\/workspace(?:\/|$)/, entityType: "project_workspace", table: "project_workspaces", whereColumn: "project_id" },
  { pattern: /^\/api\/v1\/projects\/([^/]+)(?:\/|$)/, entityType: "project", table: "projects" },
  { pattern: /^\/api\/v1\/ideas\/([^/]+)(?:\/|$)/, entityType: "idea", table: "ideas" },
  { pattern: /^\/api\/v1\/finance\/accounts\/([^/]+)(?:\/|$)/, entityType: "finance_account", table: "finance_accounts" },
  { pattern: /^\/api\/v1\/finance\/account-entries\/([^/]+)(?:\/|$)/, entityType: "finance_account_entry", table: "finance_account_entries" },
  { pattern: /^\/api\/v1\/finance\/(expenses|incomes)\/([^/]+)(?:\/|$)/, entityType: "finance_entry", table: "__kind__" },
  { pattern: /^\/api\/v1\/health\/([^/]+)(?:\/|$)/, entityType: "health", table: "health_logs", whereColumn: "log_date" },
  { pattern: /^\/api\/v1\/reviews\/([^/]+)(?:\/|$)/, entityType: "review", table: "reviews" }
];

const COLLECTION_TARGETS: Record<string, Omit<AuditTarget, "entityId">> = {
  "/api/v1/tasks": { entityType: "task", table: "tasks", whereColumn: "id" },
  "/api/v1/task-recurrences": { entityType: "task_recurrence", table: "task_recurrences", whereColumn: "id" },
  "/api/v1/projects": { entityType: "project", table: "projects", whereColumn: "id" },
  "/api/v1/ideas": { entityType: "idea", table: "ideas", whereColumn: "id" },
  "/api/v1/finance/accounts": { entityType: "finance_account", table: "finance_accounts", whereColumn: "id" },
  "/api/v1/finance/account-entries": { entityType: "finance_account_entry", table: "finance_account_entries", whereColumn: "id" },
  "/api/v1/finance/expenses": { entityType: "finance_entry", table: "finance_expenses", whereColumn: "id" },
  "/api/v1/finance/incomes": { entityType: "finance_entry", table: "finance_incomes", whereColumn: "id" },
  "/api/v1/health": { entityType: "health", table: "health_logs", whereColumn: "log_date" },
  "/api/v1/reviews": { entityType: "review", table: "reviews", whereColumn: "id" }
};

function safeTargetTable(path: string, routeTarget: { table: string; entityType: string }, match: RegExpExecArray): string {
  if (routeTarget.table !== "__kind__") return routeTarget.table;
  return match[1] === "expenses" ? "finance_expenses" : "finance_incomes";
}

export function inferAuditTarget(path: string): AuditTarget | undefined {
  for (const routeTarget of TARGETS) {
    const match = routeTarget.pattern.exec(path);
    if (!match) continue;
    return {
      entityType: routeTarget.entityType,
      table: safeTargetTable(path, routeTarget, match),
      whereColumn: routeTarget.whereColumn ?? "id",
      entityId: routeTarget.whereColumn === "project_id" ? match[1] : routeTarget.table === "__kind__" ? match[2] : match[1]
    };
  }
  return COLLECTION_TARGETS[path] ? { ...COLLECTION_TARGETS[path] } : undefined;
}

export function targetFromButlerTool(toolName: string, args: Record<string, unknown>, data?: unknown): AuditTarget | undefined {
  const id = (key: string) => typeof args[key] === "string" && args[key] ? args[key] as string : undefined;
  const dataRecord = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  const dataId = typeof dataRecord.id === "string" ? dataRecord.id : undefined;
  switch (toolName) {
    case "tasks_create":
    case "tasks_update": return { entityType: "task", table: "tasks", whereColumn: "id", entityId: id("task_id") ?? dataId };
    case "plans_generate":
    case "plans_update": return { entityType: "daily_plan", table: "daily_plans", whereColumn: "plan_date", entityId: id("date") };
    case "period_plans_upsert": return { entityType: "period_plan", table: "period_plans", whereColumn: "id", entityId: dataId };
    case "projects_create":
    case "projects_update": return { entityType: "project", table: "projects", whereColumn: "id", entityId: id("project_id") ?? dataId };
    case "ideas_create":
    case "task_recurrence_create":
    case "task_recurrence_update": return { entityType: "task_recurrence", table: "task_recurrences", whereColumn: "id", entityId: id("recurrence_id") ?? dataId };
    case "project_workspace_update": return { entityType: "project_workspace", table: "project_workspaces", whereColumn: "project_id", entityId: id("project_id") ?? (typeof dataRecord.project_id === "string" ? dataRecord.project_id : undefined) };
    case "ideas_update": return { entityType: "idea", table: "ideas", whereColumn: "id", entityId: id("idea_id") ?? dataId };
    case "finance_expense_create": return { entityType: "finance_entry", table: "finance_expenses", whereColumn: "id", entityId: dataId };
    case "finance_income_create": return { entityType: "finance_entry", table: "finance_incomes", whereColumn: "id", entityId: dataId };
    case "finance_account_entry_create": return { entityType: "finance_account_entry", table: "finance_account_entries", whereColumn: "id", entityId: dataId };
    case "health_put": return { entityType: "health", table: "health_logs", whereColumn: "log_date", entityId: id("date") ?? (typeof dataRecord.log_date === "string" ? dataRecord.log_date : undefined) };
    case "reviews_daily_generate":
    case "reviews_period_generate": return { entityType: "review", table: "reviews", whereColumn: "id", entityId: dataId };
    case "reviews_update": return { entityType: "review", table: "reviews", whereColumn: "id", entityId: id("review_id") ?? dataId };
    default: return undefined;
  }
}

export function readAuditTarget(database: PaiosDatabase, target: AuditTarget | undefined): Record<string, unknown> | undefined {
  if (!target?.entityId) return undefined;
  try {
    return database.prepare(`SELECT * FROM ${target.table} WHERE ${target.whereColumn} = ?`).get(target.entityId) as Record<string, unknown> | undefined;
  } catch {
    return undefined;
  }
}

export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (typeof value === "string") return value.length > 8_000 ? `${value.slice(0, 8_000)}…[TRUNCATED]` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 200).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactAuditValue(item, depth + 1)]));
}

export function auditJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const serialized = JSON.stringify(redactAuditValue(value));
    if (serialized.length <= MAX_AUDIT_TEXT) return serialized;
    return JSON.stringify({ truncated: true, preview: serialized.slice(0, MAX_AUDIT_TEXT - 80) });
  } catch {
    return JSON.stringify({ unavailable: true });
  }
}

export function responseEntityId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  for (const key of ["task", "project", "idea", "recurrence", "account", "entry", "expense", "income", "health", "review"]) {
    const item = record[key];
    if (item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).id === "string") return (item as Record<string, unknown>).id as string;
    if (item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).log_date === "string") return (item as Record<string, unknown>).log_date as string;
  }
  return undefined;
}

export function recordAudit(database: PaiosDatabase, input: AuditInput): string | undefined {
  const id = randomUUID();
  try {
    database.prepare(
      "INSERT INTO audit_logs (id, change_id, at, actor, agent_token_id, agent_name, tool_name, action, entity_type, entity_id, request_json, before_json, after_json, result, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, id, new Date().toISOString(), input.actor, input.agentTokenId ?? null, input.agentName ?? null, input.toolName ?? null, input.action, input.target?.entityType ?? null, input.target?.entityId ?? null, auditJson(input.request), auditJson(input.before), auditJson(input.after), input.result, input.ip ?? null);
    return id;
  } catch {
    return undefined;
  }
}
