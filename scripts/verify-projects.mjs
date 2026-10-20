import Database from "file:///C:/Users/jytzl/.paios/desktop-runtime/resources/paios-server/node_modules/better-sqlite3/lib/index.js";

const db = new Database("C:/Users/jytzl/.paios/paios.db");
const projs = db.prepare("SELECT name, status, category, started_at, end_date FROM projects WHERE category = 'advancement' AND status = 'done'").all();
console.table(projs);
