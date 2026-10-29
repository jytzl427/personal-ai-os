import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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

test("completed projects never have active todo tasks and milestone edits in completed projects never create todos", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-project-completed-tasks-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    // 1. Create active project with milestone and todo task
    const created = await request(app, "/api/v1/projects", "POST", { name: "完结测试项目" });
    const projectId = created.body.project.id as string;
    const plan = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "里程碑1", add_to_todo: true, due_date: "2026-10-24" });
    const todoId = plan.body.project_task.todo_task_id as string;
    assert.ok(todoId);

    // Verify it appears in active todos
    let tasksRes = await request(app, "/api/v1/tasks", "GET");
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => t.id === todoId), true);
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => t.title === "🎯 完结测试项目"), true);

    // 2. Mark project status as done
    const updated = await request(app, `/api/v1/projects/${projectId}`, "PATCH", { status: "done", row_version: created.body.project.row_version });
    assert.equal(updated.response.status, 200);

    // Verify tasks are now archived and NOT in active todos
    tasksRes = await request(app, "/api/v1/tasks", "GET");
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => t.id === todoId), false);
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => t.title === "🎯 完结测试项目"), false);

    // 3. Edit milestone in the completed project (e.g. changing title, due date, status)
    const patchedPlan = await request(app, `/api/v1/project-task-plans/${plan.body.project_task.id}`, "PATCH", { title: "修改里程碑名称", due_date: "2026-10-24", status: "done" });
    assert.equal(patchedPlan.response.status, 200);
    assert.equal(patchedPlan.body.project_task.todo_task_id, null);

    // Verify still NO tasks in active todos
    tasksRes = await request(app, "/api/v1/tasks", "GET");
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => String(t.title ?? "").includes("完结测试项目")), false);
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => String(t.title ?? "").includes("修改里程碑名称")), false);

    // 4. Try adding new milestone with add_to_todo: true in the completed project
    const newPlan = await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "新里程碑", add_to_todo: true, due_date: "2026-10-24" });
    assert.equal(newPlan.response.status, 201);
    assert.equal(newPlan.body.project_task.todo_task_id, null);

    tasksRes = await request(app, "/api/v1/tasks", "GET");
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => String(t.title ?? "").includes("完结测试项目")), false);
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => String(t.title ?? "").includes("新里程碑")), false);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("stage plan dynamically drives project todo sync: active checkpoints in stage window sync, idea projects and out-of-stage checkpoints do not", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-stage-sync-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    // 1. Insert a confirmed stage plan for 2026-10-25 ~ 2026-11-01
    const stageId = randomUUID();
    database.prepare(`
      INSERT INTO period_plans (id, period_start, period_end, status, plan_text, created_at, updated_at)
      VALUES (?, '2026-10-25', '2026-11-01', 'confirmed', '阶段计划', '2026-10-25T00:00:00Z', '2026-10-25T00:00:00Z')
    `).run(stageId);

    // 2. Create an active advancing project with 2 milestones (one in stage window, one outside)
    const advProj = await request(app, "/api/v1/projects", "POST", { name: "VoltGuard", category: "advancement", status: "active" });
    const advId = advProj.body.project.id as string;

    const inStagePlan = await request(app, `/api/v1/projects/${advId}/task-plans`, "POST", { title: "阶段一验收", due_date: "2026-10-30" });
    const outStagePlan = await request(app, `/api/v1/projects/${advId}/task-plans`, "POST", { title: "阶段二验收", due_date: "2026-11-10" });

    // 3. Create an idea project with a milestone on 2026-10-28
    const ideaProj = await request(app, "/api/v1/projects", "POST", { name: "专升本", category: "advancement", status: "idea" });
    const ideaId = ideaProj.body.project.id as string;
    await request(app, `/api/v1/projects/${ideaId}/task-plans`, "POST", { title: "专升本调研", due_date: "2026-10-28" });

    // 4. Request tasks - triggers syncUpcomingCheckpointsToTodos
    let tasksRes = await request(app, "/api/v1/tasks", "GET");
    const tasks = tasksRes.body.tasks as Array<Record<string, unknown>>;

    // VoltGuard Phase 1 (10-30) should be synced
    assert.equal(tasks.some((t) => t.title === "阶段一验收"), true);
    assert.equal(tasks.some((t) => t.title === "🎯 VoltGuard"), true);

    // VoltGuard Phase 2 (11-10) should NOT be synced
    assert.equal(tasks.some((t) => t.title === "阶段二验收"), false);

    // 专升本 (idea) should NOT be synced
    assert.equal(tasks.some((t) => t.title === "专升本调研"), false);
    assert.equal(tasks.some((t) => t.title === "🎯 专升本"), false);

    // 5. Postpone Phase 1 outside stage window (e.g. 2026-11-15) -> should be unlinked/pruned from active todos
    await request(app, `/api/v1/project-task-plans/${inStagePlan.body.project_task.id}`, "PATCH", { due_date: "2026-11-15" });
    tasksRes = await request(app, "/api/v1/tasks", "GET");
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => t.title === "阶段一验收"), false);
    assert.equal(tasksRes.body.tasks.some((t: Record<string, unknown>) => t.title === "🎯 VoltGuard"), false);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("project task plans can be reordered by arbitrary position and auto-cascades", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-reorder-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const created = await request(app, "/api/v1/projects", "POST", { name: "排序测试项目", category: "advancement" });
    const projectId = created.body.project.id as string;

    const p1 = (await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "节点1" })).body.project_task.id as string;
    const p2 = (await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "节点2" })).body.project_task.id as string;
    const p3 = (await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "节点3" })).body.project_task.id as string;
    const p4 = (await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "节点4" })).body.project_task.id as string;
    const p5 = (await request(app, `/api/v1/projects/${projectId}/task-plans`, "POST", { title: "节点5" })).body.project_task.id as string;

    // Initial order: [p1, p2, p3, p4, p5]
    let initialList = [p1, p2, p3, p4, p5];

    // User moves node 5 (fromIndex = 4) to position 2 (toIndex = 1)
    const [moved] = initialList.splice(4, 1);
    if (!moved) throw new Error("moved element not found");
    initialList.splice(1, 0, moved);
    // Expected order: [p1, p5, p2, p3, p4]
    assert.deepEqual(initialList, [p1, p5, p2, p3, p4]);

    const reorderRes = await request(app, `/api/v1/projects/${projectId}/task-plans/reorder`, "POST", { plan_ids: initialList });
    assert.equal(reorderRes.response.status, 200);
    assert.equal(reorderRes.body.ok, true);

    const reorderedTasks = reorderRes.body.project_tasks as Array<{ id: string; title: string; sort_order: number }>;
    assert.equal(reorderedTasks.length, 5);
    assert.equal(reorderedTasks[0]!.id, p1);
    assert.equal(reorderedTasks[0]!.title, "节点1");
    assert.equal(reorderedTasks[1]!.id, p5);
    assert.equal(reorderedTasks[1]!.title, "节点5");
    assert.equal(reorderedTasks[2]!.id, p2);
    assert.equal(reorderedTasks[2]!.title, "节点2");
    assert.equal(reorderedTasks[3]!.id, p3);
    assert.equal(reorderedTasks[3]!.title, "节点3");
    assert.equal(reorderedTasks[4]!.id, p4);
    assert.equal(reorderedTasks[4]!.title, "节点4");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
