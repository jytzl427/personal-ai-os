import fs from "node:fs";

const filePath = "D:/code/mature project/Personal AI OS/apps/web/src/pages/ProjectsPage.tsx";
let content = fs.readFileSync(filePath, "utf8");

// 1. In renderProjectCard, calculate urgency and add warning classes
const oldCardInit = `    const netCents = project.finance?.net_cents ?? 0;
    const hasFinance = Boolean(project.benefit_enabled && project.finance);
    const countdown = getCountdownBadge(project.target_date, isCompleted);
    const progressVal = isCompleted
      ? 100
      : (project.progress_manual !== null && project.progress_manual !== undefined
          ? Math.max(0, Math.min(100, project.progress_manual))
          : Math.max(0, Math.min(100, project.progress ?? 0)));

    return (
      <article className={\`project-card \${isCompleted ? "is-completed" : ""}\`} key={project.id}>`;

const newCardInit = `    const netCents = project.finance?.net_cents ?? 0;
    const hasFinance = Boolean(project.benefit_enabled && project.finance);
    const countdown = getCountdownBadge(project.target_date, isCompleted);
    const cpCountdown = project.next_checkpoint?.due_date ? getCountdownBadge(project.next_checkpoint.due_date, false) : null;
    const isOverdue = !isCompleted && (countdown.tone === "overdue" || cpCountdown?.tone === "overdue");
    const isDueToday = !isCompleted && !isOverdue && (countdown.tone === "due-today" || cpCountdown?.tone === "due-today");
    const isUrgent = !isCompleted && !isOverdue && !isDueToday && (countdown.tone === "urgent" || cpCountdown?.tone === "urgent");
    const urgencyClass = isOverdue ? "has-overdue-deadline" : isDueToday ? "has-due-today-deadline" : isUrgent ? "has-urgent-deadline" : "";

    const progressVal = isCompleted
      ? 100
      : (project.progress_manual !== null && project.progress_manual !== undefined
          ? Math.max(0, Math.min(100, project.progress_manual))
          : Math.max(0, Math.min(100, project.progress ?? 0)));

    return (
      <article className={\`project-card \${isCompleted ? "is-completed" : ""} \${urgencyClass}\`} key={project.id}>`;

content = content.replace(oldCardInit, newCardInit);

// 2. In renderProjectCard, update next_checkpoint slot and countdown badge
const oldTimeCapsuleRow = `              <div className="time-capsule-row">
                <span className="time-capsule-span">
                  📅 {formatDateCompact(project.started_at)} ─ {formatDateCompact(project.target_date)}
                </span>
                <span className={\`time-capsule-badge tone-\${countdown.tone}\`}>
                  {countdown.text}
                </span>
              </div>`;

const newTimeCapsuleRow = `              <div className="time-capsule-row">
                <span className="time-capsule-span">
                  📅 {formatDateCompact(project.started_at)} ─ {formatDateCompact(project.target_date)}
                </span>
                <span className={\`time-capsule-badge tone-\${countdown.tone} \${countdown.tone !== "normal" && countdown.tone !== "muted" && countdown.tone !== "done" ? "is-emphasized" : ""}\`}>
                  {countdown.text}
                </span>
              </div>`;

content = content.replace(oldTimeCapsuleRow, newTimeCapsuleRow);

const oldNextSlot = `              {project.next_checkpoint ? (
                <div className="project-card-next-slot">
                  <span className="next-slot-tag">🎯 下一步攻坚</span>
                  <span className="next-slot-title" title={project.next_checkpoint.title}>
                    {project.next_checkpoint.title}
                  </span>
                  {project.next_checkpoint.due_date ? (
                    <span className="next-slot-due">
                      {formatDateCompact(project.next_checkpoint.due_date)} 截止
                    </span>
                  ) : null}
                </div>`;

const newNextSlot = `              {project.next_checkpoint ? (
                <div className={\`project-card-next-slot \${cpCountdown && cpCountdown.tone !== "normal" && cpCountdown.tone !== "muted" ? "is-urgent-slot tone-" + cpCountdown.tone : ""}\`}>
                  <span className="next-slot-tag">🎯 下一步攻坚</span>
                  <span className="next-slot-title" title={project.next_checkpoint.title}>
                    {project.next_checkpoint.title}
                  </span>
                  {project.next_checkpoint.due_date ? (
                    <span className={\`next-slot-due \${cpCountdown ? "tone-" + cpCountdown.tone : ""}\`}>
                      {cpCountdown?.tone === "overdue" || cpCountdown?.tone === "due-today" || cpCountdown?.tone === "urgent"
                        ? \`⚠️ \${formatDateCompact(project.next_checkpoint.due_date)} 截止 (\${cpCountdown.text})\`
                        : \`\${formatDateCompact(project.next_checkpoint.due_date)} 截止\`}
                    </span>
                  ) : null}
                </div>`;

content = content.replace(oldNextSlot, newNextSlot);

// 3. Add moveCheckpoint & saveField in ProjectDetailPage
const oldSaveFunc = `  async function save() {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const isMaint = isMaintenanceProject(draft.category);
      const payload: Record<string, unknown> = {
        name: draft.name,
        category: draft.category,
        status: draft.status,
        started_at: draft.started_at || null,
        end_date: draft.end_date || null,
        benefit_enabled: draft.benefit_enabled === "1",
        archive_requested: draft.archive_requested === "1",
        row_version: data.project.row_version,
      };
      if (isMaint) {
        payload.description = draft.description;
      } else {
        payload.target_result = draft.target_result;
        payload.target_date = draft.target_date || null;
      }

      const result = await apiJson<{ project: Project }>(\`/projects/\${encodeURIComponent(id)}\`, jsonRequest("PATCH", payload));
      if (result.project.archived_at) {
        onNavigate({ name: "archive", tab: "projects" });
        return;
      }
      setData((current) => (current ? { ...current, project: result.project } : current));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "项目保存失败");
    } finally {
      setSaving(false);
    }
  }`;

const newSaveFunc = `  async function saveField(updates: Record<string, unknown> = {}) {
    if (!data) return;
    const nextDraft = { ...draft, ...updates };
    setDraft(nextDraft);
    setSaving(true);
    setError(null);
    try {
      const isMaint = isMaintenanceProject(nextDraft.category);
      const payload: Record<string, unknown> = {
        name: nextDraft.name,
        category: nextDraft.category,
        status: nextDraft.status,
        started_at: nextDraft.started_at || null,
        end_date: nextDraft.end_date || null,
        benefit_enabled: nextDraft.benefit_enabled === "1",
        archive_requested: nextDraft.archive_requested === "1",
        row_version: data.project.row_version,
      };
      if (isMaint) {
        payload.description = nextDraft.description;
      } else {
        payload.target_result = nextDraft.target_result;
        payload.target_date = nextDraft.target_date || null;
      }

      const result = await apiJson<{ project: Project }>(\`/projects/\${encodeURIComponent(id)}\`, jsonRequest("PATCH", payload));
      if (result.project.archived_at) {
        onNavigate({ name: "archive", tab: "projects" });
        return;
      }
      setData((current) => (current ? { ...current, project: result.project } : current));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "项目属性自动同步失败");
    } finally {
      setSaving(false);
    }
  }

  async function moveCheckpoint(index: number, direction: -1 | 1) {
    if (!data?.project_tasks) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= data.project_tasks.length) return;

    const list = [...data.project_tasks];
    const [moved] = list.splice(index, 1);
    list.splice(targetIndex, 0, moved);

    setData({ ...data, project_tasks: list });

    try {
      await apiJson(
        \`/projects/\${encodeURIComponent(id)}/task-plans/reorder\`,
        jsonRequest("POST", { plan_ids: list.map((t) => t.id) })
      );
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "节点排序更新失败");
      load();
    }
  }

  async function save() {
    await saveField();
  }`;

content = content.replace(oldSaveFunc, newSaveFunc);

// 4. Update advancement panel inputs to auto-save on blur/change
const oldAdvPanelHeading = `<span className="muted">{saving ? "保存中…" : "可编辑"}</span>`;
const newAdvPanelHeading = `<span className="auto-save-status">{saving ? "正在自动同步…" : "✓ 属性实时保存"}</span>`;
content = content.replaceAll(oldAdvPanelHeading, newAdvPanelHeading);

const oldAdvName = `<input className="cell-input" onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name ?? ""} />`;
const newAdvName = `<input className="cell-input" onBlur={() => void saveField()} onChange={(event) => setDraft({ ...draft, name: event.target.value })} value={draft.name ?? ""} />`;
content = content.replaceAll(oldAdvName, newAdvName);

const oldAdvTarget = `              <input
                className="cell-input"
                onChange={(event) => setDraft({ ...draft, target_result: event.target.value })}
                placeholder="一句话定义项目最终交付结果（如：搭建一套可用的复习与考试系统）"
                value={draft.target_result ?? ""}
              />`;

const newAdvTarget = `              <input
                className="cell-input"
                onBlur={() => void saveField()}
                onChange={(event) => setDraft({ ...draft, target_result: event.target.value })}
                placeholder="一句话定义项目最终交付结果（如：搭建一套可用的复习与考试系统）"
                value={draft.target_result ?? ""}
              />`;

content = content.replace(oldAdvTarget, newAdvTarget);

const oldAdvSelectCategory = `<select className="select-input" onChange={(event) => setDraft({ ...draft, category: event.target.value })} value={draft.category ?? "advancement"}>`;
const newAdvSelectCategory = `<select className="select-input" onChange={(event) => { const category = event.target.value; setDraft({ ...draft, category }); void saveField({ category }); }} value={draft.category ?? "advancement"}>`;
content = content.replace(oldAdvSelectCategory, newAdvSelectCategory);

const oldAdvSelectStatus = `<select className="select-input" onChange={(event) => setDraft({ ...draft, status: event.target.value })} value={draft.status ?? "idea"}>`;
const newAdvSelectStatus = `<select className="select-input" onChange={(event) => { const status = event.target.value; setDraft({ ...draft, status }); void saveField({ status }); }} value={draft.status ?? "idea"}>`;
content = content.replace(oldAdvSelectStatus, newAdvSelectStatus);

const oldAdvDates = `              <label className="form-field">
                <span>启动时间</span>
                <DateField ariaLabel="项目启动时间" onChange={(value) => setDraft({ ...draft, started_at: value })} value={draft.started_at} />
              </label>

              <label className="form-field">
                <span>预计完成时间</span>
                <DateField ariaLabel="预计完成时间" onChange={(value) => setDraft({ ...draft, target_date: value })} value={draft.target_date} />
              </label>

              <label className="form-field">
                <span>实际完成时间</span>
                <DateField ariaLabel="实际完成时间" onChange={(value) => setDraft({ ...draft, end_date: value })} value={draft.end_date} />
              </label>`;

const newAdvDates = `              <label className="form-field">
                <span>启动时间</span>
                <DateField ariaLabel="项目启动时间" onChange={(value) => { setDraft({ ...draft, started_at: value }); void saveField({ started_at: value }); }} value={draft.started_at} />
              </label>

              <label className="form-field">
                <span>预计完成时间</span>
                <DateField ariaLabel="预计完成时间" onChange={(value) => { setDraft({ ...draft, target_date: value }); void saveField({ target_date: value }); }} value={draft.target_date} />
              </label>

              <label className="form-field">
                <span>实际完成时间</span>
                <DateField ariaLabel="实际完成时间" onChange={(value) => { setDraft({ ...draft, end_date: value }); void saveField({ end_date: value }); }} value={draft.end_date} />
              </label>`;

content = content.replace(oldAdvDates, newAdvDates);

// 5. Add Up/Down buttons in stepper-card-actions
const oldStepperActions = `                          <div className="stepper-card-actions">
                            <button
                              className={\`stepper-status-btn \${isDone ? "done" : "todo"}\`}
                              onClick={() => void updateCheckpoint(task, { status: isDone ? "todo" : "done" })}
                              type="button"
                            >
                              {isDone ? "✓ 验收通过" : "○ 点击验收"}
                            </button>
                            <DeleteButton label={\`删除节点 \${task.title || idx + 1}\`} onClick={() => void deleteCheckpoint(task)} />
                          </div>`;

const newStepperActions = `                          <div className="stepper-card-actions">
                            <div className="stepper-reorder-group">
                              <button
                                aria-label={\`上移节点 \${task.title || idx + 1}\`}
                                className="stepper-reorder-btn"
                                disabled={idx === 0}
                                onClick={() => void moveCheckpoint(idx, -1)}
                                title="上移此节点"
                                type="button"
                              >
                                ▲
                              </button>
                              <button
                                aria-label={\`下移节点 \${task.title || idx + 1}\`}
                                className="stepper-reorder-btn"
                                disabled={idx === checkpoints.length - 1}
                                onClick={() => void moveCheckpoint(idx, 1)}
                                title="下移此节点"
                                type="button"
                              >
                                ▼
                              </button>
                            </div>
                            <button
                              className={\`stepper-status-btn \${isDone ? "done" : "todo"}\`}
                              onClick={() => void updateCheckpoint(task, { status: isDone ? "todo" : "done" })}
                              type="button"
                            >
                              {isDone ? "✓ 验收通过" : "○ 点击验收"}
                            </button>
                            <DeleteButton label={\`删除节点 \${task.title || idx + 1}\`} onClick={() => void deleteCheckpoint(task)} />
                          </div>`;

content = content.replace(oldStepperActions, newStepperActions);

fs.writeFileSync(filePath, content, "utf8");
console.log("Patched ProjectsPage.tsx successfully");
