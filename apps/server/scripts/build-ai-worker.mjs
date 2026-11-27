import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform === "linux") {
  const source = fileURLToPath(new URL("../ai-worker/", import.meta.url));
  const output = fileURLToPath(new URL("../dist/ai-worker/", import.meta.url));
  mkdirSync(output, { recursive: true });
  const result = spawnSync("cc", [
    "-std=c11", "-O2", "-shared", "-fPIC", "-Wall", "-Wextra", "-Werror",
    "-Wl,-z,relro,-z,now", "-o", join(output, "sandbox.so"), join(source, "sandbox.c")
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  cpSync(join(source, "worker.py"), join(output, "worker.py"));
}
