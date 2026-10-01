import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { AudioSnapshot, ShellStore } from "@sse/engine-client";
import { ContextMenu, ShellRegion, type ContextMenuItem } from "@sse/design-system";
import { RotateCcw, SlidersHorizontal } from "lucide-react";

import styles from "./AudioWorkspace.module.css";
import { audioSnapshotLoadKey } from "./audioArming";
import { AUDIO_ARM_TIMEOUT_MS, AUDIO_DRAFT_CLEAR_MS } from "./audioConstants";
import { useAudioArming } from "./hooks/useAudioArming";
import { useAudioOptimisticSettings, type OptimisticAudioSettings } from "./hooks/useAudioOptimisticSettings";
import { createAudioControlDraftStore } from "./audioControlDraftStore";
import { AUDIO_FADER_UNITY, type AudioFeedbackTone } from "./audioFormatting";
import { parseAudioLoadReport, type AudioLoadReport } from "./audioLoadReport";
import {
  audioChannelSupportsPhase,
  buildAudioViewModel,
  toggleChannelGroupSelection,
  type AudioChannelGroupSelectionRequest,
  type AudioChannelGroupSelections,
} from "./audioViewModel";
import { AudioCluster } from "./components/AudioCluster";
import { AudioFooter } from "./components/AudioFooter";
import { AudioInspector } from "./components/AudioInspector";
import { AudioMeterCanvasOverlay } from "./components/AudioMeterCanvasOverlay";
import { AudioSignalCanvas } from "./components/AudioSignalCanvas";
import { type SnapshotRecord } from "../shellData";
import { useLiveCallback } from "../shared/useLiveCallback";

interface AudioWorkspaceProps {
  appSnapshot: SnapshotRecord | null;
  audioSnapshot: AudioSnapshot | null;
  store: ShellStore;
}

interface AudioWorkspaceFeedback {
  message: string;
  tone: AudioFeedbackTone;
}

declare global {
  interface Window {
    __SSE_TEST_RENDER_COUNTS__?: {
      audioInspector?: number;
      audioRail?: number;
      audioSignalCanvas?: number;
      audioWorkspace?: number;
    };
  }
}

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioDynamicsUpdate = Parameters<ShellStore["updateAudioChannelDynamics"]>[0];
type AudioEqUpdate = Parameters<ShellStore["updateAudioChannelEq"]>[0];
type AudioSendModeUpdate = Parameters<ShellStore["updateAudioChannelSendMode"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];
type AudioSettingsUpdate = Parameters<ShellStore["updateAudioSettings"]>[0];

interface AudioContextMenuState {
  channelId: string;
  x: number;
  y: number;
}

const EMPTY_CHANNEL_GROUP_SELECTIONS: AudioChannelGroupSelections = {
  "hardware-inputs": [],
  "software-playback": [],
};

// Slice 8 (system §9): a write the desk did not take has one way out, and
// every message that reports one names it.
const SYNC_HINT = "Press Sync from TotalMix to pull the current state.";

export function AudioWorkspace({ appSnapshot, audioSnapshot, store }: AudioWorkspaceProps) {
  const [activeChannelGroups, setActiveChannelGroups] =
    useState<AudioChannelGroupSelections>(EMPTY_CHANNEL_GROUP_SELECTIONS);
  const [bankIndex, setBankIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AudioWorkspaceFeedback | null>(null);
  // 2026-10-01: what the last TotalMix snapshot load read back from the desk.
  const [loadReport, setLoadReport] = useState<AudioLoadReport | null>(null);
  const [contextMenu, setContextMenu] = useState<AudioContextMenuState | null>(null);
  const draftStoreRef = useRef<ReturnType<typeof createAudioControlDraftStore> | null>(null);
  if (!draftStoreRef.current) {
    draftStoreRef.current = createAudioControlDraftStore();
  }
  const draftStore = draftStoreRef.current;
  const [peakHoldEnabled, setPeakHoldEnabled] = useState(true);
  const [peakHoldResetToken, setPeakHoldResetToken] = useState(0);

  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) {
      return;
    }
    window.__SSE_TEST_RENDER_COUNTS__.audioWorkspace = (window.__SSE_TEST_RENDER_COUNTS__.audioWorkspace ?? 0) + 1;
  });

  const { audioSnapshotForView, applyOptimistic, clearOptimistic } = useAudioOptimisticSettings(audioSnapshot);

  const viewModel = useMemo(() => {
    if (!audioSnapshotForView) return null;
    return buildAudioViewModel({
      activeChannelGroups,
      appSnapshot,
      audioSnapshot: audioSnapshotForView,
      bankIndex,
    });
  }, [activeChannelGroups, appSnapshot, audioSnapshotForView, bankIndex]);

  // The slot TotalMix holds (active, or changed since its load), 2026-10-01: a
  // load from anywhere else moves it, and an arm made against the old mix is
  // dropped.
  const loadedSnapshotSlot =
    viewModel?.consoleSnapshots.find((entry) => entry.state === "active" || entry.state === "changed")?.slot ?? null;
  // The arm hook also owns the Esc that cancels an arm (new pages program,
  // Slice 3); the Console binds no other key.
  const { armedAction, armOrApplyAction, clearArmedAction } = useAudioArming({
    setFeedback,
    resetTriggers: {
      loadedSnapshotSlot,
      selectedChannelId: viewModel?.selectedChannelId,
      selectedMixTargetId: viewModel?.selectedMixTargetId,
    },
  });

  useEffect(() => {
    if (!viewModel || bankIndex === viewModel.clampedBankIndex) {
      return;
    }
    setBankIndex(viewModel.clampedBankIndex);
  }, [bankIndex, viewModel]);

  useEffect(() => {
    return () => {
      draftStore.dispose();
    };
  }, [draftStore]);

  const performAction = useLiveCallback(async (actionId: string, runner: () => Promise<void>) => {
    setBusyAction(actionId);
    clearArmedAction();
    setFeedback(null);
    try {
      await runner();
    } catch (error) {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "The action could not be completed. Try it again, or press Sync from TotalMix to see the desk's current state.",
        tone: "error",
      });
    } finally {
      setBusyAction(null);
    }
  });

  const getDraftValue = useLiveCallback((key: string, fallback: number) => draftStore.get(key) ?? fallback);

  const setDraftValue = useLiveCallback((key: string, value: number) => {
    draftStore.set(key, value);
  });

  const clearDraftValueLater = useLiveCallback((key: string, delayMs: number = AUDIO_DRAFT_CLEAR_MS) => {
    draftStore.clearLater(key, delayMs);
  });

  const resetChannelFaderToUnity = useLiveCallback((channelId: string, mixTargetId: string | null | undefined) => {
    if (!mixTargetId) return;
    const draftKey = `channel:${channelId}:send:${mixTargetId}`;
    setDraftValue(draftKey, AUDIO_FADER_UNITY);
    updateChannel({
      channelId,
      fader: AUDIO_FADER_UNITY,
      mixTargetId,
    });
    clearDraftValueLater(draftKey);
  });

  const updateAudioSettings = useLiveCallback((request: AudioSettingsUpdate, optimistic: OptimisticAudioSettings) => {
    applyOptimistic(optimistic);
    void store.updateAudioSettings(request).catch((error) => {
      clearOptimistic();
      setFeedback({
        message:
          error instanceof Error ? error.message : "The selection could not be saved. Click the strip or output again.",
        tone: "error",
      });
    });
  });

  const syncAudio = useLiveCallback(() => {
    void performAction("audio-sync", async () => {
      await store.syncAudio();
    });
  });

  // Why (2026-09 audit remediation, Slice 1): while the audio probe has not
  // passed, every console write is refused, so the workspace offers the probe
  // itself as the recovery action. The transport values come from the engine
  // snapshot so the probe targets the commissioned ports, never a guess.
  const runAudioProbe = useLiveCallback(() => {
    if (!audioSnapshot) return;
    void performAction("audio-probe", async () => {
      await store.runCommissioningCheck({
        receivePort: audioSnapshot.receivePort,
        sendHost: audioSnapshot.sendHost,
        sendPort: audioSnapshot.sendPort,
        target: "audio",
      });
    });
  });

  const openSetup = useLiveCallback(() => {
    void performAction("audio-open-setup", async () => {
      await store.setWorkspace("setup");
    });
  });

  // 2026-10-01: the Console's snapshots are TotalMix's own. The first press
  // arms; the second, after the dwell and inside the window, has TotalMix load
  // the slot, and the store reads the console back as Sync does.
  const loadSnapshot = useLiveCallback((slot: number) => {
    const slotName = viewModel?.consoleSnapshots.find((entry) => entry.slot === slot)?.name ?? `Slot ${slot}`;
    armOrApplyAction(
      {
        key: audioSnapshotLoadKey(slot),
        // The panel's heading says "in TotalMix"; the row keeps room for
        // "press again to apply".
        label: `Load ${slotName}`,
        targetId: String(slot),
        targetKind: "snapshot-load",
        timeoutMs: AUDIO_ARM_TIMEOUT_MS,
      },
      () => {
        void performAction(`audio-snapshot-load-${slot}`, async () => {
          const result = await store.loadAudioSnapshot(slot);
          setLoadReport(parseAudioLoadReport(result));
        });
      }
    );
  });

  const dismissLoadReport = useLiveCallback(() => {
    setLoadReport(null);
  });

  const selectChannel = useLiveCallback((channelId: string | null) => {
    setContextMenu(null);
    updateAudioSettings({ selectedChannelId: channelId }, { selectedChannelId: channelId });
  });

  const selectMixTarget = useLiveCallback((mixTargetId: string) => {
    updateAudioSettings({ selectedMixTargetId: mixTargetId }, { selectedMixTargetId: mixTargetId });
  });

  const selectOutputMixTarget = useLiveCallback((mixTargetId: string) => {
    setContextMenu(null);
    updateAudioSettings(
      { selectedChannelId: null, selectedMixTargetId: mixTargetId },
      { selectedChannelId: null, selectedMixTargetId: mixTargetId }
    );
  });

  // New pages program, Slice 3 (decision 10): a plain click switches a chip on
  // or off, and several chips can be lit at once (Shift+click and Alt+click
  // went with the other keys held while pointing). Only the clicked chip
  // changes; a lit chip whose strips are on another bank stays lit.
  const selectChannelGroup = useLiveCallback((request: AudioChannelGroupSelectionRequest) => {
    setActiveChannelGroups((current) => toggleChannelGroupSelection(current, request));
    setBankIndex(0);
  });

  const updateChannel = useLiveCallback((request: AudioChannelUpdate) => {
    void performAction(`audio-channel-${request.channelId}`, async () => {
      await store.updateAudioChannel(request);
    });
  });

  const togglePhantom = useLiveCallback(
    ({ channelId, channelName, phantom }: { channelId: string; channelName: string; phantom: boolean }) => {
      armOrApplyAction(
        {
          key: `phantom:${channelId}:${phantom}`,
          label: `${phantom ? "Enable" : "Disable"} 48 V on ${channelName}`,
          targetId: channelId,
          targetKind: "phantom",
          timeoutMs: AUDIO_ARM_TIMEOUT_MS,
        },
        () => updateChannel({ channelId, phantom })
      );
    }
  );

  const updateChannelEq = useLiveCallback((request: AudioEqUpdate) => {
    void performAction(`audio-channel-eq-${request.channelId}`, async () => {
      await store.updateAudioChannelEq(request);
    });
  });

  const commitChannelEqContinuous = useLiveCallback((request: AudioEqUpdate) => {
    void store.updateAudioChannelEq(request).catch((error) => {
      setFeedback({
        message: error instanceof Error ? error.message : `The EQ control could not be changed. ${SYNC_HINT}`,
        tone: "error",
      });
    });
  });

  const updateChannelDynamics = useLiveCallback((request: AudioDynamicsUpdate) => {
    void performAction(`audio-channel-dynamics-${request.channelId}`, async () => {
      await store.updateAudioChannelDynamics(request);
    });
  });

  const updateChannelSendMode = useLiveCallback((request: AudioSendModeUpdate) => {
    void performAction(`audio-channel-send-${request.channelId}-${request.mixTargetId}`, async () => {
      await store.updateAudioChannelSendMode(request);
    });
  });

  const updateMixTarget = useLiveCallback((request: AudioMixTargetUpdate) => {
    void performAction(`audio-output-${request.mixTargetId}`, async () => {
      await store.updateAudioMixTarget(request);
    });
  });

  const clearAllSolo = useLiveCallback(() => {
    void performAction("audio-clear-all-solo", async () => {
      await store.clearAllAudioSolo();
    });
  });

  const clearClips = useLiveCallback((channelId?: string) => {
    void performAction(channelId ? `audio-clear-clip-${channelId}` : "audio-clear-clips", async () => {
      await store.clearAudioClips(channelId ? { channelId } : {});
    });
  });

  const togglePeakHold = useLiveCallback(() => {
    setPeakHoldEnabled((current) => !current);
    setPeakHoldResetToken((current) => current + 1);
  });

  const resetPeakHolds = useLiveCallback(() => {
    setPeakHoldResetToken((current) => current + 1);
  });

  const commitChannelContinuous = useLiveCallback((request: AudioChannelUpdate) => {
    void store.updateAudioChannel(request).catch((error) => {
      setFeedback({
        message: error instanceof Error ? error.message : `The control could not be changed. ${SYNC_HINT}`,
        tone: "error",
      });
    });
  });

  const commitMixTargetContinuous = useLiveCallback((request: AudioMixTargetUpdate) => {
    void store.updateAudioMixTarget(request).catch((error) => {
      setFeedback({
        message: error instanceof Error ? error.message : `The output could not be changed. ${SYNC_HINT}`,
        tone: "error",
      });
    });
  });

  const openChannelContextMenu = useLiveCallback((event: ReactMouseEvent<HTMLElement>, channelId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ channelId, x: event.clientX, y: event.clientY });
  });

  // New pages program, Slice 3 (decision 3): the Inputs heading's ‹ › keys
  // page both rows, as `[` and `]` did. Without them Line 1–8 (banks 2–3 at
  // 2560) could not be reached on screen at all.
  const previousBank = useLiveCallback(() => {
    setBankIndex((current) => Math.max(0, current - 1));
  });

  const nextBank = useLiveCallback(() => {
    const maxBankIndex = Math.max(0, (viewModel?.totalBanks ?? 1) - 1);
    setBankIndex((current) => Math.min(maxBankIndex, current + 1));
  });

  const contextMenuChannel = viewModel?.channels.find((entry) => entry.id === contextMenu?.channelId) ?? null;
  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenuChannel || !viewModel) return [];
    const canMutate = viewModel.actionsAllowed;
    return [
      {
        disabled: !canMutate,
        icon: RotateCcw,
        id: "reset-unity",
        label: "Reset to unity",
        onSelect: () => resetChannelFaderToUnity(contextMenuChannel.id, viewModel.selectedMixTargetId),
      },
      {
        disabled: !canMutate || !audioChannelSupportsPhase(contextMenuChannel),
        icon: SlidersHorizontal,
        id: "flip-polarity",
        label: contextMenuChannel.phase ? "Restore polarity" : "Flip polarity",
        onSelect: () => updateChannel({ channelId: contextMenuChannel.id, phase: !contextMenuChannel.phase }),
      },
      // No Rename (2026-10-01): the channels take TotalMix's names, and a
      // channel is renamed in TotalMix.
    ];
  }, [contextMenuChannel, resetChannelFaderToUnity, updateChannel, viewModel]);

  if (!viewModel) {
    return (
      <div className={styles.audioShell} data-testid="audio-workspace-loading">
        <section className={styles.loadingPanel} data-material="plate" data-level="float">
          <span className={styles.eyebrow}>Audio</span>
          <h1>Loading the console…</h1>
          <div className={styles.loadingGrid}>
            {Array.from({ length: 16 }, (_, index) => (
              <span key={`audio-loading-${index}`} />
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className={styles.audioShell}
      data-canvas-metering={viewModel.meterSimulationState === "gated" ? "false" : "true"}
      data-meter-simulation-state={viewModel.meterSimulationState}
      data-output-role={viewModel.selectedMixTarget?.role ?? "main-out"}
      data-testid="audio-workspace"
      data-view-mode={viewModel.viewMode}
    >
      {feedback ? (
        <div className={styles.feedbackBanner} data-tone={feedback.tone} role="status">
          {feedback.message}
        </div>
      ) : null}

      <ShellRegion region="cluster">
        <AudioCluster
          armedAction={armedAction}
          busyAction={busyAction}
          clearDraftValueLater={clearDraftValueLater}
          commitMixTargetContinuous={commitMixTargetContinuous}
          draftStore={draftStore}
          getDraftValue={getDraftValue}
          onClearAllSolo={clearAllSolo}
          onClearClips={clearClips}
          onLoadSnapshot={loadSnapshot}
          onOpenSetup={openSetup}
          onRunAudioProbe={runAudioProbe}
          onSelectMixTarget={selectMixTarget}
          onSync={syncAudio}
          onUpdateMixTarget={updateMixTarget}
          setDraftValue={setDraftValue}
          viewModel={viewModel}
        />
      </ShellRegion>

      <ShellRegion region="footer">
        <AudioFooter viewModel={viewModel} />
      </ShellRegion>

      <div className={styles.audioBody}>
        <AudioSignalCanvas
          armedAction={armedAction}
          clearDraftValueLater={clearDraftValueLater}
          commitChannelContinuous={commitChannelContinuous}
          commitMixTargetContinuous={commitMixTargetContinuous}
          draftStore={draftStore}
          getDraftValue={getDraftValue}
          onClearClips={clearClips}
          onNextBank={nextBank}
          onOpenChannelMenu={openChannelContextMenu}
          onPreviousBank={previousBank}
          loadReport={loadReport}
          onDismissLoadReport={dismissLoadReport}
          onSelectChannel={selectChannel}
          onSelectChannelGroup={selectChannelGroup}
          onSelectMixTarget={selectMixTarget}
          onSelectOutputMixTarget={selectOutputMixTarget}
          onTogglePhantom={togglePhantom}
          setDraftValue={setDraftValue}
          onUpdateChannel={updateChannel}
          onUpdateMixTarget={updateMixTarget}
          store={store}
          viewModel={viewModel}
        />
        <AudioInspector
          armedActionKey={armedAction?.key ?? null}
          clearDraftValueLater={clearDraftValueLater}
          commitChannelContinuous={commitChannelContinuous}
          commitChannelEqContinuous={commitChannelEqContinuous}
          commitMixTargetContinuous={commitMixTargetContinuous}
          draftStore={draftStore}
          getDraftValue={getDraftValue}
          onResetPeakHolds={resetPeakHolds}
          onSelectMixTarget={selectMixTarget}
          onTogglePeakHold={togglePeakHold}
          setDraftValue={setDraftValue}
          onUpdateChannelDynamics={updateChannelDynamics}
          onUpdateChannelEq={updateChannelEq}
          onUpdateChannelSendMode={updateChannelSendMode}
          onTogglePhantom={togglePhantom}
          onUpdateChannel={updateChannel}
          onUpdateMixTarget={updateMixTarget}
          peakHoldEnabled={peakHoldEnabled}
          peakHoldResetToken={peakHoldResetToken}
          store={store}
          viewModel={viewModel}
        />
      </div>

      <AudioMeterCanvasOverlay
        peakHoldEnabled={peakHoldEnabled}
        peakHoldResetToken={peakHoldResetToken}
        store={store}
      />

      {contextMenu && contextMenuItems.length > 0 ? (
        <ContextMenu
          ariaLabel={contextMenuChannel ? `${contextMenuChannel.name} actions` : "Audio channel actions"}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      ) : null}
    </div>
  );
}
