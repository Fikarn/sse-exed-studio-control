import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { AudioSnapshot, ShellStore } from "@sse/engine-client";
import { ConfirmDialog, ContextMenu, type ContextMenuItem } from "@sse/design-system";
import { Pencil, RotateCcw, SlidersHorizontal } from "lucide-react";

import styles from "./AudioWorkspace.module.css";
import { AUDIO_ARM_TIMEOUT_MS, AUDIO_DRAFT_CLEAR_MS, AUDIO_RECALL_PULSE_MS } from "./audioConstants";
import { useAudioArming } from "./hooks/useAudioArming";
import { useAudioKeyboardShortcuts } from "./hooks/useAudioKeyboardShortcuts";
import { useAudioOptimisticSettings, type OptimisticAudioSettings } from "./hooks/useAudioOptimisticSettings";
import { useAudioPaletteRegistration } from "./hooks/useAudioPaletteRegistration";
import { createAudioControlDraftStore } from "./audioControlDraftStore";
import { AUDIO_FADER_UNITY, type AudioFeedbackTone } from "./audioFormatting";
import {
  audioChannelSupportsPhase,
  buildAudioViewModel,
  type AudioChannelGroup,
  type AudioChannelGroupSelectionRequest,
  type AudioChannelGroupSelections,
} from "./audioViewModel";
import { AudioHealthBar } from "./components/AudioHealthBar";
import { AudioInspector, type InspectorTab } from "./components/AudioInspector";
import { AudioMeterCanvasOverlay } from "./components/AudioMeterCanvasOverlay";
import { AudioRail } from "./components/AudioRail";
import { AudioSignalCanvas } from "./components/AudioSignalCanvas";
import { AudioTextDialog } from "./components/AudioTextDialog";
import { type SnapshotRecord } from "../shellData";
import { useLiveCallback } from "../shared/useLiveCallback";
import { usePalette } from "../shared/paletteContext";

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

const AUDIO_DENSITY_MODE = "desktop";

export function AudioWorkspace({ appSnapshot, audioSnapshot, store }: AudioWorkspaceProps) {
  const { register } = usePalette();
  const [activeChannelGroups, setActiveChannelGroups] =
    useState<AudioChannelGroupSelections>(EMPTY_CHANNEL_GROUP_SELECTIONS);
  const [bankIndex, setBankIndex] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<AudioWorkspaceFeedback | null>(null);
  const [recentlyRecalledSnapshotId, setRecentlyRecalledSnapshotId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<AudioContextMenuState | null>(null);
  const draftStoreRef = useRef<ReturnType<typeof createAudioControlDraftStore> | null>(null);
  if (!draftStoreRef.current) {
    draftStoreRef.current = createAudioControlDraftStore();
  }
  const draftStore = draftStoreRef.current;
  const [textDialog, setTextDialog] = useState<AudioTextDialogState | null>(null);
  const [deleteSnapshotDialog, setDeleteSnapshotDialog] = useState<AudioDeleteSnapshotState | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("channel");
  const [peakHoldEnabled, setPeakHoldEnabled] = useState(true);
  const [peakHoldResetToken, setPeakHoldResetToken] = useState(0);
  const warningBandRef = useRef<HTMLDivElement | null>(null);
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
      density: AUDIO_DENSITY_MODE,
    });
  }, [activeChannelGroups, appSnapshot, audioSnapshotForView, bankIndex]);

  const { armedAction, armOrApplyAction, cancelArmedAction, clearArmedAction } = useAudioArming({
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
        message: error instanceof Error ? error.message : "The audio action could not be completed.",
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
        message: error instanceof Error ? error.message : "The audio setting could not be updated.",
        tone: "error",
      });
    });
  });

  const syncAudio = useLiveCallback(() => {
    void performAction("audio-sync", async () => {
      await store.syncAudio();
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
          await store.recallAudioSnapshot(snapshotId);
        });
      }
    );
  });

  const recallCurrentSnapshot = useLiveCallback(() => {
    if (!viewModel?.selectedSnapshot) return;
    recallSnapshot(viewModel.selectedSnapshot.id);
  });

  const captureSnapshot = useLiveCallback(() => {
    if (!viewModel) return;
    const usedSlots = new Set(viewModel.snapshots.map((snapshot) => snapshot.oscIndex));
    const slotIndex = Array.from({ length: 8 }, (_, index) => index).find((index) => !usedSlots.has(index));
    if (slotIndex === undefined) {
      setFeedback({ message: "All audio snapshot slots are populated.", tone: "info" });
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

  const saveCurrentSnapshot = useLiveCallback(() => {
    if (!viewModel?.selectedSnapshot) return;
    saveSnapshot(viewModel.selectedSnapshot.id);
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

  const selectChannelGroup = useLiveCallback(({ group, mode, tierId }: AudioChannelGroupSelectionRequest) => {
    const availableGroups = (tierId === "hardware-inputs"
      ? viewModel?.hardwareInputs.chips
      : viewModel?.softwarePlayback.chips
    )?.map((chip) => chip.id as AudioChannelGroup) ?? [group];
    setActiveChannelGroups((current) => {
      const selected = new Set(current[tierId]);
      if (mode === "invert") {
        for (const availableGroup of availableGroups) {
          if (selected.has(availableGroup)) {
            selected.delete(availableGroup);
          } else {
            selected.add(availableGroup);
          }
        }
      } else if (mode === "toggle") {
        if (selected.has(group)) {
          selected.delete(group);
        } else {
          selected.add(group);
        }
      } else {
        const isActive = selected.has(group);
        selected.clear();
        if (!isActive) {
          selected.add(group);
        }
      }

      return {
        ...current,
        [tierId]: availableGroups.filter((availableGroup) => selected.has(availableGroup)),
      };
    });
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
          label: `${phantom ? "Enable" : "Disable"} 48V on ${channelName}`,
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
        message: error instanceof Error ? error.message : "The audio EQ control could not be updated.",
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

  const clearSolo = useLiveCallback((channelId: string) => {
    updateChannel({ channelId, solo: false });
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
        message: error instanceof Error ? error.message : "The audio control could not be updated.",
        tone: "error",
      });
    });
  });

  const commitMixTargetContinuous = useLiveCallback((request: AudioMixTargetUpdate) => {
    void store.updateAudioMixTarget(request).catch((error) => {
      setFeedback({
        message: error instanceof Error ? error.message : "The audio output could not be updated.",
        tone: "error",
      });
    });
  });

  const openChannelContextMenu = useLiveCallback((event: ReactMouseEvent<HTMLElement>, channelId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ channelId, x: event.clientX, y: event.clientY });
  });

  const previousBank = useLiveCallback(() => {
    setBankIndex((current) => Math.max(0, current - 1));
  });

  const nextBank = useLiveCallback(() => {
    const maxBankIndex = Math.max(0, (viewModel?.totalBanks ?? 1) - 1);
    setBankIndex((current) => Math.min(maxBankIndex, current + 1));
  });

  const visibleSelectableChannels = useMemo(() => {
    if (!viewModel) return [];
    return [...viewModel.hardwareInputs.channels, ...viewModel.softwarePlayback.channels];
  }, [viewModel]);

  const orderedSelectableSources = useMemo(() => {
    if (!viewModel) return [];
    return [
      ...viewModel.channels
        .filter((channel) => channel.role !== "playback-pair")
        .map((channel) => ({ id: channel.id, kind: "channel" as const })),
      ...viewModel.channels
        .filter((channel) => channel.role === "playback-pair")
        .map((channel) => ({ id: channel.id, kind: "channel" as const })),
      ...viewModel.mixTargets.map((mixTarget) => ({ id: mixTarget.id, kind: "output" as const })),
    ];
  }, [viewModel]);
  useAudioKeyboardShortcuts({
    cancelArmedAction,
    clearClips,
    contextMenu,
    inspectorTab,
    nextBank,
    orderedSelectableSources,
    previousBank,
    recallSnapshot,
    resetChannelFaderToUnity,
    saveCurrentSnapshot,
    selectChannel,
    selectOutputMixTarget,
    setContextMenu,
    setInspectorTab,
    syncAudio,
    updateChannel,
    viewModel,
    visibleSelectableChannels,
    warningBandRef,
  });

  useAudioPaletteRegistration({
    captureSnapshot,
    clearAllSolo,
    clearClips,
    nextBank,
    previousBank,
    recallSnapshot,
    register,
    renameChannel,
    resetPeakHolds,
    saveCurrentSnapshot,
    selectChannel,
    selectOutputMixTarget,
    syncAudio,
    togglePeakHold,
    updateChannel,
    viewModel,
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
        label: "Rename",
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
      <div className={styles.audioShell} data-testid="audio-workspace">
        <section className={styles.loadingPanel}>
          <span className={styles.eyebrow}>Audio</span>
          <h1>Loading audio snapshot.</h1>
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
      data-density={AUDIO_DENSITY_MODE}
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

      <div className={styles.audioBody}>
        <AudioRail
          clearDraftValueLater={clearDraftValueLater}
          commitMixTargetContinuous={commitMixTargetContinuous}
          draftStore={draftStore}
          getDraftValue={getDraftValue}
          onRecallCurrentSnapshot={recallCurrentSnapshot}
          onOpenSetup={openSetup}
          onSelectMixTarget={selectMixTarget}
          onSync={syncAudio}
          store={store}
          setDraftValue={setDraftValue}
          onUpdateMixTarget={updateMixTarget}
          viewModel={viewModel}
        />
        <AudioSignalCanvas
          armedAction={armedAction}
          busyAction={busyAction}
          clearDraftValueLater={clearDraftValueLater}
          commitChannelContinuous={commitChannelContinuous}
          commitMixTargetContinuous={commitMixTargetContinuous}
          draftStore={draftStore}
          getDraftValue={getDraftValue}
          onOpenChannelMenu={openChannelContextMenu}
          onClearAllSolo={clearAllSolo}
          onClearClips={clearClips}
          onClearSolo={clearSolo}
          onCaptureSnapshot={captureSnapshot}
          onDeleteSnapshot={deleteSnapshot}
          onOpenSetup={openSetup}
          onRecallSnapshot={recallSnapshot}
          onRenameSnapshot={renameSnapshot}
          onSaveSnapshot={saveSnapshot}
          onSelectChannel={selectChannel}
          onSelectChannelGroup={selectChannelGroup}
          onSelectMixTarget={selectMixTarget}
          onSelectOutputMixTarget={selectOutputMixTarget}
          onSync={syncAudio}
          onTogglePeakHold={togglePeakHold}
          onResetPeakHolds={resetPeakHolds}
          setDraftValue={setDraftValue}
          onUpdateChannel={updateChannel}
          onUpdateMixTarget={updateMixTarget}
          peakHoldEnabled={peakHoldEnabled}
          recentlyRecalledSnapshotId={recentlyRecalledSnapshotId}
          statusWarningRef={warningBandRef}
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
          activeTab={inspectorTab}
          onActiveTabChange={setInspectorTab}
          onSelectMixTarget={selectMixTarget}
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
          title={textDialog.kind === "snapshot" ? "Rename Audio Snapshot" : "Rename Audio Channel"}
        />
      ) : null}

      {deleteSnapshotDialog ? (
        <ConfirmDialog
          body={`Delete "${deleteSnapshotDialog.name}" from the audio snapshot list.`}
          busy={busyAction === `audio-snapshot-delete-${deleteSnapshotDialog.id}`}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleteSnapshotDialog(null)}
          onConfirm={confirmDeleteSnapshot}
          title="Delete Audio Snapshot"
        />
      ) : null}

      <AudioHealthBar viewModel={viewModel} />
    </div>
  );
}
