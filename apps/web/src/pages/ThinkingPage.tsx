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

// Subtle, airy soap-bubble color themes with realistic translucent glass glow
const THEMES: Record<
  Thought["color_theme"],
  {
    name: string;
    accent: string;
    rgb: string;
    border: string;
    bgGradient: string;
    glow: string;
    hoverGlow: string;
    pillBg: string;
    pillColor: string;
    bannerBg: string;
  }
> = {
  emerald: {
    name: "翠竹",
    accent: "#059669",
    rgb: "16, 185, 129",
    border: "rgba(16, 185, 129, 0.35)",
    bgGradient: "radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.95) 0%, rgba(209, 250, 229, 0.75) 45%, rgba(110, 231, 183, 0.32) 90%)",
    glow: "0 8px 24px -4px rgba(16, 185, 129, 0.22), inset 0 2px 4px rgba(255, 255, 255, 0.95), inset 0 -2px 6px rgba(16, 185, 129, 0.12)",
    hoverGlow: "0 14px 32px -4px rgba(16, 185, 129, 0.35), inset 0 2px 5px rgba(255, 255, 255, 0.98)",
    pillBg: "rgba(16, 185, 129, 0.12)",
    pillColor: "#047857",
    bannerBg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
  },
  amber: {
    name: "暖杏",
    accent: "#d97706",
    rgb: "245, 158, 11",
    border: "rgba(245, 158, 11, 0.35)",
    bgGradient: "radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.95) 0%, rgba(254, 243, 199, 0.75) 45%, rgba(252, 211, 77, 0.32) 90%)",
    glow: "0 8px 24px -4px rgba(245, 158, 11, 0.22), inset 0 2px 4px rgba(255, 255, 255, 0.95), inset 0 -2px 6px rgba(245, 158, 11, 0.12)",
    hoverGlow: "0 14px 32px -4px rgba(245, 158, 11, 0.35), inset 0 2px 5px rgba(255, 255, 255, 0.98)",
    pillBg: "rgba(245, 158, 11, 0.12)",
    pillColor: "#b45309",
    bannerBg: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
  },
  purple: {
    name: "星河",
    accent: "#8b5cf6",
    rgb: "139, 92, 246",
    border: "rgba(139, 92, 246, 0.35)",
    bgGradient: "radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.95) 0%, rgba(243, 232, 255, 0.75) 45%, rgba(216, 180, 254, 0.32) 90%)",
    glow: "0 8px 24px -4px rgba(139, 92, 246, 0.22), inset 0 2px 4px rgba(255, 255, 255, 0.95), inset 0 -2px 6px rgba(139, 92, 246, 0.12)",
    hoverGlow: "0 14px 32px -4px rgba(139, 92, 246, 0.35), inset 0 2px 5px rgba(255, 255, 255, 0.98)",
    pillBg: "rgba(139, 92, 246, 0.12)",
    pillColor: "#6d28d9",
    bannerBg: "linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%)",
  },
  ocean: {
    name: "青蓝",
    accent: "#0284c7",
    rgb: "14, 165, 233",
    border: "rgba(14, 165, 233, 0.35)",
    bgGradient: "radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.95) 0%, rgba(224, 242, 254, 0.75) 45%, rgba(125, 211, 252, 0.32) 90%)",
    glow: "0 8px 24px -4px rgba(14, 165, 233, 0.22), inset 0 2px 4px rgba(255, 255, 255, 0.95), inset 0 -2px 6px rgba(14, 165, 233, 0.12)",
    hoverGlow: "0 14px 32px -4px rgba(14, 165, 233, 0.35), inset 0 2px 5px rgba(255, 255, 255, 0.98)",
    pillBg: "rgba(14, 165, 233, 0.12)",
    pillColor: "#0369a1",
    bannerBg: "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)",
  },
  sunset: {
    name: "暮霞",
    accent: "#e11d48",
    rgb: "244, 63, 94",
    border: "rgba(244, 63, 94, 0.35)",
    bgGradient: "radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.95) 0%, rgba(255, 228, 230, 0.75) 45%, rgba(253, 164, 175, 0.32) 90%)",
    glow: "0 8px 24px -4px rgba(244, 63, 94, 0.22), inset 0 2px 4px rgba(255, 255, 255, 0.95), inset 0 -2px 6px rgba(244, 63, 94, 0.12)",
    hoverGlow: "0 14px 32px -4px rgba(244, 63, 94, 0.35), inset 0 2px 5px rgba(255, 255, 255, 0.98)",
    pillBg: "rgba(244, 63, 94, 0.12)",
    pillColor: "#be123c",
    bannerBg: "linear-gradient(135deg, #fff1f2 0%, #ffe4e6 100%)",
  },
  aurora: {
    name: "冰曦",
    accent: "#4f46e5",
    rgb: "79, 70, 229",
    border: "rgba(99, 102, 241, 0.35)",
    bgGradient: "radial-gradient(circle at 35% 28%, rgba(255, 255, 255, 0.95) 0%, rgba(238, 242, 255, 0.75) 45%, rgba(199, 210, 254, 0.32) 90%)",
    glow: "0 8px 24px -4px rgba(79, 70, 229, 0.22), inset 0 2px 4px rgba(255, 255, 255, 0.95), inset 0 -2px 6px rgba(79, 70, 229, 0.12)",
    hoverGlow: "0 14px 32px -4px rgba(79, 70, 229, 0.35), inset 0 2px 5px rgba(255, 255, 255, 0.98)",
    pillBg: "rgba(79, 70, 229, 0.12)",
    pillColor: "#4338ca",
    bannerBg: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
  },
};

const CATEGORIES = ["认知模型", "消费防御", "情绪觉察", "战略与学业", "生活哲学"];

export function ThinkingPage({ onNavigate }: { onNavigate?: (route: any) => void }) {
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>("全部");
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
  const mouseRef = useRef<{
    x: number;
    y: number;
    isDown: boolean;
    dragId: string | null;
    offset: { x: number; y: number };
    startPos: { x: number; y: number };
  }>({
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

  // Clean, comfortable bubble sizes:
  // Normal bubble: diameter 118px (radius 59px)
  // Pinned bubble: diameter 136px (radius 68px)
  useEffect(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 540;

    const currentMap = physicsRef.current;
    const newMap = new Map<string, BubblePhysics>();
    const newPositions: { [id: string]: { x: number; y: number } } = {};

    filteredThoughts.forEach((t, i) => {
      const baseRadius = t.is_pinned ? 68 : 59;
      const existing = currentMap.get(t.id);

      if (existing) {
        existing.baseRadius = baseRadius;
        existing.radius = baseRadius;
        newMap.set(t.id, existing);
        newPositions[t.id] = { x: existing.x, y: existing.y };
      } else {
        const cols = Math.max(1, Math.ceil(Math.sqrt(filteredThoughts.length * 1.6)));
        const rows = Math.ceil(filteredThoughts.length / cols);
        const col = i % cols;
        const row = Math.floor(i / cols);

        const slotW = w / cols;
        const slotH = h / rows;

        const x = Math.max(
          baseRadius + 24,
          Math.min(w - baseRadius - 24, slotW * (col + 0.5) + (Math.random() - 0.5) * 20)
        );
        const y = Math.max(
          baseRadius + 24,
          Math.min(h - baseRadius - 24, slotH * (row + 0.5) + (Math.random() - 0.5) * 20)
        );

        const node: BubblePhysics = {
          id: t.id,
          x,
          y,
          // Ethereal, gentle natural drift
          vx: (Math.random() - 0.5) * 0.12,
          vy: (Math.random() - 0.5) * 0.12,
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
  }, [filteredThoughts]);

  // Serene Zen floating loop: ultra-calm, fluid, breathing oscillation
  useEffect(() => {
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
          // Extremely gentle sinusoidal breathing drift
          const timeOffset = now * 0.00045 + i * 2.3;
          n.vx += Math.sin(timeOffset) * 0.003;
          n.vy += Math.cos(timeOffset * 0.85) * 0.003;

          // Strong friction / air damping to maintain peaceful calm
          n.vx *= 0.97;
          n.vy *= 0.97;

          // Strict speed cap at 0.4px/frame
          const spd = Math.hypot(n.vx, n.vy);
          if (spd > 0.4) {
            n.vx = (n.vx / spd) * 0.4;
            n.vy = (n.vy / spd) * 0.4;
          }

          n.x += n.vx;
          n.y += n.vy;

          // Gentle mouse proximity cushion
          const dxMouse = n.x - mouse.x;
          const dyMouse = n.y - mouse.y;
          const distMouse = Math.hypot(dxMouse, dyMouse);
          if (distMouse < n.radius + 35 && distMouse > 1) {
            const push = (1 - distMouse / (n.radius + 35)) * 0.15;
            n.vx += (dxMouse / distMouse) * push;
            n.vy += (dyMouse / distMouse) * push;
          }

          // Soft boundary containment
          if (n.x - n.radius < 18) {
            n.x = n.radius + 18;
            n.vx = Math.abs(n.vx) * 0.6;
          } else if (n.x + n.radius > w - 18) {
            n.x = w - n.radius - 18;
            n.vx = -Math.abs(n.vx) * 0.6;
          }
          if (n.y - n.radius < 18) {
            n.y = n.radius + 18;
            n.vy = Math.abs(n.vy) * 0.6;
          } else if (n.y + n.radius > h - 18) {
            n.y = h - n.radius - 18;
            n.vy = -Math.abs(n.vy) * 0.6;
          }
        }

        // Soft inter-bubble repulsive cushion (prevent harsh collisions)
        for (let j = i + 1; j < nodes.length; j++) {
          const m = nodes[j];
          const dx = m.x - n.x;
          const dy = m.y - n.y;
          const dist = Math.hypot(dx, dy);
          const minDist = n.radius + m.radius + 14;
          if (dist < minDist && dist > 0.1) {
            const overlap = (minDist - dist) * 0.035;
            const nx = dx / dist;
            const ny = dy / dist;
            if (!n.isDragging) {
              n.x -= nx * overlap;
              n.y -= ny * overlap;
              n.vx -= nx * 0.025;
              n.vy -= ny * 0.025;
            }
            if (!m.isDragging) {
              m.x += nx * overlap;
              m.y += ny * overlap;
              m.vx += nx * 0.025;
              m.vy += ny * 0.025;
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
  }, []);

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
        // Pure click triggers card opening
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
    <div className="page-stack" style={{ padding: "0 28px 32px", maxWidth: "1200px", margin: "0 auto" }}>
      {/* 
        1. SIMPLIFIED & BEAUTIFIED HEADER 
        Clean, quiet, Apple-grade aesthetic
      */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: "24px",
          paddingBottom: "16px",
          borderBottom: "1px solid rgba(226, 232, 240, 0.8)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "12px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "20px",
              fontWeight: "700",
              color: "#0f172a",
              letterSpacing: "-0.02em",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "20px" }}>🫧</span>
            <span>思考</span>
          </h1>
          <span style={{ fontSize: "12.5px", color: "#64748b" }}>
            触碰气泡重温认知锚点 · 点击弹出感悟小卡片
          </span>
        </div>

        {/* Single Prominent Action */}
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
            padding: "6px 14px",
            borderRadius: "999px",
            fontSize: "12.5px",
            fontWeight: "600",
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(16, 185, 129, 0.2)",
          }}
        >
          <span>+</span>
          <span>记下感悟</span>
        </button>
      </div>

      {/* 
        2. CLEAN MINIMAL CATEGORY FILTER 
      */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          margin: "12px 0 16px",
          overflowX: "auto",
        }}
      >
        {allCategories.map((cat) => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              style={{
                border: "none",
                background: isSelected ? "#0f172a" : "rgba(241, 245, 249, 0.8)",
                color: isSelected ? "#ffffff" : "#64748b",
                fontWeight: isSelected ? "600" : "500",
                fontSize: "12px",
                padding: "4px 12px",
                borderRadius: "999px",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* 
        3. ETHEREAL FLOATING BUBBLE SANCTUARY 
      */}
      {loading ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "460px",
            color: "#94a3b8",
            fontSize: "13.5px",
          }}
        >
          正在唤醒思考晶体...
        </div>
      ) : filteredThoughts.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "460px",
            color: "#94a3b8",
          }}
        >
          <span style={{ fontSize: "36px", marginBottom: "8px" }}>🫧</span>
          <p style={{ margin: 0, fontSize: "14px", color: "#64748b" }}>暂无该分类的思考气泡</p>
          <p style={{ margin: "4px 0 0", fontSize: "12px" }}>点击右上角“记下感悟”，随时捕捉生活与内耗中的定海神针</p>
        </div>
      ) : (
        <div
          ref={containerRef}
          onPointerMove={handleContainerPointerMove}
          style={{
            position: "relative",
            width: "100%",
            height: "calc(100vh - 210px)",
            minHeight: "520px",
            // Gentle ambient gradient background
            background: "radial-gradient(ellipse at 50% 30%, #fdfdfe 0%, #f8fafc 55%, #f1f5f9 100%)",
            borderRadius: "24px",
            border: "1px solid rgba(226, 232, 240, 0.8)",
            boxShadow: "inset 0 1px 3px rgba(0,0,0,0.015), 0 4px 20px -2px rgba(0,0,0,0.03)",
            overflow: "hidden",
            userSelect: "none",
            touchAction: "none",
          }}
        >
          {/* Ambient Lighting Orbs */}
          <div
            style={{
              position: "absolute",
              top: "12%",
              left: "18%",
              width: "320px",
              height: "320px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(167, 243, 208, 0.25) 0%, rgba(255,255,255,0) 70%)",
              filter: "blur(48px)",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "15%",
              right: "20%",
              width: "340px",
              height: "340px",
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(216, 180, 254, 0.22) 0%, rgba(255,255,255,0) 70%)",
              filter: "blur(52px)",
              pointerEvents: "none",
            }}
          />

          {/* Clean, Luminous Soap Bubbles */}
          {filteredThoughts.map((t) => {
            const theme = THEMES[t.color_theme] || THEMES.emerald;
            const pos = positions[t.id] || { x: 200, y: 200 };
            const isHovered = hoveredId === t.id;
            const size = t.is_pinned ? 136 : 118;

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
                  transform: `translate3d(${pos.x - size / 2}px, ${pos.y - size / 2}px, 0) scale(${isHovered ? 1.06 : 1})`,
                  background: theme.bgGradient,
                  border: `1.5px solid ${theme.border}`,
                  boxShadow: isHovered ? theme.hoverGlow : theme.glow,
                  backdropFilter: "blur(10px) saturate(160%)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "14px 16px",
                  boxSizing: "border-box",
                  cursor: "pointer",
                  transition: "transform 0.16s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease",
                  textAlign: "center",
                  willChange: "transform",
                  zIndex: isHovered ? 10 : 2,
                }}
              >
                {/* 3D Natural Specular Reflection Highlight */}
                <div
                  style={{
                    position: "absolute",
                    top: "12%",
                    left: "18%",
                    width: "36%",
                    height: "22%",
                    borderRadius: "50%",
                    transform: "rotate(-32deg)",
                    background: "radial-gradient(ellipse, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0) 80%)",
                    pointerEvents: "none",
                  }}
                />

                {/* Subtle Pin Indicator */}
                {t.is_pinned === 1 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "8px",
                      fontSize: "11px",
                      color: "#d97706",
                      lineHeight: 1,
                      pointerEvents: "none",
                    }}
                  >
                    ★
                  </div>
                )}

                {/* Pure, Elegant Summary Text (RADICALLY SIMPLIFIED) */}
                <div
                  style={{
                    fontSize: t.is_pinned ? "12px" : "11.5px",
                    fontWeight: "600",
                    color: "#0f172a",
                    lineHeight: "1.45",
                    letterSpacing: "-0.01em",
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: "vertical",
                    pointerEvents: "none",
                    userSelect: "none",
                    textShadow: "0 1px 2px rgba(255, 255, 255, 0.9)",
                  }}
                >
                  {t.summary}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 
        4. ELEGANT REFLECTION CARD MODAL ("小卡片")
        Minimal, distraction-free, Apple Notes / Linear style
      */}
      {activeThought && (
        <div
          className="habit-modal-backdrop"
          onClick={() => setActiveThought(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(8px)",
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
              maxWidth: "460px",
              width: "100%",
              background: "#ffffff",
              borderRadius: "22px",
              border: "1px solid rgba(226, 232, 240, 0.8)",
              boxShadow: "0 24px 64px -12px rgba(15, 23, 42, 0.22), 0 4px 16px rgba(0, 0, 0, 0.04)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              animation: "modalDialogZoomIn 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {/* Top Minimal Header */}
            <div
              style={{
                padding: "16px 20px 14px",
                background: (THEMES[activeThought.color_theme] || THEMES.emerald).bannerBg,
                borderBottom: "1px solid rgba(226, 232, 240, 0.8)",
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
                    background: (THEMES[activeThought.color_theme] || THEMES.emerald).pillBg,
                    color: (THEMES[activeThought.color_theme] || THEMES.emerald).pillColor,
                  }}
                >
                  {activeThought.category}
                </span>
                {activeThought.is_pinned === 1 && (
                  <span style={{ fontSize: "11px", color: "#d97706", fontWeight: "600" }}>
                    ★ 核心定海神针
                  </span>
                )}
                <span style={{ fontSize: "11.5px", color: "#64748b" }}>
                  {activeThought.created_at ? activeThought.created_at.slice(0, 10) : ""}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setActiveThought(null)}
                style={{
                  border: "none",
                  background: "rgba(0, 0, 0, 0.05)",
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "13px",
                  cursor: "pointer",
                  color: "#64748b",
                  transition: "background 0.14s ease",
                }}
              >
                ✕
              </button>
            </div>

            {/* Golden Rule Summary */}
            <div style={{ padding: "18px 22px 12px", borderBottom: "1px solid rgba(241, 245, 249, 0.8)" }}>
              <div
                style={{
                  fontSize: "16px",
                  fontWeight: "700",
                  color: "#0f172a",
                  lineHeight: "1.45",
                  letterSpacing: "-0.01em",
                }}
              >
                “{activeThought.summary}”
              </div>
            </div>

            {/* Thought Reflections & Markdown Body */}
            <div style={{ padding: "16px 22px 20px", maxHeight: "50vh", overflowY: "auto" }}>
              <div style={{ fontSize: "13px", color: "#334155", lineHeight: "1.7" }}>
                {activeThought.content && activeThought.content.trim() ? (
                  <MarkdownView content={activeThought.content} />
                ) : (
                  <p style={{ color: "#94a3b8", fontStyle: "italic", margin: 0 }}>
                    暂无展开感悟，可点击下方“编辑”补充详细背景与推导。
                  </p>
                )}
              </div>
            </div>

            {/* Card Footer Actions */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid rgba(241, 245, 249, 0.9)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "#f8fafc",
              }}
            >
              <button
                type="button"
                onClick={() => handleDeleteThought(activeThought.id)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "#ef4444",
                  fontSize: "12px",
                  cursor: "pointer",
                  padding: "4px 8px",
                }}
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

      {/* 
        5. MINIMAL EDIT / CREATE MODAL
      */}
      {isEditing && (
        <div
          className="habit-modal-backdrop"
          onClick={() => setIsEditing(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.4)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
        >
          <div
            className="habit-modal-dialog"
            style={{ maxWidth: "460px", borderRadius: "20px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="habit-modal-header" style={{ padding: "16px 20px" }}>
              <div className="modal-title-group">
                <h3 className="modal-title" style={{ fontSize: "15.5px" }}>
                  {editForm.id ? "编辑思考" : "记下新感悟"}
                </h3>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setIsEditing(false)}
                style={{ border: "none", background: "transparent", fontSize: "15px", cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "65vh", overflowY: "auto" }}>
              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "#0f172a", marginBottom: "5px" }}>
                  总结金句 <span style={{ fontWeight: "normal", color: "#64748b" }}>（气泡核心外显）</span>
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
                  <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "#0f172a", marginBottom: "5px" }}>
                    分类
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
                  <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "#0f172a", marginBottom: "5px" }}>
                    彩泡色调
                  </label>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", paddingTop: "5px" }}>
                    {(Object.keys(THEMES) as Array<Thought["color_theme"]>).map((thm) => (
                      <button
                        key={thm}
                        type="button"
                        onClick={() => setEditForm((prev) => ({ ...prev, color_theme: thm }))}
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          background: THEMES[thm].accent,
                          border: editForm.color_theme === thm ? "2.5px solid #0f172a" : "2px solid transparent",
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

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: "10px",
                  background: "#f8fafc",
                  border: "1px solid rgba(226, 232, 240, 0.8)",
                }}
              >
                <div>
                  <span style={{ fontSize: "12px", fontWeight: "600", color: "#0f172a" }}>置顶为定海神针</span>
                  <p style={{ margin: "1px 0 0", fontSize: "11px", color: "#64748b" }}>气泡略大并带有星标，核心呈现</p>
                </div>
                <input
                  type="checkbox"
                  checked={editForm.is_pinned}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, is_pinned: e.target.checked }))}
                  style={{ width: "15px", height: "15px", cursor: "pointer" }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "11.5px", fontWeight: "600", color: "#0f172a", marginBottom: "5px" }}>
                  感悟与推导 <span style={{ fontWeight: "normal", color: "#94a3b8" }}>（支持 Markdown）</span>
                </label>
                <textarea
                  rows={5}
                  value={editForm.content}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                  placeholder="记录发生的事情、心智觉察、逻辑推导以及给未来的原则..."
                  className="rounded-input"
                  style={{ width: "100%", boxSizing: "border-box", resize: "vertical", lineHeight: "1.55", fontSize: "12.5px" }}
                />
              </div>
            </div>

            <div style={{ padding: "12px 20px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "flex-end", gap: "8px", background: "#f8fafc" }}>
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
                保存感悟
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
