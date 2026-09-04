import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Calendar, Mic, Sliders, Sun } from "lucide-react";

import { AppShellFrame } from "@sse/design-system";
import { useShellSnapshot, type ShellState } from "@sse/engine-client";

import { formatShortcut } from "./shared/shortcutGlyphs";
import styles from "./OperatorShell.module.css";
import { createShellEnvironment } from "./createShellEnvironment";
import { OperatorLayoutProvider, useOperatorLayout } from "./OperatorLayoutProvider";
import { OPERATOR_UI_SCALES } from "./operatorLayout";
import { buildMonitorItems, isEditableTarget } from "./shellData";
import { computeLiveSceneDrift } from "./lighting/lightingDrift";
import { SetupSupportPilot } from "./setup/SetupSupportPilot";
import { SetupRecoverySurface } from "./setup/SetupRecoverySurface";
import {
  confirmShellClose,
  enterStudioFullscreen,
  onShellCloseRequested,
  resetWindowLayout,
  switchToWindowedLayout,
} from "./shellCommands";
import { useTauriShellTestBridge } from "./tauriShellTestBridge";
import { AudioWorkspace } from "./audio/AudioWorkspace";
import { LightingWorkspaceSurface } from "./lighting/LightingWorkspace";
import { attemptLeaveCurrentWorkspace } from "./lighting/useUnsavedScenePrompt";
import { PlanningWorkspaceSurface } from "./planning/PlanningWorkspace";
import { PaletteProvider, usePalette } from "./shared/paletteContext";
import { PreReadyFrame } from "./shared/PreReadyFrame";
import { ShellDialog } from "./shared/ShellDialog";
import { ShortcutOverlay } from "./shared/ShortcutOverlay";
import { ToastProvider } from "./shared/toastContext";
import { useLiveCallback } from "./shared/useLiveCallback";
import { RecoverySurface } from "./startup/RecoverySurface";
import { SetupStartupSurface } from "./startup/SetupStartupSurface";
import { StartupSurface } from "./startup/StartupSurface";
import { deriveShellExperience } from "./startup/startupHelpers";

type ConfirmIntent = "restart-engine" | "close-window" | null;

declare global {
  interface Window {
    /** Browser / fixture stand-in for the native close request (Playwright). */
    __SSE_TEST_REQUEST_CLOSE__?: () => void;
  }
}

const CLOSE_DIALOG_BODY =
  "Closing ends the console link. TotalMix keeps its current state, sACN output stops and fixtures hold their last levels, and the Stream Deck goes idle.";

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
  const deferredLightingFixtureCatalogSnapshot = useDeferredValue(shellState.lightingFixtureCatalogSnapshot);
  const deferredLightingSnapshot = useDeferredValue(shellState.lightingSnapshot);
  const deferredAudioSnapshot = useDeferredValue(shellState.audioSnapshot);
  const deferredPlanningSnapshot = useDeferredValue(shellState.planningSnapshot);
  const deferredSupportSnapshot = useDeferredValue(shellState.supportSnapshot);

  // GLO-09: latched cross-workspace state gets a persistent attention chip in
  // the monitor strip. Both flags derive from live (non-deferred) snapshots so
  // the chrome reacts immediately and survives workspace switches. These
  // hooks must stay ABOVE the shellExperience early returns (hooks order).
  const lightingSceneDrift = useMemo(
    () => computeLiveSceneDrift(shellState.lightingSnapshot, shellState.lightingFixtureCatalogSnapshot),
    [shellState.lightingSnapshot, shellState.lightingFixtureCatalogSnapshot]
  );
  const audioSolo = useMemo(
    () => (shellState.audioSnapshot?.channels ?? []).some((channel) => channel.solo),
    [shellState.audioSnapshot]
  );

  // Deterministic-capture marker: the audio snapshot hydrates on its own
  // refresh machine after bootstrap, so chrome derived from it (the GLO-09
  // solo chip) would otherwise race visual captures. The visual-review spec
  // waits for this attribute before screenshotting post-ready fixtures.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-audio-hydrated", shellState.audioSnapshot !== null);
    return () => document.documentElement.removeAttribute("data-audio-hydrated");
  }, [shellState.audioSnapshot]);

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

  // 2026-09 audit Slice 11: closing the window asks first. The native shell
  // prevents the close and raises shell://close-requested; the lighting
  // unsaved-scene guard runs before the close dialog, exactly like a
  // workspace switch. Confirming hands back to the shell, which stops the
  // engine gracefully and closes the window.
  const requestClose = useLiveCallback(async () => {
    const allowed = await attemptLeaveCurrentWorkspace();
    if (!allowed) return;
    setConfirmIntent("close-window");
  });

  const performClose = useLiveCallback(async () => {
    setConfirmIntent(null);
    await confirmShellClose();
  });

  useEffect(() => {
    const unlisten = onShellCloseRequested(() => void requestClose());
    window.__SSE_TEST_REQUEST_CLOSE__ = () => void requestClose();
    return () => {
      unlisten();
      delete window.__SSE_TEST_REQUEST_CLOSE__;
    };
  }, [requestClose]);

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
        shortcut: formatShortcut(["shift", "S"]),
        action: () => void tryNavigateWorkspace("setup"),
      },
      {
        id: "workspace:lighting",
        label: "Switch to Lighting",
        group: "Workspace",
        keywords: ["lighting", "lights", "rig"],
        shortcut: formatShortcut(["mod", "1"]),
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
        shortcut: formatShortcut(["mod", "4"]),
        action: () => void tryNavigateWorkspace("planning"),
      },
      {
        id: "system:restart-engine",
        label: "Restart engine bridge",
        group: "System",
        keywords: ["restart", "reset", "bridge", "recover"],
        shortcut: formatShortcut(["mod", "shift", "R"]),
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
      // R2-GLO-02: single-modal posture — opening the palette dismisses the
      // shortcut guide so two modal surfaces never stack.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        setShowShortcutGuide(false);
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

  // CHROME-08: pre-ready surfaces (startup / recovery / setup-recovery) have no
  // bottom footer, so the toast portal (mounted at document.body) should dock at
  // the true edge rather than reserve the health-bar offset. The toast lives
  // outside `.root`, so flag it on <html> — the one ancestor it inherits from.
  useEffect(() => {
    const preReady = shellExperience !== "ready";
    document.documentElement.toggleAttribute("data-pre-ready", preReady);
    return () => document.documentElement.removeAttribute("data-pre-ready");
  }, [shellExperience]);

  // Rendered next to the restart dialog in every shell state (startup,
  // recovery, operator) so a close request is never swallowed.
  const closeDialog =
    confirmIntent === "close-window" ? (
      <ShellDialog
        body={CLOSE_DIALOG_BODY}
        confirmLabel="Close Studio Control"
        onCancel={() => setConfirmIntent(null)}
        onConfirm={() => void performClose()}
        title="Close Studio Control?"
      />
    ) : null;

  if (setupModalActive && shellExperience === "startup") {
    return (
      <>
        <PreReadyFrame>
          <SetupStartupSurface
            appSnapshot={shellState.appSnapshot}
            lifecycle={shellState.lifecycle}
            onShowShortcuts={showShortcuts}
          />
        </PreReadyFrame>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting reconnects the app to its engine. The console link and the Stream Deck drop for a few seconds and come back on their own; TotalMix and the lights keep their current state."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
        {closeDialog}
      </>
    );
  }

  if (shellExperience === "startup") {
    return (
      <>
        <PreReadyFrame>
          <StartupSurface lifecycle={shellState.lifecycle} onShowShortcuts={showShortcuts} />
        </PreReadyFrame>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting reconnects the app to its engine. The console link and the Stream Deck drop for a few seconds and come back on their own; TotalMix and the lights keep their current state."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
        {closeDialog}
      </>
    );
  }

  if (setupModalActive && shellExperience === "ready") {
    return (
      <>
        <PreReadyFrame>
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
        </PreReadyFrame>
        {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
        {confirmIntent === "restart-engine" ? (
          <ShellDialog
            body="Restarting reconnects the app to its engine. The console link and the Stream Deck drop for a few seconds and come back on their own; TotalMix and the lights keep their current state."
            confirmLabel="Restart bridge"
            onCancel={() => setConfirmIntent(null)}
            onConfirm={() => void performRestart()}
            title="Restart engine bridge?"
          />
        ) : null}
        {closeDialog}
      </>
    );
  }

  if (setupModalActive && shellExperience === "recovery") {
    return (
      <>
        <PreReadyFrame>
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
        </PreReadyFrame>
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
        {closeDialog}
      </>
    );
  }

  if (shellExperience === "recovery") {
    return (
      <>
        <PreReadyFrame>
          <RecoverySurface
            failure={shellState.startupFailure}
            healthSnapshot={shellState.healthSnapshot}
            onRequestRestart={requestRestart}
            onShowShortcuts={showShortcuts}
          />
        </PreReadyFrame>
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
        {closeDialog}
      </>
    );
  }

  if (activeWorkspace === "setup") {
    // Unreachable: every shellExperience (startup/ready/recovery) early-returns
    // for the setup workspace above. The guard narrows the union so the frame
    // below models only the three real workspaces (GLO-07 close-out).
    return null;
  }

  const monitorItems = buildMonitorItems(shellState.healthSnapshot, { lightingSceneDrift, audioSolo });

  const body =
    activeWorkspace === "lighting" ? (
      <LightingWorkspaceSurface
        appSnapshot={shellState.appSnapshot}
        lightingFixtureCatalogSnapshot={deferredLightingFixtureCatalogSnapshot}
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
    ) : (
      <PlanningWorkspaceSurface
        appSnapshot={shellState.appSnapshot}
        planningSnapshot={deferredPlanningSnapshot}
        store={environment.store}
      />
    );

  return (
    <>
      <AppShellFrame
        activeWorkspace={activeWorkspace}
        monitorItems={monitorItems}
        workspaces={workspaces}
        onMonitorItemClick={(item) => {
          // Health chips open Setup / Support; latched chips jump to the
          // workspace that owns the latched state (same-target clicks no-op).
          const target =
            item.id === "latched:scene-drift" ? "lighting" : item.id === "latched:solo" ? "audio" : "setup";
          void tryNavigateWorkspace(target);
        }}
        onWorkspaceChange={(workspaceId) => {
          void tryNavigateWorkspace(workspaceId as ShellState["activeWorkspace"]);
        }}
      >
        <div className={styles.workspaceStack}>{body}</div>
      </AppShellFrame>
      {showShortcutGuide ? <ShortcutOverlay onClose={() => setShowShortcutGuide(false)} /> : null}
      {confirmIntent === "restart-engine" ? (
        <ShellDialog
          body="Restarting reconnects the app to its engine. The console link and the Stream Deck drop for a few seconds and come back on their own; TotalMix and the lights keep their current state."
          confirmLabel="Restart bridge"
          onCancel={() => setConfirmIntent(null)}
          onConfirm={() => void performRestart()}
          title="Restart engine bridge?"
        />
      ) : null}
      {closeDialog}
    </>
  );
}
