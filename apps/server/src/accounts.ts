import { openAccountRegistryDatabase, type PaiosDatabase } from "@paios/db";
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LOCAL_OWNER_ID = "local";
export const SESSION_SECONDS = 12 * 60 * 60;
export const accountRegistryPath = (root: string) => join(root, ".accounts", "accounts.db");
export const setupCodePath = (root: string) => join(root, ".accounts", "setup-code.txt");

export type Account = {
  id: string;
  username: string;
  role: "admin" | "member";
  disabled_at: string | null;
};

type Credential = Account & { password_hash: string };
export type HumanSession = { account: Account; sessionHash: string };

export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const timestamp = () => new Date().toISOString();
const accountColumns = "id, username, role, disabled_at";

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return salt.toString("hex") + ":" + key.toString("hex");
}

const dummyPasswordHash = "0".repeat(32) + ":" + "0".repeat(64);

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, expected] = hash.split(":");
  const key = await deriveKey(password, Buffer.from(salt ?? "", "hex"));
  return timingSafeEqual(key, Buffer.from(expected ?? "", "hex"));
}

export class AccountStore {
  readonly database: PaiosDatabase;

  constructor(readonly root: string) {
    mkdirSync(join(root, ".accounts"), { recursive: true, mode: 0o700 });
    this.database = openAccountRegistryDatabase(accountRegistryPath(root));
    try {
      this.database.exec(
        "CREATE TABLE IF NOT EXISTS accounts (" +
        "id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin', 'member')), " +
        "password_hash TEXT NOT NULL, created_at TEXT NOT NULL, disabled_at TEXT);" +
        "CREATE TABLE IF NOT EXISTS account_sessions (" +
        "token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at TEXT NOT NULL);" +
        "CREATE INDEX IF NOT EXISTS account_sessions_owner ON account_sessions(account_id);"
      );
      if (this.needsSetup() && !existsSync(setupCodePath(root))) {
        writeFileSync(setupCodePath(root), randomBytes(24).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  needsSetup(): boolean {
    return !this.database.prepare("SELECT 1 FROM accounts WHERE id = ?").get(LOCAL_OWNER_ID);
  }

  active(id: string): Account | undefined {
    return this.database.prepare("SELECT " + accountColumns + " FROM accounts WHERE id = ? AND disabled_at IS NULL").get(id);
  }

  list(): Account[] {
    return this.database.prepare("SELECT " + accountColumns + " FROM accounts ORDER BY created_at, id").all() as Account[];
  }

  dataDir(id: string): string {
    return id === LOCAL_OWNER_ID ? this.root : join(this.root, ".accounts", id);
  }

  async createOwner(username: string, password: string, code: string): Promise<Account | undefined> {
    if (!this.needsSetup()) return undefined;
    const expected = readFileSync(setupCodePath(this.root), "utf8").trim();
    if (!timingSafeEqual(Buffer.from(digest(code)), Buffer.from(digest(expected)))) return undefined;
    const passwordHash = await hashPassword(password);
    const owner = this.database.transaction(() => {
      if (!this.needsSetup()) return undefined;
      return this.insert(LOCAL_OWNER_ID, username, "admin", passwordHash);
    })();
    if (owner) unlinkSync(setupCodePath(this.root));
    return owner;
  }

  async createMember(username: string, password: string): Promise<Account | undefined> {
    return this.insert(randomUUID(), username, "member", await hashPassword(password));
  }

  private insert(id: string, username: string, role: Account["role"], passwordHash: string): Account | undefined {
    const created = this.database.prepare(
      "INSERT INTO accounts (id, username, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(username) DO NOTHING"
    ).run(id, username, role, passwordHash, timestamp());
    return created.changes === 1 ? { id, username, role, disabled_at: null } : undefined;
  }

  disable(id: string): boolean {
    return this.database.transaction(() => {
      const update = this.database.prepare("UPDATE accounts SET disabled_at = ? WHERE id = ? AND role = 'member' AND disabled_at IS NULL").run(timestamp(), id);
      if (update.changes !== 1) return false;
      this.database.prepare("DELETE FROM account_sessions WHERE account_id = ?").run(id);
      return true;
    })();
  }

  async login(username: string, password: string): Promise<Account | undefined> {
    const row = this.database.prepare("SELECT " + accountColumns + ", password_hash FROM accounts WHERE username = ?").get(username) as Credential | undefined;
    const matches = await verifyPassword(password, row?.password_hash ?? dummyPasswordHash);
    return matches && row ? this.active(row.id) : undefined;
  }

  createSession(id: string): string {
    const token = randomBytes(32).toString("hex");
    this.database.prepare("DELETE FROM account_sessions WHERE expires_at <= ?").run(timestamp());
    this.database.prepare("INSERT INTO account_sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)").run(
      digest(token), id, new Date(Date.now() + SESSION_SECONDS * 1000).toISOString()
    );
    return token;
  }

  session(token?: string): HumanSession | undefined {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return undefined;
    return this.sessionByHash(digest(token));
  }

  sessionByHash(sessionHash: string): HumanSession | undefined {
    const account = this.database.prepare(
      "SELECT a.id, a.username, a.role, a.disabled_at FROM account_sessions s JOIN accounts a ON a.id = s.account_id " +
      "WHERE s.token_hash = ? AND s.expires_at > ? AND a.disabled_at IS NULL"
    ).get(sessionHash, timestamp()) as Account | undefined;
    return account ? { account, sessionHash } : undefined;
  }

  endSession(session: HumanSession): void {
    this.database.prepare("DELETE FROM account_sessions WHERE token_hash = ?").run(session.sessionHash);
  }
}
