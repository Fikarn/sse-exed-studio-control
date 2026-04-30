import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
  /** Step per pixel of horizontal drag at the default modifier (Logic Pro
   *  convention is ~0.1 unit per px). Defaults to 0.1. */
  pixelsPerStep?: number;
  /** Snap step. Defaults to the same as `pixelsPerStep`. */
  step?: number;
  /** Disabled state. */
  disabled?: boolean;
  /** Extra class on the root span. */
  className?: string;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startValue: number;
}

function modifierFactor(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): number {
  if (event.shiftKey) return 0.1;
  if (event.metaKey || event.ctrlKey) return 10;
  return 1;
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

/**
 * Drag-horizontal scrub on a label, paired with an editable text input.
 * Logic Pro / Figma idiom — the label becomes a "scrubber" that nudges
 * the value while still allowing keyboard editing of the input itself.
 *
 * Modifiers (mid-drag): Shift = ×0.1 fine, Cmd/Ctrl = ×10 coarse, plain = ×1.
 *
 * Use inside a `<label>` alongside the matching `<input>`:
 *
 *   <label>
 *     <ScrubLabel value={x} onChange={setX} min={0} max={12}>Stage X (m)</ScrubLabel>
 *     <input value={x} ... />
 *   </label>
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
  disabled = false,
  className,
}: ScrubLabelProps) {
  const dragRef = useRef<DragState | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const effectiveStep = step ?? pixelsPerStep;
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

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startValue: value,
      };
      setScrubbing(true);
    },
    [disabled, value]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startClientX;
      const factor = modifierFactor(event);
      const next = clampValue(snapToStep(drag.startValue + dx * pixelsPerStep * factor, effectiveStep), min, max);
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
      role="presentation"
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
