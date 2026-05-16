import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "../AudioWorkspace.module.css";
import type { AudioDensityMode } from "../audioFormatting";
import type { AudioChannelGroupSelectionRequest, AudioWorkspaceViewModel } from "../audioViewModel";
import { AudioSnapshotDeck } from "./AudioSnapshotDeck";
import { AudioTargetPicker } from "./AudioTargetPicker";
import { AudioTieredMixer } from "./AudioTieredMixer";

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

export function AudioSignalCanvas({
  busyAction,
  clearDraftValue,
  commitChannelContinuous,
  commitMixTargetContinuous,
  density,
  getDraftValue,
  onOpenChannelMenu,
  onClearAllSolo,
  onClearClips,
  onClearSolo,
  onCaptureSnapshot,
  onDeleteSnapshot,
  onRecallSnapshot,
  onRenameSnapshot,
  onSaveSnapshot,
  onSelectChannel,
  onSelectChannelGroup,
  onSelectMixTarget,
  onSetDensity,
  onSetViewMode,
  setDraftValue,
  onUpdateChannel,
  onUpdateMixTarget,
  recentlyRecalledSnapshotId,
  statusWarningRef,
  viewModel,
}: {
  busyAction: string | null;
  clearDraftValue: (key: string) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  density: AudioDensityMode;
  getDraftValue: (key: string, fallback: number) => number;
  onOpenChannelMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  onClearAllSolo: () => void;
  onClearClips: (channelId?: string) => void;
  onClearSolo: (channelId: string) => void;
  onCaptureSnapshot: () => void;
  onDeleteSnapshot: (snapshotId: string, snapshotName: string) => void;
  onRecallSnapshot: (snapshotId: string) => void;
  onRenameSnapshot: (snapshotId: string, snapshotName: string) => void;
  onSaveSnapshot: (snapshotId: string) => void;
  onSelectChannel: (channelId: string | null) => void;
  onSelectChannelGroup: (request: AudioChannelGroupSelectionRequest) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onSetDensity: (density: AudioDensityMode) => void;
  onSetViewMode: (viewMode: "submix" | "master") => void;
  setDraftValue: (key: string, value: number) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  recentlyRecalledSnapshotId: string | null;
  statusWarningRef: RefObject<HTMLDivElement | null>;
  viewModel: AudioWorkspaceViewModel;
}) {
  const soloedChannel = viewModel.soloedChannel ?? viewModel.selectedChannel ?? viewModel.channels[0] ?? null;

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
          <small>Enter sync · V view · Esc clear</small>
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
        <span className={styles.canvasSelectedMeta}>{viewModel.selectedSourceMeta}</span>
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
        <span className={styles.canvasBarLabel}>View</span>
        <div className={styles.canvasModeSwitch} aria-label="Audio canvas view">
          <button data-active={viewModel.viewMode === "submix"} onClick={() => onSetViewMode("submix")} type="button">
            Submix
          </button>
          <button
            data-active={viewModel.viewMode === "master"}
            disabled={!viewModel.capabilities.canUseMasterView}
            onClick={() => onSetViewMode("master")}
            title={
              viewModel.capabilities.canUseMasterView ? "Show master view" : "Master view requires engine support"
            }
            type="button"
          >
            Master
          </button>
        </div>
        <span className={styles.canvasDivider} />
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
          <span>
            <strong>{viewModel.activeMixReadout.lufs}</strong> LUFS-i
          </span>
        </div>
        <span className={styles.canvasSpacer} />
        <div
          className={styles.canvasActiveMixMeter}
          aria-label="Active mix level"
          data-simulated-meter={viewModel.meterSimulationActive}
          data-testid="audio-active-mix-meter"
        >
          <span>Active mix</span>
          <i
            style={{ "--meter-level": `${Math.round(viewModel.activeMixReadout.meterLeft * 100)}%` } as CSSProperties}
          />
          <i
            style={{ "--meter-level": `${Math.round(viewModel.activeMixReadout.meterRight * 100)}%` } as CSSProperties}
          />
          <strong>{viewModel.activeMixReadout.db}</strong>
        </div>
        <span className={styles.canvasSpacer} />
        <span className={styles.canvasBarLabel}>Density</span>
        <div className={styles.canvasModeSwitch} aria-label="Audio density">
          <button data-active={density === "desktop"} onClick={() => onSetDensity("desktop")} type="button">
            Desktop
          </button>
          <button data-active={density === "touch"} onClick={() => onSetDensity("touch")} type="button">
            Touch
          </button>
        </div>
      </div>

      {viewModel.healthStats.soloedChannels > 0 || viewModel.healthStats.clippedChannels > 0 ? (
        <div className={styles.canvasWarningStack}>
          {viewModel.healthStats.soloedChannels > 0 ? (
            <div className={styles.canvasWarningBand} data-kind="solo" data-testid="audio-solo-warning-band">
              <strong>Solo engaged</strong>
              <span>
                on <b>{soloedChannel?.name ?? "A channel"}</b> · the mix you're hearing isn't the mix you're seeing
              </span>
              {soloedChannel ? (
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
        clearDraftValue={clearDraftValue}
        commitChannelContinuous={commitChannelContinuous}
        commitMixTargetContinuous={commitMixTargetContinuous}
        getDraftValue={getDraftValue}
        onOpenChannelMenu={onOpenChannelMenu}
        onClearClip={onClearClips}
        onSelectChannel={onSelectChannel}
        onSelectChannelGroup={onSelectChannelGroup}
        onSelectMixTarget={onSelectMixTarget}
        setDraftValue={setDraftValue}
        onUpdateChannel={onUpdateChannel}
        onUpdateMixTarget={onUpdateMixTarget}
        viewModel={viewModel}
      />

      <AudioSnapshotDeck
        actionsAllowed={viewModel.capabilities.canCaptureSnapshot}
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
