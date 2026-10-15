export function SegmentedControl<Value extends string>({
  value,
  options,
  ariaLabel,
  onChange
}: {
  value: Value;
  options: Array<{ value: Value; label: string }>;
  ariaLabel: string;
  onChange: (value: Value) => void;
}) {
  return (
    <div aria-label={ariaLabel} className="segmented" role="tablist">
      {options.map((option) => (
        <button
          aria-selected={option.value === value}
          className={option.value === value ? "segmented-item is-active" : "segmented-item"}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="tab"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
