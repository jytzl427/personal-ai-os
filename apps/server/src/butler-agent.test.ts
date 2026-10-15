import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDateInTimezone, recurrenceDatesThrough } from "@paios/core";
import { getSetting, openDatabase } from "@paios/db";
import { createApp } from "./app.js";
import { ButlerAgentError, executeButlerReadTool, runButlerAgent } from "./butler-agent.js";
import { executeButlerWriteTool } from "./butler-writes.js";

test("conversation Butler reads the real task through a tool call before answering", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-agent-"));
  const requests: Array<Record<string, unknown>> = [];
  const mock = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.setHeader("Content-Type", "application/json");
      const payload = requests.length === 1
        ? { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-tasks", type: "function", function: { name: "tasks_list", arguments: "{}" } }] } }] }
        : { choices: [{ message: { role: "assistant", content: "本地查到的任务是：真实任务正文。" } }] };
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const headers = { "Content-Type": "application/json" };
    const key = await app.fetch(new Request("http://paios.local/api/v1/settings/api-key", { method: "PUT", headers, body: JSON.stringify({ api_key: "agent-test-key" }) }));
    assert.equal(key.status, 200);
    const config = await app.fetch(new Request("http://paios.local/api/v1/workbench/config", { method: "PATCH", headers, body: JSON.stringify({ base_url: `http://127.0.0.1:${address.port}/v1`, model: "mock" }) }));
    assert.equal(config.status, 200);
    const task = await app.fetch(new Request("http://paios.local/api/v1/tasks", { method: "POST", headers, body: JSON.stringify({ title: "真实任务正文", content: "真实任务正文。" }) }));
    assert.equal(task.status, 201);
    const conversation = await app.fetch(new Request("http://paios.local/api/v1/conversations", { method: "POST", headers, body: JSON.stringify({ title: "工具读取测试" }) }));
    const conversationId = (await conversation.json() as { conversation: { id: string } }).conversation.id;
    const response = await app.fetch(new Request(`http://paios.local/api/v1/conversations/${conversationId}/messages`, { method: "POST", headers, body: JSON.stringify({ content: "我有哪些任务？" }) }));
    assert.equal(response.status, 200);
    const result = await response.json() as { message: { content_text: string; tool_calls: Array<{ name: string; ok: boolean }> } };
    assert.equal(result.message.content_text, "本地查到的任务是：真实任务正文。");
    assert.equal(result.message.tool_calls.length, 1);
    assert.equal(result.message.tool_calls[0]?.name, "tasks_list");
    assert.equal(result.message.tool_calls[0]?.ok, true);
    assert.equal(requests.length, 2);
    const secondMessages = requests[1]?.messages as Array<{ role: string; content: string }>;
    assert.ok(secondMessages.some((item) => item.role === "tool" && item.content.includes("真实任务正文")));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_tool_calls").get() as { count: number }).count, 1);
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("today Butler reads only tasks whose execution date (due_date) is today", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-today-"));
  const requests: Array<Record<string, unknown>> = [];
  const mock = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.setHeader("Content-Type", "application/json");
      const payload = requests.length === 1
        ? { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-today", type: "function", function: { name: "tasks_list", arguments: "{}" } }] } }] }
        : { choices: [{ message: { role: "assistant", content: "今天的任务是：今天任务。" } }] };
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const timestamp = new Date().toISOString();
  database.prepare(
    "INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P2', ?, NULL, ?, ?)"
  ).run("today-task", "今天任务", "2026-08-31", timestamp, timestamp);
  database.prepare(
    "INSERT INTO tasks (id, title, description, content, status, priority, due_date, scheduled_date, created_at, updated_at) VALUES (?, ?, '', '', 'todo', 'P2', ?, NULL, ?, ?)"
  ).run("tomorrow-task", "明天任务", "2026-09-01", timestamp, timestamp);
  try {
    const result = await runButlerAgent({
      database,
      endpoint: new URL(`http://127.0.0.1:${address.port}/v1/chat/completions`),
      apiKey: "today-test-key",
      model: "mock",
      date: "2026-08-31",
      history: [{ role: "user", content: "我今天有哪些任务？" }]
    });
    assert.equal(result.traces[0]?.name, "today_get");
    assert.equal(result.traces[0]?.ok, true);
    assert.equal(requests.length, 2);
    const toolMessage = (requests[1]?.messages as Array<{ role: string; content: string }>).find((item) => item.role === "tool");
    assert.ok(toolMessage?.content.includes("今天任务"));
    assert.equal(toolMessage?.content.includes("明天任务"), false);
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("Butler recurrence tools keep rule management separate from generated occurrences", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-recurrence-tools-"));
  const database = openDatabase(dataDir);
  try {
    const timezone = getSetting(database, "timezone", "Asia/Shanghai");
    const today = localDateInTimezone(timezone);
    const startDate = "2026-08-31";
    const rule = { frequency: "weekly" as const, interval: 1, weekdays: [1] };
    const created = executeButlerWriteTool(database, "task_recurrence_create", {
      title_template: "每周整理",
      description_template: "",
      content_template: "",
      start_date: startDate,
      rule,
      enabled: true
    }, today, "recurrence-tool-test:create");
    assert.equal(created.error, undefined);
    if ("error" in created) throw new Error(created.error);
    const recurrence = created.data as { id: string; row_version: number };
    const inspected = executeButlerReadTool(database, "task_recurrences_list", {}, today);
    assert.equal("error" in inspected, false);
    if ("error" in inspected) throw new Error(inspected.error);
    assert.equal((inspected.data as Array<{ id: string; missing_count: number }>).find((item) => item.id === recurrence.id)?.missing_count, 0);
    const expectedDates = recurrenceDatesThrough(rule, startDate, today);
    assert.ok(expectedDates.length >= 1);

    const updated = executeButlerWriteTool(database, "task_recurrence_update", {
      recurrence_id: recurrence.id,
      enabled: false,
      row_version: recurrence.row_version
    }, today, "recurrence-tool-test:update");
    assert.equal(updated.error, undefined);
    assert.equal((updated.data as { enabled: number }).enabled, 0);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE recurrence_id = ?").get(recurrence.id) as { count: number }).count, expectedDates.length);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("conversation Butler only exposes ordinary write tools for an explicit write request", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-write-agent-"));
  const requests: Array<Record<string, unknown>> = [];
  const mock = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.setHeader("Content-Type", "application/json");
      const payload = requests.length === 1
        ? { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-create", type: "function", function: { name: "tasks_create", arguments: JSON.stringify({ title: "管家创建的任务", content: "任务正文" }) } }] } }] }
        : { choices: [{ message: { role: "assistant", content: "已创建任务，并保留了任务正文。" } }] };
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const headers = { "Content-Type": "application/json" };
    assert.equal((await app.fetch(new Request("http://paios.local/api/v1/settings/api-key", { method: "PUT", headers, body: JSON.stringify({ api_key: "agent-test-key" }) }))).status, 200);
    assert.equal((await app.fetch(new Request("http://paios.local/api/v1/workbench/config", { method: "PATCH", headers, body: JSON.stringify({ base_url: `http://127.0.0.1:${address.port}/v1`, model: "mock" }) }))).status, 200);
    const conversation = await app.fetch(new Request("http://paios.local/api/v1/conversations", { method: "POST", headers, body: JSON.stringify({ title: "写入测试" }) }));
    const conversationId = (await conversation.json() as { conversation: { id: string } }).conversation.id;
    const response = await app.fetch(new Request(`http://paios.local/api/v1/conversations/${conversationId}/messages`, { method: "POST", headers, body: JSON.stringify({ content: "请创建一个任务，名称是管家创建的任务" }) }));
    assert.equal(response.status, 200);
    const firstTools = requests[0]?.tools as Array<{ function?: { name?: string } }>;
    assert.ok(firstTools.some((tool) => tool.function?.name === "tasks_create"));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE title = ?").get("管家创建的任务") as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE actor = 'agent' AND tool_name = 'tasks_create'").get() as { count: number }).count, 1);
    const audit = database.prepare("SELECT change_id, before_json, after_json FROM audit_logs WHERE actor = 'agent' AND tool_name = 'tasks_create' ORDER BY at DESC LIMIT 1").get() as { change_id: string | null; before_json: string | null; after_json: string | null };
    assert.ok(audit.change_id);
    assert.equal(audit.before_json, null);
    assert.match(audit.after_json ?? "", /任务正文/);
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("conversation Butler treats a direct natural-language expense as a write request", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-natural-finance-"));
  const requests: Array<Record<string, unknown>> = [];
  const mock = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.setHeader("Content-Type", "application/json");
      const payload = requests.length === 1
        ? { choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-expense", type: "function", function: { name: "finance_expense_create", arguments: JSON.stringify({ amount_cents: 1000, category_major: "日常消费", category_minor: "饭费", event: "午饭", occurred_date: "2026-09-02" }) } }] } }] }
        : { choices: [{ message: { role: "assistant", content: "已记录今日午饭支出10元。" } }] };
      response.end(JSON.stringify(payload));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const headers = { "Content-Type": "application/json" };
    assert.equal((await app.fetch(new Request("http://paios.local/api/v1/settings/api-key", { method: "PUT", headers, body: JSON.stringify({ api_key: "agent-test-key" }) }))).status, 200);
    assert.equal((await app.fetch(new Request("http://paios.local/api/v1/workbench/config", { method: "PATCH", headers, body: JSON.stringify({ base_url: `http://127.0.0.1:${address.port}/v1`, model: "mock" }) }))).status, 200);
    const conversation = await app.fetch(new Request("http://paios.local/api/v1/conversations", { method: "POST", headers, body: JSON.stringify({ title: "自然语言记账测试" }) }));
    const conversationId = (await conversation.json() as { conversation: { id: string } }).conversation.id;
    const response = await app.fetch(new Request(`http://paios.local/api/v1/conversations/${conversationId}/messages`, { method: "POST", headers, body: JSON.stringify({ content: "今日午饭10元" }) }));
    assert.equal(response.status, 200);
    const firstTools = requests[0]?.tools as Array<{ function?: { name?: string } }>;
    assert.ok(firstTools.some((tool) => tool.function?.name === "finance_expense_create"));
    const expense = database.prepare("SELECT amount_cents, category_major, category_minor, event, account_id FROM finance_expenses ORDER BY created_at DESC LIMIT 1").get() as { amount_cents: number; category_major: string; category_minor: string; event: string; account_id: string | null };
    assert.deepEqual(expense, { amount_cents: 1000, category_major: "日常消费", category_minor: "饭费", event: "午饭", account_id: null });
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("Butler cancellation aborts the model request without creating an assistant message", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-cancel-"));
  const mock = createServer((_request, response) => {
    const timer = setTimeout(() => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "不应返回" } }] }));
    }, 1000);
    response.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const controller = new AbortController();
  try {
    const pending = runButlerAgent({
      database,
      endpoint: new URL(`http://127.0.0.1:${address.port}/v1/chat/completions`),
      apiKey: "cancel-test-key",
      model: "mock",
      date: "2026-08-31",
      history: [{ role: "user", content: "请读取今天的任务" }],
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 25);
    await assert.rejects(pending, (error: unknown) => error instanceof Error && /aborted|abort/i.test(error.message));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_messages").get() as { count: number }).count, 0);
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("Butler model failure retains successful tool traces and writes", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-partial-"));
  let requestCount = 0;
  const mock = createServer((_request, response) => {
    requestCount += 1;
    if (requestCount === 1) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-create", type: "function", function: { name: "tasks_create", arguments: JSON.stringify({ title: "已写入但回答失败", content: "正文" }) } }] } }] }));
      return;
    }
    setTimeout(() => response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "不应返回" } }] })), 1000);
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const controller = new AbortController();
  try {
    const pending = runButlerAgent({
      database,
      endpoint: new URL(`http://127.0.0.1:${address.port}/v1/chat/completions`),
      apiKey: "partial-test-key",
      model: "mock",
      date: "2026-08-31",
      history: [{ role: "user", content: "请创建任务" }],
      allowWrites: true,
      idempotencyNamespace: "partial-test",
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, (error: unknown) => error instanceof ButlerAgentError && error.traces.some((trace) => trace.name === "tasks_create" && trace.ok));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE title = ?").get("已写入但回答失败") as { count: number }).count, 1);
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("conversation persists a partial write trace when the model fails after a tool call", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-partial-conversation-"));
  let requestCount = 0;
  const mock = createServer((_request, response) => {
    requestCount += 1;
    response.setHeader("Content-Type", "application/json");
    if (requestCount === 1) {
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "", tool_calls: [{ id: "call-create", type: "function", function: { name: "tasks_create", arguments: JSON.stringify({ title: "部分成功任务", content: "正文" }) } }] } }] }));
      return;
    }
    response.statusCode = 500;
    response.end(JSON.stringify({ error: { message: "mock model failure" } }));
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const headers = { "Content-Type": "application/json" };
    assert.equal((await app.fetch(new Request("http://paios.local/api/v1/settings/api-key", { method: "PUT", headers, body: JSON.stringify({ api_key: "agent-test-key" }) }))).status, 200);
    assert.equal((await app.fetch(new Request("http://paios.local/api/v1/workbench/config", { method: "PATCH", headers, body: JSON.stringify({ base_url: `http://127.0.0.1:${address.port}/v1`, model: "mock" }) }))).status, 200);
    const conversation = await app.fetch(new Request("http://paios.local/api/v1/conversations", { method: "POST", headers, body: JSON.stringify({ title: "部分成功测试" }) }));
    const conversationId = (await conversation.json() as { conversation: { id: string } }).conversation.id;
    const response = await app.fetch(new Request(`http://paios.local/api/v1/conversations/${conversationId}/messages`, { method: "POST", headers, body: JSON.stringify({ content: "请创建一个任务" }) }));
    assert.equal(response.status, 502);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM tasks WHERE title = ?").get("部分成功任务") as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_messages WHERE conversation_id = ? AND role = 'assistant'").get(conversationId) as { count: number }).count, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM conversation_tool_calls WHERE conversation_id = ? AND tool_name = 'tasks_create'").get(conversationId) as { count: number }).count, 1);
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
