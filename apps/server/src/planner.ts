import { getSetting, type PaiosDatabase } from "@paios/db";
import { generateDailyPlan } from "@paios/core";
import { randomUUID } from "node:crypto";
import { buildDailyPlanningContext, renderDailyPlanText } from "./planning.js";

export type DailyPlanResult = {
  plan: Record<string, unknown> | null;
  items: unknown[];
};

export function readDailyPlan(database: PaiosDatabase, date: string): DailyPlanResult {
  const plan = database.prepare("SELECT * FROM daily_plans WHERE plan_date = ?").get(date) as Record<string, unknown> | undefined;
  if (!plan) return { plan: null, items: [] };
  const items = database.prepare(
    `SELECT i.id, i.task_id, i.sort_order, i.reason, i.completed, t.title, t.status, t.priority, t.due_date, t.scheduled_date
     FROM daily_plan_items i INNER JOIN tasks t ON t.id = i.task_id WHERE i.plan_id = ? ORDER BY i.sort_order`
  ).all(plan.id);
  return { plan, items };
}

export function generateDailyPlanForDate(database: PaiosDatabase, date: string): DailyPlanResult | { error: string } {
  const existing = database.prepare("SELECT * FROM daily_plans WHERE plan_date = ?").get(date) as { id: string; status: string } | undefined;
  if (existing?.status === "confirmed") return { error: "Confirmed plan cannot be overwritten" };
  const rawPreferences = getSetting(database, "schedule_pref", {}) as Record<string, unknown>;
  const preferences = {
    maxItems: typeof rawPreferences.max_items === "number" ? rawPreferences.max_items : 8,
    includeBlocked: rawPreferences.include_blocked === true,
    includeOverdueFirst: rawPreferences.include_overdue_first !== false,
    maxDeepWorkBlocks: typeof rawPreferences.max_deep_work_blocks === "number" ? rawPreferences.max_deep_work_blocks : 2
  };
  const candidates = database.prepare(
    `SELECT id, status, priority, due_date AS dueDate, scheduled_date AS scheduledDate, estimate_minutes AS estimateMinutes
     FROM tasks WHERE archived_at IS NULL AND status NOT IN ('done', 'cancelled') AND due_date IS NOT NULL AND due_date <= ?`
  ).all(date) as Array<{ id: string; status: string; priority: string; dueDate: string | null; scheduledDate: string | null; estimateMinutes: number | null }>;
  const selected = generateDailyPlan(candidates, date, preferences);
  const timestamp = new Date().toISOString();
  const currentText = existing ? String((database.prepare("SELECT plan_text FROM daily_plans WHERE plan_date = ?").get(date) as { plan_text?: string } | undefined)?.plan_text ?? "") : "";
  const suggestedText = currentText.trim() ? currentText : renderDailyPlanText(buildDailyPlanningContext(database, date, date));
  database.transaction(() => {
    const planId = existing?.id ?? randomUUID();
    database.prepare(
      `INSERT INTO daily_plans (id, plan_date, status, plan_text, generated_at, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?, ?, ?)
       ON CONFLICT(plan_date) DO UPDATE SET status = 'draft', generated_at = excluded.generated_at, plan_text = CASE WHEN daily_plans.plan_text IS NULL OR daily_plans.plan_text = '' THEN excluded.plan_text ELSE daily_plans.plan_text END, updated_at = excluded.updated_at`
    ).run(planId, date, suggestedText, timestamp, timestamp, timestamp);
    const activePlan = database.prepare("SELECT id FROM daily_plans WHERE plan_date = ?").get(date) as { id: string };
    database.prepare("DELETE FROM daily_plan_items WHERE plan_id = ?").run(activePlan.id);
    const insertItem = database.prepare("INSERT INTO daily_plan_items (id, plan_id, task_id, sort_order, reason) VALUES (?, ?, ?, ?, ?)");
    selected.forEach((taskId, index) => insertItem.run(randomUUID(), activePlan.id, taskId, index, "按执行日期和优先级排序"));
  })();
  return readDailyPlan(database, date);
}

