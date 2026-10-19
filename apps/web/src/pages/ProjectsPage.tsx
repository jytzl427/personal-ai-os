import { useEffect, useState } from "react";
import { AutoGrowTextarea } from "../components/AutoGrowTextarea.js";
import { CellText } from "../components/CellText.js";
import { DateField, formatDate } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { Tag, type TagTone } from "../components/Tag.js";
import { PlusIcon } from "../components/Icons.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import type { Route } from "../lib/route.js";

type Project = {
  id: string;
  name: string;
  description?: string;
  category?: string;
  status?: string;
  started_at?: string | null;
  target_date?: string | null;
  end_date?: string | null;
  target_result?: string;
  priority?: string;
  progress_manual?: number | null;
  benefit_enabled?: number | boolean;
  archive_requested?: number | boolean;
  archived_at?: string | null;
  row_version?: number;
  finance?: ProjectFinance;
};

type ProjectTask = {
  id: string;
  title: string;
  description?: string;
  due_date?: string | null;
  status: string;
  completed_at?: string | null;
  todo_task_id?: string | null;
  archive_requested?: number | boolean | null;
  archived_at?: string | null;
};

type ProjectFinance = {
  income_cents: number;
  expense_cents: number;
  net_cents: number;
  income_count: number;
  expense_count: number;
};

type ProjectActivity = {
  id: string;
  kind: string;
  content: string;
  created_at: string;
  important?: number;
};

const statusLabels: Record<string, string> = {
  idea: "想法",
  planned: "规划中",
  active: "进行中",
  paused: "暂停",
  done: "历史完结",
  abandoned: "已放弃",
};

const maintenanceStatusLabels: Record<string, string> = {
  active: "平稳运营中",
  paused: "暂停维护",
  done: "历史完结",
};

const categoryLabels: Record<string, string> = {
  advancement: "推进项目",
  maintenance: "维护项目",
  small: "推进项目",
  mid: "推进项目",
  long_term: "维护项目",
};

function isMaintenanceProject(category?: string | null): boolean {
  return category === "maintenance" || category === "long_term";
}

function statusTone(status?: string): TagTone {
  if (status === "done") return "success";
  if (status === "active") return "info";
  if (status === "abandoned") return "danger";
  return "neutral";
}

export function ProjectsPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("advancement");
  const [profitable, setProfitable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    apiJson<{ projects: Project[] }>("/projects")
      .then((result) => setProjects(result.projects))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "项目加载失败"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function addProject() {
    if (!name.trim()) return;
    try {
      const result = await apiJson<{ project: Project }>(
        "/projects",
        jsonRequest("POST", {
          name: name.trim(),
          category,
          status: isMaintenanceProject(category) ? "active" : "idea",
          benefit_enabled: profitable,
        })
      );
      setProjects((current) => [result.project, ...current]);
      setName("");
      setProfitable(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "项目创建失败");
    }
  }

  async function deleteProject(id: string) {
    try {
      await apiJson(`/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
      setProjects((current) => current.filter((project) => project.id !== id));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "项目删除失败");
    }
  }

  const completedProjects = projects.filter((p) => p.status === "done");
  const advancementProjects = projects.filter((p) => p.status !== "done" && !isMaintenanceProject(p.category));
  const maintenanceProjects = projects.filter((p) => p.status !== "done" && isMaintenanceProject(p.category));

  function renderProjectCard(project: Project) {
    const isMaint = isMaintenanceProject(project.category);
    const isCompleted = project.status === "done";
    const netCents = project.finance?.net_cents ?? 0;
    const hasFinance = Boolean(project.benefit_enabled && project.finance);

    return (
      <article className={`project-card ${isCompleted ? "is-completed" : ""}`} key={project.id}>
        <button className="project-card-open" onClick={() => onNavigate({ name: "project", id: project.id })} type="button">
          <div className="project-card-top">
            <div className="project-card-tags">
              <Tag tone={statusTone(project.status)}>
                {isCompleted
                  ? "历史完结"
                  : isMaint
                  ? (maintenanceStatusLabels[project.status ?? "active"] ?? project.status ?? "平稳运营中")
                  : (statusLabels[project.status ?? "idea"] ?? project.status ?? "想法")}
              </Tag>
              {isCompleted ? (
                <span className="project-card-category-tag">
                  {categoryLabels[project.category ?? "advancement"] ?? "推进项目"}
                </span>
              ) : null}
            </div>
            {hasFinance ? (
              <span className={`project-card-profit-badge ${netCents >= 0 ? "positive" : "negative"}`}>
                净收益 {netCents >= 0 ? "+" : ""}{(netCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元
              </span>
            ) : null}
          </div>
          <h3>{project.name}</h3>
          <p>
            {isMaint
              ? (project.description || (isCompleted ? "项目已平稳运营圆满收官。" : "尚未设定运营策略。"))
              : (project.target_result || project.description || (isCompleted ? "交付目标已圆满达成收官。" : "尚未设定总目标。"))}
          </p>
          <div className="project-card-meta">
            {!isCompleted ? (
              <span>{categoryLabels[project.category ?? "advancement"] ?? project.category ?? "推进项目"}</span>
            ) : null}
            <span>{project.started_at ? "启动 " + formatDate(project.started_at) : "未设启动时间"}</span>
            {isCompleted ? (
              <span>{project.end_date ? "完结 " + formatDate(project.end_date) : (project.target_date ? "完结 " + formatDate(project.target_date) : "已收官")}</span>
            ) : (
              <>
                {!isMaint && (
                  <span>{project.target_date ? "预计 " + formatDate(project.target_date) : "未设预计完成"}</span>
                )}
                {!isMaint && project.end_date ? <span>完成 {formatDate(project.end_date)}</span> : null}
                {project.benefit_enabled ? <span>盈利核算</span> : null}
              </>
            )}
          </div>
          {!isMaint && !isCompleted ? (
            <div className="progress-track"><span style={{ width: `${Math.max(0, Math.min(100, project.progress_manual ?? 0))}%` }} /></div>
          ) : null}
        </button>
        <DeleteButton label={`删除项目 ${project.name}`} onClick={() => void deleteProject(project.id)} />
      </article>
    );
  }

  return (
    <div className="page-stack page-projects">
      <PageHeader meta={loading ? "读取中…" : projects.length + " 个项目"} title="项目" />
      {error ? <div className="notice error">{error}</div> : null}

      <section className="project-add panel">
        <input
          className="cell-input"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void addProject();
          }}
          placeholder="输入项目名称，回车创建"
          value={name}
        />
        <select className="select-input" onChange={(event) => setCategory(event.target.value)} value={category}>
          <option value="advancement">推进项目</option>
          <option value="maintenance">维护项目</option>
        </select>
        <label className="check-field">
          <input checked={profitable} onChange={(event) => setProfitable(event.target.checked)} type="checkbox" /> 盈利项目
        </label>
        <button className="primary-button" onClick={() => void addProject()} type="button">
          <PlusIcon /> 新建项目
        </button>
      </section>

      <div className="project-sections">
        <section className="project-group-section">
          <div className="section-heading">
            <div>
              <h2>推进项目</h2>
              <span className="page-meta">阶段攻坚与开发落地，有明确交付物和完成闭环</span>
            </div>
            <span className="page-meta">{advancementProjects.length} 个</span>
          </div>
          <div className="project-gallery">
            {advancementProjects.length === 0 && !loading ? (
              <div className="panel database-empty">暂无推进项目。从上方新建或将维护项目调整为推进项目。</div>
            ) : null}
            {advancementProjects.map(renderProjectCard)}
          </div>
        </section>

        <section className="project-group-section">
          <div className="section-heading">
            <div>
              <h2>维护项目</h2>
              <span className="page-meta">日常运营与资产维护，保持低精力消耗与平稳运行</span>
            </div>
            <span className="page-meta">{maintenanceProjects.length} 个</span>
          </div>
          <div className="project-gallery">
            {maintenanceProjects.length === 0 && !loading ? (
              <div className="panel database-empty">暂无维护项目。</div>
            ) : null}
            {maintenanceProjects.map(renderProjectCard)}
          </div>
        </section>

        <section className="project-group-section completed-projects-section">
          <div className="section-heading">
            <div>
              <h2>历史完结项目</h2>
              <span className="page-meta">圆满收官的里程碑项目，成果永久留存与复盘纪念</span>
            </div>
            <span className="page-meta">{completedProjects.length} 个</span>
          </div>
          <div className="project-gallery">
            {completedProjects.length === 0 && !loading ? (
              <div className="panel database-empty">暂无历史完结项目。项目圆满收官后，可在此永久留存复盘与查看成果。</div>
            ) : null}
            {completedProjects.map(renderProjectCard)}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ProjectDetailPage({ id, onNavigate }: { id: string; onNavigate: (route: Route) => void }) {
  const [data, setData] = useState<{
    project: Project;
    workspace?: Record<string, string>;
    project_tasks?: ProjectTask[];
    activities?: ProjectActivity[];
    finance?: ProjectFinance;
  } | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [workspace, setWorkspace] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [focusTaskId, setFocusTaskId] = useState<string | null>(null);
  const [activity, setActivity] = useState("");

  function load() {
    apiJson<{
      project: Project;
      workspace?: Record<string, string>;
      project_tasks?: ProjectTask[];
      activities?: ProjectActivity[];
      finance?: ProjectFinance;
    }>(`/projects/${encodeURIComponent(id)}`)
      .then((result) => {
        setData(result);
        setDraft({
          name: result.project.name,
          description: result.project.description ?? "",
          category: result.project.category ?? "advancement",
          status: result.project.status ?? "idea",
          started_at: result.project.started_at ?? "",
          target_date: result.project.target_date ?? "",
          end_date: result.project.end_date ?? "",
          target_result: result.project.target_result ?? "",
          benefit_enabled: result.project.benefit_enabled ? "1" : "0",
          archive_requested: result.project.archive_requested ? "1" : "0",
        });
        setWorkspace(result.workspace ?? {});
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "项目详情加载失败"));
  }

  useEffect(load, [id]);

  async function addCheckpoint() {
    setError(null);
    try {
      const result = await apiJson<{ project_task: ProjectTask }>(
        `/projects/${encodeURIComponent(id)}/task-plans`,
        jsonRequest("POST", { title: "", description: "", status: "todo", add_to_todo: false })
      );
      setData((current) => (current ? { ...current, project_tasks: [...(current.project_tasks ?? []), result.project_task] } : current));
      setFocusTaskId(result.project_task.id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "验收节点创建失败");
    }
  }

  async function updateCheckpoint(task: ProjectTask, changes: { title?: string; status?: "todo" | "done"; due_date?: string | null }) {
    try {
      await apiJson(`/project-task-plans/${encodeURIComponent(task.id)}`, jsonRequest("PATCH", changes));

      // Auto-closure prompt if marking as done and all checkpoints become done
      if (changes.status === "done" && data) {
        const nextTasks = (data.project_tasks ?? []).map((t) => (t.id === task.id ? { ...t, status: "done" } : t));
        const allDone = nextTasks.length > 0 && nextTasks.every((t) => t.status === "done");
        if (allDone && data.project.status !== "done") {
          const confirmComplete = window.confirm(
            "所有验收节点均已验收通过！\n是否将项目整体标记为“历史完结”，并自动填入今天作为实际完成时间？"
          );
          if (confirmComplete) {
            const todayStr = new Date().toISOString().slice(0, 10);
            await apiJson(
              `/projects/${encodeURIComponent(id)}`,
              jsonRequest("PATCH", {
                ...draft,
                status: "done",
                end_date: todayStr,
                started_at: draft.started_at || null,
                target_date: draft.target_date || null,
                archive_requested: draft.archive_requested === "1",
                row_version: data.project.row_version,
              })
            );
          }
        }
      }
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "验收节点更新失败");
    }
  }

  async function deleteCheckpoint(task: ProjectTask) {
    try {
      await apiJson(`/project-task-plans/${encodeURIComponent(task.id)}`, { method: "DELETE" });
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "验收节点删除失败");
    }
  }

  async function addActivity() {
    if (!activity.trim()) return;
    try {
      await apiJson(`/projects/${encodeURIComponent(id)}/activities`, jsonRequest("POST", { content: activity.trim() }));
      setActivity("");
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "重大事件记录失败");
    }
  }

  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const isMaint = isMaintenanceProject(draft.category);
      const payload: Record<string, unknown> = {
        name: draft.name,
        category: draft.category,
        status: draft.status,
        started_at: draft.started_at || null,
        end_date: draft.end_date || null,
        benefit_enabled: draft.benefit_enabled === "1",
        archive_requested: draft.archive_requested === "1",
        row_version: data.project.row_version,
      };
      if (isMaint) {
        payload.description = draft.description;
      } else {
        payload.target_result = draft.target_result;
        payload.target_date = draft.target_date || null;
      }

      const result = await apiJson<{ project: Project }>(`/projects/${encodeURIComponent(id)}`, jsonRequest("PATCH", payload));
      if (result.project.archived_at) {
        onNavigate({ name: "archive", tab: "projects" });
        return;
      }
      setData((current) => (current ? { ...current, project: result.project } : current));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "项目保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function saveWorkspaceNotes() {
    setSavingNotes(true);
    try {
      await apiJson(`/projects/${encodeURIComponent(id)}/workspace`, jsonRequest("PATCH", { notes: workspace.notes ?? "" }));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "维护备忘保存失败");
    } finally {
      setSavingNotes(false);
    }
  }

  if (error && !data) return <div className="notice error">{error}</div>;
  if (!data) return <div className="panel database-empty">项目读取中…</div>;

  const isMaint = isMaintenanceProject(draft.category);
  const checkpoints = data.project_tasks ?? [];
  const completedCheckpoints = checkpoints.filter((c) => c.status === "done").length;

  return (
    <div className="page-stack page-project-detail">
      <div className="project-detail-toolbar">
        <button className="secondary-button project-back-button" onClick={() => onNavigate({ name: "projects" })} type="button">
          <span aria-hidden="true">←</span>
          <span>返回项目列表</span>
        </button>
        <span className="muted">{isMaint ? "维护项目工作区" : "推进项目工作区"}</span>
      </div>

      <section className="detail-hero project-detail-hero">
        <div>
          <h1>{data.project.name}</h1>
          <p>
            {isMaint
              ? (data.project.description || "尚未设定运营策略。")
              : (data.project.target_result || "尚未设定任务总目标。")}
          </p>
        </div>
        <Tag tone={statusTone(data.project.status)}>
          {isMaint
            ? (maintenanceStatusLabels[data.project.status ?? "active"] ?? data.project.status ?? "平稳运营中")
            : (statusLabels[data.project.status ?? "idea"] ?? data.project.status ?? "想法")}
        </Tag>
      </section>

      {error ? <div className="notice error">{error}</div> : null}

      {!isMaint ? (
        /* ================= 推进项目视图 ================= */
        <>
          <section className="panel project-detail-panel project-advancement-meta-panel">
            <div className="panel-heading project-detail-heading">
              <div>
                <h2>核心目标与时间线</h2>
                <span className="page-meta">明确交付物边界与三大关键时间坐标</span>
              </div>
              <span className="muted">{saving ? "保存中…" : "可编辑"}</span>
            </div>

            <label className="form-field">
              <span>项目名称</span>
              <input className="cell-input" onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name ?? ""} />
            </label>

            <label className="form-field">
              <span>任务总目标（交付物边界）</span>
              <input
                className="cell-input"
                onChange={(event) => setDraft({ ...draft, target_result: event.target.value })}
                placeholder="一句话定义项目最终交付结果（如：搭建一套可用的复习与考试系统）"
                value={draft.target_result ?? ""}
              />
            </label>

            <div className="form-row form-row-4">
              <label className="form-field">
                <span>项目板块</span>
                <select className="select-input" onChange={(event) => setDraft({ ...draft, category: event.target.value })} value={draft.category ?? "advancement"}>
                  <option value="advancement">推进项目</option>
                  <option value="maintenance">维护项目</option>
                </select>
              </label>

              <label className="form-field">
                <span>状态</span>
                <select className="select-input" onChange={(event) => setDraft({ ...draft, status: event.target.value })} value={draft.status ?? "idea"}>
                  <option value="idea">想法</option>
                  <option value="planned">规划中</option>
                  <option value="active">进行中</option>
                  <option value="paused">暂停</option>
                  <option value="done">历史完结</option>
                  <option value="abandoned">已放弃</option>
                </select>
              </label>

              <label className="form-field">
                <span>启动时间</span>
                <DateField ariaLabel="项目启动时间" onChange={(value) => setDraft({ ...draft, started_at: value })} value={draft.started_at} />
              </label>

              <label className="form-field">
                <span>预计完成时间</span>
                <DateField ariaLabel="预计完成时间" onChange={(value) => setDraft({ ...draft, target_date: value })} value={draft.target_date} />
              </label>

              <label className="form-field">
                <span>实际完成时间</span>
                <DateField ariaLabel="实际完成时间" onChange={(value) => setDraft({ ...draft, end_date: value })} value={draft.end_date} />
              </label>
            </div>

            <label className="check-field project-archive-check">
              <input checked={draft.archive_requested === "1"} onChange={(event) => setDraft({ ...draft, archive_requested: event.target.checked ? "1" : "0" })} type="checkbox" />
              归档项目（需同时设置实际完成时间）
            </label>

            <button className="primary-button" onClick={() => void save()} type="button">保存项目属性</button>
          </section>

          <section className="panel project-detail-section checkpoint-section">
            <div className="panel-heading project-detail-heading">
              <div>
                <h2>验收节点清单</h2>
                <span className="page-meta">按交付物顺序推进验收。全部节点验收完成将触发项目完工闭环。</span>
              </div>
              <span className="checkpoint-counter-badge">
                {completedCheckpoints} / {checkpoints.length} 已验收
              </span>
            </div>

            {checkpoints.length ? (
              <div className="checkpoint-table">
                <div className="checkpoint-table-header">
                  <span className="col-index">节点</span>
                  <span className="col-title">交付物名称</span>
                  <span className="col-due">计划验收时间</span>
                  <span className="col-status">验收状态</span>
                  <span className="col-completed">实际完成时间</span>
                  <span className="col-action">操作</span>
                </div>
                {checkpoints.map((task, idx) => {
                  const isDone = task.status === "done";
                  return (
                    <div className={`checkpoint-table-row ${isDone ? "is-done" : ""}`} key={task.id}>
                      <span className="col-index">
                        <span className="checkpoint-tag">节点 {idx + 1}</span>
                      </span>
                      <span className="col-title">
                        <CellText
                          ariaLabel={`验收节点交付物 ${task.title || "未命名节点"}`}
                          autoFocus={focusTaskId === task.id}
                          multiline
                          placeholder="填写交付物（如：完成计划与方案设计）"
                          value={task.title}
                          onCommit={(value) => {
                            const next = value.trim();
                            if (next !== task.title) void updateCheckpoint(task, { title: next });
                          }}
                        />
                      </span>
                      <span className="col-due">
                        <DateField
                          ariaLabel={`计划验收时间：${task.title}`}
                          value={task.due_date}
                          onChange={(value) => void updateCheckpoint(task, { due_date: value || null })}
                        />
                      </span>
                      <span className="col-status">
                        <button
                          className={`checkpoint-status-btn ${isDone ? "done" : "todo"}`}
                          onClick={() => void updateCheckpoint(task, { status: isDone ? "todo" : "done" })}
                          type="button"
                        >
                          {isDone ? "✓ 已验收" : "○ 未完成"}
                        </button>
                      </span>
                      <span className="col-completed">
                        {task.completed_at ? (
                          <span className="checkpoint-completed-time">{formatDate(task.completed_at)}</span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </span>
                      <span className="col-action">
                        <DeleteButton label={`删除节点 ${task.title || idx + 1}`} onClick={() => void deleteCheckpoint(task)} />
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="database-empty">还没有验收节点。点击下方添加第一个阶段验收节点。</div>
            )}

            <button className="database-add-button project-task-create-button" onClick={() => void addCheckpoint()} type="button">
              <PlusIcon /> 添加验收节点
            </button>
          </section>
        </>
      ) : (
        /* ================= 维护项目视图 ================= */
        <>
          <section className="panel project-detail-panel project-maintenance-meta-panel">
            <div className="panel-heading project-detail-heading">
              <div>
                <h2>运营策略与状态属性</h2>
                <span className="page-meta">一句话底线策略与精力投入控制</span>
              </div>
              <span className="muted">{saving ? "保存中…" : "可编辑"}</span>
            </div>

            <label className="form-field">
              <span>项目名称</span>
              <input className="cell-input" onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name ?? ""} />
            </label>

            <label className="form-field">
              <span>当前运营策略</span>
              <AutoGrowTextarea
                ariaLabel="当前运营策略"
                className="cell-input memo-input auto-grow-textarea"
                onChange={(value) => setDraft({ ...draft, description: value })}
                placeholder="一句话底线与精力投入策略（例如：每周低精力维护，保持平稳运行与盈利状态，不占用攻坚精力）"
                value={draft.description ?? ""}
              />
            </label>

            <div className="form-row form-row-4">
              <label className="form-field">
                <span>项目板块</span>
                <select className="select-input" onChange={(event) => setDraft({ ...draft, category: event.target.value })} value={draft.category ?? "maintenance"}>
                  <option value="advancement">推进项目</option>
                  <option value="maintenance">维护项目</option>
                </select>
              </label>

              <label className="form-field">
                <span>运行状态</span>
                <select className="select-input" onChange={(event) => setDraft({ ...draft, status: event.target.value })} value={draft.status ?? "active"}>
                  <option value="active">平稳运营中</option>
                  <option value="paused">暂停维护</option>
                  <option value="done">历史完结</option>
                </select>
              </label>

              <label className="form-field">
                <span>启动时间</span>
                <DateField ariaLabel="项目启动时间" onChange={(value) => setDraft({ ...draft, started_at: value })} value={draft.started_at} />
              </label>

              <label className="form-field">
                <span>完结时间</span>
                <DateField ariaLabel="项目完结时间" onChange={(value) => setDraft({ ...draft, end_date: value })} value={draft.end_date} />
              </label>
            </div>

            <div style={{ display: "flex", gap: "20px", alignItems: "center", marginBottom: "16px" }}>
              <label className="check-field">
                <input
                  checked={draft.benefit_enabled === "1"}
                  onChange={(event) => setDraft({ ...draft, benefit_enabled: event.target.checked ? "1" : "0" })}
                  type="checkbox"
                />
                开启盈利核算
              </label>

              <label className="check-field project-archive-check">
                <input
                  checked={draft.archive_requested === "1"}
                  onChange={(event) => setDraft({ ...draft, archive_requested: event.target.checked ? "1" : "0" })}
                  type="checkbox"
                />
                归档项目（需同时设置实际完结时间）
              </label>
            </div>

            <button className="primary-button" onClick={() => void save()} type="button">保存运营策略</button>
          </section>

          {(draft.benefit_enabled === "1" || data.project.benefit_enabled) ? (
            <section className="project-finance-strip">
              <article className="panel project-finance-card"><span className="muted">项目总收入</span><strong>{((data.finance?.income_cents ?? 0) / 100).toFixed(2)} 元</strong></article>
              <article className="panel project-finance-card"><span className="muted">项目总支出</span><strong>{((data.finance?.expense_cents ?? 0) / 100).toFixed(2)} 元</strong></article>
              <article className="panel project-finance-card"><span className="muted">项目净收益</span><strong>{((data.finance?.net_cents ?? 0) / 100).toFixed(2)} 元</strong></article>
            </section>
          ) : null}

          <div className="detail-grid project-detail-grid maintenance-two-col">
            <article className="panel project-detail-panel">
              <div className="panel-heading project-detail-heading">
                <div>
                  <h2>维护备忘与 SOP</h2>
                  <span className="page-meta">记录固定维护标准、账号/服务器配置与巡检要点</span>
                </div>
                <span className="muted">{savingNotes ? "保存中…" : "随时记录"}</span>
              </div>
              <AutoGrowTextarea
                ariaLabel="维护备忘与 SOP"
                className="cell-input memo-input large-textarea auto-grow-textarea"
                onChange={(value) => setWorkspace({ ...workspace, notes: value })}
                placeholder="记录账号密码、巡检周期、故障处理 SOP、维护要点..."
                value={workspace.notes ?? ""}
              />
              <button className="secondary-button" onClick={() => void saveWorkspaceNotes()} style={{ marginTop: "12px" }} type="button">
                {savingNotes ? "保存中…" : "保存备忘与 SOP"}
              </button>
            </article>

            <article className="panel project-detail-panel">
              <div className="panel-heading project-detail-heading">
                <div>
                  <h2>重大维护事件记录</h2>
                  <span className="page-meta">仅记录架构调整、战略变动或关键维护事件时间线</span>
                </div>
              </div>
              <div className="project-activity-add" style={{ display: "flex", gap: "8px", alignItems: "flex-end", marginBottom: "16px" }}>
                <AutoGrowTextarea
                  ariaLabel="记录重大事件"
                  className="cell-input memo-input auto-grow-textarea"
                  onChange={setActivity}
                  placeholder="记录重大事件（例如：完成服务器迁移、调整个税申报方案等）"
                  value={activity}
                />
                <button className="secondary-button" onClick={() => void addActivity()} style={{ whiteSpace: "nowrap" }} type="button">
                  记录事件
                </button>
              </div>
              {data.activities?.length ? (
                <div className="simple-list">
                  {data.activities.map((item) => (
                    <div className="simple-list-row" key={item.id}>
                      <span>{item.content}</span>
                      <small>{new Date(item.created_at).toLocaleDateString("zh-CN")}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">还没有重大维护事件记录。</p>
              )}
            </article>
          </div>
        </>
      )}
    </div>
  );
}
