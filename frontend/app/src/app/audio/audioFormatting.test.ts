import { describe, expect, it } from "vitest";

import {
  AUDIO_DB_NEG_INFINITY,
  AUDIO_FADER_UNITY,
  AUDIO_METER_NEG_INFINITY,
  dbfsToMeterPercent,
  deriveSendStatusLabel,
  faderDbToNormalized,
  formatAudioDb,
  formatAudioRole,
  formatMeterDb,
  formatMeterPercent,
  meterTone,
  normalizedToDbfs,
  normalizedToFaderDb,
  snapFaderValue,
} from "./audioFormatting";

// plan PR 6 / workstream D3: pure-logic unit tests for the audio
// formatting helpers. These were previously covered by Playwright assertions
// inside `tests/audio.spec.ts` that ran in a full browser — overkill for
// pure number → number / number → string conversions. Moving them here lets
// the Playwright suite focus on the actual UI surfaces.

describe("normalizedToFaderDb / faderDbToNormalized", () => {
  it("maps the unity fader (0.8) to 0 dB", () => {
    expect(normalizedToFaderDb(AUDIO_FADER_UNITY)).toBeCloseTo(0, 6);
    expect(faderDbToNormalized(0)).toBeCloseTo(AUDIO_FADER_UNITY, 6);
  });

  it("maps the full-up fader (1.0) to +6 dB", () => {
    expect(normalizedToFaderDb(1)).toBe(6);
    expect(faderDbToNormalized(6)).toBeCloseTo(1, 6);
  });

  it("returns -Infinity at the fader bottom", () => {
    expect(normalizedToFaderDb(0)).toBe(Number.NEGATIVE_INFINITY);
    // -60 dB is the lowest finite value the curve reaches.
    expect(faderDbToNormalized(-60)).toBeCloseTo(0, 6);
  });

  it("survives a round-trip across the documented breakpoints", () => {
    for (const value of [0.05, 0.35, 0.7, 0.75, 0.8, 0.9, 1]) {
      const db = normalizedToFaderDb(value);
      const round = faderDbToNormalized(db);
      expect(round).toBeCloseTo(value, 6);
    }
  });

  it("clamps non-finite inputs", () => {
    expect(faderDbToNormalized(Number.NaN)).toBe(0);
    expect(normalizedToFaderDb(Number.NaN)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe("snapFaderValue", () => {
  it("snaps a near-unity value to exactly AUDIO_FADER_UNITY", () => {
    expect(snapFaderValue(AUDIO_FADER_UNITY - 0.01)).toBe(AUDIO_FADER_UNITY);
    expect(snapFaderValue(AUDIO_FADER_UNITY + 0.01)).toBe(AUDIO_FADER_UNITY);
  });

  it("leaves values outside the snap window alone", () => {
    expect(snapFaderValue(0.5)).toBe(0.5);
    expect(snapFaderValue(0.95)).toBe(0.95);
  });

  it("clamps to [0, 1]", () => {
    expect(snapFaderValue(-1)).toBe(0);
    expect(snapFaderValue(2)).toBe(1);
  });
});

describe("normalizedToDbfs / dbfsToMeterPercent", () => {
  it("maps 1.0 to 0 dBFS and 0.0 to -Infinity", () => {
    expect(normalizedToDbfs(1)).toBe(0);
    expect(normalizedToDbfs(0)).toBe(Number.NEGATIVE_INFINITY);
  });

  it("maps -60 dBFS to 0% and 0 dBFS to 100% of the meter range", () => {
    expect(dbfsToMeterPercent(-60)).toBeCloseTo(0, 6);
    expect(dbfsToMeterPercent(0)).toBeCloseTo(100, 6);
  });

  it("clamps below floor and above ceiling", () => {
    expect(dbfsToMeterPercent(-120)).toBe(0);
    expect(dbfsToMeterPercent(6)).toBe(100);
  });

  it("treats non-finite dBFS as 0% (silence)", () => {
    expect(dbfsToMeterPercent(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(dbfsToMeterPercent(Number.NaN)).toBe(0);
  });
});

describe("formatMeterPercent", () => {
  it("emits a percentage string with one decimal", () => {
    expect(formatMeterPercent(1)).toBe("100.0%");
    expect(formatMeterPercent(0)).toBe("0.0%");
  });
});

describe("formatAudioDb / formatMeterDb", () => {
  it("formats unity as '0.0 dB' (no sign at zero)", () => {
    expect(formatAudioDb(AUDIO_FADER_UNITY)).toBe("0.0 dB");
  });

  it("formats above-unity values with a leading +", () => {
    // Full-up (normalized 1.0) = +6 dB on the documented curve.
    expect(formatAudioDb(1)).toBe("+6.0 dB");
  });

  it("formats negative values without a leading +", () => {
    // Half-fader is roughly -14 dB on this curve.
    const formatted = formatAudioDb(0.5);
    expect(formatted).toMatch(/^-\d+\.\d dB$/);
  });

  it("formats the bottom as the shared -∞ glyph", () => {
    expect(formatAudioDb(0)).toBe(AUDIO_DB_NEG_INFINITY);
    expect(formatMeterDb(0)).toBe(AUDIO_METER_NEG_INFINITY);
  });

  it("formats a full-scale meter value as '0'", () => {
    expect(formatMeterDb(1)).toBe("0");
  });
});

describe("meterTone", () => {
  it("returns 'red' when clip is set, regardless of value", () => {
    expect(meterTone(0.01, true)).toBe("red");
  });

  it("returns 'green' below the nominal threshold", () => {
    // 0.2 normalised ≈ -14 dBFS, which is above the nominal -18 dBFS
    // threshold but still in the green band.
    expect(meterTone(0.05)).toBe("green");
  });

  it("returns 'amber' between nominal and hot", () => {
    // 0.2 normalised ≈ -14 dBFS → amber.
    expect(meterTone(0.2)).toBe("amber");
  });

  it("returns 'hot' between hot and peak-warning", () => {
    // 0.6 normalised ≈ -4.4 dBFS → past hot (-6) but below warning (-3).
    expect(meterTone(0.6)).toBe("hot");
  });

  it("returns 'red' at or past the peak-warning threshold", () => {
    // 0.71 normalised ≈ -2.97 dBFS → red.
    expect(meterTone(0.71)).toBe("red");
  });
});

describe("deriveSendStatusLabel", () => {
  it("prefixes 'Active mix' when the send routes to the selected target", () => {
    expect(deriveSendStatusLabel({ isActive: true, noSend: false, sendMuted: false })).toBe("Active mix");
    expect(deriveSendStatusLabel({ isActive: true, noSend: false, sendMuted: true })).toBe("Active mix muted");
    expect(deriveSendStatusLabel({ isActive: true, noSend: true, sendMuted: false })).toBe("Active mix no send");
  });

  it("falls back to plain-language status when the send is inactive", () => {
    expect(deriveSendStatusLabel({ isActive: false, noSend: false, sendMuted: false })).toBe("Send");
    expect(deriveSendStatusLabel({ isActive: false, noSend: true, sendMuted: false })).toBe("No send");
    expect(deriveSendStatusLabel({ isActive: false, noSend: false, sendMuted: true })).toBe("Muted");
  });
});

describe("formatAudioRole", () => {
  it("maps the documented role tokens to operator labels", () => {
    expect(formatAudioRole("front-preamp")).toBe("Mic pre");
    expect(formatAudioRole("rear-line")).toBe("Rear line");
    expect(formatAudioRole("playback-pair")).toBe("Playback");
    expect(formatAudioRole("main-out")).toBe("Main out");
    expect(formatAudioRole("phones-a")).toBe("Phones A");
    expect(formatAudioRole("phones-b")).toBe("Phones B");
  });

  it("falls back to a humanised version of unknown roles", () => {
    expect(formatAudioRole("aux-send-1")).toBe("aux send 1");
  });
});
