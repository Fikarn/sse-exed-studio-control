import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Calendar, Mic, Sliders, Sun } from "lucide-react";

import { AppShellFrame, Button } from "@sse/design-system";
import { useShellSnapshot, type ShellState } from "@sse/engine-client";
import { StagePlotPlaceholder } from "@sse/shared-graphics";

import styles from "./OperatorShell.module.css";
import { createShellEnvironment } from "./createShellEnvironment";
import { OperatorLayoutProvider, useOperatorLayout } from "./OperatorLayoutProvider";
import { OPERATOR_UI_SCALES } from "./operatorLayout";
import { buildContextSections, buildMonitorItems, isEditableTarget } from "./shellData";
import { SetupSupportPilot } from "./setup/SetupSupportPilot";
import { SetupRecoverySurface } from "./setup/SetupRecoverySurface";
import { enterStudioFullscreen, resetWindowLayout, switchToWindowedLayout } from "./shellCommands";
import { useTauriShellTestBridge } from "./tauriShellTestBridge";
import { AudioWorkspace } from "./audio/AudioWorkspace";
import { LightingWorkspaceSurface } from "./lighting/LightingWorkspace";
import { attemptLeaveCurrentWorkspace } from "./lighting/useUnsavedScenePrompt";
import { PlanningWorkspaceSurface } from "./planning/PlanningWorkspace";
import { PaletteProvider, usePalette } from "./shared/paletteContext";
import { ShellDialog } from "./shared/ShellDialog";
import { ShortcutOverlay } from "./shared/ShortcutOverlay";
import { ToastProvider } from "./shared/toastContext";
import { useLiveCallback } from "./shared/useLiveCallback";
import { RecoverySurface } from "./startup/RecoverySurface";
import { SetupStartupSurface } from "./startup/SetupStartupSurface";
import { StartupSurface } from "./startup/StartupSurface";
import { deriveShellExperience } from "./startup/startupHelpers";

type ConfirmIntent = "restart-engine" | null;

function GraphicsWorkspace({ title, subtitle, note }: { title: string; subtitle: string; note: string }) {
  return (
    <div className={styles.workspaceBody}>
      <section className={styles.primaryPanel}>
        <div className={styles.stagePlot}>
          <StagePlotPlaceholder title={title} subtitle={subtitle} />
        </div>
      </section>
      <aside className={styles.secondaryPanel}>
        <div className={styles.metaItem}>
          <div className={styles.metaLabel}>Shell direction</div>
          <div className={styles.metaValue}>{note}</div>
        </div>
      </aside>
    </div>
  );
}

export function OperatorShell() {
  // Toast portal hosts cross-workspace bottom-right notifications + the ⌘K
  // command palette. Both mount once at the shell root so every workspace
  // (and any startup/recovery surface) inherits the same stacks.
  return (
    <ToastProvider>
      <PaletteProvider>
        <OperatorLayoutProvider>
          <OperatorShellInner />
        </OperatorLayoutProvider>
      </PaletteProvider>
    </ToastProvider>
  );
}

function OperatorShellInner() {
  const environment = useMemo(() => createShellEnvironment(), []);
  const palette = usePalette();
  const { reviewSurface, setReviewSurface, setUiScale } = useOperatorLayout();
  const shellState = useShellSnapshot(environment.store);
  useTauriShellTestBridge(shellState, environment.store);
  const activeWorkspace = shellState.activeWorkspace;
  const setupModalActive = activeWorkspace === "setup";
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent>(null);
  const [showShortcutGuide, setShowShortcutGuide] = useState(false);
  const deferredLightingDmxMonitorSnapshot = useDeferredValue(shellState.lightingDmxMonitorSnapshot);
  const deferredLightingSnapshot = useDeferredValue(shellState.lightingSnapshot);
  const deferredAudioSnapshot = useDeferredValue(shellState.audioSnapshot);
  const deferredPlanningSnapshot = useDeferredValue(shellState.planningSnapshot);
  const deferredSupportSnapshot = useDeferredValue(shellState.supportSnapshot);

  const requestRestart = useLiveCallback(() => {
    setConfirmIntent("restart-engine");
  });

  const showShortcuts = useLiveCallback(() => {
    setShowShortcutGuide(true);
  });

  const performRestart = useLiveCallback(async () => {
    setConfirmIntent(null);
    await environment.store.restart();
  });

  const tryNavigateWorkspace = useLiveCallback(async (target: ShellState["activeWorkspace"]) => {
    // Same-target clicks shouldn't trigger the prompt.
    if (target === activeWorkspace) return;
    const allowed = await attemptLeaveCurrentWorkspace();
    if (!allowed) return;
    void environment.store.setWorkspace(target);
  });

  useEffect(() => {
    void environment.store.initialize();

    return () => {
      void environment.store.dispose();
    };
  }, [environment.store]);

  // Register cross-workspace ⌘K actions. Workspace-specific actions (lighting
  // recall, save changes, etc.) live in their respective workspaces and
  // register from there with `when` predicates so they only surface when the
  // workspace is active.
  useEffect(() => {
    const uiScaleActions = OPERATOR_UI_SCALES.map((scale) => ({
      id: `system:ui-scale:${scale}`,
      label: `Set UI scale to ${scale}%`,
      group: "System",
      keywords: ["ui", "scale", "density", "compact", String(scale)],
      action: () => setUiScale(scale),
    }));

    return palette.register([
      {
        id: "workspace:setup",
        label: "Switch to Setup / Support",
        group: "Workspace",
        keywords: ["setup", "support", "pilot"],
        shortcut: "⇧S",
        action: () => void tryNavigateWorkspace("setup"),
      },
      {
        id: "workspace:lighting",
        label: "Switch to Lighting",
        group: "Workspace",
        keywords: ["lighting", "lights", "rig"],
        shortcut: "⌘1",
        action: () => void tryNavigateWorkspace("lighting"),
      },
      {
        id: "workspace:audio",
        label: "Switch to Audio",
        group: "Workspace",
        keywords: ["audio", "mixer", "sound"],
        shortcut: "A",
        action: () => void tryNavigateWorkspace("audio"),
      },
      {
        id: "workspace:planning",
        label: "Switch to Planning",
        group: "Workspace",
        keywords: ["planning", "tasks", "projects"],
        shortcut: "⌘4",
        action: () => void tryNavigateWorkspace("planning"),
      },
      {
        id: "system:restart-engine",
        label: "Restart engine bridge",
        group: "System",
        keywords: ["restart", "reset", "bridge", "recover"],
        shortcut: "⌘⇧R",
        action: () => setConfirmIntent("restart-engine"),
      },
      {
        id: "system:show-shortcuts",
        label: "Show keyboard shortcuts",
        group: "System",
        keywords: ["help", "shortcuts", "keys"],
        shortcut: "?",
        action: () => setShowShortcutGuide(true),
      },
      {
        id: "system:enter-studio-fullscreen",
        label: "Enter Studio Fullscreen",
        group: "Window",
        keywords: ["studio", "fullscreen", "monitor", "window"],
        action: () => void enterStudioFullscreen(),
      },
      {
        id: "system:use-windowed-layout",
        label: "Use Windowed Layout",
        group: "Window",
        keywords: ["windowed", "layout", "resize", "monitor"],
        action: () => void switchToWindowedLayout(),
      },
      {
        id: "system:reset-window-layout",
        label: "Reset Window Layout",
        group: "Window",
        keywords: ["reset", "window", "layout", "monitor"],
        action: () => void resetWindowLayout(),
      },
      {
        id: "system:enter-studio-preview",
        label: "Studio Preview: Enter 2560x1440 Review",
        group: "Window",
        keywords: ["studio", "preview", "scaled", "review", "2560", "1440", "layout"],
        when: () => reviewSurface !== "studioPreview",
        action: () => setReviewSurface("studioPreview"),
      },
      {
        id: "system:exit-studio-preview",
        label: "Studio Preview: Exit Review",
        group: "Window",
        keywords: ["studio", "preview", "scaled", "review", "native", "layout"],
        when: () => reviewSurface === "studioPreview",
        action: () => setReviewSurface("native"),
      },
      ...uiScaleActions,
    ]);
  }, [palette, reviewSurface, setReviewSurface, setUiScale, tryNavigateWorkspace]);

  const workspaces = useMemo(
    () =>
      [
        { id: "setup", label: "Setup / Support", meta: "pilot", icon: <Sliders size={16} /> },
        { id: "lighting", label: "Lighting", meta: "primary", icon: <Sun size={16} /> },
        { id: "audio", label: "Audio", meta: "primary", icon: <Mic size={16} /> },
        { id: "planning", label: "Planning", meta: "secondary", icon: <Calendar size={16} /> },
      ] as const,
    []
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Escape") {
        if (confirmIntent) {
          setConfirmIntent(null);
          event.preventDefault();
          return;
        }

        if (showShortcutGuide) {
          setShowShortcutGuide(false);
          event.preventDefault();
        }
        return;
      }

      // ⌘K / Ctrl+K — open command palette. Active even when an editable
      // target has focus (Linear / VS Code convention) so operators can
      // jump from the toolbar search into the palette without re-focusing.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        palette.setOpen(true);
        event.preventDefault();
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key.toLowerCase() === "s") {
        if (activeWorkspace !== "setup") {
          void tryNavigateWorkspace("setup");
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        if (activeWorkspace !== "audio") {
          void tryNavigateWorkspace("audio");
          event.preventDefault();
        }
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && activeWorkspace === "planning") {
        if (event.key.toLowerCase() === "b") {
          void environment.store.updatePlanningSettings({ modeSection: "board" });
          event.preventDefault();
          return;
        }

        if (event.key.toLowerCase() === "t") {
          void environment.store.updatePlanningSettings({ modeSection: "timeline" });
          event.preventDefault();
          return;
        }
      }

      if (
        (event.key === "?" || (event.key === "/" && event.shiftKey)) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        setShowShortcutGuide((current) => !current);
        event.preventDefault();
        return;
      }

      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && ["1", "2", "3", "4"].includes(event.key)) {
        const nextWorkspace = workspaces[Number(event.key) - 1]?.id;
        if (nextWorkspace) {
          void tryNavigateWorkspace(nextWorkspace);
          event.preventDefault();
        }
        return;
      }

      if (modifier && event.shiftKey && event.key.toLowerCase() === "r") {
        setConfirmIntent("restart-engine");
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorkspace, confirmIntent, environment.store, palette, showShortcutGuide, tryNavigateWorkspace, workspaces]);

  const shellExperience = deriveShellExperience(shellState);

  if (setupModalActive && shellExperience === "startup") {
    return (
      <>
        <div className={styles.setupShell}>
          <div className={styles.setupCanvas}>
            <SetupStartupSurface appSnapshot={shellState.appSnapshot} onShowShortcuts={showShortcuts} />
          </div>
        </div>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting the engine bridge clears the current shell session and repeats the startup handshake."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
      </>
    );
  }

  if (shellExperience === "startup") {
    return (
      <>
        <StartupSurface lifecycle={shellState.lifecycle} onShowShortcuts={showShortcuts} />
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting the engine bridge clears the current shell session and repeats the startup handshake."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
      </>
    );
  }

  if (setupModalActive && shellExperience === "ready") {
    return (
      <>
        <div className={styles.setupShell}>
          <div className={styles.setupCanvas}>
            <SetupSupportPilot
              appSnapshot={shellState.appSnapshot}
              commissioningSnapshot={shellState.commissioningSnapshot}
              controlSurfaceSnapshot={shellState.controlSurfaceSnapshot}
              healthSnapshot={shellState.healthSnapshot}
              liveTransportRequested={environment.liveTransportRequested}
              onRequestRestart={requestRestart}
              onShowShortcuts={showShortcuts}
              store={environment.store}
              supportSnapshot={deferredSupportSnapshot}
            />
          </div>
        </div>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting the engine bridge closes the current shell session, re-runs protocol negotiation, and reloads commissioning/support state."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
      </>
    );
  }

  if (setupModalActive && shellExperience === "recovery") {
    return (
      <>
        <div className={styles.setupShell}>
          <div className={styles.setupCanvas}>
            <SetupRecoverySurface
              appSnapshot={shellState.appSnapshot}
              failure={shellState.startupFailure}
              healthSnapshot={shellState.healthSnapshot}
              liveTransportRequested={environment.liveTransportRequested}
              onRequestRestart={requestRestart}
              onShowShortcuts={showShortcuts}
              store={environment.store}
              supportSnapshot={deferredSupportSnapshot}
            />
          </div>
        </div>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Retry startup with the current runtime paths. If the failure persists, capture diagnostics before changing persistence or protocol state."
            confirmLabel="Retry startup"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Retry startup?"
          />
        ) : null}
      </>
    );
  }

  if (shellExperience === "recovery") {
    return (
      <>
        <RecoverySurface
          failure={shellState.startupFailure}
          healthSnapshot={shellState.healthSnapshot}
          onRequestRestart={requestRestart}
          onShowShortcuts={showShortcuts}
        />
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Retry startup with the current runtime paths. If the failure persists, capture diagnostics before changing persistence or protocol state."
            confirmLabel="Retry startup"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Retry startup?"
          />
        ) : null}
      </>
    );
  }

  const monitorItems = buildMonitorItems(shellState.healthSnapshot);
  const contextSections = buildContextSections(
    activeWorkspace,
    shellState.commissioningSnapshot,
    deferredSupportSnapshot,
    deferredLightingSnapshot
  );

  const degradedSummary =
    shellState.recovery === "degraded" &&
    !setupModalActive &&
    activeWorkspace !== "lighting" &&
    activeWorkspace !== "audio" &&
    activeWorkspace !== "planning"
      ? String(shellState.healthSnapshot?.summary ?? "Hardware or bridge attention required.")
      : null;
  const frameContextSections =
    activeWorkspace === "lighting" || activeWorkspace === "audio" || activeWorkspace === "planning"
      ? []
      : contextSections;
  const hideFrameMainHeader =
    activeWorkspace === "lighting" || activeWorkspace === "audio" || activeWorkspace === "planning";

  const body =
    activeWorkspace === "setup" ? (
      <SetupSupportPilot
        appSnapshot={shellState.appSnapshot}
        commissioningSnapshot={shellState.commissioningSnapshot}
        controlSurfaceSnapshot={shellState.controlSurfaceSnapshot}
        healthSnapshot={shellState.healthSnapshot}
        liveTransportRequested={environment.liveTransportRequested}
        onRequestRestart={requestRestart}
        onShowShortcuts={showShortcuts}
        store={environment.store}
        supportSnapshot={deferredSupportSnapshot}
      />
    ) : activeWorkspace === "lighting" ? (
      <LightingWorkspaceSurface
        appSnapshot={shellState.appSnapshot}
        lightingDmxMonitorSnapshot={deferredLightingDmxMonitorSnapshot}
        lightingSnapshot={deferredLightingSnapshot}
        store={environment.store}
      />
    ) : activeWorkspace === "audio" ? (
      <AudioWorkspace
        appSnapshot={shellState.appSnapshot}
        audioSnapshot={deferredAudioSnapshot}
        store={environment.store}
      />
    ) : activeWorkspace === "planning" ? (
      <PlanningWorkspaceSurface
        appSnapshot={shellState.appSnapshot}
        planningSnapshot={deferredPlanningSnapshot}
        store={environment.store}
      />
    ) : (
      <GraphicsWorkspace
        title="Planning workbench"
        subtitle="Secondary planning surface in a sidecar posture rather than a co-equal operator workspace."
        note="Planning migrates last and stays secondary to lighting and audio."
      />
    );

  return (
    <>
      <AppShellFrame
        activeWorkspace={activeWorkspace}
        eyebrow={environment.liveTransportRequested ? "Live transport" : `Fixture ${environment.fixtureId}`}
        hideMainHeader={hideFrameMainHeader}
        monitorItems={monitorItems}
        subtitle={
          shellState.errorSummary ?? String(shellState.appSnapshot?.summary ?? "Story-first operator shell foundation.")
        }
        title={activeWorkspace === "setup" ? "Startup, recovery, and setup posture" : "Operator console foundation"}
        workspaces={workspaces}
        contextSections={frameContextSections}
        onWorkspaceChange={(workspaceId) => {
          void tryNavigateWorkspace(workspaceId as ShellState["activeWorkspace"]);
        }}
      >
        <div className={styles.workspaceStack}>
          {degradedSummary ? (
            <div className={styles.statusBanner} role="status">
              <div>
                <div className={styles.statusBannerTitle}>Hardware attention required</div>
                <div className={styles.statusBannerBody}>{degradedSummary}</div>
              </div>
              <div className={styles.statusBannerActions}>
                <Button variant="secondary" onClick={requestRestart}>
                  Retry bridges
                </Button>
                <Button variant="ghost" onClick={showShortcuts}>
                  Shortcuts
                </Button>
              </div>
            </div>
          ) : null}
          {body}
        </div>
      </AppShellFrame>
      {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
      {confirmIntent === "restart-engine" ? (
        <ShellDialog
          body="Restarting the engine bridge closes the current shell session, re-runs protocol negotiation, and reloads commissioning/support state."
          confirmLabel="Restart bridge"
          onCancel={() => setConfirmIntent(null)}
          onConfirm={() => void performRestart()}
          title="Restart engine bridge?"
        />
      ) : null}
    </>
  );
}
