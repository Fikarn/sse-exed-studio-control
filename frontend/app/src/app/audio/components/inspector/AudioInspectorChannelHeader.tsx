import type { ShellStore } from "@sse/engine-client";

import styles from "../../AudioWorkspace.module.css";
import { AUDIO_FADER_UNITY, formatAudioDb } from "../../audioFormatting";
import type { AudioMixTargetEntry } from "../../../shellData";
import {
  audioChannelSupportsAutoSet,
  audioChannelSupportsGain,
  audioChannelSupportsInstrument,
  audioChannelSupportsPhantom,
  audioChannelSupportsPhase,
  type AudioWorkspaceViewModel,
} from "../../audioViewModel";
import { AudioStableMeterDbPair } from "../AudioLiveMeterReadout";
import { AudioPreampControl } from "../AudioPreampControl";
import { AudioSliderControl } from "../AudioSliderControl";
import { AudioStereoMeter } from "../AudioStereoMeter";
import {
  channelOrdinalLabel,
  channelRoutingSourceText,
  channelTypeLabel,
  type AudioChannelUpdate,
  type SelectedAudioChannel,
} from "./audioInspectorHelpers";

interface PhantomToggleArg {
  channelId: string;
  channelName: string;
  phantom: boolean;
}

interface AudioInspectorChannelHeaderProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  gainDraftKey: string;
  onTogglePhantom: (arg: PhantomToggleArg) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  phantomArmed: boolean;
  phantomLabel: string;
  selectedChannel: SelectedAudioChannel;
  selectedClip: boolean;
  selectedGain: number;
  selectedGroup: string;
  selectedLeftMeter: number;
  selectedMixTarget: AudioMixTargetEntry | null;
  selectedRightMeter: number;
  selectedSendDraftKey: string;
  selectedSendLevel: number;
  setDraftValue: (key: string, value: number) => void;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}

/**
 * Sticky-header block for channel-mode inspector. Renders the channel identity
 * strip, the big meter card with stabilised level/peak-hold readouts, the
 * Hardware/Software mini card (preamp + safety toggles), the inspector send
 * fader, and the Mute/Solo/Unity action row. Parent owns the conditional
 * that picks between this view and the OutputView / empty state.
 */
export function AudioInspectorChannelHeader({
  clearDraftValueLater,
  commitChannelContinuous,
  gainDraftKey,
  onTogglePhantom,
  onUpdateChannel,
  peakHoldEnabled,
  peakHoldResetToken,
  phantomArmed,
  phantomLabel,
  selectedChannel,
  selectedClip,
  selectedGain,
  selectedGroup,
  selectedLeftMeter,
  selectedMixTarget,
  selectedRightMeter,
  selectedSendDraftKey,
  selectedSendLevel,
  setDraftValue,
  store,
  viewModel,
}: AudioInspectorChannelHeaderProps) {
  return (
    <>
      <div className={styles.inspectorEyebrowRow}>
        <span>
          Channel · {channelTypeLabel(selectedChannel.role)} {channelOrdinalLabel(viewModel, selectedChannel)}
        </span>
        <span className={styles.inspectorTagRow}>
          <span className={styles.inspectorTag}>{selectedChannel.stereo ? "Stereo" : "Mono"}</span>
          <span className={styles.inspectorTag} data-group={selectedGroup}>
            {selectedGroup}
          </span>
        </span>
      </div>
      <h2 className={styles.inspectorTitle}>{selectedChannel.name}</h2>
      <div className={styles.inspectorSubtitle}>
        {channelRoutingSourceText(selectedChannel.role)} · {selectedChannel.stereo ? "Stereo" : "Mono"} →{" "}
        <strong>{selectedMixTarget?.name ?? "No output"}</strong>
      </div>

      <div className={styles.bigMeterCard} data-testid="audio-inspector-metering">
        <AudioStereoMeter
          clip={selectedChannel.clip}
          left={selectedChannel.meterLeft}
          meterId={selectedChannel.id}
          meterKind="channel"
          mirrorRight={!selectedChannel.stereo}
          peakLeft={selectedChannel.peakHoldLeft}
          peakRight={selectedChannel.stereo ? selectedChannel.peakHoldRight : selectedChannel.peakHoldLeft}
          right={selectedChannel.stereo ? selectedChannel.meterRight : selectedChannel.meterLeft}
          showReadout={false}
          showScale
        />
        <div className={styles.bigMeterInfo}>
          {viewModel.meterSimulationActive ? <span className={styles.meterSimulationBadge}>TEST STAGE</span> : null}
          <div className={styles.bigMeterRow}>
            <span>
              <small>Level L / R</small>
              <strong>
                <AudioStableMeterDbPair
                  fallbackLeft={selectedLeftMeter}
                  fallbackRight={selectedRightMeter}
                  kind="channel"
                  mirrorRight={!selectedChannel.stereo}
                  meterId={selectedChannel.id}
                  mode="level"
                  peakHoldEnabled={peakHoldEnabled}
                  peakHoldResetToken={peakHoldResetToken}
                  store={store}
                  testId="audio-inspector-level-readout"
                />
                <em>dB</em>
              </strong>
            </span>
            <span>
              <small>Peak hold</small>
              <strong data-tone={selectedClip ? "clip" : "warn"}>
                <AudioStableMeterDbPair
                  fallbackLeft={selectedLeftMeter}
                  fallbackRight={selectedRightMeter}
                  kind="channel"
                  mirrorRight={!selectedChannel.stereo}
                  meterId={selectedChannel.id}
                  mode="peakHold"
                  peakHoldEnabled={peakHoldEnabled}
                  peakHoldResetToken={peakHoldResetToken}
                  store={store}
                  testId="audio-inspector-peak-hold-readout"
                />
                <em>dB</em>
              </strong>
            </span>
          </div>
          <div className={styles.bigMeterReferenceRow}>
            <span>
              <small>Nominal ref</small>
              <strong>
                -18<em>dBFS</em>
              </strong>
            </span>
            <span>
              <small>Peak warn</small>
              <strong>-3 dBFS</strong>
            </span>
          </div>
        </div>
      </div>

      <section
        className={`${styles.inspectorMiniCard} ${styles.sourceCard} ${styles.inspectorStickyHardwareCard}`}
        data-testid="audio-inspector-hardware-mini"
      >
        <span className={styles.eyebrow}>{audioChannelSupportsGain(selectedChannel) ? "Hardware" : "Software"}</span>
        {audioChannelSupportsGain(selectedChannel) ? (
          <div className={styles.inspectorHardwareGrid}>
            <AudioPreampControl
              channelId={selectedChannel.id}
              disabled={!viewModel.actionsAllowed}
              gain={selectedGain}
              label={`${selectedChannel.name} preamp gain`}
              onCommit={(nextGain) => {
                setDraftValue(gainDraftKey, nextGain);
                commitChannelContinuous({ channelId: selectedChannel.id, gain: nextGain });
                clearDraftValueLater(gainDraftKey);
              }}
              onPreview={(nextGain) => setDraftValue(gainDraftKey, nextGain)}
              variant="narrow"
            />
            <div className={styles.unsupportedToggleRow}>
              <button
                aria-label={`${selectedChannel.phantom ? "Disable" : "Enable"} 48V on ${selectedChannel.name}`}
                aria-pressed={selectedChannel.phantom}
                data-armed={phantomArmed}
                data-active={selectedChannel.phantom}
                disabled={!audioChannelSupportsPhantom(selectedChannel) || !viewModel.actionsAllowed}
                onClick={() =>
                  onTogglePhantom({
                    channelId: selectedChannel.id,
                    channelName: selectedChannel.name,
                    phantom: !selectedChannel.phantom,
                  })
                }
                type="button"
              >
                {phantomLabel}
              </button>
              <button
                aria-pressed={selectedChannel.instrument}
                data-active={selectedChannel.instrument}
                disabled={!audioChannelSupportsInstrument(selectedChannel) || !viewModel.actionsAllowed}
                onClick={() =>
                  onUpdateChannel({ channelId: selectedChannel.id, instrument: !selectedChannel.instrument })
                }
                type="button"
              >
                Hi-Z
              </button>
              <button
                aria-pressed={selectedChannel.phase}
                data-active={selectedChannel.phase}
                disabled={!audioChannelSupportsPhase(selectedChannel) || !viewModel.actionsAllowed}
                onClick={() => onUpdateChannel({ channelId: selectedChannel.id, phase: !selectedChannel.phase })}
                type="button"
              >
                Polarity
              </button>
              <button
                aria-pressed={selectedChannel.autoSet}
                data-active={selectedChannel.autoSet}
                disabled={!audioChannelSupportsAutoSet(selectedChannel) || !viewModel.actionsAllowed}
                onClick={() => onUpdateChannel({ channelId: selectedChannel.id, autoSet: !selectedChannel.autoSet })}
                type="button"
              >
                AutoSet
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.softwarePanelStack}>
            <div className={styles.unavailableTelemetry} data-testid="audio-playback-telemetry-unavailable">
              <strong>Playback telemetry not reported</strong>
              <span>Driver buffer and latency are not exposed by the current engine snapshot.</span>
            </div>
            <div className={styles.detailGrid}>
              <span>
                <small>Stereo link</small>
                <strong>{selectedChannel.stereo ? "Linked" : "Mono"}</strong>
              </span>
              <span>
                <small>Auto fade</small>
                <strong>Off</strong>
              </span>
            </div>
          </div>
        )}
      </section>

      <div className={styles.inspectorFaderCard}>
        <div className={styles.inspectorFaderHead}>
          <span>
            Send to <strong>{selectedMixTarget?.name ?? "output"}</strong>
          </span>
          <strong>{formatAudioDb(selectedSendLevel)}</strong>
        </div>
        <div className={styles.inspectorFaderTicks} aria-hidden="true">
          <span>-∞</span>
          <span>-40</span>
          <span>-20</span>
          <span>-10</span>
          <span>0</span>
          <span>+6</span>
        </div>
        <AudioSliderControl
          className={styles.inspectorSendSlider}
          disabled={!viewModel.actionsAllowed}
          label={`${selectedChannel.name} send to selected output`}
          onCommit={(value) => {
            setDraftValue(selectedSendDraftKey, value);
            commitChannelContinuous({
              channelId: selectedChannel.id,
              fader: value,
              mixTargetId: viewModel.selectedMixTargetId ?? undefined,
            });
            clearDraftValueLater(selectedSendDraftKey);
          }}
          onPreview={(value) => setDraftValue(selectedSendDraftKey, value)}
          orientation="horizontal"
          snapUnity
          value={selectedSendLevel}
          valueText={formatAudioDb(selectedSendLevel)}
        />
      </div>

      <div className={styles.inspectorActionRow}>
        <button
          aria-label={`Mute ${selectedChannel.name}`}
          aria-pressed={selectedChannel.mute}
          data-control="mute"
          data-active={selectedChannel.mute}
          disabled={!viewModel.actionsAllowed}
          onClick={() => onUpdateChannel({ channelId: selectedChannel.id, mute: !selectedChannel.mute })}
          type="button"
        >
          Mute
        </button>
        <button
          aria-label={`Solo ${selectedChannel.name}`}
          aria-pressed={selectedChannel.solo}
          data-control="solo"
          data-active={selectedChannel.solo}
          disabled={!viewModel.actionsAllowed}
          onClick={() => onUpdateChannel({ channelId: selectedChannel.id, solo: !selectedChannel.solo })}
          type="button"
        >
          Solo
        </button>
        <button
          aria-label={`Set ${selectedChannel.name} send to unity`}
          data-control="unity"
          disabled={!viewModel.actionsAllowed}
          onClick={() =>
            onUpdateChannel({
              channelId: selectedChannel.id,
              fader: AUDIO_FADER_UNITY,
              mixTargetId: viewModel.selectedMixTargetId ?? undefined,
            })
          }
          type="button"
        >
          Unity
        </button>
      </div>
    </>
  );
}
