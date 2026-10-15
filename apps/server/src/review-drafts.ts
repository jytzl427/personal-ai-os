import { getSetting, type PaiosDatabase } from "@paios/db";
import { randomUUID } from "node:crypto";
import { buildReviewFacts, emptyReviewAnalysis, renderReviewText } from "./planning.js";

function parseJson(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function generateDailyReviewDraft(database: PaiosDatabase, date: string): Record<string, unknown> | undefined {
  const existing = database.prepare("SELECT * FROM reviews WHERE review_type = 'daily' AND period_start = ? AND period_end = ? ORDER BY created_at DESC LIMIT 1").get(date, date) as Record<string, unknown> | undefined;
  if (existing?.status === "finalized") return existing;
  const questionsSetting = getSetting(database, "questioning", { questions: [] }) as { questions?: string[] };
  const facts = buildReviewFacts(database, date, date, date);
  const current = parseJson(existing?.content_json);
  const content = {
    questions: questionsSetting.questions ?? [],
    answers: current.answers && typeof current.answers === "object" ? current.answers : {},
    facts,
    data: {
      tasks: { total: facts.tasks.total, completed: facts.tasks.completed, incomplete: facts.tasks.open },
      finance: { expensesCents: facts.finance.expensesCents, incomesCents: facts.finance.incomesCents },
      health: facts.health.records[0] ?? null
    },
    analysis: current.analysis ?? emptyReviewAnalysis(),
    suggestions: current.suggestions ?? { next_day: "", next_period: "", task_split: "", project: "", recurrence: "" },
    checkpoints: Array.isArray(current.checkpoints) ? current.checkpoints : [],
    adjustments: Array.isArray(current.adjustments) ? current.adjustments : [],
    text: typeof current.text === "string" && current.text.trim() ? current.text : renderReviewText(facts, "daily")
  };
  const id = existing?.id as string | undefined ?? randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO reviews (id, review_type, period_start, period_end, mode, status, content_json, created_at, updated_at)
     VALUES (?, 'daily', ?, ?, 'data_first', 'draft', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, mode = excluded.mode, updated_at = excluded.updated_at`
  ).run(id, date, date, JSON.stringify(content), timestamp, timestamp);
  return database.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as Record<string, unknown> | undefined;
}

