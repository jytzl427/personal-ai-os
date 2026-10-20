import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiJson } from "../lib/api.js";
import { activeNavName, navigation, pageTitle, type Route } from "../lib/route.js";
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

  useEffect(() => {
    document.title = pageTitle(route) + " · Personal AI OS";
  }, [route]);

  useEffect(() => {
    loadAttention();
    const onVisible = () => {
      if (document.visibilityState === "visible") loadAttention();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = window.setInterval(loadAttention, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className={`app-shell ${collapsed ? "is-sidebar-collapsed" : ""}`}>
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

        <nav aria-label="主导航" className="main-nav">
          {!collapsed && <div className="nav-section-label">核心工作台</div>}
          {navigation.map((item) => {
            const isActive = item.label === currentNav;
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
