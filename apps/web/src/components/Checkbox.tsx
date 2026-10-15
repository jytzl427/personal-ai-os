export function Checkbox({
  checked,
  ariaLabel,
  onChange,
  disabled = false
}: {
  checked: boolean;
  ariaLabel: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <input
      aria-label={ariaLabel}
      checked={checked}
      className="ui-checkbox"
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      type="checkbox"
    />
  );
}
