import type { PaiosDatabase } from "@paios/db";
import { randomUUID } from "node:crypto";

export const PROJECT_TEMPLATES = [
  { id: "advancement", label: "推进项目", description: "阶段攻坚与开发落地，有明确交付物和完成条件。", default_goal: "明确交付物、完成条件和下一步动作。" },
  { id: "maintenance", label: "维护项目", description: "日常运营与持续经营，重点在资产收益、运营策略与低精力维护。", default_goal: "明确当前经营策略、收支底盘与维护节奏。" },
  { id: "long_term", label: "长期/大型项目", description: "适合长期建设、持续维护和逐步产生回报的项目。", default_goal: "明确长期方向、阶段目标和维护节奏。" },
  { id: "mid", label: "中型/阶段性项目", description: "适合学习、阶段建设和数周到数月完成的项目。", default_goal: "明确本阶段交付结果，并拆成可执行任务。" },
  { id: "small", label: "小型项目", description: "适合几天到几周完成的具体制作或实验。", default_goal: "明确交付物、完成条件和最小步骤。" }
] as const;

export function projectTemplate(category: string) {
  return PROJECT_TEMPLATES.find((item) => item.id === category) ?? PROJECT_TEMPLATES[1];
}

export type ProjectFinanceSummary = {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  income_count: number;
  expense_count: number;
};

export function projectFinanceSummary(database: PaiosDatabase, projectId: string): ProjectFinanceSummary {
  const row = database.prepare(`
    SELECT
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_incomes WHERE project_id = ? AND archived_at IS NULL) AS income_cents,
      (SELECT COALESCE(SUM(amount_cents), 0) FROM finance_expenses WHERE project_id = ? AND archived_at IS NULL) AS expense_cents,
      (SELECT COUNT(*) FROM finance_incomes WHERE project_id = ? AND archived_at IS NULL) AS income_count,
      (SELECT COUNT(*) FROM finance_expenses WHERE project_id = ? AND archived_at IS NULL) AS expense_count
  `).get(projectId, projectId, projectId, projectId) as Partial<ProjectFinanceSummary>;
  const income = Number(row.income_cents ?? 0);
  const expense = Number(row.expense_cents ?? 0);
  return { income_cents: income, expense_cents: expense, net_cents: income - expense, income_count: Number(row.income_count ?? 0), expense_count: Number(row.expense_count ?? 0) };
}

export function addProjectActivity(database: PaiosDatabase, projectId: string, kind: string, content: string, important = false, timestamp = new Date().toISOString()): void {
  if (!content.trim()) return;
  database.prepare("INSERT INTO project_activity_logs (id, project_id, kind, content, important, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(randomUUID(), projectId, kind, content.trim(), important ? 1 : 0, timestamp);
}

export function syncProjectPlansForTodo(database: PaiosDatabase, taskId: string, event: "completed" | "cancelled" | "removed" | "archived", timestamp = new Date().toISOString()): number {
  const rows = database.prepare(`
    SELECT p.id, p.project_id, p.title
    FROM project_task_plans p
    WHERE p.todo_task_id = ? AND p.archived_at IS NULL
  `).all(taskId) as Array<{ id: string; project_id: string; title: string }>;
  if (!rows.length) return 0;
  for (const row of rows) {
    if (event === "removed") {
      database.prepare("UPDATE project_task_plans SET todo_task_id = NULL, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(timestamp, row.id);
      addProjectActivity(database, row.project_id, "task_removed", `项目任务已从待办移除：${row.title}`, false, timestamp);
      continue;
    }
    const nextStatus = event === "cancelled" ? "cancelled" : "done";
    database.prepare("UPDATE project_task_plans SET status = ?, completed_at = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(
      nextStatus,
      nextStatus === "done" ? timestamp : null,
      timestamp,
      row.id
    );
    const kind = event === "completed" ? "task_completed" : event === "archived" ? "task_archived" : "task_cancelled";
    const label = event === "completed" ? "项目任务完成" : event === "archived" ? "关联待办已归档" : "项目任务取消";
    addProjectActivity(database, row.project_id, kind, `${label}：${row.title}`, event === "completed", timestamp);
  }
  return rows.length;
}

export function projectTaskPlans(database: PaiosDatabase, projectId: string) {
  return database.prepare(`
    SELECT * FROM project_task_plans
    WHERE project_id = ? AND archived_at IS NULL
    ORDER BY due_date IS NULL, due_date ASC, created_at ASC
  `).all(projectId);
}

export function projectActivities(database: PaiosDatabase, projectId: string, limit = 50) {
  return database.prepare(`
    SELECT * FROM project_activity_logs
    WHERE project_id = ? AND archived_at IS NULL
    ORDER BY created_at DESC LIMIT ?
  `).all(projectId, Math.max(1, Math.min(limit, 200)));
}

export function projectPlanningContext(database: PaiosDatabase, projectId: string) {
  return {
    planned_tasks: projectTaskPlans(database, projectId),
    finance: projectFinanceSummary(database, projectId),
    recent_activities: projectActivities(database, projectId, 20)
  };
}
