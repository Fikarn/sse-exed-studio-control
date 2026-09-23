// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import { faderLinToDb } from "../../audio/faderCurve";
import { clampNumber } from "./lighting";
import type { JsonObject, JsonValue } from "../../generated/protocol";
import { asString, asArray, asRecord, asBoolean, asNumber } from "./json";
import type { MutableFixtureState } from "./state";

export interface AudioMeterFrame {
  clip: boolean;
  meterLeft: number;
  meterLevel: number;
  meterRight: number;
  peakHold: number;
  peakHoldLeft: number;
  peakHoldRight: number;
}

export interface AudioMeterState {
  bodyLeft: number;
  bodyRight: number;
  clipUntilMs: number;
  holdLeftUntilMs: number;
  holdRightUntilMs: number;
  peakHoldLeft: number;
  peakHoldRight: number;
  updatedAtMs: number;
}

export const AUDIO_METERING_TICK_MS = 33;
export const AUDIO_METERING_CADENCE_HZ = 30;
export const AUDIO_METER_FLOOR_DBFS = -60;
export const AUDIO_METER_PEAK_WARNING_DBFS = -3;
export const AUDIO_METER_OVER_DBFS = 0;
export const AUDIO_METER_POINT_INPUT = "input";
export const AUDIO_METER_POINT_PLAYBACK = "playback";
export const AUDIO_METER_POINT_POST_FADER = "post-fader";
export const FAIRLIGHT_PEAK_HOLD_MS = 1500;
export const FAIRLIGHT_PEAK_FALL_DB_PER_SECOND = 20;
export const SIMULATED_AUDIO_ADAPTER_MODES = new Set(["fixture", "simulated"]);

export function normalizedToDbfs(value: number) {
  const normalized = Math.max(0, Math.min(1, value));
  if (normalized <= 0) return AUDIO_METER_FLOOR_DBFS;
  return Math.max(AUDIO_METER_FLOOR_DBFS, Math.min(0, 20 * Math.log10(normalized)));
}

export function dbfsToNormalized(dbfs: number) {
  if (!Number.isFinite(dbfs)) return 0;
  return 10 ** (Math.max(AUDIO_METER_FLOOR_DBFS, Math.min(0, dbfs)) / 20);
}

// Simulated submix gain follows RME's fader curve (audio/faderCurve.ts), the
// same law the engine's simulated metering uses (audio/snapshot.rs).
export function totalMixFaderGain(value: number) {
  const db = faderLinToDb(clampNumber(value, 0, 1));
  return Number.isFinite(db) ? 10 ** (db / 20) : 0;
}

export function audioChannelSeed(id: string) {
  let seed = 0;
  for (let index = 0; index < id.length; index += 1) {
    seed = (seed * 33 + id.charCodeAt(index)) >>> 0;
  }
  return seed;
}

export function audioChannelIndex(id: string, seed: number) {
  const raw = id.split("-").at(-1);
  const parsed = raw ? Number.parseFloat(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : seed % 11;
}

export function lfo(t: number, hz: number, offset: number) {
  return Math.sin(t * hz * Math.PI * 2 + offset);
}

export function pulse(phase: number, center: number, width: number) {
  const distance = Math.abs((phase - center) / width);
  if (distance >= 1) return 0;
  const shaped = 1 - distance;
  return shaped * shaped * (3 - 2 * shaped);
}

export function simulatedSpeechPair(t: number, channelIndex: number, floor: number, range: number) {
  const period = 8.7 + (channelIndex % 4) * 0.9;
  const phase = (((t + channelIndex * 1.37) % period) + period) % period;
  const syllables =
    pulse(phase, 0.72, 0.28) +
    0.92 * pulse(phase, 1.24, 0.22) +
    0.78 * pulse(phase, 2.02, 0.34) +
    0.68 * pulse(phase, 4.58, 0.4) +
    0.86 * pulse(phase, 5.42, 0.3);
  const breath = 0.032 * lfo(t, 0.62, channelIndex * 0.43);
  const consonants = 0.035 * lfo(t, 5.4, channelIndex);
  const level = clampNumber(floor + range * Math.min(syllables / 1.8, 1) + breath + consonants, 0.08, 0.9);
  const sideOffset = 0.025 * lfo(t, 1.7, channelIndex * 0.25);
  return [level, clampNumber(level * 0.88 + sideOffset, 0.05, 0.86)] as const;
}

export function simulatedLevelPairAt(elapsedMs: number, id: string, role: string, stereo: boolean) {
  const seed = audioChannelSeed(id);
  const t = elapsedMs / 1000 + seed / 307;
  const channelIndex = audioChannelIndex(id, seed);

  let left: number;
  let right: number;
  if (role === "front-preamp") {
    [left, right] = simulatedSpeechPair(t, channelIndex, 0.34, 0.56);
  } else if (role === "rear-line") {
    const base = id.includes("remote") || id.endsWith("-3") || id.endsWith("-4") ? 0.14 : 0.09;
    const motion = 0.045 * lfo(t, 0.41, 0) + 0.026 * lfo(t, 1.2, 0.7);
    left = clampNumber(base + motion, 0.04, 0.28);
    right = left * 0.9;
  } else if (id === "audio-playback-1-2") {
    const body = 0.48 + 0.065 * lfo(t, 0.22, 0) + 0.032 * lfo(t, 1.1, 1.2);
    const width = 0.04 * lfo(t, 0.53, 0.4);
    left = clampNumber(body - width, 0.28, 0.72);
    right = clampNumber(body + width, 0.3, 0.74);
  } else if (id === "audio-playback-3-4") {
    const sting = pulse(t % 11, 1.1, 0.22) + 0.72 * pulse(t % 11, 6.7, 0.32);
    const bed = 0.07 + 0.02 * lfo(t, 0.9, 0);
    left = clampNumber(bed + 0.62 * sting, 0.04, 0.84);
    right = clampNumber(bed * 0.92 + 0.56 * sting + 0.02 * lfo(t, 2.1, 0.8), 0.04, 0.8);
  } else if (id === "audio-playback-5-6") {
    [left, right] = simulatedSpeechPair(t + 3.7, channelIndex, 0.16, 0.32);
  } else if (id === "audio-playback-7-8") {
    const groove = 0.34 + 0.12 * lfo(t, 0.36, 0) + 0.06 * lfo(t, 1.8, 0.2);
    const width = 0.08 * lfo(t, 0.71, 1.4);
    left = clampNumber(groove - width, 0.16, 0.76);
    right = clampNumber(groove + width * 0.86, 0.16, 0.78);
  } else if (role === "playback-pair") {
    const level = clampNumber(0.11 + 0.035 * lfo(t, 0.31, 0.5) + 0.018 * lfo(t, 1.4, 1.1), 0.04, 0.22);
    left = level;
    right = clampNumber(level * 0.92 + 0.02 * lfo(t, 0.8, 0.6), 0.04, 0.24);
  } else {
    const level = clampNumber(0.06 + 0.025 * lfo(t, 0.8, 0), 0.02, 0.16);
    left = level;
    right = level * 0.9;
  }

  if (stereo) {
    return [clampNumber(left, 0, 0.96), clampNumber(right, 0, 0.96)] as const;
  }

  const mono = clampNumber(Math.max(left, right), 0, 0.96);
  return [mono, mono] as const;
}

export function simulatedMeterFrame(
  id: string,
  role: string,
  stereo: boolean,
  meterState: Record<string, AudioMeterState>
): AudioMeterFrame {
  const elapsedMs = Date.now();
  const [rawLeft, rawRight] = simulatedLevelPairAt(elapsedMs, id, role, stereo);
  const previous = meterState[id];
  const [initialLeft, initialRight] = previous
    ? [previous.bodyLeft, previous.bodyRight]
    : simulatedBodyLevelPairAt(elapsedMs, id, role, stereo);
  const deltaSeconds = previous
    ? Math.max(0.001, (elapsedMs - previous.updatedAtMs) / 1000)
    : AUDIO_METERING_TICK_MS / 1000;
  let left = smoothMeterBody(initialLeft, rawLeft, deltaSeconds);
  let right = smoothMeterBody(initialRight, rawRight, deltaSeconds);
  if (!stereo) {
    left = Math.max(left, right);
    right = left;
  }
  const meterLevel = Math.max(left, right);
  let [peakHoldLeft, holdLeftUntilMs] = nextPeakHold(
    rawLeft,
    left,
    previous?.peakHoldLeft ?? left,
    previous?.holdLeftUntilMs ?? 0,
    elapsedMs,
    deltaSeconds
  );
  let [peakHoldRight, holdRightUntilMs] = nextPeakHold(
    rawRight,
    right,
    previous?.peakHoldRight ?? right,
    previous?.holdRightUntilMs ?? 0,
    elapsedMs,
    deltaSeconds
  );
  if (!stereo) {
    const monoPeakHold = Math.max(peakHoldLeft, peakHoldRight);
    peakHoldLeft = monoPeakHold;
    peakHoldRight = monoPeakHold;
    holdRightUntilMs = holdLeftUntilMs = Math.max(holdLeftUntilMs, holdRightUntilMs);
  }
  const peakHold = Math.max(peakHoldLeft, peakHoldRight);
  const clipUntilMs = Math.max(previous?.clipUntilMs ?? 0, rawLeft >= 0.985 || rawRight >= 0.985 ? elapsedMs + 700 : 0);
  meterState[id] = {
    bodyLeft: left,
    bodyRight: right,
    clipUntilMs,
    holdLeftUntilMs,
    holdRightUntilMs,
    peakHoldLeft,
    peakHoldRight,
    updatedAtMs: elapsedMs,
  };

  return {
    clip: clipUntilMs > elapsedMs,
    meterLeft: left,
    meterLevel,
    meterRight: right,
    peakHold,
    peakHoldLeft,
    peakHoldRight,
  };
}

export function smoothMeterBody(previous: number, raw: number, deltaSeconds: number) {
  const timeConstant = raw >= previous ? 0.32 : 0.46;
  const alpha = 1 - Math.exp(-deltaSeconds / timeConstant);
  return clampNumber(previous + (raw - previous) * alpha, 0, 0.96);
}

export function calculateNextFixturePeakHold({
  body,
  deltaSeconds,
  elapsedMs,
  holdUntilMs,
  previousPeak,
  raw,
}: {
  body: number;
  deltaSeconds: number;
  elapsedMs: number;
  holdUntilMs: number;
  previousPeak: number;
  raw: number;
}) {
  const instantaneousPeak = clampNumber(Math.max(raw, body), body, 1);
  const heldPeak = clampNumber(Math.max(previousPeak, body), body, 1);
  if (instantaneousPeak >= heldPeak) {
    return { holdUntilMs: elapsedMs + FAIRLIGHT_PEAK_HOLD_MS, peakHold: instantaneousPeak };
  }
  if (elapsedMs < holdUntilMs) {
    return { holdUntilMs, peakHold: heldPeak };
  }

  const decayedPeak = clampNumber(
    Math.max(body, dbfsToNormalized(normalizedToDbfs(heldPeak) - deltaSeconds * FAIRLIGHT_PEAK_FALL_DB_PER_SECOND)),
    body,
    1
  );
  if (instantaneousPeak >= decayedPeak) {
    return { holdUntilMs: elapsedMs + FAIRLIGHT_PEAK_HOLD_MS, peakHold: instantaneousPeak };
  }

  return { holdUntilMs, peakHold: decayedPeak };
}

export function nextPeakHold(
  raw: number,
  body: number,
  previousPeak: number,
  holdUntilMs: number,
  elapsedMs: number,
  deltaSeconds: number
): readonly [number, number] {
  const next = calculateNextFixturePeakHold({
    body,
    deltaSeconds,
    elapsedMs,
    holdUntilMs,
    previousPeak,
    raw,
  });
  return [next.peakHold, next.holdUntilMs] as const;
}

export function simulatedBodyLevelPairAt(
  elapsedMs: number,
  id: string,
  role: string,
  stereo: boolean
): readonly [number, number] {
  const samples = [
    [0, 0.3],
    [85, 0.24],
    [170, 0.18],
    [270, 0.14],
    [390, 0.1],
    [480, 0.04],
  ] as const;
  let left = 0;
  let right = 0;
  let totalWeight = 0;
  for (const [ageMs, weight] of samples) {
    const [sampleLeft, sampleRight] = simulatedLevelPairAt(Math.max(0, elapsedMs - ageMs), id, role, stereo);
    left += sampleLeft * weight;
    right += sampleRight * weight;
    totalWeight += weight;
  }
  return [clampNumber(left / totalWeight, 0, 0.96), clampNumber(right / totalWeight, 0, 0.96)] as const;
}

export function isSimulatedAudioSnapshot(audioSnapshot: JsonObject) {
  const meteringSource = asString(audioSnapshot.meteringSource, "");
  if (meteringSource === "simulated" || meteringSource === "fixture") {
    return true;
  }
  return SIMULATED_AUDIO_ADAPTER_MODES.has(asString(audioSnapshot.adapterMode, "simulated"));
}

export function applyFixtureMixTargetMetering(audioSnapshot: JsonObject) {
  const channels = asArray(audioSnapshot.channels)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);
  const mixTargets = asArray(audioSnapshot.mixTargets)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);

  for (const mixTarget of mixTargets) {
    if (asBoolean(mixTarget.mute, false)) {
      mixTarget.meterLeft = 0;
      mixTarget.meterRight = 0;
      mixTarget.meterLevel = 0;
      mixTarget.peakHold = 0;
      mixTarget.peakHoldLeft = 0;
      mixTarget.peakHoldRight = 0;
      continue;
    }

    let leftEnergy = 0;
    let rightEnergy = 0;
    let peakLeftEnergy = 0;
    let peakRightEnergy = 0;
    const mixTargetId = asString(mixTarget.id);
    for (const channel of channels) {
      if (asBoolean(channel.mute, false)) continue;
      const sendMode = asRecord(asRecord(channel.sendModes)?.[mixTargetId]);
      if (asBoolean(sendMode?.mute, false)) continue;
      const mixLevels = asRecord(channel.mixLevels) ?? {};
      const sendLevel = clampNumber(asNumber(mixLevels[mixTargetId], asNumber(channel.fader, 0)), 0, 1);
      if (sendLevel <= 0.01) continue;

      const stereo = asBoolean(channel.stereo, false);
      const sourceLeft = stereo ? asNumber(channel.meterLeft, 0) : asNumber(channel.meterLevel, 0);
      const sourceRight = stereo ? asNumber(channel.meterRight, 0) : asNumber(channel.meterLevel, 0);
      const sourcePeakLeft = stereo
        ? asNumber(channel.peakHoldLeft, asNumber(channel.peakHold, sourceLeft))
        : Math.max(asNumber(channel.peakHoldLeft, sourceLeft), asNumber(channel.peakHold, sourceLeft));
      const sourcePeakRight = stereo
        ? asNumber(channel.peakHoldRight, asNumber(channel.peakHold, sourceRight))
        : Math.max(asNumber(channel.peakHoldRight, sourceRight), asNumber(channel.peakHold, sourceRight));
      const dimScale = asBoolean(mixTarget.dim, false) ? 0.42 : 1;
      const gain = totalMixFaderGain(sendLevel) * totalMixFaderGain(asNumber(mixTarget.volume, 0)) * dimScale;
      leftEnergy += (sourceLeft * gain) ** 2;
      rightEnergy += (sourceRight * gain) ** 2;
      peakLeftEnergy += (sourcePeakLeft * gain) ** 2;
      peakRightEnergy += (sourcePeakRight * gain) ** 2;
    }

    let meterLeft = clampNumber(Math.sqrt(leftEnergy), 0, 0.98);
    let meterRight = clampNumber(Math.sqrt(rightEnergy), 0, 0.98);
    let peakHoldLeft = clampNumber(Math.max(meterLeft, Math.sqrt(peakLeftEnergy) * 0.98), meterLeft, 1);
    let peakHoldRight = clampNumber(Math.max(meterRight, Math.sqrt(peakRightEnergy) * 0.98), meterRight, 1);
    if (asBoolean(mixTarget.mono, false)) {
      const mono = clampNumber((meterLeft + meterRight) * 0.5, 0, 0.98);
      meterLeft = mono;
      meterRight = mono;
      const monoPeak = Math.max(mono, peakHoldLeft, peakHoldRight);
      peakHoldLeft = monoPeak;
      peakHoldRight = monoPeak;
    }
    const meterLevel = Math.max(meterLeft, meterRight);
    const peakHold = Math.max(meterLevel, peakHoldLeft, peakHoldRight);
    mixTarget.meterLeft = meterLeft;
    mixTarget.meterRight = meterRight;
    mixTarget.meterLevel = meterLevel;
    mixTarget.peakHold = peakHold;
    mixTarget.peakHoldLeft = peakHoldLeft;
    mixTarget.peakHoldRight = peakHoldRight;
  }

  audioSnapshot.mixTargets = mixTargets;
}

export function refreshFixtureAudioMetering(state: MutableFixtureState) {
  const audioSnapshot = asRecord(state.audioSnapshot);
  if (!audioSnapshot || !isSimulatedAudioSnapshot(audioSnapshot)) {
    return false;
  }

  audioSnapshot.channels = asArray(audioSnapshot.channels)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .map((channel) => {
      const frame = simulatedMeterFrame(
        asString(channel.id),
        asString(channel.role),
        asBoolean(channel.stereo, false),
        state.audioMeterState
      );
      return {
        ...channel,
        ...frame,
        clip: asBoolean(channel.clip, false) || frame.clip,
      };
    });
  applyFixtureMixTargetMetering(audioSnapshot);
  state.audioSnapshot = audioSnapshot;
  return true;
}

export function meterPointForFixtureChannel(record: JsonObject) {
  return asString(record.role) === "playback-pair" ? AUDIO_METER_POINT_PLAYBACK : AUDIO_METER_POINT_INPUT;
}

export function audioMeterPayloadFromSnapshot(
  audioSnapshot: JsonObject,
  sequence: number,
  startedAtMs: number
): JsonObject {
  const compactMeter = (entry: JsonValue, meterPoint: string) => {
    const record = asRecord(entry) ?? {};
    const meterLeft = asNumber(record.meterLeft, 0);
    const meterRight = asNumber(record.meterRight, 0);
    const meterLevel = asNumber(record.meterLevel, 0);
    const peakHoldLeft = asNumber(record.peakHoldLeft, 0);
    const peakHoldRight = asNumber(record.peakHoldRight, 0);
    const rmsLeft = meterLeft;
    const rmsRight = meterRight;
    const levelLeftDbfs = normalizedToDbfs(rmsLeft);
    const levelRightDbfs = normalizedToDbfs(rmsRight);
    const peakLeft = Math.max(peakHoldLeft, meterLeft);
    const peakRight = Math.max(peakHoldRight, meterRight);
    const clip = asBoolean(record.clip, false);
    const overLeft = levelLeftDbfs >= AUDIO_METER_OVER_DBFS;
    const overRight = levelRightDbfs >= AUDIO_METER_OVER_DBFS;
    const meterPointOver = overLeft || overRight;

    return {
      channelPathClip: clip,
      channelPathClipHold: clip,
      clip,
      clipHold: clip,
      id: asString(record.id),
      lufsIntegrated: asNumber(record.lufsIntegrated, 0),
      levelLeftDbfs,
      levelRightDbfs,
      meterPoint,
      meterLeft,
      meterLevel,
      meterRight,
      meterPointOver,
      meterPointOverLeft: overLeft,
      meterPointOverRight: overRight,
      over: meterPointOver,
      overLeft,
      overRight,
      peakHold: asNumber(record.peakHold, 0),
      peakHoldLeft,
      peakHoldRight,
      peakLeftDbfs: normalizedToDbfs(peakLeft),
      peakRightDbfs: normalizedToDbfs(peakRight),
      peakWarning:
        levelLeftDbfs >= AUDIO_METER_PEAK_WARNING_DBFS || levelRightDbfs >= AUDIO_METER_PEAK_WARNING_DBFS || clip,
      rmsLeftDbfs: levelLeftDbfs,
      rmsRightDbfs: levelRightDbfs,
      peakHoldLeftDbfs: normalizedToDbfs(peakHoldLeft),
      peakHoldRightDbfs: normalizedToDbfs(peakHoldRight),
    };
  };

  return {
    cadenceHz: AUDIO_METERING_CADENCE_HZ,
    channels: asArray(audioSnapshot.channels).map((entry) =>
      compactMeter(entry, meterPointForFixtureChannel(asRecord(entry) ?? {}))
    ),
    diagnostics: {
      mappedEntryCount: asArray(audioSnapshot.channels).length + asArray(audioSnapshot.mixTargets).length,
      mappedPacketCount: sequence,
      packetCount: sequence,
      unknownPacketCount: 0,
    },
    lastPacketAgeMs: null,
    meteringSource: asString(audioSnapshot.meteringSource, "simulated"),
    meteringState: asString(audioSnapshot.meteringState, "simulated"),
    mixTargets: asArray(audioSnapshot.mixTargets).map((entry) => compactMeter(entry, AUDIO_METER_POINT_POST_FADER)),
    monotonicTimestampMs: Math.max(0, performance.now() - startedAtMs),
    reason: "metering-tick",
    sequence,
    selectedMixTargetId: asString(audioSnapshot.selectedMixTargetId, ""),
  };
}
