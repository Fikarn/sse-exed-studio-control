import { expect, test } from "@playwright/test";

import {
  applyBallistics,
  applyBallisticsReducedMotion,
  CLIP_LATCH_DEFAULT_MS,
  CLIP_THRESHOLD_LEVEL,
  DEFAULT_PRESET,
  INITIAL_METER_STATE,
  PEAK_HOLD_DEFAULT_MS,
  dbToLevel,
  isClipLatched,
  levelToDb,
  releaseDbPerSecond,
} from "../src/app/audio/meters/ballistics";
import type { BallisticsPreset, MeterSample } from "../src/app/audio/meters/types";

function sampleAt(level: number, clip = false): MeterSample {
  return { l: level, r: level, peakL: level, peakR: level, clip, timestampMs: 0 };
}

const PPM_I: BallisticsPreset = { kind: "ppm-i" };
const PPM_IIA: BallisticsPreset = { kind: "ppm-iia" };
const PPM_IIB: BallisticsPreset = { kind: "ppm-iib" };
const VU: BallisticsPreset = { kind: "vu", attackMs: 300, releaseMs: 300 };
const K12: BallisticsPreset = { kind: "k-system", reference: 12 };

const HARD_RISE_PRESETS: ReadonlyArray<{ name: string; preset: BallisticsPreset }> = [
  { name: "digital-peak", preset: DEFAULT_PRESET },
  { name: "ppm-i", preset: PPM_I },
  { name: "ppm-iia", preset: PPM_IIA },
  { name: "ppm-iib", preset: PPM_IIB },
  { name: "k-12", preset: K12 },
];

test("hard-rise presets snap to peak instantly on a louder sample", () => {
  for (const { name, preset } of HARD_RISE_PRESETS) {
    const prev = { ...INITIAL_METER_STATE, level: dbToLevel(-30) };
    const next = applyBallistics(prev, sampleAt(dbToLevel(-3)), 33, preset, 1_000);
    expect(next.level, `${name} should snap up`).toBeCloseTo(dbToLevel(-3), 6);
  }
});

test("digital-peak release follows the configured slope within ±0.1 dB", () => {
  const startDb = -3;
  const dropSeconds = 1;
  const expectedNextDb = startDb - DEFAULT_PRESET.releaseDbPerSec * dropSeconds;
  const prev = {
    ...INITIAL_METER_STATE,
    level: dbToLevel(startDb),
    peakHold: dbToLevel(startDb),
    peakHoldExpiresMs: 0,
  };
  const next = applyBallistics(prev, sampleAt(0), dropSeconds * 1000, DEFAULT_PRESET, 5_000);
  const nextDb = levelToDb(next.level);
  expect(nextDb).toBeGreaterThanOrEqual(expectedNextDb - 0.1);
  expect(nextDb).toBeLessThanOrEqual(expectedNextDb + 0.1);
});

test("ppm-iia release follows 8.6 dB/s within ±0.1 dB over a half-second interval", () => {
  const startDb = -6;
  const dropSeconds = 0.5;
  const expectedDb = startDb - 8.6 * dropSeconds;
  const prev = { ...INITIAL_METER_STATE, level: dbToLevel(startDb) };
  const next = applyBallistics(prev, sampleAt(0), dropSeconds * 1000, PPM_IIA, 1_000);
  const nextDb = levelToDb(next.level);
  expect(nextDb).toBeGreaterThanOrEqual(expectedDb - 0.1);
  expect(nextDb).toBeLessThanOrEqual(expectedDb + 0.1);
});

test("ppm-i release rate is faster than ppm-iia at the same start", () => {
  expect(releaseDbPerSecond(PPM_I)).toBeGreaterThan(releaseDbPerSecond(PPM_IIA));
});

test("peak hold survives its hold window and then decays", () => {
  const startDb = -6;
  const prev = {
    ...INITIAL_METER_STATE,
    level: dbToLevel(startDb),
    peakHold: dbToLevel(startDb),
    peakHoldExpiresMs: 2_000,
  };

  const midHold = applyBallistics(prev, sampleAt(0), 200, DEFAULT_PRESET, 1_500);
  expect(midHold.peakHold).toBeCloseTo(dbToLevel(startDb), 6);

  const afterHold = applyBallistics(
    { ...midHold, peakHold: dbToLevel(startDb), peakHoldExpiresMs: 2_000 },
    sampleAt(0),
    500,
    DEFAULT_PRESET,
    2_600
  );
  expect(afterHold.peakHold).toBeLessThan(dbToLevel(startDb));
});

test("clip latch fires when the sample reports clip and persists for the latch duration", () => {
  const prev = { ...INITIAL_METER_STATE };
  const next = applyBallistics(prev, sampleAt(dbToLevel(-1), true), 33, DEFAULT_PRESET, 1_000);
  expect(next.clipLatchExpiresMs).toBe(1_000 + CLIP_LATCH_DEFAULT_MS);
  expect(isClipLatched(next, 1_500)).toBe(true);
  expect(isClipLatched(next, 1_000 + CLIP_LATCH_DEFAULT_MS + 1)).toBe(false);
});

test("clip latch fires when the input crosses the clip threshold without an explicit flag", () => {
  const prev = { ...INITIAL_METER_STATE };
  const next = applyBallistics(prev, sampleAt(CLIP_THRESHOLD_LEVEL), 33, DEFAULT_PRESET, 500);
  expect(next.clipLatchExpiresMs).toBeGreaterThan(0);
});

test("vu preset smooths attack and release symmetrically toward the input", () => {
  const prev = { ...INITIAL_METER_STATE, level: 0 };
  const targetLevel = 0.6;
  const after100ms = applyBallistics(prev, sampleAt(targetLevel), 100, VU, 0);
  expect(after100ms.level).toBeGreaterThan(0);
  expect(after100ms.level).toBeLessThan(targetLevel);
  const after400ms = applyBallistics(after100ms, sampleAt(targetLevel), 300, VU, 0);
  expect(after400ms.level).toBeGreaterThan(after100ms.level);
  expect(after400ms.level).toBeLessThan(targetLevel);
});

test("reduced-motion variant snaps level to input every tick", () => {
  const prev = { ...INITIAL_METER_STATE, level: 0.8 };
  const next = applyBallisticsReducedMotion(prev, sampleAt(0.2), 33, DEFAULT_PRESET, 0);
  expect(next.level).toBe(0.2);

  const rebound = applyBallisticsReducedMotion(next, sampleAt(0.6), 33, DEFAULT_PRESET, 33);
  expect(rebound.level).toBe(0.6);
});

test("reduced-motion variant still latches clip for the full duration", () => {
  const prev = { ...INITIAL_METER_STATE };
  const next = applyBallisticsReducedMotion(prev, sampleAt(0.5, true), 33, DEFAULT_PRESET, 200);
  expect(next.clipLatchExpiresMs).toBe(200 + CLIP_LATCH_DEFAULT_MS);
  expect(isClipLatched(next, 200 + CLIP_LATCH_DEFAULT_MS - 1)).toBe(true);
});

test("DEFAULT_PRESET parameters match the spec", () => {
  expect(DEFAULT_PRESET.kind).toBe("digital-peak");
  if (DEFAULT_PRESET.kind === "digital-peak") {
    expect(DEFAULT_PRESET.releaseDbPerSec).toBe(20);
    expect(DEFAULT_PRESET.peakHoldMs).toBe(PEAK_HOLD_DEFAULT_MS);
    expect(DEFAULT_PRESET.clipLatchMs).toBe(CLIP_LATCH_DEFAULT_MS);
  }
});

test("level/db conversion round-trips within machine precision", () => {
  for (const db of [-60, -36, -24, -12, -6, -3, -1, 0]) {
    const level = dbToLevel(db);
    expect(levelToDb(level)).toBeCloseTo(db, 6);
  }
  expect(dbToLevel(Number.NEGATIVE_INFINITY)).toBe(0);
  expect(levelToDb(0)).toBe(Number.NEGATIVE_INFINITY);
});
