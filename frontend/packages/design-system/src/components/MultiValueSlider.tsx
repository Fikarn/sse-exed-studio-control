import { forwardRef, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { ScrubSlider } from "./ScrubSlider";

import styles from "./MultiValueSlider.module.css";

export interface MultiValueSliderProps {
  ariaLabel: string;
  /** Per-fixture current values. Average drives the displayed thumb; min/max
   *  drive the ghost markers. */
  values: readonly number[];
  min: number;
  max: number;
  step?: number;
  /** Called whenever the user shifts via slider drag, types a delta
   *  expression, or resets via dbl-click. Returns the per-value array
   *  with the same length and order as `values`. */
  onValuesChange: (next: number[]) => void;
  /** Optional commit callback (debounce-friendly). Receives the same array
   *  shape as `onValuesChange`. */
  onValuesCommit?: (next: number[]) => void;
  /** Reset target when user double-clicks the track. Applies to ALL values. */
  resetValue?: number;
  /** Disabled state. */
  disabled?: boolean;
  /** Display unit appended to the value text + delta-input placeholder hint. */
  unit?: string;
  /** Custom CSS class on the slider track (e.g. CCT gradient). */
  trackClassName?: string;
}

/**
 * Bulk-edit slider for heterogeneous selections (Figma multi-edit pattern).
 * Renders the average as the active thumb plus ghost markers at the
 * current min and max. Slider drag shifts every value by the same delta,
 * preserving the spread. The companion text input accepts:
 *
 *   `65`     → set every value to 65
 *   `+5`     → add 5 to every value
 *   `-10`    → subtract 10 from every value
 *   `+10%`   → add 10% of (max-min) to every value
 *   `-5%`    → subtract 5% of (max-min) from every value
 *
 * The text input also displays "Mixed (X–Y)" when values span a range, or
 * the single value when they don't.
 */
export const MultiValueSlider = forwardRef<HTMLDivElement, MultiValueSliderProps>(function MultiValueSlider(
  {
    ariaLabel,
    values,
    min,
    max,
    step = 1,
    onValuesChange,
    onValuesCommit,
    resetValue,
    disabled = false,
    unit = "",
    trackClassName,
  },
  ref
) {
  const summary = useMemo(() => {
    if (values.length === 0) return { avg: min, min: min, max: min, mixed: false };
    let sum = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      sum += v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const avg = Math.round(sum / values.length);
    return { avg, min: lo, max: hi, mixed: hi - lo > 0.5 };
  }, [values, min]);

  // Track the slider draft separately from the persisted summary average so
  // mid-drag changes to `values` don't fight the user's pointer position.
  const [draftAvg, setDraftAvg] = useState(summary.avg);
  useEffect(() => {
    setDraftAvg(summary.avg);
  }, [summary.avg]);

  const [draftDelta, setDraftDelta] = useState("");

  const clampOne = (v: number) => Math.max(min, Math.min(max, v));

  const applyDelta = (parsed: ParsedDelta) => {
    if (!parsed) return null;
    const range = max - min;
    return values.map((v) => {
      switch (parsed.kind) {
        case "absolute":
          return clampOne(parsed.value);
        case "delta":
          return clampOne(v + parsed.value);
        case "percent":
          return clampOne(v + (parsed.value / 100) * range);
      }
    });
  };

  const onSliderChange = (next: number) => {
    const delta = next - draftAvg;
    if (delta === 0) return;
    setDraftAvg(next);
    onValuesChange(values.map((v) => clampOne(v + delta)));
  };

  const onSliderCommit = (final: number) => {
    if (!onValuesCommit) return;
    const delta = final - summary.avg;
    onValuesCommit(values.map((v) => clampOne(v + delta)));
  };

  const onDeltaSubmit = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    const parsed = parseDeltaExpression(draftDelta);
    const nextValues = applyDelta(parsed);
    if (nextValues) {
      event.preventDefault();
      setDraftDelta("");
      onValuesChange(nextValues);
      onValuesCommit?.(nextValues);
    }
  };

  const displayText = summary.mixed
    ? `Mixed (${Math.round(summary.min)}–${Math.round(summary.max)}${unit})`
    : `${Math.round(summary.avg)}${unit}`;

  return (
    <div ref={ref} className={styles.wrapper}>
      <ScrubSlider
        ariaLabel={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={draftAvg}
        onChange={onSliderChange}
        onCommit={onSliderCommit}
        resetValue={resetValue}
        disabled={disabled}
        ghostMarkers={summary.mixed ? [summary.min, summary.max] : undefined}
        formatValue={() => displayText}
        trackClassName={trackClassName}
      />
      <input
        type="text"
        className={styles.deltaInput}
        placeholder={`+5 / -10 / 65${unit ? " / +10%" : ""}`}
        value={draftDelta}
        onChange={(event) => setDraftDelta(event.currentTarget.value)}
        onKeyDown={onDeltaSubmit}
        onBlur={() => setDraftDelta("")}
        aria-label={`${ariaLabel} delta expression`}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
});

type ParsedDelta = { kind: "absolute" | "delta" | "percent"; value: number } | null;

/**
 * Parse a delta-expression string to a tagged update.
 *
 *   "65"      → { kind: "absolute", value: 65 }
 *   "+5"      → { kind: "delta",    value: 5  }
 *   "-10"     → { kind: "delta",    value: -10 }
 *   "+10%"    → { kind: "percent",  value: 10 }
 *   "-5%"     → { kind: "percent",  value: -5 }
 *
 * Whitespace allowed at edges. Returns null on any malformed input.
 */
export function parseDeltaExpression(input: string): ParsedDelta {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const match = /^([+-]?)([0-9]+(?:\.[0-9]+)?)(%?)$/.exec(trimmed);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const magnitude = Number(match[2]);
  if (!Number.isFinite(magnitude)) return null;
  const value = sign * magnitude;
  if (match[3] === "%") return { kind: "percent", value };
  if (match[1] === "+" || match[1] === "-") return { kind: "delta", value };
  return { kind: "absolute", value: magnitude };
}
