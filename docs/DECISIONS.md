# Architecture decisions

D1–D12 record the v2 architecture decisions. See the [handoff guide](./交付手册.md) for the current implementation.

| ID | Decision | Locked value |
|---|---|---|
| D1 | Phase-1 product form | Local web app |
| D2 | Language stack | TypeScript monorepo |
| D3 | Finance bounded contexts | One SQLite file; expenses, incomes and account entries are separate databases with no automatic cross-domain linkage |
| D4 | Expense vs account entries | Completely separate; daily expense/income records do not create account entries or change account balances |
| D5 | In-page AI workbench | Phase P6, not MVP |
| D6 | Plan/review generation | Rule templates in Core; LLM via external Agent |
| D7 | Money | Integer cents in DB and API |
| D8 | Startup password | Optional, off by default |
| D9 | Project benefit fields | `benefit_enabled` default 0 |
| D10 | High-risk confirmation | UI only; MCP approve is FORBIDDEN; parked tickets 7 days |
| D11 | Data directory | Personal runs and manual `serve` default to `~/.paios/`; isolated development uses explicit `PAIOS_DATA_DIR=.data/` |
| D12 | Investment tables | Do not create yet |

Also locked: port `4738`; single SQLite writer; transfer = two legs; sleep onset belongs to wake/weigh-in date; static board + click calendar in MVP; never physically delete business rows; `executeTicket` runs payload exactly once.
