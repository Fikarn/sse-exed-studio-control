import { useState } from "react";
import { Groove } from "@sse/design-system";

import styles from "./AudioFader.module.css";
import {
  AUDIO_FADER_UNITY,
  AUDIO_FADER_UNITY_SNAP,
  faderDbToNormalized,
  formatAudioDb,
  normalizedToFaderDb,
} from "../audioFormatting";
import { NumberEntryDialog } from "@sse/design-system";
import { FADER_MAX_DB, FADER_OFF_DB } from "@sse/engine-client";

// Visual overhaul A, Slice 4b (system §7, "Strip"): the strip's fader is the
// design system's groove — the 44 px target column the cap rides in, the 18 px
// slot, the unity notch — and this wrapper keeps what the desk expects of it:
// unity by Shift, typed entry by double-click or Enter, and the dB the engine
// speaks translated to and from the groove's 0..1 travel.
export function AudioFader({
  disabled = false,
  label,
  onCommit,
  onPreview,
  showValue = true,
  testId,
  value,
}: {
  disabled?: boolean;
  label: string;
  onCommit: (value: number) => void;
  onPreview?: (value: number) => void;
  showValue?: boolean;
  testId?: string;
  value: number;
}) {
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  // Typed entry spans TotalMix's fader range: -65 dB (and below) is off, +6 dB is the top.
  const currentDb = normalizedToFaderDb(value);

  return (
    <div className={styles.fader}>
      <Groove
        label={label}
        locked={disabled}
        onChange={(next) => onPreview?.(next)}
        onCommit={onCommit}
        onRequestTypedEntry={disabled ? undefined : () => setNumberDialogOpen(true)}
        snapUnity
        take
        testId={testId}
        unity={AUDIO_FADER_UNITY}
        unitySnap={AUDIO_FADER_UNITY_SNAP}
        value={value}
        valueText={formatAudioDb(value)}
      />
      {showValue ? <span className={styles.faderValue}>{formatAudioDb(value)}</span> : null}
      {numberDialogOpen ? (
        <NumberEntryDialog
          fieldLabel="Fader level"
          initialValue={Number.isFinite(currentDb) ? Number(currentDb.toFixed(1)) : FADER_OFF_DB}
          max={FADER_MAX_DB}
          min={FADER_OFF_DB}
          onCancel={() => setNumberDialogOpen(false)}
          onConfirm={(nextDb) => {
            setNumberDialogOpen(false);
            onPreview?.(faderDbToNormalized(nextDb));
            onCommit(faderDbToNormalized(nextDb));
          }}
          step={0.1}
          suffix="dB"
          title={`Set ${label}`}
        />
      ) : null}
    </div>
  );
}
