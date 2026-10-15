import { useEffect, useState } from "react";

export function MoneyCell({
  value,
  ariaLabel,
  allowZero = false,
  onCommit
}: {
  value: number;
  ariaLabel?: string;
  allowZero?: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState((value / 100).toFixed(2));
  useEffect(() => setDraft((value / 100).toFixed(2)), [value]);

  return (
    <input
      aria-label={ariaLabel}
      className="money-edit"
      inputMode="decimal"
      onBlur={() => {
        const cents = Math.round(Number(draft) * 100);
        const valid = Number.isInteger(cents) && (allowZero ? cents >= 0 : cents > 0);
        if (valid) onCommit(cents);
        else setDraft((value / 100).toFixed(2));
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft((value / 100).toFixed(2));
          event.currentTarget.blur();
        }
      }}
      value={draft}
    />
  );
}
