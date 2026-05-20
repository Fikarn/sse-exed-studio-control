import type { ShellStore } from "@sse/engine-client";

import styles from "../../AudioWorkspace.module.css";
import { AUDIO_FADER_UNITY, formatAudioDb } from "../../audioFormatting";
import type { AudioMixTargetEntry } from "../../../shellData";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioStableMeterDbPair } from "../AudioLiveMeterReadout";
import { AudioSliderControl } from "../AudioSliderControl";
import { AudioStereoMeter } from "../AudioStereoMeter";
import { outputRouteText, outputTypeLabel, type AudioMixTargetUpdate } from "./audioInspectorHelpers";

interface AudioInspectorOutputViewProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  monitorDraftKey: string;
  monitorValue: number;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  outputLeftMeter: number;
  outputRightMeter: number;
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  selectedMixTarget: AudioMixTargetEntry;
  setDraftValue: (key: string, value: number) => void;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * Output-mode inspector view. Renders when only a mix target is selected (no
 * channel). Owns the output identity strip, the big meter card with live
 * level / peak-hold readouts, the monitor level fader, and the Mute / Unity
 * action row. Parent owns the surrounding `<aside>` element and the routing
 * between Output view / Channel view / Empty state.
 */
export function AudioInspectorOutputView({
  clearDraftValueLater,
  commitMixTargetContinuous,
  monitorDraftKey,
  monitorValue,
  onUpdateMixTarget,
  outputLeftMeter,
  outputRightMeter,
  peakHoldEnabled,
  peakHoldResetToken,
  selectedMixTarget,
  setDraftValue,
  store,
  viewModel,
}: AudioInspectorOutputViewProps) {
  return (
    <div data-testid="audio-inspector-output">
      <div className={styles.inspectorEyebrowRow}>
        <span>
          Output · {outputTypeLabel(selectedMixTarget.role)}{" "}
          {String(viewModel.mixTargets.indexOf(selectedMixTarget) + 1).padStart(2, "0")}
        </span>
        <span className={styles.inspectorTagRow}>
          <span className={styles.inspectorTag}>Stereo</span>
          <span className={styles.inspectorTag} data-group="output">
            Active mix
          </span>
        </span>
      </div>
      <h2 className={styles.inspectorTitle}>{selectedMixTarget.name}</h2>
      <div className={styles.inspectorSubtitle}>
        {outputRouteText(selectedMixTarget.role)} · Hardware output → <strong>Active mix</strong>
      </div>

      <div className={styles.bigMeterCard} data-testid="audio-inspector-output-metering">
        <AudioStereoMeter
          left={selectedMixTarget.meterLeft}
          meterId={selectedMixTarget.id}
          meterKind="mixTarget"
          mirrorRight={selectedMixTarget.mono}
          peakLeft={selectedMixTarget.peakHoldLeft}
          peakRight={selectedMixTarget.peakHoldRight}
          right={selectedMixTarget.mono ? selectedMixTarget.meterLevel : selectedMixTarget.meterRight}
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
                  fallbackLeft={outputLeftMeter}
                  fallbackRight={outputRightMeter}
                  kind="mixTarget"
                  mirrorRight={selectedMixTarget.mono}
                  meterId={selectedMixTarget.id}
                  mode="level"
                  peakHoldEnabled={peakHoldEnabled}
                  peakHoldResetToken={peakHoldResetToken}
                  store={store}
                  testId="audio-inspector-output-level-readout"
                />
                <em>dB</em>
              </strong>
            </span>
            <span>
              <small>Peak hold</small>
              <strong>
                <AudioStableMeterDbPair
                  fallbackLeft={outputLeftMeter}
                  fallbackRight={outputRightMeter}
                  kind="mixTarget"
                  mirrorRight={selectedMixTarget.mono}
                  meterId={selectedMixTarget.id}
                  mode="peakHold"
                  peakHoldEnabled={peakHoldEnabled}
                  peakHoldResetToken={peakHoldResetToken}
                  store={store}
                  testId="audio-inspector-output-peak-hold-readout"
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

      <div className={styles.inspectorFaderCard}>
        <div className={styles.inspectorFaderHead}>
          <span>
            Monitor level <strong>{selectedMixTarget.name}</strong>
          </span>
          <strong>{formatAudioDb(monitorValue)}</strong>
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
          label={`${selectedMixTarget.name} monitor level`}
          onCommit={(value) => {
            setDraftValue(monitorDraftKey, value);
            commitMixTargetContinuous({ mixTargetId: selectedMixTarget.id, volume: value });
            clearDraftValueLater(monitorDraftKey);
          }}
          onPreview={(value) => setDraftValue(monitorDraftKey, value)}
          orientation="horizontal"
          snapUnity
          value={monitorValue}
          valueText={formatAudioDb(monitorValue)}
        />
      </div>

      <div className={styles.inspectorActionRow}>
        <button
          aria-label={`Mute ${selectedMixTarget.name}`}
          aria-pressed={selectedMixTarget.mute}
          data-control="mute"
          data-active={selectedMixTarget.mute}
          disabled={!viewModel.actionsAllowed}
          onClick={() => onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, mute: !selectedMixTarget.mute })}
          type="button"
        >
          Mute
        </button>
        <button
          aria-label={`Set ${selectedMixTarget.name} monitor level to unity`}
          data-control="unity"
          disabled={!viewModel.actionsAllowed}
          onClick={() => onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, volume: AUDIO_FADER_UNITY })}
          type="button"
        >
          Unity
        </button>
      </div>
    </div>
  );
}
