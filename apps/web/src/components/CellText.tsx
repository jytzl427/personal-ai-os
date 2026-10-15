import { useEffect, useRef, useState } from "react";

export function CellText({
  value,
  placeholder,
  multiline = false,
  autoGrow = true,
  autoFocus = false,
  className = "",
  ariaLabel,
  onCommit
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
  autoGrow?: boolean;
  autoFocus?: boolean;
  className?: string;
  ariaLabel?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (!multiline || !autoGrow || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [autoGrow, draft, multiline]);
  const commit = () => onCommit(draft);
  const classNames = ["cell-input", multiline ? "memo-input" : "", className].filter(Boolean).join(" ");

  if (multiline) {
    return (
      <textarea
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className={classNames}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onInput={(event) => {
          if (!autoGrow) return;
          event.currentTarget.style.height = "auto";
          event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
          if (event.key === "Enter" && event.ctrlKey) event.currentTarget.blur();
        }}
        placeholder={placeholder}
        ref={textareaRef}
        rows={autoGrow ? 1 : undefined}
        value={draft}
      />
    );
  }

  return (
    <input
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      className={classNames}
      onBlur={commit}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      placeholder={placeholder}
      value={draft}
    />
  );
}
