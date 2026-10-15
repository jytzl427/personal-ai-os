import { useEffect, useRef, useState } from "react";
import { DateField } from "../components/DateField.js";
import { Checkbox } from "../components/Checkbox.js";
import { PageHeader } from "../components/PageHeader.js";
import { PropertySelect } from "../components/PropertySelect.js";
import { Tag, type TagTone } from "../components/Tag.js";
import { RichTextBlockEditor } from "../components/RichTextBlockEditor.js";
import { apiJson, jsonRequest } from "../lib/api.js";
import type { Route } from "../lib/route.js";

type TaskStatus = "todo" | "done" | "cancelled";
type Task = {
  id: string;
  title: string;
  description?: string | null;
  content?: string | null;
  status: string;
  due_date?: string | null;
  archive_requested?: number | boolean | null;
  archived_at?: string | null;
  row_version?: number;
};
type TaskResponse = { task: Task };
type TaskDraft = {
  title: string;
  description: string;
  content: string;
  status: TaskStatus;
  due_date: string;
  archive_requested: boolean;
};
type SlashCommand = { label: string; description: string; insert: string };

const SLASH_COMMANDS: SlashCommand[] = [
  { label: "待办事项", description: "插入一个待办勾选标记", insert: "- [ ] " },
  { label: "无序列表", description: "插入一个普通列表项", insert: "- " }
];

function normalizeStatus(status: string): TaskStatus {
  return status === "done" || status === "cancelled" ? status : "todo";
}

function statusTone(status: string): TagTone {
  if (status === "done") return "success";
  if (status === "cancelled") return "danger";
  return "neutral";
}

function statusLabel(status: string) {
  if (status === "done") return "完成";
  if (status === "cancelled") return "取消";
  return "未完成";
}

export function TaskDetailPage({ id, onNavigate }: { id: string; onNavigate: (route: Route) => void }) {
  const [data, setData] = useState<TaskResponse | null>(null);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<TaskDraft | null>(null);
  const versionRef = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const initialDraftRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setLoading(true);
    setData(null);
    setDraft(null);
    setError(null);
    draftRef.current = null;
    versionRef.current = undefined;
    dirtyRef.current = false;
    initialDraftRef.current = false;
    apiJson<TaskResponse>(`/tasks/${encodeURIComponent(id)}`)
      .then((result) => {
        const nextDraft = {
          title: result.task.title ?? "",
          description: result.task.description ?? "",
          content: result.task.content ?? "",
          status: normalizeStatus(result.task.status),
          due_date: result.task.due_date ?? "",
          archive_requested: Boolean(result.task.archive_requested)
        } satisfies TaskDraft;
        setData(result);
        versionRef.current = result.task.row_version;
        draftRef.current = nextDraft;
        setDraft(nextDraft);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "任务详情加载失败"))
      .finally(() => setLoading(false));
  }, [id]);

  function update(patch: Partial<TaskDraft>) {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      draftRef.current = next;
      dirtyRef.current = true;
      return next;
    });
    setError(null);
  }

  async function persist(nextDraft: TaskDraft) {
    setError(null);
    try {
      const result = await apiJson<{ task: Task }>(`/tasks/${encodeURIComponent(id)}`, jsonRequest("PATCH", {
        title: nextDraft.title,
        description: nextDraft.description,
        content: nextDraft.content,
        status: nextDraft.status,
        due_date: nextDraft.due_date || null,
        archive_requested: nextDraft.archive_requested,
        row_version: versionRef.current
      }));
      if (result.task.archived_at) {
        onNavigate({ name: "tasks" });
        return;
      }
      versionRef.current = result.task.row_version;
      if (draftRef.current === nextDraft) dirtyRef.current = false;
      setData((current) => current ? { ...current, task: result.task } : current);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "自动保存失败");
    }
  }

  function enqueueAutoSave() {
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const latest = draftRef.current;
        if (latest) await persist(latest);
      });
  }

  useEffect(() => {
    if (!draft) return;
    if (!initialDraftRef.current) {
      initialDraftRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => enqueueAutoSave(), 800);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => () => {
    if (draftRef.current && initialDraftRef.current && dirtyRef.current) enqueueAutoSave();
  }, [id]);

  if (loading) return <div className="page-stack page-task-detail"><div className="panel database-empty">任务读取中…</div></div>;
  if (!data || !draft) return <div className="page-stack page-task-detail"><div className="notice error">{error ?? "任务不存在"}</div></div>;

  const taskName = draft.title.trim() || "未命名任务";
  return (
    <div className="page-stack page-task-detail">
      <PageHeader title={taskName}>
        <button className="secondary-button" onClick={() => onNavigate({ name: "tasks" })} type="button">← 返回任务</button>
      </PageHeader>
      {error ? <div className="notice error">{error}</div> : null}
      <section className="task-detail-hero">
        <div className="task-detail-title-wrap">
          <Tag tone={statusTone(draft.status)}>{statusLabel(draft.status)}</Tag>
          <TaskTitleEditor value={draft.title} onChange={(value) => update({ title: value })} />
        </div>
      </section>
      <div className="task-detail-layout">
        <main className="task-detail-editor-panel panel">
          <div className="panel-heading task-detail-heading">
            <h2>任务内容</h2>
          </div>
          <RichTextBlockEditor blockAriaLabel="任务内容块" value={draft.content} onChange={(value) => update({ content: value })} />
        </main>
        <aside className="task-detail-sidebar panel">
          <div className="panel-heading task-detail-heading"><h2>任务属性</h2><span className="muted">可编辑</span></div>
          <label className="form-field"><span>任务日期</span><DateField ariaLabel="任务日期" value={draft.due_date} onChange={(value) => update({ due_date: value })} /></label>
          <label className="form-field"><span>状态</span><PropertySelect ariaLabel="任务状态" options={[{ value: "todo", label: "未完成" }, { value: "done", label: "完成" }, { value: "cancelled", label: "取消" }]} tone={statusTone(draft.status)} value={draft.status} onChange={(value) => update({ status: value as TaskStatus })} /></label>
          <label className="detail-check-field"><Checkbox ariaLabel="请求归档任务" checked={draft.archive_requested} onChange={(checked) => update({ archive_requested: checked })} /><span>完成或取消后自动归档</span></label>
        </aside>
      </div>
    </div>
  );
}

function TaskTitleEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }

  useEffect(() => resize(), [value]);

  return (
    <textarea
      aria-label="任务名称"
      className="task-detail-title"
      onChange={(event) => onChange(event.target.value)}
      onInput={resize}
      ref={ref}
      rows={1}
      value={value}
    />
  );
}

function TaskContentEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [slashRange, setSlashRange] = useState<{ start: number; end: number } | null>(null);
  const matches = SLASH_COMMANDS.filter((command) => command.label.includes(query));

  function inspectSlash(nextValue: string, cursor: number) {
    const lineStart = nextValue.lastIndexOf("\n", cursor - 1) + 1;
    const lineBeforeCursor = nextValue.slice(lineStart, cursor);
    const slashIndex = lineBeforeCursor.lastIndexOf("/");
    if (slashIndex < 0 || (slashIndex > 0 && !/\s/.test(lineBeforeCursor[slashIndex - 1] ?? ""))) {
      setMenuOpen(false);
      setSlashRange(null);
      return;
    }
    const currentQuery = lineBeforeCursor.slice(slashIndex + 1);
    if (/\s/.test(currentQuery)) {
      setMenuOpen(false);
      setSlashRange(null);
      return;
    }
    setQuery(currentQuery);
    setActiveIndex(0);
    setSlashRange({ start: lineStart + slashIndex, end: cursor });
    setMenuOpen(SLASH_COMMANDS.some((command) => command.label.includes(currentQuery)));
  }

  function handleChange(nextValue: string) {
    onChange(nextValue);
    const cursor = editorRef.current?.selectionStart ?? nextValue.length;
    inspectSlash(nextValue, cursor);
  }

  function closeMenu() {
    setMenuOpen(false);
    setSlashRange(null);
  }

  function insertCommand(command: SlashCommand) {
    if (!slashRange) return;
    const nextValue = value.slice(0, slashRange.start) + command.insert + value.slice(slashRange.end);
    const nextCursor = slashRange.start + command.insert.length;
    onChange(nextValue);
    closeMenu();
    window.requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  return (
    <div className="task-editor-shell">
      <textarea
        aria-label="任务详细内容"
        className="task-detail-editor"
        maxLength={10000}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={(event) => {
          if (!menuOpen || !matches.length) {
            if (event.key === "Escape") closeMenu();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((current) => (current + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => (current - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            insertCommand(matches[activeIndex] ?? matches[0]!);
          } else if (event.key === "Escape") {
            event.preventDefault();
            closeMenu();
          }
        }}
        ref={editorRef}
        value={value}
      />
      {menuOpen && matches.length ? (
        <div aria-label="斜杠命令" className="slash-menu" role="listbox">
          {matches.map((command, index) => (
            <button
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "slash-menu-item is-active" : "slash-menu-item"}
              key={command.label}
              onClick={() => insertCommand(command)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
              type="button"
            >
              <strong>{command.label}</strong>
              <span>{command.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
