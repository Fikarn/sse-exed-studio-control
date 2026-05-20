import { useSyncExternalStore } from "react";

import {
  PROTOCOL_VERSION,
  type EventEnvelope,
  type EventName,
  type JsonObject,
  type JsonValue,
} from "../generated/protocol";
import type { AudioSnapshot } from "../generated/snapshots/AudioSnapshot";
import type { LightingDmxMonitorSnapshot } from "../generated/snapshots/LightingDmxMonitorSnapshot";
import type { LightingFixtureCatalogSnapshot } from "../generated/snapshots/LightingFixtureCatalogSnapshot";
import type { LightingSnapshot } from "../generated/snapshots/LightingSnapshot";
import type { PlanningSnapshot } from "../generated/snapshots/PlanningSnapshot";
import { transitionStartupState } from "../machines/startupMachine";
import { deriveRecoveryState } from "../machines/recoveryMachine";

// Boundary cast for typed snapshots produced by ts-rs codegen. The
// engine boundary is the contract; we don't run runtime validation here
// (no Zod, no schema check) for two reasons:
//
//   1. The IPC envelope is already validated by the engine; the wire
//      format is JSON of a known shape that matches the ts-rs binding
//      one-to-one.
//   2. Adding runtime validation in the hot path would cost shell
//      startup time on every refresh.
//
// If a snapshot ever returns null or a non-object, we still return null
// here — that lets the UI keep rendering its empty state rather than
// throwing.
function coerceSnapshot<T>(value: JsonValue): T | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as unknown as T) : null;
}
import type {
  AudioChannelUpdateRequest,
  AudioMeterEntry,
  AudioMeterFrame,
  AudioMixTargetUpdateRequest,
  AudioSettingsUpdateRequest,
  CommissioningCheckRequest,
  CommissioningUpdateRequest,
  EngineTransport,
  LightingFixtureCreateRequest,
  LightingFixtureUpdateRequest,
  LightingGroupUpdateRequest,
  LightingPaletteApplyRequest,
  LightingPaletteCreateRequest,
  LightingPaletteUpdateRequest,
  LightingPreviewModeRequest,
  LightingSceneCreateRequest,
  LightingSceneUpdateRequest,
  PlanningProjectCreateRequest,
  PlanningProjectReorderRequest,
  LightingSettingsUpdateRequest,
  PlanningSettingsUpdateRequest,
  PlanningTaskCreateRequest,
  PlanningTaskRescheduleRequest,
  ShellState,
  ShellStore,
  StartupFailure,
  WorkspaceId,
} from "../types";

const initialState: ShellState = {
  lifecycle: "idle",
  recovery: "healthy",
  activeWorkspace: "setup",
  appSnapshot: null,
  healthSnapshot: null,
  commissioningSnapshot: null,
  lightingSnapshot: null,
  lightingFixtureCatalogSnapshot: null,
  lightingDmxMonitorSnapshot: null,
  audioSnapshot: null,
  planningSnapshot: null,
  supportSnapshot: null,
  controlSurfaceSnapshot: null,
  startupFailure: null,
  lastEvent: null,
  errorSummary: null,
};

const initialAudioMeterFrame: AudioMeterFrame = {
  activeMixTargetId: null,
  cadenceHz: null,
  channels: {},
  diagnostics: null,
  lastPacketAgeMs: null,
  meteringSource: null,
  meteringState: null,
  mixTargets: {},
  monotonicTimestampMs: null,
  sequence: 0,
};

interface PendingStartupGate {
  reject: (failure: StartupFailure) => void;
  resolve: (payload: JsonObject) => void;
  timeoutId: number;
}

function deriveWorkspace(appSnapshot: JsonObject | null): WorkspaceId {
  const startup = appSnapshot?.startup;
  const startupTargetSurface =
    typeof startup === "object" && startup && "targetSurface" in startup ? (startup.targetSurface as string) : null;

  if (startupTargetSurface === "commissioning") {
    return "setup";
  }

  const workspace = appSnapshot?.shell;
  const value =
    typeof workspace === "object" && workspace && "workspace" in workspace ? (workspace.workspace as string) : "setup";

  if (value === "lighting" || value === "audio" || value === "planning") {
    return value;
  }

  return "setup";
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function isStartupFailure(value: unknown): value is StartupFailure {
  const record = asRecord(value);
  return record !== null && typeof record.stage === "string" && typeof record.code === "string";
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrUndefined(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function currentMonotonicTimestampMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function normalizedToDbfs(value: number) {
  const normalized = Math.max(0, Math.min(1, value));
  if (normalized <= 0) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(normalized)));
}

export function audioMeterEntryFromRecord(value: unknown): AudioMeterEntry | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string") {
    return null;
  }

  const meterLeft = numberOrZero(record.meterLeft);
  const meterRight = numberOrZero(record.meterRight);
  const meterLevel = numberOrZero(record.meterLevel);
  const peakHoldLeft = numberOrZero(record.peakHoldLeft);
  const peakHoldRight = numberOrZero(record.peakHoldRight);
  const fallbackPeakLeft = Math.max(peakHoldLeft, meterLeft);
  const fallbackPeakRight = Math.max(peakHoldRight, meterRight);
  const levelLeftDbfs =
    numberOrNull(record.levelLeftDbfs) ?? numberOrNull(record.rmsLeftDbfs) ?? normalizedToDbfs(meterLeft);
  const levelRightDbfs =
    numberOrNull(record.levelRightDbfs) ?? numberOrNull(record.rmsRightDbfs) ?? normalizedToDbfs(meterRight);
  const clipHold = booleanOrUndefined(record.clipHold);
  const clip = booleanOrUndefined(record.clip) ?? clipHold;
  const meterPointOverLeft = booleanOrUndefined(record.meterPointOverLeft) ?? booleanOrUndefined(record.overLeft);
  const meterPointOverRight = booleanOrUndefined(record.meterPointOverRight) ?? booleanOrUndefined(record.overRight);
  const meterPointOver =
    booleanOrUndefined(record.meterPointOver) ??
    booleanOrUndefined(record.over) ??
    (meterPointOverLeft === true || meterPointOverRight === true);
  const channelPathClipHold = booleanOrUndefined(record.channelPathClipHold) ?? clipHold;
  const channelPathClip = booleanOrUndefined(record.channelPathClip) ?? channelPathClipHold ?? clip;

  return {
    channelPathClip,
    channelPathClipHold,
    clip,
    clipHold,
    levelLeftDbfs,
    levelRightDbfs,
    lufs:
      typeof record.lufsIntegrated === "number" && Number.isFinite(record.lufsIntegrated)
        ? record.lufsIntegrated
        : null,
    meterLeft,
    meterLevel: typeof record.meterLevel === "number" && Number.isFinite(record.meterLevel) ? meterLevel : undefined,
    meterPoint: typeof record.meterPoint === "string" ? record.meterPoint : null,
    meterPointOver,
    meterPointOverLeft,
    meterPointOverRight,
    meterRight,
    over: booleanOrUndefined(record.over) ?? meterPointOver,
    overLeft: booleanOrUndefined(record.overLeft) ?? meterPointOverLeft,
    overRight: booleanOrUndefined(record.overRight) ?? meterPointOverRight,
    peakHoldLeft,
    peakHoldRight,
    peakHoldLeftDbfs: numberOrNull(record.peakHoldLeftDbfs) ?? normalizedToDbfs(peakHoldLeft),
    peakHoldRightDbfs: numberOrNull(record.peakHoldRightDbfs) ?? normalizedToDbfs(peakHoldRight),
    peakLeftDbfs: numberOrNull(record.peakLeftDbfs) ?? normalizedToDbfs(fallbackPeakLeft),
    peakRightDbfs: numberOrNull(record.peakRightDbfs) ?? normalizedToDbfs(fallbackPeakRight),
    peakWarning: booleanOrUndefined(record.peakWarning),
    rmsLeftDbfs: numberOrNull(record.rmsLeftDbfs) ?? levelLeftDbfs,
    rmsRightDbfs: numberOrNull(record.rmsRightDbfs) ?? levelRightDbfs,
  };
}

function buildAudioMeterFrame(snapshot: AudioSnapshot | null, sequence: number): AudioMeterFrame {
  if (!snapshot) {
    return {
      ...initialAudioMeterFrame,
      sequence,
    };
  }

  const channels: Record<string, AudioMeterEntry> = {};
  for (const channel of snapshot.channels) {
    const entry = audioMeterEntryFromRecord(channel);
    if (entry) {
      channels[channel.id] = entry;
    }
  }

  const mixTargets: Record<string, AudioMeterEntry> = {};
  for (const mixTarget of snapshot.mixTargets) {
    const entry = audioMeterEntryFromRecord(mixTarget);
    if (entry) {
      mixTargets[mixTarget.id] = entry;
    }
  }

  return {
    activeMixTargetId: snapshot.selectedMixTargetId ?? snapshot.mixTargets[0]?.id ?? null,
    cadenceHz: null,
    channels,
    diagnostics: null,
    lastPacketAgeMs: null,
    meteringSource: typeof snapshot.meteringSource === "string" ? snapshot.meteringSource : null,
    meteringState: typeof snapshot.meteringState === "string" ? snapshot.meteringState : null,
    mixTargets,
    monotonicTimestampMs: currentMonotonicTimestampMs(),
    sequence,
  };
}

function buildAudioMeterFrameFromPayload(payload: JsonObject | null, sequence: number): AudioMeterFrame | null {
  if (!payload || !Array.isArray(payload.channels) || !Array.isArray(payload.mixTargets)) {
    return null;
  }

  const channels: Record<string, AudioMeterEntry> = {};
  for (const channel of payload.channels) {
    const entry = audioMeterEntryFromRecord(channel);
    const record = asRecord(channel);
    if (entry && record?.id && typeof record.id === "string") {
      channels[record.id] = entry;
    }
  }

  const mixTargets: Record<string, AudioMeterEntry> = {};
  for (const mixTarget of payload.mixTargets) {
    const entry = audioMeterEntryFromRecord(mixTarget);
    const record = asRecord(mixTarget);
    if (entry && record?.id && typeof record.id === "string") {
      mixTargets[record.id] = entry;
    }
  }

  return {
    activeMixTargetId:
      typeof payload.selectedMixTargetId === "string"
        ? payload.selectedMixTargetId
        : (Object.keys(mixTargets)[0] ?? null),
    cadenceHz: numberOrNull(payload.cadenceHz),
    channels,
    diagnostics: asRecord(payload.diagnostics),
    lastPacketAgeMs: numberOrNull(payload.lastPacketAgeMs),
    meteringSource: typeof payload.meteringSource === "string" ? payload.meteringSource : null,
    meteringState: typeof payload.meteringState === "string" ? payload.meteringState : null,
    mixTargets,
    monotonicTimestampMs: numberOrNull(payload.monotonicTimestampMs) ?? currentMonotonicTimestampMs(),
    sequence,
  };
}

function coerceAudioSnapshot(value: JsonValue): AudioSnapshot | null {
  const snapshot = coerceSnapshot<AudioSnapshot>(value);
  return snapshot && Array.isArray(snapshot.channels) && Array.isArray(snapshot.mixTargets) ? snapshot : null;
}

function recordId(value: unknown) {
  const record = asRecord(value);
  return typeof record?.id === "string" ? record.id : null;
}

function patchAudioChannel(snapshot: AudioSnapshot, value: JsonValue): AudioSnapshot | null {
  const id = recordId(value);
  if (!id || !snapshot.channels.some((channel) => channel.id === id)) {
    return null;
  }

  return {
    ...snapshot,
    channels: snapshot.channels.map((channel) =>
      channel.id === id ? (value as AudioSnapshot["channels"][number]) : channel
    ),
  };
}

function patchAudioMixTarget(snapshot: AudioSnapshot, value: JsonValue): AudioSnapshot | null {
  const id = recordId(value);
  if (!id || !snapshot.mixTargets.some((mixTarget) => mixTarget.id === id)) {
    return null;
  }

  return {
    ...snapshot,
    mixTargets: snapshot.mixTargets.map((mixTarget) =>
      mixTarget.id === id ? (value as AudioSnapshot["mixTargets"][number]) : mixTarget
    ),
  };
}

function patchAudioSnapshotList(method: string, snapshot: AudioSnapshot, params: JsonObject, value: JsonValue) {
  const result = asRecord(value);
  const scene = asRecord(result?.snapshot);
  const sceneId = typeof scene?.id === "string" ? scene.id : null;

  if (method === "audio.snapshot.delete") {
    const snapshotId = typeof params.snapshotId === "string" ? params.snapshotId : null;
    if (!snapshotId) return null;
    return {
      ...snapshot,
      lastRecalledSnapshotId: snapshot.lastRecalledSnapshotId === snapshotId ? null : snapshot.lastRecalledSnapshotId,
      lastSnapshotRecallAt: snapshot.lastRecalledSnapshotId === snapshotId ? null : snapshot.lastSnapshotRecallAt,
      snapshots: snapshot.snapshots.filter((entry) => entry.id !== snapshotId),
    };
  }

  if (!sceneId) return null;

  const nextScene = scene as AudioSnapshot["snapshots"][number];
  const existing = snapshot.snapshots.some((entry) => entry.id === sceneId);
  return {
    ...snapshot,
    snapshots: existing
      ? snapshot.snapshots.map((entry) => (entry.id === sceneId ? nextScene : entry))
      : [...snapshot.snapshots, nextScene],
  };
}

function patchAudioClipClear(snapshot: AudioSnapshot, params: JsonObject) {
  const channelId = typeof params.channelId === "string" ? params.channelId : null;
  return {
    ...snapshot,
    channels: snapshot.channels.map((channel) =>
      !channelId || channel.id === channelId
        ? {
            ...channel,
            clip: false,
          }
        : channel
    ),
  };
}

function normalizeStartupFailure(error: unknown): StartupFailure {
  if (isStartupFailure(error)) {
    const pathsRecord = asRecord(error.paths);
    return {
      code: String(error.code),
      message: String(error.message ?? "Engine startup failed."),
      paths: pathsRecord
        ? Object.fromEntries(
            Object.entries(pathsRecord).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : []))
          )
        : undefined,
      requestedProtocol: typeof error.requestedProtocol === "string" ? error.requestedProtocol : undefined,
      stage: String(error.stage),
      supportedProtocol: typeof error.supportedProtocol === "string" ? error.supportedProtocol : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      code: "ENGINE_STARTUP_FAILED",
      message: error.message,
      stage: "frontend-bootstrap",
    };
  }

  const errorRecord = asRecord(error);
  if (errorRecord) {
    return {
      code: typeof errorRecord.code === "string" ? errorRecord.code : "ENGINE_STARTUP_FAILED",
      message: typeof errorRecord.message === "string" ? errorRecord.message : JSON.stringify(errorRecord),
      stage: typeof errorRecord.stage === "string" ? errorRecord.stage : "frontend-bootstrap",
    };
  }

  if (typeof error === "string" && error.trim()) {
    return {
      code: "ENGINE_STARTUP_FAILED",
      message: error,
      stage: "frontend-bootstrap",
    };
  }

  return {
    code: "ENGINE_STARTUP_FAILED",
    message: "Engine startup failed.",
    stage: "frontend-bootstrap",
  };
}

export function createShellStore(transport: EngineTransport): ShellStore {
  let state = initialState;
  let audioMeterFrame = initialAudioMeterFrame;
  const listeners = new Set<() => void>();
  const audioMeterListeners = new Set<() => void>();
  let unsubscribeTransport = () => {};
  let initializePromise: Promise<void> | null = null;
  let pendingStartupGate: PendingStartupGate | null = null;
  let bootstrapGeneration = 0;
  let audioRefreshInFlight = false;
  let audioRefreshQueued = false;
  let audioMeterSequence = 0;
  let audioLocalMutationDepth = 0;
  let audioRefreshSuppressUntilMs = 0;

  const setState = (nextState: ShellState) => {
    state = nextState;
    for (const listener of listeners) {
      listener();
    }
  };

  const updateState = (partial: Partial<ShellState>) => {
    setState({
      ...state,
      ...partial,
    });
  };

  const publishAudioMeterFrame = (audioSnapshot: AudioSnapshot | null) => {
    audioMeterFrame = buildAudioMeterFrame(audioSnapshot, ++audioMeterSequence);
    for (const listener of audioMeterListeners) {
      listener();
    }
  };

  const applyAudioSnapshot = (audioSnapshot: AudioSnapshot | null, eventName: EventName | null = "audio.changed") => {
    publishAudioMeterFrame(audioSnapshot);
    if (state.lifecycle !== "ready") {
      return;
    }

    setState({
      ...state,
      audioSnapshot,
      lastEvent: eventName ?? state.lastEvent,
      errorSummary: null,
    });
  };

  const applyPatchedAudioSnapshot = (audioSnapshot: AudioSnapshot, eventName: EventName | null = "audio.changed") => {
    applyAudioSnapshot(audioSnapshot, eventName);
    return true;
  };

  const applyAudioCommandResult = (method: string, params: JsonObject, result: JsonValue) => {
    const fullSnapshot = coerceAudioSnapshot(result);
    if (fullSnapshot) {
      return applyPatchedAudioSnapshot(fullSnapshot, "audio.changed");
    }

    const currentAudioSnapshot = state.audioSnapshot;
    if (!currentAudioSnapshot || state.lifecycle !== "ready") {
      return false;
    }

    if (
      method === "audio.channel.update" ||
      method === "audio.channel.eq.update" ||
      method === "audio.channel.dynamics.update" ||
      method === "audio.channel.send.update"
    ) {
      const patched = patchAudioChannel(currentAudioSnapshot, result);
      return patched ? applyPatchedAudioSnapshot(patched, "audio.changed") : false;
    }

    if (method === "audio.mixTarget.update") {
      const patched = patchAudioMixTarget(currentAudioSnapshot, result);
      return patched ? applyPatchedAudioSnapshot(patched, "audio.changed") : false;
    }

    if (
      method === "audio.snapshot.create" ||
      method === "audio.snapshot.update" ||
      method === "audio.snapshot.delete"
    ) {
      const patched = patchAudioSnapshotList(method, currentAudioSnapshot, params, result);
      return patched ? applyPatchedAudioSnapshot(patched, "audio.changed") : false;
    }

    if (method === "audio.clip.clear") {
      return applyPatchedAudioSnapshot(patchAudioClipClear(currentAudioSnapshot, params), "audio.changed");
    }

    if (method === "audio.sync") {
      const record = asRecord(result);
      return applyPatchedAudioSnapshot(
        {
          ...currentAudioSnapshot,
          consoleStateConfidence:
            typeof record?.consoleStateConfidence === "string"
              ? record.consoleStateConfidence
              : currentAudioSnapshot.consoleStateConfidence,
          lastActionCode: null,
          lastActionMessage:
            typeof record?.summary === "string" ? record.summary : currentAudioSnapshot.lastActionMessage,
          lastActionStatus: "succeeded",
          lastConsoleSyncAt: new Date().toISOString(),
          lastConsoleSyncReason: "manual sync",
        },
        "audio.changed"
      );
    }

    return false;
  };

  const publishAudioMeterPayload = (payload: JsonObject | null) => {
    const nextFrame = buildAudioMeterFrameFromPayload(payload, ++audioMeterSequence);
    if (!nextFrame) {
      return false;
    }

    audioMeterFrame = nextFrame;
    if (state.audioSnapshot) {
      const nextMeteringSource = nextFrame.meteringSource ?? state.audioSnapshot.meteringSource;
      const nextMeteringState = nextFrame.meteringState ?? state.audioSnapshot.meteringState;
      if (
        nextMeteringSource !== state.audioSnapshot.meteringSource ||
        nextMeteringState !== state.audioSnapshot.meteringState
      ) {
        setState({
          ...state,
          audioSnapshot: {
            ...state.audioSnapshot,
            meteringSource: nextMeteringSource,
            meteringState: nextMeteringState,
          },
          lastEvent: "audio.changed",
        });
      }
    }
    for (const listener of audioMeterListeners) {
      listener();
    }
    return true;
  };

  const clearStartupGate = () => {
    if (!pendingStartupGate) {
      return;
    }

    window.clearTimeout(pendingStartupGate.timeoutId);
    pendingStartupGate = null;
  };

  const waitForEngineReady = () =>
    new Promise<JsonObject>((resolve, reject) => {
      clearStartupGate();
      const timeoutId = window.setTimeout(() => {
        pendingStartupGate = null;
        reject(
          normalizeStartupFailure({
            code: "ENGINE_READY_TIMEOUT",
            message: "Timed out waiting for the engine ready event.",
            stage: "ready-event",
          })
        );
      }, 10_000);

      pendingStartupGate = {
        resolve: (payload) => {
          window.clearTimeout(timeoutId);
          pendingStartupGate = null;
          resolve(payload);
        },
        reject: (failure) => {
          window.clearTimeout(timeoutId);
          pendingStartupGate = null;
          reject(failure);
        },
        timeoutId,
      };
    });

  const waitForEngineHandshake = async () => {
    const readyEventPromise = waitForEngineReady();
    const pingFallbackPromise = transport
      .request("engine.ping")
      .then((value) => {
        const payload = value as JsonObject;
        clearStartupGate();
        return payload;
      })
      .catch(() => new Promise<JsonObject>(() => {}));

    try {
      return await Promise.race([readyEventPromise, pingFallbackPromise]);
    } finally {
      clearStartupGate();
    }
  };

  const refreshDomain = async (eventName: EventName | null = null) => {
    const [
      healthSnapshot,
      appSnapshot,
      commissioningSnapshot,
      lightingFixtureCatalogSnapshot,
      lightingSnapshot,
      lightingDmxMonitorSnapshot,
      audioSnapshot,
      planningSnapshot,
      supportSnapshot,
      controlSurfaceSnapshot,
    ] = await Promise.all([
      transport.request("health.snapshot").then((value) => value as JsonObject),
      transport.request("app.snapshot").then((value) => value as JsonObject),
      transport.request("commissioning.snapshot").then((value) => value as JsonObject),
      transport
        .request("lighting.fixtureCatalog.snapshot")
        .then((value) => coerceSnapshot<LightingFixtureCatalogSnapshot>(value)),
      transport.request("lighting.snapshot").then((value) => coerceSnapshot<LightingSnapshot>(value)),
      transport
        .request("lighting.dmxMonitor.snapshot")
        .then((value) => coerceSnapshot<LightingDmxMonitorSnapshot>(value)),
      transport.request("audio.snapshot").then((value) => coerceSnapshot<AudioSnapshot>(value)),
      transport.request("planning.snapshot").then((value) => coerceSnapshot<PlanningSnapshot>(value)),
      transport.request("support.snapshot").then((value) => value as JsonObject),
      transport.request("controlSurface.snapshot").then((value) => value as JsonObject),
    ]);

    setState({
      ...state,
      lifecycle: "ready",
      recovery: deriveRecoveryState(healthSnapshot),
      healthSnapshot,
      appSnapshot,
      commissioningSnapshot,
      lightingFixtureCatalogSnapshot,
      lightingSnapshot,
      lightingDmxMonitorSnapshot,
      audioSnapshot,
      planningSnapshot,
      supportSnapshot,
      controlSurfaceSnapshot,
      activeWorkspace: deriveWorkspace(appSnapshot),
      startupFailure: null,
      lastEvent: eventName ?? state.lastEvent,
      errorSummary: null,
    });
    publishAudioMeterFrame(audioSnapshot);
  };

  const refreshAudioSnapshot = async (eventName: EventName) => {
    if (audioRefreshInFlight) {
      audioRefreshQueued = true;
      return;
    }

    audioRefreshInFlight = true;
    try {
      const audioSnapshot = await transport.request("audio.snapshot").then((value) => coerceAudioSnapshot(value));
      applyAudioSnapshot(audioSnapshot, eventName);
    } finally {
      audioRefreshInFlight = false;
      if (audioRefreshQueued) {
        audioRefreshQueued = false;
        void refreshAudioSnapshot(eventName);
      }
    }
  };

  const handleTransportEvent = (event: EventEnvelope<EventName>) => {
    if (event.event === "engine.ready") {
      pendingStartupGate?.resolve(event.payload);
      return;
    }

    if (event.event === "engine.startupFailed") {
      const startupFailure = normalizeStartupFailure(event.payload);

      setState({
        ...state,
        lifecycle: "failed",
        recovery: "recovery",
        startupFailure,
        lastEvent: event.event,
        errorSummary: startupFailure.message,
      });

      pendingStartupGate?.reject(startupFailure);
      return;
    }

    if (state.lifecycle === "ready") {
      const payload = asRecord(event.payload);
      if (event.event === "audio.meters" || (event.event === "audio.changed" && payload?.reason === "metering-tick")) {
        publishAudioMeterPayload(payload);
        return;
      }
      if (event.event === "audio.changed") {
        if (audioLocalMutationDepth > 0 || currentMonotonicTimestampMs() < audioRefreshSuppressUntilMs) {
          return;
        }
        void refreshAudioSnapshot(event.event);
        return;
      }
      void refreshDomain(event.event);
    }
  };

  const bootstrap = async () => {
    const generation = ++bootstrapGeneration;
    const isCurrentBootstrap = () => generation === bootstrapGeneration;

    clearStartupGate();
    unsubscribeTransport();
    unsubscribeTransport = () => {};

    setState({
      ...initialState,
      lifecycle: transitionStartupState("idle", { type: "spawned" }),
    });
    publishAudioMeterFrame(null);

    unsubscribeTransport = transport.subscribe((event) => {
      if (isCurrentBootstrap()) {
        handleTransportEvent(event);
      }
    });

    try {
      await transport.initialize?.();
      if (!isCurrentBootstrap()) return;

      updateState({
        lifecycle: transitionStartupState("launching-process", {
          type: "process-launched",
        }),
      });

      const readyPayload = await waitForEngineHandshake();
      if (!isCurrentBootstrap()) return;

      const reportedProtocol = typeof readyPayload.protocol === "string" ? readyPayload.protocol : "unknown";

      if (reportedProtocol !== PROTOCOL_VERSION) {
        throw normalizeStartupFailure({
          code: "PROTOCOL_MISMATCH",
          message: `Shell expected protocol ${PROTOCOL_VERSION} but engine reported ${reportedProtocol}.`,
          requestedProtocol: PROTOCOL_VERSION,
          stage: "protocol-negotiation",
          supportedProtocol: reportedProtocol,
        });
      }

      updateState({
        lifecycle: transitionStartupState("waiting-for-ready-event", {
          type: "ready-event-received",
        }),
      });

      const healthSnapshot = (await transport.request("health.snapshot")) as JsonObject;
      if (!isCurrentBootstrap()) return;

      updateState({
        lifecycle: transitionStartupState("waiting-for-health-snapshot", {
          type: "health-loaded",
        }),
        healthSnapshot,
        recovery: deriveRecoveryState(healthSnapshot),
      });

      const [
        appSnapshot,
        commissioningSnapshot,
        lightingFixtureCatalogSnapshot,
        lightingSnapshot,
        lightingDmxMonitorSnapshot,
        audioSnapshot,
        planningSnapshot,
        supportSnapshot,
        controlSurfaceSnapshot,
      ] = await Promise.all([
        transport.request("app.snapshot").then((value) => value as JsonObject),
        transport.request("commissioning.snapshot").then((value) => value as JsonObject),
        transport
          .request("lighting.fixtureCatalog.snapshot")
          .then((value) => coerceSnapshot<LightingFixtureCatalogSnapshot>(value)),
        transport.request("lighting.snapshot").then((value) => coerceSnapshot<LightingSnapshot>(value)),
        transport
          .request("lighting.dmxMonitor.snapshot")
          .then((value) => coerceSnapshot<LightingDmxMonitorSnapshot>(value)),
        transport.request("audio.snapshot").then((value) => coerceSnapshot<AudioSnapshot>(value)),
        transport.request("planning.snapshot").then((value) => coerceSnapshot<PlanningSnapshot>(value)),
        transport.request("support.snapshot").then((value) => value as JsonObject),
        transport.request("controlSurface.snapshot").then((value) => value as JsonObject),
      ]);
      if (!isCurrentBootstrap()) return;

      setState({
        lifecycle: transitionStartupState("waiting-for-app-snapshot", { type: "app-loaded" }),
        recovery: deriveRecoveryState(healthSnapshot),
        activeWorkspace: deriveWorkspace(appSnapshot),
        appSnapshot,
        healthSnapshot,
        commissioningSnapshot,
        lightingFixtureCatalogSnapshot,
        lightingSnapshot,
        lightingDmxMonitorSnapshot,
        audioSnapshot,
        planningSnapshot,
        supportSnapshot,
        controlSurfaceSnapshot,
        startupFailure: null,
        lastEvent: "engine.ready",
        errorSummary: null,
      });
      publishAudioMeterFrame(audioSnapshot);
    } catch (error) {
      if (!isCurrentBootstrap()) return;

      const startupFailure = normalizeStartupFailure(error);
      setState({
        ...state,
        lifecycle: "failed",
        recovery: "recovery",
        startupFailure,
        errorSummary: startupFailure.message,
      });
    } finally {
      if (isCurrentBootstrap()) {
        clearStartupGate();
      }
    }
  };

  const start = () => {
    if (!initializePromise) {
      const trackedPromise = bootstrap().finally(() => {
        if (initializePromise === trackedPromise) {
          initializePromise = null;
        }
      });
      initializePromise = trackedPromise;
    }

    return initializePromise;
  };

  const performRequest = async (method: string, params: JsonObject = {}) => {
    const result = await transport.request(method as never, params);
    if (state.lifecycle === "ready") {
      await refreshDomain(state.lastEvent);
    }
    return result;
  };

  const performAudioRequest = async (method: string, params: JsonObject = {}) => {
    audioLocalMutationDepth++;
    try {
      const result = await transport.request(method as never, params);
      if (state.lifecycle === "ready") {
        const applied = applyAudioCommandResult(method, params, result);
        if (applied) {
          audioRefreshSuppressUntilMs = currentMonotonicTimestampMs() + 250;
        }
        if (!applied) {
          await refreshAudioSnapshot("audio.changed");
        }
      }
      return result;
    } finally {
      audioLocalMutationDepth = Math.max(0, audioLocalMutationDepth - 1);
    }
  };

  return {
    async initialize() {
      return start();
    },
    getSnapshot() {
      return state;
    },
    async refresh() {
      if (state.lifecycle !== "ready") {
        return;
      }
      await refreshDomain(state.lastEvent);
    },
    async restart() {
      bootstrapGeneration++;
      initializePromise = null;
      clearStartupGate();
      unsubscribeTransport();
      unsubscribeTransport = () => {};
      await transport.dispose?.();
      return start();
    },
    async setWorkspace(workspaceId) {
      return performRequest("settings.update", { workspace: workspaceId });
    },
    async setSetupSection(section) {
      return performRequest("settings.update", {
        setup: {
          activeSection: section,
        },
      });
    },
    async setLightingSection(sectionId) {
      return performRequest("settings.update", {
        lighting: {
          currentSectionId: sectionId,
        },
      });
    },
    async setLightingSceneThumbs(thumbs) {
      return performRequest("settings.update", {
        lighting: {
          sceneThumbs: thumbs as unknown as JsonObject,
        },
      });
    },
    async setLightingTalentMarks(marks) {
      return performRequest("settings.update", {
        lighting: {
          talentMarks: marks as unknown as JsonObject[],
        },
      });
    },
    async runCommissioningCheck(request: CommissioningCheckRequest) {
      return performRequest("commissioning.check.run", request as unknown as JsonObject);
    },
    async updateCommissioning(request: CommissioningUpdateRequest) {
      return performRequest("commissioning.update", request as unknown as JsonObject);
    },
    async syncAudio() {
      return performAudioRequest("audio.sync");
    },
    async recallAudioSnapshot(snapshotId: string) {
      return performAudioRequest("audio.snapshot.recall", { snapshotId });
    },
    async createAudioSnapshot(request) {
      return performAudioRequest("audio.snapshot.create", request as unknown as JsonObject);
    },
    async updateAudioSnapshot(request) {
      return performAudioRequest("audio.snapshot.update", request as unknown as JsonObject);
    },
    async deleteAudioSnapshot(request) {
      return performAudioRequest("audio.snapshot.delete", request as unknown as JsonObject);
    },
    async clearAudioClips(request = {}) {
      return performAudioRequest("audio.clip.clear", request as unknown as JsonObject);
    },
    async clearAllAudioSolo() {
      return performAudioRequest("audio.solo.clearAll");
    },
    async updateAudioChannel(request: AudioChannelUpdateRequest) {
      return performAudioRequest("audio.channel.update", request as unknown as JsonObject);
    },
    async updateAudioChannelEq(request) {
      return performAudioRequest("audio.channel.eq.update", request as unknown as JsonObject);
    },
    async updateAudioChannelDynamics(request) {
      return performAudioRequest("audio.channel.dynamics.update", request as unknown as JsonObject);
    },
    async updateAudioChannelSendMode(request) {
      return performAudioRequest("audio.channel.send.update", request as unknown as JsonObject);
    },
    async updateAudioMixTarget(request: AudioMixTargetUpdateRequest) {
      return performAudioRequest("audio.mixTarget.update", request as unknown as JsonObject);
    },
    async updateAudioSettings(request: AudioSettingsUpdateRequest) {
      return performAudioRequest("audio.settings.update", request as unknown as JsonObject);
    },
    async updateLightingSettings(request: LightingSettingsUpdateRequest) {
      return performRequest("lighting.settings.update", request as JsonObject);
    },
    async createLightingGroup(name: string) {
      return performRequest("lighting.group.create", { name });
    },
    async updateLightingGroup(request: LightingGroupUpdateRequest) {
      return performRequest("lighting.group.update", request as unknown as JsonObject);
    },
    async deleteLightingGroup(groupId: string) {
      return performRequest("lighting.group.delete", { groupId });
    },
    async createLightingFixture(request: LightingFixtureCreateRequest) {
      return performRequest("lighting.fixture.create", request as unknown as JsonObject);
    },
    async createLightingScene(request: LightingSceneCreateRequest) {
      return performRequest("lighting.scene.create", request as unknown as JsonObject);
    },
    async updateLightingScene(request: LightingSceneUpdateRequest) {
      return performRequest("lighting.scene.update", request as unknown as JsonObject);
    },
    async setLightingPreviewMode(request: LightingPreviewModeRequest) {
      return performRequest("lighting.editor.previewMode", request as unknown as JsonObject);
    },
    async discardLightingPreview() {
      return performRequest("lighting.editor.previewDiscard");
    },
    async listLightingPalettes() {
      return performRequest("lighting.palette.list");
    },
    async createLightingPalette(request: LightingPaletteCreateRequest) {
      return performRequest("lighting.palette.create", request as unknown as JsonObject);
    },
    async updateLightingPalette(request: LightingPaletteUpdateRequest) {
      return performRequest("lighting.palette.update", request as unknown as JsonObject);
    },
    async deleteLightingPalette(paletteId: string) {
      return performRequest("lighting.palette.delete", { paletteId });
    },
    async applyLightingPalette(request: LightingPaletteApplyRequest) {
      return performRequest("lighting.palette.apply", {
        ...request,
        fixtureIds: [...request.fixtureIds],
      } as unknown as JsonObject);
    },
    async deleteLightingScene(sceneId: string) {
      return performRequest("lighting.scene.delete", { sceneId });
    },
    async reorderLightingScene(sceneId: string, beforeSceneId: string | null) {
      return performRequest("lighting.scene.reorder", { sceneId, beforeSceneId });
    },
    async reorderLightingGroup(groupId: string, beforeGroupId: string | null) {
      return performRequest("lighting.group.reorder", { groupId, beforeGroupId });
    },
    async pinLightingScene(sceneId: string, pinned: boolean) {
      return performRequest("lighting.scene.pin", { sceneId, pinned });
    },
    async updateLightingFixture(request: LightingFixtureUpdateRequest) {
      return performRequest("lighting.fixture.update", request as unknown as JsonObject);
    },
    async identifyLightingFixture(fixtureId: string, durationMs?: number) {
      return performRequest(
        "lighting.fixture.identify",
        durationMs === undefined ? { fixtureId } : { fixtureId, durationMs }
      );
    },
    async highlightLightingFixtures(fixtureIds: readonly string[], mode: "highlight" | "solo" | "off") {
      return performRequest("lighting.fixture.highlight", {
        fixtureIds: [...fixtureIds],
        mode,
      });
    },
    async startLightingIdentifySequence(fixtureIds: readonly string[], stepMs: number, durationMs: number) {
      return performRequest("lighting.fixture.identifySequence", {
        fixtureIds: [...fixtureIds],
        stepMs,
        durationMs,
      });
    },
    async clearLightingIdentifyBursts() {
      return performRequest("lighting.fixture.identify.clearAll");
    },
    async deleteLightingFixture(fixtureId: string) {
      return performRequest("lighting.fixture.delete", { fixtureId });
    },
    async setLightingGroupPower(groupId: string, on: boolean) {
      return performRequest("lighting.group.power", { groupId, on });
    },
    async setLightingAllPower(on: boolean) {
      return performRequest("lighting.power.all", { on });
    },
    async recallLightingScene(sceneId: string, fadeMs?: number) {
      return performRequest("lighting.scene.recall", fadeMs === undefined ? { sceneId } : { sceneId, fadeMs });
    },
    async seedPlanningDemo(replaceExistingData = false) {
      return performRequest("commissioning.seedPlanningDemo", { replaceExistingData });
    },
    async createPlanningProject(request: PlanningProjectCreateRequest) {
      return performRequest("planning.project.create", request as unknown as JsonObject);
    },
    async reorderPlanningProject(request: PlanningProjectReorderRequest) {
      return performRequest("planning.project.reorder", request as unknown as JsonObject);
    },
    async createPlanningTask(request: PlanningTaskCreateRequest) {
      return performRequest("planning.task.create", request as unknown as JsonObject);
    },
    async addPlanningChecklistItem(taskId: string, text: string) {
      return performRequest("planning.task.checklist.add", { taskId, text });
    },
    async setPlanningChecklistItemDone(taskId: string, itemId: string, done: boolean) {
      return performRequest("planning.task.checklist.update", { done, itemId, taskId });
    },
    async readPlanningTimeReport(projectId?: string) {
      return performRequest("planning.report.time", projectId ? ({ projectId } as JsonObject) : {});
    },
    async updatePlanningSettings(request: PlanningSettingsUpdateRequest) {
      return performRequest("planning.settings.update", request as unknown as JsonObject);
    },
    async reschedulePlanningTask(request: PlanningTaskRescheduleRequest) {
      return performRequest("planning.task.reschedule", request as unknown as JsonObject);
    },
    async togglePlanningTaskComplete(taskId: string) {
      return performRequest("planning.task.toggleComplete", { taskId });
    },
    async exportSupportBackup() {
      return performRequest("support.backup.export");
    },
    async restoreSupportBackup(path: string) {
      return performRequest("support.backup.restore", { path });
    },
    async exportCompanionConfig(baseUrl?: string) {
      return performRequest("exports.companion.export", baseUrl ? { baseUrl } : {});
    },
    getAudioMeterFrame() {
      return audioMeterFrame;
    },
    subscribeAudioMeters(listener) {
      audioMeterListeners.add(listener);
      return () => audioMeterListeners.delete(listener);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      bootstrapGeneration++;
      initializePromise = null;
      clearStartupGate();
      unsubscribeTransport();
      unsubscribeTransport = () => {};
      await transport.dispose?.();
    },
  };
}

export function useAudioMeterFrame(store: ShellStore) {
  return useSyncExternalStore(store.subscribeAudioMeters, store.getAudioMeterFrame, store.getAudioMeterFrame);
}

export function useShellSnapshot(store: ShellStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
