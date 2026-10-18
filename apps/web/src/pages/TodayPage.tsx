import { useEffect, useState } from "react";
import type { TodayResponse } from "@paios/api-types";
import { PageHeader } from "../components/PageHeader.js";
import { Tag } from "../components/Tag.js";
import { FinanceIcon, HealthIcon, PlusIcon, SparklesIcon } from "../components/Icons.js";
import { apiJson } from "../lib/api.js";
import { formatDate, money } from "../lib/dates.js";
import type { Route } from "../lib/route.js";

type Task = { id: string; title: string; status: string; due_date?: string | null };
type Idea = { id: string; title: string; urgency?: number | null };
type Review = { id: string; review_type: string; period_start: string; status: string };

export function TodayPage({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<TodayResponse>("/today").then(setToday).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "无法读取今日数据");
    });
    apiJson<{ tasks: Task[] }>("/tasks").then((result) => setTasks(result.tasks)).catch(() => undefined);
    apiJson<{ ideas: Idea[] }>("/ideas").then((result) => setIdeas(result.ideas)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!today?.date) return;
    apiJson<{ reviews: Review[] }>("/reviews").then((result) => {
      setReview(result.reviews.find((item) => item.review_type === "daily" && item.period_start === today.date) ?? null);
    }).catch(() => undefined);
  }, [today?.date]);

  const date = today?.date;
  const dueTasks = tasks.filter((task) => date && task.due_date === date);
  const undated = tasks.filter((task) => task.status === "todo" && !task.due_date);
  const visibleTasks = [...dueTasks, ...undated.filter((task) => !dueTasks.some((item) => item.id === task.id))].slice(0, 10);
  const overdue = tasks.filter((task) => date && task.due_date && task.due_date < date && task.status === "todo");
  const topIdeas = [...ideas].sort((left, right) => (left.urgency ?? 4) - (right.urgency ?? 4)).slice(0, 4);
  const weekday = date ? new Date(date + "T12:00:00").toLocaleDateString("zh-CN", { weekday: "long" }) : "";

  return (
    <div className="page-stack page-today">
      <PageHeader meta={date ? `${formatDate(date)} · ${weekday}` : "读取中…"} title="今日" />
      {error ? <div className="notice error">{error}。请确认本机服务正在运行。</div> : null}
      
      <div className="status-strip">
        <button className="status-chip" onClick={() => onNavigate({ name: "finance", tab: "expenses" })} type="button">
          <span className="muted">本月支出</span>
          <strong>{today ? money(today.finance.monthExpenseCents) : "—"}</strong>
        </button>
        <button className="status-chip" onClick={() => onNavigate({ name: "health" })} type="button">
          <span className="muted">健康记录</span>
          <strong>{today?.health.recorded ? "今日已记" : "未记录"}</strong>
        </button>
        <button className="status-chip" onClick={() => onNavigate({ name: "reviews", tab: "daily" })} type="button">
          <span className="muted">今日复盘</span>
          <strong>{review ? (review.status === "finalized" ? "已完成" : "草稿中") : "尚未开启"}</strong>
        </button>
      </div>

      <div className="today-board">
        <section className="doc-section today-card">
          <div className="section-heading">
            <div>
              <h2>今日任务</h2>
              <span className="page-meta">当日到期与待办攻坚清单</span>
            </div>
            <button className="text-link" onClick={() => onNavigate({ name: "tasks" })} type="button">全部任务 →</button>
          </div>
          <div className="today-list">
            {visibleTasks.length === 0 ? (
              <div className="today-row empty"><span className="muted">今天还没有安排任务，随时从下方添加。</span></div>
            ) : null}
            {visibleTasks.map((task) => (
              <div className="today-row" key={task.id}>
                <button className={task.status === "done" ? "linkish done" : "linkish"} onClick={() => onNavigate({ name: "tasks" })} type="button">
                  {task.title || "未命名任务"}
                </button>
                <Tag size="sm" tone={task.status === "done" ? "success" : task.status === "cancelled" ? "danger" : "neutral"}>
                  {task.status === "done" ? "完成" : task.status === "cancelled" ? "取消" : "待办"}
                </Tag>
              </div>
            ))}
            {overdue.length > 0 && (
              <div className="today-row overdue-warning">
                <span className="danger-text">⚠️ 另有 {overdue.length} 项任务已逾期</span>
                <button className="text-link" onClick={() => onNavigate({ name: "tasks" })} type="button">查看</button>
              </div>
            )}
          </div>
        </section>

        <section className="doc-section today-card">
          <div className="section-heading">
            <div>
              <h2>灵感收集箱</h2>
              <span className="page-meta">暂存的突发想法与碎片灵感</span>
            </div>
            <button className="text-link" onClick={() => onNavigate({ name: "tasks" })} type="button">灵感库 →</button>
          </div>
          <div className="today-list">
            {topIdeas.length === 0 ? (
              <div className="today-row empty"><span className="muted">暂无未处理想法，Inbox 清爽。</span></div>
            ) : null}
            {topIdeas.map((idea) => (
              <div className="today-row" key={idea.id}>
                <button className="linkish" onClick={() => onNavigate({ name: "tasks" })} type="button">{idea.title || "未命名想法"}</button>
                <Tag size="sm" tone={idea.urgency === 1 ? "danger" : idea.urgency === 2 ? "warning" : "neutral"}>
                  {idea.urgency ? `${idea.urgency}级` : "常规"}
                </Tag>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="today-actions">
        <button className="primary-button" onClick={() => onNavigate({ name: "tasks" })} type="button">
          <PlusIcon /> 添加任务
        </button>
        <button className="secondary-button" onClick={() => onNavigate({ name: "finance", tab: "expenses" })} type="button">
          <FinanceIcon /> 记一笔支出
        </button>
        <button className="secondary-button" onClick={() => onNavigate({ name: "health" })} type="button">
          <HealthIcon /> 记健康数据
        </button>
        <button className="secondary-button" onClick={() => onNavigate({ name: "butler", conversationId: null })} type="button">
          <SparklesIcon /> 呼叫管家
        </button>
      </div>
    </div>
  );
}

