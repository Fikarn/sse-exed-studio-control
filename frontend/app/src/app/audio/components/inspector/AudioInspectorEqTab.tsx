import type { CSSProperties, MutableRefObject, PointerEvent as ReactPointerEvent } from "react";

import styles from "../AudioInspector.module.css";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioInspectorEqBandTray } from "./AudioInspectorEqBandTray";
import { AudioInspectorEqLowCutTray } from "./AudioInspectorEqLowCutTray";
import {
  EQ_FREQUENCY_MARKERS,
  EQ_GAIN_MARKERS,
  eqPointX,
  eqPointY,
  LOW_CUT_HANDLE_ID,
  type AudioEqBand,
  type AudioEqUpdate,
  type EqDragRef,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

export type { EqDragRef };

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
          <AudioInspectorEqLowCutTray
            clearDraftValueLater={clearDraftValueLater}
            lowCutFrequencyKey={lowCutFrequencyKey}
            lowCutFrequencyValue={lowCutFrequencyValue}
            onUpdateChannelEq={onUpdateChannelEq}
            selectedChannel={selectedChannel}
            setDraftValue={setDraftValue}
            setSelectedEqBandId={setSelectedEqBandId}
            viewModel={viewModel}
          />
        ) : activeEqBand ? (
          <AudioInspectorEqBandTray
            activeEqBand={activeEqBand}
            activeEqBandFrequencyKey={activeEqBandFrequencyKey}
            activeEqBandFrequencyValue={activeEqBandFrequencyValue}
            activeEqBandGainKey={activeEqBandGainKey}
            activeEqBandGainValue={activeEqBandGainValue}
            activeEqBandQKey={activeEqBandQKey}
            activeEqBandQValue={activeEqBandQValue}
            activeEqBandTypeOptions={activeEqBandTypeOptions}
            canChangeBandType={canChangeBandType}
            clearDraftValueLater={clearDraftValueLater}
            onUpdateChannelEq={onUpdateChannelEq}
            selectedChannel={selectedChannel}
            setDraftValue={setDraftValue}
            setSelectedEqBandId={setSelectedEqBandId}
            viewModel={viewModel}
          />
        ) : null}
      </div>
    </div>
  );
}
