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

// Why: arm-then-apply safety window for 48V and a TotalMix snapshot load.
// After this window the armed candidate clears and the operator must arm
// again.
// Source: previously inline at AudioWorkspace.tsx:103.
export const AUDIO_ARM_TIMEOUT_MS = 4500;

// Why: arm-then-apply minimum dwell. A second activation of the same armed
// key inside this window is ignored and the arm stays, so a double-click or a
// bounced pointer can never arm and apply a 48V change or a snapshot load in
// one motion. 350 ms is past any double-click interval
// and well inside AUDIO_ARM_TIMEOUT_MS. The dwell does not stop a held key: its
// auto-repeat goes on past it (Windows starts repeating after about 500 ms by
// default), so `useAudioArming` cancels a held Enter's repeats while something
// is armed (new pages program, Slice 3).
// 2026-09 audit remediation, Slice 7.
export const AUDIO_ARM_MIN_DWELL_MS = 350;

// Why: rail prototype monitor level used as fallback when no draft/value is
// present for the selected mix target's volume. Expressed in dBFS, converted
// via `faderDbToNormalized` at the call site.
// Source: previously inline at AudioRail.tsx:21 — that file was deleted on
// 2026-09-09 with the GS-AUD-44 dead-code posture, and it was this constant's
// only production consumer. Kept because audio-constants.spec.ts pins the
// value; drop both together if no Console surface reclaims it.
export const PROTOTYPE_MONITOR_LEVEL_DB = -12;

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

// Why: delay before clearing optimistic local-draft state after a commit.
// Long enough for the engine snapshot to round-trip and authoritative state
// to land in the React tree; short enough that stale drafts never linger.
// Source: previously inline at audioControlDraftStore.ts:38 and AudioSliderControl.tsx:119.
export const AUDIO_DRAFT_CLEAR_MS = 250;

// Why: maximum preamp gain in dB. Matches RME UFX III preamp range.
// Source: previously inline at AudioPreampControl.tsx:98,116,163,164.
export const PREAMP_GAIN_MAX_DB = 75;

// Why: default preamp gain in dB — what typed entry's Reset key sets on the
// preamp surfaces (the plate's AudioKnob and the strip's AudioStripGainKey;
// new pages program, Slice 3, decision 8 — it used to be Backspace/Delete).
// Consolidated so both surfaces reset to the same value (C13 preamp unification).
// Source: previously inline at AudioInspectorChannelHardwareCard.tsx:32.
export const PREAMP_GAIN_DEFAULT_DB = 24;

// Why: vertical pointer travel (px) for a full min→max sweep of an audio rotary
// knob. Shared so the two preamp surfaces (inspector hero AudioKnob + channel-
// strip AudioStripPreamp) move at the same px-per-dB (C13 preamp unification;
// the strip preamp previously used a divergent 120 px).
export const AUDIO_KNOB_DRAG_TRAVEL_PX = 150;

// Why: angular sweep of the preamp knob bitmap. The PNG asset is authored so
// the visible indicator travels 250° from minimum to maximum gain.
// Source: previously inline at AudioPreampControl.tsx:164.
export const PREAMP_ROTATION_RANGE_DEG = 250;

// Why: rotation origin offset (the angle at 0 dB). Half of the sweep range,
// negated so the knob centres on 0 dB at the asset's pointing-up midpoint.
// Source: previously inline at AudioPreampControl.tsx:164.
export const PREAMP_ROTATION_ORIGIN_DEG = -125;
