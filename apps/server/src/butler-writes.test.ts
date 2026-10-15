import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@paios/db";
import { executeButlerWriteTool } from "./butler-writes.js";
import { executeButlerReadTool } from "./butler-agent.js";

test("Butler ordinary writes are idempotent and preserve task正文", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-write-"));
  const database = openDatabase(dataDir);
  try {
    const args = { title: "幂等任务", content: "这是任务正文", due_date: "2026-09-01" };
    const first = executeButlerWriteTool(database, "tasks_create", args, "2026-08-30", "conversation:user-1:tasks_create:key");
    const second = executeButlerWriteTool(database, "tasks_create", args, "2026-08-30", "conversation:user-1:tasks_create:key");
    assert.equal(first.error, undefined);
    assert.equal(second.error, undefined);
    assert.equal((first.data as { id: string }).id, (second.data as { id: string }).id);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE title = ?").get("幂等任务") as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT content, description FROM tasks WHERE title = ?").get("幂等任务") as { content: string; description: string }).content, "这是任务正文");
    const audit = database.prepare("SELECT change_id, before_json, after_json FROM audit_logs WHERE tool_name = 'tasks_create' ORDER BY at DESC LIMIT 1").get() as { change_id: string | null; before_json: string | null; after_json: string | null };
    assert.ok(audit.change_id);
    assert.equal(audit.before_json, null);
    assert.match(audit.after_json ?? "", /幂等任务/);

    const guarded = executeButlerWriteTool(database, "tasks_create", { title: "人工归档任务" }, "2026-08-30");
    const guardedId = (guarded.data as { id: string }).id;
    database.prepare("UPDATE tasks SET archive_requested = 1 WHERE id = ?").run(guardedId);
    const blocked = executeButlerWriteTool(database, "tasks_update", { task_id: guardedId, status: "done", row_version: 1 }, "2026-08-30");
    assert.match(blocked.error ?? "", /不能通过完成或取消触发归档/);
    assert.equal((database.prepare("SELECT archived_at FROM tasks WHERE id = ?").get(guardedId) as { archived_at: string | null }).archived_at, null);

    const planTask = executeButlerWriteTool(database, "tasks_create", { title: "计划候选任务", due_date: "2026-08-30" }, "2026-08-30");
    const plan = executeButlerWriteTool(database, "plans_generate", { date: "2026-08-30" }, "2026-08-30");
    assert.equal(plan.error, undefined);
    assert.equal((plan.data as { items: Array<{ task_id: string }> }).items[0]?.task_id, (planTask.data as { id: string }).id);
    const planRead = executeButlerReadTool(database, "plans_get", { date: "2026-08-30" }, "2026-08-30");
    if ("error" in planRead) throw new Error(planRead.error);
    assert.equal((planRead.data as { plan: { plan_date: string } }).plan.plan_date, "2026-08-30");
    const review = executeButlerWriteTool(database, "reviews_daily_generate", { date: "2026-08-30" }, "2026-08-30");
    assert.equal((review.data as { review_type: string }).review_type, "daily");
    const preview = executeButlerReadTool(database, "finance_quick_preview", { input: "早餐 12" }, "2026-08-30");
    if ("error" in preview) throw new Error(preview.error);
    assert.equal((preview.data as { amountCents: number }).amountCents, 1200);
    const accountBeforeFinanceWrite = (database.prepare("SELECT current_balance_cents FROM finance_accounts WHERE id = 'love'").get() as { current_balance_cents: number }).current_balance_cents;
    const expense = executeButlerWriteTool(database, "finance_expense_create", { account_id: "love", amount_cents: 1000, category_major: "日常消费", category_minor: "饭费", event: "午饭" }, "2026-08-30");
    assert.equal(expense.error, undefined);
    assert.equal((expense.data as { account_id: string | null }).account_id, null);
    assert.equal((database.prepare("SELECT current_balance_cents FROM finance_accounts WHERE id = 'love'").get() as { current_balance_cents: number }).current_balance_cents, accountBeforeFinanceWrite);
    const normalizedExpense = executeButlerWriteTool(database, "finance_expense_create", { amount_cents: 1000, category: "今日午饭元" }, "2026-08-30");
    assert.equal(normalizedExpense.error, undefined);
    assert.equal((normalizedExpense.data as { category_major: string; category_minor: string; event: string }).category_major, "日常消费");
    assert.equal((normalizedExpense.data as { category_major: string; category_minor: string; event: string }).category_minor, "饭费");
    assert.equal((normalizedExpense.data as { category_major: string; category_minor: string; event: string }).event, "午饭");
    const project = executeButlerWriteTool(database, "projects_create", { name: "管家项目" }, "2026-08-30");
    const projectId = (project.data as { id: string }).id;
    const timestamp = new Date().toISOString();
    database.prepare("INSERT INTO period_plans (id, period_start, period_end, plan_text, status, created_at, updated_at) VALUES (?, ?, ?, '', 'confirmed', ?, ?)").run("stage-confirmed", "2026-08-30", "2026-08-30", timestamp, timestamp);
    const projectUpdate = executeButlerWriteTool(database, "projects_update", { project_id: projectId, status: "planned", row_version: 1 }, "2026-08-30");
    assert.equal(projectUpdate.error, undefined);
    assert.equal((projectUpdate.data as { status: string }).status, "planned");
    const idea = executeButlerWriteTool(database, "ideas_create", { title: "管家想法", category: "short_term", urgency: 1 }, "2026-08-30");
    assert.equal((idea.data as { title: string; urgency: number }).title, "管家想法");
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
