import { useEffect, useMemo, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import type { JsonValue, ShellState, ShellStore } from "@sse/engine-client";

import { exportShellDiagnostics } from "./shellCommands";

interface ShellTestBridgeConfig {
  commandPath?: string | null;
  statusPath?: string | null;
}

interface EngineSummary {
  binary_path?: string;
  protocol?: string;
  running?: boolean;
}

interface ShellTestCommandResult {
  action: string;
  error?: string;
  finishedAt: string;
  id: string;
  ok: boolean;
  result?: JsonValue;
}

function tauriAvailable() {
  return "__TAURI_INTERNALS__" in window;
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function serializeShellState(shellState: ShellState) {
  return toJsonValue(shellState) as Record<string, JsonValue>;
}

function buildDiagnosticsReport(shellState: ShellState) {
  return {
    activeWorkspace: shellState.activeWorkspace,
    appSnapshot: toJsonValue(shellState.appSnapshot),
    commissioningSnapshot: toJsonValue(shellState.commissioningSnapshot),
    controlSurfaceSnapshot: toJsonValue(shellState.controlSurfaceSnapshot),
    healthSnapshot: toJsonValue(shellState.healthSnapshot),
    lifecycle: shellState.lifecycle,
    planningSnapshot: toJsonValue(shellState.planningSnapshot),
    recovery: shellState.recovery,
    startupFailure: toJsonValue(shellState.startupFailure),
    supportSnapshot: toJsonValue(shellState.supportSnapshot),
  } as Record<string, JsonValue>;
}

async function runShellTestCommand(command: Record<string, JsonValue>, shellState: ShellState, store: ShellStore) {
  const action = typeof command.action === "string" ? command.action : "";

  switch (action) {
    case "exportCompanionConfig":
      return store.exportCompanionConfig(typeof command.baseUrl === "string" ? command.baseUrl : undefined);
    case "exportShellDiagnostics":
      return exportShellDiagnostics(
        buildDiagnosticsReport(shellState),
        typeof command.directory === "string" ? command.directory : undefined
      );
    case "exportSupportBackup":
      return store.exportSupportBackup();
    case "refresh":
      await store.refresh();
      return { ok: true };
    case "restart":
      await store.restart();
      return { ok: true };
    case "restoreSupportBackup":
      if (typeof command.path !== "string" || !command.path.trim()) {
        throw new Error("restoreSupportBackup requires a path.");
      }
      return store.restoreSupportBackup(command.path);
    case "runCommissioningCheck":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("runCommissioningCheck requires a request object.");
      }
      return store.runCommissioningCheck(command.request as never);
    case "createPlanningProject":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("createPlanningProject requires a request object.");
      }
      return store.createPlanningProject(command.request as never);
    case "createPlanningTask":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("createPlanningTask requires a request object.");
      }
      return store.createPlanningTask(command.request as never);
    case "readPlanningTimeReport":
      return store.readPlanningTimeReport(typeof command.projectId === "string" ? command.projectId : undefined);
    case "recallAudioSnapshot":
      if (typeof command.snapshotId !== "string" || !command.snapshotId.trim()) {
        throw new Error("recallAudioSnapshot requires snapshotId.");
      }
      return store.recallAudioSnapshot(command.snapshotId);
    case "recallLightingScene":
      if (typeof command.sceneId !== "string" || !command.sceneId.trim()) {
        throw new Error("recallLightingScene requires sceneId.");
      }
      return store.recallLightingScene(
        command.sceneId,
        typeof command.fadeDurationSeconds === "number" ? command.fadeDurationSeconds : undefined
      );
    case "reschedulePlanningTask":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("reschedulePlanningTask requires a request object.");
      }
      return store.reschedulePlanningTask(command.request as never);
    case "seedPlanningDemo":
      return store.seedPlanningDemo(command.replaceExistingData === true);
    case "setSetupSection":
      if (command.section !== "commissioning" && command.section !== "support") {
        throw new Error("setSetupSection requires section 'commissioning' or 'support'.");
      }
      return store.setSetupSection(command.section);
    case "setWorkspace":
      if (
        command.workspaceId !== "setup" &&
        command.workspaceId !== "lighting" &&
        command.workspaceId !== "audio" &&
        command.workspaceId !== "planning"
      ) {
        throw new Error("setWorkspace requires a supported workspaceId.");
      }
      return store.setWorkspace(command.workspaceId);
    case "setLightingGroupPower":
      if (typeof command.groupId !== "string" || !command.groupId.trim()) {
        throw new Error("setLightingGroupPower requires groupId.");
      }
      if (typeof command.on !== "boolean") {
        throw new Error("setLightingGroupPower requires boolean on.");
      }
      return store.setLightingGroupPower(command.groupId, command.on);
    case "syncAudio":
      return store.syncAudio();
    case "togglePlanningTaskComplete":
      if (typeof command.taskId !== "string" || !command.taskId.trim()) {
        throw new Error("togglePlanningTaskComplete requires taskId.");
      }
      return store.togglePlanningTaskComplete(command.taskId);
    case "updateAudioChannel":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("updateAudioChannel requires a request object.");
      }
      return store.updateAudioChannel(command.request as never);
    case "updateAudioMixTarget":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("updateAudioMixTarget requires a request object.");
      }
      return store.updateAudioMixTarget(command.request as never);
    case "updateAudioSettings":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("updateAudioSettings requires a request object.");
      }
      return store.updateAudioSettings(command.request as never);
    case "updateCommissioning":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("updateCommissioning requires a request object.");
      }
      return store.updateCommissioning(command.request as never);
    case "updateLightingFixture":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("updateLightingFixture requires a request object.");
      }
      return store.updateLightingFixture(command.request as never);
    case "updatePlanningSettings":
      if (!command.request || typeof command.request !== "object" || Array.isArray(command.request)) {
        throw new Error("updatePlanningSettings requires a request object.");
      }
      return store.updatePlanningSettings(command.request as never);
    default:
      throw new Error(`Unsupported shell test action '${action}'.`);
  }
}

export function useTauriShellTestBridge(shellState: ShellState, store: ShellStore) {
  const [config, setConfig] = useState<ShellTestBridgeConfig | null>(null);
  const [engineSummary, setEngineSummary] = useState<EngineSummary | null>(null);
  const [lastCommand, setLastCommand] = useState<ShellTestCommandResult | null>(null);
  const latestShellStateRef = useRef(shellState);
  const processedCommandIdRef = useRef<string | null>(null);
  const commandInFlightRef = useRef(false);

  latestShellStateRef.current = shellState;

  useEffect(() => {
    if (!tauriAvailable()) {
      return;
    }

    let cancelled = false;
    void invoke<ShellTestBridgeConfig | null>("shell_test_bridge_config")
      .then((result) => {
        if (!cancelled) {
          setConfig(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.statusPath || !tauriAvailable()) {
      return;
    }

    let cancelled = false;
    void invoke<EngineSummary | null>("engine_summary")
      .then((result) => {
        if (!cancelled) {
          setEngineSummary(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEngineSummary(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config?.statusPath, shellState.lifecycle, shellState.lastEvent]);

  const statusPayload = useMemo(
    () => ({
      capturedAt: new Date().toISOString(),
      shellState: serializeShellState(shellState),
      testBridge: {
        commandPath: config?.commandPath ?? null,
        engineSummary: toJsonValue(engineSummary),
        lastCommand,
        statusPath: config?.statusPath ?? null,
      },
    }),
    [config?.commandPath, config?.statusPath, engineSummary, lastCommand, shellState]
  );

  useEffect(() => {
    if (!config?.statusPath || !tauriAvailable()) {
      return;
    }

    void invoke("shell_test_bridge_write_status", {
      status: statusPayload,
    }).catch(() => {
      // Ignore missing bridge writes outside explicit qualification runs.
    });
  }, [config?.statusPath, statusPayload]);

  useEffect(() => {
    if (!config?.commandPath || !tauriAvailable()) {
      return;
    }

    let disposed = false;

    const pollCommand = async () => {
      if (disposed || commandInFlightRef.current) {
        return;
      }

      const command = await invoke<Record<string, JsonValue> | null>("shell_test_bridge_read_command").catch(
        () => null
      );
      if (!command || typeof command.id !== "string" || !command.id) {
        return;
      }

      if (processedCommandIdRef.current === command.id) {
        return;
      }

      commandInFlightRef.current = true;
      processedCommandIdRef.current = command.id;

      try {
        const result = await runShellTestCommand(command, latestShellStateRef.current, store);
        if (!disposed) {
          setLastCommand({
            action: String(command.action ?? "unknown"),
            finishedAt: new Date().toISOString(),
            id: command.id,
            ok: true,
            result: toJsonValue(result),
          });
        }
      } catch (error) {
        if (!disposed) {
          setLastCommand({
            action: String(command.action ?? "unknown"),
            error: error instanceof Error ? error.message : String(error),
            finishedAt: new Date().toISOString(),
            id: command.id,
            ok: false,
          });
        }
      } finally {
        commandInFlightRef.current = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void pollCommand();
    }, 200);
    void pollCommand();

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [config?.commandPath, store]);
}
