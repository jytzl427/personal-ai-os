import { useEffect, useState } from "react";
import { Tag } from "./Tag.js";
import { CloseIcon } from "./Icons.js";
import { apiJson } from "../lib/api.js";
import { parseTaskBlocks, richTextToPlainText, type TaskBlock } from "./RichTextBlockEditor.js";
import { formatDate, todayYmd } from "../lib/dates.js";

type CardKind = "daily" | "stage";
type DailyPlanDetail = {
  plan: { plan_date: string; status: string; plan_text?: string | null } | null;
};
type StagePlan = {
  id: string;
  period_start: string;
  period_end: string;
  plan_text?: string | null;
  status: string;
};

function readablePlanText(value?: string | null) {
  return richTextToPlainText(String(value ?? "")).trim();
}

function renderInlineMarkdown(rawText: string): React.ReactNode {
  const clean = rawText
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

function PlanRichText({ value }: { value?: string | null }) {
  const blocks = parseTaskBlocks(String(value ?? "")).filter((block) => block.type === "divider" || block.text.trim());
  let numberedIndex = 0;
  return (
    <div className="plan-card-rich-text">
      {blocks.map((block: TaskBlock) => {
        if (block.type === "numbered") numberedIndex += 1;
        else numberedIndex = 0;
        const text = block.text.trim();
        if (block.type === "divider") return <div className="plan-card-rich-divider" key={block.id} />;
        if (!text) return null;
        const rendered = renderInlineMarkdown(text);
        if (!rendered) return null;
        if (block.type === "heading1") return <h3 className="plan-card-rich-heading1" key={block.id}>{rendered}</h3>;
        if (block.type === "heading2") return <h4 className="plan-card-rich-heading2" key={block.id}>{rendered}</h4>;
        if (block.type === "todo") return <div className="plan-card-rich-item plan-card-rich-todo" key={block.id}><span aria-hidden="true" className={block.checked ? "plan-card-rich-checkbox is-checked" : "plan-card-rich-checkbox"}>{block.checked ? "✓" : ""}</span><span className={block.checked ? "is-checked" : ""}>{rendered}</span></div>;
        if (block.type === "bullet") return <div className="plan-card-rich-item" key={block.id}><span aria-hidden="true" className="plan-card-rich-marker">•</span><span>{rendered}</span></div>;
        if (block.type === "numbered") return <div className="plan-card-rich-item" key={block.id}><span aria-hidden="true" className="plan-card-rich-marker">{numberedIndex}.</span><span>{rendered}</span></div>;
        if (block.type === "quote") return <blockquote className="plan-card-rich-quote" key={block.id}>{rendered}</blockquote>;
        return <p className="plan-card-rich-paragraph" key={block.id}>{rendered}</p>;
      })}
    </div>
  );
}

export function ReadOnlyPlanCard({ kind, onClose }: { kind: CardKind; onClose: () => void }) {
  const [daily, setDaily] = useState<DailyPlanDetail | null>(null);
  const [stages, setStages] = useState<StagePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const request = kind === "daily"
      ? apiJson<DailyPlanDetail>("/plans/" + todayYmd())
      : apiJson<{ stages: StagePlan[] }>("/stage-plans");
    request.then((result) => {
      if (!active) return;
      if (kind === "daily") setDaily(result as DailyPlanDetail);
      else setStages((result as { stages: StagePlan[] }).stages);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "计划读取失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [kind]);

  return (
    <div className="read-only-plan-overlay" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-label={kind === "daily" ? "每日计划" : "阶段计划"} aria-modal="true" className="read-only-plan-card" role="dialog">
        <div className="read-only-plan-header">
          <div>
            <p className="eyebrow">{kind === "daily" ? "今日计划" : "阶段计划"}</p>
            <h2>{kind === "daily" ? "每日计划" : "阶段计划"}</h2>
          </div>
          <button aria-label="关闭计划卡片" className="plan-card-close" onClick={onClose} type="button">
            <CloseIcon />
          </button>
        </div>
        {loading ? <p className="muted">正在读取计划…</p> : null}
        {error ? <div className="notice error">{error}</div> : null}
        {!loading && !error && kind === "daily" ? (
          daily?.plan ? <div className="plan-card-body">
            <div className="plan-card-meta">
              <span>{formatDate(daily.plan.plan_date)}</span>
              <Tag size="sm" tone={daily.plan.status === "confirmed" ? "success" : "neutral"}>
                {daily.plan.status === "confirmed" ? "已确认" : "草稿"}
              </Tag>
            </div>
            {readablePlanText(daily.plan.plan_text) ? <PlanRichText value={daily.plan.plan_text} /> : <p className="muted">今天还没有填写计划。</p>}
          </div> : <p className="muted">今天还没有填写计划。</p>
        ) : null}
        {!loading && !error && kind === "stage" ? (
          stages.length === 0 ? <p className="muted">目前没有阶段周期计划。</p> : (
            <div className="plan-card-stage-list">
              {stages.map((stage) => (
                <article className="plan-card-stage" key={stage.id}>
                  <div className="plan-card-meta">
                    <strong>{formatDate(stage.period_start)} — {formatDate(stage.period_end)}</strong>
                    <Tag size="sm" tone={stage.status === "confirmed" ? "success" : stage.status === "executed" ? "info" : "neutral"}>
                      {stage.status === "confirmed" ? "已确认" : stage.status === "executed" ? "已执行" : "草稿"}
                    </Tag>
                  </div>
                  {readablePlanText(stage.plan_text) ? <PlanRichText value={stage.plan_text} /> : <p className="muted">这个周期还没有填写计划。</p>}
                </article>
              ))}
            </div>
          )
        ) : null}
        <p className="plan-card-readonly">只读查看 · 如需修改，请进入计划与复盘</p>
      </section>
    </div>
  );
}
