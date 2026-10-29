import { useEffect, useState } from "react";
import { AutoGrowTextarea } from "../components/AutoGrowTextarea.js";
import { CellText } from "../components/CellText.js";
import { DateField, formatDate } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { MarkdownView } from "../components/MarkdownView.js";
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
  progress?: number;
  checkpoint_stats?: {
    total: number;
    completed: number;
  };
  next_checkpoint?: {
    id: string;
    title: string;
    due_date?: string | null;
  } | null;
  benefit_enabled?: number | boolean;
  archive_requested?: number | boolean;
  archived_at?: string | null;
  row_version?: number;
  finance?: ProjectFinance;
  score?: number | null;
};

function CheckpointTitleInput({
  initialValue,
  placeholder,
  autoFocus,
  onCommit,
}: {
  initialValue: string;
  placeholder: string;
  autoFocus?: boolean;
  onCommit: (val: string) => void;
}) {
  const [val, setVal] = useState(initialValue);
  useEffect(() => {
    setVal(initialValue);
  }, [initialValue]);

  return (
    <input
      type="text"
      className="stepper-title-input"
      value={val}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => {
        const next = val.trim();
        if (next !== initialValue) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function CheckpointPositionControl({
  index,
  total,
  taskTitle,
  onReorder,
  onMove,
}: {
  index: number;
  total: number;
  taskTitle?: string;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const currentPos = index + 1;
  const [val, setVal] = useState(String(currentPos));

  useEffect(() => {
    setVal(String(currentPos));
  }, [currentPos]);

  function commit() {
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) {
      setVal(String(currentPos));
      return;
    }
    const clamped = Math.max(1, Math.min(total, parsed));
    setVal(String(clamped));
    if (clamped !== currentPos) {
      onReorder(index, clamped - 1);
    }
  }

  return (
    <div className="stepper-reorder-group" title="调整节点顺序与位置">
      <button
        aria-label={`上移节点 ${taskTitle || currentPos}`}
        className="stepper-reorder-btn"
        disabled={index === 0}
        onClick={() => onMove(index, -1)}
        title="上移一位 (▲)"
        type="button"
      >
        ▲
      </button>

      <div className="stepper-order-picker" title="可直接输入目标序号回车，或点击右侧箭头下拉选择">
        <span className="stepper-order-prefix">第</span>
        <input
          aria-label={`节点 ${taskTitle || currentPos} 序号`}
          className="stepper-order-input"
          max={total}
          min={1}
          onBlur={commit}
          onChange={(e) => setVal(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setVal(String(currentPos));
              e.currentTarget.blur();
            }
          }}
          type="number"
          value={val}
        />
        <span className="stepper-order-divider">/{total}</span>
        <div className="stepper-order-dropdown-wrap" title="点击展开位置下拉菜单">
          <span aria-hidden="true" className="stepper-order-dropdown-arrow">▾</span>
          <select
            aria-label={`快捷调整节点 ${taskTitle || currentPos} 排序位置`}
            className="stepper-order-select-native"
            onChange={(e) => {
              const target = parseInt(e.target.value, 10);
              if (!isNaN(target) && target !== currentPos) {
                onReorder(index, target - 1);
              }
            }}
            value={currentPos}
          >
            {Array.from({ length: total }, (_, i) => i + 1).map((pos) => (
              <option key={pos} value={pos}>
                移至第 {pos} 节点 {pos === currentPos ? "(当前)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        aria-label={`下移节点 ${taskTitle || currentPos}`}
        className="stepper-reorder-btn"
        disabled={index === total - 1}
        onClick={() => onMove(index, 1)}
        title="下移一位 (▼)"
        type="button"
      >
        ▼
      </button>
    </div>
  );
}

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
  high_energy: "高投入维护",
  active: "平稳维护",
  low_energy: "低精力维护",
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

function formatDateCompact(d?: string | null): string {
  if (!d) return "--";
  const clean = d.slice(0, 10).replace(/-/g, ".");
  const parts = clean.split(".");
  if (parts.length === 3) {
    return `${parts[1]}.${parts[2]}`;
  }
  return clean;
}

function formatActivityTime(isoStr?: string | null): { date: string; time: string } {
  if (!isoStr) return { date: "--", time: "" };
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return { date: isoStr.slice(0, 10).replace(/-/g, "."), time: "" };
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return {
      date: `${d.getFullYear()}.${month}.${day}`,
      time: `${hours}:${minutes}`,
    };
  } catch {
    return { date: isoStr.slice(0, 10).replace(/-/g, "."), time: "" };
  }
}

function getActivityKindMeta(kind?: string, important?: number) {
  if (kind === "game_changer") {
    return {
      type: "game_changer",
      label: "⚡ 胜负手",
      icon: "⚡",
      dotClass: "dot-game-changer",
      cardClass: "card-game-changer",
      badgeClass: "badge-game-changer",
    };
  }
  if (kind === "closure") {
    return {
      type: "closure",
      label: "🏁 关键收官",
      icon: "🏁",
      dotClass: "dot-closure",
      cardClass: "card-closure",
      badgeClass: "badge-closure",
    };
  }
  if (kind === "pivot") {
    return {
      type: "pivot",
      label: "🔄 战略调整",
      icon: "🔄",
      dotClass: "dot-pivot",
      cardClass: "card-pivot",
      badgeClass: "badge-pivot",
    };
  }
  if (kind === "incident") {
    return {
      type: "incident",
      label: "⚠️ 故障复盘",
      icon: "⚠️",
      dotClass: "dot-incident",
      cardClass: "card-incident",
      badgeClass: "badge-incident",
    };
  }
  if (kind === "milestone" || (kind === "progress" && important === 1)) {
    return {
      type: "milestone",
      label: "🌟 重大里程碑",
      icon: "★",
      dotClass: "dot-milestone",
      cardClass: "card-milestone",
      badgeClass: "badge-milestone",
    };
  }
  if (kind === "task_completed") {
    return {
      type: "task_completed",
      label: "✓ 任务完成",
      icon: "✓",
      dotClass: "dot-task",
      cardClass: "card-normal",
      badgeClass: "badge-task",
    };
  }
  if (kind === "task_cancelled" || kind === "task_removed") {
    return {
      type: kind,
      label: kind === "task_cancelled" ? "✕ 任务取消" : "🗑 任务移除",
      icon: "•",
      dotClass: "dot-normal",
      cardClass: "card-normal",
      badgeClass: "badge-muted",
    };
  }
  return {
    type: "progress",
    label: "📝 常规记录",
    icon: "•",
    dotClass: "dot-normal",
    cardClass: "card-normal",
    badgeClass: "badge-normal",
  };
}

function getCountdownBadge(targetDateStr?: string | null, isDone?: boolean) {
  if (isDone) {
    return { text: "✓ 已收官", tone: "done" };
  }
  if (!targetDateStr) {
    return { text: "未设截止", tone: "muted" };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDateStr);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { text: `⚠️ 超期 ${Math.abs(diffDays)} 天`, tone: "overdue" };
  }
  if (diffDays === 0) {
    return { text: "🔥 今天截止", tone: "due-today" };
  }
  if (diffDays <= 3) {
    return { text: `⏳ 剩 ${diffDays} 天`, tone: "urgent" };
  }
  return { text: `⏳ 剩 ${diffDays} 天`, tone: "normal" };
}

function renderStatusPill(status: string | undefined, isMaint: boolean, isCompleted: boolean) {
  if (isCompleted || status === "done") {
    return (
      <span className="status-pill status-pill-done">
        <span className="status-pill-trophy">🏆</span> 历史完结
      </span>
    );
  }
  if (isMaint) {
    if (status === "high_energy") {
      return (
        <span className="status-pill status-pill-high">
          <span className="status-pill-icon">🔥</span> 高投入维护
        </span>
      );
    }
    if (status === "low_energy") {
      return (
        <span className="status-pill status-pill-low">
          <span className="status-pill-dot" /> 低精力维护
        </span>
      );
    }
    if (status === "paused") {
      return (
        <span className="status-pill status-pill-paused">
          <span className="status-pill-dot" /> 暂停维护
        </span>
      );
    }
    return (
      <span className="status-pill status-pill-steady">
        <span className="status-pill-dot pulsing" /> 平稳维护
      </span>
    );
  }

  // Advancement
  if (status === "active") {
    return (
      <span className="status-pill status-pill-active">
        <span className="status-pill-dot pulsing" /> 进行中
      </span>
    );
  }
  if (status === "planned") {
    return (
      <span className="status-pill status-pill-planned">
        <span className="status-pill-dot" /> 规划中
      </span>
    );
  }
  if (status === "paused") {
    return (
      <span className="status-pill status-pill-paused">
        <span className="status-pill-dot" /> 暂停
      </span>
    );
  }
  if (status === "abandoned") {
    return (
      <span className="status-pill status-pill-abandoned">
        <span className="status-pill-dot" /> 已放弃
      </span>
    );
  }
  return (
    <span className="status-pill status-pill-idea">
      <span className="status-pill-dot" /> 想法
    </span>
  );
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

  const completedProjects = projects
    .filter((p) => p.status === "done")
    .sort((a, b) => {
      const scoreA = typeof a.score === "number" ? a.score : -1;
      const scoreB = typeof b.score === "number" ? b.score : -1;
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      return (b.end_date || "").localeCompare(a.end_date || "");
    });
  const advancementProjects = projects.filter((p) => p.status !== "done" && !isMaintenanceProject(p.category));
  const maintenanceProjects = projects.filter((p) => p.status !== "done" && isMaintenanceProject(p.category));

  function renderProjectCard(project: Project) {
    const isMaint = isMaintenanceProject(project.category);
    const isCompleted = project.status === "done";
    const netCents = project.finance?.net_cents ?? 0;
    const hasFinance = Boolean(project.benefit_enabled && project.finance);
    const countdown = getCountdownBadge(project.target_date, isCompleted);
    const cpCountdown = project.next_checkpoint?.due_date ? getCountdownBadge(project.next_checkpoint.due_date, false) : null;
    const isOverdue = !isCompleted && (countdown.tone === "overdue" || cpCountdown?.tone === "overdue");
    const isDueToday = !isCompleted && !isOverdue && (countdown.tone === "due-today" || cpCountdown?.tone === "due-today");
    const isUrgent = !isCompleted && !isOverdue && !isDueToday && (countdown.tone === "urgent" || cpCountdown?.tone === "urgent");
    const urgencyClass = isOverdue ? "has-overdue-deadline" : isDueToday ? "has-due-today-deadline" : isUrgent ? "has-urgent-deadline" : "";

    const progressVal = isCompleted
      ? 100
      : (project.progress_manual !== null && project.progress_manual !== undefined
          ? Math.max(0, Math.min(100, project.progress_manual))
          : Math.max(0, Math.min(100, project.progress ?? 0)));

    return (
      <article className={`project-card ${isCompleted ? "is-completed" : ""} ${isMaint ? "is-maintenance" : ""} ${urgencyClass}`} key={project.id}>
        <button className="project-card-open" onClick={() => onNavigate({ name: "project", id: project.id })} type="button">
          <div className="project-card-top">
            <div className="project-card-tags">
              {renderStatusPill(project.status, isMaint, isCompleted)}
              {isCompleted ? (
                <span className="project-card-category-tag">
                  {categoryLabels[project.category ?? "advancement"] ?? "推进项目"}
                </span>
              ) : null}
            </div>
            {isCompleted ? (
              project.score !== null && project.score !== undefined ? (
                <div className="project-score-badge" title={`项目评分：${project.score} 分`}>
                  <span className="score-icon">🏆</span>
                  <span className="score-val">{project.score}</span>
                  <span className="score-suffix">分</span>
                </div>
              ) : (
                <div className="project-score-badge is-unrated" title="尚未打分">
                  <span className="score-suffix">未打分</span>
                </div>
              )
            ) : hasFinance ? (
              <span className={`project-card-profit-badge ${netCents >= 0 ? "positive" : "negative"}`}>
                净收益 {netCents >= 0 ? "+" : ""}{(netCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元
              </span>
            ) : null}
          </div>
          <h3 className="project-card-title">{project.name}</h3>
          <p className="project-card-desc">
            {isMaint
              ? (project.description || (isCompleted ? "项目已平稳运营圆满收官。" : "尚未设定运营策略。"))
              : (project.target_result || project.description || (isCompleted ? "交付目标已圆满达成收官。" : "尚未设定总目标。"))}
          </p>
          {!isMaint && !isCompleted ? (
            <div className="project-time-capsule">
              <div className="time-capsule-row">
                <span className="time-capsule-span">
                  📅 {formatDateCompact(project.started_at)} ─ {formatDateCompact(project.target_date)}
                </span>
                <span className={`time-capsule-badge tone-${countdown.tone} ${countdown.tone !== "normal" && countdown.tone !== "muted" && countdown.tone !== "done" ? "is-emphasized" : ""}`}>
                  {countdown.text}
                </span>
              </div>
              <div className="time-capsule-track">
                <div className="time-capsule-bar" style={{ width: `${progressVal}%` }} />
              </div>
              <div className="time-capsule-footer">
                <span className="time-capsule-stat">
                  {project.checkpoint_stats?.total
                    ? `🧩 ${project.checkpoint_stats.completed}/${project.checkpoint_stats.total} 节点已验收`
                    : "尚未添加节点"}
                </span>
                <span className="time-capsule-pct">完成度 {progressVal}%</span>
              </div>
              {project.next_checkpoint ? (
                <div className={`project-card-next-slot ${cpCountdown && cpCountdown.tone !== "normal" && cpCountdown.tone !== "muted" ? "is-urgent-slot tone-" + cpCountdown.tone : ""}`}>
                  <span className="next-slot-tag">🎯 下一步攻坚</span>
                  <span className="next-slot-title" title={project.next_checkpoint.title}>
                    {project.next_checkpoint.title}
                  </span>
                  {project.next_checkpoint.due_date ? (
                    <span className={`next-slot-due ${cpCountdown ? "tone-" + cpCountdown.tone : ""}`}>
                      {cpCountdown?.tone === "overdue" || cpCountdown?.tone === "due-today" || cpCountdown?.tone === "urgent"
                        ? `⚠️ ${formatDateCompact(project.next_checkpoint.due_date)} 截止 (${cpCountdown.text})`
                        : `${formatDateCompact(project.next_checkpoint.due_date)} 截止`}
                    </span>
                  ) : null}
                </div>
              ) : project.checkpoint_stats?.total && project.checkpoint_stats.completed === project.checkpoint_stats.total ? (
                <div className="project-card-next-slot is-all-done">
                  <span className="next-slot-tag">🎉 全部节点已验收</span>
                  <span className="next-slot-title">所有交付切片已达成</span>
                </div>
              ) : null}
            </div>
          ) : isCompleted ? (
            <div className="completed-project-showcase">
              <div className="showcase-milestones">
                {project.checkpoint_stats?.total ? (
                  <span className="showcase-pill checkpoint-pill">
                    ✨ 全部交付 {project.checkpoint_stats.total} 个验收切片
                  </span>
                ) : (
                  <span className="showcase-pill checkpoint-pill muted">
                    ✨ 历史成果交付收官
                  </span>
                )}
                {hasFinance ? (
                  <span className={`showcase-pill finance-pill ${netCents >= 0 ? "positive" : "negative"}`}>
                    💰 {netCents >= 0 ? "+" : ""}{(netCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元
                  </span>
                ) : null}
              </div>
              <div className="showcase-dates">
                <span>📅 {formatDate(project.started_at)} ─ {formatDate(project.end_date || project.target_date)}</span>
              </div>
            </div>
          ) : (
            <div className="maintenance-project-showcase">
              <div className="maintenance-rhythm-banner">
                <span className="maintenance-pill">
                  🔄 持续稳态维护中
                </span>
                {hasFinance ? (
                  <span className={`maintenance-finance-pill ${netCents >= 0 ? "positive" : "negative"}`}>
                    💰 {netCents >= 0 ? "累计收益" : "净支出"} {(netCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元
                  </span>
                ) : null}
              </div>
              <div className="showcase-dates">
                <span>🌱 启动于 {formatDate(project.started_at)}</span>
              </div>
            </div>
          )}
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
  const [activityKind, setActivityKind] = useState("progress");
  const [savingActivity, setSavingActivity] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);

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
          score: result.project.score ?? null,
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

      // If the project is currently 'done', ask if user wants to reawaken it!
      if (data && data.project.status === "done") {
        const todayStr = new Date().toISOString().slice(0, 10);
        const confirmAwaken = window.confirm(
          "当前项目处于“历史完结”状态。\n检测到您新增了阶段验收节点，是否重新唤醒该项目开启新一轮迭代？"
        );
        if (confirmAwaken) {
          await apiJson(
            `/projects/${encodeURIComponent(id)}`,
            jsonRequest("PATCH", {
              name: draft.name,
              category: draft.category,
              status: "active",
              end_date: null,
              row_version: data.project.row_version,
            })
          );
          await apiJson(
            `/projects/${encodeURIComponent(id)}/activities`,
            jsonRequest("POST", {
              content: `🚀 项目于 ${todayStr} 重新唤醒，开启新一轮迭代攻坚`,
              kind: "pivot",
              important: true,
            })
          );
          load();
        }
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "验收节点创建失败");
    }
  }

  async function updateCheckpoint(task: ProjectTask, changes: { title?: string; status?: "todo" | "done"; due_date?: string | null }) {
    try {
      setData((current) => current ? {
        ...current,
        project_tasks: current.project_tasks?.map((t) => t.id === task.id ? { ...t, ...changes } : t)
      } : current);
      await apiJson(`/project-task-plans/${encodeURIComponent(task.id)}`, jsonRequest("PATCH", changes));
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "验收节点更新失败");
      load();
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
    if (!activity.trim() || savingActivity) return;
    setSavingActivity(true);
    try {
      const isImportant = activityKind !== "progress";
      await apiJson(
        `/projects/${encodeURIComponent(id)}/activities`,
        jsonRequest("POST", { content: activity.trim(), kind: activityKind, important: isImportant })
      );
      setActivity("");
      setActivityKind("progress");
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "重大事件记录失败");
    } finally {
      setSavingActivity(false);
    }
  }

  async function updateActivityKind(activityId: string, nextKind: string) {
    try {
      const isImportant = nextKind !== "progress" && nextKind !== "task_completed" && nextKind !== "task_cancelled" && nextKind !== "task_removed";
      await apiJson(
        `/projects/${encodeURIComponent(id)}/activities/${encodeURIComponent(activityId)}`,
        jsonRequest("PATCH", { kind: nextKind, important: isImportant })
      );
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "事件类型修改失败");
    }
  }

  async function deleteActivity(activityId: string) {
    try {
      await apiJson(`/projects/${encodeURIComponent(id)}/activities/${encodeURIComponent(activityId)}`, { method: "DELETE" });
      load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "重大事件删除失败");
    }
  }

  async function saveField(updates: Record<string, unknown> = {}) {
    if (!data) return;
    const nextDraft = { ...draft, ...updates };
    setDraft(nextDraft);
    setSaving(true);
    setError(null);
    try {
      const isMaint = isMaintenanceProject(nextDraft.category);
      const payload: Record<string, unknown> = {
        name: nextDraft.name,
        category: nextDraft.category,
        status: nextDraft.status,
        started_at: nextDraft.started_at || null,
        end_date: nextDraft.end_date || null,
        benefit_enabled: nextDraft.benefit_enabled === "1",
        archive_requested: nextDraft.archive_requested === "1",
        score: typeof nextDraft.score === "number" ? nextDraft.score : null,
        row_version: data.project.row_version,
      };
      if (isMaint) {
        payload.description = nextDraft.description;
      } else {
        payload.target_result = nextDraft.target_result;
        payload.target_date = nextDraft.target_date || null;
      }

      const result = await apiJson<{ project: Project }>(`/projects/${encodeURIComponent(id)}`, jsonRequest("PATCH", payload));
      if (result.project.archived_at) {
        onNavigate({ name: "archive", tab: "projects" });
        return;
      }
      setData((current) => (current ? { ...current, project: result.project } : current));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "项目属性自动同步失败");
    } finally {
      setSaving(false);
    }
  }

  async function reorderCheckpoint(fromIndex: number, toIndex: number) {
    if (!data?.project_tasks) return;
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= data.project_tasks.length) return;
    if (toIndex < 0 || toIndex >= data.project_tasks.length) return;

    const list = [...data.project_tasks];
    const [moved] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, moved);

    setData({ ...data, project_tasks: list });

    try {
      const res = await apiJson<{ ok: boolean; project_tasks?: ProjectTask[] }>(
        `/projects/${encodeURIComponent(id)}/task-plans/reorder`,
        jsonRequest("POST", { plan_ids: list.map((t) => t.id) })
      );
      if (res?.project_tasks) {
        setData((curr) => (curr ? { ...curr, project_tasks: res.project_tasks! } : curr));
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "节点排序更新失败");
      load();
    }
  }

  function moveCheckpoint(index: number, direction: -1 | 1) {
    void reorderCheckpoint(index, index + direction);
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
  const currentCheckpointId = checkpoints.find((c) => c.status !== "done")?.id;

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
        {renderStatusPill(data.project.status, isMaint, data.project.status === "done")}
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
              <span className="auto-save-status">{saving ? "正在自动同步…" : "✓ 属性实时保存"}</span>
            </div>

            <label className="form-field">
              <span>项目名称</span>
              <input className="cell-input" onBlur={() => void saveField()} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name ?? ""} />
            </label>

            <label className="form-field">
              <span>任务总目标（交付物边界）</span>
              <input
                className="cell-input"
                onBlur={() => void saveField()}
                onChange={(event) => setDraft({ ...draft, target_result: event.target.value })}
                placeholder="一句话定义项目最终交付结果（如：搭建一套可用的复习与考试系统）"
                value={draft.target_result ?? ""}
              />
            </label>

            <div className="form-row form-row-4">
              <label className="form-field">
                <span>项目板块</span>
                <select className="select-input" onChange={(event) => { const category = event.target.value; setDraft({ ...draft, category }); void saveField({ category }); }} value={draft.category ?? "advancement"}>
                  <option value="advancement">推进项目</option>
                  <option value="maintenance">维护项目</option>
                </select>
              </label>

              <label className="form-field">
                <span>状态</span>
                <select className="select-input" onChange={(event) => { const status = event.target.value; setDraft({ ...draft, status }); void saveField({ status }); }} value={draft.status ?? "idea"}>
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
                <DateField ariaLabel="项目启动时间" onChange={(value) => { setDraft({ ...draft, started_at: value }); void saveField({ started_at: value }); }} value={draft.started_at} />
              </label>

              <label className="form-field">
                <span>预计完成时间</span>
                <DateField ariaLabel="预计完成时间" onChange={(value) => { setDraft({ ...draft, target_date: value }); void saveField({ target_date: value }); }} value={draft.target_date} />
              </label>

              <label className="form-field">
                <span>实际完成时间</span>
                <DateField ariaLabel="实际完成时间" onChange={(value) => { setDraft({ ...draft, end_date: value }); void saveField({ end_date: value }); }} value={draft.end_date} />
              </label>

              <label className="form-field">
                <span>项目评分 (0~100 分)</span>
                <div className="score-input-wrapper">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="text-input score-input"
                    placeholder="未打分 (满分 100)"
                    value={draft.score ?? ""}
                    onChange={(event) => {
                      const val = event.target.value === "" ? null : Math.max(0, Math.min(100, Number(event.target.value)));
                      setDraft({ ...draft, score: val });
                    }}
                    onBlur={() => {
                      void saveField({ score: draft.score ?? null });
                    }}
                  />
                  <span className="score-input-suffix">分</span>
                </div>
              </label>
            </div>

            <label className="check-field project-archive-check">
              <input
                checked={draft.archive_requested === "1"}
                onChange={(event) => {
                  const archive_requested = event.target.checked ? "1" : "0";
                  setDraft({ ...draft, archive_requested });
                  void saveField({ archive_requested });
                }}
                type="checkbox"
              />
              归档项目（需同时设置实际完成时间）
            </label>
          </section>

          <section className="panel project-detail-section checkpoint-section">
            <div className="panel-heading project-detail-heading">
              <div>
                <h2>验收节点推进</h2>
                <span className="page-meta">按交付物切片顺序逐步推进验收。全部节点验收后，可由您自主在基本信息中将项目调整为历史完结并打分。</span>
              </div>
              <span className="checkpoint-counter-badge">
                {completedCheckpoints} / {checkpoints.length} 已验收 ({checkpoints.length > 0 ? Math.round((completedCheckpoints / checkpoints.length) * 100) : 0}%)
              </span>
            </div>

            {checkpoints.length ? (
              <div className="milestone-stepper-list">
                {checkpoints.map((task, idx) => {
                  const isDone = task.status === "done";
                  const isCurrent = task.id === currentCheckpointId;
                  const isLast = idx === checkpoints.length - 1;
                  const countdown = task.due_date ? getCountdownBadge(task.due_date, isDone) : null;

                  return (
                    <div
                      className={`milestone-stepper-item ${isDone ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`}
                      key={task.id}
                    >
                      <div className="stepper-spine">
                        <div className={`stepper-node ${isDone ? "node-done" : isCurrent ? "node-current" : "node-pending"}`}>
                          {isDone ? (
                            <span className="stepper-icon-check">✓</span>
                          ) : isCurrent ? (
                            <span className="stepper-dot-pulse" />
                          ) : (
                            <span className="stepper-num">{idx + 1}</span>
                          )}
                        </div>
                        {!isLast ? <div className={`stepper-connector ${isDone ? "is-done" : ""}`} /> : null}
                      </div>

                      <div className="stepper-card">
                        <div className="stepper-card-header">
                          <div className="stepper-card-tags">
                            <span className={`stepper-tag ${isDone ? "tag-done" : isCurrent ? "tag-current" : "tag-pending"}`}>
                              {isDone ? `阶段节点 ${idx + 1} · 已验收` : isCurrent ? `阶段节点 ${idx + 1} · 🔥 当前攻坚` : `阶段节点 ${idx + 1}`}
                            </span>
                            {isCurrent && countdown ? (
                              <span className={`time-capsule-badge tone-${countdown.tone}`}>
                                {countdown.text}
                              </span>
                            ) : null}
                          </div>

                          <div className="stepper-card-actions">
                            <CheckpointPositionControl
                              index={idx}
                              total={checkpoints.length}
                              taskTitle={task.title}
                              onReorder={(fromIdx, toIdx) => void reorderCheckpoint(fromIdx, toIdx)}
                              onMove={moveCheckpoint}
                            />
                            <button
                              className={`stepper-status-btn ${isDone ? "done" : "todo"}`}
                              onClick={() => void updateCheckpoint(task, { status: isDone ? "todo" : "done" })}
                              type="button"
                            >
                              {isDone ? "✓ 验收通过" : "○ 点击验收"}
                            </button>
                            <DeleteButton label={`删除节点 ${task.title || idx + 1}`} onClick={() => void deleteCheckpoint(task)} />
                          </div>
                        </div>

                        <div className="stepper-card-body">
                          <CheckpointTitleInput
                            autoFocus={focusTaskId === task.id}
                            initialValue={task.title}
                            placeholder="填写该阶段的核心交付物（如：完成架构设计并跑通自测）"
                            onCommit={(val) => void updateCheckpoint(task, { title: val })}
                          />
                        </div>

                        <div className="stepper-card-footer">
                          <div className="stepper-due-box">
                            <span className="stepper-due-label">计划交付：</span>
                            <DateField
                              ariaLabel={`计划验收时间：${task.title || "节点" + (idx + 1)}`}
                              value={task.due_date}
                              onChange={(value) => void updateCheckpoint(task, { due_date: value || null })}
                            />
                          </div>

                          {task.completed_at ? (
                            <span className="stepper-completed-badge">
                              ✓ 已于 {formatDate(task.completed_at)} 验收闭环
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="database-empty">还没有验收节点。点击下方规划第一个阶段验收节点。</div>
            )}

            <button className="stepper-add-btn" onClick={() => void addCheckpoint()} type="button">
              <PlusIcon /> 规划下一个阶段验收节点
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
              <span className="auto-save-status">{saving ? "正在自动同步…" : "✓ 属性实时保存"}</span>
            </div>

            <label className="form-field">
              <span>项目名称</span>
              <input className="cell-input" onBlur={() => void saveField()} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name ?? ""} />
            </label>

            <label className="form-field">
              <span>当前运营策略</span>
              <AutoGrowTextarea
                ariaLabel="当前运营策略"
                className="cell-input memo-input auto-grow-textarea"
                onBlur={() => void saveField({ description: draft.description })}
                onChange={(value) => setDraft({ ...draft, description: value })}
                placeholder="一句话底线与精力投入策略（例如：每周低精力维护，保持平稳运行与盈利状态，不占用攻坚精力）"
                value={draft.description ?? ""}
              />
            </label>

            <div className="form-row form-row-4">
              <label className="form-field">
                <span>项目板块</span>
                <select
                  className="select-input"
                  onChange={(event) => {
                    const category = event.target.value;
                    setDraft({ ...draft, category });
                    void saveField({ category });
                  }}
                  value={draft.category ?? "maintenance"}
                >
                  <option value="advancement">推进项目</option>
                  <option value="maintenance">维护项目</option>
                </select>
              </label>

              <label className="form-field">
                <span>运行状态</span>
                <select
                  className="select-input"
                  onChange={(event) => {
                    const status = event.target.value;
                    setDraft({ ...draft, status });
                    void saveField({ status });
                  }}
                  value={draft.status ?? "active"}
                >
                  <option value="high_energy">高投入维护</option>
                  <option value="active">平稳维护</option>
                  <option value="low_energy">低精力维护</option>
                  <option value="paused">暂停维护</option>
                  <option value="done">历史完结</option>
                </select>
              </label>

              <label className="form-field">
                <span>启动时间</span>
                <DateField
                  ariaLabel="项目启动时间"
                  onChange={(value) => {
                    setDraft({ ...draft, started_at: value });
                    void saveField({ started_at: value });
                  }}
                  value={draft.started_at}
                />
              </label>

              <label className="form-field">
                <span>完结时间</span>
                <DateField
                  ariaLabel="项目完结时间"
                  onChange={(value) => {
                    setDraft({ ...draft, end_date: value });
                    void saveField({ end_date: value });
                  }}
                  value={draft.end_date}
                />
              </label>

              <label className="form-field">
                <span>项目评分 (0~100 分)</span>
                <div className="score-input-wrapper">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="text-input score-input"
                    placeholder="未打分 (满分 100)"
                    value={draft.score ?? ""}
                    onChange={(event) => {
                      const val = event.target.value === "" ? null : Math.max(0, Math.min(100, Number(event.target.value)));
                      setDraft({ ...draft, score: val });
                    }}
                    onBlur={() => {
                      void saveField({ score: draft.score ?? null });
                    }}
                  />
                  <span className="score-input-suffix">分</span>
                </div>
              </label>
            </div>

            <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
              <label className="check-field">
                <input
                  checked={draft.benefit_enabled === "1"}
                  onChange={(event) => {
                    const benefit_enabled = event.target.checked ? "1" : "0";
                    setDraft({ ...draft, benefit_enabled });
                    void saveField({ benefit_enabled });
                  }}
                  type="checkbox"
                />
                开启盈利核算
              </label>

              <label className="check-field project-archive-check">
                <input
                  checked={draft.archive_requested === "1"}
                  onChange={(event) => {
                    const archive_requested = event.target.checked ? "1" : "0";
                    setDraft({ ...draft, archive_requested });
                    void saveField({ archive_requested });
                  }}
                  type="checkbox"
                />
                归档项目（需同时设置实际完结时间）
              </label>
            </div>
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
                  <span className="page-meta">记录固定维护标准、账号/配置与巡检要点（支持 Markdown）</span>
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <button
                    className="secondary-button"
                    onClick={() => setIsEditingNotes((prev) => !prev)}
                    style={{ fontSize: "12px", padding: "4px 10px" }}
                    type="button"
                  >
                    {isEditingNotes ? "👁️ 预览渲染" : "✏️ 编辑 SOP"}
                  </button>
                  <span className="muted">{savingNotes ? "保存中…" : "随时记录"}</span>
                </div>
              </div>
              {isEditingNotes ? (
                <>
                  <AutoGrowTextarea
                    ariaLabel="维护备忘与 SOP"
                    className="cell-input memo-input large-textarea auto-grow-textarea md-editor-textarea"
                    onChange={(value) => setWorkspace({ ...workspace, notes: value })}
                    placeholder="使用 Markdown 记录账号密码、巡检周期、故障处理 SOP、维护要点...&#10;支持 # 标题、- 列表、**粗体**、`代码` 等"
                    value={workspace.notes ?? ""}
                  />
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button
                      className="primary-button"
                      onClick={async () => {
                        await saveWorkspaceNotes();
                        setIsEditingNotes(false);
                      }}
                      type="button"
                    >
                      {savingNotes ? "保存中…" : "保存并完成"}
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setIsEditingNotes(false)}
                      type="button"
                    >
                      返回预览
                    </button>
                  </div>
                </>
              ) : (
                <div
                  className="sop-markdown-wrapper"
                  onClick={() => setIsEditingNotes(true)}
                  title="点击开始编辑 SOP"
                >
                  <MarkdownView content={workspace.notes ?? ""} />
                </div>
              )}
            </article>

            <article className="panel project-detail-panel">
              <div className="panel-heading project-detail-heading">
                <div>
                  <h2>重大维护事件记录</h2>
                  <span className="page-meta">仅记录架构调整、战略变动或关键维护事件时间线</span>
                </div>
              </div>
              <div className="project-activity-composer">
                <AutoGrowTextarea
                  ariaLabel="记录重大维护事件"
                  className="activity-composer-textarea"
                  onChange={setActivity}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                      event.preventDefault();
                      void addActivity();
                    }
                  }}
                  placeholder="记录关键架构调整、业务策略变动、重要故障复盘或关键里程碑…&#10;（支持 Ctrl+Enter 快捷提交）"
                  value={activity}
                />
                <div className="activity-composer-footer">
                  <div className="activity-kind-picker">
                    <span className="activity-kind-label">事件性质：</span>
                    <select
                      aria-label="选择事件性质"
                      className="activity-kind-select"
                      onChange={(e) => setActivityKind(e.target.value)}
                      value={activityKind}
                    >
                      <option value="progress">📝 常规记录（默认）</option>
                      <option value="milestone">🌟 重大里程碑</option>
                      <option value="game_changer">⚡ 胜负手</option>
                      <option value="closure">🏁 关键收官</option>
                      <option value="pivot">🔄 战略调整</option>
                      <option value="incident">⚠️ 故障复盘</option>
                    </select>
                  </div>
                  <button
                    className="primary-button activity-submit-btn"
                    disabled={!activity.trim() || savingActivity}
                    onClick={() => void addActivity()}
                    type="button"
                  >
                    {savingActivity ? "记录中…" : "➕ 记录事件"}
                  </button>
                </div>
              </div>

              {data.activities?.length ? (
                <div className="project-activity-stream">
                  {data.activities.map((item, idx) => {
                    const isLast = idx === (data.activities?.length ?? 0) - 1;
                    const meta = getActivityKindMeta(item.kind, item.important);
                    const timeInfo = formatActivityTime(item.created_at);
                    return (
                      <div className={`activity-timeline-item ${meta.cardClass}`} key={item.id}>
                        <div className="activity-timeline-axis">
                          <div className={`activity-node-dot ${meta.dotClass}`}>
                            {meta.icon !== "•" ? meta.icon : null}
                          </div>
                          {!isLast && <div className="activity-axis-line" />}
                        </div>
                        <div className="activity-card">
                          <div className="activity-card-header">
                            <div className="activity-header-left">
                              <span className="activity-time-badge">
                                📅 {timeInfo.date} <span className="activity-time-clock">{timeInfo.time}</span>
                              </span>
                              <select
                                aria-label="事件性质"
                                className={`activity-kind-badge-select ${meta.badgeClass}`}
                                onChange={(e) => void updateActivityKind(item.id, e.target.value)}
                                title="点击直接切换此事件性质"
                                value={meta.type}
                              >
                                <option value="progress">📝 常规记录</option>
                                <option value="milestone">🌟 重大里程碑</option>
                                <option value="game_changer">⚡ 胜负手</option>
                                <option value="closure">🏁 关键收官</option>
                                <option value="pivot">🔄 战略调整</option>
                                <option value="incident">⚠️ 故障复盘</option>
                              </select>
                            </div>
                            <DeleteButton
                              label="删除此条事件记录"
                              message="确定删除此条重大维护事件记录吗？此操作不可撤销。"
                              onClick={() => void deleteActivity(item.id)}
                            />
                          </div>
                          <div className="activity-card-body">
                            <MarkdownView content={item.content} emptyPlaceholder="" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="activity-empty-state">
                  <span className="activity-empty-icon">📜</span>
                  <p>暂无重大维护事件记录</p>
                  <span className="muted">用于沉淀关键战略升级、技术改造、故障排查与里程碑节点</span>
                </div>
              )}
            </article>
          </div>
        </>
      )}
    </div>
  );
}
