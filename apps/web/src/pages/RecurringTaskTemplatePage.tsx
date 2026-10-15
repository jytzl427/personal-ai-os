import { useEffect, useRef, useState } from "react";
import { Checkbox } from "../components/Checkbox.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DateField } from "../components/DateField.js";
import { PageHeader } from "../components/PageHeader.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { formatDate as formatYmdDate } from "../lib/dates.js";
import type { Route } from "../lib/route.js";

type Frequency = "daily" | "weekly" | "monthly" | "yearly";
type Rule = { frequency: Frequency; interval: number; weekdays?: number[]; day_of_month?: number; month?: number };
type Recurrence = {
  id: string;
  title: string;
  description_template: string;
  content_template: string;
  enabled: boolean;
  rule: Rule | null;
  start_date: string;
  end_date: string | null;
  next_occurrence_date: string | null;
  row_version: number;
  template_version: number;
  status: string;
  generated_count: number;
};
type Draft = {
  title_template: string;
  description_template: string;
  content_template: string;
  enabled: boolean;
  start_date: string;
  end_date: string;
  next_occurrence_date: string | null;
  rule: Rule;
  generated_count: number;
};

const weekLabels = ["一", "二", "三", "四", "五", "六", "日"];

function defaultRule(): Rule {
  return { frequency: "daily", interval: 1 };
}

function draftFrom(recurrence: Recurrence): Draft {
  return {
    title_template: recurrence.title ?? "",
    description_template: recurrence.description_template ?? "",
    content_template: recurrence.content_template ?? "",
    enabled: recurrence.enabled,
    start_date: recurrence.start_date ?? "",
    end_date: recurrence.end_date ?? "",
    next_occurrence_date: recurrence.next_occurrence_date ?? null,
    rule: recurrence.rule ?? defaultRule(),
    generated_count: recurrence.generated_count ?? 0
  };
}

function yearOf(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Number(value.slice(0, 4));
}

function isCrossYear(draft: Pick<Draft, "start_date" | "end_date" | "next_occurrence_date">): boolean {
  const startYear = yearOf(draft.start_date);
  if (startYear === null) return false;
  const endYear = yearOf(draft.end_date);
  const nextYear = yearOf(draft.next_occurrence_date);
  return (endYear !== null && endYear !== startYear) || (nextYear !== null && nextYear !== startYear);
}

function ruleText(rule: Rule): string {
  const interval = rule.interval === 1 ? "每" : `每${rule.interval}`;
  if (rule.frequency === "daily") return `${interval}天`;
  if (rule.frequency === "weekly") return `${interval}周${(rule.weekdays ?? []).map((day) => weekLabels[day - 1]).join("、")}`;
  if (rule.frequency === "monthly") return `${interval}月${rule.day_of_month ?? "—"}日`;
  return `${interval}年${rule.month ?? "—"}月${rule.day_of_month ?? "—"}日`;
}

export function RecurringTaskTemplatePage({ id, onNavigate }: { id: string; onNavigate: (route: Route) => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const [rowVersion, setRowVersion] = useState<number | undefined>(undefined);
  const rowVersionRef = useRef<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialRef = useRef(false);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const deletingRef = useRef(false);

  useEffect(() => {
    let alive = true;
    apiJson<{ recurrence: Recurrence }>(`/task-recurrences/${encodeURIComponent(id)}`)
      .then((result) => {
        if (!alive) return;
        const next = draftFrom(result.recurrence);
        setDraft(next);
        draftRef.current = next;
        setRowVersion(result.recurrence.row_version);
        rowVersionRef.current = result.recurrence.row_version;
        initialRef.current = false;
        dirtyRef.current = false;
      })
      .catch((reason: unknown) => { if (alive) setError(reason instanceof Error ? reason.message : "周期模板读取失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  function update(patch: Partial<Draft>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      draftRef.current = next;
      dirtyRef.current = true;
      return next;
    });
  }

  async function persist() {
    const current = draftRef.current;
    if (!current || rowVersionRef.current === undefined || !dirtyRef.current) return;
    setSaving(true);
    setError(null);
    try {
      const result = await apiJson<{ recurrence: Recurrence }>(`/task-recurrences/${encodeURIComponent(id)}`, jsonRequest("PATCH", {
        ...current,
        end_date: current.end_date || null,
        row_version: rowVersionRef.current
      }));
      const nextVersion = result.recurrence.row_version;
      setRowVersion(nextVersion);
      rowVersionRef.current = nextVersion;
      if (draftRef.current === current) dirtyRef.current = false;
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "周期模板自动保存失败");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!draft) return;
    if (!initialRef.current) {
      initialRef.current = true;
      return;
    }
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void persist(); }, 800);
    return () => {
      if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    };
  }, [draft]);

  useEffect(() => () => {
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    if (!deletingRef.current && dirtyRef.current) void persist();
  }, [id]);

  if (loading) return <div className="page-stack page-task-detail"><div className="panel database-empty">周期模板读取中…</div></div>;
  if (!draft) return <div className="page-stack page-task-detail"><div className="notice error">{error ?? "周期模板不存在"}</div></div>;

  function changeFrequency(frequency: Frequency) {
    const current = draft;
    if (!current) return;
    update({ rule: { ...current.rule, frequency, interval: current.rule.interval || 1, weekdays: frequency === "weekly" ? (current.rule.weekdays?.length ? current.rule.weekdays : [1]) : undefined, day_of_month: frequency === "monthly" || frequency === "yearly" ? (current.rule.day_of_month || 1) : undefined, month: frequency === "yearly" ? (current.rule.month || 1) : undefined } });
  }

  function requestDeleteTemplate() {
    if (!draft || deleting) return;
    setDeleteConfirmOpen(true);
  }

  async function deleteTemplate() {
    if (!draft || deleting) return;
    deletingRef.current = true;
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current);
    dirtyRef.current = false;
    setDeleting(true);
    setError(null);
    try {
      await apiJson(`/task-recurrences/${encodeURIComponent(id)}`, { method: "DELETE" });
      onNavigate({ name: "tasks", tab: "recurring" });
    } catch (reason: unknown) {
      deletingRef.current = false;
      dirtyRef.current = true;
      setError(reason instanceof Error ? reason.message : "周期模板删除失败");
      setDeleting(false);
    }
  }

  return (
    <div className="page-stack page-task-detail page-recurring-template-detail">
      <PageHeader title={draft.title_template.trim() || "周期任务模板"}>
        <div className="template-header-actions">
          <button className="secondary-button danger-button" disabled={deleting} onClick={requestDeleteTemplate} type="button">{deleting ? "正在删除…" : "删除模板"}</button>
          <button className="secondary-button" disabled={deleting} onClick={() => onNavigate({ name: "tasks", tab: "recurring" })} type="button">← 返回周期任务</button>
        </div>
      </PageHeader>
      {error ? <div className="notice error">{error}</div> : null}
      <div className="template-save-state muted">{saving ? "正在自动保存…" : "已自动保存 · 修改只影响未来生成的任务"}</div>
      <section className="template-detail-grid">
        <main className="panel template-editor-panel">
          <label className="form-field"><span>任务名称</span><textarea aria-label="周期任务模板名称" className="task-detail-title template-title-input" onChange={(event) => update({ title_template: event.target.value })} rows={1} value={draft.title_template} /></label>
          <label className="form-field"><span>任务内容</span><textarea aria-label="周期任务模板内容" className="template-long-text" onChange={(event) => update({ content_template: event.target.value })} placeholder="每次生成普通任务时复制到任务内容" value={draft.content_template} /></label>
          <label className="form-field"><span>备忘</span><textarea aria-label="周期任务模板备忘" className="template-long-text template-memo" onChange={(event) => update({ description_template: event.target.value })} placeholder="每次生成普通任务时复制到备忘属性" value={draft.description_template} /></label>
        </main>
        <aside className="panel template-property-panel">
          <div className="panel-heading task-detail-heading"><h2>周期设置</h2><span className="muted">{ruleText(draft.rule)}{isCrossYear(draft) ? <span className="recurrence-cross-year recurrence-cross-year-detail">跨年</span> : null}</span></div>
          <div className="template-next-occurrence"><span className="muted">下一次生成</span><strong>{draft.next_occurrence_date ? formatYmdDate(draft.next_occurrence_date) : "—"}</strong>{isCrossYear(draft) ? <span className="recurrence-cross-year">跨年</span> : null}</div>
          <label className="form-field"><span>周期</span><select aria-label="周期规则" className="select-input" onChange={(event) => changeFrequency(event.target.value as Frequency)} value={draft.rule.frequency}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label>
          <div className="recurrence-inline-field"><span>每</span><input aria-label="周期间隔" className="recurrence-number" min={1} max={1000} onChange={(event) => update({ rule: { ...draft.rule, interval: Math.max(1, Number(event.target.value) || 1) } })} type="number" value={draft.rule.interval} /><span>{draft.rule.frequency === "daily" ? "天" : draft.rule.frequency === "weekly" ? "周" : draft.rule.frequency === "monthly" ? "个月" : "年"}</span></div>
          {draft.rule.frequency === "weekly" ? <div className="weekday-picker" aria-label="每周星期"><span className="muted">星期</span>{[1, 2, 3, 4, 5, 6, 7].map((day) => <button aria-pressed={(draft.rule.weekdays ?? []).includes(day)} className={(draft.rule.weekdays ?? []).includes(day) ? "weekday-button active" : "weekday-button"} key={day} onClick={() => update({ rule: { ...draft.rule, weekdays: (draft.rule.weekdays ?? []).includes(day) ? (draft.rule.weekdays ?? []).filter((item) => item !== day) : [...(draft.rule.weekdays ?? []), day].sort() } })} type="button">{weekLabels[day - 1]}</button>)}</div> : null}
          {draft.rule.frequency === "monthly" || draft.rule.frequency === "yearly" ? <div className="recurrence-inline-field"><span>{draft.rule.frequency === "yearly" ? "每年" : "每月"}</span>{draft.rule.frequency === "yearly" ? <select aria-label="周期月份" className="recurrence-number" onChange={(event) => update({ rule: { ...draft.rule, month: Number(event.target.value) } })} value={draft.rule.month}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> : null}<span>月</span><input aria-label="周期日期" className="recurrence-number" min={1} max={31} onChange={(event) => update({ rule: { ...draft.rule, day_of_month: Math.min(31, Math.max(1, Number(event.target.value) || 1)) } })} type="number" value={draft.rule.day_of_month} /><span>日</span></div> : null}
          <label className="form-field"><span>开始日期</span><DateField ariaLabel="周期开始日期" value={draft.start_date || null} onChange={(date) => update({ start_date: date })} /></label>
          <label className="form-field"><span>结束日期（可选）</span><DateField ariaLabel="周期结束日期" value={draft.end_date || null} onChange={(date) => update({ end_date: date })} /></label>
          <label className="detail-check-field"><Checkbox ariaLabel="启用周期模板" checked={draft.enabled} onChange={(enabled) => update({ enabled })} /><span>{draft.enabled ? "已启用" : "已暂停"}</span></label>
          <p className="recurrence-hint">停用期间不会生成任务；恢复时也不会补回停用期间的日期。</p>
        </aside>
      </section>
      {deleteConfirmOpen ? <ConfirmDialog message={draft.generated_count > 0 ? `即将删除“${draft.title_template.trim() || "未命名模板"}”。模板会停止生成，已生成的 ${draft.generated_count} 条普通任务会保留。` : `即将删除“${draft.title_template.trim() || "未命名模板"}”。模板会停止生成，已保存的历史记录会保留。`} onCancel={() => setDeleteConfirmOpen(false)} onConfirm={() => { setDeleteConfirmOpen(false); void deleteTemplate(); }} /> : null}
    </div>
  );
}
