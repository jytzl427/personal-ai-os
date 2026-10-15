import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openDatabase } from "@paios/db";

const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "main.js");

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
  return port;
}

async function waitForService(url: string, process?: ChildProcess, getStderr?: () => string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/v1/system/status`);
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  const details = [
    process?.exitCode === null ? "running" : `exit=${process?.exitCode ?? "unknown"}`,
    getStderr?.().trim() || "no stderr"
  ].join(", ");
  throw new Error(`server did not start in time (${details})`);
}

function jsonText(result: unknown): any {
  const value = result as { content?: Array<{ type: string; text?: string }>; contents?: Array<{ text?: string }> };
  const text = value.content?.find((item) => item.type === "text")?.text ?? value.contents?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

async function connectMcp(baseUrl: string, token: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<string, string>;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry, "mcp"],
    cwd: process.cwd(),
    env: { ...env, PAIOS_URL: baseUrl, PAIOS_TOKEN: token, PAIOS_AGENT_NAME: "mcp-integration-test" },
    stderr: "pipe"
  });
  const client = new Client({ name: "paios-integration-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

async function connectDirectMcp(dataDir: string, token: string): Promise<{ client: Client; transport: StdioClientTransport }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) as Record<string, string>;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry, "mcp-direct"],
    cwd: process.cwd(),
    env: { ...env, PAIOS_DATA_DIR: dataDir, PAIOS_TOKEN: token, PAIOS_AGENT_NAME: "direct-mcp-integration-test" },
    stderr: "pipe"
  });
  const client = new Client({ name: "paios-direct-mcp-integration-test", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

test("real MCP stdio exposes scoped tools, resources and named batches", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-mcp-"));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverProcess: ChildProcess | undefined;
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  try {
    serverProcess = spawn(process.execPath, [serverEntry, "serve"], {
      cwd: process.cwd(),
      env: { ...process.env, PAIOS_DATA_DIR: dataDir, PAIOS_PORT: String(port), PAIOS_BIND: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let startupStderr = "";
    serverProcess.stderr?.on("data", (chunk: Buffer) => { startupStderr += chunk.toString(); });
    await waitForService(baseUrl, serverProcess, () => startupStderr);
    const token = readFileSync(join(dataDir, "mcp-token.txt"), "utf8").trim();
    ({ client, transport } = await connectMcp(baseUrl, token));

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    assert.ok(names.includes("tasks_get"));
    assert.ok(names.includes("capabilities_get"));
    assert.ok(names.includes("finance_account_entry_create"));
    assert.ok(names.includes("plans_get"));
    assert.ok(names.includes("plans_generate"));
    assert.ok(names.includes("task_recurrence_create"));
    assert.ok(names.includes("task_recurrence_update"));
    assert.ok(!names.includes("tasks_delete"));
    assert.ok(!names.includes("archive_delete"));
    assert.ok(!names.includes("confirmations_approve"));
    const expectedTools = [
      "today_get", "attention_get", "planning_context_get", "tasks_list", "tasks_get", "tasks_create", "tasks_update",
      "task_recurrences_list", "task_recurrence_check", "task_recurrence_create", "task_recurrence_update",
      "plans_get", "plans_generate", "plans_update", "period_plans_upsert", "projects_list", "projects_get", "projects_create", "projects_update",
      "project_workspace_update", "ideas_list", "ideas_create", "ideas_update", "finance_quick_preview",
      "finance_expense_create", "finance_accounts_list", "finance_account_entries_list", "finance_account_entry_create",
      "finance_expenses_list", "finance_incomes_list", "finance_income_create", "finance_summary", "finance_taxonomy",
      "health_get", "health_range", "health_put", "reviews_list", "reviews_get", "reviews_update",
      "reviews_daily_generate", "reviews_period_generate", "ideas_promote_to_task", "confirmations_list", "batch_run"
    ];
    for (const toolName of expectedTools) assert.ok(names.includes(toolName), `missing MCP tool: ${toolName}`);
    const ordinaryWriteTools = [
      "tasks_create", "tasks_update", "task_recurrence_check", "task_recurrence_create", "task_recurrence_update",
      "plans_generate", "plans_update", "period_plans_upsert", "projects_create", "projects_update", "project_workspace_update", "ideas_create", "ideas_update",
      "finance_expense_create", "finance_account_entry_create", "finance_income_create", "health_put", "reviews_update",
      "reviews_daily_generate", "reviews_period_generate"
    ];
    for (const toolName of ordinaryWriteTools) {
      const tool = tools.tools.find((item) => item.name === toolName);
      assert.ok(tool, `missing ordinary write tool: ${toolName}`);
      assert.ok(Object.prototype.hasOwnProperty.call(tool.inputSchema.properties ?? {}, "idempotency_key"), `missing idempotency_key: ${toolName}`);
    }
    const forbiddenFields = ["archive_requested", "archived", "approve", "restore", "purge"];
    for (const tool of tools.tools.filter((item) => ordinaryWriteTools.includes(item.name))) {
      for (const field of forbiddenFields) {
        assert.equal(Object.prototype.hasOwnProperty.call(tool.inputSchema.properties ?? {}, field), false, `${tool.name} exposes ${field}`);
      }
    }
    const ideasUpdate = tools.tools.find((tool) => tool.name === "ideas_update");
    assert.ok(ideasUpdate);
    assert.equal(Object.prototype.hasOwnProperty.call(ideasUpdate.inputSchema.properties ?? {}, "archive_requested"), false);
    const reviewsUpdate = tools.tools.find((tool) => tool.name === "reviews_update");
    assert.ok(reviewsUpdate);
    assert.equal(Object.prototype.hasOwnProperty.call(reviewsUpdate.inputSchema.properties ?? {}, "status"), false);
    const projectUpdate = tools.tools.find((tool) => tool.name === "projects_update");
    assert.ok(projectUpdate);
    assert.equal(Object.prototype.hasOwnProperty.call(projectUpdate.inputSchema.properties ?? {}, "row_version"), true);
    const statusEnum = (projectUpdate.inputSchema.properties as { status?: { enum?: string[] } } | undefined)?.status?.enum ?? [];
    assert.equal(statusEnum.includes("paused"), false);
    assert.equal(statusEnum.includes("abandoned"), false);
    assert.ok(statusEnum.includes("active"));

    const today = await client.readResource({ uri: "paios://today" });
    assert.equal(today.contents[0]?.mimeType, "application/json");
    const overview = await client.readResource({ uri: "paios://schema/overview" });
    const overviewData = jsonText(overview) as { entities: string[]; batch_tools: string[] };
    assert.ok(overviewData.entities.includes("tasks"));
    for (const toolName of ["tasks_create", "tasks_update", "plans_generate", "projects_create", "projects_update", "project_workspace_update", "ideas_create", "ideas_update", "finance_expense_create", "finance_account_entry_create", "finance_income_create", "health_put", "reviews_update", "reviews_daily_generate"]) {
      assert.ok(overviewData.batch_tools.includes(toolName), `missing batch MCP tool: ${toolName}`);
    }
    assert.equal(overviewData.batch_tools.includes("task_recurrence_create"), false);
    assert.equal(overviewData.batch_tools.includes("task_recurrence_update"), false);
    assert.equal(overviewData.batch_tools.includes("ideas_promote_to_task"), false);

    const projectResult = await client.callTool({ name: "projects_create", arguments: { name: "MCP 集成项目" } });
    const project = jsonText(projectResult) as { project: { id: string } };
    const projectResource = await client.readResource({ uri: `paios://projects/${project.project.id}` });
    assert.equal(jsonText(projectResource).project.id, project.project.id);

    const batch = await client.callTool({ name: "batch_run", arguments: { operations: [{ tool: "tasks_list", arguments: {} }, { tool: "not_registered", arguments: {} }] } });
    const batchData = jsonText(batch) as { operations: Array<{ ok: boolean; error?: { code: string } }> };
    assert.equal(batchData.operations[0]?.ok, true);
    assert.equal(batchData.operations[1]?.error?.code, "FORBIDDEN");

    await client.close();
    client = undefined;
    await transport?.close();
    transport = undefined;

    const readonlyResponse = await fetch(`${baseUrl}/api/v1/settings/agent-tokens`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "MCP 只读", preset: "readonly" }) });
    assert.equal(readonlyResponse.status, 201);
    const readonlyToken = (await readonlyResponse.json() as { token: { value: string } }).token.value;
    ({ client, transport } = await connectMcp(baseUrl, readonlyToken));
    const denied = await client.callTool({ name: "tasks_create", arguments: { title: "不应写入" } });
    assert.equal(denied.isError, true);
  } finally {
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    if (serverProcess && serverProcess.exitCode === null) {
      await new Promise<void>((resolvePromise) => {
        const timer = setTimeout(resolvePromise, 2_000);
        serverProcess?.once("exit", () => { clearTimeout(timer); resolvePromise(); });
        serverProcess?.kill();
      });
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("direct MCP opens the database without the HTTP service", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-direct-mcp-"));
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  try {
    openDatabase(dataDir).close();
    const token = readFileSync(join(dataDir, "mcp-token.txt"), "utf8").trim();
    ({ client, transport } = await connectDirectMcp(dataDir, token));

    const status = jsonText(await client.callTool({ name: "system_status", arguments: {} })) as { dataDir: string; database: string };
    assert.equal(status.database, "ok");
    assert.equal(status.dataDir, dataDir);

    const capabilities = jsonText(await client.callTool({ name: "capabilities_get", arguments: {} })) as { source: string; answer: string };
    assert.equal(capabilities.source, "capabilities_get");
    assert.match(capabilities.answer, /不能物理删除数据/);

    const created = jsonText(await client.callTool({ name: "tasks_create", arguments: { title: "直接 MCP 测试任务", idempotency_key: "direct-task-once" } })) as { task: { id: string; title: string } };
    assert.equal(created.task.title, "直接 MCP 测试任务");
    const repeated = jsonText(await client.callTool({ name: "tasks_create", arguments: { title: "不应重复创建", idempotency_key: "direct-task-once" } })) as { task: { id: string; title: string } };
    assert.equal(repeated.task.id, created.task.id);
    const verificationDb = openDatabase(dataDir);
    try {
      assert.equal((verificationDb.prepare("SELECT COUNT(*) AS count FROM tasks WHERE id = ?").get(created.task.id) as { count: number }).count, 1);
    } finally {
      verificationDb.close();
    }

    const generatedPlan = jsonText(await client.callTool({ name: "plans_generate", arguments: { date: "2026-08-31", idempotency_key: "direct-plan-once" } })) as { plan: { plan_date: string } };
    assert.equal(generatedPlan.plan.plan_date, "2026-08-31");
    const readPlan = jsonText(await client.callTool({ name: "plans_get", arguments: { date: "2026-08-31" } })) as { plan: { plan_date: string } };
    assert.equal(readPlan.plan.plan_date, "2026-08-31");

    const recurrenceCreated = jsonText(await client.callTool({
      name: "task_recurrence_create",
      arguments: {
        title_template: "每日 MCP 测试模板",
        description_template: "",
        content_template: "",
        start_date: "2026-08-31",
        rule: { frequency: "daily", interval: 1 },
        enabled: true
      }
    })) as { recurrence: { id: string; enabled: number; row_version: number } };
    assert.equal(recurrenceCreated.recurrence.enabled, true);

    const recurrenceUpdated = jsonText(await client.callTool({
      name: "task_recurrence_update",
      arguments: {
        recurrence_id: recurrenceCreated.recurrence.id,
        enabled: false,
        row_version: recurrenceCreated.recurrence.row_version
      }
    })) as { recurrence: { enabled: number } };
    assert.equal(recurrenceUpdated.recurrence.enabled, false);
  } finally {
    await client?.close().catch(() => undefined);
    await transport?.close().catch(() => undefined);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
