import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("D:/code/mature project/Personal AI OS/packages/db/node_modules/better-sqlite3");

const db = new Database("C:/Users/jytzl/.paios/paios.db");
const projects = db.prepare("SELECT id, name FROM projects").all();
console.log("Projects:", projects);

const projectNames = projects.map(p => p.name);
const allOrphans = db.prepare(`
  SELECT t.id, t.title, t.status, t.description, t.parent_id
  FROM tasks t
  WHERE t.parent_id IS NULL AND t.title NOT LIKE '🎯%'
  AND (
    t.description IN (${projectNames.map(() => '?').join(',')})
    OR t.id IN (SELECT todo_task_id FROM project_task_plans WHERE todo_task_id IS NOT NULL)
  )
`).all(...projectNames);
console.log("All orphan project checkpoint tasks:", allOrphans);

const allProjectTaskPlans = db.prepare("SELECT id, project_id, title, status, todo_task_id FROM project_task_plans WHERE todo_task_id IS NOT NULL").all();
console.log("Linked project task plans count:", allProjectTaskPlans.length);

const parents = db.prepare("SELECT id, title, parent_id FROM tasks WHERE title LIKE '🎯%'").all();
console.log("Parent tasks:", parents);
