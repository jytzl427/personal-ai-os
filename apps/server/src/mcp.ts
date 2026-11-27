import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, ErrorCode, ListResourcesRequestSchema, ListToolsRequestSchema, McpError,
  ReadResourceRequestSchema, type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { openDatabase, type PaiosDatabase } from "@paios/db";
import { existsSync } from "node:fs";
import { checkPendingRestore } from "./account-mcp-api.js";
import { AccountStore, accountRegistryPath } from "./accounts.js";
import { loadConfig, type ServerConfig } from "./config.js";
import { executeLocalTaskTool, listLocalTaskTools, missingGrant, ToolError } from "./local-task-tools.js";
import { SingleWriterLock } from "./lock.js";
import { McpGrants } from "./mcp-grants.js";

type McpAccess = {
  list: () => Promise<Tool[]>;
  call: (name: string, input: Record<string, unknown>) => Promise<unknown>;
};

function mcpErrorPayload(error: unknown) {
  return error instanceof ToolError
    ? { code: error.code, message: error.message }
    : { code: "MCP_UNAVAILABLE", message: "本机 MCP 暂时不可用" };
}

function httpAccess(token: string, defaultPort = 4738): McpAccess {
  const base = new URL(process.env.PAIOS_URL || "http://127.0.0.1:" + defaultPort);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) {
    throw new Error("PAIOS_URL must be a loopback HTTP origin such as http://127.0.0.1:4738");
  }
  async function request(path: string, input?: Record<string, unknown>) {
    const response = await fetch(new URL("/api/v1/mcp/tools" + path, base), {
      method: input ? "POST" : "GET",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: input ? JSON.stringify(input) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(10_000)
    });
    const data = await response.json() as { tools?: Tool[]; result?: unknown; error?: { code: string; message: string } };
    if (!response.ok) {
      const statuses = [400, 401, 403, 404, 409] as const;
      const status = statuses.find((candidate) => candidate === response.status) ?? 503;
      throw new ToolError(status, data.error?.code ?? "MCP_UNAVAILABLE", data.error?.message ?? "本机 MCP 暂时不可用");
    }
    return data;
  }
  return {
    list: async () => (await request("")).tools ?? [],
    call: async (name, input) => {
      if (!/^[a-z][a-z_]{0,63}$/.test(name)) throw new ToolError(403, "TOOL_FORBIDDEN", "此工具未获批准");
      return (await request("/" + name, input)).result;
    }
  };
}

function directAccess(config: ServerConfig, token: string): McpAccess {
  const online = httpAccess(token, config.port);
  function runLocal<T>(work: (grants: McpGrants, accounts: AccountStore) => T, whileOnline: () => Promise<T>): T | Promise<T> {
    let lock: SingleWriterLock;
    try {
      lock = SingleWriterLock.acquire(config.dataDir);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("SINGLE_WRITER_LOCKED:")) return whileOnline();
      throw error;
    }
    let accounts: AccountStore | undefined;
    try {
      if (!existsSync(accountRegistryPath(config.dataDir))) throw missingGrant();
      accounts = new AccountStore(config.dataDir);
      return work(new McpGrants(accounts), accounts);
    } finally {
      try { accounts?.database.close(); } finally { lock.release(); }
    }
  }

  return {
    list: async () => runLocal((grants) => {
      const principal = grants.authenticate(token);
      if (!principal) throw missingGrant();
      return listLocalTaskTools(principal);
    }, online.list),
    call: async (name, input) => runLocal((grants, accounts) => {
      const principal = grants.authenticate(token);
      if (!principal) throw missingGrant();
      const dataDir = accounts.dataDir(principal.account.id);
      checkPendingRestore(dataDir);
      const database: PaiosDatabase = openDatabase(dataDir, { applyPendingRestore: false, seedAgentToken: false });
      try {
        return executeLocalTaskTool(database, principal, name, input);
      } finally {
        database.close();
      }
    }, () => online.call(name, input))
  };
}

const todayUri = "paios://today";
const todayResource = { uri: todayUri, name: "今日待办", mimeType: "application/json" };
const textResult = (data: unknown) => ({ type: "text" as const, text: JSON.stringify(data) });

async function serveMcp(access: McpAccess): Promise<void> {
  const server = new Server({ name: "paios", version: "1.1.0" }, { capabilities: { tools: {}, resources: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    try {
      return { tools: await access.list() };
    } catch (error) {
      throw new McpError(ErrorCode.InvalidRequest, mcpErrorPayload(error).code);
    }
  });
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      return { content: [textResult(await access.call(params.name, params.arguments ?? {}))] };
    } catch (error) {
      return { isError: true, content: [textResult({ error: mcpErrorPayload(error) })] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    try {
      const tools = await access.list();
      return { resources: tools.some((tool) => tool.name === "today_get") ? [todayResource] : [] };
    } catch (error) {
      throw new McpError(ErrorCode.InvalidRequest, mcpErrorPayload(error).code);
    }
  });
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    if (params.uri !== todayUri) throw new McpError(ErrorCode.InvalidParams, "Unknown resource");
    try {
      const result = await access.call("today_get", {});
      return { contents: [{ uri: todayUri, mimeType: todayResource.mimeType, text: JSON.stringify(result) }] };
    } catch (error) {
      throw new McpError(ErrorCode.InvalidRequest, mcpErrorPayload(error).code);
    }
  });
  await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }));
  process.stdin.once("end", () => { void server.close(); });
}

export async function runMcp(): Promise<void> {
  const token = process.env.PAIOS_TOKEN?.trim() ?? "";
  await serveMcp(httpAccess(token));
}

export async function runDirectMcp(): Promise<void> {
  const token = process.env.PAIOS_TOKEN?.trim() ?? "";
  await serveMcp(directAccess(loadConfig(), token));
}
