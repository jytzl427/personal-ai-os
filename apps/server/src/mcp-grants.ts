import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { digest, type AccountStore } from "./accounts.js";
import { taskScopeSchema, type TaskScope, type ToolPrincipal } from "./local-task-tools.js";

export const mcpGrantSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(taskScopeSchema).min(1).max(taskScopeSchema.options.length)
}).strict();

type Grant = { id: string; name: string; scopes_json: string; created_at: string; revoked_at: string | null };
const tokenFormat = /^paios_mcp_[a-f0-9]{64}$/;

export class McpGrants {
  constructor(private readonly accounts: AccountStore) {
    accounts.database.exec(
      "CREATE TABLE IF NOT EXISTS mcp_grants (" +
      "id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, " +
      "scopes_json TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT);" +
      "CREATE INDEX IF NOT EXISTS mcp_grants_owner ON mcp_grants(account_id);"
    );
  }

  list(accountId: string) {
    const grants = this.accounts.database.prepare(
      "SELECT id, name, scopes_json, created_at, revoked_at FROM mcp_grants WHERE account_id = ? ORDER BY created_at DESC"
    ).all(accountId) as Grant[];
    return grants.map(({ scopes_json, ...row }) => ({ ...row, scopes: this.scopes(scopes_json) }));
  }

  create(accountId: string, name: string, scopes: TaskScope[]) {
    const token = "paios_mcp_" + randomBytes(32).toString("hex");
    const grant = { id: randomUUID(), name, scopes: [...new Set(scopes)], created_at: new Date().toISOString(), revoked_at: null };
    this.accounts.database.prepare(
      "INSERT INTO mcp_grants (id, account_id, name, token_hash, scopes_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(grant.id, accountId, name, digest(token), JSON.stringify(grant.scopes), grant.created_at);
    return { grant, token };
  }

  revoke(accountId: string, id: string): boolean {
    return this.accounts.database.prepare(
      "UPDATE mcp_grants SET revoked_at = COALESCE(revoked_at, ?) WHERE account_id = ? AND id = ?"
    ).run(new Date().toISOString(), accountId, id).changes === 1;
  }

  rotate(accountId: string, id: string) {
    return this.accounts.database.transaction(() => {
      const row = this.accounts.database.prepare(
        "SELECT name, scopes_json FROM mcp_grants WHERE account_id = ? AND id = ? AND revoked_at IS NULL"
      ).get(accountId, id) as Pick<Grant, "name" | "scopes_json"> | undefined;
      if (!row) return undefined;
      this.revoke(accountId, id);
      return this.create(accountId, row.name, this.scopes(row.scopes_json));
    })();
  }

  authenticate(token: string | null): ToolPrincipal | undefined {
    if (!token || !tokenFormat.test(token)) return undefined;
    const row = this.accounts.database.prepare(
      "SELECT id, account_id, name, scopes_json FROM mcp_grants WHERE token_hash = ? AND revoked_at IS NULL"
    ).get(digest(token)) as (Pick<Grant, "id" | "name" | "scopes_json"> & { account_id: string }) | undefined;
    if (!row) return undefined;
    const account = this.accounts.active(row.account_id);
    if (!account) return undefined;
    return { account, kind: "mcp", id: row.id, name: row.name, scopes: new Set(this.scopes(row.scopes_json)) };
  }

  private scopes(json: string): TaskScope[] {
    try {
      const parsed = z.array(taskScopeSchema).safeParse(JSON.parse(json));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }
}
