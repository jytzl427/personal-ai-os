import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@paios/db";
import { createApp } from "./app.js";

test("settings, conversations, archive and stats endpoints work together", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-system-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const key = await app.fetch(new Request("http://paios.local/api/v1/settings/api-key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: "test-key" }) }));
    assert.equal(key.status, 200);
    assert.equal((await key.json() as { configured: boolean }).configured, true);
    const invalidBackupRetention = await app.fetch(new Request("http://paios.local/api/v1/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "backup.retain": "invalid" }) }));
    assert.equal(invalidBackupRetention.status, 400);
    assert.equal((await invalidBackupRetention.json() as { error: { message: string } }).error.message, "INVALID_BACKUP_RETAIN");
    const excessiveBackupRetention = await app.fetch(new Request("http://paios.local/api/v1/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ "backup.retain": 4 }) }));
    assert.equal(excessiveBackupRetention.status, 400);
    const created = await app.fetch(new Request("http://paios.local/api/v1/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "测试对话" }) }));
    assert.equal(created.status, 201);
    const conversationId = (await created.json() as { conversation: { id: string } }).conversation.id;
    const sessionResponse = await app.fetch(new Request("http://paios.local/api/v1/system/ui-session"));
    assert.equal(sessionResponse.status, 200);
    const uiSession = (await sessionResponse.json() as { session: string }).session;
    const stats = await app.fetch(new Request("http://paios.local/api/v1/stats/finance"));
    assert.deepEqual(await stats.json(), { ok: true, available: false, domain: "finance", from: "", to: "", series: [] });
    const capabilities = await app.fetch(new Request("http://paios.local/api/v1/system/capabilities"));
    const capabilityData = await capabilities.json() as { answer: string; restrictions: string[] };
    assert.equal(capabilities.status, 200);
    assert.match(capabilityData.answer, /任务、周期任务/);
    assert.ok(capabilityData.restrictions.some((item) => item.includes("物理删除") || item.includes("删除")));
    const capabilityConversation = await app.fetch(new Request("http://paios.local/api/v1/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "能力回答测试" }) }));
    const capabilityConversationId = (await capabilityConversation.json() as { conversation: { id: string } }).conversation.id;
    const capabilityMessage = await app.fetch(new Request(`http://paios.local/api/v1/conversations/${capabilityConversationId}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "你能做什么？" }) }));
    assert.equal(capabilityMessage.status, 200);
    assert.match((await capabilityMessage.json() as { message: { content_text: string } }).message.content_text, /我可以读取/);
    const archived = await app.fetch(new Request(`http://paios.local/api/v1/conversations/${conversationId}/archive`, { method: "POST", headers: { "X-PAIOS-UI-Session": uiSession } }));
    assert.equal(archived.status, 200);
    const listed = await app.fetch(new Request("http://paios.local/api/v1/archive"));
    const archive = await listed.json() as { conversations: Array<{ id: string }> };
    assert.equal(archive.conversations.some((item) => item.id === conversationId), true);
    const restored = await app.fetch(new Request("http://paios.local/api/v1/archive/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity_type: "conversation", id: conversationId }) }));
    assert.equal(restored.status, 403);
    const restoredWithSession = await app.fetch(new Request("http://paios.local/api/v1/archive/restore", { method: "POST", headers: { "Content-Type": "application/json", "X-PAIOS-UI-Session": uiSession }, body: JSON.stringify({ entity_type: "conversation", id: conversationId }) }));
    assert.equal(restoredWithSession.status, 200);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
