import { createBackup, WEEKLY_BACKUP_RETAIN, type PaiosDatabase } from "@paios/db";
import { localDateInTimezone, nextRecurrenceDate, normalizeRecurrenceRule, recurrenceDatesThrough, type RecurrenceRule } from "@paios/core";
import { randomUUID } from "node:crypto";

const now = () => new Date().toISOString();
const BATCH_SIZE = 200;
const LOCK_NAME = "global";
const LOCK_LEASE_MS = 120_000;

type RecurrenceRow = {
  id: string;
  title_template: string;
  description_template: string;
  content_template: string;
  rule_json: string;
  timezone: string;
  start_date: string;
  end_date: string | null;
  enabled: number;
  paused_from_date: string | null;
  next_occurrence_date: string | null;
  last_checked_at: string | null;
  last_generated_at: string | null;
  status: string;
  last_error: string | null;
  template_version: number;
  row_version: number;
};

type RecurrenceVersionRow = {
  id: string;
  recurrence_id: string;
  version: number;
  effective_from: string;
  effective_to: string | null;
  title_template: string;
  description_template: string;
  content_template: string;
  rule_json: string;
  schedule_anchor_date: string;
};

type ExpectedOccurrence = { occurrenceDate: string; version: RecurrenceVersionRow };

export type RecurrenceInspection = {
  id: string;
  title: string;
  description_template: string;
  content_template: string;
  enabled: boolean;
  paused_from_date: string | null;
  rule: RecurrenceRule | null;
  start_date: string;
  end_date: string | null;
  next_occurrence_date: string | null;
  last_checked_at: string | null;
  last_generated_at: string | null;
  status: string;
  last_error: string | null;
  template_version: number;
  row_version: number;
  generated_count: number;
  missing_count: number;
  missing_dates: string[];
  orphaned_count: number;
};

export type RecurrenceSyncResult = {
  runId: string;
  status: "ok" | "partial" | "failed";
  generatedCount: number;
  skippedCount: number;
  errorCount: number;
  checkedAt: string;
  lockResult?: "acquired" | "busy";
  error?: string;
};

function parseRule(value: string): RecurrenceRule | null {
  try {
    return normalizeRecurrenceRule(JSON.parse(value));
  } catch {
    return null;
  }
}

function shiftDate(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function minDate(left: string, right: string): string {
  return left < right ? left : right;
}

function throughDate(row: RecurrenceRow, today: string): string | null {
  if (row.start_date > today) return null;
  if (row.end_date && row.end_date < row.start_date) return null;
  return row.end_date && row.end_date < today ? row.end_date : today;
}

function versionsFor(database: PaiosDatabase, row: RecurrenceRow): RecurrenceVersionRow[] {
  const versions = database.prepare("SELECT * FROM task_recurrence_versions WHERE recurrence_id = ? ORDER BY version ASC").all(row.id) as RecurrenceVersionRow[];
  if (versions.length > 0) return versions;
  const version = Number(row.template_version || 1);
  return [{
    id: `${row.id}:v${version}`,
    recurrence_id: row.id,
    version,
    effective_from: row.start_date,
    effective_to: null,
    title_template: row.title_template,
    description_template: row.description_template,
    content_template: row.content_template,
    rule_json: row.rule_json,
    schedule_anchor_date: row.start_date
  }];
}

function expectedOccurrences(database: PaiosDatabase, row: RecurrenceRow, today: string): ExpectedOccurrence[] {
  const through = throughDate(row, today);
  if (!through) return [];
  const result: ExpectedOccurrence[] = [];
  for (const version of versionsFor(database, row)) {
    const rule = parseRule(version.rule_json);
    if (!rule) throw new Error("周期规则无效");
    // The cadence is anchored at the original schedule date. A later template
    // version filters out older occurrences below, but must not restart the
    // cadence from its effective date when only content changes.
    const versionStart = version.schedule_anchor_date;
    let versionEnd = minDate(through, version.effective_to ?? through);
    if (row.end_date) versionEnd = minDate(versionEnd, row.end_date);
    if (versionStart > versionEnd) continue;
    const dates = recurrenceDatesThrough(rule, versionStart, versionEnd);
    for (const occurrenceDate of dates) {
      if (occurrenceDate >= version.effective_from && (!version.effective_to || occurrenceDate <= version.effective_to)) {
        result.push({ occurrenceDate, version });
      }
    }
  }
  result.sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate));
  return result;
}

function missingOccurrences(database: PaiosDatabase, row: RecurrenceRow, today: string): ExpectedOccurrence[] {
  const expected = expectedOccurrences(database, row, today);
  const existing = new Set((database.prepare("SELECT occurrence_date FROM task_recurrence_occurrences WHERE recurrence_id = ?").all(row.id) as Array<{ occurrence_date: string }>).map((item) => item.occurrence_date));
  return expected.filter((item) => !existing.has(item.occurrenceDate));
}

function nextDateForTemplate(database: PaiosDatabase, row: RecurrenceRow, today: string): string | null {
  const activeVersion = versionsFor(database, row).at(-1);
  if (!activeVersion) return null;
  const rule = parseRule(activeVersion.rule_json);
  if (!rule) return null;
  const next = nextRecurrenceDate(rule, activeVersion.schedule_anchor_date, today);
  if (!next || (row.end_date && next > row.end_date)) return null;
  return next;
}

function markError(database: PaiosDatabase, rowId: string, message: string, checkedAt: string): void {
  database.prepare("UPDATE task_recurrences SET status = 'error', last_error = ?, last_checked_at = ?, updated_at = ? WHERE id = ?").run(message.slice(0, 1000), checkedAt, checkedAt, rowId);
}

function acquireSyncLock(database: PaiosDatabase, owner: string, timestamp: string): boolean {
  const leaseExpires = new Date(Date.parse(timestamp) + LOCK_LEASE_MS).toISOString();
  let acquired = false;
  const acquire = database.transaction(() => {
    const current = database.prepare("SELECT owner_id, lease_expires_at FROM task_recurrence_sync_lock WHERE lock_name = ?").get(LOCK_NAME) as { owner_id: string | null; lease_expires_at: string | null } | undefined;
    const expired = !current?.lease_expires_at || Date.parse(current.lease_expires_at) <= Date.parse(timestamp);
    if (current?.owner_id && current.owner_id !== owner && !expired) return;
    database.prepare(
      "INSERT INTO task_recurrence_sync_lock (lock_name, owner_id, acquired_at, lease_expires_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(lock_name) DO UPDATE SET owner_id = excluded.owner_id, acquired_at = excluded.acquired_at, lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at"
    ).run(LOCK_NAME, owner, timestamp, leaseExpires, timestamp);
    acquired = true;
  });
  acquire();
  return acquired;
}

function renewSyncLock(database: PaiosDatabase, owner: string): void {
  const timestamp = now();
  const leaseExpires = new Date(Date.parse(timestamp) + LOCK_LEASE_MS).toISOString();
  const result = database.prepare("UPDATE task_recurrence_sync_lock SET lease_expires_at = ?, updated_at = ? WHERE lock_name = ? AND owner_id = ?").run(leaseExpires, timestamp, LOCK_NAME, owner);
  if (result.changes !== 1) throw new Error("周期同步锁已失效，本次同步已中止");
}

function isSyncLockLost(error: unknown): boolean {
  return error instanceof Error && error.message === "周期同步锁已失效，本次同步已中止";
}

function releaseSyncLock(database: PaiosDatabase, owner: string): void {
  database.prepare("UPDATE task_recurrence_sync_lock SET owner_id = NULL, acquired_at = NULL, lease_expires_at = NULL, updated_at = ? WHERE lock_name = ? AND owner_id = ?").run(now(), LOCK_NAME, owner);
}

export function inspectRecurrences(database: PaiosDatabase, id: string | null, today?: string): RecurrenceInspection[] {
  const rows = (id
    ? database.prepare("SELECT * FROM task_recurrences WHERE id = ? AND status <> 'deleted'").all(id)
    : database.prepare("SELECT * FROM task_recurrences WHERE status <> 'deleted' ORDER BY enabled DESC, next_occurrence_date IS NULL, next_occurrence_date ASC, created_at DESC").all()) as RecurrenceRow[];
  const currentDate = today ?? localDateInTimezone("Asia/Shanghai");
  return rows.map((row) => {
    const rule = parseRule(row.rule_json);
    let missing: ExpectedOccurrence[] = [];
    let status = row.status;
    if (rule) {
      try {
        missing = row.enabled ? missingOccurrences(database, row, currentDate) : [];
      } catch {
        status = "error";
      }
    } else {
      status = "error";
    }
    const generated = database.prepare("SELECT COUNT(*) AS count FROM task_recurrence_occurrences WHERE recurrence_id = ? AND outcome = 'generated'").get(row.id) as { count: number };
    const orphaned = database.prepare("SELECT COUNT(*) AS count FROM task_recurrence_occurrences o LEFT JOIN tasks t ON t.id = o.task_id WHERE o.recurrence_id = ? AND o.outcome = 'generated' AND (o.task_id IS NULL OR t.id IS NULL)").get(row.id) as { count: number };
    return {
      id: row.id,
      title: row.title_template,
      description_template: row.description_template,
      content_template: row.content_template,
      enabled: Boolean(row.enabled),
      paused_from_date: row.paused_from_date ?? null,
      rule,
      start_date: row.start_date,
      end_date: row.end_date,
      next_occurrence_date: row.enabled && rule ? nextDateForTemplate(database, row, currentDate) : null,
      last_checked_at: row.last_checked_at ?? null,
      last_generated_at: row.last_generated_at ?? null,
      status,
      last_error: row.last_error ?? null,
      template_version: Number(row.template_version || 1),
      row_version: Number(row.row_version || 1),
      generated_count: Number(generated.count || 0),
      missing_count: missing.length,
      missing_dates: missing.slice(0, 20).map((item) => item.occurrenceDate),
      orphaned_count: Number(orphaned.count || 0)
    };
  });
}

export function runRecurrenceSync(
  database: PaiosDatabase,
  dataDir: string,
  timezone: string,
  retainBackups = WEEKLY_BACKUP_RETAIN,
  onlyId?: string,
  triggerSource = "startup",
  todayOverride?: string
): RecurrenceSyncResult {
  const runId = randomUUID();
  const startedAt = now();
  const owner = `${process.pid}:${runId}`;
  if (!acquireSyncLock(database, owner, startedAt)) {
    const finishedAt = now();
    database.prepare("INSERT INTO task_recurrence_runs (id, started_at, finished_at, status, error_message, trigger_source, target_recurrence_id, lock_result) VALUES (?, ?, ?, 'ok', ?, ?, ?, 'busy')").run(runId, startedAt, finishedAt, "同步锁被占用，本次跳过；下一次启动或检查会继续。", triggerSource, onlyId ?? null);
    return { runId, status: "ok", generatedCount: 0, skippedCount: 0, errorCount: 0, checkedAt: finishedAt, lockResult: "busy" };
  }

  database.prepare("INSERT INTO task_recurrence_runs (id, started_at, status, trigger_source, target_recurrence_id, lock_result) VALUES (?, ?, 'running', ?, ?, 'acquired')").run(runId, startedAt, triggerSource, onlyId ?? null);
  let generatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];
  const today = todayOverride ?? localDateInTimezone(timezone);

  try {
    const rows = (onlyId
      ? database.prepare("SELECT * FROM task_recurrences WHERE id = ? AND enabled = 1 ORDER BY next_occurrence_date ASC").all(onlyId)
      : database.prepare("SELECT * FROM task_recurrences WHERE enabled = 1 ORDER BY next_occurrence_date ASC").all()) as RecurrenceRow[];
    const prepared: Array<{ row: RecurrenceRow; dates: ExpectedOccurrence[] }> = [];

    for (const row of rows) {
      try {
        prepared.push({ row, dates: missingOccurrences(database, row, today) });
      } catch (error) {
        errorCount += 1;
        const message = error instanceof Error ? error.message : "周期日期计算失败";
        errors.push(`${row.title_template || row.id}: ${message}`);
        markError(database, row.id, message, startedAt);
      }
    }

    const pendingCount = prepared.reduce((total, item) => total + item.dates.length, 0);
    if (pendingCount > 100) createBackup(database, dataDir, retainBackups);

    for (const item of prepared) {
      const { row, dates } = item;
      try {
        for (let offset = 0; offset < dates.length; offset += BATCH_SIZE) {
          renewSyncLock(database, owner);
          const batch = dates.slice(offset, offset + BATCH_SIZE);
          let batchGenerated = 0;
          let batchSkipped = 0;
          const writeBatch = database.transaction(() => {
            for (const itemDate of batch) {
              const existing = database.prepare("SELECT outcome FROM task_recurrence_occurrences WHERE recurrence_id = ? AND occurrence_date = ?").get(row.id, itemDate.occurrenceDate) as { outcome?: string } | undefined;
              if (existing) {
                batchSkipped += 1;
                continue;
              }
              const taskId = randomUUID();
              const timestamp = now();
              database.prepare(
                "INSERT INTO tasks (id, title, description, content, recurrence_id, recurrence_date, status, priority, due_date, archive_requested, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'todo', 'P2', ?, 0, ?, ?)"
              ).run(taskId, itemDate.version.title_template, itemDate.version.description_template, itemDate.version.content_template, row.id, itemDate.occurrenceDate, itemDate.occurrenceDate, timestamp, timestamp);
              database.prepare("INSERT INTO task_recurrence_occurrences (id, recurrence_id, occurrence_date, task_id, template_version, outcome, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'generated', ?, ?)").run(randomUUID(), row.id, itemDate.occurrenceDate, taskId, itemDate.version.version, timestamp, timestamp);
              batchGenerated += 1;
            }
          });
          writeBatch();
          generatedCount += batchGenerated;
          skippedCount += batchSkipped;
        }
        const timestamp = now();
        database.prepare("UPDATE task_recurrences SET next_occurrence_date = ?, last_checked_at = ?, last_generated_at = CASE WHEN ? > 0 THEN ? ELSE last_generated_at END, status = 'ok', last_error = NULL, updated_at = ? WHERE id = ?").run(nextDateForTemplate(database, row, today), timestamp, dates.length, timestamp, timestamp, row.id);
      } catch (error) {
        if (isSyncLockLost(error)) throw error;
        errorCount += 1;
        const message = error instanceof Error ? error.message : "周期任务生成失败";
        errors.push(`${row.title_template || row.id}: ${message}`);
        markError(database, row.id, message, startedAt);
      }
    }

    const finishedAt = now();
    const status: "ok" | "partial" | "failed" = errorCount === 0 ? "ok" : generatedCount > 0 ? "partial" : "failed";
    database.prepare("UPDATE task_recurrence_runs SET finished_at = ?, status = ?, generated_count = ?, skipped_count = ?, error_count = ?, error_message = ? WHERE id = ?").run(finishedAt, status, generatedCount, skippedCount, errorCount, errors.join("; ").slice(0, 2000) || null, runId);
    return { runId, status, generatedCount, skippedCount, errorCount, checkedAt: finishedAt, lockResult: "acquired" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "周期任务同步失败";
    errorCount += 1;
    errors.push(message);
    const finishedAt = now();
    database.prepare("UPDATE task_recurrence_runs SET finished_at = ?, status = 'failed', error_count = ?, error_message = ? WHERE id = ?").run(finishedAt, errorCount, errors.join("; ").slice(0, 2000), runId);
    return { runId, status: "failed", generatedCount, skippedCount, errorCount, checkedAt: finishedAt, lockResult: "acquired" };
  } finally {
    releaseSyncLock(database, owner);
  }
}

function markPausedOccurrencesWork(database: PaiosDatabase, recurrenceId: string, fromDate: string, throughDate: string): number {
  const row = database.prepare("SELECT * FROM task_recurrences WHERE id = ?").get(recurrenceId) as RecurrenceRow | undefined;
  if (!row || fromDate > throughDate) return 0;
  const expected = expectedOccurrences(database, row, throughDate).filter((item) => item.occurrenceDate >= fromDate && item.occurrenceDate <= throughDate);
  const insert = database.prepare("INSERT INTO task_recurrence_occurrences (id, recurrence_id, occurrence_date, task_id, template_version, outcome, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, 'skipped', ?, ?) ON CONFLICT(recurrence_id, occurrence_date) DO NOTHING");
  const timestamp = now();
  let count = 0;
  for (const item of expected) {
    const result = insert.run(randomUUID(), recurrenceId, item.occurrenceDate, item.version.version, timestamp, timestamp);
    count += result.changes;
  }
  return count;
}

/**
 * Mark the dates skipped while a template was paused. The optional flag is
 * used by template updates so the skipped rows and the optimistic row-version
 * write commit or roll back together.
 */
export function markPausedOccurrences(database: PaiosDatabase, recurrenceId: string, fromDate: string, throughDate: string, inTransaction = false): number {
  if (inTransaction) return markPausedOccurrencesWork(database, recurrenceId, fromDate, throughDate);
  return database.transaction(() => markPausedOccurrencesWork(database, recurrenceId, fromDate, throughDate))();
}
