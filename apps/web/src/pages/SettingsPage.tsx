import { useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader.js";
import { apiJson, jsonRequest } from "../lib/api.js";

type AgentToken = {
  id: string;
  name: string;
  scopes: string[];
  scope_label: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

type CreatedAgentToken = {
  token: { id: string; name: string; scopes: string[]; value: string };
  setup: { command: string; args: string[]; env: Record<string, string> };
};

type AgentConnection = {
  service: string;
  token: { id: string; name: string; scopes: string[] };
  tool_catalog_version: string;
  readable_tool_count: number;
  writable_tool_count: number;
  timezone: string;
};

type AgentActivity = {
  at: string;
  agent_name: string | null;
  tool_name: string | null;
  action: string;
  result: string;
};

type WeeklyBackup = {
  status: "created" | "skipped" | "failed";
  anchorDate: string;
  path?: string;
  error?: string;
};

type BackupFile = {
  name: string;
  size: number;
  valid?: boolean;
};

export function SettingsPage() {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [agentTokens, setAgentTokens] = useState<AgentToken[]>([]);
  const [agentName, setAgentName] = useState("我的 Agent");
  const [agentPreset, setAgentPreset] = useState("ordinary");
  const [createdAgentToken, setCreatedAgentToken] = useState<CreatedAgentToken | null>(null);
  const [connectionTest, setConnectionTest] = useState<AgentConnection | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [agentActivity, setAgentActivity] = useState<AgentActivity[]>([]);
  const [weeklyBackup, setWeeklyBackup] = useState<WeeklyBackup | null>(null);
  const [weeklyBackups, setWeeklyBackups] = useState<BackupFile[]>([]);

  useEffect(() => {
    apiJson<{ base_url?: string; model?: string }>("/workbench/config").then((result) => {
      setBaseUrl(result.base_url ?? "");
      setModel(result.model ?? "");
    }).catch(() => undefined);
    apiJson<{ configured: boolean }>("/settings/api-key").then((result) => setHasKey(result.configured)).catch(() => undefined);
    refreshAgentTokens();
    refreshAgentActivity();
    refreshBackups();
  }, []);

  async function refreshAgentTokens() {
    try {
      const result = await apiJson<{ tokens: AgentToken[] }>("/settings/agent-tokens");
      setAgentTokens(result.tokens);
    } catch {
      // Older running services do not have token management yet.
    }
  }

  async function refreshAgentActivity() {
    try {
      const result = await apiJson<{ activity: AgentActivity[] }>("/settings/agent-tokens/activity");
      setAgentActivity(result.activity);
    } catch {
      // Older running services do not have Agent activity yet.
    }
  }

  async function refreshBackups() {
    try {
      const result = await apiJson<{ weekly_backup?: WeeklyBackup | null; weekly_backups: BackupFile[] }>("/system/backups");
      setWeeklyBackup(result.weekly_backup ?? null);
      setWeeklyBackups(result.weekly_backups);
    } catch {
      // Older running services may not expose backup status yet.
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const config: Record<string, string> = {};
      if (baseUrl.trim()) config.base_url = baseUrl.trim();
      if (model.trim()) config.model = model.trim();
      if (Object.keys(config).length) await apiJson("/workbench/config", jsonRequest("PATCH", config));
      if (apiKey.trim()) {
        await apiJson("/settings/api-key", jsonRequest("PUT", { api_key: apiKey.trim() }));
        setHasKey(true);
        setApiKey("");
      }
      setMessage("配置已保存");
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    try {
      await apiJson("/settings/api-key", jsonRequest("PUT", { api_key: "" }));
      setHasKey(false);
      setMessage("API Key 已清除");
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "清除失败");
    }
  }

  async function createAgentToken() {
    setMessage(null);
    try {
      const result = await apiJson<CreatedAgentToken>("/settings/agent-tokens", jsonRequest("POST", { name: agentName, preset: agentPreset }));
      setCreatedAgentToken(result);
      setMessage("接入 Token 已创建；它只会在这里显示，请立即复制保存");
      await refreshAgentTokens();
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "Token 创建失败");
    }
  }

  async function revokeAgentToken(id: string) {
    try {
      await apiJson(`/settings/agent-tokens/${encodeURIComponent(id)}/revoke`, { method: "POST" });
      setMessage("Token 已撤销");
      await refreshAgentTokens();
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "Token 撤销失败");
    }
  }

  async function rotateAgentToken(id: string) {
    try {
      const result = await apiJson<CreatedAgentToken>(`/settings/agent-tokens/${encodeURIComponent(id)}/rotate`, { method: "POST" });
      setCreatedAgentToken(result);
      setMessage("Token 已轮换；旧 Token 已撤销，请更新外部 Agent 配置");
      await refreshAgentTokens();
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "Token 轮换失败");
    }
  }

  async function copy(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(successMessage);
    } catch {
      setMessage("复制失败，请手动复制");
    }
  }

  async function testConnection(value: string) {
    setTestingConnection(true);
    setConnectionTest(null);
    try {
      const result = await apiJson<{ connection: AgentConnection }>("/settings/agent-tokens/test", jsonRequest("POST", { token: value }));
      setConnectionTest(result.connection);
      setMessage("连接测试通过：服务、Token、权限和时区均正常");
      await refreshAgentTokens();
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : "连接测试失败");
    } finally {
      setTestingConnection(false);
    }
  }

  return (
    <div className="page-stack page-settings">
      <PageHeader meta="Key 只保存在本机" title="设置" />
      {message ? <div className="notice">{message}</div> : null}
      <section className="panel settings-panel">
        <div className="panel-heading">
          <h2>AI API 配置</h2>
          <span className={hasKey ? "key-status ready" : "key-status"}>{hasKey ? "已配置" : "未配置"}</span>
        </div>
        <label className="form-field"><span>Base URL</span><input className="cell-input" onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" value={baseUrl} /></label>
        <label className="form-field"><span>模型</span><input className="cell-input" onChange={(event) => setModel(event.target.value)} placeholder="gpt-4o-mini" value={model} /></label>
        <label className="form-field">
          <span>API Key {hasKey ? "（留空表示不修改）" : ""}</span>
          <input className="cell-input" onChange={(event) => setApiKey(event.target.value)} placeholder={hasKey ? "已保存，输入新 Key 可替换" : "输入 API Key"} type="password" value={apiKey} />
        </label>
        <div className="settings-actions">
          <button className="primary-button" onClick={() => void save()} type="button">{saving ? "保存中…" : "保存配置"}</button>
          {hasKey ? <button className="secondary-button" onClick={() => void clearKey()} type="button">清除 API Key</button> : null}
        </div>
      </section>
      <section className="panel settings-panel backup-status-panel">
        <div className="panel-heading">
          <h2>本地周备份</h2>
          <span className="key-status ready">保留 3 份</span>
        </div>
        <p className="settings-help">每次打开程序检查本地时区对应的周日备份。备份先校验完整性，再替换旧文件；失败不会阻止程序启动，并会在下次打开时重试。</p>
        <div className="backup-status-row">
          <strong>{weeklyBackup?.status === "failed" ? "本次备份失败" : weeklyBackup?.status === "created" ? "本次已完成备份" : weeklyBackup?.status === "skipped" ? "本周备份已存在" : "等待下次启动检查"}</strong>
          <span>{weeklyBackup?.anchorDate ? `周日：${weeklyBackup.anchorDate}` : "—"}</span>
        </div>
        {weeklyBackup?.status === "failed" ? <div className="notice error backup-error">{weeklyBackup.error ?? "未知错误"}；下次启动会自动重试</div> : null}
        <div className="backup-file-list">
          {weeklyBackups.length ? weeklyBackups.map((backup) => <div className="backup-file-row" key={backup.name}><span>{backup.name}</span><span className="muted">{backup.valid === false ? "校验失败" : "可恢复"} · {Math.max(1, Math.round(backup.size / 1024))} KB</span></div>) : <span className="muted">还没有周备份</span>}
        </div>
        <button className="text-button" onClick={() => void refreshBackups()} type="button">刷新状态</button>
      </section>
      <section className="panel settings-panel agent-access-panel">
        <div className="panel-heading">
          <h2>MCP / Skill 接入</h2>
          <span className="key-status ready">本机 Agent</span>
        </div>
        <p className="settings-help">给外部 Agent 使用的钥匙。Token 只在创建或轮换时显示一次，数据库只保存不可逆摘要。</p>
        <div className="form-row agent-token-create">
          <label className="form-field"><span>名称</span><input className="cell-input" onChange={(event) => setAgentName(event.target.value)} value={agentName} /></label>
          <label className="form-field"><span>权限</span><select className="select-input" onChange={(event) => setAgentPreset(event.target.value)} value={agentPreset}><option value="readonly">只读</option><option value="tasks_projects">任务和项目</option><option value="finance_health">财务和健康</option><option value="ordinary">全部普通能力</option></select></label>
          <button className="secondary-button agent-create-button" onClick={() => void createAgentToken()} type="button">创建 Token</button>
        </div>
        {createdAgentToken ? (
          <div className="agent-token-result">
            <div className="agent-token-result-heading"><strong>新 Token（请立即保存）</strong><button className="text-button" onClick={() => void copy(createdAgentToken.token.value, "Token 已复制")} type="button">复制 Token</button></div>
            <div className="agent-token-value"><code>{createdAgentToken.token.value}</code></div>
            <div className="settings-actions">
              <button className="secondary-button" onClick={() => void copy(JSON.stringify({ mcpServers: { paios: { command: createdAgentToken.setup.command, args: createdAgentToken.setup.args, env: createdAgentToken.setup.env } } }, null, 2), "MCP 配置已复制")} type="button">复制 MCP 配置</button>
              <button className="secondary-button" disabled={testingConnection} onClick={() => void testConnection(createdAgentToken.token.value)} type="button">{testingConnection ? "测试中…" : "测试连接"}</button>
            </div>
            {connectionTest ? <div className="agent-connection-result">连接正常 · {connectionTest.readable_tool_count} 个可读工具 · {connectionTest.writable_tool_count} 个可写工具 · 时区 {connectionTest.timezone}</div> : null}
          </div>
        ) : null}
        <div className="agent-token-list">
          {agentTokens.map((token) => (
            <div className={token.revoked_at ? "agent-token-row revoked" : "agent-token-row"} key={token.id}>
              <div><strong>{token.name}</strong><span>{token.revoked_at ? "已撤销" : token.scope_label}</span></div>
              <div><span className="muted">最近使用：{token.last_used_at ? new Date(token.last_used_at).toLocaleString("zh-CN") : "尚未使用"}</span>{!token.revoked_at ? <><button className="text-button" onClick={() => void rotateAgentToken(token.id)} type="button">轮换</button><button className="text-button danger-text" onClick={() => void revokeAgentToken(token.id)} type="button">撤销</button></> : null}</div>
            </div>
          ))}
        </div>
        <div className="agent-activity">
          <div className="agent-activity-heading"><strong>最近调用</strong><button className="text-button" onClick={() => void refreshAgentActivity()} type="button">刷新</button></div>
          {agentActivity.length ? agentActivity.slice(0, 8).map((item, index) => <div className="agent-activity-row" key={`${item.at}-${item.tool_name}-${index}`}><span>{item.tool_name ?? item.action}</span><span className="muted">{item.agent_name ?? "Agent"} · {new Date(item.at).toLocaleString("zh-CN")} · {item.result === "ok" ? "成功" : "失败"}</span></div>) : <p className="muted">还没有 Agent 调用记录。</p>}
        </div>
      </section>
    </div>
  );
}
