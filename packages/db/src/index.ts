// Recovered from the verified standalone server bundle. Runtime behavior is preserved.
// @ts-nocheck
import Database from "better-sqlite3";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, statSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";

import { localDateInTimezone, EXPENSE_MINORS, INCOME_MINORS, ACCOUNT_LABELS, DEFAULT_QUICK_BUTTONS } from "@paios/core";
var INITIAL_SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  change_id TEXT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
  agent_token_id TEXT,
  agent_name TEXT,
  tool_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  request_json TEXT,
  before_json TEXT,
  after_json TEXT,
  result TEXT NOT NULL,
  ip TEXT
);

CREATE TABLE IF NOT EXISTS confirmation_tickets (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  human_summary TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'high',
  ttl_class TEXT NOT NULL CHECK (ttl_class IN ('interactive', 'parked')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'superseded', 'executed', 'failed')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT,
  executed_at TEXT
);

CREATE TABLE IF NOT EXISTS workflow_versions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('propose', 'draft', 'pending_review', 'active', 'rejected', 'rolled_back')),
  spec_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  user_feedback TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(scope, version)
);

CREATE TABLE IF NOT EXISTS purge_jobs (
  id TEXT PRIMARY KEY,
  requested_at TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'executed')),
  confirmed_by TEXT,
  executed_at TEXT,
  result_json TEXT
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  format TEXT NOT NULL CHECK (format IN ('csv', 'ics')),
  target TEXT NOT NULL CHECK (target IN ('tasks', 'finance')),
  fingerprint TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('preview', 'committed')),
  preview_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'mid',
  started_at TEXT,
  target_date TEXT,
  end_date TEXT,
  target_result TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea',
  priority TEXT NOT NULL DEFAULT 'P2',
  progress_manual INTEGER,
  benefit_enabled INTEGER NOT NULL DEFAULT 0,
  benefit_cents INTEGER,
  benefit_kind TEXT NOT NULL DEFAULT 'none',
  archive_requested INTEGER NOT NULL DEFAULT 0,
  score INTEGER DEFAULT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS project_workspaces (
  project_id TEXT PRIMARY KEY,
  introduction TEXT NOT NULL DEFAULT '',
  goals TEXT NOT NULL DEFAULT '',
  current_situation TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_task_plans (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'cancelled')),
  todo_task_id TEXT UNIQUE,
  archive_requested INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS project_activity_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'progress',
  content TEXT NOT NULL,
  important INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS project_issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS project_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  plan_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  sort_order INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  recurrence_id TEXT,
  recurrence_date TEXT,
  parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'P2',
  due_date TEXT,
  scheduled_date TEXT,
  estimate_minutes INTEGER,
  energy TEXT,
  archive_requested INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS task_recurrences (
  id TEXT PRIMARY KEY,
  title_template TEXT NOT NULL DEFAULT '',
  description_template TEXT NOT NULL DEFAULT '',
  content_template TEXT NOT NULL DEFAULT '',
  rule_json TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  start_date TEXT NOT NULL,
  end_date TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  paused_from_date TEXT,
  next_occurrence_date TEXT,
  last_checked_at TEXT,
  last_generated_at TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  last_error TEXT,
  template_version INTEGER NOT NULL DEFAULT 1,
  row_version INTEGER NOT NULL DEFAULT 1,
  legacy_source_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_recurrence_versions (
  id TEXT PRIMARY KEY,
  recurrence_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  title_template TEXT NOT NULL DEFAULT '',
  description_template TEXT NOT NULL DEFAULT '',
  content_template TEXT NOT NULL DEFAULT '',
  rule_json TEXT NOT NULL,
  schedule_anchor_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (recurrence_id, version)
);

CREATE TABLE IF NOT EXISTS task_recurrence_occurrences (
  id TEXT PRIMARY KEY,
  recurrence_id TEXT NOT NULL,
  occurrence_date TEXT NOT NULL,
  task_id TEXT,
  template_version INTEGER NOT NULL DEFAULT 1,
  outcome TEXT NOT NULL CHECK (outcome IN ('generated', 'skipped', 'deleted', 'failed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (recurrence_id, occurrence_date)
);

CREATE TABLE IF NOT EXISTS task_recurrence_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
  generated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  trigger_source TEXT,
  target_recurrence_id TEXT,
  lock_result TEXT
);

CREATE TABLE IF NOT EXISTS task_recurrence_sync_lock (
  lock_name TEXT PRIMARY KEY,
  owner_id TEXT,
  acquired_at TEXT,
  lease_expires_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_project_links (
  task_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (task_id, project_id)
);

CREATE TABLE IF NOT EXISTS task_milestone_links (
  task_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  PRIMARY KEY (task_id, milestone_id)
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  id TEXT PRIMARY KEY,
  blocked_task_id TEXT NOT NULL,
  blocking_task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(blocked_task_id, blocking_task_id)
);

CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'short_term',
  urgency INTEGER NOT NULL DEFAULT 4,
  processed INTEGER NOT NULL DEFAULT 0,
  archive_requested INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'inbox',
  promoted_task_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS daily_plans (
  id TEXT PRIMARY KEY,
  plan_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft',
  plan_text TEXT NOT NULL DEFAULT '',
  generated_at TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_plan_items (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  completed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(plan_id, task_id)
);

CREATE TABLE IF NOT EXISTS period_plans (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  plan_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE(period_start, period_end),
  CHECK(period_start <= period_end)
);

CREATE TABLE IF NOT EXISTS finance_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'cash',
  currency TEXT NOT NULL DEFAULT 'CNY',
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  current_balance_cents INTEGER NOT NULL DEFAULT 0,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS finance_account_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'deposit',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  event TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  occurred_date TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS finance_expenses (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  category TEXT NOT NULL,
  category_major TEXT NOT NULL DEFAULT '',
  category_minor TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  event TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  occurred_date TEXT NOT NULL,
  linked_transaction_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS finance_incomes (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'CNY',
  category TEXT NOT NULL,
  category_major TEXT NOT NULL DEFAULT '',
  category_minor TEXT NOT NULL DEFAULT '',
  project_id TEXT,
  event TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  occurred_date TEXT NOT NULL,
  linked_transaction_id TEXT,
  row_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS finance_transactions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('transfer', 'expense_link', 'income_link', 'adjustment')),
  note TEXT NOT NULL DEFAULT '',
  occurred_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  archive_reason TEXT,
  archived_by TEXT
);

CREATE TABLE IF NOT EXISTS finance_transaction_legs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit'))
);

CREATE TABLE IF NOT EXISTS health_logs (
  id TEXT PRIMARY KEY,
  log_date TEXT NOT NULL UNIQUE,
  weight_kg REAL,
  bedtime_local TEXT,
  sleep_onset_local TEXT,
  wake_local TEXT,
  sleep_duration_minutes INTEGER,
  exercise_note TEXT,
  exercise_minutes INTEGER,
  disciplined INTEGER,
  cloud_content TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  review_type TEXT NOT NULL CHECK (review_type IN ('daily', 'period', 'project')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'data_first',
  status TEXT NOT NULL DEFAULT 'draft',
  content_json TEXT NOT NULL DEFAULT '{}',
  finalized_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '\u65B0\u5BF9\u8BDD',
  project_id TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content_text TEXT NOT NULL DEFAULT '',
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  relpath TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_tool_calls (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_snapshots (
  review_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (review_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_date ON tasks(scheduled_date) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_task_plans_project ON project_task_plans(project_id, archived_at, due_date);
CREATE INDEX IF NOT EXISTS idx_project_activity_logs_project ON project_activity_logs(project_id, archived_at, created_at);
CREATE INDEX IF NOT EXISTS idx_expenses_occurred_date ON finance_expenses(occurred_date);
CREATE INDEX IF NOT EXISTS idx_incomes_occurred_date ON finance_incomes(occurred_date);
CREATE INDEX IF NOT EXISTS idx_account_entries_occurred_date ON finance_account_entries(occurred_date);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON confirmation_tickets(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
-- idx_audit_change_id is created by migration 012 after old databases receive the column.
CREATE INDEX IF NOT EXISTS idx_conversation_tool_calls ON conversation_tool_calls(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_idempotency_created_at ON agent_idempotency(created_at);
`;
var MIGRATION_NAME = "002_standalone_finance_entries";
var TASK_CONTENT_MIGRATION_NAME = "003_task_page_content";
var TASK_RECURRENCE_MIGRATION_NAME = "004_task_recurrence";
var FINANCE_HEALTH_MIGRATION_NAME = "005_finance_health_categories";
var ACCOUNT_ENTRIES_MIGRATION_NAME = "006_account_deposit_entries";
var ACCOUNT_FLOW_MIGRATION_NAME = "007_account_deposit_withdrawal";
var AGENT_ACCESS_MIGRATION_NAME = "008_agent_access";
var BUTLER_TOOL_TRACE_MIGRATION_NAME = "009_butler_tool_trace";
var AGENT_IDEMPOTENCY_MIGRATION_NAME = "010_agent_idempotency";
var AUDIT_AGENT_TOKEN_MIGRATION_NAME = "011_audit_agent_token";
var AUDIT_SNAPSHOTS_MIGRATION_NAME = "012_audit_snapshots";
var STANDALONE_RECURRENCE_TEMPLATE_MIGRATION_NAME = "013_standalone_recurrence_templates";
var PLAN_DOCUMENT_MIGRATION_NAME = "014_plan_documents";
var STAGE_PLAN_DOCUMENT_MIGRATION_NAME = "015_stage_plan_documents";
var PERIOD_PLAN_DOCUMENT_MIGRATION_NAME = "016_period_plan_documents";
var PROJECT_SYSTEM_MIGRATION_NAME = "017_project_system";
var PROJECT_LIFECYCLE_MIGRATION_NAME = "018_project_lifecycle";
var PROJECT_TASK_ARCHIVE_MIGRATION_NAME = "019_project_task_archive";
var nowIso = () => (/* @__PURE__ */ new Date()).toISOString();
function columns(database, table) {
  return new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}
function columnInfo(database, table, name) {
  return database.prepare(`PRAGMA table_info(${table})`).all().find((row) => row.name === name);
}
function ensureColumn(database, table, name, definition) {
  if (!columns(database, table).has(name))
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}
function flattenMinors(groups) {
  return new Set(Object.values(groups).flatMap((items) => items.map((item) => item.value)));
}
function applyMigrations(database) {
  database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL)");
  database.prepare("INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(1, "001_ui_restructure", nowIso());
  const alreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(MIGRATION_NAME);
  if (!alreadyApplied) {
    const migrate = database.transaction(() => {
      ensureColumn(database, "tasks", "archive_requested", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(database, "ideas", "archive_requested", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(database, "ideas", "urgency", "INTEGER NOT NULL DEFAULT 4");
      ensureColumn(database, "ideas", "processed", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(database, "projects", "category", "TEXT NOT NULL DEFAULT 'mid'");
      ensureColumn(database, "projects", "started_at", "TEXT");
      ensureColumn(database, "projects", "target_date", "TEXT");
      ensureColumn(database, "projects", "target_result", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(database, "projects", "benefit_kind", "TEXT NOT NULL DEFAULT 'none'");
      for (const table of ["finance_expenses", "finance_incomes"]) {
        ensureColumn(database, table, "category_major", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, table, "category_minor", "TEXT NOT NULL DEFAULT ''");
        ensureColumn(database, table, "project_id", "TEXT");
        ensureColumn(database, table, "event", "TEXT NOT NULL DEFAULT ''");
      }
      for (const table of ["finance_expenses", "finance_incomes"]) {
        if (columnInfo(database, table, "account_id")?.notnull !== 1)
          continue;
        const replacement = `${table}_standalone`;
        database.exec(`
        CREATE TABLE ${replacement} (
          id TEXT PRIMARY KEY,
          account_id TEXT,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          currency TEXT NOT NULL DEFAULT 'CNY',
          category TEXT NOT NULL,
          category_major TEXT NOT NULL DEFAULT '',
          category_minor TEXT NOT NULL DEFAULT '',
          project_id TEXT,
          event TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          occurred_date TEXT NOT NULL,
          linked_transaction_id TEXT,
          row_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          archive_reason TEXT,
          archived_by TEXT
        );
        INSERT INTO ${replacement} (id, account_id, amount_cents, currency, category, category_major, category_minor, project_id, event, note, occurred_date, linked_transaction_id, row_version, created_at, updated_at, archived_at, archive_reason, archived_by)
          SELECT id, account_id, amount_cents, currency, category, category_major, category_minor, project_id, event, note, occurred_date, linked_transaction_id, row_version, created_at, updated_at, archived_at, archive_reason, archived_by FROM ${table};
        DROP TABLE ${table};
        ALTER TABLE ${replacement} RENAME TO ${table};
      `);
      }
      database.exec("CREATE INDEX IF NOT EXISTS idx_expenses_occurred_date ON finance_expenses(occurred_date); CREATE INDEX IF NOT EXISTS idx_incomes_occurred_date ON finance_incomes(occurred_date);");
      ensureColumn(database, "health_logs", "bedtime_local", "TEXT");
      ensureColumn(database, "health_logs", "wake_local", "TEXT");
      ensureColumn(database, "health_logs", "exercise_note", "TEXT");
      ensureColumn(database, "health_logs", "exercise_minutes", "INTEGER");
      ensureColumn(database, "health_logs", "disciplined", "INTEGER");
      database.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '\u65B0\u5BF9\u8BDD',
        project_id TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content_text TEXT NOT NULL DEFAULT '',
        attachments_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id TEXT,
        filename TEXT NOT NULL,
        mime TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        relpath TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
      database.exec("UPDATE tasks SET archive_requested = 1 WHERE archived_at IS NOT NULL AND archive_requested = 0");
      database.exec("UPDATE ideas SET archive_requested = 1 WHERE archived_at IS NOT NULL AND archive_requested = 0");
      database.exec("UPDATE ideas SET processed = 1 WHERE status IN ('promoted', 'archived') AND processed = 0");
      database.exec("UPDATE projects SET category = 'mid' WHERE category IS NULL OR category = ''");
      database.exec("UPDATE projects SET target_result = description WHERE target_result IS NULL OR target_result = ''");
      database.exec("UPDATE projects SET benefit_kind = CASE WHEN benefit_enabled = 1 THEN 'certain' ELSE 'none' END WHERE benefit_kind IS NULL OR benefit_kind = ''");
      const expenseMinors = flattenMinors(EXPENSE_MINORS);
      const incomeMinors = flattenMinors(INCOME_MINORS);
      const expenseRows = database.prepare("SELECT id, category, category_major, category_minor, event FROM finance_expenses WHERE category_major = '' OR category_minor = ''").all();
      const incomeRows = database.prepare("SELECT id, category, category_major, category_minor, event FROM finance_incomes WHERE category_major = '' OR category_minor = ''").all();
      const updateExpense = database.prepare("UPDATE finance_expenses SET category_major = ?, category_minor = ?, event = ? WHERE id = ?");
      const updateIncome = database.prepare("UPDATE finance_incomes SET category_major = ?, category_minor = ?, event = ? WHERE id = ?");
      for (const row of expenseRows) {
        const minor = expenseMinors.has(row.category) ? row.category : "\u5176\u4ED6";
        updateExpense.run(minor === row.category ? "\u65E5\u5E38\u6D88\u8D39" : "\u65E5\u5E38\u6D88\u8D39", minor, row.event || (minor === row.category ? "" : row.category), row.id);
      }
      for (const row of incomeRows) {
        const minor = incomeMinors.has(row.category) ? row.category : "\u5176\u4ED6";
        updateIncome.run(minor === "\u751F\u6D3B\u8D39" ? "\u751F\u6D3B\u8D39/\u5DE5\u8D44" : "\u7A81\u53D1/\u5176\u4ED6\u6536\u5165", minor, row.event || (minor === row.category ? "" : row.category), row.id);
      }
      const accountUpdate = database.prepare("UPDATE finance_accounts SET name = ? WHERE id = ?");
      for (const [id, info] of Object.entries(ACCOUNT_LABELS))
        accountUpdate.run(info.label, id);
      database.prepare("INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)").run("finance.quick_buttons", JSON.stringify(DEFAULT_QUICK_BUTTONS), nowIso());
      database.prepare("INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)").run("finance.default_account_id", JSON.stringify("love"), nowIso());
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(2, MIGRATION_NAME, nowIso());
    });
    migrate();
  }
  const taskContentAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(TASK_CONTENT_MIGRATION_NAME);
  if (!taskContentAlreadyApplied) {
    const migrateTaskContent = database.transaction(() => {
      ensureColumn(database, "tasks", "content", "TEXT NOT NULL DEFAULT ''");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(3, TASK_CONTENT_MIGRATION_NAME, nowIso());
    });
    migrateTaskContent();
  }
  const taskRecurrenceAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(TASK_RECURRENCE_MIGRATION_NAME);
  if (!taskRecurrenceAlreadyApplied) {
    const migrateTaskRecurrence = database.transaction(() => {
      ensureColumn(database, "tasks", "recurrence_id", "TEXT");
      ensureColumn(database, "tasks", "recurrence_date", "TEXT");
      database.exec(`
        CREATE TABLE IF NOT EXISTS task_recurrences (
          id TEXT PRIMARY KEY,
          template_task_id TEXT NOT NULL UNIQUE,
          title_template TEXT NOT NULL DEFAULT '',
          description_template TEXT NOT NULL DEFAULT '',
          content_template TEXT NOT NULL DEFAULT '',
          rule_json TEXT NOT NULL,
          timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
          start_date TEXT NOT NULL,
          end_date TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          next_occurrence_date TEXT,
          last_checked_at TEXT,
          last_generated_at TEXT,
          status TEXT NOT NULL DEFAULT 'ok',
          last_error TEXT,
          row_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_recurrence_occurrences (
          id TEXT PRIMARY KEY,
          recurrence_id TEXT NOT NULL,
          occurrence_date TEXT NOT NULL,
          task_id TEXT,
          outcome TEXT NOT NULL CHECK (outcome IN ('generated', 'skipped', 'deleted', 'failed')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (recurrence_id, occurrence_date)
        );
        CREATE TABLE IF NOT EXISTS task_recurrence_runs (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'partial', 'failed')),
          generated_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          error_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_recurrence ON tasks(recurrence_id, recurrence_date);
        CREATE INDEX IF NOT EXISTS idx_recurrence_occurrences ON task_recurrence_occurrences(recurrence_id, occurrence_date);
      `);
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(4, TASK_RECURRENCE_MIGRATION_NAME, nowIso());
    });
    migrateTaskRecurrence();
  }
  const financeHealthAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(FINANCE_HEALTH_MIGRATION_NAME);
  if (!financeHealthAlreadyApplied) {
    const migrateFinanceHealth = database.transaction(() => {
      ensureColumn(database, "health_logs", "cloud_content", "TEXT");
      database.exec(`
        UPDATE health_logs
        SET cloud_content = note
        WHERE (cloud_content IS NULL OR cloud_content = '') AND note IS NOT NULL AND note <> '';

        UPDATE finance_expenses
        SET category_minor = CASE category_minor
          WHEN '\u65E9\u9910' THEN '\u996D\u8D39'
          WHEN '\u5348\u9910' THEN '\u996D\u8D39'
          WHEN '\u665A\u9910' THEN '\u996D\u8D39'
          WHEN '\u996E\u6599' THEN '\u996E\u7528\u6C34'
          WHEN '\u5496\u5561' THEN '\u4F11\u95F2\u5A31\u4E50'
          WHEN '\u8BA2\u9605/\u5206\u671F' THEN '\u8BA2\u9605'
          ELSE category_minor
        END;
        UPDATE finance_expenses
        SET category_major = CASE
          WHEN category_minor IN ('\u65E5\u7528\u54C1', '\u4F11\u95F2\u5A31\u4E50') THEN '\u54C1\u8D28\u751F\u6D3B'
          WHEN category_minor IN ('\u996D\u8D39', '\u996E\u7528\u6C34', '\u4EA4\u901A\u8D39') THEN '\u65E5\u5E38\u6D88\u8D39'
          WHEN category_minor IN ('\u8BA2\u9605', '\u5206\u671F', '\u7535\u8D39', '\u6C34\u8D39', '\u7535\u8BDD\u8D39') THEN '\u56FA\u5B9A\u652F\u51FA'
          ELSE '\u7A81\u53D1\u6D88\u8D39'
        END;
        UPDATE finance_expenses SET category = category_major || ' / ' || category_minor;

        UPDATE finance_incomes SET category_major = '\u5176\u4ED6/\u7A81\u53D1\u6536\u5165' WHERE category_major = '\u7A81\u53D1/\u5176\u4ED6\u6536\u5165';
        UPDATE finance_incomes SET category_minor = '\u4E2D\u8F6C\u7AD9' WHERE category_minor = '\u4E2D\u8F6C\u7AD9\u9879\u76EE';
        UPDATE finance_incomes
        SET category_major = CASE
          WHEN category_minor IN ('\u4EE3\u62A2\u2192\u706B\u5C71', '\u4E2D\u8F6C\u7AD9', '\u9879\u76EE\u6536\u5165') THEN '\u9879\u76EE\u6536\u5165'
          WHEN category_minor = '\u751F\u6D3B\u8D39' THEN '\u751F\u6D3B\u8D39/\u5DE5\u8D44'
          ELSE '\u5176\u4ED6/\u7A81\u53D1\u6536\u5165'
        END;
        UPDATE finance_incomes SET category = category_major || ' / ' || category_minor;
      `);
      database.prepare("INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at").run("finance.quick_buttons", JSON.stringify(DEFAULT_QUICK_BUTTONS), nowIso());
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(5, FINANCE_HEALTH_MIGRATION_NAME, nowIso());
    });
    migrateFinanceHealth();
  }
  const accountEntriesAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(ACCOUNT_ENTRIES_MIGRATION_NAME);
  if (!accountEntriesAlreadyApplied) {
    const migrateAccountEntries = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS finance_account_entries (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL,
          direction TEXT NOT NULL DEFAULT 'deposit',
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          currency TEXT NOT NULL DEFAULT 'CNY',
          event TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          occurred_date TEXT NOT NULL,
          row_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          archive_reason TEXT,
          archived_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_account_entries_occurred_date ON finance_account_entries(occurred_date);
      `);
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(6, ACCOUNT_ENTRIES_MIGRATION_NAME, nowIso());
    });
    migrateAccountEntries();
  }
  const accountFlowAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(ACCOUNT_FLOW_MIGRATION_NAME);
  if (!accountFlowAlreadyApplied) {
    const migrateAccountFlow = database.transaction(() => {
      ensureColumn(database, "finance_account_entries", "direction", "TEXT NOT NULL DEFAULT 'deposit'");
      database.exec("UPDATE finance_account_entries SET direction = 'deposit' WHERE direction IS NULL OR direction NOT IN ('deposit', 'withdrawal')");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(7, ACCOUNT_FLOW_MIGRATION_NAME, nowIso());
    });
    migrateAccountFlow();
  }
  const agentAccessAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(AGENT_ACCESS_MIGRATION_NAME);
  if (!agentAccessAlreadyApplied) {
    const migrateAgentAccess = database.transaction(() => {
      ensureColumn(database, "api_tokens", "expires_at", "TEXT");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(8, AGENT_ACCESS_MIGRATION_NAME, nowIso());
    });
    migrateAgentAccess();
  }
  const butlerToolTraceAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(BUTLER_TOOL_TRACE_MIGRATION_NAME);
  if (!butlerToolTraceAlreadyApplied) {
    const migrateButlerToolTrace = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS conversation_tool_calls (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          message_id TEXT,
          tool_name TEXT NOT NULL,
          arguments_json TEXT NOT NULL DEFAULT '{}',
          result_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL CHECK (status IN ('ok', 'error')),
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conversation_tool_calls ON conversation_tool_calls(conversation_id, created_at);
      `);
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(9, BUTLER_TOOL_TRACE_MIGRATION_NAME, nowIso());
    });
    migrateButlerToolTrace();
  }
  const agentIdempotencyAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(AGENT_IDEMPOTENCY_MIGRATION_NAME);
  if (!agentIdempotencyAlreadyApplied) {
    const migrateAgentIdempotency = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS agent_idempotency (
          idempotency_key TEXT PRIMARY KEY,
          tool_name TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_idempotency_created_at ON agent_idempotency(created_at);
      `);
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(10, AGENT_IDEMPOTENCY_MIGRATION_NAME, nowIso());
    });
    migrateAgentIdempotency();
  }
  const auditAgentTokenAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(AUDIT_AGENT_TOKEN_MIGRATION_NAME);
  if (!auditAgentTokenAlreadyApplied) {
    const migrateAuditAgentToken = database.transaction(() => {
      ensureColumn(database, "audit_logs", "agent_token_id", "TEXT");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(11, AUDIT_AGENT_TOKEN_MIGRATION_NAME, nowIso());
    });
    migrateAuditAgentToken();
  }
  const auditSnapshotsAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(AUDIT_SNAPSHOTS_MIGRATION_NAME);
  if (!auditSnapshotsAlreadyApplied) {
    const migrateAuditSnapshots = database.transaction(() => {
      ensureColumn(database, "audit_logs", "change_id", "TEXT");
      ensureColumn(database, "audit_logs", "before_json", "TEXT");
      ensureColumn(database, "audit_logs", "after_json", "TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_audit_change_id ON audit_logs(change_id)");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(12, AUDIT_SNAPSHOTS_MIGRATION_NAME, nowIso());
    });
    migrateAuditSnapshots();
  }
  const standaloneRecurrenceTemplateAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(STANDALONE_RECURRENCE_TEMPLATE_MIGRATION_NAME);
  if (!standaloneRecurrenceTemplateAlreadyApplied) {
    const migrateStandaloneRecurrenceTemplates = database.transaction(() => {
      const recurrenceColumns = columns(database, "task_recurrences");
      if (recurrenceColumns.has("template_task_id")) {
        database.exec(`
          ALTER TABLE task_recurrences RENAME TO task_recurrences_legacy_004;
          CREATE TABLE task_recurrences (
            id TEXT PRIMARY KEY,
            title_template TEXT NOT NULL DEFAULT '',
            description_template TEXT NOT NULL DEFAULT '',
            content_template TEXT NOT NULL DEFAULT '',
            rule_json TEXT NOT NULL,
            timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
            start_date TEXT NOT NULL,
            end_date TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            paused_from_date TEXT,
            next_occurrence_date TEXT,
            last_checked_at TEXT,
            last_generated_at TEXT,
            status TEXT NOT NULL DEFAULT 'ok',
            last_error TEXT,
            template_version INTEGER NOT NULL DEFAULT 1,
            row_version INTEGER NOT NULL DEFAULT 1,
            legacy_source_task_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          INSERT INTO task_recurrences (
            id, title_template, description_template, content_template, rule_json, timezone,
            start_date, end_date, enabled, paused_from_date, next_occurrence_date, last_checked_at,
            last_generated_at, status, last_error, template_version, row_version,
            legacy_source_task_id, created_at, updated_at
          )
          SELECT id, title_template, description_template, content_template, rule_json, timezone,
            start_date, end_date, enabled, NULL, next_occurrence_date, last_checked_at,
            last_generated_at, status, last_error, 1, row_version,
            template_task_id, created_at, updated_at
          FROM task_recurrences_legacy_004;
          DROP TABLE task_recurrences_legacy_004;
        `);
      } else {
        ensureColumn(database, "task_recurrences", "paused_from_date", "TEXT");
        ensureColumn(database, "task_recurrences", "template_version", "INTEGER NOT NULL DEFAULT 1");
        ensureColumn(database, "task_recurrences", "legacy_source_task_id", "TEXT");
      }
      database.exec(`
        CREATE TABLE IF NOT EXISTS task_recurrence_versions (
          id TEXT PRIMARY KEY,
          recurrence_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          effective_from TEXT NOT NULL,
          effective_to TEXT,
          title_template TEXT NOT NULL DEFAULT '',
          description_template TEXT NOT NULL DEFAULT '',
          content_template TEXT NOT NULL DEFAULT '',
          rule_json TEXT NOT NULL,
          schedule_anchor_date TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (recurrence_id, version)
        );
        CREATE INDEX IF NOT EXISTS idx_recurrence_versions_dates ON task_recurrence_versions(recurrence_id, effective_from, effective_to);
      `);
      ensureColumn(database, "task_recurrence_occurrences", "template_version", "INTEGER NOT NULL DEFAULT 1");
      ensureColumn(database, "task_recurrence_runs", "trigger_source", "TEXT");
      ensureColumn(database, "task_recurrence_runs", "target_recurrence_id", "TEXT");
      ensureColumn(database, "task_recurrence_runs", "lock_result", "TEXT");
      database.exec(`
        CREATE TABLE IF NOT EXISTS task_recurrence_sync_lock (
          lock_name TEXT PRIMARY KEY,
          owner_id TEXT,
          acquired_at TEXT,
          lease_expires_at TEXT,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recurrence_occurrences_task ON task_recurrence_occurrences(task_id);
      `);
      database.prepare("INSERT OR IGNORE INTO task_recurrence_sync_lock (lock_name, updated_at) VALUES ('global', ?)").run(nowIso());
      const templates = database.prepare("SELECT id, title_template, description_template, content_template, rule_json, start_date, template_version, created_at FROM task_recurrences").all();
      const insertVersion = database.prepare("INSERT OR IGNORE INTO task_recurrence_versions (id, recurrence_id, version, effective_from, effective_to, title_template, description_template, content_template, rule_json, schedule_anchor_date, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)");
      for (const template of templates) {
        const version2 = Number(template.template_version || 1);
        insertVersion.run(`${template.id}:v${version2}`, template.id, version2, template.start_date, template.title_template, template.description_template, template.content_template, template.rule_json, template.start_date, template.created_at);
      }
      database.prepare("UPDATE task_recurrence_occurrences SET template_version = 1 WHERE template_version IS NULL OR template_version < 1").run();
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(13, STANDALONE_RECURRENCE_TEMPLATE_MIGRATION_NAME, nowIso());
    });
    migrateStandaloneRecurrenceTemplates();
  }
  const planDocumentAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(PLAN_DOCUMENT_MIGRATION_NAME);
  if (!planDocumentAlreadyApplied) {
    const migratePlanDocuments = database.transaction(() => {
      ensureColumn(database, "daily_plans", "plan_text", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(database, "daily_plans", "archived_at", "TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_daily_plans_archived_date ON daily_plans(archived_at, plan_date)");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(14, PLAN_DOCUMENT_MIGRATION_NAME, nowIso());
    });
    migratePlanDocuments();
  }
  const stagePlanDocumentAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(STAGE_PLAN_DOCUMENT_MIGRATION_NAME);
  if (!stagePlanDocumentAlreadyApplied) {
    const migrateStagePlanDocuments = database.transaction(() => {
      ensureColumn(database, "milestones", "plan_text", "TEXT NOT NULL DEFAULT ''");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(15, STAGE_PLAN_DOCUMENT_MIGRATION_NAME, nowIso());
    });
    migrateStagePlanDocuments();
  }
  const periodPlanDocumentAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(PERIOD_PLAN_DOCUMENT_MIGRATION_NAME);
  if (!periodPlanDocumentAlreadyApplied) {
    const migratePeriodPlanDocuments = database.transaction(() => {
      database.exec("CREATE TABLE IF NOT EXISTS period_plans (id TEXT PRIMARY KEY, period_start TEXT NOT NULL, period_end TEXT NOT NULL, plan_text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT, UNIQUE(period_start, period_end), CHECK(period_start <= period_end)); CREATE INDEX IF NOT EXISTS idx_period_plans_dates ON period_plans(period_start, period_end, archived_at);");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(16, PERIOD_PLAN_DOCUMENT_MIGRATION_NAME, nowIso());
    });
    migratePeriodPlanDocuments();
  }
  const projectSystemAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(PROJECT_SYSTEM_MIGRATION_NAME);
  if (!projectSystemAlreadyApplied) {
    const migrateProjectSystem = database.transaction(() => {
      database.exec(`
        CREATE TABLE IF NOT EXISTS project_task_plans (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          due_date TEXT,
          status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done', 'cancelled')),
          todo_task_id TEXT UNIQUE,
          archive_requested INTEGER NOT NULL DEFAULT 0,
          row_version INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT,
          archived_at TEXT,
          archive_reason TEXT,
          archived_by TEXT
        );
        CREATE TABLE IF NOT EXISTS project_activity_logs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'progress',
          content TEXT NOT NULL,
          important INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          archived_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_project_task_plans_project ON project_task_plans(project_id, archived_at, due_date);
        CREATE INDEX IF NOT EXISTS idx_project_activity_logs_project ON project_activity_logs(project_id, archived_at, created_at);
      `);
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(17, PROJECT_SYSTEM_MIGRATION_NAME, nowIso());
    });
    migrateProjectSystem();
  }
  const projectLifecycleAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(PROJECT_LIFECYCLE_MIGRATION_NAME);
  if (!projectLifecycleAlreadyApplied) {
    const migrateProjectLifecycle = database.transaction(() => {
      ensureColumn(database, "projects", "end_date", "TEXT");
      ensureColumn(database, "projects", "archive_requested", "INTEGER NOT NULL DEFAULT 0");
      database.prepare("UPDATE projects SET end_date = target_date WHERE end_date IS NULL AND target_date IS NOT NULL").run();
      database.prepare("UPDATE projects SET archive_requested = 1 WHERE archived_at IS NOT NULL AND archive_requested = 0").run();
      database.exec("CREATE INDEX IF NOT EXISTS idx_projects_archived_at ON projects(archived_at, end_date)");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(18, PROJECT_LIFECYCLE_MIGRATION_NAME, nowIso());
    });
    migrateProjectLifecycle();
  }
  const projectTaskArchiveAlreadyApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get(PROJECT_TASK_ARCHIVE_MIGRATION_NAME);
  if (!projectTaskArchiveAlreadyApplied) {
    const migrateProjectTaskArchive = database.transaction(() => {
      ensureColumn(database, "project_task_plans", "archive_requested", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(database, "project_task_plans", "archive_reason", "TEXT");
      ensureColumn(database, "project_task_plans", "archived_by", "TEXT");
      database.prepare("UPDATE project_task_plans SET archive_requested = 1 WHERE archived_at IS NOT NULL AND archive_requested = 0").run();
      database.exec("CREATE INDEX IF NOT EXISTS idx_project_task_plans_archived_at ON project_task_plans(archived_at)");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(19, PROJECT_TASK_ARCHIVE_MIGRATION_NAME, nowIso());
    });
    migrateProjectTaskArchive();
  }
  const projectTaskSortOrderApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("020_project_task_sort_order");
  if (!projectTaskSortOrderApplied) {
    const migrateSortOrder = database.transaction(() => {
      ensureColumn(database, "project_task_plans", "sort_order", "INTEGER NOT NULL DEFAULT 0");
      database.exec("CREATE INDEX IF NOT EXISTS idx_project_task_plans_sort ON project_task_plans(project_id, sort_order)");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(20, "020_project_task_sort_order", nowIso());
    });
    migrateSortOrder();
  }
  const checkpointTaskMemoApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("022_project_checkpoint_task_memo");
  if (!checkpointTaskMemoApplied) {
    const migrateCheckpointMemo = database.transaction(() => {
      database.prepare(`
        UPDATE tasks
        SET description = (
          SELECT p.name
          FROM project_task_plans pt
          JOIN projects p ON p.id = pt.project_id
          WHERE pt.todo_task_id = tasks.id
        )
        WHERE id IN (
          SELECT pt.todo_task_id
          FROM project_task_plans pt
          WHERE pt.todo_task_id IS NOT NULL
        ) AND (description IS NULL OR trim(description) = '')
      `).run();
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(22, "022_project_checkpoint_task_memo", nowIso());
    });
    migrateCheckpointMemo();
  }

  const taskSubtasksApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("023_task_subtasks");
  if (!taskSubtasksApplied) {
    const migrateSubtasks = database.transaction(() => {
      ensureColumn(database, "tasks", "parent_id", "TEXT");
      database.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(23, "023_task_subtasks", nowIso());
    });
    migrateSubtasks();
  }
}

var nowIso2 = () => (/* @__PURE__ */ new Date()).toISOString();
var WEEKLY_BACKUP_RETAIN = 3;
var legacyBackupName = /^\d{14}\.db$/;
var weeklyBackupName = /^weekly-(\d{4}-\d{2}-\d{2})\.db$/;
var safetyBackupName = /^(?:pre-restore|restore-failed|corrupt)-\d+\.db$/;
var DIRECT_MCP_MARKER = "paios-mcp.active";
function openDatabase(dataDir, options = {}): any {
  mkdirSync(dataDir, { recursive: true });
  if (options.applyPendingRestore !== false)
    applyPendingRestore(dataDir);
  const databasePath = join(dataDir, "paios.db");
  const hadDatabase = existsSync(databasePath);
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    database.close();
    throw new Error(`DATABASE_INTEGRITY_FAILED: ${integrity}`);
  }
  database.exec(INITIAL_SCHEMA_SQL);
  const hasStandaloneRecurrenceMigration = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()) && Boolean(database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("013_standalone_recurrence_templates"));
  if (hadDatabase && !hasStandaloneRecurrenceMigration)
    createBackup(database, dataDir, WEEKLY_BACKUP_RETAIN);
  applyMigrations(database);
  seedDatabase(database, dataDir);
  return database;
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error2) {
    return error2.code === "EPERM";
  }
}
function assertNoActiveDirectMcp(dataDir) {
  const markerPath = join(dataDir, DIRECT_MCP_MARKER);
  if (!existsSync(markerPath))
    return;
  let pid = 0;
  try {
    pid = Number(readFileSync(markerPath, "utf8").trim());
  } catch {
  }
  if (Number.isInteger(pid) && pid > 0 && isProcessAlive(pid)) {
    throw new Error("MCP_ACTIVE_REQUIRES_EXIT: \u8BF7\u5148\u5173\u95ED\u76F4\u8FDE MCP \u540E\u518D\u6062\u590D\u672C\u5730\u6570\u636E");
  }
  try {
    unlinkSync(markerPath);
  } catch {
    throw new Error("MCP_ACTIVE_REQUIRES_EXIT: \u65E0\u6CD5\u786E\u8BA4\u76F4\u8FDE MCP \u5DF2\u5173\u95ED\uFF0C\u8BF7\u5148\u5173\u95ED MCP \u540E\u91CD\u8BD5");
  }
}
function acquireDirectMcpMarker(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  assertNoActiveDirectMcp(dataDir);
  const markerPath = join(dataDir, DIRECT_MCP_MARKER);
  try {
    writeFileSync(markerPath, `${process.pid}
`, { encoding: "utf8", flag: "wx" });
  } catch (error2) {
    if (error2.code === "EEXIST") {
      throw new Error("MCP_ACTIVE_REQUIRES_EXIT: \u76F4\u8FDE MCP \u5DF2\u5728\u4F7F\u7528\u672C\u5730\u6570\u636E\uFF0C\u8BF7\u5148\u5173\u95ED\u5B83");
    }
    throw error2;
  }
  let released = false;
  return () => {
    if (released)
      return;
    released = true;
    try {
      if (existsSync(markerPath) && readFileSync(markerPath, "utf8").trim() === String(process.pid))
        unlinkSync(markerPath);
    } catch {
    }
  };
}
function preserveCurrentDatabase(databasePath, backupDir) {
  if (!existsSync(databasePath))
    return null;
  const preRestorePath = join(backupDir, `pre-restore-${Date.now()}.db`);
  let currentDatabase;
  try {
    currentDatabase = new Database(databasePath);
    currentDatabase.pragma("busy_timeout = 5000");
    currentDatabase.pragma("wal_checkpoint(FULL)");
    currentDatabase.close();
    currentDatabase = void 0;
    removeBackupSidecarsStrict(databasePath);
    renameSync(databasePath, preRestorePath);
    if (isBackupValid(preRestorePath))
      return preRestorePath;
    const corruptPath = join(backupDir, `corrupt-${Date.now()}.db`);
    renameSync(preRestorePath, corruptPath);
    return corruptPath;
  } catch (error2) {
    currentDatabase?.close();
    try {
      removeBackupSidecarsStrict(databasePath);
      if (existsSync(databasePath)) {
        const corruptPath = join(backupDir, `corrupt-${Date.now()}.db`);
        renameSync(databasePath, corruptPath);
        return corruptPath;
      }
    } catch {
    }
    throw error2;
  }
}
function applyPendingRestore(dataDir) {
  const pendingPath = join(dataDir, "restore.pending.db");
  if (!existsSync(pendingPath))
    return;
  assertNoActiveDirectMcp(dataDir);
  const databasePath = join(dataDir, "paios.db");
  const backupDir = join(dataDir, "backups");
  mkdirSync(backupDir, { recursive: true });
  let candidate;
  try {
    candidate = new Database(pendingPath, { readonly: true });
    const integrity = candidate.pragma("integrity_check", { simple: true });
    if (integrity !== "ok")
      throw new Error(`DATABASE_INTEGRITY_FAILED: ${integrity}`);
  } catch {
    candidate?.close();
    removeBackupSidecars(pendingPath);
    renameSync(pendingPath, join(backupDir, `restore-failed-${Date.now()}.db`));
    pruneSafetyBackups(backupDir, WEEKLY_BACKUP_RETAIN);
    return;
  }
  candidate?.close();
  removeBackupSidecarsStrict(pendingPath);
  const temporary = join(dataDir, `.paios-restore-${randomUUID()}.tmp`);
  let preservedPath = null;
  try {
    copyFileSync(pendingPath, temporary);
    if (!isBackupValid(temporary))
      throw new Error("DATABASE_INTEGRITY_FAILED: \u5F85\u6062\u590D\u526F\u672C\u6821\u9A8C\u5931\u8D25");
    preservedPath = preserveCurrentDatabase(databasePath, backupDir);
    removeBackupSidecarsStrict(databasePath);
    renameSync(temporary, databasePath);
    unlinkSync(pendingPath);
    pruneSafetyBackups(backupDir, WEEKLY_BACKUP_RETAIN);
  } catch (error2) {
    try {
      if (existsSync(temporary))
        unlinkSync(temporary);
    } catch {
    }
    if (preservedPath && !existsSync(databasePath) && existsSync(preservedPath)) {
      try {
        renameSync(preservedPath, databasePath);
      } catch {
      }
    }
    throw error2;
  }
}
function seedDatabase(database, dataDir) {
  const createdAt = nowIso2();
  database.prepare("INSERT OR IGNORE INTO users (id, display_name, timezone, created_at) VALUES (?, ?, ?, ?)").run("local", "\u672C\u5730\u7528\u6237", Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", createdAt);
  const settings = {
    theme: "light",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    currency: "CNY",
    week_starts_on: 1,
    "finance.expense_writes_tx": true,
    "finance.income_writes_tx": true,
    "finance.default_account_id": "love",
    bind: "127.0.0.1",
    port: 4738,
    "backup.retain": WEEKLY_BACKUP_RETAIN,
    "archive.purge_after_days": 180,
    "archive.cleanup_interval_days": 7,
    "archive.last_cleanup_at": null,
    "archive.scan_weekday": 0
  };
  const settingStatement = database.prepare("INSERT OR IGNORE INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)");
  for (const [key, value] of Object.entries(settings)) {
    settingStatement.run(key, JSON.stringify(value), createdAt);
  }
  // The previous default was 90 days. Migrate that legacy default to the new
  // 180-day retention policy.
  if (getSetting(database, "archive.purge_after_days", 180) === 90) {
    database.prepare("UPDATE app_settings SET value_json = ?, updated_at = ? WHERE key = 'archive.purge_after_days'").run(JSON.stringify(180), createdAt);
  }
  const storedBackupRetain = getSetting(database, "backup.retain", WEEKLY_BACKUP_RETAIN);
  const safeBackupRetain = normalizeBackupRetention(storedBackupRetain, WEEKLY_BACKUP_RETAIN);
  if (storedBackupRetain !== safeBackupRetain) {
    database.prepare("UPDATE app_settings SET value_json = ?, updated_at = ? WHERE key = 'backup.retain'").run(JSON.stringify(safeBackupRetain), createdAt);
  }
  const accounts = [
    ["love", "\u604B\u7231\u8D44\u91D1"],
    ["emergency", "\u7D27\u6025\u8D44\u91D1"],
    ["daily", "\u6295\u8D44\u8D44\u91D1"]
  ];
  const accountStatement = database.prepare("INSERT OR IGNORE INTO finance_accounts (id, name, account_type, currency, created_at, updated_at) VALUES (?, ?, 'cash', 'CNY', ?, ?)");
  for (const [id, name] of accounts)
    accountStatement.run(id, name, createdAt, createdAt);
  database.prepare("UPDATE finance_accounts SET name = ? WHERE id = ?").run("\u604B\u7231\u8D44\u91D1", "love");
  database.prepare("UPDATE finance_accounts SET name = ? WHERE id = ?").run("\u7D27\u6025\u8D44\u91D1", "emergency");
  database.prepare("UPDATE finance_accounts SET name = ? WHERE id = ?").run("\u6295\u8D44\u8D44\u91D1", "daily");
  const specs = {
    questioning: { questions: ["\u4ECA\u5929\u6700\u6709\u8FDB\u5C55\u7684\u4E00\u4EF6\u4E8B\u662F\u4EC0\u4E48\uFF1F", "\u672A\u5B8C\u6210\u7684\u4EFB\u52A1\u4E3B\u8981\u5361\u5728\u54EA\u91CC\uFF1F", "\u7761\u7720\u548C\u4F53\u91CD\u6709\u6CA1\u6709\u9700\u8981\u6CE8\u610F\u7684\uFF1F", "\u660E\u5929\u53EA\u5141\u8BB8\u4E09\u4EF6\u4F18\u5148\uFF0C\u4F1A\u9009\u54EA\u4E09\u4EF6\uFF1F"] },
    review_flow: { prefer_data_draft_first: true, ask_sleep: true, ask_incomplete_reasons: true, auto_finalize: false },
    schedule_pref: { workday_start: "09:00", workday_end: "18:00", max_items: 8, max_deep_work_blocks: 2, prefer_energy_match: true, include_overdue_first: true, include_blocked: false, respect_project_wip_limit: 3 },
    reminder: { plan_morning: true, review_evening: true, nag_minutes: 0 },
    output_format: { plan_style: "bullet", review_style: "markdown_sections", language: "zh-CN" },
    user_pref: { tone: "direct", honorific: false, call_user: "\u4F60" },
    workflow: { morning_order: ["today", "plan_generate", "health_get"], evening_order: ["reviews_aggregate", "reviews_generate_daily"] },
    task_breakdown: { max_subtasks: 5, default_estimate_minutes: 30, never_auto_create: true }
  };
  const workflowStatement = database.prepare("INSERT OR IGNORE INTO workflow_versions (id, scope, version, status, spec_json, reason, user_feedback, created_by, created_at) VALUES (?, ?, 1, 'active', ?, 'P0 seed', '', 'system', ?)");
  for (const [scope, spec] of Object.entries(specs)) {
    workflowStatement.run(randomUUID(), scope, JSON.stringify(spec), createdAt);
  }
  const tokenPath = join(dataDir, "mcp-token.txt");
  if (!existsSync(tokenPath)) {
    const token = `paios_${randomBytes(24).toString("hex")}`;
    writeFileSync(tokenPath, `${token}
`, { encoding: "utf8", flag: "wx" });
    database.prepare("INSERT OR IGNORE INTO api_tokens (id, name, token_hash, scopes_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), "development", createHash("sha256").update(token).digest("hex"), JSON.stringify(["read", "write"]), createdAt);
  } else if (database.prepare("SELECT 1 FROM api_tokens LIMIT 1").get() === void 0) {
    const token = readFileSync(tokenPath, "utf8").trim();
    if (token) {
      database.prepare("INSERT INTO api_tokens (id, name, token_hash, scopes_json, created_at) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), "development", createHash("sha256").update(token).digest("hex"), JSON.stringify(["read", "write"]), createdAt);
    }
  }
}
function getSetting(database, key, fallback) {
  const row = database.prepare("SELECT value_json FROM app_settings WHERE key = ?").get(key);
  if (!row?.value_json)
    return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}
function weeklyBackupAnchorDate(date3) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date3))
    throw new Error("INVALID_LOCAL_DATE");
  const value = /* @__PURE__ */ new Date(`${date3}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime()))
    throw new Error("INVALID_LOCAL_DATE");
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}
function isBackupValid(path) {
  let candidate;
  try {
    candidate = new Database(path, { readonly: true, fileMustExist: true });
    return candidate.pragma("integrity_check", { simple: true }) === "ok";
  } catch {
    return false;
  } finally {
    candidate?.close();
    removeBackupSidecars(path);
  }
}
function removeBackupSidecarsStrict(path) {
  const sidecars = [`${path}-wal`, `${path}-shm`];
  for (const sidecar of sidecars) {
    if (!existsSync(sidecar))
      continue;
    try {
      unlinkSync(sidecar);
    } catch (error2) {
      throw new Error(`\u65E0\u6CD5\u5220\u9664\u6570\u636E\u5E93\u65C1\u8DEF\u6587\u4EF6 ${sidecar}: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
    if (existsSync(sidecar))
      throw new Error(`\u6570\u636E\u5E93\u65C1\u8DEF\u6587\u4EF6\u4ECD\u7136\u5B58\u5728: ${sidecar}`);
  }
}
function removeBackupSidecars(path) {
  for (const sidecar of [`${path}-wal`, `${path}-shm`]) {
    try {
      if (existsSync(sidecar))
        unlinkSync(sidecar);
    } catch {
    }
  }
}
function normalizeBackupRetention(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1)
    return Math.min(value, WEEKLY_BACKUP_RETAIN);
  return Math.min(Math.max(1, Math.trunc(fallback) || WEEKLY_BACKUP_RETAIN), WEEKLY_BACKUP_RETAIN);
}
function pruneSafetyBackups(backupDir, retain) {
  const keep = normalizeBackupRetention(retain, WEEKLY_BACKUP_RETAIN);
  const backups = readdirSync(backupDir).filter((file) => safetyBackupName.test(file)).flatMap((file) => {
    try {
      return [{ file, mtime: statSync(join(backupDir, file)).mtimeMs }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.mtime - a.mtime);
  for (const old of backups.slice(keep)) {
    try {
      removeBackupSidecars(join(backupDir, old.file));
      unlinkSync(join(backupDir, old.file));
    } catch {
    }
  }
}
function pruneWeeklyBackups(backupDir, retain) {
  const keep = normalizeBackupRetention(retain, WEEKLY_BACKUP_RETAIN);
  const backups = readdirSync(backupDir).flatMap((file) => {
    const match2 = weeklyBackupName.exec(file);
    if (!match2)
      return [];
    const path = join(backupDir, file);
    return [{ file, date: match2[1] ?? "", valid: isBackupValid(path) }];
  }).sort((a, b) => b.date.localeCompare(a.date));
  const validBackups = backups.filter((backup) => backup.valid);
  for (const old of backups.filter((backup) => !backup.valid)) {
    try {
      removeBackupSidecars(join(backupDir, old.file));
      unlinkSync(join(backupDir, old.file));
    } catch {
    }
  }
  for (const old of validBackups.slice(keep)) {
    try {
      removeBackupSidecars(join(backupDir, old.file));
      unlinkSync(join(backupDir, old.file));
    } catch {
    }
  }
}
async function ensureWeeklyBackup(database, dataDir, timezone, retain = WEEKLY_BACKUP_RETAIN, today = localDateInTimezone(timezone), force = false): Promise<WeeklyBackupResult> {
  const anchorDate = weeklyBackupAnchorDate(today);
  const backupDir = join(dataDir, "backups");
  const target = join(backupDir, `weekly-${anchorDate}.db`);
  mkdirSync(backupDir, { recursive: true });
  if (!force && existsSync(target) && isBackupValid(target)) {
    pruneWeeklyBackups(backupDir, retain);
    return { status: "skipped", anchorDate, path: target };
  }
  const temporary = join(backupDir, `.weekly-${anchorDate}-${randomUUID()}.tmp`);
  try {
    await database.backup(temporary);
    if (!isBackupValid(temporary))
      throw new Error("WEEKLY_BACKUP_INTEGRITY_FAILED");
    if (existsSync(target))
      unlinkSync(target);
    renameSync(temporary, target);
    pruneWeeklyBackups(backupDir, retain);
    return { status: "created", anchorDate, path: target };
  } catch (error2) {
    try {
      if (existsSync(temporary))
        unlinkSync(temporary);
    } catch {
    }
    return {
      status: "failed",
      anchorDate,
      error: error2 instanceof Error ? error2.message : String(error2)
    };
  }
}
function createBackup(database, dataDir, retain = WEEKLY_BACKUP_RETAIN) {
  const keep = normalizeBackupRetention(retain, WEEKLY_BACKUP_RETAIN);
  database.pragma("wal_checkpoint(FULL)");
  const backupDir = join(dataDir, "backups");
  mkdirSync(backupDir, { recursive: true });
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const target = join(backupDir, `${stamp}.db`);
  const temporary = join(backupDir, `.${stamp}-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, database.serialize());
    if (!isBackupValid(temporary))
      throw new Error("BACKUP_INTEGRITY_FAILED");
    if (existsSync(target))
      unlinkSync(target);
    renameSync(temporary, target);
  } catch (error2) {
    try {
      if (existsSync(temporary))
        unlinkSync(temporary);
    } catch {
    }
    throw error2;
  }
  const backups = readdirSync(backupDir).filter((file) => legacyBackupName.test(file)).flatMap((file) => {
    const path = join(backupDir, file);
    try {
      return [{ file, mtime: statSync(path).mtimeMs, valid: isBackupValid(path) }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.mtime - a.mtime);
  const validBackups = backups.filter((backup) => backup.valid);
  for (const old of backups.filter((backup) => !backup.valid)) {
    const oldPath = join(backupDir, old.file);
    try {
      removeBackupSidecars(oldPath);
      unlinkSync(oldPath);
    } catch {
    }
  }
  for (const old of validBackups.slice(keep)) {
    const oldPath = join(backupDir, old.file);
    try {
      removeBackupSidecars(oldPath);
      unlinkSync(oldPath);
    } catch {
    }
  }
  return target;
}
function recoverFromLatestBackup(dataDir, retain = WEEKLY_BACKUP_RETAIN) {
  assertNoActiveDirectMcp(dataDir);
  const backupDir = join(dataDir, "backups");
  const databasePath = join(dataDir, "paios.db");
  if (!existsSync(backupDir))
    throw new Error("NO_VALID_BACKUP: \u672C\u5730\u6CA1\u6709\u53EF\u7528\u5907\u4EFD");
  const candidates = readdirSync(backupDir).filter((file) => file.endsWith(".db") && !file.startsWith(".") && !/^(?:restore-failed|corrupt)-/.test(file)).flatMap((file) => {
    try {
      return [{ file, mtime: statSync(join(backupDir, file)).mtimeMs }];
    } catch {
      return [];
    }
  }).sort((a, b) => b.mtime - a.mtime);
  const sourceFile = candidates.find((candidate) => isBackupValid(join(backupDir, candidate.file)))?.file;
  if (!sourceFile)
    throw new Error("NO_VALID_BACKUP: \u672C\u5730\u6CA1\u6709\u901A\u8FC7\u5B8C\u6574\u6027\u6821\u9A8C\u7684\u5907\u4EFD");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  const temporary = join(dataDir, `.paios-recovery-${randomUUID()}.tmp`);
  const replacedPath = join(backupDir, `corrupt-${Date.now()}.db`);
  let currentMoved = false;
  try {
    copyFileSync(join(backupDir, sourceFile), temporary);
    if (!isBackupValid(temporary))
      throw new Error("RECOVERY_BACKUP_INTEGRITY_FAILED: \u6062\u590D\u526F\u672C\u6821\u9A8C\u5931\u8D25");
    removeBackupSidecarsStrict(databasePath);
    if (existsSync(databasePath)) {
      renameSync(databasePath, replacedPath);
      currentMoved = true;
    }
    renameSync(temporary, databasePath);
    pruneSafetyBackups(backupDir, retain);
    return { sourcePath: join(backupDir, sourceFile), replacedPath: currentMoved ? replacedPath : "" };
  } catch (error2) {
    try {
      if (existsSync(temporary))
        unlinkSync(temporary);
    } catch {
    }
    if (currentMoved && !existsSync(databasePath) && existsSync(replacedPath)) {
      try {
        renameSync(replacedPath, databasePath);
      } catch {
      }
    }
    throw error2;
  }
}

type PaiosStatement = { get: (...args: any[]) => any; all: (...args: any[]) => Array<Record<string, any>>; run: (...args: any[]) => any };
export type PaiosDatabase = {
  name: string;
  open: boolean;
  prepare: (...args: any[]) => PaiosStatement;
  transaction: <T>(fn: () => T) => () => T;
  pragma: (...args: any[]) => any;
  exec: (...args: any[]) => any;
  backup: (destination: string) => Promise<void>;
  serialize: () => Buffer;
  close: () => void;
};
export type WeeklyBackupResult = { status: "created" | "skipped" | "failed"; anchorDate: string; path?: string; error?: string };
export { WEEKLY_BACKUP_RETAIN, acquireDirectMcpMarker, createBackup, ensureWeeklyBackup, getSetting, isBackupValid, openDatabase, recoverFromLatestBackup };

