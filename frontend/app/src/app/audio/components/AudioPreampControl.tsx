import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import preampKnobBody from "../assets/preamp/preamp-knob-body.png";
import preampPanelCompact from "../assets/preamp/preamp-panel-compact.png";
import preampPanelNarrow from "../assets/preamp/preamp-panel-narrow.png";
import styles from "./AudioPreampControl.module.css";
import {
  AUDIO_DRAFT_CLEAR_MS,
  PREAMP_GAIN_MAX_DB,
  PREAMP_ROTATION_ORIGIN_DEG,
  PREAMP_ROTATION_RANGE_DEG,
} from "../audioConstants";
import { AudioNumberDialog } from "./AudioNumberDialog";

interface AudioPreampControlProps {
  channelId: string;
  disabled: boolean;
  gain: number;
  label: string;
  onCommit: (gain: number) => void;
  onPreview?: (gain: number) => void;
  variant: "compact" | "narrow";
}

interface PreampDragState {
  fine: boolean;
  latestGain: number;
  pointerId: number;
  startGain: number;
  startY: number;
  step: number;
}

const PREAMP_LED_SOCKET_MAPS = {
  compact: {
    radius: 15,
    sockets: [
      [189, 467, 18],
      [166, 391],
      [169, 317],
      [195, 251],
      [243, 194],
      [308, 154],
      [395, 137],
      [485, 150],
      [544, 193],
      [591, 250],
      [617, 316],
      [618, 391],
      [598, 467, 18],
    ],
    viewBox: "0 0 2172 724",
  },
  narrow: {
    radius: 14,
    sockets: [
      [268, 685],
      [254, 638],
      [251, 587],
      [257, 537],
      [272, 489],
      [298, 445],
      [333, 408],
      [374, 375],
      [418, 353],
      [465, 338],
      [513, 334],
      [562, 339],
      [610, 353],
      [654, 376],
      [694, 407],
      [726, 445],
      [751, 490],
      [766, 537],
      [771, 588],
      [768, 638],
      [754, 686],
      [735, 723],
      [704, 762],
      [662, 803],
      [619, 827],
      [573, 842],
      [510, 849],
      [447, 842],
      [401, 828],
      [359, 801],
      [322, 769],
      [291, 730],
    ],
    viewBox: "0 0 1024 1536",
  },
} as const;

function clampGain(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PREAMP_GAIN_MAX_DB, value));
}

function quantizeGain(value: number, step: number) {
  const clamped = clampGain(value);
  return Number((Math.round(clamped / step) * step).toFixed(2));
}

function commitGainValue(value: number) {
  return Math.round(clampGain(value));
}

function preampNumber(channelId: string) {
  return channelId.match(/\d+/g)?.at(-1) ?? "1";
}

function PreampLedRing({ gain, variant }: { gain: number; variant: AudioPreampControlProps["variant"] }) {
  const map = PREAMP_LED_SOCKET_MAPS[variant];
  const activeLed = Math.round((clampGain(gain) / PREAMP_GAIN_MAX_DB) * (map.sockets.length - 1));

  return (
    <svg
      aria-hidden="true"
      className={styles.preampLedRing}
      data-led-skin={variant}
      preserveAspectRatio="none"
      viewBox={map.viewBox}
    >
      <g>
        {map.sockets.map(([x, y, radius], index) => (
          <circle
            className={[
              styles.preampLedDot,
              index <= activeLed ? styles.preampLedDotActive : "",
              index === activeLed ? styles.preampLedDotCurrent : "",
            ]
              .filter(Boolean)
              .join(" ")}
            cx={x}
            cy={y}
            data-led={index}
            key={`${x}-${y}-${index}`}
            r={radius ?? map.radius}
          />
        ))}
      </g>
    </svg>
  );
}

export function AudioPreampControl({
  channelId,
  disabled,
  gain,
  label,
  onCommit,
  onPreview,
  variant,
}: AudioPreampControlProps) {
  const dragRef = useRef<PreampDragState | null>(null);
  const clearTimerRef = useRef<number | null>(null);
  const lastPointerDownAtRef = useRef(0);
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  const [localDraftGain, setLocalDraftGain] = useState<number | null>(null);
  const currentGain = clampGain(localDraftGain ?? gain);
  const gainPct = (currentGain / PREAMP_GAIN_MAX_DB) * 100;
  // Why: the preamp knob asset sweeps PREAMP_ROTATION_RANGE_DEG (250°) total,
  // centred so 0 dB sits at PREAMP_ROTATION_ORIGIN_DEG (-125°) — the asset's
  // pointing-up midpoint.
  const rotation = (currentGain / PREAMP_GAIN_MAX_DB) * PREAMP_ROTATION_RANGE_DEG + PREAMP_ROTATION_ORIGIN_DEG;

  useEffect(() => {
    if (dragRef.current) return;
    setLocalDraftGain(null);
  }, [gain]);

  useEffect(
    () => () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    },
    []
  );

  const preview = (nextGain: number) => {
    setLocalDraftGain(nextGain);
    onPreview?.(nextGain);
  };

  const previewAndCommit = (nextGain: number) => {
    const committed = commitGainValue(nextGain);
    preview(committed);
    onCommit(committed);
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current);
    }
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      setLocalDraftGain(null);
    }, AUDIO_DRAFT_CLEAR_MS);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();

    const now = performance.now();
    if (now - lastPointerDownAtRef.current <= 360) {
      lastPointerDownAtRef.current = 0;
      setNumberDialogOpen(true);
      return;
    }
    lastPointerDownAtRef.current = now;

    event.currentTarget.setPointerCapture(event.pointerId);

    const step = event.metaKey || event.ctrlKey ? 0.25 : event.shiftKey ? 5 : 1;
    dragRef.current = {
      fine: event.metaKey || event.ctrlKey,
      latestGain: currentGain,
      pointerId: event.pointerId,
      startGain: currentGain,
      startY: event.clientY,
      step,
    };
    preview(currentGain);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const pixelsPerDb = drag.fine ? 16 : 4;
    const rawGain = drag.startGain + (drag.startY - event.clientY) / pixelsPerDb;
    const nextGain = quantizeGain(rawGain, drag.step);
    drag.latestGain = nextGain;
    preview(nextGain);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    previewAndCommit(drag.latestGain);
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let nextGain: number;

    switch (event.key) {
      case "Enter":
        event.preventDefault();
        setNumberDialogOpen(true);
        return;
      case "ArrowUp":
      case "ArrowRight":
        nextGain = currentGain + 1;
        break;
      case "ArrowDown":
      case "ArrowLeft":
        nextGain = currentGain - 1;
        break;
      case "PageUp":
        nextGain = currentGain + 5;
        break;
      case "PageDown":
        nextGain = currentGain - 5;
        break;
      case "Home":
        nextGain = 0;
        break;
      case "End":
        nextGain = PREAMP_GAIN_MAX_DB;
        break;
      default:
        return;
    }

    event.preventDefault();
    previewAndCommit(nextGain);
  };

  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setNumberDialogOpen(true);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setNumberDialogOpen(true);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) {
      handleDoubleClick(event);
    }
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.detail < 2 || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setNumberDialogOpen(true);
  };

  return (
    <>
      <div
        aria-disabled={disabled ? true : undefined}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemax={PREAMP_GAIN_MAX_DB}
        aria-valuemin={0}
        aria-valuenow={commitGainValue(currentGain)}
        aria-valuetext={`${commitGainValue(currentGain)} dB`}
        className={`${styles.preampModule} ${styles.preampControl}`}
        data-channel={channelId}
        data-variant={variant}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onKeyDownCapture={handleKeyDownCapture}
        onMouseDownCapture={handleMouseDown}
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="slider"
        style={
          {
            "--gain-pct": `${gainPct}%`,
            "--gain-rotation": `${rotation}deg`,
            "--gain-sweep": `${(currentGain / PREAMP_GAIN_MAX_DB) * 270}deg`,
          } as CSSProperties
        }
        tabIndex={disabled ? -1 : 0}
      >
        <img
          alt=""
          className={styles.preampPanel}
          draggable={false}
          src={variant === "narrow" ? preampPanelNarrow : preampPanelCompact}
        />
        <PreampLedRing gain={currentGain} variant={variant} />
        <img alt="" className={styles.preampKnob} draggable={false} src={preampKnobBody} />
        <span className={styles.preampNumber}>Pre {preampNumber(channelId)}</span>
        <span className={styles.preampGainLabel}>
          +{commitGainValue(currentGain)}
          <i>dB</i>
        </span>
      </div>
      {numberDialogOpen ? (
        <AudioNumberDialog
          fieldLabel="Preamp gain"
          initialValue={commitGainValue(currentGain)}
          max={PREAMP_GAIN_MAX_DB}
          min={0}
          onCancel={() => setNumberDialogOpen(false)}
          onConfirm={(nextGain) => {
            setNumberDialogOpen(false);
            previewAndCommit(nextGain);
          }}
          suffix="dB"
          title={`Set ${label}`}
        />
      ) : null}
    </>
  );
}
