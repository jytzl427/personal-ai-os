---
name: paios
description: Query, create, and add notes to Personal AI OS tasks through its account-scoped local MCP connection.
---

# Personal AI OS

Use the tools listed by the current account's MCP connection. Treat an invalid or revoked grant as a signal that the user needs to grant access through their own settings. On a missing scope, tell the user which permission the requested action needs.

- Read today's local date and tasks with `today_get` or the `paios://today` resource.
- Search with `tasks_list`, using its local calendar date or query. Use `tasks_get` for a single task.
- Create a new ordinary task with `tasks_create` after the user specifies it. The default priority is P2. `due_date` is the local execution date.
- Use `tasks_append_note` when the user asks to append a note to an existing open task. Apply it to the selected task ID.
- When retrying a write, reuse the original arguments and `idempotency_key`. A separate intended write gets a separate operation key.

The web application handles project management, finance, health, reviews, task lifecycle, exports, settings, account management and human approvals.
