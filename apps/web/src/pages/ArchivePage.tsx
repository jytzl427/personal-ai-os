import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "../components/Checkbox.js";
import { ConfirmDialog } from "../components/ConfirmDialog.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import { Tag } from "../components/Tag.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { formatDate, shiftYmd, todayYmd } from "../lib/dates.js";
import type { Route } from "../lib/route.js";

type ArchiveRow = { id: string; title?: string; name?: string; project_name?: string; plan_date?: string; period_start?: string; period_end?: string; archived_at: string };
type ArchiveData = { tasks: ArchiveRow[]; ideas: ArchiveRow[]; projects: ArchiveRow[]; project_tasks?: ArchiveRow[]; conversations?: ArchiveRow[]; plans?: ArchiveRow[]; stage_plans?: ArchiveRow[] };
type Tab = "tasks" | "ideas" | "projects" | "project-tasks" | "conversations" | "plans" | "stage-plans";
type ArchiveWindow = "all" | "7" | "30";

function entityForTab(tab: Tab) {
  if (tab === "tasks") return "task";
  if (tab === "ideas") return "idea";
  if (tab === "projects") return "project";
  if (tab === "project-tasks") return "project_task";
  if (tab === "conversations") return "conversation";
  if (tab === "plans") return "plan";
  return "stage_plan";
}

function archiveRowName(row: ArchiveRow) {
  const name = row.name ?? row.title ?? row.plan_date ?? row.period_start ?? "归档数据";
  return row.project_name ? `${name}（${row.project_name}）` : name;
}

export function ArchivePage({ tab, onNavigate }: { tab: Tab; onNavigate: (route: Route) => void }) {
  const [data, setData] = useState<ArchiveData>({ tasks: [], ideas: [], projects: [], project_tasks: [], conversations: [], plans: [], stage_plans: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [windowFilter, setWindowFilter] = useState<ArchiveWindow>("all");
  const [pendingBatchDelete, setPendingBatchDelete] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setData(await apiJson<ArchiveData>("/archive"));
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "归档加载失败");
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => { setSelected(new Set()); }, [tab]);

  const rows = tab === "stage-plans" ? (data.stage_plans ?? []) : tab === "project-tasks" ? (data.project_tasks ?? []) : data[tab] ?? [];
  const filteredRows = useMemo(() => {
    const cutoff = windowFilter === "all" ? null : shiftYmd(todayYmd(), -Number(windowFilter));
    const normalized = keyword.trim().toLowerCase();
    return rows.filter((row) => {
      const name = archiveRowName(row).toLowerCase();
      return (!normalized || name.includes(normalized)) && (!cutoff || row.archived_at.slice(0, 10) >= cutoff);
    });
  }, [rows, keyword, windowFilter]);
  const allSelected = filteredRows.length > 0 && filteredRows.every((row) => selected.has(row.id));

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  async function restore(id: string) {
    try {
      await apiJson("/archive/restore", jsonRequest("POST", { entity_type: entityForTab(tab), id }));
      setMessage("已恢复");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "恢复失败");
    }
  }

  async function deleteOne(id: string) {
    try {
      await apiJson(`/archive/${entityForTab(tab)}/${id}`, { method: "DELETE" });
      setSelected((current) => { const next = new Set(current); next.delete(id); return next; });
      setMessage("已删除归档数据");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    }
  }

  function requestDeleteBatch() {
    const ids = filteredRows.filter((row) => selected.has(row.id)).map((row) => row.id);
    if (!ids.length) return;
    setPendingBatchDelete(ids);
  }

  async function deleteBatch(ids: string[]) {
    try {
      const result = await apiJson<{ deleted: number }>("/archive/delete-batch", jsonRequest("POST", { entity_type: entityForTab(tab), ids }));
      setSelected(new Set());
      setMessage(`已批量删除 ${result.deleted} 条归档数据`);
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "批量删除失败");
    }
  }

  return (
    <div className="page-stack page-archive">
      <PageHeader meta="支持筛选、恢复、删除和批量删除" title="归档">
        <SegmentedControl ariaLabel="归档类型" options={[{ value: "tasks", label: "任务" }, { value: "ideas", label: "想法" }, { value: "projects", label: "项目" }, { value: "project-tasks", label: "项目任务" }, { value: "conversations", label: "对话" }, { value: "plans", label: "每日计划" }, { value: "stage-plans", label: "阶段计划" }]} value={tab} onChange={(value) => onNavigate({ name: "archive", tab: value })} />
      </PageHeader>
      {error ? <div className="notice error">{error}</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      <section className="table-panel database-panel archive-database-panel">
        <div className="archive-toolbar"><label className="form-field archive-search"><span>搜索</span><input className="cell-input" placeholder="按名称筛选" value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label><label className="form-field"><span>时间</span><select className="select-input" value={windowFilter} onChange={(event) => setWindowFilter(event.target.value as ArchiveWindow)}><option value="all">全部时间</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option></select></label><button className="secondary-button" disabled={!selected.size} onClick={requestDeleteBatch} type="button">批量删除{selected.size ? `（${selected.size}）` : ""}</button></div>
        <div className="database-scroll">
          <table className="database-table archive-table">
            <thead><tr><th><Checkbox ariaLabel="全选当前筛选结果" checked={allSelected} onChange={(checked) => setSelected(checked ? new Set(filteredRows.map((row) => row.id)) : new Set())} /></th><th>名称</th><th>归档时间</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>{filteredRows.length ? filteredRows.map((row) => <tr key={row.id}><td><Checkbox ariaLabel={`选择 ${archiveRowName(row)}`} checked={selected.has(row.id)} onChange={(checked) => toggle(row.id, checked)} /></td><td>{archiveRowName(row)}</td><td>{formatDate(row.archived_at, "未设置")}</td><td><Tag tone="neutral">已归档</Tag></td><td className="archive-actions"><button className="secondary-button" onClick={() => void restore(row.id)} type="button">恢复</button><DeleteButton label="删除归档数据" onClick={() => void deleteOne(row.id)} /></td></tr>) : <tr><td className="database-empty" colSpan={5}>{rows.length ? "没有符合筛选条件的归档数据。" : "这里还没有归档数据。"}</td></tr>}</tbody>
          </table>
        </div>
        <div className="database-summary"><span>当前显示 {filteredRows.length} 条</span><strong>已选 {selected.size} 条</strong></div>
      </section>
      {pendingBatchDelete ? <ConfirmDialog message={`即将永久删除当前选中的 ${pendingBatchDelete.length} 条归档数据，此操作不可撤销，请确认是否继续。`} onCancel={() => setPendingBatchDelete(null)} onConfirm={() => { const ids = pendingBatchDelete; setPendingBatchDelete(null); void deleteBatch(ids); }} /> : null}
    </div>
  );
}


