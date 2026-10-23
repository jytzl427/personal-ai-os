import { useEffect, useMemo, useState } from "react";
import { CellText } from "../components/CellText.js";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { DateField } from "../components/DateField.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { MoneyCell } from "../components/MoneyCell.js";
import { PageHeader } from "../components/PageHeader.js";
import { PropertySelect } from "../components/PropertySelect.js";
import { SegmentedControl } from "../components/SegmentedControl.js";
import type { TagTone } from "../components/Tag.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import { money, shiftYmd, todayYmd } from "../lib/dates.js";
import type { Route } from "../lib/route.js";

type LedgerKind = "expense" | "income";
type FinanceTab = "quick" | "expenses" | "incomes" | "accounts" | "stats";
type FinanceRange = "all" | "today" | "week" | "month" | "custom";
type Account = { id: string; name: string; account_type?: string; opening_balance_cents: number; current_balance_cents: number; row_version?: number };
type Entry = { id: string; amount_cents: number; category_major?: string; category_minor?: string; event?: string; note?: string; occurred_date: string };
type AccountEntry = { id: string; account_id: string; account_name?: string; direction?: "deposit" | "withdrawal"; amount_cents: number; event?: string; note?: string; occurred_date: string };
type FinanceTaxonomyGroup = { majors: Array<{ value: string }>; minors: Record<string, Array<{ value: string }>> };
type FinanceQuickButton = { id: string; name: string; kind: LedgerKind; category_major: string; category_minor: string; event?: string; project_id?: string };

const expenseCategories: Record<string, string[]> = {
  品质生活: ["日用品", "休闲娱乐"],
  日常消费: ["饭费", "饮用水", "交通费"],
  固定支出: ["订阅", "分期", "电费", "水费", "电话费"],
  突发消费: ["冲动消费", "医药", "其他"]
};
const incomeCategories: Record<string, string[]> = {
  项目收入: ["其他"],
  "生活费/工资": ["生活费", "其他"],
  "其他/突发收入": ["其他"]
};

type QuickPreset = { id?: string; name: string; major: string; minor: string; event?: string; project_id?: string };
const expensePresets: QuickPreset[] = [
  { name: "早餐", major: "日常消费", minor: "饭费", event: "早餐" },
  { name: "午餐", major: "日常消费", minor: "饭费", event: "午餐" },
  { name: "晚餐", major: "日常消费", minor: "饭费", event: "晚餐" },
  { name: "咖啡", major: "品质生活", minor: "休闲娱乐", event: "咖啡" },
  { name: "日用品", major: "品质生活", minor: "日用品" },
  { name: "饮用水", major: "日常消费", minor: "饮用水" },
  { name: "交通费", major: "日常消费", minor: "交通费" },
  { name: "订阅", major: "固定支出", minor: "订阅" },
  { name: "分期", major: "固定支出", minor: "分期" },
  { name: "电费", major: "固定支出", minor: "电费" },
  { name: "水费", major: "固定支出", minor: "水费" },
  { name: "电话费", major: "固定支出", minor: "电话费" },
  { name: "冲动消费", major: "突发消费", minor: "冲动消费" },
  { name: "医药", major: "突发消费", minor: "医药" },
  { name: "其他", major: "突发消费", minor: "其他" },
  { name: "休闲娱乐", major: "品质生活", minor: "休闲娱乐" }
];
const incomePresets: QuickPreset[] = [
  { name: "生活费", major: "生活费/工资", minor: "生活费", event: "生活费" },
  { name: "其他", major: "其他/突发收入", minor: "其他" }
];

function getPresetIcon(name: string): string {
  switch (name) {
    case "早餐": return "🥣";
    case "午餐": return "🍱";
    case "晚餐": return "🍲";
    case "咖啡": return "☕";
    case "日用品": return "🧻";
    case "饮用水": return "💧";
    case "交通费": return "🚇";
    case "订阅": return "🔄";
    case "分期": return "💳";
    case "电费": return "⚡";
    case "水费": return "🚰";
    case "电话费": return "📱";
    case "冲动消费": return "🛍️";
    case "医药": return "💊";
    case "休闲娱乐": return "🎮";
    case "生活费": return "💰";
    case "其他": return "📦";
    default: return "🚀";
  }
}

const CATEGORY_COLORS: Record<string, string> = {
  日常消费: "#10b981",
  品质生活: "#3b82f6",
  固定支出: "#f59e0b",
  突发消费: "#ef4444",
  项目支出: "#8b5cf6",
  项目收入: "#10b981",
  "生活费/工资": "#3b82f6",
  "其他/突发收入": "#8b5cf6"
};

function presetKey(preset: QuickPreset) {
  return preset.id ?? `${preset.major}-${preset.minor}-${preset.name}`;
}

function presetCategoryKey(preset: QuickPreset) {
  return `${preset.major}-${preset.minor}`;
}

function normalizeTaxonomyGroup(group: FinanceTaxonomyGroup): Record<string, string[]> {
  return Object.fromEntries(group.majors.map((major) => [major.value, (group.minors[major.value] ?? []).map((minor) => minor.value)]));
}

function weekStart(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const mondayOffset = (parsed.getDay() + 6) % 7;
  return shiftYmd(date, -mondayOffset);
}

function rangeBounds(range: FinanceRange, date: string, fromDate: string, toDate: string) {
  if (range === "today") return { from: date, to: date };
  if (range === "week") return { from: weekStart(date), to: date };
  if (range === "month") return { from: `${date.slice(0, 7)}-01`, to: date };
  if (range === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && fromDate <= toDate) return { from: fromDate, to: toDate };
  return null;
}

function isValidCustomRange(fromDate: string, toDate: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(fromDate) && /^\d{4}-\d{2}-\d{2}$/.test(toDate) && fromDate <= toDate;
}

export function FinancePage({ tab, onNavigate }: { tab: FinanceTab; onNavigate: (route: Route) => void }) {
  const activeTab = tab === "quick" || tab === "stats" ? "expenses" : tab;
  const kind: LedgerKind = activeTab === "incomes" ? "income" : "expense";
  const today = todayYmd();
  const [categoryMap, setCategoryMap] = useState<Record<LedgerKind, Record<string, string[]>>>({ expense: expenseCategories, income: incomeCategories });
  const [projectQuickButtons, setProjectQuickButtons] = useState<FinanceQuickButton[]>([]);
  const categories = categoryMap[kind];
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [accountEntries, setAccountEntries] = useState<AccountEntry[]>([]);
  const [range, setRange] = useState<FinanceRange>("today");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [accountFilter, setAccountFilter] = useState("");
  const [accountDirectionFilter, setAccountDirectionFilter] = useState<"" | "deposit" | "withdrawal">("");
  const [filterMajor, setFilterMajor] = useState("");
  const [filterMinor, setFilterMinor] = useState("");
  const [major, setMajor] = useState(Object.keys(categories)[0] ?? "");
  const [minor, setMinor] = useState(categories[Object.keys(categories)[0] ?? ""]?.[0] ?? "");
  const [amount, setAmount] = useState("");
  const [event, setEvent] = useState("");
  const [date, setDate] = useState(today);
  const [accountDate, setAccountDate] = useState(today);
  const [accountId, setAccountId] = useState("");
  const [accountDirection, setAccountDirection] = useState<"deposit" | "withdrawal">("deposit");
  const [accountAmount, setAccountAmount] = useState("");
  const [accountEvent, setAccountEvent] = useState("");
  const [accountNote, setAccountNote] = useState("");
  const [todayMealCents, setTodayMealCents] = useState(0);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadTodayMeal() {
    try {
      const res = await apiJson<{ expenses?: Entry[] }>(`/finance/expenses?from=${today}&to=${today}`);
      const sum = (res.expenses ?? [])
        .filter((e) => e.category_minor === "饭费")
        .reduce((acc, cur) => acc + (cur.amount_cents || 0), 0);
      setTodayMealCents(sum);
    } catch {}
  }

  async function loadEntries() {
    if (activeTab !== "expenses" && activeTab !== "incomes") return;
    if (range === "custom" && !isValidCustomRange(fromDate, toDate)) {
      setEntries([]);
      setError("自定义日期范围无效，请检查开始和结束日期");
      return;
    }
    try {
      const bounds = rangeBounds(range, today, fromDate, toDate);
      const params = new URLSearchParams();
      if (bounds) { params.set("from", bounds.from); params.set("to", bounds.to); }
      if (filterMajor) params.set("category_major", filterMajor);
      if (filterMinor) params.set("category_minor", filterMinor);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const result = await apiJson<{ expenses?: Entry[]; incomes?: Entry[] }>(`/finance/${activeTab}${suffix}`);
      setEntries(activeTab === "expenses" ? result.expenses ?? [] : result.incomes ?? []);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账目加载失败");
    }
  }

  async function loadAccounts() {
    try {
      const result = await apiJson<{ accounts: Account[] }>("/finance/accounts");
      setAccounts(result.accounts);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户加载失败");
    }
  }

  async function loadAccountEntries() {
    if (activeTab !== "accounts") return;
    if (range === "custom" && !isValidCustomRange(fromDate, toDate)) {
      setAccountEntries([]);
      setError("自定义日期范围无效，请检查开始和结束日期");
      return;
    }
    try {
      const bounds = rangeBounds(range, today, fromDate, toDate);
      const params = new URLSearchParams();
      if (bounds) { params.set("from", bounds.from); params.set("to", bounds.to); }
      if (accountFilter) params.set("account_id", accountFilter);
      if (accountDirectionFilter) params.set("direction", accountDirectionFilter);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const result = await apiJson<{ entries: AccountEntry[] }>(`/finance/account-entries${suffix}`);
      setAccountEntries(result.entries);
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户流水加载失败");
    }
  }

  useEffect(() => {
    void loadAccounts();
    void loadTodayMeal();
  }, []);
  useEffect(() => {
    void Promise.all([
      apiJson<{ expense: FinanceTaxonomyGroup; income: FinanceTaxonomyGroup }>("/finance/taxonomy"),
      apiJson<{ quick_buttons: FinanceQuickButton[] }>("/finance/quick-buttons")
    ]).then(([taxonomy, quickButtons]) => {
      setCategoryMap({ expense: normalizeTaxonomyGroup(taxonomy.expense), income: normalizeTaxonomyGroup(taxonomy.income) });
      setProjectQuickButtons((quickButtons.quick_buttons ?? []).filter((button) => Boolean(button.project_id)));
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "财务分类加载失败"));
  }, []);
  useEffect(() => { void loadEntries(); }, [activeTab, range, fromDate, toDate, filterMajor, filterMinor]);
  useEffect(() => { void loadAccountEntries(); }, [activeTab, range, fromDate, toDate, accountFilter, accountDirectionFilter]);
  useEffect(() => { if (!accountId && accounts[0]) setAccountId(accounts[0].id); }, [accounts, accountId]);
  useEffect(() => {
    const nextMajor = Object.keys(categories)[0] ?? "";
    setMajor(nextMajor);
    setMinor(categories[nextMajor]?.[0] ?? "");
    setActivePreset(null);
    setEvent("");
    setFilterMajor("");
    setFilterMinor("");
  }, [kind]);

  async function quickAdd() {
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isInteger(cents) || cents <= 0) {
      setError("请填写金额");
      return;
    }
    try {
      const path = kind === "expense" ? "/finance/expenses" : "/finance/incomes";
      const eventName = event.trim();
      const selectedPreset = presets.find((preset) => presetKey(preset) === activePreset);
      const projectButton = projectQuickButtons.find((button) => button.kind === kind && button.category_major === major && button.category_minor === minor);
      const projectId = selectedPreset?.project_id ?? projectButton?.project_id;
      const quickButtonId = selectedPreset?.id ?? projectButton?.id;
      await apiJson(path, jsonRequest("POST", { amount_cents: cents, category: `${major} / ${minor}`, category_major: major, category_minor: minor, ...(projectId ? { project_id: projectId } : {}), ...(quickButtonId ? { quick_button_id: quickButtonId } : {}), event: eventName, note: eventName, occurred_date: date }));
      setAmount("");
      setError(null);
      setMessage("已记下，不关联资金账户");
      await loadEntries();
      void loadTodayMeal();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "记账失败");
    }
  }

  async function saveEntry(id: string, patch: Record<string, unknown>) {
    try {
      const path = kind === "expense" ? "/finance/expenses/" : "/finance/incomes/";
      const result = await apiJson<{ expense?: Entry; income?: Entry }>(path + id, jsonRequest("PATCH", patch));
      const saved = result.expense ?? result.income;
      if (saved) setEntries((current) => current.map((entry) => entry.id === id ? saved : entry));
      setError(null);
      void loadTodayMeal();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账目保存失败");
    }
  }

  async function deleteEntry(id: string) {
    try {
      const path = kind === "expense" ? "/finance/expenses/" : "/finance/incomes/";
      await apiJson(path + id, { method: "DELETE" });
      setEntries((current) => current.filter((entry) => entry.id !== id));
      setError(null);
      void loadTodayMeal();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账目删除失败");
    }
  }

  async function addAccount() {
    try {
      const result = await apiJson<{ account: Account }>("/finance/accounts", jsonRequest("POST", { name: "新账户", opening_balance_cents: 0 }));
      setAccounts((current) => [...current, result.account]);
      setAccountId(result.account.id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户添加失败");
    }
  }

  async function saveAccount(id: string, patch: Record<string, unknown>) {
    try {
      const result = await apiJson<{ account: Account }>(`/finance/accounts/${id}`, jsonRequest("PATCH", patch));
      setAccounts((current) => current.map((account) => account.id === id ? result.account : account));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户保存失败");
    }
  }

  async function deleteAccount(id: string) {
    try {
      await apiJson(`/finance/accounts/${id}`, { method: "DELETE" });
      setAccounts((current) => current.filter((account) => account.id !== id));
      setAccountEntries((current) => current.filter((entry) => entry.account_id !== id));
      if (accountId === id) setAccountId("");
      if (accountFilter === id) setAccountFilter("");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户删除失败");
    }
  }

  async function addAccountEntry() {
    const cents = Math.round(Number(accountAmount) * 100);
    if (!accountId) { setError("请先添加账户"); return; }
    if (!Number.isInteger(cents) || cents <= 0) { setError("请填写金额"); return; }
    try {
      await apiJson("/finance/account-entries", jsonRequest("POST", { account_id: accountId, direction: accountDirection, amount_cents: cents, event: accountEvent.trim(), note: accountNote.trim(), occurred_date: accountDate }));
      setAccountAmount("");
      setAccountEvent("");
      setAccountNote("");
      await Promise.all([loadAccounts(), loadAccountEntries()]);
      setError(null);
      setMessage(accountDirection === "deposit" ? "已记录账户存入" : "已记录账户取出");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户流水保存失败");
    }
  }

  async function saveAccountEntry(id: string, patch: Record<string, unknown>) {
    try {
      const result = await apiJson<{ entry: AccountEntry }>(`/finance/account-entries/${id}`, jsonRequest("PATCH", patch));
      setAccountEntries((current) => current.map((entry) => entry.id === id ? result.entry : entry));
      await loadAccounts();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户流水保存失败");
    }
  }

  async function deleteAccountEntry(id: string) {
    try {
      await apiJson(`/finance/account-entries/${id}`, { method: "DELETE" });
      setAccountEntries((current) => current.filter((entry) => entry.id !== id));
      await loadAccounts();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "账户流水删除失败");
    }
  }

  const basePresets = kind === "expense" ? expensePresets : incomePresets;
  const dynamicPresets = projectQuickButtons.filter((button) => button.kind === kind).map((button) => ({ id: button.id, name: button.name, major: button.category_major, minor: button.category_minor, event: button.event, project_id: button.project_id }));
  const dynamicCategories = new Set(dynamicPresets.map(presetCategoryKey));
  const presets = [...basePresets.filter((preset) => !dynamicCategories.has(presetCategoryKey(preset))), ...dynamicPresets];
  const kindLabel = kind === "expense" ? "支出" : "收入";
  function changeRange(nextRange: FinanceRange) {
    setRange(nextRange);
    if (nextRange !== "all" && nextRange !== "custom") {
      const bounds = rangeBounds(nextRange, today, fromDate, toDate);
      if (bounds) { setFromDate(bounds.from); setToDate(bounds.to); }
    }
  }

  const periodTotalCents = useMemo(() => entries.reduce((acc, cur) => acc + (cur.amount_cents || 0), 0), [entries]);
  const impulseEntries = useMemo(() => entries.filter((e) => e.category_minor === "冲动消费" || (e.event && e.event.includes("冲动"))), [entries]);
  const impulseTotalCents = useMemo(() => impulseEntries.reduce((acc, cur) => acc + (cur.amount_cents || 0), 0), [impulseEntries]);
  const impulseCount = impulseEntries.length;

  const categoryDistribution = useMemo(() => {
    if (entries.length === 0 || periodTotalCents === 0) return [];
    const map = new Map<string, number>();
    for (const entry of entries) {
      const cat = entry.category_major || "其他";
      map.set(cat, (map.get(cat) || 0) + entry.amount_cents);
    }
    return Array.from(map.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        pct: (amount / periodTotalCents) * 100,
        color: CATEGORY_COLORS[category] || "#64748b"
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [entries, periodTotalCents]);

  return (
    <div className="page-stack page-finance">
      <PageHeader meta="支出、收入与账户分开管理" title="财务">
        <SegmentedControl
          ariaLabel="财务数据库"
          options={[{ value: "expenses", label: "支出" }, { value: "incomes", label: "收入" }, { value: "accounts", label: "账户" }]}
          value={activeTab}
          onChange={(value) => onNavigate({ name: "finance", tab: value })}
        />
      </PageHeader>
      {error ? <div className="notice error">{error}</div> : null}
      {message && !error ? <div className="notice">{message}</div> : null}
      {activeTab === "expenses" || activeTab === "incomes" ? (
        <>
          <div className="finance-pulse-grid">
            <div className="finance-pulse-card meal-radar-card">
              <div className="pulse-card-header">
                <span className="pulse-card-title">🍱 今日餐饮限额雷达</span>
                <span className={`pulse-card-tag ${todayMealCents > 2500 ? "is-danger" : todayMealCents >= 2000 ? "is-warn" : "is-ok"}`}>
                  {todayMealCents > 2500 ? "已超标" : todayMealCents >= 2000 ? "临界警戒" : "守线平稳"}
                </span>
              </div>
              <div className="pulse-card-main">
                <div className="pulse-stat-number">
                  <span className="stat-cur">¥{(todayMealCents / 100).toFixed(2)}</span>
                  <span className="stat-max"> / ¥25.00</span>
                </div>
                <div className="pulse-meter-track" title={`今日饭费使用率 ${Math.round((todayMealCents / 2500) * 100)}%`}>
                  <div
                    className={`pulse-meter-fill ${todayMealCents > 2500 ? "is-danger" : todayMealCents >= 2000 ? "is-warn" : "is-ok"}`}
                    style={{ width: `${Math.min(100, (todayMealCents / 2500) * 100)}%` }}
                  />
                </div>
                <div className="pulse-card-sub">
                  {todayMealCents <= 2500 ? (
                    <span>今日午晚限额节余 <strong>¥{((2500 - todayMealCents) / 100).toFixed(2)}</strong></span>
                  ) : (
                    <span className="text-danger">超出日限额 <strong>¥{((todayMealCents - 2500) / 100).toFixed(2)}</strong></span>
                  )}
                </div>
              </div>
            </div>

            <div className="finance-pulse-card period-summary-card">
              <div className="pulse-card-header">
                <span className="pulse-card-title">📊 筛选周期{kindLabel}大盘</span>
                <span className="pulse-card-tag is-neutral">{entries.length} 笔明细</span>
              </div>
              <div className="pulse-card-main">
                <div className="pulse-stat-number">
                  <span className="stat-cur">¥{(periodTotalCents / 100).toFixed(2)}</span>
                </div>
                <div className="pulse-card-badge-row">
                  {kind === "expense" ? (
                    impulseCount === 0 ? (
                      <div className="pulse-shield-badge is-ok">
                        <span className="badge-icon">🛡️</span>
                        <span>0 冲动消费 · 守线完美</span>
                      </div>
                    ) : (
                      <div className="pulse-shield-badge is-warn">
                        <span className="badge-icon">⚠️</span>
                        <span>{impulseCount} 笔冲动消费 (¥{(impulseTotalCents / 100).toFixed(2)})</span>
                      </div>
                    )
                  ) : (
                    <div className="pulse-shield-badge is-ok">
                      <span className="badge-icon">💰</span>
                      <span>资金回流平稳</span>
                    </div>
                  )}
                </div>
                <div className="pulse-card-sub">
                  <span>当前视图：{range === "today" ? "今日" : range === "week" ? "本周" : range === "month" ? "本月" : range === "custom" ? `${fromDate} ~ ${toDate}` : "全部历史"}</span>
                </div>
              </div>
            </div>

            <div className="finance-pulse-card distribution-card">
              <div className="pulse-card-header">
                <span className="pulse-card-title">🎨 分类结构分布</span>
                <span className="pulse-card-tag is-neutral">{categoryDistribution.length} 个分类</span>
              </div>
              <div className="pulse-card-main">
                <div className="category-stacked-bar" title="分类占比">
                  {categoryDistribution.length === 0 ? (
                    <div className="stacked-bar-empty" />
                  ) : (
                    categoryDistribution.map((item) => (
                      <div
                        key={item.category}
                        className="stacked-bar-segment"
                        style={{ width: `${item.pct}%`, backgroundColor: item.color }}
                        title={`${item.category}: ¥${(item.amount / 100).toFixed(2)} (${item.pct.toFixed(1)}%)`}
                      />
                    ))
                  )}
                </div>
                <div className="category-legend-list">
                  {categoryDistribution.slice(0, 4).map((item) => (
                    <div key={item.category} className="category-legend-item">
                      <span className="legend-dot" style={{ backgroundColor: item.color }} />
                      <span className="legend-name">{item.category}</span>
                      <span className="legend-pct">{item.pct.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <section className="quick-ledger">
            <div className="ledger-heading">
              <div>
                <h2>快捷{kindLabel}</h2>
                <p className="muted">快捷项只预填分类；事件可以继续填写具体内容</p>
              </div>
            </div>
            <div className="quick-button-row">
              {presets.map((preset) => (
                <button
                  className={activePreset === presetKey(preset) ? "quick-preset is-active" : "quick-preset"}
                  key={presetKey(preset)}
                  onClick={() => {
                    setMajor(preset.major);
                    setMinor(preset.minor);
                    setEvent(preset.event ?? "");
                    setActivePreset(presetKey(preset));
                  }}
                  type="button"
                >
                  <span className="preset-icon">{getPresetIcon(preset.name)}</span>
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
            <div className="form-row">
              <label className="form-field"><span>大项</span><select className="select-input" value={major} onChange={(event) => { setMajor(event.target.value); setMinor(categories[event.target.value]?.[0] ?? ""); setActivePreset(null); }}>{Object.keys(categories).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="form-field"><span>小项</span><select className="select-input" value={minor} onChange={(event) => { setMinor(event.target.value); setActivePreset(null); }}>{(categories[major] ?? []).map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="form-field"><span>日期</span><DateField ariaLabel="记账日期" value={date} onChange={setDate} /></label>
            </div>
            <div className="quick-input-row">
              <label className="form-field amount-field">
                <span>金额（元）</span>
                <div className="amount-input-wrap">
                  <span className="currency-symbol">¥</span>
                  <input className="amount-input" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void quickAdd(); }} />
                </div>
              </label>
              <label className="form-field event-field"><span>事件</span><input className="cell-input" placeholder={minor === "日用品" ? "例如：纸巾" : "可填写具体事件"} value={event} onChange={(event) => setEvent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void quickAdd(); }} /></label>
              <button className="primary-button" onClick={() => void quickAdd()} type="button">记一笔</button>
            </div>
          </section>
          <EntryTable categories={categories} entries={entries} kind={kind} onDelete={deleteEntry} onSave={saveEntry} range={range} onRangeChange={changeRange} fromDate={fromDate} toDate={toDate} onFromDateChange={(value) => { setFromDate(value); setRange("custom"); }} onToDateChange={(value) => { setToDate(value); setRange("custom"); }} majorFilter={filterMajor} minorFilter={filterMinor} onMajorFilterChange={(value) => { setFilterMajor(value); setFilterMinor(""); }} onMinorFilterChange={setFilterMinor} />
        </>
      ) : null}
      {activeTab === "accounts" ? <>
        <AccountGallery accounts={accounts} onAdd={addAccount} onDelete={deleteAccount} onRename={(id, value) => void saveAccount(id, { name: value })} />
        <section className="quick-ledger account-entry-ledger">
          <div className="ledger-heading"><div><h2>账户流水</h2><p className="muted">每次存入或取出都会新增一条账户流水，余额会同步更新</p></div></div>
          <div className="form-row">
            <label className="form-field"><span>账户</span><select className="select-input" disabled={!accounts.length} value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">选择账户</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
            <label className="form-field"><span>类型</span><select className="select-input" value={accountDirection} onChange={(event) => setAccountDirection(event.target.value as "deposit" | "withdrawal")}><option value="deposit">存入</option><option value="withdrawal">取出</option></select></label>
            <label className="form-field"><span>日期</span><DateField ariaLabel="账户流水日期" value={accountDate} onChange={setAccountDate} /></label>
            <label className="form-field"><span>金额（元）</span><input className="amount-input" inputMode="decimal" placeholder="0.00" value={accountAmount} onChange={(event) => setAccountAmount(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addAccountEntry(); }} /></label>
          </div>
          <div className="quick-input-row"><label className="form-field event-field"><span>事件</span><input className="cell-input" placeholder="例如：本月存入/取出" value={accountEvent} onChange={(event) => setAccountEvent(event.target.value)} /></label><label className="form-field event-field"><span>备注</span><input className="cell-input" placeholder="可选" value={accountNote} onChange={(event) => setAccountNote(event.target.value)} /></label><button className="primary-button" disabled={!accounts.length} onClick={() => void addAccountEntry()} type="button">记一笔</button></div>
        </section>
        <AccountEntryTable accounts={accounts} entries={accountEntries} accountFilter={accountFilter} directionFilter={accountDirectionFilter} onAccountFilterChange={setAccountFilter} onDirectionFilterChange={setAccountDirectionFilter} onDelete={deleteAccountEntry} onSave={saveAccountEntry} range={range} onRangeChange={changeRange} fromDate={fromDate} toDate={toDate} onFromDateChange={(value) => { setFromDate(value); setRange("custom"); }} onToDateChange={(value) => { setToDate(value); setRange("custom"); }} />
      </> : null}
    </div>
  );
}

type FinanceFilterProps = {
  range: FinanceRange;
  onRangeChange: (range: FinanceRange) => void;
  fromDate: string;
  toDate: string;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  categories?: Record<string, string[]>;
  majorFilter?: string;
  minorFilter?: string;
  onMajorFilterChange?: (value: string) => void;
  onMinorFilterChange?: (value: string) => void;
  accountOptions?: Array<{ value: string; label: string }>;
  accountFilter?: string;
  onAccountFilterChange?: (value: string) => void;
  directionFilter?: "" | "deposit" | "withdrawal";
  onDirectionFilterChange?: (value: "" | "deposit" | "withdrawal") => void;
};

function FinanceFilters({ range, onRangeChange, fromDate, toDate, onFromDateChange, onToDateChange, categories, majorFilter = "", minorFilter = "", onMajorFilterChange, onMinorFilterChange, accountOptions, accountFilter = "", onAccountFilterChange, directionFilter = "", onDirectionFilterChange }: FinanceFilterProps) {
  const minorOptions = majorFilter ? categories?.[majorFilter] ?? [] : Object.values(categories ?? {}).flat();
  return <div className="finance-filters">
    <div className="finance-filter-group">
      <span className="finance-filter-label">时间</span>
      <div className="finance-range-buttons">
        {[{ value: "all", label: "全部" }, { value: "today", label: "本天" }, { value: "week", label: "本周" }, { value: "month", label: "本月" }].map((item) => <button className={range === item.value ? "finance-range-button is-active" : "finance-range-button"} key={item.value} onClick={() => onRangeChange(item.value as FinanceRange)} type="button">{item.label}</button>)}
      </div>
      <div className="finance-date-range"><DateField ariaLabel="筛选开始日期" value={fromDate} onChange={onFromDateChange} /><span>至</span><DateField ariaLabel="筛选结束日期" value={toDate} onChange={onToDateChange} /></div>
    </div>
    {categories && onMajorFilterChange && onMinorFilterChange ? <div className="finance-filter-group finance-category-filters">
      <span className="finance-filter-label">分类</span>
      <select aria-label="筛选大项" className="select-input" value={majorFilter} onChange={(event) => onMajorFilterChange(event.target.value)}><option value="">全部大项</option>{Object.keys(categories).map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select aria-label="筛选小项" className="select-input" value={minorFilter} onChange={(event) => onMinorFilterChange(event.target.value)}><option value="">全部小项</option>{minorOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>
    </div> : null}
    {accountOptions && onAccountFilterChange && onDirectionFilterChange ? <div className="finance-filter-group finance-category-filters">
      <span className="finance-filter-label">流水</span>
      <select aria-label="筛选账户" className="select-input" value={accountFilter} onChange={(event) => onAccountFilterChange(event.target.value)}><option value="">全部账户</option>{accountOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <select aria-label="筛选存入取出类型" className="select-input" value={directionFilter} onChange={(event) => onDirectionFilterChange(event.target.value as "" | "deposit" | "withdrawal")}><option value="">全部类型</option><option value="deposit">存入</option><option value="withdrawal">取出</option></select>
    </div> : null}
  </div>;
}

function EntryTable({ entries, kind, categories, onSave, onDelete, range, onRangeChange, fromDate, toDate, onFromDateChange, onToDateChange, majorFilter, minorFilter, onMajorFilterChange, onMinorFilterChange }: { entries: Entry[]; kind: LedgerKind; categories: Record<string, string[]>; onSave: (id: string, patch: Record<string, unknown>) => Promise<void>; onDelete: (id: string) => Promise<void>; range: FinanceRange; onRangeChange: (range: FinanceRange) => void; fromDate: string; toDate: string; onFromDateChange: (value: string) => void; onToDateChange: (value: string) => void; majorFilter: string; minorFilter: string; onMajorFilterChange: (value: string) => void; onMinorFilterChange: (value: string) => void }) {
  const majorOptions = Object.keys(categories);
  const kindLabel = kind === "expense" ? "支出" : "收入";
  const kindTone: TagTone = kind === "expense" ? "warning" : "success";
  const total = entries.reduce((sum, entry) => sum + entry.amount_cents, 0);
  return (
    <section className={`table-panel finance-table-panel ${kind === "expense" ? "finance-expenses-panel" : "finance-incomes-panel"}`}>
      <div className="finance-table-heading"><div><h2>{kindLabel}</h2><span className="page-meta">当前显示 {entries.length} 条</span></div><FinanceFilters categories={categories} fromDate={fromDate} majorFilter={majorFilter} minorFilter={minorFilter} onFromDateChange={onFromDateChange} onMajorFilterChange={onMajorFilterChange} onMinorFilterChange={onMinorFilterChange} onRangeChange={onRangeChange} onToDateChange={onToDateChange} range={range} toDate={toDate} /></div>
      <DatabaseTable
        empty="还没有记录，先用上方快捷项记一笔。"
        rows={entries}
        columns={[
          { key: "delete", label: "", className: "col-delete", render: (entry) => <DeleteButton label={`删除${kindLabel}记录`} onClick={() => void onDelete(entry.id)} /> },
          { key: "date", label: "日期", className: "col-date", render: (entry) => <DateField ariaLabel={`${kindLabel}日期`} value={entry.occurred_date} onChange={(value) => void onSave(entry.id, { occurred_date: value })} /> },
          { key: "major", label: "大项", className: "col-category", render: (entry) => { const resolvedMajor = majorOptions.includes(entry.category_major ?? "") ? entry.category_major ?? majorOptions[0] ?? "" : majorOptions[0] ?? ""; return <PropertySelect ariaLabel={`${kindLabel}大项`} options={majorOptions.map((item) => ({ value: item, label: item }))} tone={kindTone} value={resolvedMajor} onChange={(value) => { const nextMinor = categories[value]?.[0] ?? ""; void onSave(entry.id, { category_major: value, category_minor: nextMinor, category: `${value} / ${nextMinor}` }); }} />; } },
          { key: "minor", label: "小项", className: "col-category", render: (entry) => { const resolvedMajor = majorOptions.includes(entry.category_major ?? "") ? entry.category_major ?? majorOptions[0] ?? "" : majorOptions[0] ?? ""; const minorOptions = categories[resolvedMajor] ?? []; const resolvedMinor = minorOptions.includes(entry.category_minor ?? "") ? entry.category_minor ?? minorOptions[0] ?? "" : minorOptions[0] ?? ""; return <PropertySelect ariaLabel={`${kindLabel}小项`} options={minorOptions.map((item) => ({ value: item, label: item }))} tone="neutral" value={resolvedMinor} onChange={(value) => void onSave(entry.id, { category_minor: value, category: `${resolvedMajor} / ${value}` })} />; } },
          { key: "event", label: "事件", className: "col-title", render: (entry) => <CellText placeholder="填写事件" value={entry.event ?? ""} onCommit={(value) => { if (value !== (entry.event ?? "")) void onSave(entry.id, { event: value }); }} /> },
          { key: "note", label: "备注", className: "col-memo", render: (entry) => <CellText multiline placeholder="添加备注" value={entry.note ?? ""} onCommit={(value) => { if (value !== (entry.note ?? "")) void onSave(entry.id, { note: value }); }} /> },
          { key: "amount", label: "金额", className: "col-money", render: (entry) => <MoneyCell value={entry.amount_cents} onCommit={(value) => { if (value !== entry.amount_cents) void onSave(entry.id, { amount_cents: value }); }} /> }
        ]}
        footer={<div className="database-summary"><span>当前筛选汇总</span><strong>{money(total)}</strong></div>}
      />
    </section>
  );
}

function AccountGallery({ accounts, onAdd, onDelete, onRename }: { accounts: Account[]; onAdd: () => Promise<void>; onDelete: (id: string) => Promise<void>; onRename: (id: string, value: string) => void }) {
  return <section className="account-gallery" aria-label="账户概览">{accounts.map((account) => <div className="account-card" key={account.id}><div className="account-card-top"><CellText placeholder="账户名称" value={account.name} onCommit={(value) => { if (value.trim() && value.trim() !== account.name) onRename(account.id, value.trim()); }} /><DeleteButton label={`删除账户“${account.name}”`} message={`即将删除账户“${account.name}”，并同时删除该账户的全部存入/取出流水；支出和收入记录本身不会被删除。此操作不可撤销，请确认是否继续。`} onClick={() => void onDelete(account.id)} /></div><strong>{money(account.current_balance_cents)}</strong></div>)}<button className="account-card account-card-add" onClick={() => void onAdd()} type="button">＋ 添加账户</button></section>;
}

function AccountEntryTable({ accounts, entries, accountFilter, directionFilter, onAccountFilterChange, onDirectionFilterChange, onSave, onDelete, range, onRangeChange, fromDate, toDate, onFromDateChange, onToDateChange }: { accounts: Account[]; entries: AccountEntry[]; accountFilter: string; directionFilter: "" | "deposit" | "withdrawal"; onAccountFilterChange: (value: string) => void; onDirectionFilterChange: (value: "" | "deposit" | "withdrawal") => void; onSave: (id: string, patch: Record<string, unknown>) => Promise<void>; onDelete: (id: string) => Promise<void>; range: FinanceRange; onRangeChange: (range: FinanceRange) => void; fromDate: string; toDate: string; onFromDateChange: (value: string) => void; onToDateChange: (value: string) => void }) {
  const total = entries.reduce((sum, entry) => sum + (entry.direction === "withdrawal" ? -entry.amount_cents : entry.amount_cents), 0);
  return <section className="table-panel finance-table-panel finance-accounts-panel"><div className="finance-table-heading"><div><h2>账户流水</h2><span className="page-meta">当前显示 {entries.length} 条</span></div><FinanceFilters accountFilter={accountFilter} accountOptions={accounts.map((account) => ({ value: account.id, label: account.name }))} directionFilter={directionFilter} fromDate={fromDate} onAccountFilterChange={onAccountFilterChange} onDirectionFilterChange={onDirectionFilterChange} onFromDateChange={onFromDateChange} onRangeChange={onRangeChange} onToDateChange={onToDateChange} range={range} toDate={toDate} /></div><DatabaseTable empty="还没有账户流水。" rows={entries} columns={[{ key: "delete", label: "", className: "col-delete", render: (entry) => <DeleteButton label="删除账户流水" onClick={() => void onDelete(entry.id)} /> }, { key: "date", label: "日期", className: "col-date", render: (entry) => <DateField ariaLabel="账户流水日期" value={entry.occurred_date} onChange={(value) => void onSave(entry.id, { occurred_date: value })} /> }, { key: "direction", label: "类型", className: "col-category", render: (entry) => <PropertySelect ariaLabel="账户流水类型" options={[{ value: "deposit", label: "存入" }, { value: "withdrawal", label: "取出" }]} tone={entry.direction === "withdrawal" ? "warning" : "success"} value={entry.direction ?? "deposit"} onChange={(value) => void onSave(entry.id, { direction: value })} /> }, { key: "account", label: "账户", className: "col-category", render: (entry) => <PropertySelect ariaLabel="账户" options={accounts.map((account) => ({ value: account.id, label: account.name }))} tone="neutral" value={entry.account_id} onChange={(value) => void onSave(entry.id, { account_id: value })} /> }, { key: "event", label: "事件", className: "col-title", render: (entry) => <CellText placeholder="填写事件" value={entry.event ?? ""} onCommit={(value) => { if (value !== (entry.event ?? "")) void onSave(entry.id, { event: value }); }} /> }, { key: "note", label: "备注", className: "col-memo", render: (entry) => <CellText multiline placeholder="添加备注" value={entry.note ?? ""} onCommit={(value) => { if (value !== (entry.note ?? "")) void onSave(entry.id, { note: value }); }} /> }, { key: "amount", label: "金额", className: "col-money", render: (entry) => <MoneyCell value={entry.amount_cents} onCommit={(value) => { if (value !== entry.amount_cents) void onSave(entry.id, { amount_cents: value }); }} /> }]} footer={<div className="database-summary"><span>当前筛选净变动</span><strong>{money(total)}</strong></div>} /></section>;
}
