import { serve } from "@hono/node-server";
import { ensureWeeklyBackup, getSetting, openDatabase, recoverFromLatestBackup, type PaiosDatabase, type WeeklyBackupResult } from "@paios/db";
import { loadConfig } from "./config.js";
import { SingleWriterLock } from "./lock.js";
import { createApp } from "./app.js";
import { runDirectMcp, runMcp } from "./mcp.js";
import { type RecurrenceSyncResult } from "./recurrence.js";
import { runRecurrenceSyncWithRetry } from "./recurrence-service.js";

const command = process.argv[2] || "serve";

if (command === "mcp") {
  try {
    await runMcp();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else if (command === "mcp-direct") {
  try {
    await runDirectMcp();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else if (command === "restore-latest") {
  try {
    const config = loadConfig();
    const lock = SingleWriterLock.acquire(config.dataDir);
    try {
      const restored = recoverFromLatestBackup(config.dataDir);
      console.log(`已从本地备份恢复数据库: ${restored.sourcePath}`);
    } finally {
      lock.release();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
} else if (command !== "serve") {
  console.error(`未知命令: ${command}. 可用命令: serve, mcp, mcp-direct, restore-latest`);
  process.exitCode = 2;
} else {
  const config = loadConfig();
  const lock = SingleWriterLock.acquire(config.dataDir);
  let database: PaiosDatabase | undefined;
  try {
    const activeDatabase = openDatabase(config.dataDir);
    database = activeDatabase;
    const timezone = getSetting(activeDatabase, "timezone", "Asia/Shanghai");
    let weeklyBackup: WeeklyBackupResult;
    try {
      weeklyBackup = await ensureWeeklyBackup(activeDatabase, config.dataDir, timezone);
      if (weeklyBackup.status === "failed") console.error("周备份失败，将在下次启动重试", weeklyBackup.error);
    } catch (error) {
      weeklyBackup = { status: "failed", anchorDate: "unknown", error: error instanceof Error ? error.message : String(error) };
      console.error("周备份检查失败，将在下次启动重试", error);
    }
    const recurrenceSync = new Promise<RecurrenceSyncResult>((resolve) => {
      setImmediate(() => {
        try {
          resolve(runRecurrenceSyncWithRetry(activeDatabase, config.dataDir, undefined, "startup"));
        } catch (error) {
          console.error("周期任务启动检查失败", error);
          resolve({ runId: "startup-error", status: "failed", generatedCount: 0, skippedCount: 0, errorCount: 1, checkedAt: new Date().toISOString() });
        }
      });
    });
    const app = createApp({ database: activeDatabase, config, recurrenceSync, weeklyBackup });
    const server = serve({ fetch: app.fetch, hostname: config.bind, port: config.port });
    console.log(`Personal AI OS running at http://${config.bind}:${config.port}`);
    console.log(`Data directory: ${config.dataDir}`);
    const shutdown = () => {
      server.close();
      activeDatabase.close();
      lock.release();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    database?.close();
    lock.release();
    throw error;
  }
}
