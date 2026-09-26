import { useState } from "react";
import { Key, NumberEntryDialog } from "@sse/design-system";

import styles from "./AudioStripGainKey.module.css";
import { PREAMP_GAIN_DEFAULT_DB, PREAMP_GAIN_MAX_DB } from "../audioConstants";

// Visual overhaul A, Slice 4b (system §7 "Strip"): preamp gain on the strip is
// a key that prints what the desk reports and opens typed entry when pressed.
// Riding the gain by hand stays on the plate's knob, where there is room for a
// control that answers a drag and the arrows. The engine rejects fractional
// gain, so every value the key sends is a whole dB.
// New pages program, Slice 3 (decisions 8 and 9): the key is a button, so the
// arrows (and Shift for five), Home / End and Backspace / Delete no longer
// nudge or reset it; typed entry offers "Reset to 24 dB" instead.
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

  const commit = (next: number) => {
    const value = clampGain(next);
    onPreview(value);
    onCommit(value);
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
        title={`${label} — press to type a value`}
        onClick={(event) => {
          event.stopPropagation();
          if (!disabled) setDialogOpen(true);
        }}
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
            commit(next);
          }}
          resetValue={PREAMP_GAIN_DEFAULT_DB}
          step={1}
          suffix="dB"
          title={`Set ${label}`}
        />
      ) : null}
    </>
  );
}
