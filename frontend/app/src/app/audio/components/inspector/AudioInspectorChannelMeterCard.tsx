/**
 * Big meter card for the channel-mode inspector header. Renders the stereo
 * meter, the stabilised Level L / R readouts, the Peak hold pair, and the
 * fixed Nominal ref / Peak warn reference row.
 *
 * Extracted from `AudioInspectorChannelHeader.tsx` to keep the header focused
 * on the identity strip (Slice 5B).
 */
import type { ShellStore } from "@sse/engine-client";

import styles from "../AudioInspector.module.css";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioStableMeterDbPair } from "../AudioLiveMeterReadout";
import { AudioStereoMeter } from "../AudioStereoMeter";
import type { SelectedAudioChannel } from "./audioInspectorHelpers";

interface AudioInspectorChannelMeterCardProps {
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  selectedChannel: SelectedAudioChannel;
  selectedClip: boolean;
  selectedLeftMeter: number;
  selectedRightMeter: number;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioInspectorChannelMeterCard({
  peakHoldEnabled,
  peakHoldResetToken,
  selectedChannel,
  selectedClip,
  selectedLeftMeter,
  selectedRightMeter,
  store,
  viewModel,
}: AudioInspectorChannelMeterCardProps) {
  return (
    <div className={styles.bigMeterCard} data-testid="audio-inspector-metering">
      <AudioStereoMeter
        clip={selectedChannel.clip}
        left={selectedChannel.meterLeft}
        meterId={selectedChannel.id}
        meterKind="channel"
        mirrorRight={!selectedChannel.stereo}
        peakLeft={selectedChannel.peakHoldLeft}
        peakRight={selectedChannel.stereo ? selectedChannel.peakHoldRight : selectedChannel.peakHoldLeft}
        right={selectedChannel.stereo ? selectedChannel.meterRight : selectedChannel.meterLeft}
        showReadout={false}
        showScale
      />
      <div className={styles.bigMeterInfo}>
        {viewModel.meterSimulationActive ? <span className={styles.meterSimulationBadge}>TEST STAGE</span> : null}
        <div className={styles.bigMeterRow}>
          <span>
            <small>Level L / R</small>
            <strong>
              <AudioStableMeterDbPair
                fallbackLeft={selectedLeftMeter}
                fallbackRight={selectedRightMeter}
                kind="channel"
                mirrorRight={!selectedChannel.stereo}
                meterId={selectedChannel.id}
                mode="level"
                peakHoldEnabled={peakHoldEnabled}
                peakHoldResetToken={peakHoldResetToken}
                store={store}
                testId="audio-inspector-level-readout"
              />
              <em>dB</em>
            </strong>
          </span>
          <span>
            <small>Peak hold</small>
            <strong data-tone={selectedClip ? "clip" : "warn"}>
              <AudioStableMeterDbPair
                fallbackLeft={selectedLeftMeter}
                fallbackRight={selectedRightMeter}
                kind="channel"
                mirrorRight={!selectedChannel.stereo}
                meterId={selectedChannel.id}
                mode="peakHold"
                peakHoldEnabled={peakHoldEnabled}
                peakHoldResetToken={peakHoldResetToken}
                store={store}
                testId="audio-inspector-peak-hold-readout"
              />
              <em>dB</em>
            </strong>
          </span>
        </div>
        <div className={styles.bigMeterReferenceRow}>
          <span>
            <small>Nominal ref</small>
            <strong>
              -18<em>dBFS</em>
            </strong>
          </span>
          <span>
            <small>Peak warn</small>
            <strong>-3 dBFS</strong>
          </span>
        </div>
      </div>
    </div>
  );
}
