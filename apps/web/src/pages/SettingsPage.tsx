import { useEffect, useState } from "react";
import { McpSettings } from "../components/McpSettings.js";
import { PageHeader } from "../components/PageHeader.js";
import { apiJson, jsonRequest } from "../lib/api.js";

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

export function SettingsPage({ accountControls }: { accountControls: React.ReactNode }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [weeklyBackup, setWeeklyBackup] = useState<WeeklyBackup | null>(null);
  const [weeklyBackups, setWeeklyBackups] = useState<BackupFile[]>([]);

  useEffect(() => {
    apiJson<{ base_url?: string; model?: string }>("/workbench/config").then((result) => {
      setBaseUrl(result.base_url ?? "");
      setModel(result.model ?? "");
    }).catch(() => undefined);
    apiJson<{ configured: boolean }>("/settings/api-key").then((result) => setHasKey(result.configured)).catch(() => undefined);
    refreshBackups();
  }, []);

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

  return (
    <div className="page-stack page-settings">
      <PageHeader meta="Key 只保存在本机" title="设置" />
      {accountControls}
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
      <McpSettings />
    </div>
  );
}
