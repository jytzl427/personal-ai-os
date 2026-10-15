import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBackupValid, openDatabase } from "@paios/db";
import { createApp } from "./app.js";
import { runArchiveRetentionCleanup } from "./archive-retention.js";

const NOW = new Date("2026-09-07T00:00:00.000Z");
const OLD_ARCHIVE = "2026-01-01T00:00:00.000Z";
const RECENT_ARCHIVE = "2026-08-01T00:00:00.000Z";

test("archive retention cleans only short-lived records after the seven-day interval", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-archive-retention-"));
  const database = openDatabase(dataDir);
  try {
    database.prepare("UPDATE app_settings SET value_json = ? WHERE key = 'archive.last_cleanup_at'").run(JSON.stringify("2026-08-29T00:00:00.000Z"));
    database.prepare("INSERT INTO tasks (id, title, status, recurrence_id, recurrence_date, created_at, updated_at, archived_at) VALUES ('old-task', '旧任务', 'done', 'recurrence-1', '2026-01-01', ?, ?, ?)").run(OLD_ARCHIVE, OLD_ARCHIVE, OLD_ARCHIVE);
    database.prepare("INSERT INTO tasks (id, title, status, created_at, updated_at, archived_at) VALUES ('recent-task', '近期任务', 'done', ?, ?, ?)").run(RECENT_ARCHIVE, RECENT_ARCHIVE, RECENT_ARCHIVE);
    database.prepare("INSERT INTO ideas (id, title, created_at, updated_at, archived_at) VALUES ('old-idea', '旧想法', ?, ?, ?)").run(OLD_ARCHIVE, OLD_ARCHIVE, OLD_ARCHIVE);
    database.prepare("INSERT INTO projects (id, name, created_at, updated_at, archived_at) VALUES ('old-project', '长期项目', ?, ?, ?)").run(OLD_ARCHIVE, OLD_ARCHIVE, OLD_ARCHIVE);
    database.prepare("INSERT INTO project_task_plans (id, project_id, title, status, created_at, updated_at, archived_at) VALUES ('old-project-task', 'live-project', '旧项目任务', 'done', ?, ?, ?)").run(OLD_ARCHIVE, OLD_ARCHIVE, OLD_ARCHIVE);
    database.prepare("INSERT INTO project_task_plans (id, project_id, title, status, created_at, updated_at, archived_at) VALUES ('recent-project-task', 'live-project', '近期项目任务', 'done', ?, ?, ?)").run(RECENT_ARCHIVE, RECENT_ARCHIVE, RECENT_ARCHIVE);
    database.prepare("INSERT INTO conversations (id, title, created_at, updated_at, archived_at) VALUES ('old-conversation', '旧对话', ?, ?, ?)").run(OLD_ARCHIVE, OLD_ARCHIVE, OLD_ARCHIVE);
    database.prepare("INSERT INTO conversation_messages (id, conversation_id, role, content_text, created_at) VALUES ('old-message', 'old-conversation', 'user', '旧内容', ?)").run(OLD_ARCHIVE);
    database.prepare("INSERT INTO conversation_tool_calls (id, conversation_id, tool_name, status, created_at) VALUES ('old-tool-call', 'old-conversation', 'tasks_list', 'ok', ?)").run(OLD_ARCHIVE);
    mkdirSync(join(dataDir, "attachments"), { recursive: true });
    writeFileSync(join(dataDir, "attachments", "old.txt"), "old attachment");
    database.prepare("INSERT INTO attachments (id, conversation_id, filename, mime, byte_size, relpath, created_at) VALUES ('old-attachment', 'old-conversation', 'old.txt', 'text/plain', 14, 'attachments/old.txt', ?)").run(OLD_ARCHIVE);

    const result = await runArchiveRetentionCleanup({ database, dataDir, now: NOW });
    assert.equal(result.status, "cleaned");
    assert.deepEqual(result.deleted, { tasks: 1, ideas: 1, projects: 1, project_task_plans: 1, conversations: 1, attachments: 1, attachmentFiles: 1 });
    assert.equal(database.prepare("SELECT 1 FROM tasks WHERE id = 'old-task'").get(), undefined);
    assert.ok(database.prepare("SELECT 1 FROM tasks WHERE id = 'recent-task'").get());
    assert.equal(database.prepare("SELECT 1 FROM projects WHERE id = 'old-project'").get(), undefined);
    assert.equal(database.prepare("SELECT 1 FROM project_task_plans WHERE id = 'old-project-task'").get(), undefined);
    assert.ok(database.prepare("SELECT 1 FROM project_task_plans WHERE id = 'recent-project-task'").get());
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id = 'old-conversation'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM conversation_tool_calls WHERE conversation_id = 'old-conversation'").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM task_recurrence_occurrences WHERE recurrence_id = 'recurrence-1' AND occurrence_date = '2026-01-01' AND outcome = 'deleted'").get().count, 1);
    assert.equal(existsSync(join(dataDir, "attachments", "old.txt")), false);
    assert.equal(database.prepare("SELECT value_json FROM app_settings WHERE key = 'archive.last_cleanup_at'").get().value_json, JSON.stringify(NOW.toISOString()));

    const backups = readdirSync(join(dataDir, "backups")).filter((file) => file.endsWith(".db"));
    assert.ok(backups.length >= 1);
    assert.ok(backups.every((file) => isBackupValid(join(dataDir, "backups", file))));

    database.prepare("INSERT INTO tasks (id, title, status, created_at, updated_at, archived_at) VALUES ('interval-task', '间隔内任务', 'done', ?, ?, ?)").run(OLD_ARCHIVE, OLD_ARCHIVE, OLD_ARCHIVE);
    const skipped = await runArchiveRetentionCleanup({ database, dataDir, now: new Date("2026-09-08T00:00:00.000Z") });
    assert.equal(skipped.status, "skipped");
    assert.ok(database.prepare("SELECT 1 FROM tasks WHERE id = 'interval-task'").get());

    const nextRun = await runArchiveRetentionCleanup({ database, dataDir, now: new Date("2026-09-16T00:00:00.000Z") });
    assert.equal(nextRun.status, "cleaned");
    assert.equal(database.prepare("SELECT 1 FROM tasks WHERE id = 'interval-task'").get(), undefined);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("archive retention endpoint is UI-only and does not expose deletion to Agents", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-archive-retention-route-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const agentAttempt = await app.fetch(new Request("http://paios.local/api/v1/system/archive-retention/check", { method: "POST", headers: { Authorization: "Bearer invalid" } }));
    assert.equal(agentAttempt.status, 401);
    const sessionResponse = await app.fetch(new Request("http://paios.local/api/v1/system/ui-session"));
    const session = (await sessionResponse.json() as { session: string }).session;
    const uiAttempt = await app.fetch(new Request("http://paios.local/api/v1/system/archive-retention/check", { method: "POST", headers: { "X-PAIOS-UI-Session": session } }));
    assert.equal(uiAttempt.status, 200);
    assert.equal((await uiAttempt.json() as { cleanup: { status: string } }).cleanup.status, "checked");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
