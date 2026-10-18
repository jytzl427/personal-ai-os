import { useEffect, useState } from "react";
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

export function HealthPage() {
  const [logs, setLogs] = useState<Health[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = todayYmd();

  async function load() {
    try {
      const result = await apiJson<{ health: Health[] }>(`/health?from=${shiftYmd(today, -90)}&to=${today}`);
      setLogs([...result.health].sort((left, right) => right.log_date.localeCompare(left.log_date)));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "健康记录加载失败");
    }
  }

  useEffect(() => { void load(); }, []);

  async function save(date: string, patch: Partial<Health>) {
    try {
      const current = logs.find((row) => row.log_date === date) ?? { log_date: date };
      const next = { ...current, ...patch };
      const duration = sleepMinutes(next.bedtime_local, next.wake_local);
      const result = await apiJson<{ health: Health }>(`/health/${date}`, jsonRequest("PUT", {
        weight_kg: next.weight_kg ?? null,
        bedtime_local: next.bedtime_local || null,
        wake_local: next.wake_local || null,
        sleep_duration_minutes: duration,
        exercise_note: next.exercise_note ?? null,
        disciplined: next.disciplined === null || next.disciplined === undefined ? null : Boolean(next.disciplined)
      }));
      const saved = { ...result.health, log_date: date };
      setLogs((rows) => {
        const exists = rows.some((row) => row.log_date === date);
        return (exists ? rows.map((row) => row.log_date === date ? saved : row) : [saved, ...rows]).sort((left, right) => right.log_date.localeCompare(left.log_date));
      });
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "健康记录保存失败");
    }
  }

  async function addToday() {
    if (!logs.some((row) => row.log_date === today)) await save(today, { log_date: today });
  }

  async function deleteRecord(date: string) {
    try {
      await apiJson(`/health/${date}`, { method: "DELETE" });
      setLogs((rows) => rows.filter((row) => row.log_date !== date));
      setMessage("已删除这条健康记录");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "健康记录删除失败");
    }
  }

  const latestWeight = logs.find((r) => r.weight_kg != null)?.weight_kg;
  const latestSleep = logs[0] ? sleepLabel(logs[0]) : "—";
  const recentUndisciplined = logs.slice(0, 7).filter((r) => Boolean(r.disciplined)).length;

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
        <div className="status-chip">
          <span className="muted">近 7 天不自律</span>
          <strong style={{ color: recentUndisciplined > 1 ? "var(--danger)" : "var(--ok)" }}>
            {recentUndisciplined} 天
          </strong>
        </div>
      </div>

      <section className="table-panel database-panel health-table-panel">
        <DatabaseTable
          empty="还没有健康记录。"
          rows={logs.map((row) => ({ ...row, id: row.log_date }))}
          columns={[
            { key: "delete", label: "", className: "col-delete", render: (row) => <DeleteButton label={`删除 ${formatDate(row.log_date)} 的健康记录`} onClick={() => void deleteRecord(row.log_date)} /> },
            { key: "date", label: "日期", className: "col-date", render: (row) => <span>{formatDate(row.log_date)}</span> },
            { key: "bed", label: "上床", className: "col-time", render: (row) => <TimeCell ariaLabel={`${formatDate(row.log_date)} 上床时间`} value={row.bedtime_local ?? ""} onCommit={(value) => void save(row.log_date, { bedtime_local: value || null })} /> },
            { key: "sleep", label: "睡眠时长", className: "col-time", render: (row) => <span className="sleep-duration">{sleepLabel(row)}</span> },
            { key: "wake", label: "起床", className: "col-time", render: (row) => <TimeCell ariaLabel={`${formatDate(row.log_date)} 起床时间`} value={row.wake_local ?? ""} onCommit={(value) => void save(row.log_date, { wake_local: value || null })} /> },
            { key: "weight", label: "空腹体重", className: "col-number", render: (row) => <WeightCell ariaLabel={`${formatDate(row.log_date)} 今日空腹体重`} value={row.weight_kg} onCommit={(value) => void save(row.log_date, { weight_kg: value })} /> },
            { key: "exercise", label: "运动与消耗", className: "col-memo", render: (row) => <CellText multiline placeholder="记录运动、体能消耗…" value={row.exercise_note ?? ""} onCommit={(value) => { if (value !== (row.exercise_note ?? "")) void save(row.log_date, { exercise_note: value }); }} /> },
            { key: "disciplined", label: "是否不自律", className: "col-disciplined", render: (row) => <Checkbox ariaLabel={`${formatDate(row.log_date)} 是否不自律`} checked={Boolean(row.disciplined)} onChange={(checked) => void save(row.log_date, { disciplined: checked })} /> }
          ]}
          footer={logs.some((row) => row.log_date === today) ? undefined : <AddRowButton label="记录今天" onClick={() => void addToday()} />}
        />
      </section>
    </div>
  );
}

function TimeCell({ value, ariaLabel, onCommit }: { value: string; ariaLabel: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={ariaLabel} className="cell-input time-input" max="23:59" min="00:00" onBlur={() => onCommit(draft)} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setDraft(value); event.currentTarget.blur(); } if (event.key === "Enter") event.currentTarget.blur(); }} step={60} type="time" value={draft} />;
}

function WeightCell({ value, ariaLabel, onCommit }: { value?: number | null; ariaLabel: string; onCommit: (value: number | null) => void }) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => setDraft(value === null || value === undefined ? "" : String(value)), [value]);
  function commit() {
    if (!draft.trim()) { onCommit(null); return; }
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0 && next <= 500) onCommit(next);
    else setDraft(value === null || value === undefined ? "" : String(value));
  }
  return <input aria-label={ariaLabel} className="cell-input weight-input" inputMode="decimal" onBlur={commit} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setDraft(value === null || value === undefined ? "" : String(value)); event.currentTarget.blur(); } if (event.key === "Enter") event.currentTarget.blur(); }} placeholder="kg" value={draft} />;
}
