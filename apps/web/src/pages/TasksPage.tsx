import { useEffect, useMemo, useState } from "react";
import { AddRowButton } from "../components/AddRowButton.js";
import { CellText } from "../components/CellText.js";
import { Checkbox } from "../components/Checkbox.js";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { DateField } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { PropertySelect } from "../components/PropertySelect.js";
import { ReadOnlyPlanCard } from "../components/ReadOnlyPlanCard.js";
import type { TagTone } from "../components/Tag.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import type { Route } from "../lib/route.js";
import { IdeasDatabase } from "./IdeasPage.js";
import { RecurringTasksPage } from "./RecurringTasksPage.js";

type TaskStatus = "todo" | "done" | "cancelled";
type Task = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority?: string | null;
  due_date?: string | null;
  created_at?: string;
  row_version?: number;
  archive_requested?: number | boolean | null;
  archived_at?: string | null;
};

function normalizeStatus(status: string): TaskStatus {
  return status === "done" || status === "cancelled" ? status : "todo";
}

function statusTone(status: string): TagTone {
  if (status === "done") return "success";
  if (status === "cancelled") return "danger";
  return "neutral";
}

function sortTasks(rows: Task[]) {
  return [...rows].sort((left, right) => {
    if (!left.due_date && !right.due_date) return (left.created_at ?? "").localeCompare(right.created_at ?? "");
    if (!left.due_date) return 1;
    if (!right.due_date) return -1;
    const dateOrder = left.due_date.localeCompare(right.due_date);
    return dateOrder || (left.created_at ?? "").localeCompare(right.created_at ?? "");
  });
}

export function TasksPage({ initialTab, onNavigate }: { initialTab?: "tasks" | "recurring"; onNavigate: (route: Route) => void }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"tasks" | "recurring">(initialTab === "recurring" ? "recurring" : "tasks");
  const [planCard, setPlanCard] = useState<"daily" | "stage" | null>(null);
  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);

  useEffect(() => {
    apiJson<{ tasks: Task[] }>("/tasks")
      .then((result) => setTasks(result.tasks))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "任务加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function saveTask(id: string, patch: Partial<Task> & { status?: TaskStatus }) {
    const current = tasks.find((task) => task.id === id);
    if (!current) return;
    setSavingId(id);
    setFailedId(null);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...patch };
      if (current.row_version !== undefined) body.row_version = current.row_version;
      const result = await apiJson<{ task: Task }>("/tasks/" + id, jsonRequest("PATCH", body));
      const saved = result.task;
      setTasks((rows) => sortTasks(saved.archived_at ? rows.filter((task) => task.id !== id) : rows.map((task) => task.id === id ? { ...task, ...saved } : task)));
    } catch (reason: unknown) {
      setFailedId(id);
      setError(reason instanceof Error ? reason.message : "任务保存失败");
    } finally {
      setSavingId(null);
    }
  }

  async function addTask() {
    setError(null);
    try {
      const result = await apiJson<{ task: Task }>("/tasks", jsonRequest("POST", {
        title: "",
        description: "",
        status: "todo"
      }));
      setTasks((current) => sortTasks([...(current ?? []), result.task]));
      setFocusTaskId(result.task.id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "任务创建失败");
    }
  }

  async function deleteTask(id: string) {
    try {
      await apiJson("/tasks/" + id, { method: "DELETE" });
      setTasks((current) => current.filter((task) => task.id !== id));
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "任务删除失败");
    }
  }

  return (
    <div className="page-stack page-tasks">
      <PageHeader meta={view === "tasks" ? (loading ? "读取中…" : sortedTasks.length + " 条未归档") : undefined} title="任务">
        <div className="task-view-switch" role="tablist">
          <button className={view === "tasks" ? "secondary-button active" : "secondary-button"} onClick={() => setView("tasks")} role="tab" type="button">任务数据库</button>
          <button className={view === "recurring" ? "secondary-button active" : "secondary-button"} onClick={() => setView("recurring")} role="tab" type="button">周期任务</button>
        </div>      </PageHeader>
      <div className="task-page-toolbar">
        <div className="task-plan-buttons">
          <button className="secondary-button" onClick={() => setPlanCard("daily")} type="button">每日计划</button>
          <button className="secondary-button" onClick={() => setPlanCard("stage")} type="button">阶段计划</button>
        </div>
      </div>      {planCard ? <ReadOnlyPlanCard kind={planCard} onClose={() => setPlanCard(null)} /> : null}
      {view === "recurring" ? <RecurringTasksPage onNavigate={onNavigate} /> : null}
      {view === "tasks" && error ? <div className="notice error">{error}</div> : null}
      {view === "tasks" ? <>
      <section className="table-panel database-panel tasks-database-panel">
        <DatabaseTable
          empty={loading ? "正在读取任务…" : "还没有任务，从下方添加第一条。"}
          rowState={(task) => savingId === task.id ? "saving" : failedId === task.id ? "failed" : undefined}
          rows={sortedTasks}
          columns={[
            {
              key: "delete",
              label: "",
              className: "col-delete",
              render: (task) => <DeleteButton label={`删除任务 ${task.title || "未命名任务"}`} onClick={() => void deleteTask(task.id)} />
            },
            {
              key: "archive",
              label: "归档",
              className: "col-archive",
              render: (task) => (
                <Checkbox
                  ariaLabel={"归档任务 " + (task.title || "未命名任务")}
                  checked={Boolean(task.archive_requested)}
                  onChange={(checked) => void saveTask(task.id, { archive_requested: checked })}
                />
              )
            },
            {
              key: "title",
              label: "任务名称",
              className: "col-title",
              render: (task) => (
                <div className="task-title-cell">
                  <CellText
                    autoFocus={focusTaskId === task.id}
                    autoGrow
                    className="task-name-input"
                    multiline
                    placeholder="填写任务名称"
                    value={task.title}
                    onCommit={(value) => { if (value.trim() !== task.title) void saveTask(task.id, { title: value.trim() }); }}
                  />
                  <button aria-label={`打开任务 ${task.title || "未命名任务"}`} className="task-open-button" onClick={() => onNavigate({ name: "task", id: task.id })} title="打开任务页面" type="button">↗</button>
                </div>
              )
            },
            {
              key: "date",
              label: "任务日期",
              className: "col-date",
              render: (task) => (
                <DateField
                  ariaLabel={"任务日期 " + (task.title || "未命名任务")}
                  value={task.due_date}
                  onChange={(value) => void saveTask(task.id, { due_date: value || null })}
                />
              )
            },
            {
              key: "status",
              label: "状态",
              className: "col-status",
              render: (task) => (
                <PropertySelect
                  ariaLabel={"状态 " + (task.title || "未命名任务")}
                  options={[{ value: "todo", label: "未完成" }, { value: "done", label: "完成" }, { value: "cancelled", label: "取消" }]}
                  tone={statusTone(task.status)}
                  value={normalizeStatus(task.status)}
                  onChange={(value) => void saveTask(task.id, { status: value as TaskStatus })}
                />
              )
            },
            {
              key: "memo",
              label: "备忘",
              className: "col-memo",
              render: (task) => (
                <CellText
                  multiline
                  placeholder="添加备忘…"
                  value={task.description ?? ""}
                  onCommit={(value) => { if (value !== (task.description ?? "")) void saveTask(task.id, { description: value }); }}
                />
              )
            }
          ]}
          footer={<AddRowButton label="添加任务" onClick={() => void addTask()} />}
        />
      </section>
      <IdeasDatabase embedded />
      </> : null}
    </div>
  );
}


