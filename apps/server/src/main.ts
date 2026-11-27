import { serve } from "@hono/node-server";
import { recoverFromLatestBackup } from "@paios/db";
import { existsSync } from "node:fs";
import { accountRegistryPath } from "./accounts.js";
import { createAccountApp } from "./account-app.js";
import { loadConfig } from "./config.js";
import { SingleWriterLock } from "./lock.js";
import { runDirectMcp, runMcp } from "./mcp.js";

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
    if (existsSync(accountRegistryPath(loadConfig().dataDir))) await runMcp();
    else await runDirectMcp();
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
  let instance: Awaited<ReturnType<typeof createAccountApp>> | undefined;
  try {
    const activeInstance = await createAccountApp(config);
    instance = activeInstance;
    const server = serve({ fetch: activeInstance.app.fetch, hostname: config.bind, port: config.port });
    console.log(`Personal AI OS running at http://${config.bind}:${config.port}`);
    console.log(`Data directory: ${config.dataDir}`);
    let stopping = false;
    const shutdown = () => {
      if (stopping) return;
      stopping = true;
      server.close(() => {
        void activeInstance.close().catch((error) => {
          console.error("关闭数据库失败", error);
          process.exitCode = 1;
        }).finally(() => lock.release());
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    try {
      await instance?.close();
    } finally {
      lock.release();
    }
    throw error;
  }
}
