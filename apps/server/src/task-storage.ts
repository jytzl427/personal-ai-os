import type { PaiosDatabase } from "@paios/db";
import { randomUUID } from "node:crypto";

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
