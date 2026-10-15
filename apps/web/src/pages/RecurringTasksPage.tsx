import { useEffect, useMemo, useState } from "react";
import { AddRowButton } from "../components/AddRowButton.js";
import { Checkbox } from "../components/Checkbox.js";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { PageHeader } from "../components/PageHeader.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { todayYmd } from "../lib/dates.js";
import type { Route } from "../lib/route.js";

type Frequency = "daily" | "weekly" | "monthly" | "yearly";
type Rule = { frequency: Frequency; interval: number; weekdays?: number[]; day_of_month?: number; month?: number };
type Recurrence = {
  id: string;
  title: string;
  enabled: boolean;
  rule: Rule | null;
  start_date: string;
  end_date: string | null;
  next_occurrence_date: string | null;
  last_checked_at: string | null;
  last_generated_at: string | null;
  status: string;
  last_error: string | null;
  row_version: number;
  generated_count: number;
  missing_count: number;
  missing_dates: string[];
  orphaned_count: number;
};
type Run = { status: string; generated_count: number; error_count: number; finished_at: string | null } | null;

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];

function todayText(): string {
  return todayYmd();
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const options: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
  return new Intl.DateTimeFormat("zh-CN", options).format(date);
}

function yearOf(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number(value.slice(0, 4));
}

function isCrossYear(row: Pick<Recurrence, "start_date" | "end_date" | "next_occurrence_date">): boolean {
  const startYear = yearOf(row.start_date);
  if (startYear === null) return false;
  const endYear = yearOf(row.end_date);
  const nextYear = yearOf(row.next_occurrence_date);
  return (endYear !== null && endYear !== startYear) || (nextYear !== null && nextYear !== startYear);
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatRule(rule: Rule | null): string {
  if (!rule) return "规则错误";
  const interval = rule.interval === 1 ? "每" : `每${rule.interval}`;
  if (rule.frequency === "daily") return `${interval}天`;
  if (rule.frequency === "weekly") return `${interval}周${(rule.weekdays ?? []).map((day) => weekLabels[day - 1]).join("、")}`;
  if (rule.frequency === "monthly") return `${interval}月${rule.day_of_month ?? "—"}日`;
  return `${interval}年${rule.month ?? "—"}月${rule.day_of_month ?? "—"}日`;
}

function statusText(row: Recurrence): string {
  if (!row.enabled) return row.title ? "已暂停" : "草稿";
  if (row.status === "error") return "错误";
  if (row.orphaned_count > 0) return `有${row.orphaned_count}条异常`;
  if (row.missing_count > 0) return `待补齐 ${row.missing_count}`;
  return "正常";
}

export function RecurringTasksPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [rows, setRows] = useState<Recurrence[]>([]);
  const [latestRun, setLatestRun] = useState<Run>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enabledCount = useMemo(() => rows.filter((row) => row.enabled).length, [rows]);
  const issueCount = useMemo(() => rows.filter((row) => row.status === "error" || row.missing_count > 0 || row.orphaned_count > 0).length, [rows]);

  async function refresh() {
    const result = await apiJson<{ recurrences: Recurrence[]; latest_run: Run }>("/task-recurrences");
    setRows(result.recurrences);
    setLatestRun(result.latest_run);
  }

  useEffect(() => {
    refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "周期模板读取失败")).finally(() => setLoading(false));
  }, []);

  async function createTemplate() {
    setError(null);
    try {
      const result = await apiJson<{ recurrence: Recurrence }>("/task-recurrences", jsonRequest("POST", {
        title_template: "",
        description_template: "",
        content_template: "",
        start_date: todayText(),
        rule: { frequency: "daily", interval: 1 },
        enabled: false
      }));
      onNavigate({ name: "recurring-task", id: result.recurrence.id });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "周期模板创建失败");
    }
  }

  async function toggle(row: Recurrence, enabled: boolean) {
    setBusyId(row.id);
    setError(null);
    try {
      await apiJson(`/task-recurrences/${encodeURIComponent(row.id)}`, jsonRequest("PATCH", { enabled, row_version: row.row_version }));
      await refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "周期模板更新失败");
    } finally {
      setBusyId(null);
    }
  }

  async function check(row: Recurrence, repair: boolean) {
    setBusyId(row.id);
    setError(null);
    try {
      await apiJson(`/task-recurrences/${encodeURIComponent(row.id)}/check`, jsonRequest("POST", { repair }));
      await refresh();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "周期模板检查失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="recurring-tasks-section">
      <PageHeader title="周期任务模板" meta={`${enabledCount} 个启用 · ${issueCount} 个需要关注`} />
      {error ? <div className="notice error">{error}</div> : null}
      <div className="recurrence-run-summary panel">
        <span>模板会生成普通任务；程序启动时自动检查遗漏并补齐。</span>
        <span className={latestRun?.status === "failed" ? "recurrence-run-error" : "muted"}>上次检查：{formatDateTime(latestRun?.finished_at ?? null)}{latestRun ? ` · 生成 ${latestRun.generated_count} 条` : ""}</span>
      </div>
      <section className="table-panel database-panel recurrence-database-panel">
        <DatabaseTable
          empty={loading ? "正在检查周期模板…" : "还没有周期任务模板。"}
          rows={rows}
          columns={[
            { key: "enabled", label: "启用", className: "col-archive", render: (row) => <Checkbox ariaLabel={`启用周期模板 ${row.title || "未命名模板"}`} checked={row.enabled} onChange={(checked) => void toggle(row, checked)} /> },
            { key: "name", label: "任务模板", className: "col-title", render: (row) => <span className="recurrence-name-cell"><button className="link-button recurrence-name-button" onClick={() => onNavigate({ name: "recurring-task", id: row.id })} type="button">{row.title || "未命名模板"}</button>{isCrossYear(row) ? <span className="recurrence-cross-year">跨年</span> : null}</span> },
            { key: "rule", label: "周期规则", className: "col-category", render: (row) => <span className="recurrence-rule">{formatRule(row.rule)}</span> },
            { key: "next", label: "下一次", className: "col-date", render: (row) => <span>{row.enabled ? formatDate(row.next_occurrence_date) : "—"}</span> },
            { key: "last", label: "最后检查", className: "col-date", render: (row) => <span>{formatDateTime(row.last_checked_at)}</span> },
            { key: "count", label: "已生成", className: "col-urgency", render: (row) => <span>{row.generated_count}</span> },
            { key: "status", label: "状态", className: "col-status", render: (row) => <span className={`recurrence-status recurrence-status-${row.status === "error" ? "error" : row.missing_count > 0 ? "pending" : row.enabled ? "ok" : "paused"}`}>{statusText(row)}</span> },
            { key: "actions", label: "操作", className: "recurrence-actions", render: (row) => <div className="recurrence-action-group"><button className="text-button" disabled={busyId === row.id} onClick={() => void check(row, false)} type="button">检查</button><button className="text-button" disabled={busyId === row.id || !row.enabled} onClick={() => void check(row, true)} type="button">检查并修复</button></div> }
          ]}
          footer={<AddRowButton label="新建周期任务模板" onClick={() => void createTemplate()} />}
        />
      </section>
    </section>
  );
}
