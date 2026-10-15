import test from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig } from "./config.js";

test("server defaults to the personal database directory", () => {
  const previous = process.env.PAIOS_DATA_DIR;
  try {
    delete process.env.PAIOS_DATA_DIR;
    assert.equal(loadConfig().dataDir, resolve(join(homedir(), ".paios")));
  } finally {
    if (previous === undefined) delete process.env.PAIOS_DATA_DIR;
    else process.env.PAIOS_DATA_DIR = previous;
  }
});
