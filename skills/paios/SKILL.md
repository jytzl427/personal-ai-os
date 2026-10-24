---
name: paios
description: Operate the local Personal AI OS through its MCP tools. Use for tasks, projects, plans, finance, health, reviews and ideas.
---

# Personal AI OS

Personal AI OS is the user's local source of truth. The Web UI is the human control surface; MCP is the Agent interface. Do not access `.data/paios.db` directly and do not invent a second data model.

At the start of a connection, call `system_status`. Continue only when `database` is `ok` and `dataDir` is the user's personal `.paios` directory. If `dataDir` points to the repository `.data` directory, stop and report that the development database is connected. Never start `node apps/server/dist/main.js serve` or another development server on the user's behalf; ask the user to open the Personal AI OS EXE instead.

## Operating rules

1. Read `today_get` or the `paios://today` resource before making a plan or writing a daily record. `due_date` is the execution date.
2. Use `attention_get` for proactive checks. Use `planning_context_get` before drafting a daily or stage plan. Use `tasks_list` without a date only when the user asks for all active tasks. For today, call `today_get`; for a specific execution date, pass that local date to `tasks_list`.
3. Use structured tools for writes. For money, always use integer cents; use `finance_quick_preview` before turning natural language into a ledger entry.
4. Treat dates as the user's local calendar dates, not UTC dates. Sleep onset belongs to the health log for the weigh-in date.
5. `ideas_promote_to_task` and archive/purge operations return confirmation tickets. Tell the user what is waiting and stop; never try to approve a ticket through MCP.
6. A plan is a draft until the user confirms it in the Web UI. Do not overwrite a confirmed plan.
7. Do not claim that a review is final until `reviews/:id/finalize` has succeeded in the Web UI/API.
8. Prefer small, explicit writes. Use `batch_run` for a bounded group of related calls (at most 20), never for confirmation approval.
9. For ordinary writes, send an `idempotency_key` when the transport may retry. Reuse the same key after an uncertain response; use a new key only for a new intentional change.

## Common flows

- Morning: `attention_get` → `planning_context_get` → `plans_update` or `plans_generate` → user confirms in the UI.
- Stage plan: `planning_context_get` mode=stage → `period_plans_upsert` draft → user edits/confirms in the UI. The server rejects project advancement (project update, workspace update, project-linked tasks) until a confirmed stage plan covers today. After confirmation, ordinary project-scoped writes are allowed; do not pause, abandon, delete or archive.
- Expense: `finance_quick_preview` → confirm date, major/minor category and integer cents → `finance_expense_create`. Do not ask which account paid; ordinary expenses never touch account balances.
- Health: `health_get` → collect weight/sleep → write the date-specific health record through the API/UI.
- Evening: `today_get` → `reviews_daily_generate` → draft answers; leave finalization to the user.
- Idea: read the idea → `ideas_promote_to_task` → report the confirmation ticket; no task exists until the user approves it.

Detailed rules are split into [`references/tasks-and-recurrence.md`](references/tasks-and-recurrence.md), [`references/finance.md`](references/finance.md), [`references/health-and-reviews.md`](references/health-and-reviews.md), [`references/projects.md`](references/projects.md), [`references/stage-planning.md`](references/stage-planning.md), and [`references/daily-plan-template.md`](references/daily-plan-template.md). Read the relevant reference before a domain write or review.

## Safety boundary

MCP can read data and perform ordinary structured writes. It cannot approve confirmation tickets, purge history, alter schema, physically delete business rows, or silently rewrite finalized reviews.

## First UI restructure fields

The Web UI uses a Notion-like task table with `archive_requested`, `title`, `due_date`, `status` (`todo`, `done`, `cancelled`) and `description`. A task is archived only when the user requested archive and the status is done or cancelled.

Ideas use `archive_requested`, `title`, `category` (`project`, `long_term`, `short_term`), `body`, `urgency` (1–4, default 4) and `processed`. An idea is archived only when the user requested archive and it is processed.

Projects are shown as gallery cards. Their important attributes are name, category, started date, status, target date, target result, benefit amount and benefit kind. Use `projects_list` and `projects_get` before proposing a project plan.

Finance writes must preserve integer cents and use major/minor taxonomy values. Health writes use the local calendar date; sleep onset belongs to the weigh-in date. Financial, health and review records are long-term records and are not archived.

The in-app Butler uses the same local database facts and registered tool names as MCP; it must not invent a private data snapshot. External agents use a scoped token and the ordinary read/write tools listed by the server. Confirmation approval, restore, purge, physical deletion, settings mutation and schema changes remain unavailable to Agents.

Health exercise data uses `exercise_note` and `exercise_minutes`; do not use the obsolete `cloud_content` field. When a tool returns `CONFIRM_REQUIRED`, report the pending human action and stop.
