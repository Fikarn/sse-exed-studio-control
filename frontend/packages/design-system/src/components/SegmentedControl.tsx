import type { KeyboardEvent } from "react";

import styles from "./SegmentedControl.module.css";

export interface SegmentedControlOption {
  disabled?: boolean;
  label: string;
  value: string;
}

export interface SegmentedControlProps {
  label: string;
  onChange: (value: string) => void;
  options: SegmentedControlOption[];
  size?: "regular" | "compact";
  value: string;
}

function enabledOptions(options: SegmentedControlOption[]) {
  return options.filter((option) => !option.disabled);
}

export function SegmentedControl({ label, onChange, options, size = "regular", value }: SegmentedControlProps) {
  const enabled = enabledOptions(options);
  const focusableValue = enabled.some((option) => option.value === value) ? value : enabled[0]?.value;

  const moveSelection = (
    event: KeyboardEvent<HTMLButtonElement>,
    direction: "next" | "previous" | "first" | "last"
  ) => {
    if (enabled.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      enabled.findIndex((option) => option.value === value)
    );
    let nextIndex = currentIndex;

    if (direction === "next") {
      nextIndex = (currentIndex + 1) % enabled.length;
    } else if (direction === "previous") {
      nextIndex = (currentIndex - 1 + enabled.length) % enabled.length;
    } else if (direction === "first") {
      nextIndex = 0;
    } else {
      nextIndex = enabled.length - 1;
    }

    event.preventDefault();
    onChange(enabled[nextIndex]!.value);
  };

  return (
    <div aria-label={label} className={[styles.control, styles[size]].join(" ")} role="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            aria-checked={selected}
            className={styles.segment}
            disabled={option.disabled}
            key={option.value}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                moveSelection(event, "next");
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                moveSelection(event, "previous");
              } else if (event.key === "Home") {
                moveSelection(event, "first");
              } else if (event.key === "End") {
                moveSelection(event, "last");
              }
            }}
            role="radio"
            tabIndex={option.value === focusableValue ? 0 : -1}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
