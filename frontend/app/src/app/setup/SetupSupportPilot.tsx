import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { Button, ConfirmDialog, Key, ShellRegion, StatusPill, Surface } from "@sse/design-system";
import type { JsonValue, ShellStore } from "@sse/engine-client";

import { exportShellDiagnostics, openShellPath } from "../shellCommands";
import { useLiveCallback } from "../shared/useLiveCallback";
import {
  asRecord,
  asStatusTone,
  describeBackupKind,
  formatBackupTimestamp,
  getCommissioningChecks,
  getSupportBackups,
  isEditableTarget,
  statusToneLabel,
  type SnapshotRecord,
  type StatusToneLike,
} from "../shellData";
import { useOperatorLayout } from "../OperatorLayoutProvider";
import { SetupCluster, type SetupClusterStep } from "./components/SetupCluster";
import { SetupFooter } from "./components/SetupFooter";
import { SetupFactCard, SetupRecordHeading, SetupRecordRow, SetupStepScreen } from "./components/SetupStepScreen";
import { SupportPlate } from "./components/SupportPlate";
import { findEchoControlId, parseControlSurfaceLastEvent } from "./setupControlEcho";
import { deriveSetupState } from "./setupState";
import styles from "./SetupSupportPilot.module.css";

const APP_VERSION = `v${__APP_VERSION__}`;

type SetupMode = "runner" | "support";
type RunnerStepId = "import" | "probe" | "map" | "verify" | "publish";

// The three engine commissioning probes. Fixture snapshots may carry extra
// label-only check entries; the publish gate (2026-09 audit Slice 8) counts
// only these, exactly as the engine does.
const PROBE_CHECK_IDS = new Set(["control-surface", "lighting", "audio"]);

function probeChecks<T extends { id: string }>(entries: T[]) {
  const known = entries.filter((entry) => PROBE_CHECK_IDS.has(entry.id));
  return known.length > 0 ? known : entries;
}
type FeedbackTone = "error" | "info" | "ok";

interface ControlSurfaceControl {
  body: { action?: string; value?: string } | null;
  description: string;
  id: string;
  label: string;
  position: number;
  type: string;
}

interface ControlSurfacePage {
  buttons: ControlSurfaceControl[];
  dials: ControlSurfaceControl[];
  id: string;
  label: string;
}

interface ActionFeedback {
  message: string;
  tone: FeedbackTone;
}

interface SetupSupportPilotProps {
  appSnapshot: SnapshotRecord | null;
  commissioningSnapshot: SnapshotRecord | null;
  controlSurfaceSnapshot: SnapshotRecord | null;
  healthSnapshot: SnapshotRecord | null;
  liveTransportRequested: boolean;
  onRequestRestart: () => void;
  onShowShortcuts: () => void;
  store: ShellStore;
  supportSnapshot: SnapshotRecord | null;
}

interface RunnerStep {
  hint: string;
  id: RunnerStepId;
  label: string;
  tone: StatusToneLike;
}

const runnerStepOrder: RunnerStepId[] = ["import", "probe", "map", "verify", "publish"];

function parseControlSurfacePages(snapshot: SnapshotRecord | null): ControlSurfacePage[] {
  const pages = snapshot?.pages;
  if (!Array.isArray(pages)) {
    return [];
  }

  return pages.flatMap((page) => {
    const record = asRecord(page);
    if (!record) {
      return [];
    }

    const parseControls = (controls: unknown) =>
      (Array.isArray(controls) ? controls : []).flatMap((control) => {
        const controlRecord = asRecord(control);
        if (!controlRecord) {
          return [];
        }

        const body = asRecord(controlRecord.body);
        return [
          {
            body: body
              ? {
                  action: typeof body.action === "string" ? body.action : undefined,
                  value: typeof body.value === "string" ? body.value : undefined,
                }
              : null,
            description: String(controlRecord.description ?? "Control mapped on the deck."),
            id: String(controlRecord.id ?? controlRecord.label ?? "control"),
            label: String(controlRecord.label ?? "Control"),
            position: typeof controlRecord.position === "number" ? controlRecord.position : 0,
            type: String(controlRecord.type ?? "button"),
          },
        ];
      });

    return [
      {
        buttons: parseControls(record.buttons),
        dials: parseControls(record.dials),
        id: String(record.id ?? record.label ?? "page"),
        label: String(record.label ?? "PAGE"),
      },
    ];
  });
}

function normalizeSetupMode(appSnapshot: SnapshotRecord | null): SetupMode {
  const shell = asRecord(appSnapshot?.shell);
  const setup = asRecord(shell?.setup);
  return setup?.activeSection === "support" ? "support" : "runner";
}

function normalizeRunnerStage(snapshot: SnapshotRecord | null): RunnerStepId | null {
  const runnerStage = snapshot?.runnerStage;
  if (
    runnerStage === "import" ||
    runnerStage === "probe" ||
    runnerStage === "map" ||
    runnerStage === "verify" ||
    runnerStage === "publish"
  ) {
    return runnerStage;
  }

  if (snapshot?.stage === "ready") {
    return "publish";
  }

  if (snapshot?.stage === "in-progress") {
    return "probe";
  }

  if (snapshot?.stage === "setup-required") {
    return "import";
  }

  return null;
}

function deriveRecommendedStepId(snapshot: SnapshotRecord | null, pages: ControlSurfacePage[]): RunnerStepId {
  const persistedStage = normalizeRunnerStage(snapshot);
  if (persistedStage) {
    return persistedStage;
  }

  const checks = getCommissioningChecks(snapshot);
  const allChecksPassing = checks.length > 0 && checks.every((check) => check.status === "ok");
  const isReady = snapshot?.hasCompletedSetup === true;

  if (isReady) {
    return "publish";
  }

  if (!allChecksPassing) {
    return "probe";
  }

  if (pages.length > 0) {
    return "map";
  }

  return "import";
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes <= 0) {
    return "fixture";
  }

  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function feedbackStatus(feedback: ActionFeedback | null) {
  if (!feedback) {
    return null;
  }

  return feedback.tone === "ok" ? "ok" : feedback.tone === "error" ? "error" : "info";
}

function nextControlId(controls: ControlSurfaceControl[], selectedControlId: string | null, direction: -1 | 1) {
  if (controls.length === 0) {
    return null;
  }

  const currentIndex = controls.findIndex((control) => control.id === selectedControlId);
  if (currentIndex === -1) {
    return controls[0]?.id ?? null;
  }

  const nextIndex = (currentIndex + direction + controls.length) % controls.length;
  return controls[nextIndex]?.id ?? null;
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

export function SetupSupportPilot({
  appSnapshot,
  commissioningSnapshot,
  controlSurfaceSnapshot,
  healthSnapshot,
  liveTransportRequested,
  onRequestRestart,
  onShowShortcuts,
  store,
  supportSnapshot,
}: SetupSupportPilotProps) {
  const pages = useMemo(() => parseControlSurfacePages(controlSurfaceSnapshot), [controlSurfaceSnapshot]);
  const checks = useMemo(() => getCommissioningChecks(commissioningSnapshot), [commissioningSnapshot]);
  const backups = useMemo(() => getSupportBackups(supportSnapshot), [supportSnapshot]);
  const persistedMode = useMemo(() => normalizeSetupMode(appSnapshot), [appSnapshot]);
  const recommendedStepId = useMemo(
    () => deriveRecommendedStepId(commissioningSnapshot, pages),
    [commissioningSnapshot, pages]
  );

  const { setTheme, setUiScale, theme, uiScale } = useOperatorLayout();
  const [mode, setMode] = useState<SetupMode>(persistedMode);
  const [activeStepId, setActiveStepId] = useState<RunnerStepId>(recommendedStepId);
  const [pendingStepId, setPendingStepId] = useState<RunnerStepId | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  // 2026-09 audit Slice 8: probes that are not green when the operator asks
  // to publish; non-null opens the "Publish with failing probes?" confirm.
  const [publishOverridePrompt, setPublishOverridePrompt] = useState<string[] | null>(null);
  // 2026-09 audit remediation, Slice 12: seeding demo planning data is a
  // confirmed action, not a single click next to the profile download.
  const [seedPlanningPrompt, setSeedPlanningPrompt] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedControlId, setSelectedControlId] = useState<string | null>(null);
  const [echoControlId, setEchoControlId] = useState<string | null>(null);
  const [exportBaseUrl, setExportBaseUrl] = useState("");
  const [lightingBridgeIp, setLightingBridgeIp] = useState("");
  const [lightingUniverse, setLightingUniverse] = useState("1");
  const [audioSendHost, setAudioSendHost] = useState("127.0.0.1");
  const [audioSendPort, setAudioSendPort] = useState("7001");
  const [audioReceivePort, setAudioReceivePort] = useState("9001");
  const [restorePath, setRestorePath] = useState("");
  const lastEchoEventAtRef = useRef<number | null>(null);
  const echoTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setMode(persistedMode);
  }, [persistedMode]);

  useEffect(() => {
    const runtime = asRecord(appSnapshot?.runtime);
    const controlSurface = asRecord(runtime?.controlSurface);
    setExportBaseUrl(String(controlSurface?.baseUrl ?? ""));
    setLightingBridgeIp(String(asRecord(commissioningSnapshot?.lighting)?.bridgeIp ?? ""));
    setLightingUniverse(String(asRecord(commissioningSnapshot?.lighting)?.universe ?? 1));
    setAudioSendHost(String(asRecord(commissioningSnapshot?.audio)?.sendHost ?? "127.0.0.1"));
    setAudioSendPort(String(asRecord(commissioningSnapshot?.audio)?.sendPort ?? 7001));
    setAudioReceivePort(String(asRecord(commissioningSnapshot?.audio)?.receivePort ?? 9001));
  }, [appSnapshot, commissioningSnapshot]);

  useEffect(() => {
    const latestBackup = backups[0];
    if (latestBackup && !restorePath) {
      setRestorePath(latestBackup.path);
    }
  }, [backups, restorePath]);

  useEffect(() => {
    if (!pages.some((page) => page.id === selectedPageId)) {
      setSelectedPageId(pages[0]?.id ?? "");
      setSelectedControlId(pages[0]?.buttons[0]?.id ?? pages[0]?.dials[0]?.id ?? null);
    }
  }, [pages, selectedPageId]);

  useEffect(() => {
    setActiveStepId(recommendedStepId);
  }, [recommendedStepId]);

  useEffect(() => {
    if (activeStepId !== "verify") {
      lastEchoEventAtRef.current = null;
      return;
    }

    const pollTimer = window.setInterval(() => {
      void store.refreshControlSurfaceSnapshot();
    }, 500);
    return () => {
      window.clearInterval(pollTimer);
    };
  }, [activeStepId, store]);

  useEffect(() => {
    if (activeStepId !== "verify") {
      return;
    }

    const lastEvent = parseControlSurfaceLastEvent(controlSurfaceSnapshot?.lastEvent);
    if (!lastEvent) {
      return;
    }
    if (lastEchoEventAtRef.current === null) {
      // The first observed event predates this verify session; only pulse for
      // presses that arrive after the operator opened the step.
      lastEchoEventAtRef.current = lastEvent.at;
      return;
    }
    if (lastEvent.at === lastEchoEventAtRef.current) {
      return;
    }
    lastEchoEventAtRef.current = lastEvent.at;

    const changedControlId = findEchoControlId(pages, lastEvent, selectedPageId || null);
    if (changedControlId) {
      setEchoControlId(changedControlId);
      if (echoTimeoutRef.current !== null) {
        window.clearTimeout(echoTimeoutRef.current);
      }
      echoTimeoutRef.current = window.setTimeout(() => {
        setEchoControlId(null);
        echoTimeoutRef.current = null;
      }, 300);
    }
  }, [activeStepId, controlSurfaceSnapshot, pages, selectedPageId]);

  useEffect(() => {
    return () => {
      if (echoTimeoutRef.current !== null) {
        window.clearTimeout(echoTimeoutRef.current);
      }
    };
  }, []);

  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? null;
  const selectedControl =
    selectedPage?.buttons.find((control) => control.id === selectedControlId) ??
    selectedPage?.dials.find((control) => control.id === selectedControlId) ??
    null;
  const selectedPageControls = selectedPage ? [...selectedPage.buttons, ...selectedPage.dials] : [];

  const runtime = asRecord(appSnapshot?.runtime);
  const runtimePaths = asRecord(runtime?.paths);
  const controlSurface = asRecord(runtime?.controlSurface);
  const startup = asRecord(appSnapshot?.startup);
  // SET-01: the banner fires on ANY non-ok health tone, so derive its title
  // from that tone instead of the hardcoded alarming "Degraded startup posture"
  // (an `attention` posture is not "degraded").
  const healthTone = healthSnapshot ? asStatusTone(healthSnapshot.status, "info") : "ok";
  const degradedSummary =
    healthTone !== "ok"
      ? String(healthSnapshot?.summary ?? "The desk or the bridge needs attention. Run all probes to see which.")
      : null;
  const isReady = commissioningSnapshot?.hasCompletedSetup === true;
  const lastBackup = backups[0];
  const stepIndex = runnerStepOrder.indexOf(activeStepId);
  const totalControlCount = pages.reduce((count, page) => count + page.buttons.length + page.dials.length, 0);
  const canReturnToConsole = String(startup?.targetSurface ?? "commissioning") === "dashboard";
  const probeHasError = checks.some((check) => check.status === "error");

  const runnerSteps = useMemo<RunnerStep[]>(
    () =>
      runnerStepOrder.map((id, index) => {
        const tone: StatusToneLike =
          id === "probe" && probeHasError
            ? "error"
            : index < stepIndex || (id === "publish" && isReady)
              ? "ok"
              : id === activeStepId
                ? "attention"
                : "info";

        const hintMap: Record<RunnerStepId, string> = {
          import: "Export the ready-to-import Companion profile.",
          probe: "Run the deck, bridge and desk probes.",
          map: "Review the deck's pages, buttons and dials.",
          publish: "Commit commissioning and export a support backup.",
          verify: "Press physical controls and watch for live echo.",
        };

        const labelMap: Record<RunnerStepId, string> = {
          import: "Import profile",
          probe: "Probe hardware",
          map: "Map bindings",
          publish: "Publish",
          verify: "Verify live echo",
        };

        return {
          hint: hintMap[id],
          id,
          label: labelMap[id],
          tone,
        };
      }),
    [activeStepId, isReady, probeHasError, stepIndex]
  );

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

  const loadSamplePlanning = async () => {
    await store.seedPlanningDemo(false);
    return {
      message: "Loaded the bundled sample planning data for commissioning support.",
      tone: "info" as const,
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
    await store.setWorkspace("planning");

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
      message:
        result?.requiresRestart === true
          ? `Database backup restored from ${String(result?.sourcePath ?? path)}; the hardware link restarted into it.`
          : `Restored ${String(result?.sourceFormat ?? "backup")} from ${String(result?.sourcePath ?? path)}.`,
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
    return isReady ? "Open planning" : "Publish setup";
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
      void performAction("open-planning", async () => {
        await store.setWorkspace("planning");
        return {
          message: "Opened the Planning workspace.",
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const editableTarget = isEditableTarget(event.target);
      if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s") {
        persistMode(mode === "runner" ? "support" : "runner");
        event.preventDefault();
        return;
      }

      if (mode !== "runner" || pendingStepId !== null || editableTarget) {
        return;
      }

      if (event.key === "Tab") {
        moveStepSelection(event.shiftKey ? -1 : 1);
        event.preventDefault();
        return;
      }

      if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        invokePrimaryAction();
        event.preventDefault();
        return;
      }

      if ((activeStepId === "map" || activeStepId === "verify") && event.key.toLowerCase() === "j") {
        moveControlSelection(-1);
        event.preventDefault();
        return;
      }

      if ((activeStepId === "map" || activeStepId === "verify") && event.key.toLowerCase() === "k") {
        moveControlSelection(1);
        event.preventDefault();
        return;
      }

      if (activeStepId === "map" && /^[1-4]$/.test(event.key)) {
        const page = pages[Number(event.key) - 1];
        if (page) {
          setSelectedPageId(page.id);
          setSelectedControlId(page.buttons[0]?.id ?? page.dials[0]?.id ?? null);
          event.preventDefault();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeStepId,
    invokePrimaryAction,
    mode,
    moveControlSelection,
    moveStepSelection,
    pages,
    pendingStepId,
    persistMode,
  ]);

  // Visual overhaul A, Slice 7: the runner's steps as the cluster prints them —
  // done, current or pending, with a probe failure showing on the step that
  // runs the probes.
  const clusterSteps: SetupClusterStep[] = runnerSteps.map((step, index) => ({
    hint: step.hint,
    id: step.id,
    label: step.label,
    standing:
      step.id === "probe" && probeHasError
        ? "failed"
        : step.id === activeStepId
          ? "current"
          : index < stepIndex || (step.id === "publish" && isReady)
            ? "done"
            : "pending",
  }));

  const setupState = deriveSetupState({
    checks: probeChecks(checks),
    commissioningSummary: typeof commissioningSnapshot?.summary === "string" ? commissioningSnapshot.summary : null,
    healthSummary: degradedSummary,
    healthTone: healthTone === "error" ? "error" : healthTone === "attention" ? "attention" : "ok",
    lastBackupLabel: lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : null,
    published: isReady,
    stepLabel: runnerSteps[stepIndex]?.label ?? "Import profile",
    stepNumber: stepIndex + 1,
    stepTotal: runnerStepOrder.length,
  });

  const engineLogPath = String(runtimePaths?.logFilePath ?? "");
  const openEngineLog = () => {
    void performAction("open-engine-log", () => openReferencePath("Engine log", engineLogPath));
  };

  const primaryKey = (
    <Key
      mode="primary"
      take
      disabled={busyAction !== null}
      testId="setup-step-primary"
      onClick={() => invokePrimaryAction()}
    >
      {busyAction ? "Working…" : primaryActionLabel}
    </Key>
  );

  const backKey =
    stepIndex > 0 ? (
      <Key take testId="setup-step-back" onClick={() => moveStepSelection(-1)}>
        Back to {runnerSteps[stepIndex - 1]?.label ?? "the previous step"}
      </Key>
    ) : null;

  const bayHead = (
    <>
      <span className={styles.bayTitle}>{mode === "runner" ? "Commissioning runner" : "Support dashboard"}</span>
      <span className={styles.bayDetail}>
        {mode === "runner"
          ? `step ${stepIndex + 1} of ${runnerStepOrder.length} · ${
              activeStepId === "publish"
                ? "the last step commits everything above it"
                : "each step is finished before the next one opens"
            }`
          : "what to do when something is wrong, and the archives to do it from"}
      </span>
      <Key size="small" className={styles.bayShortcuts} cap="Shortcuts" hint="?" onClick={onShowShortcuts} />
    </>
  );

  const publishOverrideRecorded =
    typeof commissioningSnapshot?.publishOverrideAt === "string" && commissioningSnapshot.publishOverrideAt
      ? formatBackupTimestamp(commissioningSnapshot.publishOverrideAt)
      : null;
  const notPassedProbes = probeChecks(checks).filter((check) => check.status !== "ok");

  return (
    <div className={styles.workspaceStack} data-testid="setup-workspace">
      <ShellRegion region="cluster">
        <SetupCluster
          busy={busyAction !== null}
          canReturnToConsole={canReturnToConsole}
          checks={probeChecks(checks)}
          mode={mode}
          state={setupState}
          steps={clusterSteps}
          onExportBackup={() => void performAction("support-export", exportSupportBackup)}
          onOpenEngineLog={openEngineLog}
          onReturnToConsole={() => void store.setWorkspace("planning")}
          onRunAllProbes={() => {
            persistMode("runner");
            void activateStep("probe");
            void performAction("run-all-probes", () => runAllProbes(true));
          }}
          onSelectMode={persistMode}
          onSelectStep={(stepId) => requestStepSelection(stepId as RunnerStepId)}
          onStartRunner={() => {
            persistMode("runner");
            void activateStep("import");
          }}
        />
      </ShellRegion>

      <div className={styles.body}>
        <main className={styles.bay} data-region={mode === "runner" ? "runner" : "support"}>
          {mode === "runner" ? (
            <>
              {activeStepId === "import" ? (
                <SetupStepScreen
                  head={bayHead}
                  eyebrow={`Step 1 of ${runnerStepOrder.length}`}
                  title="Import the Companion profile"
                  lead="Export the ready-to-import deck profile, then load it in Companion on this workstation."
                  rules={[
                    {
                      id: "bindings",
                      text: "The profile carries the deck pages and their controls; edit bindings in Map bindings, not in Companion.",
                      tone: "off",
                    },
                    {
                      id: "url",
                      text: "The server base URL is where Companion reaches this workstation; keep it on the studio network.",
                      tone: "off",
                    },
                  ]}
                  facts={
                    <>
                      <label className={styles.field}>
                        <span>Server base URL</span>
                        <input
                          className={styles.textField}
                          onChange={(event) => setExportBaseUrl(event.target.value)}
                          placeholder="http://127.0.0.1:38201"
                          value={exportBaseUrl}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Export target</span>
                        <input
                          className={styles.textField}
                          disabled
                          value={String(runtimePaths?.appDataDir ?? "Native runtime path unavailable")}
                        />
                      </label>
                    </>
                  }
                  actions={
                    <>
                      {primaryKey}
                      <Key
                        take
                        testId="setup-download-companion"
                        onClick={() => void performAction("export-companion-inline", () => saveImportProfile(false))}
                      >
                        Download Companion profile
                      </Key>
                    </>
                  }
                  note="Download profile writes the export, then opens Probe hardware."
                  record={
                    <>
                      <SetupRecordHeading>Before you start</SetupRecordHeading>
                      <SetupRecordRow
                        label="Companion link"
                        value={String(controlSurface?.summary ?? "Pending")}
                        tone={asStatusTone(controlSurface?.status, "info") === "ok" ? "ok" : "attention"}
                      />
                      <SetupRecordRow
                        label="Deck pages"
                        value={String(pages.length)}
                        tone={pages.length > 0 ? "ok" : "off"}
                      />
                      <SetupRecordRow
                        label="Mapped controls"
                        value={String(totalControlCount)}
                        tone={totalControlCount > 0 ? "ok" : "off"}
                      />
                      <SetupRecordRow
                        label="Hardware profile"
                        value={String(commissioningSnapshot?.hardwareProfile ?? "Unavailable")}
                        tone="off"
                      />
                    </>
                  }
                  testId="setup-screen-import"
                />
              ) : null}

              {activeStepId === "probe" ? (
                <SetupStepScreen
                  head={bayHead}
                  eyebrow={`Step 2 of ${runnerStepOrder.length}`}
                  title="Probe hardware"
                  lead="Run the deck, bridge and desk probes in one pass. What each one reports also shows under Probes and in Support, so recovery starts from the same place."
                  rules={[
                    {
                      id: "green",
                      text: "Every probe must be green before publish; a probe that is not green asks for an explicit override and records it.",
                      tone: probeHasError
                        ? "error"
                        : setupState.passedProbeCount === setupState.probeCount
                          ? "ok"
                          : "attention",
                    },
                  ]}
                  facts={
                    <>
                      <label className={styles.field}>
                        <span>Lighting bridge IP</span>
                        <input
                          className={styles.textField}
                          onChange={(event) => setLightingBridgeIp(event.target.value)}
                          placeholder="192.168.1.80"
                          value={lightingBridgeIp}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Lighting universe</span>
                        <input
                          className={styles.textField}
                          onChange={(event) => setLightingUniverse(event.target.value)}
                          value={lightingUniverse}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>TotalMix send host</span>
                        <input
                          className={styles.textField}
                          onChange={(event) => setAudioSendHost(event.target.value)}
                          value={audioSendHost}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>TotalMix send port</span>
                        <input
                          className={styles.textField}
                          onChange={(event) => setAudioSendPort(event.target.value)}
                          value={audioSendPort}
                        />
                      </label>
                      <label className={styles.field}>
                        <span>TotalMix receive port</span>
                        <input
                          className={styles.textField}
                          onChange={(event) => setAudioReceivePort(event.target.value)}
                          value={audioReceivePort}
                        />
                      </label>
                    </>
                  }
                  actions={
                    <>
                      {primaryKey}
                      {backKey}
                    </>
                  }
                  note={`${setupState.passedProbeCount} of ${setupState.probeCount} probes passed. A probe that fails never advances the runner on its own.`}
                  record={
                    <>
                      <SetupRecordHeading>What each probe reports</SetupRecordHeading>
                      {probeChecks(checks).map((check) => (
                        <div key={check.id} className={styles.probeRecord}>
                          <SetupRecordRow
                            label={check.label}
                            value={statusToneLabel(check.status)}
                            tone={check.status === "ok" ? "ok" : check.status === "error" ? "error" : "attention"}
                            testId={`setup-probe-record-${check.id}`}
                          />
                          <div className={styles.checkDetail}>{check.detail}</div>
                          <div className={styles.inlineActions}>
                            <Key
                              size="small"
                              disabled={busyAction !== null}
                              onClick={() =>
                                void performAction(`probe-${check.id}`, () =>
                                  runSingleProbe(check.id as "control-surface" | "lighting" | "audio")
                                )
                              }
                            >
                              Run probe
                            </Key>
                            {check.checkedAt ? (
                              <span className={styles.metaCopy}>Last run {formatBackupTimestamp(check.checkedAt)}</span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </>
                  }
                  testId="setup-screen-probe"
                />
              ) : null}

              {activeStepId === "map" || activeStepId === "verify" ? (
                <SetupStepScreen
                  head={bayHead}
                  eyebrow={`Step ${activeStepId === "map" ? 3 : 4} of ${runnerStepOrder.length}`}
                  title={activeStepId === "map" ? "Map bindings" : "Verify live echo"}
                  lead={
                    activeStepId === "map"
                      ? "Review the deck page map Studio Control holds, then confirm each slot label against the hardware before live verification."
                      : "Press a button or dial on the deck. The matching cell pulses when the deck reports the press back."
                  }
                  rules={
                    activeStepId === "verify"
                      ? [
                          {
                            id: "echo",
                            text: echoControlId
                              ? "The pulse is driven by what the deck reports, not by this screen."
                              : "Nothing has been pressed yet. The cell pulses as soon as the deck answers.",
                            tone: echoControlId ? "ok" : "off",
                          },
                          {
                            id: "transport",
                            text: liveTransportRequested
                              ? "This workstation is wired to the hardware, so a press is real."
                              : "This workstation is running on sample data; presses are simulated.",
                            tone: liveTransportRequested ? "ok" : "off",
                          },
                        ]
                      : [
                          {
                            id: "pages",
                            text: "Bindings are edited here, not in Companion: the profile is regenerated from what Studio Control holds.",
                            tone: "off",
                          },
                        ]
                  }
                  facts={
                    selectedPage ? (
                      <div className={styles.deckPreview}>
                        <div className={styles.pageTabs}>
                          {pages.map((page, index) => (
                            <button
                              key={page.id}
                              className={styles.pageTab}
                              data-active={page.id === selectedPage?.id}
                              onClick={() => {
                                setSelectedPageId(page.id);
                                setSelectedControlId(page.buttons[0]?.id ?? page.dials[0]?.id ?? null);
                              }}
                              type="button"
                            >
                              {page.label}
                              {activeStepId === "map" ? <small>{index + 1}</small> : null}
                            </button>
                          ))}
                        </div>
                        <div className={styles.buttonMatrix}>
                          {selectedPage.buttons.map((control) => (
                            <button
                              key={control.id}
                              className={styles.deckButton}
                              data-echo={activeStepId === "verify" && control.id === echoControlId}
                              data-selected={control.id === selectedControl?.id}
                              onClick={() => setSelectedControlId(control.id)}
                              type="button"
                            >
                              <span>{control.label}</span>
                              <small>{control.type}</small>
                            </button>
                          ))}
                        </div>
                        <div className={styles.dialRow}>
                          {selectedPage.dials.map((control) => (
                            <button
                              key={control.id}
                              className={styles.dialChip}
                              data-echo={activeStepId === "verify" && control.id === echoControlId}
                              data-selected={control.id === selectedControl?.id}
                              onClick={() => setSelectedControlId(control.id)}
                              type="button"
                            >
                              {control.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className={styles.emptyState}>
                        The deck has not reported its pages yet. Run all probes to check the deck.
                      </div>
                    )
                  }
                  actions={
                    <>
                      {primaryKey}
                      {backKey}
                    </>
                  }
                  note={
                    activeStepId === "verify" && !echoControlId
                      ? "Waiting for a press. Continue when every control you rely on has echoed."
                      : undefined
                  }
                  record={
                    <>
                      <SetupRecordHeading>
                        {activeStepId === "map" ? "Binding detail" : "Echo detail"}
                      </SetupRecordHeading>
                      <SetupRecordRow
                        label={selectedControl?.label ?? "Choose a control"}
                        value={selectedControl?.type ?? "—"}
                        tone={
                          activeStepId === "verify" && selectedControl?.id === echoControlId
                            ? "ok"
                            : selectedControl
                              ? "off"
                              : "attention"
                        }
                      />
                      <div className={styles.checkDetail}>
                        {selectedControl?.description ??
                          "Review the current page and make sure the binding description matches the hardware label."}
                      </div>
                      <SetupRecordHeading>The deck as Studio Control holds it</SetupRecordHeading>
                      <SetupRecordRow
                        label="Pages"
                        value={String(pages.length)}
                        tone={pages.length > 0 ? "ok" : "attention"}
                      />
                      <SetupRecordRow
                        label="Controls"
                        value={String(totalControlCount)}
                        tone={totalControlCount > 0 ? "ok" : "attention"}
                      />
                      <SetupRecordRow
                        label="Hardware link"
                        value={liveTransportRequested ? "live" : "sample data"}
                        tone={liveTransportRequested ? "ok" : "off"}
                      />
                    </>
                  }
                  testId={`setup-screen-${activeStepId}`}
                />
              ) : null}

              {activeStepId === "publish" ? (
                <SetupStepScreen
                  head={bayHead}
                  eyebrow={`Step ${runnerStepOrder.length} of ${runnerStepOrder.length}`}
                  title="Publish"
                  lead="Publishing unlocks the operator workspaces, exports a fresh support backup, and returns you to the console."
                  rules={[
                    {
                      id: "probes",
                      text: "The deck, bridge and desk probes must all be green before publish; publishing with a probe that is not green asks for an explicit override and records it.",
                      tone: notPassedProbes.length > 0 ? "attention" : "ok",
                    },
                    {
                      id: "backup",
                      text: "The support backup export is part of publish, not a chore for afterwards.",
                      tone: "ok",
                    },
                    {
                      id: "live",
                      text: "Once published, the deck's pages, the bridge and the desk are live for the next session.",
                      tone: "ok",
                    },
                  ]}
                  facts={
                    <>
                      <SetupFactCard
                        label="Latest backup"
                        value={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "None"}
                        standing={lastBackup ? "healthy" : "none yet"}
                        tone={lastBackup ? "ok" : "attention"}
                      />
                      <SetupFactCard
                        label="Startup target"
                        value={
                          String(startup?.targetSurface ?? "commissioning") === "dashboard"
                            ? "Console"
                            : "Setup / Support"
                        }
                        standing={isReady ? "healthy" : "pending publish"}
                        tone={isReady ? "ok" : "attention"}
                      />
                      <SetupFactCard
                        label="Support archives"
                        value={`${backups.length} · native`}
                        standing={backups.length > 0 ? "ready" : "none yet"}
                        tone={backups.length > 0 ? "ok" : "attention"}
                      />
                    </>
                  }
                  actions={
                    <>
                      <Key
                        mode={notPassedProbes.length > 0 ? "danger" : "primary"}
                        take
                        disabled={busyAction !== null}
                        testId="setup-step-primary"
                        onClick={() => invokePrimaryAction()}
                      >
                        {busyAction
                          ? "Working…"
                          : notPassedProbes.length > 0
                            ? "Publish with override…"
                            : isReady
                              ? "Open planning"
                              : "Publish setup"}
                      </Key>
                      {backKey}
                    </>
                  }
                  note={
                    notPassedProbes.length > 0
                      ? `${notPassedProbes.length} of ${setupState.probeCount} probes are not green. Publishing now asks for an explicit override and records it with a timestamp.`
                      : "Writes the gate, exports a backup, then opens the console."
                  }
                  record={
                    <>
                      {/* What publish commits, as the engine holds it: the
                          addresses and the counts, not a repeat of the probe
                          sentences the cluster already prints. */}
                      <SetupRecordHeading>What publish records</SetupRecordHeading>
                      <SetupRecordRow
                        label="Hardware profile"
                        value={String(commissioningSnapshot?.hardwareProfile ?? "Unavailable")}
                      />
                      <SetupRecordRow
                        label="Lighting bridge"
                        value={lightingBridgeIp ? `${lightingBridgeIp} · U${lightingUniverse}` : "no address recorded"}
                        tone={lightingBridgeIp ? "ok" : "attention"}
                      />
                      <SetupRecordRow
                        label="TotalMix"
                        value={`${audioSendHost}:${audioSendPort} · receive ${audioReceivePort}`}
                      />
                      <SetupRecordRow
                        label="Deck"
                        value={`${pages.length} pages · ${totalControlCount} controls`}
                        tone={pages.length > 0 ? "ok" : "attention"}
                      />
                      <SetupRecordRow
                        label="Companion profile"
                        value={String(controlSurface?.summary ?? "not exported yet")}
                        tone={asStatusTone(controlSurface?.status, "info") === "ok" ? "ok" : "attention"}
                      />
                      <SetupRecordRow
                        label="Override"
                        value={publishOverrideRecorded ?? "none recorded"}
                        tone={publishOverrideRecorded ? "attention" : "ok"}
                        testId={publishOverrideRecorded ? "setup-publish-override-note" : undefined}
                      />
                      <SetupRecordHeading>The steps above, as done</SetupRecordHeading>
                      {clusterSteps.slice(0, -1).map((step, index) => (
                        <SetupRecordRow
                          key={step.id}
                          label={`${index + 1} · ${step.label}`}
                          value={
                            step.id === "probe"
                              ? `${setupState.passedProbeCount} of ${setupState.probeCount} probes passed`
                              : step.id === "import"
                                ? String(controlSurface?.summary ?? "not exported yet")
                                : step.id === "map"
                                  ? `${pages.length} pages · ${totalControlCount} controls mapped`
                                  : echoControlId
                                    ? "a control echoed"
                                    : "not confirmed this session"
                          }
                          tone={step.standing === "done" ? "ok" : step.standing === "failed" ? "error" : "attention"}
                        />
                      ))}
                      <SetupRecordHeading>Support archives</SetupRecordHeading>
                      {backups.length > 0 ? (
                        backups
                          .slice(0, 3)
                          .map((backup) => (
                            <SetupRecordRow
                              key={backup.path}
                              label={backup.name}
                              value={formatBackupTimestamp(backup.modifiedAt)}
                            />
                          ))
                      ) : (
                        <SetupRecordRow label="No archives yet" value="export one with publish" tone="attention" />
                      )}
                    </>
                  }
                  testId="setup-screen-publish"
                />
              ) : null}
            </>
          ) : (
            <SetupStepScreen
              head={bayHead}
              eyebrow="Support"
              title="Backup and recovery"
              lead="What went wrong? Verify a backup, restore a backup archive or a database backup from the backups folder, then run the deck, bridge and desk probes again before resuming operator work."
              rules={[
                {
                  id: "restore",
                  text: String(
                    supportSnapshot?.restoreSummary ??
                      "Restore a backup archive or a database backup from the backups folder."
                  ),
                  tone: backups.length > 0 ? "ok" : "attention",
                },
                {
                  id: "install",
                  text: "Keep the workstation on the packaged installer and update-repository path rather than ad hoc local binaries. On macOS, right-click the app and choose Open to clear Gatekeeper once; on Windows, choose More info then Run anyway if SmartScreen intervenes.",
                  tone: "off",
                },
              ]}
              facts={
                <>
                  <SetupFactCard
                    label="Latest backup"
                    value={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "No backup exported yet"}
                    standing={backups.length > 0 ? `${backups.length} backups` : "empty backup history"}
                    tone={backups.length > 0 ? "ok" : "attention"}
                  />
                  <label className={styles.field}>
                    <span>Restore from path</span>
                    <input
                      className={styles.textField}
                      onChange={(event) => setRestorePath(event.target.value)}
                      placeholder={String(runtimePaths?.backupDir ?? "a file inside the backups folder")}
                      value={restorePath}
                    />
                  </label>
                </>
              }
              actions={
                <>
                  <Key
                    mode="primary"
                    take
                    disabled={busyAction !== null}
                    testId="support-export-first"
                    onClick={() =>
                      void performAction(
                        backups.length > 0 ? "support-export-main" : "support-export-first",
                        exportSupportBackup
                      )
                    }
                  >
                    {backups.length > 0 ? "Export a backup now" : "Export first backup"}
                  </Key>
                  <Key
                    take
                    disabled={!restorePath.trim() || busyAction !== null}
                    testId="support-verify-path"
                    onClick={() => void performAction("verify-backup", () => verifyBackup(restorePath.trim()))}
                  >
                    Verify path
                  </Key>
                  <Key
                    take
                    disabled={!restorePath.trim() || busyAction !== null}
                    testId="support-restore-path"
                    onClick={() => void performAction("restore-path", () => restoreBackup(restorePath.trim()))}
                  >
                    Restore path
                  </Key>
                </>
              }
              note="Restoring replaces the workstation's saved data; a database backup restarts the hardware link. Export a backup first."
              record={
                <>
                  <SetupRecordHeading>Backups</SetupRecordHeading>
                  <div className={styles.backupList}>
                    {backups.length > 0 ? (
                      backups.map((backup) => (
                        <button
                          key={backup.path}
                          className={styles.backupRow}
                          onClick={() => setRestorePath(backup.path)}
                          type="button"
                        >
                          <span>
                            <strong>{backup.name}</strong>
                            <small>{backup.path}</small>
                          </span>
                          <span className={styles.metaCopy}>
                            {formatBackupTimestamp(backup.modifiedAt)} · {formatFileSize(backup.sizeBytes)} ·{" "}
                            {describeBackupKind(backup.kind)}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className={styles.emptyState}>
                        No backups yet. Export first backup before any destructive support work.
                      </div>
                    )}
                  </div>
                  <SetupRecordHeading>Where things are</SetupRecordHeading>
                  <div className={styles.supportRailButtons}>
                    <button
                      className={styles.railButton}
                      onClick={() =>
                        void performAction("open-archive-path", () =>
                          openReferencePath(
                            "Archive",
                            String(supportSnapshot?.backupDir ?? runtimePaths?.backupDir ?? "")
                          )
                        )
                      }
                      type="button"
                    >
                      Archive
                    </button>
                    <button
                      className={styles.railButton}
                      disabled={!String(runtimePaths?.updateRepositoryPath ?? "").trim()}
                      onClick={() =>
                        void performAction("open-update-repo", () =>
                          openReferencePath("Update folder", String(runtimePaths?.updateRepositoryPath ?? ""))
                        )
                      }
                      type="button"
                    >
                      Update folder
                    </button>
                    <button
                      className={styles.railButton}
                      disabled={!String(runtimePaths?.appDataDir ?? "").trim()}
                      onClick={() =>
                        void performAction("open-app-data", () =>
                          openReferencePath("App data", String(runtimePaths?.appDataDir ?? ""))
                        )
                      }
                      type="button"
                    >
                      App data
                    </button>
                    <button
                      className={styles.railButton}
                      disabled={!String(runtimePaths?.exportsDir ?? runtimePaths?.appDataDir ?? "").trim()}
                      onClick={() =>
                        void performAction("open-diagnostics-dir", () =>
                          openReferencePath(
                            "Diagnostics",
                            String(runtimePaths?.exportsDir ?? runtimePaths?.appDataDir ?? "")
                          )
                        )
                      }
                      type="button"
                    >
                      Diagnostics
                    </button>
                    <button
                      className={styles.railButton}
                      disabled={!String(runtimePaths?.logsDir ?? "").trim()}
                      onClick={() =>
                        void performAction("open-logs", () =>
                          openReferencePath("Logs", String(runtimePaths?.logsDir ?? ""))
                        )
                      }
                      type="button"
                    >
                      Logs
                    </button>
                  </div>
                </>
              }
              testId="setup-screen-support"
            />
          )}

          {feedback ? (
            <div className={styles.feedbackBanner} data-testid="setup-feedback" data-tone={feedback.tone} role="status">
              <StatusPill
                label={feedback.tone === "ok" ? "Updated" : feedback.tone === "error" ? "Attention" : "Info"}
                tone={feedbackStatus(feedback) ?? "info"}
              />
              <span>{feedback.message}</span>
            </div>
          ) : null}
        </main>

        <aside className={styles.plateColumn} data-material="plate" data-region="support">
          <SupportPlate
            appVersion={APP_VERSION}
            archiveCount={backups.length}
            backupKind={lastBackup ? describeBackupKind(lastBackup.kind) : "none yet"}
            busy={busyAction !== null}
            canOpenEngineLog={engineLogPath.trim().length > 0}
            engineVersion={String(runtime?.engineVersion ?? "—")}
            hardwareProfile={String(commissioningSnapshot?.hardwareProfile ?? "Unavailable")}
            lastBackupLabel={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "no backup exported yet"}
            protocolVersion={String(runtime?.protocol ?? runtime?.protocolVersion ?? "1")}
            restoreDisabled={!lastBackup}
            theme={theme}
            uiScale={uiScale}
            onExportBackup={() => void performAction("support-export-main", exportSupportBackup)}
            onExportDiagnostics={() => void performAction("export-shell-diagnostics", exportDiagnostics)}
            onLoadSamplePlanning={() => setSeedPlanningPrompt(true)}
            onOpenEngineLog={openEngineLog}
            onRestartBridge={onRequestRestart}
            onRestoreLatest={() => {
              if (!lastBackup) return;
              void performAction("restore-latest", () => restoreBackup(lastBackup.path));
            }}
            onSelectTheme={setTheme}
            onSelectUiScale={setUiScale}
            onVerifyBackup={() => {
              if (!lastBackup) return;
              void performAction("verify-backup", () => verifyBackup(lastBackup.path));
            }}
          />
        </aside>
      </div>

      <ShellRegion region="footer">
        <SetupFooter
          appVersion={APP_VERSION}
          commissioningWord={
            setupState.word === "READY"
              ? "published"
              : setupState.word === "DEGRADED"
                ? "needs re-verification"
                : "setup required"
          }
          passedProbeCount={setupState.passedProbeCount}
          probeCount={setupState.probeCount}
          stepLabel={runnerSteps[stepIndex]?.label ?? ""}
          stepNumber={stepIndex + 1}
          stepTotal={runnerStepOrder.length}
        />
      </ShellRegion>

      {seedPlanningPrompt ? (
        <ConfirmDialog
          body={
            <p>
              This adds the bundled sample projects, tasks and schedule blocks to Planning, next to anything already
              there. Use it for commissioning and training only.
            </p>
          }
          cancelLabel="Cancel"
          confirmLabel="Load sample planning"
          onCancel={() => setSeedPlanningPrompt(false)}
          onConfirm={() => {
            setSeedPlanningPrompt(false);
            void performAction("seed-planning-inline", loadSamplePlanning);
          }}
          title="Load sample planning data?"
        />
      ) : null}

      {publishOverridePrompt ? (
        <ConfirmDialog
          body={
            <>
              <p>These probes are not green:</p>
              <ul>
                {publishOverridePrompt.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
              <p>
                Publishing anyway unlocks operator mode with unverified hardware. The override is recorded in the setup
                summary and the Engine log.
              </p>
            </>
          }
          cancelLabel="Cancel"
          confirmLabel="Publish anyway"
          danger
          onCancel={() => setPublishOverridePrompt(null)}
          onConfirm={() => {
            setPublishOverridePrompt(null);
            void performAction("publish-setup", () => publishSetup(true));
          }}
          title="Publish with failing probes?"
        />
      ) : null}

      {pendingStepId ? (
        <div className={styles.jumpScrim} role="presentation">
          <Surface
            aria-labelledby="setup-jump-title"
            aria-modal="true"
            className={styles.jumpSurface}
            padding="lg"
            role="dialog"
            tone="raised"
          >
            <div className={styles.dialogTitle} id="setup-jump-title">
              Skip ahead?
            </div>
            <p className={styles.dialogBody}>
              Preceding steps haven&apos;t been confirmed. Skipping may leave the commissioning incomplete.
            </p>
            <div className={styles.dialogActions}>
              <Button variant="ghost" onClick={() => setPendingStepId(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  void activateStep(pendingStepId);
                  setPendingStepId(null);
                }}
              >
                Skip ahead
              </Button>
            </div>
          </Surface>
        </div>
      ) : null}
    </div>
  );
}
