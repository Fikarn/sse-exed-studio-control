/**
 * Low Cut control tray for the EQ inspector tab. Rendered when the Low Cut
 * handle is the active selection. Owns the bypass toggle, slope switcher,
 * and the cutoff frequency slider.
 *
 * Extracted from `AudioInspectorEqTab.tsx` to keep the tab body under the
 * sub-file budget (Slice 5B).
 */
import styles from "../AudioInspector.module.css";
import tabStyles from "../AudioInspectorEqTab.module.css";
import dynamicsStyles from "../AudioInspectorDynamicsTab.module.css";
import sendStyles from "../AudioInspectorSendsTab.module.css";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";
import { AudioSliderControl } from "../AudioSliderControl";
import {
  formatEqFrequency,
  LOW_CUT_FREQUENCY_MAX,
  LOW_CUT_FREQUENCY_MIN,
  LOW_CUT_HANDLE_ID,
  LOW_CUT_SLOPES,
  type AudioEqUpdate,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

interface AudioInspectorEqLowCutTrayProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  lowCutFrequencyKey: string;
  lowCutFrequencyValue: number;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  selectedChannel: SelectedAudioChannel;
  setDraftValue: (key: string, value: number) => void;
  setSelectedEqBandId: (id: string | null) => void;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioInspectorEqLowCutTray({
  clearDraftValueLater,
  lowCutFrequencyKey,
  lowCutFrequencyValue,
  onUpdateChannelEq,
  selectedChannel,
  setDraftValue,
  setSelectedEqBandId,
  viewModel,
}: AudioInspectorEqLowCutTrayProps) {
  return (
    <>
      <div className={sendStyles.sendCardHead}>
        <strong>Low Cut</strong>
        <span className={sendStyles.sendCardTag}>
          {selectedChannel.eq.lowCut.enabled ? "In" : "Out"} · {selectedChannel.eq.lowCut.slopeDbPerOctave} dB/oct
        </span>
      </div>
      <div className={tabStyles.eqModeRow}>
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
      <div className={dynamicsStyles.processingControlGrid}>
        <label className={dynamicsStyles.processingControl}>
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
  );
}
