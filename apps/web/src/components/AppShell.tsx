import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiJson } from "../lib/api.js";
import { todayYmd } from "../lib/dates.js";
import { activeNavName, navigation, pageTitle, type Route } from "../lib/route.js";
import { CommandPalette } from "./CommandPalette.js";
import {
  AlertIcon,
  ArchiveIcon,
  ArrowRightIcon,
  FinanceIcon,
  HealthIcon,
  PlansIcon,
  ProjectsIcon,
  SettingsIcon,
  TasksIcon,
  TodayIcon
} from "./Icons.js";

type AttentionSummary = {
  date: string;
  phase: string;
  phase_label: string;
  items: string[];
};

function getNavIcon(label: string) {
  switch (label) {
    case "今日":
      return <TodayIcon />;
    case "任务":
      return <TasksIcon />;
    case "项目":
      return <ProjectsIcon />;
    case "财务":
      return <FinanceIcon />;
    case "健康":
      return <HealthIcon />;
    case "计划与复盘":
      return <PlansIcon />;
    case "归档":
      return <ArchiveIcon />;
    case "设置":
      return <SettingsIcon />;
    default:
      return <TasksIcon />;
  }
}

export function AppShell({
  route,
  onNavigate,
  children
}: {
  route: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}) {
  const currentNav = activeNavName(route);
  const [attention, setAttention] = useState<AttentionSummary | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [todoCount, setTodoCount] = useState(0);
  const [urgentCount, setUrgentCount] = useState(0);
  const [projectCount, setProjectCount] = useState(0);
  const retentionCheckStarted = useRef(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("paios_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });

  function toggleCollapse() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("paios_sidebar_collapsed", String(next));
      } catch {}
      return next;
    });
  }

  function loadAttention() {
    apiJson<AttentionSummary>("/system/attention")
      .then((result) => {
        setAttention(result);
        if (!retentionCheckStarted.current) {
          retentionCheckStarted.current = true;
          void apiJson("/system/archive-retention/check", { method: "POST" }).catch(() => undefined);
        }
      })
      .catch(() => setAttention(null));
  }

  function loadBadges() {
    const today = todayYmd();
    apiJson<{ tasks: Array<{ status: string; due_date?: string | null; archived_at?: string | null }> }>("/tasks")
      .then((res) => {
        const activeTodos = (res.tasks || []).filter((t) => t.status === "todo" && !t.archived_at);
        setTodoCount(activeTodos.length);
        const urgent = activeTodos.filter((t) => Boolean(t.due_date && t.due_date <= today));
        setUrgentCount(urgent.length);
      })
      .catch(() => undefined);

    apiJson<{ projects: Array<{ status?: string; category?: string; archived_at?: string | null }> }>("/projects")
      .then((res) => {
        const active = (res.projects || []).filter(
          (p) => p.status !== "done" && p.category !== "maintenance" && p.category !== "long_term" && !p.archived_at
        );
        setProjectCount(active.length);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    document.title = pageTitle(route) + " · Personal AI OS";
  }, [route]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    loadAttention();
    loadBadges();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadAttention();
        loadBadges();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(() => {
      loadAttention();
      loadBadges();
    }, 2 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className={`app-shell ${collapsed ? "is-sidebar-collapsed" : ""}`}>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onNavigate={onNavigate} />
      <aside className={`sidebar ${collapsed ? "is-collapsed" : ""}`}>
        <div className="brand">
          <div
            className="brand-logo"
            aria-hidden="true"
            onClick={toggleCollapse}
            style={{ cursor: "pointer" }}
            title={collapsed ? "点击展开侧边栏" : "Personal AI OS"}
          >
            <span className="brand-logo-inner" />
          </div>
          {!collapsed && (
            <div className="brand-info">
              <span className="brand-title">Personal AI OS</span>
              <span className="brand-badge">Local Core</span>
            </div>
          )}
          <button
            aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"}
            className="sidebar-collapse-toggle"
            onClick={toggleCollapse}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            type="button"
          >
            <span className="collapse-toggle-icon">{collapsed ? "❯" : "❮"}</span>
          </button>
        </div>

        {!collapsed && (
          <button
            type="button"
            className="sidebar-cmd-trigger"
            onClick={() => setPaletteOpen(true)}
            title="快捷指挥中心 (Ctrl+K)"
          >
            <span className="cmd-trigger-icon">🔍</span>
            <span className="cmd-trigger-text">快速跳转或操作…</span>
            <kbd className="cmd-trigger-kbd">Ctrl K</kbd>
          </button>
        )}

        <nav aria-label="主导航" className="main-nav">
          {!collapsed && <div className="nav-section-label">核心工作台</div>}
          {navigation.map((item) => {
            const isActive = item.label === currentNav;
            const isTasks = item.label === "任务";
            const isProjects = item.label === "项目";
            return (
              <button
                className={isActive ? "nav-item active" : "nav-item"}
                key={item.label}
                onClick={() => onNavigate(item.route)}
                title={item.label}
                type="button"
              >
                <span className="nav-icon">{getNavIcon(item.label)}</span>
                {!collapsed && <span className="nav-label">{item.label}</span>}
                {!collapsed && isTasks && todoCount > 0 && (
                  <span className={`nav-count-pill ${urgentCount > 0 ? "is-urgent" : ""}`} title={urgentCount > 0 ? `${urgentCount} 项今日或逾期待办` : `${todoCount} 项待办`}>
                    {todoCount}
                  </span>
                )}
                {!collapsed && isProjects && projectCount > 0 && (
                  <span className="nav-count-pill is-project" title={`${projectCount} 个活跃推进项目`}>
                    {projectCount}
                  </span>
                )}
                {isActive ? <span className="nav-active-indicator" /> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="system-status-pill" title="本地离线 · 安全隔离">
            <span className="status-dot-pulse" aria-hidden="true" />
            {!collapsed && <span className="status-text">本地离线 · 安全隔离</span>}
          </div>
        </div>
      </aside>

      <main className="main-content">
        {attention?.items.length ? (
          <div className="attention-banner">
            <div className="attention-icon" aria-hidden="true">
              <AlertIcon />
            </div>
            <div className="attention-content">
              <div className="attention-header">
                <strong>{attention.phase_label}状态提醒</strong>
              </div>
              <p className="attention-text">
                {attention.items.join("；")}。软件关闭期间不会主动打扰你。
              </p>
            </div>
            <button
              className="attention-action-button"
              onClick={() => onNavigate({ name: "plans", tab: "daily-plan" })}
              type="button"
            >
              <span>查看计划与复盘</span>
              <ArrowRightIcon />
            </button>
          </div>
        ) : null}
        <div className="page-view" key={window.location.hash}>
          {children}
        </div>
      </main>
    </div>
  );
}
