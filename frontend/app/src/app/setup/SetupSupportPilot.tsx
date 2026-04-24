import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { Button, MetricCard, StatusBadge, StatusPill, Surface } from "@sse/design-system";
import type { JsonValue, ShellStore } from "@sse/engine-client";

import { exportShellDiagnostics, openShellPath } from "../shellCommands";
import {
  asRecord,
  asStatusTone,
  formatBackupTimestamp,
  getCommissioningChecks,
  getSupportBackups,
  isEditableTarget,
  mapStatusBadgeTone,
  type SnapshotRecord,
  type StatusToneLike,
} from "../shellData";
import styles from "./SetupSupportPilot.module.css";

type SetupMode = "runner" | "support";
type RunnerStepId = "import" | "probe" | "map" | "verify" | "publish";
type FeedbackTone = "error" | "info" | "ok";

interface ControlSurfaceControl {
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

        return [
          {
            description: String(controlRecord.description ?? "Bridge-mapped control."),
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

function createControlSignatureMap(snapshot: SnapshotRecord | null) {
  const signatures = new Map<string, string>();
  for (const page of parseControlSurfacePages(snapshot)) {
    for (const control of [...page.buttons, ...page.dials]) {
      signatures.set(
        control.id,
        JSON.stringify({
          description: control.description,
          label: control.label,
          pageId: page.id,
          position: control.position,
          type: control.type,
        })
      );
    }
  }
  return signatures;
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

  const [mode, setMode] = useState<SetupMode>(persistedMode);
  const [activeStepId, setActiveStepId] = useState<RunnerStepId>(recommendedStepId);
  const [pendingStepId, setPendingStepId] = useState<RunnerStepId | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
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
  const previousControlSignaturesRef = useRef<Map<string, string>>(new Map());
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
    const nextSignatures = createControlSignatureMap(controlSurfaceSnapshot);
    if (activeStepId === "verify") {
      const changedControlId = [...nextSignatures.entries()].find(([id, signature]) => {
        const previousSignature = previousControlSignaturesRef.current.get(id);
        return previousSignature !== undefined && previousSignature !== signature;
      })?.[0];

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
    }

    previousControlSignaturesRef.current = nextSignatures;
  }, [activeStepId, controlSurfaceSnapshot]);

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
  const shell = asRecord(appSnapshot?.shell);
  const startup = asRecord(appSnapshot?.startup);
  const healthChecks = asRecord(healthSnapshot?.checks);
  const degradedSummary =
    healthSnapshot && asStatusTone(healthSnapshot.status, "info") !== "ok"
      ? String(healthSnapshot.summary ?? "Hardware or bridge attention required.")
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
          probe: "Run control-surface, lighting, and audio probes.",
          map: "Review page, button, and dial bindings.",
          publish: "Commit setup and capture a support snapshot.",
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

  const performAction = useEffectEvent(async (actionId: string, onRun: () => Promise<ActionFeedback | null | void>) => {
    setBusyAction(actionId);
    setFeedback(null);

    try {
      const result = await onRun();
      if (result) {
        setFeedback(result);
      }
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "The setup workflow action failed.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const activateStep = useEffectEvent(async (stepId: RunnerStepId) => {
    startTransition(() => setActiveStepId(stepId));
    await store.updateCommissioning({ runnerStage: stepId });
  });

  const persistMode = useEffectEvent((nextMode: SetupMode) => {
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
            ? "Audio OSC probe passed."
            : "Control-surface probe passed.",
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
    await store.runCommissioningCheck({
      receivePort: Number(audioReceivePort),
      sendHost: audioSendHost.trim(),
      sendPort: Number(audioSendPort),
      target: "audio",
    });

    if (advance) {
      await activateStep("map");
    }

    return {
      message: "All commissioning probes completed.",
      tone: "ok" as const,
    };
  };

  const publishSetup = async () => {
    await store.updateCommissioning({ runnerStage: "publish", stage: "ready" });
    const backup = asRecord(await store.exportSupportBackup());
    await store.setWorkspace("planning");

    return {
      message: `Setup published and support backup written to ${String(backup?.path ?? "the backup directory")}.`,
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
    return {
      message: `Restored ${String(result?.sourceFormat ?? "backup")} from ${String(result?.sourcePath ?? path)}.`,
      tone: "ok" as const,
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
      commissioningSnapshot: toJsonValue(commissioningSnapshot),
      controlSurfaceSnapshot: toJsonValue(controlSurfaceSnapshot),
      generatedAt: new Date().toISOString(),
      healthSnapshot: toJsonValue(healthSnapshot),
      liveTransportRequested,
      supportSnapshot: toJsonValue(supportSnapshot),
    };
    const path = await exportShellDiagnostics(
      report,
      typeof runtimePaths?.logsDir === "string" ? runtimePaths.logsDir : undefined
    );
    return {
      message: `Shell diagnostics exported to ${path}.`,
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

  const invokePrimaryAction = useEffectEvent(() => {
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

    if (isReady) {
      void performAction("open-planning", async () => {
        await store.setWorkspace("planning");
        return {
          message: "Routing returned to the planning workbench.",
          tone: "info" as const,
        };
      });
      return;
    }

    void performAction("publish-setup", publishSetup);
  });

  const moveControlSelection = useEffectEvent((direction: -1 | 1) => {
    const nextId = nextControlId(selectedPageControls, selectedControlId, direction);
    if (nextId) {
      setSelectedControlId(nextId);
    }
  });

  const moveStepSelection = useEffectEvent((direction: -1 | 1) => {
    const nextIndex = Math.min(Math.max(stepIndex + direction, 0), runnerStepOrder.length - 1);
    void activateStep(runnerStepOrder[nextIndex]!);
  });

  const requestStepSelection = useEffectEvent((stepId: RunnerStepId) => {
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

  return (
    <div className={styles.workspaceStack}>
      {degradedSummary ? (
        <div className={styles.degradedBanner} role="status">
          <div>
            <div className={styles.bannerTitle}>Degraded startup posture</div>
            <div className={styles.bannerBody}>{degradedSummary}</div>
          </div>
          <div className={styles.bannerActions}>
            <Button variant="secondary" onClick={() => persistMode("support")}>
              Open support
            </Button>
            <Button variant="ghost" onClick={onRequestRestart}>
              Restart bridge
            </Button>
          </div>
        </div>
      ) : null}

      {feedback ? (
        <div className={styles.feedbackBanner} role="status">
          <StatusPill
            label={feedback.tone === "ok" ? "Updated" : feedback.tone === "error" ? "Attention" : "Info"}
            status={feedbackStatus(feedback) ?? "info"}
          />
          <span>{feedback.message}</span>
        </div>
      ) : null}

      <div className={styles.utilityRow}>
        <div className={styles.utilityActions}>
          <Button
            disabled={!canReturnToConsole}
            onClick={() => {
              void store.setWorkspace("planning");
            }}
            variant="ghost"
          >
            Back to Console
          </Button>
        </div>
        <div className={styles.utilityMeta}>
          <div className={styles.modeEyebrow}>Setup / Support</div>
          <div className={styles.modeHeadline}>{mode === "runner" ? "Commissioning runner" : "Support dashboard"}</div>
        </div>
        <div className={styles.utilityActions}>
          <Button
            variant={mode === "runner" ? "primary" : "secondary"}
            onClick={() => persistMode("runner")}
            size="compact"
          >
            Runner
          </Button>
          <Button
            variant={mode === "support" ? "primary" : "secondary"}
            onClick={() => persistMode("support")}
            size="compact"
          >
            Support
          </Button>
          <Button variant="ghost" onClick={onShowShortcuts} size="compact">
            Shortcuts
          </Button>
        </div>
      </div>

      {mode === "runner" ? (
        <div className={styles.runnerLayout}>
          <div className={styles.stepRail} role="tablist" aria-label="Commissioning runner">
            {runnerSteps.map((step, index) => (
              <button
                key={step.id}
                className={styles.stepButton}
                data-active={step.id === activeStepId}
                data-status={step.tone}
                onClick={() => requestStepSelection(step.id)}
                role="tab"
                type="button"
              >
                <span className={styles.stepNumber}>{index + 1}</span>
                <span className={styles.stepLabel}>{step.label}</span>
                <span className={styles.stepHint}>{step.hint}</span>
                <StatusPill
                  label={
                    step.tone === "ok"
                      ? "complete"
                      : step.tone === "error"
                        ? "error"
                        : step.id === activeStepId
                          ? "current"
                          : "up next"
                  }
                  status={step.tone}
                />
              </button>
            ))}
          </div>

          <div className={styles.runnerBody}>
            <div className={styles.runnerMain}>
              {activeStepId === "import" ? (
                <Surface className={styles.heroSurface} padding="lg" tone="raised">
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.sectionEyebrow}>Step 1</div>
                      <h2 className={styles.sectionTitle}>Import the Companion profile</h2>
                      <p className={styles.sectionBody}>
                        Export the ready-to-import control-surface profile before manual edits. The runner stays
                        anchored to the engine-owned local bridge URL and current control-surface snapshot.
                      </p>
                    </div>
                    <StatusBadge
                      label={String(controlSurface?.status ?? "pending")}
                      tone={mapStatusBadgeTone(asStatusTone(controlSurface?.status, "info"))}
                    />
                  </div>
                  <div className={styles.fieldGrid}>
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
                  </div>
                  <div className={styles.metricRow}>
                    <MetricCard
                      caption="Bridge status"
                      tone={asStatusTone(controlSurface?.status, "info") === "ok" ? "healthy" : "warning"}
                      value={String(controlSurface?.summary ?? "Pending")}
                    />
                    <MetricCard
                      caption="Deck pages"
                      tone={pages.length > 0 ? "connected" : "idle"}
                      value={String(pages.length)}
                    />
                    <MetricCard
                      caption="Mapped controls"
                      tone={totalControlCount > 0 ? "connected" : "idle"}
                      value={String(totalControlCount)}
                    />
                  </div>
                  <div className={styles.inlineActions}>
                    <Button
                      onClick={() => {
                        void performAction("export-companion-inline", () => saveImportProfile(false));
                      }}
                      variant="secondary"
                    >
                      Download Companion profile
                    </Button>
                    <Button
                      onClick={() => {
                        void performAction("seed-planning-inline", loadSamplePlanning);
                      }}
                      variant="ghost"
                    >
                      Load sample planning
                    </Button>
                  </div>
                </Surface>
              ) : null}

              {activeStepId === "probe" ? (
                <Surface className={styles.heroSurface} padding="lg" tone="raised">
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.sectionEyebrow}>Step 2</div>
                      <h2 className={styles.sectionTitle}>Probe hardware</h2>
                      <p className={styles.sectionBody}>
                        Run the control-surface, DMX, and OSC probes in one pass. Probe failures stay visible here and
                        in Support so recovery does not fork into a second model.
                      </p>
                    </div>
                    <StatusBadge
                      label={`${checks.filter((check) => check.status === "ok").length}/${checks.length} passing`}
                      tone={checks.length > 0 && checks.every((check) => check.status === "ok") ? "healthy" : "warning"}
                    />
                  </div>
                  <div className={styles.fieldGrid}>
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
                      <span>Audio send host</span>
                      <input
                        className={styles.textField}
                        onChange={(event) => setAudioSendHost(event.target.value)}
                        value={audioSendHost}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Audio send port</span>
                      <input
                        className={styles.textField}
                        onChange={(event) => setAudioSendPort(event.target.value)}
                        value={audioSendPort}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Audio receive port</span>
                      <input
                        className={styles.textField}
                        onChange={(event) => setAudioReceivePort(event.target.value)}
                        value={audioReceivePort}
                      />
                    </label>
                  </div>
                  <div className={styles.checkGrid}>
                    {checks.map((check) => (
                      <div key={check.id} className={styles.checkCard}>
                        <div className={styles.checkHeader}>
                          <div>
                            <div className={styles.checkTitle}>{check.label}</div>
                            <div className={styles.checkDetail}>{check.detail}</div>
                          </div>
                          <StatusPill label={check.status === "ok" ? "ready" : check.status} status={check.status} />
                        </div>
                        <div className={styles.inlineActions}>
                          <Button
                            onClick={() => {
                              void performAction(`probe-${check.id}`, () =>
                                runSingleProbe(check.id as "control-surface" | "lighting" | "audio")
                              );
                            }}
                            size="compact"
                            variant="secondary"
                          >
                            Run probe
                          </Button>
                          {check.checkedAt ? (
                            <span className={styles.metaCopy}>Last run {formatBackupTimestamp(check.checkedAt)}</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </Surface>
              ) : null}

              {activeStepId === "map" || activeStepId === "verify" ? (
                <Surface className={styles.heroSurface} padding="lg" tone="raised">
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.sectionEyebrow}>Step {activeStepId === "map" ? "3" : "4"}</div>
                      <h2 className={styles.sectionTitle}>
                        {activeStepId === "map" ? "Map bindings" : "Verify live echo"}
                      </h2>
                      <p className={styles.sectionBody}>
                        {activeStepId === "map"
                          ? "Review the engine-owned Stream Deck+ page map, then use the binding detail pane to confirm slot labels before live verification."
                          : "Waiting for press… physical button and dial activity should pulse the matching cell when the control-surface snapshot changes."}
                      </p>
                    </div>
                    <StatusBadge
                      label={
                        activeStepId === "map"
                          ? `${pages.length} pages`
                          : liveTransportRequested
                            ? "live transport"
                            : "fixture transport"
                      }
                      tone={
                        activeStepId === "map"
                          ? pages.length > 0
                            ? "healthy"
                            : "idle"
                          : liveTransportRequested
                            ? "ready"
                            : "idle"
                      }
                    />
                  </div>
                  {activeStepId === "verify" ? (
                    <div className={styles.verifyLead}>
                      <StatusPill
                        label={echoControlId ? "pulse detected" : "waiting for press"}
                        status={echoControlId ? "ok" : "info"}
                      />
                      <span className={styles.metaCopy}>
                        {echoControlId
                          ? "The grid pulse is driven by control-surface snapshot deltas."
                          : "Press a physical button or encoder to confirm live echo."}
                      </span>
                    </div>
                  ) : null}
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
                  {selectedPage ? (
                    <div className={styles.deckPreview}>
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
                      <div className={styles.selectionCard}>
                        <div className={styles.selectionLabel}>
                          {activeStepId === "map" ? "Binding detail" : "Echo detail"}
                        </div>
                        <div className={styles.selectionTitle}>{selectedControl?.label ?? "Choose a control"}</div>
                        <div className={styles.checkDetail}>
                          {selectedControl?.description ??
                            "Review the current page and make sure the binding description matches the hardware label."}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.emptyState}>Control-surface snapshot unavailable.</div>
                  )}
                </Surface>
              ) : null}

              {activeStepId === "publish" ? (
                <Surface className={styles.heroSurface} padding="lg" tone="raised">
                  <div className={styles.cardHeader}>
                    <div>
                      <div className={styles.sectionEyebrow}>Step 5</div>
                      <h2 className={styles.sectionTitle}>Publish</h2>
                      <p className={styles.sectionBody}>
                        Publishing commits the commissioning gate, exports a fresh support backup, and returns routing
                        to Planning.
                      </p>
                    </div>
                    <StatusBadge label={isReady ? "ready" : "pending publish"} tone={isReady ? "healthy" : "warning"} />
                  </div>
                  <div className={styles.metricRow}>
                    <MetricCard
                      caption="Latest backup"
                      tone={lastBackup ? "healthy" : "warning"}
                      value={lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "None"}
                    />
                    <MetricCard
                      caption="Startup target"
                      tone={isReady ? "ready" : "warning"}
                      value={String(startup?.targetSurface ?? "commissioning")}
                    />
                    <MetricCard
                      caption="Support archives"
                      tone={backups.length > 0 ? "healthy" : "idle"}
                      value={String(backups.length)}
                    />
                  </div>
                  <div className={styles.readinessList}>
                    <div>Lighting, audio, and control-surface probes should all be green before publish.</div>
                    <div>Support backup export is part of publish, not a post-commissioning chore.</div>
                    <div>The shell asks for the routing change, then reloads from engine snapshots.</div>
                  </div>
                </Surface>
              ) : null}
            </div>

            <aside className={styles.runnerSide}>
              <Surface className={styles.sideCard} padding="lg">
                <div className={styles.selectionLabel}>Health posture</div>
                <div className={styles.sideList}>
                  {Object.entries(healthChecks ?? {}).map(([key, value]) => {
                    const record = asRecord(value);
                    return (
                      <div key={key} className={styles.sideRow}>
                        <span className={styles.sideLabel}>{key}</span>
                        <StatusPill
                          label={String(record?.summary ?? "Pending")}
                          status={asStatusTone(record?.status, "info")}
                        />
                      </div>
                    );
                  })}
                </div>
              </Surface>

              <Surface className={styles.sideCard} padding="lg">
                <div className={styles.selectionLabel}>Setup context</div>
                <div className={styles.sideList}>
                  <div className={styles.sideRow}>
                    <span className={styles.sideLabel}>Workspace</span>
                    <span className={styles.metaCopy}>{String(shell?.workspace ?? "setup")}</span>
                  </div>
                  <div className={styles.sideRow}>
                    <span className={styles.sideLabel}>Hardware profile</span>
                    <span className={styles.metaCopy}>
                      {String(commissioningSnapshot?.hardwareProfile ?? "Unavailable")}
                    </span>
                  </div>
                  <div className={styles.sideRow}>
                    <span className={styles.sideLabel}>Support archive</span>
                    <span className={styles.metaCopy}>
                      {lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "No backups yet"}
                    </span>
                  </div>
                  <div className={styles.inlineActions}>
                    <Button
                      onClick={() => {
                        void performAction("support-export", exportSupportBackup);
                      }}
                      size="compact"
                      variant="secondary"
                    >
                      Export backup
                    </Button>
                    <Button onClick={() => persistMode("support")} size="compact" variant="ghost">
                      Support dashboard
                    </Button>
                  </div>
                </div>
              </Surface>
            </aside>
          </div>

          <div className={styles.footerBar}>
            <Button disabled={stepIndex <= 0} onClick={() => moveStepSelection(-1)} variant="ghost">
              Back
            </Button>
            <Button onClick={invokePrimaryAction} variant="primary" disabled={busyAction !== null}>
              {busyAction ? "Working…" : primaryActionLabel}
            </Button>
          </div>
        </div>
      ) : (
        <div className={styles.supportGrid}>
          <Surface className={styles.supportHero} padding="lg" tone="raised">
            <div className={styles.supportPrompt}>What went wrong?</div>
            <div className={styles.cardHeader}>
              <div>
                <div className={styles.sectionEyebrow}>Restore</div>
                <h2 className={styles.sectionTitle}>Backup and recovery</h2>
                <p className={styles.sectionBody}>
                  Restore from a native support archive or a legacy `db.json`, then re-probe the affected adapters
                  before resuming operator work.
                </p>
              </div>
              <StatusBadge
                label={backups.length > 0 ? `${backups.length} archives` : "empty backup history"}
                tone={backups.length > 0 ? "healthy" : "warning"}
              />
            </div>
            <div className={styles.restoreSummary}>
              <div className={styles.restoreHighlight}>
                <span className={styles.selectionLabel}>Latest backup</span>
                <strong>{lastBackup ? formatBackupTimestamp(lastBackup.modifiedAt) : "No backup exported yet"}</strong>
                <span className={styles.checkDetail}>
                  {String(
                    supportSnapshot?.restoreSummary ??
                      "Restore from a native support archive or a legacy db.json export."
                  )}
                </span>
              </div>
              <div className={styles.restoreField}>
                <label className={styles.field}>
                  <span>Restore from path</span>
                  <input
                    className={styles.textField}
                    onChange={(event) => setRestorePath(event.target.value)}
                    placeholder={String(runtimePaths?.backupDir ?? "/path/to/backup.json")}
                    value={restorePath}
                  />
                </label>
              </div>
            </div>
            <div className={styles.inlineActions}>
              <Button
                onClick={() => {
                  void performAction(
                    backups.length > 0 ? "support-export-main" : "support-export-first",
                    exportSupportBackup
                  );
                }}
                variant="primary"
              >
                {backups.length > 0 ? "Export backup" : "Export first backup"}
              </Button>
              <Button
                disabled={!lastBackup}
                onClick={() => {
                  if (!lastBackup) {
                    return;
                  }
                  void performAction("restore-latest", () => restoreBackup(lastBackup.path));
                }}
                variant="secondary"
              >
                Restore latest
              </Button>
              <Button
                disabled={!restorePath.trim()}
                onClick={() => {
                  void performAction("restore-path", () => restoreBackup(restorePath.trim()));
                }}
                variant="ghost"
              >
                Restore path
              </Button>
            </div>
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
                      {formatBackupTimestamp(backup.modifiedAt)} · {formatFileSize(backup.sizeBytes)}
                    </span>
                  </button>
                ))
              ) : (
                <div className={styles.emptyState}>
                  No backups yet. Export first backup before any destructive support work.
                </div>
              )}
            </div>
          </Surface>

          <Surface className={styles.supportCard} padding="lg">
            <div className={styles.selectionLabel}>Diagnostics</div>
            <div className={styles.checkGrid}>
              {checks.map((check) => (
                <div key={check.id} className={styles.checkCard}>
                  <div className={styles.checkHeader}>
                    <div>
                      <div className={styles.checkTitle}>{check.label}</div>
                      <div className={styles.checkDetail}>{check.detail}</div>
                    </div>
                    <StatusPill label={check.status === "ok" ? "ready" : check.status} status={check.status} />
                  </div>
                  <Button
                    onClick={() => {
                      void performAction(`support-probe-${check.id}`, () =>
                        runSingleProbe(check.id as "control-surface" | "lighting" | "audio")
                      );
                    }}
                    size="compact"
                    variant="secondary"
                  >
                    Probe
                  </Button>
                </div>
              ))}
            </div>
            <div className={styles.inlineActions}>
              <Button
                onClick={() => {
                  void performAction("export-shell-diagnostics", exportDiagnostics);
                }}
                size="compact"
                variant="secondary"
              >
                Export diagnostics
              </Button>
              <Button
                disabled={!String(runtimePaths?.logFilePath ?? "").trim()}
                onClick={() => {
                  void performAction("open-engine-log", () =>
                    openReferencePath("Engine log", String(runtimePaths?.logFilePath ?? ""))
                  );
                }}
                size="compact"
                variant="secondary"
              >
                Engine log
              </Button>
              <Button onClick={onRequestRestart} size="compact" variant="ghost">
                Restart bridge
              </Button>
            </div>
          </Surface>

          <Surface className={styles.supportCard} padding="lg">
            <div className={styles.selectionLabel}>Install & Update</div>
            <div className={styles.supportInfoList}>
              <div>
                <strong>macOS</strong>
                <span>
                  If the app is blocked, right-click the app, choose Open, then confirm once to clear Gatekeeper for
                  future launches.
                </span>
              </div>
              <div>
                <strong>Windows</strong>
                <span>If SmartScreen intervenes, choose More info, then Run anyway.</span>
              </div>
              <div>
                <strong>Update posture</strong>
                <span>
                  Keep the workstation on the packaged installer/update-repository path rather than ad hoc local
                  binaries.
                </span>
              </div>
            </div>
          </Surface>

          <Surface className={styles.supportRail} padding="lg">
            <div className={styles.selectionLabel}>Reference paths</div>
            <div className={styles.supportRailButtons}>
              <button
                className={styles.railButton}
                onClick={() => {
                  void performAction("open-archive-path", () =>
                    openReferencePath("Archive", String(supportSnapshot?.backupDir ?? runtimePaths?.backupDir ?? ""))
                  );
                }}
                type="button"
              >
                Archive
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.updateRepositoryPath ?? "").trim()}
                onClick={() => {
                  void performAction("open-update-repo", () =>
                    openReferencePath("Update repo", String(runtimePaths?.updateRepositoryPath ?? ""))
                  );
                }}
                type="button"
              >
                Update repo
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.appDataDir ?? "").trim()}
                onClick={() => {
                  void performAction("open-app-data", () =>
                    openReferencePath("App data", String(runtimePaths?.appDataDir ?? ""))
                  );
                }}
                type="button"
              >
                App data
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.logsDir ?? runtimePaths?.appDataDir ?? "").trim()}
                onClick={() => {
                  void performAction("open-diagnostics-dir", () =>
                    openReferencePath("Diagnostics", String(runtimePaths?.logsDir ?? runtimePaths?.appDataDir ?? ""))
                  );
                }}
                type="button"
              >
                Diagnostics
              </button>
              <button
                className={styles.railButton}
                disabled={!String(runtimePaths?.logsDir ?? "").trim()}
                onClick={() => {
                  void performAction("open-logs", () => openReferencePath("Logs", String(runtimePaths?.logsDir ?? "")));
                }}
                type="button"
              >
                Logs
              </button>
            </div>
          </Surface>
        </div>
      )}

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
