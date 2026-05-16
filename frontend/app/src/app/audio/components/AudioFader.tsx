import styles from "../AudioWorkspace.module.css";
import { faderDbToNormalized, formatAudioDb, normalizedToFaderDb } from "../audioFormatting";
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
  return (
    <label className={styles.fader}>
      <AudioSliderControl
        disabled={disabled}
        label={label}
        onCommit={onCommit}
        onPreview={onPreview}
        onRequestNumericValue={(currentValue) => {
          const currentDb = normalizedToFaderDb(currentValue);
          const raw = window.prompt(
            "Set fader dB, -60 to +6",
            Number.isFinite(currentDb) ? currentDb.toFixed(1) : "-60"
          );
          if (raw === null || raw.trim() === "") return null;
          const parsed = Number(raw);
          return Number.isFinite(parsed) ? faderDbToNormalized(parsed) : null;
        }}
        orientation="vertical"
        snapUnity
        value={value}
        valueText={formatAudioDb(value)}
      />
      {showValue ? <span className={styles.faderValue}>{formatAudioDb(value)}</span> : null}
    </label>
  );
}
