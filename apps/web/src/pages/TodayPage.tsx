import { useEffect, useState } from "react";
import type { TodayResponse } from "@paios/api-types";
import { PageHeader } from "../components/PageHeader.js";
import { Tag } from "../components/Tag.js";
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
  const topIdeas = [...ideas].sort((left, right) => (left.urgency ?? 4) - (right.urgency ?? 4)).slice(0, 3);
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
          <span className="muted">健康</span>
          <strong>{today?.health.recorded ? "已记录" : "未记录"}</strong>
        </button>
        <button className="status-chip" onClick={() => onNavigate({ name: "reviews", tab: "daily" })} type="button">
          <span className="muted">今日复盘</span>
          <strong>{review ? (review.status === "finalized" ? "已完成" : "草稿") : "未写"}</strong>
        </button>
      </div>
      <section className="doc-section">
        <div className="section-heading">
          <h2>今天的任务</h2>
          <button className="text-link" onClick={() => onNavigate({ name: "tasks" })} type="button">全部任务</button>
        </div>
        <div className="today-list">
          {visibleTasks.length === 0 ? <div className="today-row"><span className="muted">今天还没有安排任务。</span></div> : null}
          {visibleTasks.map((task) => (
            <div className="today-row" key={task.id}>
              <button className={task.status === "done" ? "linkish done" : "linkish"} onClick={() => onNavigate({ name: "tasks" })} type="button">
                {task.title || "未命名任务"}
              </button>
              <Tag tone={task.status === "done" ? "success" : task.status === "cancelled" ? "danger" : "neutral"}>
                {task.status === "done" ? "完成" : task.status === "cancelled" ? "取消" : "未完成"}
              </Tag>
            </div>
          ))}
          {overdue.length ? <div className="today-row"><span className="muted">{overdue.length} 项已逾期</span></div> : null}
        </div>
        <div className="section-heading"><h2>想法</h2></div>
        <div className="today-list">
          {topIdeas.length === 0 ? <div className="today-row"><span className="muted">暂无未处理想法。</span></div> : null}
          {topIdeas.map((idea) => (
            <div className="today-row" key={idea.id}>
              <button className="linkish" onClick={() => onNavigate({ name: "tasks" })} type="button">{idea.title || "未命名想法"}</button>
              <span className="muted">{idea.urgency ?? 4}级</span>
            </div>
          ))}
        </div>
        <div className="today-actions">
          <button className="secondary-button" onClick={() => onNavigate({ name: "tasks" })} type="button">添加任务</button>
          <button className="secondary-button" onClick={() => onNavigate({ name: "finance", tab: "expenses" })} type="button">记一笔</button>
          <button className="secondary-button" onClick={() => onNavigate({ name: "health" })} type="button">记健康</button>
        </div>
      </section>
    </div>
  );
}
