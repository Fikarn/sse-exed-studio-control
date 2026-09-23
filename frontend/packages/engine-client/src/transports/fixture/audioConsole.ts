// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import { asArray, asRecord, asString, asBoolean, cloneJson, asNumber } from "./json";
import { clampNumber } from "./lighting";
import type { MutableFixtureState } from "./state";

export function buildAudioMixLevels(main: number, phonesA: number, phonesB: number) {
  return {
    "audio-mix-main": main,
    "audio-mix-phones-a": phonesA,
    "audio-mix-phones-b": phonesB,
  };
}

export function buildAudioEq() {
  return {
    enabled: false,
    lowCut: { enabled: false, frequencyHz: 80, slopeDbPerOctave: 12 },
    hardwareStatus: "local",
    bands: [
      { id: "1", label: "1", enabled: true, frequencyHz: 180, gainDb: 0, q: 0.9, bandType: "bell" },
      { id: "2", label: "2", enabled: true, frequencyHz: 1600, gainDb: 0, q: 1.2, bandType: "bell" },
      { id: "3", label: "3", enabled: true, frequencyHz: 8500, gainDb: 0, q: 0.8, bandType: "high-shelf" },
    ],
  };
}

export function normalizeAudioEq(value: JsonObject | null) {
  const defaults = buildAudioEq();
  if (!value) return defaults;
  const sourceBands = asArray(value.bands)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);
  const legacyLowCut = sourceBands.find((entry) => asString(entry.id) === "lc");
  const sourceLowCut = asRecord(value.lowCut);
  const lowCut = {
    enabled: legacyLowCut ? asBoolean(legacyLowCut.enabled, false) : asBoolean(sourceLowCut?.enabled, false),
    frequencyHz: clampNumber(
      typeof legacyLowCut?.frequencyHz === "number"
        ? legacyLowCut.frequencyHz
        : typeof sourceLowCut?.frequencyHz === "number"
          ? sourceLowCut.frequencyHz
          : 80,
      20,
      500
    ),
    slopeDbPerOctave: normalizeLowCutSlope(
      typeof sourceLowCut?.slopeDbPerOctave === "number" ? sourceLowCut.slopeDbPerOctave : 12
    ),
  };

  const bands = (defaults.bands as JsonObject[]).map((defaultBand) => {
    const id = asString(defaultBand.id);
    const legacyId = id === "1" ? "lo" : id === "2" ? "mid" : id === "3" ? "hi" : id;
    const source = sourceBands.find((entry) => asString(entry.id) === id || asString(entry.id) === legacyId);
    const bandType = normalizeEqBandType(id, asString(source?.bandType, asString(defaultBand.bandType)));
    const sourceEnabled = asBoolean(source?.enabled, true);
    const gainDb = clampNumber(
      typeof source?.gainDb === "number" ? source.gainDb : Number(defaultBand.gainDb),
      -20,
      20
    );
    return {
      ...defaultBand,
      enabled: true,
      frequencyHz: clampNumber(
        typeof source?.frequencyHz === "number" ? source.frequencyHz : Number(defaultBand.frequencyHz),
        20,
        20_000
      ),
      gainDb: sourceEnabled ? gainDb : 0,
      q: clampNumber(typeof source?.q === "number" ? source.q : Number(defaultBand.q), 0.4, 9.9),
      bandType,
    };
  });

  const hardwareStatus = ["pending", "confirmed"].includes(asString(value.hardwareStatus))
    ? asString(value.hardwareStatus)
    : "local";
  return { enabled: asBoolean(value.enabled, false), lowCut, hardwareStatus, bands };
}

export function normalizeLowCutSlope(value: number) {
  if (value <= 9) return 6;
  if (value <= 15) return 12;
  if (value <= 21) return 18;
  return 24;
}

export function normalizeEqBandType(bandId: string, bandType: string) {
  if (bandId === "1") {
    return ["bell", "low-shelf", "high-pass", "low-pass"].includes(bandType) ? bandType : "bell";
  }
  if (bandId === "3") {
    if (bandType === "shelf") return "high-shelf";
    return ["bell", "high-shelf", "low-pass", "high-pass"].includes(bandType) ? bandType : "bell";
  }
  return "bell";
}

export function buildAudioDynamics() {
  return {
    compressor: { enabled: false, thresholdDb: -18, ratio: 2, attackMs: 12, releaseMs: 120, makeupDb: 0 },
    gate: { enabled: false, thresholdDb: -48, ratio: 1.5, attackMs: 4, releaseMs: 180, makeupDb: 0 },
  };
}

export function buildAudioSendModes() {
  return {
    "audio-mix-main": { preFader: false, mute: false, linkStereo: true, solo: false },
    "audio-mix-phones-a": { preFader: false, mute: false, linkStereo: true, solo: false },
    "audio-mix-phones-b": { preFader: false, mute: false, linkStereo: true, solo: false },
  } satisfies JsonObject;
}

export function buildAudioSnapshotPreview(hasContents = false) {
  return {
    hasContents,
    channelCount: hasContents ? 18 : 0,
    mixTargetCount: hasContents ? 3 : 0,
    changedChannels: [],
    changedMixTargets: [],
  };
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
    eq: buildAudioEq(),
    dynamics: buildAudioDynamics(),
    sendModes: buildAudioSendModes(),
  };
}

/// Captured console state for the "Interview block" slot, derived from the
/// fixture's own channels so a recall pushes a coherent scene: Host's 48V is
/// flipped relative to the live strip, which is exactly the case Slice 4
/// refuses to push and lists instead.
export function attachInterviewBlockContents(snapshot: JsonObject) {
  const channels: JsonObject = {};
  for (const channel of asArray(snapshot.channels).map((entry) => asRecord(entry))) {
    if (!channel) continue;
    const id = asString(channel.id);
    channels[id] = {
      name: channel.name ?? null,
      gain: channel.gain ?? 0,
      fader: channel.fader ?? 0,
      clip: false,
      mixLevels: cloneJson((asRecord(channel.mixLevels) ?? {}) as JsonObject),
      mute: channel.mute === true,
      solo: channel.solo === true,
      phantom: id === "audio-input-9" ? channel.phantom !== true : channel.phantom === true,
      phase: channel.phase === true,
      pad: channel.pad === true,
      instrument: channel.instrument === true,
      autoSet: channel.autoSet === true,
      eq: cloneJson((asRecord(channel.eq) ?? {}) as JsonObject),
      dynamics: cloneJson((asRecord(channel.dynamics) ?? {}) as JsonObject),
      sendModes: cloneJson((asRecord(channel.sendModes) ?? {}) as JsonObject),
    };
  }
  const mixTargets: JsonObject = {};
  for (const mixTarget of asArray(snapshot.mixTargets).map((entry) => asRecord(entry))) {
    if (!mixTarget) continue;
    mixTargets[asString(mixTarget.id)] = {
      volume: mixTarget.volume ?? 0,
      mute: mixTarget.mute === true,
      dim: mixTarget.dim === true,
      mono: mixTarget.mono === true,
      talkback: mixTarget.talkback === true,
    };
  }
  for (const entry of asArray(snapshot.snapshots).map((item) => asRecord(item))) {
    if (entry && asString(entry.id) === "snapshot-interview-block") {
      entry.contents = { capturedAt: "2026-04-22T18:40:00+02:00", channels, mixTargets };
    }
  }
}

export function buildDefaultAudioSnapshot(): JsonObject {
  const snapshot: JsonObject = {
    status: "ready",
    summary:
      "Test mode: the console is simulated and nothing reaches TotalMix. 18 channels, 3 outputs and 5 snapshots.",
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
      canEditProcessing: true,
      canClearClips: true,
      canCaptureSnapshot: true,
      canUseMasterView: true,
    },
    consoleStateConfidence: "aligned",
    lastConsoleSyncAt: "2026-04-23T18:24:12+02:00",
    lastConsoleSyncReason: "manual sync",
    lastRecalledSnapshotId: "snapshot-show-open",
    lastSnapshotRecallAt: "2026-04-23T06:05:43+02:00",
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
        talkback: false,
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
        talkback: true,
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
        mono: true,
        talkback: false,
      },
    ],
    snapshots: [
      {
        id: "snapshot-open-rehearsal",
        name: "Open rehearsal",
        oscIndex: 0,
        order: 0,
        lastRecalled: false,
        lastRecalledAt: "2026-04-23T05:42:00+02:00",
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-show-open",
        name: "Show open",
        oscIndex: 1,
        order: 1,
        lastRecalled: true,
        lastRecalledAt: "2026-04-23T06:05:43+02:00",
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-interview-block",
        name: "Interview block",
        oscIndex: 2,
        order: 2,
        lastRecalled: false,
        lastRecalledAt: null,
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-break-bumper",
        name: "Break bumper",
        oscIndex: 3,
        order: 3,
        lastRecalled: false,
        lastRecalledAt: null,
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-credits",
        name: "Credits",
        oscIndex: 4,
        order: 4,
        lastRecalled: false,
        lastRecalledAt: null,
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
    ],
  };
  attachInterviewBlockContents(snapshot);
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
      activeConsoleSnapshot: null,
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
    canEditProcessing: consoleReady,
    canClearClips: oscEnabled,
    canCaptureSnapshot: oscEnabled,
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

export function fixtureAudioChannel(audioSnapshot: JsonObject, channelIdValue: unknown) {
  const channelId = asString(channelIdValue).trim();
  const channel = asArray(audioSnapshot.channels)
    .map((entry) => asRecord(entry))
    .find((entry) => asString(entry?.id) === channelId);
  if (!channel) {
    throw new Error(`Audio channel '${channelId}' is not exposed by the fixture transport.`);
  }
  return channel;
}

export function captureFixtureAudioScene(audioSnapshot: JsonObject) {
  const channels: JsonObject = {};
  for (const channel of asArray(audioSnapshot.channels).map((entry) => asRecord(entry))) {
    if (!channel) continue;
    channels[asString(channel.id)] = {
      name: asString(channel.name),
      gain: asNumber(channel.gain, 0),
      fader: asNumber(channel.fader, 0),
      clip: asBoolean(channel.clip, false),
      mixLevels: cloneJson(asRecord(channel.mixLevels) ?? {}),
      mute: asBoolean(channel.mute, false),
      solo: asBoolean(channel.solo, false),
      phantom: asBoolean(channel.phantom, false),
      phase: asBoolean(channel.phase, false),
      pad: false,
      instrument: asBoolean(channel.instrument, false),
      autoSet: asBoolean(channel.autoSet, false),
      eq: cloneJson(normalizeAudioEq(asRecord(channel.eq))),
      dynamics: cloneJson(asRecord(channel.dynamics) ?? buildAudioDynamics()),
      sendModes: cloneJson(asRecord(channel.sendModes) ?? buildAudioSendModes()),
    };
  }

  const mixTargets: JsonObject = {};
  for (const mixTarget of asArray(audioSnapshot.mixTargets).map((entry) => asRecord(entry))) {
    if (!mixTarget) continue;
    mixTargets[asString(mixTarget.id)] = {
      volume: asNumber(mixTarget.volume, 0),
      mute: asBoolean(mixTarget.mute, false),
      dim: asBoolean(mixTarget.dim, false),
      mono: asBoolean(mixTarget.mono, false),
      talkback: asBoolean(mixTarget.talkback, false),
    };
  }

  return {
    capturedAt: new Date().toISOString(),
    channels,
    mixTargets,
  };
}
