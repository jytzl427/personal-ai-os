import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@paios/db";
import { createApp } from "./app.js";

type ApiBody = {
  ok?: boolean;
  task?: Record<string, unknown>;
  tasks?: Array<Record<string, unknown>>;
  idea?: Record<string, unknown>;
  ideas?: Array<Record<string, unknown>>;
};

async function callApi(app: ReturnType<typeof createApp>, path: string, method: "GET" | "POST" | "PATCH", body?: Record<string, unknown>) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await app.fetch(new Request(`http://paios.local${path}`, init));
  return { response, body: await response.json() as ApiBody };
}

function idOf(row: Record<string, unknown> | undefined): string {
  assert.ok(row && typeof row.id === "string");
  return row.id as string;
}

function versionOf(row: Record<string, unknown> | undefined): number {
  assert.ok(row && typeof row.row_version === "number");
  return row.row_version as number;
}

test("tasks expose new fields, sort by due date and auto-archive", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-tasks-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const older = await callApi(app, "/api/v1/tasks", "POST", { title: "旧任务", due_date: "2026-08-20" });
    assert.equal(older.response.status, 201);
    const newer = await callApi(app, "/api/v1/tasks", "POST", { title: "新任务", due_date: "2026-08-28", description: "备注" });
    assert.equal(newer.response.status, 201);

    const listed = await callApi(app, "/api/v1/tasks", "GET");
    assert.equal(listed.response.status, 200);
    assert.deepEqual(listed.body.tasks?.map((row) => row.title), ["旧任务", "新任务"]);
    assert.equal(listed.body.tasks?.[1]?.description, "备注");
    assert.equal(listed.body.tasks?.[1]?.archive_requested, 0);
    assert.equal(listed.body.tasks?.[1]?.archived_at, null);

    const dateFiltered = await callApi(app, "/api/v1/tasks?date=2026-08-28", "GET");
    assert.deepEqual(dateFiltered.body.tasks?.map((row) => row.title), ["新任务"]);
    const invalidDate = await callApi(app, "/api/v1/tasks?date=今天", "GET");
    assert.equal(invalidDate.response.status, 400);

    const created = await callApi(app, "/api/v1/tasks", "POST", { title: "待归档任务" });
    const taskId = idOf(created.body.task);
    let taskVersion = versionOf(created.body.task);
    const requested = await callApi(app, `/api/v1/tasks/${taskId}`, "PATCH", { archive_requested: true, row_version: taskVersion });
    assert.equal(requested.response.status, 200);
    assert.equal(requested.body.task?.archive_requested, 1);
    assert.equal(requested.body.task?.archived_at, null);
    taskVersion = versionOf(requested.body.task);

    const completed = await callApi(app, `/api/v1/tasks/${taskId}`, "PATCH", { status: "done", row_version: taskVersion });
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.task?.status, "done");
    assert.equal(typeof completed.body.task?.archived_at, "string");

    const activeAfterArchive = await callApi(app, "/api/v1/tasks", "GET");
    assert.equal(activeAfterArchive.body.tasks?.some((row) => row.id === taskId), false);
    const archived = await callApi(app, "/api/v1/tasks?archived=1", "GET");
    assert.equal(archived.body.tasks?.some((row) => row.id === taskId), true);

    const legacy = await callApi(app, "/api/v1/tasks", "POST", { title: "旧状态兼容", status: "doing" });
    assert.equal(legacy.response.status, 201);
    assert.equal(legacy.body.task?.status, "todo");

    const blank = await callApi(app, "/api/v1/tasks", "POST", { title: "" });
    assert.equal(blank.response.status, 201);
    assert.equal(blank.body.task?.title, "");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("ideas expose new fields, sort by urgency and auto-archive", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-ideas-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const low = await callApi(app, "/api/v1/ideas", "POST", { title: "低优先级", urgency: 3 });
    assert.equal(low.response.status, 201);
    const high = await callApi(app, "/api/v1/ideas", "POST", { title: "最高优先级", urgency: 1, category: "project", body: "项目灵感" });
    assert.equal(high.response.status, 201);
    const listed = await callApi(app, "/api/v1/ideas", "GET");
    assert.deepEqual(listed.body.ideas?.map((row) => row.title), ["最高优先级", "低优先级"]);
    assert.equal(listed.body.ideas?.[0]?.urgency, 1);
    assert.equal(listed.body.ideas?.[0]?.processed, 0);
    assert.equal(listed.body.ideas?.[0]?.archive_requested, 0);

    const created = await callApi(app, "/api/v1/ideas", "POST", { title: "待归档想法", category: "life" });
    const ideaId = idOf(created.body.idea);
    assert.equal(created.body.idea?.category, "short_term");
    let ideaVersion = versionOf(created.body.idea);
    const requested = await callApi(app, `/api/v1/ideas/${ideaId}`, "PATCH", { archive_requested: true, row_version: ideaVersion });
    assert.equal(requested.response.status, 200);
    assert.equal(requested.body.idea?.archived_at, null);
    ideaVersion = versionOf(requested.body.idea);

    const processed = await callApi(app, `/api/v1/ideas/${ideaId}`, "PATCH", { processed: true, row_version: ideaVersion });
    assert.equal(processed.response.status, 200);
    assert.equal(processed.body.idea?.processed, 1);
    assert.equal(typeof processed.body.idea?.archived_at, "string");

    const activeAfterArchive = await callApi(app, "/api/v1/ideas", "GET");
    assert.equal(activeAfterArchive.body.ideas?.some((row) => row.id === ideaId), false);
    const archived = await callApi(app, "/api/v1/ideas?archived=1", "GET");
    assert.equal(archived.body.ideas?.some((row) => row.id === ideaId), true);

    const urgentFour = await callApi(app, "/api/v1/ideas", "POST", { title: "四级紧急度", urgency: 4 });
    assert.equal(urgentFour.response.status, 201);
    assert.equal(urgentFour.body.idea?.urgency, 4);
    const invalid = await callApi(app, "/api/v1/ideas", "POST", { title: "非法紧急度", urgency: 5 });
    assert.equal(invalid.response.status, 400);

    const blank = await callApi(app, "/api/v1/ideas", "POST", { title: "" });
    assert.equal(blank.response.status, 201);
    assert.equal(blank.body.idea?.title, "");
    assert.equal(blank.body.idea?.urgency, 4);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
