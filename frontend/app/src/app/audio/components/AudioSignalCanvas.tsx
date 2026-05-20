import { useEffect, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "../AudioWorkspace.module.css";
import type { AudioArmedAction } from "../audioArming";
import { type AudioControlDraftStore } from "../audioControlDraftStore";
import type { AudioChannelGroupSelectionRequest, AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioLiveActiveMixMeter } from "./AudioLiveMeterReadout";
import { AudioSnapshotDeck } from "./AudioSnapshotDeck";
import { AudioTargetPicker } from "./AudioTargetPicker";
import { AudioTieredMixer } from "./AudioTieredMixer";

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

export function AudioSignalCanvas({
  armedAction,
  busyAction,
  clearDraftValueLater,
  commitChannelContinuous,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onOpenChannelMenu,
  onClearAllSolo,
  onClearClips,
  onClearSolo,
  onCaptureSnapshot,
  onDeleteSnapshot,
  onOpenSetup,
  onRecallSnapshot,
  onRenameSnapshot,
  onSaveSnapshot,
  onSelectChannel,
  onSelectChannelGroup,
  onSelectMixTarget,
  onSelectOutputMixTarget,
  onSync,
  onTogglePeakHold,
  onResetPeakHolds,
  setDraftValue,
  onUpdateChannel,
  onUpdateMixTarget,
  peakHoldEnabled,
  recentlyRecalledSnapshotId,
  statusWarningRef,
  store,
  viewModel,
}: {
  armedAction: AudioArmedAction | null;
  busyAction: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onOpenChannelMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  onClearAllSolo: () => void;
  onClearClips: (channelId?: string) => void;
  onClearSolo: (channelId: string) => void;
  onCaptureSnapshot: () => void;
  onDeleteSnapshot: (snapshotId: string, snapshotName: string) => void;
  onOpenSetup: () => void;
  onRecallSnapshot: (snapshotId: string) => void;
  onRenameSnapshot: (snapshotId: string, snapshotName: string) => void;
  onSaveSnapshot: (snapshotId: string) => void;
  onSelectChannel: (channelId: string | null) => void;
  onSelectChannelGroup: (request: AudioChannelGroupSelectionRequest) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onSelectOutputMixTarget: (mixTargetId: string) => void;
  onSync: () => void;
  onTogglePeakHold: () => void;
  onResetPeakHolds: () => void;
  setDraftValue: (key: string, value: number) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  peakHoldEnabled: boolean;
  recentlyRecalledSnapshotId: string | null;
  statusWarningRef: RefObject<HTMLDivElement | null>;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}) {
  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) return;
    window.__SSE_TEST_RENDER_COUNTS__.audioSignalCanvas =
      (window.__SSE_TEST_RENDER_COUNTS__.audioSignalCanvas ?? 0) + 1;
  });

  const soloedChannels = viewModel.soloedChannels;
  const soloedChannel = soloedChannels[0] ?? null;
  const soloSummary =
    soloedChannels.length <= 1
      ? soloedChannel?.name
      : `${soloedChannels
          .slice(0, 3)
          .map((channel) => channel.name)
          .join(", ")}${soloedChannels.length > 3 ? ` +${soloedChannels.length - 3}` : ""}`;

  return (
    <section className={styles.signalCanvas} data-testid="audio-signal-canvas">
      {viewModel.status.warningBody ? (
        <div
          className={styles.warningBand}
          data-variant="compact"
          data-testid="audio-warning-band"
          ref={statusWarningRef}
          role="status"
          tabIndex={0}
        >
          <strong>{viewModel.status.warningTitle}</strong>
          <span>{viewModel.status.warningBody}</span>
          <span className={styles.warningRecoveryActions}>
            <button
              disabled={!viewModel.capabilities.canSync}
              onClick={onSync}
              title={
                viewModel.capabilities.canSync ? "Run audio sync" : "Audio sync is unavailable until OSC is enabled"
              }
              type="button"
            >
              Sync now
            </button>
            <button onClick={onOpenSetup} type="button">
              Setup
            </button>
          </span>
        </div>
      ) : null}

      <div className={styles.canvasContextBar}>
        <span className={styles.canvasBarLabel}>Editing</span>
        <AudioTargetPicker
          mixTargets={viewModel.mixTargets}
          onSelectMixTarget={onSelectMixTarget}
          selectedMixTargetId={viewModel.selectedMixTargetId}
          selectionLabel={`${viewModel.selectedSourceLabel} selected`}
        />
        <span className={styles.canvasSelectedMeta} title={viewModel.selectedSourceMeta}>
          {viewModel.selectedSourceMeta}
        </span>
        {viewModel.meterSimulationActive ? (
          <span
            className={styles.meterSimulationChip}
            data-testid="audio-meter-simulation-chip"
            title={viewModel.meterSimulationDetail}
          >
            {viewModel.meterSimulationLabel}
          </span>
        ) : null}
        <span className={styles.canvasDivider} />
        <span className={styles.canvasBarLabel}>Peak</span>
        <div className={styles.canvasModeSwitch} aria-label="Meter peak hold">
          <button
            aria-pressed={peakHoldEnabled}
            data-active={peakHoldEnabled}
            data-testid="audio-peak-hold-toggle"
            onClick={onTogglePeakHold}
            title={peakHoldEnabled ? "Disable held peak marks" : "Enable held peak marks"}
            type="button"
          >
            Hold
          </button>
          <button
            data-testid="audio-peak-hold-reset"
            onClick={onResetPeakHolds}
            title="Reset held peak marks"
            type="button"
          >
            Reset
          </button>
        </div>
        <div className={styles.canvasStatPills}>
          <span>
            <strong>{viewModel.hardwareInputs.channels.length}</strong> in
          </span>
          <span>
            <strong>{viewModel.softwarePlayback.channels.length}</strong> pb
          </span>
          <span>
            <strong>{viewModel.hardwareOutputs.mixTargets.length}</strong> out
          </span>
          <span className={styles.canvasMeterStatus} title={viewModel.activeMixReadout.label}>
            <strong>{viewModel.activeMixReadout.meterSource}</strong>
            <em>tap</em>
            <strong>{viewModel.activeMixReadout.meterPoint}</strong>
            <em>ref</em>
            <strong>{viewModel.activeMixReadout.nominalReference}</strong>
            <em>peak</em>
            <strong>{viewModel.activeMixReadout.peakStatus}</strong>
          </span>
        </div>
        <span className={styles.canvasSpacer} />
        <AudioLiveActiveMixMeter
          fallbackLeft={viewModel.activeMixReadout.meterLeft}
          fallbackRight={viewModel.activeMixReadout.meterRight}
          selectedMixTargetId={viewModel.selectedMixTargetId}
          store={store}
        />
      </div>

      {viewModel.healthStats.soloedChannels > 0 || viewModel.healthStats.clippedChannels > 0 ? (
        <div className={styles.canvasWarningStack}>
          {viewModel.healthStats.soloedChannels > 0 ? (
            <div className={styles.canvasWarningBand} data-kind="solo" data-testid="audio-solo-warning-band">
              <strong>{viewModel.healthStats.soloedChannels} solo engaged</strong>
              <span>
                {soloSummary ? (
                  <>
                    on <b>{soloSummary}</b> · the mix you're hearing isn't the mix you're seeing
                  </>
                ) : (
                  "The mix you're hearing isn't the mix you're seeing"
                )}
              </span>
              {soloedChannels.length === 1 && soloedChannel ? (
                <button
                  className={styles.canvasWarningChip}
                  onClick={() => onClearSolo(soloedChannel.id)}
                  type="button"
                >
                  {soloedChannel.name} ×
                </button>
              ) : null}
              <button disabled={!viewModel.actionsAllowed} onClick={onClearAllSolo} type="button">
                Clear all solo
              </button>
            </div>
          ) : null}
          {viewModel.healthStats.clippedChannels > 0 ? (
            <div className={styles.canvasWarningBand} data-kind="clip" data-testid="audio-clip-warning-band">
              <strong>{viewModel.healthStats.clippedChannels} channels clipped</strong>
              <span>— over 0 dBFS</span>
              <button
                aria-label="Clear clips"
                data-testid="audio-clear-clips"
                disabled={!viewModel.capabilities.canClearClips}
                onClick={() => onClearClips()}
                title={
                  viewModel.capabilities.canClearClips
                    ? "Clear clip holds"
                    : "Clip reset is unavailable while OSC is disabled."
                }
                type="button"
              >
                Clear clips <kbd>⌥C</kbd>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <AudioTieredMixer
        clearDraftValueLater={clearDraftValueLater}
        commitChannelContinuous={commitChannelContinuous}
        commitMixTargetContinuous={commitMixTargetContinuous}
        draftStore={draftStore}
        getDraftValue={getDraftValue}
        onOpenChannelMenu={onOpenChannelMenu}
        onClearClip={onClearClips}
        onSelectChannel={onSelectChannel}
        onSelectChannelGroup={onSelectChannelGroup}
        onSelectOutputMixTarget={onSelectOutputMixTarget}
        setDraftValue={setDraftValue}
        onUpdateChannel={onUpdateChannel}
        onUpdateMixTarget={onUpdateMixTarget}
        viewModel={viewModel}
      />

      <AudioSnapshotDeck
        actionsAllowed={viewModel.capabilities.canCaptureSnapshot}
        armedAction={armedAction}
        busyAction={busyAction}
        channels={viewModel.channels}
        mixTargets={viewModel.mixTargets}
        onCaptureSnapshot={onCaptureSnapshot}
        onDeleteSnapshot={onDeleteSnapshot}
        onRecallSnapshot={onRecallSnapshot}
        onRenameSnapshot={onRenameSnapshot}
        onSaveSnapshot={onSaveSnapshot}
        recentlyRecalledSnapshotId={recentlyRecalledSnapshotId}
        selectedMixTargetId={viewModel.selectedMixTargetId}
        snapshots={viewModel.snapshots}
      />
    </section>
  );
}
