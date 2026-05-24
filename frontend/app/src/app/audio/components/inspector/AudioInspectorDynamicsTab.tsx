import type { CSSProperties } from "react";

import styles from "../AudioInspector.module.css";
import tabStyles from "../AudioInspectorDynamicsTab.module.css";
import eqStyles from "../AudioInspectorEqTab.module.css";
import sendStyles from "../AudioInspectorSendsTab.module.css";
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
    <div className={`${styles.placeholderPanel} ${eqStyles.inspectorFullGraphPanel}`}>
      <div className={styles.graphCardHead}>
        <span className={styles.eyebrow}>Dynamics · TotalMix FX</span>
        <span className={tabStyles.dynamicsPills}>
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
        className={tabStyles.dynamicsGraphFull}
        data-active={selectedChannel.dynamics.compressor.enabled}
        data-testid="audio-dynamics-curve"
        aria-hidden="true"
      >
        {/* Phase 3 follow-up G28: always-visible -60 / 0 dB axis cues so a
            bypassed 1:1 curve doesn't read as "no data" — the axes are
            calibrated and labelled regardless of whether the compressor
            is engaged. */}
        <span className={tabStyles.dynamicsAxisLabel} data-axis-position="top-left">
          0 dB
        </span>
        <span className={tabStyles.dynamicsAxisLabel} data-axis-position="top-right">
          0 dB
        </span>
        <span className={tabStyles.dynamicsAxisLabel} data-axis-position="bottom-left">
          -60 dB
        </span>
        <span className={tabStyles.dynamicsAxisLabel} data-axis-position="bottom-right">
          -60 dB
        </span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d={dynamicsCurve} />
          <circle cx={dynamicsCurvePoint.x} cy={dynamicsCurvePoint.y} r="3" />
        </svg>
        <i
          data-active={selectedChannel.dynamics.gate.enabled}
          style={{ "--dynamics-gate-x": `${gateThresholdX}%` } as CSSProperties}
        />
      </div>
      {/* Phase 3 follow-up G27: monospace Threshold/Ratio/Makeup readout
          cluster — three at-rest facts that name the compressor's current
          curve in numerals, so the graph and the numbers reinforce each
          other. Data from selectedChannel.dynamics.compressor; no engine
          change required. */}
      <div className={tabStyles.dynamicsReadoutCluster} data-testid="audio-dynamics-readout-cluster">
        <span>
          <small>Threshold</small>
          <strong>{selectedChannel.dynamics.compressor.thresholdDb.toFixed(0)} dB</strong>
        </span>
        <span>
          <small>Ratio</small>
          <strong>{selectedChannel.dynamics.compressor.ratio.toFixed(1)}:1</strong>
        </span>
        <span>
          <small>Makeup</small>
          <strong>+{selectedChannel.dynamics.compressor.makeupDb.toFixed(1)} dB</strong>
        </span>
      </div>
      <div className={eqStyles.graphRangeRow} data-testid="audio-dynamics-range">
        <span>Gate {selectedChannel.dynamics.gate.thresholdDb.toFixed(0)} dB</span>
        <strong>{dynamicsStatusText(selectedChannel)}</strong>
        <span>Comp {selectedChannel.dynamics.compressor.thresholdDb.toFixed(0)} dB</span>
      </div>
      <div className={sendStyles.sendStack}>
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
            <div className={sendStyles.sendCardFull} data-active={processor.enabled} key={section}>
              <div className={sendStyles.sendCardHead}>
                <strong>{section === "compressor" ? "Compressor" : "Gate"}</strong>
                <span className={sendStyles.sendCardTag}>{processor.enabled ? "Enabled" : "Bypassed"}</span>
              </div>
              <div className={tabStyles.processingControlGrid}>
                <label className={tabStyles.processingControl}>
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
                <label className={tabStyles.processingControl}>
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
                <label className={tabStyles.processingControl}>
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
                <label className={tabStyles.processingControl}>
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
                <label className={tabStyles.processingControl}>
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
