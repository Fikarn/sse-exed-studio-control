import { describe, expect, it } from "vitest";

import { identifyFlashMoments } from "./identifyFlashes";

// The moments at which an Identify or a Find changes what the lighting state
// shows, read from the hardware link's replies (`E/lighting/types.rs`:
// `LightingFixtureIdentifyResult`, `LightingFixtureIdentifySequenceResult`).
describe("identifyFlashMoments", () => {
  it("an Identify changes the lighting state once, when its flash ends", () => {
    expect(identifyFlashMoments({ fixtureId: "fixture-back", durationMs: 1200, summary: "…" })).toEqual([1200]);
  });

  it("a Find changes it as each flash after the first starts, and as each one ends", () => {
    // Three flashes 400 ms apart, 1.2 s each: they start at 0, 400 and 800 and
    // end at 1200, 1600 and 2000.
    expect(identifyFlashMoments({ fixtureCount: 3, stepMs: 400, durationMs: 1200, totalDurationMs: 2000 })).toEqual([
      400, 800, 1200, 1600, 2000,
    ]);
    // A step as long as a flash: each flash ends as the next one starts.
    expect(identifyFlashMoments({ fixtureCount: 3, stepMs: 500, durationMs: 500 })).toEqual([500, 1000, 1500]);
    expect(identifyFlashMoments({ fixtureCount: 1, stepMs: 400, durationMs: 1200 })).toEqual([1200]);
  });

  it("a Find stops at the hardware link's 64 fixtures", () => {
    const moments = identifyFlashMoments({ fixtureCount: 200, stepMs: 100, durationMs: 100 });
    expect(moments.at(-1)).toBe(64 * 100);
  });

  it("anything else gives no moment", () => {
    expect(identifyFlashMoments(null)).toEqual([]);
    expect(identifyFlashMoments([1200])).toEqual([]);
    expect(identifyFlashMoments({ summary: "Cleared 2 identify bursts." })).toEqual([]);
    expect(identifyFlashMoments({ durationMs: "1200" })).toEqual([]);
    expect(identifyFlashMoments({ durationMs: 0 })).toEqual([]);
    expect(identifyFlashMoments({ fixtureCount: 0, stepMs: 400, durationMs: 1200 })).toEqual([]);
  });
});
