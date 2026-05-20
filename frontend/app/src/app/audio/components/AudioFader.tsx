import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import styles from "../AudioWorkspace.module.css";
import { faderDbToNormalized, formatAudioDb, normalizedToFaderDb } from "../audioFormatting";
import { AudioNumberDialog } from "./AudioNumberDialog";
import { AudioSliderControl } from "./AudioSliderControl";

export function AudioFader({
  disabled = false,
  label,
  onCommit,
  onPreview,
  showValue = true,
  value,
}: {
  disabled?: boolean;
  label: string;
  onCommit: (value: number) => void;
  onPreview?: (value: number) => void;
  showValue?: boolean;
  value: number;
}) {
  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  const currentDb = normalizedToFaderDb(value);
  const openNumberDialog = () => {
    if (!disabled) setNumberDialogOpen(true);
  };
  const handleKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setNumberDialogOpen(true);
  };

  return (
    <div className={styles.fader} onKeyDownCapture={handleKeyDownCapture}>
      <AudioSliderControl
        disabled={disabled}
        label={label}
        onCommit={onCommit}
        onPreview={onPreview}
        onRequestNumericValue={() => {
          openNumberDialog();
          return null;
        }}
        orientation="vertical"
        snapUnity
        value={value}
        valueText={formatAudioDb(value)}
      />
      {showValue ? <span className={styles.faderValue}>{formatAudioDb(value)}</span> : null}
      {numberDialogOpen ? (
        <AudioNumberDialog
          fieldLabel="Fader level"
          initialValue={Number.isFinite(currentDb) ? Number(currentDb.toFixed(1)) : -60}
          max={6}
          min={-60}
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
