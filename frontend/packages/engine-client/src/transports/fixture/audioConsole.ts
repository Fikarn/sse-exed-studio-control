// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import { asArray, asRecord, asString, asBoolean, asNumber } from "./json";
import type { MutableFixtureState } from "./state";

export function buildAudioMixLevels(main: number, phonesA: number, phonesB: number) {
  return {
    "audio-mix-main": main,
    "audio-mix-phones-a": phonesA,
    "audio-mix-phones-b": phonesB,
  };
}

/** TotalMix's slots, `/snapshot/load/1` to `/snapshot/load/8` (`SNAPSHOT_SLOTS`). */
export const CONSOLE_SNAPSHOT_SLOTS = 8;

const CONSOLE_SNAPSHOT_STATES = new Set(["unknown", "off", "active", "changed"]);

/**
 * TotalMix's eight snapshots as a simulated console shows them (2026-10-01):
 * the names of the hardware link's test file (`rme_totalmix_names/fixture.xml`),
 * slot 1 loaded, 2 and 3 reported off, 4 to 8 neither named nor reported. The
 * time is the populated fixture's own, so the Console's source line shows.
 */
export function buildFixtureConsoleSnapshots(): JsonObject {
  const names = ["Mix 1", "Interview", "Panel & Q&A"];
  const states = ["active", "off", "off"];
  return {
    slots: Array.from({ length: CONSOLE_SNAPSHOT_SLOTS }, (_, index) => ({
      slot: index + 1,
      name: names[index] ?? null,
      state: states[index] ?? "unknown",
    })),
    namesSavedAt: "2026-09-21T08:17:36Z",
    namesNote: null,
  };
}

/** Always eight slots, slot 1 first, each with a state word the hardware link uses. */
export function normalizeConsoleSnapshots(value: JsonObject | null): JsonObject {
  const given = asArray(value?.slots)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);
  return {
    slots: Array.from({ length: CONSOLE_SNAPSHOT_SLOTS }, (_, index) => {
      const entry = given.find((candidate) => asNumber(candidate.slot, 0) === index + 1);
      const name = typeof entry?.name === "string" && entry.name.trim() ? entry.name.trim() : null;
      const state = asString(entry?.state, "unknown");
      return { slot: index + 1, name, state: CONSOLE_SNAPSHOT_STATES.has(state) ? state : "unknown" };
    }),
    namesSavedAt: typeof value?.namesSavedAt === "string" ? value.namesSavedAt : null,
    namesNote: typeof value?.namesNote === "string" ? value.namesNote : null,
  };
}

/** A transport change: another address may be another desk, so every slot is unknown again. */
export function forgetConsoleSnapshotStates(audioSnapshot: JsonObject) {
  const consoleSnapshots = normalizeConsoleSnapshots(asRecord(audioSnapshot.consoleSnapshots));
  consoleSnapshots.slots = asArray(consoleSnapshots.slots).map((entry) => ({
    ...(asRecord(entry) ?? {}),
    state: "unknown",
  }));
  audioSnapshot.consoleSnapshots = consoleSnapshots;
}

/**
 * The simulated console's load (`mark_snapshot_loaded`): the slot is active,
 * and every other slot TotalMix had reported is off; a slot never reported
 * stays unknown.
 */
export function markConsoleSnapshotLoaded(audioSnapshot: JsonObject, slot: number) {
  const consoleSnapshots = normalizeConsoleSnapshots(asRecord(audioSnapshot.consoleSnapshots));
  consoleSnapshots.slots = asArray(consoleSnapshots.slots).map((entry) => {
    const record = asRecord(entry) ?? {};
    const state = record.slot === slot ? "active" : record.state === "unknown" ? "unknown" : "off";
    return { ...record, state };
  });
  audioSnapshot.consoleSnapshots = consoleSnapshots;
  return consoleSnapshots;
}

export function buildAudioChannel(
  id: string,
  name: string,
  shortName: string,
  role: string,
  stereo: boolean,
  gain: number,
  mixLevels: Record<string, number>,
  meterLevel: number,
  options: Partial<JsonObject> = {}
): JsonObject {
  const meterLeft = stereo ? Math.max(0, meterLevel - 0.04) : meterLevel;
  const meterRight = stereo ? meterLevel : meterLevel;

  return {
    id,
    name,
    shortName,
    role,
    stereo,
    gain,
    fader: typeof mixLevels["audio-mix-main"] === "number" ? mixLevels["audio-mix-main"] : 0,
    meterLeft,
    meterRight,
    meterLevel,
    peakHold: Math.min(1, meterLevel + 0.08),
    peakHoldLeft: Math.min(1, meterLeft + 0.08),
    peakHoldRight: Math.min(1, meterRight + 0.08),
    clip: options.clip === true,
    mixLevels,
    mute: options.mute === true,
    solo: options.solo === true,
    phantom: role === "front-preamp",
    phase: options.phase === true,
    pad: false,
    instrument: options.instrument === true,
    autoSet: options.autoSet === true,
  };
}

export function buildDefaultAudioSnapshot(): JsonObject {
  const snapshot: JsonObject = {
    status: "ready",
    summary: "Test mode: the console is simulated and nothing reaches TotalMix. 18 channels and 3 outputs.",
    adapterMode: "simulated",
    sendHost: "127.0.0.1",
    sendPort: 7001,
    receivePort: 9001,
    oscEnabled: true,
    connected: true,
    verified: true,
    meteringSource: "simulated",
    meteringState: "simulated",
    selectedChannelId: "audio-playback-3-4",
    selectedMixTargetId: "audio-mix-main",
    expectedPeakData: true,
    expectedSubmixLock: true,
    expectedCompatibilityMode: false,
    fadersPerBank: 12,
    viewMode: "submix",
    capabilities: {
      canEditMixerState: true,
      canSync: true,
      canRecallConsoleSnapshot: true,
      canClearClips: true,
      canUseMasterView: true,
    },
    consoleStateConfidence: "aligned",
    lastConsoleSyncAt: "2026-04-23T18:24:12+02:00",
    lastConsoleSyncReason: "manual sync",
    lastActionStatus: "succeeded",
    lastActionCode: null,
    lastActionMessage: "Sync succeeded",
    channels: [
      buildAudioChannel(
        "audio-input-9",
        "Host",
        "HOST",
        "front-preamp",
        false,
        32,
        buildAudioMixLevels(0.7, 0.76, 0.5),
        0.72
      ),
      buildAudioChannel(
        "audio-input-10",
        "Co-host",
        "CO-HOST",
        "front-preamp",
        false,
        28,
        buildAudioMixLevels(0.68, 0.74, 0.48),
        0.71
      ),
      buildAudioChannel(
        "audio-input-11",
        "Guest 1",
        "GUEST 1",
        "front-preamp",
        false,
        45,
        buildAudioMixLevels(0.8, 0.8, 0.6),
        0.8
      ),
      buildAudioChannel(
        "audio-input-12",
        "Guest 2",
        "GUEST 2",
        "front-preamp",
        false,
        36,
        buildAudioMixLevels(0.64, 0.7, 0.52),
        0.74
      ),
      buildAudioChannel(
        "audio-input-1",
        "Line 1",
        "L1",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.18, 0.12, 0.1),
        0.16
      ),
      buildAudioChannel(
        "audio-input-2",
        "Line 2",
        "L2",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.14, 0.1, 0.08),
        0.12
      ),
      buildAudioChannel(
        "audio-input-3",
        "Remote A",
        "REM A",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.38, 0.32, 0.26),
        0.3,
        { mute: true }
      ),
      buildAudioChannel(
        "audio-input-4",
        "Remote B",
        "REM B",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.32, 0.26, 0.22),
        0.26,
        { mute: true }
      ),
      buildAudioChannel(
        "audio-input-5",
        "Line 5",
        "L5",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.1, 0.08, 0.06),
        0.09
      ),
      buildAudioChannel(
        "audio-input-6",
        "Line 6",
        "L6",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.08, 0.06, 0.05),
        0.07
      ),
      buildAudioChannel(
        "audio-input-7",
        "Line 7",
        "L7",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.06, 0.05, 0.04),
        0.05
      ),
      buildAudioChannel(
        "audio-input-8",
        "Line 8",
        "L8",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.05, 0.04, 0.03),
        0.04
      ),
      buildAudioChannel(
        "audio-playback-1-2",
        "Program 1/2",
        "PGM",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.9, 0.8, 0.78),
        0.78
      ),
      buildAudioChannel(
        "audio-playback-3-4",
        "FX 3/4",
        "FX",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.88, 0.6, 0.5),
        0.66,
        { solo: true }
      ),
      buildAudioChannel(
        "audio-playback-5-6",
        "N-1 5/6",
        "N-1",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.46, 0.3, 0.28),
        0.32
      ),
      buildAudioChannel(
        "audio-playback-7-8",
        "Music 7/8",
        "MUS",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.64, 0.52, 0.48),
        0.44
      ),
      buildAudioChannel(
        "audio-playback-9-10",
        "Playback 9/10",
        "PB 9/10",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.22, 0.16, 0.14),
        0.12
      ),
      buildAudioChannel(
        "audio-playback-11-12",
        "Playback 11/12",
        "PB 11/12",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.18, 0.12, 0.12),
        0.09
      ),
    ],
    mixTargets: [
      {
        id: "audio-mix-main",
        name: "Main Out",
        shortName: "MAIN",
        role: "main-out",
        volume: 0.78,
        meterLeft: 0,
        meterRight: 0,
        meterLevel: 0,
        peakHold: 0,
        peakHoldLeft: 0,
        peakHoldRight: 0,
        mute: false,
        dim: false,
        mono: false,
      },
      {
        id: "audio-mix-phones-a",
        name: "Phones 1",
        shortName: "HP 1",
        role: "phones-a",
        volume: 0.56,
        meterLeft: 0,
        meterRight: 0,
        meterLevel: 0,
        peakHold: 0,
        peakHoldLeft: 0,
        peakHoldRight: 0,
        mute: false,
        dim: false,
        mono: false,
      },
      {
        id: "audio-mix-phones-b",
        name: "Phones 2",
        shortName: "HP 2",
        role: "phones-b",
        volume: 0.42,
        meterLeft: 0,
        meterRight: 0,
        meterLevel: 0,
        peakHold: 0,
        peakHoldLeft: 0,
        peakHoldRight: 0,
        mute: false,
        dim: false,
        // Dim and mono are Main Out's alone (2026-09-28): no phones target holds one.
        mono: false,
      },
    ],
    consoleSnapshots: buildFixtureConsoleSnapshots(),
  };
  return snapshot;
}

export function ensureAudioSnapshotAvailable(state: MutableFixtureState) {
  const audioSnapshot = asRecord(state.audioSnapshot);
  if (!audioSnapshot) {
    throw new Error("Audio snapshot is not available yet.");
  }

  return audioSnapshot;
}

export function refreshAudioCapabilities(audioSnapshot: JsonObject, state: MutableFixtureState) {
  const audioCheck = asRecord(
    asArray(state.commissioningSnapshot.checks)
      .map((entry) => asRecord(entry))
      .find((entry) => asString(entry?.id) === "audio")
  );
  const audioReady = asString(audioCheck?.status) === "passed" || asString(audioCheck?.status) === "ok";
  const oscEnabled = asBoolean(audioSnapshot.oscEnabled, true);
  // Every audio snapshot carries the console-link summary the engine exposes
  // (rme_console_link); fixtures that predate it get the idle default.
  if (!asRecord(audioSnapshot.consoleLink)) {
    audioSnapshot.consoleLink = {
      slotBound: false,
      connection: "unknown",
      device: null,
      dspLoad: null,
      lastEchoAgeMs: null,
      pendingSends: 0,
      unconfirmedSends: 0,
      unconfirmedAddresses: [],
      confirmedSends: 0,
      adjustedSends: 0,
      externalChanges: 0,
      lastPullAt: null,
      lastPullValues: null,
    };
  }
  // Mirrors the engine's `audio_capabilities`: console writes need OSC on AND
  // a passed audio probe; app-local actions only need OSC on.
  const consoleReady = oscEnabled && audioReady;
  audioSnapshot.capabilities = {
    canEditMixerState: consoleReady,
    canSync: consoleReady,
    canRecallConsoleSnapshot: consoleReady,
    canClearClips: oscEnabled,
    canUseMasterView: oscEnabled,
  };
}

export function ensureAudioEditAllowed(state: MutableFixtureState) {
  const audioSnapshot = ensureAudioSnapshotAvailable(state);
  refreshAudioCapabilities(audioSnapshot, state);

  if (!asBoolean(audioSnapshot.oscEnabled, true)) {
    throw new Error("OSC transport is disabled in native audio settings.");
  }

  return audioSnapshot;
}

export function ensureAudioActionAllowed(state: MutableFixtureState) {
  const audioSnapshot = ensureAudioSnapshotAvailable(state);
  refreshAudioCapabilities(audioSnapshot, state);

  const audioCheck = asRecord(
    asArray(state.commissioningSnapshot.checks)
      .map((entry) => asRecord(entry))
      .find((entry) => asString(entry?.id) === "audio")
  );
  const audioReady = asString(audioCheck?.status) === "passed" || asString(audioCheck?.status) === "ok";

  if (!audioReady) {
    // Same refusal the engine's `ensure_audio_action_allowed` produces.
    throw new Error("Audio is not verified yet. Run the audio probe before changing console settings.");
  }

  if (!asBoolean(audioSnapshot.oscEnabled, true)) {
    throw new Error("OSC transport is disabled in native audio settings.");
  }

  return audioSnapshot;
}
