import { useEffect, useRef, useState } from "react";
import { DeleteButton } from "../components/DeleteButton.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import type { Route } from "../lib/route.js";

type Conversation = { id: string; title: string; archived_at?: string | null; updated_at?: string };
type ToolTrace = { name: string; source?: string; ok?: boolean; arguments_json?: string; status?: string };
type Message = { id?: string; role: "user" | "assistant"; content_text?: string; content?: string; tool_calls?: ToolTrace[] };
type Attachment = { filename: string; mime: string; data_url?: string };

function textOf(message: Message) {
  return message.content_text ?? message.content ?? "";
}

const PHASE_CHECK_PROMPT = "请根据 attention_get 做当前时段主动检查。先读取真实数据，列出逾期、未安排日期、周期任务、项目推进、阶段计划、可能未登记的消费、缺失健康数据和待确认事项。不要删除或归档。把检查结果写入今日复盘草稿，并明确区分客观事实和推测。软件关闭期间不要承诺主动联系我。";

export function ButlerPage({ conversationId, onNavigate }: { conversationId: string | null; onNavigate: (route: Route) => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const messageLoadVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const sendTextRef = useRef<(text: string, options?: { title?: string; attachment?: Attachment | null }) => Promise<void>>(async () => undefined);
  const busyRef = useRef(false);

  function loadConversations() {
    apiJson<{ conversations: Conversation[] }>("/conversations")
      .then((result) => setConversations(result.conversations))
      .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "对话历史加载失败"));
  }

  function loadMessages(id: string) {
    const version = ++messageLoadVersion.current;
    apiJson<{ messages: Message[] }>(`/conversations/${encodeURIComponent(id)}`)
      .then((result) => { if (version === messageLoadVersion.current) setMessages(result.messages); })
      .catch((reason: unknown) => setMessage(reason instanceof Error ? reason.message : "对话加载失败"));
  }

  useEffect(() => { loadConversations(); }, []);
  useEffect(() => {
    if (conversationId) loadMessages(conversationId);
    else setMessages([]);
  }, [conversationId]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);
  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    let cancelled = false;
    async function maybeCheck() {
      if (cancelled || activeRequest.current) return;
      try {
        const attention = await apiJson<{ date: string; phase: string; items: string[] }>("/system/attention");
        const key = `paios-butler-check:${attention.date}:${attention.phase}`;
        if (!attention.items.length || sessionStorage.getItem(key) || busyRef.current || activeRequest.current) return;
        sessionStorage.setItem(key, "1");
        await sendTextRef.current(PHASE_CHECK_PROMPT, { title: `${attention.date} ${attention.phase}检查` });
      } catch {
        // 无模型配置或服务未就绪时只保留顶部摘要，不打断页面。
      }
    }
    void maybeCheck();
    const timer = window.setInterval(() => { void maybeCheck(); }, 60 * 1000);
    const onVisible = () => { if (document.visibilityState === "visible") void maybeCheck(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  async function newConversation() {
    try {
      const result = await apiJson<{ conversation: Conversation }>("/conversations", jsonRequest("POST", { title: "新对话" }));
      loadConversations();
      onNavigate({ name: "butler", conversationId: result.conversation.id });
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "新建对话失败");
    }
  }

  async function archiveConversation(id: string) {
    try {
      await apiJson(`/conversations/${id}/archive`, { method: "POST" });
      loadConversations();
      if (id === conversationId) onNavigate({ name: "butler", conversationId: null });
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "对话归档失败");
    }
  }

  async function deleteConversation(id: string) {
    try {
      await apiJson(`/conversations/${id}`, { method: "DELETE" });
      loadConversations();
      if (id === conversationId) onNavigate({ name: "butler", conversationId: null });
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "对话删除失败");
    }
  }

  async function copyConversation(id: string) {
    try {
      const result = await apiJson<{ messages: Message[] }>(`/conversations/${encodeURIComponent(id)}`);
      const text = result.messages.map((item) => `${item.role === "user" ? "我" : "管家"}：${textOf(item)}`).join("\n\n");
      await navigator.clipboard.writeText(text || "（空对话）");
      setMessage("已复制对话");
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "复制失败");
    }
  }

  async function sendText(sentText: string, options?: { title?: string; attachment?: Attachment | null }) {
    if (!sentText.trim() || busy) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const controller = new AbortController();
    activeRequest.current = controller;
    const sentAttachment = options?.attachment === undefined ? attachment : options.attachment;
    const localMessageId = `local-${Date.now()}`;
    messageLoadVersion.current += 1;
    setMessages((current) => [...current, { id: localMessageId, role: "user", content_text: sentText }]);
    setDraft("");
    setAttachment(null);
    let createdConversationId: string | null = null;
    try {
      let id = conversationId;
      if (!id) {
        const result = await apiJson<{ conversation: Conversation }>("/conversations", { ...jsonRequest("POST", { title: (options?.title ?? sentText).slice(0, 30) }), signal: controller.signal });
        id = result.conversation.id;
        createdConversationId = id;
      }
      const result = await apiJson<{ message: Message; user_message_id?: string }>(`/conversations/${id}/messages`, { ...jsonRequest("POST", {
        content: sentText,
        attachments: sentAttachment ? [sentAttachment] : []
      }), signal: controller.signal });
      setMessages((current) => [...current.filter((item) => item.id !== localMessageId), { id: result.user_message_id, role: "user", content_text: sentText }, result.message]);
      loadConversations();
      if (createdConversationId) onNavigate({ name: "butler", conversationId: createdConversationId });
    } catch (reason: unknown) {
      if (reason instanceof Error && reason.name === "AbortError") {
        setMessage("本次回答已取消，已发送的消息仍保留。");
        if (createdConversationId) {
          loadConversations();
          onNavigate({ name: "butler", conversationId: createdConversationId });
        }
      } else {
        setMessage(reason instanceof Error ? reason.message : "消息发送失败");
      }
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  }
  sendTextRef.current = sendText;

  async function send() {
    await sendText(draft.trim());
  }

  function cancelSend() {
    activeRequest.current?.abort();
  }

  function chooseFile(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAttachment({ filename: file.name, mime: file.type || "application/octet-stream", data_url: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <div className="butler-layout">
      <aside className="conversation-list">
        <div className="conversation-heading">
          <h2>对话</h2>
          <button className="primary-button" onClick={() => void newConversation()} type="button">新对话</button>
        </div>
        {conversations.map((item) => (
          <div className={item.id === conversationId ? "conversation-item active" : "conversation-item"} key={item.id}>
            <button onClick={() => onNavigate({ name: "butler", conversationId: item.id })} type="button">{item.title}</button>
            <div className="conversation-actions">
              <button aria-label="归档对话" className="icon-button" onClick={() => void archiveConversation(item.id)} type="button">归档</button>
              <button aria-label="复制对话" className="icon-button" onClick={() => void copyConversation(item.id)} type="button">复制</button>
              <DeleteButton label={`删除对话 ${item.title}`} onClick={() => void deleteConversation(item.id)} />
            </div>
          </div>
        ))}
        {!conversations.length ? <p className="muted" style={{ padding: "8px" }}>还没有对话</p> : null}
      </aside>
      <section className="butler-chat">
        <div className="message-list" ref={listRef}>
          {messages.length
            ? messages.map((item, index) => (
                <div className={item.role === "user" ? "chat-bubble user" : "chat-bubble assistant"} key={item.id ?? index}>
                  {textOf(item)}
                  {item.tool_calls?.length ? <div className="message-sources">已读取：{item.tool_calls.map((trace) => <span className={trace.ok === false || trace.status === "error" ? "message-source error" : "message-source"} key={`${trace.name}-${trace.source}`}>{trace.source ?? trace.name}</span>)}</div> : null}
                  <button className="copy-button" onClick={() => void navigator.clipboard?.writeText(textOf(item))} type="button">复制</button>
                </div>
              ))
            : <div className="chat-empty">从一句话开始，让管家读取真实数据后制定计划、推进项目和复盘。</div>}
        </div>
        {message ? <div className="notice error" style={{ margin: "0 16px 8px" }}>{message}</div> : null}
        {attachment ? (
          <div className="attachment-chip">
            {attachment.filename}
            <button onClick={() => setAttachment(null)} type="button">×</button>
          </div>
        ) : null}
        <div className="chat-compose">
          <textarea
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="输入消息，Enter 发送"
            value={draft}
          />
          <input accept="image/*" hidden onChange={(event) => chooseFile(event.target.files?.[0])} ref={fileRef} type="file" />
          <button aria-label="添加图片" className="secondary-button" onClick={() => fileRef.current?.click()} type="button">图片</button>
          <button className="secondary-button" disabled={busy} onClick={() => void sendText(PHASE_CHECK_PROMPT, { title: "时段检查" })} type="button">时段检查</button>
          <button className="primary-button" onClick={() => busy ? cancelSend() : void send()} type="button">{busy ? "取消" : "发送"}</button>
        </div>
      </section>
    </div>
  );
}
