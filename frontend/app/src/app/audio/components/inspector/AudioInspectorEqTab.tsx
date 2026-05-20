import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent } from "react";

import styles from "../../AudioWorkspace.module.css";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioSliderControl } from "../AudioSliderControl";
import {
  EQ_FREQUENCY_MARKERS,
  EQ_FREQUENCY_MAX,
  EQ_FREQUENCY_MIN,
  EQ_GAIN_MARKERS,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_Q_MAX,
  EQ_Q_MIN,
  eqBandId,
  eqBandType,
  eqPointX,
  eqPointY,
  formatEqBandType,
  formatEqFrequency,
  LOW_CUT_FREQUENCY_MAX,
  LOW_CUT_FREQUENCY_MIN,
  LOW_CUT_HANDLE_ID,
  LOW_CUT_SLOPES,
  type AudioEqBand,
  type AudioEqUpdate,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

export interface EqDragRef {
  bandId: string;
  height: number;
  left: number;
  pointerId: number;
  top: number;
  width: number;
}

interface AudioInspectorEqTabProps {
  // Per-band draft keys/values resolved in the parent so the EQ tab + Overview
  // mini card render from the same source.
  activeEqBand: AudioEqBand | null;
  activeEqBandFrequencyKey: string;
  activeEqBandFrequencyValue: number;
  activeEqBandGainKey: string;
  activeEqBandGainValue: number;
  activeEqBandQKey: string;
  activeEqBandQValue: number;
  activeEqBandTypeOptions: readonly string[];
  activeEqHandleId: string | null;
  activeEqLabel: string;
  activeEqValue: string;
  canChangeBandType: boolean;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitEqPointFromPointer: (
    event: ReactPointerEvent<HTMLButtonElement>,
    band: AudioEqBand,
    mode?: "schedule" | "flush"
  ) => void;
  commitLowCutFromPointer: (event: ReactPointerEvent<HTMLButtonElement>, mode?: "schedule" | "flush") => void;
  eqBands: AudioEqBand[];
  eqDragRef: MutableRefObject<EqDragRef | null>;
  eqGraphPath: string;
  lowCutFrequencyKey: string;
  lowCutFrequencyValue: number;
  lowCutShade: string;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  selectedChannel: SelectedAudioChannel;
  setDraftValue: (key: string, value: number) => void;
  setSelectedEqBandId: (id: string | null) => void;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * EQ tab body. Renders the band-selector tag strip, the full-size response
 * curve graph with pointer-driven band handles, the value badge, and the
 * Low Cut / per-band control trays.
 *
 * EQ state (selected band, graph draft, drag ref, throttled commit) lives in
 * the parent so the channel Overview mini card and this tab read from the
 * same source — both render the same `eqGraphPath` while a drag is in flight.
 */
export function AudioInspectorEqTab({
  activeEqBand,
  activeEqBandFrequencyKey,
  activeEqBandFrequencyValue,
  activeEqBandGainKey,
  activeEqBandGainValue,
  activeEqBandQKey,
  activeEqBandQValue,
  activeEqBandTypeOptions,
  activeEqHandleId,
  activeEqLabel,
  activeEqValue,
  canChangeBandType,
  clearDraftValueLater,
  commitEqPointFromPointer,
  commitLowCutFromPointer,
  eqBands,
  eqDragRef,
  eqGraphPath,
  lowCutFrequencyKey,
  lowCutFrequencyValue,
  lowCutShade,
  onUpdateChannelEq,
  selectedChannel,
  setDraftValue,
  setSelectedEqBandId,
  viewModel,
}: AudioInspectorEqTabProps) {
  return (
    <div className={`${styles.placeholderPanel} ${styles.inspectorFullGraphPanel}`}>
      <div className={styles.graphCardHead}>
        <span className={styles.eyebrow}>TotalMix FX EQ · Low Cut + 3-band PEQ</span>
        <span className={styles.eqBandRow}>
          <button
            aria-pressed={activeEqHandleId === LOW_CUT_HANDLE_ID}
            data-active={selectedChannel.eq.lowCut.enabled}
            data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}
            onClick={() => setSelectedEqBandId(LOW_CUT_HANDLE_ID)}
            type="button"
          >
            LC
          </button>
          {eqBands.map((band) => (
            <button
              aria-pressed={band.id === activeEqHandleId}
              data-active={selectedChannel.eq.enabled}
              data-selected={band.id === activeEqHandleId}
              key={band.id}
              onClick={() => setSelectedEqBandId(band.id)}
              type="button"
            >
              {band.label}
            </button>
          ))}
        </span>
      </div>
      <div className={styles.eqGraphFull} data-eq-graph="true" data-testid="audio-eq-graph">
        <div className={styles.eqGraphGuideLayer} aria-hidden="true">
          <div className={styles.eqGraphDbMarkers} data-testid="audio-eq-db-scale">
            {EQ_GAIN_MARKERS.map((marker) => (
              <span
                className={styles.eqGraphDbLabel}
                key={marker.label}
                style={{ "--eq-marker-y": `${eqPointY(marker.gainDb)}%` } as CSSProperties}
              >
                {marker.label}
              </span>
            ))}
          </div>
          <div className={styles.eqGraphFrequencyMarkers} data-testid="audio-eq-frequency-markers">
            {EQ_FREQUENCY_MARKERS.map((marker) => (
              <span
                className={styles.eqGraphFrequencyMarker}
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
          {lowCutShade ? (
            <path className={styles.eqLowCutShade} d={lowCutShade} data-testid="audio-eq-low-cut-shade" />
          ) : null}
          <path d={eqGraphPath} />
        </svg>
        <div className={styles.eqValueBadge} data-testid="audio-eq-value-badge">
          <strong>{activeEqLabel}</strong>
          <span>{activeEqValue}</span>
        </div>
        <div className={styles.eqPointLayer} aria-label="EQ graph band points">
          <button
            aria-label={`${selectedChannel.name} Low Cut EQ point`}
            className={`${styles.eqPoint} ${styles.eqLowCutPoint}`}
            data-active={selectedChannel.eq.lowCut.enabled}
            data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}
            data-testid="audio-eq-point-low-cut"
            disabled={!viewModel.capabilities.canEditProcessing}
            onClick={() => setSelectedEqBandId(LOW_CUT_HANDLE_ID)}
            onPointerCancel={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              commitLowCutFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              event.preventDefault();
              event.stopPropagation();
              commitLowCutFromPointer(event);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.preventDefault();
                event.stopPropagation();
                commitLowCutFromPointer(event, "flush");
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            style={
              {
                "--eq-point-x": `${eqPointX(lowCutFrequencyValue)}%`,
                "--eq-point-y": `${eqPointY(0)}%`,
              } as CSSProperties
            }
            type="button"
          >
            <span>LC</span>
          </button>
          {eqBands.map((band) => (
            <button
              aria-label={`${selectedChannel.name} Band ${band.label} EQ point`}
              className={styles.eqPoint}
              data-selected={band.id === activeEqHandleId}
              data-testid={`audio-eq-point-${band.id}`}
              disabled={!viewModel.capabilities.canEditProcessing}
              key={band.id}
              onClick={() => setSelectedEqBandId(band.id)}
              onPointerCancel={(event) => {
                eqDragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const graph = event.currentTarget.closest("[data-eq-graph]");
                if (graph instanceof HTMLElement) {
                  const rect = graph.getBoundingClientRect();
                  eqDragRef.current = {
                    bandId: band.id,
                    height: Math.max(1, rect.height),
                    left: rect.left,
                    pointerId: event.pointerId,
                    top: rect.top,
                    width: Math.max(1, rect.width),
                  };
                }
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                commitEqPointFromPointer(event, band);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                event.preventDefault();
                event.stopPropagation();
                commitEqPointFromPointer(event, band);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.preventDefault();
                  event.stopPropagation();
                  commitEqPointFromPointer(event, band, "flush");
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
                eqDragRef.current = null;
              }}
              style={
                {
                  "--eq-point-x": `${eqPointX(band.frequencyHz)}%`,
                  "--eq-point-y": `${eqPointY(band.gainDb)}%`,
                } as CSSProperties
              }
              type="button"
            >
              <span>{band.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.graphRangeRow} data-testid="audio-eq-range">
        <span>20 Hz</span>
        <strong>
          {activeEqLabel} · {selectedChannel.eq.hardwareStatus}
        </strong>
        <span>20 kHz · ±20 dB</span>
      </div>
      <div className={`${styles.sendCardFull} ${styles.eqControlTray}`} data-testid="audio-eq-control-tray">
        {activeEqHandleId === LOW_CUT_HANDLE_ID ? (
          <>
            <div className={styles.sendCardHead}>
              <strong>Low Cut</strong>
              <span className={styles.sendCardTag}>
                {selectedChannel.eq.lowCut.enabled ? "In" : "Out"} · {selectedChannel.eq.lowCut.slopeDbPerOctave} dB/oct
              </span>
            </div>
            <div className={styles.eqModeRow}>
              <button
                aria-pressed={selectedChannel.eq.lowCut.enabled}
                data-active={selectedChannel.eq.lowCut.enabled}
                disabled={!viewModel.capabilities.canEditProcessing}
                onClick={() =>
                  onUpdateChannelEq({
                    channelId: selectedChannel.id,
                    lowCutEnabled: !selectedChannel.eq.lowCut.enabled,
                  })
                }
                type="button"
              >
                {selectedChannel.eq.lowCut.enabled ? "Bypass Low Cut" : "Enable Low Cut"}
              </button>
              {LOW_CUT_SLOPES.map((slope) => (
                <button
                  aria-pressed={selectedChannel.eq.lowCut.slopeDbPerOctave === slope}
                  data-active={selectedChannel.eq.lowCut.slopeDbPerOctave === slope}
                  disabled={!viewModel.capabilities.canEditProcessing}
                  key={slope}
                  onClick={() =>
                    onUpdateChannelEq({
                      channelId: selectedChannel.id,
                      lowCutSlopeDbPerOctave: slope,
                    })
                  }
                  type="button"
                >
                  {slope}
                </button>
              ))}
            </div>
            <div className={styles.processingControlGrid}>
              <label className={styles.processingControl}>
                <span>Cutoff</span>
                <AudioSliderControl
                  disabled={!viewModel.capabilities.canEditProcessing}
                  label={`${selectedChannel.name} Low Cut frequency`}
                  max={LOW_CUT_FREQUENCY_MAX}
                  min={LOW_CUT_FREQUENCY_MIN}
                  onCommit={(value) => {
                    setSelectedEqBandId(LOW_CUT_HANDLE_ID);
                    setDraftValue(lowCutFrequencyKey, value);
                    onUpdateChannelEq({
                      channelId: selectedChannel.id,
                      lowCutFrequencyHz: value,
                    });
                    clearDraftValueLater(lowCutFrequencyKey);
                  }}
                  onPreview={(value) => setDraftValue(lowCutFrequencyKey, value)}
                  orientation="horizontal"
                  step={1}
                  value={lowCutFrequencyValue}
                  valueText={formatEqFrequency(lowCutFrequencyValue)}
                />
                <strong>{formatEqFrequency(lowCutFrequencyValue)}</strong>
              </label>
            </div>
          </>
        ) : activeEqBand ? (
          <>
            <div className={styles.sendCardHead}>
              <strong>Band {activeEqBand.label}</strong>
              <span className={styles.sendCardTag}>
                {formatEqBandType(activeEqBand.bandType)} · {selectedChannel.eq.enabled ? "PEQ in" : "PEQ bypassed"}
              </span>
            </div>
            <div className={styles.eqModeRow}>
              <button
                aria-pressed={selectedChannel.eq.enabled}
                data-active={selectedChannel.eq.enabled}
                disabled={!viewModel.capabilities.canEditProcessing}
                onClick={() =>
                  onUpdateChannelEq({ channelId: selectedChannel.id, enabled: !selectedChannel.eq.enabled })
                }
                type="button"
              >
                {selectedChannel.eq.enabled ? "Bypass PEQ" : "Enable PEQ"}
              </button>
              {activeEqBandTypeOptions.map((option) => (
                <button
                  aria-pressed={activeEqBand.bandType === option}
                  data-active={activeEqBand.bandType === option}
                  // Why: TotalMix Band 2 is fixed to Bell — operator cannot change
                  // its band type. The capability flag keeps that decision in one
                  // place and lets future Rust contract changes (eg. unlocking the
                  // shape) collapse to a single update site.
                  disabled={!viewModel.capabilities.canEditProcessing || !canChangeBandType}
                  key={option}
                  onClick={() =>
                    onUpdateChannelEq({
                      bandId: eqBandId(activeEqBand.id),
                      bandType: eqBandType(option),
                      channelId: selectedChannel.id,
                    })
                  }
                  type="button"
                >
                  {formatEqBandType(option)}
                </button>
              ))}
            </div>
            <div className={styles.processingControlGrid}>
              <label className={styles.processingControl}>
                <span>Freq</span>
                <AudioSliderControl
                  disabled={!viewModel.capabilities.canEditProcessing}
                  label={`${selectedChannel.name} Band ${activeEqBand.label} EQ frequency`}
                  max={EQ_FREQUENCY_MAX}
                  min={EQ_FREQUENCY_MIN}
                  onCommit={(value) => {
                    setSelectedEqBandId(activeEqBand.id);
                    setDraftValue(activeEqBandFrequencyKey, value);
                    onUpdateChannelEq({
                      bandId: eqBandId(activeEqBand.id),
                      channelId: selectedChannel.id,
                      frequencyHz: value,
                    });
                    clearDraftValueLater(activeEqBandFrequencyKey);
                  }}
                  onPreview={(value) => setDraftValue(activeEqBandFrequencyKey, value)}
                  orientation="horizontal"
                  step={10}
                  value={activeEqBandFrequencyValue}
                  valueText={formatEqFrequency(activeEqBandFrequencyValue)}
                />
                <strong>{formatEqFrequency(activeEqBandFrequencyValue)}</strong>
              </label>
              <label className={styles.processingControl}>
                <span>Gain</span>
                <AudioSliderControl
                  disabled={!viewModel.capabilities.canEditProcessing}
                  label={`${selectedChannel.name} Band ${activeEqBand.label} EQ gain`}
                  max={EQ_GAIN_MAX}
                  min={EQ_GAIN_MIN}
                  onCommit={(value) => {
                    setSelectedEqBandId(activeEqBand.id);
                    setDraftValue(activeEqBandGainKey, value);
                    onUpdateChannelEq({
                      bandId: eqBandId(activeEqBand.id),
                      channelId: selectedChannel.id,
                      gainDb: value,
                    });
                    clearDraftValueLater(activeEqBandGainKey);
                  }}
                  onPreview={(value) => setDraftValue(activeEqBandGainKey, value)}
                  orientation="horizontal"
                  step={0.5}
                  value={activeEqBandGainValue}
                  valueText={`${activeEqBandGainValue.toFixed(1)} dB`}
                />
                <strong>{activeEqBandGainValue.toFixed(1)} dB</strong>
              </label>
              <label className={styles.processingControl}>
                <span>Q</span>
                <AudioSliderControl
                  disabled={!viewModel.capabilities.canEditProcessing}
                  label={`${selectedChannel.name} Band ${activeEqBand.label} EQ Q`}
                  max={EQ_Q_MAX}
                  min={EQ_Q_MIN}
                  onCommit={(value) => {
                    setSelectedEqBandId(activeEqBand.id);
                    setDraftValue(activeEqBandQKey, value);
                    onUpdateChannelEq({
                      bandId: eqBandId(activeEqBand.id),
                      channelId: selectedChannel.id,
                      q: value,
                    });
                    clearDraftValueLater(activeEqBandQKey);
                  }}
                  onPreview={(value) => setDraftValue(activeEqBandQKey, value)}
                  orientation="horizontal"
                  step={0.1}
                  value={activeEqBandQValue}
                  valueText={`Q ${activeEqBandQValue.toFixed(1)}`}
                />
                <strong>Q {activeEqBandQValue.toFixed(1)}</strong>
              </label>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
