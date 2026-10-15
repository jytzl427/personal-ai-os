import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type SecretStore = { llm_api_key?: string };

function secretsPath(dataDir: string): string {
  return join(dataDir, "secrets.json");
}

export function readLlmApiKey(dataDir: string): string {
  const path = secretsPath(dataDir);
  if (existsSync(path)) {
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as SecretStore;
      if (typeof value.llm_api_key === "string" && value.llm_api_key.length > 0) return value.llm_api_key;
    } catch {
      // Fall through to the environment variable if the file is invalid.
    }
  }
  return process.env.PAIOS_LLM_API_KEY || "";
}

export function hasLlmApiKey(dataDir: string): boolean {
  return readLlmApiKey(dataDir).length > 0;
}

export function writeLlmApiKey(dataDir: string, apiKey: string): void {
  mkdirSync(dataDir, { recursive: true });
  const path = secretsPath(dataDir);
  let current: SecretStore = {};
  if (existsSync(path)) {
    try { current = JSON.parse(readFileSync(path, "utf8")) as SecretStore; } catch { current = {}; }
  }
  if (apiKey.trim()) current.llm_api_key = apiKey.trim();
  else delete current.llm_api_key;
  writeFileSync(path, `${JSON.stringify(current, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
