import { useMemo, useRef, useState } from "react";
import type { ShellStore } from "@sse/engine-client";
import { ArmKey, Groove, Key, LampWord, MenuButton, Meter, Readout, type UseArmResult } from "@sse/design-system";

import styles from "./AudioMixerLane.module.css";
import { AudioGainEntryDialog, AudioLevelEntryDialog } from "./AudioEntryDialogs";
import { AudioKnob } from "./AudioKnob";
import { METER_SCALE_MARKS } from "./AudioStereoMeter";
import { audioPhantomKey } from "../audioArming";
import { AUDIO_ARM_TIMEOUT_MS, AUDIO_THROTTLE_FADER_MS, PREAMP_GAIN_MAX_DB } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { createThrottledCommit } from "../audioContinuousControls";
import { AUDIO_FADER_TICKS } from "../audioFaderScale";
import {
  AUDIO_FADER_UNITY,
  AUDIO_FADER_UNITY_SNAP,
  AUDIO_HIDDEN_STRIP_MENU_LOCK,
  AUDIO_HIDDEN_STRIP_SENTENCE,
  dbfsToMeterPercent,
  formatAudioDb,
  meterFill,
} from "../audioFormatting";
import { METER_FLOOR_DBFS, METER_NOMINAL_DBFS } from "../audioMeterDisplayModel";
import { audioChannelSupportsGain, getAudioChannelGroup, selectedChannelSendLevel } from "../audioViewModel";
import { buildChannelMenu } from "./audioChannelMenu";
import type { AudioChannelEntry, AudioMixTargetEntry } from "../../shellData";

// The strip (the Console's strip, 2026-10-11, D50): the meter is the strip's
// hero and the fader is secondary. From the top: the name; M and S; on an
// input with a preamp, 48 V on its own line and the gain knob under it on the
// strip's axis, the strip's ⋯ at the knob's side; the held peak in a small
// well over the meter; the meter and, at its right, the fader; the level it
// sends under the fader. The meter's scale is printed once per tier, in the
// gutter beside the first strip, on the same rows. Every other command is in
// the strip's menu: its ⋯, or a right-click on the strip, opens the same menu.

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];

// The wide meter's edge ticks: the meter's marks between its ends, less the
// reference, which the meter draws through its edges itself.
const STRIP_METER_MARKS = METER_SCALE_MARKS.filter(
  ({ dbfs }) => dbfs !== 0 && dbfs !== METER_NOMINAL_DBFS && dbfs !== METER_FLOOR_DBFS
).map(({ dbfs }) => dbfsToMeterPercent(dbfs) / 100);

export interface AudioChannelLaneProps {
  actionsAllowed: boolean;
  arm: UseArmResult;
  armedActionKey: string | null;
  channel: AudioChannelEntry;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  /** The desk has not confirmed the levels: the values carry the dashed yellow keyline (DESIGN.md §4). */
  doubt?: boolean;
  draftStore: AudioControlDraftStore;
  feeding: boolean;
  getDraftValue: (key: string, fallback: number) => number;
  lockedReason?: string;
  /** The menu's short reason for a locked item ("desk NOT VERIFIED"); null when unlocked. */
  menuLock: string | null;
  /** No metering is arriving: the well carries its ticks and nothing else. */
  meterEmpty?: boolean;
  onClearClip: (channelId: string) => void;
  onResetToUnity: (channelId: string) => void;
  onSelect: (channelId: string) => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  selected: boolean;
  selectedMixTarget: AudioMixTargetEntry | null;
}

export function AudioChannelLane({
  actionsAllowed,
  arm,
  armedActionKey,
  channel,
  clearDraftValueLater,
  commitChannelContinuous,
  doubt = false,
  draftStore,
  feeding,
  getDraftValue,
  lockedReason,
  menuLock,
  meterEmpty,
  onClearClip,
  onResetToUnity,
  onSelect,
  onTogglePhantom,
  onUpdateChannel,
  setDraftValue,
  selected,
  selectedMixTarget,
}: AudioChannelLaneProps) {
  const stripRef = useRef<HTMLElement | null>(null);
  const [entry, setEntry] = useState<"level" | "gain" | null>(null);
  const selectedMixTargetId = selectedMixTarget?.id ?? null;
  const sendDraftKey = `channel:${channel.id}:send:${selectedMixTargetId ?? "none"}`;
  const sendLevel = useAudioControlDraftValue(
    draftStore,
    sendDraftKey,
    getDraftValue(sendDraftKey, selectedChannelSendLevel(channel, selectedMixTargetId))
  );
  const gainDraftKey = `channel:${channel.id}:gain`;
  const gain = useAudioControlDraftValue(draftStore, gainDraftKey, getDraftValue(gainDraftKey, channel.gain));
  const supportsPreamp = audioChannelSupportsGain(channel);
  const group = getAudioChannelGroup(channel);
  // A strip TotalMix hides (Setup's list, 2026-10-08): every write on it is
  // locked with the sentence, whatever the desk's state, and the preamp's line
  // says so in a word.
  const hidden = channel.hidden;
  const laneActionsAllowed = actionsAllowed && !hidden;
  const laneLockedReason = hidden ? AUDIO_HIDDEN_STRIP_SENTENCE : lockedReason;
  const laneMenuLock = hidden ? AUDIO_HIDDEN_STRIP_MENU_LOCK : menuLock;
  const phantomArmKey = audioPhantomKey(channel.id, !channel.phantom);
  const phantomArmed = armedActionKey === phantomArmKey;
  const throttledSendCommit = useMemo(
    () => createThrottledCommit<AudioChannelUpdate>(commitChannelContinuous, AUDIO_THROTTLE_FADER_MS),
    [commitChannelContinuous]
  );
  const commitSend = (value: number) => {
    setDraftValue(sendDraftKey, value);
    throttledSendCommit.schedule({
      channelId: channel.id,
      fader: value,
      mixTargetId: selectedMixTargetId ?? undefined,
    });
    throttledSendCommit.flush();
    clearDraftValueLater(sendDraftKey);
  };
  const commitGain = (next: number) => {
    // A press that does not turn the knob, an arrow at its end or a typed
    // value the desk already has sends nothing: a click on the strip's knob
    // only selects the strip (the Console's strip, 2026-10-11, D50).
    if (next === channel.gain) {
      clearDraftValueLater(gainDraftKey);
      return;
    }
    setDraftValue(gainDraftKey, next);
    commitChannelContinuous({ channelId: channel.id, gain: next });
    clearDraftValueLater(gainDraftKey);
  };

  const menu = buildChannelMenu({
    channel,
    gain,
    sendLevel,
    selectedMixTarget,
    menuLock: laneMenuLock,
    onRequestLevel: () => setEntry("level"),
    onRequestGain: () => setEntry("gain"),
    onResetToUnity,
    onClearClip,
    onUpdateChannel,
    testIdPrefix: `audio-lane-menu-${channel.id}`,
  });

  return (
    <article
      ref={stripRef}
      className={styles.strip}
      data-audio-channel-id={channel.id}
      data-clip={channel.clip}
      data-feeding={feeding}
      data-group={group}
      data-hidden={hidden ? "" : undefined}
      data-no-send={!feeding && !channel.mute}
      data-role={channel.role}
      data-lit={selected ? "" : undefined}
      data-selected={selected}
      data-testid={`audio-strip-${channel.id}`}
      onClick={() => onSelect(channel.id)}
    >
      <span className={styles.name} data-testid={`audio-lane-name-${channel.id}`}>
        {channel.name}
      </span>

      <div className={styles.keys}>
        <Key
          mode="toggle"
          cap="M"
          engaged={channel.mute}
          locked={!laneActionsAllowed}
          reason={laneLockedReason}
          size="large"
          take
          className={styles.stripKey}
          data-control="mute"
          data-active={channel.mute}
          aria-label={`Mute ${channel.name}`}
          aria-pressed={channel.mute}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateChannel({ channelId: channel.id, mute: !channel.mute });
          }}
        />
        <Key
          mode="toggle"
          cap="S"
          engaged={channel.solo}
          locked={!laneActionsAllowed}
          reason={laneLockedReason}
          size="large"
          take
          className={styles.stripKey}
          data-control="solo"
          data-active={channel.solo}
          aria-label={`Solo ${channel.name}`}
          aria-pressed={channel.solo}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateChannel({ channelId: channel.id, solo: !channel.solo });
          }}
        />
      </div>

      {hidden ? (
        // The walk of 2026-10-07, finding 3: the strip says it is hidden, in
        // the attention ink, where its preamp would be; the sentence is on its
        // keys and in its menu.
        <span className={styles.hiddenWord} title={AUDIO_HIDDEN_STRIP_SENTENCE}>
          <LampWord tone="attention" testId={`audio-lane-hidden-${channel.id}`}>
            hidden
          </LampWord>
        </span>
      ) : supportsPreamp ? (
        // 48 V is the one control on the strip that can damage a source, so it
        // is a hazard key: it arms, then applies. On its own line it is as wide
        // as M and S together, and armed it has the room for its whole question.
        <div className={styles.phantom}>
          <ArmKey
            armed={phantomArmed}
            hazard
            lit={channel.phantom}
            armedWord={channel.phantom ? "48 V OFF?" : "48 V ON?"}
            timeoutMs={AUDIO_ARM_TIMEOUT_MS}
            countdownTestId={`audio-lane-phantom-countdown-${channel.id}`}
            cap={phantomArmed ? undefined : "48 V"}
            className={styles.phantomKey}
            data-control="phantom"
            locked={!laneActionsAllowed}
            reason={laneLockedReason}
            size="small"
            take
            testId={`audio-lane-phantom-${channel.id}`}
            aria-label={`${channel.phantom ? "Switch off" : "Switch on"} 48 V on ${channel.name}`}
            aria-pressed={channel.phantom}
            title={`48 V phantom ${channel.phantom ? "on" : "off"} — press twice to change it`}
            onClick={(event) => {
              event.stopPropagation();
              onTogglePhantom({ channelId: channel.id, channelName: channel.name, phantom: !channel.phantom });
            }}
          />
        </div>
      ) : null}

      {/* The preamp's gain on the strip's axis: a drag, the arrows or typed
          entry ride it, as the plate's knob does (they share the draft, so
          each shows the other's drag). The strip's ⋯ waits at its side. */}
      <div className={styles.knobRow}>
        {!hidden && supportsPreamp ? (
          <AudioKnob
            ariaLabel={`${channel.name} preamp gain`}
            caption="dB"
            disabled={!laneActionsAllowed}
            doubt={doubt}
            // Preamp gain is integer-only at the hardware link; show and commit whole dB.
            format={(value) => `${Math.round(value)}`}
            max={PREAMP_GAIN_MAX_DB}
            min={0}
            numericSuffix="dB"
            onCommit={commitGain}
            onPreview={(next) => setDraftValue(gainDraftKey, next)}
            onRequestTypedEntry={() => setEntry("gain")}
            size={56}
            step={1}
            testId={`audio-lane-gain-${channel.id}`}
            value={gain}
            valueInside
          />
        ) : null}
        <span
          className={styles.menu}
          // A press on the ⋯ opens the menu and does not select the strip, as
          // a right-click does not.
          onClick={(event) => event.stopPropagation()}
        >
          <MenuButton
            buttonLabel={`${channel.name} menu`}
            buttonTestId={`audio-lane-menu-${channel.id}`}
            contextTarget={stripRef}
            size="sm"
            menu={{ ...menu, arm }}
          />
        </span>
      </div>

      {/* The held peak, small and quiet over its meter: the meters' painter
          writes the number when its whole dB changes, so the page never
          renders for it. The hot pink from −3 dBFS; CLIP while a clip is held. */}
      <div className={styles.peak}>
        <span
          className={styles.peakWell}
          data-clip={channel.clip ? "" : undefined}
          data-peak-well-id={channel.id}
          data-peak-well-kind="channel"
          data-peak-well-stereo={channel.stereo ? "true" : "false"}
          data-testid={`audio-lane-peak-${channel.id}`}
          title="The held peak, in dBFS"
        >
          <span className={styles.peakValue} data-peak-well-value="" />
          {channel.clip ? <span className={styles.clipWord}>CLIP</span> : null}
        </span>
      </div>

      <div className={styles.fader}>
        <Meter
          className={styles.meter}
          clip={channel.clip}
          empty={meterEmpty}
          form="wide"
          label={`${channel.name} meter`}
          level={meterFill(channel.meterLeft)}
          levelRight={channel.stereo ? meterFill(channel.meterRight) : undefined}
          marks={STRIP_METER_MARKS}
          meterId={channel.id}
          meterKind="channel"
          peak={meterFill(channel.peakHoldLeft)}
          peakRight={channel.stereo ? meterFill(channel.peakHoldRight) : undefined}
          testId={`audio-lane-meter-${channel.id}`}
        />
        <Groove
          label={`${channel.name} send level`}
          locked={!laneActionsAllowed}
          onChange={(value) => {
            setDraftValue(sendDraftKey, value);
            throttledSendCommit.schedule({
              channelId: channel.id,
              fader: value,
              mixTargetId: selectedMixTargetId ?? undefined,
            });
          }}
          onCommit={commitSend}
          onRequestTypedEntry={laneActionsAllowed ? () => setEntry("level") : undefined}
          size="compact"
          snapUnity
          take
          ticks={AUDIO_FADER_TICKS}
          unity={AUDIO_FADER_UNITY}
          unityLabel="0"
          unitySnap={AUDIO_FADER_UNITY_SNAP}
          value={sendLevel}
          valueText={formatAudioDb(sendLevel)}
        />
      </div>

      {/* The level it sends, under its fader. The visual overhaul's polish
          (2026-10-05): a level the desk has not confirmed is drawn in doubt, a
          dashed yellow keyline on the value. */}
      <Readout
        className={styles.send}
        size="value"
        align="right"
        value={formatAudioDb(sendLevel).replace(/ dB$/, "")}
        unit="dB"
        doubt={doubt && !hidden}
        empty={hidden || (!feeding && !channel.mute)}
        testId={`audio-lane-readout-${channel.id}`}
      />

      {entry === "level" ? (
        <AudioLevelEntryDialog
          title={`Set ${channel.name} send level`}
          value={sendLevel}
          onCancel={() => setEntry(null)}
          onConfirm={(next) => {
            setEntry(null);
            commitSend(next);
          }}
        />
      ) : null}
      {entry === "gain" ? (
        <AudioGainEntryDialog
          title={`Set ${channel.name} preamp gain`}
          gain={gain}
          onCancel={() => setEntry(null)}
          onConfirm={(next) => {
            setEntry(null);
            commitGain(next);
          }}
        />
      ) : null}
    </article>
  );
}
