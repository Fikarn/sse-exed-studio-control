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
  // Production readiness S15: spans, not divs — this renders inside the plate
  // head's `<p>`, where a `<div>` is invalid markup (React warned about it in
  // every development build). Both classes lay the spans out as blocks.
  return (
    <>
      <span className={styles.inspectorEyebrowRow}>
        <span>
          Channel · {channelTypeLabel(selectedChannel.role)} {channelOrdinalLabel(viewModel, selectedChannel)}
        </span>
        <span className={styles.inspectorTagRow}>
          <span className={styles.inspectorTag}>{selectedChannel.stereo ? "Stereo" : "Mono"}</span>
          <span className={styles.inspectorTag} data-group={selectedGroup}>
            {selectedGroup}
          </span>
        </span>
      </span>
      {/* Visual overhaul A, Slice 4c: the plate head prints the name, so this
          is the line under it — what the strip is and where it goes. */}
      <span className={styles.inspectorSubtitle}>
        {channelRoutingSourceText(selectedChannel.role)} · {selectedChannel.stereo ? "Stereo" : "Mono"} →{" "}
        <strong>{selectedMixTarget?.name ?? "No output"}</strong>
      </span>
    </>
  );
}
