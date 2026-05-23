/**
 * Send fader card + Mute/Solo/Unity action row for the channel-mode
 * inspector header.
 *
 * Extracted from `AudioInspectorChannelHeader.tsx` to keep the header focused
 * on the identity strip (Slice 5B).
 */
import styles from "../AudioInspector.module.css";
import { AUDIO_FADER_UNITY, formatAudioDb } from "../../audioFormatting";
import type { AudioMixTargetEntry } from "../../../shellData";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioHardwareReadout } from "../AudioHardwareReadout";
import { AudioSliderControl } from "../AudioSliderControl";
import type { AudioChannelUpdate, SelectedAudioChannel } from "./audioInspectorHelpers";

interface AudioInspectorChannelSendActionsProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  selectedChannel: SelectedAudioChannel;
  selectedMixTarget: AudioMixTargetEntry | null;
  selectedSendDraftKey: string;
  selectedSendLevel: number;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioInspectorChannelSendActions({
  clearDraftValueLater,
  commitChannelContinuous,
  onUpdateChannel,
  selectedChannel,
  selectedMixTarget,
  selectedSendDraftKey,
  selectedSendLevel,
  setDraftValue,
  viewModel,
}: AudioInspectorChannelSendActionsProps) {
  return (
    <>
      <div className={styles.inspectorFaderCard}>
        <div className={styles.inspectorFaderHead}>
          <span>
            Send to <strong>{selectedMixTarget?.name ?? "output"}</strong>
          </span>
          <AudioHardwareReadout>
            <strong>{formatAudioDb(selectedSendLevel)}</strong>
          </AudioHardwareReadout>
        </div>
        <div className={styles.inspectorFaderTicks} aria-hidden="true">
          <span>-∞</span>
          <span>-40</span>
          <span>-20</span>
          <span>-10</span>
          <span>0</span>
          <span>+6</span>
        </div>
        <AudioSliderControl
          className={styles.inspectorSendSlider}
          disabled={!viewModel.actionsAllowed}
          label={`${selectedChannel.name} send to selected output`}
          onCommit={(value) => {
            setDraftValue(selectedSendDraftKey, value);
            commitChannelContinuous({
              channelId: selectedChannel.id,
              fader: value,
              mixTargetId: viewModel.selectedMixTargetId ?? undefined,
            });
            clearDraftValueLater(selectedSendDraftKey);
          }}
          onPreview={(value) => setDraftValue(selectedSendDraftKey, value)}
          orientation="horizontal"
          snapUnity
          value={selectedSendLevel}
          valueText={formatAudioDb(selectedSendLevel)}
        />
      </div>

      <div className={styles.inspectorActionRow}>
        <button
          aria-label={`Mute ${selectedChannel.name}`}
          aria-pressed={selectedChannel.mute}
          data-control="mute"
          data-active={selectedChannel.mute}
          disabled={!viewModel.actionsAllowed}
          onClick={() => onUpdateChannel({ channelId: selectedChannel.id, mute: !selectedChannel.mute })}
          type="button"
        >
          Mute
        </button>
        <button
          aria-label={`Solo ${selectedChannel.name}`}
          aria-pressed={selectedChannel.solo}
          data-control="solo"
          data-active={selectedChannel.solo}
          disabled={!viewModel.actionsAllowed}
          onClick={() => onUpdateChannel({ channelId: selectedChannel.id, solo: !selectedChannel.solo })}
          type="button"
        >
          Solo
        </button>
        <button
          aria-label={`Set ${selectedChannel.name} send to unity`}
          data-control="unity"
          disabled={!viewModel.actionsAllowed}
          onClick={() =>
            onUpdateChannel({
              channelId: selectedChannel.id,
              fader: AUDIO_FADER_UNITY,
              mixTargetId: viewModel.selectedMixTargetId ?? undefined,
            })
          }
          type="button"
        >
          Unity
        </button>
      </div>
    </>
  );
}
