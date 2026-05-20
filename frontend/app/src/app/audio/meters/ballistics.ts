import type { BallisticsPreset, MeterSample, MeterState } from "./types";

export const DB_FLOOR = -120;
export const CLIP_LATCH_DEFAULT_MS = 1500;
export const PEAK_HOLD_DEFAULT_MS = 1500;
export const CLIP_THRESHOLD_LEVEL = 0.99526; // ≈ -0.04 dBFS, matches engine's 0.985+ clip range

export const DEFAULT_PRESET: BallisticsPreset = {
  kind: "digital-peak",
  releaseDbPerSec: 20,
  peakHoldMs: PEAK_HOLD_DEFAULT_MS,
  clipLatchMs: CLIP_LATCH_DEFAULT_MS,
};

export const INITIAL_METER_STATE: MeterState = {
  level: 0,
  peakHold: 0,
  peakHoldExpiresMs: 0,
  clipLatchExpiresMs: 0,
};

export function levelToDb(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(level);
}

export function dbToLevel(db: number): number {
  if (!Number.isFinite(db) || db <= DB_FLOOR) return 0;
  return Math.pow(10, db / 20);
}

export function releaseDbPerSecond(preset: BallisticsPreset): number {
  switch (preset.kind) {
    case "digital-peak":
      return preset.releaseDbPerSec;
    case "ppm-i":
      return 11.8;
    case "ppm-iia":
      return 8.6;
    case "ppm-iib":
      return 8.6;
    case "vu":
      return 0;
    case "k-system":
      return 20;
  }
}

export function peakHoldMs(preset: BallisticsPreset): number {
  switch (preset.kind) {
    case "digital-peak":
      return preset.peakHoldMs;
    case "k-system":
      return PEAK_HOLD_DEFAULT_MS;
    case "ppm-i":
    case "ppm-iia":
    case "ppm-iib":
    case "vu":
      return 0;
  }
}

export function clipLatchMs(preset: BallisticsPreset): number {
  if (preset.kind === "digital-peak") return preset.clipLatchMs;
  return CLIP_LATCH_DEFAULT_MS;
}

function decayLevelByDb(level: number, dbDrop: number, floor: number): number {
  if (level <= 0) return 0;
  const currentDb = levelToDb(level);
  if (!Number.isFinite(currentDb)) return 0;
  const nextDb = currentDb - dbDrop;
  if (nextDb <= DB_FLOOR) return 0;
  return Math.max(floor, dbToLevel(nextDb));
}

function onePoleStep(current: number, target: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return target;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return current + alpha * (target - current);
}

export function applyBallistics(
  prev: MeterState,
  sample: MeterSample,
  dtMs: number,
  preset: BallisticsPreset,
  nowMs: number
): MeterState {
  const inputLevel = Math.max(0, Math.max(sample.l, sample.r));
  let level = prev.level;

  if (preset.kind === "vu") {
    const attackTau = preset.attackMs;
    const releaseTau = preset.releaseMs;
    const tau = inputLevel > level ? attackTau : releaseTau;
    level = onePoleStep(level, inputLevel, dtMs, tau);
  } else {
    if (inputLevel >= level) {
      level = inputLevel;
    } else {
      const dropDb = releaseDbPerSecond(preset) * (dtMs / 1000);
      level = decayLevelByDb(level, dropDb, inputLevel);
    }
  }

  let peakHold = prev.peakHold;
  let peakHoldExpiresMs = prev.peakHoldExpiresMs;
  const holdMs = peakHoldMs(preset);
  if (holdMs > 0) {
    if (inputLevel > peakHold) {
      peakHold = inputLevel;
      peakHoldExpiresMs = nowMs + holdMs;
    } else if (nowMs >= peakHoldExpiresMs) {
      const dropDb = releaseDbPerSecond(preset) * (dtMs / 1000);
      peakHold = Math.max(level, decayLevelByDb(peakHold, dropDb, level));
    }
  } else {
    peakHold = level;
    peakHoldExpiresMs = 0;
  }

  let clipLatchExpiresMs = prev.clipLatchExpiresMs;
  if (sample.clip || inputLevel >= CLIP_THRESHOLD_LEVEL) {
    clipLatchExpiresMs = nowMs + clipLatchMs(preset);
  }

  return { level, peakHold, peakHoldExpiresMs, clipLatchExpiresMs };
}

export function applyBallisticsReducedMotion(
  prev: MeterState,
  sample: MeterSample,
  _dtMs: number,
  preset: BallisticsPreset,
  nowMs: number
): MeterState {
  const inputLevel = Math.max(0, Math.max(sample.l, sample.r));
  const level = inputLevel;

  let peakHold = Math.max(prev.peakHold, inputLevel);
  let peakHoldExpiresMs = prev.peakHoldExpiresMs;
  const holdMs = peakHoldMs(preset);
  if (holdMs > 0) {
    if (inputLevel > prev.peakHold) {
      peakHoldExpiresMs = nowMs + holdMs;
    } else if (nowMs >= peakHoldExpiresMs) {
      peakHold = inputLevel;
      peakHoldExpiresMs = 0;
    }
  } else {
    peakHold = level;
    peakHoldExpiresMs = 0;
  }

  let clipLatchExpiresMs = prev.clipLatchExpiresMs;
  if (sample.clip || inputLevel >= CLIP_THRESHOLD_LEVEL) {
    clipLatchExpiresMs = nowMs + clipLatchMs(preset);
  }

  return { level, peakHold, peakHoldExpiresMs, clipLatchExpiresMs };
}

export function isClipLatched(state: MeterState, nowMs: number): boolean {
  return state.clipLatchExpiresMs > nowMs;
}
