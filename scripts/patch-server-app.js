import fs from "node:fs";

const filePath = "D:/code/mature project/Personal AI OS/apps/server/src/app.ts";
let content = fs.readFileSync(filePath, "utf8");

// 1. Update import
const oldImport = 'import { addProjectActivity, PROJECT_TEMPLATES, projectActivities, projectFinanceSummary, projectTaskPlans, projectTemplate, syncProjectPlansForTodo } from "./project-service.js";';
const newImport = 'import { addProjectActivity, PROJECT_TEMPLATES, projectActivities, projectFinanceSummary, projectTaskPlans, projectTemplate, syncProjectPlansForTodo, syncUpcomingCheckpointsToTodos } from "./project-service.js";';
if (!content.includes(newImport)) {
  content = content.replace(oldImport, newImport);
}

// 2. In createApp
const oldToken = 'const uiSessionToken = randomUUID().replaceAll("-", "");';
const newToken = `const uiSessionToken = randomUUID().replaceAll("-", "");\n  try { syncUpcomingCheckpointsToTodos(context.database); } catch {}`;
if (!content.includes('syncUpcomingCheckpointsToTodos(context.database);')) {
  content = content.replace(oldToken, newToken);
}

// 3. In /api/v1/system/attention
const oldAttention = `  app.get("/api/v1/system/attention", (c) => {\n    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");\n    const date = localDateInTimezone(timezone);`;
const newAttention = `  app.get("/api/v1/system/attention", (c) => {\n    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");\n    const date = localDateInTimezone(timezone);\n    syncUpcomingCheckpointsToTodos(context.database, date);`;
content = content.replace(oldAttention, newAttention);

// 4. In /api/v1/planning/context
const oldPlanContext = `  app.get("/api/v1/planning/context", (c) => {\n    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");\n    const today = localDateInTimezone(timezone);`;
const newPlanContext = `  app.get("/api/v1/planning/context", (c) => {\n    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");\n    const today = localDateInTimezone(timezone);\n    syncUpcomingCheckpointsToTodos(context.database, today);`;
content = content.replace(oldPlanContext, newPlanContext);

// 5. In /api/v1/today
const oldToday = `  app.get("/api/v1/today", (c) => {\n    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");\n    const date = localDateInTimezone(timezone);`;
const newToday = `  app.get("/api/v1/today", (c) => {\n    const timezone = getSetting(context.database, "timezone", "Asia/Shanghai");\n    const date = localDateInTimezone(timezone);\n    syncUpcomingCheckpointsToTodos(context.database, date);`;
content = content.replace(oldToday, newToday);

// 6. In /api/v1/tasks
const oldTasks = `  app.get("/api/v1/tasks", (c) => {\n    const archived = parseArchivedFilter(c);`;
const newTasks = `  app.get("/api/v1/tasks", (c) => {\n    syncUpcomingCheckpointsToTodos(context.database);\n    const archived = parseArchivedFilter(c);`;
content = content.replace(oldTasks, newTasks);

fs.writeFileSync(filePath, content, "utf8");
console.log("Patched app.ts successfully");
