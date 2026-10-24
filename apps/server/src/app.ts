import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { getSetting, createBackup, isBackupValid, WEEKLY_BACKUP_RETAIN, type PaiosDatabase, type WeeklyBackupResult } from "@paios/db";
import { ACCOUNT_LABELS, BUTLER_ALLOWED_TOOLS, EXPENSE_MAJORS, EXPENSE_MINORS, INCOME_MAJORS, INCOME_MINORS, assertNoCycle, computeProjectProgress, financeQuickParse, localDateInTimezone, monthStart, parseCsv, parseIcs, shouldArchiveIdea, shouldArchiveTask, sleepMinutes } from "@paios/core";
import { butlerChatRequestSchema, createIdeaSchema, createProjectSchema, createTaskSchema, financeEntrySchema, healthLogSchema, patchFinanceEntrySchema, patchIdeaSchema, patchProjectSchema, patchTaskSchema } from "@paios/api-types";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ServerConfig } from "./config.js";
import { hasLlmApiKey, readLlmApiKey, writeLlmApiKey } from "./secrets.js";
import { inspectRecurrences, runRecurrenceSync, type RecurrenceSyncResult } from "./recurrence.js";
import { createRecurrenceTemplate, runRecurrenceSyncWithRetry, syncTemplateAfterWrite, syncTemplateAfterWriteWithRetry, updateRecurrenceTemplate } from "./recurrence-service.js";
import { AGENT_SCOPE_PRESETS, authenticateAgent, createAgentToken, hasScope, isAgentTransport, isForbiddenAgentOperation, parseScopes, requestAgentAuth, requiredScope, scopeLabel, scopePreset, type AgentAuth } from "./auth.js";
import { ButlerAgentError, butlerAgentHistory, runButlerAgent, type ButlerToolTrace } from "./butler-agent.js";
import { TOOL_CATALOG } from "./tool-catalog.js";
import { buildCapabilities, isCapabilitiesQuestion } from "./capabilities.js";
import { inferAuditTarget, readAuditTarget, recordAudit, responseEntityId } from "./audit.js";
import { generateDailyPlanForDate, readDailyPlan } from "./planner.js";
import { generateDailyReviewDraft } from "./review-drafts.js";
import { agentCannotWriteProject, agentProjectAdvancementBlocked, buildAttentionSnapshot, buildDailyPlanningContext, buildStagePlanningContext, countTasksByExecutionPeriod, currentStagePlan, generatePeriodReviewDraft, isButlerWriteIntent, PAUSED_PROJECT_ADVANCEMENT_ERROR, projectIdForMilestone, shiftIsoDate, updateDailyPlanText, upsertPeriodPlan } from "./planning.js";
import { runArchiveRetentionCleanup } from "./archive-retention.js";
import { addProjectActivity, getOrCreateProjectParentTask, PROJECT_TEMPLATES, projectActivities, projectFinanceSummary, projectTaskPlans, projectTemplate, refreshParentTaskDueDate, syncProjectPlansForTodo, syncUpcomingCheckpointsToTodos } from "./project-service.js";

type AppContext = {
  database: PaiosDatabase;
  config: ServerConfig;
  recurrenceSync?: Promise<RecurrenceSyncResult>;
  weeklyBackup?: WeeklyBackupResult;
  directMcp?: boolean;
};

const now = () => new Date().toISOString();

function requiresUiSession(context: Context): boolean {
  const path = context.req.path;
  if (context.req.method === "GET" || context.req.method === "HEAD") return false;
  return (
    /\/confirmations\/[^/]+\/(approve|reject)$/.test(path) ||
    /\/system\/(restore|export)$/.test(path) ||
    /\/system\/archive-retention\/check$/.test(path) ||
    /\/archive\/(restore|delete|delete-batch|purge-request)(\/|$)/.test(path) ||
    /\/task-recurrences\/[^/]+$/.test(path) && context.req.method === "DELETE" ||
    /\/conversations\/[^/]+\/archive$/.test(path)
  );
}



function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|abort/i.test(error.message));
}

function saveButlerAssistant(database: PaiosDatabase, conversationId: string, content: string, traces: ButlerToolTrace[]) {
  const assistantId = randomUUID();
  const timestamp = now();
  database.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content_text, attachments_json, created_at) VALUES (?, ?, 'assistant', ?, '[]', ?)").run(assistantId, conversationId, content, timestamp);
  for (const trace of traces) {
    database.prepare("INSERT INTO conversation_tool_calls (id, conversation_id, message_id, tool_name, arguments_json, result_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(randomUUID(), conversationId, assistantId, trace.name, JSON.stringify(trace.arguments).slice(0, 20000), JSON.stringify({ source: trace.source }).slice(0, 20000), trace.ok ? "ok" : "error", timestamp);
  }
  database.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(timestamp, conversationId);
  return { id: assistantId, created_at: timestamp };
}

function normalizeTaskStatus(status: unknown): "todo" | "done" | "cancelled" {
  if (status === "done") return "done";
  if (status === "cancelled") return "cancelled";
  return "todo";
}

function normalizeIdeaCategory(category: unknown): "project" | "long_term" | "short_term" {
  if (category === "project" || category === "long_term" || category === "short_term") return category;
  return "short_term";
}

function toFlag(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  return value === true || value === 1 ? 1 : 0;
}

const FINANCE_EXPENSE_TAXONOMY = { majors: EXPENSE_MAJORS, minors: EXPENSE_MINORS };
const FINANCE_INCOME_TAXONOMY = { majors: INCOME_MAJORS, minors: INCOME_MINORS };
const FINANCE_ACCOUNT_LABELS = Object.entries(ACCOUNT_LABELS).map(([value, info]) => ({ value, ...info }));

type FinanceKind = "expense" | "income";
type FinanceQuickButton = {
  id: string;
  name: string;
  kind: FinanceKind;
  category_major: string;
  category_minor: string;
  event?: string;
  occurred_date?: string;
  account_id?: string;
  project_id?: string;
};

function parseQuickButtons(database: PaiosDatabase): FinanceQuickButton[] {
  const value = getSetting(database, "finance.quick_buttons", []) as unknown;
  const buttons = Array.isArray(value) ? value.flatMap((item): FinanceQuickButton[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const major = typeof row.category_major === "string" ? row.category_major : row.major;
    const minor = typeof row.category_minor === "string" ? row.category_minor : row.minor;
    const name = typeof row.name === "string" ? row.name : row.label;
    if (typeof row.id !== "string" || typeof name !== "string" || typeof major !== "string" || typeof minor !== "string") return [];
    const kind = row.kind === "income" ? "income" : "expense";
    return [{ id: row.id, name, kind, category_major: major, category_minor: minor, event: typeof row.event === "string" ? row.event : undefined, occurred_date: typeof row.occurred_date === "string" ? row.occurred_date : undefined, account_id: typeof row.account_id === "string" ? row.account_id : undefined }];
  }) : [];
  const projects = database.prepare("SELECT id, name FROM projects WHERE archived_at IS NULL AND benefit_enabled = 1 ORDER BY name COLLATE NOCASE").all() as Array<{ id: string; name: string }>;
  return [...buttons, ...projects.flatMap((project) => [
    { id: `project-income-${project.id}`, name: project.name, kind: "income" as const, category_major: "项目收入", category_minor: project.name, event: project.name, project_id: project.id },
    { id: `project-expense-${project.id}`, name: project.name, kind: "expense" as const, category_major: "项目支出", category_minor: project.name, event: project.name, project_id: project.id }
  ])];
}

function resolveFinanceFields(database: PaiosDatabase, body: Record<string, unknown>, kind: FinanceKind) {
  const button = typeof body.quick_button_id === "string"
    ? parseQuickButtons(database).find((item) => item.id === body.quick_button_id && item.kind === kind)
    : undefined;
  if (body.quick_button_id !== undefined && !button) return { error: "quick_button_id is invalid for this finance entry" } as const;
  const timezone = getSetting(database, "timezone", "Asia/Shanghai");
  // Ordinary expenses and incomes never consume or credit an account.
  // Account deposits/withdrawals use the separate account-entry endpoint.
  const accountId = undefined;
  const occurredDate = button?.occurred_date ?? (typeof body.occurred_date === "string" ? body.occurred_date : localDateInTimezone(timezone));
  const major = button?.category_major ?? (typeof body.category_major === "string" ? body.category_major : "");
  const minor = button?.category_minor ?? (typeof body.category_minor === "string" ? body.category_minor : "");
  const category = typeof body.category === "string" && body.category.trim() ? body.category.trim() : [major, minor].filter(Boolean).join(" / ") || "未分类";
  const event = button?.event ?? (typeof body.event === "string" ? body.event : typeof body.note === "string" ? body.note : "");
  return { accountId, occurredDate, major, minor, category, projectId: button?.project_id ?? (body.project_id === null ? null : typeof body.project_id === "string" ? body.project_id : undefined), event, note: typeof body.note === "string" ? body.note : event, currency: typeof body.currency === "string" ? body.currency : "CNY" } as const;
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    return /^https?:$/.test(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}

function validTime(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour = -1, minute = -1] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function reviewForResponse(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  let content: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.content_json ?? "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) content = parsed as Record<string, unknown>;
  } catch {
    // Keep malformed legacy JSON visible without making the whole endpoint fail.
  }
  const { content_json: _contentJson, ...rest } = row;
  return { ...rest, content };
}

function normalizeReviewStatus(value: unknown): "draft" | "finalized" | undefined {
  if (value === "draft") return "draft";
  if (value === "finalized" || value === "completed" || value === "已完成") return "finalized";
  return undefined;
}

function parseArchivedFilter(c: Context): boolean | Response {
  const value = c.req.query("archived");
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "archived must be 0 or 1" } }, 400);
}

function parseDateRange(c: Context): { from?: string; to?: string } | Response {
  const from = c.req.query("from");
  const to = c.req.query("to");
  if (from === undefined && to === undefined) return {};
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "from and to must be valid dates" } }, 400);
  }
  return { from, to };
}

function parseFinanceCategoryFilters(c: Context): { major?: string; minor?: string } {
  const major = c.req.query("category_major")?.trim();
  const minor = c.req.query("category_minor")?.trim();
  return { major: major || undefined, minor: minor || undefined };
}

function normalizeAccountEntryDirection(value: unknown): "deposit" | "withdrawal" | undefined {
  if (value === "deposit" || value === "withdrawal") return value;
  return undefined;
}

function accountEntryDelta(amount: number, direction: "deposit" | "withdrawal"): number {
  return direction === "withdrawal" ? -amount : amount;
}

function archiveTable(entity: unknown): "tasks" | "ideas" | "projects" | "project_task_plans" | "conversations" | "daily_plans" | "period_plans" | null {
  if (entity === "task" || entity === "tasks") return "tasks";
  if (entity === "idea" || entity === "ideas") return "ideas";
  if (entity === "project" || entity === "projects") return "projects";
  if (entity === "project_task" || entity === "project_tasks" || entity === "project_task_plan" || entity === "project_task_plans") return "project_task_plans";
  if (entity === "conversation" || entity === "conversations") return "conversations";
  if (entity === "plan" || entity === "plans" || entity === "daily_plan" || entity === "daily_plans") return "daily_plans";
  if (entity === "stage_plan" || entity === "stage_plans" || entity === "period_plan" || entity === "period_plans") return "period_plans";
  return null;
}

function normalizeProjectTaskStatus(status: unknown, fallback: string): "todo" | "doing" | "done" | "cancelled" {
  if (status === "doing" || status === "done" || status === "cancelled" || status === "todo") return status;
  if (fallback === "doing" || fallback === "done" || fallback === "cancelled") return fallback;
  return "todo";
}

function unlinkMissingProjectTaskTodo(database: PaiosDatabase, id: string): void {
  const row = database.prepare("SELECT todo_task_id FROM project_task_plans WHERE id = ?").get(id) as { todo_task_id?: string | null } | undefined;
  if (!row?.todo_task_id) return;
  if (database.prepare("SELECT id FROM tasks WHERE id = ?").get(row.todo_task_id)) return;
  database.prepare("UPDATE project_task_plans SET todo_task_id = NULL WHERE id = ?").run(id);
}

function parseBody<T>(value: unknown, schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { issues: unknown } } }) {
  const result = schema.safeParse(value);
  if (!result.success) return { error: result.error } as const;
  return { data: result.data as T } as const;
}

function notFound(c: Context, entity: string) {
  return c.json({ ok: false, error: { code: "NOT_FOUND", message: `${entity} not found` } }, 404);
}

function localToday(database: PaiosDatabase): string {
  return localDateInTimezone(getSetting(database, "timezone", "Asia/Shanghai"));
}

function rejectAgentProjectWrite(c: Context, database: PaiosDatabase, projectId?: string | null) {
  if (!c.get("agentAuth")) return null;
  const today = localToday(database);
  const message = projectId ? agentCannotWriteProject(database, today, projectId) : agentProjectAdvancementBlocked(database, today);
  if (!message) return null;
  return c.json({ ok: false, error: { code: "FORBIDDEN", message } }, 403);
}

function agentSetup(config: ServerConfig, token: string) {
  const executable = process.env.PAIOS_MCP_COMMAND?.trim();
  if (executable) return { command: executable, args: ["--mcp"], env: { PAIOS_TOKEN: token } };
  return { command: "pnpm", args: ["--filter", "@paios/server", "mcp"], env: { PAIOS_URL: `http://${config.bind}:${config.port}`, PAIOS_TOKEN: token } };
}

async function readJsonClone(request: Request): Promise<unknown> {
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}

async function readResponseJson(response: Response | undefined): Promise<unknown> {
  if (!response) return undefined;
  try {
    return await response.clone().json();
  } catch {
    return undefined;
  }
}

export function createApp(context: AppContext): Hono<{ Variables: { agentAuth: AgentAuth | null } }> {
  const app = new Hono<{ Variables: { agentAuth: AgentAuth | null } }>();
  const uiSessionToken = randomUUID().replaceAll("-", "");
  try { syncUpcomingCheckpointsToTodos(context.database); } catch {}
  app.use("/api/*", cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"], allowHeaders: ["Content-Type", "Authorization", "X-PAIOS-Agent-Transport", "X-Agent-Name", "X-Tool-Name", "X-PAIOS-UI-Session", "X-PAIOS-Idempotency-Key"], credentials: true }));
  app.use("/api/v1/*", async (c, next) => {
    const auth = requestAgentAuth(context.database, c);
    if (auth.error === "missing") return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Agent token is required" } }, 401);
    if (auth.error === "invalid") return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Agent token is invalid or revoked" } }, 401);
    c.set("agentAuth", auth.auth);
    if (auth.auth && isForbiddenAgentOperation(c)) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "This operation is only available to the human UI" } }, 403);
    if (requiresUiSession(c) && c.req.header("X-PAIOS-UI-Session") !== uiSessionToken) return c.json({ ok: false, error: { code: "UI_SESSION_REQUIRED", message: "This operation must come from the human UI" } }, 403);
    if (auth.auth && isAgentTransport(c) && !hasScope(auth.auth, requiredScope(c))) return c.json({ ok: false, error: { code: "FORBIDDEN", message: `Missing scope: ${requiredScope(c)}` } }, 403);
    if (context.directMcp && existsSync(join(context.config.dataDir, "restore.pending.db"))) {
      return c.json({ ok: false, error: { code: "PENDING_RESTORE_REQUIRES_RESTART", message: "本地存在待恢复数据，请先关闭图形界面并重启 Personal AI OS" } }, 409);
    }
    const idempotencyKey = auth.auth && c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.header("X-PAIOS-Idempotency-Key")?.trim() : undefined;
    const toolName = c.req.header("X-Tool-Name") ?? `${c.req.method} ${c.req.path}`;
    if (idempotencyKey) {
      const cached = context.database.prepare("SELECT tool_name, result_json FROM agent_idempotency WHERE idempotency_key = ?").get(idempotencyKey) as { tool_name: string; result_json: string } | undefined;
      if (cached) {
        if (cached.tool_name !== toolName) return c.json({ ok: false, error: { code: "CONFLICT", message: "Idempotency key was already used for another tool" } }, 409);
        try {
          const cachedResponse = JSON.parse(cached.result_json) as { status: number; body: unknown };
          return new Response(JSON.stringify(cachedResponse.body), { status: cachedResponse.status, headers: { "Content-Type": "application/json" } });
        } catch {
          return c.json({ ok: false, error: { code: "CONFLICT", message: "Idempotency record is invalid; use a new key" } }, 409);
        }
      }
    }
    if (context.recurrenceSync) await context.recurrenceSync;
    const auditTarget = c.req.method === "GET" || c.req.method === "HEAD" ? undefined : inferAuditTarget(c.req.path);
    const auditBefore = readAuditTarget(context.database, auditTarget);
    const auditRequest = auth.auth ? await readJsonClone(c.req.raw) : undefined;
    await next();
    if (c.req.method === "GET" || c.req.method === "HEAD") return;
    try {
      const agent = c.get("agentAuth");
      const responseJson = await readResponseJson(c.res);
      const target = auditTarget && !auditTarget.entityId
        ? { ...auditTarget, entityId: responseEntityId(responseJson) }
        : auditTarget;
      recordAudit(context.database, {
        actor: agent ? "agent" : "user",
        agentTokenId: agent?.tokenId ?? null,
        agentName: agent?.name ?? null,
        toolName: c.req.header("X-Tool-Name") ?? null,
        action: `${c.req.method} ${c.req.path}`,
        target,
        request: auditRequest,
        before: auditBefore,
        after: readAuditTarget(context.database, target),
        result: c.res.status < 400 ? "ok" : "error",
        ip: c.req.header("X-Forwarded-For") ?? null
      });
      if (idempotencyKey && c.res.status < 400) {
        const responseJson = await readResponseJson(c.res);
        if (responseJson !== undefined) {
          context.database.prepare("INSERT OR IGNORE INTO agent_idempotency (idempotency_key, tool_name, result_json, created_at) VALUES (?, ?, ?, ?)").run(idempotencyKey, toolName, JSON.stringify({ status: c.res.status, body: responseJson }), now());
        }
      }
    } catch {
      // Audit failure must not turn a successful user action into a failed action.
    }
  });

  app.get("/api/v1/system/status", (c) => {
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const date = localDateInTimezone(timezone);
    const attention = buildAttentionSnapshot(context.database, date);
    return c.json({
      ok: true,
      version: "2.0.0",
      dataDir: context.config.dataDir,
      database: "ok",
      lock: "held",
      bind: context.config.bind,
      port: context.config.port,
      weekly_backup: context.weeklyBackup ?? null,
      attention: {
        date: attention.date,
        phase: attention.phase,
        itemCount: attention.items.length,
        overdue: attention.overdue.length,
        undated: attention.undated.length,
        pending_confirmations: attention.pending_confirmations
      }
    });
  });

  app.get("/api/v1/system/attention", (c) => {
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const date = localDateInTimezone(timezone);
    return c.json({ ok: true, ...buildAttentionSnapshot(context.database, date) });
  });

  app.post("/api/v1/system/archive-retention/check", async (c) => {
    const cleanup = await runArchiveRetentionCleanup({ database: context.database, dataDir: context.config.dataDir });
    return c.json({ ok: cleanup.status !== "failed", cleanup });
  });

  app.get("/api/v1/planning/context", (c) => {
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const today = localDateInTimezone(timezone);
    const mode = c.req.query("mode") === "stage" ? "stage" : "daily";
    if (mode === "stage") {
      const covering = currentStagePlan(context.database, today);
      const periodStart = c.req.query("period_start") || (typeof covering?.period_start === "string" ? covering.period_start : today);
      const periodEnd = c.req.query("period_end") || (typeof covering?.period_end === "string" ? covering.period_end : shiftIsoDate(today, 6));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "period_start and period_end must be YYYY-MM-DD" } }, 400);
      return c.json({ ok: true, ...buildStagePlanningContext(context.database, periodStart, periodEnd, today) });
    }
    const date = c.req.query("date") || shiftIsoDate(today, 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "date must be YYYY-MM-DD" } }, 400);
    return c.json({ ok: true, ...buildDailyPlanningContext(context.database, date, today) });
  });

  app.get("/api/v1/system/capabilities", (c) => c.json(buildCapabilities(c.get("agentAuth"))));

  app.get("/api/v1/system/ui-session", (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "UI session is not available to Agents" } }, 403);
    return c.json({ ok: true, session: uiSessionToken });
  });

  app.get("/api/v1/settings", (c) => {
    const rows = context.database.prepare("SELECT key, value_json FROM app_settings ORDER BY key").all() as Array<{ key: string; value_json: string }>;
    return c.json({ ok: true, settings: Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)])) });
  });

  app.patch("/api/v1/settings", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const allowed = new Set(["theme", "timezone", "currency", "week_starts_on", "bind", "port", "backup.retain", "archive.purge_after_days", "archive.scan_weekday"]);
    const timestamp = now();
    let restartRequired = false;
    const write = context.database.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        if (key === "confirm_non_localhost") continue;
        if (!allowed.has(key)) throw new Error(`SETTING_NOT_ALLOWED:${key}`);
        if (key === "theme" && value !== "dark" && value !== "light") throw new Error("INVALID_THEME");
        if (key === "backup.retain" && (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > WEEKLY_BACKUP_RETAIN)) throw new Error("INVALID_BACKUP_RETAIN");
        if (key === "timezone") {
          try { new Intl.DateTimeFormat("en-US", { timeZone: String(value) }).format(); } catch { throw new Error("INVALID_TIMEZONE"); }
        }
        if (key === "bind" && value !== "127.0.0.1") {
          if (body.confirm_non_localhost !== true) throw new Error("NON_LOCALHOST_REQUIRES_CONFIRMATION");
          restartRequired = true;
        }
        if (key === "port") restartRequired = true;
        context.database.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(key, JSON.stringify(value), timestamp);
      }
    });
    try { write(); } catch (error) { return c.json({ ok: false, error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid setting" } }, 400); }
    return c.json({ ok: true, restartRequired });
  });

  app.get("/api/v1/workbench/config", (c) => c.json({
    ok: true,
    enabled: getSetting(context.database, "workbench.enabled", true),
    base_url: getSetting(context.database, "llm.base_url", process.env.PAIOS_LLM_BASE_URL || ""),
    model: getSetting(context.database, "llm.model", process.env.PAIOS_LLM_MODEL || ""),
    api_key_configured: hasLlmApiKey(context.config.dataDir)
  }));

  app.patch("/api/v1/workbench/config", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const baseUrl = body.base_url === undefined ? undefined : normalizeHttpUrl(body.base_url);
    const model = body.model;
    if (baseUrl !== undefined) {
      if (!baseUrl) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "base_url must use http(s)" } }, 400);
    }
    if (model !== undefined && (typeof model !== "string" || model.trim().length === 0)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "model must be a non-empty string" } }, 400);
    const timestamp = now();
    const write = context.database.transaction(() => {
      if (baseUrl !== undefined) context.database.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('llm.base_url', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(JSON.stringify(baseUrl), timestamp);
      if (model !== undefined) context.database.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('llm.model', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(JSON.stringify(model), timestamp);
      if (body.enabled !== undefined) context.database.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES ('workbench.enabled', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run(JSON.stringify(body.enabled === true), timestamp);
    });
    write();
    return c.json({ ok: true, config: { enabled: getSetting(context.database, "workbench.enabled", true), base_url: getSetting(context.database, "llm.base_url", ""), model: getSetting(context.database, "llm.model", "") } });
  });

  app.get("/api/v1/settings/api-key", (c) => c.json({ ok: true, configured: hasLlmApiKey(context.config.dataDir) }));

  app.put("/api/v1/settings/api-key", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.api_key !== "string" || body.api_key.length > 500) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "api_key must be a string with at most 500 characters" } }, 400);
    try {
      writeLlmApiKey(context.config.dataDir, body.api_key);
      return c.json({ ok: true, configured: hasLlmApiKey(context.config.dataDir) });
    } catch {
      return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "无法保存 API Key" } }, 500);
    }
  });

  app.get("/api/v1/settings/agent-tokens", (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agent token management is only available to the human UI" } }, 403);
    const tokens = (context.database.prepare("SELECT id, name, scopes_json, created_at, last_used_at, expires_at, revoked_at FROM api_tokens ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      name: String(row.name),
      scopes: [...parseScopes(String(row.scopes_json ?? "[]"))],
      scope_label: scopeLabel([...parseScopes(String(row.scopes_json ?? "[]"))]),
      created_at: row.created_at,
      last_used_at: row.last_used_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at
    }));
    return c.json({ ok: true, presets: Object.keys(AGENT_SCOPE_PRESETS), tokens });
  });

  app.post("/api/v1/settings/agent-tokens", async (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agent token management is only available to the human UI" } }, 403);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 100) : "我的 Agent";
    const scopes = scopePreset(body.preset ?? "readonly");
    if (!scopes) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "preset is invalid" } }, 400);
    const expiresAt = body.expires_at === undefined || body.expires_at === null || body.expires_at === "" ? null : typeof body.expires_at === "string" && !Number.isNaN(Date.parse(body.expires_at)) ? new Date(body.expires_at).toISOString() : undefined;
    if (expiresAt === undefined) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "expires_at is invalid" } }, 400);
    const token = createAgentToken();
    const id = randomUUID();
    context.database.prepare("INSERT INTO api_tokens (id, name, token_hash, scopes_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, name, createHash("sha256").update(token).digest("hex"), JSON.stringify(scopes), now(), expiresAt);
    return c.json({ ok: true, token: { id, name, scopes, expires_at: expiresAt, value: token }, setup: agentSetup(context.config, token) }, 201);
  });

  app.post("/api/v1/settings/agent-tokens/:id/revoke", (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agent token management is only available to the human UI" } }, 403);
    const result = context.database.prepare("UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(now(), c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "agent token");
    return c.json({ ok: true });
  });

  app.post("/api/v1/settings/agent-tokens/:id/rotate", (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agent token management is only available to the human UI" } }, 403);
    const current = context.database.prepare("SELECT id, name, scopes_json, expires_at, revoked_at FROM api_tokens WHERE id = ?").get(c.req.param("id")) as { id: string; name: string; scopes_json: string; expires_at: string | null; revoked_at: string | null } | undefined;
    if (!current) return notFound(c, "agent token");
    const token = createAgentToken();
    const id = randomUUID();
    const timestamp = now();
    const rotate = context.database.transaction(() => {
      context.database.prepare("UPDATE api_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?").run(timestamp, current.id);
      context.database.prepare("INSERT INTO api_tokens (id, name, token_hash, scopes_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, `${current.name}（轮换）`, createHash("sha256").update(token).digest("hex"), current.scopes_json, timestamp, current.expires_at);
    });
    rotate();
    const scopes = [...parseScopes(current.scopes_json)];
    return c.json({ ok: true, token: { id, name: `${current.name}（轮换）`, scopes, expires_at: current.expires_at, value: token }, setup: agentSetup(context.config, token) }, 201);
  });

  app.post("/api/v1/settings/agent-tokens/test", async (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agent connection testing is only available to the human UI" } }, 403);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const value = typeof body.token === "string" ? body.token.trim() : "";
    const auth = authenticateAgent(context.database, value);
    if (!auth) return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "Token is invalid, expired or revoked" } }, 401);
    const readableTools = Object.entries(TOOL_CATALOG).filter(([, entry]) => hasScope(auth, `${entry.domain}:read`)).map(([name]) => name);
    const writableTools = Object.entries(TOOL_CATALOG).filter(([, entry]) => entry.access === "ordinary_write" && hasScope(auth, `${entry.domain}:write`)).map(([name]) => name);
    return c.json({
      ok: true,
      connection: {
        service: "ok",
        token: { id: auth.tokenId, name: auth.name, scopes: [...auth.scopes] },
        tool_catalog_version: "2",
        readable_tool_count: readableTools.length,
        writable_tool_count: writableTools.length,
        readable_tools: readableTools,
        writable_tools: writableTools,
        timezone: getSetting(context.database, "timezone", "Asia/Shanghai")
      }
    });
  });

  app.get("/api/v1/settings/agent-tokens/activity", (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agent activity is only available to the human UI" } }, 403);
    const activity = context.database.prepare("SELECT at, agent_name, tool_name, action, result FROM audit_logs WHERE actor = 'agent' ORDER BY at DESC LIMIT 20").all();
    return c.json({ ok: true, activity });
  });

  app.get("/api/v1/conversations", (c) => c.json({
    ok: true,
    conversations: context.database.prepare("SELECT id, title, project_id, archived_at, created_at, updated_at FROM conversations WHERE archived_at IS NULL ORDER BY updated_at DESC").all()
  }));

  app.post("/api/v1/conversations", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 100) : "新对话";
    const id = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO conversations (id, title, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(id, title, typeof body.project_id === "string" ? body.project_id : null, timestamp, timestamp);
    return c.json({ ok: true, conversation: context.database.prepare("SELECT * FROM conversations WHERE id = ?").get(id) }, 201);
  });

  app.get("/api/v1/conversations/:id", (c) => {
    const id = c.req.param("id");
    const conversation = context.database.prepare("SELECT * FROM conversations WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!conversation) return notFound(c, "conversation");
    const messages = (context.database.prepare("SELECT id, role, content_text, attachments_json, created_at FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC").all(id) as Array<Record<string, unknown>>).map((message) => ({
      ...message,
      tool_calls: (context.database.prepare("SELECT tool_name, arguments_json, result_json, status, created_at FROM conversation_tool_calls WHERE message_id = ? ORDER BY created_at ASC").all(message.id) as Array<Record<string, unknown>>).map((trace) => {
        let result: Record<string, unknown> = {};
        try { result = JSON.parse(String(trace.result_json ?? "{}")) as Record<string, unknown>; } catch { /* Keep the source label empty for malformed legacy traces. */ }
        return { name: trace.tool_name, source: result.source ?? trace.tool_name, ok: trace.status === "ok", arguments_json: trace.arguments_json, status: trace.status, created_at: trace.created_at };
      })
    }));
    return c.json({ ok: true, conversation, messages });
  });

  app.post("/api/v1/conversations/:id/archive", (c) => {
    const result = context.database.prepare("UPDATE conversations SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(now(), now(), c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "conversation");
    return c.json({ ok: true });
  });

  app.delete("/api/v1/conversations/:id", (c) => {
    const id = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM conversations WHERE id = ?").get(id)) return notFound(c, "conversation");
    const remove = context.database.transaction(() => {
      context.database.prepare("DELETE FROM attachments WHERE conversation_id = ?").run(id);
      context.database.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(id);
      context.database.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    });
    remove();
    return c.json({ ok: true });
  });

  app.post("/api/v1/conversations/:id/messages", async (c) => {
    const conversationId = c.req.param("id");
    const conversation = context.database.prepare("SELECT * FROM conversations WHERE id = ? AND archived_at IS NULL").get(conversationId) as Record<string, unknown> | undefined;
    if (!conversation) return notFound(c, "conversation");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.content !== "string" || !body.content.trim() || body.content.length > 20000) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "content is required and must be <= 20000 characters" } }, 400);
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const savedAttachments: Array<{ id: string; filename: string; mime: string; byte_size: number }> = [];
    const outboundAttachments: Array<{ mime: string; dataUrl: string }> = [];
    for (const item of attachments.slice(0, 4)) {
      if (!item || typeof item !== "object") continue;
      const value = item as Record<string, unknown>;
      const dataUrl = typeof value.data_url === "string" ? value.data_url : "";
      const filename = typeof value.filename === "string" && value.filename.trim() ? value.filename.trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) : "image";
      const mime = typeof value.mime === "string" && value.mime.startsWith("image/") ? value.mime : "application/octet-stream";
      if (!dataUrl.startsWith("data:") || !dataUrl.includes(",")) continue;
      const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
      let bytes: Buffer;
      try { bytes = Buffer.from(encoded, "base64"); } catch { continue; }
      if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) continue;
      const attachmentId = randomUUID();
      const attachmentDir = join(context.config.dataDir, "attachments");
      mkdirSync(attachmentDir, { recursive: true });
      const relpath = join("attachments", `${attachmentId}-${filename}`);
      writeFileSync(join(context.config.dataDir, relpath), bytes);
      savedAttachments.push({ id: attachmentId, filename, mime, byte_size: bytes.length });
      outboundAttachments.push({ mime, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` });
      context.database.prepare("INSERT INTO attachments (id, conversation_id, filename, mime, byte_size, relpath, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(attachmentId, conversationId, filename, mime, bytes.length, relpath, now());
    }
    const userMessageId = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content_text, attachments_json, created_at) VALUES (?, ?, 'user', ?, ?, ?)").run(userMessageId, conversationId, body.content.trim(), JSON.stringify(savedAttachments), timestamp);
    if (savedAttachments.length) context.database.prepare(`UPDATE attachments SET message_id = ? WHERE conversation_id = ? AND id IN (${savedAttachments.map(() => "?").join(",")})`).run(userMessageId, conversationId, ...savedAttachments.map((item) => item.id));
    context.database.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(timestamp, conversationId);
    if (isCapabilitiesQuestion(body.content)) {
      const capabilities = buildCapabilities(null);
      const saved = saveButlerAssistant(context.database, conversationId, capabilities.answer, [{ name: "capabilities_get", arguments: {}, source: "固定能力说明", ok: true }]);
      return c.json({ ok: true, message: { id: saved.id, role: "assistant", content_text: capabilities.answer, attachments_json: "[]", created_at: saved.created_at, tool_calls: [{ name: "capabilities_get", source: "固定能力说明", ok: true }] }, user_message_id: userMessageId });
    }
    const apiKey = readLlmApiKey(context.config.dataDir);
    const baseUrl = String(getSetting(context.database, "llm.base_url", process.env.PAIOS_LLM_BASE_URL || "")).trim();
    const model = getSetting(context.database, "llm.model", process.env.PAIOS_LLM_MODEL || "");
    if (!baseUrl || !apiKey || !model) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "请先在设置中配置 Base URL、模型和 API Key" } }, 400);
    let endpoint: URL;
    try { endpoint = new URL("chat/completions", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`); if (!/^https?:$/.test(endpoint.protocol)) throw new Error("unsupported protocol"); }
    catch { return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "base_url is invalid" } }, 400); }
    const history = context.database.prepare("SELECT role, content_text FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conversationId) as Array<{ role: "user" | "assistant"; content_text: string }>;
    const date = localDateInTimezone(getSetting(context.database, "timezone", "Asia/Shanghai"));
    let agentResult: Awaited<ReturnType<typeof runButlerAgent>>;
    try {
      agentResult = await runButlerAgent({ database: context.database, endpoint, apiKey, model, date, history: butlerAgentHistory(history), currentAttachments: outboundAttachments, allowWrites: isButlerWriteIntent(body.content), idempotencyNamespace: userMessageId, signal: c.req.raw.signal });
    } catch (error) {
      if (error instanceof ButlerAgentError && error.traces.length > 0) {
        const failureMessage = isAbortError(error) ? "本次回答已取消，但已执行的工具操作已记录，请以工具来源为准。" : "管家回答未完成，但已执行的工具操作已记录，请以工具来源为准。";
        const saved = saveButlerAssistant(context.database, conversationId, failureMessage, error.traces);
        if (c.req.raw.signal.aborted || isAbortError(error)) return c.json({ ok: false, error: { code: "CANCELLED", message: failureMessage }, message: { id: saved.id, role: "assistant", content_text: failureMessage, tool_calls: error.traces }, user_message_id: userMessageId }, 408);
        return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: error.message }, message: { id: saved.id, role: "assistant", content_text: failureMessage, tool_calls: error.traces }, user_message_id: userMessageId }, 502);
      }
      if (isAbortError(error) || c.req.raw.signal.aborted) return c.json({ ok: false, error: { code: "CANCELLED", message: "本次回答已取消，已发送的用户消息仍保留" } }, 408);
      return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "LLM request failed" } }, 502);
    }
    const content = agentResult.content;
    const saved = saveButlerAssistant(context.database, conversationId, content, agentResult.traces);
    return c.json({ ok: true, message: { id: saved.id, role: "assistant", content_text: content, attachments_json: "[]", created_at: saved.created_at, tool_calls: agentResult.traces }, user_message_id: userMessageId });
  });

  app.post("/api/v1/butler/chat", async (c) => {
    const parsed = butlerChatRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    if (!getSetting(context.database, "workbench.enabled", true)) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Workbench is disabled" } }, 403);
    const data = parsed.data;
    const baseUrl = (data.base_url || String(getSetting(context.database, "llm.base_url", process.env.PAIOS_LLM_BASE_URL || ""))).trim();
    const apiKey = readLlmApiKey(context.config.dataDir);
    const model = data.model || getSetting(context.database, "llm.model", process.env.PAIOS_LLM_MODEL || "");
    if (!baseUrl || !apiKey || !model) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "请先在设置中配置 Base URL、模型和 API Key" } }, 400);
    let endpoint: URL;
    try {
      const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      endpoint = new URL("chat/completions", normalizedBase);
      if (!/^https?:$/.test(endpoint.protocol)) throw new Error("unsupported protocol");
    } catch {
      return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "base_url is invalid" } }, 400);
    }
    const date = localDateInTimezone(getSetting(context.database, "timezone", "Asia/Shanghai"));
    let agentResult: Awaited<ReturnType<typeof runButlerAgent>>;
    try {
      const lastUserMessage = [...data.messages].reverse().find((item) => item.role === "user")?.content ?? "";
      agentResult = await runButlerAgent({ database: context.database, endpoint, apiKey, model, date, history: butlerAgentHistory(data.messages.map((item) => ({ role: item.role, content_text: item.content }))), allowWrites: isButlerWriteIntent(lastUserMessage), idempotencyNamespace: `legacy:${randomUUID()}`, signal: c.req.raw.signal });
    } catch (error) {
      if (isAbortError(error) || c.req.raw.signal.aborted) return c.json({ ok: false, error: { code: "CANCELLED", message: "本次回答已取消" } }, 408);
      return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: error instanceof Error ? `LLM request failed: ${error.message}` : "LLM request failed" } }, 502);
    }
    return c.json({ ok: true, message: { role: "assistant", content: agentResult.content }, model, date, sources: agentResult.traces, allowed_tools: BUTLER_ALLOWED_TOOLS });
  });

  app.get("/api/v1/audit", (c) => c.json({ ok: true, audit: context.database.prepare("SELECT * FROM audit_logs ORDER BY at DESC LIMIT 200").all() }));

  app.get("/api/v1/system/backups", (c) => {
    const backupDir = join(context.config.dataDir, "backups");
    if (!existsSync(backupDir)) return c.json({ ok: true, backups: [], weekly_backups: [], weekly_retention: WEEKLY_BACKUP_RETAIN, weekly_backup: context.weeklyBackup ?? null });
    const backups = readdirSync(backupDir).filter((file) => file.endsWith(".db")).map((file) => {
      const path = join(backupDir, file);
      return { name: file, path, size: statSync(path).size, valid: isBackupValid(path) };
    }).sort((a, b) => b.name.localeCompare(a.name));
    const weeklyBackups = backups.filter((backup) => /^weekly-\d{4}-\d{2}-\d{2}\.db$/.test(backup.name));
    return c.json({ ok: true, backups, weekly_backups: weeklyBackups, weekly_retention: WEEKLY_BACKUP_RETAIN, weekly_backup: context.weeklyBackup ?? null });
  });

  app.post("/api/v1/system/restore", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.path !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "backup path is required" } }, 400);
    const backupDir = resolve(join(context.config.dataDir, "backups"));
    const candidate = resolve(isAbsolute(body.path) ? body.path : join(backupDir, body.path));
    const relativePath = relative(backupDir, candidate);
    if (!existsSync(candidate) || relativePath.startsWith("..") || isAbsolute(relativePath) || !candidate.endsWith(".db") || !isBackupValid(candidate)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "restore path must be an existing, valid backup in .data/backups" } }, 400);
    const ticketId = randomUUID();
    const timestamp = new Date();
    context.database.prepare("INSERT INTO confirmation_tickets (id, action, payload_json, human_summary, ttl_class, status, created_at, expires_at) VALUES (?, 'system.restore', ?, ?, 'parked', 'pending', ?, ?)").run(ticketId, JSON.stringify({ path: candidate }), `恢复备份 ${candidate}（批准后需要重启服务）`, timestamp.toISOString(), new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
    return c.json({ ok: false, error: { code: "CONFIRM_REQUIRED", message: "Human confirmation required" }, confirmation: { id: ticketId, status: "pending" } }, 202);
  });

  app.get("/api/v1/system/exports", (c) => {
    const exportDir = join(context.config.dataDir, "exports");
    if (!existsSync(exportDir)) return c.json({ ok: true, exports: [] });
    const exports = readdirSync(exportDir).filter((file) => file.endsWith(".json")).map((file) => ({ name: file, path: join(exportDir, file), size: statSync(join(exportDir, file)).size })).sort((a, b) => b.name.localeCompare(a.name));
    return c.json({ ok: true, exports });
  });

  app.post("/api/v1/system/export", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const ticketId = randomUUID();
    const timestamp = new Date();
    const scope = { include_finance: body.include_finance !== false, include_health: body.include_health !== false };
    context.database.prepare("INSERT INTO confirmation_tickets (id, action, payload_json, human_summary, ttl_class, status, created_at, expires_at) VALUES (?, 'system.export', ?, ?, 'parked', 'pending', ?, ?)").run(ticketId, JSON.stringify({ scope }), "导出个人数据 JSON（排除 token 和 API Key）", timestamp.toISOString(), new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
    return c.json({ ok: false, error: { code: "CONFIRM_REQUIRED", message: "Human confirmation required" }, confirmation: { id: ticketId, status: "pending" } }, 202);
  });

  app.post("/api/v1/imports/preview", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const format = body.format;
    const target = body.target;
    const content = body.content;
    if ((format !== "csv" && format !== "ics") || (target !== "tasks" && target !== "finance") || typeof content !== "string" || content.length === 0 || content.length > 2_000_000) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "format, target and content are required; content must be <= 2MB" } }, 400);
    if (format === "ics" && target !== "tasks") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "ICS import target is tasks" } }, 400);
    const fingerprint = createHash("sha256").update(content).digest("hex");
    const existing = context.database.prepare("SELECT * FROM import_batches WHERE fingerprint = ?").get(fingerprint) as { id: string; status: string; preview_json: string } | undefined;
    if (existing) return c.json({ ok: true, idempotent: true, batch: { id: existing.id, status: existing.status, preview: JSON.parse(existing.preview_json) } });
    let preview: Record<string, unknown>;
    if (format === "csv") {
      const table = parseCsv(content);
      if (table.rows.length > 500) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "at most 500 rows per import" } }, 400);
      if (target === "tasks") {
        const rows = table.rows.map((row) => ({ title: row.title || row.summary || row.name || "", description: row.description || row.note || "", due_date: row.due_date || row.date || null, scheduled_date: row.scheduled_date || null, priority: row.priority || "P2" })).filter((row) => row.title.length > 0);
        preview = { columns: table.headers, rows, skipped: table.rows.length - rows.length };
      } else {
        const rows = table.rows.map((row) => {
          const amountText = row.amount_cents || row.amount || "0";
          const amountCents = row.amount_cents ? Number.parseInt(amountText, 10) : Math.round(Number(amountText) * 100);
          return { type: row.type === "income" ? "income" : "expense", account_id: row.account_id || "", amount_cents: amountCents, category: row.category || "未分类", note: row.note || "", occurred_date: row.occurred_date || row.date || "" };
        }).filter((row) => row.account_id && Number.isInteger(row.amount_cents) && row.amount_cents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.occurred_date));
        preview = { columns: table.headers, rows, skipped: table.rows.length - rows.length };
      }
    } else {
      const events = parseIcs(content);
      const rows = events.slice(0, 500).map((event) => ({ external_id: event.externalId, title: event.summary, description: event.description, scheduled_date: /^\d{8}$/.test(event.start) ? `${event.start.slice(0, 4)}-${event.start.slice(4, 6)}-${event.start.slice(6, 8)}` : event.start.slice(0, 10), due_date: null, priority: "P2" }));
      preview = { rows, skipped: Math.max(0, events.length - rows.length) };
    }
    const id = randomUUID();
    context.database.prepare("INSERT INTO import_batches (id, format, target, fingerprint, status, preview_json, created_at) VALUES (?, ?, ?, ?, 'preview', ?, ?)").run(id, format, target, fingerprint, JSON.stringify(preview), now());
    return c.json({ ok: true, idempotent: false, batch: { id, format, target, status: "preview", preview } }, 201);
  });

  app.post("/api/v1/imports/commit", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.batch_id !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "batch_id is required" } }, 400);
    const batch = context.database.prepare("SELECT * FROM import_batches WHERE id = ?").get(body.batch_id) as { id: string; target: string; status: string; preview_json: string } | undefined;
    if (!batch) return notFound(c, "import batch");
    const existingPreview = JSON.parse(batch.preview_json) as { rows: Array<Record<string, unknown>>; created?: unknown };
    if (batch.status === "committed") return c.json({ ok: true, idempotent: true, batchId: batch.id, created: existingPreview.created ?? {} });
    const timestamp = now();
    const created = { tasks: 0, expenses: 0, incomes: 0 };
    try {
      const commit = context.database.transaction(() => {
        if (batch.target === "tasks") {
          for (const row of existingPreview.rows) {
            context.database.prepare("INSERT INTO tasks (id, title, description, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?)").run(randomUUID(), row.title, row.description ?? "", row.priority ?? "P2", row.due_date ?? null, row.scheduled_date ?? null, timestamp, timestamp);
            created.tasks += 1;
          }
        } else {
          for (const row of existingPreview.rows) {
            if (!context.database.prepare("SELECT 1 FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(row.account_id)) throw new Error(`ACCOUNT_NOT_FOUND:${String(row.account_id)}`);
            const id = randomUUID();
            if (row.type === "income") {
              context.database.prepare("INSERT INTO finance_incomes (id, account_id, amount_cents, currency, category, note, occurred_date, created_at, updated_at) VALUES (?, ?, ?, 'CNY', ?, ?, ?, ?, ?)").run(id, row.account_id, row.amount_cents, row.category, row.note ?? "", row.occurred_date, timestamp, timestamp);
              context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(row.amount_cents, timestamp, row.account_id);
              created.incomes += 1;
            } else {
              context.database.prepare("INSERT INTO finance_expenses (id, account_id, amount_cents, currency, category, note, occurred_date, created_at, updated_at) VALUES (?, ?, ?, 'CNY', ?, ?, ?, ?, ?)").run(id, row.account_id, row.amount_cents, row.category, row.note ?? "", row.occurred_date, timestamp, timestamp);
              context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents - ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(row.amount_cents, timestamp, row.account_id);
              created.expenses += 1;
            }
          }
        }
        context.database.prepare("UPDATE import_batches SET status = 'committed', committed_at = ? WHERE id = ?").run(timestamp, batch.id);
      });
      commit();
    } catch (error) {
      return c.json({ ok: false, error: { code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Import commit failed" } }, 400);
    }
    return c.json({ ok: true, idempotent: false, batchId: batch.id, created });
  });

  app.get("/api/v1/finance/summary", (c) => {
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const date = c.req.query("to") || localDateInTimezone(timezone);
    const from = c.req.query("from") || monthStart(date);
    const expenses = (context.database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_expenses WHERE occurred_date BETWEEN ? AND ?").get(from, date) as { total: number }).total;
    const incomes = (context.database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_incomes WHERE occurred_date BETWEEN ? AND ?").get(from, date) as { total: number }).total;
    const accounts = context.database.prepare("SELECT id, name, currency, current_balance_cents FROM finance_accounts WHERE archived_at IS NULL ORDER BY created_at").all();
    return c.json({ ok: true, from, to: date, expensesCents: expenses, incomesCents: incomes, netCents: incomes - expenses, accounts });
  });

  app.get("/api/v1/finance/accounts", (c) => c.json({ ok: true, accounts: context.database.prepare("SELECT * FROM finance_accounts WHERE archived_at IS NULL ORDER BY created_at").all() }));

  app.get("/api/v1/finance/taxonomy", (c) => {
    const projectOptions = context.database.prepare("SELECT name AS value, name AS label FROM projects WHERE archived_at IS NULL AND benefit_enabled = 1 ORDER BY name COLLATE NOCASE").all() as Array<{ value: string; label: string }>;
    return c.json({
      ok: true,
      expense: {
        majors: [...FINANCE_EXPENSE_TAXONOMY.majors, { value: "项目支出", label: "项目支出", color: "#557c69" }],
        minors: { ...FINANCE_EXPENSE_TAXONOMY.minors, "项目支出": projectOptions }
      },
      income: {
        majors: FINANCE_INCOME_TAXONOMY.majors,
        minors: {
          ...FINANCE_INCOME_TAXONOMY.minors,
          "项目收入": [
            ...(FINANCE_INCOME_TAXONOMY.minors["项目收入"] ?? []),
            ...projectOptions
          ]
        }
      },
      accounts: FINANCE_ACCOUNT_LABELS
    });
  });

  app.get("/api/v1/finance/quick-buttons", (c) => c.json({ ok: true, quick_buttons: parseQuickButtons(context.database) }));

  app.post("/api/v1/finance/accounts", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.name !== "string" || body.name.trim().length === 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "name is required" } }, 400);
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO finance_accounts (id, name, account_type, currency, opening_balance_cents, current_balance_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, body.name.trim(), typeof body.account_type === "string" ? body.account_type : "cash", typeof body.currency === "string" ? body.currency : "CNY", typeof body.opening_balance_cents === "number" ? body.opening_balance_cents : 0, typeof body.opening_balance_cents === "number" ? body.opening_balance_cents : 0, timestamp, timestamp);
    return c.json({ ok: true, account: context.database.prepare("SELECT * FROM finance_accounts WHERE id = ?").get(id) }, 201);
  });

  app.patch("/api/v1/finance/accounts/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(id) as { name: string; account_type: string; opening_balance_cents: number; current_balance_cents: number } | undefined;
    if (!current) return notFound(c, "account");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const name = body.name === undefined ? current.name : typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    if (!name) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "name is required" } }, 400);
    const opening = body.opening_balance_cents === undefined ? current.opening_balance_cents : body.opening_balance_cents;
    if (typeof opening !== "number" || !Number.isInteger(opening)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "opening_balance_cents must be an integer" } }, 400);
    const accountType = typeof body.account_type === "string" && body.account_type.trim() ? body.account_type.trim() : current.account_type;
    const currentBalance = current.current_balance_cents + opening - current.opening_balance_cents;
    context.database.prepare("UPDATE finance_accounts SET name = ?, account_type = ?, opening_balance_cents = ?, current_balance_cents = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND archived_at IS NULL").run(name, accountType, opening, currentBalance, now(), id);
    return c.json({ ok: true, account: context.database.prepare("SELECT * FROM finance_accounts WHERE id = ?").get(id) });
  });

  app.delete("/api/v1/finance/accounts/:id", (c) => {
    const id = c.req.param("id");
    const account = context.database.prepare("SELECT id FROM finance_accounts WHERE id = ?").get(id);
    if (!account) return notFound(c, "account");
    const remove = context.database.transaction(() => {
      context.database.prepare("UPDATE finance_expenses SET account_id = NULL WHERE account_id = ?").run(id);
      context.database.prepare("UPDATE finance_incomes SET account_id = NULL WHERE account_id = ?").run(id);
      context.database.prepare("DELETE FROM finance_transaction_legs WHERE account_id = ?").run(id);
      context.database.prepare("DELETE FROM finance_account_entries WHERE account_id = ?").run(id);
      context.database.prepare("DELETE FROM finance_accounts WHERE id = ?").run(id);
    });
    remove();
    return c.json({ ok: true });
  });

  app.get("/api/v1/finance/account-entries", (c) => {
    const range = parseDateRange(c);
    if (range instanceof Response) return range;
    const accountId = c.req.query("account_id");
    const direction = c.req.query("direction");
    if (direction && !normalizeAccountEntryDirection(direction)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "direction must be deposit or withdrawal" } }, 400);
    const conditions = ["e.archived_at IS NULL"];
    const params: string[] = [];
    if (range.from) { conditions.push("e.occurred_date BETWEEN ? AND ?"); params.push(range.from, range.to!); }
    if (accountId) { conditions.push("e.account_id = ?"); params.push(accountId); }
    if (direction) { conditions.push("e.direction = ?"); params.push(direction); }
    return c.json({ ok: true, entries: context.database.prepare(`SELECT e.*, a.name AS account_name FROM finance_account_entries e INNER JOIN finance_accounts a ON a.id = e.account_id AND a.archived_at IS NULL WHERE ${conditions.join(" AND ")} ORDER BY e.occurred_date DESC, e.created_at DESC`).all(...params) });
  });

  app.post("/api/v1/finance/account-entries", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const accountId = typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : "";
    const amount = body.amount_cents;
    const direction = body.direction === undefined ? "deposit" : normalizeAccountEntryDirection(body.direction);
    const occurredDate = typeof body.occurred_date === "string" ? body.occurred_date : localDateInTimezone(getSetting(context.database, "timezone", "Asia/Shanghai"));
    if (!accountId || !context.database.prepare("SELECT id FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(accountId)) return notFound(c, "account");
    if (!direction) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "direction must be deposit or withdrawal" } }, 400);
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "amount_cents must be a positive integer" } }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredDate)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "occurred_date must be YYYY-MM-DD" } }, 400);
    const event = typeof body.event === "string" ? body.event : "";
    const note = typeof body.note === "string" ? body.note : event;
    const id = randomUUID();
    const timestamp = now();
    const delta = accountEntryDelta(amount, direction);
    const write = context.database.transaction(() => {
      context.database.prepare("INSERT INTO finance_account_entries (id, account_id, direction, amount_cents, currency, event, note, occurred_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, accountId, direction, amount, typeof body.currency === "string" ? body.currency : "CNY", event, note, occurredDate, timestamp, timestamp);
      context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(delta, timestamp, accountId);
    });
    write();
    return c.json({ ok: true, entry: context.database.prepare("SELECT e.*, a.name AS account_name FROM finance_account_entries e INNER JOIN finance_accounts a ON a.id = e.account_id WHERE e.id = ?").get(id) }, 201);
  });

  app.patch("/api/v1/finance/account-entries/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM finance_account_entries WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "account entry");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const accountId = body.account_id === undefined ? String(current.account_id) : typeof body.account_id === "string" ? body.account_id.trim() : "";
    const amount = body.amount_cents === undefined ? Number(current.amount_cents) : body.amount_cents;
    const direction = body.direction === undefined ? (normalizeAccountEntryDirection(current.direction) ?? "deposit") : normalizeAccountEntryDirection(body.direction);
    const occurredDate = body.occurred_date === undefined ? String(current.occurred_date) : body.occurred_date;
    if (!accountId || !context.database.prepare("SELECT id FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(accountId)) return notFound(c, "account");
    if (!direction) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "direction must be deposit or withdrawal" } }, 400);
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "amount_cents must be a positive integer" } }, 400);
    if (typeof occurredDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(occurredDate)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "occurred_date must be YYYY-MM-DD" } }, 400);
    const event = body.event === undefined ? String(current.event ?? "") : typeof body.event === "string" ? body.event : "";
    const note = body.note === undefined ? String(current.note ?? "") : typeof body.note === "string" ? body.note : "";
    const oldAccountId = String(current.account_id);
    const oldAmount = Number(current.amount_cents);
    const oldDirection = normalizeAccountEntryDirection(current.direction) ?? "deposit";
    const timestamp = now();
    const write = context.database.transaction(() => {
      context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents - ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(accountEntryDelta(oldAmount, oldDirection), timestamp, oldAccountId);
      context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(accountEntryDelta(amount, direction), timestamp, accountId);
      context.database.prepare("UPDATE finance_account_entries SET account_id = ?, direction = ?, amount_cents = ?, currency = ?, event = ?, note = ?, occurred_date = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(accountId, direction, amount, typeof body.currency === "string" ? body.currency : current.currency ?? "CNY", event, note, occurredDate, timestamp, id);
    });
    write();
    return c.json({ ok: true, entry: context.database.prepare("SELECT e.*, a.name AS account_name FROM finance_account_entries e INNER JOIN finance_accounts a ON a.id = e.account_id WHERE e.id = ?").get(id) });
  });

  app.delete("/api/v1/finance/account-entries/:id", (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM finance_account_entries WHERE id = ? AND archived_at IS NULL").get(id) as { account_id: string; amount_cents: number; direction?: string } | undefined;
    if (!current) return notFound(c, "account entry");
    const remove = context.database.transaction(() => {
      context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents - ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(accountEntryDelta(current.amount_cents, normalizeAccountEntryDirection(current.direction) ?? "deposit"), now(), current.account_id);
      context.database.prepare("DELETE FROM finance_account_entries WHERE id = ?").run(id);
    });
    remove();
    return c.json({ ok: true });
  });

  app.get("/api/v1/finance/expenses", (c) => {
    const range = parseDateRange(c);
    if (range instanceof Response) return range;
    const filters = parseFinanceCategoryFilters(c);
    const conditions = ["archived_at IS NULL"];
    const params: string[] = [];
    if (range.from) { conditions.push("occurred_date BETWEEN ? AND ?"); params.push(range.from, range.to!); }
    if (filters.major) { conditions.push("category_major = ?"); params.push(filters.major); }
    if (filters.minor) { conditions.push("category_minor = ?"); params.push(filters.minor); }
    return c.json({ ok: true, expenses: context.database.prepare(`SELECT * FROM finance_expenses WHERE ${conditions.join(" AND ")} ORDER BY occurred_date DESC, created_at DESC`).all(...params) });
  });

  app.post("/api/v1/finance/expenses", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const parsed = financeEntrySchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const amount = parsed.data.amount_cents;
    const fields = resolveFinanceFields(context.database, body, "expense");
    if ("error" in fields) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: fields.error } }, 400);
    if (fields.accountId && !context.database.prepare("SELECT 1 FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(fields.accountId)) return notFound(c, "account");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.occurredDate)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "occurred_date must be YYYY-MM-DD" } }, 400);
    if (fields.projectId !== undefined && fields.projectId !== null && !context.database.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(fields.projectId)) return notFound(c, "project");
    const id = randomUUID();
    const timestamp = now();
    const writesTransaction = getSetting(context.database, "finance.expense_writes_tx", true);
    const write = context.database.transaction(() => {
      let transactionId: string | null = null;
      if (writesTransaction && fields.accountId) {
        transactionId = randomUUID();
        context.database.prepare("INSERT INTO finance_transactions (id, kind, note, occurred_date, created_at, updated_at) VALUES (?, 'expense_link', ?, ?, ?, ?)").run(transactionId, fields.note, fields.occurredDate, timestamp, timestamp);
        context.database.prepare("INSERT INTO finance_transaction_legs (id, transaction_id, account_id, amount_cents, direction) VALUES (?, ?, ?, ?, 'debit')").run(randomUUID(), transactionId, fields.accountId, amount);
      }
      context.database.prepare("INSERT INTO finance_expenses (id, account_id, amount_cents, currency, category, category_major, category_minor, project_id, event, note, occurred_date, linked_transaction_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, fields.accountId, amount, fields.currency, fields.category, fields.major, fields.minor, fields.projectId ?? null, fields.event, fields.note, fields.occurredDate, transactionId, timestamp, timestamp);
      if (writesTransaction && fields.accountId) context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents - ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(amount, timestamp, fields.accountId);
    });
    write();
    return c.json({ ok: true, expense: context.database.prepare("SELECT * FROM finance_expenses WHERE id = ?").get(id) }, 201);
  });

  app.get("/api/v1/finance/incomes", (c) => {
    const range = parseDateRange(c);
    if (range instanceof Response) return range;
    const filters = parseFinanceCategoryFilters(c);
    const conditions = ["archived_at IS NULL"];
    const params: string[] = [];
    if (range.from) { conditions.push("occurred_date BETWEEN ? AND ?"); params.push(range.from, range.to!); }
    if (filters.major) { conditions.push("category_major = ?"); params.push(filters.major); }
    if (filters.minor) { conditions.push("category_minor = ?"); params.push(filters.minor); }
    return c.json({ ok: true, incomes: context.database.prepare(`SELECT * FROM finance_incomes WHERE ${conditions.join(" AND ")} ORDER BY occurred_date DESC, created_at DESC`).all(...params) });
  });

  app.post("/api/v1/finance/incomes", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const parsed = financeEntrySchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const amount = parsed.data.amount_cents;
    const fields = resolveFinanceFields(context.database, body, "income");
    if ("error" in fields) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: fields.error } }, 400);
    if (fields.accountId && !context.database.prepare("SELECT 1 FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(fields.accountId)) return notFound(c, "account");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.occurredDate)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "occurred_date must be YYYY-MM-DD" } }, 400);
    if (fields.projectId !== undefined && fields.projectId !== null && !context.database.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(fields.projectId)) return notFound(c, "project");
    const id = randomUUID();
    const timestamp = now();
    const writesTransaction = getSetting(context.database, "finance.income_writes_tx", true);
    const write = context.database.transaction(() => {
      let transactionId: string | null = null;
      if (writesTransaction && fields.accountId) {
        transactionId = randomUUID();
        context.database.prepare("INSERT INTO finance_transactions (id, kind, note, occurred_date, created_at, updated_at) VALUES (?, 'income_link', ?, ?, ?, ?)").run(transactionId, fields.note, fields.occurredDate, timestamp, timestamp);
        context.database.prepare("INSERT INTO finance_transaction_legs (id, transaction_id, account_id, amount_cents, direction) VALUES (?, ?, ?, ?, 'credit')").run(randomUUID(), transactionId, fields.accountId, amount);
      }
      context.database.prepare("INSERT INTO finance_incomes (id, account_id, amount_cents, currency, category, category_major, category_minor, project_id, event, note, occurred_date, linked_transaction_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, fields.accountId, amount, fields.currency, fields.category, fields.major, fields.minor, fields.projectId ?? null, fields.event, fields.note, fields.occurredDate, transactionId, timestamp, timestamp);
      if (writesTransaction && fields.accountId) context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(amount, timestamp, fields.accountId);
    });
    write();
    return c.json({ ok: true, income: context.database.prepare("SELECT * FROM finance_incomes WHERE id = ?").get(id) }, 201);
  });

  for (const definition of [
    { path: "expenses", table: "finance_expenses", kind: "expense" as const },
    { path: "incomes", table: "finance_incomes", kind: "income" as const }
  ]) {
    app.patch(`/api/v1/finance/${definition.path}/:id`, async (c) => {
      const id = c.req.param("id");
      const current = context.database.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      if (!current) return notFound(c, definition.kind);
      const parsed = patchFinanceEntrySchema.safeParse(await c.req.json());
      if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
      const data = parsed.data;
      const amount = data.amount_cents ?? Number(current.amount_cents);
      const occurredDate = data.occurred_date ?? String(current.occurred_date);
      if (!Number.isInteger(amount) || amount <= 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "amount_cents must be a positive integer" } }, 400);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredDate)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "occurred_date must be YYYY-MM-DD" } }, 400);
      const major = data.category_major ?? String(current.category_major ?? "");
      const minor = data.category_minor ?? String(current.category_minor ?? "");
      const category = data.category ?? ([major, minor].filter(Boolean).join(" / ") || String(current.category ?? "未分类"));
      const event = data.event ?? String(current.event ?? "");
      const note = data.note ?? String(current.note ?? event);
      const timestamp = now();
      const update = context.database.transaction(() => {
        const oldAmount = Number(current.amount_cents);
        const delta = amount - oldAmount;
        if (delta !== 0 && typeof current.account_id === "string" && current.account_id && typeof current.linked_transaction_id === "string" && current.linked_transaction_id) {
          const accountDelta = definition.kind === "expense" ? -delta : delta;
          context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(accountDelta, timestamp, current.account_id);
          context.database.prepare("UPDATE finance_transaction_legs SET amount_cents = ? WHERE transaction_id = ? AND account_id = ?").run(amount, current.linked_transaction_id, current.account_id);
        }
        context.database.prepare(`UPDATE ${definition.table} SET amount_cents = ?, currency = ?, category = ?, category_major = ?, category_minor = ?, project_id = ?, event = ?, note = ?, occurred_date = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?`).run(amount, data.currency ?? current.currency ?? "CNY", category, major, minor, data.project_id === undefined ? current.project_id ?? null : data.project_id, event, note, occurredDate, timestamp, id);
      });
      update();
      return c.json({ ok: true, [definition.kind]: context.database.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id) });
    });

    app.delete(`/api/v1/finance/${definition.path}/:id`, (c) => {
      const id = c.req.param("id");
      const current = context.database.prepare(`SELECT * FROM ${definition.table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
      if (!current) return notFound(c, definition.kind);
      const remove = context.database.transaction(() => {
        if (typeof current.account_id === "string" && current.account_id && typeof current.linked_transaction_id === "string" && current.linked_transaction_id) {
          const accountDelta = definition.kind === "expense" ? Number(current.amount_cents) : -Number(current.amount_cents);
          context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(accountDelta, now(), current.account_id);
          context.database.prepare("DELETE FROM finance_transaction_legs WHERE transaction_id = ?").run(current.linked_transaction_id);
          context.database.prepare("DELETE FROM finance_transactions WHERE id = ?").run(current.linked_transaction_id);
        }
        context.database.prepare(`DELETE FROM ${definition.table} WHERE id = ?`).run(id);
      });
      remove();
      return c.json({ ok: true });
    });
  }

  app.get("/api/v1/finance/transactions", (c) => c.json({ ok: true, transactions: context.database.prepare("SELECT * FROM finance_transactions WHERE archived_at IS NULL ORDER BY occurred_date DESC, created_at DESC").all() }));

  app.post("/api/v1/finance/transactions", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const amount = body.amount_cents;
    if (typeof body.from !== "string" || typeof body.to !== "string" || body.from === body.to || typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "from, to and positive integer amount_cents are required" } }, 400);
    if (!context.database.prepare("SELECT 1 FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(body.from) || !context.database.prepare("SELECT 1 FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(body.to)) return notFound(c, "account");
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const occurredDate = typeof body.occurred_date === "string" ? body.occurred_date : localDateInTimezone(timezone);
    const id = randomUUID();
    const timestamp = now();
    const write = context.database.transaction(() => {
      context.database.prepare("INSERT INTO finance_transactions (id, kind, note, occurred_date, created_at, updated_at) VALUES (?, 'transfer', ?, ?, ?, ?)").run(id, typeof body.note === "string" ? body.note : "", occurredDate, timestamp, timestamp);
      context.database.prepare("INSERT INTO finance_transaction_legs (id, transaction_id, account_id, amount_cents, direction) VALUES (?, ?, ?, ?, 'debit'), (?, ?, ?, ?, 'credit')").run(randomUUID(), id, body.from, amount, randomUUID(), id, body.to, amount);
      context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents - ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(amount, timestamp, body.from);
      context.database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(amount, timestamp, body.to);
    });
    write();
    return c.json({ ok: true, transaction: context.database.prepare("SELECT * FROM finance_transactions WHERE id = ?").get(id) }, 201);
  });

  app.post("/api/v1/finance/preview", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.input !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "input is required" } }, 400);
    return c.json({ ok: true, preview: financeQuickParse(body.input) });
  });

  app.post("/api/v1/tasks", async (c) => {
    const parsed = createTaskSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const data = parsed.data;
    if (c.get("agentAuth") && (data.project_id || data.milestone_id)) {
      const linkedProjectId = data.project_id ?? (data.milestone_id ? projectIdForMilestone(context.database, data.milestone_id) : null);
      const rejected = rejectAgentProjectWrite(c, context.database, linkedProjectId);
      if (rejected) return rejected;
    }
    const id = randomUUID();
    const timestamp = now();
    const status = normalizeTaskStatus(data.status ?? "todo");
    const archiveRequested = toFlag(data.archive_requested, 0);
    const parentId = data.parent_id ?? null;
    const insert = context.database.transaction(() => {
      context.database.prepare(
        `INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, estimate_minutes, archive_requested, parent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, data.title, data.description ?? "", data.content ?? "", status, data.priority ?? "P2", data.due_date ?? null, data.scheduled_date ?? null, data.estimate_minutes ?? null, archiveRequested, parentId, timestamp, timestamp);
      if (data.project_id) context.database.prepare("INSERT INTO task_project_links (task_id, project_id) VALUES (?, ?)").run(id, data.project_id);
      if (data.milestone_id) context.database.prepare("INSERT INTO task_milestone_links (task_id, milestone_id) VALUES (?, ?)").run(id, data.milestone_id);
      if (parentId) refreshParentTaskDueDate(context.database, parentId, timestamp);
      if (shouldArchiveTask({ archive_requested: archiveRequested, status, archived_at: null })) {
        context.database.prepare("UPDATE tasks SET archived_at = ?, archive_reason = 'auto', archived_by = 'user' WHERE id = ? AND archived_at IS NULL").run(timestamp, id);
      }
    });
    insert();
    const task = context.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
    return c.json({ ok: true, task }, 201);
  });

  app.get("/api/v1/tasks/:id", (c) => {
    const id = c.req.param("id");
    const task = context.database.prepare(`
      SELECT tasks.*,
        (
          SELECT pt.project_id 
          FROM project_task_plans pt 
          WHERE pt.todo_task_id = tasks.id 
            AND pt.archived_at IS NULL 
          LIMIT 1
        ) AS project_id,
        (
          SELECT p.name 
          FROM project_task_plans pt 
          JOIN projects p ON p.id = pt.project_id 
          WHERE pt.todo_task_id = tasks.id 
            AND pt.archived_at IS NULL 
          LIMIT 1
        ) AS project_name
      FROM tasks WHERE id = ? AND archived_at IS NULL
    `).get(id) as Record<string, unknown> | undefined;
    if (!task) return notFound(c, "task");
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const recurrence = typeof task.recurrence_id === "string" ? inspectRecurrences(context.database, task.recurrence_id, localDateInTimezone(timezone))[0] ?? null : null;
    return c.json({ ok: true, task, recurrence, projects: context.database.prepare("SELECT p.* FROM projects p INNER JOIN task_project_links l ON l.project_id = p.id WHERE l.task_id = ?").all(id), milestones: context.database.prepare("SELECT m.* FROM milestones m INNER JOIN task_milestone_links l ON l.milestone_id = m.id WHERE l.task_id = ?").all(id), dependencies: context.database.prepare("SELECT * FROM task_dependencies WHERE blocked_task_id = ? OR blocking_task_id = ?").all(id, id) });
  });

  app.post("/api/v1/task-recurrences", async (c) => {
    const created = createRecurrenceTemplate(context.database, await c.req.json());
    if ("error" in created) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: created.error } }, 400);
    const id = String(created.id);
    if (Number(created.enabled) === 1) syncTemplateAfterWriteWithRetry(context.database, context.config.dataDir, id, "template_create");
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    return c.json({ ok: true, recurrence: inspectRecurrences(context.database, id, localDateInTimezone(timezone))[0] ?? null }, 201);
  });

  app.delete("/api/v1/task-recurrences/:id", (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT id, enabled FROM task_recurrences WHERE id = ? AND status <> 'deleted'").get(id) as { id: string; enabled: number } | undefined;
    if (!current) return notFound(c, "task recurrence");
    if (Number(current.enabled) === 1) {
      const sync = runRecurrenceSyncWithRetry(context.database, context.config.dataDir, id, "template_delete_before");
      if (sync.lockResult === "busy" || sync.status !== "ok") return c.json({ ok: false, error: { code: "RECURRENCE_SYNC_REQUIRED", message: "周期模板尚未完成同步，请稍后再删除" } }, 409);
    }
    const preservedTasks = Number((context.database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ?").get(id) as { count: number }).count ?? 0);
    const timestamp = now();
    const result = context.database.prepare("UPDATE task_recurrences SET enabled = 0, paused_from_date = NULL, next_occurrence_date = NULL, status = 'deleted', last_error = NULL, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND status <> 'deleted'").run(timestamp, id);
    if (result.changes !== 1) return notFound(c, "task recurrence");
    return c.json({ ok: true, deleted: true, preserved_tasks: preservedTasks });
  });

  app.post("/api/v1/tasks/:id/recurrence", (c) => c.json({ ok: false, error: { code: "BAD_REQUEST", message: "周期任务现在必须在周期任务模板页面中创建，不能从普通任务绑定。" } }, 410));

  app.get("/api/v1/task-recurrences", (c) => {
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const latestRun = context.database.prepare("SELECT * FROM task_recurrence_runs ORDER BY started_at DESC LIMIT 1").get() ?? null;
    return c.json({ ok: true, recurrences: inspectRecurrences(context.database, null, localDateInTimezone(timezone)), latest_run: latestRun });
  });

  app.get("/api/v1/task-recurrences/:id", (c) => {
    const id = c.req.param("id");
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const recurrence = inspectRecurrences(context.database, id, localDateInTimezone(timezone))[0];
    if (!recurrence) return notFound(c, "task recurrence");
    const versions = context.database.prepare("SELECT id, recurrence_id, version, effective_from, effective_to, title_template, description_template, content_template, rule_json, schedule_anchor_date, created_at FROM task_recurrence_versions WHERE recurrence_id = ? ORDER BY version ASC").all(id);
    return c.json({ ok: true, recurrence, versions });
  });

  app.patch("/api/v1/task-recurrences/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM task_recurrences WHERE id = ? AND status <> 'deleted'").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "task recurrence");
    const body = await c.req.json();
    const updated = updateRecurrenceTemplate(context.database, id, body, () => syncTemplateAfterWriteWithRetry(context.database, context.config.dataDir, id, "template_update_before"));
    if ("error" in updated) {
      const stale = String(updated.error).includes("其他操作修改");
      return c.json({ ok: false, error: { code: stale ? "STALE_VERSION" : "BAD_REQUEST", message: String(updated.error) } }, stale ? 409 : 400);
    }
    if (Number(updated.enabled) === 1) syncTemplateAfterWriteWithRetry(context.database, context.config.dataDir, id, "template_update");
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const today = localDateInTimezone(timezone);
    return c.json({ ok: true, recurrence: inspectRecurrences(context.database, id, today)[0] ?? null });
  });

  app.post("/api/v1/task-recurrences/:id/check", async (c) => {
    const id = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM task_recurrences WHERE id = ?").get(id)) return notFound(c, "task recurrence");
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const repair = body.repair === true;
    const sync = repair ? runRecurrenceSyncWithRetry(context.database, context.config.dataDir, id, "manual_repair") : null;
    return c.json({ ok: true, repaired: repair, sync, inspection: inspectRecurrences(context.database, id, localDateInTimezone(timezone))[0] ?? null });
  });

  app.get("/api/v1/task-recurrences/:id/occurrences", (c) => {
    const id = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM task_recurrences WHERE id = ?").get(id)) return notFound(c, "task recurrence");
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 100) || 100));
    const occurrences = context.database.prepare("SELECT o.*, t.title, t.status, t.due_date, t.archived_at FROM task_recurrence_occurrences o LEFT JOIN tasks t ON t.id = o.task_id WHERE o.recurrence_id = ? ORDER BY o.occurrence_date DESC LIMIT ?").all(id, limit);
    return c.json({ ok: true, occurrences });
  });

  app.post("/api/v1/tasks/:id/links", async (c) => {
    const id = c.req.param("id");
    if (!context.database.prepare("SELECT 1 FROM tasks WHERE id = ?").get(id)) return notFound(c, "task");
    const body = await c.req.json() as Record<string, unknown>;
    const projectId = typeof body.project_id === "string" ? body.project_id : null;
    const milestoneId = typeof body.milestone_id === "string" ? body.milestone_id : null;
    if (!projectId && !milestoneId) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "project_id or milestone_id is required" } }, 400);
    if (c.get("agentAuth")) {
      const linkedProjectId = projectId ?? (milestoneId ? projectIdForMilestone(context.database, milestoneId) : null);
      const rejected = rejectAgentProjectWrite(c, context.database, linkedProjectId);
      if (rejected) return rejected;
    }
    if (projectId) context.database.prepare("INSERT OR IGNORE INTO task_project_links (task_id, project_id) VALUES (?, ?)").run(id, projectId);
    if (milestoneId) context.database.prepare("INSERT OR IGNORE INTO task_milestone_links (task_id, milestone_id) VALUES (?, ?)").run(id, milestoneId);
    return c.json({ ok: true });
  });

  app.delete("/api/v1/tasks/:id/links/:linkId", (c) => {
    const taskId = c.req.param("id");
    const linkId = c.req.param("linkId");
    const projectResult = context.database.prepare("DELETE FROM task_project_links WHERE task_id = ? AND project_id = ?").run(taskId, linkId);
    const milestoneResult = context.database.prepare("DELETE FROM task_milestone_links WHERE task_id = ? AND milestone_id = ?").run(taskId, linkId);
    if (projectResult.changes + milestoneResult.changes === 0) return notFound(c, "task link");
    return c.json({ ok: true });
  });

  app.patch("/api/v1/tasks/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "task");
    const parsed = patchTaskSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const data = parsed.data;
    if (c.get("agentAuth") && data.archive_requested !== undefined) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot archive tasks; use the human UI" } }, 403);
    if (c.get("agentAuth") && (data.project_id || data.milestone_id)) {
      const linkedProjectId = data.project_id ?? (data.milestone_id ? projectIdForMilestone(context.database, data.milestone_id) : null);
      const rejected = rejectAgentProjectWrite(c, context.database, linkedProjectId);
      if (rejected) return rejected;
    }
    if (data.row_version !== undefined && data.row_version !== current.row_version) return c.json({ ok: false, error: { code: "STALE_VERSION", message: "Task was changed by another operation" } }, 409);
    const nextStatus = normalizeTaskStatus(data.status ?? current.status);
    const nextArchiveRequested = toFlag(data.archive_requested, Number(current.archive_requested ?? 0));
    const nextParentId = data.parent_id === undefined ? current.parent_id : data.parent_id;
    if (c.get("agentAuth") && shouldArchiveTask({ archive_requested: nextArchiveRequested, status: nextStatus, archived_at: current.archived_at as string | null })) {
      return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot trigger task archiving; use the human UI" } }, 403);
    }
    const timestamp = now();
    let result: { changes: number } = { changes: 0 };
    const write = context.database.transaction(() => {
      result = context.database.prepare(
        `UPDATE tasks SET title = ?, description = ?, content = ?, status = ?, priority = ?, due_date = ?, scheduled_date = ?, estimate_minutes = ?, archive_requested = ?, parent_id = ?, updated_at = ?, completed_at = ?, row_version = row_version + 1
         WHERE id = ? AND row_version = ? AND archived_at IS NULL`
      ).run(data.title ?? current.title, data.description ?? current.description, data.content ?? current.content, nextStatus, data.priority ?? current.priority, data.due_date === undefined ? current.due_date : data.due_date, data.scheduled_date === undefined ? current.scheduled_date : data.scheduled_date, data.estimate_minutes === undefined ? current.estimate_minutes : data.estimate_minutes, nextArchiveRequested, nextParentId, timestamp, nextStatus === "done" ? (current.completed_at ?? timestamp) : null, id, current.row_version);
      if (result.changes !== 1) return;
      if (shouldArchiveTask({ archive_requested: nextArchiveRequested, status: nextStatus, archived_at: current.archived_at as string | null })) {
        context.database.prepare("UPDATE tasks SET archived_at = ?, archive_reason = 'auto', archived_by = 'user' WHERE id = ? AND archived_at IS NULL").run(timestamp, id);
      }
    });
    write();
    if (result.changes !== 1) return c.json({ ok: false, error: { code: "STALE_VERSION", message: "Task was changed by another operation" } }, 409);
    if (nextParentId) {
      refreshParentTaskDueDate(context.database, nextParentId as string, timestamp);
    }
    if (current.parent_id && current.parent_id !== nextParentId) {
      refreshParentTaskDueDate(context.database, current.parent_id as string, timestamp);
    }
    if (data.title !== undefined || data.due_date !== undefined) {
      const checkpoint = context.database.prepare(
        "SELECT id, project_id, title, due_date FROM project_task_plans WHERE todo_task_id = ? AND archived_at IS NULL"
      ).get(id) as { id: string; project_id: string; title: string; due_date: string | null } | undefined;
      if (checkpoint) {
        const newTitle = data.title ?? checkpoint.title;
        const newDueDate = data.due_date === undefined ? checkpoint.due_date : data.due_date;
        context.database.prepare(
          "UPDATE project_task_plans SET title = ?, due_date = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?"
        ).run(newTitle, newDueDate, timestamp, checkpoint.id);
        addProjectActivity(
          context.database,
          checkpoint.project_id,
          "checkpoint_synced",
          `待办同步：更新验收节点「${newTitle}」${newDueDate ? `（截止 ${newDueDate}）` : ""}`,
          false,
          timestamp
        );
      }
    }
    if (nextStatus === "todo" && current.status !== "todo") {
      context.database.prepare(
        "UPDATE project_task_plans SET status = 'todo', completed_at = NULL, updated_at = ?, row_version = row_version + 1 WHERE todo_task_id = ? AND archived_at IS NULL"
      ).run(timestamp, id);
    }
    if (Object.prototype.hasOwnProperty.call(data, "project_id")) {
      context.database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(id);
      if (data.project_id) context.database.prepare("INSERT INTO task_project_links (task_id, project_id) VALUES (?, ?)").run(id, data.project_id);
    }
    if (Object.prototype.hasOwnProperty.call(data, "milestone_id")) {
      context.database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(id);
      if (data.milestone_id) context.database.prepare("INSERT INTO task_milestone_links (task_id, milestone_id) VALUES (?, ?)").run(id, data.milestone_id);
    }
    if (nextStatus === "done" || nextStatus === "cancelled") syncProjectPlansForTodo(context.database, id, nextStatus === "done" ? "completed" : "cancelled", timestamp);
    return c.json({ ok: true, task: context.database.prepare("SELECT * FROM tasks WHERE id = ?").get(id) });
  });

  app.delete("/api/v1/tasks/:id", (c) => {
    const id = c.req.param("id");
    const task = context.database.prepare("SELECT id, recurrence_id, recurrence_date, parent_id FROM tasks WHERE id = ?").get(id) as { id: string; recurrence_id?: string | null; recurrence_date?: string | null; parent_id?: string | null } | undefined;
    if (!task) return notFound(c, "task");
    const timestamp = now();
    syncProjectPlansForTodo(context.database, id, "removed", timestamp);
    const remove = context.database.transaction(() => {
      context.database.prepare("DELETE FROM daily_plan_items WHERE task_id = ?").run(id);
      context.database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(id);
      context.database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(id);
      context.database.prepare("DELETE FROM task_dependencies WHERE blocked_task_id = ? OR blocking_task_id = ?").run(id, id);
      context.database.prepare("UPDATE tasks SET parent_id = NULL WHERE parent_id = ?").run(id);
      if (task.recurrence_id && task.recurrence_date) {
        const timestamp = now();
        context.database.prepare("INSERT INTO task_recurrence_occurrences (id, recurrence_id, occurrence_date, task_id, outcome, created_at, updated_at) VALUES (?, ?, ?, NULL, 'deleted', ?, ?) ON CONFLICT(recurrence_id, occurrence_date) DO UPDATE SET task_id = NULL, outcome = 'deleted', updated_at = excluded.updated_at").run(randomUUID(), task.recurrence_id, task.recurrence_date, timestamp, timestamp);
      }
      context.database.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    });
    remove();
    if (task.parent_id) {
      refreshParentTaskDueDate(context.database, task.parent_id, timestamp);
    }
    return c.json({ ok: true });
  });

  app.post("/api/v1/tasks/:id/archive", (c) => {
    const timestamp = now();
    const result = context.database.prepare("UPDATE tasks SET archived_at = ?, archive_reason = 'user', archived_by = 'user', updated_at = ?, row_version = row_version + 1 WHERE id = ? AND archived_at IS NULL").run(timestamp, timestamp, c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "task");
    syncProjectPlansForTodo(context.database, c.req.param("id"), "archived", timestamp);
    return c.json({ ok: true });
  });

  app.post("/api/v1/tasks/:id/restore", (c) => {
    const result = context.database.prepare("UPDATE tasks SET archived_at = NULL, archive_requested = 0, archive_reason = NULL, archived_by = NULL, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND archived_at IS NOT NULL").run(now(), c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "task");
    return c.json({ ok: true });
  });

  app.get("/api/v1/projects", (c) => {
    try { syncUpcomingCheckpointsToTodos(context.database); } catch {}
    const projects = context.database.prepare("SELECT * FROM projects WHERE archived_at IS NULL ORDER BY started_at IS NULL, started_at DESC, end_date IS NULL, end_date ASC, created_at DESC").all() as Array<Record<string, unknown>>;
    const result = projects.map((project) => {
      const planCounts = context.database.prepare(
        `SELECT COUNT(id) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed
         FROM project_task_plans
         WHERE project_id = ? AND archived_at IS NULL`
      ).get(project.id) as { total: number; completed: number | null };

      const taskCounts = context.database.prepare(
        `SELECT COUNT(t.id) AS total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed
         FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id
         WHERE l.project_id = ? AND t.archived_at IS NULL`
      ).get(project.id) as { total: number; completed: number | null };

      const totalTasks = (planCounts?.total ?? 0) + (taskCounts?.total ?? 0);
      const completedTasks = (planCounts?.completed ?? 0) + (taskCounts?.completed ?? 0);

      let progress = 0;
      if (project.status === "done") {
        progress = 100;
      } else if (project.progress_manual !== null && project.progress_manual !== undefined) {
        progress = Math.min(100, Math.max(0, Math.round(Number(project.progress_manual))));
      } else if (totalTasks > 0) {
        progress = Math.min(100, Math.max(0, Math.round((completedTasks / totalTasks) * 100)));
      }

      const nextCheckpoint = context.database.prepare(
        `SELECT id, title, due_date
         FROM project_task_plans
         WHERE project_id = ? AND status != 'done' AND archived_at IS NULL
         ORDER BY sort_order ASC, due_date IS NULL, due_date ASC, created_at ASC
         LIMIT 1`
      ).get(project.id) as { id: string; title: string; due_date: string | null } | undefined;

      return {
        ...project,
        progress,
        checkpoint_stats: {
          total: planCounts?.total ?? 0,
          completed: planCounts?.completed ?? 0,
        },
        next_checkpoint: nextCheckpoint ?? null,
        finance: projectFinanceSummary(context.database, String(project.id)),
      };
    });
    return c.json({ ok: true, projects: result });
  });

  app.post("/api/v1/projects", async (c) => {
    const parsed = createProjectSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const data = parsed.data;
    const id = randomUUID();
    const timestamp = now();
    const initialStatus = data.status ?? (data.category === "maintenance" || data.category === "long_term" ? "active" : "idea");
    const create = context.database.transaction(() => {
      context.database.prepare("INSERT INTO projects (id, parent_id, name, category, started_at, target_date, end_date, target_result, description, status, priority, benefit_enabled, benefit_cents, benefit_kind, score, archive_requested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)").run(id, data.parent_id ?? null, data.name, data.category ?? "mid", data.started_at ?? null, data.target_date ?? null, data.end_date ?? null, data.target_result ?? "", data.description ?? "", initialStatus, data.priority ?? "P2", data.benefit_enabled ? 1 : 0, data.benefit_cents ?? null, data.benefit_kind ?? "none", data.score ?? null, timestamp, timestamp);
      const template = projectTemplate(data.template ?? data.category ?? "mid");
      context.database.prepare("INSERT INTO project_workspaces (project_id, introduction, goals, updated_at) VALUES (?, ?, ?, ?)").run(id, template.description, template.default_goal, timestamp);
    });
    create();
    return c.json({ ok: true, project: context.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) }, 201);
  });

  app.get("/api/v1/projects/templates", (c) => c.json({ ok: true, templates: PROJECT_TEMPLATES }));

  app.get("/api/v1/projects/:id", (c) => {
    const project = context.database.prepare("SELECT * FROM projects WHERE id = ? AND archived_at IS NULL").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!project) return notFound(c, "project");
    const tasks = context.database.prepare("SELECT t.* FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id WHERE l.project_id = ? AND t.archived_at IS NULL ORDER BY t.due_date IS NULL, t.due_date").all(c.req.param("id"));
    const milestones = context.database.prepare("SELECT * FROM milestones WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order, created_at").all(c.req.param("id"));
    const issues = context.database.prepare("SELECT * FROM project_issues WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC").all(c.req.param("id"));
    const links = context.database.prepare("SELECT * FROM project_links WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC").all(c.req.param("id"));
    return c.json({ ok: true, project, workspace: context.database.prepare("SELECT * FROM project_workspaces WHERE project_id = ?").get(c.req.param("id")), tasks, project_tasks: projectTaskPlans(context.database, c.req.param("id")), activities: projectActivities(context.database, c.req.param("id")), finance: projectFinanceSummary(context.database, c.req.param("id")), milestones, issues, links });
  });

  app.post("/api/v1/projects/:id/task-plans", async (c) => {
    const projectId = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) return notFound(c, "project");
    if (c.get("agentAuth")) {
      const rejected = rejectAgentProjectWrite(c, context.database, projectId);
      if (rejected) return rejected;
    }
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.title !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "title is required" } }, 400);
    const title = body.title.trim();
    if ((!title && c.get("agentAuth")) || (!title && body.add_to_todo === true)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "title is required before adding a project task to the todo list" } }, 400);
    if (body.due_date !== undefined && body.due_date !== null && (typeof body.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.due_date))) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "due_date is invalid" } }, 400);
    const status = body.status === "doing" ? "doing" : "todo";
    const id = randomUUID();
    const timestamp = now();
    let todoTaskId: string | null = null;
    const write = context.database.transaction(() => {
      if (body.add_to_todo === true) {
        todoTaskId = randomUUID();
        const project = context.database.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
        const projectName = project?.name ?? "";
        const rawDesc = typeof body.description === "string" ? body.description.trim() : "";
        const parentTaskId = getOrCreateProjectParentTask(context.database, projectId, projectName, body.due_date as string | null, timestamp);
        context.database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, parent_id, created_at, updated_at) VALUES (?, ?, ?, '', 'todo', 'P2', ?, ?, ?, ?)").run(todoTaskId, title, rawDesc, body.due_date ?? null, parentTaskId, timestamp, timestamp);
        context.database.prepare("INSERT INTO task_project_links (task_id, project_id) VALUES (?, ?)").run(todoTaskId, projectId);
        refreshParentTaskDueDate(context.database, parentTaskId, timestamp);
      }
      context.database.prepare("INSERT INTO project_task_plans (id, project_id, title, description, due_date, status, todo_task_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, projectId, title, typeof body.description === "string" ? body.description : "", body.due_date ?? null, status, todoTaskId, timestamp, timestamp);
      if (todoTaskId) addProjectActivity(context.database, projectId, "task_committed", "项目任务已加入待办：" + title, false, timestamp);
    });
    write();
    return c.json({ ok: true, project_task: context.database.prepare("SELECT * FROM project_task_plans WHERE id = ?").get(id) }, 201);
  });

  app.patch("/api/v1/project-task-plans/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM project_task_plans WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "project task plan");
    if (c.get("agentAuth")) {
      const rejected = rejectAgentProjectWrite(c, context.database, String(current.project_id));
      if (rejected) return rejected;
    }
    const body = await c.req.json() as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : String(current.title);
    if ((!title && c.get("agentAuth")) || (!title && body.add_to_todo === true)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "title is required before adding a project task to the todo list" } }, 400);
    if (c.get("agentAuth") && body.archive_requested !== undefined) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot archive project tasks; use the human UI" } }, 403);
    const status = body.status === undefined ? normalizeProjectTaskStatus(current.status, "todo") : normalizeProjectTaskStatus(body.status, String(current.status));
    const nextArchiveRequested = toFlag(body.archive_requested, Number(current.archive_requested ?? 0));
    if (c.get("agentAuth") && shouldArchiveTask({ archive_requested: nextArchiveRequested, status, archived_at: current.archived_at as string | null })) {
      return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot trigger project task archiving; use the human UI" } }, 403);
    }
    const timestamp = now();
    const timezone = "Asia/Shanghai";
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
    const tomorrowStr = new Date(Date.parse(todayStr + "T00:00:00+08:00") + 86400000).toLocaleDateString("en-CA", { timeZone: timezone });
    const dueDate = body.due_date === undefined ? (current.due_date as string | null ?? null) : (body.due_date as string | null);
    const isDueWithinTwoDays = typeof dueDate === "string" && dueDate.length > 0 && dueDate <= tomorrowStr;

    let todoTaskId = typeof current.todo_task_id === "string" ? current.todo_task_id : null;
    const write = context.database.transaction(() => {
      // If milestone is cancelled, remove from active todos if still uncompleted
      if (status === "cancelled" && todoTaskId) {
        const existingTask = context.database.prepare("SELECT status FROM tasks WHERE id = ?").get(todoTaskId) as { status: string } | undefined;
        if (existingTask && existingTask.status === "todo") {
          context.database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(todoTaskId);
          context.database.prepare("DELETE FROM tasks WHERE id = ?").run(todoTaskId);
        }
        todoTaskId = null;
      } else if ((body.add_to_todo === true || isDueWithinTwoDays || status === "done") && !todoTaskId && status !== "cancelled") {
        todoTaskId = randomUUID();
        const isDueTodayOrOverdue = typeof dueDate === "string" && dueDate <= todayStr;
        const priority = isDueTodayOrOverdue ? "P1" : "P2";
        const project = context.database.prepare("SELECT name FROM projects WHERE id = ?").get(current.project_id) as { name: string } | undefined;
        const projectName = project?.name ?? "";
        const rawDesc = typeof body.description === "string" ? body.description.trim() : String(current.description ?? "").trim();
        const parentTaskId = getOrCreateProjectParentTask(context.database, String(current.project_id), projectName, dueDate, timestamp);
        context.database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, parent_id, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)").run(todoTaskId, title, rawDesc, status === "done" ? "done" : "todo", priority, dueDate, parentTaskId, timestamp, timestamp);
        context.database.prepare("INSERT INTO task_project_links (task_id, project_id) VALUES (?, ?)").run(todoTaskId, current.project_id);
        refreshParentTaskDueDate(context.database, parentTaskId, timestamp);
        addProjectActivity(context.database, String(current.project_id), "task_committed", "项目任务已加入待办：" + title, false, timestamp);
      }
      const description = body.description === undefined ? String(current.description ?? "") : String(body.description);
      const completedAt = status === "done" ? (typeof body.completed_at === "string" ? body.completed_at : (current.completed_at ?? timestamp)) : null;
      context.database.prepare("UPDATE project_task_plans SET title = ?, description = ?, due_date = ?, status = ?, todo_task_id = ?, archive_requested = ?, updated_at = ?, completed_at = ?, row_version = row_version + 1 WHERE id = ?").run(title, description, dueDate, status, todoTaskId, nextArchiveRequested, timestamp, completedAt, id);
      if (todoTaskId) {
        const todoStatus = status === "done" ? "done" : status === "cancelled" ? "cancelled" : "todo";
        const existingTask = context.database.prepare("SELECT description, parent_id FROM tasks WHERE id = ?").get(todoTaskId) as { description: string | null; parent_id: string | null } | undefined;
        let taskMemo = existingTask?.description ?? "";
        if (body.description !== undefined) {
          taskMemo = String(body.description ?? "").trim();
        }
        context.database.prepare("UPDATE tasks SET title = ?, description = ?, due_date = ?, status = ?, completed_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND archived_at IS NULL").run(title, taskMemo, dueDate, todoStatus, todoStatus === "done" ? timestamp : null, timestamp, todoTaskId);
        if (existingTask?.parent_id) {
          refreshParentTaskDueDate(context.database, existingTask.parent_id, timestamp);
        }
      }
      if (status !== String(current.status) && (status === "done" || status === "cancelled")) {
        addProjectActivity(context.database, String(current.project_id), status === "done" ? "task_completed" : "task_cancelled", status === "done" ? "项目任务完成：" + title : "项目任务取消：" + title, status === "done", timestamp);
      }
      if (shouldArchiveTask({ archive_requested: nextArchiveRequested, status, archived_at: current.archived_at as string | null })) {
        context.database.prepare("UPDATE project_task_plans SET archived_at = ?, archive_reason = 'auto', archived_by = 'user' WHERE id = ? AND archived_at IS NULL").run(timestamp, id);
      }
    });
    write();
    return c.json({ ok: true, project_task: context.database.prepare("SELECT * FROM project_task_plans WHERE id = ?").get(id) ?? null });
  });

  app.delete("/api/v1/project-task-plans/:id", (c) => {
    if (c.get("agentAuth")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot delete project task plans; use the human UI" } }, 403);
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM project_task_plans WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "project task plan");
    const timestamp = now();
    const remove = context.database.transaction(() => {
      if (current.todo_task_id) {
        const todoId = String(current.todo_task_id);
        context.database.prepare("DELETE FROM daily_plan_items WHERE task_id = ?").run(todoId);
        context.database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(todoId);
        context.database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(todoId);
        context.database.prepare("DELETE FROM task_dependencies WHERE blocked_task_id = ? OR blocking_task_id = ?").run(todoId, todoId);
        context.database.prepare("DELETE FROM tasks WHERE id = ?").run(todoId);
      }
      context.database.prepare("DELETE FROM project_task_plans WHERE id = ?").run(id);
      addProjectActivity(context.database, String(current.project_id), "task_removed", "项目任务已删除：" + current.title, false, timestamp);
    });
    remove();
    return c.json({ ok: true });
  });

  app.post("/api/v1/projects/:id/task-plans/reorder", async (c) => {
    const projectId = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) return notFound(c, "project");
    const body = await c.req.json() as { plan_ids?: string[] };
    if (!Array.isArray(body.plan_ids)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "plan_ids array is required" } }, 400);
    const timestamp = now();
    const update = context.database.transaction(() => {
      body.plan_ids!.forEach((planId, index) => {
        context.database.prepare(
          "UPDATE project_task_plans SET sort_order = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND project_id = ?"
        ).run(index, timestamp, planId, projectId);
      });
    });
    update();
    return c.json({ ok: true, project_tasks: projectTaskPlans(context.database, projectId) });
  });

  app.post("/api/v1/projects/:id/activities", async (c) => {
    const projectId = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) return notFound(c, "project");
    if (c.get("agentAuth")) {
      const rejected = rejectAgentProjectWrite(c, context.database, projectId);
      if (rejected) return rejected;
    }
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.content !== "string" || !body.content.trim()) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "content is required" } }, 400);
    const kind = typeof body.kind === "string" && body.kind.trim() ? body.kind.trim() : "progress";
    const important = body.important === true || (typeof body.important !== "boolean" && kind !== "progress");
    addProjectActivity(context.database, projectId, kind, body.content, important);
    return c.json({ ok: true, activities: projectActivities(context.database, projectId) }, 201);
  });

  app.patch("/api/v1/projects/:id/activities/:activityId", async (c) => {
    const projectId = c.req.param("id");
    const activityId = c.req.param("activityId");
    if (!context.database.prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) return notFound(c, "project");
    if (c.get("agentAuth")) {
      const rejected = rejectAgentProjectWrite(c, context.database, projectId);
      if (rejected) return rejected;
    }
    const body = await c.req.json() as Record<string, unknown>;
    const updates: string[] = [];
    const values: unknown[] = [];
    if (typeof body.kind === "string" && body.kind.trim()) {
      updates.push("kind = ?");
      values.push(body.kind.trim());
      if (body.important === undefined) {
        updates.push("important = ?");
        values.push(body.kind.trim() === "progress" ? 0 : 1);
      }
    }
    if (typeof body.important === "boolean") {
      updates.push("important = ?");
      values.push(body.important ? 1 : 0);
    }
    if (typeof body.content === "string" && body.content.trim()) {
      updates.push("content = ?");
      values.push(body.content.trim());
    }
    if (updates.length > 0) {
      values.push(activityId, projectId);
      context.database.prepare(`UPDATE project_activity_logs SET ${updates.join(", ")} WHERE id = ? AND project_id = ?`).run(...values);
    }
    return c.json({ ok: true, activities: projectActivities(context.database, projectId) });
  });

  app.delete("/api/v1/projects/:id/activities/:activityId", async (c) => {
    const projectId = c.req.param("id");
    const activityId = c.req.param("activityId");
    if (!context.database.prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) return notFound(c, "project");
    if (c.get("agentAuth")) {
      const rejected = rejectAgentProjectWrite(c, context.database, projectId);
      if (rejected) return rejected;
    }
    context.database.prepare("DELETE FROM project_activity_logs WHERE id = ? AND project_id = ?").run(activityId, projectId);
    return c.json({ ok: true, activities: projectActivities(context.database, projectId) });
  });

  app.patch("/api/v1/projects/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM projects WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "project");
    const parsed = patchProjectSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const data = parsed.data;
    if (c.get("agentAuth") && (data.status === "paused" || data.status === "abandoned")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot pause or abandon projects; use the human UI" } }, 403);
    if (c.get("agentAuth") && data.archive_requested) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot archive projects; use the human UI" } }, 403);
    if (c.get("agentAuth") && (current.status === "paused" || current.status === "abandoned")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: PAUSED_PROJECT_ADVANCEMENT_ERROR } }, 403);
    const rejectedProjectWrite = rejectAgentProjectWrite(c, context.database, id);
    if (rejectedProjectWrite) return rejectedProjectWrite;
    if (data.row_version !== undefined && data.row_version !== current.row_version) return c.json({ ok: false, error: { code: "STALE_VERSION", message: "Project was changed by another operation" } }, 409);
    const nextArchiveRequested = data.archive_requested === undefined ? Number(current.archive_requested ?? 0) : toFlag(data.archive_requested, 0);
    const nextEndDate = data.end_date === undefined ? current.end_date : data.end_date;
    const nextTargetDate = data.target_date === undefined ? current.target_date : data.target_date;
    if (nextArchiveRequested && !nextEndDate) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "项目归档前必须设置结束时间" } }, 400);
    const nextScore = data.score === undefined ? (current.score as number | null ?? null) : data.score;
    const result = context.database.prepare(
      `UPDATE projects SET parent_id = ?, name = ?, category = ?, started_at = ?, target_date = ?, end_date = ?, target_result = ?, description = ?, status = ?, priority = ?, benefit_enabled = ?, benefit_cents = ?, benefit_kind = ?, progress_manual = ?, score = ?, archive_requested = ?, updated_at = ?, row_version = row_version + 1
       WHERE id = ? AND row_version = ? AND archived_at IS NULL`
    ).run(data.parent_id === undefined ? current.parent_id : data.parent_id, data.name ?? current.name, data.category ?? current.category, data.started_at === undefined ? current.started_at : data.started_at, nextTargetDate, nextEndDate, data.target_result ?? current.target_result, data.description ?? current.description, data.status ?? current.status, data.priority ?? current.priority, data.benefit_enabled === undefined ? current.benefit_enabled : (data.benefit_enabled ? 1 : 0), data.benefit_cents === undefined ? current.benefit_cents : data.benefit_cents, data.benefit_kind ?? current.benefit_kind, data.progress_manual === undefined ? current.progress_manual : data.progress_manual, nextScore, nextArchiveRequested, now(), id, current.row_version);
    if (result.changes !== 1) return c.json({ ok: false, error: { code: "STALE_VERSION", message: "Project was changed by another operation" } }, 409);
    if (nextArchiveRequested && nextEndDate) context.database.prepare("UPDATE projects SET archived_at = ?, archive_reason = 'auto', archived_by = 'user', updated_at = ? WHERE id = ? AND archived_at IS NULL").run(now(), now(), id);
    return c.json({ ok: true, project: context.database.prepare("SELECT * FROM projects WHERE id = ?").get(id) });
  });

  app.delete("/api/v1/projects/:id", (c) => {
    const id = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM projects WHERE id = ?").get(id)) return notFound(c, "project");
    const remove = context.database.transaction(() => {
      context.database.prepare("UPDATE finance_expenses SET project_id = NULL WHERE project_id = ?").run(id);
      context.database.prepare("UPDATE finance_incomes SET project_id = NULL WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM task_project_links WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM project_task_plans WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM project_activity_logs WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM task_milestone_links WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = ?)").run(id);
      context.database.prepare("DELETE FROM project_workspaces WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM project_issues WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM project_links WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM milestones WHERE project_id = ?").run(id);
      context.database.prepare("DELETE FROM projects WHERE id = ?").run(id);
    });
    remove();
    return c.json({ ok: true });
  });

  app.post("/api/v1/projects/:id/archive", (c) => {
    const current = context.database.prepare("SELECT end_date FROM projects WHERE id = ? AND archived_at IS NULL").get(c.req.param("id")) as { end_date?: string | null } | undefined;
    if (!current) return notFound(c, "project");
    if (!current.end_date) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "项目归档前必须设置结束时间" } }, 400);
    const result = context.database.prepare("UPDATE projects SET archive_requested = 1, archived_at = ?, archive_reason = 'user', archived_by = 'user', updated_at = ?, row_version = row_version + 1 WHERE id = ? AND archived_at IS NULL").run(now(), now(), c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "project");
    return c.json({ ok: true });
  });

  app.post("/api/v1/projects/:id/restore", (c) => {
    const result = context.database.prepare("UPDATE projects SET archived_at = NULL, archive_reason = NULL, archived_by = NULL, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND archived_at IS NOT NULL").run(now(), c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "project");
    return c.json({ ok: true });
  });

  app.get("/api/v1/projects/:id/workspace", (c) => {
    const workspace = context.database.prepare("SELECT * FROM project_workspaces WHERE project_id = ?").get(c.req.param("id"));
    if (!workspace) return notFound(c, "project workspace");
    return c.json({ ok: true, workspace });
  });

  app.patch("/api/v1/projects/:id/workspace", async (c) => {
    const id = c.req.param("id");
    const project = context.database.prepare("SELECT status FROM projects WHERE id = ? AND archived_at IS NULL").get(id) as { status?: string } | undefined;
    if (!project) return notFound(c, "project");
    if (c.get("agentAuth") && (project.status === "paused" || project.status === "abandoned")) return c.json({ ok: false, error: { code: "FORBIDDEN", message: PAUSED_PROJECT_ADVANCEMENT_ERROR } }, 403);
    const rejectedWorkspace = rejectAgentProjectWrite(c, context.database, id);
    if (rejectedWorkspace) return rejectedWorkspace;
    const body = await c.req.json() as Record<string, unknown>;
    const fields = ["introduction", "goals", "current_situation", "notes"] as const;
    const existing = context.database.prepare("SELECT introduction, goals, current_situation, notes FROM project_workspaces WHERE project_id = ?").get(id) as Record<string, string> | undefined;
    const values = fields.map((field) => typeof body[field] === "string" ? body[field] : (existing?.[field] ?? ""));
    const timestamp = now();
    context.database.prepare(
      `INSERT INTO project_workspaces (project_id, introduction, goals, current_situation, notes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET introduction = excluded.introduction, goals = excluded.goals, current_situation = excluded.current_situation, notes = excluded.notes, updated_at = excluded.updated_at`
    ).run(id, ...values, timestamp);
    return c.json({ ok: true, workspace: context.database.prepare("SELECT * FROM project_workspaces WHERE project_id = ?").get(id) });
  });

  app.get("/api/v1/projects/:id/issues", (c) => c.json({ ok: true, issues: context.database.prepare("SELECT * FROM project_issues WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC").all(c.req.param("id")) }));

  app.post("/api/v1/projects/:id/issues", async (c) => {
    const project = context.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(c.req.param("id"));
    if (!project) return notFound(c, "project");
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.title !== "string" || body.title.trim().length === 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "title is required" } }, 400);
    const id = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO project_issues (id, project_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, c.req.param("id"), body.title.trim(), typeof body.body === "string" ? body.body : "", timestamp, timestamp);
    return c.json({ ok: true, issue: context.database.prepare("SELECT * FROM project_issues WHERE id = ?").get(id) }, 201);
  });

  app.patch("/api/v1/issues/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM project_issues WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "issue");
    const body = await c.req.json() as Record<string, unknown>;
    context.database.prepare("UPDATE project_issues SET title = ?, body = ?, status = ?, updated_at = ? WHERE id = ?").run(typeof body.title === "string" && body.title.trim() ? body.title.trim() : current.title, typeof body.body === "string" ? body.body : current.body, typeof body.status === "string" ? body.status : current.status, now(), id);
    return c.json({ ok: true, issue: context.database.prepare("SELECT * FROM project_issues WHERE id = ?").get(id) });
  });

  app.get("/api/v1/projects/:id/links", (c) => c.json({ ok: true, links: context.database.prepare("SELECT * FROM project_links WHERE project_id = ? AND archived_at IS NULL ORDER BY created_at DESC").all(c.req.param("id")) }));

  app.post("/api/v1/projects/:id/links", async (c) => {
    const project = context.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(c.req.param("id"));
    if (!project) return notFound(c, "project");
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.title !== "string" || typeof body.url !== "string" || !/^https?:\/\//.test(body.url)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "title and http(s) url are required" } }, 400);
    const id = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO project_links (id, project_id, title, url, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, c.req.param("id"), body.title.trim(), body.url, typeof body.note === "string" ? body.note : "", timestamp, timestamp);
    return c.json({ ok: true, link: context.database.prepare("SELECT * FROM project_links WHERE id = ?").get(id) }, 201);
  });

  app.patch("/api/v1/project-links/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM project_links WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "project link");
    const body = await c.req.json() as Record<string, unknown>;
    const url = typeof body.url === "string" ? body.url : current.url;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "url must be http(s)" } }, 400);
    context.database.prepare("UPDATE project_links SET title = ?, url = ?, note = ?, updated_at = ? WHERE id = ?").run(typeof body.title === "string" ? body.title : current.title, url, typeof body.note === "string" ? body.note : current.note, now(), id);
    return c.json({ ok: true, link: context.database.prepare("SELECT * FROM project_links WHERE id = ?").get(id) });
  });

  app.get("/api/v1/milestones", (c) => c.json({ ok: true, milestones: context.database.prepare("SELECT * FROM milestones WHERE archived_at IS NULL ORDER BY project_id, sort_order, created_at").all() }));

  app.post("/api/v1/milestones", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.project_id !== "string" || typeof body.name !== "string" || body.name.trim().length === 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "project_id and name are required" } }, 400);
    const project = context.database.prepare("SELECT 1 FROM projects WHERE id = ?").get(body.project_id);
    if (!project) return notFound(c, "project");
    const id = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO milestones (id, project_id, name, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, body.project_id, body.name.trim(), typeof body.description === "string" ? body.description : "", typeof body.sort_order === "number" ? body.sort_order : 0, timestamp, timestamp);
    return c.json({ ok: true, milestone: context.database.prepare("SELECT * FROM milestones WHERE id = ?").get(id) }, 201);
  });

  app.patch("/api/v1/milestones/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM milestones WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "milestone");
    const body = await c.req.json() as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status : current.status;
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : current.name;
    context.database.prepare("UPDATE milestones SET name = ?, description = ?, status = ?, sort_order = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(name, typeof body.description === "string" ? body.description : current.description, status, typeof body.sort_order === "number" ? body.sort_order : current.sort_order, now(), id);
    return c.json({ ok: true, milestone: context.database.prepare("SELECT * FROM milestones WHERE id = ?").get(id) });
  });

  app.post("/api/v1/deps", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.blocked_task_id !== "string" || typeof body.blocking_task_id !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "blocked_task_id and blocking_task_id are required" } }, 400);
    const edges = (context.database.prepare("SELECT blocked_task_id AS from_task, blocking_task_id AS to_task FROM task_dependencies").all() as Array<{ from_task: string; to_task: string }>).map((edge) => ({ from: edge.from_task, to: edge.to_task }));
    try {
      assertNoCycle(edges, { from: body.blocked_task_id, to: body.blocking_task_id });
    } catch {
      return c.json({ ok: false, error: { code: "CONFLICT", message: "Dependency would create a cycle" } }, 409);
    }
    const id = randomUUID();
    context.database.prepare("INSERT INTO task_dependencies (id, blocked_task_id, blocking_task_id, created_at) VALUES (?, ?, ?, ?)").run(id, body.blocked_task_id, body.blocking_task_id, now());
    return c.json({ ok: true, dependency: context.database.prepare("SELECT * FROM task_dependencies WHERE id = ?").get(id) }, 201);
  });

  app.delete("/api/v1/deps/:id", (c) => {
    const result = context.database.prepare("DELETE FROM task_dependencies WHERE id = ?").run(c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "dependency");
    return c.json({ ok: true });
  });

  app.get("/api/v1/plans", (c) => {
    const plans = context.database.prepare("SELECT p.*, COUNT(i.id) AS item_count, COALESCE(SUM(i.completed), 0) AS completed_count FROM daily_plans p LEFT JOIN daily_plan_items i ON i.plan_id = p.id WHERE p.archived_at IS NULL GROUP BY p.id ORDER BY p.plan_date DESC").all();
    return c.json({ ok: true, plans });
  });

  app.post("/api/v1/plans", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const date = typeof body.plan_date === "string" ? body.plan_date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "plan_date must be YYYY-MM-DD" } }, 400);
    if (context.database.prepare("SELECT id FROM daily_plans WHERE plan_date = ?").get(date)) return c.json({ ok: false, error: { code: "CONFLICT", message: "A plan already exists for this date" } }, 409);
    const id = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO daily_plans (id, plan_date, status, plan_text, created_at, updated_at) VALUES (?, ?, 'draft', '', ?, ?)").run(id, date, timestamp, timestamp);
    return c.json({ ok: true, ...readDailyPlan(context.database, date) }, 201);
  });

  app.get("/api/v1/stage-plans", (c) => {
    const plans = context.database.prepare("SELECT * FROM period_plans WHERE archived_at IS NULL ORDER BY period_start DESC, period_end DESC, created_at DESC").all();
    return c.json({ ok: true, stages: plans });
  });

  app.post("/api/v1/stage-plans", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const periodStart = typeof body.period_start === "string" ? body.period_start : "";
    const periodEnd = typeof body.period_end === "string" ? body.period_end : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) {
      return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "period_start and period_end must be valid YYYY-MM-DD dates" } }, 400);
    }
    if (context.database.prepare("SELECT id FROM period_plans WHERE period_start = ? AND period_end = ?").get(periodStart, periodEnd)) {
      return c.json({ ok: false, error: { code: "CONFLICT", message: "A period plan already exists for this period" } }, 409);
    }
    const id = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO period_plans (id, period_start, period_end, plan_text, status, created_at, updated_at) VALUES (?, ?, ?, '', 'draft', ?, ?)").run(id, periodStart, periodEnd, timestamp, timestamp);
    return c.json({ ok: true, plan: context.database.prepare("SELECT * FROM period_plans WHERE id = ?").get(id) }, 201);
  });

  app.post("/api/v1/stage-plans/upsert", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const periodStart = typeof body.period_start === "string" ? body.period_start : "";
    const periodEnd = typeof body.period_end === "string" ? body.period_end : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) {
      return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "period_start and period_end must be valid YYYY-MM-DD dates" } }, 400);
    }
    if (c.get("agentAuth") && (body.status === "confirmed" || body.status === "executed")) {
      return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot confirm stage plans; use the human UI" } }, 403);
    }
    const plan = upsertPeriodPlan(context.database, periodStart, periodEnd, typeof body.plan_text === "string" ? body.plan_text : undefined);
    if (plan && typeof plan === "object" && "error" in plan) return c.json({ ok: false, error: { code: "CONFLICT", message: String((plan as { error: string }).error) } }, 409);
    return c.json({ ok: true, plan });
  });

  app.patch("/api/v1/stage-plans/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM period_plans WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "period plan");
    const body = await c.req.json() as Record<string, unknown>;
    const planText = typeof body.plan_text === "string" ? body.plan_text : String(current.plan_text ?? "");
    const requestedStatus = typeof body.status === "string" ? body.status : String(current.status ?? "draft");
    if (c.get("agentAuth") && (requestedStatus === "confirmed" || requestedStatus === "executed")) {
      return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot confirm stage plans; use the human UI" } }, 403);
    }
    const status = ["draft", "confirmed", "executed"].includes(requestedStatus) ? requestedStatus : String(current.status ?? "draft");
    context.database.prepare("UPDATE period_plans SET plan_text = ?, status = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(planText, status, now(), id);
    return c.json({ ok: true, plan: context.database.prepare("SELECT * FROM period_plans WHERE id = ?").get(id) });
  });

  app.post("/api/v1/stage-plans/:id/archive", (c) => {
    const id = c.req.param("id");
    const timestamp = now();
    const result = context.database.prepare("UPDATE period_plans SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL").run(timestamp, timestamp, id);
    if (result.changes !== 1) return notFound(c, "period plan");
    return c.json({ ok: true });
  });

  app.delete("/api/v1/stage-plans/:id", (c) => {
    const id = c.req.param("id");
    const result = context.database.prepare("DELETE FROM period_plans WHERE id = ? AND archived_at IS NULL").run(id);
    if (result.changes !== 1) return notFound(c, "period plan");
    return c.json({ ok: true });
  });
  app.get("/api/v1/plans/:date", (c) => c.json({ ok: true, ...readDailyPlan(context.database, c.req.param("date")) }));

  app.patch("/api/v1/plans/:date", async (c) => {
    const date = c.req.param("date");
    const current = context.database.prepare("SELECT * FROM daily_plans WHERE plan_date = ?").get(date) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "daily plan");
    const body = await c.req.json() as Record<string, unknown>;
    const planText = typeof body.plan_text === "string" ? body.plan_text : String(current.plan_text ?? "");
    const requestedStatus = typeof body.status === "string" ? body.status : String(current.status ?? "draft");
    if (c.get("agentAuth") && (requestedStatus === "confirmed" || requestedStatus === "executed")) {
      return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot confirm daily plans; use the human UI" } }, 403);
    }
    const status = ["draft", "confirmed", "executed"].includes(requestedStatus) ? requestedStatus : String(current.status ?? "draft");
    if (typeof body.adjustment_reason === "string" && body.adjustment_reason.trim()) {
      const updated = updateDailyPlanText(context.database, date, planText, body.adjustment_reason);
      if (!c.get("agentAuth") && status !== current.status) {
        context.database.prepare("UPDATE daily_plans SET status = ?, updated_at = ? WHERE plan_date = ?").run(status, now(), date);
      }
      return c.json({ ok: true, ...updated, ...readDailyPlan(context.database, date) });
    }
    context.database.prepare("UPDATE daily_plans SET plan_text = ?, status = ?, updated_at = ? WHERE plan_date = ?").run(planText, status, now(), date);
    return c.json({ ok: true, ...readDailyPlan(context.database, date) });
  });

  app.post("/api/v1/plans/:date/archive", (c) => {
    const timestamp = now();
    const result = context.database.prepare("UPDATE daily_plans SET archived_at = ?, updated_at = ? WHERE plan_date = ? AND archived_at IS NULL").run(timestamp, timestamp, c.req.param("date"));
    if (result.changes !== 1) return notFound(c, "daily plan");
    return c.json({ ok: true });
  });

  app.delete("/api/v1/plans/:date", (c) => {
    const date = c.req.param("date");
    const plan = context.database.prepare("SELECT id FROM daily_plans WHERE plan_date = ?").get(date) as { id: string } | undefined;
    if (!plan) return notFound(c, "daily plan");
    context.database.transaction(() => {
      context.database.prepare("DELETE FROM daily_plan_items WHERE plan_id = ?").run(plan.id);
      context.database.prepare("DELETE FROM daily_plans WHERE id = ?").run(plan.id);
    })();
    return c.json({ ok: true });
  });

  app.post("/api/v1/plans/:date/generate", (c) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "date must be YYYY-MM-DD" } }, 400);
    const generated = generateDailyPlanForDate(context.database, date);
    if ("error" in generated) return c.json({ ok: false, error: { code: "CONFLICT", message: generated.error } }, 409);
    return c.json({ ok: true, ...generated });
  });

  app.patch("/api/v1/plans/:date/items", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.item_id !== "string" || typeof body.completed !== "boolean") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "item_id and completed are required" } }, 400);
    const plan = context.database.prepare("SELECT id FROM daily_plans WHERE plan_date = ?").get(c.req.param("date")) as { id: string } | undefined;
    if (!plan) return notFound(c, "daily plan");
    const result = context.database.prepare("UPDATE daily_plan_items SET completed = ? WHERE id = ? AND plan_id = ?").run(body.completed ? 1 : 0, body.item_id, plan.id);
    if (result.changes !== 1) return notFound(c, "plan item");
    return c.json({ ok: true, ...readDailyPlan(context.database, c.req.param("date")) });
  });

  app.post("/api/v1/plans/:date/confirm", (c) => {
    const timestamp = now();
    const result = context.database.prepare("UPDATE daily_plans SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE plan_date = ? AND status != 'confirmed'").run(timestamp, timestamp, c.req.param("date"));
    if (result.changes !== 1) return notFound(c, "daily plan");
    return c.json({ ok: true, ...readDailyPlan(context.database, c.req.param("date")) });
  });
  app.get("/api/v1/ideas", (c) => {
    const archived = parseArchivedFilter(c);
    if (archived instanceof Response) return archived;
    const rows = context.database.prepare(
      `SELECT * FROM ideas WHERE archived_at ${archived ? "IS NOT NULL" : "IS NULL"}
       ORDER BY COALESCE(urgency, 4) ASC, created_at DESC`
    ).all() as Array<Record<string, unknown>>;
    const ideas = rows.map((row) => ({
      ...row,
      category: normalizeIdeaCategory(row.category),
      urgency: Number(row.urgency ?? 4),
      processed: Number(row.processed ?? 0),
      archive_requested: Number(row.archive_requested ?? 0)
    }));
    return c.json({ ok: true, ideas });
  });

  app.post("/api/v1/ideas", async (c) => {
    const parsed = createIdeaSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const data = parsed.data;
    const id = randomUUID();
    const timestamp = now();
    const category = normalizeIdeaCategory(data.category ?? "short_term");
    const urgency = data.urgency ?? 4;
    const processed = toFlag(data.processed, 0);
    const archiveRequested = toFlag(data.archive_requested, 0);
    const insert = context.database.transaction(() => {
      context.database.prepare("INSERT INTO ideas (id, title, body, category, urgency, processed, archive_requested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, data.title, data.body ?? "", category, urgency, processed, archiveRequested, timestamp, timestamp);
      if (shouldArchiveIdea({ archive_requested: archiveRequested, processed, archived_at: null })) {
        context.database.prepare("UPDATE ideas SET archived_at = ?, archive_reason = 'auto', archived_by = 'user' WHERE id = ? AND archived_at IS NULL").run(timestamp, id);
      }
    });
    insert();
    return c.json({ ok: true, idea: context.database.prepare("SELECT * FROM ideas WHERE id = ?").get(id) }, 201);
  });

  app.patch("/api/v1/ideas/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM ideas WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
    if (!current) return notFound(c, "idea");
    const parsed = patchIdeaSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const data = parsed.data;
    if (c.get("agentAuth") && data.archive_requested !== undefined) return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot archive ideas; use the human UI" } }, 403);
    if (data.row_version !== undefined && data.row_version !== current.row_version) return c.json({ ok: false, error: { code: "STALE_VERSION", message: "Idea was changed by another operation" } }, 409);
    const nextCategory = normalizeIdeaCategory(data.category ?? current.category);
    const nextUrgency = data.urgency ?? Number(current.urgency ?? 4);
    const nextProcessed = toFlag(data.processed, Number(current.processed ?? 0));
    const nextArchiveRequested = toFlag(data.archive_requested, Number(current.archive_requested ?? 0));
    if (c.get("agentAuth") && shouldArchiveIdea({ archive_requested: nextArchiveRequested, processed: nextProcessed, archived_at: current.archived_at as string | null })) {
      return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot trigger idea archiving; use the human UI" } }, 403);
    }
    const timestamp = now();
    let result: { changes: number } = { changes: 0 };
    const write = context.database.transaction(() => {
      result = context.database.prepare("UPDATE ideas SET title = ?, body = ?, category = ?, urgency = ?, processed = ?, archive_requested = ?, status = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND archived_at IS NULL").run(data.title ?? current.title, data.body ?? current.body, nextCategory, nextUrgency, nextProcessed, nextArchiveRequested, data.status ?? current.status, timestamp, id, current.row_version);
      if (result.changes !== 1) return;
      if (shouldArchiveIdea({ archive_requested: nextArchiveRequested, processed: nextProcessed, archived_at: current.archived_at as string | null })) {
        context.database.prepare("UPDATE ideas SET archived_at = ?, archive_reason = 'auto', archived_by = 'user' WHERE id = ? AND archived_at IS NULL").run(timestamp, id);
      }
    });
    write();
    if (result.changes !== 1) return c.json({ ok: false, error: { code: "STALE_VERSION", message: "Idea was changed by another operation" } }, 409);
    return c.json({ ok: true, idea: context.database.prepare("SELECT * FROM ideas WHERE id = ?").get(id) });
  });

  app.delete("/api/v1/ideas/:id", (c) => {
    const id = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM ideas WHERE id = ?").get(id)) return notFound(c, "idea");
    context.database.prepare("DELETE FROM ideas WHERE id = ?").run(id);
    return c.json({ ok: true });
  });

  app.post("/api/v1/ideas/:id/promote", (c) => {
    const idea = context.database.prepare("SELECT * FROM ideas WHERE id = ? AND archived_at IS NULL").get(c.req.param("id")) as { id: string; title: string; body: string } | undefined;
    if (!idea) return notFound(c, "idea");
    const ticketId = randomUUID();
    const timestamp = new Date();
    context.database.prepare("INSERT INTO confirmation_tickets (id, action, payload_json, human_summary, ttl_class, status, created_at, expires_at) VALUES (?, 'ideas.promote', ?, ?, 'parked', 'pending', ?, ?)").run(ticketId, JSON.stringify({ idea_id: idea.id, title: idea.title, body: idea.body }), `将想法“${idea.title}”升级为任务`, timestamp.toISOString(), new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
    return c.json({ ok: false, error: { code: "CONFIRM_REQUIRED", message: "Human confirmation required" }, confirmation: { id: ticketId, status: "pending" } }, 202);
  });

  app.post("/api/v1/ideas/:id/archive", (c) => {
    const result = context.database.prepare("UPDATE ideas SET archived_at = ?, archive_reason = 'user', archived_by = 'user', updated_at = ?, row_version = row_version + 1 WHERE id = ? AND archived_at IS NULL").run(now(), now(), c.req.param("id"));
    if (result.changes !== 1) return notFound(c, "idea");
    return c.json({ ok: true });
  });

  app.get("/api/v1/workflows", (c) => c.json({ ok: true, workflows: context.database.prepare("SELECT * FROM workflow_versions ORDER BY scope, version DESC").all() }));

  app.post("/api/v1/workflows/propose", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const scopes = new Set(["questioning", "review_flow", "schedule_pref", "reminder", "output_format", "user_pref", "workflow", "task_breakdown"]);
    if (typeof body.scope !== "string" || !scopes.has(body.scope) || !body.spec || typeof body.spec !== "object" || typeof body.reason !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "scope, object spec and reason are required" } }, 400);
    const current = context.database.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM workflow_versions WHERE scope = ?").get(body.scope) as { version: number };
    const id = randomUUID();
    const timestamp = now();
    context.database.prepare("INSERT INTO workflow_versions (id, scope, version, status, spec_json, reason, user_feedback, created_by, created_at) VALUES (?, ?, ?, 'pending_review', ?, ?, ?, ?, ?)").run(id, body.scope, current.version + 1, JSON.stringify(body.spec), body.reason, typeof body.user_feedback === "string" ? body.user_feedback : "", "agent", timestamp);
    return c.json({ ok: true, workflow: context.database.prepare("SELECT * FROM workflow_versions WHERE id = ?").get(id) }, 201);
  });

  app.post("/api/v1/workflows/:id/apply", (c) => {
    const workflow = context.database.prepare("SELECT * FROM workflow_versions WHERE id = ? AND status = 'pending_review'").get(c.req.param("id")) as { id: string; scope: string; version: number } | undefined;
    if (!workflow) return notFound(c, "workflow proposal");
    const ticketId = randomUUID();
    const timestamp = new Date();
    context.database.prepare("INSERT INTO confirmation_tickets (id, action, payload_json, human_summary, ttl_class, status, created_at, expires_at) VALUES (?, 'workflow.apply', ?, ?, 'parked', 'pending', ?, ?)").run(ticketId, JSON.stringify({ workflow_id: workflow.id }), `激活 workflow ${workflow.scope} v${workflow.version}`, timestamp.toISOString(), new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
    return c.json({ ok: false, error: { code: "CONFIRM_REQUIRED", message: "Human confirmation required" }, confirmation: { id: ticketId, status: "pending" } }, 202);
  });

  app.post("/api/v1/workflows/:id/rollback", (c) => {
    const workflow = context.database.prepare("SELECT * FROM workflow_versions WHERE id = ?").get(c.req.param("id")) as { id: string; scope: string; version: number } | undefined;
    if (!workflow) return notFound(c, "workflow version");
    const ticketId = randomUUID();
    const timestamp = new Date();
    context.database.prepare("INSERT INTO confirmation_tickets (id, action, payload_json, human_summary, ttl_class, status, created_at, expires_at) VALUES (?, 'workflow.rollback', ?, ?, 'parked', 'pending', ?, ?)").run(ticketId, JSON.stringify({ workflow_id: workflow.id }), `回滚 workflow ${workflow.scope} 到 v${workflow.version}`, timestamp.toISOString(), new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString());
    return c.json({ ok: false, error: { code: "CONFIRM_REQUIRED", message: "Human confirmation required" }, confirmation: { id: ticketId, status: "pending" } }, 202);
  });

  app.get("/api/v1/reviews", (c) => {
    const type = c.req.query("type");
    const rows = context.database.prepare("SELECT * FROM reviews ORDER BY period_end DESC, created_at DESC").all() as Array<Record<string, unknown>>;
    const filtered = type === "daily" || type === "period" ? rows.filter((row) => row.review_type === type) : rows;
    return c.json({ ok: true, reviews: filtered.map(reviewForResponse) });
  });

  app.get("/api/v1/reviews/:id", (c) => {
    const review = context.database.prepare("SELECT * FROM reviews WHERE id = ?").get(c.req.param("id")) as Record<string, unknown> | undefined;
    if (!review) return notFound(c, "review");
    return c.json({ ok: true, review: reviewForResponse(review) });
  });

  app.post("/api/v1/reviews/daily/:date/generate", (c) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "date must be YYYY-MM-DD" } }, 400);
    return c.json({ ok: true, review: reviewForResponse(generateDailyReviewDraft(context.database, date)) });
  });

  app.patch("/api/v1/reviews/:id", async (c) => {
    const id = c.req.param("id");
    const current = context.database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as { content_json: string; status: string; finalized_at?: string | null } | undefined;
    if (!current) return notFound(c, "review");
    if (current.status === "finalized") return c.json({ ok: false, error: { code: "CONFLICT", message: "Finalized review is immutable" } }, 409);
    const body = await c.req.json() as Record<string, unknown>;
    if (c.get("agentAuth") && body.status !== undefined && normalizeReviewStatus(body.status) === "finalized") return c.json({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot finalize reviews; use the human UI" } }, 403);
    let currentContent: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(current.content_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) currentContent = parsed as Record<string, unknown>;
    } catch {
      // Treat malformed legacy content as an empty editable document.
    }
    const nextContent = { ...currentContent, ...(body.content && typeof body.content === "object" && !Array.isArray(body.content) ? body.content as Record<string, unknown> : {}) };
    if (body.answers && typeof body.answers === "object" && !Array.isArray(body.answers)) nextContent.answers = { ...(currentContent.answers as Record<string, unknown> | undefined), ...(body.answers as Record<string, unknown>) };
    const nextStatus = body.status === undefined ? current.status : normalizeReviewStatus(body.status);
    if (body.status !== undefined && !nextStatus) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "status must be draft or completed" } }, 400);
    const finalizedAt = nextStatus === "finalized" ? (current.status === "finalized" ? current.finalized_at ?? now() : now()) : null;
    context.database.prepare("UPDATE reviews SET content_json = ?, status = ?, finalized_at = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(nextContent), nextStatus, finalizedAt, now(), id);
    return c.json({ ok: true, review: reviewForResponse(context.database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Record<string, unknown> | undefined) });
  });

  app.delete("/api/v1/reviews/:id", (c) => {
    const id = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM reviews WHERE id = ?").get(id)) return notFound(c, "review");
    const remove = context.database.transaction(() => {
      context.database.prepare("DELETE FROM review_snapshots WHERE review_id = ?").run(id);
      context.database.prepare("DELETE FROM reviews WHERE id = ?").run(id);
    });
    remove();
    return c.json({ ok: true });
  });

  app.post("/api/v1/reviews/:id/finalize", (c) => {
    const id = c.req.param("id");
    const review = context.database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as { id: string; status: string; period_start: string; period_end: string } | undefined;
    if (!review) return notFound(c, "review");
    if (review.status === "finalized") return c.json({ ok: true, review: context.database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) });
    const taskSnapshot = countTasksByExecutionPeriod(context.database, review.period_start, review.period_end);
    const financeSnapshot = context.database.prepare("SELECT (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS expenses, (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_incomes WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS incomes").get(review.period_start, review.period_end, review.period_start, review.period_end);
    const finalize = context.database.transaction(() => {
      context.database.prepare("DELETE FROM review_snapshots WHERE review_id = ?").run(id);
      context.database.prepare("INSERT INTO review_snapshots (review_id, entity_type, entity_id, snapshot_json) VALUES (?, 'tasks', 'aggregate', ?), (?, 'finance', 'aggregate', ?)").run(id, JSON.stringify(taskSnapshot), id, JSON.stringify(financeSnapshot));
      context.database.prepare("UPDATE reviews SET status = 'finalized', finalized_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
    });
    finalize();
    return c.json({ ok: true, review: reviewForResponse(context.database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Record<string, unknown> | undefined), snapshots: context.database.prepare("SELECT * FROM review_snapshots WHERE review_id = ?").all(id) });
  });

  app.post("/api/v1/reviews/period/generate", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.period_start !== "string" || typeof body.period_end !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "period_start and period_end are required" } }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.period_start) || !/^\d{4}-\d{2}-\d{2}$/.test(body.period_end) || body.period_start > body.period_end) {
      return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "period_start and period_end must be valid YYYY-MM-DD dates" } }, 400);
    }
    return c.json({ ok: true, review: reviewForResponse(generatePeriodReviewDraft(context.database, body.period_start, body.period_end)) }, 201);
  });

  app.post("/api/v1/reviews/period", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.period_start !== "string" || typeof body.period_end !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "period_start and period_end are required" } }, 400);
    const id = randomUUID();
    const timestamp = now();
    const content = body.content && typeof body.content === "object" && !Array.isArray(body.content)
      ? body.content
      : { tasks: countTasksByExecutionPeriod(context.database, body.period_start, body.period_end) };
    context.database.prepare("INSERT INTO reviews (id, review_type, period_start, period_end, mode, status, content_json, created_at, updated_at) VALUES (?, 'period', ?, ?, 'data_first', 'draft', ?, ?, ?)").run(id, body.period_start, body.period_end, JSON.stringify(content), timestamp, timestamp);
    return c.json({ ok: true, review: reviewForResponse(context.database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Record<string, unknown> | undefined) }, 201);
  });

  app.get("/api/v1/archive", (c) => c.json({ ok: true, tasks: context.database.prepare("SELECT id, title, archived_at, archive_reason FROM tasks WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all(), projects: context.database.prepare("SELECT id, name, archived_at, archive_reason FROM projects WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all(), project_tasks: context.database.prepare("SELECT p.id, p.title, p.archived_at, p.archive_reason, p.project_id, pr.name AS project_name FROM project_task_plans p LEFT JOIN projects pr ON pr.id = p.project_id WHERE p.archived_at IS NOT NULL ORDER BY p.archived_at DESC").all(), ideas: context.database.prepare("SELECT id, title, archived_at, archive_reason FROM ideas WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all(), conversations: context.database.prepare("SELECT id, title, archived_at FROM conversations WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all(), plans: context.database.prepare("SELECT id, plan_date, plan_text, archived_at FROM daily_plans WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all(), stage_plans: context.database.prepare("SELECT id, period_start, period_end, plan_text, status, archived_at FROM period_plans WHERE archived_at IS NOT NULL ORDER BY archived_at DESC").all() }));

  app.post("/api/v1/archive/restore", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    if (typeof body.entity_type !== "string" || typeof body.id !== "string") return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "entity_type and id are required" } }, 400);
    const table = archiveTable(body.entity_type);
    if (!table) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "Unsupported archive entity" } }, 400);
    const archiveRequestReset = table === "tasks" || table === "ideas" || table === "projects" || table === "project_task_plans" ? ", archive_requested = 0" : "";
    const versionReset = table === "conversations" || table === "daily_plans" || table === "period_plans" ? "" : ", row_version = row_version + 1";
    const auditReset = table === "conversations" || table === "daily_plans" || table === "period_plans" ? "" : ", archive_reason = NULL, archived_by = NULL";
    const result = context.database.prepare(`UPDATE ${table} SET archived_at = NULL${archiveRequestReset}${auditReset}, updated_at = ?${versionReset} WHERE id = ? AND archived_at IS NOT NULL`).run(now(), body.id);
    if (result.changes !== 1) return notFound(c, body.entity_type);
    if (table === "project_task_plans") unlinkMissingProjectTaskTodo(context.database, body.id);
    return c.json({ ok: true });
  });

  app.delete("/api/v1/archive/:entity/:id", (c) => {
    const table = archiveTable(c.req.param("entity"));
    if (!table) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "Unsupported archive entity" } }, 400);
    const id = c.req.param("id");
    const exists = context.database.prepare(`SELECT id FROM ${table} WHERE id = ? AND archived_at IS NOT NULL`).get(id);
    if (!exists) return notFound(c, "archived item");
    const remove = context.database.transaction(() => {
      if (table === "daily_plans") {
        context.database.prepare("DELETE FROM daily_plan_items WHERE plan_id = ?").run(id);
      }
      if (table === "tasks") {
        const task = context.database.prepare("SELECT recurrence_id, recurrence_date FROM tasks WHERE id = ?").get(id) as { recurrence_id?: string | null; recurrence_date?: string | null } | undefined;
        syncProjectPlansForTodo(context.database, id, "removed");
        context.database.prepare("DELETE FROM daily_plan_items WHERE task_id = ?").run(id);
        context.database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(id);
        context.database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(id);
        context.database.prepare("DELETE FROM task_dependencies WHERE blocked_task_id = ? OR blocking_task_id = ?").run(id, id);
        if (task?.recurrence_id && task.recurrence_date) {
          const timestamp = now();
          context.database.prepare("INSERT INTO task_recurrence_occurrences (id, recurrence_id, occurrence_date, task_id, template_version, outcome, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, 'deleted', ?, ?) ON CONFLICT(recurrence_id, occurrence_date) DO UPDATE SET task_id = NULL, outcome = 'deleted', updated_at = excluded.updated_at").run(randomUUID(), task.recurrence_id, task.recurrence_date, timestamp, timestamp);
        }
      }
      if (table === "projects") {
        context.database.prepare("UPDATE finance_expenses SET project_id = NULL WHERE project_id = ?").run(id);
        context.database.prepare("UPDATE finance_incomes SET project_id = NULL WHERE project_id = ?").run(id);
        context.database.prepare("DELETE FROM project_task_plans WHERE project_id = ?").run(id);
        context.database.prepare("DELETE FROM project_activity_logs WHERE project_id = ?").run(id);
        context.database.prepare("DELETE FROM task_project_links WHERE project_id = ?").run(id);
        context.database.prepare("DELETE FROM task_milestone_links WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = ?)").run(id);
        context.database.prepare("DELETE FROM milestones WHERE project_id = ?").run(id);
        context.database.prepare("DELETE FROM project_issues WHERE project_id = ?").run(id);
        context.database.prepare("DELETE FROM project_links WHERE project_id = ?").run(id);
        context.database.prepare("DELETE FROM project_workspaces WHERE project_id = ?").run(id);
      }
      if (table === "conversations") {
        context.database.prepare("DELETE FROM attachments WHERE conversation_id = ?").run(id);
        context.database.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(id);
      }
      context.database.prepare(`DELETE FROM ${table} WHERE id = ? AND archived_at IS NOT NULL`).run(id);
    });
    remove();
    return c.json({ ok: true, deleted: 1 });
  });

  app.post("/api/v1/archive/delete-batch", async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const table = archiveTable(body.entity_type);
    const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0).slice(0, 500) : [];
    if (!table || ids.length === 0) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "entity_type and ids are required" } }, 400);
    const remove = context.database.transaction(() => {
      let deleted = 0;
      for (const id of ids) {
        const exists = context.database.prepare(`SELECT id FROM ${table} WHERE id = ? AND archived_at IS NOT NULL`).get(id);
        if (!exists) continue;
        if (table === "daily_plans") {
          context.database.prepare("DELETE FROM daily_plan_items WHERE plan_id = ?").run(id);
        }
        if (table === "tasks") {
          const task = context.database.prepare("SELECT recurrence_id, recurrence_date FROM tasks WHERE id = ?").get(id) as { recurrence_id?: string | null; recurrence_date?: string | null } | undefined;
          syncProjectPlansForTodo(context.database, id, "removed");
          context.database.prepare("DELETE FROM daily_plan_items WHERE task_id = ?").run(id);
          context.database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(id);
          context.database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(id);
          context.database.prepare("DELETE FROM task_dependencies WHERE blocked_task_id = ? OR blocking_task_id = ?").run(id, id);
          if (task?.recurrence_id && task.recurrence_date) {
            const timestamp = now();
            context.database.prepare("INSERT INTO task_recurrence_occurrences (id, recurrence_id, occurrence_date, task_id, template_version, outcome, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, 'deleted', ?, ?) ON CONFLICT(recurrence_id, occurrence_date) DO UPDATE SET task_id = NULL, outcome = 'deleted', updated_at = excluded.updated_at").run(randomUUID(), task.recurrence_id, task.recurrence_date, timestamp, timestamp);
          }
        }
        if (table === "projects") {
          context.database.prepare("UPDATE finance_expenses SET project_id = NULL WHERE project_id = ?").run(id);
          context.database.prepare("UPDATE finance_incomes SET project_id = NULL WHERE project_id = ?").run(id);
          context.database.prepare("DELETE FROM project_task_plans WHERE project_id = ?").run(id);
          context.database.prepare("DELETE FROM project_activity_logs WHERE project_id = ?").run(id);
          context.database.prepare("DELETE FROM task_project_links WHERE project_id = ?").run(id);
          context.database.prepare("DELETE FROM task_milestone_links WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = ?)").run(id);
          context.database.prepare("DELETE FROM milestones WHERE project_id = ?").run(id);
          context.database.prepare("DELETE FROM project_issues WHERE project_id = ?").run(id);
          context.database.prepare("DELETE FROM project_links WHERE project_id = ?").run(id);
          context.database.prepare("DELETE FROM project_workspaces WHERE project_id = ?").run(id);
        }
        if (table === "conversations") {
          context.database.prepare("DELETE FROM attachments WHERE conversation_id = ?").run(id);
          context.database.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(id);
        }
        deleted += context.database.prepare(`DELETE FROM ${table} WHERE id = ? AND archived_at IS NOT NULL`).run(id).changes;
      }
      return deleted;
    });
    return c.json({ ok: true, deleted: remove() });
  });

  app.post("/api/v1/archive/purge-request", async (c) => {
    const body = await c.req.json() as Record<string, unknown>;
    const jobId = randomUUID();
    const ticketId = randomUUID();
    const timestamp = new Date();
    const scope = body.scope && typeof body.scope === "object" ? body.scope : { older_than_days: getSetting(context.database, "archive.purge_after_days", 180) };
    const expires = new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const create = context.database.transaction(() => {
      context.database.prepare("INSERT INTO purge_jobs (id, requested_at, scope_json, status) VALUES (?, ?, ?, 'proposed')").run(jobId, timestamp.toISOString(), JSON.stringify(scope));
      context.database.prepare("INSERT INTO confirmation_tickets (id, action, payload_json, human_summary, ttl_class, status, created_at, expires_at) VALUES (?, 'archive.purge', ?, ?, 'parked', 'pending', ?, ?)").run(ticketId, JSON.stringify({ job_id: jobId, scope }), "申请清理已归档数据（不会物理删除财务历史）", timestamp.toISOString(), expires);
    });
    create();
    return c.json({ ok: false, error: { code: "CONFIRM_REQUIRED", message: "Human confirmation required" }, confirmation: { id: ticketId, jobId, status: "pending" } }, 202);
  });

  app.get("/api/v1/stats/:domain", (c) => {
    const domain = c.req.param("domain");
    if (!["finance", "health", "reviews", "tasks"].includes(domain)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "Unsupported stats domain" } }, 400);
    const from = c.req.query("from") ?? "";
    const to = c.req.query("to") ?? "";
    return c.json({ ok: true, available: false, domain, from, to, series: [] });
  });

  app.get("/api/v1/confirmations", (c) => {
    context.database.prepare("UPDATE confirmation_tickets SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").run(now());
    return c.json({ ok: true, confirmations: context.database.prepare("SELECT * FROM confirmation_tickets WHERE status = 'pending' ORDER BY created_at DESC").all() });
  });

  app.post("/api/v1/confirmations/:id/reject", (c) => {
    const result = context.database.prepare("UPDATE confirmation_tickets SET status = 'rejected', resolved_at = ?, resolved_by = 'user' WHERE id = ? AND status = 'pending' AND expires_at > ?").run(now(), c.req.param("id"), now());
    if (result.changes !== 1) return notFound(c, "confirmation ticket");
    return c.json({ ok: true });
  });

  app.post("/api/v1/confirmations/:id/approve", (c) => {
    const ticket = context.database.prepare("SELECT * FROM confirmation_tickets WHERE id = ? AND status = 'pending' AND expires_at > ?").get(c.req.param("id"), now()) as { id: string; action: string; payload_json: string } | undefined;
    if (!ticket) return notFound(c, "confirmation ticket");
    const payload = JSON.parse(ticket.payload_json) as Record<string, unknown>;
    const timestamp = now();
    const execute = context.database.transaction(() => {
      if (ticket.action === "ideas.promote") {
        const idea = context.database.prepare("SELECT * FROM ideas WHERE id = ? AND archived_at IS NULL").get(payload.idea_id) as { id: string; title: string; body: string } | undefined;
        if (!idea) throw new Error("IDEA_NOT_FOUND");
        const taskId = randomUUID();
        context.database.prepare("INSERT INTO tasks (id, title, description, status, priority, created_at, updated_at) VALUES (?, ?, ?, 'todo', 'P2', ?, ?)").run(taskId, idea.title, idea.body, timestamp, timestamp);
        context.database.prepare("UPDATE ideas SET status = 'promoted', promoted_task_id = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(taskId, timestamp, idea.id);
        context.database.prepare("UPDATE confirmation_tickets SET status = 'executed', resolved_at = ?, resolved_by = 'user', executed_at = ? WHERE id = ?").run(timestamp, timestamp, ticket.id);
        return { taskId };
      }
      if (ticket.action === "workflow.apply" || ticket.action === "workflow.rollback") {
        const workflow = context.database.prepare("SELECT id, scope FROM workflow_versions WHERE id = ?").get(payload.workflow_id) as { id: string; scope: string } | undefined;
        if (!workflow) throw new Error("WORKFLOW_NOT_FOUND");
        context.database.prepare("UPDATE workflow_versions SET status = 'rolled_back' WHERE scope = ? AND status = 'active'").run(workflow.scope);
        context.database.prepare("UPDATE workflow_versions SET status = 'active' WHERE id = ?").run(workflow.id);
        context.database.prepare("UPDATE confirmation_tickets SET status = 'executed', resolved_at = ?, resolved_by = 'user', executed_at = ? WHERE id = ?").run(timestamp, timestamp, ticket.id);
        return { workflowId: workflow.id };
      }
      if (ticket.action === "system.export") {
        const scope = (payload.scope && typeof payload.scope === "object" ? payload.scope : {}) as { include_finance?: boolean; include_health?: boolean };
        const exportDir = join(context.config.dataDir, "exports");
        mkdirSync(exportDir, { recursive: true });
        const filename = `export-${timestamp.replace(/[-:TZ.]/g, "").slice(0, 14)}.json`;
        const exportData: Record<string, unknown> = {
          format_version: 1,
          exported_at: timestamp,
          source: "Personal AI OS",
          users: context.database.prepare("SELECT * FROM users").all(),
          settings: context.database.prepare("SELECT key, value_json FROM app_settings WHERE key NOT LIKE 'llm.%'").all(),
          projects: context.database.prepare("SELECT * FROM projects").all(),
          project_workspaces: context.database.prepare("SELECT * FROM project_workspaces").all(),
          project_issues: context.database.prepare("SELECT * FROM project_issues").all(),
          project_links: context.database.prepare("SELECT * FROM project_links").all(),
          milestones: context.database.prepare("SELECT * FROM milestones").all(),
          tasks: context.database.prepare("SELECT * FROM tasks").all(),
          task_project_links: context.database.prepare("SELECT * FROM task_project_links").all(),
          task_milestone_links: context.database.prepare("SELECT * FROM task_milestone_links").all(),
          task_dependencies: context.database.prepare("SELECT * FROM task_dependencies").all(),
          ideas: context.database.prepare("SELECT * FROM ideas").all(),
          daily_plans: context.database.prepare("SELECT * FROM daily_plans").all(),
          daily_plan_items: context.database.prepare("SELECT * FROM daily_plan_items").all(),
          period_plans: context.database.prepare("SELECT * FROM period_plans").all(),
          workflows: context.database.prepare("SELECT * FROM workflow_versions").all()
        };
        if (scope.include_finance !== false) {
          exportData.finance_accounts = context.database.prepare("SELECT * FROM finance_accounts").all();
          exportData.finance_expenses = context.database.prepare("SELECT * FROM finance_expenses").all();
          exportData.finance_incomes = context.database.prepare("SELECT * FROM finance_incomes").all();
          exportData.finance_transactions = context.database.prepare("SELECT * FROM finance_transactions").all();
          exportData.finance_transaction_legs = context.database.prepare("SELECT * FROM finance_transaction_legs").all();
        }
        if (scope.include_health !== false) exportData.health_logs = context.database.prepare("SELECT * FROM health_logs").all();
        exportData.reviews = context.database.prepare("SELECT * FROM reviews").all();
        exportData.review_snapshots = context.database.prepare("SELECT * FROM review_snapshots").all();
        const exportPath = join(exportDir, filename);
        writeFileSync(exportPath, JSON.stringify(exportData, null, 2), "utf8");
        context.database.prepare("UPDATE confirmation_tickets SET status = 'executed', resolved_at = ?, resolved_by = 'user', executed_at = ? WHERE id = ?").run(timestamp, timestamp, ticket.id);
        return { exportPath, containsSecrets: false };
      }
      if (ticket.action === "system.restore") {
        const backupPath = typeof payload.path === "string" ? payload.path : "";
        if (!backupPath || !existsSync(backupPath)) throw new Error("BACKUP_NOT_FOUND");
        const pendingPath = join(context.config.dataDir, "restore.pending.db");
        copyFileSync(backupPath, pendingPath);
        context.database.prepare("UPDATE confirmation_tickets SET status = 'executed', resolved_at = ?, resolved_by = 'user', executed_at = ? WHERE id = ?").run(timestamp, timestamp, ticket.id);
        return { pendingRestore: pendingPath, restartRequired: true };
      }
      if (ticket.action === "archive.purge") {
        context.database.prepare("UPDATE purge_jobs SET status = 'approved', confirmed_by = ? WHERE id = ?").run("user", payload.job_id);
        context.database.prepare("UPDATE confirmation_tickets SET status = 'approved', resolved_at = ?, resolved_by = 'user' WHERE id = ?").run(timestamp, ticket.id);
        return { jobId: payload.job_id };
      }
      throw new Error("UNSUPPORTED_TICKET_ACTION");
    });
    try {
      return c.json({ ok: true, result: execute() });
    } catch (error) {
      return c.json({ ok: false, error: { code: "CONFLICT", message: error instanceof Error ? error.message : "Ticket execution failed" } }, 409);
    }
  });

  app.post("/api/v1/batch", async (c) => {
    const body = await c.req.json() as { commands?: Array<{ method?: string; path?: string; body?: unknown }> };
    if (!Array.isArray(body.commands) || body.commands.length > 20) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "commands must contain at most 20 items" } }, 400);
    const results: unknown[] = [];
    for (const command of body.commands) {
      if (!command.path?.startsWith("/api/v1/") || !["GET", "POST", "PATCH"].includes(command.method ?? "")) {
        results.push({ ok: false, error: { code: "BAD_REQUEST", message: "unsupported batch command" } });
        continue;
      }
      if (command.path.includes("/confirmations/") && command.path.endsWith("/approve")) {
        results.push({ ok: false, error: { code: "FORBIDDEN", message: "Agents cannot approve confirmation tickets" } });
        continue;
      }
      const response = await app.fetch(new Request(`http://paios.local${command.path}`, { method: command.method, headers: { "Content-Type": "application/json" }, body: command.method === "GET" ? undefined : JSON.stringify(command.body ?? {}) }));
      results.push(await response.json().catch(() => ({ ok: false, error: { code: "INTERNAL_ERROR", message: "Invalid batch response" } })));
    }
    return c.json({ ok: true, results });
  });

  app.get("/api/v1/today", (c) => {
    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");
    const date = localDateInTimezone(timezone);
    try { syncUpcomingCheckpointsToTodos(context.database, date); } catch {}
    const start = monthStart(date);
    const todayTasks = context.database.prepare(
      `SELECT id, title, description, content, status, due_date, scheduled_date, recurrence_date, updated_at
       FROM tasks
       WHERE archived_at IS NULL AND status != 'cancelled' AND due_date = ?
       ORDER BY due_date ASC, created_at ASC
       LIMIT 100`
    ).all(date) as Array<Record<string, unknown>>;
    const overdueTasks = context.database.prepare(
      `SELECT id, title, description, content, status, due_date, scheduled_date, recurrence_date, updated_at
       FROM tasks
       WHERE archived_at IS NULL AND status NOT IN ('done', 'cancelled') AND due_date < ?
       ORDER BY due_date ASC, created_at ASC
       LIMIT 100`
    ).all(date) as Array<Record<string, unknown>>;
    const taskRows = context.database.prepare(
      `SELECT
        SUM(CASE WHEN due_date = @date AND status != 'cancelled' THEN 1 ELSE 0 END) AS due,
        SUM(CASE WHEN due_date = @date AND status = 'done' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN due_date < @date AND status NOT IN ('done', 'cancelled') THEN 1 ELSE 0 END) AS overdue
       FROM tasks WHERE archived_at IS NULL`
    ).get({ date }) as { due: number | null; completed: number | null; overdue: number | null };
    const finance = context.database.prepare(
      `SELECT
        (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses WHERE occurred_date >= @start AND occurred_date <= @date AND archived_at IS NULL) AS expenses,
        (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_incomes WHERE occurred_date >= @start AND occurred_date <= @date AND archived_at IS NULL) AS incomes`
    ).get({ start, date }) as { expenses: number; incomes: number };
    const health = context.database.prepare(
      "SELECT 1 AS recorded FROM health_logs WHERE log_date = ? AND archived_at IS NULL LIMIT 1"
    ).get(date) as { recorded: number } | undefined;
    const confirmations = context.database.prepare(
      "SELECT COUNT(*) AS count FROM confirmation_tickets WHERE status = 'pending' AND expires_at > ?"
    ).get(new Date().toISOString()) as { count: number };
    const plan = context.database.prepare(
      `SELECT p.status, COUNT(i.id) AS item_count
       FROM daily_plans p LEFT JOIN daily_plan_items i ON i.plan_id = p.id
       WHERE p.plan_date = ? GROUP BY p.id`
    ).get(date) as { status: string; item_count: number } | undefined;
    return c.json({
      ok: true,
      date,
      timezone,
      tasks: {
        due: taskRows.due ?? 0,
        completed: taskRows.completed ?? 0,
        overdue: taskRows.overdue ?? 0,
        items: todayTasks,
        overdueItems: overdueTasks
      },
      finance: {
        monthExpenseCents: finance.expenses,
        monthIncomeCents: finance.incomes
      },
      health: { recorded: Boolean(health?.recorded) },
      confirmations: confirmations.count,
      plan: {
        confirmed: plan?.status === "confirmed",
        itemCount: plan?.item_count ?? 0
      }
    });
  });

  app.get("/api/v1/health/:date", (c) => {
    const row = context.database.prepare(
      "SELECT log_date, weight_kg, bedtime_local, sleep_onset_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined, cloud_content, note, created_at, updated_at FROM health_logs WHERE log_date = ?"
    ).get(c.req.param("date"));
    return c.json({ ok: true, health: row ?? null });
  });

  app.get("/api/v1/health", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "from and to are required" } }, 400);
    return c.json({ ok: true, health: context.database.prepare("SELECT log_date, weight_kg, bedtime_local, sleep_onset_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined, cloud_content, note, created_at, updated_at FROM health_logs WHERE log_date BETWEEN ? AND ? ORDER BY log_date").all(from, to) });
  });

  app.put("/api/v1/health/:date", async (c) => {
    const date = c.req.param("date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "date must be YYYY-MM-DD" } }, 400);
    const body = await c.req.json();
    const parsed = healthLogSchema.safeParse(body);
    if (!parsed.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed.error.message } }, 400);
    const data = parsed.data;
    for (const field of ["bedtime_local", "sleep_onset_local", "wake_local"] as const) {
      if (data[field] !== undefined && data[field] !== null && !validTime(data[field])) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: `${field} must be a valid HH:MM time` } }, 400);
    }
    const current = context.database.prepare("SELECT * FROM health_logs WHERE log_date = ?").get(date) as Record<string, unknown> | undefined;
    const value = (field: keyof typeof data, fallback: unknown = null) => data[field] === undefined ? (current?.[field] ?? fallback) : data[field];
    const bedtime = value("bedtime_local") as string | null;
    const wake = value("wake_local") as string | null;
    const computedSleep = bedtime && wake ? sleepMinutes(bedtime, wake) : null;
    const disciplined = data.disciplined === undefined
      ? current?.disciplined === undefined || current.disciplined === null ? null : Number(current.disciplined) === 1 ? 1 : 0
      : data.disciplined === null ? null : toFlag(data.disciplined, 0);
    const timestamp = now();
    context.database.prepare(
      `INSERT INTO health_logs (id, log_date, weight_kg, bedtime_local, sleep_onset_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined, cloud_content, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(log_date) DO UPDATE SET weight_kg = excluded.weight_kg, bedtime_local = excluded.bedtime_local, sleep_onset_local = excluded.sleep_onset_local, wake_local = excluded.wake_local, sleep_duration_minutes = excluded.sleep_duration_minutes, exercise_note = excluded.exercise_note, exercise_minutes = excluded.exercise_minutes, disciplined = excluded.disciplined, cloud_content = excluded.cloud_content, note = excluded.note, updated_at = excluded.updated_at`
    ).run(randomUUID(), date, value("weight_kg"), bedtime, value("sleep_onset_local"), wake, computedSleep, value("exercise_note"), value("exercise_minutes"), disciplined, value("cloud_content", value("note")), value("note"), current?.created_at ?? timestamp, timestamp);
    return c.json({ ok: true, health: context.database.prepare("SELECT * FROM health_logs WHERE log_date = ?").get(date) });
  });

  app.delete("/api/v1/health/:date", (c) => {
    const date = c.req.param("date");
    const result = context.database.prepare("DELETE FROM health_logs WHERE log_date = ?").run(date);
    if (result.changes !== 1) return notFound(c, "health log");
    return c.json({ ok: true });
  });

  app.get("/api/v1/tasks", (c) => {
    try { syncUpcomingCheckpointsToTodos(context.database); } catch {}
    const archived = parseArchivedFilter(c);
    if (archived instanceof Response) return archived;
    const date = c.req.query("date");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const undated = c.req.query("undated") === "1" || c.req.query("undated") === "true";
    const overdue = c.req.query("overdue") === "1" || c.req.query("overdue") === "true";
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "date must be YYYY-MM-DD" } }, 400);
    const today = localDateInTimezone(getSetting(context.database, "timezone", "Asia/Shanghai"));
    const extra = undated
      ? " AND due_date IS NULL AND status NOT IN ('done', 'cancelled')"
      : overdue
        ? " AND due_date IS NOT NULL AND due_date < ? AND status NOT IN ('done', 'cancelled')"
        : date
          ? " AND due_date = ?"
          : from && to
            ? " AND due_date BETWEEN ? AND ?"
            : "";
    const params = overdue ? [today] : date ? [date] : from && to ? [from, to] : [];
    const rows = context.database.prepare(
      `SELECT tasks.id, tasks.title, tasks.description, tasks.status, tasks.priority, tasks.due_date, tasks.scheduled_date, tasks.recurrence_id, tasks.recurrence_date, tasks.parent_id, tasks.archive_requested, tasks.archived_at, tasks.row_version, tasks.created_at, tasks.updated_at,
        COALESCE(
          (SELECT pt.project_id FROM project_task_plans pt WHERE pt.todo_task_id = tasks.id AND pt.archived_at IS NULL LIMIT 1),
          (SELECT l.project_id FROM task_project_links l WHERE l.task_id = tasks.id LIMIT 1)
        ) AS project_id,
        COALESCE(
          (SELECT p.name FROM project_task_plans pt JOIN projects p ON p.id = pt.project_id WHERE pt.todo_task_id = tasks.id AND pt.archived_at IS NULL LIMIT 1),
          (SELECT p.name FROM task_project_links l JOIN projects p ON p.id = l.project_id WHERE l.task_id = tasks.id LIMIT 1)
        ) AS project_name,
        (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = tasks.id AND sub.archived_at IS NULL) AS subtask_count,
        (SELECT COUNT(*) FROM tasks sub WHERE sub.parent_id = tasks.id AND sub.archived_at IS NULL AND sub.status = 'done') AS subtask_done_count
       FROM tasks WHERE archived_at ${archived ? "IS NOT NULL" : "IS NULL"}${extra}
       ORDER BY due_date IS NULL, due_date ASC, created_at ASC`
    ).all(...params) as Array<Record<string, unknown>>;
    return c.json({ ok: true, tasks: rows.map((row) => ({ ...row, status: normalizeTaskStatus(row.status), archive_requested: Number(row.archive_requested ?? 0) })) });
  });

  app.post("/api/v1/system/backup", (c) => {
    const retain = getSetting(context.database, "backup.retain", WEEKLY_BACKUP_RETAIN);
    const path = createBackup(context.database, context.config.dataDir, retain);
    return c.json({ ok: true, path, createdAt: new Date().toISOString() });
  });

  const webRoot = join(process.cwd(), "apps", "web", "dist");
  if (existsSync(join(webRoot, "index.html"))) {
    app.use("/assets/*", serveStatic({ root: webRoot }));
    app.get("/", (c) => c.html(readFileSync(join(webRoot, "index.html"), "utf8")));
  }

  app.get("/", (c) => c.html("<!doctype html><html><body><h1>Personal AI OS</h1><p>服务已运行。开发时请打开 Vite 页面。</p></body></html>"));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, 500);
  });
  return app;
}




