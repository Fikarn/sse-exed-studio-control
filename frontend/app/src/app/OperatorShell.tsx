import { Suspense, useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Mic, Sliders, Sun } from "lucide-react";

import { AppShellFrame } from "@sse/design-system";
import { useShellSnapshot, type ShellState } from "@sse/engine-client";

import styles from "./OperatorShell.module.css";
import { createShellEnvironment } from "./createShellEnvironment";
import { OperatorLayoutProvider } from "./OperatorLayoutProvider";
import { asRecord, buildMonitorItems, deriveLightingWorkspaceTone } from "./shellData";
import { describeAudioStatus } from "./audio/audioFormatting";
import { computeLiveSceneDrift } from "./lighting/lightingDrift";
import { SetupRecoverySurface } from "./setup/SetupRecoverySurface";
import { confirmShellClose, onShellCloseRequested } from "./shellCommands";
import { useTauriShellTestBridge } from "./tauriShellTestBridge";
import { attemptLeaveCurrentWorkspace } from "./lighting/useUnsavedScenePrompt";
import { BackgroundFailureBand } from "./shared/BackgroundFailureBand";
import { ShellDialog } from "./shared/ShellDialog";
import { ToastProvider } from "./shared/toastContext";
import { useLiveCallback } from "./shared/useLiveCallback";
import { RecoverySurface } from "./startup/RecoverySurface";
import { reportUiFailure } from "./startup/reportUiFailure";
import { SetupStartupSurface } from "./startup/SetupStartupSurface";
import { StartupSurface } from "./startup/StartupSurface";
import { deriveShellExperience } from "./startup/startupHelpers";
import { WorkspaceCrashProbe } from "./startup/WorkspaceCrashProbe";
import { WorkspaceErrorBoundary } from "./startup/WorkspaceErrorBoundary";
import { WorkspaceLoadingSurface } from "./startup/WorkspaceLoadingSurface";
import { preloadWorkspace, whenIdle, workspaceChunks, WORKSPACE_IDS } from "./workspaceChunks";

type ConfirmIntent = "restart-engine" | "close-window" | null;

declare global {
  interface Window {
    /** Browser / fixture stand-in for the native close request (Playwright). */
    __SSE_TEST_REQUEST_CLOSE__?: () => void;
  }
}

const CLOSE_DIALOG_BODY =
  "Closing ends Studio Control's link to the desk, the rig and the deck. TotalMix keeps its current state, sACN output stops and fixtures hold their last levels, and the Stream Deck goes idle.";

export type ShellEnvironment = ReturnType<typeof createShellEnvironment>;

// New pages program, Slice 3 (D4, D6): the header tabs are the way between the
// workspaces. They print no key hint — Studio Control binds no key of its own.
const WORKSPACES = [
  { id: "setup", label: "Setup / Support", meta: "pilot", icon: <Sliders size={16} /> },
  { id: "lighting", label: "Lighting", meta: "primary", icon: <Sun size={16} /> },
  { id: "audio", label: "Audio", meta: "primary", icon: <Mic size={16} /> },
] as const;

export function OperatorShell({ environment }: { environment?: ShellEnvironment }) {
  // The toast portal hosts cross-workspace bottom-right notifications. It
  // mounts once at the shell root so every workspace (and any startup /
  // recovery surface) inherits the same stack. New pages program, Slice 3
  // (D6): the palette that mounted beside it is gone.
  return (
    <ToastProvider>
      <OperatorLayoutProvider>
        <OperatorShellInner environment={environment} />
      </OperatorLayoutProvider>
    </ToastProvider>
  );
}

function OperatorShellInner({ environment: providedEnvironment }: { environment?: ShellEnvironment }) {
  // 2026-09 production readiness, Slice 5: `main.tsx` creates the environment
  // so it can forward uncaught window errors to the store; tests and stories
  // render the shell without one.
  const environment = useMemo(() => providedEnvironment ?? createShellEnvironment(), [providedEnvironment]);
  const shellState = useShellSnapshot(environment.store);
  useTauriShellTestBridge(shellState, environment.store);
  const activeWorkspace = shellState.activeWorkspace;
  const setupModalActive = activeWorkspace === "setup";
  const [confirmIntent, setConfirmIntent] = useState<ConfirmIntent>(null);
  // Slice 9 (F10): advanced by "Reload this area"; with the area's name it is
  // the workspace boundary's key.
  const [areaReloads, setAreaReloads] = useState(0);
  const deferredLightingDmxMonitorSnapshot = useDeferredValue(shellState.lightingDmxMonitorSnapshot);
  const deferredLightingFixtureCatalogSnapshot = useDeferredValue(shellState.lightingFixtureCatalogSnapshot);
  const deferredLightingSnapshot = useDeferredValue(shellState.lightingSnapshot);
  const deferredAudioSnapshot = useDeferredValue(shellState.audioSnapshot);
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

  // Visual overhaul A, Slice 2: the header clock (HH:MM, the studio's local
  // time), and the workspace states the lamps mirror (plan D1, finding C3).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const clock = useMemo(
    () => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now),
    [now]
  );
  const audioStatus = useMemo(() => describeAudioStatus(shellState.audioSnapshot), [shellState.audioSnapshot]);
  const workspaceTones = useMemo(
    () => ({
      audio: shellState.audioSnapshot ? { tone: audioStatus.tone, word: audioStatus.label.toLowerCase() } : null,
      lighting: deriveLightingWorkspaceTone(shellState.lightingSnapshot, lightingSceneDrift),
    }),
    [audioStatus, lightingSceneDrift, shellState.audioSnapshot, shellState.lightingSnapshot]
  );

  const requestRestart = useLiveCallback(() => {
    setConfirmIntent("restart-engine");
  });

  // Esc closes the shell's dialogs wherever focus is (ShellDialog listens on
  // the window while it is up); Cancel does the same.
  const cancelConfirm = useLiveCallback(() => {
    setConfirmIntent(null);
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

  // New pages program, Slice 3 (D6): the shell binds no key of its own. The
  // palette, its registrations and the window key handler (the workspace keys,
  // the palette and guide keys, the restart key) are gone; every one of them
  // had an on-screen twin at 2560 — the header tabs, the theme, the UI scale
  // and "Restart the hardware link…" on Setup / Support's plate, "Retry
  // startup" — and the window commands are keys in Workstation, under the
  // Support screen below 2200 px (where the Workstation plate is hidden) and on
  // the recovery screens. Below 2200 px the plate's other keys are not on
  // screen; Studio fullscreen brings them back. Escape still closes the
  // shell's dialogs (ShellDialog).

  const shellExperience = deriveShellExperience(shellState);

  // Slice 14 (F26): the workspaces are chunks of their own. This effect runs
  // after the shell has drawn, so the startup surface is on screen before any
  // workspace's code is fetched; the hardware link takes longer to start than
  // a chunk takes to arrive, so the active workspace is in hand at `ready`.
  useEffect(() => {
    void preloadWorkspace(activeWorkspace);
  }, [activeWorkspace]);
  // The other two follow once the shell is ready and idle: a workspace whose
  // chunk is in hand mounts in the commit that asks for it, with no loading
  // surface in between.
  useEffect(() => {
    if (shellExperience !== "ready") return undefined;
    return whenIdle(() => {
      for (const workspaceId of WORKSPACE_IDS) void preloadWorkspace(workspaceId);
    });
  }, [shellExperience]);

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
        onCancel={cancelConfirm}
        onConfirm={() => void performClose()}
        title="Close Studio Control?"
      />
    ) : null;

  const restartDialog =
    confirmIntent === "restart-engine" ? (
      shellExperience === "recovery" ? (
        <ShellDialog
          body="Retry startup with the paths Studio Control is set to use. If it fails again, export diagnostics before you change any saved data or connection settings."
          confirmLabel="Retry startup"
          onCancel={cancelConfirm}
          onConfirm={() => void performRestart()}
          title="Retry startup?"
        />
      ) : (
        <ShellDialog
          body="Restarting reconnects Studio Control to the desk, the rig and the deck. The hardware link and the Stream Deck drop for a few seconds and come back on their own; TotalMix and the lights keep their current state."
          confirmLabel="Restart the hardware link"
          onCancel={cancelConfirm}
          onConfirm={() => void performRestart()}
          title="Restart the hardware link?"
        />
      )
    ) : null;

  // Visual overhaul A, Slice 2 (plan D1): one shell on every surface. Before
  // the engine is ready there is nowhere to go, so every tab is locked; once
  // ready, the operator workspaces stay locked until commissioning has
  // published (the engine's startup target says "dashboard"), and Setup is
  // a workspace with the same header, lamps and latches as the others.
  const operatorModeUnlocked =
    String(asRecord(shellState.appSnapshot?.startup)?.targetSurface ?? "commissioning") === "dashboard";
  const tabsDisabled = shellExperience !== "ready";
  const disabledWorkspaces = !tabsDisabled && !operatorModeUnlocked ? ["lighting", "audio"] : [];
  const monitorItems = buildMonitorItems(
    shellState.healthSnapshot,
    { lightingSceneDrift, audioSolo },
    shellExperience === "ready" ? workspaceTones : undefined
  );

  // Visual overhaul A: a workspace fills the shell's cluster, plate and
  // footer regions once it has moved onto the cluster rule. The Console did in
  // Slice 4, Lighting in Slice 5 and Setup in Slice 7.
  // The pre-ready surfaces render their own frame (they are not workspaces).
  const workspaceRegions =
    shellExperience === "ready" &&
    (activeWorkspace === "audio" || activeWorkspace === "lighting" || activeWorkspace === "setup")
      ? ("slot" as const)
      : undefined;

  // What the workspace boundary calls the area it wraps (Slice 9).
  const areaLabel =
    shellExperience === "ready"
      ? (WORKSPACES.find((workspace) => workspace.id === activeWorkspace)?.label ?? "This area")
      : shellExperience === "recovery"
        ? "Recovery"
        : "Startup";

  const SetupSurface = workspaceChunks.setup.Surface;
  const LightingSurface = workspaceChunks.lighting.Surface;
  const AudioSurface = workspaceChunks.audio.Surface;

  let surface: ReactNode;
  if (setupModalActive && shellExperience === "startup") {
    surface = <SetupStartupSurface appSnapshot={shellState.appSnapshot} lifecycle={shellState.lifecycle} />;
  } else if (shellExperience === "startup") {
    surface = <StartupSurface lifecycle={shellState.lifecycle} />;
  } else if (setupModalActive && shellExperience === "ready") {
    surface = (
      <SetupSurface
        appSnapshot={shellState.appSnapshot}
        commissioningSnapshot={shellState.commissioningSnapshot}
        controlSurfaceSnapshot={shellState.controlSurfaceSnapshot}
        healthSnapshot={shellState.healthSnapshot}
        lightOutputsArmed={shellState.lightingSnapshot ? shellState.lightingSnapshot.outputArmed !== false : null}
        liveTransportRequested={environment.liveTransportRequested}
        onRequestRestart={requestRestart}
        store={environment.store}
        supportSnapshot={deferredSupportSnapshot}
      />
    );
  } else if (setupModalActive && shellExperience === "recovery") {
    surface = (
      <SetupRecoverySurface
        appSnapshot={shellState.appSnapshot}
        failure={shellState.startupFailure}
        healthSnapshot={shellState.healthSnapshot}
        liveTransportRequested={environment.liveTransportRequested}
        onRequestRestart={requestRestart}
        store={environment.store}
        supportSnapshot={deferredSupportSnapshot}
      />
    );
  } else if (shellExperience === "recovery") {
    surface = (
      <RecoverySurface
        failure={shellState.startupFailure}
        healthSnapshot={shellState.healthSnapshot}
        onRequestRestart={requestRestart}
      />
    );
  } else if (activeWorkspace === "lighting") {
    surface = (
      <LightingSurface
        appSnapshot={shellState.appSnapshot}
        lightingFixtureCatalogSnapshot={deferredLightingFixtureCatalogSnapshot}
        lightingDmxMonitorSnapshot={deferredLightingDmxMonitorSnapshot}
        lightingSnapshot={deferredLightingSnapshot}
        store={environment.store}
      />
    );
  } else {
    // The Console. Setup is drawn above in every shell state and Lighting just
    // above, so Audio is the one workspace left to reach this branch (new pages
    // program, D1: a page saved while Planning was open reads as the
    // Console).
    surface = (
      <AudioSurface
        appSnapshot={shellState.appSnapshot}
        audioSnapshot={deferredAudioSnapshot}
        store={environment.store}
      />
    );
  }

  return (
    <>
      <AppShellFrame
        activeWorkspace={activeWorkspace}
        clock={clock}
        cluster={workspaceRegions}
        footer={workspaceRegions}
        disabledWorkspaces={disabledWorkspaces}
        monitorItems={monitorItems}
        tabsDisabled={tabsDisabled}
        workspaces={WORKSPACES}
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
        <div className={styles.workspaceStack}>
          {/* Slice 9 (F10). The band is absent while nothing has failed, and the
              boundary adds no element of its own, so the surface is still the
              stack's only child on every board. The pre-ready surfaces sit
              inside the same boundary: a recovery surface that fails to draw
              must not take the header, the restart dialog and the close dialog
              with it. */}
          {shellExperience === "ready" ? <BackgroundFailureBand failures={shellState.backgroundFailures} /> : null}
          <WorkspaceErrorBoundary
            key={`${shellExperience}:${activeWorkspace}:${areaReloads}`}
            area={areaLabel}
            onError={(error) => reportUiFailure(environment.store, error, `${areaLabel} stopped drawing`)}
            onReset={() => setAreaReloads((count) => count + 1)}
          >
            {shellExperience === "ready" && environment.crashWorkspace === activeWorkspace ? (
              <WorkspaceCrashProbe area={areaLabel} />
            ) : null}
            <Suspense fallback={<WorkspaceLoadingSurface area={areaLabel} />}>{surface}</Suspense>
          </WorkspaceErrorBoundary>
        </div>
      </AppShellFrame>
      {restartDialog}
      {closeDialog}
    </>
  );
}
