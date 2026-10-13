import type { AudioMeterEntry } from "@sse/engine-client";

import { METER_PEAK_FALL_DB_PER_SECOND, METER_PEAK_HOLD_MS } from "./audioConstants";
import { AUDIO_METER_NEG_INFINITY, MINUS } from "./audioFormatting";

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
 *
 * The two layers (the Console's strip, 2026-10-11, D50): the level, the
 * hardware link's moving body, is the solid bar; the peak, its sample peak,
 * is a fainter segment above it that rises at once and falls at
 * `METER_TRANSIENT_FALL_DB_PER_SECOND`, faster than the held peak; the held
 * peak is taken from the peak, so it marks the loudest sample, not the
 * loudest body.
 */
export { METER_PEAK_FALL_DB_PER_SECOND, METER_PEAK_HOLD_MS };
export const METER_FLOOR_DBFS = -60;
export const METER_NOMINAL_DBFS = -18;
/** The warning, as the hardware link's `peakWarning`: from here a meter is hot. */
export const METER_HOT_DBFS = -3;
export const METER_ATTACK_SECONDS = 0.045;
export const METER_RELEASE_SECONDS = 0.34;
export const METER_MIN_DELTA_DB = 0.03;
/** The peak's segment falls at 40 dB/s, as the design board's did. */
export const METER_TRANSIENT_FALL_DB_PER_SECOND = 40;

export interface MeterDisplayTarget {
  bodyLeftDbfs: number;
  bodyRightDbfs: number;
  /** The sample peak, never below the body. */
  transientLeftDbfs: number;
  transientRightDbfs: number;
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

/** The held peak as a strip's well prints it: whole dBFS, the real minus, −∞ under the floor. */
export function formatPeakWellDbfs(dbfs: number) {
  if (!Number.isFinite(dbfs) || dbfs < METER_FLOOR_DBFS) return AUDIO_METER_NEG_INFINITY;
  const rounded = Math.min(0, Math.round(dbfs));
  return rounded < 0 ? `${MINUS}${-rounded}` : "0";
}

/** A well's level: `floor` under the meter's floor, `hot` from the warning, `live` between. */
export function peakWellLevel(dbfs: number): "floor" | "hot" | "live" {
  if (!Number.isFinite(dbfs) || dbfs < METER_FLOOR_DBFS) return "floor";
  return dbfs >= METER_HOT_DBFS ? "hot" : "live";
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
  const bodyLeftDbfs = maxMeterDbfs(entry.levelLeftDbfs);
  const bodyRightDbfs = mirrorRight ? bodyLeftDbfs : maxMeterDbfs(entry.levelRightDbfs);
  const transientLeftDbfs = maxMeterDbfs(bodyLeftDbfs, entry.peakLeftDbfs);
  const transientRightDbfs = mirrorRight ? transientLeftDbfs : maxMeterDbfs(bodyRightDbfs, entry.peakRightDbfs);
  const meterPointOverLeft = entry.meterPointOverLeft ?? entry.meterPointOver ?? false;
  const rawMeterPointOverRight = entry.meterPointOverRight ?? entry.meterPointOver ?? false;
  // The console's held clip, drawn over the meter until `audio.clip.clear`.
  const channelPathClip = entry.clip === true;

  return {
    bodyLeftDbfs,
    bodyRightDbfs,
    transientLeftDbfs,
    transientRightDbfs,
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
  const bodyRightDbfs = mirrorRight ? bodyLeftDbfs : normalizedToMeterDbfs(fallbackRight);
  return {
    bodyLeftDbfs,
    bodyRightDbfs,
    transientLeftDbfs: bodyLeftDbfs,
    transientRightDbfs: bodyRightDbfs,
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

// The peak's segment: up at once, then down at its own rate, and never under
// the body it stands on.
function nextTransientDbfs(previous: number, target: number, bodyDbfs: number, deltaSeconds: number) {
  const clampedTarget = clampMeterDbfs(target);
  const fallen = clampMeterDbfs(previous) - METER_TRANSIENT_FALL_DB_PER_SECOND * deltaSeconds;
  return Math.max(clampMeterDbfs(bodyDbfs), clampedTarget, fallen);
}

// The held peak of what it is given: the peak's segment.
function nextPeakHoldDbfs({
  sourceDbfs,
  deltaSeconds,
  holdUntilMs,
  nowMs,
  previousPeakDbfs,
}: {
  sourceDbfs: number;
  deltaSeconds: number;
  holdUntilMs: number;
  nowMs: number;
  previousPeakDbfs: number;
}) {
  const clampedSourceDbfs = clampMeterDbfs(sourceDbfs);
  const clampedPreviousPeakDbfs = clampMeterDbfs(previousPeakDbfs);

  if (clampedSourceDbfs >= clampedPreviousPeakDbfs - METER_MIN_DELTA_DB) {
    return {
      holdUntilMs: nowMs + METER_PEAK_HOLD_MS,
      peakDbfs: clampedSourceDbfs,
    };
  }

  if (nowMs <= holdUntilMs) {
    return {
      holdUntilMs,
      peakDbfs: Math.max(clampedPreviousPeakDbfs, clampedSourceDbfs),
    };
  }

  return {
    holdUntilMs,
    peakDbfs: Math.max(clampedSourceDbfs, clampedPreviousPeakDbfs - METER_PEAK_FALL_DB_PER_SECOND * deltaSeconds),
  };
}

export function updateMeterDisplayState({
  deltaSeconds,
  nowMs,
  peakHoldEnabled,
  previous,
  snap = false,
  target,
}: {
  deltaSeconds: number;
  nowMs: number;
  peakHoldEnabled: boolean;
  previous: MeterDisplayState | undefined;
  /** R2-MOT-01: under prefers-reduced-motion the meters must keep showing
   *  live telemetry, but the eased envelope-follower approach is decorative
   *  motion layered on the data — `snap` bypasses it so the body tracks the
   *  raw value frame-to-frame. Peak-hold semantics (hold window + fall rate)
   *  are data, not decoration, and stay as-is. */
  snap?: boolean;
  target: MeterDisplayTarget;
}): MeterDisplayState {
  if (!previous) {
    return {
      ...target,
      peakHoldUntilLeftMs: nowMs + METER_PEAK_HOLD_MS,
      peakHoldUntilRightMs: nowMs + METER_PEAK_HOLD_MS,
      peakLeftDbfs: target.transientLeftDbfs,
      peakRightDbfs: target.transientRightDbfs,
    };
  }

  const nextBodyLeftDbfs = snap
    ? target.bodyLeftDbfs
    : approachDbfs(previous.bodyLeftDbfs, target.bodyLeftDbfs, deltaSeconds);
  const nextBodyRightDbfs = snap
    ? target.bodyRightDbfs
    : approachDbfs(previous.bodyRightDbfs, target.bodyRightDbfs, deltaSeconds);
  const nextTransientLeftDbfs = nextTransientDbfs(
    previous.transientLeftDbfs,
    target.transientLeftDbfs,
    nextBodyLeftDbfs,
    deltaSeconds
  );
  const nextTransientRightDbfs = nextTransientDbfs(
    previous.transientRightDbfs,
    target.transientRightDbfs,
    nextBodyRightDbfs,
    deltaSeconds
  );

  if (!peakHoldEnabled) {
    return {
      ...target,
      bodyLeftDbfs: nextBodyLeftDbfs,
      bodyRightDbfs: nextBodyRightDbfs,
      transientLeftDbfs: nextTransientLeftDbfs,
      transientRightDbfs: nextTransientRightDbfs,
      peakHoldUntilLeftMs: nowMs,
      peakHoldUntilRightMs: nowMs,
      peakLeftDbfs: nextTransientLeftDbfs,
      peakRightDbfs: nextTransientRightDbfs,
    };
  }

  const nextPeakLeft = nextPeakHoldDbfs({
    sourceDbfs: nextTransientLeftDbfs,
    deltaSeconds,
    holdUntilMs: previous.peakHoldUntilLeftMs,
    nowMs,
    previousPeakDbfs: previous.peakLeftDbfs,
  });
  const nextPeakRight = nextPeakHoldDbfs({
    sourceDbfs: nextTransientRightDbfs,
    deltaSeconds,
    holdUntilMs: previous.peakHoldUntilRightMs,
    nowMs,
    previousPeakDbfs: previous.peakRightDbfs,
  });

  return {
    bodyLeftDbfs: nextBodyLeftDbfs,
    bodyRightDbfs: nextBodyRightDbfs,
    transientLeftDbfs: nextTransientLeftDbfs,
    transientRightDbfs: nextTransientRightDbfs,
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
