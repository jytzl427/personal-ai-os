import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "@paios/db";
import { createApp } from "./app.js";

async function request(app: ReturnType<typeof createApp>, path: string, method: "GET" | "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>) {
  const response = await app.fetch(new Request(`http://paios.local${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { response, body: await response.json() as Record<string, any> };
}

test("finance entries can be standalone and be edited or deleted independently from accounts", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-finance-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const standalone = await request(app, "/api/v1/finance/expenses", "POST", { amount_cents: 1280, category_major: "日常消费", category_minor: "午餐", event: "午餐", occurred_date: "2026-08-28" });
    assert.equal(standalone.response.status, 201);
    assert.equal(standalone.body.expense.account_id, null);
    const expenseId = standalone.body.expense.id as string;
    const accountBefore = await request(app, "/api/v1/finance/accounts", "GET");
    const balanceBefore = accountBefore.body.accounts.find((row: Record<string, unknown>) => row.id === "love").current_balance_cents;
    const withIgnoredAccount = await request(app, "/api/v1/finance/expenses", "POST", { account_id: "love", amount_cents: 1000, category_major: "日常消费", category_minor: "饭费", event: "今日午饭", occurred_date: "2026-08-28" });
    assert.equal(withIgnoredAccount.response.status, 201);
    assert.equal(withIgnoredAccount.body.expense.account_id, null);
    assert.equal((await request(app, "/api/v1/finance/accounts", "GET")).body.accounts.find((row: Record<string, unknown>) => row.id === "love").current_balance_cents, balanceBefore);
    const edited = await request(app, `/api/v1/finance/expenses/${expenseId}`, "PATCH", { amount_cents: 1500, event: "午餐（编辑）" });
    assert.equal(edited.response.status, 200);
    assert.equal(edited.body.expense.amount_cents, 1500);
    assert.equal(edited.body.expense.event, "午餐（编辑）");
    const removed = await request(app, `/api/v1/finance/expenses/${expenseId}`, "DELETE");
    assert.equal(removed.response.status, 200);
    const accountAfter = await request(app, "/api/v1/finance/accounts", "GET");
    assert.equal(accountAfter.body.accounts.find((row: Record<string, unknown>) => row.id === "love").current_balance_cents, balanceBefore);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("account entries can be filtered by date, account and direction, and accounts can be deleted explicitly", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-finance-filter-"));
  const database = openDatabase(dataDir);
  const app = createApp({ database, config: { dataDir, bind: "127.0.0.1", port: 4738 } });
  try {
    const created = await request(app, "/api/v1/finance/accounts", "POST", { id: "filter-emergency", name: "紧急资金" });
    assert.equal(created.response.status, 201);
    await request(app, "/api/v1/finance/account-entries", "POST", { account_id: "filter-emergency", direction: "deposit", amount_cents: 1000, occurred_date: "2026-09-01" });
    await request(app, "/api/v1/finance/account-entries", "POST", { account_id: "filter-emergency", direction: "withdrawal", amount_cents: 200, occurred_date: "2026-09-03" });
    await request(app, "/api/v1/finance/account-entries", "POST", { account_id: "filter-emergency", direction: "deposit", amount_cents: 300, occurred_date: "2026-09-08" });

    const filtered = await request(app, "/api/v1/finance/account-entries?from=2026-09-01&to=2026-09-07&account_id=filter-emergency&direction=deposit", "GET");
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.body.entries.length, 1);
    assert.equal(filtered.body.entries[0].amount_cents, 1000);
    assert.equal((await request(app, "/api/v1/finance/account-entries?direction=invalid", "GET")).response.status, 400);

    const removed = await request(app, "/api/v1/finance/accounts/filter-emergency", "DELETE");
    assert.equal(removed.response.status, 200);
    assert.equal((await request(app, "/api/v1/finance/accounts", "GET")).body.accounts.some((row: Record<string, unknown>) => row.id === "filter-emergency"), false);
  } finally {
    database.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
