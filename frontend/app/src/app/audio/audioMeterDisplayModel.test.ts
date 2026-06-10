import { describe, expect, it } from "vitest";

import { type MeterDisplayTarget, updateMeterDisplayState } from "./audioMeterDisplayModel";

// R2-MOT-01 (round-2 audit): under prefers-reduced-motion the meters keep
// showing live telemetry, but the eased envelope-follower approach is
// decorative motion — `snap: true` bypasses it. Peak-hold semantics (hold
// window + fall rate) are data, not decoration, and must survive the snap.

function target(bodyDbfs: number): MeterDisplayTarget {
  return {
    bodyLeftDbfs: bodyDbfs,
    bodyRightDbfs: bodyDbfs,
    channelPathClip: false,
    meterPointOverLeft: false,
    meterPointOverRight: false,
    peakWarning: false,
  };
}

describe("updateMeterDisplayState snap (reduced motion)", () => {
  it("eases toward the target by default (the ballistics)", () => {
    const first = updateMeterDisplayState({
      deltaSeconds: 0.033,
      nowMs: 1000,
      peakHoldEnabled: true,
      previous: undefined,
      target: target(-60),
    });
    const next = updateMeterDisplayState({
      deltaSeconds: 0.033,
      nowMs: 1033,
      peakHoldEnabled: true,
      previous: first,
      target: target(-6),
    });
    // One eased frame lands strictly between the previous value and the
    // target — that lag IS the decorative motion.
    expect(next.bodyLeftDbfs).toBeGreaterThan(-60);
    expect(next.bodyLeftDbfs).toBeLessThan(-6);
  });

  it("snap: true tracks the raw target with zero lag", () => {
    const first = updateMeterDisplayState({
      deltaSeconds: 0.033,
      nowMs: 1000,
      peakHoldEnabled: true,
      previous: undefined,
      target: target(-60),
    });
    const next = updateMeterDisplayState({
      deltaSeconds: 0.033,
      nowMs: 1033,
      peakHoldEnabled: true,
      previous: first,
      snap: true,
      target: target(-6),
    });
    expect(next.bodyLeftDbfs).toBe(-6);
    expect(next.bodyRightDbfs).toBe(-6);
  });

  it("snap preserves peak-hold semantics (hold window + peak >= body)", () => {
    const first = updateMeterDisplayState({
      deltaSeconds: 0.033,
      nowMs: 1000,
      peakHoldEnabled: true,
      previous: undefined,
      target: target(-6),
    });
    // Body falls back to -30; the held peak must stay at the -6 high-water
    // mark inside its hold window even while snapping.
    const next = updateMeterDisplayState({
      deltaSeconds: 0.033,
      nowMs: 1033,
      peakHoldEnabled: true,
      previous: first,
      snap: true,
      target: target(-30),
    });
    expect(next.bodyLeftDbfs).toBe(-30);
    expect(next.peakLeftDbfs).toBeGreaterThanOrEqual(-6.0001);
    expect(next.peakHoldUntilLeftMs).toBe(first.peakHoldUntilLeftMs);
  });
});
