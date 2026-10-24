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
import { SegmentedControl } from "../components/SegmentedControl.js";
import { CalendarIcon } from "../components/Icons.js";
import type { TagTone } from "../components/Tag.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { todayYmd } from "../lib/dates.js";
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
  parent_id?: string | null;
  subtask_count?: number;
  subtask_done_count?: number;
  created_at?: string;
  row_version?: number;
  archive_requested?: number | boolean | null;
  archived_at?: string | null;
  project_id?: string | null;
  project_name?: string | null;
};

type TaskRow = Task & { is_add_action?: boolean };

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
  const [taskFilter, setTaskFilter] = useState<"all" | "today" | "project">("all");
  // Default collapsed: parents remain closed until user explicitly clicks to expand
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const sortedTasks = useMemo(() => sortTasks(tasks), [tasks]);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (task.parent_id) {
        const list = map.get(task.parent_id) || [];
        list.push(task);
        map.set(task.parent_id, list);
      }
    }
    for (const [key, list] of map.entries()) {
      map.set(key, sortTasks(list));
    }
    return map;
  }, [tasks]);

  const rootTasks = useMemo(() => {
    return sortedTasks.filter((t) => !t.parent_id);
  }, [sortedTasks]);

  const today = todayYmd();
  const urgentCount = useMemo(
    () => sortedTasks.filter((t) => t.status === "todo" && Boolean(t.due_date && t.due_date <= today)).length,
    [sortedTasks, today]
  );
  const projectMilestoneCount = useMemo(
    () => sortedTasks.filter((t) => Boolean(t.project_name) && t.status === "todo").length,
    [sortedTasks]
  );

  const filteredTasks = useMemo(() => {
    let matchedRoots = rootTasks;
    if (taskFilter === "today") {
      matchedRoots = rootTasks.filter((parent) => {
        const parentMatch = Boolean(parent.due_date && parent.due_date <= today);
        const children = childrenByParent.get(parent.id) || [];
        const childMatch = children.some((c) => Boolean(c.due_date && c.due_date <= today));
        return parentMatch || childMatch;
      });
    } else if (taskFilter === "project") {
      matchedRoots = rootTasks.filter((parent) => {
        const parentMatch = Boolean(parent.project_name);
        const children = childrenByParent.get(parent.id) || [];
        const childMatch = children.some((c) => Boolean(c.project_name));
        return parentMatch || childMatch;
      });
    }

    const list: TaskRow[] = [];
    for (const root of matchedRoots) {
      list.push(root);
      if (expandedIds.has(root.id)) {
        const children = childrenByParent.get(root.id) || [];
        if (taskFilter === "today") {
          for (const child of children) {
            if (child.due_date && child.due_date <= today) {
              list.push(child);
            }
          }
        } else {
          for (const child of children) {
            list.push(child);
          }
        }
        // Inline action to add a subtask without auto-creating a row on expand
        list.push({
          id: "__add_subtask__" + root.id,
          title: "",
          status: "todo",
          parent_id: root.id,
          is_add_action: true
        });
      }
    }

    const allRootIds = new Set(rootTasks.map((t) => t.id));
    const orphans = sortedTasks.filter((t) => t.parent_id && !allRootIds.has(t.parent_id));
    for (const orphan of orphans) {
      list.push(orphan);
    }

    return list;
  }, [rootTasks, childrenByParent, taskFilter, today, expandedIds, sortedTasks]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addSubtask(parentId: string) {
    setError(null);
    try {
      const parent = tasks.find((t) => t.id === parentId);
      const result = await apiJson<{ task: Task }>("/tasks", jsonRequest("POST", {
        title: "",
        description: "",
        status: "todo",
        parent_id: parentId,
        due_date: parent?.due_date || todayYmd(),
        project_id: parent?.project_id || null
      }));
      setTasks((current) => [...current, result.task]);
      setFocusTaskId(result.task.id);
      setExpandedIds((prev) => new Set(prev).add(parentId));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "子任务创建失败");
    }
  }

  function loadTasks() {
    return apiJson<{ tasks: Task[] }>("/tasks")
      .then((result) => setTasks(result.tasks))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "任务加载失败"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    void loadTasks();
  }, []);

  async function toggleParentSubtasks(parent: Task, shouldDone: boolean) {
    const children = childrenByParent.get(parent.id) || [];
    if (children.length === 0) {
      void saveTask(parent.id, { status: shouldDone ? "done" : "todo" });
      return;
    }
    const nextStatus: TaskStatus = shouldDone ? "done" : "todo";
    setTasks((current) =>
      current.map((t) => {
        if (t.parent_id === parent.id || t.id === parent.id) {
          return { ...t, status: nextStatus };
        }
        return t;
      })
    );
    try {
      await Promise.all([
        ...children.map((c) => apiJson<{ task: Task }>("/tasks/" + c.id, jsonRequest("PATCH", { status: nextStatus }))),
        apiJson<{ task: Task }>("/tasks/" + parent.id, jsonRequest("PATCH", { status: nextStatus }))
      ]);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "批量更新子任务失败");
      void loadTasks();
    }
  }

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
        <SegmentedControl
          ariaLabel="任务视图"
          options={[
            { value: "tasks", label: "任务数据库" },
            { value: "recurring", label: "周期任务" }
          ]}
          value={view}
          onChange={(val) => setView(val as "tasks" | "recurring")}
        />
      </PageHeader>
      <div className="task-page-toolbar">
        <div className="task-filter-pills" role="tablist" aria-label="待办过滤">
          <button
            type="button"
            className={`filter-pill ${taskFilter === "all" ? "active" : ""}`}
            onClick={() => setTaskFilter("all")}
          >
            全部 ({sortedTasks.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${taskFilter === "today" ? "active" : ""}`}
            onClick={() => setTaskFilter("today")}
          >
            今日及临期 {urgentCount > 0 && <span className="filter-pill-badge">{urgentCount}</span>}
          </button>
          <button
            type="button"
            className={`filter-pill ${taskFilter === "project" ? "active" : ""}`}
            onClick={() => setTaskFilter("project")}
          >
            项目节点 {projectMilestoneCount > 0 && <span className="filter-pill-badge is-project">{projectMilestoneCount}</span>}
          </button>
        </div>

        <div className="task-plan-buttons">
          <button className="secondary-button" onClick={() => setPlanCard("daily")} type="button">
            <CalendarIcon /> 每日计划
          </button>
          <button className="secondary-button" onClick={() => setPlanCard("stage")} type="button">
            <CalendarIcon /> 阶段计划
          </button>
        </div>
      </div>
      {planCard ? <ReadOnlyPlanCard kind={planCard} onClose={() => setPlanCard(null)} /> : null}
      {view === "recurring" ? <RecurringTasksPage onNavigate={onNavigate} /> : null}
      {view === "tasks" && error ? <div className="notice error">{error}</div> : null}
      {view === "tasks" ? <>
      <section className="table-panel database-panel tasks-database-panel">
        <DatabaseTable
          empty={loading ? "正在读取任务…" : "还没有任务，从下方添加第一条。"}
          rowState={(task) => savingId === task.id ? "saving" : failedId === task.id ? "failed" : undefined}
          rowClassName={(task) =>
            task.is_add_action
              ? "task-add-subtask-row"
              : task.parent_id
              ? "task-subtask-row"
              : childrenByParent.has(task.id)
              ? "task-parent-row"
              : undefined
          }
          rows={filteredTasks}
          columns={[
            {
              key: "delete",
              label: "",
              className: "col-delete",
              render: (task) =>
                task.is_add_action ? null : (
                  <DeleteButton label={`删除任务 ${task.title || "未命名任务"}`} onClick={() => void deleteTask(task.id)} />
                )
            },
            {
              key: "archive",
              label: "归档",
              className: "col-archive",
              render: (task) => {
                if (task.is_add_action) return null;
                const children = childrenByParent.get(task.id) || [];
                const hasChildren = children.length > 0;
                const allDone = hasChildren && children.every((c) => c.status === "done");

                return (
                  <Checkbox
                    ariaLabel={"归档任务 " + (task.title || "未命名任务")}
                    checked={hasChildren ? allDone : Boolean(task.archive_requested)}
                    onChange={(checked) => {
                      if (hasChildren) {
                        void toggleParentSubtasks(task, checked);
                      } else {
                        void saveTask(task.id, { archive_requested: checked });
                      }
                    }}
                  />
                );
              }
            },
            {
              key: "title",
              label: "任务名称",
              className: "col-title",
              render: (task) => {
                if (task.is_add_action) {
                  return (
                    <div className="task-title-cell is-subtask subtask-add-cell">
                      <span aria-hidden="true" className="subtask-tree-connector">
                        <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
                          <path d="M3 0V10C3 11.6569 4.34315 13 6 13H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
                        </svg>
                      </span>
                      <button
                        type="button"
                        className="subtask-add-action-btn"
                        onClick={() => void addSubtask(task.parent_id!)}
                      >
                        <span className="add-subtask-plus">+</span>
                        <span>添加子任务</span>
                      </button>
                    </div>
                  );
                }

                const isSubtask = Boolean(task.parent_id);
                const children = childrenByParent.get(task.id) || [];
                const hasSubtasks = children.length > 0;
                const isExpanded = expandedIds.has(task.id);
                const doneSubtasks = children.filter((c) => c.status === "done").length;

                return (
                  <div className={`task-title-cell ${task.status === "done" ? "is-done" : ""} ${isSubtask ? "is-subtask" : hasSubtasks ? "is-parent-cell" : ""}`}>
                    {isSubtask ? (
                      <span aria-hidden="true" className="subtask-tree-connector">
                        <svg width="14" height="18" viewBox="0 0 14 18" fill="none">
                          <path d="M3 0V10C3 11.6569 4.34315 13 6 13H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={`subtask-toggle-btn ${isExpanded ? "is-expanded" : ""}`}
                        onClick={() => toggleExpand(task.id)}
                        title={isExpanded ? "收起子任务" : hasSubtasks ? "展开子任务" : "展开添加子任务"}
                      >
                        <svg className="toggle-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    )}

                    <CellText
                      autoFocus={focusTaskId === task.id}
                      autoGrow
                      className={`task-name-input ${hasSubtasks ? "is-parent-title" : ""}`}
                      multiline
                      placeholder={isSubtask ? "填写子任务名称" : "填写任务名称"}
                      value={task.title}
                      onCommit={(value) => { if (value.trim() !== task.title) void saveTask(task.id, { title: value.trim() }); }}
                    />

                    {!isSubtask && hasSubtasks ? (
                      <span className="subtask-progress-chip" title={`子任务进度：${doneSubtasks}/${children.length} 项已完成`}>
                        <span className={`progress-dot ${doneSubtasks === children.length ? "is-done" : ""}`} />
                        <span>{doneSubtasks}/{children.length} 完成</span>
                      </span>
                    ) : null}

                    <button aria-label={`打开任务 ${task.title || "未命名任务"}`} className="task-open-button" onClick={() => onNavigate({ name: "task", id: task.id })} title="打开任务页面" type="button">↗</button>
                  </div>
                );
              }
            },
            {
              key: "date",
              label: "任务日期",
              className: "col-date",
              render: (task) => {
                if (task.is_add_action) return null;
                const isToday = task.due_date === today;
                const isOverdue = Boolean(task.due_date && task.due_date < today && task.status === "todo");
                const dateClass = isOverdue ? "date-badge-wrap is-overdue" : isToday ? "date-badge-wrap is-due-today" : "date-badge-wrap";
                return (
                  <div className={dateClass}>
                    <DateField
                      ariaLabel={"任务日期 " + (task.title || "未命名任务")}
                      value={task.due_date}
                      onChange={(value) => void saveTask(task.id, { due_date: value || null })}
                    />
                  </div>
                );
              }
            },
            {
              key: "status",
              label: "状态",
              className: "col-status",
              render: (task) => {
                if (task.is_add_action) return null;
                const children = childrenByParent.get(task.id) || [];
                if (!task.parent_id && children.length > 0) {
                  const allDone = children.every((c) => c.status === "done");
                  const doneCount = children.filter((c) => c.status === "done").length;
                  return (
                    <button
                      type="button"
                      className={`subtask-parent-status-pill ${allDone ? "is-done" : "is-progress"}`}
                      onClick={() => void toggleParentSubtasks(task, !allDone)}
                      title="点击一键切换全部子任务状态"
                    >
                      <span className={`status-dot ${allDone ? "is-done" : ""}`} />
                      <span>{allDone ? "全部完成" : `进行中 · ${doneCount}/${children.length}`}</span>
                    </button>
                  );
                }

                return (
                  <PropertySelect
                    ariaLabel={"状态 " + (task.title || "未命名任务")}
                    options={[{ value: "todo", label: "未完成" }, { value: "done", label: "完成" }, { value: "cancelled", label: "取消" }]}
                    tone={statusTone(task.status)}
                    value={normalizeStatus(task.status)}
                    onChange={(value) => void saveTask(task.id, { status: value as TaskStatus })}
                  />
                );
              }
            },
            {
              key: "memo",
              label: "备忘",
              className: "col-memo",
              render: (task) => {
                if (task.is_add_action) return null;
                return (
                  <div className="task-memo-cell">
                    <CellText
                      multiline
                      placeholder="添加备忘…"
                      value={task.description ?? ""}
                      onCommit={(value) => {
                        void saveTask(task.id, { description: value.trim() ? value.trim() : null });
                      }}
                    />
                  </div>
                );
              }
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


