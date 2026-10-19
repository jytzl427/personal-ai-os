import { createIdeaSchema, createProjectSchema, createTaskSchema, financeEntrySchema, healthLogSchema, patchFinanceEntrySchema, patchIdeaSchema, patchProjectSchema, patchTaskSchema } from "@paios/api-types";
import { getSetting, type PaiosDatabase } from "@paios/db";
import { assertFinanceCategory, financeQuickParse, shouldArchiveIdea, shouldArchiveTask, sleepMinutes } from "@paios/core";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import { readAuditTarget, recordAudit, targetFromButlerTool } from "./audit.js";
import { generateDailyPlanForDate } from "./planner.js";
import { generateDailyReviewDraft } from "./review-drafts.js";
import { agentCannotWriteProject, agentProjectAdvancementBlocked, generatePeriodReviewDraft, PAUSED_PROJECT_ADVANCEMENT_ERROR, projectIdForMilestone, updateDailyPlanText, upsertPeriodPlan } from "./planning.js";
import { createRecurrenceTemplate, syncTemplateAfterWriteWithRetry, updateRecurrenceTemplate } from "./recurrence-service.js";
import { runRecurrenceSync, type RecurrenceSyncResult } from "./recurrence.js";

export type ButlerWriteOutcome = {
  data?: unknown;
  source: string;
  error?: string;
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateFields = { occurred_date: dateSchema.optional() };

function now(): string {
  return new Date().toISOString();
}

function taskStatus(value: unknown): "todo" | "done" | "cancelled" {
  return value === "done" ? "done" : value === "cancelled" ? "cancelled" : "todo";
}

function flag(value: unknown, fallback: number): number {
  return value === undefined ? fallback : value === true || value === 1 ? 1 : 0;
}

function syncButlerRecurrence(database: PaiosDatabase, recurrenceId: string, trigger: string): RecurrenceSyncResult {
  const databaseName = typeof database.name === "string" ? database.name : "";
  const dataDir = databaseName && databaseName !== ":memory:" ? dirname(databaseName) : process.cwd();
  const timezone = getSetting(database, "timezone", "Asia/Shanghai");
  return runRecurrenceSync(database, dataDir, timezone, getSetting(database, "backup.retain", 3), recurrenceId, trigger);
}

function syncButlerRecurrenceWithRetry(database: PaiosDatabase, recurrenceId: string, trigger: string): RecurrenceSyncResult {
  const databaseName = typeof database.name === "string" ? database.name : "";
  const dataDir = databaseName && databaseName !== ":memory:" ? dirname(databaseName) : process.cwd();
  return syncTemplateAfterWriteWithRetry(database, dataDir, recurrenceId, trigger);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function financeFields(database: PaiosDatabase, raw: Record<string, unknown>) {
  // Ordinary expenses and incomes are deliberately independent from the
  // account-ledger database. Only finance_account_entry_create may touch an
  // account balance.
  const accountId = null;
  const occurredDate = typeof raw.occurred_date === "string" ? raw.occurred_date : new Intl.DateTimeFormat("en-CA", { timeZone: getSetting(database, "timezone", "Asia/Shanghai"), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const major = typeof raw.category_major === "string" ? raw.category_major.trim() : "";
  const minor = typeof raw.category_minor === "string" ? raw.category_minor.trim() : "";
  const category = typeof raw.category === "string" && raw.category.trim() ? raw.category.trim() : [major, minor].filter(Boolean).join(" / ") || "未分类";
  const event = typeof raw.event === "string" ? raw.event : typeof raw.note === "string" ? raw.note : "";
  const note = typeof raw.note === "string" ? raw.note : event;
  return { accountId, occurredDate, major, minor, category, event, note, currency: typeof raw.currency === "string" ? raw.currency : "CNY" };
}

function isDynamicProjectFinanceCategory(database: PaiosDatabase, kind: "expense" | "income", major: string, minor: string): boolean {
  const expectedMajor = kind === "expense" ? "项目支出" : "项目收入";
  if (major !== expectedMajor || !minor) return false;
  return Boolean(database.prepare("SELECT 1 FROM projects WHERE name = ? AND archived_at IS NULL AND benefit_enabled = 1 LIMIT 1").get(minor));
}

function normalizeButlerFinanceInput(database: PaiosDatabase, input: Record<string, unknown>, kind: "expense" | "income"): Record<string, unknown> {
  if (kind !== "expense" || typeof input.amount_cents !== "number" || !Number.isInteger(input.amount_cents) || input.amount_cents <= 0) return input;
  const major = typeof input.category_major === "string" ? input.category_major.trim() : "";
  const minor = typeof input.category_minor === "string" ? input.category_minor.trim() : "";
  let categoryIsValid = isDynamicProjectFinanceCategory(database, kind, major, minor);
  if (!categoryIsValid && major && minor) {
    try {
      assertFinanceCategory("expense", major, minor);
      categoryIsValid = true;
    } catch {
      categoryIsValid = false;
    }
  }
  if (categoryIsValid) return input;
  const text = [input.event, input.category, input.note].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ");
  const preview = financeQuickParse(String(input.amount_cents / 100) + "元 " + text);
  if (!preview?.categoryMajor || !preview.categoryMinor) return input;
  return {
    ...input,
    category_major: preview.categoryMajor,
    category_minor: preview.categoryMinor,
    category: preview.category,
    event: preview.event || input.event
  };
}

function writeTask(database: PaiosDatabase, raw: unknown, today: string): ButlerWriteOutcome {
  const parsed = createTaskSchema.safeParse(raw);
  if (!parsed.success) return { source: "任务写入", error: "任务参数无效" };
  const data = parsed.data;
  if (data.project_id && !database.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(data.project_id)) return { source: "任务写入", error: "关联项目不存在" };
  if (data.milestone_id && !database.prepare("SELECT 1 FROM milestones WHERE id = ? AND archived_at IS NULL").get(data.milestone_id)) return { source: "任务写入", error: "关联阶段不存在" };
  const linkedProjectId = data.project_id ?? (data.milestone_id ? projectIdForMilestone(database, data.milestone_id) : null);
  if (linkedProjectId) {
    const blocked = agentCannotWriteProject(database, today, linkedProjectId);
    if (blocked) return { source: "任务写入", error: blocked };
  }
  const id = randomUUID();
  const timestamp = now();
  const status = taskStatus(data.status ?? "todo");
  // Archive state is human-controlled; the Agent cannot create an already-archived task.
  const archiveRequested = 0;
  database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, estimate_minutes, archive_requested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, data.title, data.description ?? "", data.content ?? "", status, data.priority ?? "P2", data.due_date ?? null, data.scheduled_date ?? null, data.estimate_minutes ?? null, archiveRequested, timestamp, timestamp);
  if (data.project_id) database.prepare("INSERT INTO task_project_links (task_id, project_id) VALUES (?, ?)").run(id, data.project_id);
  if (data.milestone_id) database.prepare("INSERT INTO task_milestone_links (task_id, milestone_id) VALUES (?, ?)").run(id, data.milestone_id);
  if (shouldArchiveTask({ archive_requested: archiveRequested, status, archived_at: null })) database.prepare("UPDATE tasks SET archived_at = ?, archive_reason = 'auto', archived_by = 'agent' WHERE id = ?").run(timestamp, id);
  return { data: database.prepare("SELECT * FROM tasks WHERE id = ?").get(id), source: `任务已写入（${id}）` };
}

function updateTask(database: PaiosDatabase, raw: unknown, today: string): ButlerWriteOutcome {
  const parsed = patchTaskSchema.safeParse(raw);
  if (!parsed.success || typeof raw !== "object" || raw === null || typeof (raw as Record<string, unknown>).task_id !== "string") return { source: "任务更新", error: "task_id 或任务参数无效" };
  const input = raw as Record<string, unknown>;
  const id = input.task_id as string;
  const current = database.prepare("SELECT * FROM tasks WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
  if (!current) return { source: `任务更新（${id}）`, error: "本地当前没有查到这个任务" };
  const data = parsed.data;
  if (data.row_version !== undefined && data.row_version !== Number(current.row_version)) return { source: `任务更新（${id}）`, error: "任务版本已变化，请先重新读取" };
  if (data.project_id && !database.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(data.project_id)) return { source: `任务更新（${id}）`, error: "关联项目不存在" };
  if (data.milestone_id && !database.prepare("SELECT 1 FROM milestones WHERE id = ? AND archived_at IS NULL").get(data.milestone_id)) return { source: `任务更新（${id}）`, error: "关联阶段不存在" };
  if (data.project_id) {
    const blocked = agentCannotWriteProject(database, today, data.project_id);
    if (blocked) return { source: `任务更新（${id}）`, error: blocked };
  }
  if (data.milestone_id) {
    const blocked = agentCannotWriteProject(database, today, projectIdForMilestone(database, data.milestone_id));
    if (blocked) return { source: `任务更新（${id}）`, error: blocked };
  }
  const status = taskStatus(data.status ?? current.status);
  // Archive state is human-controlled. The Butler may update idea content and
  // processing state, but can never hide the record by setting this flag.
  const archiveRequested = Number(current.archive_requested ?? 0);
  if (shouldArchiveTask({ archive_requested: archiveRequested, status, archived_at: current.archived_at as string | null })) return { source: `任务更新（${id}）`, error: "该任务已勾选归档，管家不能通过完成或取消触发归档，请在人工界面操作" };
  const timestamp = now();
  database.prepare("UPDATE tasks SET title = ?, description = ?, content = ?, status = ?, priority = ?, due_date = ?, scheduled_date = ?, estimate_minutes = ?, archive_requested = ?, updated_at = ?, completed_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND archived_at IS NULL").run(data.title ?? current.title, data.description ?? current.description, data.content ?? current.content, status, data.priority ?? current.priority, data.due_date === undefined ? current.due_date : data.due_date, data.scheduled_date === undefined ? current.scheduled_date : data.scheduled_date, data.estimate_minutes === undefined ? current.estimate_minutes : data.estimate_minutes, archiveRequested, timestamp, status === "done" ? current.completed_at ?? timestamp : null, id, current.row_version);
  if (Object.prototype.hasOwnProperty.call(data, "project_id")) {
    database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(id);
    if (data.project_id) database.prepare("INSERT INTO task_project_links (task_id, project_id) VALUES (?, ?)").run(id, data.project_id);
  }
  if (Object.prototype.hasOwnProperty.call(data, "milestone_id")) {
    database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(id);
    if (data.milestone_id) database.prepare("INSERT INTO task_milestone_links (task_id, milestone_id) VALUES (?, ?)").run(id, data.milestone_id);
  }
  if (shouldArchiveTask({ archive_requested: archiveRequested, status, archived_at: null })) database.prepare("UPDATE tasks SET archived_at = ?, archive_reason = 'auto', archived_by = 'agent' WHERE id = ? AND archived_at IS NULL").run(timestamp, id);
  return { data: database.prepare("SELECT * FROM tasks WHERE id = ?").get(id), source: `任务已更新（${id}）` };
}

function writeTaskRecurrence(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  const created = createRecurrenceTemplate(database, raw);
  if ("error" in created) return { source: "周期模板创建", error: String(created.error) };
  syncButlerRecurrenceWithRetry(database, String(created.id), "butler_template_create");
  return { data: created, source: `周期模板已创建（${String(created.id)}）` };
}

function updateTaskRecurrence(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "周期模板更新", error: "周期模板参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.recurrence_id !== "string" || !input.recurrence_id) return { source: "周期模板更新", error: "recurrence_id 缺失" };
  const recurrenceId = input.recurrence_id;
  const { recurrence_id: _recurrenceId, ...body } = input;
  const updated = updateRecurrenceTemplate(database, recurrenceId, body, () => syncButlerRecurrence(database, recurrenceId, "butler_template_update_before"));
  if ("error" in updated) return { source: `周期模板更新（${recurrenceId}）`, error: String(updated.error) };
  if (Number(updated.enabled) === 1) syncButlerRecurrenceWithRetry(database, recurrenceId, "butler_template_update");
  return { data: updated, source: `周期模板已更新（${recurrenceId}）` };
}

function writeProjectWorkspace(database: PaiosDatabase, raw: unknown, today: string): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "项目资料写入", error: "项目参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.project_id !== "string" || !input.project_id) return { source: "项目资料写入", error: "project_id 缺失" };
  const project = database.prepare("SELECT status FROM projects WHERE id = ? AND archived_at IS NULL").get(input.project_id) as { status?: string } | undefined;
  if (!project) return { source: "项目资料写入", error: "本地当前没有查到这个项目" };
  if (project.status === "paused" || project.status === "abandoned") return { source: "项目资料写入", error: PAUSED_PROJECT_ADVANCEMENT_ERROR };
  const blocked = agentProjectAdvancementBlocked(database, today);
  if (blocked) return { source: "项目资料写入", error: blocked };
  const current = database.prepare("SELECT * FROM project_workspaces WHERE project_id = ?").get(input.project_id) as Record<string, unknown> | undefined;
  const value = (key: string) => typeof input[key] === "string" ? input[key] : String(current?.[key] ?? "");
  const timestamp = now();
  database.prepare("INSERT INTO project_workspaces (project_id, introduction, goals, current_situation, notes, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET introduction = excluded.introduction, goals = excluded.goals, current_situation = excluded.current_situation, notes = excluded.notes, updated_at = excluded.updated_at").run(input.project_id, value("introduction"), value("goals"), value("current_situation"), value("notes"), timestamp);
  return { data: database.prepare("SELECT * FROM project_workspaces WHERE project_id = ?").get(input.project_id), source: `项目资料已更新（${input.project_id}）` };
}

function writeProject(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  const parsed = createProjectSchema.safeParse(raw);
  if (!parsed.success) return { source: "项目创建", error: "项目参数无效" };
  const data = parsed.data;
  if (data.parent_id && !database.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(data.parent_id)) return { source: "项目创建", error: "上级项目不存在" };
  const id = randomUUID();
  const timestamp = now();
  const initialStatus = data.status ?? (data.category === "maintenance" || data.category === "long_term" ? "active" : "idea");
  database.transaction(() => {
    database.prepare("INSERT INTO projects (id, parent_id, name, category, started_at, end_date, target_result, description, status, priority, benefit_enabled, benefit_cents, benefit_kind, archive_requested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)").run(id, data.parent_id ?? null, data.name, data.category ?? "mid", data.started_at ?? null, data.end_date ?? null, data.target_result ?? "", data.description ?? "", initialStatus, data.priority ?? "P2", data.benefit_enabled ? 1 : 0, data.benefit_cents ?? null, data.benefit_kind ?? "none", timestamp, timestamp);
    const templateText = data.template ?? data.category ?? "mid";
    const template = templateText === "small" ? "小型项目：适合几天到几周完成的具体制作或实验。" : templateText === "long_term" ? "长期/大型项目：适合长期建设、持续维护和逐步产生回报。" : "中型/阶段性项目：适合学习、阶段建设和数周到数月完成。";
    const goal = templateText === "small" ? "明确交付物、完成条件和最小步骤。" : templateText === "long_term" ? "明确长期方向、阶段目标和维护节奏。" : "明确本阶段交付结果，并拆成可执行任务。";
    database.prepare("INSERT INTO project_workspaces (project_id, introduction, goals, updated_at) VALUES (?, ?, ?, ?)").run(id, template, goal, timestamp);
  })();
  return { data: database.prepare("SELECT * FROM projects WHERE id = ?").get(id), source: `项目已创建（${id}）` };
}

function updateProject(database: PaiosDatabase, raw: unknown, today: string): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object" || typeof (raw as Record<string, unknown>).project_id !== "string") return { source: "项目更新", error: "project_id 缺失" };
  const input = raw as Record<string, unknown>;
  const id = input.project_id as string;
  const current = database.prepare("SELECT * FROM projects WHERE id = ? AND archived_at IS NULL").get(id) as Record<string, unknown> | undefined;
  if (!current) return { source: `项目更新（${id}）`, error: "本地当前没有查到这个项目" };
  const { project_id: _projectId, ...body } = input;
  const parsed = patchProjectSchema.safeParse(body);
  if (!parsed.success) return { source: `项目更新（${id}）`, error: "项目参数无效" };
  const data = parsed.data;
  if (data.status === "paused" || data.status === "abandoned") return { source: `项目更新（${id}）`, error: "暂停或放弃项目必须由用户在图形界面确认，管家不能直接修改" };
  if (data.archive_requested) return { source: `项目更新（${id}）`, error: "项目归档必须由用户在图形界面确认，管家不能直接修改" };
  if (current.status === "paused" || current.status === "abandoned") return { source: `项目更新（${id}）`, error: PAUSED_PROJECT_ADVANCEMENT_ERROR };
  const blocked = agentProjectAdvancementBlocked(database, today);
  if (blocked) return { source: `项目更新（${id}）`, error: blocked };
  if (data.row_version !== undefined && data.row_version !== Number(current.row_version)) return { source: `项目更新（${id}）`, error: "项目已被其他操作修改，请先重新读取" };
  if (data.parent_id && !database.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(data.parent_id)) return { source: `项目更新（${id}）`, error: "上级项目不存在" };
  const result = database.prepare(`UPDATE projects SET parent_id = ?, name = ?, category = ?, started_at = ?, end_date = ?, target_result = ?, description = ?, status = ?, priority = ?, benefit_enabled = ?, benefit_cents = ?, benefit_kind = ?, progress_manual = ?, archive_requested = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND archived_at IS NULL`).run(data.parent_id === undefined ? current.parent_id : data.parent_id, data.name ?? current.name, data.category ?? current.category, data.started_at === undefined ? current.started_at : data.started_at, data.end_date === undefined ? current.end_date : data.end_date, data.target_result ?? current.target_result, data.description ?? current.description, data.status ?? current.status, data.priority ?? current.priority, data.benefit_enabled === undefined ? current.benefit_enabled : data.benefit_enabled ? 1 : 0, data.benefit_cents === undefined ? current.benefit_cents : data.benefit_cents, data.benefit_kind ?? current.benefit_kind, data.progress_manual === undefined ? current.progress_manual : data.progress_manual, Number(current.archive_requested ?? 0), now(), id, current.row_version);
  if (result.changes !== 1) return { source: `项目更新（${id}）`, error: "项目已被其他操作修改，请先重新读取" };
  return { data: database.prepare("SELECT * FROM projects WHERE id = ?").get(id), source: `项目已更新（${id}）` };
}

function updateIdea(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "想法更新", error: "想法参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.idea_id !== "string" || !input.idea_id) return { source: "想法更新", error: "idea_id 缺失" };
  const current = database.prepare("SELECT * FROM ideas WHERE id = ? AND archived_at IS NULL").get(input.idea_id) as Record<string, unknown> | undefined;
  if (!current) return { source: `想法更新（${input.idea_id}）`, error: "本地当前没有查到这个想法" };
  const { idea_id: _ideaId, ...body } = input;
  const parsed = patchIdeaSchema.safeParse(body);
  if (!parsed.success) return { source: `想法更新（${input.idea_id}）`, error: "想法参数无效" };
  const data = parsed.data;
  if (data.row_version !== undefined && data.row_version !== Number(current.row_version)) return { source: `想法更新（${input.idea_id}）`, error: "想法版本已变化，请先重新读取" };
  const category = data.category === "project" || data.category === "long_term" || data.category === "short_term" ? data.category : String(current.category ?? "short_term");
  const processed = flag(data.processed, Number(current.processed ?? 0));
  const archiveRequested = flag(data.archive_requested, Number(current.archive_requested ?? 0));
  if (shouldArchiveIdea({ archive_requested: archiveRequested, processed, archived_at: current.archived_at as string | null })) return { source: `想法更新（${input.idea_id}）`, error: "该想法已勾选归档，管家不能通过已处理触发归档，请在人工界面操作" };
  const timestamp = now();
  database.prepare("UPDATE ideas SET title = ?, body = ?, category = ?, urgency = ?, processed = ?, archive_requested = ?, status = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND archived_at IS NULL").run(data.title ?? current.title, data.body ?? current.body, category, data.urgency ?? Number(current.urgency ?? 4), processed, archiveRequested, data.status ?? current.status, timestamp, input.idea_id, current.row_version);
  if (shouldArchiveIdea({ archive_requested: archiveRequested, processed, archived_at: null })) database.prepare("UPDATE ideas SET archived_at = ?, archive_reason = 'auto', archived_by = 'agent' WHERE id = ? AND archived_at IS NULL").run(timestamp, input.idea_id);
  return { data: database.prepare("SELECT * FROM ideas WHERE id = ?").get(input.idea_id), source: `想法已更新（${input.idea_id}）` };
}

function writeIdea(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  const parsed = createIdeaSchema.safeParse(raw);
  if (!parsed.success) return { source: "想法创建", error: "想法参数无效" };
  const data = parsed.data;
  const id = randomUUID();
  const timestamp = now();
  const category = data.category === "project" || data.category === "long_term" || data.category === "short_term" ? data.category : "short_term";
  const urgency = data.urgency ?? 4;
  database.prepare("INSERT INTO ideas (id, title, body, category, urgency, processed, archive_requested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)").run(id, data.title, data.body ?? "", category, urgency, timestamp, timestamp);
  return { data: database.prepare("SELECT * FROM ideas WHERE id = ?").get(id), source: `想法已创建（${id}）` };
}

function writeFinance(database: PaiosDatabase, raw: unknown, kind: "expense" | "income"): ButlerWriteOutcome {
  const parsed = financeEntrySchema.safeParse(raw);
  if (!parsed.success) return { source: kind === "expense" ? "支出写入" : "收入写入", error: "金额或财务参数无效" };
  const input = normalizeButlerFinanceInput(database, raw as Record<string, unknown>, kind);
  const fields = financeFields(database, input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.occurredDate)) return { source: "财务写入", error: "日期必须使用 YYYY-MM-DD" };
  if (fields.accountId && !database.prepare("SELECT 1 FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(fields.accountId)) return { source: "财务写入", error: "账户不存在" };
  const projectId = typeof input.project_id === "string" ? input.project_id : null;
  if (projectId && !database.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) return { source: "财务写入", error: "项目不存在" };
  const id = randomUUID();
  const transactionId = randomUUID();
  const timestamp = now();
  const writesTransaction = getSetting(database, kind === "expense" ? "finance.expense_writes_tx" : "finance.income_writes_tx", true);
  if (writesTransaction && fields.accountId) {
    database.prepare("INSERT INTO finance_transactions (id, kind, note, occurred_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(transactionId, kind === "expense" ? "expense_link" : "income_link", fields.note, fields.occurredDate, timestamp, timestamp);
    database.prepare("INSERT INTO finance_transaction_legs (id, transaction_id, account_id, amount_cents, direction) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), transactionId, fields.accountId, parsed.data.amount_cents, kind === "expense" ? "debit" : "credit");
  }
  const table = kind === "expense" ? "finance_expenses" : "finance_incomes";
  database.prepare(`INSERT INTO ${table} (id, account_id, amount_cents, currency, category, category_major, category_minor, project_id, event, note, occurred_date, linked_transaction_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, fields.accountId, parsed.data.amount_cents, fields.currency, fields.category, fields.major, fields.minor, projectId, fields.event, fields.note, fields.occurredDate, writesTransaction && fields.accountId ? transactionId : null, timestamp, timestamp);
  if (writesTransaction && fields.accountId) database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(kind === "expense" ? -parsed.data.amount_cents : parsed.data.amount_cents, timestamp, fields.accountId);
  return { data: database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id), source: `${kind === "expense" ? "支出" : "收入"}已写入（${id}）` };
}

function writeAccountEntry(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  const schema = z.object({ account_id: z.string().min(1), direction: z.enum(["deposit", "withdrawal"]).default("deposit"), amount_cents: z.number().int().positive(), event: z.string().max(10000).optional(), note: z.string().max(10000).optional(), ...dateFields });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { source: "账户流水写入", error: "账户、方向或金额参数无效" };
  const data = parsed.data;
  if (!database.prepare("SELECT id FROM finance_accounts WHERE id = ? AND archived_at IS NULL").get(data.account_id)) return { source: "账户流水写入", error: "账户不存在" };
  const occurredDate = data.occurred_date ?? new Intl.DateTimeFormat("en-CA", { timeZone: getSetting(database, "timezone", "Asia/Shanghai"), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const id = randomUUID();
  const timestamp = now();
  database.prepare("INSERT INTO finance_account_entries (id, account_id, direction, amount_cents, currency, event, note, occurred_date, created_at, updated_at) VALUES (?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?)").run(id, data.account_id, data.direction, data.amount_cents, data.event ?? "", data.note ?? data.event ?? "", occurredDate, timestamp, timestamp);
  database.prepare("UPDATE finance_accounts SET current_balance_cents = current_balance_cents + ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(data.direction === "withdrawal" ? -data.amount_cents : data.amount_cents, timestamp, data.account_id);
  return { data: database.prepare("SELECT * FROM finance_account_entries WHERE id = ?").get(id), source: `账户流水已写入（${id}）` };
}

function writeHealth(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "健康写入", error: "健康参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.date !== "string" || !dateSchema.safeParse(input.date).success) return { source: "健康写入", error: "日期必须使用 YYYY-MM-DD" };
  const { date: _date, ...body } = input;
  const parsed = healthLogSchema.safeParse(body);
  if (!parsed.success) return { source: "健康写入", error: "健康参数无效" };
  const data = parsed.data;
  const current = database.prepare("SELECT * FROM health_logs WHERE log_date = ?").get(input.date) as Record<string, unknown> | undefined;
  const value = (key: keyof typeof data) => data[key] === undefined ? current?.[key] ?? null : data[key];
  const bedtime = value("bedtime_local") as string | null;
  const wake = value("wake_local") as string | null;
  const computedSleep = bedtime && wake ? sleepMinutes(bedtime, wake) : null;
  const disciplined = data.disciplined === undefined ? current?.disciplined ?? null : data.disciplined === null ? null : data.disciplined === true || data.disciplined === 1 ? 1 : 0;
  const timestamp = now();
  database.prepare("INSERT INTO health_logs (id, log_date, weight_kg, bedtime_local, sleep_onset_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined, cloud_content, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?) ON CONFLICT(log_date) DO UPDATE SET weight_kg = excluded.weight_kg, bedtime_local = excluded.bedtime_local, sleep_onset_local = excluded.sleep_onset_local, wake_local = excluded.wake_local, sleep_duration_minutes = excluded.sleep_duration_minutes, exercise_note = excluded.exercise_note, exercise_minutes = excluded.exercise_minutes, disciplined = excluded.disciplined, note = excluded.note, updated_at = excluded.updated_at").run(randomUUID(), input.date, value("weight_kg"), bedtime, value("sleep_onset_local"), wake, computedSleep, value("exercise_note"), value("exercise_minutes"), disciplined, value("note"), current?.created_at ?? timestamp, timestamp);
  return { data: database.prepare("SELECT log_date, weight_kg, bedtime_local, sleep_onset_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined, note, created_at, updated_at FROM health_logs WHERE log_date = ?").get(input.date), source: `健康记录已写入（${input.date}）` };
}

function updateReview(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "复盘更新", error: "复盘参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.review_id !== "string" || !input.review_id) return { source: "复盘更新", error: "review_id 缺失" };
  const current = database.prepare("SELECT * FROM reviews WHERE id = ?").get(input.review_id) as Record<string, unknown> | undefined;
  if (!current) return { source: `复盘更新（${input.review_id}）`, error: "本地当前没有查到这条复盘" };
  if (current.status === "finalized") return { source: `复盘更新（${input.review_id}）`, error: "已完成复盘不可由管家修改" };
  if (input.status !== undefined && input.status !== "draft") return { source: `复盘更新（${input.review_id}）`, error: "复盘最终确认必须在人工界面完成" };
  const currentContent = parseJsonObject(current.content_json);
  const nextContent = { ...currentContent, ...(input.content && typeof input.content === "object" && !Array.isArray(input.content) ? input.content as Record<string, unknown> : {}) };
  if (input.answers && typeof input.answers === "object" && !Array.isArray(input.answers)) nextContent.answers = { ...(currentContent.answers as Record<string, unknown> | undefined), ...(input.answers as Record<string, unknown>) };
  const timestamp = now();
  database.prepare("UPDATE reviews SET content_json = ?, status = 'draft', updated_at = ? WHERE id = ?").run(JSON.stringify(nextContent), timestamp, input.review_id);
  return { data: database.prepare("SELECT id, review_type, period_start, period_end, status, content_json, updated_at FROM reviews WHERE id = ?").get(input.review_id), source: `复盘草稿已更新（${input.review_id}）` };
}

function generatePlan(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object" || typeof (raw as Record<string, unknown>).date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test((raw as Record<string, unknown>).date as string)) return { source: "计划生成", error: "date 必须使用 YYYY-MM-DD" };
  const date = (raw as Record<string, unknown>).date as string;
  const result = generateDailyPlanForDate(database, date);
  if ("error" in result) return { source: "计划生成", error: result.error };
  return { data: result, source: `计划草稿已生成（${date}）` };
}

function generateReview(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object" || typeof (raw as Record<string, unknown>).date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test((raw as Record<string, unknown>).date as string)) return { source: "复盘生成", error: "date 必须使用 YYYY-MM-DD" };
  const date = (raw as Record<string, unknown>).date as string;
  const review = generateDailyReviewDraft(database, date);
  return review ? { data: review, source: `每日复盘草稿已生成（${date}）` } : { source: "复盘生成", error: "复盘草稿生成失败" };
}

function updatePlan(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "每日计划更新", error: "计划参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.date !== "string" || !dateSchema.safeParse(input.date).success) return { source: "每日计划更新", error: "date 必须使用 YYYY-MM-DD" };
  if (typeof input.plan_text !== "string") return { source: "每日计划更新", error: "plan_text 必须是文本" };
  if (input.status === "confirmed" || input.status === "executed") return { source: "每日计划更新", error: "确认每日计划必须在图形界面完成" };
  const result = updateDailyPlanText(database, input.date, input.plan_text, typeof input.adjustment_reason === "string" ? input.adjustment_reason : undefined);
  return { data: result, source: `每日计划已更新（${input.date}）` };
}

function upsertStagePlan(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "阶段计划写入", error: "阶段计划参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.period_start !== "string" || typeof input.period_end !== "string" || !dateSchema.safeParse(input.period_start).success || !dateSchema.safeParse(input.period_end).success) {
    return { source: "阶段计划写入", error: "period_start 和 period_end 必须使用 YYYY-MM-DD" };
  }
  if (input.period_start > input.period_end) return { source: "阶段计划写入", error: "开始日期不能晚于结束日期" };
  if (input.status === "confirmed" || input.status === "executed") return { source: "阶段计划写入", error: "确认阶段计划必须在图形界面完成" };
  const plan = upsertPeriodPlan(database, input.period_start, input.period_end, typeof input.plan_text === "string" ? input.plan_text : undefined);
  if (plan && "error" in plan) return { source: "阶段计划写入", error: String(plan.error) };
  return { data: plan, source: `阶段计划草稿已写入（${input.period_start} 至 ${input.period_end}）` };
}

function generatePeriodReview(database: PaiosDatabase, raw: unknown): ButlerWriteOutcome {
  if (!raw || typeof raw !== "object") return { source: "阶段复盘生成", error: "复盘参数无效" };
  const input = raw as Record<string, unknown>;
  if (typeof input.period_start !== "string" || typeof input.period_end !== "string" || !dateSchema.safeParse(input.period_start).success || !dateSchema.safeParse(input.period_end).success) {
    return { source: "阶段复盘生成", error: "period_start 和 period_end 必须使用 YYYY-MM-DD" };
  }
  if (input.period_start > input.period_end) return { source: "阶段复盘生成", error: "开始日期不能晚于结束日期" };
  const review = generatePeriodReviewDraft(database, input.period_start, input.period_end);
  if (review.status === "finalized") return { data: review, source: `阶段复盘已最终确认，管家不能覆盖（${input.period_start} 至 ${input.period_end}）` };
  return { data: review, source: `阶段复盘草稿已生成（${input.period_start} 至 ${input.period_end}）` };
}

const writers: Record<string, (database: PaiosDatabase, raw: unknown, today: string) => ButlerWriteOutcome> = {
  tasks_create: (database, raw, today) => writeTask(database, raw, today),
  tasks_update: (database, raw, today) => updateTask(database, raw, today),
  plans_generate: (database, raw) => generatePlan(database, raw),
  plans_update: (database, raw) => updatePlan(database, raw),
  period_plans_upsert: (database, raw) => upsertStagePlan(database, raw),
  reviews_daily_generate: (database, raw) => generateReview(database, raw),
  reviews_period_generate: (database, raw) => generatePeriodReview(database, raw),
  projects_create: (database, raw) => writeProject(database, raw),
  projects_update: (database, raw, today) => updateProject(database, raw, today),
  ideas_create: (database, raw) => writeIdea(database, raw),
  task_recurrence_create: (database, raw) => writeTaskRecurrence(database, raw),
  task_recurrence_update: (database, raw) => updateTaskRecurrence(database, raw),
  project_workspace_update: (database, raw, today) => writeProjectWorkspace(database, raw, today),
  ideas_update: (database, raw) => updateIdea(database, raw),
  finance_expense_create: (database, raw) => writeFinance(database, raw, "expense"),
  finance_income_create: (database, raw) => writeFinance(database, raw, "income"),
  finance_account_entry_create: (database, raw) => writeAccountEntry(database, raw),
  health_put: (database, raw) => writeHealth(database, raw),
  reviews_update: (database, raw) => updateReview(database, raw),
  _unused: (_database, _raw, _today) => ({ source: "工具目录", error: "未登记的写工具" })
};

export const BUTLER_WRITE_TOOL_NAMES = Object.keys(writers).filter((name) => name !== "_unused");

export function executeButlerWriteTool(database: PaiosDatabase, name: string, rawArguments: unknown, today: string, idempotencyKey?: string): ButlerWriteOutcome {
  const writer = writers[name];
  if (!writer) return { source: "工具目录", error: `未登记的写工具：${name}` };
  const args = rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments) ? rawArguments as Record<string, unknown> : {};
  const beforeTarget = targetFromButlerTool(name, args);
  const before = readAuditTarget(database, beforeTarget);
  const transaction = database.transaction(() => {
    if (idempotencyKey) {
      const cached = database.prepare("SELECT tool_name, result_json FROM agent_idempotency WHERE idempotency_key = ?").get(idempotencyKey) as { tool_name: string; result_json: string } | undefined;
      if (cached?.tool_name === name) {
        try {
          const result = JSON.parse(cached.result_json) as ButlerWriteOutcome;
          return { ...result, source: `${result.source}（重复请求，已复用）` };
        } catch {
          return { source: "幂等记录", error: "幂等记录损坏，请重新执行" };
        }
      }
    }
    const outcome = writer(database, rawArguments, today);
    if (!outcome.error && idempotencyKey) database.prepare("INSERT INTO agent_idempotency (idempotency_key, tool_name, result_json, created_at) VALUES (?, ?, ?, ?)").run(idempotencyKey, name, JSON.stringify(outcome), now());
    return outcome;
  });
  try {
    const outcome = transaction();
    const afterTarget = targetFromButlerTool(name, args, outcome.data);
    recordAudit(database, {
      actor: "agent",
      agentName: "butler",
      toolName: name,
      action: `BUTLER ${name}`,
      target: afterTarget ?? beforeTarget,
      request: rawArguments,
      before,
      after: readAuditTarget(database, afterTarget ?? beforeTarget),
      result: outcome.error ? "error" : "ok"
    });
    return outcome;
  } catch {
    const outcome = { source: `${name} 写入`, error: "本地数据写入失败，未完成本次操作" };
    recordAudit(database, {
      actor: "agent",
      agentName: "butler",
      toolName: name,
      action: `BUTLER ${name}`,
      target: beforeTarget,
      request: rawArguments,
      before,
      after: readAuditTarget(database, beforeTarget),
      result: "error"
    });
    return outcome;
  }
}
