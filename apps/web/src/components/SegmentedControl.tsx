import { useEffect, useRef, useState } from "react";

export function SegmentedControl<Value extends string>({
  value,
  options,
  ariaLabel,
  onChange
}: {
  value: Value;
  options: Array<{ value: Value; label: string; count?: number }>;
  ariaLabel: string;
  onChange: (value: Value) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const activeEl = containerRef.current.querySelector<HTMLButtonElement>(`[data-value="${value}"]`);
    if (activeEl) {
      setIndicator({
        left: activeEl.offsetLeft,
        width: activeEl.offsetWidth,
        ready: true
      });
    }
  }, [value, options]);

  return (
    <div aria-label={ariaLabel} className="segmented" ref={containerRef} role="tablist">
      {indicator.ready ? (
        <div
          aria-hidden="true"
          className="segmented-indicator"
          style={{
            transform: `translateX(${indicator.left}px)`,
            width: `${indicator.width}px`
          }}
        />
      ) : null}
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            aria-selected={isActive}
            className={isActive ? "segmented-item is-active" : "segmented-item"}
            data-value={option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="tab"
            type="button"
          >
            <span className="segmented-label">{option.label}</span>
            {option.count !== undefined ? (
              <span className={isActive ? "segmented-count is-active" : "segmented-count"}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
