import React from "react";

function cleanLatexArrows(str: string): string {
  return str
    .replace(/\$\\to\$/g, "→")
    .replace(/\$\s*o\s*\$/g, "→")
    .replace(/\\to\b/g, "→");
}

function renderInline(text: string): React.ReactNode[] {
  const sanitized = cleanLatexArrows(text);
  // Regex to split on bold, inline code, links, italic, strikethrough
  const tokens = sanitized.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\)|~~[^~]+~~|\*[^*]+\*)/g);
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
      if (match && match[1] && match[2]) {
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

function splitTableRow(line: string): string[] {
  let content = line.trim();
  if (content.startsWith("|")) content = content.slice(1);
  if (content.endsWith("|")) content = content.slice(0, -1);
  return content.split("|").map(c => c.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line.trim());
}

function parseTableAlignments(sepLine: string): Array<"left" | "center" | "right"> {
  const cells = splitTableRow(sepLine);
  return cells.map(cell => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return "left";
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

  const sanitized = cleanLatexArrows(content);
  const lines = sanitized.replace(/\r\n/g, "\n").split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBuffer: string[] = [];
  let codeLang = "";
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;
  let quoteBuffer: string[] = [];

  function flushList() {
    if (!listBuffer) return;
    const ListTag = listBuffer.type;
    const key = `list-${elements.length}`;
    elements.push(
      <ListTag className="md-list" key={key}>
        {listBuffer.items.map((item, i) => {
          const isTaskUnchecked = item.startsWith("[ ] ");
          const isTaskChecked = item.startsWith("[x] ") || item.startsWith("[X] ");
          if (isTaskUnchecked || isTaskChecked) {
            return (
              <li className="md-task-item" key={i}>
                <input
                  type="checkbox"
                  checked={isTaskChecked}
                  readOnly
                  className="md-task-checkbox"
                />
                <span>{renderInline(item.slice(4))}</span>
              </li>
            );
          }
          return <li key={i}>{renderInline(item)}</li>;
        })}
      </ListTag>
    );
    listBuffer = null;
  }

  function flushQuote() {
    if (quoteBuffer.length === 0) return;
    const key = `quote-${elements.length}`;
    elements.push(
      <blockquote className="md-blockquote" key={key}>
        {quoteBuffer.map((qLine, qIdx) => (
          <p className="md-quote-p" key={qIdx}>
            {renderInline(qLine)}
          </p>
        ))}
      </blockquote>
    );
    quoteBuffer = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // Fenced code block toggle
    if (line.trim().startsWith("```")) {
      flushList();
      flushQuote();
      if (inCodeBlock) {
        elements.push(
          <pre className="md-code-block" key={`code-${elements.length}`}>
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Markdown Table detection: current line has '|' and next line is table separator
    const nextLine = lines[i + 1];
    if (line.includes("|") && nextLine !== undefined && isTableSeparator(nextLine)) {
      flushList();
      flushQuote();
      const headers = splitTableRow(line);
      const alignments = parseTableAlignments(nextLine);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const curLine = lines[i];
        if (curLine === undefined || !curLine.trim().includes("|") || curLine.trim() === "") {
          break;
        }
        rows.push(splitTableRow(curLine));
        i++;
      }
      i--; // Rewind one step so outer loop advances correctly
      elements.push(
        <div className="md-table-wrapper" key={`table-${elements.length}`}>
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx} style={{ textAlign: alignments[hIdx] ?? "left" }}>
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} style={{ textAlign: alignments[cIdx] ?? "left" }}>
                      {renderInline(cell ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Horizontal Rule
    if (/^(\*\*\*|---|___)$/.test(line.trim())) {
      flushList();
      flushQuote();
      elements.push(<hr className="md-hr" key={`hr-${elements.length}`} />);
      continue;
    }

    // Headings
    if (line.startsWith("# ")) {
      flushList();
      flushQuote();
      elements.push(<h2 className="md-h1" key={`h1-${elements.length}`}>{renderInline(line.slice(2))}</h2>);
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      flushQuote();
      elements.push(<h3 className="md-h2" key={`h2-${elements.length}`}>{renderInline(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      flushQuote();
      elements.push(<h4 className="md-h3" key={`h3-${elements.length}`}>{renderInline(line.slice(4))}</h4>);
      continue;
    }
    if (line.startsWith("#### ")) {
      flushList();
      flushQuote();
      elements.push(<h5 className="md-h4" key={`h4-${elements.length}`}>{renderInline(line.slice(5))}</h5>);
      continue;
    }

    // Blockquote
    if (line.startsWith("> ") || line.trim() === ">") {
      flushList();
      quoteBuffer.push(line.startsWith("> ") ? line.slice(2) : "");
      continue;
    } else {
      flushQuote();
    }

    // Unordered List (- or *)
    const ulMatch = line.match(/^[-*]\s+(.*)$/);
    if (ulMatch && ulMatch[1] !== undefined) {
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
    if (olMatch && olMatch[1] !== undefined) {
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
      flushQuote();
      continue;
    }

    // Regular paragraph
    flushList();
    flushQuote();
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
  flushQuote();

  return <div className={`markdown-rendered ${className}`}>{elements}</div>;
}
