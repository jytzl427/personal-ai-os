import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "../..");
const serverDir = path.join(rootDir, "apps", "server");
const tsx = path.join(serverDir, "node_modules", "tsx", "dist", "cli.mjs");
const child = spawn(process.execPath, [tsx, "src/main.ts", "serve"], { cwd: serverDir, stdio: "inherit", shell: false });
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
