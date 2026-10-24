import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("D:/code/mature project/Personal AI OS/packages/db/node_modules/better-sqlite3");

const db = new Database("C:/Users/jytzl/.paios/paios.db");

// 1. Find all project parent tasks
const parentTasks = db.prepare("SELECT id, title FROM tasks WHERE title LIKE '🎯%'").all();
const parentMap = new Map();
for (const p of parentTasks) {
  const name = p.title.replace(/^🎯\s*/, "").trim();
  parentMap.set(name, p.id);
}
console.log("Parent tasks map:", Object.fromEntries(parentMap));

// 2. Find any orphan task whose description matches a project name or is linked to project_task_plans
const projects = db.prepare("SELECT id, name FROM projects").all();
const projectMap = new Map(projects.map(p => [p.id, p.name]));

// Check project_task_plans
const plans = db.prepare("SELECT id, project_id, title, status, todo_task_id FROM project_task_plans WHERE todo_task_id IS NOT NULL").all();
for (const plan of plans) {
  const projectName = projectMap.get(plan.project_id);
  const parentId = parentMap.get(projectName);
  if (parentId) {
    db.prepare("UPDATE tasks SET parent_id = ? WHERE id = ? AND parent_id IS NULL").run(parentId, plan.todo_task_id);
  }
}

// Check tasks whose description matches a project name
for (const proj of projects) {
  const parentId = parentMap.get(proj.name);
  if (parentId) {
    db.prepare("UPDATE tasks SET parent_id = ? WHERE description = ? AND parent_id IS NULL AND id != ?").run(parentId, proj.name, parentId);
  }
}

// Clean up description if it equals project name
for (const proj of projects) {
  db.prepare("UPDATE tasks SET description = '' WHERE description = ?").run(proj.name);
}

// Specific fix for "v1.6：接通考试与 Agent 分工（告知ai 考试系统已完工）"
const teacherParentId = parentMap.get("教师agent");
if (teacherParentId) {
  db.prepare("UPDATE tasks SET parent_id = ?, description = '' WHERE title LIKE '%接通考试%'").run(teacherParentId);
}

// 3. Recalculate parent task due_date and status
for (const [name, pid] of parentMap.entries()) {
  const children = db.prepare("SELECT status, due_date FROM tasks WHERE parent_id = ?").all(pid);
  if (children.length > 0) {
    const allDone = children.every(c => c.status === "done");
    const nextStatus = allDone ? "done" : "todo";
    const earliestDueDate = children
      .filter(c => c.status === "todo" && Boolean(c.due_date))
      .map(c => c.due_date)
      .sort()[0] || null;
    db.prepare("UPDATE tasks SET status = ?, due_date = ? WHERE id = ?").run(nextStatus, earliestDueDate, pid);
    console.log(`Updated parent ${name}: status=${nextStatus}, due_date=${earliestDueDate}, subtasks=${children.length}`);
  }
}

console.log("Orphans fixed successfully!");
