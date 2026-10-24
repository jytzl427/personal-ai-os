import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Tag } from "./Tag.js";
import { CloseIcon } from "./Icons.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { richTextToPlainText } from "./RichTextBlockEditor.js";
import { formatDate, todayYmd } from "../lib/dates.js";

type CardKind = "daily" | "stage";

type DailyPlanDetail = {
  plan: { plan_date: string; status: string; plan_text?: string | null } | null;
  items?: Array<{ id: string; title: string; status: string; completed?: number }>;
};

type StagePlan = {
  id: string;
  period_start: string;
  period_end: string;
  plan_text?: string | null;
  status: string;
};

export type DailyHUDData = {
  phaseInfo: string;
  focusBattles: string[];
  checklistSections: Array<{ title: string; icon: string; items: Array<{ checked: boolean; text: string }> }>;
  totalCount: number;
  checkedCount: number;
};

export type StageHUDData = {
  title: string;
  mainline: { title: string; detail: string };
  baselineMood: { title: string; detail: string };
  financeItems: string[];
  healthItems: string[];
  habitItems: string[];
  projectMilestones: Array<{ name: string; milestone: string; goal?: string }>;
  maintenanceProjects: Array<{ name: string; milestone: string }>;
  miscItems: string[];
};

function cleanLatexMath(str: string): string {
  return str
    .replace(/\$\\le\s*(\d+(?:\.\d+)?)\$/g, "≤ $1")
    .replace(/\$\\ge\s*(\d+(?:\.\d+)?)\$/g, "≥ $1")
    .replace(/\$\\le\$/g, "≤")
    .replace(/\$\\ge\$/g, "≥")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/；；+/g, "；")
    .replace(/；\s*；/g, "；");
}

function readablePlanText(value?: string | null) {
  return cleanLatexMath(richTextToPlainText(String(value ?? ""))).trim();
}

function renderInlineMarkdown(rawText: string): React.ReactNode {
  const clean = cleanLatexMath(rawText)
    .replace(/\*{4,}/g, "")
    .replace(/\*\*\s*\*\*/g, "")
    .trim();
  if (!clean) return null;

  const regex = /(\*\*[^*]+\*\*|`[^`]+`|~~[^~]+~~|\*[^*]+\*)/g;
  const parts = clean.split(regex);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return <del key={index}>{part.slice(2, -2)}</del>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export function PlanRichText({ value }: { value?: string | null }) {
  const lines = useMemo(() => {
    const raw = String(value ?? "").trim();
    if (!raw) return [];
    return raw.split(/\r?\n/).map((line, idx) => ({ id: `line-${idx}`, text: line.trim() }));
  }, [value]);

  if (lines.length === 0) {
    return <p className="muted">暂无计划内容。</p>;
  }

  let numberedIndex = 0;

  return (
    <div className="plan-card-rich-text">
      {lines.map(({ id, text }) => {
        if (!text) return null;
        if (/^[-*_]{3,}$/.test(text)) {
          numberedIndex = 0;
          return <div className="plan-card-rich-divider" key={id} />;
        }
        if (text.startsWith("# ")) {
          numberedIndex = 0;
          return <h3 className="plan-card-rich-heading1" key={id}>{renderInlineMarkdown(text.slice(2))}</h3>;
        }
        if (text.startsWith("## ")) {
          numberedIndex = 0;
          return <h4 className="plan-card-rich-heading2" key={id}>{renderInlineMarkdown(text.slice(3))}</h4>;
        }
        if (text.startsWith("### ")) {
          numberedIndex = 0;
          return <h5 className="plan-card-rich-heading3" key={id}>{renderInlineMarkdown(text.slice(4))}</h5>;
        }
        if (text.startsWith("- [ ] ") || text.startsWith("- [x] ") || text.startsWith("* [ ] ") || text.startsWith("* [x] ")) {
          numberedIndex = 0;
          const checked = text.includes("[x]");
          const content = text.replace(/^[*\-]\s*\[[ x]\]\s*/, "");
          return (
            <div className="plan-card-rich-item plan-card-rich-todo" key={id}>
              <span aria-hidden="true" className={checked ? "plan-card-rich-checkbox is-checked" : "plan-card-rich-checkbox"}>
                {checked ? "✓" : ""}
              </span>
              <span className={checked ? "is-checked" : ""}>{renderInlineMarkdown(content)}</span>
            </div>
          );
        }
        if (text.startsWith("- ") || text.startsWith("* ")) {
          numberedIndex = 0;
          const content = text.slice(2).trim();
          return (
            <div className="plan-card-rich-item" key={id}>
              <span aria-hidden="true" className="plan-card-rich-marker">•</span>
              <span>{renderInlineMarkdown(content)}</span>
            </div>
          );
        }
        if (/^\d+\.\s+/.test(text)) {
          numberedIndex += 1;
          const content = text.replace(/^\d+\.\s+/, "");
          return (
            <div className="plan-card-rich-item" key={id}>
              <span aria-hidden="true" className="plan-card-rich-marker">{numberedIndex}.</span>
              <span>{renderInlineMarkdown(content)}</span>
            </div>
          );
        }
        if (text.startsWith("> ")) {
          numberedIndex = 0;
          return <blockquote className="plan-card-rich-quote" key={id}>{renderInlineMarkdown(text.slice(2))}</blockquote>;
        }
        numberedIndex = 0;
        return <p className="plan-card-rich-paragraph" key={id}>{renderInlineMarkdown(text)}</p>;
      })}
    </div>
  );
}

function parseDailyHUD(text?: string | null): DailyHUDData | null {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\r?\n/);
  let phaseInfo = "";
  const focusBattles: string[] = [];
  const checklistSections: Array<{ title: string; icon: string; items: Array<{ checked: boolean; text: string }> }> = [];
  let currentSection: { title: string; icon: string; items: Array<{ checked: boolean; text: string }> } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("# ")) {
      const match = line.match(/（([^）]+)）/);
      if (match) phaseInfo = match[1];
      continue;
    }

    if (line.startsWith("## ") && (line.includes("板块一") || line.includes("攻坚硬仗聚焦"))) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("## ")) {
        const item = lines[j].trim();
        if (item.startsWith("* ") || item.startsWith("- ")) {
          focusBattles.push(item.replace(/^[*\-]\s+/, "").trim());
        }
        j++;
      }
      i = j - 1;
      continue;
    }

    if (line.startsWith("### ")) {
      const rawTitle = line.slice(4).trim();
      let icon = "📋";
      if (rawTitle.includes("财务") || rawTitle.includes("消费")) icon = "💰";
      else if (rawTitle.includes("健康") || rawTitle.includes("作息")) icon = "🏃";
      else if (rawTitle.includes("习惯")) icon = "🥛";
      else if (rawTitle.includes("攻坚") || rawTitle.includes("硬仗")) icon = "⚔️";
      else if (rawTitle.includes("维护") || rawTitle.includes("琐事")) icon = "🛡️";

      currentSection = { title: rawTitle, icon, items: [] };
      checklistSections.push(currentSection);
      continue;
    }

    if (line.startsWith("- [ ] ") || line.startsWith("- [x] ") || line.startsWith("* [ ] ") || line.startsWith("* [x] ")) {
      const checked = line.includes("[x]");
      const itemText = line.replace(/^[*\-]\s*\[[ x]\]\s*/, "").trim();
      if (!currentSection) {
        currentSection = { title: "行动待办清单", icon: "📋", items: [] };
        checklistSections.push(currentSection);
      }
      currentSection.items.push({ checked, text: itemText });
    }
  }

  const totalCount = checklistSections.reduce((sum, s) => sum + s.items.length, 0);
  const checkedCount = checklistSections.reduce((sum, s) => sum + s.items.filter((it) => it.checked).length, 0);

  return { phaseInfo, focusBattles, checklistSections, totalCount, checkedCount };
}

function parseStageHUD(text?: string | null): StageHUDData | null {
  if (!text || !text.trim()) return null;
  const lines = text.split(/\r?\n/);
  let title = "";
  const mainline = { title: "", detail: "" };
  const baselineMood = { title: "", detail: "" };

  const financeItems: string[] = [];
  const healthItems: string[] = [];
  const habitItems: string[] = [];
  const projectMilestones: Array<{ name: string; milestone: string }> = [];
  const maintenanceProjects: Array<{ name: string; milestone: string }> = [];
  const miscItems: string[] = [];

  let currentBlock = "";

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      continue;
    }

    if (line.startsWith("## ")) {
      if (line.includes("板块一") || line.includes("主线与生活状态")) currentBlock = "mainline";
      else if (line.includes("板块二") || line.includes("生活底盘与指标")) currentBlock = "finance";
      else if (line.includes("板块三") || line.includes("项目与想法流转")) currentBlock = "projects";
      else if (line.includes("板块四") || line.includes("其他杂项板块")) currentBlock = "misc";
      continue;
    }

    if (line.includes("财务指标") || line.includes("财务计划")) { currentBlock = "finance"; continue; }
    if (line.includes("健康指标") || line.includes("健康计划")) { currentBlock = "health"; continue; }
    if (line.includes("习惯清单") || line.includes("习惯计划")) { currentBlock = "habit"; continue; }
    if (line.includes("维护类项目")) { currentBlock = "maintenance"; continue; }
    if (line.includes("推进类项目")) { currentBlock = "projects"; continue; }
    if (line.includes("想法库流转")) { currentBlock = "ideas"; continue; }

    const clean = cleanLatexMath(line.replace(/^[*\-\s]+/, "").replace(/\*\*/g, "").trim());

    if (currentBlock === "mainline") {
      if (line.includes("核心主线")) {
        const m = line.match(/核心主线[*\s：:]+(.+)/);
        if (m) mainline.title = m[1].replace(/[*#]/g, "").trim();
      } else if (line.includes("生活状态")) {
        const m = line.match(/生活状态[^\s*：:]*[*\s：:]+(.+)/);
        if (m) baselineMood.title = m[1].replace(/[*#]/g, "").trim();
      } else if (baselineMood.title) {
        baselineMood.detail += (baselineMood.detail ? " " : "") + clean;
      } else if (mainline.title) {
        mainline.detail += (mainline.detail ? " " : "") + clean;
      }
    } else if (currentBlock === "finance") {
      financeItems.push(clean);
    } else if (currentBlock === "health") {
      healthItems.push(clean);
    } else if (currentBlock === "habit") {
      habitItems.push(clean);
    } else if (currentBlock === "projects") {
      let name = "";
      let milestone = clean;
      let goal = "";

      const bracketMatch = clean.match(/^【([^】]+)】\s*(.*)$/);
      if (bracketMatch) {
        name = bracketMatch[1].trim();
        milestone = bracketMatch[2].trim();
      } else {
        const colonMatch = clean.match(/^([^：:]+?)[：:]\s*(.+)$/);
        if (colonMatch) {
          name = colonMatch[1].trim();
          milestone = colonMatch[2].trim();
        }
      }

      const goalMatch = milestone.match(/(?:目标|阶段目标|工作量)[：:]\s*(.+)$/);
      if (goalMatch) {
        goal = goalMatch[1].trim();
      } else {
        goal = milestone;
      }

      projectMilestones.push({ name, milestone, goal });
    } else if (currentBlock === "maintenance") {
      const match = clean.match(/^([^：:]+?)[：:]\s*(.+)$/);
      if (match) {
        maintenanceProjects.push({ name: match[1].trim(), milestone: match[2].trim() });
      } else {
        maintenanceProjects.push({ name: "", milestone: clean });
      }
    } else if (currentBlock === "misc") {
      miscItems.push(clean);
    }
  }

  return { title, mainline, baselineMood, financeItems, healthItems, habitItems, projectMilestones, maintenanceProjects, miscItems };
}

export function ReadOnlyPlanCard({ kind, onClose }: { kind: CardKind; onClose: () => void }) {
  const [daily, setDaily] = useState<DailyPlanDetail | null>(null);
  const [stages, setStages] = useState<StagePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRawText, setShowRawText] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const request = kind === "daily"
      ? apiJson<DailyPlanDetail>("/plans/" + todayYmd())
      : apiJson<{ stages: StagePlan[] }>("/stage-plans");

    request.then((result) => {
      if (!active) return;
      if (kind === "daily") {
        setDaily(result as DailyPlanDetail);
      } else {
        const stageList = (result as { stages: StagePlan[] }).stages ?? [];
        setStages(stageList);
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "计划读取失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [kind]);

  const dailyHUD = useMemo(() => {
    if (kind !== "daily" || !daily?.plan?.plan_text) return null;
    return parseDailyHUD(daily.plan.plan_text);
  }, [kind, daily]);

  const currentStage = useMemo(() => {
    if (kind !== "stage" || stages.length === 0) return null;
    const today = todayYmd();
    // Prioritize latest stage if today is within or before its end date
    if (stages[0] && today <= stages[0].period_end) {
      return stages[0];
    }
    return stages.find((s) => today >= s.period_start && today <= s.period_end) ?? stages[0];
  }, [kind, stages]);

  const stageHUD = useMemo(() => {
    if (!currentStage?.plan_text) return null;
    return parseStageHUD(currentStage.plan_text);
  }, [currentStage]);

  async function toggleDailyItem(itemText: string, currentChecked: boolean) {
    if (!daily?.plan) return;
    const oldText = daily.plan.plan_text || "";
    const lines = oldText.split(/\r?\n/);
    let found = false;
    const newLines = lines.map((line) => {
      if (found) return line;
      const trimmed = line.trim();
      const content = trimmed.replace(/^[*\-]\s*\[[ x]\]\s*/, "").trim();
      if ((trimmed.startsWith("- [") || trimmed.startsWith("* [")) && content === itemText.trim()) {
        found = true;
        const prefix = line.match(/^(\s*[*\-]\s*\[)[ x](\]\s*)/);
        if (prefix) {
          return `${prefix[1]}${currentChecked ? " " : "x"}${prefix[2]}${content}`;
        }
        return currentChecked ? line.replace(/\[x\]/, "[ ]") : line.replace(/\[ \]/, "[x]");
      }
      return line;
    });

    if (!found) return;
    const newText = newLines.join("\n");
    setDaily((prev) => prev ? { ...prev, plan: { ...prev.plan!, plan_text: newText } } : null);

    try {
      await apiJson("/plans/" + daily.plan.plan_date, jsonRequest("PATCH", { plan_text: newText }));
    } catch {
      setDaily((prev) => prev ? { ...prev, plan: { ...prev.plan!, plan_text: oldText } } : null);
    }
  }

  async function saveDirectEdit() {
    setSavingEdit(true);
    setError(null);
    try {
      if (kind === "daily") {
        if (!daily?.plan) return;
        await apiJson("/plans/" + daily.plan.plan_date, jsonRequest("PATCH", { plan_text: editText }));
        setDaily((prev) => prev ? { ...prev, plan: { ...prev.plan!, plan_text: editText } } : null);
      } else {
        if (!currentStage) return;
        await apiJson("/stage-plans/" + currentStage.id, jsonRequest("PATCH", { plan_text: editText }));
        setStages((prev) => prev.map((s) => s.id === currentStage.id ? { ...s, plan_text: editText } : s));
      }
      setIsEditing(false);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "保存计划修改失败");
    } finally {
      setSavingEdit(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="read-only-plan-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        aria-label={kind === "daily" ? "每日计划速览" : "阶段计划速览"}
        aria-modal="true"
        className="read-only-plan-card plan-quick-hud"
        role="dialog"
      >
        {/* Top Header */}
        <div className="read-only-plan-header">
          <div className="plan-hud-title-group">
            <div className="plan-hud-badge-row">
              <span className="plan-hud-eyebrow">
                {kind === "daily" ? "今日战术速览 · DAILY HUD" : "阶段战略速览 · STAGE STRATEGY"}
              </span>
              {kind === "daily" && daily?.plan?.status ? (
                <Tag size="sm" tone={daily.plan.status === "confirmed" ? "success" : "neutral"}>
                  {daily.plan.status === "confirmed" ? "已确认生效" : "草稿中"}
                </Tag>
              ) : null}
              {kind === "stage" && currentStage ? (
                <Tag size="sm" tone={currentStage.status === "confirmed" ? "success" : currentStage.status === "executed" ? "info" : "neutral"}>
                  {currentStage.status === "confirmed" ? "已确认生效" : currentStage.status === "executed" ? "已执行" : "草稿中"}
                </Tag>
              ) : null}
            </div>
            <h2>
              {kind === "daily" ? (
                <>
                  <span>{daily?.plan ? formatDate(daily.plan.plan_date) : "今日"} 每日计划</span>
                  {dailyHUD?.phaseInfo ? <span className="plan-hud-phase-chip">{dailyHUD.phaseInfo}</span> : null}
                </>
              ) : (
                <>
                  <span>{currentStage ? `${formatDate(currentStage.period_start)} — ${formatDate(currentStage.period_end)}` : "阶段周期计划"}</span>
                  {currentStage && todayYmd() >= currentStage.period_start && todayYmd() <= currentStage.period_end ? (
                    <span className="plan-hud-phase-chip is-active">当前执行周期</span>
                  ) : null}
                </>
              )}
            </h2>
          </div>
          <button aria-label="关闭计划速览" className="plan-card-close" onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </div>

        {loading ? <p className="muted" style={{ padding: "32px 0", textAlign: "center" }}>正在载入计划情报…</p> : null}
        {error ? <div className="notice error">{error}</div> : null}

        {/* DIRECT EDITING PANE */}
        {isEditing ? (
          <div className="plan-hud-editor-pane">
            <div className="plan-hud-editor-toolbar">
              <span className="editor-title">✏️ 编辑{kind === "daily" ? "每日" : "阶段"}计划 Markdown 内容</span>
              <button
                className="primary-button plan-hud-save-btn"
                disabled={savingEdit}
                onClick={() => void saveDirectEdit()}
                type="button"
              >
                {savingEdit ? "正在保存…" : "💾 保存修改"}
              </button>
            </div>
            <textarea
              aria-label="修改计划内容"
              className="plan-hud-editor-textarea"
              onChange={(e) => setEditText(e.target.value)}
              placeholder="在此直接修改计划 Markdown 文本…"
              value={editText}
            />
          </div>
        ) : null}

        {/* DAILY PLAN HUD CONTENT */}
        {!loading && !error && !isEditing && kind === "daily" ? (
          !daily?.plan || !daily.plan.plan_text?.trim() ? (
            <div className="plan-hud-empty">
              <p className="empty-title">今日暂未填写计划</p>
              <p className="muted">请在晨起通过每日计划制定对话录入攻坚硬仗与打卡清单。</p>
            </div>
          ) : showRawText ? (
            <div className="plan-card-body">
              <PlanRichText value={daily.plan.plan_text} />
            </div>
          ) : (
            <div className="plan-hud-content">
              {/* Section 1: Focus Hard Battles (攻坚硬仗聚焦) */}
              {dailyHUD && dailyHUD.focusBattles.length > 0 ? (
                <section className="plan-hud-focus-bento">
                  <div className="plan-hud-section-header">
                    <div className="header-left">
                      <span className="hud-icon">⚔️</span>
                      <h3>今日核心攻坚聚焦</h3>
                    </div>
                    <span className="hud-count-tag">{dailyHUD.focusBattles.length} 个攻坚重点</span>
                  </div>
                  <div className="plan-hud-focus-grid">
                    {dailyHUD.focusBattles.map((battle, idx) => {
                      const projectMatch = battle.match(/^【([^】]+)】/);
                      const projectName = projectMatch ? projectMatch[1] : null;
                      const taskDesc = projectMatch ? battle.replace(/^【[^】]+】\s*/, "") : battle;
                      return (
                        <div className="plan-hud-focus-card" key={idx}>
                          {projectName ? <span className="focus-project-badge">{projectName}</span> : null}
                          <span className="focus-task-text">{taskDesc}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {/* Section 2: Baseline Indicators Dashboard (底盘三线微看板) */}
              <div className="plan-hud-metrics-row">
                <div className="plan-hud-metric-card card-finance">
                  <div className="metric-header">
                    <span className="metric-icon">💰</span>
                    <span className="metric-label">财务与日常消费</span>
                  </div>
                  <div className="metric-value">¥25.00 <span className="metric-unit">/ 天</span></div>
                  <div className="metric-subtext">午晚餐饮日清日结 · 坚决 0 破戒</div>
                </div>

                <div className="plan-hud-metric-card card-health">
                  <div className="metric-header">
                    <span className="metric-icon">🏃</span>
                    <span className="metric-label">健康作息筑底</span>
                  </div>
                  <div className="metric-value">00:30 <span className="metric-unit">就寝底线</span></div>
                  <div className="metric-subtext">晨起称重 · 适度走动拉伸</div>
                </div>

                <div className="plan-hud-metric-card card-habits">
                  <div className="metric-header">
                    <span className="metric-icon">🥛</span>
                    <span className="metric-label">微习惯打卡</span>
                  </div>
                  <div className="metric-value">水 5 杯 <span className="metric-unit">· 牙 3 次</span></div>
                  <div className="metric-subtext">每小时起身活动 1~2 分钟打断久坐</div>
                </div>
              </div>

              {/* Section 3: Action Checklists (全盘行动总清单) */}
              {dailyHUD && dailyHUD.checklistSections.length > 0 ? (
                <section className="plan-hud-checklist-bento">
                  <div className="plan-hud-section-header">
                    <div className="header-left">
                      <span className="hud-icon">📋</span>
                      <h3>全盘行动清单</h3>
                    </div>
                    {dailyHUD.totalCount > 0 ? (
                      <div className="hud-progress-capsule">
                        <span className="capsule-label">{dailyHUD.checkedCount} / {dailyHUD.totalCount} 项完成</span>
                        <div className="capsule-bar">
                          <div
                            className="capsule-bar-fill"
                            style={{ width: `${Math.round((dailyHUD.checkedCount / dailyHUD.totalCount) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="plan-hud-checklist-groups">
                    {dailyHUD.checklistSections.map((sec, secIdx) => (
                      <div className="plan-hud-checklist-group" key={secIdx}>
                        <h4 className="checklist-group-title">
                          <span className="group-icon">{sec.icon}</span>
                          <span>{sec.title}</span>
                          <span className="group-count">({sec.items.length})</span>
                        </h4>
                        <div className="checklist-group-items">
                          {sec.items.map((item, itemIdx) => (
                            <div
                              className={`hud-checklist-item ${item.checked ? "is-checked" : ""}`}
                              key={itemIdx}
                              onClick={() => void toggleDailyItem(item.text, item.checked)}
                              role="checkbox"
                              aria-checked={item.checked}
                              tabIndex={0}
                              title="点击切换完成勾选"
                            >
                              <span className={`hud-checkbox ${item.checked ? "checked" : ""}`}>
                                {item.checked ? "✓" : ""}
                              </span>
                              <span className="hud-item-text">{renderInlineMarkdown(item.text)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          )
        ) : null}

        {/* STAGE PLAN HUD CONTENT */}
        {!loading && !error && !isEditing && kind === "stage" ? (
          !currentStage || !currentStage.plan_text?.trim() ? (
            <div className="plan-hud-empty">
              <p className="empty-title">当前周期暂未填写阶段计划</p>
              <p className="muted">请在阶段初通过阶段计划制定对话敲定核心战略、底盘指标与项目攻坚节点。</p>
            </div>
          ) : showRawText ? (
            <div className="plan-card-body">
              <PlanRichText value={currentStage.plan_text} />
            </div>
          ) : (
            <div className="plan-hud-content">
              {/* Section 1: Mainline & Mindset Dual Bento (核心主线与生活状态) */}
              <div className="plan-hud-dual-bento">
                <div className="plan-hud-strategy-card card-mainline">
                  <div className="strategy-tag">🎯 阶段唯一核心主线</div>
                  <h4 className="strategy-headline">{stageHUD?.mainline.title || "【核心主线推进】"}</h4>
                  <p className="strategy-detail">{stageHUD?.mainline.detail || "多线齐头并进，以小切片快速验收推进，全方位收割技术资产。"}</p>
                </div>

                <div className="plan-hud-strategy-card card-lifestyle">
                  <div className="strategy-tag">⚡ 生活与作息基调</div>
                  <h4 className="strategy-headline">{stageHUD?.baselineMood.title || "【状态迅速调整】"}</h4>
                  <p className="strategy-detail">{stageHUD?.baselineMood.detail || "作息强力拉回，坚决守牢 00:30 就寝底线，心智彻底收敛，全神贯注主线攻坚。"}</p>
                </div>
              </div>

              {/* Section 2: Project Milestones Matrix (项目攻坚推进目标与验收节点) */}
              {stageHUD && stageHUD.projectMilestones.length > 0 ? (
                <section className="plan-hud-milestones-bento">
                  <div className="plan-hud-section-header">
                    <div className="header-left">
                      <span className="hud-icon">🚩</span>
                      <h3>推进类项目攻坚目标与验收节点</h3>
                    </div>
                    <span className="hud-count-tag">{stageHUD.projectMilestones.length} 个攻坚项目</span>
                  </div>
                  <div className="plan-hud-milestones-grid">
                    {stageHUD.projectMilestones.map((proj, idx) => (
                      <div className="plan-hud-milestone-card" key={idx}>
                        <div className="milestone-card-top">
                          {proj.name ? <span className="milestone-project-name">{proj.name}</span> : null}
                          <span className="milestone-goal-badge">🎯 阶段目标</span>
                        </div>
                        <div className="milestone-deliverable">
                          {renderInlineMarkdown(proj.goal || proj.milestone)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Section 3: Baseline Redlines & Maintenance (底盘量化指标与维持类项目) */}
              <div className="plan-hud-metrics-row">
                <div className="plan-hud-metric-card card-finance">
                  <div className="metric-header">
                    <span className="metric-icon">💰</span>
                    <span className="metric-label">财务底盘红线</span>
                  </div>
                  <div className="metric-list">
                    {stageHUD && stageHUD.financeItems.length > 0 ? (
                      stageHUD.financeItems.slice(0, 3).map((item, idx) => (
                        <div className="metric-bullet" key={idx}>• {renderInlineMarkdown(item)}</div>
                      ))
                    ) : (
                      <>
                        <div className="metric-bullet">• 午晚餐饮限额：25.00 元/天</div>
                        <div className="metric-bullet">• 弹性消费上限：冲动/零食/奶茶 ≤ 1 笔</div>
                        <div className="metric-bullet">• 中转站收支：严格零新增负债</div>
                      </>
                    )}
                  </div>
                </div>

                <div className="plan-hud-metric-card card-health">
                  <div className="metric-header">
                    <span className="metric-icon">🏃</span>
                    <span className="metric-label">健康底盘红线</span>
                  </div>
                  <div className="metric-list">
                    {stageHUD && stageHUD.healthItems.length > 0 ? (
                      stageHUD.healthItems.slice(0, 3).map((item, idx) => (
                        <div className="metric-bullet" key={idx}>• {renderInlineMarkdown(item)}</div>
                      ))
                    ) : (
                      <>
                        <div className="metric-bullet">• 严格守住 00:30 就寝底线</div>
                        <div className="metric-bullet">• 晨起空腹称重管理走势</div>
                        <div className="metric-bullet">• 有效运动 ≥ 1~2 次 · 不自律 ≤ 2 次</div>
                      </>
                    )}
                  </div>
                </div>

                <div className="plan-hud-metric-card card-habits">
                  <div className="metric-header">
                    <span className="metric-icon">🛡️</span>
                    <span className="metric-label">维护项目与关键节点</span>
                  </div>
                  <div className="metric-list">
                    {stageHUD && stageHUD.maintenanceProjects.length > 0 ? (
                      stageHUD.maintenanceProjects.slice(0, 2).map((m, idx) => (
                        <div className="metric-bullet" key={idx}>
                          <strong>{m.name}</strong>：{renderInlineMarkdown(m.milestone.slice(0, 35))}
                        </div>
                      ))
                    ) : null}
                    {stageHUD && stageHUD.miscItems.length > 0 ? (
                      stageHUD.miscItems.slice(0, 2).map((m, idx) => (
                        <div className="metric-bullet is-highlight" key={`misc-${idx}`}>
                          {renderInlineMarkdown(m.slice(0, 40))}
                        </div>
                      ))
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          )
        ) : null}

        {/* Bottom Bar: Switch View & Readonly Hint */}
        <div className="plan-hud-footer">
          <div className="plan-hud-footer-left">
            <button
              className="plan-hud-toggle-raw"
              onClick={() => {
                if (isEditing) setIsEditing(false);
                setShowRawText(!showRawText);
              }}
              type="button"
            >
              {showRawText ? "← 返回战术速览看板" : "查看完整原始文本 →"}
            </button>
            <button
              className="plan-hud-edit-btn"
              onClick={() => {
                if (isEditing) {
                  setIsEditing(false);
                } else {
                  setEditText(kind === "daily" ? (daily?.plan?.plan_text ?? "") : (currentStage?.plan_text ?? ""));
                  setIsEditing(true);
                  setShowRawText(false);
                }
              }}
              type="button"
            >
              {isEditing ? "取消编辑" : "✏️ 修改计划内容"}
            </button>
          </div>
          <span className="plan-card-readonly-hint">速览看板 · 沟通确认即生效</span>
        </div>
      </section>
    </div>,
    document.body
  );
}
