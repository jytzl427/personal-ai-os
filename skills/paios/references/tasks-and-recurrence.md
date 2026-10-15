# Tasks and recurrence

- Read `today_get` or `tasks_list` before making a schedule. The task date (`due_date`) is the execution date; do not treat `scheduled_date` as the execution date. Undated tasks have a null `due_date` and must be asked about before scheduling.
- Task正文 is `content`; the short memo is `description`. Never copy one into the other without the user's request.
- When changing an existing task, call `tasks_get` first and pass `row_version` when it is available. If the version is stale, reread and explain the conflict.
- Recurring tasks are checked at local service startup. Use `task_recurrences_list` to inspect missing occurrences, status and last error; use `task_recurrence_create` or `task_recurrence_update` only after the user explicitly asks to create or change a recurring rule; use `task_recurrence_check` with `repair: true` only for an ordinary repair request.
- Do not delete or restore tasks through MCP. Archive and restore remain human-controlled operations.
