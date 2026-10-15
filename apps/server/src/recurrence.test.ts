import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase } from "@paios/db";
import { createApp } from "./app.js";
import { runRecurrenceSync } from "./recurrence.js";
import { createRecurrenceTemplate, runRecurrenceSyncWithRetry, updateRecurrenceTemplate } from "./recurrence-service.js";

function seedRecurrence(database: ReturnType<typeof openDatabase>, startDate: string, endDate: string, rule: object, title: string): string {
  const recurrenceId = randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare("INSERT INTO task_recurrences (id, title_template, description_template, content_template, rule_json, timezone, start_date, end_date, enabled, next_occurrence_date, status, template_version, created_at, updated_at) VALUES (?, ?, '', '', ?, 'Asia/Shanghai', ?, ?, 1, ?, 'ok', 1, ?, ?)").run(recurrenceId, title, JSON.stringify(rule), startDate, endDate, startDate, timestamp, timestamp);
  database.prepare("INSERT INTO task_recurrence_versions (id, recurrence_id, version, effective_from, title_template, description_template, content_template, rule_json, schedule_anchor_date, created_at) VALUES (?, ?, 1, ?, ?, '', '', ?, ?, ?)").run(`${recurrenceId}:v1`, recurrenceId, startDate, title, JSON.stringify(rule), startDate, timestamp);
  return recurrenceId;
}

test("startup recurrence sync fills calendar boundaries once and backs up large gaps", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-"));
  const database = openDatabase(dataDir);
  try {
    const monthly = seedRecurrence(database, "2024-01-31", "2024-03-31", { frequency: "monthly", interval: 1, day_of_month: 31 }, "月末任务");
    const yearly = seedRecurrence(database, "2024-02-29", "2026-02-28", { frequency: "yearly", interval: 1, month: 2, day_of_month: 29 }, "闰日任务");
    const first = runRecurrenceSync(database, dataDir, "Asia/Shanghai");
    assert.equal(first.status, "ok");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM task_recurrence_occurrences WHERE recurrence_id = ? AND outcome = 'generated'").get(monthly) as { count: number }).count, 3);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM task_recurrence_occurrences WHERE recurrence_id = ? AND outcome = 'generated'").get(yearly) as { count: number }).count, 3);
    const second = runRecurrenceSync(database, dataDir, "Asia/Shanghai");
    assert.equal(second.generatedCount, 0);

    const largeGap = seedRecurrence(database, "2025-01-01", "2026-08-30", { frequency: "daily", interval: 1 }, "大间隔任务");
    const third = runRecurrenceSync(database, dataDir, "Asia/Shanghai");
    assert.equal(third.status, "ok");
    assert.ok(existsSync(join(dataDir, "backups")));
    assert.ok(readdirSync(join(dataDir, "backups")).some((file) => file.endsWith(".db")));
    assert.ok((database.prepare("SELECT COUNT(*) AS count FROM task_recurrence_occurrences WHERE recurrence_id = ? AND outcome = 'generated'").get(largeGap) as { count: number }).count > 100);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("standalone template creates ordinary instances and future edits do not rewrite old instances", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-template-"));
  const database = openDatabase(dataDir);
  try {
    const created = createRecurrenceTemplate(database, {
      title_template: "旧模板名称",
      description_template: "旧备忘",
      content_template: "旧内容",
      start_date: "2026-09-01",
      rule: { frequency: "daily", interval: 1 },
      enabled: true
    });
    if ("error" in created) throw new Error(String(created.error));
    const recurrenceId = String(created.id);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ?").get(recurrenceId) as { count: number }).count, 0);
    runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, recurrenceId, "test", "2026-09-02");
    const before = database.prepare("SELECT recurrence_date, title, description, content FROM tasks WHERE recurrence_id = ? ORDER BY recurrence_date").all(recurrenceId) as Array<Record<string, string>>;
    assert.deepEqual(before.map((row) => row.recurrence_date), ["2026-09-01", "2026-09-02"]);

    const current = database.prepare("SELECT row_version FROM task_recurrences WHERE id = ?").get(recurrenceId) as { row_version: number };
    const updated = updateRecurrenceTemplate(database, recurrenceId, {
      title_template: "新模板名称",
      description_template: "新备忘",
      content_template: "新内容",
      enabled: true,
      row_version: current.row_version
    }, undefined, "2026-09-02");
    if ("error" in updated) throw new Error(String(updated.error));
    runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, recurrenceId, "test", "2026-09-03");
    const after = database.prepare("SELECT recurrence_date, title, description, content FROM tasks WHERE recurrence_id = ? ORDER BY recurrence_date").all(recurrenceId) as Array<Record<string, string>>;
    assert.equal(after.length, 3);
    assert.equal(after[0]?.title, "旧模板名称");
    assert.equal(after[1]?.content, "旧内容");
    assert.equal(after[2]?.title, "新模板名称");
    assert.equal(after[2]?.description, "新备忘");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("editing template content preserves the original recurrence cadence", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-cadence-"));
  const database = openDatabase(dataDir);
  try {
    const created = createRecurrenceTemplate(database, {
      title_template: "旧标题",
      description_template: "",
      content_template: "旧内容",
      start_date: "2026-09-01",
      rule: { frequency: "daily", interval: 2 },
      enabled: true
    });
    if ("error" in created) throw new Error(String(created.error));
    const recurrenceId = String(created.id);
    runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, recurrenceId, "test", "2026-09-03");
    const current = database.prepare("SELECT row_version FROM task_recurrences WHERE id = ?").get(recurrenceId) as { row_version: number };
    const updated = updateRecurrenceTemplate(database, recurrenceId, {
      title_template: "新标题",
      enabled: true,
      row_version: current.row_version
    }, undefined, "2026-09-03");
    if ("error" in updated) throw new Error(String(updated.error));
    runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, recurrenceId, "test", "2026-09-07");
    const tasks = database.prepare("SELECT recurrence_date, title FROM tasks WHERE recurrence_id = ? ORDER BY recurrence_date").all(recurrenceId) as Array<{ recurrence_date: string; title: string }>;
    assert.deepEqual(tasks.map((task) => task.recurrence_date), ["2026-09-01", "2026-09-03", "2026-09-05", "2026-09-07"]);
    assert.deepEqual(tasks.map((task) => task.title), ["旧标题", "旧标题", "新标题", "新标题"]);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("stale concurrent template update rolls back its version edit", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-stale-concurrent-"));
  const databaseA = openDatabase(dataDir);
  const databaseB = openDatabase(dataDir);
  try {
    const created = createRecurrenceTemplate(databaseA, {
      title_template: "初始标题",
      description_template: "",
      content_template: "",
      start_date: "2026-09-05",
      rule: { frequency: "daily", interval: 1 },
      enabled: true
    });
    if ("error" in created) throw new Error(String(created.error));
    const recurrenceId = String(created.id);
    const stale = databaseA.prepare("SELECT row_version FROM task_recurrences WHERE id = ?").get(recurrenceId) as { row_version: number };
    let updateB: Record<string, unknown> | { error: string } | undefined;
    const updateA = updateRecurrenceTemplate(databaseA, recurrenceId, {
      title_template: "请求A",
      enabled: true,
      row_version: stale.row_version
    }, () => {
      updateB = updateRecurrenceTemplate(databaseB, recurrenceId, {
        title_template: "请求B",
        enabled: true,
        row_version: stale.row_version
      }, undefined, "2026-09-03");
      return { runId: "test", status: "ok", generatedCount: 0, skippedCount: 0, errorCount: 0, checkedAt: new Date().toISOString() };
    }, "2026-09-03");
    if (!updateB || "error" in updateB) throw new Error("并发基准更新失败");
    if (!("error" in updateA)) throw new Error("过期更新不应成功");
    assert.match(String(updateA.error), /其他操作修改/);
    assert.equal((databaseA.prepare("SELECT title_template, row_version FROM task_recurrences WHERE id = ?").get(recurrenceId) as { title_template: string; row_version: number }).title_template, "请求B");
    assert.equal((databaseA.prepare("SELECT version, title_template FROM task_recurrence_versions WHERE recurrence_id = ? ORDER BY version DESC LIMIT 1").get(recurrenceId) as { version: number; title_template: string }).title_template, "请求B");
  } finally {
    databaseB.close();
    databaseA.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("template updates reject a partial pre-sync", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-partial-update-"));
  const database = openDatabase(dataDir);
  try {
    const created = createRecurrenceTemplate(database, {
      title_template: "原模板",
      description_template: "",
      content_template: "",
      start_date: "2026-09-01",
      rule: { frequency: "daily", interval: 1 },
      enabled: true
    });
    if ("error" in created) throw new Error(String(created.error));
    const recurrenceId = String(created.id);
    const current = database.prepare("SELECT row_version FROM task_recurrences WHERE id = ?").get(recurrenceId) as { row_version: number };
    const updated = updateRecurrenceTemplate(database, recurrenceId, {
      title_template: "不应写入",
      enabled: false,
      row_version: current.row_version
    }, () => ({ runId: "partial", status: "partial", generatedCount: 1, skippedCount: 0, errorCount: 1, checkedAt: new Date().toISOString(), lockResult: "acquired" }), "2026-09-03");
    assert.ok("error" in updated);
    assert.match(String(updated.error), /同步未完成/);
    const unchanged = database.prepare("SELECT title_template, enabled, row_version FROM task_recurrences WHERE id = ?").get(recurrenceId) as { title_template: string; enabled: number; row_version: number };
    assert.equal(unchanged.title_template, "原模板");
    assert.equal(unchanged.enabled, 1);
    assert.equal(unchanged.row_version, current.row_version);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("deleted generated instance is recorded and never regenerated", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-delete-"));
  const database = openDatabase(dataDir);
  try {
    const recurrenceId = seedRecurrence(database, "2026-09-01", "2026-09-04", { frequency: "daily", interval: 1 }, "可删除实例");
    runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, recurrenceId, "test", "2026-09-02");
    const task = database.prepare("SELECT id, recurrence_date FROM tasks WHERE recurrence_id = ? AND recurrence_date = '2026-09-01'").get(recurrenceId) as { id: string; recurrence_date: string };
    const timestamp = new Date().toISOString();
    const remove = database.transaction(() => {
      database.prepare("UPDATE task_recurrence_occurrences SET task_id = NULL, outcome = 'deleted', updated_at = ? WHERE recurrence_id = ? AND occurrence_date = ?").run(timestamp, recurrenceId, task.recurrence_date);
      database.prepare("DELETE FROM tasks WHERE id = ?").run(task.id);
    });
    remove();
    runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, recurrenceId, "test", "2026-09-04");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ? AND recurrence_date = '2026-09-01'").get(recurrenceId) as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT outcome FROM task_recurrence_occurrences WHERE recurrence_id = ? AND occurrence_date = '2026-09-01'").get(recurrenceId) as { outcome: string }).outcome, "deleted");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("recurrence sync respects the shared lease lock", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-lock-"));
  const database = openDatabase(dataDir);
  try {
    const timestamp = new Date().toISOString();
    const lease = new Date(Date.now() + 60_000).toISOString();
    database.prepare("UPDATE task_recurrence_sync_lock SET owner_id = 'other-process', acquired_at = ?, lease_expires_at = ?, updated_at = ? WHERE lock_name = 'global'").run(timestamp, lease, timestamp);
    const result = runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, undefined, "test", "2026-09-02");
    assert.equal(result.lockResult, "busy");
    assert.equal((database.prepare("SELECT lock_result FROM task_recurrence_runs WHERE id = ?").get(result.runId) as { lock_result: string }).lock_result, "busy");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("recurrence sync stops immediately when it loses the lease", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-lock-loss-"));
  const database = openDatabase(dataDir);
  try {
    const first = seedRecurrence(database, "2025-01-01", "2026-10-01", { frequency: "daily", interval: 1 }, "先处理模板");
    const second = seedRecurrence(database, "2025-01-02", "2026-10-01", { frequency: "daily", interval: 1 }, "不应继续处理");
    database.exec("CREATE TRIGGER test_steal_recurrence_lease AFTER INSERT ON tasks BEGIN UPDATE task_recurrence_sync_lock SET owner_id = 'other-process'; END");
    const result = runRecurrenceSync(database, dataDir, "Asia/Shanghai", 3, undefined, "test", "2026-10-01");
    assert.equal(result.status, "failed");
    assert.ok(result.generatedCount > 0);
    assert.ok(result.generatedCount < 639);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ?").get(second) as { count: number }).count, 0);
    assert.equal((database.prepare("SELECT owner_id FROM task_recurrence_sync_lock WHERE lock_name = 'global'").get() as { owner_id: string }).owner_id, "other-process");
    assert.ok((database.prepare("SELECT status FROM task_recurrence_runs WHERE id = ?").get(result.runId) as { status: string }).status === "failed");
    assert.ok((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ?").get(first) as { count: number }).count > 0);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("recurrence sync retries after a competing lease expires", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-retry-"));
  const database = openDatabase(dataDir);
  try {
    const created = createRecurrenceTemplate(database, {
      title_template: "租约重试任务",
      description_template: "",
      content_template: "",
      start_date: "2026-09-03",
      rule: { frequency: "daily", interval: 1 },
      enabled: true
    });
    if ("error" in created) throw new Error(String(created.error));
    const recurrenceId = String(created.id);
    const timestamp = new Date().toISOString();
    const lease = new Date(Date.now() + 700).toISOString();
    database.prepare("UPDATE task_recurrence_sync_lock SET owner_id = 'other-process', acquired_at = ?, lease_expires_at = ?, updated_at = ? WHERE lock_name = 'global'").run(timestamp, lease, timestamp);
    const immediate = runRecurrenceSyncWithRetry(database, dataDir, recurrenceId, "retry_test", "2026-09-03");
    assert.equal(immediate.lockResult, "busy");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ? AND recurrence_date = '2026-09-03'").get(recurrenceId) as { count: number }).count, 1);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("deleting a recurrence template stops future generation and preserves generated tasks", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-recurrence-template-delete-"));
  const database = openDatabase(dataDir);
  try {
    const created = createRecurrenceTemplate(database, {
      title_template: "保留实例的模板",
      description_template: "",
      content_template: "",
      start_date: "2026-09-01",
      rule: { frequency: "daily", interval: 1 },
      enabled: true
    });
    if ("error" in created) throw new Error(String(created.error));
    const recurrenceId = String(created.id);
    runRecurrenceSync(database, dataDir, "Asia/Shanghai", 14, recurrenceId, "test", "2026-09-01");
    const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
    const sessionResponse = await app.fetch(new Request("http://paios.local/api/v1/system/ui-session"));
    const session = (await sessionResponse.json() as { session: string }).session;
    const response = await app.fetch(new Request(`http://paios.local/api/v1/task-recurrences/${recurrenceId}`, { method: "DELETE", headers: { "X-PAIOS-UI-Session": session } }));
    assert.equal(response.status, 200);
    const deleted = database.prepare("SELECT status, enabled, row_version FROM task_recurrences WHERE id = ?").get(recurrenceId) as { status: string; enabled: number; row_version: number };
    assert.equal(deleted.status, "deleted");
    assert.equal(deleted.enabled, 0);
    assert.equal(deleted.row_version, 2);
    assert.ok((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ?").get(recurrenceId) as { count: number }).count >= 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM task_recurrences WHERE status <> 'deleted'").get() as { count: number }).count, 0);
    const stalePatch = await app.fetch(new Request(`http://paios.local/api/v1/task-recurrences/${recurrenceId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-PAIOS-UI-Session": session },
      body: JSON.stringify({ title_template: "不应复活", enabled: true, row_version: 1 })
    }));
    assert.equal(stalePatch.status, 404);
    assert.equal((database.prepare("SELECT status, title_template FROM task_recurrences WHERE id = ?").get(recurrenceId) as { status: string; title_template: string }).status, "deleted");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("direct MCP blocks requests while a restore is pending", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-direct-mcp-restore-"));
  const database = openDatabase(dataDir);
  try {
    const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 }, directMcp: true });
    writeFileSync(join(dataDir, "restore.pending.db"), "pending restore marker");
    const token = readFileSync(join(dataDir, "mcp-token.txt"), "utf8").trim();
    const response = await app.fetch(new Request("http://paios.local/api/v1/system/status", {
      headers: { Authorization: `Bearer ${token}`, "X-PAIOS-Agent-Transport": "mcp" }
    }));
    assert.equal(response.status, 409);
    const body = await response.json() as { error?: { code?: string } };
    assert.equal(body.error?.code, "PENDING_RESTORE_REQUIRES_RESTART");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
