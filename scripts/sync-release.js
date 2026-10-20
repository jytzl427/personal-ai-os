import fs from "node:fs";
import { execSync, spawn } from "node:child_process";

try {
  execSync('powershell -NoProfile -Command "Stop-Process -Name Personal-AI-OS, paios-desktop -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 600"', { stdio: "ignore" });
} catch {}

try {
  execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'server\\.mjs\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"', { stdio: "ignore" });
} catch {}

const lockFile = "C:/Users/jytzl/.paios/paios.lock";
try {
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
} catch {}

const src = "D:/code/mature project/Personal AI OS/apps/desktop/src-tauri/target/release/paios-desktop.exe";
const dst = "D:/code/mature project/Personal AI OS/release/Personal-AI-OS.exe";
const zip = "D:/code/mature project/Personal AI OS/release/Personal-AI-OS-windows-x64.zip";

// Sync server runtime files directly to ensure new server builds are immediately used
const runtimeServerSrc = "D:/code/mature project/Personal AI OS/apps/desktop/src-tauri/resources/paios-server/server.mjs";
const runtimeServerDst = "C:/Users/jytzl/.paios/desktop-runtime/resources/paios-server/server.mjs";
const runtimeVerSrc = "D:/code/mature project/Personal AI OS/apps/desktop/src-tauri/resources/runtime-version.txt";
const runtimeVerDst = "C:/Users/jytzl/.paios/desktop-runtime/resources/runtime-version.txt";
const integrityFile = "C:/Users/jytzl/.paios/desktop-runtime/resources/.integrity-check";

try {
  if (fs.existsSync(runtimeServerSrc)) fs.copyFileSync(runtimeServerSrc, runtimeServerDst);
  if (fs.existsSync(runtimeVerSrc)) fs.copyFileSync(runtimeVerSrc, runtimeVerDst);
  if (fs.existsSync(integrityFile)) fs.unlinkSync(integrityFile);
} catch {}

// Retry copy file up to 5 times in case Windows handle teardown has a slight delay
for (let i = 0; i < 5; i++) {
  try {
    fs.copyFileSync(src, dst);
    console.log("Copied latest paios-desktop.exe to Personal-AI-OS.exe");
    break;
  } catch (err) {
    if (i === 4) throw err;
    execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 500"');
  }
}

try {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${src}' -DestinationPath '${zip}' -Force"`);
  console.log("Updated release zip package successfully");
} catch (err) {
  console.error("Zip compression note:", err.message);
}

const child = spawn(dst, [], { detached: true, stdio: "ignore" });
child.unref();
console.log("Spawned updated desktop client, PID:", child.pid);
