import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { AudioSnapshot, ShellStore } from "@sse/engine-client";
import { ConfirmDialog, ContextMenu, ShellRegion, type ContextMenuItem } from "@sse/design-system";
import { Pencil, RotateCcw, SlidersHorizontal } from "lucide-react";

import styles from "./AudioWorkspace.module.css";
import { AUDIO_ARM_TIMEOUT_MS, AUDIO_DRAFT_CLEAR_MS, AUDIO_RECALL_PULSE_MS } from "./audioConstants";
import { useAudioArming } from "./hooks/useAudioArming";
import { useAudioOptimisticSettings, type OptimisticAudioSettings } from "./hooks/useAudioOptimisticSettings";
import { createAudioControlDraftStore } from "./audioControlDraftStore";
import { AUDIO_FADER_UNITY, type AudioFeedbackTone } from "./audioFormatting";
import { parseAudioRecallReport, type AudioRecallReport } from "./audioRecallReport";
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
import { AudioTextDialog } from "./components/AudioTextDialog";
import { useOperatorLayout } from "../OperatorLayoutProvider";
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
type AudioTalkbackHold = Parameters<ShellStore["holdAudioTalkback"]>[0];
type AudioSettingsUpdate = Parameters<ShellStore["updateAudioSettings"]>[0];

interface AudioContextMenuState {
  channelId: string;
  x: number;
  y: number;
}

interface AudioTextDialogState {
  currentName: string;
  id: string;
  kind: "channel" | "snapshot";
}

interface AudioDeleteSnapshotState {
  id: string;
  name: string;
}

const EMPTY_CHANNEL_GROUP_SELECTIONS: AudioChannelGroupSelections = {
  "hardware-inputs": [],
  "software-playback": [],
};

// Console redesign themes (Studio / Graphite / Bone) — applied via the
// `data-audio-theme` attribute on the shell; CSS in AudioWorkspace.module.css
// overrides Audio's private token family per theme. Slice 3c: the active theme
// is now driven by the GLOBAL theme (OperatorLayoutProvider / `data-theme` on
// <html>) instead of an audio-local state + storage, so flipping the theme
// anywhere carries the mixer along — the dark-chrome/light-mixer seam is closed.
export type AudioTheme = "studio" | "graphite" | "bone";

// Slice 8 (system §9): a write the desk did not take has one way out, and
// every message that reports one names it.
const SYNC_HINT = "Press Sync from TotalMix to pull the current state.";

export function AudioWorkspace({ appSnapshot, audioSnapshot, store }: AudioWorkspaceProps) {
  const [activeChannelGroups, setActiveChannelGroups] =
    useState<AudioChannelGroupSelections>(EMPTY_CHANNEL_GROUP_SELECTIONS);
  const [bankIndex, setBankIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AudioWorkspaceFeedback | null>(null);
  // 2026-09 audit remediation, Slice 4: what the last recall pushed and what
  // the console confirmed, incl. the 48V differences that need arming.
  const [recallReport, setRecallReport] = useState<AudioRecallReport | null>(null);
  const [recentlyRecalledSnapshotId, setRecentlyRecalledSnapshotId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<AudioContextMenuState | null>(null);
  const draftStoreRef = useRef<ReturnType<typeof createAudioControlDraftStore> | null>(null);
  if (!draftStoreRef.current) {
    draftStoreRef.current = createAudioControlDraftStore();
  }
  const draftStore = draftStoreRef.current;
  const [textDialog, setTextDialog] = useState<AudioTextDialogState | null>(null);
  const [deleteSnapshotDialog, setDeleteSnapshotDialog] = useState<AudioDeleteSnapshotState | null>(null);
  const [peakHoldEnabled, setPeakHoldEnabled] = useState(true);
  const [peakHoldResetToken, setPeakHoldResetToken] = useState(0);
  // Slice 3c — follow the global theme rather than an audio-local state, so the
  // mixer re-themes in lockstep with the chrome (seam closed). The switcher in
  // AudioTopBar drives the same global setter.
  const { theme: audioTheme } = useOperatorLayout();
  const recallPulseTimerRef = useRef<number | null>(null);

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

  // The arm hook also owns the Esc that cancels an arm (new pages program,
  // Slice 3); the Console binds no other key.
  const { armedAction, armOrApplyAction, clearArmedAction } = useAudioArming({
    setFeedback,
    resetTriggers: {
      lastRecalledSnapshotId: audioSnapshot?.lastRecalledSnapshotId,
      lastSnapshotRecallAt: audioSnapshot?.lastSnapshotRecallAt,
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
    const recalledSnapshotId =
      typeof audioSnapshot?.lastRecalledSnapshotId === "string" ? audioSnapshot.lastRecalledSnapshotId : null;

    if (!recalledSnapshotId || !audioSnapshot?.lastSnapshotRecallAt) {
      return;
    }

    setRecentlyRecalledSnapshotId(recalledSnapshotId);
    if (recallPulseTimerRef.current !== null) {
      window.clearTimeout(recallPulseTimerRef.current);
    }
    recallPulseTimerRef.current = window.setTimeout(() => {
      setRecentlyRecalledSnapshotId(null);
      recallPulseTimerRef.current = null;
    }, AUDIO_RECALL_PULSE_MS);
  }, [audioSnapshot?.lastRecalledSnapshotId, audioSnapshot?.lastSnapshotRecallAt]);

  useEffect(() => {
    return () => {
      if (recallPulseTimerRef.current !== null) {
        window.clearTimeout(recallPulseTimerRef.current);
      }
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

  const recallSnapshot = useLiveCallback((snapshotId: string) => {
    const snapshotName = viewModel?.snapshots.find((snapshot) => snapshot.id === snapshotId)?.name ?? "snapshot";
    armOrApplyAction(
      {
        key: `snapshot-recall:${snapshotId}`,
        label: `Recall ${snapshotName}`,
        targetId: snapshotId,
        targetKind: "snapshot-recall",
        timeoutMs: AUDIO_ARM_TIMEOUT_MS,
      },
      () => {
        void performAction(`audio-snapshot-${snapshotId}`, async () => {
          const result = await store.recallAudioSnapshot(snapshotId);
          setRecallReport(parseAudioRecallReport(result));
        });
      }
    );
  });

  const dismissRecallReport = useLiveCallback(() => {
    setRecallReport(null);
  });

  const captureSnapshot = useLiveCallback(() => {
    if (!viewModel) return;
    const usedSlots = new Set(viewModel.snapshots.map((snapshot) => snapshot.oscIndex));
    const slotIndex = Array.from({ length: 8 }, (_, index) => index).find((index) => !usedSlots.has(index));
    if (slotIndex === undefined) {
      setFeedback({
        message: "All eight snapshot slots are full. Save over a slot or delete one first.",
        tone: "info",
      });
      return;
    }
    void performAction("audio-snapshot-capture", async () => {
      await store.createAudioSnapshot({
        captureCurrentState: true,
        name: `Snapshot ${slotIndex + 1}`,
        oscIndex: slotIndex,
      });
    });
  });

  const saveSnapshot = useLiveCallback((snapshotId: string) => {
    const snapshotName = viewModel?.snapshots.find((snapshot) => snapshot.id === snapshotId)?.name ?? "snapshot";
    armOrApplyAction(
      {
        key: `snapshot-save:${snapshotId}`,
        label: `Save current mix into ${snapshotName}`,
        targetId: snapshotId,
        targetKind: "snapshot-save",
        timeoutMs: AUDIO_ARM_TIMEOUT_MS,
      },
      () => {
        void performAction(`audio-snapshot-save-${snapshotId}`, async () => {
          await store.updateAudioSnapshot({ snapshotId, captureCurrentState: true });
        });
      }
    );
  });

  const renameSnapshot = useLiveCallback((snapshotId: string, currentName: string) => {
    setTextDialog({ currentName, id: snapshotId, kind: "snapshot" });
  });

  const renameChannel = useLiveCallback((channelId: string, currentName: string) => {
    setTextDialog({ currentName, id: channelId, kind: "channel" });
  });

  const deleteSnapshot = useLiveCallback((snapshotId: string, snapshotName: string) => {
    setDeleteSnapshotDialog({ id: snapshotId, name: snapshotName });
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

  // A recall never pushes 48V; the report lists each difference and this is
  // the same armed flow the inspector uses.
  const armPhantomFromRecall = useLiveCallback((channelId: string, channelName: string, phantom: boolean) => {
    togglePhantom({ channelId, channelName, phantom });
  });

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

  // Talkback holds bypass performAction on purpose: a hold re-sends every
  // 750 ms, and a heartbeat must not clear an armed action, flash the busy
  // state or wipe feedback. Errors still surface as feedback.
  const holdTalkback = useLiveCallback((request: AudioTalkbackHold) => {
    void store.holdAudioTalkback(request).catch((error) => {
      setFeedback({
        message:
          error instanceof Error
            ? error.message
            : "Talkback could not be changed. Release Talkback and press it again.",
        tone: "error",
      });
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
      {
        disabled: !canMutate,
        icon: Pencil,
        id: "rename",
        label: "Rename channel",
        onSelect: () => renameChannel(contextMenuChannel.id, contextMenuChannel.name),
      },
    ];
  }, [contextMenuChannel, renameChannel, resetChannelFaderToUnity, updateChannel, viewModel]);

  const confirmTextDialog = useLiveCallback((nextName: string) => {
    if (!textDialog) return;
    const dialog = textDialog;
    setTextDialog(null);
    if (dialog.kind === "snapshot") {
      void performAction(`audio-snapshot-rename-${dialog.id}`, async () => {
        await store.updateAudioSnapshot({ snapshotId: dialog.id, name: nextName });
      });
      return;
    }
    updateChannel({ channelId: dialog.id, name: nextName });
  });

  const confirmDeleteSnapshot = useLiveCallback(() => {
    if (!deleteSnapshotDialog) return;
    const dialog = deleteSnapshotDialog;
    setDeleteSnapshotDialog(null);
    void performAction(`audio-snapshot-delete-${dialog.id}`, async () => {
      await store.deleteAudioSnapshot({ snapshotId: dialog.id });
    });
  });

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
      data-audio-theme={audioTheme}
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
          onCaptureSnapshot={captureSnapshot}
          onClearAllSolo={clearAllSolo}
          onClearClips={clearClips}
          onDeleteSnapshot={deleteSnapshot}
          onHoldTalkback={holdTalkback}
          onOpenSetup={openSetup}
          onRecallSnapshot={recallSnapshot}
          onRenameSnapshot={renameSnapshot}
          onRunAudioProbe={runAudioProbe}
          onSaveSnapshot={saveSnapshot}
          onSelectMixTarget={selectMixTarget}
          onSync={syncAudio}
          onUpdateMixTarget={updateMixTarget}
          recentlyRecalledSnapshotId={recentlyRecalledSnapshotId}
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
          recallReport={recallReport}
          onDismissRecallReport={dismissRecallReport}
          onArmPhantomFromRecall={armPhantomFromRecall}
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
          onRenameChannel={(channelId) => {
            const channel = viewModel.channels.find((entry) => entry.id === channelId);
            if (channel) renameChannel(channel.id, channel.name);
          }}
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

      {textDialog ? (
        <AudioTextDialog
          busy={Boolean(busyAction?.includes(textDialog.id))}
          confirmLabel="Rename"
          fieldLabel={textDialog.kind === "snapshot" ? "Snapshot name" : "Channel name"}
          initialValue={textDialog.currentName}
          onCancel={() => setTextDialog(null)}
          onConfirm={confirmTextDialog}
          title={textDialog.kind === "snapshot" ? "Rename snapshot" : "Rename channel"}
        />
      ) : null}

      {deleteSnapshotDialog ? (
        <ConfirmDialog
          body={`Delete "${deleteSnapshotDialog.name}" from the snapshot slots.`}
          busy={busyAction === `audio-snapshot-delete-${deleteSnapshotDialog.id}`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteSnapshotDialog(null)}
          onConfirm={confirmDeleteSnapshot}
          title="Delete snapshot"
        />
      ) : null}
    </div>
  );
}
