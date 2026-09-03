import { useEffect, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioSignalCanvas.module.css";
import type { AudioArmedAction } from "../audioArming";
import type { AudioRecallReport } from "../audioRecallReport";
import { type AudioControlDraftStore } from "../audioControlDraftStore";
import type { AudioChannelGroupSelectionRequest, AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioSnapshotDeck } from "./AudioSnapshotDeck";
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
  recallReport,
  onDismissRecallReport,
  onArmPhantomFromRecall,
  onRecallSnapshot,
  onRenameSnapshot,
  onRunAudioProbe,
  onSaveSnapshot,
  onSelectChannel,
  onSelectChannelGroup,
  onSelectMixTarget: _onSelectMixTarget,
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
  store: _store,
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
  recallReport: AudioRecallReport | null;
  onDismissRecallReport: () => void;
  onArmPhantomFromRecall: (channelId: string, channelName: string, phantom: boolean) => void;
  onRecallSnapshot: (snapshotId: string) => void;
  onRenameSnapshot: (snapshotId: string, snapshotName: string) => void;
  onRunAudioProbe: () => void;
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
      {viewModel.status.warningBody && viewModel.status.bannerEligible ? (
        <div
          className={styles.warningBand}
          data-variant="compact"
          data-tone={viewModel.status.tone}
          data-testid="audio-warning-band"
          ref={statusWarningRef}
          role="status"
          tabIndex={0}
        >
          <strong>{viewModel.status.warningTitle}</strong>
          <span>{viewModel.status.warningBody}</span>
          <span className={styles.warningRecoveryActions}>
            {viewModel.capabilities.canSync || viewModel.audioSnapshot.oscEnabled === false ? (
              <button
                disabled={!viewModel.capabilities.canSync}
                onClick={onSync}
                title={
                  viewModel.capabilities.canSync
                    ? "Pull the console state from TotalMix"
                    : "Audio sync is unavailable until OSC is enabled"
                }
                type="button"
              >
                Sync now
              </button>
            ) : (
              <button
                data-testid="audio-warning-band-probe"
                onClick={onRunAudioProbe}
                title="Run the audio probe to verify the TotalMix link and unlock console controls"
                type="button"
              >
                Run audio probe
              </button>
            )}
            <button onClick={onOpenSetup} type="button">
              Setup
            </button>
          </span>
        </div>
      ) : null}

      {/* 2026-09 audit remediation, Slice 4: a recall pushes the snapshot to
          the desk and says what the console confirmed. 48V is never pushed —
          each difference gets its own armed confirm right here. */}
      {recallReport ? (
        <div
          className={styles.warningBand}
          data-variant="compact"
          data-tone={recallReport.unconfirmed > 0 ? "attention" : "ok"}
          data-testid="audio-recall-report"
          role="status"
        >
          <strong>Recalled {recallReport.snapshotName}</strong>
          <span>{recallReport.summaryLine}</span>
          <span className={styles.warningRecoveryActions}>
            {recallReport.phantomDifferences.map((difference) => {
              const armKey = `phantom:${difference.channelId}:${difference.target}`;
              return (
                <button
                  data-armed={armedAction?.key === armKey ? "true" : "false"}
                  data-testid={`audio-recall-arm-phantom-${difference.channelId}`}
                  key={difference.channelId}
                  onClick={() =>
                    onArmPhantomFromRecall(difference.channelId, difference.channelName, difference.target)
                  }
                  title={`${difference.target ? "Enable" : "Disable"} 48V on ${difference.channelName} — arm, then press again to apply`}
                  type="button"
                >
                  {armedAction?.key === armKey ? "Confirm" : "Arm"} 48V {difference.target ? "on" : "off"} ·{" "}
                  {difference.channelName}
                </button>
              );
            })}
            <button
              aria-label="Dismiss recall report"
              data-testid="audio-recall-report-dismiss"
              onClick={onDismissRecallReport}
              type="button"
            >
              Dismiss
            </button>
          </span>
        </div>
      ) : null}

      {/* 2026-05-27 Console redesign + C11 (2026-06-02): the dense Phase 3
          context bar (editing target picker, meter readouts, big stat pills)
          is retired — that context now lives in the AudioTopBar status cluster
          + the "MIX FOR → {active}" eyebrow inside the Outputs section. C11
          also removes the slim context-bar row entirely (~38px reclaimed):
          the Peak Hold + Reset controls and the meter-simulation chip now
          render as an eyebrow inside the Outputs tier header (AudioTieredMixer),
          keeping their testids + labels so keyboard + spec coverage stays
          green. */}
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
              <button
                aria-label="Clear all solo"
                disabled={!viewModel.actionsAllowed}
                onClick={onClearAllSolo}
                type="button"
              >
                Clear all solo <kbd>⌥S</kbd>
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
        onResetPeakHolds={onResetPeakHolds}
        onSelectChannel={onSelectChannel}
        onSelectChannelGroup={onSelectChannelGroup}
        onSelectOutputMixTarget={onSelectOutputMixTarget}
        onTogglePeakHold={onTogglePeakHold}
        peakHoldEnabled={peakHoldEnabled}
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
