/**
 * Hardware / Software mini card for the channel-mode inspector header.
 *   - For preamp-capable channels (front preamps), renders the
 *     AudioPreampControl plus the 48V / Hi-Z / Polarity / AutoSet toggles.
 *   - For software-playback channels, renders the "Playback telemetry not
 *     reported" truth fact and the stereo-link / auto-fade detail grid.
 *
 * Extracted from `AudioInspectorChannelHeader.tsx` to keep the header focused
 * on the identity strip (Slice 5B).
 */
import styles from "../AudioInspector.module.css";
import {
  audioChannelSupportsAutoSet,
  audioChannelSupportsGain,
  audioChannelSupportsInstrument,
  audioChannelSupportsPhantom,
  audioChannelSupportsPhase,
  type AudioWorkspaceViewModel,
} from "../../audioViewModel";
import { AudioPreampControl } from "../AudioPreampControl";
import type { AudioChannelUpdate, SelectedAudioChannel } from "./audioInspectorHelpers";

interface PhantomToggleArg {
  channelId: string;
  channelName: string;
  phantom: boolean;
}

interface AudioInspectorChannelHardwareCardProps {
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  gainDraftKey: string;
  onTogglePhantom: (arg: PhantomToggleArg) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  phantomArmed: boolean;
  phantomLabel: string;
  selectedChannel: SelectedAudioChannel;
  selectedGain: number;
  setDraftValue: (key: string, value: number) => void;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioInspectorChannelHardwareCard({
  clearDraftValueLater,
  commitChannelContinuous,
  gainDraftKey,
  onTogglePhantom,
  onUpdateChannel,
  phantomArmed,
  phantomLabel,
  selectedChannel,
  selectedGain,
  setDraftValue,
  viewModel,
}: AudioInspectorChannelHardwareCardProps) {
  return (
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
  );
}
