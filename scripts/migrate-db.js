import fs from "node:fs";

const filePath = "D:/code/mature project/Personal AI OS/packages/db/src/index.ts";
let content = fs.readFileSync(filePath, "utf8");
const needle = "migrateProjectTaskArchive();";
const addition = `
  }
  const projectTaskSortOrderApplied = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?").get("020_project_task_sort_order");
  if (!projectTaskSortOrderApplied) {
    const migrateSortOrder = database.transaction(() => {
      ensureColumn(database, "project_task_plans", "sort_order", "INTEGER NOT NULL DEFAULT 0");
      database.exec("CREATE INDEX IF NOT EXISTS idx_project_task_plans_sort ON project_task_plans(project_id, sort_order)");
      database.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(20, "020_project_task_sort_order", nowIso());
    });
    migrateSortOrder();`;

if (!content.includes("020_project_task_sort_order")) {
  content = content.replace(needle, needle + addition);
  fs.writeFileSync(filePath, content, "utf8");
  console.log("Updated packages/db/src/index.ts successfully");
} else {
  console.log("Already updated.");
}
