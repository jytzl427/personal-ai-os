import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createTestAccounts, makeAccountClient } from "./account-test-support.js";

const serverEntry = join(dirname(fileURLToPath(import.meta.url)), "main.js");

async function freePort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

async function startApp(dataDir: string, port: number): Promise<ChildProcess> {
  const processHandle = spawn(process.execPath, [serverEntry, "serve"], {
    env: { ...process.env, PAIOS_DATA_DIR: dataDir, PAIOS_PORT: String(port), PAIOS_BIND: "127.0.0.1" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  processHandle.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch("http://127.0.0.1:" + port + "/api/v1/account/session").catch(() => undefined);
    if (response?.ok) return processHandle;
    if (processHandle.exitCode !== null) break;
    await delay(50);
  }
  await stopApp(processHandle);
  throw new Error("MCP test server could not start: " + stderr);
}

async function stopApp(processHandle?: ChildProcess) {
  if (!processHandle || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  const exited = once(processHandle, "exit");
  processHandle.kill();
  const timer = setTimeout(() => { processHandle.kill("SIGKILL"); }, 3000);
  try { await exited; } finally { clearTimeout(timer); }
}

function accountHttp(port: number) {
  return makeAccountClient(async (request) => {
    const url = new URL(request.url);
    return fetch("http://127.0.0.1:" + port + url.pathname + url.search, {
      method: request.method, headers: request.headers,
      body: request.body ? await request.text() : undefined
    });
  });
}

async function connectMcp(dataDir: string, port: number, token: string, command = "mcp") {
  const client = new Client({ name: "paios-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry, command],
    env: { PAIOS_DATA_DIR: dataDir, PAIOS_BIND: "127.0.0.1", PAIOS_PORT: String(port), PAIOS_URL: "http://127.0.0.1:" + port, PAIOS_TOKEN: token },
    stderr: "pipe"
  });
  await client.connect(transport);
  return client;
}

function responseBody(result: unknown): any {
  const value = result as { content?: Array<{ text?: string }>; contents?: Array<{ text?: string }> };
  const text = value.content?.[0]?.text ?? value.contents?.[0]?.text;
  assert.ok(text);
  return JSON.parse(text);
}

async function invoke(client: Client, name: string, input: Record<string, unknown> = {}) {
  return responseBody(await client.callTool({ name, arguments: input }));
}

async function grant(request: ReturnType<typeof accountHttp>, cookie: string, scopes: string[]) {
  const response = await request("/account/mcp/grants", { cookie, method: "POST", body: { name: "Synthetic connection", scopes } });
  assert.equal(response.response.status, 201);
  return { id: response.data.grant.id as string, token: response.data.token as string };
}

test("stdio verifies account scopes and ownership on every call and revokes live sessions independently", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-mcp-accounts-"));
  const port = await freePort();
  let server: ChildProcess | undefined;
  const clients: Client[] = [];
  try {
    server = await startApp(dataDir, port);
    const request = accountHttp(port);
    const { ownerCookie, memberCookie, member } = await createTestAccounts(request, dataDir);
    assert.equal((await request("/account/mcp/grants", { cookie: memberCookie })).data.grants.length, 0);
    assert.equal((await request("/mcp/tools", { cookie: memberCookie })).response.status, 401);
    const invalid = await connectMcp(dataDir, port, "paios_legacy_fixture");
    clients.push(invalid);
    await assert.rejects(invalid.listTools(), /INVALID_GRANT/);

    const ownerGrant = await grant(request, ownerCookie, ["tasks:read"]);
    const memberGrant = await grant(request, memberCookie, ["tasks:read", "tasks:create", "tasks:note"]);
    assert.equal((await request("/account/mcp/grants/" + memberGrant.id + "/revoke", { cookie: ownerCookie, method: "POST" })).response.status, 404);
    assert.equal((await request("/account/mcp/grants", { cookie: ownerCookie })).data.grants.length, 1);

    const owner = await connectMcp(dataDir, port, ownerGrant.token);
    const agent = await connectMcp(dataDir, port, memberGrant.token);
    clients.push(owner, agent);
    assert.deepEqual((await owner.listTools()).tools.map((tool) => tool.name), ["today_get", "tasks_list", "tasks_get"]);
    assert.deepEqual((await agent.listTools()).tools.map((tool) => tool.name), ["today_get", "tasks_list", "tasks_get", "tasks_create", "tasks_append_note"]);
    assert.equal(responseBody(await owner.readResource({ uri: "paios://today" })).timezone, "Asia/Shanghai");
    assert.equal((await invoke(owner, "tasks_create", { title: "Denied" })).error.code, "SCOPE_REQUIRED");
    assert.equal((await invoke(agent, "system_status")).error.code, "TOOL_FORBIDDEN");
    assert.equal((await invoke(agent, "tasks_create", { title: "Denied", owner_id: "local", priority: "P0" })).error.code, "INVALID_ARGUMENTS");

    const ownerTask = (await request("/tasks", { cookie: ownerCookie, method: "POST", body: { title: "Owner synthetic task" } })).data.task;
    assert.equal((await invoke(agent, "tasks_get", { id: ownerTask.id })).error.code, "TASK_NOT_FOUND");
    assert.equal((await invoke(agent, "tasks_append_note", { id: ownerTask.id, note: "Denied" })).error.code, "TASK_NOT_FOUND");
    assert.deepEqual((await invoke(agent, "tasks_list", { q: "Owner synthetic" })).tasks, []);
    const created = await invoke(agent, "tasks_create", { title: "Member synthetic task", due_date: "2027-01-02", idempotency_key: "create-1" });
    assert.equal(created.task.status, "todo");
    assert.equal(created.task.priority, "P2");
    assert.equal((await invoke(owner, "tasks_get", { id: created.task.id })).error.code, "TASK_NOT_FOUND");
    const note = { id: created.task.id, note: "Synthetic note", idempotency_key: "note-1" };
    assert.equal((await invoke(agent, "tasks_append_note", note)).task.description, "Synthetic note");
    assert.equal((await invoke(agent, "tasks_append_note", note)).task.description, "Synthetic note");
    assert.equal((await invoke(agent, "tasks_append_note", { ...note, note: "Different note" })).error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal((await request("/account/mcp/activity", { cookie: memberCookie })).data.activity.length, 2);
    assert.deepEqual((await request("/account/mcp/activity", { cookie: ownerCookie })).data.activity, []);
    assert.equal((await request("/api-does-not-exist", { headers: { Authorization: "Bearer " + memberGrant.token } })).response.status, 401);

    assert.equal((await request("/account/mcp/grants/" + memberGrant.id + "/revoke", { cookie: memberCookie, method: "POST" })).response.status, 200);
    assert.equal((await invoke(agent, "tasks_append_note", note)).error.code, "INVALID_GRANT");
    await assert.rejects(agent.listTools(), /INVALID_GRANT/);
    assert.equal((await invoke(owner, "tasks_get", { id: ownerTask.id })).task.id, ownerTask.id);

    const laterGrant = await grant(request, memberCookie, ["tasks:read"]);
    const later = await connectMcp(dataDir, port, laterGrant.token);
    clients.push(later);
    assert.equal((await request("/account/users/" + member.id + "/disable", { cookie: ownerCookie, method: "POST" })).response.status, 200);
    assert.equal((await invoke(later, "tasks_list")).error.code, "INVALID_GRANT");
    assert.equal((await invoke(owner, "tasks_get", { id: ownerTask.id })).task.id, ownerTask.id);
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await stopApp(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("direct stdio works offline and rechecks revocation while connected across server restarts", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-mcp-direct-"));
  const port = await freePort();
  let server: ChildProcess | undefined;
  let client: Client | undefined;
  try {
    server = await startApp(dataDir, port);
    const request = accountHttp(port);
    const { memberCookie, member } = await createTestAccounts(request, dataDir);
    const issued = await grant(request, memberCookie, ["tasks:read", "tasks:create"]);
    await stopApp(server);
    client = await connectMcp(dataDir, port, issued.token, "mcp-direct");
    const created = await invoke(client, "tasks_create", { title: "Offline synthetic task", idempotency_key: "offline-1" });
    assert.equal(created.task.title, "Offline synthetic task");
    const pending = join(dataDir, ".accounts", member.id, "restore.pending.db");
    writeFileSync(pending, "Synthetic pending marker");
    try {
      assert.equal((await invoke(client, "tasks_get", { id: created.task.id })).error.code, "PENDING_RESTORE");
    } finally {
      unlinkSync(pending);
    }

    server = await startApp(dataDir, port);
    assert.equal((await invoke(client, "tasks_get", { id: created.task.id })).task.id, created.task.id);
    assert.equal((await request("/account/mcp/grants/" + issued.id + "/revoke", { cookie: memberCookie, method: "POST" })).response.status, 200);
    assert.equal((await invoke(client, "tasks_get", { id: created.task.id })).error.code, "INVALID_GRANT");
    await stopApp(server);
    assert.equal((await invoke(client, "tasks_get", { id: created.task.id })).error.code, "INVALID_GRANT");
  } finally {
    await client?.close();
    await stopApp(server);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
