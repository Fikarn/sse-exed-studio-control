import type { ShellStore } from "@sse/engine-client";

import styles from "../AudioInspector.module.css";
import type { AudioMixTargetEntry } from "../../../shellData";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioInspectorChannelHardwareCard } from "./AudioInspectorChannelHardwareCard";
import { AudioInspectorChannelMeterCard } from "./AudioInspectorChannelMeterCard";
import { AudioInspectorChannelSendActions } from "./AudioInspectorChannelSendActions";
import {
  channelOrdinalLabel,
  channelRoutingSourceText,
  channelTypeLabel,
  type AudioChannelUpdate,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

interface PhantomToggleArg {
  channelId: string;
  channelName: string;
  phantom: boolean;
}

interface AudioInspectorChannelHeaderProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  gainDraftKey: string;
  onTogglePhantom: (arg: PhantomToggleArg) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  phantomArmed: boolean;
  phantomLabel: string;
  selectedChannel: SelectedAudioChannel;
  selectedClip: boolean;
  selectedGain: number;
  selectedGroup: string;
  selectedLeftMeter: number;
  selectedMixTarget: AudioMixTargetEntry | null;
  selectedRightMeter: number;
  selectedSendDraftKey: string;
  selectedSendLevel: number;
  setDraftValue: (key: string, value: number) => void;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * Sticky-header block for channel-mode inspector. Identity strip + the three
 * extracted sub-components (meter card, Hardware/Software mini, send fader +
 * action row). Parent owns the conditional that picks between this view and
 * the OutputView / empty state.
 */
export function AudioInspectorChannelHeader({
  clearDraftValueLater,
  commitChannelContinuous,
  gainDraftKey,
  onTogglePhantom,
  onUpdateChannel,
  peakHoldEnabled,
  peakHoldResetToken,
  phantomArmed,
  phantomLabel,
  selectedChannel,
  selectedClip,
  selectedGain,
  selectedGroup,
  selectedLeftMeter,
  selectedMixTarget,
  selectedRightMeter,
  selectedSendDraftKey,
  selectedSendLevel,
  setDraftValue,
  store,
  viewModel,
}: AudioInspectorChannelHeaderProps) {
  return (
    <>
      <div className={styles.inspectorEyebrowRow}>
        <span>
          Channel · {channelTypeLabel(selectedChannel.role)} {channelOrdinalLabel(viewModel, selectedChannel)}
        </span>
        <span className={styles.inspectorTagRow}>
          <span className={styles.inspectorTag}>{selectedChannel.stereo ? "Stereo" : "Mono"}</span>
          <span className={styles.inspectorTag} data-group={selectedGroup}>
            {selectedGroup}
          </span>
        </span>
      </div>
      <h2 className={styles.inspectorTitle}>{selectedChannel.name}</h2>
      <div className={styles.inspectorSubtitle}>
        {channelRoutingSourceText(selectedChannel.role)} · {selectedChannel.stereo ? "Stereo" : "Mono"} →{" "}
        <strong>{selectedMixTarget?.name ?? "No output"}</strong>
      </div>

      <AudioInspectorChannelMeterCard
        peakHoldEnabled={peakHoldEnabled}
        peakHoldResetToken={peakHoldResetToken}
        selectedChannel={selectedChannel}
        selectedClip={selectedClip}
        selectedLeftMeter={selectedLeftMeter}
        selectedRightMeter={selectedRightMeter}
        store={store}
        viewModel={viewModel}
      />

      <AudioInspectorChannelHardwareCard
        clearDraftValueLater={clearDraftValueLater}
        commitChannelContinuous={commitChannelContinuous}
        gainDraftKey={gainDraftKey}
        onTogglePhantom={onTogglePhantom}
        onUpdateChannel={onUpdateChannel}
        phantomArmed={phantomArmed}
        phantomLabel={phantomLabel}
        selectedChannel={selectedChannel}
        selectedGain={selectedGain}
        setDraftValue={setDraftValue}
        viewModel={viewModel}
      />

      <AudioInspectorChannelSendActions
        clearDraftValueLater={clearDraftValueLater}
        commitChannelContinuous={commitChannelContinuous}
        onUpdateChannel={onUpdateChannel}
        selectedChannel={selectedChannel}
        selectedMixTarget={selectedMixTarget}
        selectedSendDraftKey={selectedSendDraftKey}
        selectedSendLevel={selectedSendLevel}
        setDraftValue={setDraftValue}
        viewModel={viewModel}
      />
    </>
  );
}
