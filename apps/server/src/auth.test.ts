import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@paios/db";
import { createApp } from "./app.js";

function agentHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-PAIOS-Agent-Transport": "mcp",
    "X-Agent-Name": "auth-test"
  };
}

test("MCP authentication enforces token validity and scope", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-auth-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const seedToken = readFileSync(join(dataDir, "mcp-token.txt"), "utf8").trim();
    const missing = await app.fetch(new Request("http://paios.local/api/v1/system/status", { headers: { "X-PAIOS-Agent-Transport": "mcp" } }));
    assert.equal(missing.status, 401);
    const invalid = await app.fetch(new Request("http://paios.local/api/v1/system/status", { headers: agentHeaders("paios_invalid") }));
    assert.equal(invalid.status, 401);
    const valid = await app.fetch(new Request("http://paios.local/api/v1/system/status", { headers: agentHeaders(seedToken) }));
    assert.equal(valid.status, 200);

    const guardedTask = await app.fetch(new Request("http://paios.local/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Agent 护栏测试" })
    }));
    const guardedTaskId = (await guardedTask.json() as { task: { id: string } }).task.id;
    const archiveAttempt = await app.fetch(new Request(`http://paios.local/api/v1/tasks/${guardedTaskId}`, {
      method: "PATCH",
      headers: { ...agentHeaders(seedToken), "Content-Type": "application/json" },
      body: JSON.stringify({ archive_requested: true })
    }));
    assert.equal(archiveAttempt.status, 403);
    const humanArchived = await app.fetch(new Request("http://paios.local/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "人工归档护栏" })
    }));
    const humanArchivedTask = (await humanArchived.json() as { task: { id: string; row_version: number } }).task;
    const markForArchive = await app.fetch(new Request(`http://paios.local/api/v1/tasks/${humanArchivedTask.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archive_requested: true, row_version: humanArchivedTask.row_version })
    }));
    assert.equal(markForArchive.status, 200);
    const triggerArchive = await app.fetch(new Request(`http://paios.local/api/v1/tasks/${humanArchivedTask.id}`, {
      method: "PATCH",
      headers: { ...agentHeaders(seedToken), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done", row_version: humanArchivedTask.row_version + 1 })
    }));
    assert.equal(triggerArchive.status, 403);
    assert.equal((database.prepare("SELECT archived_at FROM tasks WHERE id = ?").get(humanArchivedTask.id) as { archived_at: string | null }).archived_at, null);
    const deleteAttempt = await app.fetch(new Request(`http://paios.local/api/v1/tasks/${guardedTaskId}`, { method: "DELETE", headers: agentHeaders(seedToken) }));
    assert.equal(deleteAttempt.status, 403);
    const importAttempt = await app.fetch(new Request("http://paios.local/api/v1/imports/commit", {
      method: "POST",
      headers: { ...agentHeaders(seedToken), "Content-Type": "application/json" },
      body: JSON.stringify({})
    }));
    assert.equal(importAttempt.status, 403);
    const planConfirmAttempt = await app.fetch(new Request("http://paios.local/api/v1/plans/2026-08-31/confirm", {
      method: "POST",
      headers: { ...agentHeaders(seedToken), "Content-Type": "application/json" },
      body: JSON.stringify({})
    }));
    assert.equal(planConfirmAttempt.status, 403);
    database.prepare("INSERT INTO reviews (id, review_type, period_start, period_end, status, content_json, created_at, updated_at) VALUES ('guarded-review', 'daily', '2026-08-31', '2026-08-31', 'draft', '{}', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
    const finalizeAttempt = await app.fetch(new Request("http://paios.local/api/v1/reviews/guarded-review", {
      method: "PATCH",
      headers: { ...agentHeaders(seedToken), "Content-Type": "application/json" },
      body: JSON.stringify({ status: "finalized" })
    }));
    assert.equal(finalizeAttempt.status, 403);

    const created = await app.fetch(new Request("http://paios.local/api/v1/settings/agent-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "只读测试", preset: "readonly" })
    }));
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { token: { id: string; value: string } };
    const readOnlyToken = createdBody.token.value;
    const agentSession = await app.fetch(new Request("http://paios.local/api/v1/system/ui-session", { headers: agentHeaders(readOnlyToken) }));
    assert.equal(agentSession.status, 403);

    const connection = await app.fetch(new Request("http://paios.local/api/v1/settings/agent-tokens/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: readOnlyToken })
    }));
    assert.equal(connection.status, 200);
    const connectionBody = await connection.json() as { connection: { service: string; readable_tool_count: number; writable_tool_count: number; timezone: string } };
    assert.equal(connectionBody.connection.service, "ok");
    assert.ok(connectionBody.connection.readable_tool_count > 0);
    assert.equal(connectionBody.connection.writable_tool_count, 0);
    assert.equal(connectionBody.connection.timezone, "Asia/Shanghai");
    const activity = await app.fetch(new Request("http://paios.local/api/v1/settings/agent-tokens/activity"));
    assert.equal(activity.status, 200);

    const read = await app.fetch(new Request("http://paios.local/api/v1/tasks", { headers: agentHeaders(readOnlyToken) }));
    assert.equal(read.status, 200);
    const batchBypass = await app.fetch(new Request("http://paios.local/api/v1/batch", {
      method: "POST",
      headers: { ...agentHeaders(readOnlyToken), "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [{ method: "GET", path: "/api/v1/tasks" }] })
    }));
    assert.equal(batchBypass.status, 403);
    const write = await app.fetch(new Request("http://paios.local/api/v1/tasks", {
      method: "POST",
      headers: { ...agentHeaders(readOnlyToken), "Content-Type": "application/json" },
      body: JSON.stringify({ title: "不应创建" })
    }));
    assert.equal(write.status, 403);
    const manage = await app.fetch(new Request("http://paios.local/api/v1/settings/agent-tokens", { headers: agentHeaders(readOnlyToken) }));
    assert.equal(manage.status, 403);

    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const expiring = await app.fetch(new Request("http://paios.local/api/v1/settings/agent-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "轮换过期测试", preset: "readonly", expires_at: expiresAt })
    }));
    assert.equal(expiring.status, 201);
    const expiringBody = await expiring.json() as { token: { id: string; value: string; expires_at: string } };
    assert.equal(expiringBody.token.expires_at, expiresAt);
    const rotated = await app.fetch(new Request(`http://paios.local/api/v1/settings/agent-tokens/${expiringBody.token.id}/rotate`, { method: "POST" }));
    assert.equal(rotated.status, 201);
    const rotatedBody = await rotated.json() as { token: { id: string; value: string; expires_at: string } };
    assert.equal(rotatedBody.token.expires_at, expiresAt);
    const expiredNow = await app.fetch(new Request("http://paios.local/api/v1/tasks", { headers: agentHeaders(rotatedBody.token.value) }));
    assert.equal(expiredNow.status, 200);
    database.prepare("UPDATE api_tokens SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1_000).toISOString(), rotatedBody.token.id);
    const afterExpiry = await app.fetch(new Request("http://paios.local/api/v1/tasks", { headers: agentHeaders(rotatedBody.token.value) }));
    assert.equal(afterExpiry.status, 401);

    const revoked = await app.fetch(new Request(`http://paios.local/api/v1/settings/agent-tokens/${createdBody.token.id}/revoke`, { method: "POST" }));
    assert.equal(revoked.status, 200);
    const afterRevoke = await app.fetch(new Request("http://paios.local/api/v1/tasks", { headers: agentHeaders(readOnlyToken) }));
    assert.equal(afterRevoke.status, 401);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
