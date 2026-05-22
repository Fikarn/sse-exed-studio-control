import type { AudioMeterEntry } from "@sse/engine-client";

import { METER_PEAK_FALL_DB_PER_SECOND, METER_PEAK_HOLD_MS } from "./audioConstants";

/**
 * Frontend display-ballistics for the audio meter canvas.
 *
 * Peak ballistics target IEC PPM Type IIa hardware behaviour:
 * - hold ~1.5 s before the peak indicator starts to fall
 * - decay 12–15 dB·s⁻¹ once falling
 *
 * `METER_PEAK_HOLD_MS` and `METER_PEAK_FALL_DB_PER_SECOND` are re-exported from
 * `audioConstants.ts` so the values stay aligned with the Rust engine's
 * `CONSOLE_PEAK_HOLD_MS` constant in
 * `native/rust-engine/src/rme_totalmix_osc.rs:33`. Keep both sides in sync
 * when the hardware reference changes; the engine drives the same hold window
 * for OSC meter packets and the UI must not diverge from it visually.
 */
export { METER_PEAK_FALL_DB_PER_SECOND, METER_PEAK_HOLD_MS };
export const METER_FLOOR_DBFS = -60;
export const METER_NOMINAL_DBFS = -18;
export const METER_ATTACK_SECONDS = 0.045;
export const METER_RELEASE_SECONDS = 0.34;
export const METER_MIN_DELTA_DB = 0.03;

export interface MeterDisplayTarget {
  bodyLeftDbfs: number;
  bodyRightDbfs: number;
  channelPathClip: boolean;
  meterPointOverLeft: boolean;
  meterPointOverRight: boolean;
  peakWarning: boolean;
}

export interface MeterDisplayState extends MeterDisplayTarget {
  peakHoldUntilLeftMs: number;
  peakHoldUntilRightMs: number;
  peakLeftDbfs: number;
  peakRightDbfs: number;
}

export function dbfsToMeterPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, ((value - METER_FLOOR_DBFS) / Math.abs(METER_FLOOR_DBFS)) * 100));
}

export function clampMeterDbfs(value: number) {
  if (!Number.isFinite(value)) return METER_FLOOR_DBFS;
  return Math.max(METER_FLOOR_DBFS, Math.min(0, value));
}

export function normalizedToMeterDbfs(value: number) {
  if (!Number.isFinite(value) || value <= 0) return METER_FLOOR_DBFS;
  return clampMeterDbfs(20 * Math.log10(Math.max(0, Math.min(1, value))));
}

export function maxMeterDbfs(...values: Array<number | null | undefined>) {
  return values.reduce<number>(
    (max, value) => Math.max(max, clampMeterDbfs(value ?? METER_FLOOR_DBFS)),
    METER_FLOOR_DBFS
  );
}

export function meterDisplayTargetFromEntry(entry: AudioMeterEntry, mirrorRight = false): MeterDisplayTarget {
  const bodyLeftDbfs = maxMeterDbfs(entry.levelLeftDbfs, entry.rmsLeftDbfs);
  const bodyRightDbfs = mirrorRight ? bodyLeftDbfs : maxMeterDbfs(entry.levelRightDbfs, entry.rmsRightDbfs);
  const meterPointOverLeft = entry.meterPointOverLeft ?? entry.overLeft ?? entry.meterPointOver ?? entry.over ?? false;
  const rawMeterPointOverRight =
    entry.meterPointOverRight ?? entry.overRight ?? entry.meterPointOver ?? entry.over ?? false;
  const channelPathClip =
    entry.channelPathClip === true ||
    entry.channelPathClipHold === true ||
    entry.clipHold === true ||
    entry.clip === true;

  return {
    bodyLeftDbfs,
    bodyRightDbfs,
    channelPathClip,
    meterPointOverLeft,
    meterPointOverRight: mirrorRight ? meterPointOverLeft : rawMeterPointOverRight,
    peakWarning: entry.peakWarning === true,
  };
}

export function meterDisplayTargetFromNormalized(
  fallbackLeft: number,
  fallbackRight: number,
  mirrorRight = false
): MeterDisplayTarget {
  const bodyLeftDbfs = normalizedToMeterDbfs(fallbackLeft);
  return {
    bodyLeftDbfs,
    bodyRightDbfs: mirrorRight ? bodyLeftDbfs : normalizedToMeterDbfs(fallbackRight),
    channelPathClip: false,
    meterPointOverLeft: false,
    meterPointOverRight: false,
    peakWarning: false,
  };
}

function approachDbfs(previous: number, target: number, deltaSeconds: number, releaseSeconds = METER_RELEASE_SECONDS) {
  const clampedPrevious = clampMeterDbfs(previous);
  const clampedTarget = clampMeterDbfs(target);
  if (Math.abs(clampedTarget - clampedPrevious) <= METER_MIN_DELTA_DB) {
    return clampedTarget;
  }

  const timeConstant = clampedTarget >= clampedPrevious ? METER_ATTACK_SECONDS : releaseSeconds;
  const alpha = 1 - Math.exp(-Math.max(0.001, deltaSeconds) / timeConstant);
  return clampMeterDbfs(clampedPrevious + (clampedTarget - clampedPrevious) * alpha);
}

function nextPeakHoldDbfs({
  bodyDbfs,
  deltaSeconds,
  holdUntilMs,
  nowMs,
  previousPeakDbfs,
}: {
  bodyDbfs: number;
  deltaSeconds: number;
  holdUntilMs: number;
  nowMs: number;
  previousPeakDbfs: number;
}) {
  const clampedBodyDbfs = clampMeterDbfs(bodyDbfs);
  const clampedPreviousPeakDbfs = clampMeterDbfs(previousPeakDbfs);

  if (clampedBodyDbfs >= clampedPreviousPeakDbfs - METER_MIN_DELTA_DB) {
    return {
      holdUntilMs: nowMs + METER_PEAK_HOLD_MS,
      peakDbfs: clampedBodyDbfs,
    };
  }

  if (nowMs <= holdUntilMs) {
    return {
      holdUntilMs,
      peakDbfs: Math.max(clampedPreviousPeakDbfs, clampedBodyDbfs),
    };
  }

  return {
    holdUntilMs,
    peakDbfs: Math.max(clampedBodyDbfs, clampedPreviousPeakDbfs - METER_PEAK_FALL_DB_PER_SECOND * deltaSeconds),
  };
}

export function updateMeterDisplayState({
  deltaSeconds,
  nowMs,
  peakHoldEnabled,
  previous,
  target,
}: {
  deltaSeconds: number;
  nowMs: number;
  peakHoldEnabled: boolean;
  previous: MeterDisplayState | undefined;
  target: MeterDisplayTarget;
}): MeterDisplayState {
  if (!previous) {
    return {
      ...target,
      peakHoldUntilLeftMs: nowMs + METER_PEAK_HOLD_MS,
      peakHoldUntilRightMs: nowMs + METER_PEAK_HOLD_MS,
      peakLeftDbfs: target.bodyLeftDbfs,
      peakRightDbfs: target.bodyRightDbfs,
    };
  }

  const nextBodyLeftDbfs = approachDbfs(previous.bodyLeftDbfs, target.bodyLeftDbfs, deltaSeconds);
  const nextBodyRightDbfs = approachDbfs(previous.bodyRightDbfs, target.bodyRightDbfs, deltaSeconds);

  if (!peakHoldEnabled) {
    return {
      ...target,
      bodyLeftDbfs: nextBodyLeftDbfs,
      bodyRightDbfs: nextBodyRightDbfs,
      peakHoldUntilLeftMs: nowMs,
      peakHoldUntilRightMs: nowMs,
      peakLeftDbfs: nextBodyLeftDbfs,
      peakRightDbfs: nextBodyRightDbfs,
    };
  }

  const nextPeakLeft = nextPeakHoldDbfs({
    bodyDbfs: nextBodyLeftDbfs,
    deltaSeconds,
    holdUntilMs: previous.peakHoldUntilLeftMs,
    nowMs,
    previousPeakDbfs: previous.peakLeftDbfs,
  });
  const nextPeakRight = nextPeakHoldDbfs({
    bodyDbfs: nextBodyRightDbfs,
    deltaSeconds,
    holdUntilMs: previous.peakHoldUntilRightMs,
    nowMs,
    previousPeakDbfs: previous.peakRightDbfs,
  });

  return {
    bodyLeftDbfs: nextBodyLeftDbfs,
    bodyRightDbfs: nextBodyRightDbfs,
    channelPathClip: target.channelPathClip,
    meterPointOverLeft: target.meterPointOverLeft,
    meterPointOverRight: target.meterPointOverRight,
    peakHoldUntilLeftMs: nextPeakLeft.holdUntilMs,
    peakHoldUntilRightMs: nextPeakRight.holdUntilMs,
    peakLeftDbfs: nextPeakLeft.peakDbfs,
    peakRightDbfs: nextPeakRight.peakDbfs,
    peakWarning: target.peakWarning,
  };
}
