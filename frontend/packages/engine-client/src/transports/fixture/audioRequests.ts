// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import { type FixtureRequestContext, type FixtureRequestResult, NOT_HANDLED } from "./requestContext";
import type { RequestMethod, JsonObject } from "../../generated/protocol";
import { asRecord, asArray, asString, asBoolean, asNumber, cloneJson } from "./json";
import {
  buildDefaultAudioSnapshot,
  refreshAudioCapabilities,
  ensureAudioActionAllowed,
  ensureAudioEditAllowed,
  captureFixtureAudioScene,
  buildAudioSnapshotPreview,
  fixtureAudioChannel,
  normalizeAudioEq,
  normalizeLowCutSlope,
  normalizeEqBandType,
  buildAudioDynamics,
  buildAudioSendModes,
  ensureAudioSnapshotAvailable,
} from "./audioConsole";
import { clampNumber } from "./lighting";
import { synchronizeFixtureState } from "./state";

/** The `audio.*` requests that change the console: settings, sync, console mixes, channels, talkback. */
export function handleFixtureAudioRequest(
  context: FixtureRequestContext,
  method: RequestMethod,
  params: JsonObject
): FixtureRequestResult {
  const { state, emit } = context;
  switch (method) {
    case "audio.settings.update": {
      const audioSnapshot = asRecord(state.audioSnapshot) ?? buildDefaultAudioSnapshot();
      const audioCheck = asArray(state.commissioningSnapshot.checks)
        .map((entry) => asRecord(entry))
        .find((entry) => asString(entry?.id) === "audio");
      const transportChanged =
        "oscEnabled" in params || "sendHost" in params || "sendPort" in params || "receivePort" in params;

      if ("oscEnabled" in params) {
        audioSnapshot.oscEnabled = asBoolean(params.oscEnabled, true);
      }
      if (typeof params.sendHost === "string" && params.sendHost.trim()) {
        audioSnapshot.sendHost = params.sendHost.trim();
        state.commissioningSnapshot.audio = {
          ...(asRecord(state.commissioningSnapshot.audio) ?? {}),
          sendHost: params.sendHost.trim(),
          sendPort: asNumber(audioSnapshot.sendPort, 7001),
          receivePort: asNumber(audioSnapshot.receivePort, 9001),
        };
      }
      if (typeof params.sendPort === "number") {
        audioSnapshot.sendPort = clampNumber(Math.round(params.sendPort), 1, 65_535);
        state.commissioningSnapshot.audio = {
          ...(asRecord(state.commissioningSnapshot.audio) ?? {}),
          sendHost: asString(audioSnapshot.sendHost, "127.0.0.1"),
          sendPort: audioSnapshot.sendPort,
          receivePort: asNumber(audioSnapshot.receivePort, 9001),
        };
      }
      if (typeof params.receivePort === "number") {
        audioSnapshot.receivePort = clampNumber(Math.round(params.receivePort), 1, 65_535);
        state.commissioningSnapshot.audio = {
          ...(asRecord(state.commissioningSnapshot.audio) ?? {}),
          sendHost: asString(audioSnapshot.sendHost, "127.0.0.1"),
          sendPort: asNumber(audioSnapshot.sendPort, 7001),
          receivePort: audioSnapshot.receivePort,
        };
      }
      if ("selectedChannelId" in params) {
        audioSnapshot.selectedChannelId =
          typeof params.selectedChannelId === "string" ? params.selectedChannelId : null;
      }
      if (typeof params.selectedMixTargetId === "string") {
        audioSnapshot.selectedMixTargetId = params.selectedMixTargetId;
      }
      if ("expectedPeakData" in params) {
        audioSnapshot.expectedPeakData = asBoolean(params.expectedPeakData, true);
      }
      if ("expectedSubmixLock" in params) {
        audioSnapshot.expectedSubmixLock = asBoolean(params.expectedSubmixLock, true);
      }
      if ("expectedCompatibilityMode" in params) {
        audioSnapshot.expectedCompatibilityMode = asBoolean(params.expectedCompatibilityMode, false);
      }
      if (typeof params.fadersPerBank === "number") {
        audioSnapshot.fadersPerBank = clampNumber(Math.round(params.fadersPerBank), 1, 24);
      }
      if (params.viewMode === "submix" || params.viewMode === "master") {
        audioSnapshot.viewMode = params.viewMode;
      }

      if (transportChanged) {
        if (audioCheck) {
          audioCheck.status = "idle";
          audioCheck.message = "Not run yet.";
          audioCheck.checkedAt = null;
        }
        audioSnapshot.consoleStateConfidence = "unknown";
        audioSnapshot.lastConsoleSyncAt = null;
        audioSnapshot.lastConsoleSyncReason = null;
        audioSnapshot.lastRecalledSnapshotId = null;
        audioSnapshot.lastSnapshotRecallAt = null;
      }

      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = "Audio settings updated";
      refreshAudioCapabilities(audioSnapshot, state);
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-settings-updated" });
      return cloneJson(state.audioSnapshot);
    }
    case "audio.sync": {
      const audioSnapshot = ensureAudioActionAllowed(state);
      const syncedAt = new Date().toISOString();
      // Mirrors the engine's console pull (Slice 3): the fixture console
      // already mirrors the app, so the pull reports what it "read" and
      // marks the state aligned.
      const channelCount = asArray(audioSnapshot.channels).length;
      const mixTargetCount = asArray(audioSnapshot.mixTargets).length;
      const pulledValues = channelCount * 4 + mixTargetCount * 2;
      const summary = `Pulled ${pulledValues} values from the fixture console · ${channelCount} channels · ${mixTargetCount} outputs`;
      audioSnapshot.consoleStateConfidence = "aligned";
      audioSnapshot.lastConsoleSyncAt = syncedAt;
      audioSnapshot.lastConsoleSyncReason = "console-pull";
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = summary;
      const consoleLink = asRecord(audioSnapshot.consoleLink);
      if (consoleLink) {
        consoleLink.lastPullAt = syncedAt;
        consoleLink.lastPullValues = pulledValues;
      }
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-sync-completed" });
      return {
        synced: true,
        syncedAt,
        summary,
        consoleStateConfidence: "aligned",
        pulledValues,
        channels: channelCount,
        mixTargets: mixTargetCount,
        complete: true,
        connection: "simulated",
      };
    }
    case "audio.snapshot.recall": {
      const audioSnapshot = ensureAudioActionAllowed(state);
      const snapshotId = asString(params.snapshotId).trim();
      const snapshots = asArray(audioSnapshot.snapshots)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      const snapshot = snapshots.find((entry) => asString(entry.id) === snapshotId);
      if (!snapshot) {
        throw new Error(`Audio snapshot '${snapshotId}' is not exposed by the fixture transport.`);
      }

      // Mirrors the engine's recall push (Slice 4): every captured console
      // value is "pushed" and confirmed by the fixture console, 48V is never
      // pushed (kept at the console's value and listed), talkback is
      // momentary and stays.
      const recalledAt = new Date().toISOString();
      const snapshotName = asString(snapshot.name, snapshotId);
      const phantomDifferences: JsonObject[] = [];
      let pushed = 0;
      const contents = asRecord(snapshot.contents);
      if (contents) {
        const sceneChannels = asRecord(contents.channels) ?? {};
        const sceneMixTargets = asRecord(contents.mixTargets) ?? {};
        for (const channel of asArray(audioSnapshot.channels).map((entry) => asRecord(entry))) {
          if (!channel) continue;
          const stateEntry = asRecord(sceneChannels[asString(channel.id)]);
          if (!stateEntry) continue;
          const currentPhantom = channel.phantom === true;
          const targetPhantom = stateEntry.phantom === true;
          if (asString(channel.role) === "front-preamp" && currentPhantom !== targetPhantom) {
            phantomDifferences.push({
              channelId: asString(channel.id),
              channelName: asString(channel.name, asString(channel.id)),
              current: currentPhantom,
              target: targetPhantom,
            });
          }
          Object.assign(channel, cloneJson(stateEntry));
          channel.phantom = currentPhantom;
          // mute + three sends + solo (+ gain/phase/instrument/autoset on a preamp)
          pushed += asString(channel.role) === "front-preamp" ? 9 : 5;
        }
        for (const mixTarget of asArray(audioSnapshot.mixTargets).map((entry) => asRecord(entry))) {
          if (!mixTarget) continue;
          const stateEntry = asRecord(sceneMixTargets[asString(mixTarget.id)]);
          if (!stateEntry) continue;
          const currentTalkback = mixTarget.talkback === true;
          Object.assign(mixTarget, cloneJson(stateEntry));
          mixTarget.talkback = currentTalkback;
          pushed += asString(mixTarget.id) === "audio-mix-main" ? 4 : 2;
        }
      }
      const phantomNote =
        phantomDifferences.length > 0
          ? ` · 48V differs on ${phantomDifferences.map((entry) => asString(entry.channelName)).join(", ")}`
          : "";
      const summary =
        pushed > 0
          ? `Recalled ${snapshotName}: ${pushed} values pushed, ${pushed} confirmed${phantomNote}.`
          : `Recalled ${snapshotName}: the snapshot has no captured console state, nothing was pushed.`;
      audioSnapshot.lastRecalledSnapshotId = snapshotId;
      audioSnapshot.lastSnapshotRecallAt = recalledAt;
      audioSnapshot.consoleStateConfidence = "aligned";
      if (pushed > 0) {
        audioSnapshot.lastConsoleSyncReason = "snapshot-push";
        audioSnapshot.lastConsoleSyncAt = recalledAt;
      }
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = summary;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-snapshot-recalled" });
      return {
        recalled: true,
        snapshotId,
        snapshotName,
        recalledAt,
        summary,
        consoleStateConfidence: "aligned",
        pushed,
        confirmed: pushed,
        adjusted: 0,
        unconfirmed: 0,
        phantomDifferences,
      };
    }
    case "audio.snapshot.create": {
      const audioSnapshot = ensureAudioEditAllowed(state);
      const name = asString(params.name).trim() || "Snapshot";
      const oscIndex = clampNumber(Math.round(asNumber(params.oscIndex, 0)), 0, 7);
      const snapshots = asArray(audioSnapshot.snapshots)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      const snapshot = {
        id: `audio-snapshot-custom-${Date.now()}`,
        name,
        oscIndex,
        order: snapshots.length,
        lastRecalled: false,
        lastRecalledAt: null,
        contents: asBoolean(params.captureCurrentState, false) ? captureFixtureAudioScene(audioSnapshot) : null,
        preview: buildAudioSnapshotPreview(asBoolean(params.captureCurrentState, false)),
      };
      snapshots.push(snapshot);
      audioSnapshot.snapshots = snapshots;
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = `Created ${name}`;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-snapshot-created" });
      return { snapshot: cloneJson(snapshot), summary: `Audio snapshot '${name}' was created.` };
    }
    case "audio.snapshot.update": {
      const audioSnapshot = ensureAudioEditAllowed(state);
      const snapshotId = asString(params.snapshotId).trim();
      const snapshots = asArray(audioSnapshot.snapshots)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      const snapshot = snapshots.find((entry) => asString(entry.id) === snapshotId);
      if (!snapshot) throw new Error(`Audio snapshot '${snapshotId}' is not exposed by the fixture transport.`);
      if (typeof params.name === "string" && params.name.trim()) {
        snapshot.name = params.name.trim();
      }
      if (typeof params.oscIndex === "number") {
        snapshot.oscIndex = clampNumber(Math.round(params.oscIndex), 0, 7);
      }
      if (asBoolean(params.captureCurrentState, false)) {
        snapshot.contents = captureFixtureAudioScene(audioSnapshot);
        snapshot.preview = buildAudioSnapshotPreview(true);
      }
      audioSnapshot.snapshots = snapshots;
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = `Updated ${asString(snapshot.name, snapshotId)}`;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-snapshot-updated" });
      return { snapshot: cloneJson(snapshot), summary: `Audio snapshot '${asString(snapshot.name)}' was updated.` };
    }
    case "audio.snapshot.delete": {
      const audioSnapshot = ensureAudioEditAllowed(state);
      const snapshotId = asString(params.snapshotId).trim();
      const snapshots = asArray(audioSnapshot.snapshots)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      audioSnapshot.snapshots = snapshots.filter((entry) => asString(entry.id) !== snapshotId);
      if (asString(audioSnapshot.lastRecalledSnapshotId) === snapshotId) {
        audioSnapshot.lastRecalledSnapshotId = null;
        audioSnapshot.lastSnapshotRecallAt = null;
      }
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = `Deleted ${snapshotId}`;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-snapshot-deleted" });
      return { deleted: true, snapshotId, summary: `Audio snapshot '${snapshotId}' was deleted.` };
    }
    case "audio.clip.clear": {
      const audioSnapshot = ensureAudioEditAllowed(state);
      const channelId = typeof params.channelId === "string" ? params.channelId : null;
      for (const channel of asArray(audioSnapshot.channels).map((entry) => asRecord(entry))) {
        if (!channel) continue;
        if (!channelId || asString(channel.id) === channelId) {
          channel.clip = false;
        }
      }
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = channelId ? `Cleared clips for ${channelId}` : "Cleared clips";
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-clips-cleared" });
      return { cleared: true, channelId, summary: audioSnapshot.lastActionMessage };
    }
    case "audio.solo.clearAll": {
      const audioSnapshot = ensureAudioActionAllowed(state);
      let cleared = 0;
      for (const channel of asArray(audioSnapshot.channels).map((entry) => asRecord(entry))) {
        if (!channel || !asBoolean(channel.solo, false)) continue;
        channel.solo = false;
        cleared += 1;
      }
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = cleared
        ? `Cleared solo on ${cleared} audio channel(s)`
        : "No soloed audio channels to clear";
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "solo-cleared" });
      return cloneJson(state.audioSnapshot);
    }
    case "audio.channel.update": {
      // Mirrors the engine gate: hardware-facing fields need a passed audio
      // probe; a rename is app-local and stays allowed.
      const touchesConsole = ["gain", "fader", "mute", "solo", "phantom", "phase", "pad", "instrument", "autoSet"].some(
        (field) => params[field] !== undefined && params[field] !== null
      );
      const audioSnapshot = touchesConsole ? ensureAudioActionAllowed(state) : ensureAudioEditAllowed(state);
      const channelId = asString(params.channelId).trim();
      const channels = asArray(audioSnapshot.channels)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      const channel = channels.find((entry) => asString(entry.id) === channelId);
      if (!channel) {
        throw new Error(`Audio channel '${channelId}' is not exposed by the fixture transport.`);
      }

      const role = asString(channel.role);
      if (typeof params.name === "string" && params.name.trim()) {
        channel.name = params.name.trim();
      }
      if (typeof params.gain === "number") {
        if (role !== "front-preamp") {
          throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: gain is only available on front preamps.");
        }
        channel.gain = clampNumber(Math.round(params.gain), 0, 75);
      }
      if (typeof params.fader === "number") {
        const mixTargetId = asString(params.mixTargetId, asString(audioSnapshot.selectedMixTargetId, "audio-mix-main"));
        const mixLevels = asRecord(channel.mixLevels) ?? {};
        mixLevels[mixTargetId] = Math.max(0, Math.min(1, params.fader));
        channel.mixLevels = mixLevels;
        if (mixTargetId === "audio-mix-main") {
          channel.fader = mixLevels[mixTargetId];
        }
      }
      if ("mute" in params) {
        channel.mute = asBoolean(params.mute, false);
      }
      if ("solo" in params) {
        channel.solo = asBoolean(params.solo, false);
      }
      if ("phantom" in params) {
        if (role !== "front-preamp") {
          throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: phantom is only available on front preamps.");
        }
        channel.phantom = asBoolean(params.phantom, false);
      }
      if ("phase" in params) {
        if (role === "playback-pair") {
          throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: phase is not available on playback pairs.");
        }
        channel.phase = asBoolean(params.phase, false);
      }
      if ("pad" in params) {
        throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: pad is not available on UFX III mic preamps.");
      }
      if ("instrument" in params) {
        if (role !== "front-preamp") {
          throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: instrument is only available on front preamps.");
        }
        channel.instrument = asBoolean(params.instrument, false);
      }
      if ("autoSet" in params) {
        if (role !== "front-preamp") {
          throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: auto-set is only available on front preamps.");
        }
        channel.autoSet = asBoolean(params.autoSet, false);
      }

      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = `Updated ${asString(channel.name, channelId)}`;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-channel-updated" });
      return cloneJson(channel);
    }
    case "audio.channel.eq.update": {
      const audioSnapshot = ensureAudioActionAllowed(state);
      const channel = fixtureAudioChannel(audioSnapshot, params.channelId);
      const eq = normalizeAudioEq(asRecord(channel.eq));
      if ("enabled" in params) eq.enabled = asBoolean(params.enabled, false);
      if ("lowCutEnabled" in params) eq.lowCut.enabled = asBoolean(params.lowCutEnabled, false);
      if (typeof params.lowCutFrequencyHz === "number") {
        eq.lowCut.frequencyHz = clampNumber(params.lowCutFrequencyHz, 20, 500);
      }
      if (typeof params.lowCutSlopeDbPerOctave === "number") {
        eq.lowCut.slopeDbPerOctave = normalizeLowCutSlope(params.lowCutSlopeDbPerOctave);
      }
      if (typeof params.bandId === "string") {
        const bands = asArray(eq.bands)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const band = bands.find((entry) => asString(entry.id) === params.bandId);
        if (!band) throw new Error(`Audio EQ band '${params.bandId}' is not exposed by the fixture transport.`);
        if ("bandEnabled" in params) band.enabled = asBoolean(params.bandEnabled, false);
        if (typeof params.bandType === "string") {
          const nextType = normalizeEqBandType(params.bandId, params.bandType);
          if (nextType !== params.bandType) {
            throw new Error(`Audio EQ band '${params.bandId}' does not support type '${params.bandType}'.`);
          }
          band.bandType = nextType;
        }
        if (typeof params.frequencyHz === "number") band.frequencyHz = clampNumber(params.frequencyHz, 20, 20_000);
        if (typeof params.gainDb === "number") band.gainDb = clampNumber(params.gainDb, -20, 20);
        if (typeof params.q === "number") band.q = clampNumber(params.q, 0.4, 9.9);
        eq.bands = bands as typeof eq.bands;
      }
      channel.eq = eq;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-channel-eq-updated" });
      return cloneJson(channel);
    }
    case "audio.channel.dynamics.update": {
      const audioSnapshot = ensureAudioEditAllowed(state);
      const channel = fixtureAudioChannel(audioSnapshot, params.channelId);
      const dynamics = asRecord(channel.dynamics) ?? buildAudioDynamics();
      const key = params.section === "gate" ? "gate" : "compressor";
      const section = asRecord(dynamics[key]) ?? {};
      if ("enabled" in params) section.enabled = asBoolean(params.enabled, false);
      if (typeof params.thresholdDb === "number") section.thresholdDb = clampNumber(params.thresholdDb, -80, 0);
      if (typeof params.ratio === "number") section.ratio = clampNumber(params.ratio, 1, 20);
      if (typeof params.attackMs === "number") section.attackMs = clampNumber(params.attackMs, 0.1, 2000);
      if (typeof params.releaseMs === "number") section.releaseMs = clampNumber(params.releaseMs, 0.1, 2000);
      if (typeof params.makeupDb === "number") section.makeupDb = clampNumber(params.makeupDb, 0, 24);
      dynamics[key] = section;
      channel.dynamics = dynamics;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-channel-dynamics-updated" });
      return cloneJson(channel);
    }
    case "audio.channel.send.update": {
      const audioSnapshot = ensureAudioEditAllowed(state);
      const channel = fixtureAudioChannel(audioSnapshot, params.channelId);
      const mixTargetId = asString(params.mixTargetId).trim();
      const sendModes: JsonObject = asRecord(channel.sendModes) ?? buildAudioSendModes();
      const sendMode = asRecord(sendModes[mixTargetId]) ?? {
        preFader: false,
        mute: false,
        linkStereo: true,
        solo: false,
      };
      if ("preFader" in params) sendMode.preFader = asBoolean(params.preFader, false);
      if ("mute" in params) sendMode.mute = asBoolean(params.mute, false);
      if ("linkStereo" in params) sendMode.linkStereo = asBoolean(params.linkStereo, true);
      if ("solo" in params) sendMode.solo = asBoolean(params.solo, false);
      sendModes[mixTargetId] = sendMode;
      channel.sendModes = sendModes;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-channel-send-updated" });
      return cloneJson(channel);
    }
    case "audio.talkback.hold": {
      // 2026-09 audit Slice 6: momentary talkback, mirroring the engine.
      // Engaging passes the console gate; a heartbeat while already on
      // changes nothing; releasing turns it off; only real changes announce.
      const engaged = params.engaged === true;
      const audioSnapshot = engaged ? ensureAudioActionAllowed(state) : ensureAudioSnapshotAvailable(state);
      const mixTargets = asArray(audioSnapshot.mixTargets)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      const requestedId = typeof params.mixTargetId === "string" ? params.mixTargetId.trim() : "";
      const mixTarget = requestedId
        ? mixTargets.find((entry) => asString(entry.id) === requestedId)
        : (mixTargets.find((entry) => asString(entry.role) === "main-out") ?? mixTargets[0]);
      if (!mixTarget) {
        throw new Error(
          requestedId
            ? `Audio mix target '${requestedId}' is not exposed by the fixture transport.`
            : "No main output mix target is available."
        );
      }
      const mixTargetId = asString(mixTarget.id);
      const changed = (mixTarget.talkback === true) !== engaged;
      if (changed) {
        mixTarget.talkback = engaged;
        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = engaged
          ? `Talkback on ${asString(mixTarget.name, mixTargetId)}`
          : `Talkback released on ${asString(mixTarget.name, mixTargetId)}`;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: engaged ? "talkback-engaged" : "talkback-released" });
      }
      return { mixTargetId, talkback: engaged, changed };
    }
    case "audio.mixTarget.update": {
      const audioSnapshot = ensureAudioActionAllowed(state);
      const mixTargetId = asString(params.mixTargetId).trim();
      const mixTargets = asArray(audioSnapshot.mixTargets)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      const mixTarget = mixTargets.find((entry) => asString(entry.id) === mixTargetId);
      if (!mixTarget) {
        throw new Error(`Audio mix target '${mixTargetId}' is not exposed by the fixture transport.`);
      }

      if ("volume" in params && typeof params.volume === "number") {
        mixTarget.volume = Math.max(0, Math.min(1, params.volume));
      }
      if ("mute" in params) {
        mixTarget.mute = asBoolean(params.mute, false);
      }
      if ("dim" in params) {
        mixTarget.dim = asBoolean(params.dim, false);
      }
      if ("mono" in params) {
        mixTarget.mono = asBoolean(params.mono, false);
      }
      if ("talkback" in params) {
        mixTarget.talkback = asBoolean(params.talkback, false);
      }

      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = `Updated ${asString(mixTarget.name, mixTargetId)}`;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "audio-mix-target-updated" });
      return cloneJson(mixTarget);
    }
    default:
      return NOT_HANDLED;
  }
}
