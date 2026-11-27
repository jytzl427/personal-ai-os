import type { PaiosDatabase } from "@paios/db";
import { randomUUID } from "node:crypto";
import { addProjectActivity, refreshParentTaskDueDate, syncProjectPlansForTodo } from "./project-service.js";

type NewTask = {
  title: string;
  description?: string;
  content?: string;
  status?: string;
  priority?: string;
  due_date?: string | null;
  scheduled_date?: string | null;
  estimate_minutes?: number | null;
  archive_requested?: number;
  parent_id?: string | null;
};

export function insertTask(database: PaiosDatabase, task: NewTask, timestamp: string): string {
  const id = randomUUID();
  database.prepare(
    "INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, estimate_minutes, archive_requested, parent_id, created_at, updated_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, task.title, task.description ?? "", task.content ?? "", task.status ?? "todo", task.priority ?? "P2",
    task.due_date ?? null, task.scheduled_date ?? null, task.estimate_minutes ?? null, task.archive_requested ?? 0, task.parent_id ?? null, timestamp, timestamp);
  return id;
}

export function updateLinkedCheckpoint(database: PaiosDatabase, taskId: string, update: { title?: string; due_date?: string | null }, timestamp: string): void {
  const checkpoint = database.prepare(
    "SELECT id, project_id, title, due_date FROM project_task_plans WHERE todo_task_id = ? AND archived_at IS NULL"
  ).get(taskId) as { id: string; project_id: string; title: string; due_date: string | null } | undefined;
  if (!checkpoint) return;
  const title = update.title ?? checkpoint.title;
  const dueDate = update.due_date === undefined ? checkpoint.due_date : update.due_date;
  database.prepare("UPDATE project_task_plans SET title = ?, due_date = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?")
    .run(title, dueDate, timestamp, checkpoint.id);
  addProjectActivity(database, checkpoint.project_id, "checkpoint_synced",
    "待办同步：更新验收节点「" + title + "」" + (dueDate ? "（截止 " + dueDate + "）" : ""),
    false, timestamp);
}

export function deleteStoredTask(database: PaiosDatabase, id: string, timestamp: string): boolean {
  return database.transaction(() => {
    const task = database.prepare("SELECT recurrence_id, recurrence_date, parent_id FROM tasks WHERE id = ?").get(id) as
      { recurrence_id: string | null; recurrence_date: string | null; parent_id: string | null } | undefined;
    if (!task) return false;
    syncProjectPlansForTodo(database, id, "removed", timestamp);
    database.prepare("DELETE FROM daily_plan_items WHERE task_id = ?").run(id);
    database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(id);
    database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(id);
    database.prepare("DELETE FROM task_dependencies WHERE blocked_task_id = ? OR blocking_task_id = ?").run(id, id);
    database.prepare("UPDATE tasks SET parent_id = NULL WHERE parent_id = ?").run(id);
    if (task.recurrence_id && task.recurrence_date) {
      database.prepare(
        "INSERT INTO task_recurrence_occurrences (id, recurrence_id, occurrence_date, task_id, template_version, outcome, created_at, updated_at) " +
        "VALUES (?, ?, ?, NULL, 1, 'deleted', ?, ?) ON CONFLICT(recurrence_id, occurrence_date) " +
        "DO UPDATE SET task_id = NULL, outcome = 'deleted', updated_at = excluded.updated_at"
      ).run(randomUUID(), task.recurrence_id, task.recurrence_date, timestamp, timestamp);
    }
    database.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    if (task.parent_id) refreshParentTaskDueDate(database, task.parent_id, timestamp);
    return true;
  })();
}
