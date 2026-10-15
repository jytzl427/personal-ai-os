import { useEffect, useRef, useState } from "react";
export type TaskBlockType = "paragraph" | "heading1" | "heading2" | "todo" | "bullet" | "numbered" | "quote" | "divider";
export type TaskBlock = { id: string; type: TaskBlockType; text: string; checked?: boolean };
type BlockCommand = { label: string; description: string; type: Exclude<TaskBlockType, "divider"> };

const BLOCK_COMMANDS: BlockCommand[] = [
  { label: "待办事项", description: "插入可勾选的待办项", type: "todo" },
  { label: "普通文本", description: "插入普通文本", type: "paragraph" },
  { label: "一级标题", description: "插入一级标题", type: "heading1" },
  { label: "二级标题", description: "插入二级标题", type: "heading2" },
  { label: "无序列表", description: "插入无序列表项", type: "bullet" },
  { label: "有序列表", description: "插入有序列表项", type: "numbered" },
  { label: "引用", description: "插入引用内容", type: "quote" }
];

function newBlock(type: TaskBlockType = "paragraph", text = ""): TaskBlock {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, type, text, checked: type === "todo" ? false : undefined };
}

export function parseTaskBlocks(value: string): TaskBlock[] {
  try {
    const parsed = JSON.parse(value) as { version?: number; blocks?: Array<Partial<TaskBlock>> };
    if (parsed?.version === 1 && Array.isArray(parsed.blocks)) {
      const blocks = parsed.blocks.flatMap((block) => {
        if (!block || typeof block.id !== "string" || typeof block.text !== "string") return [];
        const type = ["paragraph", "heading1", "heading2", "todo", "bullet", "numbered", "quote", "divider"].includes(String(block.type)) ? block.type as TaskBlockType : "paragraph";
        return [{ id: block.id, type, text: block.text, checked: type === "todo" ? block.checked === true : undefined }];
      });
      if (blocks.length) return blocks;
    }
  } catch {
    // Existing tasks may still contain plain text.
  }
  const lines = value ? value.split(/\r?\n/) : [""];
  return lines.map((line) => {
    const trimmed = line.trim();
    if (/^[-*_]{3,}$/.test(trimmed)) return newBlock("divider");
    if (line.startsWith("# ")) return newBlock("heading1", line.slice(2));
    if (line.startsWith("## ")) return newBlock("heading2", line.slice(3));
    if (line.startsWith("### ")) return newBlock("heading2", line.slice(4));
    if (line.startsWith("#### ")) return newBlock("heading2", line.slice(5));
    if (line.startsWith("> ")) return newBlock("quote", line.slice(2));
    if (/^\d+\.\s+/.test(line)) return newBlock("numbered", line.replace(/^\d+\.\s+/, ""));
    if (line.startsWith("- [ ] ") || line.startsWith("- [x] ")) return newBlock("todo", line.slice(6));
    if (line.startsWith("- ")) return newBlock("bullet", line.slice(2));
    return newBlock("paragraph", line);
  });
}

function serializeTaskBlocks(blocks: TaskBlock[]): string {
  return JSON.stringify({ version: 1, blocks: blocks.map(({ id, type, text, checked }) => ({ id, type, text, ...(type === "todo" ? { checked: Boolean(checked) } : {}) })) });
}

export function RichTextBlockEditor({ value, onChange, blockAriaLabel = "内容块" }: { value: string; onChange: (value: string) => void; blockAriaLabel?: string }) {
  const [blocks, setBlocks] = useState<TaskBlock[]>(() => parseTaskBlocks(value));
  const [slash, setSlash] = useState<{ blockId: string; start: number; end: number; query: string } | null>(null);
  const [activeCommand, setActiveCommand] = useState(0);
  const textareas = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const serializedRef = useRef(value);
  const matches = BLOCK_COMMANDS.filter((command) => command.label.includes(slash?.query ?? ""));

  useEffect(() => {
    if (value !== serializedRef.current) {
      setBlocks(parseTaskBlocks(value));
      serializedRef.current = value;
    }
  }, [value]);

  useEffect(() => {
    function closeSlashMenu(event: PointerEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".slash-menu")) return;
      setSlash(null);
    }
    document.addEventListener("pointerdown", closeSlashMenu);
    return () => document.removeEventListener("pointerdown", closeSlashMenu);
  }, []);

  function commit(nextBlocks: TaskBlock[]) {
    setBlocks(nextBlocks);
    const serialized = serializeTaskBlocks(nextBlocks);
    serializedRef.current = serialized;
    onChange(serialized);
  }

  function resize(element: HTMLTextAreaElement | null) {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(28, element.scrollHeight)}px`;
  }

  function inspectSlash(blockId: string, text: string, cursor: number) {
    const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
    const line = text.slice(lineStart, cursor);
    const slashIndex = line.lastIndexOf("/");
    if (slashIndex < 0 || (slashIndex > 0 && !/\s/.test(line[slashIndex - 1] ?? ""))) {
      setSlash(null);
      return;
    }
    const query = line.slice(slashIndex + 1);
    if (/\s/.test(query)) {
      setSlash(null);
      return;
    }
    setActiveCommand(0);
    setSlash({ blockId, start: lineStart + slashIndex, end: cursor, query });
  }

  function updateBlock(blockId: string, text: string, cursor: number) {
    commit(blocks.map((block) => block.id === blockId ? { ...block, text } : block));
    inspectSlash(blockId, text, cursor);
  }

  function splitBlock(block: TaskBlock, index: number, element: HTMLTextAreaElement) {
    const cursor = element.selectionStart ?? block.text.length;
    const left = block.text.slice(0, cursor);
    const right = block.text.slice(cursor);
    const nextBlock = newBlock(block.type, right);
    const nextBlocks = [...blocks.slice(0, index), { ...block, text: left }, nextBlock, ...blocks.slice(index + 1)];
    commit(nextBlocks);
    setSlash(null);
    window.requestAnimationFrame(() => textareas.current[nextBlock.id]?.focus());
  }

  function removeEmptyBlock(block: TaskBlock, index: number) {
    if (block.text.trim() !== "") return false;
    const nextBlocks = blocks.length === 1 ? [newBlock("paragraph")] : blocks.filter((item) => item.id !== block.id);
    const focusBlock = nextBlocks[Math.max(0, index - 1)] ?? nextBlocks[0];
    commit(nextBlocks);
    setSlash(null);
    window.requestAnimationFrame(() => focusBlock && textareas.current[focusBlock.id]?.focus());
    return true;
  }

  function insertCommand(command: BlockCommand) {
    if (!slash) return;
    const blockIndex = blocks.findIndex((block) => block.id === slash.blockId);
    const block = blocks[blockIndex];
    if (!block) return;
    const text = block.text.slice(0, slash.start) + block.text.slice(slash.end);
    const nextBlock = { ...block, type: command.type, text, checked: command.type === "todo" ? false : undefined };
    commit(blocks.map((item) => item.id === block.id ? nextBlock : item));
    const nextCursor = slash.start;
    setSlash(null);
    window.requestAnimationFrame(() => {
      const element = textareas.current[block.id];
      element?.focus();
      element?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function setChecked(blockId: string, checked: boolean) {
    commit(blocks.map((block) => block.id === blockId ? { ...block, checked } : block));
  }

  return (
    <div className="task-block-editor">
      {blocks.map((block, index) => block.type === "divider" ? <div className="task-block-divider" key={block.id} /> : <div className={`task-block task-block-${block.type}`} key={block.id}>
        {block.type === "todo" ? <input aria-label="完成待办事项" checked={Boolean(block.checked)} className="task-block-checkbox" onChange={(event) => setChecked(block.id, event.target.checked)} type="checkbox" /> : null}
        {block.type === "bullet" ? <span className="task-block-marker">•</span> : null}
        {block.type === "numbered" ? <span className="task-block-marker">{index + 1}.</span> : null}
        <textarea
          aria-label={blockAriaLabel}
          className="task-block-input"
          onChange={(event) => updateBlock(block.id, event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onFocus={(event) => { setSlash(null); resize(event.currentTarget); }}
          onInput={(event) => resize(event.currentTarget)}
          onKeyDown={(event) => {
            if (slash && slash.blockId === block.id && matches.length) {
              if (event.key === "ArrowDown") { event.preventDefault(); setActiveCommand((current) => (current + 1) % matches.length); return; }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveCommand((current) => (current - 1 + matches.length) % matches.length); return; }
              if (event.key === "Enter") { event.preventDefault(); insertCommand(matches[activeCommand] ?? matches[0]!); return; }
              if (event.key === "Escape") { event.preventDefault(); setSlash(null); return; }
            }
            if (event.key === "Backspace" && (event.currentTarget.selectionStart ?? 0) === 0 && (event.currentTarget.selectionEnd ?? 0) === 0 && removeEmptyBlock(block, index)) { event.preventDefault(); return; }
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); splitBlock(block, index, event.currentTarget); }
          }}
          ref={(element) => { textareas.current[block.id] = element; resize(element); }}
          rows={1}
          value={block.text}
        />
      </div>)}
      {slash && matches.length ? <div className="slash-menu task-block-slash-menu" role="listbox">
        {matches.map((command, index) => <button aria-selected={index === activeCommand} className={index === activeCommand ? "slash-menu-item is-active" : "slash-menu-item"} key={command.label} onClick={() => insertCommand(command)} onMouseDown={(event) => event.preventDefault()} role="option" type="button"><strong>{command.label}</strong><span>{command.description}</span></button>)}
      </div> : null}
    </div>
  );
}


export function richTextToPlainText(value: string): string {
  return parseTaskBlocks(value)
    .filter((block) => block.type !== "divider")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join(" ");
}
