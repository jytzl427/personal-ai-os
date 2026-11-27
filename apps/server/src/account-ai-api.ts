import type { PaiosDatabase } from "@paios/db";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AccountContext } from "./account-app.js";
import { checkPendingRestore, toolFailure } from "./account-mcp-api.js";
import type { AccountStore, HumanSession } from "./accounts.js";
import { AiConfirmations, applyConfirmationSchema, proposalScope, proposalTool, type Confirmation } from "./ai-confirmations.js";
import type { AiModel } from "./ai-model.js";
import { aiWorkerInstalled, runAiWorker } from "./ai-runtime.js";
import type { ServerConfig } from "./config.js";
import { executeLocalTaskTool, listLocalTaskTools, taskScopeSchema, ToolError, type ToolPrincipal } from "./local-task-tools.js";

const scope = z.enum([...taskScopeSchema.options, proposalScope]);
const permissions = z.object({ scopes: z.array(scope).max(scope.options.length) }).strict();
const promptSchema = z.object({ prompt: z.string().trim().min(1).max(4000) }).strict();
type Scope = z.infer<typeof scope>;
type Grant = { id: string; scopes: Scope[] };

function signInRequired() {
  return new ToolError(401, "UNAUTHORIZED", "请先登录");
}

function consentRequired() {
  return new ToolError(403, "AI_GRANT_REQUIRED", "请先授权当前账号的 AI 待办权限");
}

class AiGrants {
  constructor(private readonly accounts: AccountStore) {
    accounts.database.exec(
      "CREATE TABLE IF NOT EXISTS ai_grants (account_id TEXT PRIMARY KEY REFERENCES accounts(id), id TEXT NOT NULL, scopes_json TEXT NOT NULL);"
    );
  }

  get(accountId: string): Grant | undefined {
    const row = this.accounts.database.prepare("SELECT id, scopes_json FROM ai_grants WHERE account_id = ?")
      .get(accountId) as { id: string; scopes_json: string } | undefined;
    if (!row) return undefined;
    const scopes = z.array(scope).parse(JSON.parse(row.scopes_json));
    return scopes.length ? { id: row.id, scopes } : undefined;
  }

  set(accountId: string, scopes: Scope[]): void {
    if (!scopes.length) {
      this.accounts.database.prepare("DELETE FROM ai_grants WHERE account_id = ?").run(accountId);
      return;
    }
    this.accounts.database.prepare(
      "INSERT INTO ai_grants (account_id, id, scopes_json) VALUES (?, ?, ?) ON CONFLICT(account_id) " +
      "DO UPDATE SET id = excluded.id, scopes_json = excluded.scopes_json"
    ).run(accountId, randomUUID(), JSON.stringify([...new Set(scopes)]));
  }

  authorize(sessionHash: string, expectedGrant?: string): { human: HumanSession; principal: ToolPrincipal } {
    const human = this.accounts.sessionByHash(sessionHash);
    if (!human) throw signInRequired();
    const grant = this.get(human.account.id);
    if (!grant || (expectedGrant && grant.id !== expectedGrant)) throw consentRequired();
    return {
      human,
      principal: { account: human.account, kind: "assistant", id: grant.id, name: "内置 AI", scopes: new Set(grant.scopes) }
    };
  }
}

export function mountAccountAiApi(
  app: Hono<AccountContext>, accounts: AccountStore, model: AiModel | undefined,
  runtimeFor: (id: string) => Promise<{ database: PaiosDatabase; config: ServerConfig }>
): void {
  const grants = new AiGrants(accounts);
  const running = new Set<string>();
  const prefix = "/api/v1/ai";
  app.use(prefix + "/*", async (c, next) => {
    if (!c.get("human")) return toolFailure(c, signInRequired());
    if (c.req.header("Authorization") || c.req.header("X-PAIOS-Agent-Transport")) {
      return toolFailure(c, new ToolError(403, "HUMAN_SESSION_REQUIRED", "需要本人登录"));
    }
    await next();
  });
  app.use(prefix + "/*", bodyLimit({ maxSize: 24576 }));

  app.get(prefix + "/status", (c) => c.json({
    ok: true,
    mode: model?.mode ?? "disabled",
    worker_installed: aiWorkerInstalled(),
    scopes: grants.get(c.get("human")!.account.id)?.scopes ?? []
  }));

  app.put(prefix + "/permissions", async (c) => {
    try {
      const parsed = permissions.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) throw new ToolError(400, "INVALID_ARGUMENTS", "请选择支持的权限范围");
      const human = accounts.sessionByHash(c.get("human")!.sessionHash);
      if (!human) throw signInRequired();
      grants.set(human.account.id, parsed.data.scopes);
      return c.json({ ok: true, scopes: grants.get(human.account.id)?.scopes ?? [] });
    } catch (error) {
      return toolFailure(c, error);
    }
  });

  app.post(prefix + "/chat", async (c) => {
    const sessionHash = c.get("human")!.sessionHash;
    let runningAccount: string | undefined;
    try {
      const admitted = grants.authorize(sessionHash);
      if (!model || !aiWorkerInstalled()) throw new ToolError(503, "AI_RUNTIME_UNAVAILABLE", "当前环境暂无法启动内置 AI");
      const input = promptSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!input.success) throw new ToolError(400, "INVALID_ARGUMENTS", "请输入待办请求");
      const accountId = admitted.human.account.id;
      if (running.has(accountId)) throw new ToolError(409, "AI_BUSY", "当前账号已有一轮处理中");
      running.add(accountId);
      runningAccount = accountId;
      const { database, config } = await runtimeFor(accountId);
      const recheck = () => {
        const current = grants.authorize(sessionHash, admitted.principal.id);
        checkPendingRestore(config.dataDir);
        return current;
      };
      recheck();
      const tools = listLocalTaskTools(admitted.principal);
      if (admitted.principal.scopes.has(proposalScope)) tools.push(proposalTool);
      const confirmations: Confirmation[] = [];
      const text = await runAiWorker({
        prompt: input.data.prompt,
        model, tools, signal: c.req.raw.signal, recheck,
        invoke(name, args) {
          const current = recheck();
          try {
            if (name === proposalTool.name) {
              confirmations.push(new AiConfirmations(database).propose(current.principal, current.human, args));
              return { pending_confirmation: true };
            }
            return executeLocalTaskTool(database, current.principal, name, args);
          } catch (error) {
            if (error instanceof ToolError) return { error: { code: error.code, message: error.message } };
            throw error;
          }
        }
      });
      return c.json({ ok: true, mode: model.mode, text, confirmations });
    } catch (error) {
      return toolFailure(c, error);
    } finally {
      if (runningAccount) running.delete(runningAccount);
    }
  });

  app.post(prefix + "/confirmations/:id/approve", async (c) => {
    try {
      const sessionHash = c.get("human")!.sessionHash;
      const input = applyConfirmationSchema.safeParse(await c.req.json().catch(() => undefined));
      if (!input.success) throw new ToolError(400, "INVALID_ARGUMENTS", "请核对并确认完整的操作信息");
      const admitted = grants.authorize(sessionHash);
      const { database, config } = await runtimeFor(admitted.human.account.id);
      const { principal, human } = grants.authorize(sessionHash, admitted.principal.id);
      checkPendingRestore(config.dataDir);
      const result = new AiConfirmations(database).apply(principal, human, c.req.param("id") ?? "", input.data);
      return c.json({ ok: true, result });
    } catch (error) {
      return toolFailure(c, error);
    }
  });
}
