import { z } from "zod";
import { getSetting, type PaiosDatabase } from "@paios/db";
import { butlerSystemPrompt, computeProjectProgress, financeQuickParse, localDateInTimezone, monthStart } from "@paios/core";
import { createHash } from "node:crypto";
import { executeButlerWriteTool } from "./butler-writes.js";
import { getToolCatalogEntry } from "./tool-catalog.js";
import { buildCapabilities } from "./capabilities.js";
import { inspectRecurrences } from "./recurrence.js";
import { readDailyPlan } from "./planner.js";
import { buildAttentionSnapshot, buildDailyPlanningContext, buildStagePlanningContext, butlerPlanningPrompt, classifyProjectPosture, currentStagePlan, listOverdueTasks, listTasksOnExecutionDate, listUndatedTasks, listUpcomingTasks, shiftIsoDate } from "./planning.js";
import { projectPlanningContext } from "./project-service.js";

type TextPart = { type: "text"; text: string };
type ImagePart = { type: "image_url"; image_url: { url: string } };
export type ModelContent = string | Array<TextPart | ImagePart>;

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: ModelContent;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
};

export type ButlerToolTrace = {
  name: string;
  arguments: Record<string, unknown>;
  source: string;
  ok: boolean;
};

export type ButlerAgentResult = {
  content: string;
  traces: ButlerToolTrace[];
  rounds: number;
};

export class ButlerAgentError extends Error {
  constructor(message: string, public readonly traces: ButlerToolTrace[], public readonly rounds: number) {
    super(message);
    this.name = "ButlerAgentError";
  }
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const rangeSchema = z.object({ from: dateSchema.optional(), to: dateSchema.optional() });

type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export const BUTLER_READ_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "capabilities_get",
      description: "读取固定的管家能力和限制说明。用户询问‘你能做什么’或类似问题时必须使用此工具。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "today_get",
      description: "读取当前本地日期的今日总览，包含严格按今天日期筛选的任务明细。涉及‘今天/今日/本天’时必须优先调用此工具，不要用不带日期的 tasks_list 代替。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "tasks_list",
      description: "读取未归档任务。date 表示执行日期（due_date）。查询今天时必须改用 today_get。undated=true 读取没有执行日期的任务，overdue=true 读取逾期任务，from/to 读取执行日期区间。",
      parameters: { type: "object", properties: { date: { type: "string" }, undated: { type: "boolean" }, overdue: { type: "boolean" }, from: { type: "string" }, to: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "tasks_get",
      description: "按任务 id 读取一个任务的名称、正文、备忘和日期。",
      parameters: { type: "object", required: ["task_id"], properties: { task_id: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "task_recurrences_list",
      description: "读取所有周期任务、下一次日期、漏生成数量和错误状态；周期问题必须先看这里。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "task_recurrence_get",
      description: "读取一个独立周期任务模板及其版本信息；不会读取或修改普通任务模板内容。",
      parameters: { type: "object", required: ["recurrence_id"], properties: { recurrence_id: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "task_recurrence_occurrences_list",
      description: "读取一个周期模板生成、跳过和删除的发生台账；不会修改数据。",
      parameters: { type: "object", required: ["recurrence_id"], properties: { recurrence_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 500 } } }
    }
  },
  {
    type: "function",
    function: {
      name: "plans_get",
      description: "读取某个本地日期的计划草稿和已确认状态。",
      parameters: { type: "object", required: ["date"], properties: { date: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "projects_list",
      description: "读取未归档项目及其进度。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "projects_get",
      description: "读取一个项目的资料、阶段和关联任务。",
      parameters: { type: "object", required: ["project_id"], properties: { project_id: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "finance_quick_preview",
      description: "预览一条自然语言财务记录的金额、标准大项/小项和事件，不会写入数据库；普通支出收入不读取或关联账户。",
      parameters: { type: "object", required: ["input"], properties: { input: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "finance_summary",
      description: "读取指定本地日期范围的收入、支出、结余和账户余额。",
      parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "finance_expenses_list",
      description: "读取支出明细，可按日期、大项和小项筛选。",
      parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, category_major: { type: "string" }, category_minor: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "finance_incomes_list",
      description: "读取收入明细，可按日期、大项和小项筛选。",
      parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, category_major: { type: "string" }, category_minor: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "health_get",
      description: "读取某个本地日期的健康记录。",
      parameters: { type: "object", required: ["date"], properties: { date: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "health_range",
      description: "读取一段本地日期范围的健康记录。",
      parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "reviews_list",
      description: "读取每日或阶段复盘列表。",
      parameters: { type: "object", properties: { type: { type: "string", enum: ["daily", "period"] } } }
    }
  },
  {
    type: "function",
    function: {
      name: "reviews_get",
      description: "读取一条复盘的完整内容。",
      parameters: { type: "object", required: ["review_id"], properties: { review_id: { type: "string" } } }
    }
  },
  {
    type: "function",
    function: {
      name: "ideas_list",
      description: "读取未归档想法，按紧急程度排序。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "attention_get",
      description: "读取当前时段待处理摘要：逾期、未安排日期、周期异常、项目姿态、阶段计划、缺失健康数据、待确认事项。主动检查时必须先调用。",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "planning_context_get",
      description: "读取制定每日或阶段计划所需的真实数据包。mode=daily 默认读取明天的执行日期任务；mode=stage 读取想法、复盘、财务、健康和全部项目。",
      parameters: { type: "object", properties: { mode: { type: "string", enum: ["daily", "stage"] }, date: { type: "string" }, period_start: { type: "string" }, period_end: { type: "string" } } }
    }
  }
];

export const BUTLER_WRITE_TOOLS: ToolDefinition[] = [
  { type: "function", function: { name: "tasks_create", description: "按用户明确要求创建一条普通任务；不要凭空创建。关联 project_id 需要当前已确认的阶段计划。", parameters: { type: "object", required: ["title"], properties: { title: { type: "string" }, description: { type: "string" }, content: { type: "string" }, status: { type: "string", enum: ["todo", "done", "cancelled"] }, priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] }, due_date: { type: "string" }, scheduled_date: { type: "string" }, project_id: { type: "string" }, milestone_id: { type: "string" } } } } },
  { type: "function", function: { name: "tasks_update", description: "按用户明确要求更新现有任务；先读取任务并保留正文与备忘的区别。把任务关联到项目需要当前已确认的阶段计划。", parameters: { type: "object", required: ["task_id"], properties: { task_id: { type: "string" }, title: { type: "string" }, description: { type: "string" }, content: { type: "string" }, status: { type: "string", enum: ["todo", "done", "cancelled"] }, due_date: { type: "string" }, project_id: { type: "string" }, milestone_id: { type: "string" }, row_version: { type: "integer" } } } } },
  { type: "function", function: { name: "plans_generate", description: "按用户明确要求生成某个执行日期的每日计划草稿；已确认的计划不可覆盖。任务按 due_date 选取。", parameters: { type: "object", required: ["date"], properties: { date: { type: "string" } } } } },
  { type: "function", function: { name: "plans_update", description: "更新每日计划正文，可记录调整原因。不能把计划标为已确认。", parameters: { type: "object", required: ["date", "plan_text"], properties: { date: { type: "string" }, plan_text: { type: "string" }, adjustment_reason: { type: "string" } } } } },
  { type: "function", function: { name: "period_plans_upsert", description: "创建或更新阶段计划草案。省略 plan_text 时根据真实数据生成骨架。不能把阶段计划标为已确认。", parameters: { type: "object", required: ["period_start", "period_end"], properties: { period_start: { type: "string" }, period_end: { type: "string" }, plan_text: { type: "string" } } } } },
  { type: "function", function: { name: "projects_create", description: "按用户明确要求创建一个项目工作区；不会自动生成项目内容。", parameters: { type: "object", required: ["name"], properties: { name: { type: "string" }, description: { type: "string" }, category: { type: "string", enum: ["small", "mid", "long_term"] }, template: { type: "string", enum: ["small", "mid", "long_term"] }, started_at: { type: "string" }, end_date: { type: "string" }, target_result: { type: "string" }, priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] }, benefit_enabled: { type: "boolean", description: "是否为盈利项目；开启后自动生成项目收入分类和快捷按钮" } } } } },
  { type: "function", function: { name: "projects_update", description: "更新现有项目推进状态；需要当前已确认的阶段计划。不能设为 paused 或 abandoned，也不能归档项目。先读取并使用最新 row_version。", parameters: { type: "object", required: ["project_id"], properties: { project_id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, category: { type: "string", enum: ["small", "mid", "long_term"] }, started_at: { type: "string" }, end_date: { type: "string" }, target_result: { type: "string" }, status: { type: "string", enum: ["idea", "planned", "active", "done"] }, priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] }, benefit_enabled: { type: "boolean" }, progress_manual: { type: "integer", minimum: 0, maximum: 100 }, row_version: { type: "integer" } } } } },
  { type: "function", function: { name: "ideas_create", description: "按用户明确要求创建一条想法；不会自动归档或升级为任务。", parameters: { type: "object", required: ["title"], properties: { title: { type: "string" }, body: { type: "string" }, category: { type: "string", enum: ["project", "long_term", "short_term"] }, urgency: { type: "integer", minimum: 1, maximum: 4 } } } } },
  { type: "function", function: { name: "task_recurrence_create", description: "仅在用户明确要求后创建独立周期任务模板；模板不是普通任务，日期实例由系统生成。", parameters: { type: "object", required: ["start_date", "rule"], properties: { title_template: { type: "string" }, description_template: { type: "string" }, content_template: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, enabled: { type: "boolean" }, rule: { type: "object", required: ["frequency"], properties: { frequency: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] }, interval: { type: "integer", minimum: 1 }, weekdays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } }, day_of_month: { type: "integer", minimum: 1, maximum: 31 }, month: { type: "integer", minimum: 1, maximum: 12 } } } } } } },
  { type: "function", function: { name: "task_recurrence_update", description: "仅在用户明确要求后修改或暂停周期规则；先读取最新 row_version，不能自行重算或补建实例。", parameters: { type: "object", required: ["recurrence_id"], properties: { recurrence_id: { type: "string" }, start_date: { type: "string" }, end_date: { type: "string" }, enabled: { type: "boolean" }, title_template: { type: "string" }, description_template: { type: "string" }, content_template: { type: "string" }, row_version: { type: "integer" }, rule: { type: "object", properties: { frequency: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] }, interval: { type: "integer", minimum: 1 }, weekdays: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } }, day_of_month: { type: "integer", minimum: 1, maximum: 31 }, month: { type: "integer", minimum: 1, maximum: 12 } } } } } } },
  { type: "function", function: { name: "project_workspace_update", description: "按用户明确要求写入项目资料区；需要当前已确认的阶段计划。", parameters: { type: "object", required: ["project_id"], properties: { project_id: { type: "string" }, introduction: { type: "string" }, goals: { type: "string" }, current_situation: { type: "string" }, notes: { type: "string" } } } } },
  { type: "function", function: { name: "ideas_update", description: "按用户明确要求更新现有想法；想法升级和归档仍需人工确认。", parameters: { type: "object", required: ["idea_id"], properties: { idea_id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, category: { type: "string", enum: ["project", "long_term", "short_term"] }, urgency: { type: "integer", minimum: 1, maximum: 4 }, processed: { type: "boolean" }, row_version: { type: "integer" } } } } },
  { type: "function", function: { name: "finance_expense_create", description: "按用户明确要求登记独立的普通支出；金额必须是整数分。不得询问或填写账户，也不会改变账户余额。", parameters: { type: "object", required: ["amount_cents"], properties: { amount_cents: { type: "integer", minimum: 1 }, category_major: { type: "string" }, category_minor: { type: "string" }, category: { type: "string" }, project_id: { type: "string" }, event: { type: "string" }, note: { type: "string" }, occurred_date: { type: "string" } } } } },
  { type: "function", function: { name: "finance_income_create", description: "按用户明确要求登记独立的普通收入；金额必须是整数分。不得询问或填写账户，也不会改变账户余额。", parameters: { type: "object", required: ["amount_cents"], properties: { amount_cents: { type: "integer", minimum: 1 }, category_major: { type: "string" }, category_minor: { type: "string" }, category: { type: "string" }, project_id: { type: "string" }, event: { type: "string" }, note: { type: "string" }, occurred_date: { type: "string" } } } } },
  { type: "function", function: { name: "finance_account_entry_create", description: "按用户明确要求记录账户存入或取出；它不是日常支出。", parameters: { type: "object", required: ["account_id", "direction", "amount_cents"], properties: { account_id: { type: "string" }, direction: { type: "string", enum: ["deposit", "withdrawal"] }, amount_cents: { type: "integer", minimum: 1 }, event: { type: "string" }, note: { type: "string" }, occurred_date: { type: "string" } } } } },
  { type: "function", function: { name: "health_put", description: "按用户明确要求更新某个本地日期的健康记录；睡眠时长由上床和起床时间自动计算。", parameters: { type: "object", required: ["date"], properties: { date: { type: "string" }, weight_kg: { type: "number" }, bedtime_local: { type: "string" }, wake_local: { type: "string" }, exercise_note: { type: "string" }, exercise_minutes: { type: "integer" }, disciplined: { type: "boolean" }, note: { type: "string" } } } } },
  { type: "function", function: { name: "reviews_daily_generate", description: "生成指定日期的真实数据复盘草稿，含客观统计骨架；不会最终确认。时段检查结果应写入该草稿。", parameters: { type: "object", required: ["date"], properties: { date: { type: "string" } } } } },
  { type: "function", function: { name: "reviews_period_generate", description: "生成阶段复盘草稿，含客观统计；不会最终确认。", parameters: { type: "object", required: ["period_start", "period_end"], properties: { period_start: { type: "string" }, period_end: { type: "string" } } } } },
  { type: "function", function: { name: "reviews_update", description: "修改复盘草稿，包括分析、建议和时段检查记录；最终确认必须在人工界面完成。", parameters: { type: "object", required: ["review_id"], properties: { review_id: { type: "string" }, content: { type: "object" }, answers: { type: "object" } } } } }
];

function parseRange(input: unknown, today: string): { from: string; to: string } | { error: string } {
  const parsed = rangeSchema.safeParse(input ?? {});
  if (!parsed.success) return { error: "日期必须使用 YYYY-MM-DD" };
  const from = parsed.data.from ?? monthStart(today);
  const to = parsed.data.to ?? today;
  if (from > to) return { error: "开始日期不能晚于结束日期" };
  return { from, to };
}

function reviewContent(row: Record<string, unknown>): Record<string, unknown> {
  try {
    const value = JSON.parse(String(row.content_json ?? "{}")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function selectedRows(database: PaiosDatabase, sql: string, params: unknown[]): unknown[] {
  return database.prepare(sql).all(...params) as unknown[];
}

export function executeButlerReadTool(database: PaiosDatabase, name: string, rawArguments: unknown, today: string): { data: unknown; source: string } | { error: string; source: string } {
  if (name === "capabilities_get") {
    const capabilities = buildCapabilities(null);
    return { data: capabilities, source: "固定能力说明" };
  }

  if (name === "today_get") {
    const tasks = selectedRows(database,
      "SELECT id, title, description, content, status, due_date, scheduled_date, recurrence_date, updated_at FROM tasks WHERE archived_at IS NULL AND status != 'cancelled' AND due_date = ? ORDER BY due_date ASC, created_at ASC LIMIT 100",
      [today]
    ) as Array<Record<string, unknown>>;
    const overdue = selectedRows(database,
      "SELECT id, title, description, content, status, due_date, scheduled_date, recurrence_date, updated_at FROM tasks WHERE archived_at IS NULL AND status NOT IN ('done', 'cancelled') AND due_date < ? ORDER BY due_date ASC, created_at ASC LIMIT 100",
      [today]
    );
    const start = monthStart(today);
    const finance = database.prepare(
      "SELECT (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS expenses, (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_incomes WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS incomes"
    ).get(start, today, start, today) as { expenses: number; incomes: number };
    const health = database.prepare("SELECT 1 AS recorded FROM health_logs WHERE log_date = ? AND archived_at IS NULL LIMIT 1").get(today) as { recorded: number } | undefined;
    const confirmations = database.prepare("SELECT COUNT(*) AS count FROM confirmation_tickets WHERE status = 'pending' AND expires_at > ?").get(new Date().toISOString()) as { count: number };
    return {
      data: {
        date: today,
        tasks: {
          due: tasks.length,
          completed: tasks.filter((task) => task.status === "done").length,
          overdue: overdue.length,
          items: tasks,
          overdueItems: overdue
        },
        finance: { monthExpenseCents: finance.expenses, monthIncomeCents: finance.incomes },
        health: { recorded: Boolean(health?.recorded) },
        confirmations: confirmations.count
      },
      source: `今日总览（${today}，今日任务 ${tasks.length} 条）`
    };
  }

  if (name === "plans_get") {
    const args = dateSchema.safeParse((rawArguments as Record<string, unknown> | null)?.date);
    if (!args.success) return { error: "date 必须使用 YYYY-MM-DD", source: "计划读取" };
    return { data: readDailyPlan(database, args.data), source: `计划读取（${args.data}）` };
  }

  if (name === "tasks_list") {
    const args = z.object({ date: dateSchema.optional(), undated: z.boolean().optional(), overdue: z.boolean().optional(), from: dateSchema.optional(), to: dateSchema.optional() }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "日期必须使用 YYYY-MM-DD", source: "任务列表" };
    if (args.data.undated) {
      const rows = listUndatedTasks(database);
      return { data: rows, source: `未安排执行日期的任务（${rows.length} 条）` };
    }
    if (args.data.overdue) {
      const rows = listOverdueTasks(database, today);
      return { data: rows, source: `逾期任务（${rows.length} 条，执行日期早于 ${today}）` };
    }
    if (args.data.from && args.data.to) {
      const rows = listUpcomingTasks(database, shiftIsoDate(args.data.from, -1), args.data.to);
      return { data: rows, source: `执行日期 ${args.data.from} 至 ${args.data.to} 的任务（${rows.length} 条）` };
    }
    const date = args.data.date;
    const rows = date
      ? listTasksOnExecutionDate(database, date)
      : selectedRows(database, "SELECT id, title, description, content, status, due_date, scheduled_date, recurrence_date, updated_at FROM tasks WHERE archived_at IS NULL ORDER BY due_date IS NULL, due_date ASC, created_at ASC LIMIT 100", []);
    return { data: rows, source: `任务列表（${rows.length} 条${date ? `，执行日期 ${date}` : ""}）` };
  }

  if (name === "attention_get") {
    return { data: buildAttentionSnapshot(database, today), source: `主动检查摘要（${today}）` };
  }

  if (name === "planning_context_get") {
    const args = z.object({ mode: z.enum(["daily", "stage"]).optional(), date: dateSchema.optional(), period_start: dateSchema.optional(), period_end: dateSchema.optional() }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "日期必须使用 YYYY-MM-DD", source: "计划上下文" };
    const mode = args.data.mode ?? "daily";
    if (mode === "stage") {
      const covering = currentStagePlan(database, today);
      const periodStart = args.data.period_start ?? (typeof covering?.period_start === "string" ? covering.period_start : today);
      const periodEnd = args.data.period_end ?? (typeof covering?.period_end === "string" ? covering.period_end : shiftIsoDate(today, 6));
      return { data: buildStagePlanningContext(database, periodStart, periodEnd, today), source: `阶段计划上下文（${periodStart} 至 ${periodEnd}）` };
    }
    const date = args.data.date ?? shiftIsoDate(today, 1);
    return { data: buildDailyPlanningContext(database, date, today), source: `每日计划上下文（执行日期 ${date}）` };
  }

  if (name === "tasks_get") {
    const args = z.object({ task_id: z.string().min(1) }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "task_id 缺失", source: "任务详情" };
    const row = database.prepare("SELECT id, title, description, content, status, due_date, scheduled_date, recurrence_date, updated_at FROM tasks WHERE id = ? AND archived_at IS NULL").get(args.data.task_id) as Record<string, unknown> | undefined;
    return row ? { data: row, source: `任务详情（${args.data.task_id}）` } : { error: "本地当前没有查到这个任务", source: `任务详情（${args.data.task_id}，未找到）` };
  }

  if (name === "task_recurrences_list") {
    const rows = inspectRecurrences(database, null, today);
    return { data: rows, source: `周期任务检查（${rows.length} 条）` };
  }

  if (name === "task_recurrence_get") {
    const args = z.object({ recurrence_id: z.string().min(1) }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "recurrence_id 缺失", source: "周期模板详情" };
    const recurrence = inspectRecurrences(database, args.data.recurrence_id, today)[0];
    if (!recurrence) return { error: "本地当前没有查到这个周期模板", source: "周期模板详情" };
    const versions = selectedRows(database, "SELECT id, recurrence_id, version, effective_from, effective_to, title_template, description_template, content_template, rule_json, schedule_anchor_date, created_at FROM task_recurrence_versions WHERE recurrence_id = ? ORDER BY version ASC", [args.data.recurrence_id]);
    return { data: { recurrence, versions }, source: `周期模板详情（${args.data.recurrence_id}）` };
  }

  if (name === "task_recurrence_occurrences_list") {
    const args = z.object({ recurrence_id: z.string().min(1), limit: z.number().int().min(1).max(500).optional() }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "recurrence_id 或 limit 无效", source: "周期发生台账" };
    const limit = args.data.limit ?? 100;
    const rows = selectedRows(database, "SELECT o.*, t.title, t.status, t.due_date, t.archived_at FROM task_recurrence_occurrences o LEFT JOIN tasks t ON t.id = o.task_id WHERE o.recurrence_id = ? ORDER BY o.occurrence_date DESC LIMIT ?", [args.data.recurrence_id, limit]);
    return { data: rows, source: `周期发生台账（${args.data.recurrence_id}，${rows.length} 条）` };
  }

  if (name === "projects_list") {
    const projects = selectedRows(database, "SELECT * FROM projects WHERE archived_at IS NULL ORDER BY started_at IS NULL, started_at DESC, created_at DESC LIMIT 100", []) as Array<Record<string, unknown>>;
    const data = projects.map((project) => {
      const counts = database.prepare("SELECT COUNT(t.id) AS total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id WHERE l.project_id = ? AND t.archived_at IS NULL").get(project.id) as { total: number; completed: number | null };
      return { ...project, progress: computeProjectProgress(counts.completed ?? 0, counts.total, project.progress_manual as number | null), ...projectPlanningContext(database, String(project.id)) };
    });
    return { data, source: `项目列表（${data.length} 个）` };
  }

  if (name === "projects_get") {
    const args = z.object({ project_id: z.string().min(1) }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "project_id 缺失", source: "项目详情" };
    const project = database.prepare("SELECT * FROM projects WHERE id = ? AND archived_at IS NULL").get(args.data.project_id) as Record<string, unknown> | undefined;
    if (!project) return { error: "本地当前没有查到这个项目", source: `项目详情（${args.data.project_id}，未找到）` };
    const workspace = database.prepare("SELECT * FROM project_workspaces WHERE project_id = ?").get(args.data.project_id) as Record<string, unknown> | null;
    const milestones = selectedRows(database, "SELECT * FROM milestones WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order, created_at", [args.data.project_id]);
    const tasks = selectedRows(database, "SELECT t.id, t.title, t.status, t.due_date, t.description, t.content, t.updated_at, t.recurrence_id FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id WHERE l.project_id = ? AND t.archived_at IS NULL ORDER BY t.due_date IS NULL, t.due_date ASC, t.created_at ASC", [args.data.project_id]) as Array<Record<string, unknown>>;
    const openIssueCount = (database.prepare("SELECT COUNT(*) AS count FROM project_issues WHERE project_id = ? AND archived_at IS NULL AND status != 'closed'").get(args.data.project_id) as { count: number }).count;
    const posture = classifyProjectPosture({
      status: String(project.status ?? ""),
      name: String(project.name ?? ""),
      description: String(project.description ?? ""),
      goals: workspace && typeof workspace.goals === "string" ? workspace.goals : "",
      endDate: typeof project.end_date === "string" ? project.end_date : null,
      progress: null,
      today,
      tasks: tasks.map((task) => ({ status: String(task.status), due_date: typeof task.due_date === "string" ? task.due_date : null, updated_at: String(task.updated_at ?? ""), recurrence_id: typeof task.recurrence_id === "string" ? task.recurrence_id : null })),
      openIssueCount
    });
    return { data: { project, workspace, milestones, tasks, posture, ...projectPlanningContext(database, args.data.project_id) }, source: `项目详情（${args.data.project_id}，${posture.label}，${tasks.length} 个关联任务）` };
  }

  if (name === "finance_summary") {
    const range = parseRange(rawArguments, today);
    if ("error" in range) return { error: range.error, source: "财务汇总" };
    const expenses = (database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_expenses WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL").get(range.from, range.to) as { total: number }).total;
    const incomes = (database.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM finance_incomes WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL").get(range.from, range.to) as { total: number }).total;
    const accounts = selectedRows(database, "SELECT id, name, currency, current_balance_cents FROM finance_accounts WHERE archived_at IS NULL ORDER BY created_at", []);
    return { data: { from: range.from, to: range.to, expensesCents: expenses, incomesCents: incomes, netCents: incomes - expenses, accounts }, source: `财务汇总（${range.from} 至 ${range.to}）` };
  }

  if (name === "finance_quick_preview") {
    const args = z.object({ input: z.string().min(1) }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "input 不能为空", source: "财务预览" };
    const preview = financeQuickParse(args.data.input);
    return { data: preview, source: preview ? "财务预览（未写入）" : "财务预览（未识别金额）" };
  }

  if (name === "finance_expenses_list" || name === "finance_incomes_list") {
    const range = parseRange(rawArguments, today);
    if ("error" in range) return { error: range.error, source: name === "finance_expenses_list" ? "支出明细" : "收入明细" };
    const args = (rawArguments && typeof rawArguments === "object" ? rawArguments : {}) as Record<string, unknown>;
    const table = name === "finance_expenses_list" ? "finance_expenses" : "finance_incomes";
    const conditions = ["occurred_date BETWEEN ? AND ?", "archived_at IS NULL"];
    const params: unknown[] = [range.from, range.to];
    for (const key of ["category_major", "category_minor"] as const) {
      if (typeof args[key] === "string" && args[key].trim()) { conditions.push(`${key} = ?`); params.push(args[key].trim()); }
    }
    const rows = selectedRows(database, "SELECT id, amount_cents, category, category_major, category_minor, event, note, occurred_date FROM " + table + " WHERE " + conditions.join(" AND ") + " ORDER BY occurred_date DESC, created_at DESC LIMIT 200", params);
    return { data: rows, source: `${name === "finance_expenses_list" ? "支出" : "收入"}明细（${range.from} 至 ${range.to}，${rows.length} 条）` };
  }

  if (name === "health_get") {
    const args = z.object({ date: dateSchema }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "日期必须使用 YYYY-MM-DD", source: "健康记录" };
    const row = database.prepare("SELECT log_date, weight_kg, bedtime_local, sleep_onset_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined, note FROM health_logs WHERE log_date = ?").get(args.data.date) ?? null;
    return { data: row, source: `健康记录（${args.data.date}${row ? "" : "，未记录"}）` };
  }

  if (name === "health_range") {
    const range = parseRange(rawArguments, today);
    if ("error" in range) return { error: range.error, source: "健康记录" };
    const rows = selectedRows(database, "SELECT log_date, weight_kg, bedtime_local, sleep_onset_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined, note FROM health_logs WHERE log_date BETWEEN ? AND ? ORDER BY log_date DESC", [range.from, range.to]);
    return { data: rows, source: `健康记录（${range.from} 至 ${range.to}，${rows.length} 条）` };
  }

  if (name === "reviews_list") {
    const args = z.object({ type: z.enum(["daily", "period"]).optional() }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "复盘类型无效", source: "复盘列表" };
    const rows = selectedRows(database, "SELECT id, review_type, period_start, period_end, status, updated_at, content_json FROM reviews ORDER BY period_end DESC, created_at DESC LIMIT 100", []) as Array<Record<string, unknown>>;
    const filtered = args.data.type ? rows.filter((row) => row.review_type === args.data.type) : rows;
    return { data: filtered.map((row) => ({ ...row, content: reviewContent(row), content_json: undefined })), source: `复盘列表（${filtered.length} 条）` };
  }

  if (name === "reviews_get") {
    const args = z.object({ review_id: z.string().min(1) }).safeParse(rawArguments ?? {});
    if (!args.success) return { error: "review_id 缺失", source: "复盘详情" };
    const row = database.prepare("SELECT * FROM reviews WHERE id = ?").get(args.data.review_id) as Record<string, unknown> | undefined;
    return row ? { data: { ...row, content: reviewContent(row), content_json: undefined }, source: `复盘详情（${args.data.review_id}）` } : { error: "本地当前没有查到这条复盘", source: `复盘详情（${args.data.review_id}，未找到）` };
  }

  if (name === "ideas_list") {
    const rows = selectedRows(database, "SELECT id, title, body, category, urgency, processed, updated_at FROM ideas WHERE archived_at IS NULL ORDER BY urgency ASC, updated_at DESC LIMIT 100", []);
    return { data: rows, source: `想法列表（${rows.length} 条）` };
  }

  return { error: `未登记的只读工具：${name}`, source: "工具目录" };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "").join("");
}

function latestUserAsksToday(history: ModelMessage[]): boolean {
  const latestUser = [...history].reverse().find((message) => message.role === "user");
  if (!latestUser) return false;
  const text = textFromContent(latestUser.content);
  return /今天|今日|本天/.test(text) && !/明天|昨天|前天|本周|本月|日期范围/.test(text);
}

function parseModelMessage(value: unknown): { content: ModelContent; toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> } {
  if (!value || typeof value !== "object") return { content: "", toolCalls: [] };
  const message = value as { content?: unknown; tool_calls?: unknown };
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls.flatMap((call): Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> => {
    if (!call || typeof call !== "object") return [];
    const item = call as { id?: unknown; type?: unknown; function?: unknown };
    if (typeof item.id !== "string" || item.type !== "function" || !item.function || typeof item.function !== "object") return [];
    const fn = item.function as { name?: unknown; arguments?: unknown };
    if (typeof fn.name !== "string" || typeof fn.arguments !== "string") return [];
    return [{ id: item.id, type: "function", function: { name: fn.name, arguments: fn.arguments } }];
  }) : [];
  return { content: typeof message.content === "string" || Array.isArray(message.content) ? message.content as ModelContent : "", toolCalls };
}

function modelError(value: unknown): string {
  if (!value || typeof value !== "object") return "模型请求失败";
  const error = (value as { error?: unknown }).error;
  return error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string" ? String((error as { message: string }).message) : "模型请求失败";
}

export async function runButlerAgent(options: {
  database: PaiosDatabase;
  endpoint: URL;
  apiKey: string;
  model: string;
  date: string;
  history: ModelMessage[];
  currentAttachments?: Array<{ mime: string; dataUrl: string }>;
  allowWrites?: boolean;
  idempotencyNamespace?: string;
  signal?: AbortSignal;
}): Promise<ButlerAgentResult> {
  const traces: ButlerToolTrace[] = [];
  const routeUnscopedTodayTaskList = latestUserAsksToday(options.history);
  const messages: ModelMessage[] = [
    { role: "system", content: `${butlerSystemPrompt()}\n${butlerPlanningPrompt()}\n当前日期：${options.date}\n涉及已有记录的修改或查询必须以只读工具返回的真实数据为准；新建一条用户刚刚明确提供了必要信息的财务记录时，可以直接调用对应写工具。工具结果之外的个人信息一律回答“本地当前没有查到”。${options.allowWrites ? "用户明确要求制定计划、推进项目、调整任务或记录复盘时，可调用普通写工具；删除、恢复、归档、暂停/放弃项目和确认批准不可执行。" : "本轮对话只允许读取，不提供写入工具。"}` },
    ...options.history
  ];
  if (options.currentAttachments?.length) {
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      last.content = [{ type: "text", text: textFromContent(last.content) }, ...options.currentAttachments.map((item) => ({ type: "image_url" as const, image_url: { url: item.dataUrl.startsWith("data:") ? item.dataUrl : `data:${item.mime};base64,${item.dataUrl}` } }))];
    }
  }

  for (let round = 0; round < 8; round += 1) {
    let response: Response;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const timeout = AbortSignal.timeout(30000);
        response = await fetch(options.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
          body: JSON.stringify({ model: options.model, messages, tools: options.allowWrites ? [...BUTLER_READ_TOOLS, ...BUTLER_WRITE_TOOLS] : BUTLER_READ_TOOLS, tool_choice: "auto", temperature: 0.2, stream: false }),
          signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
        });
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError") || attempt === 1) break;
      }
    }
    if (!response!) throw new ButlerAgentError(lastError instanceof Error ? `LLM request failed: ${lastError.message}` : "LLM request failed", traces, round + 1);
    const payload = await response.json().catch(() => null) as { choices?: unknown; error?: unknown } | null;
    if (!response.ok) throw new ButlerAgentError(modelError(payload), traces, round + 1);
    const choices = payload?.choices;
    const first = Array.isArray(choices) ? choices[0] : null;
    const parsed = parseModelMessage(first && typeof first === "object" ? (first as { message?: unknown }).message : null);
    if (!parsed.toolCalls.length) {
      const content = textFromContent(parsed.content).trim();
      if (!content) throw new ButlerAgentError("LLM response did not contain assistant text", traces, round + 1);
      return { content, traces, rounds: round + 1 };
    }
    messages.push({ role: "assistant", content: parsed.content, tool_calls: parsed.toolCalls });
    for (const call of parsed.toolCalls.slice(0, 20 - traces.length)) {
      const catalogEntry = getToolCatalogEntry(call.function.name);
      if (!catalogEntry || catalogEntry.access === "confirmation") {
        traces.push({ name: call.function.name, arguments: {}, source: "工具未登记或需要人工确认", ok: false });
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ ok: false, error: "工具未登记或需要人工确认" }) });
        continue;
      }
      let args: Record<string, unknown> = {};
      try {
        const decoded = JSON.parse(call.function.arguments) as unknown;
        if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) args = decoded as Record<string, unknown>;
      } catch {
        traces.push({ name: call.function.name, arguments: {}, source: "工具参数无法解析", ok: false });
        messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ ok: false, error: "工具参数无法解析" }) });
        continue;
      }
      const idempotencyKey = options.idempotencyNamespace
        ? `${options.idempotencyNamespace}:${call.function.name}:${createHash("sha256").update(JSON.stringify(args, Object.keys(args).sort())).digest("hex").slice(0, 32)}`
        : undefined;
      const isReadTool = new Set(BUTLER_READ_TOOLS.map((tool) => tool.function.name)).has(call.function.name);
      const routedToolName = routeUnscopedTodayTaskList && call.function.name === "tasks_list" && args.date === undefined ? "today_get" : call.function.name;
      const output = isReadTool
        ? executeButlerReadTool(options.database, routedToolName, routedToolName === "today_get" ? {} : args, options.date)
        : options.allowWrites
          ? executeButlerWriteTool(options.database, call.function.name, args, options.date, idempotencyKey)
          : { error: "当前对话未授权写入", source: "管家写入权限" };
      const ok = !((output as { error?: string }).error);
      traces.push({ name: routedToolName, arguments: routedToolName === "today_get" ? {} : args, source: output.source, ok });
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(ok ? { ok: true, data: (output as { data: unknown }).data } : { ok: false, error: (output as { error: string }).error }) });
    }
    if (traces.length >= 20) break;
  }
  throw new ButlerAgentError("管家读取次数超过限制，请缩小问题范围后重试", traces, 8);
}

export function butlerAgentHistory(rows: Array<{ role: "user" | "assistant"; content_text: string }>): ModelMessage[] {
  return rows.map((row) => ({ role: row.role, content: row.content_text }));
}

export function butlerToday(database: PaiosDatabase): string {
  return localDateInTimezone(getSetting(database, "timezone", "Asia/Shanghai"));
}
