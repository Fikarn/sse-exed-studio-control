/**
 * All-bands EQ knob grid (2026-05-27 Console redesign). Renders the Low Cut
 * card + every PEQ band as a card with gain/freq/Q rotary knobs and the
 * per-band discrete controls (type / slope / enables) — all visible at once,
 * matching the prototype's Preamp/EQ panel. Replaces the previous
 * select-one-band tray.
 *
 * Knob values come from the draft-aware `eqBands` the EQ-state hook produces,
 * so they track the same source as the response curve.
 */
import tabStyles from "../AudioInspectorEqTab.module.css";
import dynamicsStyles from "../AudioInspectorDynamicsTab.module.css";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioKnob } from "../AudioKnob";
import {
  EQ_FREQUENCY_MAX,
  EQ_FREQUENCY_MIN,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_Q_MAX,
  EQ_Q_MIN,
  eqBandId,
  eqBandType,
  eqBandTypeOptionsFor,
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

interface AudioInspectorEqBandGridProps {
  activeEqHandleId: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  eqBands: AudioEqBand[];
  lowCutFrequencyKey: string;
  lowCutFrequencyValue: number;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  selectedChannel: SelectedAudioChannel;
  setDraftValue: (key: string, value: number) => void;
  setSelectedEqBandId: (id: string | null) => void;
  viewModel: AudioWorkspaceViewModel;
}

function formatEqGain(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

export function AudioInspectorEqBandGrid({
  activeEqHandleId,
  clearDraftValueLater,
  eqBands,
  lowCutFrequencyKey,
  lowCutFrequencyValue,
  onUpdateChannelEq,
  selectedChannel,
  setDraftValue,
  setSelectedEqBandId,
  viewModel,
}: AudioInspectorEqBandGridProps) {
  const canEdit = viewModel.capabilities.canEditProcessing;
  const lowCut = selectedChannel.eq.lowCut;

  return (
    <div className={tabStyles.eqBandGrid} data-testid="audio-eq-control-tray">
      <div className={tabStyles.eqGridHeader}>
        <span>Low Cut + 3-band PEQ</span>
        <button
          aria-pressed={selectedChannel.eq.enabled}
          className={tabStyles.eqEnableButton}
          data-active={selectedChannel.eq.enabled}
          disabled={!canEdit}
          onClick={() => onUpdateChannelEq({ channelId: selectedChannel.id, enabled: !selectedChannel.eq.enabled })}
          type="button"
        >
          {selectedChannel.eq.enabled ? "Bypass PEQ" : "Enable PEQ"}
        </button>
      </div>

      <div className={tabStyles.eqCards}>
        {/* Low Cut card */}
        <div
          className={tabStyles.eqBandCard}
          data-active={activeEqHandleId === LOW_CUT_HANDLE_ID}
          data-testid="audio-eq-lowcut-card"
          onClick={() => setSelectedEqBandId(LOW_CUT_HANDLE_ID)}
        >
          <div className={tabStyles.eqBandCardHead}>
            <strong>Low Cut</strong>
            <button
              aria-pressed={lowCut.enabled}
              data-active={lowCut.enabled}
              disabled={!canEdit}
              onClick={(event) => {
                event.stopPropagation();
                onUpdateChannelEq({ channelId: selectedChannel.id, lowCutEnabled: !lowCut.enabled });
              }}
              type="button"
            >
              {lowCut.enabled ? "Bypass Low Cut" : "Enable Low Cut"}
            </button>
          </div>
          <div className={dynamicsStyles.knobRow}>
            <AudioKnob
              ariaLabel={`${selectedChannel.name} Low Cut frequency`}
              caption="Cutoff"
              disabled={!canEdit}
              format={formatEqFrequency}
              max={LOW_CUT_FREQUENCY_MAX}
              min={LOW_CUT_FREQUENCY_MIN}
              onCommit={(value) => {
                setSelectedEqBandId(LOW_CUT_HANDLE_ID);
                setDraftValue(lowCutFrequencyKey, value);
                onUpdateChannelEq({ channelId: selectedChannel.id, lowCutFrequencyHz: value });
                clearDraftValueLater(lowCutFrequencyKey);
              }}
              onPreview={(value) => setDraftValue(lowCutFrequencyKey, value)}
              size={56}
              step={1}
              value={lowCutFrequencyValue}
            />
            <div className={tabStyles.eqSlopeColumn}>
              <span className={tabStyles.eqBandTypeLabel}>Slope</span>
              <div className={tabStyles.eqTypeRow}>
                {LOW_CUT_SLOPES.map((slope) => (
                  <button
                    aria-pressed={lowCut.slopeDbPerOctave === slope}
                    data-active={lowCut.slopeDbPerOctave === slope}
                    disabled={!canEdit}
                    key={slope}
                    onClick={(event) => {
                      event.stopPropagation();
                      onUpdateChannelEq({ channelId: selectedChannel.id, lowCutSlopeDbPerOctave: slope });
                    }}
                    type="button"
                  >
                    {slope}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* PEQ band cards */}
        {eqBands.map((band) => {
          const gainKey = `channel:${selectedChannel.id}:eq:${band.id}:gain`;
          const freqKey = `channel:${selectedChannel.id}:eq:${band.id}:frequency`;
          const qKey = `channel:${selectedChannel.id}:eq:${band.id}:q`;
          const typeOptions = eqBandTypeOptionsFor(band.id);
          const canChangeType = band.id !== "2";
          return (
            <div
              className={tabStyles.eqBandCard}
              data-active={band.id === activeEqHandleId}
              data-testid={`audio-eq-band-card-${band.id}`}
              key={band.id}
              onClick={() => setSelectedEqBandId(band.id)}
            >
              <div className={tabStyles.eqBandCardHead}>
                <strong>Band {band.label}</strong>
                <span className={tabStyles.eqBandCardTag}>{formatEqBandType(band.bandType)}</span>
              </div>
              <div className={dynamicsStyles.knobRow}>
                <AudioKnob
                  ariaLabel={`${selectedChannel.name} Band ${band.label} EQ gain`}
                  bipolar
                  caption="Gain"
                  defaultValue={0}
                  disabled={!canEdit}
                  format={formatEqGain}
                  max={EQ_GAIN_MAX}
                  min={EQ_GAIN_MIN}
                  onCommit={(value) => {
                    setSelectedEqBandId(band.id);
                    setDraftValue(gainKey, value);
                    onUpdateChannelEq({ bandId: eqBandId(band.id), channelId: selectedChannel.id, gainDb: value });
                    clearDraftValueLater(gainKey);
                  }}
                  onPreview={(value) => setDraftValue(gainKey, value)}
                  step={0.5}
                  value={band.gainDb}
                />
                <AudioKnob
                  ariaLabel={`${selectedChannel.name} Band ${band.label} EQ frequency`}
                  caption="Freq"
                  disabled={!canEdit}
                  format={formatEqFrequency}
                  max={EQ_FREQUENCY_MAX}
                  min={EQ_FREQUENCY_MIN}
                  onCommit={(value) => {
                    setSelectedEqBandId(band.id);
                    setDraftValue(freqKey, value);
                    onUpdateChannelEq({ bandId: eqBandId(band.id), channelId: selectedChannel.id, frequencyHz: value });
                    clearDraftValueLater(freqKey);
                  }}
                  onPreview={(value) => setDraftValue(freqKey, value)}
                  step={10}
                  value={band.frequencyHz}
                />
                <AudioKnob
                  ariaLabel={`${selectedChannel.name} Band ${band.label} EQ Q`}
                  caption="Q"
                  disabled={!canEdit}
                  format={(value) => `Q ${value.toFixed(1)}`}
                  max={EQ_Q_MAX}
                  min={EQ_Q_MIN}
                  onCommit={(value) => {
                    setSelectedEqBandId(band.id);
                    setDraftValue(qKey, value);
                    onUpdateChannelEq({ bandId: eqBandId(band.id), channelId: selectedChannel.id, q: value });
                    clearDraftValueLater(qKey);
                  }}
                  onPreview={(value) => setDraftValue(qKey, value)}
                  step={0.1}
                  value={band.q}
                />
              </div>
              <div className={tabStyles.eqTypeRow} data-band-type-row="true">
                {typeOptions.map((option) => (
                  <button
                    aria-pressed={band.bandType === option}
                    data-active={band.bandType === option}
                    disabled={!canEdit || !canChangeType}
                    key={option}
                    onClick={(event) => {
                      event.stopPropagation();
                      onUpdateChannelEq({
                        bandId: eqBandId(band.id),
                        bandType: eqBandType(option),
                        channelId: selectedChannel.id,
                      });
                    }}
                    type="button"
                  >
                    {formatEqBandType(option)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
