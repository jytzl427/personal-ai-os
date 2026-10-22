import { useEffect, useRef, useState } from "react";
import { AddRowButton } from "../components/AddRowButton.js";
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
  const [visibleCount, setVisibleCount] = useState(7);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayYmd();

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  async function load() {
    try {
      const result = await apiJson<{ health: Health[] }>(`/health?from=${shiftYmd(today, -90)}&to=${today}`);
      const sorted = [...result.health].sort((left, right) => right.log_date.localeCompare(left.log_date));
      logsRef.current = sorted;
      setLogs(sorted);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "健康记录加载失败");
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(date: string, patch: Partial<Health>) {
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
    if (!logsRef.current.some((row) => row.log_date === today)) await save(today, { log_date: today });
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
      await save(today, { log_date: today });
      setTimeout(focusToday, 60);
    } else {
      focusToday();
    }
  }

  async function deleteRecord(date: string) {
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

  const latestWeight = logs.find((r) => r.weight_kg != null)?.weight_kg;
  const latestSleep = logs[0] ? sleepLabel(logs[0]) : "—";
  const disciplinedStreak = computeDisciplinedStreak(logs, today);
  const hasToday = logs.some((row) => row.log_date === today);
  const visibleLogs = logs.slice(0, visibleCount);
  const hasMore = visibleCount < logs.length;

  return (
    <div className="page-stack page-health">
      <PageHeader meta="长期记录 · 晨起空腹体重与睡眠自律底盘" title="健康" />
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
      </div>

      <section className="table-panel database-panel health-table-panel">
        <DatabaseTable
          empty="还没有健康记录。"
          rows={visibleLogs.map((row) => ({ ...row, id: row.log_date }))}
          columns={[
            { key: "delete", label: "", className: "col-delete", render: (row) => <DeleteButton label={`删除 ${formatDate(row.log_date)} 的健康记录`} onClick={() => void deleteRecord(row.log_date)} /> },
            { key: "date", label: "日期", className: "col-date", render: (row) => <span>{formatDate(row.log_date)}</span> },
            { key: "bed", label: "上床", className: "col-time col-time-bed", render: (row) => <TimeCell ariaLabel={`${formatDate(row.log_date)} 上床时间`} value={row.bedtime_local ?? ""} onCommit={(value) => void save(row.log_date, { bedtime_local: value || null })} /> },
            { key: "sleep", label: "睡眠时长", className: "col-time col-time-sleep", render: (row) => <span className="sleep-duration">{sleepLabel(row)}</span> },
            { key: "wake", label: "起床", className: "col-time col-time-wake", render: (row) => <TimeCell ariaLabel={`${formatDate(row.log_date)} 起床时间`} value={row.wake_local ?? ""} onCommit={(value) => void save(row.log_date, { wake_local: value || null })} /> },
            { key: "weight", label: "空腹体重", className: "col-number", render: (row) => <WeightCell ariaLabel={`${formatDate(row.log_date)} 今日空腹体重`} value={row.weight_kg} onCommit={(value) => void save(row.log_date, { weight_kg: value })} /> },
            { key: "exercise", label: "运动与消耗", className: "col-memo", render: (row) => <CellText multiline placeholder="记录运动、体能消耗…" value={row.exercise_note ?? ""} onCommit={(value) => { if (value !== (row.exercise_note ?? "")) void save(row.log_date, { exercise_note: value }); }} /> },
            { key: "disciplined", label: "是否不自律", className: "col-disciplined", render: (row) => <Checkbox ariaLabel={`${formatDate(row.log_date)} 是否不自律`} checked={Boolean(row.disciplined)} onChange={(checked) => void save(row.log_date, { disciplined: checked })} /> }
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
    </div>
  );
}

function TimeCell({ value, ariaLabel, onCommit }: { value: string; ariaLabel: string; onCommit: (value: string) => void }) {
  const normalizedValue = typeof value === "string" ? value.slice(0, 5) : "";
  const [draft, setDraft] = useState(normalizedValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current && document.activeElement !== inputRef.current) {
      setDraft(normalizedValue);
    }
  }, [normalizedValue]);

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      className="cell-input time-input"
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
