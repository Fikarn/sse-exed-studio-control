import { describe, expect, it } from "vitest";

import { AUDIO_FADER_UNITY, FADER_OFF_DB, faderDbIsOff, faderDbToLin, faderLinToDb } from "./faderCurve";

// 2026-09 audit remediation, Slice 5. The anchors below are the "Fader curve"
// sheet of RME's Global OSC protocol table and are the same table the engine
// pins in audio/fader_curve.rs (fader_curve_matches_rme_published_anchors) and
// the deck LCD test in control_surface_audio.rs. If one side moves, all three
// must move together.
describe("RME TotalMix fader curve", () => {
  it("matches RME's published anchors", () => {
    expect(faderLinToDb(836 / 1023)).toBeCloseTo(0, 6);
    expect(faderLinToDb(649 / 1023)).toBeCloseTo(-6, 6);
    expect(faderLinToDb(1)).toBeCloseTo(6, 6);
    expect(faderLinToDb(0.5)).toBeCloseTo(-12.125, 2);
    expect(faderLinToDb(0.7)).toBeCloseTo(-3.847, 2);
    expect(faderLinToDb(0.35)).toBeCloseTo(-23.008, 2);
    // Live console reading for position 0.02 (studio UFX III, 2026-09-03).
    expect(faderLinToDb(0.02)).toBeCloseTo(-61.9744, 3);
    expect(faderLinToDb(0)).toBe(Number.NEGATIVE_INFINITY);
    expect(AUDIO_FADER_UNITY).toBeCloseTo(0.8172, 4);
  });

  it("round-trips every one of the 1023 fader steps", () => {
    for (let step = 1; step <= 1023; step += 1) {
      const position = step / 1023;
      const db = faderLinToDb(position);
      if (!Number.isFinite(db)) continue;
      expect(faderDbToLin(db)).toBeCloseTo(position, 9);
    }
    expect(faderDbToLin(0)).toBe(AUDIO_FADER_UNITY);
    expect(faderDbToLin(-6)).toBeCloseTo(649 / 1023, 9);
  });

  it("treats -65 dB, TotalMix's -300 dB sentinel and non-finite values as off", () => {
    expect(faderDbToLin(-300)).toBe(0);
    expect(faderDbToLin(FADER_OFF_DB)).toBe(0);
    expect(faderDbToLin(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(faderDbToLin(Number.NaN)).toBe(0);
    expect(faderDbToLin(12)).toBe(1);
    expect(faderDbIsOff(-300)).toBe(true);
    expect(faderDbIsOff(-64)).toBe(false);
    expect(faderLinToDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
    // The first fader step is already audible (-64.85 dB), not off.
    expect(faderLinToDb(1 / 1023)).toBeCloseTo(-64.85, 2);
  });
});
