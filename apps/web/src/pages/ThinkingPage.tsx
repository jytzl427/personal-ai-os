import { useEffect, useRef, useState, useMemo } from "react";
import { apiJson } from "../lib/api.js";
import { MarkdownView } from "../components/MarkdownView.js";

export type Thought = {
  id: string;
  summary: string;
  content: string;
  category: string;
  color_theme: "emerald" | "amber" | "purple" | "ocean" | "sunset" | "aurora";
  bubble_size: number;
  is_pinned: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type BubblePhysics = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  isDragging: boolean;
};

const THEMES: Record<
  Thought["color_theme"],
  {
    name: string;
    accent: string;
    border: string;
    bgGradient: string;
    glow: string;
    badgeBg: string;
    badgeColor: string;
    bannerGradient: string;
  }
> = {
  emerald: {
    name: "翠玉流光",
    accent: "#059669",
    border: "rgba(16, 185, 129, 0.45)",
    bgGradient: "radial-gradient(circle at 32% 28%, rgba(236, 253, 245, 0.95), rgba(167, 243, 208, 0.65) 50%, rgba(52, 211, 153, 0.3) 95%)",
    glow: "0 8px 24px rgba(16, 185, 129, 0.18), inset 0 2px 4px rgba(255, 255, 255, 0.95)",
    badgeBg: "rgba(16, 185, 129, 0.15)",
    badgeColor: "#047857",
    bannerGradient: "linear-gradient(135deg, rgba(236, 253, 245, 0.9), rgba(209, 250, 229, 0.5))",
  },
  amber: {
    name: "琥珀暖金",
    accent: "#d97706",
    border: "rgba(245, 158, 11, 0.45)",
    bgGradient: "radial-gradient(circle at 32% 28%, rgba(254, 252, 232, 0.95), rgba(253, 230, 138, 0.65) 50%, rgba(251, 191, 36, 0.3) 95%)",
    glow: "0 8px 24px rgba(245, 158, 11, 0.18), inset 0 2px 4px rgba(255, 255, 255, 0.95)",
    badgeBg: "rgba(245, 158, 11, 0.15)",
    badgeColor: "#b45309",
    bannerGradient: "linear-gradient(135deg, rgba(254, 243, 199, 0.9), rgba(253, 230, 138, 0.5))",
  },
  purple: {
    name: "星河幻紫",
    accent: "#7c3aed",
    border: "rgba(168, 85, 247, 0.45)",
    bgGradient: "radial-gradient(circle at 32% 28%, rgba(250, 245, 255, 0.95), rgba(233, 213, 255, 0.65) 50%, rgba(192, 132, 252, 0.3) 95%)",
    glow: "0 8px 24px rgba(168, 85, 247, 0.18), inset 0 2px 4px rgba(255, 255, 255, 0.95)",
    badgeBg: "rgba(168, 85, 247, 0.15)",
    badgeColor: "#6d28d9",
    bannerGradient: "linear-gradient(135deg, rgba(243, 232, 255, 0.9), rgba(233, 213, 255, 0.5))",
  },
  ocean: {
    name: "深海青蓝",
    accent: "#0284c7",
    border: "rgba(14, 165, 233, 0.45)",
    bgGradient: "radial-gradient(circle at 32% 28%, rgba(240, 249, 255, 0.95), rgba(186, 230, 253, 0.65) 50%, rgba(56, 189, 248, 0.3) 95%)",
    glow: "0 8px 24px rgba(14, 165, 233, 0.18), inset 0 2px 4px rgba(255, 255, 255, 0.95)",
    badgeBg: "rgba(14, 165, 233, 0.15)",
    badgeColor: "#0369a1",
    bannerGradient: "linear-gradient(135deg, rgba(224, 242, 254, 0.9), rgba(186, 230, 253, 0.5))",
  },
  sunset: {
    name: "晚霞绯红",
    accent: "#e11d48",
    border: "rgba(244, 63, 94, 0.45)",
    bgGradient: "radial-gradient(circle at 32% 28%, rgba(255, 241, 242, 0.95), rgba(254, 205, 211, 0.65) 50%, rgba(251, 113, 133, 0.3) 95%)",
    glow: "0 8px 24px rgba(244, 63, 94, 0.18), inset 0 2px 4px rgba(255, 255, 255, 0.95)",
    badgeBg: "rgba(244, 63, 94, 0.15)",
    badgeColor: "#be123c",
    bannerGradient: "linear-gradient(135deg, rgba(255, 228, 230, 0.9), rgba(254, 205, 211, 0.5))",
  },
  aurora: {
    name: "极光绚彩",
    accent: "#4f46e5",
    border: "rgba(99, 102, 241, 0.45)",
    bgGradient: "radial-gradient(circle at 32% 28%, rgba(245, 243, 255, 0.95), rgba(204, 251, 241, 0.65) 50%, rgba(244, 114, 182, 0.3) 95%)",
    glow: "0 8px 24px rgba(99, 102, 241, 0.18), inset 0 2px 4px rgba(255, 255, 255, 0.95)",
    badgeBg: "rgba(99, 102, 241, 0.15)",
    badgeColor: "#4338ca",
    bannerGradient: "linear-gradient(135deg, rgba(238, 242, 255, 0.9), rgba(204, 251, 241, 0.5))",
  },
};

const CATEGORIES = ["认知模型", "消费防御", "情绪觉察", "战略与学业", "生活哲学"];

export function ThinkingPage({ onNavigate }: { onNavigate?: (route: any) => void }) {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("全部");
  const [viewMode, setViewMode] = useState<"bubbles" | "cards">("bubbles");
  const [activeThought, setActiveThought] = useState<Thought | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const [editForm, setEditForm] = useState<{
    id?: string;
    summary: string;
    content: string;
    category: string;
    color_theme: Thought["color_theme"];
    is_pinned: boolean;
  }>({
    summary: "",
    content: "",
    category: "认知模型",
    color_theme: "emerald",
    is_pinned: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const physicsRef = useRef<Map<string, BubblePhysics>>(new Map());
  const mouseRef = useRef<{ x: number; y: number; isDown: boolean; dragId: string | null; offset: { x: number; y: number }; startPos: { x: number; y: number } }>({
    x: -1000,
    y: -1000,
    isDown: false,
    dragId: null,
    offset: { x: 0, y: 0 },
    startPos: { x: 0, y: 0 },
  });

  const [positions, setPositions] = useState<{ [id: string]: { x: number; y: number } }>({});

  function loadThoughts() {
    setLoading(true);
    apiJson<{ ok: boolean; thoughts: Thought[] }>("/thoughts")
      .then((res) => {
        if (res && res.thoughts) {
          setThoughts(res.thoughts);
        }
      })
      .catch((err) => {
        console.error("Failed to load thoughts", err);
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    loadThoughts();
  }, []);

  const filteredThoughts = useMemo(() => {
    if (selectedCategory === "全部") return thoughts;
    return thoughts.filter((t) => t.category === selectedCategory);
  }, [thoughts, selectedCategory]);

  const allCategories = useMemo(() => {
    const set = new Set<string>(["全部", ...CATEGORIES]);
    for (const t of thoughts) {
      if (t.category) set.add(t.category);
    }
    return Array.from(set);
  }, [thoughts]);

  // Bubble sizes tuned: compact, elegant and refined (radius 55~65px instead of 100px)
  useEffect(() => {
    if (viewMode !== "bubbles" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 550;

    const currentMap = physicsRef.current;
    const newMap = new Map<string, BubblePhysics>();
    const newPositions: { [id: string]: { x: number; y: number } } = {};

    filteredThoughts.forEach((t, i) => {
      // Compact, elegant radii: pinned = 66px (132px diameter), normal = 56px (112px diameter)
      const baseRadius = t.is_pinned ? 66 : 56;
      const existing = currentMap.get(t.id);

      if (existing) {
        existing.baseRadius = baseRadius;
        existing.radius = baseRadius;
        newMap.set(t.id, existing);
        newPositions[t.id] = { x: existing.x, y: existing.y };
      } else {
        const cols = Math.max(1, Math.ceil(Math.sqrt(filteredThoughts.length * 1.5)));
        const rows = Math.ceil(filteredThoughts.length / cols);
        const col = i % cols;
        const row = Math.floor(i / cols);

        const slotW = w / cols;
        const slotH = h / rows;

        const x = Math.max(baseRadius + 30, Math.min(w - baseRadius - 30, slotW * (col + 0.5) + (Math.random() - 0.5) * 30));
        const y = Math.max(baseRadius + 30, Math.min(h - baseRadius - 30, slotH * (row + 0.5) + (Math.random() - 0.5) * 30));

        const node: BubblePhysics = {
          id: t.id,
          x,
          y,
          // Ultra-gentle Zen initial drift
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
          radius: baseRadius,
          baseRadius,
          isDragging: false,
        };
        newMap.set(t.id, node);
        newPositions[t.id] = { x, y };
      }
    });

    physicsRef.current = newMap;
    setPositions(newPositions);
  }, [filteredThoughts, viewMode]);

  // Ultra-gentle, peaceful Zen floating physics loop
  useEffect(() => {
    if (viewMode !== "bubbles") return;

    let animId: number;

    function loop(now: number) {
      if (!containerRef.current) {
        animId = requestAnimationFrame(loop);
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const nodes = Array.from(physicsRef.current.values());
      const mouse = mouseRef.current;
      const updatedPositions: { [id: string]: { x: number; y: number } } = {};

      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        if (n.isDragging) {
          n.x = mouse.x - mouse.offset.x;
          n.y = mouse.y - mouse.offset.y;
          n.vx = 0;
          n.vy = 0;
        } else {
          // Extremely gentle, serene breathing oscillation
          const timeOffset = now * 0.0006 + i * 2.1;
          n.vx += Math.sin(timeOffset) * 0.004;
          n.vy += Math.cos(timeOffset * 0.8) * 0.004;

          // Strong friction / air damping to keep motion calm and slow
          n.vx *= 0.965;
          n.vy *= 0.965;

          // Max speed capped at 0.55px/frame (peaceful and slow!)
          const spd = Math.hypot(n.vx, n.vy);
          if (spd > 0.55) {
            n.vx = (n.vx / spd) * 0.55;
            n.vy = (n.vy / spd) * 0.55;
          }

          n.x += n.vx;
          n.y += n.vy;

          // Subtle, delicate mouse proximity push
          const dxMouse = n.x - mouse.x;
          const dyMouse = n.y - mouse.y;
          const distMouse = Math.hypot(dxMouse, dyMouse);
          if (distMouse < n.radius + 40 && distMouse > 1) {
            const push = (1 - distMouse / (n.radius + 40)) * 0.2;
            n.vx += (dxMouse / distMouse) * push;
            n.vy += (dyMouse / distMouse) * push;
          }

          // Soft boundary bounce
          if (n.x - n.radius < 15) {
            n.x = n.radius + 15;
            n.vx = Math.abs(n.vx) * 0.7;
          } else if (n.x + n.radius > w - 15) {
            n.x = w - n.radius - 15;
            n.vx = -Math.abs(n.vx) * 0.7;
          }
          if (n.y - n.radius < 15) {
            n.y = n.radius + 15;
            n.vy = Math.abs(n.vy) * 0.7;
          } else if (n.y + n.radius > h - 15) {
            n.y = h - n.radius - 15;
            n.vy = -Math.abs(n.vy) * 0.7;
          }
        }

        // Inter-bubble soft repulsion
        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dx = m.x - n.x;
          const dy = m.y - n.y;
          const dist = Math.hypot(dx, dy);
          const minDist = n.radius + m.radius + 16;
          if (dist < minDist && dist > 0.1) {
            const overlap = (minDist - dist) * 0.04;
            const nx = dx / dist;
            const ny = dy / dist;
            if (!n.isDragging) {
              n.x -= nx * overlap;
              n.y -= ny * overlap;
              n.vx -= nx * 0.03;
              n.vy -= ny * 0.03;
            }
            if (!m.isDragging) {
              m.x += nx * overlap;
              m.y += ny * overlap;
              m.vx += nx * 0.03;
              m.vy += ny * 0.03;
            }
          }
        }

        updatedPositions[n.id] = { x: n.x, y: n.y };
      }

      setPositions(updatedPositions);
      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [viewMode]);

  // Pointer drag events
  function handlePointerDown(id: string, e: React.PointerEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const node = physicsRef.current.get(id);
    if (!node) return;

    node.isDragging = true;
    mouseRef.current.isDown = true;
    mouseRef.current.dragId = id;
    mouseRef.current.offset = { x: x - node.x, y: y - node.y };
    mouseRef.current.startPos = { x, y };
    mouseRef.current.x = x;
    mouseRef.current.y = y;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handleContainerPointerMove(e: React.PointerEvent) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    mouseRef.current.x = x;
    mouseRef.current.y = y;
  }

  function handlePointerUp(id: string, thought: Thought, e: React.PointerEvent) {
    const node = physicsRef.current.get(id);
    if (node) {
      node.isDragging = false;
    }
    if (mouseRef.current.dragId === id) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dragDist = Math.hypot(x - mouseRef.current.startPos.x, y - mouseRef.current.startPos.y);
        // If movement was small, treat as a pure click -> open card!
        if (dragDist < 6) {
          setActiveThought(thought);
        }
      }
      mouseRef.current.dragId = null;
    }
    mouseRef.current.isDown = false;
  }

  async function handleSaveThought() {
    if (!editForm.summary.trim()) {
      alert("请输入总结金句");
      return;
    }
    try {
      if (editForm.id) {
        const res = await apiJson<{ ok: boolean; thought: Thought }>(`/thoughts/${editForm.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            summary: editForm.summary.trim(),
            content: editForm.content.trim(),
            category: editForm.category.trim(),
            color_theme: editForm.color_theme,
            is_pinned: editForm.is_pinned ? 1 : 0,
          }),
        });
        if (res && res.thought) {
          setThoughts((prev) => prev.map((t) => (t.id === res.thought.id ? res.thought : t)));
          if (activeThought?.id === res.thought.id) {
            setActiveThought(res.thought);
          }
        }
      } else {
        const res = await apiJson<{ ok: boolean; thought: Thought }>("/thoughts", {
          method: "POST",
          body: JSON.stringify({
            summary: editForm.summary.trim(),
            content: editForm.content.trim(),
            category: editForm.category.trim(),
            color_theme: editForm.color_theme,
            is_pinned: editForm.is_pinned ? 1 : 0,
            bubble_size: editForm.is_pinned ? 3 : 2,
          }),
        });
        if (res && res.thought) {
          setThoughts((prev) => [res.thought, ...prev]);
        }
      }
      setIsEditing(false);
    } catch (err) {
      console.error("Save thought failed", err);
      alert("保存失败，请稍后重试");
    }
  }

  async function handleDeleteThought(id: string) {
    if (!confirm("确定要删除这条思考沉淀吗？")) return;
    try {
      await apiJson(`/thoughts/${id}`, { method: "DELETE" });
      setThoughts((prev) => prev.filter((t) => t.id !== id));
      setActiveThought(null);
      setIsEditing(false);
    } catch (err) {
      console.error("Delete failed", err);
      alert("删除失败");
    }
  }

  return (
    <div className="page-stack" style={{ padding: "0 28px 40px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* Header Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingTop: "24px", paddingBottom: "16px", borderBottom: "1px solid var(--line)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "22px" }}>🫧</span>
            <h1 style={{ margin: 0, fontSize: "21px", fontWeight: "700", color: "var(--ink)", letterSpacing: "-0.02em" }}>
              思考
            </h1>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--ink-3)" }}>
            用真实经历与内耗淬炼出的认知晶体 · 触碰气泡重温定海神针
          </p>
        </div>

        {/* View Switcher & Action */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{ display: "inline-flex", background: "var(--surface-2)", padding: "3px", borderRadius: "10px", border: "1px solid var(--line)" }}>
            <button
              onClick={() => setViewMode("bubbles")}
              style={{
                border: "none",
                background: viewMode === "bubbles" ? "var(--surface)" : "transparent",
                color: viewMode === "bubbles" ? "var(--ink)" : "var(--ink-3)",
                fontWeight: viewMode === "bubbles" ? "600" : "500",
                fontSize: "12px",
                padding: "5px 12px",
                borderRadius: "7px",
                cursor: "pointer",
                boxShadow: viewMode === "bubbles" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              🫧 灵动气泡
            </button>
            <button
              onClick={() => setViewMode("cards")}
              style={{
                border: "none",
                background: viewMode === "cards" ? "var(--surface)" : "transparent",
                color: viewMode === "cards" ? "var(--ink)" : "var(--ink-3)",
                fontWeight: viewMode === "cards" ? "600" : "500",
                fontSize: "12px",
                padding: "5px 12px",
                borderRadius: "7px",
                cursor: "pointer",
                boxShadow: viewMode === "cards" ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              🗂️ 沉淀卡片
            </button>
          </div>

          <button
            onClick={() => {
              setEditForm({
                summary: "",
                content: "",
                category: selectedCategory === "全部" ? "认知模型" : selectedCategory,
                color_theme: "emerald",
                is_pinned: false,
              });
              setIsEditing(true);
            }}
            className="primary-button"
            style={{
              padding: "7px 15px",
              borderRadius: "10px",
              fontSize: "12.5px",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              gap: "5px",
              cursor: "pointer",
            }}
          >
            <span>+</span>
            <span>记录新思考</span>
          </button>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 0 16px", overflowX: "auto", paddingBottom: "2px" }}>
        <span style={{ fontSize: "12px", color: "var(--ink-4)", marginRight: "2px" }}>分类:</span>
        {allCategories.map((cat) => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                border: isSelected ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                background: isSelected ? "var(--accent-soft)" : "var(--surface)",
                color: isSelected ? "var(--accent)" : "var(--ink-2)",
                fontWeight: isSelected ? "600" : "500",
                fontSize: "12px",
                padding: "4px 14px",
                borderRadius: "9999px",
                cursor: "pointer",
                transition: "all 0.14s ease",
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Main Content Arena */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "420px", color: "var(--ink-3)", fontSize: "14px" }}>
          正在加载思考晶体...
        </div>
      ) : filteredThoughts.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "420px", color: "var(--ink-4)" }}>
          <span style={{ fontSize: "36px", marginBottom: "8px" }}>🫧</span>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--ink-3)" }}>暂无该分类的思考气泡</p>
          <p style={{ margin: "4px 0 0", fontSize: "12px" }}>点击右上角“记录新思考”，为你的心智武器库增添一颗晶体</p>
        </div>
      ) : viewMode === "bubbles" ? (
        /* Floating Organic Bubbles Pool */
        <div
          ref={containerRef}
          onPointerMove={handleContainerPointerMove}
          style={{
            position: "relative",
            width: "100%",
            height: "calc(100vh - 240px)",
            minHeight: "520px",
            // Delicate ethereal background with very soft ambient lights
            background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #f8faf9 100%)",
            borderRadius: "20px",
            border: "1px solid var(--line)",
            boxShadow: "inset 0 1px 4px rgba(0,0,0,0.02)",
            overflow: "hidden",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          {/* Subtle Ambient Decorative Pastel Halos */}
          <div
            style={{
              position: "absolute",
              top: "15%",
              left: "20%",
              width: "280px",
              height: "280px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(167, 243, 208, 0.22) 0%, rgba(255,255,255,0) 70%)",
              filter: "blur(30px)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "20%",
              right: "22%",
              width: "320px",
              height: "320px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(216, 180, 254, 0.18) 0%, rgba(255,255,255,0) 70%)",
              filter: "blur(36px)",
              pointerEvents: "none",
            }}
          />

          {/* Bubbles */}
          {filteredThoughts.map((t) => {
            const theme = THEMES[t.color_theme] || THEMES.emerald;
            const pos = positions[t.id] || { x: 200, y: 200 };
            const isHovered = hoveredId === t.id;
            // Compact, balanced size
            const size = t.is_pinned ? 132 : 116;

            return (
              <div
                key={t.id}
                onPointerDown={(e) => handlePointerDown(t.id, e)}
                onPointerUp={(e) => handlePointerUp(t.id, t, e)}
                onMouseEnter={() => setHoveredId(t.id)}
                onMouseLeave={() => setHoveredId(null)}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: `${size}px`,
                  height: `${size}px`,
                  borderRadius: "50%",
                  transform: `translate3d(${pos.x - size / 2}px, ${pos.y - size / 2}px, 0) scale(${isHovered ? 1.07 : 1})`,
                  background: theme.bgGradient,
                  border: `1.5px solid ${theme.border}`,
                  boxShadow: isHovered
                    ? `0 14px 32px rgba(0,0,0,0.12), inset 0 2px 5px rgba(255,255,255,0.95)`
                    : theme.glow,
                  backdropFilter: "blur(8px)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "12px 14px",
                  boxSizing: "border-box",
                  cursor: "pointer",
                  transition: "transform 0.15s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease",
                  textAlign: "center",
                  willChange: "transform",
                  zIndex: isHovered ? 10 : 2,
                }}
                className="thought-bubble-node"
              >
                {/* 3D Glass Specular Highlight Crescent */}
                <div
                  style={{
                    position: "absolute",
                    top: "8px",
                    left: "14px",
                    width: "36px",
                    height: "18px",
                    borderRadius: "50%",
                    transform: "rotate(-35deg)",
                    background: "radial-gradient(ellipse, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0) 80%)",
                    pointerEvents: "none",
                  }}
                />

                {/* Category Badge Pill */}
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: "600",
                    padding: "1px 7px",
                    borderRadius: "999px",
                    background: theme.badgeBg,
                    color: theme.badgeColor,
                    marginBottom: "5px",
                    pointerEvents: "none",
                    letterSpacing: "0.02em",
                  }}
                >
                  {t.category}
                </span>

                {/* Summary Quote Text */}
                <div
                  style={{
                    fontSize: t.is_pinned ? "11.5px" : "11px",
                    fontWeight: "600",
                    color: "var(--ink)",
                    lineHeight: "1.35",
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    pointerEvents: "none",
                    textShadow: "0 1px 1px rgba(255,255,255,0.7)",
                  }}
                >
                  “{t.summary}”
                </div>

                {/* Micro Hover Hint */}
                {isHovered && (
                  <span
                    style={{
                      position: "absolute",
                      bottom: "7px",
                      fontSize: "9.5px",
                      color: theme.accent,
                      fontWeight: "600",
                      pointerEvents: "none",
                    }}
                  >
                    查看 ✦
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Bento Cards Grid View */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "14px", marginTop: "6px" }}>
          {filteredThoughts.map((t) => {
            const theme = THEMES[t.color_theme] || THEMES.emerald;
            return (
              <div
                key={t.id}
                onClick={() => setActiveThought(t)}
                style={{
                  background: "var(--surface)",
                  borderRadius: "14px",
                  border: `1.5px solid ${theme.border}`,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                  padding: "18px 20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "all 0.18s ease",
                }}
                className="thought-card-item"
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "600",
                        padding: "2px 8px",
                        borderRadius: "999px",
                        background: theme.badgeBg,
                        color: theme.badgeColor,
                      }}
                    >
                      {t.category}
                    </span>
                    {t.is_pinned === 1 && (
                      <span style={{ fontSize: "11px", color: "#d97706", fontWeight: "600" }}>
                        ⭐️ 核心定海神针
                      </span>
                    )}
                  </div>
                  <h3 style={{ margin: "0 0 8px", fontSize: "14.5px", fontWeight: "600", color: "var(--ink)", lineHeight: "1.4" }}>
                    “{t.summary}”
                  </h3>
                  <p style={{ margin: 0, fontSize: "12px", color: "var(--ink-3)", lineHeight: "1.5", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                    {t.content || "点击卡片补充详细思考与背景推导。"}
                  </p>
                </div>

                <div style={{ marginTop: "14px", paddingTop: "10px", borderTop: "1px solid var(--line-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--ink-4)" }}>
                  <span>{t.created_at ? t.created_at.slice(0, 10) : "思考晶体"}</span>
                  <span style={{ color: theme.accent, fontWeight: "600" }}>展开感悟 →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 
        Active Thought Detail Modal: COMPACT, ELEGANT "小卡片" 
        (Fixed the white-screen bug by passing content prop correctly) 
      */}
      {activeThought && (
        <div
          className="habit-modal-backdrop"
          onClick={() => setActiveThought(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "480px",
              width: "100%",
              background: "var(--surface)",
              borderRadius: "20px",
              border: `1.5px solid ${(THEMES[activeThought.color_theme] || THEMES.emerald).border}`,
              boxShadow: "0 20px 48px rgba(0, 0, 0, 0.16), 0 4px 12px rgba(0, 0, 0, 0.06)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              animation: "modalDialogZoomIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Elegant Colored Banner Header */}
            <div
              style={{
                padding: "16px 20px 14px",
                background: (THEMES[activeThought.color_theme] || THEMES.emerald).bannerGradient,
                borderBottom: `1px solid ${(THEMES[activeThought.color_theme] || THEMES.emerald).border}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    background: (THEMES[activeThought.color_theme] || THEMES.emerald).badgeBg,
                    color: (THEMES[activeThought.color_theme] || THEMES.emerald).badgeColor,
                  }}
                >
                  {activeThought.category}
                </span>
                {activeThought.is_pinned === 1 && (
                  <span style={{ fontSize: "11px", color: "#d97706", fontWeight: "600" }}>
                    ⭐️ 核心定海神针
                  </span>
                )}
                <span style={{ fontSize: "11.5px", color: "var(--ink-3)" }}>
                  {activeThought.created_at ? activeThought.created_at.slice(0, 10) : ""}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setActiveThought(null)}
                style={{
                  border: "none",
                  background: "rgba(0,0,0,0.06)",
                  width: "26px",
                  height: "26px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "14px",
                  cursor: "pointer",
                  color: "var(--ink-2)",
                  transition: "background 0.14s ease",
                }}
              >
                ✕
              </button>
            </div>

            {/* Quote Header */}
            <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid var(--line)" }}>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: "var(--ink)",
                  lineHeight: "1.45",
                  letterSpacing: "-0.01em",
                }}
              >
                “{activeThought.summary}”
              </div>
            </div>

            {/* Detailed Reflections Scroll Body */}
            <div style={{ padding: "16px 22px 20px", maxHeight: "55vh", overflowY: "auto" }}>
              <div style={{ fontSize: "13px", color: "var(--ink-2)", lineHeight: "1.65" }}>
                {activeThought.content && activeThought.content.trim() ? (
                  /* Correctly pass content prop to MarkdownView */
                  <MarkdownView content={activeThought.content} />
                ) : (
                  <p style={{ color: "var(--ink-4)", fontStyle: "italic", margin: 0 }}>
                    暂无更详细的背景推导与感悟，可点击下方“编辑思考”进行补充。
                  </p>
                )}
              </div>
            </div>

            {/* Compact Modal Footer */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid var(--line)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--surface-2)",
              }}
            >
              <button
                type="button"
                onClick={() => handleDeleteThought(activeThought.id)}
                style={{ border: "none", background: "transparent", color: "var(--danger)", fontSize: "11.5px", cursor: "pointer", padding: "4px" }}
              >
                删除
              </button>

              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setEditForm({
                      id: activeThought.id,
                      summary: activeThought.summary,
                      content: activeThought.content || "",
                      category: activeThought.category,
                      color_theme: activeThought.color_theme,
                      is_pinned: Boolean(activeThought.is_pinned),
                    });
                    setIsEditing(true);
                  }}
                  className="secondary-button"
                  style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => setActiveThought(null)}
                  className="primary-button"
                  style={{ padding: "5px 16px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Create Modal */}
      {isEditing && (
        <div
          className="habit-modal-backdrop"
          onClick={() => setIsEditing(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            className="habit-modal-dialog"
            style={{ maxWidth: "480px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="habit-modal-header" style={{ padding: "16px 20px" }}>
              <div className="modal-title-group">
                <h3 className="modal-title" style={{ fontSize: "16px" }}>
                  {editForm.id ? "编辑思考沉淀" : "沉淀新的思考晶体"}
                </h3>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setIsEditing(false)}
                style={{ border: "none", background: "transparent", fontSize: "16px", cursor: "pointer", color: "var(--ink-3)" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "65vh", overflowY: "auto" }}>
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "var(--ink)", marginBottom: "5px" }}>
                  核心总结金句 <span style={{ fontWeight: "normal", color: "var(--ink-3)" }}>（气泡外显，15～25字为佳）</span>
                </label>
                <input
                  type="text"
                  value={editForm.summary}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, summary: e.target.value }))}
                  placeholder="例如：人得知足，无实际问题驱动的投入皆是欲望"
                  className="rounded-input"
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "var(--ink)", marginBottom: "5px" }}>
                    思考分类
                  </label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="rounded-input"
                    style={{ width: "100%", boxSizing: "border-box", fontSize: "12px" }}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "var(--ink)", marginBottom: "5px" }}>
                    流光色调
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingTop: "5px" }}>
                    {(Object.keys(THEMES) as Array<Thought["color_theme"]>).map((thm) => (
                      <button
                        key={thm}
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, color_theme: thm }))}
                        style={{
                          width: "22px",
                          height: "22px",
                          borderRadius: "50%",
                          background: THEMES[thm].accent,
                          border: editForm.color_theme === thm ? "2.5px solid var(--ink)" : "2px solid transparent",
                          transform: editForm.color_theme === thm ? "scale(1.2)" : "scale(1)",
                          cursor: "pointer",
                          transition: "all 0.14s ease",
                        }}
                        title={THEMES[thm].name}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: "10px", background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <div>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "var(--ink)" }}>置顶为核心定海神针</span>
                  <p style={{ margin: "1px 0 0", fontSize: "11px", color: "var(--ink-3)" }}>气泡略大，视觉优先呈现</p>
                </div>
                <input
                  type="checkbox"
                  checked={editForm.is_pinned}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, is_pinned: e.target.checked }))}
                  style={{ width: "15px", height: "15px", cursor: "pointer" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "var(--ink)", marginBottom: "5px" }}>
                  深度感悟与思考推导 <span style={{ fontWeight: "normal", color: "var(--ink-4)" }}>（支持 Markdown）</span>
                </label>
                <textarea
                  rows={5}
                  value={editForm.content}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                  placeholder="记录当时发生的事实、深层心理觉察、逻辑推导以及给未来的终极准则..."
                  className="rounded-input"
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: "1.55", fontSize: "12.5px" }}
                />
              </div>
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: "8px", background: "var(--surface-2)" }}>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="secondary-button"
                style={{ padding: "5px 12px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveThought}
                className="primary-button"
                style={{ padding: "5px 16px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
              >
                保存沉淀
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
