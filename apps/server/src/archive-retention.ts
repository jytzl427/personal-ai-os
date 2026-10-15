import { ensureWeeklyBackup, getSetting, WEEKLY_BACKUP_RETAIN, type PaiosDatabase } from "@paios/db";
import { localDateInTimezone } from "@paios/core";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { recordAudit } from "./audit.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 180;
const DEFAULT_CLEANUP_INTERVAL_DAYS = 7;

type TaskCandidate = {
  id: string;
  recurrence_id: string | null;
  recurrence_date: string | null;
};

type IdCandidate = { id: string };

export type ArchiveRetentionResult = {
  status: "skipped" | "checked" | "cleaned" | "failed";
  reason?: "interval" | "no_candidates" | "backup_failed" | "error";
  checkedAt: string;
  cutoff: string;
  retentionDays: number;
  intervalDays: number;
  deleted?: {
    tasks: number;
    ideas: number;
    projects: number;
    project_task_plans: number;
    conversations: number;
    attachments: number;
    attachmentFiles: number;
  };
  backup?: { status: string; anchorDate: string };
  error?: string;
};

function positiveIntegerSetting(database: PaiosDatabase, key: string, fallback: number, maximum: number): number {
  const value = getSetting(database, key, fallback);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function setSetting(database: PaiosDatabase, key: string, value: unknown, timestamp: string): void {
  database.prepare(
    "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at"
  ).run(key, JSON.stringify(value), timestamp);
}

function safeDataFile(dataDir: string, relativePath: string): string | null {
  const root = resolve(dataDir);
  const candidate = resolve(root, relativePath);
  const prefix = root.endsWith("\\") ? root : root + "\\";
  if (candidate !== root && !candidate.startsWith(prefix)) return null;
  return candidate;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

/**
 * Remove only short-lived archived records. This is a system maintenance rule,
 * not an Agent tool: the UI invokes it after the initial attention snapshot.
 */
export async function runArchiveRetentionCleanup(options: {
  database: PaiosDatabase;
  dataDir: string;
  now?: Date;
}): Promise<ArchiveRetentionResult> {
  const { database, dataDir } = options;
  const current = options.now ?? new Date();
  const checkedAt = current.toISOString();
  const retentionDays = positiveIntegerSetting(database, "archive.purge_after_days", DEFAULT_RETENTION_DAYS, 3650);
  const intervalDays = positiveIntegerSetting(database, "archive.cleanup_interval_days", DEFAULT_CLEANUP_INTERVAL_DAYS, 365);
  const lastCleanupAt = getSetting(database, "archive.last_cleanup_at", null);
  const lastTimestamp = typeof lastCleanupAt === "string" ? Date.parse(lastCleanupAt) : Number.NaN;
  const cutoff = new Date(current.getTime() - retentionDays * DAY_MS).toISOString();

  if (Number.isFinite(lastTimestamp) && current.getTime() - lastTimestamp < intervalDays * DAY_MS) {
    return { status: "skipped", reason: "interval", checkedAt, cutoff, retentionDays, intervalDays };
  }

  const taskCandidates = database.prepare(
    "SELECT id, recurrence_id, recurrence_date FROM tasks WHERE archived_at IS NOT NULL AND archived_at < ? ORDER BY archived_at ASC"
  ).all(cutoff) as TaskCandidate[];
  const ideaCandidates = database.prepare(
    "SELECT id FROM ideas WHERE archived_at IS NOT NULL AND archived_at < ? ORDER BY archived_at ASC"
  ).all(cutoff) as IdCandidate[];
  const projectCandidates = database.prepare(
    "SELECT id FROM projects WHERE archived_at IS NOT NULL AND archived_at < ? ORDER BY archived_at ASC"
  ).all(cutoff) as IdCandidate[];
  const conversationCandidates = database.prepare(
    "SELECT id FROM conversations WHERE archived_at IS NOT NULL AND archived_at < ? ORDER BY archived_at ASC"
  ).all(cutoff) as IdCandidate[];
  const projectTaskPlanCandidates = database.prepare(
    "SELECT id FROM project_task_plans WHERE archived_at IS NOT NULL AND archived_at < ? ORDER BY archived_at ASC"
  ).all(cutoff) as IdCandidate[];

  const candidateCount = taskCandidates.length + ideaCandidates.length + projectCandidates.length + conversationCandidates.length + projectTaskPlanCandidates.length;
  if (candidateCount === 0) {
    setSetting(database, "archive.last_cleanup_at", checkedAt, checkedAt);
    return { status: "checked", reason: "no_candidates", checkedAt, cutoff, retentionDays, intervalDays };
  }

  const conversationIds = conversationCandidates.map((row) => row.id);
  const attachmentRows = conversationIds.length === 0
    ? []
    : database.prepare("SELECT relpath FROM attachments WHERE conversation_id IN (" + placeholders(conversationIds.length) + ")").all(...conversationIds) as Array<{ relpath: string }>;

  const timezone = String(getSetting(database, "timezone", "Asia/Shanghai"));
  const backupSetting = getSetting(database, "backup.retain", WEEKLY_BACKUP_RETAIN);
  const backupRetain = typeof backupSetting === "number" && Number.isInteger(backupSetting) ? backupSetting : WEEKLY_BACKUP_RETAIN;
  const backup = await ensureWeeklyBackup(
    database,
    dataDir,
    timezone,
    backupRetain,
    localDateInTimezone(timezone),
    true
  );
  if (backup.status === "failed") {
    return {
      status: "failed",
      reason: "backup_failed",
      checkedAt,
      cutoff,
      retentionDays,
      intervalDays,
      backup: { status: backup.status, anchorDate: backup.anchorDate },
      error: backup.error ?? "weekly backup failed"
    };
  }

  const deleted = database.transaction(() => {
    let tasks = 0;
    let ideas = 0;
    let projects = 0;
    let project_task_plans = 0;
    let conversations = 0;
    let attachments = 0;
    const timestamp = checkedAt;

    for (const plan of projectTaskPlanCandidates) {
      project_task_plans += database.prepare("DELETE FROM project_task_plans WHERE id = ? AND archived_at IS NOT NULL AND archived_at < ?").run(plan.id, cutoff).changes;
    }

    for (const task of taskCandidates) {
      database.prepare("DELETE FROM daily_plan_items WHERE task_id = ?").run(task.id);
      database.prepare("DELETE FROM task_project_links WHERE task_id = ?").run(task.id);
      database.prepare("DELETE FROM task_milestone_links WHERE task_id = ?").run(task.id);
      database.prepare("DELETE FROM task_dependencies WHERE blocked_task_id = ? OR blocking_task_id = ?").run(task.id, task.id);
      const result = database.prepare("DELETE FROM tasks WHERE id = ? AND archived_at IS NOT NULL AND archived_at < ?").run(task.id, cutoff);
      if (result.changes !== 1) continue;
      tasks += 1;
      if (task.recurrence_id && task.recurrence_date) {
        database.prepare(
          "INSERT INTO task_recurrence_occurrences (id, recurrence_id, occurrence_date, task_id, template_version, outcome, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, 'deleted', ?, ?) ON CONFLICT(recurrence_id, occurrence_date) DO UPDATE SET task_id = NULL, outcome = 'deleted', updated_at = excluded.updated_at"
        ).run(task.recurrence_id + ":" + task.recurrence_date + ":retention", task.recurrence_id, task.recurrence_date, timestamp, timestamp);
      }
    }

    for (const idea of ideaCandidates) {
      ideas += database.prepare("DELETE FROM ideas WHERE id = ? AND archived_at IS NOT NULL AND archived_at < ?").run(idea.id, cutoff).changes;
    }

    for (const project of projectCandidates) {
      database.prepare("UPDATE finance_expenses SET project_id = NULL WHERE project_id = ?").run(project.id);
      database.prepare("UPDATE finance_incomes SET project_id = NULL WHERE project_id = ?").run(project.id);
      database.prepare("DELETE FROM project_task_plans WHERE project_id = ?").run(project.id);
      database.prepare("DELETE FROM project_activity_logs WHERE project_id = ?").run(project.id);
      database.prepare("DELETE FROM task_project_links WHERE project_id = ?").run(project.id);
      database.prepare("DELETE FROM task_milestone_links WHERE milestone_id IN (SELECT id FROM milestones WHERE project_id = ?)").run(project.id);
      database.prepare("DELETE FROM milestones WHERE project_id = ?").run(project.id);
      database.prepare("DELETE FROM project_issues WHERE project_id = ?").run(project.id);
      database.prepare("DELETE FROM project_links WHERE project_id = ?").run(project.id);
      database.prepare("DELETE FROM project_workspaces WHERE project_id = ?").run(project.id);
      projects += database.prepare("DELETE FROM projects WHERE id = ? AND archived_at IS NOT NULL AND archived_at < ?").run(project.id, cutoff).changes;
    }

    for (const conversation of conversationCandidates) {
      attachments += database.prepare("DELETE FROM attachments WHERE conversation_id = ?").run(conversation.id).changes;
      database.prepare("DELETE FROM conversation_tool_calls WHERE conversation_id = ?").run(conversation.id);
      database.prepare("DELETE FROM conversation_messages WHERE conversation_id = ?").run(conversation.id);
      conversations += database.prepare("DELETE FROM conversations WHERE id = ? AND archived_at IS NOT NULL AND archived_at < ?").run(conversation.id, cutoff).changes;
    }

    setSetting(database, "archive.last_cleanup_at", timestamp, timestamp);
    return { tasks, ideas, projects, project_task_plans, conversations, attachments };
  })();

  let attachmentFiles = 0;
  for (const row of attachmentRows) {
    const path = typeof row.relpath === "string" ? safeDataFile(dataDir, row.relpath) : null;
    if (!path || !existsSync(path)) continue;
    try {
      unlinkSync(path);
      attachmentFiles += 1;
    } catch {
      // Database cleanup remains valid; an inaccessible file can be handled
      // separately without rolling back deleted records.
    }
  }

  recordAudit(database, {
    actor: "system",
    action: "archive.retention_cleanup",
    request: { retention_days: retentionDays, interval_days: intervalDays, cutoff, tables: ["tasks", "ideas", "projects", "project_task_plans", "conversations"] },
    after: { ...deleted, attachment_files: attachmentFiles },
    result: "ok"
  });

  return {
    status: "cleaned",
    checkedAt,
    cutoff,
    retentionDays,
    intervalDays,
    deleted: { ...deleted, attachmentFiles },
    backup: { status: backup.status, anchorDate: backup.anchorDate }
  };
}
