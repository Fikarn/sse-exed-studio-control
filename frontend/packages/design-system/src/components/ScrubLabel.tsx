import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import styles from "./ScrubLabel.module.css";

export interface ScrubLabelProps {
  /** Label text (or any node — usually the field name + units). */
  children: ReactNode;
  /** Current numeric value. */
  value: number;
  /** Live update callback; receives the snapped, clamped value. */
  onChange: (next: number) => void;
  /** Optional commit callback fired on pointerup. Use for debounced/expensive
   *  IPCs. */
  onCommit?: (next: number) => void;
  /** Min / max clamps. */
  min?: number;
  max?: number;
  /** Value per pixel of horizontal drag (Logic Pro convention is ~0.1 unit per
   *  px). Defaults to 0.1. */
  pixelsPerStep?: number;
  /** Snap step. Defaults to the same as `pixelsPerStep`. */
  step?: number;
  /** Reset target. A plain double-click (the 360ms time-based guard) resets to
   *  this value. Because the paired `<input>`, not the label, owns typed entry,
   *  the label has no typed-entry gesture to reserve, so a plain double-click
   *  resets (matching ScrubSlider's no-typed-entry fallback). Unset = no reset
   *  gesture. */
  resetValue?: number;
  /** Disabled state. */
  disabled?: boolean;
  /** Accessible name for the `role="slider"` element. Required in practice
   *  because `children` is arbitrary node content, not a string. Keep it short
   *  and distinct from the paired `<input>`'s label so screen readers announce
   *  two affordances (nudge vs typed entry), not the same name twice. */
  ariaLabel?: string;
  /** Formats the numeric value for `aria-valuetext`. Pass the same formatter the
   *  paired `<input>` displays so the slider announces the on-screen string. */
  formatValue?: (value: number) => string;
  /** Tab order for the slider. Defaults to 0. */
  tabIndex?: number;
  /** Extra class on the root span. */
  className?: string;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startValue: number;
}

function clampValue(value: number, min: number | undefined, max: number | undefined): number {
  if (min !== undefined && value < min) return min;
  if (max !== undefined && value > max) return max;
  return value;
}

function snapToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

const DEFAULT_FORMAT = (value: number): string => String(value);

/**
 * Drag-horizontal scrub on a label, paired with an editable text input.
 * Logic Pro / Figma idiom — the label becomes a "scrubber" that nudges
 * the value while still allowing keyboard editing of the input itself.
 *
 * CONTROLS-06: exposes `role="slider"` with arrow / Home / End / PageUp-Down
 * keyboard nudges (raw step, so the result always lands on the snap grid). The
 * paired input remains the typed-entry surface; give the slider a distinct
 * `ariaLabel` so the two announce as separate affordances rather than
 * double-reading the value.
 *
 * New pages program, Slice 3 (decisions 8–10): no key held while dragging
 * changes the scrub rate, and no key reads Shift, Ctrl or Alt — the fine and
 * coarse scrubs and the Backspace / Delete reset are gone.
 *
 * Reset (LGS-06, when `resetValue` is set): a plain double-click on the label
 * (360ms guard), or type the value in the paired input.
 *
 * Pair with a matching `<input>` inside a plain wrapper — NOT a `<label>`, since
 * a focusable `role="slider"` is interactive content and must not live inside a
 * label. Give the input its own `aria-label`:
 *
 *   <div>
 *     <ScrubLabel value={x} onChange={setX} min={0} max={12} ariaLabel="Stage X">Stage X (m)</ScrubLabel>
 *     <input aria-label="Stage X position in metres" value={x} ... />
 *   </div>
 */
export function ScrubLabel({
  children,
  value,
  onChange,
  onCommit,
  min,
  max,
  pixelsPerStep = 0.1,
  step,
  resetValue,
  disabled = false,
  ariaLabel,
  formatValue = DEFAULT_FORMAT,
  tabIndex = 0,
  className,
}: ScrubLabelProps) {
  const dragRef = useRef<DragState | null>(null);
  const lastPointerDownAtRef = useRef(Number.NEGATIVE_INFINITY);
  const [scrubbing, setScrubbing] = useState(false);
  const effectiveStep = step ?? pixelsPerStep;
  const valueText = formatValue(value);
  // RAF-throttled onChange (same pattern as ScrubSlider). Coalesces high-rate
  // pointer events into one React update per animation frame.
  const pendingValueRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (pendingValueRef.current === null) return;
    const next = pendingValueRef.current;
    pendingValueRef.current = null;
    onChange(next);
  }, [onChange]);
  const scheduleChange = useCallback(
    (next: number) => {
      pendingValueRef.current = next;
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flushPending);
      }
    },
    [flushPending]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const resetToValue = useCallback(() => {
    if (disabled || resetValue === undefined) return;
    const next = clampValue(snapToStep(resetValue, effectiveStep), min, max);
    if (next !== value) onChange(next);
    onCommit?.(next);
  }, [disabled, effectiveStep, max, min, onChange, onCommit, resetValue, value]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (disabled || event.button !== 0) return;
      // Double-tap reset (mirrors ScrubSlider/AudioSliderControl's 360ms guard).
      // The label has no typed-entry path of its own, so a bare double-click
      // resets — matching ScrubSlider's no-typed-entry fallback.
      const now = performance.now();
      if (resetValue !== undefined && now - lastPointerDownAtRef.current <= 360) {
        lastPointerDownAtRef.current = Number.NEGATIVE_INFINITY;
        event.preventDefault();
        resetToValue();
        return;
      }
      lastPointerDownAtRef.current = now;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startValue: value,
      };
      setScrubbing(true);
    },
    [disabled, resetToValue, resetValue, value]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startClientX;
      const next = clampValue(snapToStep(drag.startValue + dx * pixelsPerStep, effectiveStep), min, max);
      if (next !== value) scheduleChange(next);
    },
    [effectiveStep, max, min, pixelsPerStep, scheduleChange, value]
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.currentTarget.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setScrubbing(false);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const finalValue = pendingValueRef.current ?? value;
      pendingValueRef.current = null;
      if (finalValue !== value) onChange(finalValue);
      onCommit?.(finalValue);
    },
    [onChange, onCommit, value]
  );

  // Keyboard nudge mirrors ScrubSlider (decision 9): the arrows move one RAW
  // step, Page Up / Page Down ten, Home and End go to the ends, so the result
  // always lands on the snap grid; nothing reads Shift, Ctrl or Alt. onCommit
  // fires per committed key like finishDrag does on pointerup.
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLSpanElement>) => {
      if (disabled) return;
      let next: number;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = value - effectiveStep;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = value + effectiveStep;
          break;
        case "PageDown":
          next = value - effectiveStep * 10;
          break;
        case "PageUp":
          next = value + effectiveStep * 10;
          break;
        case "Home":
          if (min === undefined) return;
          next = min;
          break;
        case "End":
          if (max === undefined) return;
          next = max;
          break;
        default:
          return;
      }
      event.preventDefault();
      next = clampValue(snapToStep(next, effectiveStep), min, max);
      if (next !== value) {
        onChange(next);
        onCommit?.(next);
      }
    },
    [disabled, effectiveStep, max, min, onChange, onCommit, value]
  );

  return (
    <span
      className={[
        styles.label,
        scrubbing ? styles.labelScrubbing : "",
        disabled ? styles.labelDisabled : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : tabIndex}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      title={disabled ? undefined : "Drag horizontally to scrub"}
    >
      {children}
    </span>
  );
}
