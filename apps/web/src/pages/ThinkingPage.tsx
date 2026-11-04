import { useEffect, useRef, useState, useMemo } from "react";
import { apiJson } from "../lib/api.js";
import { MarkdownView } from "../components/MarkdownView.js";

export type Thought = {
  id: string;
  summary: string;
  content: string;
  category: string;
  color_theme: "ocean" | "emerald" | "amber" | "purple" | "sunset" | "aurora";
  bubble_size: number;
  is_pinned: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type BubbleNode = {
  id: string;
  thought: Thought;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseRadius: number;
  isHovered: boolean;
  isDragging: boolean;
};

const THEMES: Record<
  Thought["color_theme"],
  {
    name: string;
    border: string;
    glow: string;
    fillGradient: [string, string, string];
    badgeBg: string;
    badgeText: string;
    accent: string;
  }
> = {
  emerald: {
    name: "翠玉流光",
    border: "rgba(52, 211, 153, 0.45)",
    glow: "rgba(16, 185, 129, 0.28)",
    fillGradient: ["rgba(16, 185, 129, 0.22)", "rgba(20, 184, 166, 0.18)", "rgba(6, 182, 212, 0.12)"],
    badgeBg: "rgba(16, 185, 129, 0.18)",
    badgeText: "#34d399",
    accent: "#10b981",
  },
  amber: {
    name: "琥珀暖金",
    border: "rgba(251, 191, 36, 0.45)",
    glow: "rgba(245, 158, 11, 0.28)",
    fillGradient: ["rgba(245, 158, 11, 0.24)", "rgba(251, 146, 60, 0.18)", "rgba(234, 179, 8, 0.12)"],
    badgeBg: "rgba(245, 158, 11, 0.18)",
    badgeText: "#fbbf24",
    accent: "#f59e0b",
  },
  purple: {
    name: "星河幻紫",
    border: "rgba(192, 132, 252, 0.45)",
    glow: "rgba(168, 85, 247, 0.28)",
    fillGradient: ["rgba(168, 85, 247, 0.24)", "rgba(217, 70, 239, 0.18)", "rgba(99, 102, 241, 0.12)"],
    badgeBg: "rgba(168, 85, 247, 0.18)",
    badgeText: "#c084fc",
    accent: "#a855f7",
  },
  ocean: {
    name: "深海青蓝",
    border: "rgba(56, 189, 248, 0.45)",
    glow: "rgba(14, 165, 233, 0.28)",
    fillGradient: ["rgba(14, 165, 233, 0.24)", "rgba(6, 182, 212, 0.18)", "rgba(59, 130, 246, 0.12)"],
    badgeBg: "rgba(14, 165, 233, 0.18)",
    badgeText: "#38bdf8",
    accent: "#0ea5e9",
  },
  sunset: {
    name: "晚霞绯红",
    border: "rgba(251, 113, 133, 0.45)",
    glow: "rgba(244, 63, 94, 0.28)",
    fillGradient: ["rgba(244, 63, 94, 0.24)", "rgba(236, 72, 153, 0.18)", "rgba(249, 115, 22, 0.12)"],
    badgeBg: "rgba(244, 63, 94, 0.18)",
    badgeText: "#fb7185",
    accent: "#f43f5e",
  },
  aurora: {
    name: "极光绚彩",
    border: "rgba(129, 140, 248, 0.45)",
    glow: "rgba(99, 102, 241, 0.28)",
    fillGradient: ["rgba(99, 102, 241, 0.24)", "rgba(45, 212, 191, 0.18)", "rgba(244, 114, 182, 0.12)"],
    badgeBg: "rgba(99, 102, 241, 0.18)",
    badgeText: "#818cf8",
    accent: "#6366f1",
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
    color_theme: "ocean",
    is_pinned: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const mouseRef = useRef<{ x: number; y: number; isDown: boolean; dragNode: BubbleNode | null; dragOffset: { x: number; y: number } }>({
    x: -1000,
    y: -1000,
    isDown: false,
    dragNode: null,
    dragOffset: { x: 0, y: 0 },
  });

  // Load thoughts from API
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

  // Sync physics nodes whenever filteredThoughts or container dimension changes
  useEffect(() => {
    if (viewMode !== "bubbles" || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const width = rect.width || 800;
    const height = rect.height || 600;

    const existingMap = new Map<string, BubbleNode>();
    for (const n of nodesRef.current) {
      existingMap.set(n.id, n);
    }

    const newNodes: BubbleNode[] = filteredThoughts.map((t, idx) => {
      const existing = existingMap.get(t.id);
      // Pinned thoughts get bigger radius
      const baseRadius = t.is_pinned ? 100 : t.bubble_size === 3 ? 92 : t.bubble_size === 1 ? 72 : 82;
      if (existing) {
        existing.thought = t;
        existing.baseRadius = baseRadius;
        return existing;
      }

      // Distribute nicely across the screen
      const cols = Math.ceil(Math.sqrt(filteredThoughts.length)) || 1;
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      const cellW = width / cols;
      const cellH = height / (Math.ceil(filteredThoughts.length / cols) || 1);

      const spawnX = Math.max(baseRadius + 20, Math.min(width - baseRadius - 20, cellW * (col + 0.5) + (Math.random() - 0.5) * 40));
      const spawnY = Math.max(baseRadius + 20, Math.min(height - baseRadius - 20, cellH * (row + 0.5) + (Math.random() - 0.5) * 40));

      return {
        id: t.id,
        thought: t,
        x: spawnX,
        y: spawnY,
        vx: (Math.random() - 0.5) * 0.7,
        vy: (Math.random() - 0.5) * 0.7,
        radius: baseRadius,
        baseRadius,
        isHovered: false,
        isDragging: false,
      };
    });

    nodesRef.current = newNodes;
  }, [filteredThoughts, viewMode]);

  // Interactive Physics Animation Loop
  useEffect(() => {
    if (viewMode !== "bubbles") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let lastTime = performance.now();

    function resizeCanvas() {
      if (!canvas || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx?.scale(dpr, dpr);
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    function loop(now: number) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      if (!containerRef.current || !canvas) {
        animId = requestAnimationFrame(loop);
        return;
      }

      const rect = containerRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, width, height);

      const nodes = nodesRef.current;
      const mouse = mouseRef.current;

      // Physics update
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];

        if (n.isDragging) {
          n.x = mouse.x - mouse.dragOffset.x;
          n.y = mouse.y - mouse.dragOffset.y;
          n.vx = 0;
          n.vy = 0;
        } else {
          // Gentle floating oscillation
          const floatTime = now * 0.0015 + i;
          n.vx += Math.sin(floatTime) * 0.015;
          n.vy += Math.cos(floatTime * 0.8) * 0.015;

          // Drag / friction
          n.vx *= 0.985;
          n.vy *= 0.985;

          // Clamp speed
          const speed = Math.hypot(n.vx, n.vy);
          if (speed > 2.2) {
            n.vx = (n.vx / speed) * 2.2;
            n.vy = (n.vy / speed) * 2.2;
          }

          n.x += n.vx;
          n.y += n.vy;

          // Mouse proximity gentle push
          const dxMouse = n.x - mouse.x;
          const dyMouse = n.y - mouse.y;
          const distMouse = Math.hypot(dxMouse, dyMouse);
          if (distMouse < n.radius + 60 && distMouse > 1) {
            const force = (1 - distMouse / (n.radius + 60)) * 0.6;
            n.vx += (dxMouse / distMouse) * force;
            n.vy += (dyMouse / distMouse) * force;
          }

          // Wall bouncing
          if (n.x - n.radius < 10) {
            n.x = n.radius + 10;
            n.vx = Math.abs(n.vx) * 0.8;
          } else if (n.x + n.radius > width - 10) {
            n.x = width - n.radius - 10;
            n.vx = -Math.abs(n.vx) * 0.8;
          }
          if (n.y - n.radius < 10) {
            n.y = n.radius + 10;
            n.vy = Math.abs(n.vy) * 0.8;
          } else if (n.y + n.radius > height - 10) {
            n.y = height - n.radius - 10;
            n.vy = -Math.abs(n.vy) * 0.8;
          }
        }

        // Soft repulsion between bubbles
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
              n.vx -= nx * 0.05;
              n.vy -= ny * 0.05;
            }
            if (!m.isDragging) {
              m.x += nx * overlap;
              m.y += ny * overlap;
              m.vx += nx * 0.05;
              m.vy += ny * 0.05;
            }
          }
        }

        // Smooth radius transition for hover
        const targetR = n.isHovered ? n.baseRadius * 1.08 : n.baseRadius;
        n.radius += (targetR - n.radius) * 0.15;
      }

      // Render bubbles
      for (const n of nodes) {
        const theme = THEMES[n.thought.color_theme] || THEMES.ocean;

        ctx.save();
        ctx.translate(n.x, n.y);

        // 1. Outer ambient glow
        ctx.beginPath();
        ctx.arc(0, 0, n.radius + (n.isHovered ? 14 : 6), 0, Math.PI * 2);
        ctx.fillStyle = theme.glow;
        ctx.filter = `blur(${n.isHovered ? 18 : 10}px)`;
        ctx.fill();
        ctx.filter = "none";

        // 2. Main fluid translucent bubble body
        ctx.beginPath();
        ctx.arc(0, 0, n.radius, 0, Math.PI * 2);

        const grad = ctx.createRadialGradient(-n.radius * 0.35, -n.radius * 0.35, n.radius * 0.1, 0, 0, n.radius);
        grad.addColorStop(0, theme.fillGradient[0]);
        grad.addColorStop(0.55, theme.fillGradient[1]);
        grad.addColorStop(1, theme.fillGradient[2]);
        ctx.fillStyle = grad;
        ctx.fill();

        // 3. Shimmering border
        ctx.lineWidth = n.thought.is_pinned ? 2.5 : n.isHovered ? 2.2 : 1.4;
        ctx.strokeStyle = n.isHovered ? "rgba(255, 255, 255, 0.85)" : theme.border;
        ctx.stroke();

        // 4. Specular highlight (top-left glass reflection curve)
        ctx.beginPath();
        ctx.ellipse(-n.radius * 0.35, -n.radius * 0.42, n.radius * 0.45, n.radius * 0.22, -Math.PI / 4.5, 0, Math.PI * 2);
        const specGrad = ctx.createLinearGradient(-n.radius * 0.6, -n.radius * 0.6, 0, 0);
        specGrad.addColorStop(0, "rgba(255, 255, 255, 0.45)");
        specGrad.addColorStop(1, "rgba(255, 255, 255, 0.0)");
        ctx.fillStyle = specGrad;
        ctx.fill();

        // 5. Category pill badge
        const badgeText = n.thought.category;
        ctx.font = "600 11px system-ui, -apple-system, sans-serif";
        const badgeW = ctx.measureText(badgeText).width + 14;
        const badgeH = 18;
        const badgeY = -n.radius * 0.52;

        ctx.beginPath();
        ctx.roundRect(-badgeW / 2, badgeY, badgeW, badgeH, 9);
        ctx.fillStyle = theme.badgeBg;
        ctx.fill();
        ctx.strokeStyle = theme.border;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = theme.badgeText;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, 0, badgeY + badgeH / 2);

        // 6. Summary quote text in center (auto-wrapped)
        const summaryText = n.thought.summary;
        ctx.font = n.thought.is_pinned ? "600 13px system-ui, -apple-system, sans-serif" : "500 12.5px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const maxLineW = n.radius * 1.5;
        const words = summaryText.split("");
        const lines: string[] = [];
        let curLine = "";

        for (const char of words) {
          const testLine = curLine + char;
          if (ctx.measureText(testLine).width > maxLineW && curLine.length > 0) {
            lines.push(curLine);
            curLine = char;
          } else {
            curLine = testLine;
          }
        }
        if (curLine) lines.push(curLine);

        const displayedLines = lines.slice(0, 3);
        const lineHeight = 17;
        const textStartY = 8 - ((displayedLines.length - 1) * lineHeight) / 2;

        for (let li = 0; li < displayedLines.length; li++) {
          let lineStr = displayedLines[li];
          if (li === 2 && lines.length > 3) {
            lineStr = lineStr.slice(0, -1) + "…";
          }
          // Subtle text shadow
          ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
          ctx.shadowBlur = 4;
          ctx.fillText(lineStr, 0, textStartY + li * lineHeight);
          ctx.shadowBlur = 0;
        }

        // 7. Hover click hint
        if (n.isHovered) {
          ctx.font = "500 10.5px system-ui, -apple-system, sans-serif";
          ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
          ctx.fillText("✦ 展开感悟", 0, n.radius * 0.62);
        }

        ctx.restore();
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [viewMode]);

  // Pointer & Drag Handlers for Canvas
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    mouseRef.current.x = x;
    mouseRef.current.y = y;
    mouseRef.current.isDown = true;

    // Hit test top-most bubble
    let hit: BubbleNode | null = null;
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      if (Math.hypot(n.x - x, n.y - y) <= n.radius) {
        hit = n;
        break;
      }
    }

    if (hit) {
      hit.isDragging = true;
      mouseRef.current.dragNode = hit;
      mouseRef.current.dragOffset = { x: x - hit.x, y: y - hit.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    mouseRef.current.x = x;
    mouseRef.current.y = y;

    if (!mouseRef.current.isDown) {
      // Update hover state
      let anyHovered = false;
      for (let i = nodesRef.current.length - 1; i >= 0; i--) {
        const n = nodesRef.current[i];
        const isHit = Math.hypot(n.x - x, n.y - y) <= n.radius;
        if (isHit && !anyHovered) {
          n.isHovered = true;
          anyHovered = true;
        } else {
          n.isHovered = false;
        }
      }
      if (canvasRef.current) {
        canvasRef.current.style.cursor = anyHovered ? "pointer" : "default";
      }
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mouseRef.current.dragNode) {
      const dragged = mouseRef.current.dragNode;
      dragged.isDragging = false;

      // Click detected if mouse didn't drag far
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dist = Math.hypot(x - (dragged.x + mouseRef.current.dragOffset.x), y - (dragged.y + mouseRef.current.dragOffset.y));
        if (dist < 8) {
          setActiveThought(dragged.thought);
        }
      }
      mouseRef.current.dragNode = null;
    }
    mouseRef.current.isDown = false;
  }

  // Save new / edited thought
  async function handleSaveThought() {
    if (!editForm.summary.trim()) {
      alert("请输入总结金句");
      return;
    }
    try {
      if (editForm.id) {
        // Update
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
        // Create
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

  // Delete thought
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
    <div className="flex flex-col h-full w-full bg-[#0b0f17] text-slate-100 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#0f172a]/70 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <span className="text-lg">🫧</span>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              思考
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              用真实经历与内耗淬炼出的认知晶体 · 触碰气泡重温定海神针
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          {/* View Mode Toggle */}
          <div className="flex items-center p-1 bg-slate-900/80 rounded-xl border border-white/10 text-xs">
            <button
              onClick={() => setViewMode("bubbles")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "bubbles"
                  ? "bg-gradient-to-r from-indigo-500 to-cyan-500 text-white shadow-md shadow-indigo-500/25"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🫧 灵动气泡
            </button>
            <button
              onClick={() => setViewMode("cards")}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                viewMode === "cards"
                  ? "bg-gradient-to-r from-indigo-500 to-cyan-500 text-white shadow-md shadow-indigo-500/25"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              🗂️ 沉淀卡片
            </button>
          </div>

          {/* New Thought Button */}
          <button
            onClick={() => {
              setEditForm({
                summary: "",
                content: "",
                category: selectedCategory === "全部" ? "认知模型" : selectedCategory,
                color_theme: "ocean",
                is_pinned: false,
              });
              setIsEditing(true);
            }}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 hover:opacity-90 shadow-lg shadow-indigo-500/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0"
          >
            <span>+</span>
            <span>记录新思考</span>
          </button>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center space-x-2 px-6 py-2.5 bg-slate-950/40 border-b border-white/5 overflow-x-auto shrink-0 scrollbar-none z-10">
        <span className="text-xs text-slate-500 mr-2 shrink-0">分类筛选:</span>
        {allCategories.map((cat) => {
          const isSelected = selectedCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs transition-all shrink-0 font-medium ${
                isSelected
                  ? "bg-white/20 text-white border border-white/30 shadow-sm backdrop-blur-md"
                  : "bg-white/5 text-slate-400 hover:text-slate-200 border border-transparent hover:bg-white/10"
              }`}
            >
              {cat}
            </button>
          );
        })}
      </div>

      {/* Main Canvas / Content Container */}
      <div ref={containerRef} className="relative flex-1 w-full h-full overflow-hidden bg-radial from-[#131b2e] via-[#0b0f17] to-[#06090e]">
        {/* Subtle cosmic background dots */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))] pointer-events-none" />

        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            <span className="animate-pulse">正在唤醒思维意识流...</span>
          </div>
        ) : filteredThoughts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <span className="text-4xl mb-3">🫧</span>
            <p className="text-sm">暂无该分类的思考气泡</p>
            <p className="text-xs text-slate-600 mt-1">点击右上角“记录新思考”，为你的心智武器库增添一颗晶体</p>
          </div>
        ) : viewMode === "bubbles" ? (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full block touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        ) : (
          /* Cards Grid View */
          <div className="p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto h-full max-w-7xl mx-auto">
            {filteredThoughts.map((t) => {
              const theme = THEMES[t.color_theme] || THEMES.ocean;
              return (
                <div
                  key={t.id}
                  onClick={() => setActiveThought(t)}
                  className="group relative flex flex-col justify-between p-6 rounded-2xl border bg-slate-900/60 backdrop-blur-xl hover:scale-[1.02] transition-all cursor-pointer shadow-lg hover:shadow-2xl"
                  style={{
                    borderColor: theme.border,
                    boxShadow: `0 8px 30px ${theme.glow}`,
                  }}
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span
                        className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border"
                        style={{
                          backgroundColor: theme.badgeBg,
                          color: theme.badgeText,
                          borderColor: theme.border,
                        }}
                      >
                        {t.category}
                      </span>
                      {t.is_pinned === 1 && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                          ⭐️ 核心晶体
                        </span>
                      )}
                    </div>
                    <h3 className="text-base font-bold text-white mb-3 group-hover:text-cyan-300 transition-colors leading-snug">
                      “{t.summary}”
                    </h3>
                    <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">
                      {t.content || "暂无详细感悟描述，点击卡片补充思考。"}
                    </p>
                  </div>

                  {/* Card Footer */}
                  <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{t.created_at ? t.created_at.slice(0, 10) : "近期"}</span>
                    <span className="text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      查看感悟 →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Thought Detail Modal */}
      {activeThought && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn"
          onClick={() => setActiveThought(null)}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] rounded-3xl p-8 overflow-y-auto bg-slate-900/90 border shadow-2xl backdrop-blur-2xl"
            style={{
              borderColor: (THEMES[activeThought.color_theme] || THEMES.ocean).border,
              boxShadow: `0 20px 60px ${(THEMES[activeThought.color_theme] || THEMES.ocean).glow}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header / Badges */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <span
                  className="text-xs font-semibold px-3 py-1 rounded-full border"
                  style={{
                    backgroundColor: (THEMES[activeThought.color_theme] || THEMES.ocean).badgeBg,
                    color: (THEMES[activeThought.color_theme] || THEMES.ocean).badgeText,
                    borderColor: (THEMES[activeThought.color_theme] || THEMES.ocean).border,
                  }}
                >
                  {activeThought.category}
                </span>
                {activeThought.is_pinned === 1 && (
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                    ⭐️ 核心定海神针
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  {activeThought.created_at ? activeThought.created_at.slice(0, 10) : "思考晶体"}
                </span>
              </div>

              {/* Close Button */}
              <button
                onClick={() => setActiveThought(null)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Core Golden Rule Quote */}
            <div className="mb-6 pb-6 border-b border-white/10">
              <div className="text-2xl font-bold text-white tracking-tight leading-snug">
                “{activeThought.summary}”
              </div>
            </div>

            {/* Detailed Reflections Body */}
            <div className="mb-8 prose prose-invert max-w-none text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
              {activeThought.content ? (
                <MarkdownView source={activeThought.content} />
              ) : (
                <p className="text-slate-500 italic">暂无更详细的背景推导与感悟，可点击下方“编辑思考”进行补充。</p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-white/10">
              <button
                onClick={() => handleDeleteThought(activeThought.id)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-colors"
              >
                删除思考
              </button>

              <div className="flex items-center space-x-3">
                <button
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
                  className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-white/10 hover:bg-white/20 border border-white/15 transition-colors"
                >
                  编辑此思考
                </button>
                <button
                  onClick={() => setActiveThought(null)}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-cyan-500 to-indigo-500 hover:opacity-90 shadow-lg shadow-indigo-500/25 transition-all"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Create Thought Modal */}
      {isEditing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn"
          onClick={() => setIsEditing(false)}
        >
          <div
            className="relative w-full max-w-lg rounded-3xl p-6 bg-slate-900/95 border border-white/15 shadow-2xl backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">
                {editForm.id ? "编辑思考沉淀" : "沉淀新的思考晶体"}
              </h2>
              <button
                onClick={() => setIsEditing(false)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Summary Input */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                核心总结金句 <span className="text-cyan-400 font-normal">（气泡外显，15～25字为宜）</span>
              </label>
              <input
                type="text"
                value={editForm.summary}
                onChange={(e) => setEditForm((prev) => ({ ...prev, summary: e.target.value }))}
                placeholder="例如：人得知足，无实际问题驱动的投入皆是欲望"
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-white/15 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors"
              />
            </div>

            {/* Category & Color Selector */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  思考分类
                </label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950/80 border border-white/15 text-xs text-white focus:outline-none focus:border-cyan-400"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  流光色调
                </label>
                <div className="flex items-center space-x-1.5 pt-1">
                  {(Object.keys(THEMES) as Array<Thought["color_theme"]>).map((thm) => (
                    <button
                      key={thm}
                      type="button"
                      onClick={() => setEditForm((prev) => ({ ...prev, color_theme: thm }))}
                      className={`w-6 h-6 rounded-full border transition-all ${
                        editForm.color_theme === thm ? "scale-125 border-white ring-2 ring-white/40 shadow-lg" : "border-transparent opacity-70 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: THEMES[thm].accent }}
                      title={THEMES[thm].name}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Pinned Toggle */}
            <div className="mb-4 flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
              <div>
                <span className="text-xs font-semibold text-white">置顶高亮为核心晶体</span>
                <p className="text-[11px] text-slate-400">气泡体积更大，在视野中优先呈现</p>
              </div>
              <input
                type="checkbox"
                checked={editForm.is_pinned}
                onChange={(e) => setEditForm((prev) => ({ ...prev, is_pinned: e.target.checked }))}
                className="w-4 h-4 accent-cyan-500 rounded cursor-pointer"
              />
            </div>

            {/* Detailed Content Textarea */}
            <div className="mb-6">
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                深度感悟与思考推导 <span className="text-slate-500 font-normal">（支持 Markdown）</span>
              </label>
              <textarea
                rows={5}
                value={editForm.content}
                onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
                placeholder="记录当时发生的事情、深层心理觉察、逻辑推导以及给未来的终极准则..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-white/15 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-colors leading-relaxed"
              />
            </div>

            {/* Save Button */}
            <div className="flex items-center justify-end space-x-3">
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={handleSaveThought}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-cyan-500 via-indigo-500 to-fuchsia-500 hover:opacity-90 shadow-lg shadow-indigo-500/25 transition-all"
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
