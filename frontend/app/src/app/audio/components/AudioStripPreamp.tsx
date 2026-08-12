/**
 * AudioStripPreamp — slim 32px arc-knob renderer used inside the channel
 * strip's preamp slot. Mirrors the Console.html prototype rhythm
 * (mini knob | "44 dB · Mic Gain" stacked label) instead of the bitmap
 * panel + LED ring that AudioPreampControl rendered for the pre-Console
 * inspector. AudioPreampControl itself has no live mount since the
 * 2026-05-27 Console rebuild (hero preamp is AudioKnob-based).
 */
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import styles from "./AudioStripPreamp.module.css";
import {
  AUDIO_DRAFT_CLEAR_MS,
  AUDIO_KNOB_DRAG_TRAVEL_PX,
  PREAMP_GAIN_DEFAULT_DB,
  PREAMP_GAIN_MAX_DB,
} from "../audioConstants";
import { NumberEntryDialog } from "@sse/design-system";

const ARC_START_DEG = -135;
const ARC_END_DEG = 135;

interface AudioStripPreampProps {
  channelId: string;
  disabled?: boolean;
  gain: number;
  label: string;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
}

interface DragState {
  height: number;
  pointerId: number;
  startGain: number;
  startY: number;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function polar(cx: number, cy: number, r: number, degrees: number) {
  const angleRad = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function commitGainValue(value: number) {
  return Math.round(value);
}

export function AudioStripPreamp({
  channelId,
  disabled = false,
  gain,
  label,
  onCommit,
  onPreview,
}: AudioStripPreampProps) {
  const dragRef = useRef<DragState | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  const currentGain = clamp(draft ?? gain, 0, PREAMP_GAIN_MAX_DB);

  const gainNorm = currentGain / PREAMP_GAIN_MAX_DB;
  const angle = ARC_START_DEG + gainNorm * (ARC_END_DEG - ARC_START_DEG);
  const size = 32;
  const radius = size / 2 - 3;
  const cx = size / 2;
  const cy = size / 2;
  const arcStart = polar(cx, cy, radius, ARC_START_DEG - 90);
  const arcEnd = polar(cx, cy, radius, ARC_END_DEG - 90);
  const arcCurrent = polar(cx, cy, radius, angle - 90);
  const indStart = polar(cx, cy, radius * 0.4, angle - 90);
  const indEnd = polar(cx, cy, radius * 0.9, angle - 90);
  const trackPath = `M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 1 1 ${arcEnd.x} ${arcEnd.y}`;
  const sweep = angle - ARC_START_DEG;
  const fillPath = `M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 ${sweep > 180 ? 1 : 0} 1 ${arcCurrent.x} ${arcCurrent.y}`;

  const preview = (next: number) => {
    setDraft(next);
    onPreview(next);
  };

  const previewAndCommit = (next: number) => {
    preview(next);
    onCommit(next);
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
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
      setNumberDialogOpen(true);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      height: AUDIO_KNOB_DRAG_TRAVEL_PX,
      pointerId: event.pointerId,
      startGain: currentGain,
      startY: event.clientY,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const factor = event.shiftKey ? 0.2 : 1;
    const delta = ((drag.startY - event.clientY) / drag.height) * PREAMP_GAIN_MAX_DB * factor;
    preview(clamp(Math.round(drag.startGain + delta), 0, PREAMP_GAIN_MAX_DB));
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
    previewAndCommit(currentGain);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 5 : 1;
    let next: number;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        next = currentGain + step;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        next = currentGain - step;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = PREAMP_GAIN_MAX_DB;
        break;
      case "Backspace":
      case "Delete":
        // C13: reset to the default preamp gain, mirroring AudioKnob so the two
        // preamp surfaces share the same reset key + reset target.
        next = PREAMP_GAIN_DEFAULT_DB;
        break;
      case "Enter":
        event.preventDefault();
        setNumberDialogOpen(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    previewAndCommit(clamp(next, 0, PREAMP_GAIN_MAX_DB));
  };

  return (
    <div className={styles.stripPreamp} data-channel={channelId}>
      <div
        aria-disabled={disabled ? true : undefined}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemax={PREAMP_GAIN_MAX_DB}
        aria-valuemin={0}
        aria-valuenow={commitGainValue(currentGain)}
        aria-valuetext={`${commitGainValue(currentGain)} dB`}
        className={styles.knob}
        onKeyDown={onKeyDown}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="slider"
        style={{ "--gain-pct": `${(currentGain / PREAMP_GAIN_MAX_DB) * 100}%` } as CSSProperties}
        tabIndex={disabled ? -1 : 0}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path d={trackPath} fill="none" stroke="var(--bg-3)" strokeWidth="3" strokeLinecap="round" />
          <path d={fillPath} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
          <line
            x1={indStart.x}
            y1={indStart.y}
            x2={indEnd.x}
            y2={indEnd.y}
            stroke="var(--fg)"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx={cx} cy={cy} r={radius * 0.3} fill="var(--bg-elev)" stroke="var(--line-2)" strokeWidth="1" />
        </svg>
      </div>
      <span className={styles.label}>
        <span className={styles.value}>{commitGainValue(currentGain)} dB</span>
        <span className={styles.caption}>Mic Gain</span>
      </span>
      {numberDialogOpen ? (
        <NumberEntryDialog
          fieldLabel="Preamp gain"
          initialValue={commitGainValue(currentGain)}
          max={PREAMP_GAIN_MAX_DB}
          min={0}
          onCancel={() => setNumberDialogOpen(false)}
          onConfirm={(next) => {
            setNumberDialogOpen(false);
            previewAndCommit(next);
          }}
          suffix="dB"
          title={`Set ${label}`}
        />
      ) : null}
    </div>
  );
}
