import { useSyncExternalStore } from "react";

import {
  PROTOCOL_VERSION,
  type EventEnvelope,
  type EventName,
  type JsonObject,
  type JsonValue,
} from "../generated/protocol";
import type { AudioSnapshot } from "../generated/snapshots/AudioSnapshot";
import { transitionStartupState } from "../machines/startupMachine";
import { deriveRecoveryState } from "../machines/recoveryMachine";
import { ALL_DOMAINS, DOMAIN_REQUESTS, domainsForEvent, domainsForMethod, type DomainKey } from "./domainRefresh";
import { SnapshotShapeError, snapshotProblem } from "./snapshotGuards";

// Boundary cast for a command result that may or may not be a whole audio
// snapshot (`coerceAudioSnapshot` below tells the two apart). The snapshots
// the store fetches go through `snapshotGuards.ts` instead (2026-09 production
// readiness, Slice 9 — finding F32): the engine boundary is still the
// contract and there is still no schema library in the hot path, but the top
// of each shape is checked, so a malformed reply is refused where it arrives
// rather than thrown from inside a workspace.
function coerceSnapshot<T>(value: JsonValue): T | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as unknown as T) : null;
}
import type {
  AudioChannelUpdateRequest,
  AudioMeterEntry,
  AudioMeterFrame,
  AudioMixTargetUpdateRequest,
  AudioSettingsUpdateRequest,
  AudioTalkbackHoldRequest,
  BackgroundFailure,
  CommissioningCheckRequest,
  CommissioningUpdateRequest,
  EngineLaunchInfo,
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
  backgroundFailures: [],
  snapshotFault: null,
};

/** Where each domain's snapshot lives in the state. */
const DOMAIN_STATE_KEYS = {
  health: "healthSnapshot",
  app: "appSnapshot",
  commissioning: "commissioningSnapshot",
  lightingFixtureCatalog: "lightingFixtureCatalogSnapshot",
  lighting: "lightingSnapshot",
  lightingDmxMonitor: "lightingDmxMonitorSnapshot",
  audio: "audioSnapshot",
  planning: "planningSnapshot",
  support: "supportSnapshot",
  controlSurface: "controlSurfaceSnapshot",
} as const satisfies Record<DomainKey, keyof ShellState>;

export interface ShellStoreOptions {
  /**
   * A development build (`import.meta.env.DEV` in the app): a reply that fails
   * its guard throws, and `useShellSnapshot` rethrows it while rendering so the
   * error boundary names it; an event this build does not know is logged. A
   * production build keeps the last good snapshot instead and records the
   * failure for the diagnostics export.
   */
  development?: boolean;
}

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

// 2026-09 production readiness, Slice 5 (finding F09): an engine that stops
// on its own is restarted on its own — one, two and four seconds after the
// first, second and third stop within five minutes — and a fourth stop is
// left on the recovery surface for the operator.
const AUTOMATIC_RESTART_LIMIT = 3;
/** The start-up failures after which the engine stays up in recovery mode,
 *  answering only the backup requests (Slice 7 — F20). */
const RECOVERY_MODE_CODES = new Set(["STORAGE_CORRUPT", "STORAGE_MIGRATION_FAILED"]);
const AUTOMATIC_RESTART_WINDOW_MS = 5 * 60_000;
const AUTOMATIC_RESTART_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000];
/** Background failures kept for the diagnostics export (Slice 9 renders them). */
const BACKGROUND_FAILURE_LIMIT = 20;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  const record = asRecord(error);
  if (record && typeof record.message === "string") {
    return record.message;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

function launchGeneration(launch: EngineLaunchInfo | void | undefined): number | null {
  const record = asRecord(launch);
  return typeof record?.generation === "number" ? record.generation : null;
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

// `audio.talkback.hold` answers `{ mixTargetId, talkback, changed }` — patch
// the one flag locally so a hold heartbeat (every 750 ms) never triggers a
// full snapshot refetch.
function patchAudioTalkback(snapshot: AudioSnapshot, value: JsonValue): AudioSnapshot | null {
  const result = asRecord(value);
  const id = typeof result?.mixTargetId === "string" ? result.mixTargetId : null;
  const talkback = result?.talkback;
  if (!id || typeof talkback !== "boolean" || !snapshot.mixTargets.some((mixTarget) => mixTarget.id === id)) {
    return null;
  }
  return {
    ...snapshot,
    mixTargets: snapshot.mixTargets.map((mixTarget) =>
      mixTarget.id === id && mixTarget.talkback !== talkback ? { ...mixTarget, talkback } : mixTarget
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
      message: String(error.message ?? "Studio Control could not start."),
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
    message: "Studio Control could not start.",
    stage: "frontend-bootstrap",
  };
}

export function createShellStore(transport: EngineTransport, options: ShellStoreOptions = {}): ShellStore {
  const development = options.development === true;
  let state = initialState;
  // Slice 9 (F11): the snapshots asked for and not yet fetched, who is waiting
  // for them, and whether a batch is out. One batch is in flight at a time;
  // whatever is asked for meanwhile goes out together as the next one, so a
  // burst of events costs one request per snapshot and not one per event.
  let dirtyDomains = new Set<DomainKey>();
  let refreshWaiters: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];
  let refreshEvent: EventName | null = null;
  let refreshRunning = false;
  // Advanced by every bootstrap and dispose. A batch belongs to the run that
  // sent it: a request that never settles must not hold the queue past a
  // restart, which is the operator's remedy for a screen that stopped updating.
  let refreshRun = 0;
  let refreshInFlightWaiters: typeof refreshWaiters = [];
  // The fixture catalog is compiled into the hardware link: fetched once per
  // session, kept across a restart, fetched again only by `refresh()`.
  let catalogLoaded = false;
  let audioMeterFrame = initialAudioMeterFrame;
  const listeners = new Set<() => void>();
  const audioMeterListeners = new Set<() => void>();
  let unsubscribeTransport = () => {};
  let initializePromise: Promise<void> | null = null;
  let pendingStartupGate: PendingStartupGate | null = null;
  // 2026-09 production readiness, Slice 3: the failure the engine reported
  // during this bootstrap, if any. It can arrive while `engine_start` is still
  // returning — before the ready gate exists — and it is the answer, not a
  // ready timeout ten seconds later.
  let engineStartupFailure: StartupFailure | null = null;
  // Slice 5 (F09): the launch the shell reported for this bootstrap, so an
  // `engine.exited` about a process the shell already replaced is ignored.
  let engineGeneration: number | null = null;
  let automaticRestartTimeoutId: number | null = null;
  let automaticRestartsAt: number[] = [];
  let bootstrapGeneration = 0;
  let audioRefreshInFlight = false;
  let audioRefreshQueued = false;
  let audioMeterSequence = 0;
  let audioLocalMutationDepth = 0;
  let audioRefreshSuppressUntilMs = 0;
  // A console echo (TotalMix reporting a change, or an unconfirmed send) that
  // arrived while a local mutation was in flight; replayed once it finishes.
  let audioEchoRefreshPending = false;

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

    if (method === "audio.talkback.hold") {
      const patched = patchAudioTalkback(currentAudioSnapshot, result);
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

    // `audio.sync` is deliberately not patched locally (2026-09 audit
    // remediation, Slice 3): a sync is now a console pull that rewrites
    // channel and mix-target state engine-side, so the only truthful thing to
    // show is a fresh `audio.snapshot`. Returning false triggers that refresh.
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
      if (engineStartupFailure) {
        reject(engineStartupFailure);
        return;
      }
      const timeoutId = window.setTimeout(() => {
        pendingStartupGate = null;
        reject(
          normalizeStartupFailure({
            code: "ENGINE_READY_TIMEOUT",
            message: "Studio Control did not answer within ten seconds of starting.",
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

  // Slice 9 (F32): a reply is looked at before it becomes a snapshot. A
  // development build throws on a malformed one and leaves the fault in the
  // state, where `useShellSnapshot` rethrows it for the error boundary; a
  // production build records it and answers `null`, and the caller keeps the
  // last good snapshot — a failed refresh, never a throw.
  const acceptSnapshot = (domain: DomainKey, value: JsonValue): { value: JsonValue | null } | null => {
    const problem = snapshotProblem(domain, value);
    if (problem === null) {
      return { value: value ?? null };
    }
    const error = new SnapshotShapeError(domain, problem);
    if (development) {
      setState({ ...state, snapshotFault: error.message });
      throw error;
    }
    recordBackgroundFailure(error, "reply refused");
    return null;
  };

  // Fetches `domains` side by side. A request that fails does not cost the
  // others their answers: what arrived is returned with the failures beside it.
  const fetchDomains = async (domains: readonly DomainKey[], isCurrent: () => boolean) => {
    const settled = await Promise.allSettled(domains.map((domain) => transport.request(DOMAIN_REQUESTS[domain])));
    if (!isCurrent()) {
      return null;
    }
    const accepted = new Map<DomainKey, JsonValue | null>();
    const failures: unknown[] = [];
    settled.forEach((result, index) => {
      const domain = domains[index]!;
      if (result.status === "rejected") {
        failures.push(result.reason);
        return;
      }
      try {
        const snapshot = acceptSnapshot(domain, result.value);
        if (snapshot) {
          accepted.set(domain, snapshot.value);
        }
      } catch (error) {
        failures.push(error);
      }
    });
    return { accepted, failures };
  };

  // What a set of fetched snapshots changes in the state, and nothing else:
  // the lifecycle and the start-up failure are the bootstrap's to write, the
  // workspace follows the app snapshot only when that was fetched, and the
  // recovery state follows the health snapshot only when that was.
  const snapshotsToState = (accepted: ReadonlyMap<DomainKey, JsonValue | null>): Partial<ShellState> => {
    const partial: Partial<Record<keyof ShellState, unknown>> = {};
    for (const [domain, value] of accepted) {
      partial[DOMAIN_STATE_KEYS[domain]] = value;
    }
    if (accepted.has("health")) {
      partial.recovery = deriveRecoveryState(accepted.get("health") as JsonObject | null);
    }
    if (accepted.has("app")) {
      partial.activeWorkspace = deriveWorkspace(accepted.get("app") as JsonObject | null);
    }
    if (accepted.get("lightingFixtureCatalog")) {
      catalogLoaded = true;
    }
    return partial as Partial<ShellState>;
  };

  const runRefresh = async (run: number) => {
    try {
      while (run === refreshRun && dirtyDomains.size > 0) {
        const domains = [...dirtyDomains];
        const waiters = refreshWaiters;
        const eventName = refreshEvent;
        dirtyDomains = new Set();
        refreshWaiters = [];
        refreshEvent = null;
        refreshInFlightWaiters = waiters;
        const generation = bootstrapGeneration;
        try {
          const fetched = await fetchDomains(
            domains,
            () => run === refreshRun && generation === bootstrapGeneration && state.lifecycle === "ready"
          );
          if (fetched) {
            setState({
              ...state,
              ...snapshotsToState(fetched.accepted),
              lastEvent: eventName ?? state.lastEvent,
            });
            if (fetched.accepted.has("audio")) {
              publishAudioMeterFrame(state.audioSnapshot);
            }
            if (fetched.failures.length > 0) {
              throw fetched.failures[0];
            }
          }
          for (const waiter of waiters) {
            waiter.resolve();
          }
        } catch (error) {
          for (const waiter of waiters) {
            waiter.reject(error);
          }
        }
      }
    } finally {
      // A run that was abandoned leaves the flag to the run that replaced it.
      if (run === refreshRun) {
        refreshRunning = false;
      }
    }
  };

  /** Resolves once `domains` have been fetched by a batch that went out after this call. */
  const refreshDomains = (domains: readonly DomainKey[], eventName: EventName | null = null) => {
    if (domains.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      for (const domain of domains) {
        dirtyDomains.add(domain);
      }
      refreshEvent = eventName ?? refreshEvent;
      refreshWaiters.push({ resolve, reject });
      if (!refreshRunning) {
        refreshRunning = true;
        const run = refreshRun;
        queueMicrotask(() => void runRefresh(run));
      }
    });
  };

  // A restart or a dispose makes whatever was still queued pointless: the
  // bootstrap that follows fetches everything. The batch that is out is
  // abandoned with it — its answers are dropped if they ever come — so the
  // queue starts clean however the last run ended.
  const cancelQueuedRefresh = () => {
    refreshRun += 1;
    refreshRunning = false;
    const waiters = [...refreshInFlightWaiters, ...refreshWaiters];
    refreshInFlightWaiters = [];
    dirtyDomains = new Set();
    refreshWaiters = [];
    refreshEvent = null;
    for (const waiter of waiters) {
      waiter.resolve();
    }
  };

  const refreshAudioSnapshot = async (eventName: EventName) => {
    if (audioRefreshInFlight) {
      audioRefreshQueued = true;
      return;
    }

    audioRefreshInFlight = true;
    try {
      const snapshot = acceptSnapshot("audio", await transport.request("audio.snapshot"));
      if (snapshot) {
        applyAudioSnapshot(snapshot.value as AudioSnapshot | null, eventName);
      }
    } finally {
      audioRefreshInFlight = false;
      if (audioRefreshQueued) {
        audioRefreshQueued = false;
        void refreshAudioSnapshot(eventName).catch(inBackground("queued audio refresh"));
      }
    }
  };

  // 2026-09 production readiness, Slice 5 (finding F09): what went wrong in
  // the background — a refresh the engine did not answer, an error nothing
  // caught — is kept, last twenty, for the diagnostics export. It never
  // changes what the operator sees; Slice 9 renders the ring.
  const recordBackgroundFailure = (error: unknown, context = "background") => {
    const failure: BackgroundFailure = {
      at: new Date().toISOString(),
      context,
      message: describeError(error),
    };
    setState({
      ...state,
      backgroundFailures: [...state.backgroundFailures.slice(-(BACKGROUND_FAILURE_LIMIT - 1)), failure],
    });
  };

  const inBackground = (context: string) => (error: unknown) => recordBackgroundFailure(error, context);

  const cancelAutomaticRestart = () => {
    if (automaticRestartTimeoutId !== null) {
      window.clearTimeout(automaticRestartTimeoutId);
      automaticRestartTimeoutId = null;
    }
  };

  const restartEngine = async () => {
    cancelAutomaticRestart();
    bootstrapGeneration++;
    initializePromise = null;
    clearStartupGate();
    unsubscribeTransport();
    unsubscribeTransport = () => {};
    await transport.dispose?.();
    return start();
  };

  // The restart policy: one, two and four seconds after the first, second
  // and third stop inside five minutes; a fourth stop stays on the recovery
  // surface. Returns the sentence the surface shows.
  const scheduleAutomaticRestart = (stopped: string) => {
    const now = Date.now();
    automaticRestartsAt = automaticRestartsAt.filter((at) => now - at < AUTOMATIC_RESTART_WINDOW_MS);
    if (automaticRestartsAt.length >= AUTOMATIC_RESTART_LIMIT) {
      return `${stopped} It stopped ${AUTOMATIC_RESTART_LIMIT} times within five minutes, so it is not restarted again on its own; use Retry startup once the desk and the rig are ready.`;
    }
    const delayMs =
      AUTOMATIC_RESTART_BACKOFF_MS[Math.min(automaticRestartsAt.length, AUTOMATIC_RESTART_BACKOFF_MS.length - 1)] ??
      4_000;
    automaticRestartsAt.push(now);
    const attempt = automaticRestartsAt.length;
    cancelAutomaticRestart();
    automaticRestartTimeoutId = window.setTimeout(() => {
      automaticRestartTimeoutId = null;
      void restartEngine().catch(inBackground("automatic restart"));
    }, delayMs);
    return `${stopped} Studio Control restarts it on its own in ${delayMs / 1000} s (attempt ${attempt} of ${AUTOMATIC_RESTART_LIMIT}).`;
  };

  // The shell reports that the engine process is gone. A stop the shell
  // asked for (a restart, the close) is not a failure; a report about a
  // process the shell already replaced is stale; and a start-up failure the
  // engine reported itself stands — the exit that follows it says nothing
  // new and must not restart an engine that would only refuse again.
  const handleEngineExited = (event: EventEnvelope<EventName>) => {
    const payload = asRecord(event.payload);
    if (payload?.graceful === true) {
      return;
    }
    const generation = typeof payload?.generation === "number" ? payload.generation : null;
    if (generation !== null && engineGeneration !== null && generation !== engineGeneration) {
      return;
    }
    if (engineStartupFailure) {
      return;
    }

    const status = typeof payload?.status === "number" ? `exit status ${payload.status}` : "no exit status";
    const failure: StartupFailure = {
      code: "ENGINE_EXITED",
      message: scheduleAutomaticRestart(`The hardware link stopped unexpectedly (${status}).`),
      stage: "runtime",
    };
    engineStartupFailure = failure;
    setState({
      ...state,
      lifecycle: "failed",
      recovery: "recovery",
      startupFailure: failure,
      lastEvent: event.event,
      errorSummary: failure.message,
    });
    publishAudioMeterFrame(null);
    pendingStartupGate?.reject(failure);
  };

  const handleTransportEvent = (event: EventEnvelope<EventName>) => {
    if (event.event === "engine.ready") {
      pendingStartupGate?.resolve(event.payload);
      return;
    }

    if (event.event === "engine.startupFailed") {
      const startupFailure = normalizeStartupFailure(event.payload);
      engineStartupFailure = startupFailure;

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

    // Handled before the refresh path below: the engine is gone, so there
    // is nothing to refresh from.
    if (event.event === "engine.exited") {
      handleEngineExited(event);
      return;
    }

    if (state.lifecycle === "ready") {
      const payload = asRecord(event.payload);
      if (event.event === "audio.meters" || (event.event === "audio.changed" && payload?.reason === "metering-tick")) {
        publishAudioMeterPayload(payload);
        return;
      }
      if (event.event === "audio.changed") {
        // 2026-09 audit remediation, Slice 2: a console echo is the console's
        // truth (an operator move at TotalMix, an adjusted or unconfirmed
        // send). It must not be swallowed by the 250 ms tail suppression that
        // protects a local edit from its own event; it only waits for an
        // in-flight local mutation to finish, then refreshes once.
        if (payload?.reason === "console-echo") {
          if (audioLocalMutationDepth > 0) {
            audioEchoRefreshPending = true;
            return;
          }
          void refreshAudioSnapshot(event.event).catch(inBackground(`refresh audio after ${event.event}`));
          return;
        }
        if (audioLocalMutationDepth > 0 || currentMonotonicTimestampMs() < audioRefreshSuppressUntilMs) {
          return;
        }
        void refreshAudioSnapshot(event.event).catch(inBackground(`refresh audio after ${event.event}`));
        return;
      }
      // Slice 9 (F11): every other event refreshes the snapshots it names in
      // `EVENT_DOMAIN_REFRESH`. An event this build does not know — a newer
      // hardware link — refreshes everything that can change.
      const { domains, known } = domainsForEvent(event.event);
      if (!known && development) {
        console.warn(`[shell store] '${event.event}' is not in EVENT_DOMAIN_REFRESH.`);
      }
      void refreshDomains(domains, event.event).catch(inBackground(`refresh after ${event.event}`));
    }
  };

  const bootstrap = async () => {
    const generation = ++bootstrapGeneration;
    const isCurrentBootstrap = () => generation === bootstrapGeneration;

    cancelAutomaticRestart();
    cancelQueuedRefresh();
    clearStartupGate();
    engineStartupFailure = null;
    engineGeneration = null;
    unsubscribeTransport();
    unsubscribeTransport = () => {};

    setState({
      ...initialState,
      // The failure ring outlives a restart: it is what the diagnostics
      // export carries about the session. So does the fixture catalog, which
      // is fetched once per session (Slice 9).
      backgroundFailures: state.backgroundFailures,
      lightingFixtureCatalogSnapshot: catalogLoaded ? state.lightingFixtureCatalogSnapshot : null,
      lifecycle: transitionStartupState("idle", { type: "spawned" }),
    });
    publishAudioMeterFrame(null);

    unsubscribeTransport = transport.subscribe((event) => {
      if (isCurrentBootstrap()) {
        handleTransportEvent(event);
      }
    });

    try {
      const launch = await transport.initialize?.();
      if (!isCurrentBootstrap()) return;
      engineGeneration = launchGeneration(launch);

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
          message: `Studio Control expected version ${PROTOCOL_VERSION} from its hardware link but got ${reportedProtocol}.`,
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

      // The bootstrap keeps the whole fetch (Slice 9 scopes what follows it):
      // health first, because the start-up steps show it arriving, then every
      // other snapshot side by side. A request that fails here fails the start.
      const health = await fetchDomains(["health"], isCurrentBootstrap);
      if (!health) return;
      if (health.failures.length > 0) {
        throw health.failures[0];
      }

      updateState({
        ...snapshotsToState(health.accepted),
        lifecycle: transitionStartupState("waiting-for-health-snapshot", {
          type: "health-loaded",
        }),
      });

      const rest = await fetchDomains(
        ALL_DOMAINS.filter((domain) => domain !== "health" && !(domain === "lightingFixtureCatalog" && catalogLoaded)),
        isCurrentBootstrap
      );
      if (!rest) return;
      if (rest.failures.length > 0) {
        throw rest.failures[0];
      }

      setState({
        ...state,
        ...snapshotsToState(rest.accepted),
        lifecycle: transitionStartupState("waiting-for-app-snapshot", { type: "app-loaded" }),
        startupFailure: null,
        lastEvent: "engine.ready",
        errorSummary: null,
      });
      publishAudioMeterFrame(state.audioSnapshot);
    } catch (error) {
      if (!isCurrentBootstrap()) return;

      // What the engine said about itself outranks whatever the bootstrap
      // tripped over afterwards (a request against a process that is gone).
      const startupFailure = engineStartupFailure ?? normalizeStartupFailure(error);
      setState({
        ...state,
        lifecycle: "failed",
        recovery: "recovery",
        startupFailure,
        errorSummary: startupFailure.message,
      });
      // Recovery mode (Slice 7 — F20): after a storage failure the engine
      // stays up to list, verify and restore backups, so the recovery
      // surface gets the backup list it needs to do that.
      if (RECOVERY_MODE_CODES.has(startupFailure.code)) {
        void transport
          .request("support.snapshot")
          .then((supportSnapshot) => {
            if (isCurrentBootstrap()) {
              setState({ ...state, supportSnapshot: supportSnapshot as JsonObject });
            }
          })
          .catch(inBackground("backup list in recovery"));
      }
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

  // Slice 9 (F11): the refresh after a request is scoped to what the method
  // can change (`domainsForMethod`). It stays beside the event's own refresh
  // because not every request raises an event — `settings.update` raises none
  // on the hardware link, so a workspace switch reaches the screen only from
  // here — and the two share the one queue above, so they never run side by
  // side.
  const performRequest = async (method: string, params: JsonObject = {}) => {
    const result = await transport.request(method as never, params);
    if (state.lifecycle === "ready") {
      await refreshDomains(domainsForMethod(method, params));
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
      if (audioLocalMutationDepth === 0 && audioEchoRefreshPending) {
        audioEchoRefreshPending = false;
        void refreshAudioSnapshot("audio.changed").catch(inBackground("console echo refresh"));
      }
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
      // The one refresh that fetches everything, the fixture catalog included.
      await refreshDomains(ALL_DOMAINS);
    },
    async restart() {
      return restartEngine();
    },
    reportBackgroundFailure(error, context) {
      recordBackgroundFailure(error, context);
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
    async holdAudioTalkback(request: AudioTalkbackHoldRequest) {
      return performAudioRequest("audio.talkback.hold", request as unknown as JsonObject);
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
    async setPlanningTaskTimer(taskId: string, action: "start" | "stop" | "toggle") {
      return performRequest("planning.task.timer", { action, taskId });
    },
    async deletePlanningTask(taskId: string) {
      return performRequest("planning.task.delete", { taskId });
    },
    async exportSupportBackup() {
      return performRequest("support.backup.export");
    },
    async restoreSupportBackup(path: string) {
      const result = await performRequest("support.backup.restore", { path });
      // A database backup is staged, not applied (2026-09 production
      // readiness, Slice 7 — F20): the engine takes it at its next start, so
      // the link is restarted here through the same path as Retry startup.
      // The shell reports that stop as graceful, so no automatic-restart
      // budget is spent on it.
      if (asRecord(result)?.requiresRestart === true) {
        try {
          await restartEngine();
        } catch (error) {
          recordBackgroundFailure(error, "restart after a database restore");
        }
      }
      return result;
    },
    async verifySupportBackup(path: string) {
      return transport.request("support.backup.verify", { path });
    },
    async exportCompanionConfig(baseUrl?: string) {
      return performRequest("exports.companion.export", baseUrl ? { baseUrl } : {});
    },
    async refreshControlSurfaceSnapshot() {
      if (state.lifecycle !== "ready") {
        return;
      }
      await refreshDomains(["controlSurface"]);
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
      cancelAutomaticRestart();
      cancelQueuedRefresh();
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
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Slice 9 (F32): a development build's store leaves a reply that failed its
  // guard here, and it is thrown while rendering so the error boundary shows
  // it with the request and the field named. A production store never sets it.
  if (snapshot.snapshotFault !== null) {
    throw new Error(snapshot.snapshotFault);
  }
  return snapshot;
}
