import { z } from "zod";

const dateSchema = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const errorCodeSchema = z.enum(["BAD_REQUEST", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT", "STALE_VERSION", "CONFIRM_REQUIRED", "FORBIDDEN", "INTERNAL_ERROR"]);
export const apiErrorSchema = z.object({ ok: z.literal(false), error: z.object({ code: errorCodeSchema, message: z.string() }) });
export const todayResponseSchema = z.object({
  ok: z.literal(true), date: dateSchema(), timezone: z.string(),
  tasks: z.object({ due: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), overdue: z.number().int().nonnegative() }),
  finance: z.object({ monthExpenseCents: z.number().int(), monthIncomeCents: z.number().int() }),
  health: z.object({ recorded: z.boolean() }), confirmations: z.number().int().nonnegative(),
  plan: z.object({ confirmed: z.boolean(), itemCount: z.number().int().nonnegative() })
});
export const systemStatusSchema = z.object({ ok: z.literal(true), version: z.string(), dataDir: z.string(), database: z.literal("ok"), lock: z.literal("held"), bind: z.string(), port: z.number().int().positive() });
export const taskStatusSchema = z.enum(["todo", "done", "cancelled"]);
export const taskWriteStatusSchema = z.union([taskStatusSchema, z.enum(["doing", "blocked"])]);
export const prioritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const ideaCategorySchema = z.enum(["project", "short_term", "long_term", "life", "learning", "observe", "defer"]);
export const archiveRequestedSchema = z.union([z.boolean(), z.number().int().min(0).max(1)]);
export const processedSchema = z.union([z.boolean(), z.number().int().min(0).max(1)]);
export const createTaskSchema = z.object({
  title: z.string().trim().min(0).max(200), description: z.string().max(10000).optional(), content: z.string().max(10000).optional(),
  status: taskWriteStatusSchema.optional(), priority: prioritySchema.optional(), due_date: dateSchema().nullable().optional(), scheduled_date: dateSchema().nullable().optional(),
  estimate_minutes: z.number().int().positive().max(1440).nullable().optional(), archive_requested: archiveRequestedSchema.optional(), project_id: z.string().min(1).nullable().optional(), milestone_id: z.string().min(1).nullable().optional()
});
export const patchTaskSchema = createTaskSchema.partial().extend({ row_version: z.number().int().positive().optional() });
export const recurrenceRuleSchema = z.object({ frequency: z.enum(["daily", "weekly", "monthly", "yearly"]), interval: z.number().int().min(1).max(1000).default(1), weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(), day_of_month: z.number().int().min(1).max(31).optional(), month: z.number().int().min(1).max(12).optional() });
export const createTaskRecurrenceSchema = z.object({ title_template: z.string().max(200).default(""), description_template: z.string().max(10000).default(""), content_template: z.string().max(10000).default(""), start_date: dateSchema(), end_date: dateSchema().nullable().optional(), rule: recurrenceRuleSchema, enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional().default(false) });
export const patchTaskRecurrenceSchema = createTaskRecurrenceSchema.partial().extend({ enabled: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(), title_template: z.string().max(200).optional(), description_template: z.string().max(10000).optional(), content_template: z.string().max(10000).optional(), row_version: z.number().int().positive().optional() });
export const projectCategorySchema = z.enum(["advancement", "maintenance", "small", "mid", "long_term"]);
export const projectStatusSchema = z.enum(["idea", "planned", "active", "paused", "done", "abandoned", "high_energy", "low_energy"]);
export const createProjectSchema = z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(10000).optional(), parent_id: z.string().min(1).nullable().optional(), category: projectCategorySchema.optional(), template: projectCategorySchema.optional(), status: projectStatusSchema.optional(), started_at: dateSchema().nullable().optional(), target_date: dateSchema().nullable().optional(), end_date: dateSchema().nullable().optional(), target_result: z.string().max(10000).optional(), priority: prioritySchema.optional(), benefit_enabled: z.union([z.boolean(), z.number().int().min(0).max(1), z.string()]).transform((v) => v === true || v === 1 || v === "1" || v === "true").optional(), benefit_cents: z.number().int().nonnegative().nullable().optional(), benefit_kind: z.enum(["none", "possible", "definite", "certain"]).optional(), score: z.number().int().min(0).max(100).nullable().optional() });
export const patchProjectSchema = createProjectSchema.partial().extend({ status: projectStatusSchema.optional(), progress_manual: z.number().int().min(0).max(100).nullable().optional(), archive_requested: archiveRequestedSchema.optional(), row_version: z.number().int().positive().optional() });
const financeCategorySchema = z.string().trim().min(1).max(100);
export const financeEntrySchema = z.object({ account_id: z.string().min(1).optional(), amount_cents: z.number().int().positive(), currency: z.string().trim().min(1).max(10).optional(), category: z.string().trim().min(1).max(200).optional(), category_major: financeCategorySchema.optional(), category_minor: financeCategorySchema.optional(), project_id: z.string().min(1).nullable().optional(), event: z.string().max(10000).optional(), note: z.string().max(10000).optional(), occurred_date: dateSchema().optional(), quick_button_id: z.string().min(1).optional() });
export const patchFinanceEntrySchema = financeEntrySchema.partial();
export const healthLogSchema = z.object({ weight_kg: z.number().positive().max(500).nullable().optional(), bedtime_local: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), sleep_onset_local: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), wake_local: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(), sleep_duration_minutes: z.number().int().min(0).max(1440).nullable().optional(), exercise_note: z.string().max(10000).nullable().optional(), exercise_minutes: z.number().int().min(0).max(1440).nullable().optional(), disciplined: z.union([z.boolean(), z.number().int().min(0).max(1)]).nullable().optional(), cloud_content: z.string().max(20000).nullable().optional(), note: z.string().max(10000).nullable().optional() });
export const reviewContentSchema = z.record(z.unknown());
export const createIdeaSchema = z.object({ title: z.string().trim().min(0).max(200), body: z.string().max(10000).optional(), category: ideaCategorySchema.optional(), urgency: z.number().int().min(1).max(4).optional(), processed: processedSchema.optional(), archive_requested: archiveRequestedSchema.optional() });
export const patchIdeaSchema = createIdeaSchema.partial().extend({ status: z.enum(["inbox", "considering", "promoted", "archived"]).optional(), row_version: z.number().int().positive().optional() });
export const butlerMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(20000) });
export const butlerChatRequestSchema = z.object({ base_url: z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), "base_url must use http(s)"), model: z.string().min(1).max(200).optional(), conversation_id: z.string().min(1).optional(), messages: z.array(butlerMessageSchema).min(1).max(20) });

export type TodayResponse = z.infer<typeof todayResponseSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;
export type CreateTaskRecurrence = z.infer<typeof createTaskRecurrenceSchema>;
