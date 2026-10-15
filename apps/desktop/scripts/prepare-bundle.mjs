import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const rootDir = path.resolve(desktopDir, "../..");
const resourcesDir = path.join(desktopDir, "src-tauri", "resources");
const serverDir = path.join(resourcesDir, "paios-server");
const serverEntry = path.join(rootDir, "apps", "server", "dist", "main.js");
const pnpmStoreDir = path.join(rootDir, "node_modules", ".pnpm");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: rootDir, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function findPackage(prefix) {
  const matches = (await readdir(pnpmStoreDir)).filter((name) => name.startsWith(prefix));
  if (matches.length === 0) throw new Error(`Could not find installed package ${prefix}`);
  return path.join(pnpmStoreDir, matches.sort().at(-1), "node_modules", prefix.slice(0, -1));
}

async function copyFile(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

await rm(resourcesDir, { recursive: true, force: true });
await mkdir(serverDir, { recursive: true });

const esbuildStoreEntry = (await readdir(pnpmStoreDir)).find((name) => name.startsWith("esbuild@"));
if (!esbuildStoreEntry) throw new Error("Could not find the installed esbuild runtime");
const esbuildBin = path.join(pnpmStoreDir, esbuildStoreEntry, "node_modules", "esbuild", "bin", "esbuild");
run(process.execPath, [
  esbuildBin,
  serverEntry,
  "--bundle",
  "--platform=node",
  "--format=esm",
  "--external:better-sqlite3",
  `--outfile=${path.join(serverDir, "server.mjs")}`
]);

const nativeModulesDir = path.join(serverDir, "node_modules");
await mkdir(nativeModulesDir, { recursive: true });
const runtimeBetterSqlite = path.join(nativeModulesDir, "better-sqlite3");
const betterSqliteSource = await findPackage("better-sqlite3@");
await copyFile(path.join(betterSqliteSource, "package.json"), path.join(runtimeBetterSqlite, "package.json"));
await cp(path.join(betterSqliteSource, "lib"), path.join(runtimeBetterSqlite, "lib"), { recursive: true, dereference: true });
await copyFile(path.join(betterSqliteSource, "build", "Release", "better_sqlite3.node"), path.join(runtimeBetterSqlite, "build", "Release", "better_sqlite3.node"));
const bindingsSource = await findPackage("bindings@");
await copyFile(path.join(bindingsSource, "package.json"), path.join(nativeModulesDir, "bindings", "package.json"));
await copyFile(path.join(bindingsSource, "bindings.js"), path.join(nativeModulesDir, "bindings", "bindings.js"));
const fileUriSource = await findPackage("file-uri-to-path@");
await copyFile(path.join(fileUriSource, "package.json"), path.join(nativeModulesDir, "file-uri-to-path", "package.json"));
await copyFile(path.join(fileUriSource, "index.js"), path.join(nativeModulesDir, "file-uri-to-path", "index.js"));
await cp(process.execPath, path.join(resourcesDir, "node.exe"));

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(absolute, relative));
    else files.push({ relative: relative.split(path.sep).join("/"), absolute });
  }
  return files;
}

const runtimeFiles = await listFiles(resourcesDir);
const runtimeHash = createHash("sha256");
for (const file of runtimeFiles) {
  runtimeHash.update(file.relative);
  runtimeHash.update("|");
  runtimeHash.update(await readFile(file.absolute));
}
await writeFile(path.join(resourcesDir, "runtime-version.txt"), runtimeHash.digest("hex"), "utf8");

// Keep only runtime files in the release payload. The package's build objects,
// source tree and test binaries are not needed by Node at runtime.
console.log(`Prepared standalone server runtime in ${resourcesDir}`);
