# Health and reviews

- Health is a local long-term record. Use `health_get` or `health_range` before summarizing it.
- Health writes use exercise fields (`exercise_note`, `exercise_minutes`). Sleep duration is calculated from bedtime and wake time; do not invent a missing value.
- Daily and period reviews are drafts until the user finalizes them in the Web UI. A missing health, finance or task record must be reported as missing.
- Use `reviews_daily_generate` or `reviews_period_generate` to prepare a data-first draft with objective facts, then `reviews_get` and `reviews_update` for analysis and suggestions. Time-of-day checks must be written into the daily review draft. Distinguish facts from speculation; never treat a possible correlation as causation. Never claim a review is final from an agent response alone.
