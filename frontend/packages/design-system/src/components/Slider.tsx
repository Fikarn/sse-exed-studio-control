import { useCallback, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import styles from "./Slider.module.css";

// Visual overhaul A, Slice 3 (system §7, product brief §5 "continuous"): a
// horizontal Slider and a vertical Groove, both wells with a cap that rides
// the whole target column (the probe lesson: the pointer target is the full
// column the cap rides in, so the cap never leaves it). Drag, wheel, arrow
// keys (Shift ×5), Home / End; the host owns commit-on-release and typed
// entry. A locked slider keeps its geometry and loses its fill; a doubted
// value carries a dashed amber keyline.

export interface SliderBaseProps {
  /** 0..1 position. */
  value: number;
  onChange?: (value: number) => void;
  /** Called on pointer-up / key-up with the final value. */
  onCommit?: (value: number) => void;
  /** Where the unity notch sits, 0..1; omit for none. */
  unity?: number;
  /** Arrow step, 0..1 (default 0.01); Shift multiplies by 5. */
  step?: number;
  locked?: boolean;
  doubt?: boolean;
  /** A take-time control. */
  take?: boolean;
  label: string;
  /** Printed as aria-valuetext (`-3.8 dB`). */
  valueText?: string;
  /**
   * The host's typed entry: a double-click or Enter asks for it. The desk's
   * faders are set by number as often as by hand, so the ask lives on the
   * control and the dialog lives with the host that knows the units.
   */
  onRequestTypedEntry?: () => void;
  /**
   * Unity discipline (the Console's faders): Shift + press jumps to unity, and
   * a value that lands within `unitySnap` of it settles on it exactly.
   */
  snapUnity?: boolean;
  /** How close a drag must land to unity to settle on it (0..1). */
  unitySnap?: number;
  testId?: string;
  className?: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function useSliderInteraction(
  props: SliderBaseProps,
  fractionFromPointer: (element: HTMLElement, event: PointerEvent<HTMLElement>) => number
) {
  const {
    value,
    onChange,
    onCommit,
    onRequestTypedEntry,
    step = 0.01,
    locked,
    snapUnity,
    unity = 0.8172,
    unitySnap = 0.015,
  } = props;
  const dragging = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  // A drag that lands beside unity settles on it, so the operator can put a
  // fader back to unity by hand without reading the number.
  const settle = useCallback(
    (fraction: number) => {
      const clamped = clamp01(fraction);
      if (!snapUnity) return clamped;
      return Math.abs(clamped - unity) < unitySnap ? unity : clamped;
    },
    [snapUnity, unity, unitySnap]
  );

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (locked || event.button !== 0) return;
      if (onRequestTypedEntry && event.detail >= 2) {
        event.preventDefault();
        onRequestTypedEntry();
        return;
      }
      if (snapUnity && event.shiftKey) {
        event.preventDefault();
        latest.current = unity;
        onChange?.(unity);
        onCommit?.(unity);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragging.current = true;
      const next = settle(fractionFromPointer(event.currentTarget, event));
      latest.current = next;
      onChange?.(next);
    },
    [fractionFromPointer, locked, onChange, onCommit, onRequestTypedEntry, settle, snapUnity, unity]
  );
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      const next = settle(fractionFromPointer(event.currentTarget, event));
      latest.current = next;
      onChange?.(next);
    },
    [fractionFromPointer, onChange, settle]
  );
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!dragging.current) return;
      dragging.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      onCommit?.(latest.current);
    },
    [onCommit]
  );
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (locked) return;
      if (event.key === "Enter" && onRequestTypedEntry) {
        event.preventDefault();
        onRequestTypedEntry();
        return;
      }
      const delta = step * (event.shiftKey ? 5 : 1);
      let next: number | null = null;
      if (event.key === "ArrowUp" || event.key === "ArrowRight") next = value + delta;
      else if (event.key === "ArrowDown" || event.key === "ArrowLeft") next = value - delta;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = 1;
      if (next === null) return;
      event.preventDefault();
      const clamped = clamp01(next);
      onChange?.(clamped);
      onCommit?.(clamped);
    },
    [locked, onChange, onCommit, onRequestTypedEntry, step, value]
  );
  return { onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}

function ariaProps(props: SliderBaseProps, orientation: "vertical" | "horizontal") {
  return {
    role: "slider" as const,
    "aria-label": props.label,
    "aria-orientation": orientation,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": Math.round(clamp01(props.value) * 100),
    "aria-valuetext": props.valueText,
    "aria-disabled": props.locked ? ("true" as const) : undefined,
    tabIndex: props.locked ? -1 : 0,
  };
}

export interface SliderProps extends SliderBaseProps {
  /** The colour-temperature track: the one other gradient that is information. */
  cct?: boolean;
}

export function Slider(props: SliderProps) {
  const { value, unity, locked, doubt, take, cct, testId, className } = props;
  const handlers = useSliderInteraction(props, (element, event) => {
    const rect = element.getBoundingClientRect();
    const inset = 17;
    return (event.clientX - rect.left - inset) / Math.max(1, rect.width - inset * 2);
  });
  return (
    <div
      className={[
        styles.slider,
        cct ? styles.cct : "",
        locked ? styles.locked : "",
        doubt ? styles.doubt : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-well=""
      data-take={take ? "" : undefined}
      data-locked={locked ? "" : undefined}
      data-doubt={doubt ? "" : undefined}
      data-testid={testId}
      style={
        {
          "--slider-value": String(clamp01(value)),
          "--slider-unity": unity === undefined ? undefined : String(unity),
        } as CSSProperties
      }
      {...ariaProps(props, "horizontal")}
      {...handlers}
    >
      <span className={styles.track} data-signal={cct ? "cct" : undefined} aria-hidden="true" />
      {unity !== undefined ? <span className={styles.unity} aria-hidden="true" /> : null}
      <span className={styles.cap} data-material="cap" aria-hidden="true" />
    </div>
  );
}

export interface GrooveProps extends SliderBaseProps {
  /** The travel height; the groove fills its host when omitted. */
  height?: number;
}

// The vertical fader: a 44 px target column with an 18 px slot and the cap.
export function Groove(props: GrooveProps) {
  const { value, unity = 0.8172, locked, doubt, take, height, testId, className } = props;
  const handlers = useSliderInteraction(props, (element, event) => {
    const rect = element.getBoundingClientRect();
    const inset = 14;
    return 1 - (event.clientY - rect.top - inset) / Math.max(1, rect.height - inset * 2);
  });
  return (
    <div
      className={[styles.groove, locked ? styles.locked : "", doubt ? styles.doubt : "", className]
        .filter(Boolean)
        .join(" ")}
      data-take={take ? "" : undefined}
      data-locked={locked ? "" : undefined}
      data-doubt={doubt ? "" : undefined}
      data-unity={clamp01(value) === unity ? "" : undefined}
      data-testid={testId}
      style={{ "--slider-value": String(clamp01(value)), "--slider-unity": String(unity), height } as CSSProperties}
      {...ariaProps(props, "vertical")}
      {...handlers}
    >
      <span className={styles.grooveWell} data-well="" aria-hidden="true" />
      <span className={styles.travel} aria-hidden="true">
        <span className={styles.slot} />
        <span className={styles.grooveUnity} />
        <span className={styles.grooveCap} data-material="cap" />
      </span>
    </div>
  );
}
