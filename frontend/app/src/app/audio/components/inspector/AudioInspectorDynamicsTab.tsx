import type { CSSProperties } from "react";

import styles from "../../AudioWorkspace.module.css";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioSliderControl } from "../AudioSliderControl";
import {
  dynamicsCurvePath,
  dynamicsPoint,
  dynamicsStatusText,
  dynamicsThresholdPercent,
  type AudioDynamicsUpdate,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

interface AudioInspectorDynamicsTabProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  getDraftValue: (key: string, fallback: number) => number;
  onUpdateChannelDynamics: (request: AudioDynamicsUpdate) => void;
  selectedChannel: SelectedAudioChannel | null;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * Dynamics tab body. Renders the compressor/gate enable pills, the
 * threshold-curve visualisation with a gate threshold marker, and a pair of
 * sliders per processor (threshold, ratio, attack, release, makeup). Parent
 * owns the `activeTab === "dynamics"` gate and the surrounding tabpanel
 * section element.
 */
export function AudioInspectorDynamicsTab({
  clearDraftValueLater,
  getDraftValue,
  onUpdateChannelDynamics,
  selectedChannel,
  setDraftValue,
  viewModel,
}: AudioInspectorDynamicsTabProps) {
  if (!selectedChannel) {
    return (
      <div className={styles.emptyInspector}>
        <h3>No channel selected</h3>
        <p>Dynamics controls appear here after a source strip is selected.</p>
      </div>
    );
  }

  const dynamicsCurve = dynamicsCurvePath(selectedChannel.dynamics.compressor);
  const dynamicsCurvePoint = dynamicsPoint(selectedChannel.dynamics.compressor);
  const gateThresholdX = dynamicsThresholdPercent(selectedChannel.dynamics.gate.thresholdDb);

  return (
    <div className={`${styles.placeholderPanel} ${styles.inspectorFullGraphPanel}`}>
      <div className={styles.graphCardHead}>
        <span className={styles.eyebrow}>Dynamics · TotalMix FX</span>
        <span className={styles.dynamicsPills}>
          <button
            aria-pressed={selectedChannel.dynamics.compressor.enabled}
            data-active={selectedChannel.dynamics.compressor.enabled}
            onClick={() =>
              onUpdateChannelDynamics({
                channelId: selectedChannel.id,
                enabled: !selectedChannel.dynamics.compressor.enabled,
                section: "compressor",
              })
            }
            type="button"
          >
            Comp
          </button>
          <button
            aria-pressed={selectedChannel.dynamics.gate.enabled}
            data-active={selectedChannel.dynamics.gate.enabled}
            onClick={() =>
              onUpdateChannelDynamics({
                channelId: selectedChannel.id,
                enabled: !selectedChannel.dynamics.gate.enabled,
                section: "gate",
              })
            }
            type="button"
          >
            Gate
          </button>
        </span>
      </div>
      <div
        className={styles.dynamicsGraphFull}
        data-active={selectedChannel.dynamics.compressor.enabled}
        data-testid="audio-dynamics-curve"
        aria-hidden="true"
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d={dynamicsCurve} />
          <circle cx={dynamicsCurvePoint.x} cy={dynamicsCurvePoint.y} r="3" />
        </svg>
        <i
          data-active={selectedChannel.dynamics.gate.enabled}
          style={{ "--dynamics-gate-x": `${gateThresholdX}%` } as CSSProperties}
        />
      </div>
      <div className={styles.graphRangeRow} data-testid="audio-dynamics-range">
        <span>Gate {selectedChannel.dynamics.gate.thresholdDb.toFixed(0)} dB</span>
        <strong>{dynamicsStatusText(selectedChannel)}</strong>
        <span>Comp {selectedChannel.dynamics.compressor.thresholdDb.toFixed(0)} dB</span>
      </div>
      <div className={styles.sendStack}>
        {(["compressor", "gate"] as const).map((section) => {
          const processor = selectedChannel.dynamics[section];
          const attackKey = `channel:${selectedChannel.id}:dynamics:${section}:attack`;
          const attackValue = getDraftValue(attackKey, processor.attackMs);
          const makeupKey = `channel:${selectedChannel.id}:dynamics:${section}:makeup`;
          const makeupValue = getDraftValue(makeupKey, processor.makeupDb);
          const releaseKey = `channel:${selectedChannel.id}:dynamics:${section}:release`;
          const releaseValue = getDraftValue(releaseKey, processor.releaseMs);
          const thresholdKey = `channel:${selectedChannel.id}:dynamics:${section}:threshold`;
          const thresholdValue = getDraftValue(thresholdKey, processor.thresholdDb);
          const ratioKey = `channel:${selectedChannel.id}:dynamics:${section}:ratio`;
          const ratioValue = getDraftValue(ratioKey, processor.ratio);
          return (
            <div className={styles.sendCardFull} data-active={processor.enabled} key={section}>
              <div className={styles.sendCardHead}>
                <strong>{section === "compressor" ? "Compressor" : "Gate"}</strong>
                <span className={styles.sendCardTag}>{processor.enabled ? "Enabled" : "Bypassed"}</span>
              </div>
              <div className={styles.processingControlGrid}>
                <label className={styles.processingControl}>
                  <span>Thresh</span>
                  <AudioSliderControl
                    disabled={!viewModel.capabilities.canEditProcessing}
                    label={`${selectedChannel.name} ${section} threshold`}
                    max={0}
                    min={-80}
                    onCommit={(value) => {
                      setDraftValue(thresholdKey, value);
                      onUpdateChannelDynamics({
                        channelId: selectedChannel.id,
                        section,
                        thresholdDb: value,
                      });
                      clearDraftValueLater(thresholdKey);
                    }}
                    onPreview={(value) => setDraftValue(thresholdKey, value)}
                    orientation="horizontal"
                    step={1}
                    value={thresholdValue}
                    valueText={`${thresholdValue.toFixed(0)} dB`}
                  />
                  <strong>{thresholdValue.toFixed(0)} dB</strong>
                </label>
                <label className={styles.processingControl}>
                  <span>Ratio</span>
                  <AudioSliderControl
                    disabled={!viewModel.capabilities.canEditProcessing}
                    label={`${selectedChannel.name} ${section} ratio`}
                    max={20}
                    min={1}
                    onCommit={(value) => {
                      setDraftValue(ratioKey, value);
                      onUpdateChannelDynamics({
                        channelId: selectedChannel.id,
                        ratio: value,
                        section,
                      });
                      clearDraftValueLater(ratioKey);
                    }}
                    onPreview={(value) => setDraftValue(ratioKey, value)}
                    orientation="horizontal"
                    step={0.5}
                    value={ratioValue}
                    valueText={`${ratioValue.toFixed(1)}:1`}
                  />
                  <strong>{ratioValue.toFixed(1)}:1</strong>
                </label>
                <label className={styles.processingControl}>
                  <span>Attack</span>
                  <AudioSliderControl
                    disabled={!viewModel.capabilities.canEditProcessing}
                    label={`${selectedChannel.name} ${section} attack`}
                    max={200}
                    min={0.1}
                    onCommit={(value) => {
                      setDraftValue(attackKey, value);
                      onUpdateChannelDynamics({
                        attackMs: value,
                        channelId: selectedChannel.id,
                        section,
                      });
                      clearDraftValueLater(attackKey);
                    }}
                    onPreview={(value) => setDraftValue(attackKey, value)}
                    orientation="horizontal"
                    step={0.1}
                    value={attackValue}
                    valueText={`${attackValue.toFixed(1)} ms`}
                  />
                  <strong>{attackValue.toFixed(1)} ms</strong>
                </label>
                <label className={styles.processingControl}>
                  <span>Release</span>
                  <AudioSliderControl
                    disabled={!viewModel.capabilities.canEditProcessing}
                    label={`${selectedChannel.name} ${section} release`}
                    max={1000}
                    min={10}
                    onCommit={(value) => {
                      setDraftValue(releaseKey, value);
                      onUpdateChannelDynamics({
                        channelId: selectedChannel.id,
                        releaseMs: value,
                        section,
                      });
                      clearDraftValueLater(releaseKey);
                    }}
                    onPreview={(value) => setDraftValue(releaseKey, value)}
                    orientation="horizontal"
                    step={5}
                    value={releaseValue}
                    valueText={`${releaseValue.toFixed(0)} ms`}
                  />
                  <strong>{releaseValue.toFixed(0)} ms</strong>
                </label>
                <label className={styles.processingControl}>
                  <span>Makeup</span>
                  <AudioSliderControl
                    disabled={!viewModel.capabilities.canEditProcessing}
                    label={`${selectedChannel.name} ${section} makeup`}
                    max={24}
                    min={-24}
                    onCommit={(value) => {
                      setDraftValue(makeupKey, value);
                      onUpdateChannelDynamics({
                        channelId: selectedChannel.id,
                        makeupDb: value,
                        section,
                      });
                      clearDraftValueLater(makeupKey);
                    }}
                    onPreview={(value) => setDraftValue(makeupKey, value)}
                    orientation="horizontal"
                    step={0.5}
                    value={makeupValue}
                    valueText={`${makeupValue.toFixed(1)} dB`}
                  />
                  <strong>{makeupValue.toFixed(1)} dB</strong>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
