import fs from "node:fs";

const filePath = "D:/code/mature project/Personal AI OS/apps/server/src/app.ts";
let content = fs.readFileSync(filePath, "utf8");

// 1. Update GET /api/v1/projects
const getProjectsOld = `  app.get("/api/v1/projects", (c) => {
    const projects = context.database.prepare("SELECT * FROM projects WHERE archived_at IS NULL ORDER BY started_at IS NULL, started_at DESC, end_date IS NULL, end_date ASC, created_at DESC").all() as Array<Record<string, unknown>>;
    const result = projects.map((project) => {
      const counts = context.database.prepare(
        \`SELECT COUNT(t.id) AS total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed
         FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id
         WHERE l.project_id = ? AND t.archived_at IS NULL\`
      ).get(project.id) as { total: number; completed: number | null };
      return { ...project, progress: computeProjectProgress(counts.completed ?? 0, counts.total, project.progress_manual as number | null), finance: projectFinanceSummary(context.database, String(project.id)) };
    });
    return c.json({ ok: true, projects: result });
  });`;

const getProjectsNew = `  app.get("/api/v1/projects", (c) => {
    const projects = context.database.prepare("SELECT * FROM projects WHERE archived_at IS NULL ORDER BY started_at IS NULL, started_at DESC, end_date IS NULL, end_date ASC, created_at DESC").all() as Array<Record<string, unknown>>;
    const result = projects.map((project) => {
      const planCounts = context.database.prepare(
        \`SELECT COUNT(id) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed
         FROM project_task_plans
         WHERE project_id = ? AND archived_at IS NULL\`
      ).get(project.id) as { total: number; completed: number | null };

      const taskCounts = context.database.prepare(
        \`SELECT COUNT(t.id) AS total, SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed
         FROM tasks t INNER JOIN task_project_links l ON l.task_id = t.id
         WHERE l.project_id = ? AND t.archived_at IS NULL\`
      ).get(project.id) as { total: number; completed: number | null };

      const totalTasks = (planCounts?.total ?? 0) + (taskCounts?.total ?? 0);
      const completedTasks = (planCounts?.completed ?? 0) + (taskCounts?.completed ?? 0);

      let progress = 0;
      if (project.status === "done") {
        progress = 100;
      } else if (project.progress_manual !== null && project.progress_manual !== undefined) {
        progress = Math.min(100, Math.max(0, Math.round(Number(project.progress_manual))));
      } else if (totalTasks > 0) {
        progress = Math.min(100, Math.max(0, Math.round((completedTasks / totalTasks) * 100)));
      }

      const nextCheckpoint = context.database.prepare(
        \`SELECT id, title, due_date
         FROM project_task_plans
         WHERE project_id = ? AND status != 'done' AND archived_at IS NULL
         ORDER BY sort_order ASC, due_date IS NULL, due_date ASC, created_at ASC
         LIMIT 1\`
      ).get(project.id) as { id: string; title: string; due_date: string | null } | undefined;

      return {
        ...project,
        progress,
        checkpoint_stats: {
          total: planCounts?.total ?? 0,
          completed: planCounts?.completed ?? 0,
        },
        next_checkpoint: nextCheckpoint ?? null,
        finance: projectFinanceSummary(context.database, String(project.id)),
      };
    });
    return c.json({ ok: true, projects: result });
  });`;

// 2. Add reorder endpoint
const deleteEndpointOld = `      context.database.prepare("DELETE FROM project_task_plans WHERE id = ?").run(id);
      addProjectActivity(context.database, String(current.project_id), "task_removed", "项目任务已删除：" + current.title, false, timestamp);
    });
    remove();
    return c.json({ ok: true });
  });`;

const reorderEndpointNew = `      context.database.prepare("DELETE FROM project_task_plans WHERE id = ?").run(id);
      addProjectActivity(context.database, String(current.project_id), "task_removed", "项目任务已删除：" + current.title, false, timestamp);
    });
    remove();
    return c.json({ ok: true });
  });

  app.post("/api/v1/projects/:id/task-plans/reorder", async (c) => {
    const projectId = c.req.param("id");
    if (!context.database.prepare("SELECT id FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) return notFound(c, "project");
    const body = await c.req.json() as { plan_ids?: string[] };
    if (!Array.isArray(body.plan_ids)) return c.json({ ok: false, error: { code: "BAD_REQUEST", message: "plan_ids array is required" } }, 400);
    const timestamp = now();
    const update = context.database.transaction(() => {
      body.plan_ids!.forEach((planId, index) => {
        context.database.prepare(
          "UPDATE project_task_plans SET sort_order = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND project_id = ?"
        ).run(index, timestamp, planId, projectId);
      });
    });
    update();
    return c.json({ ok: true, project_tasks: projectTaskPlans(context.database, projectId) });
  });`;

// Normalize CRLF to LF for comparison and replace
const normalizedContent = content.replace(/\r\n/g, "\n");
const normalizedGetProjectsOld = getProjectsOld.replace(/\r\n/g, "\n");
const normalizedGetProjectsNew = getProjectsNew.replace(/\r\n/g, "\n");
const normalizedDeleteEndpointOld = deleteEndpointOld.replace(/\r\n/g, "\n");
const normalizedReorderEndpointNew = reorderEndpointNew.replace(/\r\n/g, "\n");

let patched = normalizedContent.replace(normalizedGetProjectsOld, normalizedGetProjectsNew);
patched = patched.replace(normalizedDeleteEndpointOld, normalizedReorderEndpointNew);

// Restore CRLF
fs.writeFileSync(filePath, patched.replace(/\n/g, "\r\n"), "utf8");
console.log("Patched apps/server/src/app.ts successfully");
