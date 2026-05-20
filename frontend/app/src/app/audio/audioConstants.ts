/**
 * Shared audio workspace constants.
 *
 * Numeric values that previously lived as bare literals inside individual
 * audio components are consolidated here so the engine alignment (peak hold,
 * throttle windows) and operator-facing timing decisions live in one place.
 *
 * Authoritative for the React shell only. The Rust engine owns its own
 * constants (e.g. `CONSOLE_PEAK_HOLD_MS` in `native/rust-engine/src/rme_totalmix_osc.rs`);
 * where this file's values must agree with the engine, the `// Why:` line cites
 * the engine source.
 */

// Why: arm-then-apply safety window for 48V, snapshot recall, snapshot
// overwrite, palette recall, and shortcut recall. After this window the armed
// candidate clears and the operator must arm again.
// Source: previously inline at AudioWorkspace.tsx:103.
export const AUDIO_ARM_TIMEOUT_MS = 4500;

// Why: rail prototype monitor level used as fallback when no draft/value is
// present for the selected mix target's volume. Expressed in dBFS, converted
// via `faderDbToNormalized` at the call site.
// Source: previously inline at AudioRail.tsx:21.
export const PROTOTYPE_MONITOR_LEVEL_DB = -12;

// Why: snapshot thumbnail mini-meter visualisation density. 12 vertical bars
// gives a readable preview at compact card sizes without overwhelming the
// tile.
// Source: previously inline at AudioSnapshotDeck.tsx:8.
export const SNAPSHOT_THUMB_BAR_COUNT = 12;

// Why: placeholder normalized levels rendered when a snapshot has no stored
// thumb data. Hand-tuned to read as "muted recent material", not silence.
// Source: previously inline at AudioSnapshotDeck.tsx:9.
export const SNAPSHOT_PLACEHOLDER_LEVELS = [
  0.26, 0.2, 0.32, 0.18, 0.28, 0.22, 0.3, 0.16, 0.24, 0.2, 0.28, 0.18,
] as const;

// Why: peak-hold duration aligned with the engine's `CONSOLE_PEAK_HOLD_MS`
// in native/rust-engine/src/rme_totalmix_osc.rs:33 (1500 ms) and with IEC PPM
// Type IIa expectations. Previously 900 ms in the UI only; alignment closes
// the divergence between engine peak ballistics and rendered text/canvas hold.
export const METER_PEAK_HOLD_MS = 1500;

// Why: peak-hold fall rate aligned with IEC PPM Type IIa (12–15 dB/s).
// Previously 18 dB/s; the new value matches the hardware reference and gives
// the operator a slightly slower, more readable peak decay.
export const METER_PEAK_FALL_DB_PER_SECOND = 15;

// Why: inspector text readout publish cadence. 150 ms is fast enough to feel
// live but slow enough to keep proportional numbers visually stable while the
// canvas meters animate at frame rate.
// Source: previously inline at AudioLiveMeterReadout.tsx:18.
export const INSPECTOR_READOUT_INTERVAL_MS = 150;

// Why: dB hysteresis around the inspector text readout. Suppresses jitter
// within ±0.75 dB so the tabular slot reads as a stable value while the
// underlying canvas mark keeps moving.
// Source: previously inline at AudioLiveMeterReadout.tsx:19.
export const INSPECTOR_DB_HYSTERESIS = 0.75;

// Why: default throttle window for continuous fader/preamp commits while a
// pointer drag is in flight. Empirically tuned: small enough that the engine
// catches the operator gesture, large enough to avoid IPC saturation at high
// pointer rates.
// Source: previously the `delayMs = 75` default param in audioContinuousControls.ts:3.
export const AUDIO_THROTTLE_FADER_MS = 75;

// Why: throttle window for EQ continuous edits. Higher than fader throttle
// because EQ commits are more expensive engine-side and the response curve is
// less sensitive to sub-frame latency.
// Source: previously inline at AudioInspector.tsx:308.
export const AUDIO_THROTTLE_EQ_MS = 500;

// Why: delay before clearing optimistic local-draft state after a commit.
// Long enough for the engine snapshot to round-trip and authoritative state
// to land in the React tree; short enough that stale drafts never linger.
// Source: previously inline at audioControlDraftStore.ts:38 and AudioSliderControl.tsx:119.
export const AUDIO_DRAFT_CLEAR_MS = 250;

// Why: maximum preamp gain in dB. Matches RME UFX III preamp range.
// Source: previously inline at AudioPreampControl.tsx:98,116,163,164.
export const PREAMP_GAIN_MAX_DB = 75;

// Why: angular sweep of the preamp knob bitmap. The PNG asset is authored so
// the visible indicator travels 250° from minimum to maximum gain.
// Source: previously inline at AudioPreampControl.tsx:164.
export const PREAMP_ROTATION_RANGE_DEG = 250;

// Why: rotation origin offset (the angle at 0 dB). Half of the sweep range,
// negated so the knob centres on 0 dB at the asset's pointing-up midpoint.
// Source: previously inline at AudioPreampControl.tsx:164.
export const PREAMP_ROTATION_ORIGIN_DEG = -125;

// Why: visual pulse duration applied to a snapshot tile after the engine
// confirms a recall. Long enough for the operator to register the flash, short
// enough that it doesn't overlap a subsequent recall.
// Source: previously inline at AudioWorkspace.tsx:208.
export const AUDIO_RECALL_PULSE_MS = 1500;
