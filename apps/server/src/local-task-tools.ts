import { localDateInTimezone } from "@paios/core";
import { getSetting, type PaiosDatabase } from "@paios/db";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Account } from "./accounts.js";
import { recordAudit } from "./audit.js";
import { insertTask } from "./task-storage.js";

export const taskScopeSchema = z.enum(["tasks:read", "tasks:create", "tasks:note"]);
export type TaskScope = z.infer<typeof taskScopeSchema>;

export type ToolPrincipal = {
  account: Account;
  kind: "mcp" | "assistant";
  id: string;
  name: string;
  scopes: ReadonlySet<string>;
};

export class ToolError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, readonly code: string, message: string) {
    super(message);
  }
}

export function missingGrant(): ToolError {
  return new ToolError(401, "INVALID_GRANT", "此 MCP 授权无效或已撤销");
}

export function requireToolScope(principal: ToolPrincipal, scope: string): void {
  if (!principal.scopes.has(scope)) throw new ToolError(403, "SCOPE_REQUIRED", "缺少必要的授权范围");
}

const taskFields = "id, title, description, status, priority, due_date, row_version";
export type LocalTask = {
  id: string; title: string; description: string; status: string; priority: string; due_date: string | null; row_version: number;
};

export function readLocalTask(database: PaiosDatabase, id: string): LocalTask {
  const task = database.prepare("SELECT " + taskFields + " FROM tasks WHERE id = ? AND archived_at IS NULL").get(id) as LocalTask | undefined;
  if (!task) throw new ToolError(404, "TASK_NOT_FOUND", "当前账号下没有该待办");
  return task;
}

export const localTaskId = z.string().min(1).max(128);
export const localTaskDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
const writeKey = z.string().min(1).max(200).optional();

function findTasks(database: PaiosDatabase, options: { date?: string; q?: string; limit?: number }) {
  return database.prepare(
    "SELECT " + taskFields + " FROM tasks WHERE archived_at IS NULL " +
    "AND (? IS NULL OR due_date = ?) AND (? IS NULL OR instr(lower(title), lower(?)) > 0 OR instr(lower(description), lower(?)) > 0) " +
    "ORDER BY due_date IS NULL, due_date, created_at, id LIMIT ?"
  ).all(options.date ?? null, options.date ?? null, options.q ?? null, options.q ?? null, options.q ?? null, options.limit ?? 20);
}

type ToolDefinition = {
  scope: TaskScope;
  schema: Tool;
  invoke: (database: PaiosDatabase, principal: ToolPrincipal, input: unknown) => unknown;
};

function definition<Input extends z.ZodRawShape>(
  name: string, scope: TaskScope, description: string, fields: Input,
  invoke: (database: PaiosDatabase, principal: ToolPrincipal, args: z.infer<z.ZodObject<Input, "strict">>) => unknown
): ToolDefinition {
  const schema = z.object(fields).strict();
  return {
    scope,
    schema: { name, description, inputSchema: { ...toJsonSchemaCompat(schema), type: "object" } as Tool["inputSchema"] },
    invoke(database, principal, input) {
      const parsed = schema.safeParse(input);
      if (!parsed.success) throw new ToolError(400, "INVALID_ARGUMENTS", "工具参数无效");
      return invoke(database, principal, parsed.data);
    }
  };
}

function writeTask(
  database: PaiosDatabase, principal: ToolPrincipal, name: string, args: { idempotency_key?: string },
  operation: () => { before?: LocalTask; task: LocalTask }
) {
  return database.transaction(() => {
    const key = args.idempotency_key ? principal.kind + ":" + principal.id + ":" + args.idempotency_key : undefined;
    const request = JSON.stringify(args);
    if (key) {
      const cached = database.prepare("SELECT tool_name, result_json FROM agent_idempotency WHERE idempotency_key = ?").get(key) as { tool_name: string; result_json: string } | undefined;
      if (cached) {
        const stored = JSON.parse(cached.result_json) as { request: string; task: LocalTask };
        if (cached.tool_name !== name || stored.request !== request) throw new ToolError(409, "IDEMPOTENCY_CONFLICT", "同一个操作键对应不同的请求");
        return { task: stored.task };
      }
    }
    const { before, task } = operation();
    const audit = recordAudit(database, {
      actor: "agent", agentTokenId: principal.id, agentName: principal.name, toolName: name,
      action: principal.kind + "." + name, target: { entityType: "task", table: "tasks", whereColumn: "id", entityId: task.id },
      request: { account_id: principal.account.id }, before, after: task, result: "ok"
    });
    if (!audit) throw new Error("Could not record the task change");
    if (key) database.prepare("INSERT INTO agent_idempotency (idempotency_key, tool_name, result_json, created_at) VALUES (?, ?, ?, ?)").run(key, name, JSON.stringify({ request, task }), new Date().toISOString());
    return { task };
  })();
}

const definitions = [
  definition("today_get", "tasks:read", "查询当前账号今天的待办", {}, (database) => {
    const timezone = getSetting(database, "timezone", "Asia/Shanghai");
    const date = localDateInTimezone(timezone);
    return { date, timezone, tasks: findTasks(database, { date }) };
  }),
  definition("tasks_list", "tasks:read", "查询当前账号的待办", {
    q: z.string().trim().min(1).max(200).optional(),
    date: localTaskDate.optional(),
    limit: z.number().int().min(1).max(30).optional()
  }, (database, _principal, args) => ({ tasks: findTasks(database, args) })),
  definition("tasks_get", "tasks:read", "读取当前账号中指定待办的详情", {
    id: localTaskId
  }, (database, _principal, args) => ({ task: readLocalTask(database, args.id) })),
  definition("tasks_create", "tasks:create", "新增普通待办", {
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    due_date: localTaskDate.optional(),
    idempotency_key: writeKey
  }, (database, principal, args) => writeTask(database, principal, "tasks_create", args, () => {
    const id = insertTask(database, args, new Date().toISOString());
    return { task: readLocalTask(database, id) };
  })),
  definition("tasks_append_note", "tasks:note", "在当前账号的未完成待办中追加备注", {
    id: localTaskId, note: z.string().trim().min(1).max(2000), idempotency_key: writeKey
  }, (database, principal, args) => writeTask(database, principal, "tasks_append_note", args, () => {
    const before = readLocalTask(database, args.id);
    if (before.status !== "todo") throw new ToolError(409, "TASK_NOT_OPEN", "只能在未完成的待办中补备注");
    const description = before.description ? before.description + "\n\n" + args.note : args.note;
    if (description.length > 10000) throw new ToolError(409, "NOTE_TOO_LONG", "追加后备注超过长度限制");
    database.prepare("UPDATE tasks SET description = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ?").run(description, new Date().toISOString(), before.id);
    return { before, task: readLocalTask(database, before.id) };
  }))
];

const toolsByName = new Map(definitions.map((tool) => [tool.schema.name, tool]));

export function listLocalTaskTools(principal: ToolPrincipal): Tool[] {
  return definitions.filter((tool) => principal.scopes.has(tool.scope)).map((tool) => tool.schema);
}

export function executeLocalTaskTool(database: PaiosDatabase, principal: ToolPrincipal, name: string, input: unknown): unknown {
  const tool = toolsByName.get(name);
  if (!tool) throw new ToolError(403, "TOOL_FORBIDDEN", "此工具未获批准");
  requireToolScope(principal, tool.scope);
  return tool.invoke(database, principal, input);
}
