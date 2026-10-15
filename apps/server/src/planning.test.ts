import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDateInTimezone } from "@paios/core";
import { getSetting, openDatabase } from "@paios/db";
import {
  buildAttentionSnapshot,
  buildDailyPlanningContext,
  buildReviewFacts,
  classifyProjectPosture,
  classifyTaskBand,
  countTasksByExecutionPeriod,
  generatePeriodReviewDraft,
  isButlerWriteIntent,
  listOverdueTasks,
  listTasksOnExecutionDate,
  listUndatedTasks,
  renderDailyPlanText,
  renderReviewText,
  shiftIsoDate,
  timePhaseFromHour,
  updateDailyPlanText,
  upsertPeriodPlan
} from "./planning.js";
import { generateDailyReviewDraft } from "./review-drafts.js";
import { executeButlerReadTool } from "./butler-agent.js";
import { executeButlerWriteTool } from "./butler-writes.js";
import { createApp } from "./app.js";

function tempDb() {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-planning-"));
  return { dataDir, database: openDatabase(dataDir) };
}

test("time phase and execution-date helpers", () => {
  assert.equal(timePhaseFromHour(5), "morning");
  assert.equal(timePhaseFromHour(11), "morning");
  assert.equal(timePhaseFromHour(12), "afternoon");
  assert.equal(timePhaseFromHour(17), "afternoon");
  assert.equal(timePhaseFromHour(18), "evening");
  assert.equal(timePhaseFromHour(4), "evening");
  assert.equal(shiftIsoDate("2026-09-05", 1), "2026-09-06");
  assert.equal(classifyTaskBand("P0"), "urgent");
  assert.equal(classifyTaskBand("P1"), "important");
  assert.equal(classifyTaskBand("P2"), "secondary");
});

test("project posture covers maintenance, learning, blocked, stalled and pause", () => {
  assert.equal(classifyProjectPosture({ status: "paused", name: "中转站", today: "2026-09-05", tasks: [] }).posture, "paused");
  assert.equal(classifyProjectPosture({
    status: "active",
    name: "Java Web 学习",
    today: "2026-09-05",
    tasks: [{ status: "todo", due_date: "2026-09-06", updated_at: "2026-09-04T00:00:00.000Z" }]
  }).posture, "learning");
  assert.equal(classifyProjectPosture({
    status: "active",
    name: "中转站",
    today: "2026-09-05",
    tasks: [
      { status: "todo", due_date: "2026-09-05", updated_at: "2026-09-05T00:00:00.000Z", recurrence_id: "r1" },
      { status: "todo", due_date: "2026-09-06", updated_at: "2026-09-05T00:00:00.000Z", recurrence_id: "r1" }
    ]
  }).posture, "stable_maintenance");
  assert.equal(classifyProjectPosture({
    status: "active",
    name: "建设",
    today: "2026-09-05",
    tasks: [
      { status: "todo", due_date: "2026-08-01", updated_at: "2026-08-01T00:00:00.000Z" },
      { status: "todo", due_date: "2026-08-02", updated_at: "2026-08-01T00:00:00.000Z" }
    ]
  }).posture, "blocked");
  assert.equal(classifyProjectPosture({
    status: "active",
    name: "建设",
    today: "2026-09-05",
    tasks: [{ status: "todo", due_date: "2026-09-20", updated_at: "2026-08-01T00:00:00.000Z" }]
  }).posture, "stalled");
});

test("write intent includes planning verbs and auto-check, still rejects negatives", () => {
  assert.equal(isButlerWriteIntent("帮我制定阶段计划"), true);
  assert.equal(isButlerWriteIntent("请安排明天的任务"), true);
  assert.equal(isButlerWriteIntent("推进 Java Web 项目"), true);
  assert.equal(isButlerWriteIntent("请根据 attention_get 做当前时段主动检查，并把检查结果写入今日复盘草稿"), true);
  assert.equal(isButlerWriteIntent("不要创建任务"), false);
  assert.equal(isButlerWriteIntent("今天天气怎么样"), false);
});

test("execution date is due_date only; scheduled_date is ignored", () => {
  const { dataDir, database } = tempDb();
  try {
    const timestamp = new Date().toISOString();
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P0', ?, NULL, ?, ?)").run("due-today", "执行日任务", "2026-09-05", timestamp, timestamp);
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P1', NULL, ?, ?, ?)").run("scheduled-only", "仅 scheduled", "2026-09-05", timestamp, timestamp);
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P0', ?, NULL, ?, ?)").run("overdue", "逾期任务", "2026-09-01", timestamp, timestamp);
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P2', NULL, NULL, ?, ?)").run("undated", "无日期任务", timestamp, timestamp);
    const onDate = listTasksOnExecutionDate(database, "2026-09-05");
    assert.equal(onDate.some((task) => task.id === "due-today"), true);
    assert.equal(onDate.some((task) => task.id === "scheduled-only"), false);
    assert.equal(listOverdueTasks(database, "2026-09-05").some((task) => task.id === "overdue"), true);
    assert.equal(listUndatedTasks(database).some((task) => task.id === "undated"), true);
    const periodCount = countTasksByExecutionPeriod(database, "2026-09-05", "2026-09-05");
    assert.equal(periodCount.total, 1);
    const facts = buildReviewFacts(database, "2026-09-05", "2026-09-05", "2026-09-05");
    assert.equal(facts.tasks.total, 1);
    assert.equal(facts.tasks.open_titles.some((task) => task.title === "仅 scheduled"), false);
    const today = executeButlerReadTool(database, "today_get", {}, "2026-09-05");
    if ("error" in today) throw new Error(today.error);
    const payload = today.data as { tasks: { items: Array<{ id: string }>; overdueItems: Array<{ id: string }> } };
    assert.equal(payload.tasks.items.some((task) => task.id === "due-today"), true);
    assert.equal(payload.tasks.items.some((task) => task.id === "scheduled-only"), false);
    assert.equal(payload.tasks.overdueItems.some((task) => task.id === "overdue"), true);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("attention, daily/stage plans and reviews use real database facts", () => {
  const { dataDir, database } = tempDb();
  try {
    const timestamp = new Date().toISOString();
    database.prepare("INSERT OR REPLACE INTO app_settings (key, value_json, updated_at) VALUES ('timezone', ?, ?)").run(JSON.stringify("Asia/Shanghai"), timestamp);
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P0', ?, ?, ?)").run("t-overdue", "逾期建设", "2026-09-01", timestamp, timestamp);
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P1', NULL, ?, ?)").run("t-undated", "未安排", timestamp, timestamp);
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P0', ?, ?, ?)").run("t-tomorrow", "明天重要", "2026-09-06", timestamp, timestamp);
    const project = executeButlerWriteTool(database, "projects_create", { name: "中转站" }, "2026-09-05");
    assert.equal(project.error, undefined);
    database.prepare("INSERT INTO ideas (id, title, body, category, urgency, processed, created_at, updated_at) VALUES (?, ?, '', 'short_term', 2, 0, ?, ?)").run("idea-1", "值得做的想法", timestamp, timestamp);
    database.prepare("INSERT INTO finance_expenses (id, amount_cents, currency, category, category_major, category_minor, event, note, occurred_date, created_at, updated_at) VALUES (?, 1200, 'CNY', '日常消费 / 饭费', '日常消费', '饭费', '午饭', '', '2026-09-04', ?, ?)").run("exp-1", timestamp, timestamp);

    const attention = buildAttentionSnapshot(database, "2026-09-05", new Date("2026-09-05T15:00:00+08:00"));
    assert.equal(attention.phase, "afternoon");
    assert.equal(attention.overdue.some((task) => task.id === "t-overdue"), true);
    assert.equal(attention.undated.some((task) => task.id === "t-undated"), true);
    assert.equal(attention.closed_app_cannot_notify, true);
    assert.ok(attention.items.some((item) => item.includes("逾期")));

    const daily = buildDailyPlanningContext(database, "2026-09-06", "2026-09-05");
    assert.equal(daily.execution_date_field, "due_date");
    assert.equal(daily.classified.urgent.some((task) => task.id === "t-tomorrow"), true);
    const dailyText = renderDailyPlanText(daily);
    assert.match(dailyText, /上午/);
    assert.match(dailyText, /下午/);
    assert.match(dailyText, /晚上/);
    assert.match(dailyText, /未安排/);

    const stage = upsertPeriodPlan(database, "2026-09-05", "2026-09-11") as { id: string; status: string; plan_text: string };
    assert.equal(stage.status, "draft");
    assert.match(stage.plan_text, /阶段核心目标/);
    assert.match(stage.plan_text, /财务安排/);
    assert.match(stage.plan_text, /健康目标/);
    assert.match(stage.plan_text, /中转站/);
    assert.match(stage.plan_text, /值得做的想法/);
    const again = upsertPeriodPlan(database, "2026-09-05", "2026-09-11", stage.plan_text + "\n用户修改");
    assert.match(String((again as { plan_text: string }).plan_text), /用户修改/);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM period_plans").get() as { count: number }).count, 1);

    const plan = updateDailyPlanText(database, "2026-09-06", dailyText, "用户确认后把逾期放到上午");
    assert.match(String(plan.plan?.plan_text ?? ""), /用户确认后把逾期放到上午/);

    const dailyReview = generateDailyReviewDraft(database, "2026-09-05") as { content_json: string; status: string };
    const dailyContent = JSON.parse(dailyReview.content_json) as { facts: { tasks: { overdue: number }; distinction: string }; text: string };
    assert.ok(dailyContent.facts.tasks.overdue >= 1);
    assert.match(dailyContent.facts.distinction, /不能写成确定因果/);
    assert.match(dailyContent.text, /客观数据统计/);
    const periodReview = generatePeriodReviewDraft(database, "2026-09-01", "2026-09-05") as { review_type: string; content_json: string };
    assert.equal(periodReview.review_type, "period");
    assert.match(renderReviewText(buildReviewFacts(database, "2026-09-01", "2026-09-05", "2026-09-05"), "period"), /可能相关/);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("butler cannot pause a project, confirm a stage plan, or advance projects without confirmation", () => {
  const { dataDir, database } = tempDb();
  try {
    const created = executeButlerWriteTool(database, "projects_create", { name: "不可暂停" }, "2026-09-05");
    const projectId = (created.data as { id: string }).id;
    const paused = executeButlerWriteTool(database, "projects_update", { project_id: projectId, status: "paused", row_version: 1 }, "2026-09-05");
    assert.match(paused.error ?? "", /暂停|放弃|界面/);
    const abandoned = executeButlerWriteTool(database, "projects_update", { project_id: projectId, status: "abandoned", row_version: 1 }, "2026-09-05");
    assert.match(abandoned.error ?? "", /暂停|放弃|界面/);
    const advancing = executeButlerWriteTool(database, "projects_update", { project_id: projectId, status: "active", row_version: 1 }, "2026-09-05");
    assert.match(advancing.error ?? "", /阶段计划/);
    const workspace = executeButlerWriteTool(database, "project_workspace_update", { project_id: projectId, goals: "先拆任务" }, "2026-09-05");
    assert.match(workspace.error ?? "", /阶段计划/);
    const linked = executeButlerWriteTool(database, "tasks_create", { title: "项目任务", project_id: projectId }, "2026-09-05");
    assert.match(linked.error ?? "", /阶段计划/);
    const standalone = executeButlerWriteTool(database, "tasks_create", { title: "独立任务", due_date: "2026-09-06" }, "2026-09-05");
    assert.equal(standalone.error, undefined);
    const stage = executeButlerWriteTool(database, "period_plans_upsert", { period_start: "2026-09-05", period_end: "2026-09-11" }, "2026-09-05");
    assert.equal(stage.error, undefined);
    assert.equal((stage.data as { status: string }).status, "draft");
    const stillBlocked = executeButlerWriteTool(database, "projects_update", { project_id: projectId, status: "active", row_version: 1 }, "2026-09-05");
    assert.match(stillBlocked.error ?? "", /阶段计划/);
    database.prepare("UPDATE period_plans SET status = 'confirmed' WHERE period_start = ? AND period_end = ?").run("2026-09-05", "2026-09-11");
    const allowed = executeButlerWriteTool(database, "projects_update", { project_id: projectId, status: "active", row_version: 1 }, "2026-09-05");
    assert.equal(allowed.error, undefined);
    assert.equal((allowed.data as { status: string }).status, "active");
    const linkedAfter = executeButlerWriteTool(database, "tasks_create", { title: "确认后的项目任务", project_id: projectId, due_date: "2026-09-06" }, "2026-09-05");
    assert.equal(linkedAfter.error, undefined);
    const stillPaused = executeButlerWriteTool(database, "projects_update", { project_id: projectId, status: "paused", row_version: 2 }, "2026-09-05");
    assert.match(stillPaused.error ?? "", /暂停|放弃|界面/);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("legacy review endpoints count execution dates by due_date only", async () => {
  const { dataDir, database } = tempDb();
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const timestamp = new Date().toISOString();
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P2', ?, NULL, ?, ?)").run("due-task", "执行日任务", "2026-09-05", timestamp, timestamp);
    database.prepare("INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P2', NULL, ?, ?, ?)").run("scheduled-task", "仅 scheduled", "2026-09-05", timestamp, timestamp);
    const created = await app.fetch(new Request("http://paios.local/api/v1/reviews/period", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period_start: "2026-09-05", period_end: "2026-09-05" })
    }));
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { review: { id: string; content: { tasks: { total: number } } } };
    assert.equal(createdBody.review.content.tasks.total, 1);
    const finalized = await app.fetch(new Request(`http://paios.local/api/v1/reviews/${createdBody.review.id}/finalize`, { method: "POST" }));
    assert.equal(finalized.status, 200);
    const finalizedBody = await finalized.json() as { snapshots: Array<{ entity_type: string; snapshot_json: string }> };
    const taskSnapshot = JSON.parse(finalizedBody.snapshots.find((item) => item.entity_type === "tasks")?.snapshot_json ?? "{}") as { total: number };
    assert.equal(taskSnapshot.total, 1);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("MCP agent cannot update a project until a covering stage plan is confirmed", async () => {
  const { dataDir, database } = tempDb();
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const token = readFileSync(join(dataDir, "mcp-token.txt"), "utf8").trim();
    const headers = { Authorization: `Bearer ${token}`, "X-PAIOS-Agent-Transport": "mcp", "Content-Type": "application/json" };
    const created = await app.fetch(new Request("http://paios.local/api/v1/projects", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "MCP 推进项目" })
    }));
    assert.equal(created.status, 201);
    const project = (await created.json() as { project: { id: string; row_version: number } }).project;
    const blocked = await app.fetch(new Request(`http://paios.local/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "active", row_version: project.row_version })
    }));
    assert.equal(blocked.status, 403);
    const today = localDateInTimezone(getSetting(database, "timezone", "Asia/Shanghai"));
    const humanConfirm = await app.fetch(new Request("http://paios.local/api/v1/stage-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period_start: today, period_end: today })
    }));
    assert.equal(humanConfirm.status, 201);
    const planId = (await humanConfirm.json() as { plan: { id: string } }).plan.id;
    const confirm = await app.fetch(new Request(`http://paios.local/api/v1/stage-plans/${planId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "confirmed" })
    }));
    assert.equal(confirm.status, 200);
    const allowed = await app.fetch(new Request(`http://paios.local/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "active", row_version: project.row_version })
    }));
    assert.equal(allowed.status, 200);
    const pause = await app.fetch(new Request(`http://paios.local/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status: "paused", row_version: project.row_version + 1 })
    }));
    assert.equal(pause.status, 403);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
