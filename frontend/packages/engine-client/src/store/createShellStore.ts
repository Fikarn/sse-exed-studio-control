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
  AudioMixTargetUpdateRequest,
  AudioSettingsUpdateRequest,
  CommissioningCheckRequest,
  CommissioningUpdateRequest,
  EngineTransport,
  LightingFixtureCreateRequest,
  LightingFixtureUpdateRequest,
  LightingSceneCreateRequest,
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
  lightingDmxMonitorSnapshot: null,
  audioSnapshot: null,
  planningSnapshot: null,
  supportSnapshot: null,
  controlSurfaceSnapshot: null,
  startupFailure: null,
  lastEvent: null,
  errorSummary: null,
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
  const listeners = new Set<() => void>();
  let unsubscribeTransport = () => {};
  let initializePromise: Promise<void> | null = null;
  let pendingStartupGate: PendingStartupGate | null = null;

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
      void refreshDomain(event.event);
    }
  };

  const bootstrap = async () => {
    clearStartupGate();
    unsubscribeTransport();
    unsubscribeTransport = () => {};

    setState({
      ...initialState,
      lifecycle: transitionStartupState("idle", { type: "spawned" }),
    });

    unsubscribeTransport = transport.subscribe(handleTransportEvent);

    try {
      await transport.initialize?.();
      updateState({
        lifecycle: transitionStartupState("launching-process", {
          type: "process-launched",
        }),
      });

      const readyPayload = await waitForEngineHandshake();
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
        lightingSnapshot,
        lightingDmxMonitorSnapshot,
        audioSnapshot,
        planningSnapshot,
        supportSnapshot,
        controlSurfaceSnapshot,
      ] = await Promise.all([
        transport.request("app.snapshot").then((value) => value as JsonObject),
        transport.request("commissioning.snapshot").then((value) => value as JsonObject),
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
        lifecycle: transitionStartupState("waiting-for-app-snapshot", { type: "app-loaded" }),
        recovery: deriveRecoveryState(healthSnapshot),
        activeWorkspace: deriveWorkspace(appSnapshot),
        appSnapshot,
        healthSnapshot,
        commissioningSnapshot,
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
    } catch (error) {
      const startupFailure = normalizeStartupFailure(error);
      setState({
        ...state,
        lifecycle: "failed",
        recovery: "recovery",
        startupFailure,
        errorSummary: startupFailure.message,
      });
    } finally {
      clearStartupGate();
    }
  };

  const start = () => {
    if (!initializePromise) {
      initializePromise = bootstrap().finally(() => {
        initializePromise = null;
      });
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
    async runCommissioningCheck(request: CommissioningCheckRequest) {
      return performRequest("commissioning.check.run", request as unknown as JsonObject);
    },
    async updateCommissioning(request: CommissioningUpdateRequest) {
      return performRequest("commissioning.update", request as unknown as JsonObject);
    },
    async syncAudio() {
      return performRequest("audio.sync");
    },
    async recallAudioSnapshot(snapshotId: string) {
      return performRequest("audio.snapshot.recall", { snapshotId });
    },
    async updateAudioChannel(request: AudioChannelUpdateRequest) {
      return performRequest("audio.channel.update", request as unknown as JsonObject);
    },
    async updateAudioMixTarget(request: AudioMixTargetUpdateRequest) {
      return performRequest("audio.mixTarget.update", request as unknown as JsonObject);
    },
    async updateAudioSettings(request: AudioSettingsUpdateRequest) {
      return performRequest("audio.settings.update", request as unknown as JsonObject);
    },
    async updateLightingSettings(request: LightingSettingsUpdateRequest) {
      return performRequest("lighting.settings.update", request as JsonObject);
    },
    async createLightingGroup(name: string) {
      return performRequest("lighting.group.create", { name });
    },
    async createLightingFixture(request: LightingFixtureCreateRequest) {
      return performRequest("lighting.fixture.create", request as unknown as JsonObject);
    },
    async createLightingScene(request: LightingSceneCreateRequest) {
      return performRequest("lighting.scene.create", request as unknown as JsonObject);
    },
    async deleteLightingScene(sceneId: string) {
      return performRequest("lighting.scene.delete", { sceneId });
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
    async deleteLightingFixture(fixtureId: string) {
      return performRequest("lighting.fixture.delete", { fixtureId });
    },
    async setLightingGroupPower(groupId: string, on: boolean) {
      return performRequest("lighting.group.power", { groupId, on });
    },
    async setLightingAllPower(on: boolean) {
      return performRequest("lighting.power.all", { on });
    },
    async recallLightingScene(sceneId: string, fadeDurationSeconds?: number) {
      return performRequest(
        "lighting.scene.recall",
        fadeDurationSeconds === undefined ? { sceneId } : { sceneId, fadeDurationSeconds }
      );
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      clearStartupGate();
      unsubscribeTransport();
      await transport.dispose?.();
    },
  };
}

export function useShellSnapshot(store: ShellStore) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
