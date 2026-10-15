import { getSetting, type PaiosDatabase } from "@paios/db";
import { nextRecurrenceDate, normalizeRecurrenceRule, type RecurrenceRule } from "@paios/core";
import { createTaskRecurrenceSchema, patchTaskRecurrenceSchema, type CreateTaskRecurrence } from "@paios/api-types";
import { randomUUID } from "node:crypto";
import { localDateInTimezone } from "@paios/core";
import { markPausedOccurrences, runRecurrenceSync, type RecurrenceSyncResult } from "./recurrence.js";

const now = () => new Date().toISOString();

export type RecurrenceTemplatePatch = ReturnType<typeof patchTaskRecurrenceSchema.parse>;
export type RecurrenceTemplateCreate = CreateTaskRecurrence;

function flag(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  return value === true || value === 1 ? 1 : 0;
}

function readRule(value: unknown): RecurrenceRule | null {
  return normalizeRecurrenceRule(value);
}

function parseStoredRule(value: unknown): RecurrenceRule | null {
  try {
    return readRule(JSON.parse(String(value)));
  } catch {
    return null;
  }
}

function tomorrow(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function yesterday(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function validateDates(startDate: string, endDate: string | null): string | null {
  if (endDate && endDate < startDate) return "结束日期不能早于开始日期";
  return null;
}

function validateEnabled(enabled: number, title: string, rule: RecurrenceRule | null): string | null {
  if (enabled && !title.trim()) return "启用周期任务前必须填写任务名称";
  if (enabled && !rule) return "启用周期任务前必须填写完整周期规则";
  return null;
}

export function createRecurrenceTemplate(database: PaiosDatabase, raw: unknown): Record<string, unknown> | { error: string } {
  const parsed = createTaskRecurrenceSchema.safeParse(raw);
  if (!parsed.success) return { error: "周期模板参数无效" };
  const data = parsed.data;
  const rule = normalizeRecurrenceRule(data.rule);
  const enabled = flag(data.enabled, 0);
  const dateError = validateDates(data.start_date, data.end_date ?? null);
  const enabledError = validateEnabled(enabled, data.title_template, rule);
  if (dateError || enabledError || !rule) return { error: dateError ?? enabledError ?? "周期规则不完整" };
  const timezone = getSetting(database, "timezone", "Asia/Shanghai");
  const today = localDateInTimezone(timezone);
  const next = enabled ? nextRecurrenceDate(rule, data.start_date, today) : null;
  const id = randomUUID();
  const timestamp = now();
  const write = database.transaction(() => {
    database.prepare("INSERT INTO task_recurrences (id, title_template, description_template, content_template, rule_json, timezone, start_date, end_date, enabled, paused_from_date, next_occurrence_date, status, template_version, row_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'ok', 1, 1, ?, ?)").run(id, data.title_template.trim(), data.description_template, data.content_template, JSON.stringify(rule), timezone, data.start_date, data.end_date ?? null, enabled, enabled && next && data.end_date && next > data.end_date ? null : next, timestamp, timestamp);
    database.prepare("INSERT INTO task_recurrence_versions (id, recurrence_id, version, effective_from, effective_to, title_template, description_template, content_template, rule_json, schedule_anchor_date, created_at) VALUES (?, ?, 1, ?, NULL, ?, ?, ?, ?, ?, ?)").run(`${id}:v1`, id, data.start_date, data.title_template.trim(), data.description_template, data.content_template, JSON.stringify(rule), data.start_date, timestamp);
  });
  write();
  return database.prepare("SELECT * FROM task_recurrences WHERE id = ?").get(id) as Record<string, unknown>;
}

export function updateRecurrenceTemplate(
  database: PaiosDatabase,
  rawId: string,
  raw: unknown,
  syncBeforeUpdate?: () => RecurrenceSyncResult,
  todayOverride?: string
): Record<string, unknown> | { error: string } {
  const id = rawId;
  const current = database.prepare("SELECT * FROM task_recurrences WHERE id = ? AND status <> 'deleted'").get(id) as Record<string, unknown> | undefined;
  if (!current) return { error: "本地当前没有查到这个周期模板" };
  const parsed = patchTaskRecurrenceSchema.safeParse(raw);
  if (!parsed.success) return { error: "周期模板参数无效" };
  const data = parsed.data;
  if (data.row_version !== undefined && data.row_version !== Number(current.row_version)) return { error: "周期模板已被其他操作修改，请先重新读取" };
  const currentRule = parseStoredRule(current.rule_json);
  const rule = data.rule === undefined ? currentRule : normalizeRecurrenceRule(data.rule);
  if (!rule) return { error: "周期规则不完整" };
  const startDate = data.start_date ?? String(current.start_date);
  const endDate = data.end_date === undefined ? (current.end_date as string | null) : data.end_date;
  const enabled = flag(data.enabled, Number(current.enabled ?? 0));
  const title = data.title_template ?? String(current.title_template ?? "");
  const description = data.description_template ?? String(current.description_template ?? "");
  const content = data.content_template ?? String(current.content_template ?? "");
  const dateError = validateDates(startDate, endDate);
  const enabledError = validateEnabled(enabled, title, rule);
  if (dateError || enabledError) return { error: dateError ?? enabledError ?? "周期模板参数无效" };

  const currentRuleJson = String(current.rule_json);
  const nextRuleJson = JSON.stringify(rule);
  const materialChanged = title !== String(current.title_template ?? "") || description !== String(current.description_template ?? "") || content !== String(current.content_template ?? "") || startDate !== String(current.start_date) || endDate !== (current.end_date as string | null) || nextRuleJson !== currentRuleJson;
  const wasEnabled = Number(current.enabled ?? 0) === 1;
  const isPausing = wasEnabled && enabled === 0;
  const isResuming = !wasEnabled && enabled === 1;
  if ((materialChanged || isPausing) && wasEnabled) {
    const syncResult = syncBeforeUpdate?.();
    if (syncResult && (syncResult.lockResult === "busy" || syncResult.status !== "ok")) return { error: "周期同步未完成，本次模板修改已取消，请稍后重试" };
  }

  const timezone = getSetting(database, "timezone", "Asia/Shanghai");
  const today = todayOverride ?? localDateInTimezone(timezone);
  const currentVersion = Number(current.template_version ?? 1);
  const latestVersion = database.prepare("SELECT * FROM task_recurrence_versions WHERE recurrence_id = ? ORDER BY version DESC LIMIT 1").get(id) as Record<string, unknown> | undefined;
  const canEditFutureVersion = Boolean(materialChanged && wasEnabled && latestVersion && String(latestVersion.effective_from) > today);
  const latestVersionHasOccurrence = Boolean(latestVersion && database.prepare("SELECT 1 FROM task_recurrence_occurrences WHERE recurrence_id = ? AND template_version = ? LIMIT 1").get(id, Number(latestVersion.version)));
  const canEditUnmaterializedVersion = Boolean(materialChanged && !wasEnabled && latestVersion && !latestVersionHasOccurrence);
  const scheduleChanged = nextRuleJson !== currentRuleJson || startDate !== String(current.start_date);
  const hasMaterializedHistory = Boolean(latestVersionHasOccurrence);
  const effectiveFrom = materialChanged && (wasEnabled || hasMaterializedHistory)
    ? (startDate > tomorrow(today) ? startDate : tomorrow(today))
    : startDate;
  // Content/title/memo edits create a new template version but must keep the
  // original cadence. Only a rule or start-date change gets a new anchor.
  const scheduleAnchor = scheduleChanged
    ? effectiveFrom
    : String(latestVersion?.schedule_anchor_date ?? startDate);
  const next = enabled ? nextRecurrenceDate(rule, scheduleAnchor, today) : null;
  const editVersionInPlace = canEditFutureVersion || canEditUnmaterializedVersion;
  const version = editVersionInPlace ? Number(latestVersion?.version ?? currentVersion) : currentVersion + (materialChanged ? 1 : 0);
  const timestamp = now();
  const write = database.transaction(() => {
    if (isResuming && typeof current.paused_from_date === "string" && current.paused_from_date <= yesterday(today)) {
      markPausedOccurrences(database, id, current.paused_from_date, yesterday(today), true);
    }
    if (materialChanged) {
      if (editVersionInPlace) {
        database.prepare("UPDATE task_recurrence_versions SET effective_from = ?, title_template = ?, description_template = ?, content_template = ?, rule_json = ?, schedule_anchor_date = ? WHERE recurrence_id = ? AND version = ?").run(effectiveFrom, title, description, content, nextRuleJson, scheduleAnchor, id, version);
      } else {
        database.prepare("UPDATE task_recurrence_versions SET effective_to = ? WHERE recurrence_id = ? AND effective_to IS NULL").run(today, id);
        database.prepare("INSERT INTO task_recurrence_versions (id, recurrence_id, version, effective_from, effective_to, title_template, description_template, content_template, rule_json, schedule_anchor_date, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)").run(`${id}:v${version}`, id, version, effectiveFrom, title, description, content, nextRuleJson, scheduleAnchor, timestamp);
      }
    }
    const pausedFromDate = enabled ? null : (isPausing ? tomorrow(today) : current.paused_from_date ?? tomorrow(today));
    const result = database.prepare("UPDATE task_recurrences SET title_template = ?, description_template = ?, content_template = ?, rule_json = ?, timezone = ?, start_date = ?, end_date = ?, enabled = ?, paused_from_date = ?, next_occurrence_date = ?, status = 'ok', last_error = NULL, template_version = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ? AND status <> 'deleted'").run(title, description, content, nextRuleJson, timezone, startDate, endDate, enabled, pausedFromDate, endDate && next && next > endDate ? null : next, version, timestamp, id, current.row_version);
    if (result.changes !== 1) throw new Error("周期模板已被其他操作修改，请先重新读取");
  });
  try {
    write();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "周期模板更新失败" };
  }
  return database.prepare("SELECT * FROM task_recurrences WHERE id = ?").get(id) as Record<string, unknown>;
}

export function syncTemplateAfterWrite(database: PaiosDatabase, dataDir: string, recurrenceId: string, trigger: string) {
  const timezone = getSetting(database, "timezone", "Asia/Shanghai");
  return runRecurrenceSync(database, dataDir, timezone, getSetting(database, "backup.retain", 3), recurrenceId, trigger);
}

const recurrenceRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_RETRY_ATTEMPTS = 8;

function shouldRetrySync(result: RecurrenceSyncResult): boolean {
  return result.lockResult === "busy" || result.status === "partial" || result.status === "failed";
}

function retryDelay(database: PaiosDatabase, attempt: number): number {
  if (attempt === 1) return 250;
  if (attempt === 2) return 1000;
  if (attempt === 3) return 3000;
  try {
    const lock = database.prepare("SELECT lease_expires_at FROM task_recurrence_sync_lock WHERE lock_name = 'global'").get() as { lease_expires_at?: string | null } | undefined;
    const remaining = lock?.lease_expires_at ? Date.parse(lock.lease_expires_at) - Date.now() : 0;
    // A busy result is caused by the other process holding this lease. Waiting
    // for the lease is safer than exhausting short retries while the lock is
    // still valid. The extra quarter-second avoids a same-millisecond race.
    if (Number.isFinite(remaining) && remaining > 0) return remaining + 250;
  } catch {
    // Fall through to bounded exponential backoff if the lock row is not
    // readable (for example while the local database is closing).
  }
  return Math.min(30_000, 3_000 * 2 ** Math.max(0, attempt - 4));
}

type RecurrenceSyncAttempt = () => RecurrenceSyncResult;

function executeSyncAttempt(syncAttempt: RecurrenceSyncAttempt): RecurrenceSyncResult {
  try {
    return syncAttempt();
  } catch (error) {
    return {
      runId: `sync-error-${randomUUID()}`,
      status: "failed",
      generatedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      checkedAt: now(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function scheduleSyncRetry(database: PaiosDatabase, dataDir: string, recurrenceId: string, trigger: string, attempt: number, syncAttempt: RecurrenceSyncAttempt): void {
  if (attempt > MAX_RETRY_ATTEMPTS) return;
  const key = `${dataDir}:${recurrenceId || "__all__"}`;
  if (recurrenceRetryTimers.has(key)) return;
  const delay = retryDelay(database, attempt);
  const timer = setTimeout(() => {
    recurrenceRetryTimers.delete(key);
    try {
      const result = executeSyncAttempt(syncAttempt);
      if (shouldRetrySync(result)) scheduleSyncRetry(database, dataDir, recurrenceId, trigger, attempt + 1, syncAttempt);
    } catch {
      // The database may have been closed before an unref'ed retry fired.
      // Startup sync will inspect and repair all templates on the next launch.
    }
  }, delay);
  timer.unref?.();
  recurrenceRetryTimers.set(key, timer);
}

/**
 * Run a recurrence sync now and retry transient lock/error/partial results.
 * The fourth retry waits for the current SQLite lease to expire, so a short
 * competing sync cannot leave an occurrence missing merely because the UI
 * request returned before the other process finished.
 */
export function runRecurrenceSyncWithRetry(database: PaiosDatabase, dataDir: string, recurrenceId: string | undefined, trigger: string, todayOverride?: string): RecurrenceSyncResult {
  const syncAttempt = () => {
    const timezone = getSetting(database, "timezone", "Asia/Shanghai");
    return runRecurrenceSync(database, dataDir, timezone, getSetting(database, "backup.retain", 3), recurrenceId, trigger, todayOverride);
  };
  const result = executeSyncAttempt(syncAttempt);
  if (shouldRetrySync(result)) scheduleSyncRetry(database, dataDir, recurrenceId ?? "", trigger, 1, syncAttempt);
  return result;
}

export function syncTemplateAfterWriteWithRetry(database: PaiosDatabase, dataDir: string, recurrenceId: string, trigger: string): RecurrenceSyncResult {
  return runRecurrenceSyncWithRetry(database, dataDir, recurrenceId, trigger);
}
