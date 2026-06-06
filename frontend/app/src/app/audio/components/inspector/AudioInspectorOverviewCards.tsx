import styles from "../AudioInspector.module.css";
import { AudioEmptyInspector } from "./AudioEmptyInspector";
import { formatAudioDb } from "../../audioFormatting";
import type { AudioMixTargetEntry } from "../../../shellData";
import { type AudioWorkspaceViewModel } from "../../audioViewModel";
import {
  outputRouteText,
  type AudioEqBand,
  type InspectorTab,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

// 2026-05-27 redesign: the channel-tab "overview" is collapsed to a small
// hint pointing at EQ / Dyn / Routing. Most of the cards' inputs are no
// longer read here, but the props stay so the parent in AudioInspector.tsx
// doesn't need restructuring. The `_*` underscore prefix opts the unused
// names out of `@typescript-eslint/no-unused-vars`.
interface AudioInspectorOverviewCardsProps {
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
 * - selectedChannel → a small hint pointing at EQ / Dyn / Routing (the EQ
 *   mini-preview itself lives in AudioInspector.tsx, above the send card).
 * - selectedMixTarget (no channel) → Output / Output state / Output processing
 *   / Trust mini cards.
 * - neither → empty state with selection hint.
 *
 * EQ + dynamics graph data is computed by the parent so this overview tracks
 * the same draft state the EQ tab is editing.
 */
export function AudioInspectorOverviewCards({
  activeEqHandleId: _activeEqHandleId,
  dynamicsCurve: _dynamicsCurve,
  dynamicsCurvePoint: _dynamicsCurvePoint,
  eqBands: _eqBands,
  eqGraphPath: _eqGraphPath,
  gateThresholdX: _gateThresholdX,
  lowCutShade: _lowCutShade,
  monitorValue,
  onActiveTabChange: _onActiveTabChange,
  selectedChannel,
  selectedMixTarget,
  selectedSendLevel: _selectedSendLevel,
  viewModel,
}: AudioInspectorOverviewCardsProps) {
  if (selectedChannel) {
    // 2026-05-27 Console redesign: the "Preamp" tab body no longer renders the
    // dense 3-card overview grid (Route / EQ / Dyn jump cards). The sticky
    // header above already shows preamp + toggles via HardwareCard, and the
    // dedicated EQ / Dyn / Routing tabs are one click away. Keeping the
    // overview here would duplicate the header and break the prototype's
    // calm rhythm.
    return (
      <div className={styles.preampTabHint} aria-hidden="true">
        <span className={styles.eyebrow}>Preamp set above</span>
        <p>
          Open <strong>EQ</strong>, <strong>Dyn</strong>, or <strong>Routing</strong> to dig deeper into this channel.
        </p>
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
              <strong title={viewModel.footerTelemetry.clock ?? undefined}>
                {viewModel.footerTelemetry.clock ?? "—"}
              </strong>
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
    <AudioEmptyInspector
      description="Use 1-8, click a lane, or the command palette to select a source. Output selection stays active."
      title="No channel selected"
    />
  );
}
