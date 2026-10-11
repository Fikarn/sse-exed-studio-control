import { describe, expect, it } from "vitest";

import {
  formatPeakWellDbfs,
  METER_TRANSIENT_FALL_DB_PER_SECOND,
  type MeterDisplayTarget,
  peakWellLevel,
  updateMeterDisplayState,
} from "./audioMeterDisplayModel";

// R2-MOT-01 (round-2 audit): under prefers-reduced-motion the meters keep
// showing live telemetry, but the eased envelope-follower approach is
// decorative motion — `snap: true` bypasses it. Peak-hold semantics (hold
// window + fall rate) are data, not decoration, and must survive the snap.

function target(bodyDbfs: number, transientDbfs = bodyDbfs): MeterDisplayTarget {
  return {
    bodyLeftDbfs: bodyDbfs,
    bodyRightDbfs: bodyDbfs,
    transientLeftDbfs: transientDbfs,
    transientRightDbfs: transientDbfs,
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

// The Console's strip (2026-10-11, D50): the level is the solid bar, the peak a
// fainter segment over it, and the held peak is the peak's.
describe("updateMeterDisplayState: the peak's segment and the held peak", () => {
  const frame = 1 / 30;

  it("the peak's segment rises at once, falls at its own rate and never under the body", () => {
    const first = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1000,
      peakHoldEnabled: true,
      previous: undefined,
      target: target(-30, -12),
    });
    expect(first.transientLeftDbfs).toBe(-12);
    const falling = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1033,
      peakHoldEnabled: true,
      previous: first,
      target: target(-30, -40),
    });
    expect(falling.transientLeftDbfs).toBeCloseTo(-12 - METER_TRANSIENT_FALL_DB_PER_SECOND * frame, 5);
    const rising = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1066,
      peakHoldEnabled: true,
      previous: falling,
      target: target(-30, -6),
    });
    expect(rising.transientLeftDbfs).toBe(-6);
    // A body above the sample peak (a slower meter's lag) carries the segment with it.
    const under = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1100,
      peakHoldEnabled: true,
      previous: { ...rising, bodyLeftDbfs: -3 },
      snap: true,
      target: target(-3, -60),
    });
    expect(under.transientLeftDbfs).toBeGreaterThanOrEqual(under.bodyLeftDbfs);
  });

  it("holds the loudest sample peak, not the loudest body", () => {
    const first = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1000,
      peakHoldEnabled: true,
      previous: undefined,
      target: target(-30, -30),
    });
    const peak = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1033,
      peakHoldEnabled: true,
      previous: first,
      target: target(-30, -8),
    });
    expect(peak.peakLeftDbfs).toBe(-8);
    // The sample peak passes; the held peak stays inside its hold window.
    const after = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1066,
      peakHoldEnabled: true,
      previous: peak,
      target: target(-30, -30),
    });
    expect(after.peakLeftDbfs).toBe(-8);
    expect(after.transientLeftDbfs).toBeLessThan(-8);
  });

  it("without peak hold the line rides the peak's segment", () => {
    const first = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1000,
      peakHoldEnabled: false,
      previous: undefined,
      target: target(-30, -10),
    });
    const next = updateMeterDisplayState({
      deltaSeconds: frame,
      nowMs: 1033,
      peakHoldEnabled: false,
      previous: first,
      target: target(-30, -20),
    });
    expect(next.peakLeftDbfs).toBe(next.transientLeftDbfs);
  });
});

// The Console's strip (2026-10-11, D50): the held peak over each meter, a
// small number in whole dBFS that the painter writes when it changes.
describe("the peak well's words", () => {
  it("prints whole dBFS with the real minus, 0 at and over full scale, −∞ under the floor", () => {
    expect(formatPeakWellDbfs(-11.4)).toBe("−11");
    expect(formatPeakWellDbfs(-11.6)).toBe("−12");
    expect(formatPeakWellDbfs(-0.4)).toBe("0");
    expect(formatPeakWellDbfs(0)).toBe("0");
    expect(formatPeakWellDbfs(0.7)).toBe("0");
    expect(formatPeakWellDbfs(-60)).toBe("−60");
    expect(formatPeakWellDbfs(-60.5)).toBe("−∞");
    expect(formatPeakWellDbfs(Number.NEGATIVE_INFINITY)).toBe("−∞");
    expect(formatPeakWellDbfs(Number.NaN)).toBe("−∞");
  });

  it("is hot from the warning at −3 dBFS and quiet under the floor", () => {
    expect(peakWellLevel(-3)).toBe("hot");
    expect(peakWellLevel(-0.1)).toBe("hot");
    expect(peakWellLevel(-3.1)).toBe("live");
    expect(peakWellLevel(-60)).toBe("live");
    expect(peakWellLevel(-61)).toBe("floor");
    expect(peakWellLevel(Number.NEGATIVE_INFINITY)).toBe("floor");
  });
});
