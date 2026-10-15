import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiJson } from "../lib/api.js";
import { activeNavName, navigation, pageTitle, type Route } from "../lib/route.js";

type AttentionSummary = {
  date: string;
  phase: string;
  phase_label: string;
  items: string[];
};

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
    const onVisible = () => { if (document.visibilityState === "visible") loadAttention(); };
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
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span aria-hidden="true" className="brand-mark" />
          <span>Personal AI OS</span>
        </div>
        <nav aria-label="主导航" className="main-nav">
          {navigation.map((item) => (
            <button
              className={item.label === currentNav ? "nav-item active" : "nav-item"}
              key={item.label}
              onClick={() => onNavigate(item.route)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">本地 · 单用户</div>
      </aside>
      <main className="main-content">
        {attention?.items.length ? (
          <div className="attention-banner">
            <div>
              <strong>{attention.phase_label}检查</strong>
              <p>{attention.items.join("；")}。软件关闭期间不会主动联系你。</p>
            </div>
            <button className="secondary-button" onClick={() => onNavigate({ name: "plans", tab: "daily-plan" })} type="button">查看计划与复盘</button>
          </div>
        ) : null}
        <div className="page-view" key={window.location.hash}>{children}</div>
      </main>
    </div>
  );
}
