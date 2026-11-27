import { useEffect, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { PageHeader } from "../components/PageHeader.js";
import { apiJson, jsonRequest } from "../lib/api.js";

const preferences = {
  "tasks:read": "查询待办",
  "tasks:create": "新增普通待办",
  "tasks:note": "追加待办备注",
  "tasks:propose": "提出改期、完成或删除请求"
} as const;
type Scope = keyof typeof preferences;
type AiStatus = { mode: "disabled" | "mock" | "openai"; scopes: Scope[]; worker_installed: boolean };
type Confirmation = {
  id: string; task_id: string; title: string; challenge: string;
  operation: "reschedule" | "complete" | "delete"; due_date: string | null; previous_due_date: string | null;
  expires_at: string;
};
type Reply = { text: string; confirmations: Confirmation[] };
type Turn = { prompt: string; answer: string };
const operationLabels = { reschedule: "改期", complete: "完成", delete: "删除" } as const;

function describe(confirmation: Confirmation): string {
  if (confirmation.operation === "reschedule") {
    return "将「" + confirmation.title + "」从 " + (confirmation.previous_due_date ?? "未排期") + " 改到 " + confirmation.due_date + "。";
  }
  return "确认" + operationLabels[confirmation.operation] + "「" + confirmation.title + "」。";
}

export function AiPage() {
  const [status, setStatus] = useState<AiStatus>();
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [confirmations, setConfirmations] = useState<Confirmation[]>([]);
  const [selected, setSelected] = useState<Confirmation>();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    apiJson<AiStatus>("/ai/status").then((value) => {
      if (!mounted) return;
      setStatus(value);
      setScopes(value.scopes);
    }).catch((reason: Error) => { if (mounted) setError(reason.message); });
    return () => { mounted = false; };
  }, []);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError("");
    setFeedback("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI 操作失败");
    } finally {
      setPending(false);
    }
  }

  async function savePermissions() {
    await run(async () => {
      const updated = await apiJson<{ scopes: Scope[] }>("/ai/permissions", jsonRequest("PUT", { scopes }));
      setStatus((previous) => previous && { ...previous, scopes: updated.scopes });
      setConfirmations([]);
      setFeedback(updated.scopes.length ? "权限已保存。" : "此账号的 AI 权限已撤销。");
    });
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content) return;
    await run(async () => {
      const reply = await apiJson<Reply>("/ai/chat", jsonRequest("POST", { prompt: content }));
      setTurns((previous) => [...previous, { prompt: content, answer: reply.text }]);
      setConfirmations((previous) => [...previous, ...reply.confirmations]);
      setPrompt("");
    });
  }

  async function confirm(confirmation: Confirmation) {
    setSelected(undefined);
    await run(async () => {
      const { id, task_id, operation, due_date, challenge } = confirmation;
      await apiJson("/ai/confirmations/" + encodeURIComponent(id) + "/approve", jsonRequest("POST", { task_id, operation, due_date, challenge }));
      setConfirmations((previous) => previous.filter((item) => item.id !== id));
      setFeedback("已" + operationLabels[operation] + "「" + confirmation.title + "」。");
    });
  }

  const ready = status?.mode !== "disabled" && status?.worker_installed;
  const canChat = ready && Boolean(status?.scopes.length);
  return <div className="page-stack ai-page">
    <PageHeader title="内置 AI" meta={status?.mode === "mock" ? "本地模拟" : status?.mode === "openai" ? "固定模型入口" : undefined} />
    {status && !ready && <p className="notice">当前实例的 AI 运行环境未启用。</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {feedback && <p className="notice" role="status">{feedback}</p>}
    <section className="panel settings-panel">
      <div className="panel-heading"><h2>当前账号的授权</h2></div>
      <fieldset disabled={!status || pending}>
        <legend>待办权限</legend>
        {Object.entries(preferences).map(([key, description]) => {
          const scope = key as Scope;
          return <label className="mcp-scope" key={scope}>
            <input className="ui-checkbox" type="checkbox" checked={scopes.includes(scope)}
              onChange={(event) => setScopes(event.target.checked ? [...scopes, scope] : scopes.filter((item) => item !== scope))} /> {description}
          </label>;
        })}
      </fieldset>
      <button className="secondary-button" type="button" disabled={!status || pending} onClick={() => void savePermissions()}>保存 AI 权限</button>
    </section>
    <section className="panel settings-panel">
      <div className="panel-heading"><h2>待办助手</h2></div>
      {turns.map((turn, index) => <div className="ai-turn" key={index}>
        <strong>{turn.prompt}</strong><p>{turn.answer}</p>
      </div>)}
      <form className="account-form" onSubmit={(event) => void send(event)}>
        <label className="form-field">任务请求
          <textarea className="cell-input ai-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)}
            disabled={!canChat || pending} maxLength={4000} rows={3} required placeholder="查看今日待办" />
        </label>
        <button className="primary-button" disabled={!canChat || pending} type="submit">发送</button>
      </form>
    </section>
    {confirmations.length > 0 && <section className="panel settings-panel">
      <div className="panel-heading"><h2>待本人确认</h2></div>
      {confirmations.map((item) => <div className="ai-confirmation" key={item.id}>
        <strong>{describe(item)}</strong>
        <small>待办 ID {item.task_id} · {new Date(item.expires_at).toLocaleTimeString("zh-CN")} 到期</small>
        <div className="settings-actions">
          <button className="secondary-button" disabled={pending} type="button" onClick={() => setSelected(item)}>确认{operationLabels[item.operation]}</button>
          <button className="text-button" disabled={pending} type="button"
            onClick={() => setConfirmations((previous) => previous.filter((entry) => entry.id !== item.id))}>忽略</button>
        </div>
      </div>)}
    </section>}
    {selected && <ConfirmDialog title={"确认" + operationLabels[selected.operation] + "待办"} message={describe(selected)}
      confirmLabel="提交确认" onCancel={() => setSelected(undefined)} onConfirm={() => void confirm(selected)} />}
  </div>;
}
