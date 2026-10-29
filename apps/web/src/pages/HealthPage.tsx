import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CellText } from "../components/CellText.js";
import { Checkbox } from "../components/Checkbox.js";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { formatDate } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { shiftYmd, todayYmd } from "../lib/dates.js";

type Health = {
  id?: string;
  log_date: string;
  weight_kg?: number | null;
  bedtime_local?: string | null;
  wake_local?: string | null;
  sleep_duration_minutes?: number | null;
  exercise_note?: string | null;
  disciplined?: number | boolean | null;
};

export type Habit = {
  id: string;
  name: string;
  target_value: number;
  unit: string;
  frequency: string;
  icon: string;
  color: string;
  is_multi_step?: number;
  is_archived: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type HabitLog = {
  id: string;
  habit_id: string;
  log_date: string;
  value: number;
  status: string;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
};

function sleepMinutes(start?: string | null, end?: string | null) {
  if (!start || !end || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return null;
  const startParts = start.split(":").map(Number);
  const endParts = end.split(":").map(Number);
  let minutes = ((endParts[0] ?? 0) * 60 + (endParts[1] ?? 0)) - ((startParts[0] ?? 0) * 60 + (startParts[1] ?? 0));
  if (minutes < 0) minutes += 24 * 60;
  return minutes;
}

function sleepLabel(row: Health) {
  const minutes = row.sleep_duration_minutes ?? sleepMinutes(row.bedtime_local, row.wake_local);
  return minutes === null || minutes === undefined ? "—" : `${(minutes / 60).toFixed(1)} h`;
}

function computeDisciplinedStreak(rows: Health[], today: string): number {
  if (!rows || rows.length === 0) return 0;
  const sorted = [...rows].sort((a, b) => b.log_date.localeCompare(a.log_date));
  const todayRow = sorted.find((r) => r.log_date === today);

  let streak = 0;
  let currentExpectedDate = today;

  if (todayRow) {
    if (Boolean(todayRow.disciplined)) {
      return 0;
    }
    streak = 1;
    currentExpectedDate = shiftYmd(today, -1);
  } else {
    currentExpectedDate = shiftYmd(today, -1);
  }

  while (true) {
    const row = sorted.find((r) => r.log_date === currentExpectedDate);
    if (!row || Boolean(row.disciplined)) {
      break;
    }
    streak++;
    currentExpectedDate = shiftYmd(currentExpectedDate, -1);
  }

  return streak;
}

export function HealthPage() {
  const [logs, setLogs] = useState<Health[]>([]);
  const logsRef = useRef<Health[]>(logs);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([]);
  const [visibleCount, setVisibleCount] = useState(7);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingHabit, setEditingHabit] = useState<Habit | null>(null);

  const today = todayYmd();

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  async function loadHealth() {
    try {
      const result = await apiJson<{ health: Health[] }>(`/health?from=${shiftYmd(today, -90)}&to=${today}`);
      const sorted = [...result.health].sort((left, right) => right.log_date.localeCompare(left.log_date));
      logsRef.current = sorted;
      setLogs(sorted);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "健康记录加载失败");
    }
  }

  async function loadHabits() {
    try {
      const [habitsRes, logsRes] = await Promise.all([
        apiJson<{ habits: Habit[] }>("/habits"),
        apiJson<{ logs: HabitLog[] }>(`/habits/logs?from=${shiftYmd(today, -14)}&to=${today}`)
      ]);
      setHabits(habitsRes.habits || []);
      setHabitLogs(logsRes.logs || []);
    } catch (reason: unknown) {
      console.warn("习惯数据加载错误", reason);
    }
  }

  useEffect(() => {
    void loadHealth();
    void loadHabits();
  }, []);

  async function saveHealth(date: string, patch: Partial<Health>) {
    try {
      const current = logsRef.current.find((row) => row.log_date === date) ?? { log_date: date };
      const next = { ...current, ...patch };
      if ("bedtime_local" in patch || "wake_local" in patch) {
        next.sleep_duration_minutes = sleepMinutes(next.bedtime_local, next.wake_local);
      }

      const updatedLogs = (() => {
        const rows = logsRef.current;
        const exists = rows.some((row) => row.log_date === date);
        return (exists ? rows.map((row) => row.log_date === date ? next : row) : [next, ...rows])
          .sort((left, right) => right.log_date.localeCompare(left.log_date));
      })();
      logsRef.current = updatedLogs;
      setLogs(updatedLogs);

      const payload: Record<string, unknown> = {};
      if ("weight_kg" in patch) {
        payload.weight_kg = patch.weight_kg ?? null;
      }
      if ("bedtime_local" in patch) {
        payload.bedtime_local = patch.bedtime_local || null;
      }
      if ("wake_local" in patch) {
        payload.wake_local = patch.wake_local || null;
      }
      if ("bedtime_local" in patch || "wake_local" in patch) {
        payload.sleep_duration_minutes = next.sleep_duration_minutes;
      }
      if ("exercise_note" in patch) {
        payload.exercise_note = patch.exercise_note ?? null;
      }
      if ("disciplined" in patch) {
        payload.disciplined = patch.disciplined === null || patch.disciplined === undefined ? null : Boolean(patch.disciplined);
      }

      const result = await apiJson<{ health: Health }>(`/health/${date}`, jsonRequest("PUT", payload));
      const saved = { ...result.health, log_date: date };
      setLogs((rows) => {
        const nextRows = rows.map((row) => row.log_date === date ? { ...row, ...saved } : row);
        logsRef.current = nextRows;
        return nextRows;
      });
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "健康记录保存失败");
    }
  }

  async function addToday() {
    if (!logsRef.current.some((row) => row.log_date === today)) await saveHealth(today, { log_date: today });
  }

  function focusToday() {
    const todayRow = document.querySelector<HTMLTableRowElement>(".health-table-panel tbody tr:first-child");
    if (todayRow) {
      todayRow.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const input = todayRow.querySelector<HTMLInputElement>("input.weight-input, input.time-input");
      input?.focus();
      todayRow.classList.add("row-highlight");
      setTimeout(() => todayRow.classList.remove("row-highlight"), 1200);
    }
  }

  async function handleAddOrFocusToday() {
    if (!logsRef.current.some((row) => row.log_date === today)) {
      await saveHealth(today, { log_date: today });
      setTimeout(focusToday, 60);
    } else {
      focusToday();
    }
  }

  async function deleteHealthRecord(date: string) {
    try {
      await apiJson(`/health/${date}`, { method: "DELETE" });
      const nextRows = logsRef.current.filter((row) => row.log_date !== date);
      logsRef.current = nextRows;
      setLogs(nextRows);
      setMessage("已删除这条健康记录");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "健康记录删除失败");
    }
  }

  // Habits Operations
  async function saveHabitLog(habitId: string, date: string, value: number) {
    try {
      const nextVal = Math.max(0, value);
      const habit = habits.find((h) => h.id === habitId);
      const isDone = habit ? nextVal >= habit.target_value : nextVal > 0;
      const status = isDone ? "done" : nextVal > 0 ? "partial" : "undone";

      // Optimistic update
      setHabitLogs((prev) => {
        const exists = prev.some((l) => l.habit_id === habitId && l.log_date === date);
        if (exists) {
          return prev.map((l) => (l.habit_id === habitId && l.log_date === date ? { ...l, value: nextVal, status } : l));
        }
        return [...prev, { id: `temp-${Date.now()}`, habit_id: habitId, log_date: date, value: nextVal, status }];
      });

      await apiJson(`/habits/${habitId}/logs/${date}`, jsonRequest("PUT", { value: nextVal, status }));
      setError(null);
    } catch (reason: unknown) {
      const errMsg = reason instanceof Error ? reason.message : "习惯打卡保存失败";
      setError(errMsg);
      void loadHabits();
    }
  }

  async function handleCreateOrUpdateHabit(data: Partial<Habit>) {
    try {
      if (editingHabit) {
        await apiJson(`/habits/${editingHabit.id}`, jsonRequest("PATCH", data));
        setMessage(`习惯「${data.name || editingHabit.name}」已更新`);
      } else {
        await apiJson("/habits", jsonRequest("POST", data));
        setMessage(`新习惯「${data.name}」创建成功`);
      }
      setModalOpen(false);
      setEditingHabit(null);
      await loadHabits();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "保存习惯失败");
    }
  }

  async function handleDeleteHabit(id: string, name: string) {
    if (!window.confirm(`确定要删除习惯「${name}」吗？历史打卡也将一并移除。`)) return;
    try {
      await apiJson(`/habits/${id}`, { method: "DELETE" });
      setMessage(`习惯「${name}」已删除`);
      await loadHabits();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "删除习惯失败");
    }
  }

  const latestWeight = logs.find((r) => r.weight_kg != null)?.weight_kg;
  const latestSleep = logs[0] ? sleepLabel(logs[0]) : "—";
  const disciplinedStreak = computeDisciplinedStreak(logs, today);
  const hasToday = logs.some((row) => row.log_date === today);
  const visibleLogs = logs.slice(0, visibleCount);
  const hasMore = visibleCount < logs.length;

  // Habit metrics today
  const todayHabitStats = useMemo(() => {
    if (habits.length === 0) return { total: 0, done: 0, rate: 0 };
    let done = 0;
    for (const h of habits) {
      const log = habitLogs.find((l) => l.habit_id === h.id && l.log_date === today);
      if (log && log.value >= h.target_value) {
        done++;
      }
    }
    const rate = Math.round((done / habits.length) * 100);
    return { total: habits.length, done, rate };
  }, [habits, habitLogs, today]);

  return (
    <div className="page-stack page-health">
      <PageHeader meta="长期记录 · 晨起空腹体重、睡眠作息与每日微习惯底盘" title="健康与习惯" />
      {error ? <div className="notice error">{error}</div> : null}
      {message ? <div className="notice">{message}</div> : null}

      <div className="status-strip">
        <div className="status-chip">
          <span className="muted">最新空腹体重</span>
          <strong>{latestWeight ? `${latestWeight} kg` : "—"}</strong>
        </div>
        <div className="status-chip">
          <span className="muted">昨夜睡眠</span>
          <strong>{latestSleep}</strong>
        </div>
        <div className="status-chip" title="连续保持自律天数">
          <span className="muted">已经自律</span>
          <strong style={{ color: disciplinedStreak > 0 ? "var(--ok)" : "var(--warn)" }}>
            {disciplinedStreak} 天
          </strong>
        </div>
        <div className="status-chip" title="今日微习惯达成进度">
          <span className="muted">今日习惯履约</span>
          <strong style={{ color: todayHabitStats.rate >= 80 ? "var(--ok)" : todayHabitStats.rate >= 50 ? "#0284c7" : "var(--warn)" }}>
            {todayHabitStats.done} / {todayHabitStats.total} 项 ({todayHabitStats.rate}%)
          </strong>
        </div>
      </div>

      {/* 1. Health Charts: Weight & Sleep */}
      <HealthChartsGrid logs={logs} />

      {/* 2. Health Table Panel: In accordance with user feedback: "我希望这个板块在身体指标历史记录下面" */}
      <section className="table-panel database-panel health-table-panel">
        <div className="table-panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px 6px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--foreground)" }}>📋 身体指标历史记录</span>
          <span className="muted" style={{ fontSize: "12px" }}>按日期倒序</span>
        </div>
        <DatabaseTable
          empty="还没有健康记录。"
          rows={visibleLogs.map((row) => ({ ...row, id: row.log_date }))}
          columns={[
            { key: "delete", label: "", className: "col-delete", render: (row) => <DeleteButton label={`删除 ${formatDate(row.log_date)} 的健康记录`} onClick={() => void deleteHealthRecord(row.log_date)} /> },
            { key: "date", label: "日期", className: "col-date", render: (row) => <span>{formatDate(row.log_date)}</span> },
            { key: "bed", label: "上床", className: "col-time col-time-bed", render: (row) => <TimeCell ariaLabel={`${formatDate(row.log_date)} 上床时间`} isBedtime value={row.bedtime_local ?? ""} onCommit={(value) => void saveHealth(row.log_date, { bedtime_local: value || null })} /> },
            { key: "sleep", label: "睡眠时长", className: "col-time col-time-sleep", render: (row) => <span className="sleep-duration">{sleepLabel(row)}</span> },
            { key: "wake", label: "起床", className: "col-time col-time-wake", render: (row) => <TimeCell ariaLabel={`${formatDate(row.log_date)} 起床时间`} value={row.wake_local ?? ""} onCommit={(value) => void saveHealth(row.log_date, { wake_local: value || null })} /> },
            { key: "weight", label: "空腹体重", className: "col-number", render: (row) => <WeightCell ariaLabel={`${formatDate(row.log_date)} 今日空腹体重`} value={row.weight_kg} onCommit={(value) => void saveHealth(row.log_date, { weight_kg: value })} /> },
            { key: "exercise", label: "运动与消耗", className: "col-memo", render: (row) => <CellText multiline placeholder="记录运动、体能消耗…" value={row.exercise_note ?? ""} onCommit={(value) => { if (value !== (row.exercise_note ?? "")) void saveHealth(row.log_date, { exercise_note: value }); }} /> },
            { key: "disciplined", label: "是否不自律", className: "col-disciplined", render: (row) => <Checkbox ariaLabel={`${formatDate(row.log_date)} 是否不自律`} checked={Boolean(row.disciplined)} onChange={(checked) => void saveHealth(row.log_date, { disciplined: checked })} /> }
          ]}
          footer={
            <div className="health-table-footer">
              <div className="health-add-box">
                <button
                  type="button"
                  className={`health-add-today-btn ${hasToday ? "is-existing" : ""}`}
                  onClick={() => void handleAddOrFocusToday()}
                >
                  <span className="btn-icon" aria-hidden="true">{hasToday ? "✓" : "+"}</span>
                  <span className="btn-text">
                    {hasToday ? `今日记录已在第一行（${formatDate(today)} · 点击快速定位编辑）` : `添加今天的记录（${formatDate(today)}）`}
                  </span>
                </button>
              </div>
              {(hasMore || visibleCount > 7) && (
                <div className="health-expand-bar">
                  {hasMore && (
                    <>
                      <button
                        type="button"
                        className="health-expand-btn"
                        onClick={() => setVisibleCount((prev) => prev + 15)}
                      >
                        <span aria-hidden="true">▼</span>
                        展开更多历史（+15 天，剩余 {logs.length - visibleCount} 条）
                      </button>
                      {logs.length - visibleCount > 15 && (
                        <button
                          type="button"
                          className="health-expand-btn expand-all"
                          onClick={() => setVisibleCount(logs.length)}
                        >
                          <span aria-hidden="true">▼▼</span>
                          展开全部历史（共 {logs.length} 条）
                        </button>
                      )}
                    </>
                  )}
                  {visibleCount > 7 && (
                    <button
                      type="button"
                      className="health-collapse-btn"
                      onClick={() => setVisibleCount(7)}
                    >
                      <span aria-hidden="true">▲</span>
                      收起至最近 7 天
                    </button>
                  )}
                </div>
              )}
            </div>
          }
        />
      </section>

      {/* 3. Habits Section: Placed strictly UNDER the health table panel */}
      <HabitsSection
        habits={habits}
        habitLogs={habitLogs}
        today={today}
        onSaveLog={saveHabitLog}
        onOpenAdd={() => {
          setEditingHabit(null);
          setModalOpen(true);
        }}
        onOpenEdit={(h) => {
          setEditingHabit(h);
          setModalOpen(true);
        }}
        onDelete={handleDeleteHabit}
      />

      {/* Habit Modal (Create / Edit) - Rendered into document.body with createPortal for true centering */}
      {modalOpen && (
        <HabitModal
          habit={editingHabit}
          onClose={() => {
            setModalOpen(false);
            setEditingHabit(null);
          }}
          onSave={handleCreateOrUpdateHabit}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// HABITS SECTION: Per-Habit Analysis, Multi-step Checkin & Clean Layout
// -------------------------------------------------------------

function HabitsSection({
  habits,
  habitLogs,
  today,
  onSaveLog,
  onOpenAdd,
  onOpenEdit,
  onDelete
}: {
  habits: Habit[];
  habitLogs: HabitLog[];
  today: string;
  onSaveLog: (habitId: string, date: string, value: number) => void;
  onOpenAdd: () => void;
  onOpenEdit: (habit: Habit) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const [showManage, setShowManage] = useState(false);

  // Recent 14 dates array (from 13 days ago to today)
  const dateList = useMemo(() => {
    const list: string[] = [];
    for (let i = 13; i >= 0; i--) {
      list.push(shiftYmd(today, -i));
    }
    return list;
  }, [today]);

  return (
    <section className="habits-section-card">
      <div className="habits-section-header">
        <div className="habits-header-title-box">
          <div className="habits-title-row">
            <span className="habits-section-icon" aria-hidden="true">🌱</span>
            <h2 className="habits-section-title">微习惯底盘与持续履约</h2>
          </div>
          <span className="habits-section-sub">
            独立14天完成率分析 · 单次/多次灵活打卡 · 随时变动
          </span>
        </div>
        <div className="habits-header-actions">
          <button
            type="button"
            className="habits-pill-btn secondary"
            onClick={() => setShowManage((prev) => !prev)}
            title="管理习惯配置"
          >
            {showManage ? "完成管理" : "⚙️ 管理习惯"}
          </button>
          <button
            type="button"
            className="habits-pill-btn primary"
            onClick={onOpenAdd}
          >
            + 新增习惯
          </button>
        </div>
      </div>

      {/* A. Quick Checkin Deck: Single-check, Multi-step Stepper, or Duration Slider */}
      <div className="habits-quick-deck">
        {habits.map((h) => {
          const log = habitLogs.find((l) => l.habit_id === h.id && l.log_date === today);
          const currentVal = log ? log.value : 0;
          const isDone = currentVal >= h.target_value;

          // Three interaction types:
          // 1. Duration slider: unit is "分钟" and target > 1 (e.g. 力训 30分钟, 阅读 45分钟)
          // 2. Multi-step stepper: is_multi_step or (target > 1 with count units)
          // 3. Single binary check: nap (午睡15分钟), single habit (target = 1) -> 睡或者没睡
          const isDuration = h.unit === "分钟" && h.target_value > 1;
          const isMulti = !isDuration && (h.is_multi_step === 1 || (h.target_value > 1 && ["次", "杯", "组", "页", "块"].includes(h.unit)));
          const isNap = h.name.includes("午睡") || h.name.includes("小憩");

          const progressPercent = Math.min(100, Math.round((currentVal / (h.target_value || 1)) * 100));
          const maxSliderMinutes = Math.max(60, Math.ceil((h.target_value * 1.5) / 5) * 5);

          return (
            <div key={h.id} className={`habit-card ${isDone ? "is-done" : ""}`} style={{ "--habit-accent": h.color || "#10b981" } as any}>
              <div className="habit-card-top">
                <span className="habit-icon-badge" style={{ backgroundColor: `${h.color}15`, borderColor: `${h.color}35` }}>
                  {h.icon || "🌱"}
                </span>
                <div className="habit-info">
                  <div className="habit-name-row">
                    <span className="habit-name" title={h.name}>{h.name}</span>
                    {showManage && (
                      <span className="habit-manage-actions">
                        <button type="button" className="habit-icon-btn" onClick={() => onOpenEdit(h)} title="编辑习惯">✎</button>
                        <button type="button" className="habit-icon-btn is-delete" onClick={() => onDelete(h.id, h.name)} title="删除习惯">✕</button>
                      </span>
                    )}
                  </div>
                  <span className="habit-target-hint">
                    {isDuration
                      ? `时长控制 · 目标 ${h.target_value} 分钟`
                      : isMulti
                      ? `计次积累 · 目标 ${h.target_value} ${h.unit}`
                      : `单次达标 · 目标 ${h.target_value} ${h.unit}`}
                  </span>
                </div>
              </div>

              {/* Interaction Mode: 1. Duration Slider */}
              {isDuration && (
                <div className="habit-duration-wrap">
                  <div className="habit-slider-row">
                    <input
                      type="range"
                      className="habit-range-slider"
                      min={0}
                      max={maxSliderMinutes}
                      step={5}
                      value={currentVal}
                      onChange={(e) => onSaveLog(h.id, today, Number(e.target.value))}
                      style={{ accentColor: h.color || "#10b981" }}
                      aria-label={`${h.name} 时长调节`}
                    />
                  </div>
                  <div className="habit-slider-labels">
                    <span className="slider-current-readout">已记录 <strong style={{ color: isDone ? h.color : "inherit" }}>{currentVal}</strong> 分钟</span>
                    <span className="slider-target-hint muted">目标 {h.target_value} 分钟</span>
                  </div>
                  <div className="habit-quick-time-steppers">
                    <button type="button" className="habit-quick-btn" onClick={() => onSaveLog(h.id, today, Math.max(0, currentVal - 5))} title="减少 5 分钟">−5m</button>
                    <button type="button" className="habit-quick-btn" onClick={() => onSaveLog(h.id, today, currentVal + 5)} title="增加 5 分钟">+5m</button>
                    <button type="button" className="habit-quick-btn" onClick={() => onSaveLog(h.id, today, currentVal + 15)} title="增加 15 分钟">+15m</button>
                    <button
                      type="button"
                      className={`habit-quick-btn finish-btn ${isDone ? "is-active" : ""}`}
                      onClick={() => onSaveLog(h.id, today, isDone ? 0 : h.target_value)}
                      title={isDone ? "点击重置为 0" : "直接达到目标"}
                    >
                      {isDone ? "重置" : "直接满额"}
                    </button>
                  </div>
                </div>
              )}

              {/* Interaction Mode: 2. Multi-step Dots Stepper */}
              {isMulti && (
                <div className="habit-multi-dots-wrap">
                  <div className="habit-multi-dots">
                    {Array.from({ length: Math.min(12, Math.max(2, Math.floor(h.target_value))) }).map((_, idx) => {
                      const stepIndex = idx + 1;
                      const isReached = currentVal >= stepIndex;
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`multi-dot-pill ${isReached ? "is-active" : ""}`}
                          style={{
                            backgroundColor: isReached ? h.color : "transparent",
                            borderColor: isReached ? h.color : "var(--line)"
                          }}
                          onClick={() => {
                            if (currentVal === stepIndex) {
                              onSaveLog(h.id, today, stepIndex - 1);
                            } else {
                              onSaveLog(h.id, today, stepIndex);
                            }
                          }}
                          title={`打卡至第 ${stepIndex} ${h.unit}`}
                        >
                          {isReached ? "✓" : stepIndex}
                        </button>
                      );
                    })}
                  </div>
                  <div className="habit-val-label">
                    已完成 <strong>{currentVal}</strong> / {h.target_value} {h.unit}
                  </div>
                </div>
              )}

              {/* Interaction Mode: 3. Single Binary Check (e.g. 午睡15分钟 睡或者没睡) */}
              {!isDuration && !isMulti && (
                <div className="habit-progress-bar-wrap">
                  <div className="habit-progress-track">
                    <div
                      className="habit-progress-fill"
                      style={{ width: `${isDone ? 100 : 0}%`, backgroundColor: h.color || "#10b981" }}
                    />
                  </div>
                  <div className="habit-val-label">
                    状态：<strong style={{ color: isDone ? h.color : "inherit" }}>{isDone ? (isNap ? "已午睡 ✓" : "已达成 ✓") : "未达成"}</strong>
                  </div>
                </div>
              )}

              {/* Main Action Button */}
              <div className="habit-card-actions">
                <button
                  type="button"
                  className={`habit-finish-pill-btn ${isDone ? "is-finished" : ""}`}
                  style={isDone ? { backgroundColor: h.color, borderColor: h.color } : {}}
                  onClick={() => {
                    if (isDuration) {
                      onSaveLog(h.id, today, isDone ? 0 : h.target_value);
                    } else if (isMulti) {
                      if (currentVal >= h.target_value) {
                        onSaveLog(h.id, today, 0); // Reset
                      } else {
                        onSaveLog(h.id, today, currentVal + 1); // +1 step
                      }
                    } else {
                      onSaveLog(h.id, today, isDone ? 0 : 1);
                    }
                  }}
                >
                  {isDone
                    ? `✓ 今日已达成 (${isNap ? "已午睡" : isDuration ? `${currentVal}/${h.target_value}分钟` : `${currentVal}/${h.target_value} ${h.unit}`} · 点击撤销)`
                    : isDuration
                    ? `+ 满额打卡 (${h.target_value}分钟)`
                    : isMulti
                    ? `+ 打卡 1 ${h.unit}`
                    : isNap
                    ? "✓ 睡了（打卡午睡）"
                    : "点击完成打卡"}
                </button>

                {currentVal > 0 && !isDuration && (
                  <button
                    type="button"
                    className="habit-minus-btn"
                    onClick={() => onSaveLog(h.id, today, currentVal - 1)}
                    title="回退 1 次"
                  >
                    −
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {habits.length === 0 && (
          <div className="habits-empty-hint">
            还没有配置习惯。点击右上角「+ 新增习惯」定制专属于你的习惯体系！
          </div>
        )}
      </div>

      {/* B. Per-Habit 14-Day Completion Rate & Footprint Analysis */}
      <PerHabitAnalysisList habits={habits} habitLogs={habitLogs} dateList={dateList} today={today} />
    </section>
  );
}

// -------------------------------------------------------------
// PER-HABIT ANALYSIS: Individual 14-Day Rate & Footprint Track
// -------------------------------------------------------------

function PerHabitAnalysisList({
  habits,
  habitLogs,
  dateList,
  today
}: {
  habits: Habit[];
  habitLogs: HabitLog[];
  dateList: string[];
  today: string;
}) {
  const analysisList = useMemo(() => {
    return habits.map((h) => {
      let streak = 0;
      let checkDate = today;

      // Compute streak backwards
      while (true) {
        const log = habitLogs.find((l) => l.habit_id === h.id && l.log_date === checkDate);
        if (log && log.value >= h.target_value) {
          streak++;
          checkDate = shiftYmd(checkDate, -1);
        } else {
          // If today has not been completed yet, don't break yesterday's streak
          if (checkDate === today && (!log || log.value < h.target_value)) {
            checkDate = shiftYmd(checkDate, -1);
            continue;
          }
          break;
        }
      }

      // Count success days in the 14-day window
      let successDays = 0;
      let totalAmount = 0;
      const days = dateList.map((d) => {
        const log = habitLogs.find((l) => l.habit_id === h.id && l.log_date === d);
        const val = log ? log.value : 0;
        totalAmount += val;
        const isSuccess = val >= h.target_value;
        if (isSuccess) successDays++;
        const status = isSuccess ? "done" : val > 0 ? "partial" : "empty";
        return { date: d, value: val, status };
      });

      const rate = Math.round((successDays / dateList.length) * 100);
      const avgDaily = (totalAmount / dateList.length).toFixed(1);

      return {
        habit: h,
        streak,
        rate,
        successDays,
        avgDaily,
        days
      };
    });
  }, [habits, habitLogs, dateList, today]);

  if (analysisList.length === 0) return null;

  return (
    <div className="per-habit-analysis-container">
      <div className="analysis-header-row">
        <span className="analysis-title">📊 习惯独立 14 天达成率与连续足迹</span>
        <span className="analysis-sub">根据每个习惯独立统计 · 达标天数与近两周习惯足迹</span>
      </div>

      <div className="per-habit-list">
        {analysisList.map(({ habit, streak, rate, successDays, avgDaily, days }) => {
          const rateColor = rate >= 80 ? "var(--ok, #10b981)" : rate >= 50 ? "#0284c7" : "var(--warn, #f59e0b)";

          return (
            <div key={habit.id} className="per-habit-card">
              <div className="per-habit-left">
                <span className="per-habit-icon" style={{ backgroundColor: `${habit.color}15` }}>{habit.icon}</span>
                <div className="per-habit-name-box">
                  <span className="per-habit-name">{habit.name}</span>
                  <span className="per-habit-target">目标：{habit.target_value} {habit.unit} / 天</span>
                </div>
              </div>

              {/* 14-Day Footprint Dots Track */}
              <div className="per-habit-footprint-wrap">
                <div className="footprint-track">
                  {days.map((item) => (
                    <div
                      key={item.date}
                      className={`footprint-dot ${item.status} ${item.date === today ? "is-today" : ""}`}
                      style={{
                        backgroundColor: item.status === "done" ? habit.color : item.status === "partial" ? `${habit.color}45` : "transparent",
                        borderColor: item.status === "empty" ? "var(--line)" : habit.color
                      }}
                      title={`${item.date} ${habit.name}: ${item.value}/${habit.target_value} ${habit.unit} (${item.status === "done" ? "达标" : item.status === "partial" ? "部分" : "未打卡"})`}
                    >
                      <span className="footprint-date-label">{item.date.slice(8)}</span>
                    </div>
                  ))}
                </div>
                <div className="footprint-stats-line">
                  <span>近14天达标 <strong>{successDays}/14 天</strong></span>
                  <span>日均完成 <strong>{avgDaily} {habit.unit}</strong></span>
                </div>
              </div>

              {/* Individual Rate Badge */}
              <div className="per-habit-right">
                <div className="rate-badge-box">
                  <span className="rate-number" style={{ color: rateColor }}>{rate}%</span>
                  <span className="rate-label">14天完成率</span>
                </div>
                <div className="streak-indicator">
                  {streak > 0 ? (
                    <span className="streak-pill">🔥 连胜 {streak} 天</span>
                  ) : (
                    <span className="streak-pill is-zero">今日待续</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// -------------------------------------------------------------
// HABIT MODAL: Centered Dialog with Rounded Modern Controls
// -------------------------------------------------------------

function HabitModal({
  habit,
  onClose,
  onSave
}: {
  habit: Habit | null;
  onClose: () => void;
  onSave: (data: Partial<Habit>) => void;
}) {
  const [name, setName] = useState(habit?.name || "");
  
  // Determine initial mode
  const initialMode = habit
    ? habit.unit === "分钟" && habit.target_value > 1
      ? "duration"
      : habit.is_multi_step === 1 || (habit.target_value > 1 && ["次", "杯", "组"].includes(habit.unit))
      ? "multi"
      : "single"
    : "single";

  const [mode, setMode] = useState<"single" | "multi" | "duration">(initialMode);
  const [targetValue, setTargetValue] = useState(habit?.target_value ? String(habit.target_value) : "1");
  const [unit, setUnit] = useState(habit?.unit || "次");
  const [icon, setIcon] = useState(habit?.icon || "🌱");
  const [color, setColor] = useState(habit?.color || "#10b981");

  const emojiPresets = ["🛌", "👀", "💧", "🪥", "🏃", "📖", "🧘", "🍎", "🍵", "💻", "🎯", "☀️", "🚶", "💪"];
  const colorPresets = [
    { name: "翡翠绿", val: "#10b981" },
    { name: "森林青", val: "#154e3f" },
    { name: "天空蓝", val: "#0ea5e9" },
    { name: "深海青", val: "#06b6d4" },
    { name: "紫罗兰", val: "#8b5cf6" },
    { name: "琥珀金", val: "#f59e0b" },
    { name: "珊瑚粉", val: "#ec4899" }
  ];
  const unitPresets = ["次", "分钟", "杯", "页", "组", "公里"];

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleModeChange(nextMode: "single" | "multi" | "duration") {
    setMode(nextMode);
    if (nextMode === "single") {
      setTargetValue("1");
      setUnit("次");
    } else if (nextMode === "duration") {
      setUnit("分钟");
      if (Number(targetValue) <= 1) setTargetValue("30");
    } else if (nextMode === "multi") {
      if (unit === "分钟") setUnit("次");
      if (Number(targetValue) <= 1) setTargetValue("3");
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const val = Number(targetValue);
    const finalVal = Number.isFinite(val) && val > 0 ? val : 1;
    onSave({
      name: name.trim(),
      target_value: mode === "single" ? 1 : finalVal,
      unit: unit.trim() || (mode === "duration" ? "分钟" : "次"),
      icon: icon.trim() || "🌱",
      color: color || "#10b981",
      is_multi_step: mode === "multi" ? 1 : 0
    });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="habit-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
    >
      <div className="habit-modal-dialog">
        <div className="habit-modal-header">
          <div className="modal-title-group">
            <h3 className="modal-title">{habit ? "编辑习惯" : "新增个性化微习惯"}</h3>
            <span className="modal-subtitle">设定专属于你的每日自律目标</span>
          </div>
          <button
            type="button"
            className="modal-circle-close-btn"
            onClick={onClose}
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="habit-modal-form-wrap">
          {/* Scrollable Modal Body: wheel scroll works smoothly with max-height constraint */}
          <div className="habit-modal-scroll-body">
            <div className="form-field">
              <label className="form-label">习惯名称 *</label>
              <input
                type="text"
                required
                className="form-input rounded-input"
                placeholder="例如：午睡 (15分钟)、力训 (30分钟)、饮水、刷牙…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            {/* 3 Modes: Single, Multi-step, Duration Slider */}
            <div className="form-field">
              <label className="form-label">打卡模式</label>
              <div className="mode-toggle-group-3">
                <button
                  type="button"
                  className={`mode-toggle-pill ${mode === "single" ? "is-active" : ""}`}
                  onClick={() => handleModeChange("single")}
                >
                  <span>⚪ 单次达标</span>
                  <small className="muted">每日1次（如午睡15分钟、走动）</small>
                </button>
                <button
                  type="button"
                  className={`mode-toggle-pill ${mode === "multi" ? "is-active" : ""}`}
                  onClick={() => handleModeChange("multi")}
                >
                  <span>🔵 计次累加</span>
                  <small className="muted">多次分段（如饮水5杯、刷牙3次）</small>
                </button>
                <button
                  type="button"
                  className={`mode-toggle-pill ${mode === "duration" ? "is-active" : ""}`}
                  onClick={() => handleModeChange("duration")}
                >
                  <span>⏱️ 时长滑动</span>
                  <small className="muted">按分钟滑动调节（如力训、阅读）</small>
                </button>
              </div>
            </div>

            {/* If Duration mode: slider preview */}
            {mode === "duration" && (
              <div className="duration-target-box">
                <div className="duration-slider-header">
                  <span className="form-label" style={{ margin: 0 }}>目标时长：<strong style={{ color: color }}>{targetValue} 分钟</strong></span>
                  <div className="duration-chip-steppers">
                    {[15, 30, 45, 60, 90, 120].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        className={`duration-chip-btn ${Number(targetValue) === mins ? "is-active" : ""}`}
                        onClick={() => setTargetValue(String(mins))}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="range"
                  className="habit-modal-range-slider"
                  min={5}
                  max={180}
                  step={5}
                  value={Number(targetValue) || 30}
                  onChange={(e) => setTargetValue(e.target.value)}
                  style={{ accentColor: color }}
                />
              </div>
            )}

            {mode !== "duration" && (
              <div className="form-row">
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="form-label">{mode === "multi" ? "每日目标次数 *" : "目标数值 *"}</label>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    disabled={mode === "single"}
                    required
                    className="form-input rounded-input"
                    value={targetValue}
                    onChange={(e) => setTargetValue(e.target.value)}
                  />
                </div>
                <div className="form-field" style={{ flex: 1 }}>
                  <label className="form-label">计量单位</label>
                  <input
                    type="text"
                    disabled={mode === "single"}
                    className="form-input rounded-input"
                    placeholder="例如：次、杯、组"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </div>
              </div>
            )}

            {mode === "multi" && (
              <div className="preset-chip-row">
                <span className="muted" style={{ fontSize: "12px" }}>常用单位：</span>
                {unitPresets.map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={`preset-chip-pill ${unit === u ? "is-active" : ""}`}
                    onClick={() => setUnit(u)}
                  >
                    {u}
                  </button>
                ))}
              </div>
            )}

            <div className="form-field">
              <label className="form-label">代表 Emoji 图标</label>
              <div className="emoji-preset-grid">
                {emojiPresets.map((em) => (
                  <button
                    key={em}
                    type="button"
                    className={`emoji-pill-btn ${icon === em ? "is-selected" : ""}`}
                    onClick={() => setIcon(em)}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">主题色彩</label>
              <div className="color-preset-row">
                {colorPresets.map((c) => (
                  <button
                    key={c.val}
                    type="button"
                    className={`color-preset-circle ${color === c.val ? "is-selected" : ""}`}
                    style={{ backgroundColor: c.val }}
                    onClick={() => setColor(c.val)}
                    title={c.name}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Sticky Modal Action Footer */}
          <div className="modal-action-footer">
            <button
              type="button"
              className="modal-pill-btn secondary"
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="submit"
              className="modal-pill-btn primary"
            >
              {habit ? "保存修改" : "确认添加"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

// -------------------------------------------------------------
// TABLE CELLS (Weight, Time)
// -------------------------------------------------------------

function TimeCell({ value, ariaLabel, isBedtime, onCommit }: { value: string; ariaLabel: string; isBedtime?: boolean; onCommit: (value: string) => void }) {
  const normalizedValue = typeof value === "string" ? value.slice(0, 5) : "";
  const [draft, setDraft] = useState(normalizedValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current && document.activeElement !== inputRef.current) {
      setDraft(normalizedValue);
    }
  }, [normalizedValue]);

  const bedtimeClass = useMemo(() => {
    if (!isBedtime || !normalizedValue) return "";
    const isSafe = (normalizedValue >= "18:00" && normalizedValue <= "23:59") || (normalizedValue >= "00:00" && normalizedValue <= "00:30");
    return isSafe ? "bedtime-safe" : "bedtime-late";
  }, [isBedtime, normalizedValue]);

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      className={`cell-input time-input ${bedtimeClass}`}
      max="23:59"
      min="00:00"
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={() => {
        isFocusedRef.current = false;
        onCommit(draft);
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(normalizedValue);
          event.currentTarget.blur();
        }
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      step={60}
      type="time"
      value={draft}
    />
  );
}

function WeightCell({ value, ariaLabel, onCommit }: { value?: number | null; ariaLabel: string; onCommit: (value: number | null) => void }) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  const inputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current && document.activeElement !== inputRef.current) {
      setDraft(value === null || value === undefined ? "" : String(value));
    }
  }, [value]);

  function commit() {
    isFocusedRef.current = false;
    if (!draft.trim()) {
      onCommit(null);
      return;
    }
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0 && next <= 500) {
      onCommit(next);
    } else {
      setDraft(value === null || value === undefined ? "" : String(value));
    }
  }

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      className="cell-input weight-input"
      inputMode="decimal"
      onFocus={() => {
        isFocusedRef.current = true;
      }}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value === null || value === undefined ? "" : String(value));
          event.currentTarget.blur();
        }
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      placeholder="kg"
      value={draft}
    />
  );
}

// -------------------------------------------------------------
// HEALTH CHARTS (Weight Area Chart + Sleep Bar Chart)
// -------------------------------------------------------------

function HealthChartsGrid({ logs }: { logs: Health[] }) {
  const chartLogs = useMemo(() => {
    return [...logs].slice(0, 14).reverse();
  }, [logs]);

  // Weight Trend Data
  const weightPoints = useMemo(() => {
    return chartLogs
      .filter((r) => r.weight_kg != null && r.weight_kg > 0)
      .map((r) => ({ date: r.log_date, weight: r.weight_kg! }));
  }, [chartLogs]);

  const weightDiff = useMemo(() => {
    const validWeights = logs.map((r) => r.weight_kg).filter((w): w is number => w != null && w > 0);
    if (validWeights.length < 2) return null;
    return validWeights[0] - validWeights[1];
  }, [logs]);

  // SVG Calculations for Weight Area Chart
  const weightChart = useMemo(() => {
    if (weightPoints.length === 0) return null;
    const weights = weightPoints.map((p) => p.weight);
    const avgWeight = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 0;
    const minW = Math.min(...weights) - 0.4;
    const maxW = Math.max(...weights) + 0.4;
    const rangeW = maxW - minW || 1;

    const width = 420;
    const height = 130;
    const padL = 36;
    const padR = 28;
    const padT = 24;
    const padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const coords = weightPoints.map((p, idx) => {
      const x = padL + (weightPoints.length === 1 ? plotW / 2 : (idx / (weightPoints.length - 1)) * plotW);
      const y = padT + (1 - (p.weight - minW) / rangeW) * plotH;
      return { ...p, x, y };
    });

    const avgY = padT + (1 - (avgWeight - minW) / rangeW) * plotH;

    const lineD = coords.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`, "");
    const areaD = coords.length > 0
      ? `${lineD} L ${coords[coords.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
      : "";

    let minIdx = 0;
    let maxIdx = 0;
    coords.forEach((c, idx) => {
      if (c.weight < coords[minIdx].weight) minIdx = idx;
      if (c.weight > coords[maxIdx].weight) maxIdx = idx;
    });

    return { coords, lineD, areaD, avgY, avgWeight, padL, padR, padT, padB, plotW, plotH, minIdx, maxIdx };
  }, [weightPoints]);

  // Sleep Bar Chart Data
  const sleepChart = useMemo(() => {
    const width = 420;
    const height = 130;
    const padL = 28;
    const padR = 20;
    const padT = 24;
    const padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const items = chartLogs.map((r) => {
      const mins = r.sleep_duration_minutes ?? sleepMinutes(r.bedtime_local, r.wake_local);
      const hours = mins ? mins / 60 : 0;
      const bt = r.bedtime_local;
      const isCompliant = bt ? ((bt >= "18:00" && bt <= "23:59") || (bt >= "00:00" && bt <= "00:30")) : null;
      return {
        date: r.log_date,
        bedtime: bt,
        wake: r.wake_local,
        hours,
        isCompliant
      };
    });

    const maxH = Math.max(9.5, ...items.map((i) => i.hours));
    const count = items.length || 1;
    const slotW = plotW / count;
    const barW = Math.max(8, Math.min(18, slotW * 0.65));

    const bars = items.map((item, idx) => {
      const barH = (item.hours / maxH) * plotH;
      const x = padL + idx * slotW + (slotW - barW) / 2;
      const y = padT + plotH - barH;
      const color = item.isCompliant === false ? "#f59e0b" : "#10b981";
      return { ...item, x, y, barW, barH, color };
    });

    const safeCount = items.filter((i) => i.isCompliant === true).length;
    const totalRecorded = items.filter((i) => i.isCompliant !== null).length;

    return { bars, safeCount, totalRecorded, padL, padR, padT, padB, plotW, plotH };
  }, [chartLogs]);

  return (
    <div className="health-charts-grid">
      {/* Weight Chart */}
      <div className="health-chart-card weight-trend-card">
        <div className="chart-card-header">
          <div className="chart-header-left">
            <span className="chart-card-title">📉 空腹体重走势（近14天）</span>
            <span className="chart-card-sub">{weightChart ? `近14天均值：${weightChart.avgWeight.toFixed(1)} kg` : "均值走势参考"}</span>
          </div>
          {weightDiff != null && (
            <span className={`chart-diff-badge ${weightDiff <= 0 ? "is-ok" : "is-warn"}`}>
              {weightDiff <= 0 ? `↓ ${Math.abs(weightDiff).toFixed(2)} kg` : `↑ ${weightDiff.toFixed(2)} kg`}
            </span>
          )}
        </div>
        <div className="chart-canvas-wrap">
          {weightChart ? (
            <svg viewBox="0 0 420 130" className="health-svg-chart" preserveAspectRatio="none">
              <defs>
                <linearGradient id="weightAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#154e3f" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#154e3f" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              <line
                x1={weightChart.padL}
                y1={weightChart.avgY}
                x2={420 - weightChart.padR}
                y2={weightChart.avgY}
                stroke="#0ea5e9"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text
                x={420 - weightChart.padR}
                y={weightChart.avgY - 4}
                textAnchor="end"
                fontSize="10"
                fontWeight="600"
                fill="#0284c7"
              >
                均值 {weightChart.avgWeight.toFixed(1)}kg
              </text>

              <path d={weightChart.areaD} fill="url(#weightAreaGrad)" />
              <path d={weightChart.lineD} fill="none" stroke="#154e3f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

              {weightChart.coords.map((pt, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === weightChart.coords.length - 1;
                const isExtreme = idx === weightChart.minIdx || idx === weightChart.maxIdx;
                const showLabel = isFirst || isLast || isExtreme;

                return (
                  <g key={pt.date}>
                    <circle cx={pt.x} cy={pt.y} r={showLabel ? 4 : 2.5} fill="#ffffff" stroke="#154e3f" strokeWidth="2" />
                    {showLabel && (
                      <text
                        x={pt.x}
                        y={pt.y - 7}
                        textAnchor="middle"
                        fontSize="10"
                        fontWeight="700"
                        fill="#154e3f"
                        className="svg-weight-val"
                      >
                        {pt.weight}
                      </text>
                    )}
                    {(isFirst || isLast) && (
                      <text
                        x={pt.x}
                        y={130 - 6}
                        textAnchor="middle"
                        fontSize="9"
                        fill="#94a3b8"
                      >
                        {pt.date.slice(5)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="chart-empty-placeholder">暂无近14天空腹体重数据</div>
          )}
        </div>
      </div>

      {/* Sleep Chart */}
      <div className="health-chart-card sleep-trend-card">
        <div className="chart-card-header">
          <div className="chart-header-left">
            <span className="chart-card-title">🌙 睡眠时长与 00:30 底线</span>
            <span className="chart-card-sub">柱色：翠绿 ≤00:30 · 琥珀 &gt;00:30</span>
          </div>
          <span className="chart-diff-badge is-ok">
            准时入睡 {sleepChart.safeCount} 天
          </span>
        </div>
        <div className="chart-canvas-wrap">
          {sleepChart.bars.length > 0 ? (
            <svg viewBox="0 0 420 130" className="health-svg-chart" preserveAspectRatio="none">
              <line
                x1={sleepChart.padL}
                y1={sleepChart.padT + sleepChart.plotH}
                x2={420 - sleepChart.padR}
                y2={sleepChart.padT + sleepChart.plotH}
                stroke="#e2e8f0"
                strokeWidth="1"
              />

              {sleepChart.bars.map((bar) => (
                <g key={bar.date}>
                  {bar.hours > 0 ? (
                    <>
                      <rect
                        x={bar.x}
                        y={bar.y}
                        width={bar.barW}
                        height={Math.max(3, bar.barH)}
                        rx="3"
                        fill={bar.color}
                        opacity={0.88}
                      >
                        <title>{`${bar.date}: 睡眠 ${bar.hours.toFixed(1)}h (上床: ${bar.bedtime || "未记"})`}</title>
                      </rect>
                      <text
                        x={bar.x + bar.barW / 2}
                        y={Math.max(12, bar.y - 4)}
                        textAnchor="middle"
                        fontSize="9"
                        fontWeight="600"
                        fill="#475569"
                      >
                        {bar.hours.toFixed(1)}
                      </text>
                    </>
                  ) : null}
                  <text
                    x={bar.x + bar.barW / 2}
                    y={130 - 6}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#94a3b8"
                  >
                    {bar.date.slice(8)}日
                  </text>
                </g>
              ))}
            </svg>
          ) : (
            <div className="chart-empty-placeholder">暂无近14天睡眠数据</div>
          )}
        </div>
      </div>
    </div>
  );
}
