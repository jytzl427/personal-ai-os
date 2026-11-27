import { shouldArchiveTask } from "@paios/core";
import type { PaiosDatabase } from "@paios/db";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { digest, type HumanSession } from "./accounts.js";
import { recordAudit } from "./audit.js";
import { localTaskDate, localTaskId, readLocalTask, requireToolScope, ToolError, type ToolPrincipal } from "./local-task-tools.js";
import { refreshParentTaskDueDate, syncProjectPlansForTodo } from "./project-service.js";
import { deleteStoredTask, updateLinkedCheckpoint } from "./task-storage.js";

export const proposalScope = "tasks:propose";
const operation = z.enum(["reschedule", "complete", "delete"]);
const proposalFields = z.object({ task_id: localTaskId, operation, due_date: localTaskDate.optional() }).strict();

const proposalSchema = proposalFields.refine((input) => (input.operation === "reschedule") === Boolean(input.due_date));
export const applyConfirmationSchema = proposalFields.extend({
  due_date: localTaskDate.nullable(),
  challenge: z.string().regex(/^[0-9a-f]{64}$/)
});
type ProposalInput = z.infer<typeof proposalFields>;
type Approval = z.infer<typeof applyConfirmationSchema>;

export const proposalTool: Tool = {
  name: "tasks_propose_change",
  description: "请求本人确认待办改期、完成或删除。仅生成待确认请求。改期必须指定 due_date。",
  inputSchema: { ...toJsonSchemaCompat(proposalFields), type: "object" } as Tool["inputSchema"]
};

export type Confirmation = {
  id: string;
  task_id: string;
  title: string;
  operation: ProposalInput["operation"];
  due_date: string | null;
  previous_due_date: string | null;
  expires_at: string;
  challenge: string;
};

type StoredConfirmation = Pick<Confirmation, "task_id" | "operation" | "due_date"> & {
  challenge_hash: string;
  expected_version: number;
};

export class AiConfirmations {
  constructor(private readonly database: PaiosDatabase) {
    database.exec(
      "CREATE TABLE IF NOT EXISTS ai_confirmations (" +
      "id TEXT PRIMARY KEY, account_id TEXT NOT NULL, session_hash TEXT NOT NULL, grant_id TEXT NOT NULL, " +
      "task_id TEXT NOT NULL, operation TEXT NOT NULL CHECK (operation IN ('reschedule', 'complete', 'delete')), " +
      "due_date TEXT, expected_version INTEGER NOT NULL, challenge_hash TEXT NOT NULL, " +
      "created_at TEXT NOT NULL, expires_at TEXT NOT NULL, executed_at TEXT);"
    );
  }

  propose(principal: ToolPrincipal, human: HumanSession, args: unknown): Confirmation {
    requireToolScope(principal, proposalScope);
    const parsed = proposalSchema.safeParse(args);
    if (!parsed.success) throw new ToolError(400, "INVALID_ARGUMENTS", "确认请求参数无效");
    const { task_id, operation: action, due_date } = parsed.data;
    const task = readLocalTask(this.database, task_id);
    if (task.status !== "todo" && action !== "delete") {
      throw new ToolError(409, "TASK_NOT_OPEN", "此待办当前无法改期或完成");
    }
    const now = new Date();
    const confirmation: Confirmation = {
      id: randomUUID(), task_id, title: task.title, operation: action, due_date: due_date ?? null,
      previous_due_date: task.due_date, expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      challenge: randomBytes(32).toString("hex")
    };
    this.database.prepare(
      "INSERT INTO ai_confirmations (id, account_id, session_hash, grant_id, task_id, operation, due_date, expected_version, challenge_hash, created_at, expires_at) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(confirmation.id, human.account.id, human.sessionHash, principal.id, task_id, action, confirmation.due_date,
      task.row_version, digest(confirmation.challenge), now.toISOString(), confirmation.expires_at);
    return confirmation;
  }

  apply(principal: ToolPrincipal, human: HumanSession, id: string, approval: Approval) {
    requireToolScope(principal, proposalScope);
    return this.database.transaction(() => {
      const now = new Date().toISOString();
      const confirmation = this.database.prepare(
        "SELECT task_id, operation, due_date, expected_version, challenge_hash FROM ai_confirmations " +
        "WHERE id = ? AND account_id = ? AND session_hash = ? AND grant_id = ? AND executed_at IS NULL AND expires_at > ?"
      ).get(id, human.account.id, human.sessionHash, principal.id, now) as StoredConfirmation | undefined;
      if (!confirmation) throw new ToolError(404, "CONFIRMATION_UNAVAILABLE", "确认已失效或不属于当前登录");
      if (!timingSafeEqual(Buffer.from(confirmation.challenge_hash), Buffer.from(digest(approval.challenge))) ||
          approval.task_id !== confirmation.task_id || approval.operation !== confirmation.operation || approval.due_date !== confirmation.due_date) {
        throw new ToolError(403, "CONFIRMATION_MISMATCH", "确认内容与原始请求不一致");
      }
      const task = readLocalTask(this.database, confirmation.task_id);
      if (task.row_version !== confirmation.expected_version) throw new ToolError(409, "STALE_VERSION", "待办已更新，请重新发起确认");
      const after = this.execute(confirmation, now);
      this.database.prepare("UPDATE ai_confirmations SET executed_at = ? WHERE id = ?").run(now, id);
      const target = { entityType: "task", table: "tasks", whereColumn: "id", entityId: task.id };
      const audit = recordAudit(this.database, {
        actor: "user", agentTokenId: principal.id, agentName: principal.name, toolName: proposalTool.name,
        action: "assistant.confirmed." + confirmation.operation, target,
        request: { account_id: human.account.id, confirmation_id: id, task_id: task.id, operation: confirmation.operation, due_date: confirmation.due_date },
        before: task, after, result: "ok"
      });
      if (!audit) throw new Error("Could not audit the approved task change");
      return { task_id: task.id, operation: confirmation.operation, due_date: confirmation.due_date };
    })();
  }

  private execute(confirmation: StoredConfirmation, timestamp: string) {
    const id = confirmation.task_id;
    if (confirmation.operation === "delete") {
      deleteStoredTask(this.database, id, timestamp);
      return null;
    }
    const task = this.database.prepare("SELECT parent_id, archive_requested FROM tasks WHERE id = ?").get(id) as {
      parent_id: string | null; archive_requested: number;
    };
    if (confirmation.operation === "reschedule") {
      this.database.prepare("UPDATE tasks SET due_date = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(confirmation.due_date, timestamp, id);
      updateLinkedCheckpoint(this.database, id, { due_date: confirmation.due_date }, timestamp);
    } else {
      this.database.prepare("UPDATE tasks SET status = 'done', completed_at = COALESCE(completed_at, ?), updated_at = ?, row_version = row_version + 1 WHERE id = ?")
        .run(timestamp, timestamp, id);
      if (shouldArchiveTask({ archive_requested: task.archive_requested, status: "done", archived_at: null })) {
        this.database.prepare("UPDATE tasks SET archived_at = ?, archive_reason = 'auto', archived_by = 'user' WHERE (id = ? OR parent_id = ?) AND archived_at IS NULL")
          .run(timestamp, id, id);
      }
      syncProjectPlansForTodo(this.database, id, "completed", timestamp);
    }
    if (task.parent_id) refreshParentTaskDueDate(this.database, task.parent_id, timestamp);
    return this.database.prepare("SELECT id, title, due_date, status, archived_at, row_version FROM tasks WHERE id = ?").get(id);
  }
}
