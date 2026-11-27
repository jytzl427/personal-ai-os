import { useEffect, useState, type FormEvent } from "react";
import { apiJson, jsonRequest } from "../lib/api.js";

const scopeLabels = {
  "tasks:read": "查询待办",
  "tasks:create": "新增普通待办",
  "tasks:note": "追加待办备注"
} as const;
type Grant = { id: string; name: string; scopes: Array<keyof typeof scopeLabels>; revoked_at: string | null };
type NewGrant = {
  grant: Grant; token: string; setup: { command: string; args: string[]; env: Record<string, string> };
};
type Activity = { at: string; tool_name: string; agent_name: string };

const prefix = "/account/mcp";

export function McpSettings() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [issued, setIssued] = useState<NewGrant>();
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function refresh() {
    const [grantResult, log] = await Promise.all([
      apiJson<{ grants: Grant[] }>(prefix + "/grants"),
      apiJson<{ activity: Activity[] }>(prefix + "/activity")
    ]);
    setGrants(grantResult.grants);
    setActivity(log.activity);
  }

  useEffect(() => {
    void refresh().catch((reason: Error) => setError(reason.message));
  }, []);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "MCP 操作失败");
    } finally {
      setPending(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const scopes = fields.getAll("scope");
    if (!scopes.length) {
      setError("请至少勾选一个授权范围");
      return;
    }
    await run(async () => {
      setIssued(await apiJson<NewGrant>(prefix + "/grants", jsonRequest("POST", { name: fields.get("name"), scopes })));
      form.reset();
      await refresh();
    });
  }

  async function revise(grant: Grant, action: "rotate" | "revoke") {
    await run(async () => {
      const path = prefix + "/grants/" + encodeURIComponent(grant.id) + "/" + action;
      if (action === "rotate") {
        setIssued(await apiJson<NewGrant>(path, { method: "POST" }));
        setStatus("授权已轮换，旧凭证已失效。");
      } else {
        await apiJson(path, { method: "POST" });
        if (issued?.grant.id === grant.id) setIssued(undefined);
        setStatus("授权已撤销。");
      }
      await refresh();
    });
  }

  return <section className="panel settings-panel agent-access-panel">
    <div className="panel-heading"><h2>MCP 授权</h2></div>
    <form className="account-form" onSubmit={(event) => void create(event)}>
      <label className="form-field">连接名称 <input className="cell-input" name="name" required maxLength={100} /></label>
      <fieldset>
        <legend>授权范围</legend>
        {Object.entries(scopeLabels).map(([scope, label]) => <label className="mcp-scope" key={scope}>
          <input className="ui-checkbox" name="scope" type="checkbox" value={scope} /> {label}
        </label>)}
      </fieldset>
      <button className="primary-button" type="submit" disabled={pending}>创建授权</button>
    </form>
    {error && <p className="notice error" role="alert">{error}</p>}
    {status && <p className="notice" role="status">{status}</p>}
    {issued && <div className="agent-token-result">
      <strong>新凭证仅在这里显示，请复制保存。</strong>
      <div className="agent-token-value"><code>{issued.token}</code></div>
      <div className="settings-actions">
        <button className="secondary-button" type="button" disabled={pending} onClick={() => void run(async () => {
          await navigator.clipboard.writeText(JSON.stringify({ mcpServers: { paios: issued.setup } }, null, 2));
          setStatus("MCP 配置已复制。");
        })}>复制 MCP 配置</button>
        <button className="secondary-button" type="button" disabled={pending} onClick={() => void run(async () => {
          const test = await apiJson<{ tool_count: number }>(prefix + "/grants/check", jsonRequest("POST", { token: issued.token }));
          setStatus("凭证校验通过。可调用工具 " + test.tool_count + " 项。");
        })}>校验凭证</button>
      </div>
    </div>}
    <div className="agent-token-list">
      {grants.map((grant) => <div className="agent-token-row" key={grant.id}>
        <div><strong>{grant.name}</strong><span>{grant.revoked_at ? "已撤销" : grant.scopes.map((scope) => scopeLabels[scope]).join(" · ")}</span></div>
        {!grant.revoked_at && <div>
          <button className="text-button" type="button" disabled={pending} onClick={() => void revise(grant, "rotate")}>轮换</button>
          <button className="text-button danger-text" type="button" disabled={pending} onClick={() => void revise(grant, "revoke")}>撤销</button>
        </div>}
      </div>)}
    </div>
    <div className="agent-activity">
      <div className="agent-activity-heading"><strong>最近写入</strong><button className="text-button" type="button" disabled={pending} onClick={() => void run(refresh)}>刷新</button></div>
      {activity.length ? activity.map((entry, index) => <div className="agent-activity-row" key={entry.at + index}>
        <span>{entry.tool_name}</span><span className="muted">{entry.agent_name} · {new Date(entry.at).toLocaleString("zh-CN")}</span>
      </div>) : <p className="muted">还没有 MCP 写入记录。</p>}
    </div>
  </section>;
}
