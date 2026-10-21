import { useEffect, useRef } from "react";

export function AutoGrowTextarea({
  value,
  placeholder,
  className = "",
  ariaLabel,
  onChange,
  onKeyDown,
  onBlur
}: {
  value: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur?: (event: React.FocusEvent<HTMLTextAreaElement>) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = (element = textareaRef.current) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => resize(), [value]);

  return (
    <textarea
      aria-label={ariaLabel}
      className={className}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      onInput={(event) => resize(event.currentTarget)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      ref={textareaRef}
      rows={1}
      value={value}
    />
  );
}
