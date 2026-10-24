import { useEffect, useMemo, useState } from "react";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { DateField } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { RichTextBlockEditor, richTextToPlainText } from "../components/RichTextBlockEditor.js";
import { PlanRichText } from "../components/ReadOnlyPlanCard.js";
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
  const [selectedReview, setSelectedReview] = useState<Review | null>(null);
  const [reviewDraft, setReviewDraft] = useState("");
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
        if (result.plans.length > 0 && !selectedPlan) {
          void openPlan(result.plans[0].plan_date);
        }
      } else if (tab === "stage-plan") {
        const result = await apiJson<{ stages: StagePlan[] }>("/stage-plans");
        setStagePlans(result.stages);
        const nextStage = selectedStage ? result.stages.find((stage) => stage.id === selectedStage.id) ?? result.stages[0] ?? null : result.stages[0] ?? null;
        setSelectedStage(nextStage);
        setStageDraft(String(nextStage?.plan_text ?? ""));
      } else {
        const result = await apiJson<{ reviews: Review[] }>("/reviews");
        setReviews(result.reviews);
        const currentTypeReviews = result.reviews
          .filter((item) => item.review_type === reviewType(tab))
          .sort((left, right) => right.period_end.localeCompare(left.period_end));
        const nextReview = selectedReview && selectedReview.review_type === reviewType(tab)
          ? currentTypeReviews.find((r) => r.id === selectedReview.id) ?? currentTypeReviews[0] ?? null
          : currentTypeReviews[0] ?? null;
        setSelectedReview(nextReview);
        setReviewDraft(String(contentOf(nextReview?.content).text ?? ""));
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
      setReviews((current) => {
        const exists = current.some((r) => r.id === result.review.id);
        return exists ? current.map((r) => r.id === result.review.id ? result.review : r) : [result.review, ...current];
      });
      setSelectedReview(result.review);
      setReviewDraft(String(contentOf(result.review.content).text ?? ""));
      setMessage("每日复盘草案已生成");
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日复盘创建失败");
    }
  }

  async function createPeriodReview() {
    try {
      const result = await apiJson<{ review: Review }>("/reviews/period/generate", jsonRequest("POST", { period_start: periodStart, period_end: periodEnd }));
      setReviews((current) => {
        const exists = current.some((r) => r.id === result.review.id);
        return exists ? current.map((r) => r.id === result.review.id ? result.review : r) : [result.review, ...current];
      });
      setSelectedReview(result.review);
      setReviewDraft(String(contentOf(result.review.content).text ?? ""));
      setMessage("阶段复盘草案已生成");
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "阶段复盘创建失败");
    }
  }

  async function saveReviewText(id: string, text: string) {
    try {
      const current = selectedReview?.id === id ? selectedReview : reviews.find((r) => r.id === id);
      if (!current || current.status === "finalized") return;
      const currentContent = contentOf(current.content);
      const result = await apiJson<{ review: Review }>(
        "/reviews/" + encodeURIComponent(id),
        jsonRequest("PATCH", { content: { ...currentContent, text } })
      );
      setSelectedReview(result.review);
      setReviews((all) => all.map((r) => r.id === id ? result.review : r));
      setMessage("已自动保存");
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘保存失败");
    }
  }

  useEffect(() => {
    if (!selectedReview || selectedReview.status === "finalized" || reviewDraft === String(contentOf(selectedReview.content).text ?? "")) return;
    const timer = window.setTimeout(() => void saveReviewText(selectedReview.id, reviewDraft), 800);
    return () => window.clearTimeout(timer);
  }, [reviewDraft, selectedReview?.id, selectedReview?.content, selectedReview?.status]);

  async function finalizeReview(id: string) {
    try {
      const result = await apiJson<{ review: Review }>("/reviews/" + encodeURIComponent(id) + "/finalize", { method: "POST" });
      setReviews((current) => current.map((r) => r.id === id ? result.review : r));
      if (selectedReview?.id === id) {
        setSelectedReview(result.review);
      }
      setMessage("复盘已确认完成并归档");
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘确认失败");
    }
  }

  async function deleteReview(id: string) {
    try {
      await apiJson("/reviews/" + encodeURIComponent(id), { method: "DELETE" });
      const nextReviews = reviews.filter((item) => item.id !== id);
      setReviews(nextReviews);
      if (selectedReview?.id === id) {
        const nextForTab = nextReviews.filter((r) => r.review_type === reviewType(tab));
        setSelectedReview(nextForTab[0] ?? null);
        setReviewDraft(String(contentOf(nextForTab[0]?.content).text ?? ""));
      }
      setMessage("复盘已删除");
      setError(null);
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
      {tab === "daily-review" || tab === "period-review" ? (
        <ReviewDatabase
          tab={tab}
          reviews={reviewsForTab}
          selected={selectedReview}
          draft={reviewDraft}
          onDraftChange={setReviewDraft}
          onSelect={(review) => {
            setSelectedReview(review);
            setReviewDraft(String(contentOf(review.content).text ?? ""));
          }}
          dailyDate={reviewDateValue}
          periodStart={periodStart}
          periodEnd={periodEnd}
          onDailyDateChange={setReviewDateValue}
          onPeriodStartChange={setPeriodStart}
          onPeriodEndChange={setPeriodEnd}
          onCreateDaily={() => void createDailyReview()}
          onCreatePeriod={() => void createPeriodReview()}
          onFinalize={(id) => void finalizeReview(id)}
          onDelete={(id) => void deleteReview(id)}
        />
      ) : null}
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
  const [viewMode, setViewMode] = useState<"read" | "edit">("read");

  return (
    <div className="editorial-split-layout">
      <aside className="editorial-sidebar">
        <div className="editorial-create-box">
          <div className="create-box-row">
            <DateField ariaLabel="每日计划日期" value={date} onChange={onDateChange} />
            <button className="primary-button create-btn" onClick={onCreate} type="button">+ 新建</button>
          </div>
          <p className="create-box-hint">记录今日战略主线与执行切片</p>
        </div>

        <div className="editorial-nav-list" role="tablist" aria-label="每日计划列表">
          {plans.length === 0 ? (
            <div className="editorial-nav-empty">暂无每日计划，请在上方新建</div>
          ) : (
            plans.map((plan) => {
              const isSelected = selected?.plan?.plan_date === plan.plan_date;
              return (
                <div
                  key={plan.plan_date}
                  className={`editorial-card-item ${isSelected ? "is-active" : ""}`}
                  onClick={() => onOpen(plan.plan_date)}
                >
                  <div className="card-item-top">
                    <span className="card-item-date">{formatDate(plan.plan_date)}</span>
                    <Tag tone={statusTone(plan.status)}>{statusLabel(plan.status)}</Tag>
                  </div>
                  <p className="card-item-snippet">{planTextPreview(plan)}</p>
                  <div className="card-item-footer">
                    <span className="card-item-time">
                      {plan.updated_at ? String(plan.updated_at).slice(5, 16).replace("T", " ") : "未保存"}
                    </span>
                    <div className="card-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="card-action-btn"
                        onClick={() => onArchive(plan.plan_date)}
                        title="归档计划"
                      >
                        归档
                      </button>
                      <DeleteButton
                        label={`删除每日计划 ${formatDate(plan.plan_date)}`}
                        onClick={() => onDelete(plan.plan_date)}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <main className="editorial-canvas">
        {selected?.plan ? (
          <div className="editorial-canvas-inner">
            <header className="canvas-header">
              <div className="canvas-title-group">
                <h2 className="canvas-title">{formatDate(selected.plan.plan_date)} · 每日计划</h2>
                <div className="canvas-meta-row">
                  <span className="auto-save-pill">● 自动保存就绪</span>
                  <Tag tone={statusTone(selected.plan.status)}>{statusLabel(selected.plan.status)}</Tag>
                </div>
              </div>
              <div className="canvas-actions">
                <div className="view-mode-toggle" role="radiogroup" aria-label="阅读与编辑视图切换">
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "read" ? "active" : ""}`}
                    onClick={() => setViewMode("read")}
                  >
                    ✨ 阅读视图
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "edit" ? "active" : ""}`}
                    onClick={() => setViewMode("edit")}
                  >
                    ✍️ 编辑视图
                  </button>
                </div>
              </div>
            </header>

            <div className="canvas-body">
              {viewMode === "read" ? (
                draft.trim() ? (
                  <PlanRichText value={draft} />
                ) : (
                  <div className="canvas-empty-state">
                    <p className="empty-title">这是一份空白计划</p>
                    <p className="empty-desc">点击右上角「✍️ 编辑视图」开始书写你的每日主线与行动清单</p>
                    <button type="button" className="secondary-button" onClick={() => setViewMode("edit")}>
                      ✍️ 切换到编辑视图
                    </button>
                  </div>
                )
              ) : (
                <div className="canvas-editor-wrap">
                  <RichTextBlockEditor blockAriaLabel="每日计划内容块" value={draft} onChange={onDraftChange} />
                  <p className="plan-editor-hint">输入 / 可插入标题、待办、列表和引用；一级、二级标题会自动调整字号。</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="canvas-unselected">
            <div className="unselected-icon">📄</div>
            <h3>请选择或新建一份计划</h3>
            <p>在左侧选择一份历史计划进行查看与编辑，或点击上方「新建」开始制定。</p>
          </div>
        )}
      </main>
    </div>
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
  const [viewMode, setViewMode] = useState<"read" | "edit">("read");

  return (
    <div className="editorial-split-layout">
      <aside className="editorial-sidebar">
        <div className="editorial-create-box">
          <div className="create-box-row stage-dates-row">
            <DateField ariaLabel="阶段计划开始日期" value={start} onChange={onStartChange} />
            <span className="date-sep">—</span>
            <DateField ariaLabel="阶段计划结束日期" value={end} onChange={onEndChange} />
          </div>
          <button className="primary-button create-btn full-width" onClick={onCreate} type="button">
            + 新建阶段计划
          </button>
          <p className="create-box-hint">周周期定战略与指标，承接复盘输入</p>
        </div>

        <div className="editorial-nav-list" role="tablist" aria-label="阶段计划列表">
          {stages.length === 0 ? (
            <div className="editorial-nav-empty">暂无阶段计划，请在上方新建</div>
          ) : (
            stages.map((stage) => {
              const isSelected = selected?.id === stage.id;
              return (
                <div
                  key={stage.id}
                  className={`editorial-card-item ${isSelected ? "is-active" : ""}`}
                  onClick={() => onSelect(stage)}
                >
                  <div className="card-item-top">
                    <span className="card-item-date">{formatDate(stage.period_start)}—{formatDate(stage.period_end)}</span>
                    <Tag tone={statusTone(stage.status)}>{statusLabel(stage.status)}</Tag>
                  </div>
                  <p className="card-item-snippet">{planTextPreview({ plan_text: stage.plan_text } as DailyPlan)}</p>
                  <div className="card-item-footer">
                    <span className="card-item-time">
                      {stage.updated_at ? String(stage.updated_at).slice(5, 16).replace("T", " ") : "未保存"}
                    </span>
                    <div className="card-item-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="card-action-btn"
                        onClick={() => onArchive(stage.id)}
                        title="归档计划"
                      >
                        归档
                      </button>
                      <DeleteButton
                        label={`删除阶段计划 ${formatDate(stage.period_start)}至${formatDate(stage.period_end)}`}
                        onClick={() => onDelete(stage.id)}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <main className="editorial-canvas">
        {selected ? (
          <div className="editorial-canvas-inner">
            <header className="canvas-header">
              <div className="canvas-title-group">
                <h2 className="canvas-title">
                  {formatDate(selected.period_start)}—{formatDate(selected.period_end)} · 阶段计划
                </h2>
                <div className="canvas-meta-row">
                  <span className="auto-save-pill">● 自动保存就绪</span>
                  <Tag tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Tag>
                </div>
              </div>
              <div className="canvas-actions">
                <div className="view-mode-toggle" role="radiogroup" aria-label="阅读与编辑视图切换">
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "read" ? "active" : ""}`}
                    onClick={() => setViewMode("read")}
                  >
                    ✨ 阅读视图
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "edit" ? "active" : ""}`}
                    onClick={() => setViewMode("edit")}
                  >
                    ✍️ 编辑视图
                  </button>
                </div>
              </div>
            </header>

            <div className="canvas-body">
              {viewMode === "read" ? (
                draft.trim() ? (
                  <PlanRichText value={draft} />
                ) : (
                  <div className="canvas-empty-state">
                    <p className="empty-title">这是一份空白阶段计划</p>
                    <p className="empty-desc">点击右上角「✍️ 编辑视图」开始书写四大板块指标与项目推进节点</p>
                    <button type="button" className="secondary-button" onClick={() => setViewMode("edit")}>
                      ✍️ 切换到编辑视图
                    </button>
                  </div>
                )
              ) : (
                <div className="canvas-editor-wrap">
                  <RichTextBlockEditor blockAriaLabel="阶段计划内容块" value={draft} onChange={onDraftChange} />
                  <p className="plan-editor-hint">输入 / 可插入标题、待办、列表和引用；一级、二级标题会自动调整字号。</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="canvas-unselected">
            <div className="unselected-icon">🎯</div>
            <h3>请选择或新建一份阶段计划</h3>
            <p>在左侧选择一份阶段计划进行查看与编辑，或在上方新建。</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ReviewDatabase({
  tab,
  reviews,
  selected,
  draft,
  onDraftChange,
  onSelect,
  dailyDate,
  periodStart,
  periodEnd,
  onDailyDateChange,
  onPeriodStartChange,
  onPeriodEndChange,
  onCreateDaily,
  onCreatePeriod,
  onFinalize,
  onDelete
}: {
  tab: "daily-review" | "period-review";
  reviews: Review[];
  selected: Review | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSelect: (review: Review) => void;
  dailyDate: string;
  periodStart: string;
  periodEnd: string;
  onDailyDateChange: (value: string) => void;
  onPeriodStartChange: (value: string) => void;
  onPeriodEndChange: (value: string) => void;
  onCreateDaily: () => void;
  onCreatePeriod: () => void;
  onFinalize: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isDaily = tab === "daily-review";
  const [viewMode, setViewMode] = useState<"read" | "edit">("read");

  return (
    <div className="editorial-split-layout">
      <aside className="editorial-sidebar">
        <div className="editorial-create-box">
          {isDaily ? (
            <>
              <div className="create-box-row">
                <DateField ariaLabel="每日复盘日期" value={dailyDate} onChange={onDailyDateChange} />
                <button className="primary-button create-btn" onClick={onCreateDaily} type="button">+ 新建</button>
              </div>
              <p className="create-box-hint">盘点今日底盘指标与任务执行情况</p>
            </>
          ) : (
            <>
              <div className="create-box-row" style={{ flexDirection: "column", gap: "6px" }}>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <DateField ariaLabel="阶段复盘开始日期" value={periodStart} onChange={onPeriodStartChange} />
                  <span style={{ color: "var(--ink-3)", fontSize: "12px" }}>至</span>
                  <DateField ariaLabel="阶段复盘结束日期" value={periodEnd} onChange={onPeriodEndChange} />
                </div>
                <button className="primary-button create-btn" style={{ width: "100%" }} onClick={onCreatePeriod} type="button">+ 新建阶段复盘</button>
              </div>
              <p className="create-box-hint">拉平周期客观全景与推进大盘</p>
            </>
          )}
        </div>

        <div className="editorial-nav-list" role="tablist" aria-label="复盘列表">
          {reviews.length === 0 ? (
            <div className="editorial-nav-empty">暂无{isDaily ? "每日" : "阶段"}复盘记录，请在上方新建</div>
          ) : (
            reviews.map((review) => {
              const isSelected = selected?.id === review.id;
              const isFinalized = review.status === "finalized";
              return (
                <div
                  key={review.id}
                  className={`editorial-card-item ${isSelected ? "is-active" : ""}`}
                  onClick={() => onSelect(review)}
                >
                  <div className="card-item-top">
                    <span className="card-item-date">{reviewDate(review)}</span>
                    <Tag tone={isFinalized ? "success" : "neutral"}>
                      {isFinalized ? "已完成" : "草稿"}
                    </Tag>
                  </div>
                  <p className="card-item-snippet">{previewOf(review)}</p>
                  <div className="card-item-footer">
                    <span className="card-item-time">
                      {review.period_end ? formatDate(review.period_end) : ""}
                    </span>
                    <div className="card-item-actions" onClick={(e) => e.stopPropagation()}>
                      <DeleteButton
                        label={`删除复盘 ${reviewDate(review)}`}
                        onClick={() => onDelete(review.id)}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <main className="editorial-canvas">
        {selected ? (
          <div className="editorial-canvas-inner">
            <header className="canvas-header">
              <div className="canvas-title-group">
                <h2 className="canvas-title">
                  {reviewDate(selected)} · {isDaily ? "每日复盘" : "阶段复盘"}
                </h2>
                <div className="canvas-meta-row">
                  {selected.status === "finalized" ? (
                    <Tag tone="success">已完成</Tag>
                  ) : (
                    <>
                      <span className="auto-save-pill">● 自动保存就绪</span>
                      <Tag tone="neutral">草稿</Tag>
                      <button
                        type="button"
                        className="finalize-action-btn"
                        onClick={() => onFinalize(selected.id)}
                        title="完成并锁定本次复盘"
                      >
                        ✓ 标记为已完成
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="canvas-actions">
                <div className="view-mode-toggle" role="radiogroup" aria-label="阅读与编辑视图切换">
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "read" ? "active" : ""}`}
                    onClick={() => setViewMode("read")}
                  >
                    ✨ 阅读视图
                  </button>
                  <button
                    type="button"
                    className={`toggle-btn ${viewMode === "edit" ? "active" : ""}`}
                    onClick={() => setViewMode("edit")}
                  >
                    ✍️ 编辑视图
                  </button>
                </div>
              </div>
            </header>

            <div className="canvas-body">
              {viewMode === "read" ? (
                draft.trim() ? (
                  <PlanRichText value={draft} />
                ) : (
                  <div className="canvas-empty-state">
                    <p className="empty-title">这是一份空白复盘记录</p>
                    <p className="empty-desc">点击右上角「✍️ 编辑视图」开始书写客观事实盘点与管家总评</p>
                    <button type="button" className="secondary-button" onClick={() => setViewMode("edit")}>
                      ✍️ 切换到编辑视图
                    </button>
                  </div>
                )
              ) : (
                <div className="canvas-editor-wrap">
                  <RichTextBlockEditor blockAriaLabel="复盘内容块" value={draft} onChange={onDraftChange} />
                  <p className="plan-editor-hint">输入 / 可插入标题、待办、列表和引用；一级、二级标题会自动调整字号。</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="canvas-unselected">
            <div className="unselected-icon">📋</div>
            <h3>请选择或新建一份复盘</h3>
            <p>在左侧选择一份历史复盘进行查看与编辑，或在上方新建。</p>
          </div>
        )}
      </main>
    </div>
  );
}




