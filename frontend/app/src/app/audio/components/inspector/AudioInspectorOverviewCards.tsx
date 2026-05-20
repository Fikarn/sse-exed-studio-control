import type { CSSProperties } from "react";

import styles from "../../AudioWorkspace.module.css";
import { formatAudioDb } from "../../audioFormatting";
import type { AudioMixTargetEntry } from "../../../shellData";
import { selectedChannelSendLevel, type AudioWorkspaceViewModel } from "../../audioViewModel";
import {
  dynamicsStatusText,
  eqStatusText,
  LOW_CUT_HANDLE_ID,
  outputRouteText,
  type AudioEqBand,
  type InspectorTab,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

interface AudioInspectorOverviewCardsProps {
  // Active EQ/dynamics derived values come from the parent so this mini view
  // tracks the same draft state the EQ tab is editing.
  activeEqHandleId: string | null;
  dynamicsCurve: string;
  dynamicsCurvePoint: { x: number; y: number };
  eqBands: AudioEqBand[];
  eqGraphPath: string;
  gateThresholdX: number;
  lowCutShade: string;
  monitorValue: number;
  onActiveTabChange: (tab: InspectorTab) => void;
  selectedChannel: SelectedAudioChannel | null;
  selectedMixTarget: AudioMixTargetEntry | null;
  selectedSendLevel: number;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * Overview tab cards. Three branches:
 * - selectedChannel → Route / EQ / Dynamics mini cards that double as
 *   "jump-to-this-tab" buttons.
 * - selectedMixTarget (no channel) → Output / Output state / Output processing
 *   / Trust mini cards.
 * - neither → empty state with selection hint.
 *
 * EQ + dynamics graph data is computed by the parent so this overview tracks
 * the same draft state the EQ tab is editing.
 */
export function AudioInspectorOverviewCards({
  activeEqHandleId,
  dynamicsCurve,
  dynamicsCurvePoint,
  eqBands,
  eqGraphPath,
  gateThresholdX,
  lowCutShade,
  monitorValue,
  onActiveTabChange,
  selectedChannel,
  selectedMixTarget,
  selectedSendLevel,
  viewModel,
}: AudioInspectorOverviewCardsProps) {
  if (selectedChannel) {
    return (
      <div className={`${styles.inspectorMiniGrid} ${styles.channelOverviewGrid}`}>
        <button
          aria-label="Open sends tab"
          className={`${styles.inspectorMiniCard} ${styles.routingMiniCard} ${styles.overviewPrimaryCard} ${styles.overviewRouteCard}`}
          data-testid="audio-inspector-sends-mini"
          onClick={() => onActiveTabChange("sends")}
          type="button"
        >
          <span className={styles.graphCardHead}>
            <span className={styles.eyebrow}>Route · Sends from this source</span>
            <span>{viewModel.mixTargets.length} destinations</span>
          </span>
          <span className={styles.routingGraphMini} aria-hidden="true">
            <span className={styles.routingSourceNode}>
              <strong>{selectedChannel.name}</strong>
              <small>{formatAudioDb(selectedSendLevel)}</small>
            </span>
            <svg className={styles.routingCurve} viewBox="0 0 64 72" preserveAspectRatio="none" aria-hidden="true">
              <path d="M1 36 C21 36 28 11 63 11" />
              <path d="M1 36 C24 36 30 36 63 36" />
              <path d="M1 36 C21 36 28 61 63 61" />
            </svg>
            <span className={styles.routingTargetStack}>
              {viewModel.mixTargets.map((mixTarget) => {
                const value = selectedChannelSendLevel(selectedChannel, mixTarget.id);
                const sendMode = selectedChannel.sendModes[mixTarget.id];
                const muted = selectedChannel.mute || sendMode?.mute === true;
                const noSend = value <= 0.01;
                return (
                  <span
                    className={styles.routingTargetNode}
                    data-active={mixTarget.id === viewModel.selectedMixTargetId}
                    data-send-state={muted ? "muted" : noSend ? "none" : "sending"}
                    key={mixTarget.id}
                  >
                    <strong>{mixTarget.name}</strong>
                    <small>{muted ? "muted" : formatAudioDb(value)}</small>
                  </span>
                );
              })}
            </span>
          </span>
        </button>

        <button
          aria-label="Open EQ tab"
          className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard} ${styles.overviewEqCard}`}
          data-testid="audio-inspector-eq-mini"
          onClick={() => onActiveTabChange("eq")}
          type="button"
        >
          <span className={styles.graphCardHead}>
            <span className={styles.eyebrow}>EQ · {eqStatusText(selectedChannel)}</span>
            <span className={styles.eqBandRow}>
              <i data-active={selectedChannel.eq.lowCut.enabled} data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}>
                LC
              </i>
              {eqBands.map((band) => (
                <i data-active={selectedChannel.eq.enabled} data-selected={band.id === activeEqHandleId} key={band.id}>
                  {band.label}
                </i>
              ))}
            </span>
          </span>
          <span className={styles.eqGraphMini} aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              {lowCutShade ? <path className={styles.eqLowCutShade} d={lowCutShade} /> : null}
              <path d={eqGraphPath} />
            </svg>
          </span>
        </button>

        <button
          aria-label="Open processing tab"
          className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard} ${styles.overviewDynamicsCard}`}
          data-testid="audio-inspector-dynamics-mini"
          onClick={() => onActiveTabChange("dynamics")}
          type="button"
        >
          <span className={styles.graphCardHead}>
            <span className={styles.eyebrow}>Dynamics · {dynamicsStatusText(selectedChannel)}</span>
            <span className={styles.dynamicsPills}>
              <i data-active={selectedChannel.dynamics.compressor.enabled}>Comp</i>
              <i data-active={selectedChannel.dynamics.gate.enabled}>Gate</i>
            </span>
          </span>
          <span
            className={styles.dynamicsGraphMini}
            data-active={selectedChannel.dynamics.compressor.enabled}
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
          </span>
        </button>
      </div>
    );
  }

  if (selectedMixTarget) {
    return (
      <div className={`${styles.inspectorMiniGrid} ${styles.outputInspectorGrid}`}>
        <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
          <span className={styles.eyebrow}>Output</span>
          <strong>
            {outputRouteText(selectedMixTarget.role)} · {selectedMixTarget.name}
          </strong>
          <span>Active monitor mix · TotalMix output state from the engine snapshot.</span>
          <div className={styles.detailGrid}>
            <span data-fact-size="long">
              <small>Clock</small>
              <strong title={viewModel.footerTelemetry.clock}>{viewModel.footerTelemetry.clock}</strong>
            </span>
            <span data-fact-size="long">
              <small>Metering</small>
              <strong title={viewModel.footerTelemetry.metering}>{viewModel.footerTelemetry.metering}</strong>
            </span>
          </div>
        </section>

        <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
          <span className={styles.eyebrow}>Output state</span>
          <strong>{selectedMixTarget.mute ? "Muted" : "Passing signal"}</strong>
          <span>Monitor level and safety toggles are live controls for this output.</span>
          <div className={styles.detailGrid}>
            <span>
              <small>Level</small>
              <strong>{formatAudioDb(monitorValue)}</strong>
            </span>
            <span>
              <small>Dim</small>
              <strong>{selectedMixTarget.dim ? "On" : "Off"}</strong>
            </span>
            <span>
              <small>Mono</small>
              <strong>{selectedMixTarget.mono ? "On" : "Off"}</strong>
            </span>
            <span>
              <small>Talkback</small>
              <strong>{selectedMixTarget.talkback ? "On" : "Off"}</strong>
            </span>
          </div>
        </section>

        <section className={`${styles.inspectorMiniCard} ${styles.sourceCard} ${styles.subduedInspectorCard}`}>
          <span className={styles.eyebrow}>Output processing</span>
          <strong>Monitor controls active</strong>
          <span>
            EQ, dynamics, send solo, PFL, and level test stay hidden until the engine exposes real output commands.
          </span>
        </section>

        <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
          <span className={styles.eyebrow}>Trust</span>
          <strong>{viewModel.status.label}</strong>
          <span title={viewModel.status.warningBody ?? viewModel.footerTelemetry.metering}>
            {viewModel.status.warningBody ?? viewModel.footerTelemetry.metering}
          </span>
          <div className={styles.detailGrid}>
            <span>
              <small>Solo</small>
              <strong>{viewModel.healthStats.soloedChannels}</strong>
            </span>
            <span>
              <small>Clips</small>
              <strong>{viewModel.healthStats.clippedChannels}</strong>
            </span>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.emptyInspector}>
      <h3>No channel selected</h3>
      <p>Use 1-8, click a lane, or the command palette to select a source. Output selection stays active.</p>
    </div>
  );
}
