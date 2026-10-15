# Post-P7 roadmap

P8 follows the plan's rule of one small extension at a time. The MVP and P6 workbench do not depend on any of these items.

## P8-A — Read-only imports (implemented)

Goal: import ICS calendar events and finance CSV as a reviewable preview, never silently write.

Constraints:

- Preview and field mapping first; only an explicit UI action writes.
- No bank credentials, network sync or automatic categorization.
- Reuse existing tasks/expenses/incomes; do not create a second finance domain.
- Add an import batch/audit record before any row is committed.

Acceptance: a sample ICS and CSV can be previewed, corrected, committed once, and safely re-run without duplicate IDs.

Implementation: `POST /api/v1/imports/preview` creates a fingerprinted preview batch; `POST /api/v1/imports/commit` explicitly commits it. The Web UI includes a paste-based preview/commit panel. Repeating the same content or committing the same batch is idempotent.

## P8-B — Sanitized JSON export (implemented)

`POST /api/v1/system/export` creates a parked UI confirmation ticket. Approval writes a versioned JSON export under `.data/exports/`. The export includes business data and excludes `api_tokens`, token hashes, LLM settings and API keys. `GET /api/v1/system/exports` lists generated files.

## Later, separately planned

- P8-B encrypted export / SQLCipher evaluation
- P8-C investment bounded context (`fin_holdings`, snapshots, performance reviews)
- P8-D habits, meals, mood and additional health metrics
- P8-E PWA/offline packaging and stronger remote-access token policy

Each item needs its own data-model, security and migration review before implementation. Do not create placeholder tables now.
