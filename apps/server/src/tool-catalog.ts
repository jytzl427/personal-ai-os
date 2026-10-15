export type ToolDomain = "system" | "tasks" | "projects" | "ideas" | "finance" | "health" | "reviews" | "conversations";
export type ToolAccess = "read" | "ordinary_write" | "confirmation";

export type ToolCatalogEntry = {
  domain: ToolDomain;
  access: ToolAccess;
  batchable: boolean;
};

const readTools = (domain: ToolDomain): ToolCatalogEntry => ({ domain, access: "read", batchable: true });
const writeTools = (domain: ToolDomain): ToolCatalogEntry => ({ domain, access: "ordinary_write", batchable: true });
const protectedWriteTools = (domain: ToolDomain): ToolCatalogEntry => ({ domain, access: "ordinary_write", batchable: false });
const confirmationTools = (domain: ToolDomain): ToolCatalogEntry => ({ domain, access: "confirmation", batchable: false });

export const TOOL_CATALOG: Readonly<Record<string, ToolCatalogEntry>> = {
  system_status: readTools("system"),
  capabilities_get: readTools("system"),
  today_get: readTools("system"),
  attention_get: readTools("system"),
  planning_context_get: readTools("tasks"),
  plans_get: readTools("tasks"),
  tasks_list: readTools("tasks"),
  tasks_get: readTools("tasks"),
  tasks_create: writeTools("tasks"),
  tasks_update: writeTools("tasks"),
  task_recurrences_list: readTools("tasks"),
  task_recurrence_get: readTools("tasks"),
  task_recurrence_occurrences_list: readTools("tasks"),
  task_recurrence_check: writeTools("tasks"),
  task_recurrence_create: protectedWriteTools("tasks"),
  task_recurrence_update: protectedWriteTools("tasks"),
  projects_list: readTools("projects"),
  projects_get: readTools("projects"),
  projects_create: writeTools("projects"),
  projects_update: writeTools("projects"),
  project_workspace_update: writeTools("projects"),
  ideas_list: readTools("ideas"),
  ideas_create: writeTools("ideas"),
  ideas_update: writeTools("ideas"),
  ideas_promote_to_task: confirmationTools("ideas"),
  plans_generate: writeTools("tasks"),
  plans_update: writeTools("tasks"),
  period_plans_upsert: writeTools("tasks"),
  finance_quick_preview: readTools("finance"),
  finance_accounts_list: readTools("finance"),
  finance_account_entries_list: readTools("finance"),
  finance_account_entry_create: writeTools("finance"),
  finance_expenses_list: readTools("finance"),
  finance_expense_create: writeTools("finance"),
  finance_incomes_list: readTools("finance"),
  finance_income_create: writeTools("finance"),
  finance_summary: readTools("finance"),
  finance_taxonomy: readTools("finance"),
  health_get: readTools("health"),
  health_range: readTools("health"),
  health_put: writeTools("health"),
  reviews_list: readTools("reviews"),
  reviews_get: readTools("reviews"),
  reviews_update: writeTools("reviews"),
  reviews_daily_generate: writeTools("reviews"),
  reviews_period_generate: writeTools("reviews"),
  confirmations_list: readTools("system")
};

export function getToolCatalogEntry(name: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG[name];
}
