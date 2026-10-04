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
  CONSOLE_SNAPSHOT_SLOTS,
  forgetConsoleSnapshotStates,
  markConsoleSnapshotLoaded,
} from "./audioConsole";
import { clampNumber } from "./lighting";
import { synchronizeFixtureState } from "./state";
import { EngineRequestError } from "../engineRequestError";

/** The `audio.*` requests that change the console: settings, sync, TotalMix's snapshots, channels. */
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
        // As the hardware link: another address may be another desk, so
        // TotalMix's slot states are forgotten.
        forgetConsoleSnapshotStates(audioSnapshot);
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
    case "audio.snapshot.load": {
      // Mirrors the engine's load on the simulated console (2026-10-01,
      // `audio/load.rs`): TotalMix's own snapshot, by its slot; nothing is
      // sent, the slot becomes active and the read-back is the console's own.
      // The parameters' shape first, as the hardware link's parse does.
      const slot = params.slot;
      if (slot === undefined) throw new EngineRequestError("INVALID_PARAMS", "slot is required");
      if (typeof slot !== "number" || !Number.isInteger(slot)) {
        throw new EngineRequestError("INVALID_PARAMS", "slot must be an integer");
      }
      if (slot < 1 || slot > CONSOLE_SNAPSHOT_SLOTS) {
        throw new EngineRequestError("INVALID_PARAMS", `slot must be between 1 and ${CONSOLE_SNAPSHOT_SLOTS}`);
      }
      const audioSnapshot = ensureAudioActionAllowed(state);
      const loadedAt = new Date().toISOString();
      const consoleSnapshots = markConsoleSnapshotLoaded(audioSnapshot, slot);
      const slotEntry = asRecord(asArray(consoleSnapshots.slots)[slot - 1]);
      const name = typeof slotEntry?.name === "string" ? slotEntry.name : null;
      const summary = `Loaded ${name ?? `slot ${slot}`} on the simulated console; nothing was sent (test mode).`;
      audioSnapshot.consoleStateConfidence = "aligned";
      audioSnapshot.lastConsoleSyncAt = loadedAt;
      audioSnapshot.lastConsoleSyncReason = "simulated-load";
      audioSnapshot.lastActionStatus = "succeeded";
      audioSnapshot.lastActionCode = null;
      audioSnapshot.lastActionMessage = summary;
      state.audioSnapshot = audioSnapshot;
      synchronizeFixtureState(state);
      emit("audio.changed", { reason: "snapshot-loaded" });
      return {
        loaded: true,
        slot,
        name,
        loadedAt,
        summary,
        consoleStateConfidence: "aligned",
        pulledValues: 0,
        totalMixReported: false,
      };
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
      // Mirrors the engine (2026-10-01): the channels take TotalMix's names
      // and are renamed in TotalMix, so a request that carries a name is
      // refused; every other field needs a passed audio probe.
      if ("name" in params) {
        throw new Error("audio.channel.update takes no name: channels are named in TotalMix");
      }
      const audioSnapshot = ensureAudioActionAllowed(state);
      const channelId = asString(params.channelId).trim();
      const channels = asArray(audioSnapshot.channels)
        .map((entry) => asRecord(entry))
        .filter((entry): entry is JsonObject => entry !== null);
      const channel = channels.find((entry) => asString(entry.id) === channelId);
      if (!channel) {
        throw new Error(`Audio channel '${channelId}' is not exposed by the fixture transport.`);
      }

      const role = asString(channel.role);
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
