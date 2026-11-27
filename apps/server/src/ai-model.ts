import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const modelCallSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  arguments: z.string().max(8192)
});
export const modelReplySchema = z.object({
  text: z.string().max(12000),
  calls: z.array(modelCallSchema).max(4)
});
export type ModelReply = z.infer<typeof modelReplySchema>;
export type ModelMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; [key: string]: unknown };
export type AiModel = {
  mode: "mock" | "openai";
  reply: (messages: ModelMessage[], tools: Tool[], signal: AbortSignal) => Promise<ModelReply>;
};

const modelEndpoint = "https://api.openai.com/v1/chat/completions";
const fixedModel = "gpt-4o-mini";

const completionSchema = z.object({
  choices: z.array(z.object({
    message: z.object({
      content: z.string().nullable(),
      tool_calls: z.array(z.object({
        id: z.string(),
        type: z.literal("function"),
        function: z.object({ name: z.string(), arguments: z.string() })
      })).optional()
    })
  })).min(1)
});

function openAiModel(key: string): AiModel {
  return {
    mode: "openai",
    async reply(messages, tools, signal) {
      const response = await fetch(modelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        redirect: "error",
        signal,
        body: JSON.stringify({
          model: fixedModel, messages, max_completion_tokens: 800,
          ...(tools.length ? { tools: tools.map((tool) => ({
            type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
          })), parallel_tool_calls: false } : {})
        })
      });
      if (!response.ok) throw new Error("Model provider returned HTTP " + response.status);
      const parsed = completionSchema.parse(await response.json()).choices[0]!.message;
      return modelReplySchema.parse({
        text: parsed.content ?? "",
        calls: (parsed.tool_calls ?? []).map((call) => ({ id: call.id, ...call.function }))
      });
    }
  };
}

function mockCall(name: string, args: Record<string, unknown>): ModelReply {
  return { text: "", calls: [{ id: "mock-call", name, arguments: JSON.stringify(args) }] };
}

export const mockAiModel: AiModel = {
  mode: "mock",
  async reply(messages) {
    const last = messages.at(-1);
    if (last?.role === "tool") {
      const result = JSON.parse(last.content ?? "{}") as {
        error?: { message: string }; pending_confirmation?: boolean; task?: { title: string }; tasks?: Array<{ title: string }>;
      };
      if (result.error) return { text: "模拟结果：" + result.error.message, calls: [] };
      if (result.pending_confirmation) return { text: "模拟结果：请核对下方的待确认操作。", calls: [] };
      if (result.tasks) {
        const titles = result.tasks.map((task) => task.title).join("、");
        return { text: titles ? "模拟结果：" + titles.slice(0, 6000) : "模拟结果：没有匹配的待办。", calls: [] };
      }
      return { text: "模拟结果：" + (result.task?.title ?? "已处理。"), calls: [] };
    }
    const prompt = last?.content?.trim() ?? "";
    if (prompt === "查看今日待办") return mockCall("today_get", {});
    const [command, subject, ...rest] = prompt.split(/\s+/);
    if (command === "查询待办") return mockCall("tasks_list", subject ? { q: [subject, ...rest].join(" ") } : {});
    if (command === "新增待办" && subject) return mockCall("tasks_create", { title: [subject, ...rest].join(" ") });
    if (command === "补备注" && subject && rest.length) return mockCall("tasks_append_note", { id: subject, note: rest.join(" ") });
    if (command === "改期" && subject && rest.length === 1) return mockCall("tasks_propose_change", { task_id: subject, operation: "reschedule", due_date: rest[0] });
    if (command === "完成" && subject && !rest.length) return mockCall("tasks_propose_change", { task_id: subject, operation: "complete" });
    if (command === "删除" && subject && !rest.length) return mockCall("tasks_propose_change", { task_id: subject, operation: "delete" });
    return { text: "模拟模式支持「查看今日待办」「查询待办 关键词」「新增待办 标题」「补备注 待办ID 内容」及指定待办 ID 的改期、完成或删除请求。", calls: [] };
  }
};

export function configuredAiModel(): AiModel | undefined {
  if (process.env.PAIOS_AI_MODE === "mock") return mockAiModel;
  const key = process.env.PAIOS_AI_MODE === "openai" ? process.env.PAIOS_AI_MODEL_API_KEY?.trim() : undefined;
  return key ? openAiModel(key) : undefined;
}
