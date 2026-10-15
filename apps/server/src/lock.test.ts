import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SingleWriterLock } from "./lock.js";

test("single writer lock rejects a second holder", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-lock-"));
  const first = SingleWriterLock.acquire(dataDir);
  try {
    assert.throws(() => SingleWriterLock.acquire(dataDir), /SINGLE_WRITER_LOCKED/);
  } finally {
    first.release();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("single writer lock removes a lock owned by a dead process", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "paios-stale-lock-"));
  writeFileSync(join(dataDir, "paios.lock"), "999999\n", "utf8");
  const lock = SingleWriterLock.acquire(dataDir);
  try {
    assert.equal(lock !== undefined, true);
  } finally {
    lock.release();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
