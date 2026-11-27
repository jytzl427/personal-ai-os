import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAccountApp } from "./account-app.js";
import { createTestAccounts, makeAccountClient, MEMBER_CREDENTIALS } from "./account-test-support.js";
import { mockAiModel, type AiModel } from "./ai-model.js";
import { inspectAiWorker } from "./ai-runtime.js";
import { openDatabase, type PaiosDatabase } from "@paios/db";

type Client = ReturnType<typeof makeAccountClient>;
const mockScopes = ["tasks:read", "tasks:create", "tasks:note", "tasks:propose"];

function permissions(request: Client, cookie: string, scopes: string[]) {
  return request("/ai/permissions", { method: "PUT", cookie, body: { scopes } });
}

function chat(request: Client, cookie: string, prompt: string) {
  return request("/ai/chat", { method: "POST", cookie, body: { prompt } });
}

function approvalBody(ticket: { task_id: string; operation: string; due_date: string | null; challenge: string }) {
  return { task_id: ticket.task_id, operation: ticket.operation, due_date: ticket.due_date, challenge: ticket.challenge };
}

const onLinux = { skip: process.platform !== "linux" };

test("the same restricted account uses simulated AI tools and confirms each protected change exactly once", onLinux, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-ai-"));
  const ai = await createAccountApp({ dataDir, port: 4738, bind: "127.0.0.1" }, mockAiModel);
  try {
    const request = makeAccountClient(ai.app.fetch);
    const { ownerCookie, memberCookie, member } = await createTestAccounts(request, dataDir);
    assert.equal((await request("/account/users", { cookie: memberCookie })).response.status, 403);
    assert.deepEqual((await request("/ai/status", { cookie: memberCookie })).data.scopes, []);
    assert.equal((await chat(request, memberCookie, "查看今日待办")).response.status, 403);
    assert.equal((await permissions(request, memberCookie, ["tasks:read"])).response.status, 200);
    assert.match((await chat(request, memberCookie, "新增待办 Scope denied")).data.text, /缺少必要/);
    assert.equal((await permissions(request, memberCookie, mockScopes)).response.status, 200);
    assert.equal((await chat(request, ownerCookie, "查看今日待办")).response.status, 403);

    const created = await chat(request, memberCookie, "新增待办 合成测试待办");
    assert.equal(created.response.status, 200);
    assert.equal(created.data.mode, "mock");
    assert.match(created.data.text, /合成测试待办/);
    const listed = await chat(request, memberCookie, "查询待办 合成");
    assert.match(listed.data.text, /合成测试待办/);
    const ordinary = (await request("/tasks?q=" + encodeURIComponent("合成测试"), { cookie: memberCookie })).data.tasks[0];
    const note = await chat(request, memberCookie, "补备注 " + ordinary.id + " 合成备注");
    assert.equal(note.response.status, 200);
    assert.match((await request("/tasks/" + ordinary.id, { cookie: memberCookie })).data.task.description, /合成备注/);

    const ownerTask = (await request("/tasks", { method: "POST", cookie: ownerCookie, body: { title: "Owner isolated fixture", priority: "P0" } })).data.task;
    assert.match((await chat(request, memberCookie, "删除 " + ownerTask.id)).data.text, /没有该待办/);
    const important = (await request("/tasks", {
      method: "POST", cookie: memberCookie, body: { title: "Restricted important fixture", priority: "P0", due_date: "2027-01-02" }
    })).data.task;
    const details = () => request("/tasks/" + important.id, { cookie: memberCookie });
    const reschedule = await chat(request, memberCookie, "改期 " + important.id + " 2027-01-03");
    assert.equal(reschedule.response.status, 200);
    const first = reschedule.data.confirmations[0];
    assert.equal(first.operation, "reschedule");
    assert.equal(first.task_id, important.id);
    assert.equal((await details()).data.task.due_date, "2027-01-02");
    const apply = (ticket: typeof first, cookie = memberCookie, body = approvalBody(ticket)) => request(
      "/ai/confirmations/" + ticket.id + "/approve", { cookie, method: "POST", body }
    );
    await permissions(request, ownerCookie, mockScopes);
    assert.equal((await apply(first, ownerCookie)).response.status, 404);
    const newLogin = await request("/account/login", { method: "POST", body: MEMBER_CREDENTIALS });
    const newCookie = newLogin.response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(newCookie);
    assert.equal((await apply(first, newCookie)).response.status, 404);
    assert.equal((await apply(first, memberCookie, { ...approvalBody(first), task_id: ordinary.id })).response.status, 403);
    assert.equal((await apply(first, memberCookie, { ...approvalBody(first), operation: "delete" })).response.status, 403);
    assert.equal((await apply(first, memberCookie, { ...approvalBody(first), due_date: "2027-01-04" })).response.status, 403);
    assert.equal((await apply(first, memberCookie, { ...approvalBody(first), challenge: "0".repeat(64) })).response.status, 403);
    assert.equal((await apply(first)).response.status, 200);
    assert.equal((await details()).data.task.due_date, "2027-01-03");
    assert.equal((await apply(first)).response.status, 404);

    const stale = (await chat(request, memberCookie, "完成 " + important.id)).data.confirmations[0];
    assert.equal((await details()).data.task.status, "todo");
    assert.equal((await request("/tasks/" + important.id, {
      cookie: memberCookie, method: "PATCH", body: { title: "Edited important fixture" }
    })).response.status, 200);
    assert.equal((await apply(stale)).data.error.code, "STALE_VERSION");
    const complete = (await chat(request, memberCookie, "完成 " + important.id)).data.confirmations[0];
    assert.equal((await apply(complete)).response.status, 200);
    assert.equal((await details()).data.task.status, "done");

    const expiredAuthorization = (await chat(request, memberCookie, "删除 " + important.id)).data.confirmations[0];
    assert.equal((await details()).response.status, 200);
    await permissions(request, memberCookie, []);
    assert.equal((await apply(expiredAuthorization)).response.status, 403);
    await permissions(request, memberCookie, mockScopes);
    assert.equal((await apply(expiredAuthorization)).response.status, 404);
    const deletion = (await chat(request, memberCookie, "删除 " + important.id)).data.confirmations[0];
    assert.equal((await details()).response.status, 200);
    assert.equal((await apply(deletion)).response.status, 200);
    assert.equal((await details()).response.status, 404);
    assert.equal((await request("/tasks/" + ownerTask.id, { cookie: ownerCookie })).data.task.status, "todo");

    const audit = (await request("/audit", { cookie: memberCookie })).data.audit as Array<{ action: string; actor: string; request_json: string; entity_id: string }>;
    const actions = audit.filter((item) => item.action.startsWith("assistant."));
    assert.equal(actions.length, 5);
    for (const change of ["reschedule", "complete", "delete"]) {
      const row = actions.find((item) => item.action === "assistant.confirmed." + change);
      assert.ok(row);
      assert.equal(row.actor, "user");
      assert.equal(row.entity_id, important.id);
      assert.equal(JSON.parse(row.request_json).account_id, member.id);
      assert.doesNotMatch(row.request_json, /challenge/);
    }
  } finally {
    await ai.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("model text, disabled business tools and revoked permission cannot authorize a write", onLinux, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-ai-denied-"));
  const attempted: string[] = [];
  let started!: () => void;
  let resume!: () => void;
  const startedReply = new Promise<void>((resolve) => { started = resolve; });
  const continueReply = new Promise<void>((resolve) => { resume = resolve; });
  const testModel: AiModel = {
    mode: "mock",
    async reply(messages, tools) {
      assert.ok(tools.every((tool) => /^(today_get|tasks_)/.test(tool.name)));
      const last = messages.at(-1);
      if (last?.content === "Pause mock reply") {
        started();
        await continueReply;
        return { text: "", calls: [{ name: "tasks_create", id: "fixture-revoked", arguments: '{"title":"Revoked fixture"}' }] };
      }
      if (last?.role === "tool") {
        for (const item of messages.filter((message) => message.role === "tool")) {
          attempted.push(JSON.parse(item.content ?? "{}").error.code);
        }
        return { text: "Mock model claims the owner already confirmed completion.", calls: [] };
      }
      return {
        text: "",
        calls: ["system_status", "read_file", "system_shell", "confirmations_approve"].map((name, index) => ({
          name, id: "fixture-" + index, arguments: "{}"
        }))
      };
    }
  };
  const ai = await createAccountApp({ dataDir, port: 4738, bind: "127.0.0.1" }, testModel);
  try {
    const request = makeAccountClient(ai.app.fetch);
    const { memberCookie } = await createTestAccounts(request, dataDir);
    await permissions(request, memberCookie, mockScopes);
    const task = (await request("/tasks", { method: "POST", cookie: memberCookie, body: { title: "Synthetic important task", priority: "P1" } })).data.task;
    const reply = await chat(request, memberCookie, "Mock permission probe");
    assert.equal(reply.response.status, 200);
    assert.match(reply.data.text, /confirmed completion/);
    assert.deepEqual(reply.data.confirmations, []);
    assert.deepEqual(attempted, Array.from({ length: 4 }, () => "TOOL_FORBIDDEN"));
    assert.equal((await request("/tasks/" + task.id, { cookie: memberCookie })).data.task.status, "todo");
    assert.equal((await request("/butler/chat", { method: "POST", cookie: memberCookie, body: {} })).response.status, 403);
    assert.equal((await request("/settings/api-key", { cookie: memberCookie })).response.status, 403);
    const actual = chat(request, memberCookie, "Pause mock reply");
    await startedReply;
    assert.equal((await permissions(request, memberCookie, [])).response.status, 200);
    resume();
    assert.equal((await actual).data.error.code, "AI_GRANT_REQUIRED");
    assert.equal((await request("/tasks?q=Revoked", { cookie: memberCookie })).data.tasks.length, 0);
  } finally {
    resume();
    await ai.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the AI subprocess applies kernel syscall restrictions before receiving any work", onLinux, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-ai-kernel-"));
  try {
    const paths = ["synthetic-source.ts", "synthetic-admin-credential", "synthetic-backup.db"].map((file) => join(dataDir, file));
    for (const path of paths) writeFileSync(path, "fixture only", { mode: 0o600 });
    const database: PaiosDatabase = openDatabase(dataDir, { seedAgentToken: false });
    database.close();
    paths.push(join(dataDir, "paios.db"));
    assert.ok(paths.every((path) => readFileSync(path).length > 0));
    const parentStatus = readFileSync("/proc/self/status", "utf8");
    const child = await inspectAiWorker(paths);
    assert.match(child.status, /^NoNewPrivs:\s+1$/m);
    assert.match(child.status, /^Seccomp:\s+2$/m);
    assert.match(child.status, /^Threads:\s+1$/m);
    const filterCount = (status: string) => Number(/^Seccomp_filters:\s+(\d+)$/m.exec(status)?.[1]);
    assert.ok(filterCount(child.status) > filterCount(parentStatus));
    assert.deepEqual(child.reads_denied, [true, true, true, true]);
    assert.equal(child.network_denied, true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
