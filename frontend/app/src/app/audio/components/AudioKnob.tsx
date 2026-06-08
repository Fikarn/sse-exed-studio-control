/**
 * AudioKnob — reusable SVG rotary control for the audio inspector.
 *
 * Renders a 270° arc (track + accent fill + indicator + hub) with a caption
 * and a monospace value readout, matching the Claude Design "Console"
 * prototype's knob language. Generalised from AudioStripPreamp so the EQ
 * band controls, dynamics controls, and the inspector preamp hero knob can
 * all share one widget.
 *
 * Contract mirrors AudioSliderControl so it slots into the existing
 * draft-store commit plumbing: `onPreview(value)` fires continuously during a
 * drag (→ setDraftValue), `onCommit(value)` fires on release / keyboard / reset
 * (→ engine commit + clearDraftValueLater). The knob keeps its own drag draft
 * internally and reverts to the `value` prop shortly after commit.
 */
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import styles from "./AudioKnob.module.css";
import { AUDIO_DRAFT_CLEAR_MS, AUDIO_KNOB_DRAG_TRAVEL_PX } from "../audioConstants";
import { NumberEntryDialog } from "@sse/design-system";

const ARC_START_DEG = -135;
const ARC_END_DEG = 135;

export interface AudioKnobProps {
  ariaLabel: string;
  bipolar?: boolean;
  caption?: string;
  defaultValue?: number;
  disabled?: boolean;
  format?: (value: number) => string;
  max: number;
  min: number;
  /** Field label inside the typed-entry dialog (e.g. "EQ gain", "Threshold").
      Defaults to `caption`, then `ariaLabel`. */
  numericFieldLabel?: string;
  /** Raw-engine-unit suffix for the typed-entry dialog ("Hz" / "dB" / ":1" /
      ""). Deliberately NOT derived from `format`, which bakes value+unit and
      rescales (e.g. "8.00 kHz") — the dialog operates in raw units. */
  numericSuffix?: string;
  onCommit: (value: number) => void;
  onPreview?: (value: number) => void;
  size?: number;
  step?: number;
  /** Render the value large + centred inside the dial (hero preamp style)
      instead of as a small readout below. The `caption` becomes the unit. */
  valueInside?: boolean;
  value: number;
}

interface DragState {
  pointerId: number;
  startValue: number;
  startY: number;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function polar(cx: number, cy: number, radius: number, degrees: number) {
  const angleRad = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleRad), y: cy + radius * Math.sin(angleRad) };
}

export function AudioKnob({
  ariaLabel,
  bipolar = false,
  caption,
  defaultValue,
  disabled = false,
  format,
  max,
  min,
  numericFieldLabel,
  numericSuffix,
  onCommit,
  onPreview,
  size = 52,
  step,
  valueInside = false,
  value,
}: AudioKnobProps) {
  const dragRef = useRef<DragState | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  const span = Math.max(0.000001, max - min);
  const resolvedStep = step ?? span / 200;
  const current = clamp(draft ?? value, min, max);
  const norm = (current - min) / span;
  const angle = ARC_START_DEG + norm * (ARC_END_DEG - ARC_START_DEG);
  const fmt = format ?? ((v: number) => v.toFixed(1));

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    },
    []
  );

  const radius = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const arcStart = polar(cx, cy, radius, ARC_START_DEG);
  const arcEnd = polar(cx, cy, radius, ARC_END_DEG);
  const arcCurrent = polar(cx, cy, radius, angle);
  const indicatorStart = polar(cx, cy, radius * 0.42, angle);
  const indicatorEnd = polar(cx, cy, radius * 0.92, angle);
  const trackPath = `M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${radius} ${radius} 0 1 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}`;

  let fillPath: string;
  if (bipolar) {
    const center = polar(cx, cy, radius, 0);
    const sweepDir = angle >= 0 ? 1 : 0;
    const large = Math.abs(angle) > 180 ? 1 : 0;
    fillPath = `M ${center.x.toFixed(2)} ${center.y.toFixed(2)} A ${radius} ${radius} 0 ${large} ${sweepDir} ${arcCurrent.x.toFixed(2)} ${arcCurrent.y.toFixed(2)}`;
  } else {
    const sweep = angle - ARC_START_DEG;
    fillPath = `M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${arcCurrent.x.toFixed(2)} ${arcCurrent.y.toFixed(2)}`;
  }

  // Snap to the knob's step so a stepped control never emits an off-grid value.
  // The continuous pointer drag would otherwise commit fractional values — and
  // e.g. preamp gain (step 1) is integer-only engine-side, so a fractional
  // commit is rejected. Knobs that omit `step` get a fine span/200 grid, i.e.
  // effectively continuous (unchanged behaviour).
  const snapToStep = (raw: number) => {
    if (!Number.isFinite(resolvedStep) || resolvedStep <= 0) return clamp(raw, min, max);
    const snapped = Math.round((raw - min) / resolvedStep) * resolvedStep + min;
    return clamp(Number(snapped.toFixed(5)), min, max);
  };

  const preview = (raw: number) => {
    const next = snapToStep(raw);
    setDraft(next);
    onPreview?.(next);
  };

  const previewAndCommit = (raw: number) => {
    const next = snapToStep(raw);
    preview(next);
    onCommit(next);
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      setDraft(null);
    }, AUDIO_DRAFT_CLEAR_MS);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    if (event.detail === 2) {
      // C05: double-click opens typed entry (mirrors AudioFader / AudioStripPreamp);
      // reset-to-default relocates to Alt+double-click (Backspace/Delete still reset).
      if (event.altKey) {
        if (defaultValue != null) previewAndCommit(clamp(defaultValue, min, max));
      } else {
        setNumberDialogOpen(true);
      }
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startValue: current, startY: event.clientY };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const fine = event.shiftKey ? 0.25 : 1;
    const delta = ((drag.startY - event.clientY) / AUDIO_KNOB_DRAG_TRAVEL_PX) * span * fine;
    preview(clamp(drag.startValue + delta, min, max));
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    previewAndCommit(current);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const multiplier = event.shiftKey ? 5 : 1;
    let next: number;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = current + resolvedStep * multiplier;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = current - resolvedStep * multiplier;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      case "Backspace":
      case "Delete":
        if (defaultValue == null) return;
        next = defaultValue;
        break;
      case "Enter":
        // C05: Enter opens typed entry, mirroring the fader / strip-preamp siblings.
        event.preventDefault();
        setNumberDialogOpen(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    previewAndCommit(clamp(Number(next.toFixed(5)), min, max));
  };

  return (
    <div className={styles.knobWrap} data-bipolar={bipolar} data-disabled={disabled || undefined}>
      <div
        aria-disabled={disabled ? true : undefined}
        aria-label={ariaLabel}
        aria-orientation="vertical"
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={Number(current.toFixed(5))}
        aria-valuetext={fmt(current)}
        className={styles.knob}
        onDoubleClick={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        style={{ "--knob-size": `${size}px` } as CSSProperties}
        tabIndex={disabled ? -1 : 0}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <path d={trackPath} fill="none" stroke="var(--bg-3)" strokeWidth="3" strokeLinecap="round" />
          <path d={fillPath} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
          <line
            x1={indicatorStart.x}
            y1={indicatorStart.y}
            x2={indicatorEnd.x}
            y2={indicatorEnd.y}
            stroke="var(--fg)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          {valueInside ? null : (
            <circle cx={cx} cy={cy} r={radius * 0.3} fill="var(--bg-elev)" stroke="var(--line-2)" strokeWidth="1" />
          )}
        </svg>
        {valueInside ? (
          <span className={styles.valueInside} aria-hidden="true">
            <span className={styles.valueInsideValue}>{fmt(current)}</span>
            {caption ? <span className={styles.valueInsideUnit}>{caption}</span> : null}
          </span>
        ) : null}
      </div>
      {valueInside ? null : (
        <>
          {caption ? <span className={styles.caption}>{caption}</span> : null}
          <span className={styles.value}>{fmt(current)}</span>
        </>
      )}
      {numberDialogOpen ? (
        <NumberEntryDialog
          // C05: operate in RAW engine units — initial value, bounds and step
          // are the knob's own (NOT the rescaled `format` output). The explicit
          // per-site `numericSuffix` carries the unit.
          fieldLabel={numericFieldLabel ?? caption ?? ariaLabel}
          initialValue={snapToStep(current)}
          max={max}
          min={min}
          onCancel={() => setNumberDialogOpen(false)}
          onConfirm={(next) => {
            setNumberDialogOpen(false);
            previewAndCommit(next);
          }}
          step={resolvedStep}
          suffix={numericSuffix}
          title={`Set ${ariaLabel}`}
        />
      ) : null}
    </div>
  );
}
