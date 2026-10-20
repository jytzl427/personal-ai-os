import React from "react";

function renderInline(text: string): React.ReactNode[] {
  // Regex to split on bold, inline code, links, italic, strikethrough
  const tokens = text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|~~[^~]+~~|\*[^*]+\*)/g);
  return tokens.map((tok, idx) => {
    if (tok.startsWith("**") && tok.endsWith("**") && tok.length >= 4) {
      return <strong key={idx}>{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith("__") && tok.endsWith("__") && tok.length >= 4) {
      return <strong key={idx}>{tok.slice(2, -2)}</strong>;
    }
    if (tok.startsWith("`") && tok.endsWith("`") && tok.length >= 2) {
      return <code className="md-inline-code" key={idx}>{tok.slice(1, -1)}</code>;
    }
    if (tok.startsWith("[") && tok.includes("](") && tok.endsWith(")")) {
      const match = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (match) {
        return (
          <a className="md-link" href={match[2]} key={idx} rel="noopener noreferrer" target="_blank">
            {match[1]}
          </a>
        );
      }
    }
    if (tok.startsWith("~~") && tok.endsWith("~~") && tok.length >= 4) {
      return <del key={idx}>{tok.slice(2, -2)}</del>;
    }
    if (tok.startsWith("*") && tok.endsWith("*") && tok.length >= 2) {
      return <em key={idx}>{tok.slice(1, -1)}</em>;
    }
    return tok;
  });
}

export function MarkdownView({
  content,
  className = "",
  emptyPlaceholder = "暂无内容。点击“编辑 SOP”开始撰写。"
}: {
  content: string;
  className?: string;
  emptyPlaceholder?: string;
}) {
  if (!content.trim()) {
    return emptyPlaceholder ? <div className={`markdown-rendered is-empty ${className}`}>{emptyPlaceholder}</div> : null;
  }

  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = "";
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;

  function flushList() {
    if (!listBuffer) return;
    const ListTag = listBuffer.type;
    const key = `list-${elements.length}`;
    elements.push(
      <ListTag className="md-list" key={key}>
        {listBuffer.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ListTag>
    );
    listBuffer = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block toggle
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre className="md-code-block" key={`code-${elements.length}`}>
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        flushList();
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Horizontal Rule
    if (/^(\*\*\*|---|___)$/.test(line.trim())) {
      flushList();
      elements.push(<hr className="md-hr" key={`hr-${elements.length}`} />);
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      flushList();
      elements.push(<h2 className="md-h1" key={`h1-${elements.length}`}>{renderInline(line.slice(2))}</h2>);
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      elements.push(<h3 className="md-h2" key={`h2-${elements.length}`}>{renderInline(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      elements.push(<h4 className="md-h3" key={`h3-${elements.length}`}>{renderInline(line.slice(4))}</h4>);
      continue;
    }
    if (line.startsWith("#### ")) {
      flushList();
      elements.push(<h5 className="md-h4" key={`h4-${elements.length}`}>{renderInline(line.slice(5))}</h5>);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      flushList();
      elements.push(
        <blockquote className="md-blockquote" key={`quote-${elements.length}`}>
          {renderInline(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered List (- or *)
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch) {
      if (!listBuffer || listBuffer.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [ulMatch[1]] };
      } else {
        listBuffer.items.push(ulMatch[1]);
      }
      continue;
    }

    // Ordered List (1. , 2. )
    const olMatch = line.match(/^\d+\.\s+(.*)$/);
    if (olMatch) {
      if (!listBuffer || listBuffer.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [olMatch[1]] };
      } else {
        listBuffer.items.push(olMatch[1]);
      }
      continue;
    }

    // Blank line
    if (!line.trim()) {
      flushList();
      continue;
    }

    // Regular paragraph
    flushList();
    elements.push(
      <p className="md-paragraph" key={`p-${elements.length}`}>
        {renderInline(line)}
      </p>
    );
  }

  if (inCodeBlock && codeBuffer.length > 0) {
    elements.push(
      <pre className="md-code-block" key={`code-${elements.length}`}>
        <code>{codeBuffer.join("\n")}</code>
      </pre>
    );
  }
  flushList();

  return <div className={`markdown-rendered ${className}`}>{elements}</div>;
}
