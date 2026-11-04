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
  }
> = {
  emerald: {
    name: "翠玉流光",
    accent: "#059669",
    border: "rgba(16, 185, 129, 0.45)",
    bgGradient: "radial-gradient(circle at 35% 30%, rgba(209, 250, 229, 0.85), rgba(167, 243, 208, 0.6) 50%, rgba(110, 231, 183, 0.35) 100%)",
    glow: "0 12px 36px rgba(16, 185, 129, 0.22), inset 0 2px 6px rgba(255, 255, 255, 0.9)",
    badgeBg: "rgba(16, 185, 129, 0.16)",
    badgeColor: "#065f46",
  },
  amber: {
    name: "琥珀暖金",
    accent: "#d97706",
    border: "rgba(245, 158, 11, 0.45)",
    bgGradient: "radial-gradient(circle at 35% 30%, rgba(254, 243, 199, 0.85), rgba(253, 230, 138, 0.6) 50%, rgba(252, 211, 77, 0.35) 100%)",
    glow: "0 12px 36px rgba(245, 158, 11, 0.22), inset 0 2px 6px rgba(255, 255, 255, 0.9)",
    badgeBg: "rgba(245, 158, 11, 0.16)",
    badgeColor: "#92400e",
  },
  purple: {
    name: "星河幻紫",
    accent: "#7c3aed",
    border: "rgba(168, 85, 247, 0.45)",
    bgGradient: "radial-gradient(circle at 35% 30%, rgba(243, 232, 255, 0.85), rgba(233, 213, 255, 0.6) 50%, rgba(216, 180, 254, 0.35) 100%)",
    glow: "0 12px 36px rgba(168, 85, 247, 0.22), inset 0 2px 6px rgba(255, 255, 255, 0.9)",
    badgeBg: "rgba(168, 85, 247, 0.16)",
    badgeColor: "#5b21b6",
  },
  ocean: {
    name: "深海青蓝",
    accent: "#0284c7",
    border: "rgba(14, 165, 233, 0.45)",
    bgGradient: "radial-gradient(circle at 35% 30%, rgba(224, 242, 254, 0.85), rgba(186, 230, 253, 0.6) 50%, rgba(125, 211, 252, 0.35) 100%)",
    glow: "0 12px 36px rgba(14, 165, 233, 0.22), inset 0 2px 6px rgba(255, 255, 255, 0.9)",
    badgeBg: "rgba(14, 165, 233, 0.16)",
    badgeColor: "#075985",
  },
  sunset: {
    name: "晚霞绯红",
    accent: "#e11d48",
    border: "rgba(244, 63, 94, 0.45)",
    bgGradient: "radial-gradient(circle at 35% 30%, rgba(255, 228, 230, 0.85), rgba(254, 205, 211, 0.6) 50%, rgba(253, 164, 175, 0.35) 100%)",
    glow: "0 12px 36px rgba(244, 63, 94, 0.22), inset 0 2px 6px rgba(255, 255, 255, 0.9)",
    badgeBg: "rgba(244, 63, 94, 0.16)",
    badgeColor: "#9f1239",
  },
  aurora: {
    name: "极光绚彩",
    accent: "#4f46e5",
    border: "rgba(99, 102, 241, 0.45)",
    bgGradient: "radial-gradient(circle at 35% 30%, rgba(238, 242, 255, 0.85), rgba(204, 251, 241, 0.6) 50%, rgba(252, 231, 243, 0.35) 100%)",
    glow: "0 12px 36px rgba(99, 102, 241, 0.22), inset 0 2px 6px rgba(255, 255, 255, 0.9)",
    badgeBg: "rgba(99, 102, 241, 0.16)",
    badgeColor: "#3730a3",
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
  const mouseRef = useRef<{ x: number; y: number; isDown: boolean; dragId: string | null; offset: { x: number; y: number } }>({
    x: -1000,
    y: -1000,
    isDown: false,
    dragId: null,
    offset: { x: 0, y: 0 },
  });

  // Track positions in state to trigger DOM renders smoothly
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

  // Initialize bubble physics positions whenever filteredThoughts or container changes
  useEffect(() => {
    if (viewMode !== "bubbles" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = rect.width || 900;
    const h = rect.height || 600;

    const currentMap = physicsRef.current;
    const newMap = new Map<string, BubblePhysics>();
    const newPositions: { [id: string]: { x: number; y: number } } = {};

    filteredThoughts.forEach((t, i) => {
      const radius = t.is_pinned ? 105 : 90;
      const existing = currentMap.get(t.id);

      if (existing) {
        existing.radius = radius;
        newMap.set(t.id, existing);
        newPositions[t.id] = { x: existing.x, y: existing.y };
      } else {
        // Grid-based initial distribution with random offsets
        const cols = Math.max(1, Math.ceil(Math.sqrt(filteredThoughts.length)));
        const rows = Math.ceil(filteredThoughts.length / cols);
        const col = i % cols;
        const row = Math.floor(i / cols);

        const slotW = w / cols;
        const slotH = h / rows;

        const x = Math.max(radius + 20, Math.min(w - radius - 20, slotW * (col + 0.5) + (Math.random() - 0.5) * 40));
        const y = Math.max(radius + 20, Math.min(h - radius - 20, slotH * (row + 0.5) + (Math.random() - 0.5) * 40));

        const node: BubblePhysics = {
          id: t.id,
          x,
          y,
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.6,
          radius,
          isDragging: false,
        };
        newMap.set(t.id, node);
        newPositions[t.id] = { x, y };
      }
    });

    physicsRef.current = newMap;
    setPositions(newPositions);
  }, [filteredThoughts, viewMode]);

  // Smooth Physics Simulation Loop
  useEffect(() => {
    if (viewMode !== "bubbles") return;

    let animId: number;
    let lastTime = performance.now();

    function loop(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

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
          // Subtle buoyant orbital motion
          const timeOffset = now * 0.0012 + i * 1.5;
          n.vx += Math.sin(timeOffset) * 0.012;
          n.vy += Math.cos(timeOffset * 0.85) * 0.012;

          // Drag / friction
          n.vx *= 0.985;
          n.vy *= 0.985;

          // Velocity clamp
          const spd = Math.hypot(n.vx, n.vy);
          if (spd > 2.0) {
            n.vx = (n.vx / spd) * 2.0;
            n.vy = (n.vy / spd) * 2.0;
          }

          n.x += n.vx;
          n.y += n.vy;

          // Gentle mouse push
          const dxMouse = n.x - mouse.x;
          const dyMouse = n.y - mouse.y;
          const distMouse = Math.hypot(dxMouse, dyMouse);
          if (distMouse < n.radius + 50 && distMouse > 1) {
            const push = (1 - distMouse / (n.radius + 50)) * 0.5;
            n.vx += (dxMouse / distMouse) * push;
            n.vy += (dyMouse / distMouse) * push;
          }

          // Wall boundary bounce
          if (n.x - n.radius < 10) {
            n.x = n.radius + 10;
            n.vx = Math.abs(n.vx) * 0.85;
          } else if (n.x + n.radius > w - 10) {
            n.x = w - n.radius - 10;
            n.vx = -Math.abs(n.vx) * 0.85;
          }
          if (n.y - n.radius < 10) {
            n.y = n.radius + 10;
            n.vy = Math.abs(n.vy) * 0.85;
          } else if (n.y + n.radius > h - 10) {
            n.y = h - n.radius - 10;
            n.vy = -Math.abs(n.vy) * 0.85;
          }
        }

        // Inter-bubble soft repulsion
        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dx = m.x - n.x;
          const dy = m.y - n.y;
          const dist = Math.hypot(dx, dy);
          const minDist = n.radius + m.radius + 14;
          if (dist < minDist && dist > 0.1) {
            const overlap = (minDist - dist) * 0.05;
            const nx = dx / dist;
            const ny = dy / dist;
            if (!n.isDragging) {
              n.x -= nx * overlap;
              n.y -= ny * overlap;
              n.vx -= nx * 0.06;
              n.vy -= ny * 0.06;
            }
            if (!m.isDragging) {
              m.x += nx * overlap;
              m.y += ny * overlap;
              m.vx += nx * 0.06;
              m.vy += ny * 0.06;
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

  // Pointer drag events on bubbles
  function startDrag(id: string, e: React.PointerEvent) {
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

  function stopDrag(id: string, thought: Thought, e: React.PointerEvent) {
    const node = physicsRef.current.get(id);
    if (node) {
      node.isDragging = false;
    }
    if (mouseRef.current.dragId === id) {
      // Check if this was a click rather than a large drag
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect && node) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dist = Math.hypot(x - (node.x + mouseRef.current.offset.x), y - (node.y + mouseRef.current.offset.y));
        if (dist < 6) {
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
    <div className="page-stack" style={{ padding: "0 28px 40px", maxWidth: "1280px", margin: "0 auto" }}>
      {/* Page Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingTop: "24px", paddingBottom: "18px", borderBottom: "1px solid var(--line)" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "24px" }}>🫧</span>
            <h1 style={{ margin: 0, fontSize: "22px", fontWeight: "700", color: "var(--ink)", letterSpacing: "-0.02em" }}>
              思考
            </h1>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--ink-3)" }}>
            用真实经历与内耗淬炼出的认知晶体 · 触碰气泡重温定海神针
          </p>
        </div>

        {/* Toolbar controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
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
              padding: "7px 16px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: "600",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              cursor: "pointer",
            }}
          >
            <span>+</span>
            <span>记录新思考</span>
          </button>
        </div>
      </div>

      {/* Category Filter Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", margin: "14px 0 16px", overflowX: "auto", paddingBottom: "4px" }}>
        <span style={{ fontSize: "12px", color: "var(--ink-4)", marginRight: "4px" }}>分类:</span>
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

      {/* Main View Area */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "450px", color: "var(--ink-3)", fontSize: "14px" }}>
          正在加载思考晶体...
        </div>
      ) : filteredThoughts.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "450px", color: "var(--ink-4)" }}>
          <span style={{ fontSize: "40px", marginBottom: "8px" }}>🫧</span>
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
            height: "calc(100vh - 230px)",
            minHeight: "560px",
            background: "radial-gradient(ellipse at 50% 20%, rgba(240, 24DF, 245, 0.7), var(--surface-2) 80%)",
            borderRadius: "24px",
            border: "1px solid var(--line)",
            boxShadow: "inset 0 2px 10px rgba(0,0,0,0.02)",
            overflow: "hidden",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          {filteredThoughts.map((t) => {
            const theme = THEMES[t.color_theme] || THEMES.emerald;
            const pos = positions[t.id] || { x: 200, y: 200 };
            const size = t.is_pinned ? 200 : 176;

            return (
              <div
                key={t.id}
                onPointerDown={(e) => startDrag(t.id, e)}
                onPointerUp={(e) => stopDrag(t.id, t, e)}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: `${size}px`,
                  height: `${size}px`,
                  borderRadius: "50%",
                  transform: `translate3d(${pos.x - size / 2}px, ${pos.y - size / 2}px, 0)`,
                  background: theme.bgGradient,
                  border: `2px solid ${theme.border}`,
                  boxShadow: theme.glow,
                  backdropFilter: "blur(12px)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "18px",
                  boxSizing: "border-box",
                  cursor: "grab",
                  transition: "transform 0.04s linear, box-shadow 0.2s ease",
                  textAlign: "center",
                  willChange: "transform",
                }}
                className="thought-bubble-node"
              >
                {/* 3D Glass Highlight Crescent */}
                <div
                  style={{
                    position: "absolute",
                    top: "12px",
                    left: "20px",
                    width: "48px",
                    height: "24px",
                    borderRadius: "50%",
                    transform: "rotate(-35deg)",
                    background: "radial-gradient(ellipse, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0) 80%)",
                    pointerEvents: "none",
                  }}
                />

                {/* Category Badge */}
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: "600",
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: theme.badgeBg,
                    color: theme.badgeColor,
                    marginBottom: "6px",
                    pointerEvents: "none",
                  }}
                >
                  {t.category}
                </span>

                {/* Summary Quote */}
                <div
                  style={{
                    fontSize: t.is_pinned ? "13px" : "12.5px",
                    fontWeight: "600",
                    color: "var(--ink)",
                    lineHeight: "1.45",
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    pointerEvents: "none",
                    textShadow: "0 1px 2px rgba(255,255,255,0.8)",
                  }}
                >
                  “{t.summary}”
                </div>

                {/* Hover Click Hint */}
                <span
                  style={{
                    fontSize: "10.5px",
                    color: theme.accent,
                    marginTop: "6px",
                    fontWeight: "500",
                    opacity: 0.85,
                    pointerEvents: "none",
                  }}
                >
                  点击查看 ✦
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        /* Bento Cards Grid View */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "16px", marginTop: "8px" }}>
          {filteredThoughts.map((t) => {
            const theme = THEMES[t.color_theme] || THEMES.emerald;
            return (
              <div
                key={t.id}
                onClick={() => setActiveThought(t)}
                style={{
                  background: "var(--surface)",
                  borderRadius: "16px",
                  border: `1.5px solid ${theme.border}`,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  transition: "all 0.18s ease",
                }}
                className="thought-card-item"
              >
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "600",
                        padding: "3px 10px",
                        borderRadius: "9999px",
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
                  <h3 style={{ margin: "0 0 8px", fontSize: "15px", fontWeight: "600", color: "var(--ink)", lineHeight: "1.4" }}>
                    “{t.summary}”
                  </h3>
                  <p style={{ margin: 0, fontSize: "12.5px", color: "var(--ink-3)", lineHeight: "1.5", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                    {t.content || "点击卡片补充详细思考与背景推导。"}
                  </p>
                </div>

                <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--line-subtle)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11.5px", color: "var(--ink-4)" }}>
                  <span>{t.created_at ? t.created_at.slice(0, 10) : "思考晶体"}</span>
                  <span style={{ color: theme.accent, fontWeight: "500" }}>展开感悟 →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active Thought Detail Modal */}
      {activeThought && (
        <div className="habit-modal-backdrop" onClick={() => setActiveThought(null)}>
          <div
            className="habit-modal-dialog"
            style={{ maxWidth: "600px", padding: "0" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="habit-modal-header" style={{ padding: "18px 24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: "600",
                    padding: "3px 10px",
                    borderRadius: "9999px",
                    background: (THEMES[activeThought.color_theme] || THEMES.emerald).badgeBg,
                    color: (THEMES[activeThought.color_theme] || THEMES.emerald).badgeColor,
                  }}
                >
                  {activeThought.category}
                </span>
                {activeThought.is_pinned === 1 && (
                  <span style={{ fontSize: "11.5px", color: "#d97706", fontWeight: "600" }}>
                    ⭐️ 核心定海神针
                  </span>
                )}
                <span style={{ fontSize: "12px", color: "var(--ink-4)" }}>
                  {activeThought.created_at ? activeThought.created_at.slice(0, 10) : ""}
                </span>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setActiveThought(null)}
                style={{ border: "none", background: "transparent", fontSize: "18px", cursor: "pointer", color: "var(--ink-3)" }}
              >
                ✕
              </button>
            </div>

            {/* Modal Scroll Body */}
            <div style={{ padding: "20px 24px 28px", maxHeight: "65vh", overflowY: "auto" }}>
              <div
                style={{
                  padding: "16px 20px",
                  borderRadius: "14px",
                  background: (THEMES[activeThought.color_theme] || THEMES.emerald).bgGradient,
                  border: `1.5px solid ${(THEMES[activeThought.color_theme] || THEMES.emerald).border}`,
                  fontSize: "17px",
                  fontWeight: "700",
                  color: "var(--ink)",
                  lineHeight: "1.45",
                  marginBottom: "20px",
                  letterSpacing: "-0.01em",
                }}
              >
                “{activeThought.summary}”
              </div>

              <div style={{ fontSize: "13.5px", color: "var(--ink-2)", lineHeight: "1.7", whiteSpace: "pre-wrap" }}>
                {activeThought.content ? (
                  <MarkdownView source={activeThought.content} />
                ) : (
                  <p style={{ color: "var(--ink-4)", fontStyle: "italic", margin: 0 }}>
                    暂无更详细的背景推导与感悟，可点击下方“编辑思考”进行补充。
                  </p>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div style={{ padding: "14px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-2)" }}>
              <button
                type="button"
                onClick={() => handleDeleteThought(activeThought.id)}
                style={{ border: "none", background: "transparent", color: "var(--danger)", fontSize: "12px", cursor: "pointer" }}
              >
                删除此思考
              </button>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  onClick={() => {
                    setEditForm({
                      id: activeThought.id,
                      summary: activeThought.summary,
                      content: activeThought.content,
                      category: activeThought.category,
                      color_theme: activeThought.color_theme,
                      is_pinned: Boolean(activeThought.is_pinned),
                    });
                    setIsEditing(true);
                  }}
                  className="secondary-button"
                  style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
                >
                  编辑此思考
                </button>
                <button
                  type="button"
                  onClick={() => setActiveThought(null)}
                  className="primary-button"
                  style={{ padding: "6px 16px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Create Modal */}
      {isEditing && (
        <div className="habit-modal-backdrop" onClick={() => setIsEditing(false)}>
          <div
            className="habit-modal-dialog"
            style={{ maxWidth: "520px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="habit-modal-header">
              <div className="modal-title-group">
                <h3 className="modal-title">{editForm.id ? "编辑思考沉淀" : "沉淀新的思考晶体"}</h3>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setIsEditing(false)}
                style={{ border: "none", background: "transparent", fontSize: "18px", cursor: "pointer", color: "var(--ink-3)" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: "14px", maxHeight: "70vh", overflowY: "auto" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--ink)", marginBottom: "6px" }}>
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--ink)", marginBottom: "6px" }}>
                    思考分类
                  </label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                    className="rounded-input"
                    style={{ width: "100%", boxSizing: "border-box" }}
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--ink)", marginBottom: "6px" }}>
                    流光色调
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingTop: "4px" }}>
                    {(Object.keys(THEMES) as Array<Thought["color_theme"]>).map((thm) => (
                      <button
                        key={thm}
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, color_theme: thm }))}
                        style={{
                          width: "24px",
                          height: "24px",
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

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: "10px", background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                <div>
                  <span style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--ink)" }}>置顶为核心定海神针</span>
                  <p style={{ margin: "2px 0 0", fontSize: "11px", color: "var(--ink-3)" }}>气泡体积更大，视觉优先呈现</p>
                </div>
                <input
                  type="checkbox"
                  checked={editForm.is_pinned}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, is_pinned: e.target.checked }))}
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "var(--ink)", marginBottom: "6px" }}>
                  深度感悟与思考推导 <span style={{ fontWeight: "normal", color: "var(--ink-4)" }}>（支持 Markdown）</span>
                </label>
                <textarea
                  rows={6}
                  value={editForm.content}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                  placeholder="记录当时发生的事实、深层心理觉察、逻辑推导以及给未来的终极准则..."
                  className="rounded-input"
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: "1.6" }}
                />
              </div>
            </div>

            <div style={{ padding: "14px 24px", borderTop: "1px solid var(--line)", display: "flex", justifyContent: "flex-end", gap: "10px", background: "var(--surface-2)" }}>
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="secondary-button"
                style={{ padding: "6px 14px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveThought}
                className="primary-button"
                style={{ padding: "6px 18px", fontSize: "12px", borderRadius: "8px", cursor: "pointer" }}
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
