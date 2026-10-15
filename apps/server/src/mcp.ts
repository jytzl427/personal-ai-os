import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { acquireDirectMcpMarker, ensureWeeklyBackup, getSetting, openDatabase, type PaiosDatabase, type WeeklyBackupResult } from "@paios/db";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { runRecurrenceSyncWithRetry } from "./recurrence-service.js";
import { getToolCatalogEntry } from "./tool-catalog.js";

type RequestInitWithBody = RequestInit & { body?: string };
type LocalRequestExecutor = (request: Request) => Response | Promise<Response>;

class PaiosApiClient {
  constructor(
    private readonly baseUrl: string | undefined,
    private readonly token: string | undefined,
    private readonly localExecutor?: LocalRequestExecutor
  ) {}

  async request(path: string, init: RequestInitWithBody = {}, toolName?: string): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-PAIOS-Agent-Transport", "mcp");
    headers.set("X-Agent-Name", process.env.PAIOS_AGENT_NAME || "mcp");
    if (toolName) headers.set("X-Tool-Name", toolName);
    let body = init.body;
    if (body) {
      headers.set("Content-Type", "application/json");
      try {
        const parsed = JSON.parse(body) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof (parsed as Record<string, unknown>).idempotency_key === "string") {
          headers.set("X-PAIOS-Idempotency-Key", `mcp:${(parsed as Record<string, unknown>).idempotency_key}`);
          const { idempotency_key: _idempotencyKey, ...withoutKey } = parsed as Record<string, unknown>;
          body = JSON.stringify(withoutKey);
        }
      } catch {
        // The caller's schema should reject malformed JSON before it reaches the request layer.
      }
    }
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    const target = new URL(path, this.baseUrl ?? "http://paios.local");
    const response = this.localExecutor
      ? await this.localExecutor(new Request(target, { ...init, body, headers }))
      : await fetch(target, { ...init, body, headers });
    const responseBody = await response.json().catch(() => null) as unknown;
    if (!response.ok) throw new Error(`PAIOS_API_${response.status}: ${JSON.stringify(responseBody)}`);
    return responseBody;
  }

  get(path: string, toolName?: string): Promise<unknown> { return this.request(path, {}, toolName); }

  post(path: string, body?: unknown, toolName?: string): Promise<unknown> {
    return this.request(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }, toolName);
  }

  patch(path: string, body: unknown, toolName?: string): Promise<unknown> {
    return this.request(path, { method: "PATCH", body: JSON.stringify(body) }, toolName);
  }

  put(path: string, body: unknown, toolName?: string): Promise<unknown> {
    return this.request(path, { method: "PUT", body: JSON.stringify(body) }, toolName);
  }
}

function result(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

type BatchOperation = {
  schema: z.ZodTypeAny;
  run: (input: any) => Promise<unknown>;
};

const recurrenceRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(1000).optional(),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  day_of_month: z.number().int().min(1).max(31).optional(),
  month: z.number().int().min(1).max(12).optional()
});
const idempotencyKeySchema = z.string().min(1).max(200).optional();

export async function runMcp(): Promise<void> {
  const baseUrl = process.env.PAIOS_URL || "http://127.0.0.1:4738";
  const token = process.env.PAIOS_TOKEN?.trim();
  if (!token) throw new Error("PAIOS_TOKEN is required for the MCP adapter");
  const client = new PaiosApiClient(baseUrl, token);
  await runMcpServer(client);
}

/**
 * Run MCP without the HTTP service or the desktop UI. The Agent launches this
 * mode as a child process, so the local database remains available when the
 * user has not opened the graphical workbench.
 */
export async function runDirectMcp(): Promise<void> {
  const token = process.env.PAIOS_TOKEN?.trim();
  if (!token) throw new Error("PAIOS_TOKEN is required for direct MCP");

  const config = loadConfig();
  const releaseMcpMarker = acquireDirectMcpMarker(config.dataDir);
  let database: PaiosDatabase | undefined;
  try {
    if (existsSync(join(config.dataDir, "restore.pending.db"))) {
      throw new Error("本地存在待恢复数据，请先重启图形界面后再启动直连 MCP");
    }
    const openedDatabase = openDatabase(config.dataDir, { applyPendingRestore: false });
    database = openedDatabase;
    const timezone = getSetting(openedDatabase, "timezone", "Asia/Shanghai");
    let weeklyBackup: WeeklyBackupResult;
    try {
      weeklyBackup = await ensureWeeklyBackup(openedDatabase, config.dataDir, timezone);
      if (weeklyBackup.status === "failed") console.error("周备份失败，将在下次启动重试", weeklyBackup.error);
    } catch (error) {
      weeklyBackup = { status: "failed", anchorDate: "unknown", error: error instanceof Error ? error.message : String(error) };
      console.error("周备份检查失败，将在下次启动重试", error);
    }
    const recurrenceSync = Promise.resolve().then(() => runRecurrenceSyncWithRetry(openedDatabase, config.dataDir, undefined, "startup"));
    const app = createApp({ database: openedDatabase, config, recurrenceSync, weeklyBackup, directMcp: true });
    const client = new PaiosApiClient(undefined, token, (request) => app.fetch(request));

    const close = () => {
      if (openedDatabase.open) openedDatabase.close();
      releaseMcpMarker();
    };
    const shutdown = () => {
      close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.stdin.once("end", shutdown);
    process.once("exit", close);
    await runMcpServer(client);
  } catch (error) {
    if (database?.open) database.close();
    releaseMcpMarker();
    throw error;
  }
}

async function runMcpServer(client: PaiosApiClient): Promise<void> {
  const server = new McpServer({ name: "paios", version: "2.0.0" });

  const batchOperations: Record<string, BatchOperation> = {
    system_status: { schema: z.object({}), run: () => client.get("/api/v1/system/status", "system_status") },
    capabilities_get: { schema: z.object({}), run: () => client.get("/api/v1/system/capabilities", "capabilities_get") },
    today_get: { schema: z.object({}), run: () => client.get("/api/v1/today", "today_get") },
    attention_get: { schema: z.object({}), run: () => client.get("/api/v1/system/attention", "attention_get") },
    planning_context_get: {
      schema: z.object({ mode: z.enum(["daily", "stage"]).optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      run: (input) => client.get(`/api/v1/planning/context${query({ mode: input.mode, date: input.date, period_start: input.period_start, period_end: input.period_end })}`, "planning_context_get")
    },
    tasks_list: {
      schema: z.object({ date: z.string().optional(), undated: z.boolean().optional(), overdue: z.boolean().optional(), from: z.string().optional(), to: z.string().optional() }),
      run: (input) => client.get(`/api/v1/tasks${query({ date: input.date, undated: input.undated, overdue: input.overdue, from: input.from, to: input.to })}`, "tasks_list")
    },
    tasks_get: {
      schema: z.object({ task_id: z.string().min(1) }),
      run: (input) => client.get(`/api/v1/tasks/${encodeURIComponent(input.task_id)}`, "tasks_get")
    },
    tasks_create: {
      schema: z.object({
        title: z.string().min(1), description: z.string().optional(), priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
        due_date: z.string().optional(), scheduled_date: z.string().optional(), project_id: z.string().min(1).optional(), milestone_id: z.string().min(1).optional(), idempotency_key: idempotencyKeySchema
      }),
      run: (input) => client.post("/api/v1/tasks", input, "tasks_create")
    },
    tasks_update: {
      schema: z.object({
        task_id: z.string().min(1), title: z.string().max(200).optional(), description: z.string().max(10000).optional(),
        content: z.string().max(10000).optional(), status: z.enum(["todo", "done", "cancelled"]).optional(),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), project_id: z.string().min(1).nullable().optional(), milestone_id: z.string().min(1).nullable().optional(), row_version: z.number().int().positive().optional(), idempotency_key: idempotencyKeySchema
      }),
      run: ({ task_id, ...body }) => client.patch(`/api/v1/tasks/${encodeURIComponent(task_id)}`, body, "tasks_update")
    },
    plans_get: {
      schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
      run: (input) => client.get(`/api/v1/plans/${input.date}`, "plans_get")
    },
    plans_generate: {
      schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post(`/api/v1/plans/${input.date}/generate`, { idempotency_key: input.idempotency_key }, "plans_generate")
    },
    plans_update: {
      schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), plan_text: z.string(), adjustment_reason: z.string().optional(), idempotency_key: idempotencyKeySchema }),
      run: ({ date, ...body }) => client.patch(`/api/v1/plans/${date}`, body, "plans_update")
    },
    period_plans_upsert: {
      schema: z.object({ period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), plan_text: z.string().optional(), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post("/api/v1/stage-plans/upsert", input, "period_plans_upsert")
    },
    projects_list: { schema: z.object({}), run: () => client.get("/api/v1/projects", "projects_list") },
    projects_get: {
      schema: z.object({ project_id: z.string().min(1) }),
      run: (input) => client.get(`/api/v1/projects/${encodeURIComponent(input.project_id)}`, "projects_get")
    },
    projects_create: {
      schema: z.object({
        name: z.string().min(1), description: z.string().optional(), category: z.enum(["small", "mid", "long_term"]).optional(), template: z.enum(["small", "mid", "long_term"]).optional(),
        started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), target_result: z.string().optional(), benefit_enabled: z.boolean().optional(), idempotency_key: idempotencyKeySchema
      }),
      run: (input) => client.post("/api/v1/projects", input, "projects_create")
    },
    projects_update: {
      schema: z.object({
        project_id: z.string().min(1), name: z.string().min(1).optional(), description: z.string().optional(),
        category: z.enum(["small", "mid", "long_term"]).optional(), started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), target_result: z.string().optional(), benefit_enabled: z.boolean().optional(),
        status: z.enum(["idea", "planned", "active", "done"]).optional(), progress_manual: z.number().int().min(0).max(100).nullable().optional(), row_version: z.number().int().positive().optional(), idempotency_key: idempotencyKeySchema
      }),
      run: ({ project_id, ...body }) => client.patch(`/api/v1/projects/${encodeURIComponent(project_id)}`, body, "projects_update")
    },
    project_workspace_update: {
      schema: z.object({ project_id: z.string().min(1), introduction: z.string().optional(), goals: z.string().optional(), current_situation: z.string().optional(), notes: z.string().optional(), idempotency_key: idempotencyKeySchema }),
      run: ({ project_id, ...body }) => client.patch(`/api/v1/projects/${encodeURIComponent(project_id)}/workspace`, body, "project_workspace_update")
    },
    ideas_list: { schema: z.object({ archived: z.boolean().optional() }), run: (input) => client.get(`/api/v1/ideas${input.archived === undefined ? "" : `?archived=${input.archived ? 1 : 0}`}`, "ideas_list") },
    ideas_create: {
      schema: z.object({ title: z.string().min(1), body: z.string().optional(), category: z.enum(["project", "long_term", "short_term"]).optional(), urgency: z.number().int().min(1).max(4).optional(), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post("/api/v1/ideas", input, "ideas_create")
    },
    ideas_update: {
      schema: z.object({
        idea_id: z.string().min(1), title: z.string().max(200).optional(), body: z.string().max(10000).optional(),
        category: z.enum(["project", "long_term", "short_term"]).optional(), urgency: z.number().int().min(1).max(4).optional(),
        processed: z.boolean().optional(), row_version: z.number().int().positive().optional(), idempotency_key: idempotencyKeySchema
      }),
      run: ({ idea_id, ...body }) => client.patch(`/api/v1/ideas/${encodeURIComponent(idea_id)}`, body, "ideas_update")
    },
    task_recurrences_list: { schema: z.object({}), run: () => client.get("/api/v1/task-recurrences", "task_recurrences_list") },
    task_recurrence_get: { schema: z.object({ recurrence_id: z.string().min(1) }), run: (input) => client.get(`/api/v1/task-recurrences/${encodeURIComponent(input.recurrence_id)}`, "task_recurrence_get") },
    task_recurrence_occurrences_list: { schema: z.object({ recurrence_id: z.string().min(1), limit: z.number().int().min(1).max(500).optional() }), run: (input) => client.get(`/api/v1/task-recurrences/${encodeURIComponent(input.recurrence_id)}/occurrences${input.limit ? `?limit=${input.limit}` : ""}`, "task_recurrence_occurrences_list") },
    task_recurrence_check: {
      schema: z.object({ recurrence_id: z.string().min(1), repair: z.boolean().optional(), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post(`/api/v1/task-recurrences/${encodeURIComponent(input.recurrence_id)}/check`, { repair: input.repair === true, idempotency_key: input.idempotency_key }, "task_recurrence_check")
    },
    finance_accounts_list: { schema: z.object({}), run: () => client.get("/api/v1/finance/accounts", "finance_accounts_list") },
    finance_account_entries_list: {
      schema: z.object({ account_id: z.string().optional(), direction: z.enum(["deposit", "withdrawal"]).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      run: (input) => client.get(`/api/v1/finance/account-entries${query({ account_id: input.account_id, direction: input.direction, from: input.from, to: input.to })}`, "finance_account_entries_list")
    },
    finance_account_entry_create: {
      schema: z.object({ account_id: z.string().min(1), direction: z.enum(["deposit", "withdrawal"]), amount_cents: z.number().int().positive(), event: z.string().max(10000).optional(), note: z.string().max(10000).optional(), occurred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post("/api/v1/finance/account-entries", input, "finance_account_entry_create")
    },
    finance_quick_preview: {
      schema: z.object({ input: z.string().min(1) }),
      run: (input) => client.post("/api/v1/finance/preview", input, "finance_quick_preview")
    },
    finance_expense_create: {
      schema: z.object({ amount_cents: z.number().int().positive(), category_major: z.string().optional(), category_minor: z.string().optional(), category: z.string().optional(), project_id: z.string().min(1).optional(), event: z.string().max(10000).optional(), note: z.string().max(10000).optional(), occurred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post("/api/v1/finance/expenses", input, "finance_expense_create")
    },
    finance_expenses_list: {
      schema: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), category_major: z.string().optional(), category_minor: z.string().optional() }),
      run: (input) => client.get(`/api/v1/finance/expenses${query({ from: input.from, to: input.to, category_major: input.category_major, category_minor: input.category_minor })}`, "finance_expenses_list")
    },
    finance_incomes_list: {
      schema: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), category_major: z.string().optional(), category_minor: z.string().optional() }),
      run: (input) => client.get(`/api/v1/finance/incomes${query({ from: input.from, to: input.to, category_major: input.category_major, category_minor: input.category_minor })}`, "finance_incomes_list")
    },
    finance_income_create: {
      schema: z.object({ amount_cents: z.number().int().positive(), category_major: z.string().optional(), category_minor: z.string().optional(), category: z.string().optional(), project_id: z.string().min(1).optional(), event: z.string().max(10000).optional(), note: z.string().max(10000).optional(), occurred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post("/api/v1/finance/incomes", input, "finance_income_create")
    },
    finance_summary: {
      schema: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      run: (input) => client.get(`/api/v1/finance/summary${query({ from: input.from, to: input.to })}`, "finance_summary")
    },
    finance_taxonomy: { schema: z.object({}), run: () => client.get("/api/v1/finance/taxonomy", "finance_taxonomy") },
    health_get: { schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), run: (input) => client.get(`/api/v1/health/${input.date}`, "health_get") },
    health_range: {
      schema: z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
      run: (input) => client.get(`/api/v1/health${query({ from: input.from, to: input.to })}`, "health_range")
    },
    health_put: {
      schema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), weight_kg: z.number().positive().optional(), bedtime_local: z.string().optional(), sleep_onset_local: z.string().optional(), wake_local: z.string().optional(), sleep_duration_minutes: z.number().int().nonnegative().optional(), exercise_note: z.string().optional(), exercise_minutes: z.number().int().nonnegative().optional(), disciplined: z.boolean().optional(), note: z.string().optional(), idempotency_key: idempotencyKeySchema
      }),
      run: ({ date, ...body }) => client.put(`/api/v1/health/${date}`, body, "health_put")
    },
    reviews_list: { schema: z.object({ type: z.enum(["daily", "period"]).optional() }), run: (input) => client.get(`/api/v1/reviews${input.type ? `?type=${input.type}` : ""}`, "reviews_list") },
    reviews_get: { schema: z.object({ review_id: z.string().min(1) }), run: (input) => client.get(`/api/v1/reviews/${encodeURIComponent(input.review_id)}`, "reviews_get") },
    reviews_update: {
      schema: z.object({ review_id: z.string().min(1), content: z.record(z.unknown()).optional(), answers: z.record(z.unknown()).optional(), idempotency_key: idempotencyKeySchema }),
      run: ({ review_id, ...body }) => client.patch(`/api/v1/reviews/${encodeURIComponent(review_id)}`, body, "reviews_update")
    },
    reviews_daily_generate: {
      schema: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post(`/api/v1/reviews/daily/${input.date}/generate`, { idempotency_key: input.idempotency_key }, "reviews_daily_generate")
    },
    reviews_period_generate: {
      schema: z.object({ period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), idempotency_key: idempotencyKeySchema }),
      run: (input) => client.post("/api/v1/reviews/period/generate", input, "reviews_period_generate")
    },
    confirmations_list: { schema: z.object({}), run: () => client.get("/api/v1/confirmations", "confirmations_list") }
  };

  server.resource("today", "paios://today", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await client.get("/api/v1/today", "resource:today")) }]
  }));

  server.resource("schema_overview", "paios://schema/overview", async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "application/json",
      text: JSON.stringify({
        schema_version: "2",
        generated_at: new Date().toISOString(),
        timezone: "Asia/Shanghai",
        entities: ["tasks", "task_recurrences", "projects", "ideas", "finance_accounts", "finance_account_entries", "finance_expenses", "finance_incomes", "health_logs", "reviews", "conversations"],
        batch_tools: Object.keys(batchOperations)
      })
    }]
  }));

  server.resource("project", new ResourceTemplate("paios://projects/{id}", { list: undefined }), async (uri, variables) => {
    const id = typeof variables.id === "string" ? variables.id : undefined;
    if (!id) return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ok: false, error: { code: "VALIDATION_FAILED", message: "project id is required" } }) }] };
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await client.get(`/api/v1/projects/${encodeURIComponent(id)}`, "resource:project")) }] };
  });

  server.resource("finance_summary", "paios://finance/summary", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await client.get("/api/v1/finance/summary", "resource:finance_summary")) }]
  }));

  server.resource("workflow_active", "paios://workflow/active", async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await client.get("/api/v1/workflows?status=active", "resource:workflow_active")) }]
  }));

  server.tool("system_status", "Read local Personal AI OS service status.", async () => result(await client.get("/api/v1/system/status", "system_status")));

  server.tool("capabilities_get", "Read the fixed description of what this Agent is allowed to do. Use this for questions such as '你能做什么'.", async () => result(await client.get("/api/v1/system/capabilities", "capabilities_get")));

  server.tool("today_get", "Read today's tasks by execution date (due_date), finance, health and confirmation summary.", async () => result(await client.get("/api/v1/today", "today_get")));

  server.tool("attention_get", "Read overdue tasks, undated tasks, recurrence issues, project posture, missing health data and pending confirmations for the current local time phase.", async () => result(await client.get("/api/v1/system/attention", "attention_get")));

  server.tool("planning_context_get", "Read the real data bundle needed to draft a daily or stage plan. due_date is the execution date.", {
    mode: z.enum(["daily", "stage"]).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }, async (input) => result(await client.get(`/api/v1/planning/context${query({ mode: input.mode, date: input.date, period_start: input.period_start, period_end: input.period_end })}`, "planning_context_get")));

  server.tool("tasks_list", "List active tasks. date filters by execution date (due_date). Use undated/overdue/from/to for planning. Use today_get for today.", {
    date: z.string().optional(),
    undated: z.boolean().optional(),
    overdue: z.boolean().optional(),
    from: z.string().optional(),
    to: z.string().optional()
  }, async (input) => result(await client.get(`/api/v1/tasks${query({ date: input.date, undated: input.undated, overdue: input.overdue, from: input.from, to: input.to })}`, "tasks_list")));

  server.tool("tasks_create", "Create one ordinary task. Linking it to a project requires a confirmed stage plan covering today.", {
    title: z.string().min(1),
    description: z.string().optional(),
    priority: z.enum(["P0", "P1", "P2", "P3"]).optional(),
    due_date: z.string().optional(),
    scheduled_date: z.string().optional(),
    project_id: z.string().min(1).optional(),
    milestone_id: z.string().min(1).optional(),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/tasks", input, "tasks_create")));

  server.tool("tasks_get", "Read one active task, including its正文 and备忘.", {
    task_id: z.string().min(1)
  }, async ({ task_id }) => result(await client.get(`/api/v1/tasks/${encodeURIComponent(task_id)}`, "tasks_get")));

  server.tool("tasks_update", "Update an ordinary task. Linking it to a project requires a confirmed stage plan covering today.", {
    task_id: z.string().min(1),
    title: z.string().max(200).optional(),
    description: z.string().max(10000).optional(),
    content: z.string().max(10000).optional(),
    status: z.enum(["todo", "done", "cancelled"]).optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    project_id: z.string().min(1).nullable().optional(),
    milestone_id: z.string().min(1).nullable().optional(),
    row_version: z.number().int().positive().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ task_id, ...body }) => result(await client.patch(`/api/v1/tasks/${encodeURIComponent(task_id)}`, body, "tasks_update")));

  server.tool("plans_get", "Read the draft or confirmed daily plan for a local date.", {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }, async ({ date }) => result(await client.get(`/api/v1/plans/${date}`, "plans_get")));

  server.tool("task_recurrences_list", "Inspect all recurring tasks, including missed occurrences and errors.", {}, async () => result(await client.get("/api/v1/task-recurrences", "task_recurrences_list")));

  server.tool("task_recurrence_check", "Check one recurring task; repair is an ordinary local consistency operation.", {
    recurrence_id: z.string().min(1),
    repair: z.boolean().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ recurrence_id, repair, idempotency_key }) => result(await client.post(`/api/v1/task-recurrences/${encodeURIComponent(recurrence_id)}/check`, { repair: repair === true, idempotency_key }, "task_recurrence_check")));

  server.tool("task_recurrence_create", "Create an independent recurring-task template. It is not an ordinary task; the system generates ordinary task instances from it.", {
    title_template: z.string().max(200).default(""),
    description_template: z.string().max(10000).default(""),
    content_template: z.string().max(10000).default(""),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    rule: recurrenceRuleSchema,
    enabled: z.boolean().optional(),
    idempotency_key: idempotencyKeySchema
  }, async (body) => result(await client.post("/api/v1/task-recurrences", body, "task_recurrence_create")));

  server.tool("task_recurrence_update", "Update a validated recurrence rule or pause it. Use the latest row_version; do not calculate occurrences in the Agent.", {
    recurrence_id: z.string().min(1),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    rule: recurrenceRuleSchema.optional(),
    enabled: z.boolean().optional(),
    title_template: z.string().max(200).optional(),
    description_template: z.string().max(10000).optional(),
    content_template: z.string().max(10000).optional(),
    row_version: z.number().int().positive().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ recurrence_id, ...body }) => result(await client.patch(`/api/v1/task-recurrences/${encodeURIComponent(recurrence_id)}`, body, "task_recurrence_update")));

  server.tool("task_recurrence_get", "Read one recurring-task template and its consistency status.", {
    recurrence_id: z.string().min(1)
  }, async ({ recurrence_id }) => result(await client.get(`/api/v1/task-recurrences/${encodeURIComponent(recurrence_id)}`, "task_recurrence_get")));

  server.tool("task_recurrence_occurrences_list", "Read generated task instances and skipped/deleted occurrence records; never changes data.", {
    recurrence_id: z.string().min(1),
    limit: z.number().int().min(1).max(500).optional()
  }, async ({ recurrence_id, limit }) => result(await client.get(`/api/v1/task-recurrences/${encodeURIComponent(recurrence_id)}/occurrences${limit ? `?limit=${limit}` : ""}`, "task_recurrence_occurrences_list")));

  server.tool("projects_list", "List projects for planning and progress review.", {}, async () => result(await client.get("/api/v1/projects", "projects_list")));

  server.tool("projects_get", "Read one project with its workspace, milestones and linked tasks.", {
    project_id: z.string().min(1)
  }, async ({ project_id }) => result(await client.get(`/api/v1/projects/${project_id}`, "projects_get")));

  server.tool("projects_create", "Create an ordinary project planning workspace.", {
    name: z.string().min(1),
    description: z.string().optional(),
    category: z.enum(["small", "mid", "long_term"]).optional(),
    template: z.enum(["small", "mid", "long_term"]).optional(),
    started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    target_result: z.string().optional(),
    benefit_enabled: z.boolean().optional(),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/projects", input, "projects_create")));

  server.tool("projects_update", "Update project planning fields after a confirmed stage plan covers today. Status cannot be paused or abandoned.", {
    project_id: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    category: z.enum(["small", "mid", "long_term"]).optional(),
    started_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    target_result: z.string().optional(),
    benefit_enabled: z.boolean().optional(),
    status: z.enum(["idea", "planned", "active", "done"]).optional(),
    progress_manual: z.number().int().min(0).max(100).nullable().optional(),
    row_version: z.number().int().positive().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ project_id, ...body }) => result(await client.patch(`/api/v1/projects/${project_id}`, body, "projects_update")));

  server.tool("project_workspace_update", "Write project notes and goals after a confirmed stage plan covers today.", {
    project_id: z.string().min(1),
    introduction: z.string().optional(),
    goals: z.string().optional(),
    current_situation: z.string().optional(),
    notes: z.string().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ project_id, ...body }) => result(await client.patch(`/api/v1/projects/${project_id}/workspace`, body, "project_workspace_update")));

  server.tool("ideas_list", "List ideas ordered by urgency.", {
    archived: z.boolean().optional()
  }, async ({ archived }) => result(await client.get(`/api/v1/ideas${archived === undefined ? "" : `?archived=${archived ? 1 : 0}`}`, "ideas_list")));

  server.tool("ideas_create", "Create an ordinary idea. High-risk promotion remains UI-confirmed.", {
    title: z.string().min(1),
    body: z.string().optional(),
    category: z.enum(["project", "long_term", "short_term"]).optional(),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/ideas", input, "ideas_create")));

  server.tool("ideas_update", "Update an active idea using its row_version when available.", {
    idea_id: z.string().min(1),
    title: z.string().max(200).optional(),
    body: z.string().max(10000).optional(),
    category: z.enum(["project", "long_term", "short_term"]).optional(),
    urgency: z.number().int().min(1).max(4).optional(),
    processed: z.boolean().optional(),
    row_version: z.number().int().positive().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ idea_id, ...body }) => result(await client.patch(`/api/v1/ideas/${encodeURIComponent(idea_id)}`, body, "ideas_update")));

  server.tool("plans_generate", "Generate a daily plan draft from tasks whose execution date is due_date. A confirmed plan cannot be overwritten.", {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    idempotency_key: idempotencyKeySchema
  }, async ({ date, idempotency_key }) => result(await client.post(`/api/v1/plans/${date}/generate`, { idempotency_key }, "plans_generate")));

  server.tool("plans_update", "Update a daily plan draft and optionally record why it changed. Confirmation remains UI-only.", {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    plan_text: z.string(),
    adjustment_reason: z.string().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ date, ...body }) => result(await client.patch(`/api/v1/plans/${date}`, body, "plans_update")));

  server.tool("period_plans_upsert", "Create or update a stage-plan draft from real data. The Agent cannot mark it confirmed.", {
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    plan_text: z.string().optional(),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/stage-plans/upsert", input, "period_plans_upsert")));

  server.tool("finance_quick_preview", "Preview a natural-language finance note without writing it.", {
    input: z.string().min(1)
  }, async ({ input }) => result(await client.post("/api/v1/finance/preview", { input }, "finance_quick_preview")));

  server.tool("finance_expense_create", "Create an independent daily expense in integer cents; never link it to an account or change account balances.", {
    amount_cents: z.number().int().positive(),
    category_major: z.string().optional(),
    category_minor: z.string().optional(),
    category: z.string().optional(),
    project_id: z.string().min(1).optional(),
    event: z.string().max(10000).optional(),
    note: z.string().max(10000).optional(),
    occurred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/finance/expenses", input, "finance_expense_create")));

  server.tool("finance_accounts_list", "List account balances. Account entries are separate from expenses and incomes.", {}, async () => result(await client.get("/api/v1/finance/accounts", "finance_accounts_list")));

  server.tool("finance_account_entries_list", "List account deposits and withdrawals.", {
    account_id: z.string().optional(),
    direction: z.enum(["deposit", "withdrawal"]).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }, async ({ account_id, direction, from, to }) => result(await client.get(`/api/v1/finance/account-entries${query({ account_id, direction, from, to })}`, "finance_account_entries_list")));

  server.tool("finance_account_entry_create", "Record an account deposit or withdrawal without creating a daily expense.", {
    account_id: z.string().min(1),
    direction: z.enum(["deposit", "withdrawal"]),
    amount_cents: z.number().int().positive(),
    event: z.string().max(10000).optional(),
    note: z.string().max(10000).optional(),
    occurred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/finance/account-entries", input, "finance_account_entry_create")));

  server.tool("finance_expenses_list", "List expense records with date and category filters.", {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    category_major: z.string().optional(),
    category_minor: z.string().optional()
  }, async ({ from, to, category_major, category_minor }) => result(await client.get(`/api/v1/finance/expenses${query({ from, to, category_major, category_minor })}`, "finance_expenses_list")));

  server.tool("finance_incomes_list", "List income records with date and category filters.", {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    category_major: z.string().optional(),
    category_minor: z.string().optional()
  }, async ({ from, to, category_major, category_minor }) => result(await client.get(`/api/v1/finance/incomes${query({ from, to, category_major, category_minor })}`, "finance_incomes_list")));

  server.tool("finance_income_create", "Create an independent income in integer cents; never link it to an account or change account balances.", {
    amount_cents: z.number().int().positive(),
    category_major: z.string().optional(),
    category_minor: z.string().optional(),
    category: z.string().optional(),
    project_id: z.string().min(1).optional(),
    event: z.string().max(10000).optional(),
    note: z.string().max(10000).optional(),
    occurred_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/finance/incomes", input, "finance_income_create")));

  server.tool("finance_summary", "Read a finance summary for a local date range.", {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }, async ({ from, to }) => result(await client.get(`/api/v1/finance/summary${query({ from, to })}`, "finance_summary")));

  server.tool("finance_taxonomy", "Read the current finance major/minor category labels and quick buttons.", {}, async () => result(await client.get("/api/v1/finance/taxonomy", "finance_taxonomy")));

  server.tool("health_get", "Read one health log by local calendar date.", {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }, async ({ date }) => result(await client.get(`/api/v1/health/${date}`, "health_get")));

  server.tool("health_range", "Read health logs for a local date range.", {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }, async ({ from, to }) => result(await client.get(`/api/v1/health${query({ from, to })}`, "health_range")));

  server.tool("health_put", "Write an ordinary health log for one local calendar date.", {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    weight_kg: z.number().positive().optional(),
    bedtime_local: z.string().optional(),
    sleep_onset_local: z.string().optional(),
    wake_local: z.string().optional(),
    sleep_duration_minutes: z.number().int().nonnegative().optional(),
    exercise_note: z.string().optional(),
    exercise_minutes: z.number().int().nonnegative().optional(),
    disciplined: z.boolean().optional(),
    note: z.string().optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ date, ...body }) => result(await client.put(`/api/v1/health/${date}`, body, "health_put")));

  server.tool("reviews_list", "List daily or period reviews.", {
    type: z.enum(["daily", "period"]).optional()
  }, async ({ type }) => result(await client.get(`/api/v1/reviews${type ? `?type=${type}` : ""}`, "reviews_list")));

  server.tool("reviews_get", "Read one review in full.", {
    review_id: z.string().min(1)
  }, async ({ review_id }) => result(await client.get(`/api/v1/reviews/${encodeURIComponent(review_id)}`, "reviews_get")));

  server.tool("reviews_update", "Update an editable review draft; finalized reviews remain immutable.", {
    review_id: z.string().min(1),
    content: z.record(z.unknown()).optional(),
    answers: z.record(z.unknown()).optional(),
    idempotency_key: idempotencyKeySchema
  }, async ({ review_id, ...body }) => result(await client.patch(`/api/v1/reviews/${encodeURIComponent(review_id)}`, body, "reviews_update")));

  server.tool("reviews_daily_generate", "Generate a data-first daily review draft with objective facts. It is not finalized automatically.", {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    idempotency_key: idempotencyKeySchema
  }, async ({ date, idempotency_key }) => result(await client.post(`/api/v1/reviews/daily/${date}/generate`, { idempotency_key }, "reviews_daily_generate")));

  server.tool("reviews_period_generate", "Generate a period review draft with objective facts. Finalization remains UI-only.", {
    period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    idempotency_key: idempotencyKeySchema
  }, async (input) => result(await client.post("/api/v1/reviews/period/generate", input, "reviews_period_generate")));

  server.tool("ideas_promote_to_task", "Request promotion of an idea. This always returns a human confirmation ticket; the Agent cannot approve it.", {
    idea_id: z.string().min(1)
  }, async ({ idea_id }) => result(await client.post(`/api/v1/ideas/${idea_id}/promote`, undefined, "ideas_promote_to_task")));

  server.tool("confirmations_list", "List pending human confirmation tickets. Approval is only available in the Web UI.", async () => result(await client.get("/api/v1/confirmations", "confirmations_list")));

  server.tool("batch_run", "Run up to 20 registered ordinary tools. Each item names a tool and provides that tool's arguments; arbitrary REST paths and confirmation approval are forbidden.", {
    operations: z.array(z.object({
      tool: z.string().min(1),
      arguments: z.record(z.unknown()).optional()
    })).min(1).max(20)
  }, async ({ operations }) => {
    const results: unknown[] = [];
    for (const operation of operations) {
      const registered = batchOperations[operation.tool];
      const catalogEntry = getToolCatalogEntry(operation.tool);
      if (!registered || !catalogEntry?.batchable || catalogEntry.access === "confirmation") {
        results.push({ ok: false, error: { code: "FORBIDDEN", message: `Tool is not registered for batch execution: ${operation.tool}` } });
        continue;
      }
      const parsed = registered.schema.safeParse(operation.arguments ?? {});
      if (!parsed.success) {
        results.push({ ok: false, error: { code: "VALIDATION_FAILED", message: "Batch arguments do not match the registered tool schema", issues: parsed.error.issues.map((issue) => issue.path.join(".") || "input") } });
        continue;
      }
      try {
        results.push(await registered.run(parsed.data));
      } catch (error) {
        results.push({ ok: false, error: { code: "BATCH_ITEM_FAILED", tool: operation.tool, message: error instanceof Error ? error.message : "Batch item failed" } });
      }
    }
    return result({ ok: true, operations: results });
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
