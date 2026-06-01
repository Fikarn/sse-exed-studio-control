/**
 * Per-band control tray for the EQ inspector tab. Rendered when one of the
 * PEQ bands is the active selection. Owns the bypass toggle, band-type
 * switcher (locked to Bell for Band 2), and the frequency / gain / Q
 * sliders.
 *
 * Extracted from `AudioInspectorEqTab.tsx` to keep the tab body under the
 * sub-file budget (Slice 5B).
 */
import tabStyles from "../AudioInspectorEqTab.module.css";
import dynamicsStyles from "../AudioInspectorDynamicsTab.module.css";
import sendStyles from "../AudioInspectorSendsTab.module.css";
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
  formatEqBandType,
  formatEqFrequency,
  type AudioEqBand,
  type AudioEqUpdate,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

function formatEqGain(value: number) {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

interface AudioInspectorEqBandTrayProps {
  activeEqBand: AudioEqBand;
  activeEqBandFrequencyKey: string;
  activeEqBandFrequencyValue: number;
  activeEqBandGainKey: string;
  activeEqBandGainValue: number;
  activeEqBandQKey: string;
  activeEqBandQValue: number;
  activeEqBandTypeOptions: readonly string[];
  canChangeBandType: boolean;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  selectedChannel: SelectedAudioChannel;
  setDraftValue: (key: string, value: number) => void;
  setSelectedEqBandId: (id: string | null) => void;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioInspectorEqBandTray({
  activeEqBand,
  activeEqBandFrequencyKey,
  activeEqBandFrequencyValue,
  activeEqBandGainKey,
  activeEqBandGainValue,
  activeEqBandQKey,
  activeEqBandQValue,
  activeEqBandTypeOptions,
  canChangeBandType,
  clearDraftValueLater,
  onUpdateChannelEq,
  selectedChannel,
  setDraftValue,
  setSelectedEqBandId,
  viewModel,
}: AudioInspectorEqBandTrayProps) {
  return (
    <>
      <div className={sendStyles.sendCardHead}>
        <strong>Band {activeEqBand.label}</strong>
        <span className={sendStyles.sendCardTag}>
          {formatEqBandType(activeEqBand.bandType)} · {selectedChannel.eq.enabled ? "PEQ in" : "PEQ bypassed"}
        </span>
      </div>
      <div className={tabStyles.eqModeRow}>
        <button
          aria-pressed={selectedChannel.eq.enabled}
          data-active={selectedChannel.eq.enabled}
          disabled={!viewModel.capabilities.canEditProcessing}
          onClick={() => onUpdateChannelEq({ channelId: selectedChannel.id, enabled: !selectedChannel.eq.enabled })}
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
      <div className={dynamicsStyles.knobRow}>
        <AudioKnob
          ariaLabel={`${selectedChannel.name} Band ${activeEqBand.label} EQ gain`}
          bipolar
          caption="Gain"
          defaultValue={0}
          disabled={!viewModel.capabilities.canEditProcessing}
          format={formatEqGain}
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
          step={0.5}
          value={activeEqBandGainValue}
        />
        <AudioKnob
          ariaLabel={`${selectedChannel.name} Band ${activeEqBand.label} EQ frequency`}
          caption="Freq"
          disabled={!viewModel.capabilities.canEditProcessing}
          format={formatEqFrequency}
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
          step={10}
          value={activeEqBandFrequencyValue}
        />
        <AudioKnob
          ariaLabel={`${selectedChannel.name} Band ${activeEqBand.label} EQ Q`}
          caption="Q"
          disabled={!viewModel.capabilities.canEditProcessing}
          format={(value) => `Q ${value.toFixed(1)}`}
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
          step={0.1}
          value={activeEqBandQValue}
        />
      </div>
    </>
  );
}
