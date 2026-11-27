import { ensureWeeklyBackup, getSetting, openDatabase, type PaiosDatabase, type WeeklyBackupResult } from "@paios/db";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import { mkdirSync } from "node:fs";
import { z } from "zod";
import { AccountStore, LOCAL_OWNER_ID, SESSION_SECONDS, type Account, type HumanSession } from "./accounts.js";
import { createApp } from "./app.js";
import { bearerToken } from "./auth.js";
import type { ServerConfig } from "./config.js";
import { runRecurrenceSyncWithRetry } from "./recurrence-service.js";
import type { RecurrenceSyncResult } from "./recurrence.js";
import { serveWeb } from "./web.js";

const SESSION_COOKIE = "paios_account";
const SESSION_HEADER = "X-PAIOS-Account-Session";
const desktopOrigins = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"];
const appOrigins = ["http://127.0.0.1:5173", "http://localhost:5173", ...desktopOrigins];
const credentialsSchema = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{2,31}$/),
  password: z.string().min(12).max(128)
});
const setupSchema = credentialsSchema.extend({ setup_code: z.string().trim().regex(/^[0-9a-f]{48}$/) });

type AccountContext = { Variables: { human: HumanSession | undefined } };
type AccountRuntime = {
  database: PaiosDatabase;
  config: ServerConfig;
  app: ReturnType<typeof createApp>;
  recurrenceSync: Promise<RecurrenceSyncResult>;
};

function failure(c: Context, status: 400 | 401 | 403 | 404 | 409 | 429, code: string, message: string) {
  return c.json({ ok: false, error: { code, message } }, status);
}

function establishSession(c: Context, store: AccountStore, account: Account) {
  const token = store.createSession(account.id);
  if (desktopOrigins.includes(c.req.header("Origin") ?? "")) {
    return c.json({ ok: true, account, session_token: token });
  }
  setCookie(c, SESSION_COOKIE, token, {
    path: "/api/v1", httpOnly: true, sameSite: "Strict", maxAge: SESSION_SECONDS,
    secure: new URL(c.req.url).protocol === "https:"
  });
  return c.json({ ok: true, account });
}

async function openRuntime(config: ServerConfig, id: string): Promise<AccountRuntime> {
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const database: PaiosDatabase = openDatabase(config.dataDir, { seedAgentToken: id === LOCAL_OWNER_ID });
  try {
    const timezone = getSetting(database, "timezone", "Asia/Shanghai");
    let weeklyBackup: WeeklyBackupResult;
    try {
      weeklyBackup = await ensureWeeklyBackup(database, config.dataDir, timezone);
      if (weeklyBackup.status === "failed") console.error("周备份失败，将在下次启动重试", weeklyBackup.error);
    } catch (error) {
      weeklyBackup = { status: "failed", anchorDate: "unknown", error: error instanceof Error ? error.message : String(error) };
    }
    const recurrenceSync = new Promise<RecurrenceSyncResult>((resolve) => {
      setImmediate(() => {
        try {
          resolve(runRecurrenceSyncWithRetry(database, config.dataDir, undefined, "startup"));
        } catch (error) {
          console.error("周期任务启动检查失败", error);
          resolve({ runId: "startup-error", status: "failed", generatedCount: 0, skippedCount: 0, errorCount: 1, checkedAt: new Date().toISOString() });
        }
      });
    });
    const app = createApp({ database, config, recurrenceSync, weeklyBackup });
    return { database, config, app, recurrenceSync };
  } catch (error) {
    database.close();
    throw error;
  }
}

export async function createAccountApp(config: ServerConfig) {
  const store = new AccountStore(config.dataDir);
  const runtimes = new Map<string, Promise<AccountRuntime>>();

  function runtimeFor(id: string): Promise<AccountRuntime> {
    const existing = runtimes.get(id);
    if (existing) return existing;
    const runtime = openRuntime({ ...config, dataDir: store.dataDir(id) }, id).catch((error) => {
      runtimes.delete(id);
      throw error;
    });
    runtimes.set(id, runtime);
    return runtime;
  }

  try {
    // Keep the original database and sibling files in place for migration and restore.
    await runtimeFor(LOCAL_OWNER_ID);
  } catch (error) {
    store.database.close();
    throw error;
  }

  const app = new Hono<AccountContext>();
  app.use("/api/*", cors({
    origin: appOrigins,
    allowHeaders: ["Content-Type", "Authorization", SESSION_HEADER, "X-PAIOS-Agent-Transport", "X-Agent-Name", "X-Tool-Name", "X-PAIOS-UI-Session", "X-PAIOS-Idempotency-Key"],
    credentials: true
  }));
  app.use("/api/v1/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const origin = c.req.header("Origin");
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && origin && origin !== new URL(c.req.url).origin && !appOrigins.includes(origin)) {
      return failure(c, 403, "ORIGIN_FORBIDDEN", "请求来源不受信任");
    }
    c.set("human", store.session(getCookie(c, SESSION_COOKIE) ?? c.req.header(SESSION_HEADER)));
    await next();
  });
  app.use("/api/v1/account/*", bodyLimit({ maxSize: 8192 }));

  app.get("/api/v1/account/session", (c) => c.json({
    ok: true, account: c.get("human")?.account ?? null, needs_setup: store.needsSetup()
  }));

  let passwordOperations = 0;
  async function withPasswordLimit(c: Context, action: () => Promise<Response>) {
    if (passwordOperations >= 4) return failure(c, 429, "TOO_MANY_REQUESTS", "请稍后重试");
    passwordOperations += 1;
    try {
      return await action();
    } finally {
      passwordOperations -= 1;
    }
  }

  app.post("/api/v1/account/setup", async (c) => {
    const input = setupSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return failure(c, 400, "BAD_REQUEST", "请检查登录名、密码和初始化验证码");
    return withPasswordLimit(c, async () => {
      const account = await store.createOwner(input.data.username, input.data.password, input.data.setup_code);
      if (!account) return failure(c, 403, "SETUP_DENIED", "初始化验证码无效，或管理员已经创建");
      return establishSession(c, store, account);
    });
  });

  app.post("/api/v1/account/login", async (c) => {
    const input = credentialsSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return failure(c, 400, "BAD_REQUEST", "请检查登录名和密码");
    return withPasswordLimit(c, async () => {
      const account = await store.login(input.data.username, input.data.password);
      if (!account) return failure(c, 401, "INVALID_LOGIN", "账号不可用或登录信息错误");
      const oldSession = c.get("human");
      if (oldSession) store.endSession(oldSession);
      return establishSession(c, store, account);
    });
  });

  app.post("/api/v1/account/logout", (c) => {
    const human = c.get("human");
    if (human) store.endSession(human);
    deleteCookie(c, SESSION_COOKIE, { path: "/api/v1" });
    return c.json({ ok: true });
  });

  app.use("/api/v1/account/users/*", async (c, next) => {
    const human = c.get("human");
    if (!human) return failure(c, 401, "UNAUTHORIZED", "请先登录");
    if (human.account.role !== "admin") return failure(c, 403, "FORBIDDEN", "只有管理员可以管理账号");
    await next();
  });
  app.get("/api/v1/account/users", (c) => c.json({ ok: true, accounts: store.list() }));
  app.post("/api/v1/account/users", async (c) => {
    const input = credentialsSchema.safeParse(await c.req.json().catch(() => undefined));
    if (!input.success) return failure(c, 400, "BAD_REQUEST", "请检查登录名和密码");
    return withPasswordLimit(c, async () => {
      const account = await store.createMember(input.data.username, input.data.password);
      if (!account) return failure(c, 409, "ACCOUNT_EXISTS", "此登录名已被使用");
      return c.json({ ok: true, account }, 201);
    });
  });
  app.post("/api/v1/account/users/:id/disable", (c) => {
    if (!store.disable(c.req.param("id"))) return failure(c, 409, "ACCOUNT_UNAVAILABLE", "此账号不能停用");
    return c.json({ ok: true });
  });

  app.all("/api/v1/*", async (c) => {
    const human = c.get("human");
    if (c.req.header("Authorization") || c.req.header("X-PAIOS-Agent-Transport")) {
      // Legacy tokens live solely in the original owner's database.
      if (!bearerToken(c) || !store.active(LOCAL_OWNER_ID) || (human && human.account.id !== LOCAL_OWNER_ID)) {
        return failure(c, 401, "UNAUTHORIZED", "此 Agent 凭证不可用");
      }
      return (await runtimeFor(LOCAL_OWNER_ID)).app.fetch(c.req.raw);
    }
    if (!human) return failure(c, 401, "UNAUTHORIZED", "请先登录");
    const runtime = await runtimeFor(human.account.id);
    if (!store.sessionByHash(human.sessionHash)) return failure(c, 401, "UNAUTHORIZED", "登录已失效");
    return runtime.app.fetch(c.req.raw);
  });

  serveWeb(app);
  app.onError((error, c) => {
    console.error(error);
    return c.json({ ok: false, error: { code: "INTERNAL_ERROR", message: "服务处理失败" } }, 500);
  });

  return {
    app,
    async close() {
      const results = await Promise.allSettled(runtimes.values());
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        await result.value.recurrenceSync;
        result.value.database.close();
      }
      store.database.close();
    }
  };
}
