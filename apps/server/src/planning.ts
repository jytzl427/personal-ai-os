import { getSetting, type PaiosDatabase } from "@paios/db";
import { computeProjectProgress, financeQuickParse, localDateInTimezone } from "@paios/core";
import { randomUUID } from "node:crypto";
import { inspectRecurrences } from "./recurrence.js";
import { projectPlanningContext } from "./project-service.js";

export type TimePhase = "morning" | "afternoon" | "evening";
export type ProjectPosture = "stable_maintenance" | "advancing" | "needs_acceleration" | "blocked" | "stalled" | "learning" | "paused";
export type TaskBand = "urgent" | "important" | "secondary";

export const PROJECT_POSTURE_LABELS: Record<ProjectPosture, string> = {
  stable_maintenance: "稳定维护",
  advancing: "正常推进",
  needs_acceleration: "需要加速",
  blocked: "出现阻塞",
  stalled: "长期停滞",
  learning: "学习型项目",
  paused: "暂停项目"
};

const OPEN_TASK = "status NOT IN ('done', 'cancelled')";

export function shiftIsoDate(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

export function localHourInTimezone(timezone: string, now = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).formatToParts(now).find((part) => part.type === "hour")?.value;
  const parsed = Number(hour);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : now.getHours();
}

export function timePhaseFromHour(hour: number): TimePhase {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  return "evening";
}

export function nextPhaseAt(timezone: string, now = new Date()): string {
  const hour = localHourInTimezone(timezone, now);
  const date = localDateInTimezone(timezone, now);
  if (hour >= 5 && hour < 12) return `${date}T12:00:00`;
  if (hour >= 12 && hour < 18) return `${date}T18:00:00`;
  const nextMorning = hour >= 18 ? shiftIsoDate(date, 1) : date;
  return `${nextMorning}T05:00:00`;
}

export function classifyTaskBand(priority: unknown): TaskBand {
  if (priority === "P0") return "urgent";
  if (priority === "P1") return "important";
  return "secondary";
}

export function isButlerWriteIntent(text: string): boolean {
  const value = text.trim();
  if (!value || /(不要|别|无需|不需要|不能).{0,12}(添加|新增|创建|记录|修改|更新|改|设置|写入)/.test(value)) return false;
  const finance = financeQuickParse(value);
  if (finance?.categoryMajor && finance.categoryMinor && !/[?？]/.test(value)) return true;
  if (/主动检查|当前时段|写入.*复盘|检查结果/.test(value) && /请|帮我/.test(value)) return true;
  const prefix = /^(请|帮我|我要|需要|添加|新增|创建|记录|修改|更新|把|将|制定|安排|推进|拆分|调整|复盘|补记|补齐)/;
  const action = /(添加|新增|创建|记录(?:一下)?|修改|更新|改成|设置为|写入|标记为|记一笔|制定|安排|推进|拆分|调整|复盘|补齐|延期|提前)/;
  return prefix.test(value) || (/(请|帮我|我要|需要|把|将).{0,40}/.test(value) && action.test(value));
}

export type ProjectPostureInput = {
  status: string;
  name: string;
  category?: string | null;
  description?: string | null;
  goals?: string | null;
  endDate?: string | null;
  progress?: number | null;
  today: string;
  tasks: Array<{ status: string; due_date: string | null; updated_at: string; recurrence_id?: string | null }>;
  openIssueCount?: number;
};

export function classifyProjectPosture(input: ProjectPostureInput): { posture: ProjectPosture; label: string; reason: string } {
  if (input.status === "paused" || input.status === "abandoned") {
    return result("paused", "项目状态为暂停或放弃，先处理阻塞或由用户在界面恢复，不能继续堆任务。");
  }
  if (input.category === "maintenance" || input.category === "long_term") {
    return result("stable_maintenance", "属于维护型项目，保持日常低精力平稳运行与收支监控。");
  }
  const blob = `${input.name}\n${input.description ?? ""}\n${input.goals ?? ""}`;
  const openTasks = input.tasks.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const lastUpdate = input.tasks.reduce((latest, task) => task.updated_at > latest ? task.updated_at : latest, "");
  const stalled = openTasks.length > 0 && lastUpdate !== "" && lastUpdate.slice(0, 10) <= shiftIsoDate(input.today, -14);
  if (/学习|教程|入门|练习|课程|知识点|java\s*web|自学/i.test(blob)) {
    return result("learning", `从名称或目标看这是学习型项目，应先定学习目标再拆成具体学习、练习和总结任务。${stalled ? "同时超过14天没有更新，先确认学习是否卡住。" : ""}`);
  }
  const overdue = openTasks.filter((task) => task.due_date && task.due_date < input.today);
  const recent = input.tasks.filter((task) => task.updated_at.slice(0, 10) >= shiftIsoDate(input.today, -7));
  const recentDone = input.tasks.filter((task) => task.status === "done" && task.updated_at.slice(0, 10) >= shiftIsoDate(input.today, -7));
  if ((input.openIssueCount ?? 0) > 0 || (overdue.length >= 2 && recentDone.length === 0)) {
    return result("blocked", "存在未关闭问题或多项逾期且近期没有完成记录，应先分析阻塞而不是继续加任务。");
  }
  if (stalled) {
    return result("stalled", "超过14天没有任务更新，属于长期停滞，先找原因。");
  }
  if (input.tasks.length === 0 && (input.status === "active" || input.status === "planned" || input.status === "idea")) {
    return result("stalled", "项目还没有可执行任务，先拆解再推进。");
  }
  if (input.endDate && input.endDate <= shiftIsoDate(input.today, 14) && (input.progress ?? 0) < 70 && openTasks.length > 0) {
    return result("needs_acceleration", `结束日期 ${input.endDate} 临近且进度不足，需要加速。`);
  }
  const recurring = openTasks.filter((task) => task.recurrence_id);
  if (openTasks.length > 0 && recurring.length / openTasks.length >= 0.6) {
    return result("stable_maintenance", "当前开放任务多数来自周期维护，适合检查和修复，而不是大规模新建。");
  }
  if (recent.length > 0 || input.status === "active" || input.status === "planned") {
    return result("advancing", "近期有推进或项目处于进行中，按阶段目标继续拆解执行。");
  }
  return result("advancing", "未发现停滞或阻塞，按正常推进处理。");
}

function result(posture: ProjectPosture, reason: string) {
  return { posture, label: PROJECT_POSTURE_LABELS[posture], reason };
}

type TaskSummary = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
  project_id?: string | null;
  recurrence_id?: string | null;
  updated_at?: string;
  band?: TaskBand;
};

function taskRows(database: PaiosDatabase, sql: string, params: unknown[]): TaskSummary[] {
  return (database.prepare(sql).all(...params) as TaskSummary[]).map((row) => ({ ...row, band: classifyTaskBand(row.priority) }));
}

export function listTasksOnExecutionDate(database: PaiosDatabase, date: string): TaskSummary[] {
  return taskRows(database, `SELECT id, title, status, priority, due_date, recurrence_id, updated_at FROM tasks WHERE archived_at IS NULL AND due_date = ? ORDER BY priority ASC, created_at ASC LIMIT 200`, [date]);
}

export function listOverdueTasks(database: PaiosDatabase, today: string): TaskSummary[] {
  return taskRows(database, `SELECT id, title, status, priority, due_date, recurrence_id, updated_at FROM tasks WHERE archived_at IS NULL AND ${OPEN_TASK} AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date ASC, created_at ASC LIMIT 200`, [today]);
}

export function listUndatedTasks(database: PaiosDatabase): TaskSummary[] {
  return taskRows(database, `SELECT id, title, status, priority, due_date, recurrence_id, updated_at FROM tasks WHERE archived_at IS NULL AND ${OPEN_TASK} AND due_date IS NULL ORDER BY priority ASC, created_at ASC LIMIT 200`, []);
}

export function listUpcomingTasks(database: PaiosDatabase, afterDate: string, untilDate: string): TaskSummary[] {
  return taskRows(database, `SELECT id, title, status, priority, due_date, recurrence_id, updated_at FROM tasks WHERE archived_at IS NULL AND ${OPEN_TASK} AND due_date > ? AND due_date <= ? ORDER BY due_date ASC, priority ASC LIMIT 200`, [afterDate, untilDate]);
}

function projectPostures(database: PaiosDatabase, today: string) {
  const projects = database.prepare("SELECT * FROM projects WHERE archived_at IS NULL ORDER BY started_at IS NULL, started_at DESC, created_at DESC LIMIT 100").all() as Array<Record<string, unknown>>;
  return projects.map((project) => {
    const tasks = database.prepare("SELECT t.status, t.due_date, t.updated_at, t.recurrence_id FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id WHERE l.project_id = ? AND t.archived_at IS NULL").all(project.id) as Array<{ status: string; due_date: string | null; updated_at: string; recurrence_id: string | null }>;
    const counts = database.prepare("SELECT COUNT(t.id) AS total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id WHERE l.project_id = ? AND t.archived_at IS NULL").get(project.id) as { total: number; completed: number | null };
    const workspace = database.prepare("SELECT goals FROM project_workspaces WHERE project_id = ?").get(project.id) as { goals?: string } | undefined;
    const openIssueCount = (database.prepare("SELECT COUNT(*) AS count FROM project_issues WHERE project_id = ? AND archived_at IS NULL AND status != 'closed'").get(project.id) as { count: number }).count;
    const progress = computeProjectProgress(counts.completed ?? 0, counts.total, project.progress_manual as number | null);
    const classified = classifyProjectPosture({
      status: String(project.status ?? ""),
      name: String(project.name ?? ""),
      category: typeof project.category === "string" ? project.category : null,
      description: String(project.description ?? ""),
      goals: workspace?.goals ?? "",
      endDate: typeof project.end_date === "string" ? project.end_date : null,
      progress,
      today,
      tasks,
      openIssueCount
    });
    const projectContext = projectPlanningContext(database, String(project.id));
    return {
      id: String(project.id),
      name: String(project.name),
      status: String(project.status),
      progress,
      end_date: project.end_date ?? null,
      ...classified,
      open_tasks: tasks.filter((task) => task.status !== "done" && task.status !== "cancelled").length,
      overdue_tasks: tasks.filter((task) => task.status !== "done" && task.status !== "cancelled" && task.due_date && task.due_date < today).length,
      planned_tasks: projectContext.planned_tasks,
      finance: projectContext.finance,
      recent_activities: projectContext.recent_activities
    };
  });
}

export function currentStagePlan(database: PaiosDatabase, today: string) {
  return database.prepare("SELECT * FROM period_plans WHERE archived_at IS NULL AND period_start <= ? AND period_end >= ? ORDER BY CASE status WHEN 'confirmed' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updated_at DESC LIMIT 1").get(today, today) as Record<string, unknown> | undefined;
}

export const STAGE_PLAN_ADVANCEMENT_ERROR = "当前没有已确认的阶段计划。请先制定阶段计划草案，并由用户在界面确认后，才能推进项目。";
export const PAUSED_PROJECT_ADVANCEMENT_ERROR = "项目已暂停或放弃，管家不能继续推进，请由用户在界面恢复。";

export function confirmedStagePlanCovering(database: PaiosDatabase, date: string) {
  return database.prepare(
    `SELECT id, period_start, period_end, status, plan_text
     FROM period_plans
     WHERE archived_at IS NULL AND status IN ('confirmed', 'executed')
       AND period_start <= ? AND period_end >= ?
     ORDER BY CASE status WHEN 'confirmed' THEN 0 ELSE 1 END, updated_at DESC
     LIMIT 1`
  ).get(date, date) as { id: string; period_start: string; period_end: string; status: string; plan_text: string } | undefined;
}

export function agentProjectAdvancementBlocked(database: PaiosDatabase, date: string): string | null {
  return confirmedStagePlanCovering(database, date) ? null : STAGE_PLAN_ADVANCEMENT_ERROR;
}

export function agentCannotWriteProject(database: PaiosDatabase, date: string, projectId?: string | null): string | null {
  const blocked = agentProjectAdvancementBlocked(database, date);
  if (blocked) return blocked;
  if (!projectId) return null;
  const project = database.prepare("SELECT status FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId) as { status?: string } | undefined;
  if (!project) return "关联项目不存在或已归档";
  if (project.status === "paused" || project.status === "abandoned") return PAUSED_PROJECT_ADVANCEMENT_ERROR;
  return null;
}

export function countTasksByExecutionPeriod(database: PaiosDatabase, periodStart: string, periodEnd: string) {
  return database.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS completed
     FROM tasks WHERE archived_at IS NULL AND due_date BETWEEN ? AND ?`
  ).get(periodStart, periodEnd) as { total: number; completed: number };
}

export function projectIdForMilestone(database: PaiosDatabase, milestoneId: string): string | null {
  const row = database.prepare("SELECT project_id FROM milestones WHERE id = ? AND archived_at IS NULL").get(milestoneId) as { project_id?: string } | undefined;
  return typeof row?.project_id === "string" ? row.project_id : null;
}

export function previousPeriodReview(database: PaiosDatabase, before: string) {
  return database.prepare("SELECT id, review_type, period_start, period_end, status, content_json, updated_at FROM reviews WHERE review_type = 'period' AND period_end < ? ORDER BY period_end DESC, created_at DESC LIMIT 1").get(before) as Record<string, unknown> | undefined;
}

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function buildAttentionSnapshot(database: PaiosDatabase, today: string, now = new Date()) {
  const timezone = getSetting(database, "timezone", "Asia/Shanghai");
  const hour = localHourInTimezone(timezone, now);
  const phase = timePhaseFromHour(hour);
  const overdue = listOverdueTasks(database, today);
  const undated = listUndatedTasks(database);
  const recurrences = inspectRecurrences(database, null, today).filter((item) => item.missing_count > 0 || item.status === "error" || item.last_error);
  const projects = projectPostures(database, today);
  const stage = currentStagePlan(database, today);
  const health = database.prepare("SELECT weight_kg, bedtime_local, wake_local, sleep_duration_minutes, exercise_note, exercise_minutes, disciplined FROM health_logs WHERE log_date = ?").get(today) as Record<string, unknown> | undefined;
  const missingHealth = {
    weight: health?.weight_kg == null,
    sleep: health?.bedtime_local == null || health?.wake_local == null,
    exercise: health?.exercise_note == null && (health?.exercise_minutes == null || Number(health.exercise_minutes) === 0),
    disciplined: health?.disciplined == null
  };
  const todayExpenses = (database.prepare("SELECT COUNT(*) AS count FROM finance_expenses WHERE occurred_date = ? AND archived_at IS NULL").get(today) as { count: number }).count;
  const pendingConfirmations = (database.prepare("SELECT COUNT(*) AS count FROM confirmation_tickets WHERE status = 'pending' AND expires_at > ?").get(now.toISOString()) as { count: number }).count;
  const items: string[] = [];
  if (overdue.length) items.push(`逾期任务 ${overdue.length} 条`);
  if (undated.length) items.push(`未安排执行日期的任务 ${undated.length} 条`);
  if (recurrences.length) items.push(`周期任务异常或漏生成 ${recurrences.length} 条`);
  const blocked = projects.filter((project) => project.posture === "blocked" || project.posture === "stalled");
  if (blocked.length) items.push(`项目阻塞或停滞 ${blocked.length} 个`);
  if (!stage) items.push("当前没有覆盖今天的阶段计划");
  else if (stage.status !== "confirmed") items.push("当前阶段计划仍是草稿，尚未确认方向");
  if (phase !== "morning" && todayExpenses === 0) items.push("今天还没有支出记录，若有消费请补记（这是提醒，不是断定漏记）");
  if (Object.values(missingHealth).some(Boolean) && phase !== "morning") items.push("今日健康记录不完整");
  if (pendingConfirmations) items.push(`待确认事项 ${pendingConfirmations} 条`);
  return {
    date: today,
    timezone,
    phase,
    phase_label: phase === "morning" ? "上午" : phase === "afternoon" ? "下午" : "晚上",
    next_phase_at: nextPhaseAt(timezone, now),
    closed_app_cannot_notify: true,
    overdue,
    undated,
    recurrences: recurrences.map((item) => ({ id: item.id, title: item.title, status: item.status, missing_count: item.missing_count, last_error: item.last_error })),
    projects,
    stage_plan: stage ? { id: stage.id, period_start: stage.period_start, period_end: stage.period_end, status: stage.status } : null,
    missing_health: missingHealth,
    today_expense_count: todayExpenses,
    pending_confirmations: pendingConfirmations,
    items,
    note: "软件关闭期间不能主动联系用户；重新打开后应再检查一次。"
  };
}

export function buildDailyPlanningContext(database: PaiosDatabase, date: string, today: string) {
  const openOnDate = listTasksOnExecutionDate(database, date).filter((task) => task.status !== "done" && task.status !== "cancelled");
  const classified = {
    urgent: openOnDate.filter((task) => task.band === "urgent"),
    important: openOnDate.filter((task) => task.band === "important"),
    secondary: openOnDate.filter((task) => task.band === "secondary")
  };
  const habits = inspectRecurrences(database, null, today).filter((item) => item.enabled && item.rule && (item.rule as { frequency?: string }).frequency === "daily");
  return {
    date,
    today,
    execution_date_field: "due_date",
    tasks_on_date: openOnDate,
    classified,
    overdue: listOverdueTasks(database, date),
    upcoming: listUpcomingTasks(database, date, shiftIsoDate(date, 7)).filter((task) => task.band !== "secondary"),
    undated: listUndatedTasks(database),
    habits: habits.map((item) => ({ id: item.id, title: item.title, next_occurrence_date: item.next_occurrence_date })),
    stage_plan: currentStagePlan(database, date) ?? currentStagePlan(database, today) ?? null,
    projects: projectPostures(database, today)
  };
}

export function buildStagePlanningContext(database: PaiosDatabase, periodStart: string, periodEnd: string, today: string) {
  const ideas = database.prepare("SELECT id, title, body, category, urgency, processed FROM ideas WHERE archived_at IS NULL ORDER BY urgency ASC, updated_at DESC LIMIT 100").all();
  const lastReview = previousPeriodReview(database, periodStart);
  const finance = database.prepare(
    `SELECT
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS expenses,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_incomes WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS incomes`
  ).get(periodStart, periodEnd, periodStart, periodEnd) as { expenses: number; incomes: number };
  const previousEnd = shiftIsoDate(periodStart, -1);
  const previousStart = shiftIsoDate(periodStart, -7);
  const previousFinance = database.prepare(
    `SELECT
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS expenses,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_incomes WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS incomes`
  ).get(previousStart, previousEnd, previousStart, previousEnd) as { expenses: number; incomes: number };
  const health = database.prepare("SELECT log_date, weight_kg, sleep_duration_minutes, exercise_minutes, disciplined FROM health_logs WHERE log_date BETWEEN ? AND ? ORDER BY log_date").all(previousStart, previousEnd);
  return {
    period_start: periodStart,
    period_end: periodEnd,
    today,
    ideas,
    previous_review: lastReview ? { id: lastReview.id, period_start: lastReview.period_start, period_end: lastReview.period_end, status: lastReview.status, content: parseJson(lastReview.content_json) } : null,
    finance_this_period: { expensesCents: finance.expenses, incomesCents: finance.incomes },
    finance_previous_week: { from: previousStart, to: previousEnd, expensesCents: previousFinance.expenses, incomesCents: previousFinance.incomes },
    health_previous_week: health,
    projects: projectPostures(database, today),
    overdue: listOverdueTasks(database, today),
    undated: listUndatedTasks(database),
    recurrences: inspectRecurrences(database, null, today).filter((item) => item.enabled).map((item) => ({ id: item.id, title: item.title, frequency: (item.rule as { frequency?: string } | null)?.frequency ?? null, next_occurrence_date: item.next_occurrence_date }))
  };
}

export function buildReviewFacts(database: PaiosDatabase, periodStart: string, periodEnd: string, today: string) {
  const tasksInPeriod = taskRows(database, `SELECT id, title, status, priority, due_date, recurrence_id, updated_at FROM tasks WHERE archived_at IS NULL AND due_date BETWEEN ? AND ? ORDER BY due_date ASC LIMIT 500`, [periodStart, periodEnd]);
  const completed = tasksInPeriod.filter((task) => task.status === "done");
  const cancelled = tasksInPeriod.filter((task) => task.status === "cancelled");
  const open = tasksInPeriod.filter((task) => task.status !== "done" && task.status !== "cancelled");
  const overdueAtEnd = taskRows(database, `SELECT id, title, status, priority, due_date FROM tasks WHERE archived_at IS NULL AND ${OPEN_TASK} AND due_date IS NOT NULL AND due_date < ? LIMIT 200`, [shiftIsoDate(periodEnd, 1)]);
  const finance = database.prepare(
    `SELECT
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS expenses,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_incomes WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS incomes,
      (SELECT COUNT(*) FROM finance_expenses WHERE occurred_date BETWEEN ? AND ? AND archived_at IS NULL) AS expense_count`
  ).get(periodStart, periodEnd, periodStart, periodEnd, periodStart, periodEnd) as { expenses: number; incomes: number; expense_count: number };
  const health = database.prepare("SELECT log_date, weight_kg, sleep_duration_minutes, exercise_minutes, disciplined FROM health_logs WHERE log_date BETWEEN ? AND ? ORDER BY log_date").all(periodStart, periodEnd) as Array<Record<string, unknown>>;
  const expectedHealthDays = dateCount(periodStart, periodEnd);
  const plans = database.prepare("SELECT plan_date, status, plan_text FROM daily_plans WHERE archived_at IS NULL AND plan_date BETWEEN ? AND ? ORDER BY plan_date").all(periodStart, periodEnd) as Array<Record<string, unknown>>;
  const stagePlans = database.prepare("SELECT id, period_start, period_end, status FROM period_plans WHERE archived_at IS NULL AND period_start <= ? AND period_end >= ?").all(periodEnd, periodStart);
  return {
    period_start: periodStart,
    period_end: periodEnd,
    as_of: today,
    execution_date_field: "due_date",
    tasks: {
      total: tasksInPeriod.length,
      completed: completed.length,
      cancelled: cancelled.length,
      open: open.length,
      overdue: overdueAtEnd.length,
      completed_titles: completed.map((task) => task.title),
      open_titles: open.map((task) => ({ title: task.title, due_date: task.due_date, status: task.status }))
    },
    finance: { expensesCents: finance.expenses, incomesCents: finance.incomes, expenseCount: finance.expense_count },
    health: {
      recorded_days: health.length,
      expected_days: expectedHealthDays,
      missing_dates: missingDates(periodStart, periodEnd, health.map((row) => String(row.log_date))),
      records: health
    },
    projects: projectPostures(database, today),
    plans: { daily: plans, stage: stagePlans },
    distinction: "以上是客观统计。睡眠、运动、消费和执行之间的关系最多只能写成可能相关，不能写成确定因果。"
  };
}

function dateCount(start: string, end: string): number {
  let count = 0;
  for (let date = start; date <= end; date = shiftIsoDate(date, 1)) count += 1;
  return count;
}

function missingDates(start: string, end: string, have: string[]): string[] {
  const set = new Set(have);
  const missing: string[] = [];
  for (let date = start; date <= end; date = shiftIsoDate(date, 1)) if (!set.has(date)) missing.push(date);
  return missing;
}

function cents(value: number): string {
  return `${(value / 100).toFixed(2)} 元`;
}

export function renderDailyPlanText(context: ReturnType<typeof buildDailyPlanningContext>): string {
  const spreadHabits = context.habits.map((item) => item.title);
  const morning = [...context.classified.urgent, ...context.classified.important.slice(0, 2)].map((task) => task.title);
  const afternoon = [...context.classified.important.slice(2), ...context.classified.secondary.slice(0, 3)].map((task) => task.title);
  const evening = context.classified.secondary.slice(3).map((task) => task.title);
  if (spreadHabits[0]) morning.push(`习惯：${spreadHabits[0]}`);
  if (spreadHabits[1]) afternoon.push(`习惯：${spreadHabits[1]}`);
  for (const habit of spreadHabits.slice(2)) evening.push(`习惯：${habit}`);
  if (!evening.length) evening.push("回顾当天执行情况，补记健康和必要消费");
  const lines = [
    `# ${context.date} 每日计划`,
    "",
    "任务日期 = 执行日期。下列任务按 due_date 读取。",
    "",
    "## 上午",
    ...(morning.length ? morning.map((item) => `- ${item}`) : ["- （当天上午暂无已排任务，确认逾期和无日期任务后再补）"]),
    "",
    "## 下午",
    ...(afternoon.length ? afternoon.map((item) => `- ${item}`) : ["- （下午待用户确认后安排）"]),
    "",
    "## 晚上",
    ...evening.map((item) => `- ${item}`),
    "",
    "## 需要用户确认",
    context.overdue.length ? `- 逾期任务：${context.overdue.map((task) => task.title).join("、")}` : "- 无逾期任务",
    context.undated.length ? `- 没有执行日期的任务：${context.undated.map((task) => task.title).join("、")}。是否需要安排？` : "- 没有未安排日期的任务",
    context.upcoming.length ? `- 之后 7 天的重要任务：${context.upcoming.map((task) => `${task.title}（${task.due_date}）`).join("、")}。是否提前或延期？` : "- 之后 7 天没有标记为紧急/重要的任务",
    "",
    "## 项目",
    ...context.projects.map((project) => `- ${project.name}：${project.label}。${project.reason}`),
    "",
    "## 调整记录",
    "- （执行过程中的调整写在这里，说明原因）"
  ];
  return lines.join("\n");
}

export function renderStagePlanText(context: ReturnType<typeof buildStagePlanningContext>): string {
  const ideaLines = (context.ideas as Array<{ title: string; urgency: number; processed: number }>).slice(0, 12).map((idea) => `- ${idea.title}（紧急程度 ${idea.urgency}${idea.processed ? "，已处理" : ""}）`);
  return [
    `# 阶段计划 ${context.period_start} 至 ${context.period_end}`,
    "",
    "## 阶段核心目标",
    "- 根据想法库、项目姿态和上阶段复盘填写本阶段最重要的 1–3 个方向。以下为待确认草案。",
    "",
    "## 财务安排",
    `- 上一周支出 ${cents(context.finance_previous_week.expensesCents)}，收入 ${cents(context.finance_previous_week.incomesCents)}。`,
    "- 本阶段财务安排需用户确认，不能把上一周支出当成必须重复的预算。",
    "",
    "## 健康目标",
    `- 上一周有 ${Array.isArray(context.health_previous_week) ? context.health_previous_week.length : 0} 天健康记录。`,
    "- 提出可执行的睡眠、运动、体重和自律目标，缺失的数据标为未知。",
    "",
    "## 各项目的阶段目标",
    ...context.projects.map((project) => `- ${project.name}（${project.label}）：${project.reason}`),
    "",
    "## 需要拆解的任务",
    "- 建设类项目拆为设计、开发、测试、验收；学习类先定目标再拆学习/练习/总结；停滞项目先写阻塞原因。",
    "",
    "## 周期性维护事项",
    ...(context.recurrences.length ? context.recurrences.map((item) => `- ${item.title}${item.frequency ? `（${item.frequency}）` : ""}`) : ["- 当前没有启用的周期模板"]),
    "",
    "## 风险、阻塞和需要用户确认的问题",
    context.overdue.length ? `- 逾期：${context.overdue.map((task) => task.title).join("、")}` : "- 无逾期任务",
    context.undated.length ? `- 未安排执行日期：${context.undated.map((task) => task.title).join("、")}` : "- 无未安排日期任务",
    "## 想法库（供判断是否值得执行）",
    ...(ideaLines.length ? ideaLines : ["- 想法库为空"]),
    context.previous_review ? `- 上阶段复盘：${context.previous_review.period_start} 至 ${context.previous_review.period_end}（${context.previous_review.status}）` : "- 没有找到上阶段复盘"
  ].join("\n");
}

export function renderReviewText(facts: ReturnType<typeof buildReviewFacts>, kind: "daily" | "period"): string {
  const title = kind === "daily" ? `每日复盘 ${facts.period_start}` : `阶段复盘 ${facts.period_start} 至 ${facts.period_end}`;
  return [
    `# ${title}`,
    "",
    "## 1. 客观数据统计",
    `- 任务：共 ${facts.tasks.total}，完成 ${facts.tasks.completed}，取消 ${facts.tasks.cancelled}，未完成 ${facts.tasks.open}，逾期 ${facts.tasks.overdue}。`,
    `- 财务：支出 ${cents(facts.finance.expensesCents)}，收入 ${cents(facts.finance.incomesCents)}，支出笔数 ${facts.finance.expenseCount}。没有记录不能写成“没花钱”，只能写“没有登记”。`,
    `- 健康：${facts.health.recorded_days}/${facts.health.expected_days} 天有记录。缺失日期：${facts.health.missing_dates.join("、") || "无"}。`,
    `- 项目：${facts.projects.map((project) => `${project.name}（${project.label}）`).join("、") || "无项目"}。`,
    `- 计划：每日计划 ${facts.plans.daily.length} 份。`,
    "",
    "## 2. 数据分析（推测必须标明）",
    "- 哪些安排有效：待写。只根据上面的事实。",
    "- 哪些任务反复延期：待写。",
    "- 是否任务安排过多：待写。",
    "- 睡眠、运动、消费和执行若看起来有关系，只能写“可能相关”，不能写成确定因果。",
    "- 哪些项目推进顺利，哪些停滞：待写。",
    "",
    "## 3. 后续建议",
    "- 第二天计划建议：",
    "- 下一阶段计划建议：",
    "- 任务拆分和调整建议：",
    "- 项目推进建议：",
    "- 周期任务建议：",
    "",
    facts.distinction
  ].join("\n");
}

export function emptyReviewAnalysis() {
  return {
    effective: [],
    repeated_deferrals: [],
    possible_overload: null,
    possible_relations: [],
    project_momentum: []
  };
}

export function upsertPeriodPlan(database: PaiosDatabase, periodStart: string, periodEnd: string, planText?: string) {
  const existing = database.prepare("SELECT * FROM period_plans WHERE period_start = ? AND period_end = ?").get(periodStart, periodEnd) as Record<string, unknown> | undefined;
  const today = localDateInTimezone(getSetting(database, "timezone", "Asia/Shanghai"));
  const text = planText ?? renderStagePlanText(buildStagePlanningContext(database, periodStart, periodEnd, today));
  const timestamp = new Date().toISOString();
  if (existing) {
    if (existing.archived_at) return { error: "该阶段计划已归档，管家不能恢复" };
    database.prepare("UPDATE period_plans SET plan_text = ?, updated_at = ? WHERE id = ?").run(text, timestamp, existing.id);
    return database.prepare("SELECT * FROM period_plans WHERE id = ?").get(existing.id) as Record<string, unknown>;
  }
  const id = randomUUID();
  database.prepare("INSERT INTO period_plans (id, period_start, period_end, plan_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', ?, ?)").run(id, periodStart, periodEnd, text, timestamp, timestamp);
  return database.prepare("SELECT * FROM period_plans WHERE id = ?").get(id) as Record<string, unknown>;
}

export function updateDailyPlanText(database: PaiosDatabase, date: string, planText: string, adjustmentReason?: string) {
  const current = database.prepare("SELECT * FROM daily_plans WHERE plan_date = ? AND archived_at IS NULL").get(date) as Record<string, unknown> | undefined;
  const timestamp = new Date().toISOString();
  let text = planText;
  if (adjustmentReason && adjustmentReason.trim()) {
    const stamp = `${date} ${timestamp.slice(11, 16)} ${adjustmentReason.trim()}`;
    text = planText.includes("## 调整记录")
      ? planText.replace("## 调整记录", `## 调整记录\n- ${stamp}`)
      : `${planText}\n\n## 调整记录\n- ${stamp}`;
  }
  if (!current) {
    const id = randomUUID();
    database.prepare("INSERT INTO daily_plans (id, plan_date, status, plan_text, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?)").run(id, date, text, timestamp, timestamp);
  } else {
    database.prepare("UPDATE daily_plans SET plan_text = ?, updated_at = ? WHERE id = ?").run(text, timestamp, current.id);
  }
  const plan = database.prepare("SELECT * FROM daily_plans WHERE plan_date = ?").get(date) as Record<string, unknown> | undefined;
  const items = plan
    ? database.prepare("SELECT i.id, i.task_id, i.sort_order, i.reason, i.completed, t.title, t.status, t.priority, t.due_date FROM daily_plan_items i INNER JOIN tasks t ON t.id = i.task_id WHERE i.plan_id = ? ORDER BY i.sort_order").all(plan.id)
    : [];
  return { plan: plan ?? null, items };
}

export function generatePeriodReviewDraft(database: PaiosDatabase, periodStart: string, periodEnd: string) {
  const existing = database.prepare("SELECT * FROM reviews WHERE review_type = 'period' AND period_start = ? AND period_end = ? ORDER BY created_at DESC LIMIT 1").get(periodStart, periodEnd) as Record<string, unknown> | undefined;
  if (existing?.status === "finalized") return existing;
  const today = localDateInTimezone(getSetting(database, "timezone", "Asia/Shanghai"));
  const facts = buildReviewFacts(database, periodStart, periodEnd, today);
  const current = parseJson(existing?.content_json);
  const content = {
    ...current,
    facts,
    analysis: current.analysis ?? emptyReviewAnalysis(),
    suggestions: current.suggestions ?? { next_day: "", next_period: "", task_split: "", project: "", recurrence: "" },
    checkpoints: current.checkpoints ?? [],
    text: typeof current.text === "string" && current.text.trim() ? current.text : renderReviewText(facts, "period")
  };
  const id = typeof existing?.id === "string" ? existing.id : randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO reviews (id, review_type, period_start, period_end, mode, status, content_json, created_at, updated_at)
     VALUES (?, 'period', ?, ?, 'data_first', 'draft', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at`
  ).run(id, periodStart, periodEnd, JSON.stringify(content), timestamp, timestamp);
  return database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Record<string, unknown>;
}

export function butlerPlanningPrompt(): string {
  return [
    "任务的 due_date 就是执行日期。读取今天/明天/某天任务时只按 due_date 过滤，不要把 scheduled_date 或其他日期概念当成执行日期。没有 due_date 的任务是未安排日期任务，必须询问用户是否安排。",
    "制定阶段计划前必须调用 planning_context_get（mode=stage）或分别读取想法、上阶段复盘、财务、健康、全部项目、逾期和未安排任务，然后用 period_plans_upsert 写成草案。草案至少包含：阶段核心目标、财务安排、健康目标、各项目阶段目标、需要拆解的任务、周期性维护事项、风险/阻塞/待确认问题。用户可在界面修改；确认阶段方向是界面操作，管家不能把阶段计划标为 confirmed。",
    "制定每日计划时读取目标执行日（通常是明天）的任务，按紧急(P0)/重要(P1)/次要(P2-P3)分类，读取逾期、此后一段时间的重要任务、未安排日期任务、阶段计划和项目姿态。安排上午/下午/晚上，把每日习惯分散到三个阶段。先问用户是否提前、延期或安排无日期任务，再写入 plans_update。",
    "不能只生成一次静态计划。当天执行变化时，可调整顺序、修改执行日期、拆分过大任务、在已确认阶段方向且用户授权的项目范围内补充任务、调整习惯，并用 plans_update 记录调整原因。",
    "每个时段结束做简短检查：完成/延期/取消、临时事项、可能未登记的消费、缺失健康数据、项目是否推进、是否调整后续任务。这些必须写入当日复盘草稿，不能只留在聊天里。",
    "复盘必须包含客观数据统计、数据分析、后续建议三部分，并区分事实和推测。可能的相关性不能说成因果。没有登记的消费或健康只能写没有记录。",
    "项目是阶段计划的执行引擎。读取项目后根据姿态选择策略：稳定维护以检查修复为主；学习型先定目标再拆学习/练习/总结；建设类拆设计/开发/测试/验收；停滞或阻塞先分析原因，禁止无意义加任务。",
    "服务端会拒绝未确认阶段计划时的项目推进：给任务关联项目、更新项目状态/工作区。创建空项目工作区、独立任务、财务、健康、计划和复盘草稿不需要先确认阶段计划。若当前日期落在已确认的阶段计划内，用户要求推进项目后，可以在该项目范围内创建/修改普通任务、修改执行日期、拆分任务、更新工作区、创建或更新周期模板、更新项目推进状态（idea/planned/active/done）、修改计划草稿和复盘草稿。周期实例仍由系统生成，管家不得自己计算发生日期。",
    "即使用户确认了阶段方向，也不能：删除任务或项目、归档/恢复/批量删除、把项目改为 paused 或 abandoned、大幅扩大项目范围或改核心方向、修改 API key/token/设置、批准确认票、修改已最终确认的复盘、恢复数据库。",
    "管家要主动检查逾期、未安排日期、周期任务、项目推进、阶段计划、可能未登记的消费、缺失健康数据和待确认事项。软件启动和重新打开后应补查。软件关闭期间不能承诺主动联系用户。",
    "优先使用 attention_get 和 planning_context_get 减少猜测。写入后回读。涉及已有记录尽量带 row_version。可能重试的写入必须带幂等键。"
  ].join("\n");
}
