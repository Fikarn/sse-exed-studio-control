import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import styles from "./ScrubSlider.module.css";

export type ScrubModifier = "fine" | "coarse" | "default";

export interface ScrubSliderProps {
  /** Required label for screen readers + the optional inline label slot. */
  ariaLabel: string;
  /** Renders inside the track to label the slider visually. */
  label?: ReactNode;
  /** Min value (inclusive). */
  min: number;
  /** Max value (inclusive). */
  max: number;
  /** Step size for keyboard nudges + pointer snap. Defaults to 1. */
  step?: number;
  /** Controlled current value. */
  value: number;
  /** Live updates as the user drags / types. Receives the snapped value. */
  onChange: (next: number) => void;
  /** Fires once when the user finishes a continuous interaction (pointerup,
   *  blur, Enter). Use for debounced/expensive commits. */
  onCommit?: (next: number) => void;
  /** When provided, double-clicking the track resets value to this and fires
   *  onChange + onCommit. Defaults disabled. */
  resetValue?: number;
  /** Disabled state. */
  disabled?: boolean;
  /** Extra class on the outer wrapper. */
  className?: string;
  /** Extra class on the track element. Useful for tone-specific styling
   *  (e.g. CCT gradient backgrounds). */
  trackClassName?: string;
  /** Optional content after the value display (e.g. a delta-input field). */
  valueSlot?: ReactNode;
  /** Custom value formatter. Receives the snapped value, returns the display
   *  string used in `aria-valuetext` + the on-screen value chip. */
  formatValue?: (value: number) => string;
  /** Visual ghost markers — used by MultiValueSlider to show min/max thumbs.
   *  Each entry is a value in [min, max]; rendered as a thin tick. */
  ghostMarkers?: readonly number[];
  /** Tab index for the slider's keyboard focus surface. Defaults to 0. */
  tabIndex?: number;
}

const DEFAULT_FORMAT = (value: number) => String(Math.round(value));

function modifierForEvent(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): ScrubModifier {
  if (event.shiftKey) return "fine";
  if (event.metaKey || event.ctrlKey) return "coarse";
  return "default";
}

function modifierFactor(modifier: ScrubModifier): number {
  switch (modifier) {
    case "fine":
      return 0.1;
    case "coarse":
      return 10;
    default:
      return 1;
  }
}

function snapToStep(value: number, step: number, min: number): number {
  if (step <= 0) return value;
  return Math.round((value - min) / step) * step + min;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startValue: number;
  trackWidthPx: number;
}

/**
 * Continuous numeric slider with pointer + keyboard input. Replaces native
 * `<input type="range">` with custom track + thumb so we can intercept the
 * pointer-delta calculation and apply fine/coarse modifiers — Figma /
 * Logic Pro convention: Shift = ×0.1 fine, Cmd/Ctrl = ×10 coarse, plain = ×1.
 *
 * Double-click resets to `resetValue` when provided. Keyboard nudges retain
 * native semantics (arrows, Home/End, PageUp/Down). ARIA shape mirrors
 * `role="slider"` requirements so screen readers announce the value range
 * + current value text.
 */
export const ScrubSlider = forwardRef<HTMLDivElement, ScrubSliderProps>(function ScrubSlider(
  {
    ariaLabel,
    label,
    min,
    max,
    step = 1,
    value,
    onChange,
    onCommit,
    resetValue,
    disabled = false,
    className,
    trackClassName,
    valueSlot,
    formatValue = DEFAULT_FORMAT,
    ghostMarkers,
    tabIndex = 0,
  },
  ref
) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  // RAF-throttled onChange dispatch. Pointer events on high-refresh displays
  // can fire at 200+ Hz; React re-renders cascade through the whole workspace
  // (all fixture markers, scene rail, inspector). Coalescing onChange to one
  // call per animation frame keeps the slider feel buttery without dropping
  // the user's final commit value.
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

  const valueText = formatValue(value);
  const fillPercent = max > min ? ((clampValue(value, min, max) - min) / (max - min)) * 100 : 0;

  const updateFromClientX = useCallback(
    (clientX: number, modifier: ScrubModifier) => {
      const drag = dragRef.current;
      if (!drag) return;
      const factor = modifierFactor(modifier);
      const dx = clientX - drag.startClientX;
      const range = max - min;
      const valueDelta = drag.trackWidthPx > 0 ? (dx / drag.trackWidthPx) * range * factor : 0;
      const next = clampValue(snapToStep(drag.startValue + valueDelta, step, min), min, max);
      if (next !== value) scheduleChange(next);
    },
    [max, min, scheduleChange, step, value]
  );

  const onTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      const track = trackRef.current;
      if (!track) return;
      event.preventDefault();
      track.setPointerCapture(event.pointerId);
      const rect = track.getBoundingClientRect();
      const range = max - min;
      // Click-to-jump: snap value to where the user clicked, then start drag
      // from there. Same affordance as native <input type="range">.
      const clickFraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
      const clickValue = clampValue(snapToStep(min + clickFraction * range, step, min), min, max);
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startValue: clickValue,
        trackWidthPx: rect.width,
      };
      setDragging(true);
      if (clickValue !== value) onChange(clickValue);
    },
    [disabled, max, min, onChange, step, value]
  );

  const onTrackPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      updateFromClientX(event.clientX, modifierForEvent(event));
    },
    [updateFromClientX]
  );

  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      trackRef.current?.releasePointerCapture(event.pointerId);
      dragRef.current = null;
      setDragging(false);
      // Flush any pending RAF-throttled value before commit so onCommit sees
      // the final pointer position even if the last pointermove hasn't
      // re-rendered yet.
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

  const onDoubleClick = useCallback(() => {
    if (disabled || resetValue === undefined) return;
    const next = clampValue(snapToStep(resetValue, step, min), min, max);
    if (next !== value) onChange(next);
    onCommit?.(next);
  }, [disabled, max, min, onChange, onCommit, resetValue, step, value]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      let next = value;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          next = value - step;
          break;
        case "ArrowRight":
        case "ArrowUp":
          next = value + step;
          break;
        case "PageDown":
          next = value - step * 10;
          break;
        case "PageUp":
          next = value + step * 10;
          break;
        case "Home":
          next = min;
          break;
        case "End":
          next = max;
          break;
        default:
          return;
      }
      event.preventDefault();
      next = clampValue(snapToStep(next, step, min), min, max);
      if (next !== value) {
        onChange(next);
        onCommit?.(next);
      }
    },
    [disabled, max, min, onChange, onCommit, step, value]
  );

  // Release the captured pointer if the component unmounts mid-drag — keeps
  // the browser from leaking pointer-capture state across hot-reloads.
  useEffect(() => {
    return () => {
      const drag = dragRef.current;
      if (drag && trackRef.current) {
        try {
          trackRef.current.releasePointerCapture(drag.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={ref}
      className={[styles.wrapper, disabled ? styles.wrapperDisabled : "", className ?? ""].filter(Boolean).join(" ")}
    >
      <div
        ref={trackRef}
        className={[styles.track, dragging ? styles.trackDragging : "", trackClassName ?? ""].filter(Boolean).join(" ")}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : tabIndex}
        onPointerDown={onTrackPointerDown}
        onPointerMove={onTrackPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <div className={styles.fill} style={{ width: `${fillPercent}%` }} />
        {ghostMarkers?.map((markerValue, index) => {
          const fraction = max > min ? clampValue((markerValue - min) / (max - min), 0, 1) : 0;
          const markerStyle: CSSProperties = { left: `${fraction * 100}%` };
          return <span key={`ghost-${index}`} className={styles.ghost} style={markerStyle} aria-hidden="true" />;
        })}
        <span
          className={styles.thumb}
          style={{ left: `${fillPercent}%` }}
          aria-hidden="true"
          data-dragging={dragging || undefined}
        />
        {label ? <span className={styles.trackLabel}>{label}</span> : null}
      </div>
      <span className={styles.valueText} aria-hidden="true">
        {valueText}
      </span>
      {valueSlot}
    </div>
  );
});
