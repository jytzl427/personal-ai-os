# MVP verification

> 现行验收以源码测试和 [`交付手册.md`](./交付手册.md) 第 11 节为准。下文 P6/P7/P8 是历史里程碑描述，不是当前待办。普通支出/收入不联动账户余额。服务端测试先 `pnpm --filter @paios/server build` 再 `test`，当前为 39 项（读取 `dist/*.test.js`）。

Run from the repository root:

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

The automated tests cover timezone date calculation, project progress, dependency-cycle rejection, finance quick parsing, daily-plan ordering, SQLite seed/integrity, atomic weekly backup creation and retention without WAL sidecars, invalid backup-retention fallback, restore sidecar cleanup, direct-MCP restore ownership protection, backup failure retry behavior, the single-writer lock, recurrence cadence preservation after template edits, stale concurrent template rollback, template deletion against stale writes, and direct MCP blocking during pending restore.

The HTTP smoke flow covers `/today`, task/project/phase CRUD, dependency rejection, standalone finance expenses/incomes plus independent account entries, health date ownership, plan confirmation, review snapshots counted by `due_date`, idea confirmation, archive restore, purge tickets, workflow approval, settings safety and audit rows.

The MCP smoke flow initializes over stdio, lists tools, reads `paios://today`, `paios://schema/overview`, and `paios://projects/{id}`, calls `finance_quick_preview`, exercises named `batch_run` validation, and verifies that no confirmation-approval tool is exposed.

P6 adds an automated mock OpenAI-compatible server test: the workbench returns assistant text, sends the key only as Bearer authorization, and does not persist it. P7's repository build validates the Tauri scaffold; native `tauri:build` additionally requires Rust/Cargo and Windows bundling prerequisites.

P8-A's Core tests cover CSV quoting and ICS event parsing; the HTTP smoke flow covers preview, fingerprint idempotency, explicit commit, and repeated commit without duplicate writes.

P8-B's HTTP smoke flow covers UI confirmation before export and verifies the generated JSON contains business data but no API tokens, token hashes or LLM keys.
