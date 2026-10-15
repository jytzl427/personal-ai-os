import { useEffect, useMemo, useState } from "react";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { DateField } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { RichTextBlockEditor, richTextToPlainText } from "../components/RichTextBlockEditor.js";
import { PropertySelect } from "../components/PropertySelect.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import { Tag, type TagTone } from "../components/Tag.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { formatDate, shiftYmd, todayYmd } from "../lib/dates.js";
import type { Route } from "../lib/route.js";

export type PlanReviewTab = "daily-plan" | "stage-plan" | "daily-review" | "period-review";

type ReviewContent = { text?: string } & Record<string, unknown>;
type Review = { id: string; review_type: "daily" | "period" | string; period_start: string; period_end: string; status: string; content?: ReviewContent };
type DailyPlan = { id: string; plan_date: string; status: string; plan_text?: string | null; updated_at?: string | null; archived_at?: string | null };
type DailyPlanDetail = { plan: DailyPlan | null; items: Array<{ id: string; title: string; status: string; completed: number; reason?: string }> };
type StagePlan = { id: string; period_start: string; period_end: string; plan_text?: string | null; status: string; updated_at?: string | null; archived_at?: string | null };

const tabOptions: Array<{ value: PlanReviewTab; label: string }> = [
  { value: "daily-plan", label: "每日计划" },
  { value: "stage-plan", label: "阶段计划" },
  { value: "daily-review", label: "每日复盘" },
  { value: "period-review", label: "阶段复盘" }
];

function reviewType(tab: PlanReviewTab): "daily" | "period" {
  return tab === "period-review" ? "period" : "daily";
}

function contentOf(value: Review["content"]): ReviewContent {
  return value && typeof value === "object" ? value : {};
}

function reviewDate(review: Review) {
  return review.period_start === review.period_end ? formatDate(review.period_start) : formatDate(review.period_start) + "—" + formatDate(review.period_end);
}

function previewOf(review: Review) {
  const text = contentOf(review.content).text;
  return typeof text === "string" && text.trim() ? text.replace(/\s+/g, " ").slice(0, 100) : "点击打开，开始记录复盘内容";
}

function statusTone(status: string): TagTone {
  if (status === "confirmed" || status === "finalized" || status === "done") return "success";
  if (status === "dropped" || status === "cancelled") return "danger";
  if (status === "active") return "info";
  return "neutral";
}

function statusLabel(status: string) {
  const labels: Record<string, string> = { draft: "草稿", confirmed: "已确认", executed: "已执行", planned: "计划中", active: "进行中", done: "已完成", dropped: "已放弃" };
  return labels[status] ?? status;
}

function planTextPreview(plan: DailyPlan) {
  const text = richTextToPlainText(String(plan.plan_text ?? "")).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 90) : "空白计划，点击日期开始填写";
}

export function PlansReviewsPage({ tab, onNavigate }: { tab: PlanReviewTab; onNavigate: (route: Route) => void }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [dailyPlans, setDailyPlans] = useState<DailyPlan[]>([]);
  const [stagePlans, setStagePlans] = useState<StagePlan[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayYmd());
  const [selectedPlan, setSelectedPlan] = useState<DailyPlanDetail | null>(null);
  const [planDraft, setPlanDraft] = useState("");
  const [selectedStage, setSelectedStage] = useState<StagePlan | null>(null);
  const [stageDraft, setStageDraft] = useState("");
  const [stagePlanStart, setStagePlanStart] = useState(todayYmd());
  const [stagePlanEnd, setStagePlanEnd] = useState(shiftYmd(todayYmd(), 6));
  const [reviewDateValue, setReviewDateValue] = useState(todayYmd());
  const [periodStart, setPeriodStart] = useState(todayYmd());
  const [periodEnd, setPeriodEnd] = useState(todayYmd());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      if (tab === "daily-plan") {
        const result = await apiJson<{ plans: DailyPlan[] }>("/plans");
        setDailyPlans(result.plans);
      } else if (tab === "stage-plan") {
        const result = await apiJson<{ stages: StagePlan[] }>("/stage-plans");
        setStagePlans(result.stages);
        const nextStage = selectedStage ? result.stages.find((stage) => stage.id === selectedStage.id) ?? null : result.stages[0] ?? null;
        setSelectedStage(nextStage);
        setStageDraft(String(nextStage?.plan_text ?? ""));
      } else {
        const result = await apiJson<{ reviews: Review[] }>("/reviews");
        setReviews(result.reviews);
      }
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "计划与复盘加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [tab]);

  async function createDailyPlan() {
    try {
      const result = await apiJson<DailyPlanDetail>("/plans", jsonRequest("POST", { plan_date: selectedDate }));
      setSelectedPlan(result);
      setPlanDraft(String(result.plan?.plan_text ?? ""));
      setMessage("空白每日计划已创建，可以直接填写");
      setTimeout(() => {
        document.getElementById("plan-editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日计划创建失败");
    }
  }

  async function openPlan(date: string) {
    try {
      const result = await apiJson<DailyPlanDetail>("/plans/" + encodeURIComponent(date));
      setSelectedDate(date);
      setSelectedPlan(result);
      setPlanDraft(String(result.plan?.plan_text ?? ""));
      setError(null);
      setTimeout(() => {
        document.getElementById("plan-editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日计划读取失败");
    }
  }

  async function savePlanText(date: string, text: string) {
    try {
      const result = await apiJson<DailyPlanDetail>("/plans/" + encodeURIComponent(date), jsonRequest("PATCH", { plan_text: text }));
      setSelectedPlan(result);
      setDailyPlans((current) => current.map((plan) => plan.plan_date === date ? { ...plan, ...(result.plan ?? {}) } : plan));
      setMessage("已自动保存");
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日计划保存失败");
    }
  }

  useEffect(() => {
    const plan = selectedPlan?.plan;
    if (!plan || planDraft === String(plan.plan_text ?? "")) return;
    const timer = window.setTimeout(() => void savePlanText(plan.plan_date, planDraft), 800);
    return () => window.clearTimeout(timer);
  }, [planDraft, selectedPlan?.plan?.plan_date, selectedPlan?.plan?.plan_text]);

  async function archiveDailyPlan(date: string) {
    try {
      await apiJson("/plans/" + encodeURIComponent(date) + "/archive", { method: "POST" });
      setDailyPlans((current) => current.filter((plan) => plan.plan_date !== date));
      if (selectedPlan?.plan?.plan_date === date) { setSelectedPlan(null); setPlanDraft(""); }
      setMessage("每日计划已归档");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日计划归档失败");
    }
  }

  async function deleteDailyPlan(date: string) {
    try {
      await apiJson("/plans/" + encodeURIComponent(date), { method: "DELETE" });
      setDailyPlans((current) => current.filter((plan) => plan.plan_date !== date));
      if (selectedPlan?.plan?.plan_date === date) { setSelectedPlan(null); setPlanDraft(""); }
      setMessage("每日计划已删除");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日计划删除失败");
    }
  }

  async function saveStagePlanText(id: string, text: string) {
    try {
      const result = await apiJson<{ plan: StagePlan }>("/stage-plans/" + encodeURIComponent(id), jsonRequest("PATCH", { plan_text: text }));
      setSelectedStage(result.plan);
      setStagePlans((current) => current.map((stage) => stage.id === id ? result.plan : stage));
      setMessage("已自动保存");
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "阶段计划保存失败");
    }
  }

  useEffect(() => {
    if (!selectedStage || stageDraft === String(selectedStage.plan_text ?? "")) return;
    const timer = window.setTimeout(() => void saveStagePlanText(selectedStage.id, stageDraft), 800);
    return () => window.clearTimeout(timer);
  }, [stageDraft, selectedStage?.id, selectedStage?.plan_text]);
  async function archiveStage(id: string) {
    try {
      await apiJson("/stage-plans/" + encodeURIComponent(id) + "/archive", { method: "POST" });
      setStagePlans((current) => current.filter((stage) => stage.id !== id));
      if (selectedStage?.id === id) { setSelectedStage(null); setStageDraft(""); }
      setMessage("阶段计划已归档");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "阶段计划归档失败");
    }
  }

  async function deleteStage(id: string) {
    try {
      await apiJson("/stage-plans/" + encodeURIComponent(id), { method: "DELETE" });
      setStagePlans((current) => current.filter((stage) => stage.id !== id));
      if (selectedStage?.id === id) { setSelectedStage(null); setStageDraft(""); }
      setMessage("阶段计划已删除");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "阶段计划删除失败");
    }
  }

  async function createStagePlan() {
    try {
      const result = await apiJson<{ plan: StagePlan }>("/stage-plans", jsonRequest("POST", { period_start: stagePlanStart, period_end: stagePlanEnd }));
      setSelectedStage(result.plan);
      setStageDraft(String(result.plan.plan_text ?? ""));
      setMessage("空白阶段计划已创建，可以直接填写");
      await load();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "阶段计划创建失败");
    }
  }

  async function createDailyReview() {
    try {
      const result = await apiJson<{ review: Review }>("/reviews/daily/" + encodeURIComponent(reviewDateValue) + "/generate", { method: "POST" });
      onNavigate({ name: "review", tab: "daily", id: result.review.id });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日复盘创建失败");
    }
  }

  async function createPeriodReview() {
    try {
      const result = await apiJson<{ review: Review }>("/reviews/period/generate", jsonRequest("POST", { period_start: periodStart, period_end: periodEnd }));
      onNavigate({ name: "review", tab: "period", id: result.review.id });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "阶段复盘创建失败");
    }
  }

  async function saveReviewStatus(review: Review, status: string) {
    try {
      const result = await apiJson<{ review: Review }>("/reviews/" + review.id, jsonRequest("PATCH", { status }));
      setReviews((current) => current.map((item) => item.id === review.id ? result.review : item));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘状态保存失败");
    }
  }

  async function deleteReview(id: string) {
    try {
      await apiJson("/reviews/" + id, { method: "DELETE" });
      setReviews((current) => current.filter((item) => item.id !== id));
      setMessage("复盘已删除");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘删除失败");
    }
  }

  const reviewsForTab = useMemo(() => reviews.filter((item) => item.review_type === reviewType(tab)).sort((left, right) => right.period_end.localeCompare(left.period_end)), [reviews, tab]);

  return (
    <div className="page-stack page-plans-reviews">
      <PageHeader meta={loading ? "读取中…" : undefined} title="计划与复盘">
        <SegmentedControl ariaLabel="计划与复盘类型" options={tabOptions} value={tab} onChange={(value) => onNavigate({ name: "plans", tab: value })} />
      </PageHeader>
      {error ? <div className="notice error">{error}</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      {tab === "daily-plan" ? <DailyPlanDatabase date={selectedDate} onDateChange={setSelectedDate} plans={dailyPlans} selected={selectedPlan} draft={planDraft} onDraftChange={setPlanDraft} onOpen={openPlan} onClose={() => setSelectedPlan(null)} onCreate={() => void createDailyPlan()} onArchive={(date) => void archiveDailyPlan(date)} onDelete={(date) => void deleteDailyPlan(date)} /> : null}
      {tab === "stage-plan" ? <StagePlanDatabase start={stagePlanStart} end={stagePlanEnd} onStartChange={setStagePlanStart} onEndChange={setStagePlanEnd} stages={stagePlans} selected={selectedStage} draft={stageDraft} onDraftChange={setStageDraft} onSelect={(stage) => { setSelectedStage(stage); setStageDraft(String(stage.plan_text ?? "")); setTimeout(() => { document.getElementById("stage-plan-editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50); }} onClose={() => setSelectedStage(null)} onCreate={() => void createStagePlan()} onArchive={(id) => void archiveStage(id)} onDelete={(id) => void deleteStage(id)} /> : null}
      {tab === "daily-review" || tab === "period-review" ? <ReviewDatabase tab={tab} reviews={reviewsForTab} dailyDate={reviewDateValue} periodStart={periodStart} periodEnd={periodEnd} onDailyDateChange={setReviewDateValue} onPeriodStartChange={setPeriodStart} onPeriodEndChange={setPeriodEnd} onCreateDaily={() => void createDailyReview()} onCreatePeriod={() => void createPeriodReview()} onStatus={(review, status) => void saveReviewStatus(review, status)} onDelete={(id) => void deleteReview(id)} onNavigate={onNavigate} /> : null}
    </div>
  );
}

function DailyPlanDatabase({ date, onDateChange, plans, selected, draft, onDraftChange, onOpen, onClose, onCreate, onArchive, onDelete }: {
  date: string;
  onDateChange: (value: string) => void;
  plans: DailyPlan[];
  selected: DailyPlanDetail | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onOpen: (date: string) => void;
  onClose: () => void;
  onCreate: () => void;
  onArchive: (date: string) => void;
  onDelete: (date: string) => void;
}) {
  return (
    <>
      <section className="quick-ledger plan-create-bar">
        <div className="form-row">
          <label className="form-field"><span>计划日期</span><DateField ariaLabel="每日计划日期" value={date} onChange={onDateChange} /></label>
          <button className="primary-button align-end" onClick={onCreate} type="button">新建空白计划</button>
        </div>
        <p className="helper-text plan-manual-hint">计划只保存你在这里填写的内容，不会自动拉取任务。</p>
      </section>
      {selected?.plan ? <section className="plan-inline-preview plan-editor-panel panel" id="plan-editor-panel">
        <div className="panel-heading">
          <div>
            <h2>{formatDate(selected.plan.plan_date)} · 每日计划</h2>
            <span className="muted">停止编辑约 0.8 秒后自动保存</span>
          </div>
          <div className="plan-editor-actions">
            <Tag tone={statusTone(selected.plan.status)}>{statusLabel(selected.plan.status)}</Tag>
            <button className="secondary-button" onClick={onClose} type="button">收起编辑</button>
          </div>
        </div>
        <div className="plan-rich-editor"><RichTextBlockEditor blockAriaLabel="每日计划内容块" value={draft} onChange={onDraftChange} /><p className="plan-editor-hint">输入 / 可插入标题、待办、列表和引用；一级、二级标题会自动调整字号。</p></div>
      </section> : null}
      <section className="table-panel plan-database-panel">
        <DatabaseTable
          empty="还没有每日计划，选择日期后新建一份空白计划。"
          rows={plans}
          columns={[
            { key: "date", label: "日期", className: "col-plan-date", render: (plan) => <button className="plan-open-button" onClick={() => onOpen(plan.plan_date)} type="button">{formatDate(plan.plan_date)}</button> },
            { key: "content", label: "计划内容", className: "col-plan-content", render: (plan) => <button className="plan-preview-button" onClick={() => onOpen(plan.plan_date)} type="button">{planTextPreview(plan)}</button> },
            { key: "status", label: "状态", className: "col-plan-status", render: (plan) => <Tag tone={statusTone(plan.status)}>{statusLabel(plan.status)}</Tag> },
            { key: "updated", label: "最近修改", className: "col-plan-updated", render: (plan) => <span className="plan-updated-time">{plan.updated_at ? String(plan.updated_at).slice(0, 16).replace("T", " ") : "—"}</span> },
            { key: "actions", label: "操作", className: "col-plan-actions", render: (plan) => <span className="table-actions"><button className="text-link" onClick={() => onOpen(plan.plan_date)} type="button">编辑</button><button className="text-link" onClick={() => onArchive(plan.plan_date)} type="button">归档</button><DeleteButton label={`删除每日计划 ${formatDate(plan.plan_date)}`} onClick={() => onDelete(plan.plan_date)} /></span> }
          ]}
        />
      </section>
    </>
  );
}

function StagePlanDatabase({ start, end, onStartChange, onEndChange, stages, selected, draft, onDraftChange, onSelect, onClose, onCreate, onArchive, onDelete }: {
  start: string;
  end: string;
  onStartChange: (value: string) => void;
  onEndChange: (value: string) => void;
  stages: StagePlan[];
  selected: StagePlan | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSelect: (stage: StagePlan) => void;
  onClose: () => void;
  onCreate: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <>
      <section className="quick-ledger plan-create-bar">
        <div className="form-row">
          <label className="form-field"><span>开始日期</span><DateField ariaLabel="阶段计划开始日期" value={start} onChange={onStartChange} /></label>
          <label className="form-field"><span>结束日期</span><DateField ariaLabel="阶段计划结束日期" value={end} onChange={onEndChange} /></label>
          <button className="primary-button align-end" onClick={onCreate} type="button">新建阶段计划</button>
        </div>
        <p className="helper-text plan-manual-hint">阶段计划按一个时间周期记录，例如一周；它独立于项目、任务和复盘。</p>
      </section>
      {selected ? <section className="plan-inline-preview plan-editor-panel panel" id="stage-plan-editor-panel">
        <div className="panel-heading">
          <div>
            <h2>{formatDate(selected.period_start)}—{formatDate(selected.period_end)} · 阶段计划</h2>
            <span className="muted">停止编辑约 0.8 秒后自动保存</span>
          </div>
          <div className="plan-editor-actions">
            <Tag tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Tag>
            <button className="secondary-button" onClick={onClose} type="button">收起编辑</button>
          </div>
        </div>
        <div className="plan-rich-editor"><RichTextBlockEditor blockAriaLabel="阶段计划内容块" value={draft} onChange={onDraftChange} /><p className="plan-editor-hint">输入 / 可插入标题、待办、列表和引用；一级、二级标题会自动调整字号。</p></div>
      </section> : null}
      <section className="table-panel plan-database-panel">
        <DatabaseTable
          empty="还没有阶段计划，请先设置周期后新建一份空白计划。"
          rows={stages}
          columns={[
            { key: "period", label: "计划周期", className: "col-plan-date", render: (stage) => <button className="plan-open-button" onClick={() => onSelect(stage)} type="button">{formatDate(stage.period_start)}—{formatDate(stage.period_end)}</button> },
            { key: "content", label: "计划内容", className: "col-plan-content", render: (stage) => <button className="plan-preview-button" onClick={() => onSelect(stage)} type="button">{planTextPreview({ plan_text: stage.plan_text } as DailyPlan)}</button> },
            { key: "status", label: "状态", className: "col-plan-status", render: (stage) => <Tag tone={statusTone(stage.status)}>{statusLabel(stage.status)}</Tag> },
            { key: "updated", label: "最近修改", className: "col-plan-updated", render: (stage) => <span className="plan-updated-time">{stage.updated_at ? String(stage.updated_at).slice(0, 16).replace("T", " ") : "—"}</span> },
            { key: "actions", label: "操作", className: "col-plan-actions", render: (stage) => <span className="table-actions"><button className="text-link" onClick={() => onSelect(stage)} type="button">编辑</button><button className="text-link" onClick={() => onArchive(stage.id)} type="button">归档</button><DeleteButton label={"删除阶段计划 " + formatDate(stage.period_start) + "至" + formatDate(stage.period_end)} onClick={() => onDelete(stage.id)} /></span> }
          ]}
        />
      </section>
    </>
  );
}

function ReviewDatabase({ tab, reviews, dailyDate, periodStart, periodEnd, onDailyDateChange, onPeriodStartChange, onPeriodEndChange, onCreateDaily, onCreatePeriod, onStatus, onDelete, onNavigate }: {
  tab: "daily-review" | "period-review";
  reviews: Review[];
  dailyDate: string;
  periodStart: string;
  periodEnd: string;
  onDailyDateChange: (value: string) => void;
  onPeriodStartChange: (value: string) => void;
  onPeriodEndChange: (value: string) => void;
  onCreateDaily: () => void;
  onCreatePeriod: () => void;
  onStatus: (review: Review, status: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (route: Route) => void;
}) {
  const isDaily = tab === "daily-review";
  return (
    <>
      <section className="quick-ledger review-create-bar">
        {isDaily ? <div className="form-row"><label className="form-field"><span>日期</span><DateField ariaLabel="每日复盘日期" value={dailyDate} onChange={onDailyDateChange} /></label><button className="primary-button align-end" onClick={onCreateDaily} type="button">打开每日复盘</button></div> : <div className="form-row"><label className="form-field"><span>开始日期</span><DateField ariaLabel="阶段复盘开始日期" value={periodStart} onChange={onPeriodStartChange} /></label><label className="form-field"><span>结束日期</span><DateField ariaLabel="阶段复盘结束日期" value={periodEnd} onChange={onPeriodEndChange} /></label><button className="primary-button align-end" onClick={onCreatePeriod} type="button">新建阶段复盘</button></div>}
      </section>
      <section className="table-panel review-list-panel review-list-only">
        <DatabaseTable
          empty="还没有复盘记录。"
          rows={reviews}
          columns={[
            { key: "date", label: "日期", className: "col-review-date", render: (review) => <button className="review-open-button" onClick={() => onNavigate({ name: "review", tab: reviewType(tab), id: review.id })} type="button">{reviewDate(review)}</button> },
            { key: "status", label: "状态", className: "col-review-status", render: (review) => <PropertySelect ariaLabel="复盘状态" options={[{ value: "draft", label: "草稿" }, { value: "finalized", label: "已完成" }]} tone={review.status === "finalized" ? "success" : "neutral"} value={review.status === "finalized" ? "finalized" : "draft"} onChange={(value) => onStatus(review, value)} /> },
            { key: "content", label: "内容", className: "col-review-content", render: (review) => <button className="review-preview-button" onClick={() => onNavigate({ name: "review", tab: reviewType(tab), id: review.id })} type="button">{previewOf(review)}</button> },
            { key: "actions", label: "操作", className: "col-actions", render: (review) => <span className="table-actions"><button className="text-link" onClick={() => onNavigate({ name: "review", tab: reviewType(tab), id: review.id })} type="button">编辑</button><DeleteButton label="删除复盘" onClick={() => onDelete(review.id)} /></span> }
          ]}
        />
      </section>
    </>
  );
}




