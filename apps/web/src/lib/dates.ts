export function todayYmd(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.slice(0, 10));
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function formatYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shiftYmd(value: string, days: number): string {
  const parsed = parseYmd(value);
  if (!parsed) return value;
  const date = new Date(parsed.year, parsed.month - 1, parsed.day + days);
  return todayYmd(date);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function mondayIndex(year: number, month: number, day: number): number {
  const weekday = new Date(year, month - 1, day).getDay();
  return (weekday + 6) % 7;
}

export function formatDate(value?: string | null, emptyLabel = "未设置"): string {
  if (!value) return emptyLabel;
  const parsed = parseYmd(value);
  if (!parsed) return value;
  const today = todayYmd();
  if (value.slice(0, 10) === today) return "今天";
  if (value.slice(0, 10) === shiftYmd(today, -1)) return "昨天";
  if (value.slice(0, 10) === shiftYmd(today, 1)) return "明天";
  if (parsed.year === new Date().getFullYear()) return `${parsed.month}月${parsed.day}日`;
  return `${parsed.year}年${parsed.month}月${parsed.day}日`;
}

export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}¥${(Math.abs(cents) / 100).toFixed(2)}`;
}
