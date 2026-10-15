import type { TagTone } from "./Tag.js";

export type PropertyOption = { value: string; label: string };

export function PropertySelect({
  value,
  options,
  tone,
  ariaLabel,
  onChange
}: {
  value: string | number;
  options: PropertyOption[];
  tone: TagTone;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`property-control property-${tone}`}>
      <select
        aria-label={ariaLabel}
        className="property-select"
        onChange={(event) => onChange(event.target.value)}
        value={String(value)}
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
