import type { CSSProperties } from "react";

import styles from "../AudioInspector.module.css";
import tabStyles from "../AudioInspectorEqTab.module.css";
import {
  EQ_GAIN_MARKERS,
  EQ_PREVIEW_FREQUENCY_MARKERS,
  eqPointX,
  eqPointY,
  LOW_CUT_HANDLE_ID,
  type AudioEqBand,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

interface AudioInspectorEqPreviewCardProps {
  activeEqHandleId: string | null;
  activeEqLabel: string;
  activeEqValue: string;
  eqBands: AudioEqBand[];
  eqGraphPath: string;
  lowCutShade: string;
  selectedChannel: SelectedAudioChannel;
}

/**
 * Claude Design polish (DP4): a read-only EQ mini-preview pinned to the Preamp
 * tab body (source → EQ → send → meter), so the channel's EQ shape is visible
 * at a glance without leaving the tab.
 *
 * Presentation only: it reuses the EQ tab's own `eqGraphFull` styling (imported
 * from AudioInspectorEqTab.module.css) and the SAME live EQ draft data the EQ
 * tab edits — `eqGraphPath` / `eqBands` / `lowCutShade` are computed once in the
 * parent's `useAudioInspectorEqState` hook and threaded to both surfaces, so the
 * preview tracks the EQ tab in real time. The band handles are inert `<span>`s
 * (no pointer handlers; `pointer-events:none` via the `.eqPreviewCard` scope),
 * and the whole graph is `aria-hidden` — the editable copy is the EQ tab.
 */
export function AudioInspectorEqPreviewCard({
  activeEqHandleId,
  activeEqLabel,
  activeEqValue,
  eqBands,
  eqGraphPath,
  lowCutShade,
  selectedChannel,
}: AudioInspectorEqPreviewCardProps) {
  const eqOn = selectedChannel.eq.enabled;
  const lowCutEnabled = selectedChannel.eq.lowCut.enabled;
  const lowCutFrequencyHz = selectedChannel.eq.lowCut.frequencyHz;

  return (
    <section className={`${styles.inspectorMiniCard} ${styles.eqPreviewCard}`} data-testid="audio-inspector-eq-preview">
      <div className={tabStyles.eqGridHeader}>
        <span>Equalizer</span>
        <span className={tabStyles.eqEnableButton} data-active={eqOn}>
          {eqOn ? `On · ${eqBands.length}-Band` : "Bypassed"}
        </span>
      </div>
      <div className={tabStyles.eqGraphFull} data-eq-preview="true" data-eq-enabled={eqOn} aria-hidden="true">
        <div className={tabStyles.eqGraphGuideLayer}>
          <div className={tabStyles.eqGraphDbMarkers}>
            {EQ_GAIN_MARKERS.map((marker) => (
              <span
                className={tabStyles.eqGraphDbLabel}
                key={marker.label}
                style={{ "--eq-marker-y": `${eqPointY(marker.gainDb)}%` } as CSSProperties}
              >
                {marker.label}
              </span>
            ))}
          </div>
          <div className={tabStyles.eqGraphFrequencyMarkers}>
            {EQ_PREVIEW_FREQUENCY_MARKERS.map((marker) => (
              <span
                className={tabStyles.eqGraphFrequencyMarker}
                data-major={marker.major}
                key={marker.frequencyHz}
                style={{ "--eq-marker-x": `${eqPointX(marker.frequencyHz)}%` } as CSSProperties}
              >
                <i />
                <small>{marker.label}</small>
              </span>
            ))}
          </div>
        </div>
        <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
          {lowCutShade ? <path className={styles.eqLowCutShade} d={lowCutShade} /> : null}
          <path d={eqGraphPath} />
        </svg>
        <div className={tabStyles.eqValueBadge} data-eq-preview-badge="true">
          <strong>{activeEqLabel}</strong>
          <span>{activeEqValue}</span>
        </div>
        <div className={tabStyles.eqPointLayer}>
          <span
            className={`${tabStyles.eqPoint} ${tabStyles.eqLowCutPoint}`}
            data-active={lowCutEnabled}
            data-eq-preview-point="lowCut"
            data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}
            style={
              {
                "--eq-point-x": `${eqPointX(lowCutFrequencyHz)}%`,
                "--eq-point-y": `${eqPointY(0)}%`,
              } as CSSProperties
            }
          >
            <span>LC</span>
          </span>
          {eqBands.map((band) => (
            <span
              className={tabStyles.eqPoint}
              data-eq-preview-point={band.id}
              data-ghost={!eqOn || Math.abs(band.gainDb) < 0.05}
              data-selected={band.id === activeEqHandleId}
              key={band.id}
              style={
                {
                  "--eq-point-x": `${eqPointX(band.frequencyHz)}%`,
                  "--eq-point-y": `${eqPointY(band.gainDb)}%`,
                } as CSSProperties
              }
            >
              <span>{band.label}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
