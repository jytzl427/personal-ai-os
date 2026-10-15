import { useEffect, useMemo, useState } from "react";
import { AddRowButton } from "../components/AddRowButton.js";
import { CellText } from "../components/CellText.js";
import { Checkbox } from "../components/Checkbox.js";
import { DatabaseTable } from "../components/DatabaseTable.js";
import { DeleteButton } from "../components/DeleteButton.js";
import { PageHeader } from "../components/PageHeader.js";
import { PropertySelect } from "../components/PropertySelect.js";
import type { TagTone } from "../components/Tag.js";
import { apiJson, jsonRequest } from "../lib/api.js";

type IdeaCategory = "project" | "long_term" | "short_term";
type Idea = {
  id: string;
  title: string;
  body?: string | null;
  category?: string | null;
  status?: string | null;
  created_at?: string;
  row_version?: number;
  urgency?: number | null;
  processed?: number | boolean | null;
  archive_requested?: number | boolean | null;
  archived_at?: string | null;
};

function categoryTone(category: string | null | undefined): TagTone {
  if (category === "project") return "danger";
  if (category === "long_term") return "info";
  return "warning";
}

function urgencyTone(urgency: number): TagTone {
  return urgency === 1 ? "danger" : urgency === 2 ? "warning" : urgency === 3 ? "neutral" : "success";
}

function sortIdeas(rows: Idea[]) {
  return [...rows].sort((left, right) => {
    const leftUrgency = left.urgency ?? 4;
    const rightUrgency = right.urgency ?? 4;
    return leftUrgency - rightUrgency || (left.created_at ?? "").localeCompare(right.created_at ?? "");
  });
}

export function IdeasDatabase({ embedded = false }: { embedded?: boolean } = {}) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [focusIdeaId, setFocusIdeaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sortedIdeas = useMemo(() => sortIdeas(ideas), [ideas]);

  useEffect(() => {
    apiJson<{ ideas: Idea[] }>("/ideas")
      .then((result) => setIdeas(result.ideas))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "想法加载失败"))
      .finally(() => setLoading(false));
  }, []);

  async function saveIdea(id: string, patch: Record<string, unknown>) {
    const idea = ideas.find((item) => item.id === id);
    if (!idea) return;
    setSavingId(id);
    setFailedId(null);
    setError(null);
    try {
      const body = { ...patch };
      if (idea.row_version !== undefined) body.row_version = idea.row_version;
      const result = await apiJson<{ idea: Idea }>("/ideas/" + id, jsonRequest("PATCH", body));
      setIdeas((rows) => rows.map((item) => item.id === id ? { ...item, ...result.idea } : item));
      if (Boolean(result.idea.archived_at) || (Boolean(result.idea.archive_requested) && Boolean(result.idea.processed))) {
        setIdeas((rows) => rows.filter((item) => item.id !== id));
      }
    } catch (reason: unknown) {
      setFailedId(id);
      setError(reason instanceof Error ? reason.message : "想法保存失败");
    } finally {
      setSavingId(null);
    }
  }

  async function addIdea() {
    try {
      const result = await apiJson<{ idea: Idea }>("/ideas", jsonRequest("POST", { title: "", body: "", category: "short_term", urgency: 4 }));
      setIdeas((current) => [...current, result.idea]);
      setFocusIdeaId(result.idea.id);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "想法创建失败");
    }
  }

  async function deleteIdea(id: string) {
    try {
      await apiJson("/ideas/" + id, { method: "DELETE" });
      setIdeas((current) => current.filter((idea) => idea.id !== id));
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "想法删除失败");
    }
  }

  const table = (
    <section className="table-panel database-panel ideas-database-panel">
      <DatabaseTable
        empty={loading ? "正在读取想法…" : "还没有想法，从下方添加第一条。"}
        rowState={(idea) => savingId === idea.id ? "saving" : failedId === idea.id ? "failed" : undefined}
        rows={sortedIdeas}
        columns={[
          {
            key: "delete",
            label: "",
            className: "col-delete",
            render: (idea) => <DeleteButton label={`删除想法 ${idea.title || "未命名想法"}`} onClick={() => void deleteIdea(idea.id)} />
          },
          {
            key: "archive",
            label: "归档",
            className: "col-archive",
            render: (idea) => (
              <Checkbox
                ariaLabel={"归档想法 " + (idea.title || "未命名想法")}
                checked={Boolean(idea.archive_requested)}
                onChange={(checked) => void saveIdea(idea.id, { archive_requested: checked })}
              />
            )
          },
          {
            key: "title",
            label: "想法内容",
            className: "col-title",
              render: (idea) => (
                <CellText
                  autoFocus={focusIdeaId === idea.id}
                  autoGrow
                  className="idea-name-input"
                  multiline
                  placeholder="填写想法内容"
                  value={idea.title}
                  onCommit={(value) => { if (value.trim() !== idea.title) void saveIdea(idea.id, { title: value.trim() }); }}
              />
            )
          },
          {
            key: "category",
            label: "类型",
            className: "col-category",
            render: (idea) => (
              <PropertySelect
                ariaLabel={"想法类型 " + (idea.title || "未命名想法")}
                options={[{ value: "project", label: "项目灵感" }, { value: "long_term", label: "长期想法" }, { value: "short_term", label: "短期想法" }]}
                tone={categoryTone(idea.category)}
                value={idea.category === "project" || idea.category === "long_term" ? idea.category : "short_term"}
                onChange={(value) => void saveIdea(idea.id, { category: value as IdeaCategory })}
              />
            )
          },
          {
            key: "memo",
            label: "备注",
            className: "col-memo",
            render: (idea) => (
              <CellText
                multiline
                placeholder="添加备注…"
                value={idea.body ?? ""}
                onCommit={(value) => { if (value !== (idea.body ?? "")) void saveIdea(idea.id, { body: value }); }}
              />
            )
          },
          {
            key: "urgency",
            label: "紧急程度",
            className: "col-urgency",
            render: (idea) => (
              <PropertySelect
                ariaLabel={"紧急程度 " + (idea.title || "未命名想法")}
                options={[{ value: "1", label: "1级" }, { value: "2", label: "2级" }, { value: "3", label: "3级" }, { value: "4", label: "4级" }]}
                tone={urgencyTone(idea.urgency ?? 4)}
                value={idea.urgency ?? 4}
                onChange={(value) => void saveIdea(idea.id, { urgency: Number(value) })}
              />
            )
          },
          {
            key: "processed",
            label: "处理状态",
            className: "col-status",
            render: (idea) => (
              <PropertySelect
                ariaLabel={"处理状态 " + (idea.title || "未命名想法")}
                options={[{ value: "unprocessed", label: "未处理" }, { value: "processed", label: "已处理" }]}
                tone={Boolean(idea.processed) ? "success" : "neutral"}
                value={Boolean(idea.processed) ? "processed" : "unprocessed"}
                onChange={(value) => void saveIdea(idea.id, { processed: value === "processed" })}
              />
            )
          }
        ]}
        footer={<AddRowButton label="添加想法" onClick={() => void addIdea()} />}
      />
    </section>
  );

  const heading = embedded
    ? <div className="section-heading"><h2>想法</h2><span className="page-meta">{loading ? "读取中…" : sortedIdeas.length + " 条未归档"}</span></div>
    : <PageHeader meta={loading ? "读取中…" : sortedIdeas.length + " 条未归档"} title="想法" />;

  const content = (
    <>
      {heading}
      {error ? <div className="notice error">{error}</div> : null}
      {table}
    </>
  );

  return embedded ? <section className="database-section ideas-database-section">{content}</section> : <div className="page-stack page-ideas">{content}</div>;
}

export function IdeasPage() {
  return <IdeasDatabase />;
}
