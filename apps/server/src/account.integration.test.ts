import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { openAccountRegistryDatabase, openDatabase, type PaiosDatabase } from "@paios/db";
import { createAccountApp } from "./account-app.js";
import { createTestAccounts, makeAccountClient, MEMBER_CREDENTIALS } from "./account-test-support.js";
import { setupCodePath } from "./accounts.js";

const taskTitle = "Synthetic legacy cross-year task";
const dueDate = "2027-01-02";

function databaseDigest(path: string): string {
  const database = openAccountRegistryDatabase(path);
  try {
    return createHash("sha256").update(database.serialize()).digest("hex");
  } finally {
    database.close();
  }
}

test("isolates two local accounts and restores a cross-year task from a legacy database copy", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-accounts-"));
  let instance: Awaited<ReturnType<typeof createAccountApp>> | undefined;
  try {
    let legacyId = "legacy-cross-year";
    const realFixture = process.env.PAIOS_TEST_LEGACY_COPY;
    if (realFixture) {
      cpSync(realFixture, dataDir, { recursive: true });
      legacyId = (JSON.parse(readFileSync(join(dataDir, "fixture.json"), "utf8")) as { id: string }).id;
    } else {
      const database: PaiosDatabase = openDatabase(dataDir);
      const oldTime = "2026-12-29T00:00:00.000Z";
      database.prepare("INSERT INTO tasks (id, title, status, due_date, created_at, updated_at, archived_at) VALUES (?, ?, 'todo', ?, ?, ?, ?)").run(
        legacyId, taskTitle, dueDate, oldTime, oldTime, oldTime
      );
      database.close();
    }
    assert.equal(existsSync(join(dataDir, ".accounts")), false);
    instance = await createAccountApp({ dataDir, bind: "127.0.0.1", port: 4738 });
    const request = makeAccountClient(instance.app.fetch);

    assert.equal((await request("/tasks", { headers: { "X-PAIOS-Account": "local" } })).response.status, 401);
    const incorrectSetup = await request("/account/setup", {
      method: "POST", body: { username: "test-owner", password: "fixture-only-owner-password", setup_code: "0".repeat(48) }
    });
    assert.equal(incorrectSetup.response.status, 403);

    const { ownerCookie, memberCookie, member } = await createTestAccounts(request, dataDir);
    assert.equal(existsSync(setupCodePath(dataDir)), false);
    assert.equal((await request("/account/users", { cookie: memberCookie })).response.status, 403);
    assert.equal((await request("/account/users", { method: "POST", cookie: memberCookie, body: MEMBER_CREDENTIALS })).response.status, 403);
    assert.equal((await request("/account/users/local/disable", { method: "POST", cookie: ownerCookie })).response.status, 409);

    const memberTask = await request("/tasks", { method: "POST", cookie: memberCookie, body: {
      title: "Synthetic member task", due_date: dueDate, owner_id: "local"
    } });
    assert.equal(memberTask.response.status, 201);
    const memberId = memberTask.data.task.id as string;
    const memberProject = await request("/projects", { method: "POST", cookie: memberCookie, body: { name: "Synthetic member project" } });
    assert.equal(memberProject.response.status, 201);
    assert.equal((await request("/projects/" + memberProject.data.project.id, { cookie: ownerCookie })).response.status, 404);
    assert.equal((await request("/tasks/" + memberId, { cookie: ownerCookie })).response.status, 404);
    assert.equal((await request("/tasks/" + memberId, { method: "PATCH", cookie: ownerCookie, body: { title: "other" } })).response.status, 404);
    assert.equal((await request("/tasks", {
      method: "POST", cookie: ownerCookie, body: { title: "foreign parent", parent_id: memberId }
    })).response.status, 404);
    assert.equal((await request("/tasks?q=synthetic%20member", { cookie: ownerCookie })).data.tasks.length, 0);
    assert.equal((await request("/tasks?q=synthetic%20member", { cookie: memberCookie })).data.tasks[0].id, memberId);

    const ownerUi = (await request("/system/ui-session", { cookie: ownerCookie })).data.session;
    const memberUi = (await request("/system/ui-session", { cookie: memberCookie })).data.session;
    assert.notEqual(ownerUi, memberUi);
    assert.equal((await request("/archive/restore", {
      method: "POST", cookie: memberCookie, headers: { "X-PAIOS-UI-Session": memberUi }, body: { id: legacyId, entity_type: "task" }
    })).response.status, 404);
    const memberFile = join(dataDir, ".accounts", member.id, "paios.db");
    const beforeRestore = databaseDigest(memberFile);

    const restore = await request("/archive/restore", {
      method: "POST", cookie: ownerCookie, headers: { "X-PAIOS-UI-Session": ownerUi }, body: { id: legacyId, entity_type: "task", owner_id: member.id }
    });
    assert.equal(restore.response.status, 200);
    const restored = await request("/tasks/" + legacyId, { cookie: ownerCookie });
    assert.equal(restored.data.task.title, taskTitle);
    assert.equal(restored.data.task.due_date, dueDate);
    assert.equal(restored.data.task.archived_at, null);
    assert.equal(databaseDigest(memberFile), beforeRestore);
    assert.equal((await request("/tasks/" + legacyId, { cookie: memberCookie })).response.status, 404);
    assert.equal((await request("/tasks?q=legacy%20cross-year", { cookie: memberCookie })).data.tasks.length, 0);

    const requested = await request("/system/export", { method: "POST", cookie: ownerCookie, headers: { "X-PAIOS-UI-Session": ownerUi } });
    assert.equal(requested.response.status, 202);
    const approvalPath = "/confirmations/" + requested.data.confirmation.id + "/approve";
    assert.equal((await request(approvalPath, { method: "POST", cookie: memberCookie, headers: { "X-PAIOS-UI-Session": memberUi } })).response.status, 404);
    const approval = await request(approvalPath, { method: "POST", cookie: ownerCookie, headers: { "X-PAIOS-UI-Session": ownerUi } });
    assert.equal(approval.response.status, 200);
    const exportPath = "/system/exports/" + basename(approval.data.result.exportPath);
    const exported = await request(exportPath, { cookie: ownerCookie });
    assert.equal(exported.response.status, 200);
    assert.equal(exported.data.tasks.some((task: { id: string }) => task.id === legacyId), true);
    assert.equal(exported.data.tasks.some((task: { id: string }) => task.id === memberId), false);
    assert.equal((await request(exportPath, { cookie: memberCookie })).response.status, 404);

    assert.equal((await request("/account/users/" + member.id + "/disable", { method: "POST", cookie: ownerCookie })).response.status, 200);
    assert.equal((await request("/tasks/" + memberId, { cookie: memberCookie })).response.status, 401);
    assert.equal((await request("/account/login", { method: "POST", body: MEMBER_CREDENTIALS })).response.status, 401);
    assert.equal((await request("/tasks/" + legacyId, { cookie: ownerCookie })).response.status, 200);
  } finally {
    await instance?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
