import { useEffect, useMemo, useRef, useState } from "react";
import { apiJson } from "../lib/api.js";
import type { Route } from "../lib/route.js";

type Project = {
  id: string;
  name: string;
  category?: string;
  status?: string;
  archived_at?: string | null;
};

type CommandItem = {
  id: string;
  group: "action" | "project" | "navigation";
  title: string;
  meta?: string;
  icon: string;
  action: () => void;
};

export function CommandPalette({
  open,
  onClose,
  onNavigate
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (route: Route) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 40);
      apiJson<{ projects: Project[] }>("/projects")
        .then((res) => setProjects(res.projects || []))
        .catch(() => undefined);
    }
  }, [open]);

  const items: CommandItem[] = useMemo(() => {
    const list: CommandItem[] = [
      {
        id: "action-task",
        group: "action",
        title: "前往任务库新建待办",
        meta: "Tasks",
        icon: "⚔️",
        action: () => {
          onNavigate({ name: "tasks" });
          onClose();
        }
      },
      {
        id: "action-expense",
        group: "action",
        title: "记一笔日常支出",
        meta: "Finance",
        icon: "💰",
        action: () => {
          onNavigate({ name: "finance", tab: "expenses" });
          onClose();
        }
      },
      {
        id: "action-health",
        group: "action",
        title: "记录今日体重与作息",
        meta: "Health",
        icon: "🏃",
        action: () => {
          onNavigate({ name: "health" });
          onClose();
        }
      },
      {
        id: "action-daily-plan",
        group: "action",
        title: "查看 / 制定今日计划",
        meta: "Daily Plan",
        icon: "📅",
        action: () => {
          onNavigate({ name: "plans", tab: "daily-plan" });
          onClose();
        }
      },
      {
        id: "action-stage-plan",
        group: "action",
        title: "查看 / 制定阶段计划",
        meta: "Stage Plan",
        icon: "🎯",
        action: () => {
          onNavigate({ name: "plans", tab: "stage-plan" });
          onClose();
        }
      }
    ];

    // Add active projects
    const activeProjects = projects.filter((p) => p.status !== "done" && !p.archived_at);
    for (const proj of activeProjects) {
      list.push({
        id: `project-${proj.id}`,
        group: "project",
        title: proj.name,
        meta: proj.category === "maintenance" || proj.category === "long_term" ? "维护项目" : "推进项目",
        icon: "🚀",
        action: () => {
          onNavigate({ name: "project", id: proj.id });
          onClose();
        }
      });
    }

    // Navigation
    const navItems: Array<{ label: string; route: Route; icon: string }> = [
      { label: "任务数据库", route: { name: "tasks" }, icon: "📋" },
      { label: "项目工作台", route: { name: "projects" }, icon: "🗂️" },
      { label: "财务中心", route: { name: "finance", tab: "expenses" }, icon: "💳" },
      { label: "健康底盘", route: { name: "health" }, icon: "❤️" },
      { label: "计划与复盘", route: { name: "plans", tab: "daily-plan" }, icon: "🗓️" },
      { label: "归档数据池", route: { name: "archive", tab: "tasks" }, icon: "📦" },
      { label: "系统设置", route: { name: "settings" }, icon: "⚙️" }
    ];

    for (const nav of navItems) {
      list.push({
        id: `nav-${nav.label}`,
        group: "navigation",
        title: `打开 ${nav.label}`,
        meta: "导航",
        icon: nav.icon,
        action: () => {
          onNavigate(nav.route);
          onClose();
        }
      });
    }

    return list;
  }, [projects, onNavigate, onClose]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.title.toLowerCase().includes(q) || (item.meta && item.meta.toLowerCase().includes(q)));
  }, [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keep selected item in view
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector<HTMLElement>(".cmd-palette-item.is-selected");
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev + 1) % filteredItems.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (filteredItems.length === 0 ? 0 : (prev - 1 + filteredItems.length) % filteredItems.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, filteredItems, selectedIndex, onClose]);

  if (!open) return null;

  return (
    <div className="cmd-palette-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmd-palette-modal" role="dialog" aria-modal="true" aria-label="全局指挥中心">
        <div className="cmd-palette-input-wrap">
          <span className="cmd-palette-search-icon" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="cmd-palette-input"
            placeholder="键入以快速跳转项目、新建待办或执行操作…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="cmd-palette-esc-badge" onClick={onClose}>ESC</span>
        </div>

        <div className="cmd-palette-list" ref={listRef}>
          {filteredItems.length === 0 ? (
            <div className="cmd-palette-empty">没有匹配的指令或项目</div>
          ) : (
            filteredItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  className={`cmd-palette-item ${isSelected ? "is-selected" : ""}`}
                  onClick={() => item.action()}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <span className="cmd-palette-item-icon">{item.icon}</span>
                  <span className="cmd-palette-item-title">{item.title}</span>
                  {item.meta && <span className="cmd-palette-item-meta">{item.meta}</span>}
                  {isSelected && <span className="cmd-palette-enter-hint">↵ 执行</span>}
                </div>
              );
            })
          )}
        </div>

        <div className="cmd-palette-footer">
          <div className="cmd-palette-shortcuts">
            <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
            <span><kbd>↵</kbd> 选择</span>
            <span><kbd>ESC</kbd> 退出</span>
          </div>
          <span className="cmd-palette-brand">Personal AI OS</span>
        </div>
      </div>
    </div>
  );
}
