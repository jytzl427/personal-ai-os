import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Account } from "./accounts.js";
import { setupCodePath } from "./accounts.js";

type RequestHandler = (request: Request) => Response | Promise<Response>;
export const OWNER_CREDENTIALS = { username: "test-owner", password: "fixture-only-owner-password" };
export const MEMBER_CREDENTIALS = { username: "test-member", password: "fixture-only-member-password" };

export function makeAccountClient(handler: RequestHandler) {
  return async (path: string, options: {
    method?: string; body?: unknown; cookie?: string; headers?: HeadersInit;
  } = {}) => {
    const headers = new Headers(options.headers);
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.cookie) headers.set("Cookie", options.cookie);
    const response = await handler(new Request("http://paios.test/api/v1" + path, {
      method: options.method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body)
    }));
    return { response, data: await response.json() };
  };
}

export async function createTestAccounts(request: ReturnType<typeof makeAccountClient>, dataDir: string) {
  const setup = await request("/account/setup", {
    method: "POST", body: { ...OWNER_CREDENTIALS, setup_code: readFileSync(setupCodePath(dataDir), "utf8").trim() }
  });
  assert.equal(setup.response.status, 200);
  const ownerCookie = setup.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(ownerCookie);
  const creation = await request("/account/users", { method: "POST", cookie: ownerCookie, body: MEMBER_CREDENTIALS });
  assert.equal(creation.response.status, 201);
  const login = await request("/account/login", { method: "POST", body: MEMBER_CREDENTIALS });
  assert.equal(login.response.status, 200);
  const memberCookie = login.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(memberCookie);
  return { ownerCookie, memberCookie, member: creation.data.account as Account };
}
