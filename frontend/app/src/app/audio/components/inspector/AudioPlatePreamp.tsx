import { ArmKey, Key, Section, Tooltip } from "@sse/design-system";

import styles from "../AudioInspector.module.css";
import { audioPhantomKey } from "../../audioArming";
import { AUDIO_ARM_TIMEOUT_MS, PREAMP_GAIN_DEFAULT_DB, PREAMP_GAIN_MAX_DB } from "../../audioConstants";
import {
  audioChannelSupportsAutoSet,
  audioChannelSupportsInstrument,
  audioChannelSupportsPhantom,
  audioChannelSupportsPhase,
} from "../../audioViewModel";
import { AudioKnob } from "../AudioKnob";
import type { AudioChannelUpdate, SelectedAudioChannel } from "./audioInspectorHelpers";

// The plate's preamp (visual overhaul, the Console), for a front preamp: the
// gain as a knob that answers a drag, the arrows and typed entry, and the
// preamp's switches beside it. 48 V arms here as it does on the strip.

export function AudioPlatePreamp({
  actionsAllowed,
  armedActionKey,
  channel,
  gain,
  lockedReason,
  onCommitGain,
  onPreviewGain,
  onTogglePhantom,
  onUpdateChannel,
}: {
  actionsAllowed: boolean;
  armedActionKey: string | null;
  channel: SelectedAudioChannel;
  gain: number;
  lockedReason?: string;
  onCommitGain: (gain: number) => void;
  onPreviewGain: (gain: number) => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
}) {
  const phantomArmed = armedActionKey === audioPhantomKey(channel.id, !channel.phantom);
  return (
    <Section
      title={
        <Tooltip content="The mic / line gain on the UFX III" placement="left">
          <span>Preamp</span>
        </Tooltip>
      }
      className={styles.section}
      data-plate-section="preamp"
      testId="audio-inspector-channel"
    >
      <div className={styles.preamp} data-testid="audio-inspector-hardware-mini">
        <AudioKnob
          ariaLabel={`${channel.name} preamp gain`}
          caption="dB"
          defaultValue={PREAMP_GAIN_DEFAULT_DB}
          disabled={!actionsAllowed}
          // Preamp gain is integer-only engine-side; show + commit whole dB.
          format={(value) => `${Math.round(value)}`}
          max={PREAMP_GAIN_MAX_DB}
          min={0}
          numericFieldLabel="Preamp gain"
          numericSuffix="dB"
          onCommit={onCommitGain}
          onPreview={onPreviewGain}
          size={72}
          step={1}
          value={gain}
          valueInside
        />
        <div className={styles.preampKeys}>
          {audioChannelSupportsPhantom(channel) ? (
            <ArmKey
              armed={phantomArmed}
              hazard
              lit={channel.phantom}
              armedWord={channel.phantom ? "48 V OFF?" : "48 V ON?"}
              timeoutMs={AUDIO_ARM_TIMEOUT_MS}
              countdownTestId="audio-plate-phantom-countdown"
              cap={phantomArmed ? undefined : "48 V"}
              className={styles.preampArmKey}
              locked={!actionsAllowed}
              reason={lockedReason}
              data-active={channel.phantom}
              aria-pressed={channel.phantom}
              onClick={() =>
                onTogglePhantom({ channelId: channel.id, channelName: channel.name, phantom: !channel.phantom })
              }
            />
          ) : null}
          {audioChannelSupportsInstrument(channel) ? (
            <Key
              mode="toggle"
              engaged={channel.instrument}
              locked={!actionsAllowed}
              reason={lockedReason}
              data-active={channel.instrument}
              onClick={() => onUpdateChannel({ channelId: channel.id, instrument: !channel.instrument })}
            >
              Hi-Z
            </Key>
          ) : null}
          {audioChannelSupportsPhase(channel) ? (
            <Key
              mode="toggle"
              engaged={channel.phase}
              locked={!actionsAllowed}
              reason={lockedReason}
              data-active={channel.phase}
              onClick={() => onUpdateChannel({ channelId: channel.id, phase: !channel.phase })}
            >
              Polarity
            </Key>
          ) : null}
          {audioChannelSupportsAutoSet(channel) ? (
            <Key
              mode="toggle"
              engaged={channel.autoSet}
              locked={!actionsAllowed}
              reason={lockedReason}
              data-active={channel.autoSet}
              onClick={() => onUpdateChannel({ channelId: channel.id, autoSet: !channel.autoSet })}
            >
              AutoSet
            </Key>
          ) : null}
        </div>
      </div>
    </Section>
  );
}
