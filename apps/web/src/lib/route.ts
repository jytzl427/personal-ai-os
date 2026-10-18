export type Route =
  | { name: "today" }
  | { name: "tasks"; tab?: "tasks" | "recurring" }
  | { name: "task"; id: string }
  | { name: "recurring-task"; id: string }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "finance"; tab: "quick" | "expenses" | "incomes" | "accounts" | "stats" }
  | { name: "health" }
  | { name: "plans"; tab: "daily-plan" | "stage-plan" | "daily-review" | "period-review" }
  | { name: "reviews"; tab: "daily" | "period" }
  | { name: "review"; tab: "daily" | "period"; id: string }
  | { name: "butler"; conversationId: string | null }
  | { name: "archive"; tab: "tasks" | "ideas" | "projects" | "project-tasks" | "conversations" | "plans" | "stage-plans" }
  | { name: "settings" };

type FinanceTab = "quick" | "expenses" | "incomes" | "accounts" | "stats";
type ArchiveTab = "tasks" | "ideas" | "projects" | "project-tasks" | "conversations" | "plans" | "stage-plans";
const financeTabs = new Set<FinanceTab>(["quick", "expenses", "incomes", "accounts", "stats"]);
const archiveTabs = new Set<ArchiveTab>(["tasks", "ideas", "projects", "project-tasks", "conversations", "plans", "stage-plans"]);
const planTabs = new Set(["daily-plan", "stage-plan", "daily-review", "period-review"]);

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeSegment);
  const [first, second, third] = path;

  if (first === "today") return { name: "today" };
  if (!first) return { name: "tasks" };
  if (first === "tasks" && second === "recurring") return { name: "tasks", tab: "recurring" };
  if (first === "tasks" && second) return { name: "task", id: second };
  if (first === "recurring-tasks" && second) return { name: "recurring-task", id: second };
  if (first === "tasks") return { name: "tasks" };
  if (first === "ideas") return { name: "tasks" };
  if (first === "projects" && second) return { name: "project", id: second };
  if (first === "projects") return { name: "projects" };
  if (first === "finance") {
    const tab = second && financeTabs.has(second as FinanceTab) ? second as FinanceTab : "quick";
    return { name: "finance", tab };
  }
  if (first === "health") return { name: "health" };
  if (first === "plans") {
    const tab = second && planTabs.has(second) ? second as "daily-plan" | "stage-plan" | "daily-review" | "period-review" : "daily-plan";
    return { name: "plans", tab };
  }
  if (first === "reviews") {
    if ((second === "daily" || second === "period") && third) return { name: "review", tab: second, id: third };
    if (second && second !== "daily" && second !== "period") return { name: "review", tab: "daily", id: second };
    return { name: "reviews", tab: second === "period" ? "period" : "daily" };
  }
  if (first === "butler") return { name: "tasks" };
  if (first === "archive") {
    const tab = second && archiveTabs.has(second as ArchiveTab) ? second as ArchiveTab : "tasks";
    return { name: "archive", tab };
  }
  if (first === "settings") return { name: "settings" };
  return { name: "tasks" };
}

export function toHash(route: Route): string {
  switch (route.name) {
    case "today": return "#/today";
    case "tasks": return route.tab === "recurring" ? "#/tasks/recurring" : "#/tasks";
    case "task": return "#/tasks/" + encodeURIComponent(route.id);
    case "recurring-task": return "#/recurring-tasks/" + encodeURIComponent(route.id);
    case "projects": return "#/projects";
    case "project": return "#/projects/" + encodeURIComponent(route.id);
    case "finance": return route.tab === "quick" ? "#/finance" : "#/finance/" + route.tab;
    case "health": return "#/health";
    case "plans": return route.tab === "daily-plan" ? "#/plans" : "#/plans/" + route.tab;
    case "reviews": return route.tab === "daily" ? "#/reviews" : "#/reviews/period";
    case "review": return `#/reviews/${route.tab}/${encodeURIComponent(route.id)}`;
    case "butler": return route.conversationId ? "#/butler/" + encodeURIComponent(route.conversationId) : "#/butler";
    case "archive": return route.tab === "tasks" ? "#/archive" : "#/archive/" + route.tab;
    case "settings": return "#/settings";
  }
}

export type NavItem = {
  label: string;
  route: Route;
};

export const navigation: NavItem[] = [
  { label: "任务", route: { name: "tasks" } },
  { label: "项目", route: { name: "projects" } },
  { label: "财务", route: { name: "finance", tab: "expenses" } },
  { label: "健康", route: { name: "health" } },
  { label: "计划与复盘", route: { name: "plans", tab: "daily-plan" } },
  { label: "归档", route: { name: "archive", tab: "tasks" } },
  { label: "设置", route: { name: "settings" } }
];

export function activeNavName(route: Route): string {
  if (route.name === "today") return "今日";
  if (route.name === "project") return "项目";
  if (route.name === "task") return "任务";
  if (route.name === "recurring-task") return "任务";
  if (route.name === "finance") return "财务";
  if (route.name === "plans") return "计划与复盘";
  if (route.name === "archive") return "归档";
  if (route.name === "reviews") return "计划与复盘";
  if (route.name === "review") return "计划与复盘";
  return navigation.find((item) => item.route.name === route.name)?.label ?? "任务";
}

export function pageTitle(route: Route): string {
  if (route.name === "today") return "今日";
  if (route.name === "task") return "任务详情";
  if (route.name === "recurring-task") return "周期任务模板";
  if (route.name === "project") return "项目详情";
  if (route.name === "finance") return "财务";
  if (route.name === "plans") return "计划与复盘";
  if (route.name === "reviews") return route.tab === "daily" ? "每日复盘" : "阶段复盘";
  if (route.name === "review") return route.tab === "daily" ? "每日复盘详情" : "阶段复盘详情";
  if (route.name === "archive") return "归档";
  return activeNavName(route);
}


