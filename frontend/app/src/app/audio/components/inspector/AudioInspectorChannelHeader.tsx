import styles from "../AudioInspector.module.css";
import type { AudioMixTargetEntry } from "../../../shellData";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import {
  channelOrdinalLabel,
  channelRoutingSourceText,
  channelTypeLabel,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

interface AudioInspectorChannelHeaderProps {
  selectedChannel: SelectedAudioChannel;
  selectedGroup: string;
  selectedMixTarget: AudioMixTargetEntry | null;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * Lean sticky identity header for the channel-mode inspector — eyebrow,
 * name, and routing subtitle only. (2026-05-27 Console redesign: the meter
 * card, preamp, and send/Mute/Solo/Unity row moved OUT of the persistent
 * header and INTO the Preamp tab body, so the EQ / Dyn / Routing tabs render
 * full-height the way the prototype's inspector does.)
 */
export function AudioInspectorChannelHeader({
  selectedChannel,
  selectedGroup,
  selectedMixTarget,
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
    </>
  );
}
