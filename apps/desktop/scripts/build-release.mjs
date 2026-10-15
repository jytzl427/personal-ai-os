import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(desktopDir, "../..");
const tsc = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
const vite = path.join(rootDir, "apps", "web", "node_modules", "vite", "bin", "vite.js");

function run(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const project of ["packages/api-types", "packages/core", "packages/db", "apps/server"]) {
  run(process.execPath, [tsc, "-p", path.join(rootDir, project, "tsconfig.json")]);
}
run(process.execPath, [vite, "build"], path.join(rootDir, "apps", "web"));
run(process.execPath, [path.join(desktopDir, "scripts", "prepare-bundle.mjs")]);
