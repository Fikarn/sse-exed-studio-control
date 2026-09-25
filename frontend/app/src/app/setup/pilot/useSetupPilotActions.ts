import { useLiveCallback } from "../../shared/useLiveCallback";
import { startTransition, useMemo } from "react";
import { asRecord, getCommissioningChecks, withRestoreDetail } from "../../shellData";
import { openShellPath, exportShellDiagnostics } from "../../shellCommands";
import type { JsonValue } from "@sse/engine-client";
import {
  type ActionFeedback,
  type RunnerStepId,
  type SetupMode,
  probeChecks,
  type FeedbackTone,
  toJsonValue,
  nextControlId,
  runnerStepOrder,
  type SetupSupportPilotProps,
} from "../setupPilotModel";
import type { SetupPilotState } from "./useSetupPilotState";

/** What the operator can run from Setup / Support: save the import profile,
 *  the probes, publish, export / verify / restore a backup, hold or arm the
 *  light outputs, export diagnostics, and the step and control selection. */
export function useSetupPilotActions({ props, state }: { props: SetupSupportPilotProps; state: SetupPilotState }) {
  const {
    store,
    appSnapshot,
    commissioningSnapshot,
    controlSurfaceSnapshot,
    healthSnapshot,
    liveTransportRequested,
    supportSnapshot,
  } = props;
  const {
    setBusyAction,
    setFeedback,
    setActiveStepId,
    setMode,
    exportBaseUrl,
    lightingBridgeIp,
    lightingUniverse,
    audioReceivePort,
    audioSendHost,
    audioSendPort,
    activeStepId,
    isReady,
    checks,
    setPublishOverridePrompt,
    selectedPageControls,
    selectedControlId,
    setSelectedControlId,
    stepIndex,
    setPendingStepId,
  } = state;
  const performAction = useLiveCallback(
    async (actionId: string, onRun: () => Promise<ActionFeedback | null | void>) => {
      setBusyAction(actionId);
      setFeedback(null);

      try {
        const result = await onRun();
        if (result) {
          setFeedback(result);
        }
      } catch (error) {
        setFeedback({
          message:
            error instanceof Error
              ? error.message
              : "That setup step did not finish. Try it again, or export diagnostics for the support ticket.",
          tone: "error",
        });
      } finally {
        setBusyAction(null);
      }
    }
  );

  const activateStep = useLiveCallback(async (stepId: RunnerStepId) => {
    startTransition(() => setActiveStepId(stepId));
    await store.updateCommissioning({ runnerStage: stepId });
  });

  const persistMode = useLiveCallback((nextMode: SetupMode) => {
    setMode(nextMode);
    void store.setSetupSection(nextMode === "runner" ? "commissioning" : "support");
  });

  const saveImportProfile = async (advance = false) => {
    const result = asRecord(await store.exportCompanionConfig(exportBaseUrl.trim() || undefined));
    if (advance) {
      await activateStep("probe");
    }

    return {
      message: `Exported Companion profile to ${String(result?.path ?? "the native exports directory")}.`,
      tone: "ok" as const,
    };
  };

  const runSingleProbe = async (target: "control-surface" | "lighting" | "audio") => {
    const params =
      target === "lighting"
        ? {
            bridgeIp: lightingBridgeIp.trim(),
            target,
            universe: Number(lightingUniverse),
          }
        : target === "audio"
          ? {
              receivePort: Number(audioReceivePort),
              sendHost: audioSendHost.trim(),
              sendPort: Number(audioSendPort),
              target,
            }
          : { target };

    await store.runCommissioningCheck(params);
    return {
      message:
        target === "lighting"
          ? "Lighting bridge probe passed."
          : target === "audio"
            ? "The desk probe passed."
            : "The deck probe passed.",
      tone: "ok" as const,
    };
  };

  const runAllProbes = async (advance = false) => {
    await store.runCommissioningCheck({ target: "control-surface" });
    await store.runCommissioningCheck({
      bridgeIp: lightingBridgeIp.trim(),
      target: "lighting",
      universe: Number(lightingUniverse),
    });
    const latest = await store.runCommissioningCheck({
      receivePort: Number(audioReceivePort),
      sendHost: audioSendHost.trim(),
      sendPort: Number(audioSendPort),
      target: "audio",
    });

    // 2026-09 audit Slice 8: report what the probes actually returned, and
    // never advance past a probe that did not pass. The check-run result is
    // the commissioning snapshot; fall back to the store's copy if a
    // transport answers with something else.
    const fromResult = getCommissioningChecks(asRecord(latest));
    const results = probeChecks(
      fromResult.length > 0 ? fromResult : getCommissioningChecks(asRecord(store.getSnapshot().commissioningSnapshot))
    );
    const notPassed = results.filter((check) => check.status !== "ok");
    if (notPassed.length > 0) {
      return {
        message: `${results.length - notPassed.length} of ${results.length} probes passed — ${notPassed
          .map((check) => `${check.label}: ${check.detail}`)
          .join("; ")}. Fix the field it names, then press Run all probes again.`,
        tone: "error" as const,
      };
    }

    if (advance) {
      await activateStep("map");
    }

    return {
      message: `All ${results.length} commissioning probes passed.`,
      tone: "ok" as const,
    };
  };

  const publishSetup = async (overrideProbes = false) => {
    // The engine refuses `ready` while a probe is not passed unless the
    // override is explicit (COMMISSIONING_PROBES_INCOMPLETE otherwise); the
    // refusal, should the UI's view be stale, surfaces as this action's error.
    await store.updateCommissioning({
      runnerStage: "publish",
      stage: "ready",
      ...(overrideProbes ? { overrideProbes: true } : {}),
    });
    const backup = asRecord(await store.exportSupportBackup());
    await store.setWorkspace("audio");

    return {
      message: overrideProbes
        ? `Setup published with a probe override (recorded in the setup summary) and support backup written to ${String(backup?.path ?? "the backup directory")}.`
        : `Setup published and support backup written to ${String(backup?.path ?? "the backup directory")}.`,
      tone: "ok" as const,
    };
  };

  const exportSupportBackup = async () => {
    const result = asRecord(await store.exportSupportBackup());
    return {
      message: `Exported support backup to ${String(result?.path ?? "the backup directory")}.`,
      tone: "ok" as const,
    };
  };

  const restoreBackup = async (path: string) => {
    const result = asRecord(await store.restoreSupportBackup(path));
    // A database backup restarts the hardware link before this resolves
    // (2026-09 production readiness, Slice 7 — F20); the restored data is
    // what comes back on screen.
    return {
      message: withRestoreDetail(
        result?.requiresRestart === true
          ? `Database backup restored from ${String(result?.sourcePath ?? path)}; the hardware link restarted into it.`
          : `Restored ${String(result?.sourceFormat ?? "backup")} from ${String(result?.sourcePath ?? path)}.`,
        result
      ),
      tone: "ok" as const,
    };
  };

  // Slice 7 (F20): a backup is checked without anything changing — a JSON
  // archive must parse as one this app reads, a database backup must open
  // and pass its integrity check — and the answer is shown inline.
  const verifyBackup = async (path: string) => {
    const result = asRecord(await store.verifySupportBackup(path));
    const detail = String(result?.detail ?? "No detail was reported.");
    return result?.ok === true
      ? { message: `Backup checked: ${detail}`, tone: "ok" as const }
      : { message: `Backup failed its check: ${detail}`, tone: "error" as const };
  };

  // Slice 11 (F31). Held is not a blackout, and the sentence does not promise
  // one: it says what is sent.
  const setLightOutputsArmed = async (armed: boolean) => {
    await store.setLightingOutputArmed(armed);
    return armed
      ? { message: "Light outputs armed: the rig follows the app again.", tone: "ok" as const }
      : {
          message:
            "Light outputs held: nothing is sent to the rig until they are armed. The rig keeps its last look, or does what the bridge does without a source.",
          tone: "info" as const,
        };
  };

  const openReferencePath = async (label: string, path: string, tone: FeedbackTone = "info") => {
    const openedPath = await openShellPath(path);
    return {
      message: `${label} opened at ${openedPath}.`,
      tone,
    };
  };

  const exportDiagnostics = async () => {
    const report: Record<string, JsonValue> = {
      appSnapshot: toJsonValue(appSnapshot),
      // Slice 9: what went wrong in the background this session (last twenty),
      // read from the store at the moment of the export.
      backgroundFailures: toJsonValue(store.getSnapshot().backgroundFailures),
      commissioningSnapshot: toJsonValue(commissioningSnapshot),
      controlSurfaceSnapshot: toJsonValue(controlSurfaceSnapshot),
      generatedAt: new Date().toISOString(),
      healthSnapshot: toJsonValue(healthSnapshot),
      liveTransportRequested,
      supportSnapshot: toJsonValue(supportSnapshot),
    };
    const path = await exportShellDiagnostics(report);
    return {
      message: `Diagnostics exported to ${path}. Attach it to the support ticket.`,
      tone: "ok" as const,
    };
  };

  const primaryActionLabel = useMemo(() => {
    if (activeStepId === "import") {
      return "Download profile";
    }
    if (activeStepId === "probe") {
      return "Run all probes";
    }
    if (activeStepId === "map") {
      return "Continue to verify";
    }
    if (activeStepId === "verify") {
      return "Continue to publish";
    }
    return isReady ? "Open the Console" : "Publish setup";
  }, [activeStepId, isReady]);

  const invokePrimaryAction = useLiveCallback(() => {
    if (activeStepId === "import") {
      void performAction("export-companion", () => saveImportProfile(true));
      return;
    }

    if (activeStepId === "probe") {
      void performAction("run-all-probes", () => runAllProbes(true));
      return;
    }

    if (activeStepId === "map") {
      void activateStep("verify");
      return;
    }

    if (activeStepId === "verify") {
      void activateStep("publish");
      return;
    }

    // 2026-09 audit Slice 8: a probe that is not green needs the operator's
    // explicit decision before publish; the dialog names each one. Visual
    // overhaul A, Slice 7: this is asked before the published check, so a
    // desk whose probes have gone off can be re-published with the override
    // recorded rather than only offering the way back to the console.
    const notPassed = probeChecks(checks).filter((check) => check.status !== "ok");
    if (notPassed.length > 0) {
      setPublishOverridePrompt(notPassed.map((check) => `${check.label} — ${check.detail}`));
      return;
    }

    if (isReady) {
      void performAction("open-console", async () => {
        await store.setWorkspace("audio");
        return {
          message: "Opened the Console.",
          tone: "info" as const,
        };
      });
      return;
    }

    void performAction("publish-setup", () => publishSetup());
  });

  const moveControlSelection = useLiveCallback((direction: -1 | 1) => {
    const nextId = nextControlId(selectedPageControls, selectedControlId, direction);
    if (nextId) {
      setSelectedControlId(nextId);
    }
  });

  const moveStepSelection = useLiveCallback((direction: -1 | 1) => {
    const nextIndex = Math.min(Math.max(stepIndex + direction, 0), runnerStepOrder.length - 1);
    void activateStep(runnerStepOrder[nextIndex]!);
  });

  const requestStepSelection = useLiveCallback((stepId: RunnerStepId) => {
    const currentIndex = runnerStepOrder.indexOf(activeStepId);
    const nextIndex = runnerStepOrder.indexOf(stepId);
    if (nextIndex > currentIndex) {
      setPendingStepId(stepId);
      return;
    }

    void activateStep(stepId);
  });
  return {
    performAction,
    activateStep,
    persistMode,
    saveImportProfile,
    runSingleProbe,
    runAllProbes,
    publishSetup,
    exportSupportBackup,
    restoreBackup,
    verifyBackup,
    setLightOutputsArmed,
    openReferencePath,
    exportDiagnostics,
    primaryActionLabel,
    invokePrimaryAction,
    moveControlSelection,
    moveStepSelection,
    requestStepSelection,
  };
}

export type SetupPilotActions = ReturnType<typeof useSetupPilotActions>;
