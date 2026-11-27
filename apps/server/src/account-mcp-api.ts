import type { PaiosDatabase } from "@paios/db";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { AccountContext } from "./account-app.js";
import type { AccountStore } from "./accounts.js";
import { bearerToken } from "./auth.js";
import type { ServerConfig } from "./config.js";
import { executeLocalTaskTool, listLocalTaskTools, missingGrant, ToolError } from "./local-task-tools.js";
import { McpGrants, mcpGrantSchema } from "./mcp-grants.js";

export function toolFailure(c: Context, error: unknown): Response {
  if (error instanceof ToolError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status);
  throw error;
}

function clientSetup(config: ServerConfig, token: string) {
  const desktop = process.env.PAIOS_MCP_COMMAND;
  if (desktop) return { command: desktop, args: ["--mcp"], env: { PAIOS_TOKEN: token } };
  const entry = resolve(process.argv[1] ?? "apps/server/dist/main.js");
  if (entry.endsWith(".ts")) return {
    command: "pnpm", args: ["--dir", resolve(dirname(entry), "../../.."), "mcp"],
    env: { PAIOS_TOKEN: token, PAIOS_URL: "http://127.0.0.1:" + config.port }
  };
  return {
    command: process.execPath, args: [entry, "mcp-direct"],
    env: { PAIOS_TOKEN: token, PAIOS_DATA_DIR: config.dataDir, PAIOS_PORT: String(config.port) }
  };
}

export function checkPendingRestore(dataDir: string): void {
  if (existsSync(join(dataDir, "restore.pending.db"))) {
    throw new ToolError(409, "PENDING_RESTORE", "请先重启服务以完成当前账号的数据恢复");
  }
}

export function mountAccountMcpApi(
  app: Hono<AccountContext>, config: ServerConfig, accounts: AccountStore,
  runtimeFor: (id: string) => Promise<{ database: PaiosDatabase; config: ServerConfig }>
): void {
  const grants = new McpGrants(accounts);
  const humanPrefix = "/api/v1/account/mcp";
  app.use(humanPrefix + "/*", async (c, next) => {
    if (!c.get("human")) return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "请先登录" } }, 401);
    await next();
  });
  app.get(humanPrefix + "/grants", (c) => c.json({ ok: true, grants: grants.list(c.get("human")!.account.id) }));
  app.post(humanPrefix + "/grants", async (c) => {
    const input = mcpGrantSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "请选择明确的 MCP 授权范围" } }, 400);
    const human = accounts.sessionByHash(c.get("human")!.sessionHash);
    if (!human) return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "登录已失效" } }, 401);
    const result = grants.create(human.account.id, input.data.name, input.data.scopes);
    return c.json({ ok: true, ...result, setup: clientSetup(config, result.token) }, 201);
  });
  app.post(humanPrefix + "/grants/:id/revoke", (c) => {
    if (!grants.revoke(c.get("human")!.account.id, c.req.param("id") ?? "")) {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "此账号没有该授权" } }, 404);
    }
    return c.json({ ok: true });
  });
  app.post(humanPrefix + "/grants/:id/rotate", (c) => {
    const result = grants.rotate(c.get("human")!.account.id, c.req.param("id") ?? "");
    if (!result) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "此账号没有该有效授权" } }, 404);
    return c.json({ ok: true, ...result, setup: clientSetup(config, result.token) }, 201);
  });
  app.post(humanPrefix + "/grants/check", async (c) => {
    const input = await c.req.json().catch(() => undefined) as { token?: unknown } | undefined;
    const human = accounts.sessionByHash(c.get("human")!.sessionHash);
    const principal = typeof input?.token === "string" ? grants.authenticate(input.token) : undefined;
    if (!human || principal?.account.id !== human.account.id || !principal) {
      return c.json({ ok: false, error: { code: "NOT_FOUND", message: "此账号没有该有效授权" } }, 404);
    }
    return c.json({ ok: true, tool_count: listLocalTaskTools(principal).length });
  });
  app.get(humanPrefix + "/activity", async (c) => {
    const human = c.get("human")!;
    const { database } = await runtimeFor(human.account.id);
    if (!accounts.sessionByHash(human.sessionHash)) return c.json({ ok: false, error: { code: "UNAUTHORIZED", message: "登录已失效" } }, 401);
    return c.json({ ok: true, activity: database.prepare(
      "SELECT at, tool_name, agent_name FROM audit_logs WHERE action LIKE 'mcp.%' ORDER BY at DESC LIMIT 20"
    ).all() });
  });

  const toolPrefix = "/api/v1/mcp/tools";
  app.use(toolPrefix + "/*", bodyLimit({ maxSize: 16384 }));
  app.get(toolPrefix, (c) => {
    try {
      const principal = grants.authenticate(bearerToken(c));
      if (!principal) throw missingGrant();
      return c.json({ ok: true, tools: listLocalTaskTools(principal) });
    } catch (error) {
      return toolFailure(c, error);
    }
  });
  app.post(toolPrefix + "/:name", async (c) => {
    const token = bearerToken(c);
    try {
      const admitted = grants.authenticate(token);
      if (!admitted) throw missingGrant();
      const input = await c.req.json().catch(() => undefined);
      const { database, config: accountConfig } = await runtimeFor(admitted.account.id);
      const principal = grants.authenticate(token);
      if (!principal) throw missingGrant();
      checkPendingRestore(accountConfig.dataDir);
      const result = executeLocalTaskTool(database, principal, c.req.param("name") ?? "", input);
      return c.json({ ok: true, result });
    } catch (error) {
      return toolFailure(c, error);
    }
  });
}
