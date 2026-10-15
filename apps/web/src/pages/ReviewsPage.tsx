import { useEffect, useState } from "react";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { DateField } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { PropertySelect } from "../components/PropertySelect.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { formatDate, todayYmd } from "../lib/dates.js";
import type { Route } from "../lib/route.js";

type ReviewContent = { text?: string; facts?: { tasks?: { total?: number; completed?: number; overdue?: number; open?: number }; finance?: { expensesCents?: number; incomesCents?: number }; distinction?: string }; data?: { tasks?: { total?: number; completed?: number }; finance?: { expensesCents?: number; incomesCents?: number }; health?: unknown } } & Record<string, unknown>;
type Review = { id: string; review_type: "daily" | "period" | string; period_start: string; period_end: string; status: string; content?: ReviewContent };

function contentOf(value: Review["content"]): ReviewContent {
  return value && typeof value === "object" ? value : {};
}

function reviewTypeLabel(type: string) {
  return type === "period" ? "阶段复盘" : "每日复盘";
}

function reviewDate(review: Review) {
  return review.period_start === review.period_end ? formatDate(review.period_start) : `${formatDate(review.period_start)}—${formatDate(review.period_end)}`;
}

function previewOf(review: Review) {
  const text = contentOf(review.content).text;
  return typeof text === "string" && text.trim() ? text.replace(/\s+/g, " ").slice(0, 100) : "点击打开，开始记录复盘内容";
}

export function ReviewsPage({ tab, onNavigate }: { tab: "daily" | "period"; onNavigate: (route: Route) => void }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [date, setDate] = useState(todayYmd());
  const [start, setStart] = useState(todayYmd());
  const [end, setEnd] = useState(todayYmd());
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const result = await apiJson<{ reviews: Review[] }>("/reviews");
      setReviews(result.reviews);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘加载失败");
    }
  }

  useEffect(() => { void load(); }, []);

  async function createDaily() {
    try {
      const result = await apiJson<{ review: Review }>(`/reviews/daily/${date}/generate`, { method: "POST" });
      setMessage("已打开每日复盘");
      onNavigate({ name: "review", tab: "daily", id: result.review.id });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "每日复盘创建失败");
    }
  }

  async function createPeriod() {
    try {
      const result = await apiJson<{ review: Review }>("/reviews/period/generate", jsonRequest("POST", { period_start: start, period_end: end }));
      setMessage("已创建阶段复盘");
      onNavigate({ name: "review", tab: "period", id: result.review.id });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "阶段复盘创建失败");
    }
  }

  async function saveStatus(review: Review, status: string) {
    try {
      const result = await apiJson<{ review: Review }>(`/reviews/${review.id}`, jsonRequest("PATCH", { status }));
      setReviews((current) => current.map((item) => item.id === review.id ? result.review : item));
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘状态保存失败");
    }
  }

  async function deleteReview(id: string) {
    try {
      await apiJson(`/reviews/${id}`, { method: "DELETE" });
      setReviews((current) => current.filter((item) => item.id !== id));
      setMessage("复盘已删除");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘删除失败");
    }
  }

  const visibleReviews = reviews.filter((review) => review.review_type === tab).sort((left, right) => right.period_end.localeCompare(left.period_end));
  return (
    <div className="page-stack page-reviews">
      <PageHeader meta="每条复盘独立打开，内容自动保存" title="复盘">
        <SegmentedControl ariaLabel="复盘类型" options={[{ value: "daily", label: "每日复盘" }, { value: "period", label: "阶段复盘" }]} value={tab} onChange={(value) => onNavigate({ name: "reviews", tab: value })} />
      </PageHeader>
      {error ? <div className="notice error">{error}</div> : null}
      {message ? <div className="notice">{message}</div> : null}
      <section className="quick-ledger review-create-bar">
        {tab === "daily"
          ? <div className="form-row"><label className="form-field"><span>日期</span><DateField ariaLabel="每日复盘日期" value={date} onChange={setDate} /></label><button className="primary-button align-end" onClick={() => void createDaily()} type="button">打开每日复盘</button></div>
          : <div className="form-row"><label className="form-field"><span>开始日期</span><DateField ariaLabel="阶段复盘开始日期" value={start} onChange={setStart} /></label><label className="form-field"><span>结束日期</span><DateField ariaLabel="阶段复盘结束日期" value={end} onChange={setEnd} /></label><button className="primary-button align-end" onClick={() => void createPeriod()} type="button">新建阶段复盘</button></div>}
      </section>
      <section className="table-panel review-list-panel review-list-only">
        <div className="finance-table-heading"><div><h2>{reviewTypeLabel(tab)}</h2><span className="page-meta">{visibleReviews.length} 条</span></div></div>
        <DatabaseTable
          empty="还没有复盘记录。"
          rows={visibleReviews}
          columns={[
            { key: "date", label: "日期", className: "col-review-date", render: (review) => <button className="review-open-button" onClick={() => onNavigate({ name: "review", tab, id: review.id })} type="button">{reviewDate(review)}</button> },
            { key: "status", label: "状态", className: "col-review-status", render: (review) => <PropertySelect ariaLabel="复盘状态" options={[{ value: "draft", label: "草稿" }, { value: "finalized", label: "已完成" }]} tone={review.status === "finalized" ? "success" : "neutral"} value={review.status === "finalized" ? "finalized" : "draft"} onChange={(value) => void saveStatus(review, value)} /> },
            { key: "content", label: "内容", className: "col-review-content", render: (review) => <button className="review-preview-button" onClick={() => onNavigate({ name: "review", tab, id: review.id })} type="button">{previewOf(review)}</button> },
            { key: "actions", label: "操作", className: "col-actions", render: (review) => <span className="table-actions"><button className="text-link" onClick={() => onNavigate({ name: "review", tab, id: review.id })} type="button">编辑</button><DeleteButton label="删除复盘" onClick={() => void deleteReview(review.id)} /></span> }
          ]}
        />
      </section>
    </div>
  );
}

export function ReviewDetailPage({ id, tab, onNavigate }: { id: string; tab: "daily" | "period"; onNavigate: (route: Route) => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [draft, setDraft] = useState("");
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadedId(null);
    apiJson<{ review: Review }>(`/reviews/${encodeURIComponent(id)}`)
      .then((result) => {
        if (!active) return;
        setReview(result.review);
        setDraft(String(contentOf(result.review.content).text ?? ""));
        setLoadedId(result.review.id);
        setError(null);
      })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "复盘加载失败"); });
    return () => { active = false; };
  }, [id]);

  async function save(nextText = draft, status?: string) {
    if (!review || review.status === "finalized") return;
    setSaving(true);
    try {
      const nextContent = { ...contentOf(review.content), text: nextText };
      const result = await apiJson<{ review: Review }>(`/reviews/${review.id}`, jsonRequest("PATCH", { content: nextContent, ...(status ? { status } : {}) }));
      setReview(result.review);
      setMessage("已自动保存");
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "复盘保存失败");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!review || loadedId !== review.id || review.status === "finalized" || draft === String(contentOf(review.content).text ?? "")) return;
    const timer = window.setTimeout(() => void save(draft), 800);
    return () => window.clearTimeout(timer);
  }, [draft, review, loadedId]);

  if (error && !review) return <div className="page-stack page-reviews"><div className="notice error">{error}</div><button className="secondary-button" onClick={() => onNavigate({ name: "plans", tab: tab === "daily" ? "daily-review" : "period-review" })} type="button">返回计划与复盘</button></div>;
  if (!review) return <div className="page-stack page-reviews"><div className="database-empty">正在打开复盘…</div></div>;

  return <div className="page-stack page-review-detail">
    <button className="back-link" onClick={() => onNavigate({ name: "plans", tab: tab === "daily" ? "daily-review" : "period-review" })} type="button">← 返回计划与复盘</button>
    <section className="review-detail-card">
      <div className="review-detail-header"><div><p className="eyebrow">{reviewTypeLabel(review.review_type)}</p><h1>{reviewDate(review)}</h1></div><div className="review-detail-status"><PropertySelect ariaLabel="复盘状态" options={[{ value: "draft", label: "草稿" }, { value: "finalized", label: "已完成" }]} tone={review.status === "finalized" ? "success" : "neutral"} value={review.status === "finalized" ? "finalized" : "draft"} onChange={(value) => void save(draft, value)} /><span className="helper-text">{saving ? "保存中…" : review.status === "finalized" ? "已锁定" : "停止编辑后自动保存"}</span></div></div>
      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="notice error">{error}</div> : null}
      {contentOf(review.content).facts?.tasks ? (
        <div className="review-facts">
          {`客观数据：任务 ${contentOf(review.content).facts?.tasks?.completed ?? 0}/${contentOf(review.content).facts?.tasks?.total ?? 0} 完成，逾期 ${contentOf(review.content).facts?.tasks?.overdue ?? 0}。支出 ${((contentOf(review.content).facts?.finance?.expensesCents ?? 0) / 100).toFixed(2)} 元。\n${contentOf(review.content).facts?.distinction ?? "分析部分必须区分事实和推测，不能把可能相关说成因果。"}`}
        </div>
      ) : null}
      <label className="form-field review-detail-field"><span>复盘内容</span><textarea className="review-editor review-editor-full" disabled={review.status === "finalized"} onChange={(event) => setDraft(event.target.value)} placeholder="记录今天发生了什么、完成了什么，以及下一步准备做什么" value={draft} /></label>
    </section>
  </div>;
}


