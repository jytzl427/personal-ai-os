import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { daysInMonth, formatDate, formatYmd, mondayIndex, parseYmd, todayYmd } from "../lib/dates.js";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export { formatDate };

export function DateField({
  value,
  onChange,
  ariaLabel,
  emptyLabel = "设置日期",
  className = ""
}: {
  value?: string | null;
  onChange: (value: string) => void;
  ariaLabel: string;
  emptyLabel?: string;
  className?: string;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const initial = parseYmd(value ?? "") ?? parseYmd(todayYmd())!;
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);

  useEffect(() => {
    const parsed = parseYmd(value ?? "");
    if (!parsed) return;
    setYear(parsed.year);
    setMonth(parsed.month);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if ((event.target as HTMLElement | null)?.closest?.(".date-popover")) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onReposition() {
      setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  function openCalendar() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 252;
    const height = 292;
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 4);
    setCoords({ top, left });
    const parsed = parseYmd(value ?? "") ?? parseYmd(todayYmd())!;
    setYear(parsed.year);
    setMonth(parsed.month);
    setOpen(true);
  }

  function shiftMonth(delta: number) {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  }

  function shiftYear(delta: number) {
    setYear((current) => current + delta);
  }

  const blanks = mondayIndex(year, month, 1);
  const totalDays = daysInMonth(year, month);
  const today = todayYmd();
  const selected = value?.slice(0, 10) ?? "";

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className={`date-field ${className}`.trim()}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        ref={triggerRef}
        type="button"
      >
        <span className="date-field-value">{formatDate(value, emptyLabel)}</span>
        <span aria-hidden="true" className="date-field-icon">▾</span>
      </button>
      {open
        ? createPortal(
            <div className="date-popover" role="dialog" style={{ top: coords.top, left: coords.left }}>
              <div className="cal-header">
                <div className="cal-nav-group">
                  <button aria-label="上一年" className="cal-nav cal-year-nav" onClick={() => shiftYear(-1)} type="button">&lt;&lt;</button>
                  <button aria-label="上个月" className="cal-nav" onClick={() => shiftMonth(-1)} type="button">‹</button>
                </div>
                <strong>{year}年{month}月</strong>
                <div className="cal-nav-group">
                  <button aria-label="下个月" className="cal-nav" onClick={() => shiftMonth(1)} type="button">›</button>
                  <button aria-label="下一年" className="cal-nav cal-year-nav" onClick={() => shiftYear(1)} type="button">&gt;&gt;</button>
                </div>
              </div>
              <div className="cal-week cal-weekdays">
                {WEEKDAYS.map((label) => <span key={label}>{label}</span>)}
              </div>
              <div className="cal-week">
                {Array.from({ length: blanks }, (_, index) => <span key={`blank-${index}`} />)}
                {Array.from({ length: totalDays }, (_, index) => {
                  const day = index + 1;
                  const ymd = formatYmd(year, month, day);
                  const classes = [
                    "cal-day",
                    ymd === today ? "is-today" : "",
                    ymd === selected ? "is-selected" : ""
                  ].filter(Boolean).join(" ");
                  return (
                    <button
                      className={classes}
                      key={ymd}
                      onClick={() => {
                        onChange(ymd);
                        setOpen(false);
                      }}
                      type="button"
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
              <div className="cal-footer">
                {value ? (
                  <button
                    className="cal-clear"
                    onClick={() => {
                      onChange("");
                      setOpen(false);
                    }}
                    type="button"
                  >
                    清除日期
                  </button>
                ) : null}
                <button
                  className="cal-today"
                  onClick={() => {
                    onChange(today);
                    setOpen(false);
                  }}
                  type="button"
                >
                  今天
                </button>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
