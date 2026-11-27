import { useEffect, useState } from "react";
import { McpSettings } from "../components/McpSettings.js";
import { PageHeader } from "../components/PageHeader.js";
import { apiJson } from "../lib/api.js";

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
  const [weeklyBackup, setWeeklyBackup] = useState<WeeklyBackup | null>(null);
  const [weeklyBackups, setWeeklyBackups] = useState<BackupFile[]>([]);

  useEffect(() => {
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

  return (
    <div className="page-stack page-settings">
      <PageHeader title="设置" />
      {accountControls}
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
