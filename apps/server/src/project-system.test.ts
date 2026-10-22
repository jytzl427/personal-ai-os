import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@paios/db";
import { createApp } from "./app.js";

async function request(app: ReturnType<typeof createApp>, path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  const response = await app.fetch(new Request(`http://paios.local${path}`, { method, headers: { "Content-Type": "application/json", ...extraHeaders }, body: body ? JSON.stringify(body) : undefined }));
  return { response, body: await response.json() as Record<string, any> };
}

test("profitable projects create dynamic finance links and project task plans sync with todos", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-project-system-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const created = await request(app, "/api/v1/projects", "POST", { name: "测试项目", category: "mid", benefit_enabled: true });
    assert.equal(created.response.status, 201);
    const projectId = created.body.project.id as string;

    const buttons = await request(app, "/api/v1/finance/quick-buttons", "GET");
    const button = buttons.body.quick_buttons.find((item: Record<string, unknown>) => item.project_id === projectId && item.kind === "income");
    const expenseButton = buttons.body.quick_buttons.find((item: Record<string, unknown>) => item.project_id === projectId && item.kind === "expense");
    assert.equal(button.category_major, "项目收入");
    assert.equal(button.category_minor, "测试项目");
    assert.equal(expenseButton.category_major, "项目支出");
    assert.equal(expenseButton.category_minor, "测试项目");
    const taxonomy = await request(app, "/api/v1/finance/taxonomy", "GET");
    assert.equal(taxonomy.body.expense.minors["项目支出"].some((item: Record<string, unknown>) => item.value === "测试项目"), true);
    assert.equal(taxonomy.body.income.minors["项目收入"].some((item: Record<string, unknown>) => item.value === "测试项目"), true);
    const income = await request(app, "/api/v1/finance/incomes", "POST", { amount_cents: 5000, quick_button_id: button.id, occurred_date: "2026-09-08" });
    assert.equal(income.response.status, 201);
    assert.equal(income.body.income.project_id, projectId);
    const expense = await request(app, "/api/v1/finance/expenses", "POST", { amount_cents: 1200, quick_button_id: expenseButton.id, occurred_date: "2026-09-08" });
    assert.equal(expense.response.status, 201);
    assert.equal(expense.body.expense.project_id, projectId);

    const plan = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "研究方案", due_date: "2099-09-10" });
    assert.equal(plan.response.status, 201);
    const ordinary = await request(app, "/api/v1/tasks", "GET");
    assert.equal(ordinary.body.tasks.some((task: Record<string, unknown>) => task.title === "研究方案"), false);

    const blankPlan = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "" });
    assert.equal(blankPlan.response.status, 201);
    assert.equal(blankPlan.body.project_task.title, "");
    const datedBlankPlan = await request(app, `/api/v1/project-task-plans/${blankPlan.body.project_task.id}`, "PATCH", { due_date: "2099-09-12" });
    assert.equal(datedBlankPlan.response.status, 200);
    const namedPlan = await request(app, `/api/v1/project-task-plans/${blankPlan.body.project_task.id}`, "PATCH", { title: "补充项目任务名称" });
    assert.equal(namedPlan.response.status, 200);
    assert.equal(namedPlan.body.project_task.title, "补充项目任务名称");

    const committed = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "交付版本", add_to_todo: true, due_date: "2026-09-11" });
    assert.equal(committed.response.status, 201);
    const todoId = committed.body.project_task.todo_task_id as string;
    const listed = await request(app, "/api/v1/tasks", "GET");
    assert.equal(listed.body.tasks.some((task: Record<string, unknown>) => task.id === todoId), true);

    const completed = await request(app, `/api/v1/tasks/${todoId}`, "PATCH", { status: "done" });
    assert.equal(completed.response.status, 200);
    const detailAfterComplete = await request(app, `/api/v1/projects/${projectId}`, "GET");
    const completedPlan = detailAfterComplete.body.project_tasks.find((task: Record<string, unknown>) => task.todo_task_id === todoId);
    assert.equal(completedPlan?.status, "done");
    assert.equal(detailAfterComplete.body.activities.some((item: Record<string, unknown>) => item.kind === "task_completed"), true);
    assert.equal(detailAfterComplete.body.finance.net_cents, 3800);

    const removable = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "可删除任务", add_to_todo: true });
    const removablePlanId = removable.body.project_task.id as string;
    const removableId = removable.body.project_task.todo_task_id as string;
    await request(app, `/api/v1/tasks/${removableId}`, "DELETE");
    const detailAfterDelete = await request(app, `/api/v1/projects/${projectId}`, "GET");
    const unlinked = detailAfterDelete.body.project_tasks.find((task: Record<string, unknown>) => task.id === removablePlanId);
    assert.equal(unlinked?.todo_task_id, null);
    assert.equal(detailAfterDelete.body.activities.some((item: Record<string, unknown>) => item.kind === "task_removed"), true);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("projects use editable start/end dates and archive only after both checks are satisfied", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-project-lifecycle-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const created = await request(app, "/api/v1/projects", "POST", { name: "生命周期项目" });
    const projectId = created.body.project.id as string;
    const updated = await request(app, `/api/v1/projects/${projectId}`, "PATCH", { started_at: "2026-09-01", end_date: "2026-09-30", row_version: created.body.project.row_version });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.project.started_at, "2026-09-01");
    assert.equal(updated.body.project.end_date, "2026-09-30");

    const clearedEnd = await request(app, `/api/v1/projects/${projectId}`, "PATCH", { end_date: null, row_version: updated.body.project.row_version });
    const missingEnd = await request(app, `/api/v1/projects/${projectId}`, "PATCH", { archive_requested: true, row_version: clearedEnd.body.project.row_version });
    assert.equal(missingEnd.response.status, 400);

    const archived = await request(app, `/api/v1/projects/${projectId}`, "PATCH", { end_date: "2026-09-30", archive_requested: true, row_version: clearedEnd.body.project.row_version });
    assert.equal(archived.response.status, 200);
    assert.ok(archived.body.project.archived_at);
    const active = await request(app, "/api/v1/projects", "GET");
    assert.equal(active.body.projects.some((project: Record<string, unknown>) => project.id === projectId), false);
    const archive = await request(app, "/api/v1/archive", "GET");
    assert.equal(archive.body.projects.some((project: Record<string, unknown>) => project.id === projectId), true);

    const uiSessionResponse = await app.fetch(new Request("http://paios.local/api/v1/system/ui-session"));
    const uiSession = (await uiSessionResponse.json() as { session: string }).session;
    const restored = await request(app, "/api/v1/archive/restore", "POST", { entity_type: "project", id: projectId }, { "X-PAIOS-UI-Session": uiSession });
    assert.equal(restored.response.status, 200);
    const afterRestore = await request(app, `/api/v1/projects/${projectId}`, "GET");
    assert.equal(afterRestore.body.project.archive_requested, 0);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("project tasks keep completion status, archive only when done and checked, and support restore/delete", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-project-task-archive-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const created = await request(app, "/api/v1/projects", "POST", { name: "归档项目任务" });
    const projectId = created.body.project.id as string;
    const plan = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "写方案" });
    const planId = plan.body.project_task.id as string;

    const markedDone = await request(app, `/api/v1/project-task-plans/${planId}`, "PATCH", { status: "done" });
    assert.equal(markedDone.response.status, 200);
    assert.equal(markedDone.body.project_task.status, "done");
    assert.equal(markedDone.body.project_task.archived_at, null);

    const flaggedOnly = await request(app, `/api/v1/project-task-plans/${planId}`, "PATCH", { status: "todo", archive_requested: true });
    assert.equal(flaggedOnly.body.project_task.archive_requested, 1);
    assert.equal(flaggedOnly.body.project_task.archived_at, null);

    const archived = await request(app, `/api/v1/project-task-plans/${planId}`, "PATCH", { status: "done", archive_requested: true });
    assert.ok(archived.body.project_task.archived_at);
    const active = await request(app, `/api/v1/projects/${projectId}`, "GET");
    assert.equal(active.body.project_tasks.some((task: Record<string, unknown>) => task.id === planId), false);
    const archive = await request(app, "/api/v1/archive", "GET");
    assert.equal(archive.body.project_tasks.some((task: Record<string, unknown>) => task.id === planId), true);

    const uiSessionResponse = await app.fetch(new Request("http://paios.local/api/v1/system/ui-session"));
    const uiSession = (await uiSessionResponse.json() as { session: string }).session;
    const restored = await request(app, "/api/v1/archive/restore", "POST", { entity_type: "project_task", id: planId }, { "X-PAIOS-UI-Session": uiSession });
    assert.equal(restored.response.status, 200);
    const afterRestore = await request(app, `/api/v1/projects/${projectId}`, "GET");
    const restoredTask = afterRestore.body.project_tasks.find((task: Record<string, unknown>) => task.id === planId);
    assert.equal(restoredTask?.archive_requested, 0);
    assert.equal(restoredTask?.status, "done");

    const deleted = await request(app, `/api/v1/project-task-plans/${planId}`, "DELETE");
    assert.equal(deleted.response.status, 200);
    const afterDelete = await request(app, `/api/v1/projects/${projectId}`, "GET");
    assert.equal(afterDelete.body.project_tasks.some((task: Record<string, unknown>) => task.id === planId), false);

    const extra = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "归档后删除" });
    const extraId = extra.body.project_task.id as string;
    await request(app, `/api/v1/project-task-plans/${extraId}`, "PATCH", { status: "cancelled", archive_requested: true });
    const purged = await request(app, `/api/v1/archive/project_task/${extraId}`, "DELETE", undefined, { "X-PAIOS-UI-Session": uiSession });
    assert.equal(purged.response.status, 200);
    const archiveAfterPurge = await request(app, "/api/v1/archive", "GET");
    assert.equal(archiveAfterPurge.body.project_tasks.some((task: Record<string, unknown>) => task.id === extraId), false);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
