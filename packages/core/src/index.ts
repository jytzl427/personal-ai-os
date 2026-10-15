// Recovered from the verified standalone server bundle. Runtime behavior is preserved.
// @ts-nocheck
function shouldArchiveTask(row) {
  if (row.archived_at)
    return false;
  return row.archive_requested === 1 && (row.status === "done" || row.status === "cancelled");
}
function shouldArchiveIdea(row) {
  if (row.archived_at)
    return false;
  return row.archive_requested === 1 && row.processed === 1;
}

var EXPENSE_MAJORS = [
  { value: "\u54C1\u8D28\u751F\u6D3B", label: "\u54C1\u8D28\u751F\u6D3B", color: "#c0453c" },
  { value: "\u7A81\u53D1\u6D88\u8D39", label: "\u7A81\u53D1\u6D88\u8D39", color: "#8b5e3c" },
  { value: "\u65E5\u5E38\u6D88\u8D39", label: "\u65E5\u5E38\u6D88\u8D39", color: "#c9a227" },
  { value: "\u56FA\u5B9A\u652F\u51FA", label: "\u56FA\u5B9A\u652F\u51FA", color: "#d6588c" }
];
var EXPENSE_MINORS = {
  \u54C1\u8D28\u751F\u6D3B: [
    { value: "\u65E5\u7528\u54C1", label: "\u65E5\u7528\u54C1", color: "#c0453c" },
    { value: "\u4F11\u95F2\u5A31\u4E50", label: "\u4F11\u95F2\u5A31\u4E50", color: "#8b5e3c" }
  ],
  \u7A81\u53D1\u6D88\u8D39: [
    { value: "\u51B2\u52A8\u6D88\u8D39", label: "\u51B2\u52A8\u6D88\u8D39", color: "#d97706" },
    { value: "\u533B\u836F", label: "\u533B\u836F", color: "#7c5cbf" },
    { value: "\u5176\u4ED6", label: "\u5176\u4ED6", color: "#8d9399" }
  ],
  \u65E5\u5E38\u6D88\u8D39: [
    { value: "\u996D\u8D39", label: "\u996D\u8D39", color: "#3b6fb6" },
    { value: "\u996E\u7528\u6C34", label: "\u996E\u7528\u6C34", color: "#3f8f5a" },
    { value: "\u4EA4\u901A\u8D39", label: "\u4EA4\u901A\u8D39", color: "#d6588c" }
  ],
  \u56FA\u5B9A\u652F\u51FA: [
    { value: "\u8BA2\u9605", label: "\u8BA2\u9605", color: "#8d9399" },
    { value: "\u5206\u671F", label: "\u5206\u671F", color: "#9a6a9c" },
    { value: "\u7535\u8D39", label: "\u7535\u8D39", color: "#d6588c" },
    { value: "\u6C34\u8D39", label: "\u6C34\u8D39", color: "#4d8fa6" },
    { value: "\u7535\u8BDD\u8D39", label: "\u7535\u8BDD\u8D39", color: "#c9a227" }
  ]
};
var INCOME_MAJORS = [
  { value: "\u9879\u76EE\u6536\u5165", label: "\u9879\u76EE\u6536\u5165", color: "#8d9399" },
  { value: "\u751F\u6D3B\u8D39/\u5DE5\u8D44", label: "\u751F\u6D3B\u8D39/\u5DE5\u8D44", color: "#8b5e3c" },
  { value: "\u5176\u4ED6/\u7A81\u53D1\u6536\u5165", label: "\u5176\u4ED6/\u7A81\u53D1\u6536\u5165", color: "#d6588c" }
];
var INCOME_MINORS = {
  "\u751F\u6D3B\u8D39/\u5DE5\u8D44": [
    { value: "\u751F\u6D3B\u8D39", label: "\u751F\u6D3B\u8D39", color: "#c9a227" },
    { value: "\u5176\u4ED6", label: "\u5176\u4ED6", color: "#3f8f5a" }
  ],
  "\u5176\u4ED6/\u7A81\u53D1\u6536\u5165": [
    { value: "\u5176\u4ED6", label: "\u5176\u4ED6", color: "#3f8f5a" }
  ],
  \u9879\u76EE\u6536\u5165: [
    { value: "\u5176\u4ED6", label: "\u5176\u4ED6", color: "#3f8f5a" }
  ]
};
var ACCOUNT_LABELS = {
  love: { label: "\u604B\u7231\u8D44\u91D1", color: "#d6588c" },
  emergency: { label: "\u7D27\u6025\u8D44\u91D1", color: "#c0453c" },
  daily: { label: "\u6295\u8D44\u8D44\u91D1", color: "#3b6fb6" }
};
var DEFAULT_QUICK_BUTTONS = [
  { id: "breakfast", label: "\u65E9\u9910", major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996D\u8D39", event: "\u65E9\u9910" },
  { id: "lunch", label: "\u5348\u9910", major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996D\u8D39", event: "\u5348\u9910" },
  { id: "dinner", label: "\u665A\u9910", major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996D\u8D39", event: "\u665A\u9910" },
  { id: "coffee", label: "\u5496\u5561", major: "\u54C1\u8D28\u751F\u6D3B", minor: "\u4F11\u95F2\u5A31\u4E50", event: "\u5496\u5561" },
  { id: "daily", label: "\u65E5\u7528\u54C1", major: "\u54C1\u8D28\u751F\u6D3B", minor: "\u65E5\u7528\u54C1" },
  { id: "traffic", label: "\u4EA4\u901A\u8D39", major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u4EA4\u901A\u8D39" },
  { id: "water", label: "\u996E\u7528\u6C34", major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996E\u7528\u6C34" },
  { id: "electric", label: "\u7535\u8D39", major: "\u56FA\u5B9A\u652F\u51FA", minor: "\u7535\u8D39" },
  { id: "utility-water", label: "\u6C34\u8D39", major: "\u56FA\u5B9A\u652F\u51FA", minor: "\u6C34\u8D39" },
  { id: "phone", label: "\u7535\u8BDD\u8D39", major: "\u56FA\u5B9A\u652F\u51FA", minor: "\u7535\u8BDD\u8D39" },
  { id: "subscribe", label: "\u8BA2\u9605", major: "\u56FA\u5B9A\u652F\u51FA", minor: "\u8BA2\u9605" },
  { id: "installment", label: "\u5206\u671F", major: "\u56FA\u5B9A\u652F\u51FA", minor: "\u5206\u671F" },
  { id: "impulse", label: "\u51B2\u52A8\u6D88\u8D39", major: "\u7A81\u53D1\u6D88\u8D39", minor: "\u51B2\u52A8\u6D88\u8D39" },
  { id: "other-expense", label: "\u5176\u4ED6", major: "\u7A81\u53D1\u6D88\u8D39", minor: "\u5176\u4ED6" },
  { id: "medicine", label: "\u533B\u836F", major: "\u7A81\u53D1\u6D88\u8D39", minor: "\u533B\u836F" },
  { id: "play", label: "\u4F11\u95F2\u5A31\u4E50", major: "\u54C1\u8D28\u751F\u6D3B", minor: "\u4F11\u95F2\u5A31\u4E50" },
  { id: "income-life", label: "\u751F\u6D3B\u8D39", kind: "income", major: "\u751F\u6D3B\u8D39/\u5DE5\u8D44", minor: "\u751F\u6D3B\u8D39", event: "\u751F\u6D3B\u8D39" },
  { id: "income-other", label: "\u5176\u4ED6", kind: "income", major: "\u5176\u4ED6/\u7A81\u53D1\u6536\u5165", minor: "\u5176\u4ED6" }
];
function financeMinors(kind, major) {
  return kind === "expense" ? EXPENSE_MINORS[major] ?? [] : INCOME_MINORS[major] ?? [];
}
function assertFinanceCategory(kind, major, minor) {
  const majors = kind === "expense" ? EXPENSE_MAJORS : INCOME_MAJORS;
  if (!majors.some((option) => option.value === major))
    throw new Error("INVALID_FINANCE_MAJOR");
  if (!financeMinors(kind, major).some((option) => option.value === minor))
    throw new Error("INVALID_FINANCE_MINOR");
}

function parseTime(value) {
  const match2 = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match2)
    return null;
  const hour = Number(match2[1]);
  const minute = Number(match2[2]);
  if (hour > 23 || minute > 59)
    return null;
  return hour * 60 + minute;
}
function sleepMinutes(onset, wake) {
  const onsetMinutes = parseTime(onset);
  const wakeMinutes = parseTime(wake);
  if (onsetMinutes === null || wakeMinutes === null)
    return null;
  return (wakeMinutes - onsetMinutes + 24 * 60) % (24 * 60);
}

var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var DAY_MS = 24 * 60 * 60 * 1e3;
function dateValue(date3) {
  if (!DATE_PATTERN.test(date3))
    throw new Error("INVALID_DATE");
  const [year, month, day] = date3.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day)
    throw new Error("INVALID_DATE");
  return value;
}
function dateText(value) {
  return [value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate()].map((part, index) => index === 0 ? String(part).padStart(4, "0") : String(part).padStart(2, "0")).join("-");
}
function addDays(date3, amount) {
  const value = dateValue(date3);
  value.setUTCDate(value.getUTCDate() + amount);
  return dateText(value);
}
function daysBetween(left, right) {
  return Math.round((dateValue(right).getTime() - dateValue(left).getTime()) / DAY_MS);
}
function dayOfWeek(date3) {
  const value = dateValue(date3).getUTCDay();
  return value === 0 ? 7 : value;
}
function mondayOfWeek(date3) {
  return addDays(date3, 1 - dayOfWeek(date3));
}
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function monthDate(startDate, monthOffset, day) {
  const start = dateValue(startDate);
  const monthIndex = start.getUTCFullYear() * 12 + start.getUTCMonth() + monthOffset;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, daysInMonth(year, month))).padStart(2, "0")}`;
}
function yearDate(startDate, yearOffset, month, day) {
  const start = dateValue(startDate);
  const year = start.getUTCFullYear() + yearOffset;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, daysInMonth(year, month))).padStart(2, "0")}`;
}
function normalizeRecurrenceRule(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return null;
  const value = input;
  const frequency = value.frequency;
  if (frequency !== "daily" && frequency !== "weekly" && frequency !== "monthly" && frequency !== "yearly")
    return null;
  const interval = value.interval === void 0 ? 1 : value.interval;
  if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 1e3)
    return null;
  const rule = { frequency, interval };
  if (frequency === "weekly") {
    const weekdays = Array.isArray(value.weekdays) ? [...new Set(value.weekdays.filter((day) => typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7))].sort((left, right) => left - right) : [];
    if (weekdays.length === 0)
      return null;
    rule.weekdays = weekdays;
  }
  if (frequency === "monthly" || frequency === "yearly") {
    const day = value.day_of_month;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 31)
      return null;
    rule.day_of_month = day;
  }
  if (frequency === "yearly") {
    const month = value.month;
    if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12)
      return null;
    rule.month = month;
  }
  return rule;
}
function nextRecurrenceDate(rule, startDate, afterDate) {
  dateValue(startDate);
  dateValue(afterDate);
  const after = afterDate < startDate ? addDays(startDate, -1) : afterDate;
  if (rule.frequency === "daily") {
    const offset = Math.max(0, Math.ceil(daysBetween(startDate, addDays(after, 1)) / rule.interval));
    return addDays(startDate, offset * rule.interval);
  }
  if (rule.frequency === "weekly") {
    const weekdays = rule.weekdays ?? [dayOfWeek(startDate)];
    const firstCandidate = addDays(after, 1);
    const startWeek = mondayOfWeek(startDate);
    for (let offset = 0; offset <= rule.interval * 7 + 7; offset += 1) {
      const candidate = addDays(firstCandidate, offset);
      const weekOffset = Math.floor(daysBetween(startWeek, mondayOfWeek(candidate)) / 7);
      if (weekOffset >= 0 && weekOffset % rule.interval === 0 && weekdays.includes(dayOfWeek(candidate)) && candidate >= startDate)
        return candidate;
    }
    return null;
  }
  if (rule.frequency === "monthly") {
    const start2 = dateValue(startDate);
    const afterValue2 = dateValue(after);
    const monthOffset = (afterValue2.getUTCFullYear() - start2.getUTCFullYear()) * 12 + afterValue2.getUTCMonth() - start2.getUTCMonth();
    let period2 = Math.max(0, Math.ceil(monthOffset / rule.interval));
    for (let attempts = 0; attempts < 2; attempts += 1) {
      const candidate = monthDate(startDate, period2 * rule.interval, rule.day_of_month ?? start2.getUTCDate());
      if (candidate > after && candidate >= startDate)
        return candidate;
      period2 += 1;
    }
    return null;
  }
  const start = dateValue(startDate);
  const afterValue = dateValue(after);
  const yearOffset = afterValue.getUTCFullYear() - start.getUTCFullYear();
  let period = Math.max(0, Math.ceil(yearOffset / rule.interval));
  for (let attempts = 0; attempts < 2; attempts += 1) {
    const candidate = yearDate(startDate, period * rule.interval, rule.month ?? start.getUTCMonth() + 1, rule.day_of_month ?? start.getUTCDate());
    if (candidate > after && candidate >= startDate)
      return candidate;
    period += 1;
  }
  return null;
}
function recurrenceDatesThrough(rule, startDate, throughDate2, afterDate = undefined) {
  dateValue(startDate);
  dateValue(throughDate2);
  const result2 = [];
  let cursor = afterDate ?? addDays(startDate, -1);
  while (true) {
    const next = nextRecurrenceDate(rule, startDate, cursor);
    if (!next || next > throughDate2)
      break;
    result2.push(next);
    cursor = next;
    if (result2.length > 1e5)
      throw new Error("RECURRENCE_TOO_MANY_OCCURRENCES");
  }
  return result2;
}

function localDateInTimezone(timezone, now5 = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now5);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function monthStart(date3) {
  return `${date3.slice(0, 7)}-01`;
}
function computeProjectProgress(completedTasks, totalTasks, manualProgress: any = null) {
  if (manualProgress !== null) {
    return Math.min(100, Math.max(0, Math.round(manualProgress)));
  }
  if (totalTasks <= 0)
    return 0;
  return Math.min(100, Math.max(0, Math.round(completedTasks / totalTasks * 100)));
}
function assertNoCycle(edges, candidate) {
  if (candidate.from === candidate.to) {
    throw new Error("DEPENDENCY_CYCLE");
  }
  const graph = /* @__PURE__ */ new Map();
  for (const edge of [...edges, candidate]) {
    const next = graph.get(edge.from) ?? [];
    next.push(edge.to);
    graph.set(edge.from, next);
  }
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  const visit = (node) => {
    if (visiting.has(node))
      return true;
    if (visited.has(node))
      return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      if (visit(next))
        return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of graph.keys()) {
    if (visit(node))
      throw new Error("DEPENDENCY_CYCLE");
  }
}
function financeQuickParse(input) {
  const amountMatch = input.match(/(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块钱?|人民币)?/i);
  if (!amountMatch)
    return null;
  const amountCents = Math.round(Number(amountMatch[1]) * 100);
  if (!Number.isFinite(amountCents) || amountCents <= 0)
    return null;
  const note = input.trim();
  const withoutAmount = (input.slice(0, amountMatch.index ?? 0) + " " + input.slice((amountMatch.index ?? 0) + amountMatch[0].length)).replace(/今天|今日|本日|当天|昨天|明天/g, " ").replace(/记账|记一笔|支出|花了|消费|买了|购买/g, " ").replace(/[，,。.!！?？；;：:]/g, " ").replace(/\s+/g, " ").trim();
  const rules = [
    { pattern: /早餐|早饭/, major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996D\u8D39", event: (match2) => match2 },
    { pattern: /午餐|午饭|中餐|中饭/, major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996D\u8D39", event: (match2) => match2 },
    { pattern: /晚餐|晚饭/, major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996D\u8D39", event: (match2) => match2 },
    { pattern: /吃饭|饭费|餐饮|餐费/, major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996D\u8D39" },
    { pattern: /饮用水|矿泉水|纯净水|买水|喝水/, major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u996E\u7528\u6C34" },
    { pattern: /交通|打车|出租车|网约车|公交|地铁|停车|加油/, major: "\u65E5\u5E38\u6D88\u8D39", minor: "\u4EA4\u901A\u8D39" },
    { pattern: /日用品|纸巾|洗衣液|洗发水|牙膏|牙刷|清洁用品/, major: "\u54C1\u8D28\u751F\u6D3B", minor: "\u65E5\u7528\u54C1" },
    { pattern: /休闲娱乐|娱乐|电影|游戏|咖啡|奶茶|聚餐/, major: "\u54C1\u8D28\u751F\u6D3B", minor: "\u4F11\u95F2\u5A31\u4E50" },
    { pattern: /医药|买药|药品|看病|医院/, major: "\u7A81\u53D1\u6D88\u8D39", minor: "\u533B\u836F" },
    { pattern: /冲动消费|冲动/, major: "\u7A81\u53D1\u6D88\u8D39", minor: "\u51B2\u52A8\u6D88\u8D39" }
  ];
  const matched = rules.find((rule) => rule.pattern.test(withoutAmount));
  if (!matched) {
    return { amountCents, category: withoutAmount || "\u672A\u5206\u7C7B", categoryMajor: null, categoryMinor: null, event: withoutAmount, note };
  }
  const keyword = withoutAmount.match(matched.pattern)?.[0] ?? withoutAmount;
  const event = matched.event?.(keyword) ?? withoutAmount;
  return {
    amountCents,
    category: matched.major + " / " + matched.minor,
    categoryMajor: matched.major,
    categoryMinor: matched.minor,
    event: event || matched.minor,
    note
  };
}
var priorityWeight = { P0: 0, P1: 1, P2: 2, P3: 3 };
function generateDailyPlan(tasks, date3, preferences) {
  const eligible = tasks.filter((task) => task.status !== "done" && task.status !== "cancelled" && (preferences.includeBlocked || task.status !== "blocked"));
  const sorted = [...eligible].sort((left, right) => {
    const leftOverdue = preferences.includeOverdueFirst && left.dueDate !== null && left.dueDate < date3 ? 0 : 1;
    const rightOverdue = preferences.includeOverdueFirst && right.dueDate !== null && right.dueDate < date3 ? 0 : 1;
    if (leftOverdue !== rightOverdue)
      return leftOverdue - rightOverdue;
    const priority = (priorityWeight[left.priority] ?? 9) - (priorityWeight[right.priority] ?? 9);
    if (priority !== 0)
      return priority;
    const leftDue = left.dueDate ?? "9999-99-99";
    const rightDue = right.dueDate ?? "9999-99-99";
    if (leftDue !== rightDue)
      return leftDue.localeCompare(rightDue);
    const leftScheduled = left.scheduledDate === date3 ? 0 : 1;
    const rightScheduled = right.scheduledDate === date3 ? 0 : 1;
    if (leftScheduled !== rightScheduled)
      return leftScheduled - rightScheduled;
    return left.id.localeCompare(right.id);
  });
  return sorted.slice(0, Math.max(0, preferences.maxItems)).map((task) => task.id);
}
var BUTLER_ALLOWED_TOOLS = [
  "system_status",
  "capabilities_get",
  "today_get",
  "attention_get",
  "planning_context_get",
  "tasks_list",
  "tasks_create",
  "projects_list",
  "projects_get",
  "projects_create",
  "projects_update",
  "project_workspace_update",
  "tasks_get",
  "tasks_update",
  "plans_get",
  "task_recurrences_list",
  "task_recurrence_get",
  "task_recurrence_occurrences_list",
  "task_recurrence_create",
  "task_recurrence_update",
  "ideas_list",
  "ideas_create",
  "ideas_update",
  "plans_generate",
  "plans_update",
  "period_plans_upsert",
  "finance_quick_preview",
  "finance_expense_create",
  "finance_income_create",
  "finance_accounts_list",
  "finance_account_entries_list",
  "finance_account_entry_create",
  "finance_expenses_list",
  "finance_incomes_list",
  "finance_summary",
  "finance_taxonomy",
  "health_get",
  "health_range",
  "health_put",
  "reviews_list",
  "reviews_get",
  "reviews_update",
  "reviews_daily_generate",
  "reviews_period_generate",
  "ideas_promote_to_task",
  "confirmations_list"
];
function butlerSystemPrompt() {
  return [
    "\u4F60\u662F Personal AI OS \u7684 AI \u7BA1\u5BB6\uFF0C\u53EA\u8BA8\u8BBA\u548C\u64CD\u4F5C\u7528\u6237\u7684\u4EFB\u52A1\u3001\u9879\u76EE\u3001\u8BA1\u5212\u3001\u8D22\u52A1\u3001\u5065\u5EB7\u3001\u590D\u76D8\u4E0E\u60F3\u6CD5\u3002",
    "\u5F53\u7528\u6237\u8BE2\u95EE\u4F60\u80FD\u505A\u4EC0\u4E48\u3001\u6709\u54EA\u4E9B\u80FD\u529B\u6216\u7C7B\u4F3C\u95EE\u9898\u65F6\uFF0C\u5FC5\u987B\u8C03\u7528 capabilities_get\uFF0C\u5E76\u4F7F\u7528\u5176 answer \u539F\u6837\u56DE\u7B54\uFF0C\u4E0D\u5F97\u81EA\u7531\u6269\u5C55\u80FD\u529B\u3002",
    "\u6570\u636E\u5E93\u662F\u552F\u4E00\u4E8B\u5B9E\u6765\u6E90\uFF1B\u6D89\u53CA\u7528\u6237\u5DF2\u6709\u6570\u636E\u65F6\uFF0C\u5FC5\u987B\u5148\u8BFB\u53D6\u5BF9\u5E94\u7684\u771F\u5B9E\u6570\u636E\u3002\u4E0D\u5728\u5DE5\u5177\u7ED3\u679C\u4E2D\u7684\u5185\u5BB9\u4E00\u5F8B\u8BF4\u2018\u672C\u5730\u5F53\u524D\u6CA1\u6709\u67E5\u5230\u2019\uFF0C\u7981\u6B62\u51ED\u7A7A\u8865\u5168\u3001\u81C6\u6D4B\u6216\u628A\u793A\u4F8B\u5F53\u6210\u7528\u6237\u6570\u636E\u3002",
    "\u65E5\u671F\u4F7F\u7528\u7528\u6237\u672C\u5730\u65F6\u533A\u548C\u672C\u5730\u65E5\u5386\u65E5\u671F\uFF1B\u56DE\u7B54\u4ECA\u5929\u3001\u672C\u5468\u3001\u672C\u6708\u65F6\u5FC5\u987B\u6309\u5F53\u524D\u65E5\u671F\u8BA1\u7B97\uFF0C\u5E76\u5199\u51FA\u5177\u4F53\u65E5\u671F\u8303\u56F4\u3002",
    "\u6D89\u53CA\u2018\u4ECA\u5929/\u4ECA\u65E5/\u672C\u5929\u2019\u7684\u4EFB\u52A1\u95EE\u9898\uFF0C\u5FC5\u987B\u5148\u8C03\u7528 today_get\uFF1B\u4E0D\u5F97\u7528\u4E0D\u5E26 date \u7684 tasks_list \u4EE3\u66FF\u3002today_get \u8FD4\u56DE\u7684 tasks.items \u624D\u662F\u4ECA\u65E5\u4EFB\u52A1\uFF0CoverdueItems \u53EA\u80FD\u5355\u72EC\u6807\u4E3A\u903E\u671F\uFF0C\u4E0D\u80FD\u6DF7\u5165\u4ECA\u65E5\u4EFB\u52A1\u3002",
    "\u53EA\u6709\u7528\u6237\u660E\u786E\u8981\u6C42\u521B\u5EFA\u3001\u8BB0\u5F55\u3001\u66F4\u65B0\u6216\u4FEE\u6539\u65F6\uFF0C\u624D\u53EF\u4EE5\u8C03\u7528\u666E\u901A\u5199\u5DE5\u5177\uFF1B\u7F3A\u5C11\u91D1\u989D\u3001\u65E5\u671F\u3001\u5206\u7C7B\u6216\u540D\u79F0\u7B49\u5FC5\u8981\u4FE1\u606F\u65F6\u5148\u8BE2\u95EE\uFF0C\u4E0D\u8981\u731C\u3002",
    "\u4EFB\u52A1\u6B63\u6587\u4F7F\u7528 content\uFF0C\u5907\u5FD8\u4F7F\u7528 description\uFF0C\u4E0D\u80FD\u6DF7\u5199\uFF1B\u6D89\u53CA\u5468\u671F\u4EFB\u52A1\u5FC5\u987B\u5148\u8BFB\u53D6 task_recurrences_list\uFF0C\u5468\u671F\u4EFB\u52A1\u662F\u72EC\u7ACB\u6A21\u677F\u800C\u4E0D\u662F\u666E\u901A\u4EFB\u52A1\uFF0C\u521B\u5EFA\u6216\u4FEE\u6539\u6A21\u677F\u524D\u5FC5\u987B\u5F97\u5230\u7528\u6237\u660E\u786E\u8981\u6C42\uFF0C\u65E5\u671F\u5B9E\u4F8B\u7531\u7CFB\u7EDF\u751F\u6210\uFF0C\u7BA1\u5BB6\u4E0D\u5F97\u81EA\u5DF1\u8BA1\u7B97\u3001\u6279\u91CF\u8865\u5EFA\u3001\u8986\u76D6\u6216\u5220\u9664\u5B9E\u4F8B\u3002\u6A21\u677F\u4FEE\u6539\u53EA\u5F71\u54CD\u672A\u6765\u65E5\u671F\uFF1B\u5220\u9664\u7684\u751F\u6210\u5B9E\u4F8B\u7531\u7CFB\u7EDF\u4FDD\u7559\u53F0\u8D26\uFF0C\u4E0D\u80FD\u6062\u590D\u3002",
    "\u652F\u51FA\u3001\u6536\u5165\u3001\u8D26\u6237\u6D41\u6C34\u662F\u4E09\u4E2A\u72EC\u7ACB\u6570\u636E\u5E93\u3002\u666E\u901A\u652F\u51FA\u548C\u666E\u901A\u6536\u5165\u6C38\u8FDC\u4E0D\u5173\u8054\u8D26\u6237\uFF1A\u4E0D\u5F97\u8BE2\u95EE\u8D26\u6237\u3001\u4E0D\u5F97\u586B\u5199 account_id\u3001\u4E0D\u5F97\u521B\u5EFA\u8D26\u6237\u6D41\u6C34\u3001\u4E0D\u5F97\u8BFB\u53D6\u6216\u6539\u53D8\u8D26\u6237\u4F59\u989D\uFF1B\u53EA\u6709\u7528\u6237\u660E\u786E\u8BF4\u628A\u94B1\u5B58\u5165\u6216\u4ECE\u4E13\u7528\u8D26\u6237\u53D6\u51FA\u65F6\uFF0C\u624D\u4F7F\u7528\u8D26\u6237\u6D41\u6C34\u5DE5\u5177\u3002\u8D26\u6237\u53EA\u662F\u4E13\u95E8\u7528\u9014\u8D44\u91D1\u7684\u72EC\u7ACB\u7BA1\u7406\uFF0C\u4E0D\u4EE3\u8868\u65E5\u5E38\u652F\u51FA\u7684\u6765\u6E90\u3002",
    "\u7528\u6237\u8BF4\u2018\u4ECA\u65E5\u5348\u996D10\u5143\u2019\u8FD9\u7C7B\u660E\u786E\u8BB0\u8D26\u8BF7\u6C42\u65F6\uFF0C\u76F4\u63A5\u6309\u5F53\u524D\u672C\u5730\u65E5\u671F\u767B\u8BB0\u666E\u901A\u652F\u51FA\uFF0C\u5348\u996D\u5F52\u5165\u2018\u65E5\u5E38\u6D88\u8D39/\u996D\u8D39\u2019\uFF0C\u4E8B\u4EF6\u586B\u5199\u2018\u5348\u996D\u2019\uFF0C\u91D1\u989D\u4E3A1000\u5206\uFF1B\u4E0D\u8981\u628A\u6574\u53E5\u5F53\u4F5C\u5206\u7C7B\uFF0C\u4E0D\u8981\u8981\u6C42\u8D26\u6237\uFF0C\u4E0D\u8981\u5148\u628A\u5185\u90E8\u89E3\u6790\u8FC7\u7A0B\u5C55\u793A\u7ED9\u7528\u6237\u3002\u5206\u7C7B\u80FD\u591F\u6839\u636E\u8D22\u52A1\u5206\u7C7B\u8868\u786E\u5B9A\u65F6\u76F4\u63A5\u5199\u5165\uFF1B\u53EA\u6709\u786E\u5B9E\u65E0\u6CD5\u786E\u5B9A\u7684\u5FC5\u8981\u4FE1\u606F\u624D\u8BE2\u95EE\u3002",
    "\u8D22\u52A1\u5199\u5165\u6210\u529F\u540E\u53EA\u7B80\u77ED\u786E\u8BA4\u5DF2\u8BB0\u5F55\u7684\u7C7B\u578B\u3001\u91D1\u989D\u3001\u65E5\u671F\u548C\u5206\u7C7B\uFF1B\u4E0D\u8981\u5411\u7528\u6237\u5C55\u793A\u2018\u7CFB\u7EDF\u8BC6\u522B\u7ED3\u679C\u2019\u3001\u5185\u90E8\u5B57\u6BB5\u6216\u865A\u6784\u7684\u8D26\u6237\u4FE1\u606F\u3002",
    "\u5065\u5EB7\u8BB0\u5F55\u4F7F\u7528\u8FD0\u52A8\u5B57\u6BB5\uFF1B\u7761\u7720\u65F6\u957F\u7531\u4E0A\u5E8A\u548C\u8D77\u5E8A\u65F6\u95F4\u8BA1\u7B97\uFF1B\u590D\u76D8\u53EA\u80FD\u57FA\u4E8E\u771F\u5B9E\u6570\u636E\u8D77\u8349\uFF0C\u4E0D\u80FD\u628A\u8349\u7A3F\u5192\u5145\u6700\u7EC8\u590D\u76D8\u3002",
    "\u7981\u6B62 SQL\u3001\u76F4\u63A5\u8BBF\u95EE\u6570\u636E\u5E93\u3001\u4FEE\u6539 schema\u3001\u4FEE\u6539\u4EE3\u7801\u3001\u7269\u7406\u5220\u9664\u4E1A\u52A1\u5386\u53F2\uFF0C\u7981\u6B62\u628A workflow \u6807\u8BB0\u4E3A active\uFF0C\u4E5F\u4E0D\u5F97\u64C5\u81EA\u65B0\u589E\u4E1A\u52A1\u5B57\u6BB5\u3001\u9875\u9762\u6216\u6570\u636E\u5E93\u3002",
    "\u9AD8\u98CE\u9669\u64CD\u4F5C\u5FC5\u987B\u8BA9\u7528\u6237\u5728 Web UI \u786E\u8BA4\uFF1B\u4E0D\u8981\u58F0\u79F0\u81EA\u5DF1\u5DF2\u7ECF\u6279\u51C6\u786E\u8BA4\u7968\u3002",
    `\u53EF\u7528\u767D\u540D\u5355\u80FD\u529B\uFF1A${BUTLER_ALLOWED_TOOLS.join(", ")}`
  ].join("\n");
}
function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else
        quoted = !quoted;
    } else if (character === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}
function parseCsv(content): { headers: string[]; rows: Array<Record<string, string>> } {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0)
    return { headers: [], rows: [] };
  const firstLine = lines[0];
  if (firstLine === void 0)
    return { headers: [], rows: [] };
  const headers = parseCsvLine(firstLine).map((header) => header.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
  return { headers, rows };
}
function parseIcs(content) {
  const unfolded = content.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let current = null;
  for (const line of unfolded) {
    if (line === "BEGIN:VEVENT")
      current = {};
    else if (line === "END:VEVENT" && current) {
      if (current.summary && current.start)
        events.push({ externalId: current.externalId ?? `${current.start}:${current.summary}`, summary: current.summary, description: current.description ?? "", start: current.start, end: current.end ?? current.start });
      current = null;
    } else if (current) {
      const separator = line.indexOf(":");
      if (separator < 0)
        continue;
      const key = (line.slice(0, separator).split(";")[0] ?? "").toUpperCase();
      const value = line.slice(separator + 1).replace(/\\n/g, "\n").replace(/\\,/g, ",");
      if (key === "UID")
        current.externalId = value;
      if (key === "SUMMARY")
        current.summary = value;
      if (key === "DESCRIPTION")
        current.description = value;
      if (key === "DTSTART")
        current.start = value;
      if (key === "DTEND")
        current.end = value;
    }
  }
  return events;
}

export type RecurrenceRule = any;
export { ACCOUNT_LABELS, BUTLER_ALLOWED_TOOLS, EXPENSE_MAJORS, EXPENSE_MINORS, INCOME_MAJORS, INCOME_MINORS, DEFAULT_QUICK_BUTTONS, assertFinanceCategory, assertNoCycle, computeProjectProgress, financeQuickParse, generateDailyPlan, localDateInTimezone, monthStart, normalizeRecurrenceRule, nextRecurrenceDate, parseCsv, parseIcs, recurrenceDatesThrough, shouldArchiveIdea, shouldArchiveTask, sleepMinutes, butlerSystemPrompt };
