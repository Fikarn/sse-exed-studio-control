import { NumberEntryDialog } from "@sse/design-system";
import { FADER_MAX_DB, FADER_OFF_DB } from "@sse/engine-client";

import { PREAMP_GAIN_DEFAULT_DB, PREAMP_GAIN_MAX_DB } from "../audioConstants";
import { faderDbToNormalized, normalizedToFaderDb } from "../audioFormatting";

// The Console's typed entry (visual overhaul, the Console): a fader's level and
// a preamp's gain set by number. A fader asks for it by a double-click or
// Enter, and every strip's and output's menu by "Set … level…" or "Set
// preamp gain…"; both open the same dialog, so the words and the ranges are
// one.

/** Typed entry spans TotalMix's fader range: −65 dB (and below) is off, +6 dB the top. */
export function AudioLevelEntryDialog({
  title,
  value,
  onCancel,
  onConfirm,
}: {
  /** "Set FX 3/4 send level", "Set Main Out output level". */
  title: string;
  /** The fader's 0..1 position. */
  value: number;
  onCancel: () => void;
  /** The new 0..1 position. */
  onConfirm: (value: number) => void;
}) {
  const currentDb = normalizedToFaderDb(value);
  return (
    <NumberEntryDialog
      fieldLabel="Fader level"
      initialValue={Number.isFinite(currentDb) ? Number(currentDb.toFixed(1)) : FADER_OFF_DB}
      max={FADER_MAX_DB}
      min={FADER_OFF_DB}
      onCancel={onCancel}
      onConfirm={(nextDb) => onConfirm(faderDbToNormalized(nextDb))}
      // Unity: 0 dB lands exactly on AUDIO_FADER_UNITY (faderDbToLin).
      resetValue={0}
      step={0.1}
      suffix="dB"
      title={title}
    />
  );
}

/** The engine takes whole dB only, 0 to 75. */
export function clampPreampGain(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PREAMP_GAIN_MAX_DB, Math.round(value)));
}

export function AudioGainEntryDialog({
  title,
  gain,
  onCancel,
  onConfirm,
}: {
  /** "Set Host preamp gain". */
  title: string;
  gain: number;
  onCancel: () => void;
  /** The new gain, whole dB. */
  onConfirm: (gain: number) => void;
}) {
  return (
    <NumberEntryDialog
      fieldLabel="Preamp gain"
      initialValue={clampPreampGain(gain)}
      max={PREAMP_GAIN_MAX_DB}
      min={0}
      onCancel={onCancel}
      onConfirm={(next) => onConfirm(clampPreampGain(next))}
      resetValue={PREAMP_GAIN_DEFAULT_DB}
      step={1}
      suffix="dB"
      title={title}
    />
  );
}
