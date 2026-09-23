import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Key, NumberEntryDialog } from "@sse/design-system";

import styles from "./AudioStripGainKey.module.css";
import { PREAMP_GAIN_DEFAULT_DB, PREAMP_GAIN_MAX_DB } from "../audioConstants";

// Visual overhaul A, Slice 4b (system §7 "Strip"): preamp gain on the strip is
// a key that prints what the desk reports and opens typed entry when pressed;
// the arrows nudge it a whole dB at a time (Shift five). Riding the gain by
// hand stays on the plate's knob, where there is room for a control that
// answers a drag. The engine rejects fractional gain, so every value the key
// sends is a whole dB.
export interface AudioStripGainKeyProps {
  channelId: string;
  disabled?: boolean;
  gain: number;
  label: string;
  lockedReason?: string;
  onCommit: (value: number) => void;
  onPreview: (value: number) => void;
}

function clampGain(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PREAMP_GAIN_MAX_DB, Math.round(value)));
}

export function AudioStripGainKey({
  channelId,
  disabled = false,
  gain,
  label,
  lockedReason,
  onCommit,
  onPreview,
}: AudioStripGainKeyProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const current = clampGain(gain);

  const nudge = (next: number) => {
    const value = clampGain(next);
    onPreview(value);
    onCommit(value);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 5 : 1;
    switch (event.key) {
      case "ArrowUp":
      case "ArrowRight":
        event.preventDefault();
        nudge(current + step);
        return;
      case "ArrowDown":
      case "ArrowLeft":
        event.preventDefault();
        nudge(current - step);
        return;
      case "Home":
        event.preventDefault();
        nudge(0);
        return;
      case "End":
        event.preventDefault();
        nudge(PREAMP_GAIN_MAX_DB);
        return;
      case "Backspace":
      case "Delete":
        event.preventDefault();
        nudge(PREAMP_GAIN_DEFAULT_DB);
        return;
      default:
    }
  };

  return (
    <>
      <Key
        cap="Gain"
        className={styles.gainKey}
        data-channel={channelId}
        data-control="gain"
        locked={disabled}
        reason={lockedReason}
        size="small"
        take
        testId={`audio-lane-gain-${channelId}`}
        aria-label={label}
        title={`${label} — press to type a value, arrows to nudge`}
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) setDialogOpen(true);
        }}
        onKeyDown={onKeyDown}
      >
        {current} dB
      </Key>
      {dialogOpen ? (
        <NumberEntryDialog
          fieldLabel="Preamp gain"
          initialValue={current}
          max={PREAMP_GAIN_MAX_DB}
          min={0}
          onCancel={() => setDialogOpen(false)}
          onConfirm={(next) => {
            setDialogOpen(false);
            nudge(next);
          }}
          step={1}
          suffix="dB"
          title={`Set ${label}`}
        />
      ) : null}
    </>
  );
}
