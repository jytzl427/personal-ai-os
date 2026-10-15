import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@paios/db";
import { createApp } from "./app.js";

test("butler chat uses the locally configured API key without putting it in the LLM body", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-butler-"));
  const received: { authorization?: string; body?: string } = {};
  const mock = createServer((request, response) => {
    received.authorization = request.headers.authorization;
    let body = "";
    request.on("data", (chunk) => { body += chunk.toString(); });
    request.on("end", () => {
      received.body = body;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "已读取本地摘要。" } }] }));
    });
  });
  await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
  const address = mock.address();
  assert.ok(address && typeof address !== "string");
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const keyResponse = await app.fetch(new Request("http://paios.local/api/v1/settings/api-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: "secret-not-in-db" })
    }));
    assert.equal(keyResponse.status, 200);
    const taskResponse = await app.fetch(new Request("http://paios.local/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "真实任务标题", content: "真实任务正文，不应被模型编造" })
    }));
    assert.equal(taskResponse.status, 201);
    const response = await app.fetch(new Request("http://paios.local/api/v1/butler/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: `http://127.0.0.1:${address.port}/v1`, model: "mock", messages: [{ role: "user", content: "今天怎么样？" }] })
    }));
    assert.equal(response.status, 200);
    const result = await response.json() as { ok: boolean; message: { content: string } };
    assert.equal(result.ok, true);
    assert.equal(result.message.content, "已读取本地摘要。");
    assert.equal(received.authorization, "Bearer secret-not-in-db");
    assert.equal(received.body?.includes("secret-not-in-db"), false);
    assert.equal(received.body?.includes('"tools"'), true);
    assert.equal(received.body?.includes("真实任务标题"), false);
    assert.equal(received.body?.includes("真实任务正文，不应被模型编造"), false);
    const audit = database.prepare("SELECT request_json FROM audit_logs ORDER BY at DESC LIMIT 1").get() as { request_json: string | null } | undefined;
    assert.equal(audit?.request_json, null);
  } finally {
    database.close();
    await new Promise<void>((resolve, reject) => mock.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
