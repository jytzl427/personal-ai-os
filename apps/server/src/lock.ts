import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM" || code === "EACCES";
  }
}

export class SingleWriterLock {
  private constructor(private readonly path: string, private readonly fd: number, private readonly heartbeat: NodeJS.Timeout) {}

  static acquire(dataDir: string): SingleWriterLock {
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, "paios.lock");

    for (let attempt = 0; attempt < 10; attempt++) {
      if (existsSync(path)) {
        let lockContent = "";
        try {
          lockContent = readFileSync(path, "utf8").trim();
        } catch {}
        const ownerPid = Number.parseInt(lockContent, 10);
        const ageMs = Date.now() - (statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0);
        if (processIsAlive(ownerPid)) {
          if (ageMs > 10_000) {
            try { unlinkSync(path); } catch {}
          } else {
            throw new Error(`SINGLE_WRITER_LOCKED: ${path}`);
          }
        } else {
          try { unlinkSync(path); } catch {}
        }
      }

      try {
        const fd = openSync(path, "wx");
        const heartbeat = setInterval(() => {
          try {
            writeFileSync(path, `${process.pid}\n`, "utf8");
          } catch {
            // The lock is released during shutdown or was removed after a crash.
          }
        }, 2_000);
        heartbeat.unref();
        writeFileSync(fd, `${process.pid}\n`, "utf8");
        return new SingleWriterLock(path, fd, heartbeat);
      } catch (error) {
        if (attempt === 9) {
          throw new Error(`SINGLE_WRITER_LOCKED: ${path}`, { cause: error });
        }
        // Small delay for Windows NTFS handle cleanup
        const start = Date.now();
        while (Date.now() - start < 150) {}
      }
    }

    throw new Error(`SINGLE_WRITER_LOCKED: ${path}`);
  }

  release(): void {
    clearInterval(this.heartbeat);
    try {
      closeSync(this.fd);
    } finally {
      try {
        unlinkSync(this.path);
      } catch {
        // The lock may already have been removed during shutdown.
      }
    }
  }
}
