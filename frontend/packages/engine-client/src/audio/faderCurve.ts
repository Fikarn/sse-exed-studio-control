/**
 * RME TotalMix FX fader curve - the one fader law the app uses everywhere:
 * on-screen dB labels, typed dB entry, the unity notch and the fixture
 * transport's simulated submix gain. Mirrors the engine's
 * native/rust-engine/src/audio/fader_curve.rs, which the console link, the
 * recall push, simulated metering and the Stream Deck LCD labels all use, so
 * the app, the deck and TotalMix print the same dB for the same position.
 *
 * Source: the "Fader curve" sheet of RME's Global OSC protocol table
 * (OSCProtocoll_260721.ods, TotalMix FX 2.1 beta 2, 2026-07-21). Live-verified
 * on the studio UFX III (2026-09-03): sending faderlin 0.02 made TotalMix
 * report -61.974 dB, which is faderLinToDb(0.02) to five decimals.
 *
 * 2026-09 audit remediation, Slice 5 (operator decision 3). Until then the app
 * labelled a three-segment prototype law with unity at 0.80, so a fader that
 * TotalMix showed at -12.1 dB read "-24.3 dB" on screen. Positions stay 1:1
 * (faderlin is still the app's 0..1 value); only the dB the operator reads
 * changed, and unity moved from 0.80 to step 836 of 1023.
 */

/** TotalMix fader resolution: positions are 0..=1023 steps mapped onto 0..1. */
export const FADER_POSITION_STEPS = 1023;
/** At or below this the console treats the fader as off (-inf). */
export const FADER_OFF_DB = -65;
/** Top of the fader. */
export const FADER_MAX_DB = 6;
/** Unity gain (0 dB) as a linear fader position: step 836 of 1023 (0.8172). */
export const AUDIO_FADER_UNITY = 836 / 1023;

const KNEE_POSITION = 649;
const LINEAR_SLOPE = 0.0320855615;
const LINEAR_OFFSET = 26.8235294118;
const CURVE_A = -1 / 11033;
const CURVE_B = 0.1497326203;
const CURVE_C = -65;
const OFF_THRESHOLD_DB = -64.9;

/** True when TotalMix would treat this dB value as an off fader. */
export function faderDbIsOff(db: number): boolean {
  if (Number.isNaN(db)) return true;
  return db < OFF_THRESHOLD_DB;
}

/** Fader position (linear 0..1) to dB. -Infinity means the fader is off. */
export function faderLinToDb(position: number): number {
  if (!Number.isFinite(position)) return Number.NEGATIVE_INFINITY;
  const pos = Math.min(1, Math.max(0, position)) * FADER_POSITION_STEPS;
  const db = pos >= KNEE_POSITION ? pos * LINEAR_SLOPE - LINEAR_OFFSET : pos * pos * CURVE_A + pos * CURVE_B + CURVE_C;
  return db < OFF_THRESHOLD_DB ? Number.NEGATIVE_INFINITY : db;
}

/**
 * dB to fader position (linear 0..1). Anything at or below the off threshold
 * (including TotalMix's -300 dB sentinel, -Infinity and NaN) maps to 0.
 */
export function faderDbToLin(db: number): number {
  if (faderDbIsOff(db)) return 0;
  if (db >= FADER_MAX_DB) return 1;
  // Exactly 0 dB is exactly step 836: return the shared constant so a typed
  // "0" lands on the same value the unity snap and "Reset to unity" produce.
  if (db === 0) return AUDIO_FADER_UNITY;
  const pos = db >= -6 ? (db + LINEAR_OFFSET) / LINEAR_SLOPE : 826 - Math.sqrt(-34869 - 11033 * db);
  return Math.min(1, Math.max(0, pos / FADER_POSITION_STEPS));
}
