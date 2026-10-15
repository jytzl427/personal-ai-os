import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ServerConfig = {
  dataDir: string;
  bind: string;
  port: number;
};

export function loadConfig(): ServerConfig {
  // Keep manual `node ... serve` runs on the same personal database as the
  // single-file desktop app. Development/test databases must be explicit via
  // PAIOS_DATA_DIR=.data (or another isolated directory).
  const dataDir = resolve(process.env.PAIOS_DATA_DIR || join(homedir(), ".paios"));
  const bind = process.env.PAIOS_BIND || "127.0.0.1";
  const port = Number.parseInt(process.env.PAIOS_PORT || "4738", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PAIOS_PORT must be a valid TCP port");
  }
  if (bind !== "127.0.0.1" && process.env.PAIOS_ALLOW_NON_LOCALHOST !== "1") {
    throw new Error("Non-localhost bind requires PAIOS_ALLOW_NON_LOCALHOST=1");
  }
  return { dataDir, bind, port };
}
