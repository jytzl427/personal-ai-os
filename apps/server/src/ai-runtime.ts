import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { modelReplySchema, type AiModel, type ModelMessage, type ModelReply } from "./ai-model.js";
import { ToolError } from "./local-task-tools.js";

const python = "/usr/bin/python3";
const assets = new URL(import.meta.url.endsWith(".ts") ? "../dist/ai-worker/" : "./ai-worker/", import.meta.url);
const worker = fileURLToPath(new URL("worker.py", assets));
const sandbox = fileURLToPath(new URL("sandbox.so", assets));
const messageLimit = 2 * 1024 * 1024;
const readyMessage = z.object({ type: z.literal("ready"), landlock_abi: z.number().int().nonnegative(), pid: z.number().int().positive() });
const subprocessMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("model"), messages: z.array(z.object({
    role: z.enum(["system", "user", "assistant", "tool"]), content: z.string().nullable()
  }).passthrough()).min(2).max(11), allow_tools: z.boolean() }),
  z.object({ type: z.literal("tool"), name: z.string().max(64) }),
  z.object({ type: z.literal("complete"), text: z.string().max(12000) })
]);

export function aiWorkerInstalled(): boolean {
  return process.platform === "linux" && existsSync(worker) && existsSync(sandbox) && existsSync(python);
}

function runtimeError(): ToolError {
  return new ToolError(503, "AI_RUNTIME_UNAVAILABLE", "隔离的 AI 进程暂时不可用");
}

async function workerSession<T>(
  options: { signal?: AbortSignal; inspect?: boolean },
  callback: (session: {
    next: () => Promise<unknown>; send: (value: object) => void; pid: number; landlockAbi: number; signal: AbortSignal;
  }) => Promise<T>
): Promise<T> {
  if (!aiWorkerInstalled()) throw runtimeError();
  const timeout = AbortSignal.timeout(30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const child = spawn(python, ["-I", "-S", worker, sandbox, ...(options.inspect ? ["--inspect"] : [])], {
    cwd: "/", env: { LANG: "C.UTF-8" }, stdio: ["pipe", "pipe", "pipe"], signal
  });
  child.on("error", () => undefined);
  child.stdin.on("error", () => undefined);
  child.stderr.resume();
  const closed = once(child, "close").catch(() => undefined);
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const reader = lines[Symbol.asyncIterator]();
  let received = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    received += chunk.length;
    if (received > messageLimit) child.kill("SIGKILL");
  });
  async function next(): Promise<unknown> {
    const line = await reader.next();
    if (line.done || received > messageLimit || signal.aborted) throw runtimeError();
    return JSON.parse(line.value) as unknown;
  }
  function send(value: object): void {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) >= messageLimit || signal.aborted) throw runtimeError();
    child.stdin.write(json + "\n");
  }
  try {
    const ready = readyMessage.parse(await next());
    if (ready.pid !== child.pid) throw runtimeError();
    return await callback({ next, send, pid: ready.pid, landlockAbi: ready.landlock_abi, signal });
  } catch (error) {
    if (error instanceof ToolError) throw error;
    throw runtimeError();
  } finally {
    child.stdin.end();
    child.kill("SIGKILL");
    lines.close();
    await closed;
  }
}

export async function runAiWorker(input: {
  prompt: string; model: AiModel; tools: Tool[]; signal?: AbortSignal;
  invoke: (name: string, args: unknown) => unknown;
  recheck: () => void;
}): Promise<string> {
  return workerSession({ signal: input.signal }, async ({ next, send, signal }) => {
    send({ type: "start", prompt: input.prompt });
    let modelCalls = 0;
    let toolCalls = 0;
    let pendingCalls: ModelReply["calls"] = [];
    for (let step = 0; step < 11; step += 1) {
      const message = subprocessMessage.parse(await next());
      input.recheck();
      if (message.type === "complete") {
        if (pendingCalls.length) throw runtimeError();
        return message.text;
      }
      if (message.type === "model") {
        if (++modelCalls > 5 || pendingCalls.length) throw runtimeError();
        const tools = message.allow_tools && toolCalls < 4 ? input.tools : [];
        const reply = modelReplySchema.parse(await input.model.reply(message.messages as ModelMessage[], tools, signal));
        input.recheck();
        pendingCalls = message.allow_tools ? [...reply.calls] : [];
        send({ type: "model_reply", reply });
      } else {
        const call = pendingCalls.shift();
        if (++toolCalls > 4 || call?.name !== message.name) throw runtimeError();
        let args: unknown;
        try { args = JSON.parse(call.arguments); } catch {}
        send({ type: "tool_reply", result: input.invoke(call.name, args) });
      }
    }
    throw runtimeError();
  });
}

export async function inspectAiWorker(files: string[]) {
  return workerSession({ inspect: true }, async ({ next, send, pid, landlockAbi }) => {
    const status = readFileSync("/proc/" + pid + "/status", "utf8");
    send({ type: "start", files });
    const result = z.object({
      type: z.literal("inspection"), reads_denied: z.array(z.boolean()), network_denied: z.boolean()
    }).parse(await next());
    return { status, landlockAbi, ...result };
  });
}
