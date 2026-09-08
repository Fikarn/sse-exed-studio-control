import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";
import { Key, LampWord, Readout, Tooltip } from "@sse/design-system";

import styles from "./AudioMixerLane.module.css";
import { AUDIO_THROTTLE_FADER_MS } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { createThrottledCommit } from "../audioContinuousControls";
import { formatAudioDb } from "../audioFormatting";
import { audioChannelSupportsGain, getAudioChannelGroup, selectedChannelSendLevel } from "../audioViewModel";
import type { AudioChannelEntry, AudioMixTargetEntry } from "../../shellData";
import { AudioStripFader } from "./AudioStripFader";
import { AudioStripGainKey } from "./AudioStripGainKey";

// Visual overhaul A, Slice 4b (system §7 "Strip", plan Slice 4): every strip
// reads in the desk's order — name, the value it is set to, what feeds it, the
// two keys pressed during a take, then the fader block. Everything read or
// pressed sits within one glance of the name; only the fader block grows.

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

function inputPreampNumber(channelId: string) {
  const raw = Number(channelId.match(/\d+/g)?.at(-1) ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return raw >= 9 ? raw - 8 : raw;
}

// The line under the strip's name: what the desk says this strip is. Inputs
// name their preamp and its input type, playback and outputs their format.
function channelSubtitle(channel: AudioChannelEntry) {
  if (audioChannelSupportsGain(channel)) {
    return `Preamp ${inputPreampNumber(channel.id)} · ${channel.instrument ? "Hi-Z" : "mic"}`;
  }
  const group = getAudioChannelGroup(channel);
  return `${channel.stereo ? "Stereo" : "Mono"}${group ? ` · ${group}` : ""}`;
}

function outputSubtitle(mixTarget: AudioMixTargetEntry) {
  if (mixTarget.role === "phones-a") return "Cue A";
  if (mixTarget.role === "phones-b") return "Cue B";
  if (mixTarget.role === "main-out") return "Monitor bus";
  return "Line out";
}

function outputTag(mixTarget: AudioMixTargetEntry) {
  if (mixTarget.role === "phones-a") return "cue A";
  if (mixTarget.role === "phones-b") return "cue B";
  if (mixTarget.role === "main-out") return "monitor";
  return "line";
}

export function AudioChannelLane({
  actionsAllowed,
  armedActionKey,
  channel,
  clearDraftValueLater,
  commitChannelContinuous,
  draftStore,
  feeding,
  getDraftValue,
  lockedReason,
  meterEmpty,
  onClearClip,
  onOpenContextMenu,
  onSelect,
  onTogglePhantom,
  onUpdateChannel,
  otherSends,
  setDraftValue,
  selected,
  selectedMixTargetId,
}: {
  actionsAllowed: boolean;
  armedActionKey: string | null;
  channel: AudioChannelEntry;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  draftStore: AudioControlDraftStore;
  feeding: boolean;
  getDraftValue: (key: string, fallback: number) => number;
  lockedReason?: string;
  /** No metering is arriving: the well carries its reference and nothing else. */
  meterEmpty?: boolean;
  onClearClip: (channelId: string) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  onSelect: (channelId: string) => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  otherSends: readonly { id: string; name: string; level: number }[];
  setDraftValue: (key: string, value: number) => void;
  selected: boolean;
  selectedMixTargetId: string | null;
}) {
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
  const phantomArmKey = `phantom:${channel.id}:${!channel.phantom}`;
  const throttledSendCommit = useMemo(
    () => createThrottledCommit<AudioChannelUpdate>(commitChannelContinuous, AUDIO_THROTTLE_FADER_MS),
    [commitChannelContinuous]
  );

  return (
    <article
      className={styles.strip}
      data-audio-channel-id={channel.id}
      data-clip={channel.clip}
      data-feeding={feeding}
      data-group={group}
      data-no-send={!feeding && !channel.mute}
      data-role={channel.role}
      data-selected={selected}
      data-testid={`audio-strip-${channel.id}`}
      onClick={() => onSelect(channel.id)}
      onContextMenuCapture={(event) => onOpenContextMenu(event, channel.id)}
    >
      <div className={styles.stripHead}>
        <span className={styles.stripName} data-testid={`audio-lane-name-${channel.id}`}>
          {channel.name}
        </span>
        <span className={styles.stripSub}>{channelSubtitle(channel)}</span>
      </div>

      <Readout
        className={styles.stripReadout}
        value={formatAudioDb(sendLevel)}
        empty={!feeding && !channel.mute}
        testId={`audio-lane-readout-${channel.id}`}
      />

      <div className={styles.stripPre}>
        {supportsPreamp ? (
          <>
            {/* 48 V is the one control on the strip that can damage a source,
                so it is a hazard key: it arms, then applies. */}
            <Key
              mode="hazard"
              cap="48 V"
              lit={channel.phantom}
              data-armed={armedActionKey === phantomArmKey ? "true" : "false"}
              data-control="phantom"
              locked={!actionsAllowed}
              reason={lockedReason}
              size="small"
              take
              testId={`audio-lane-phantom-${channel.id}`}
              aria-label={`${channel.phantom ? "Switch off" : "Switch on"} 48 V on ${channel.name}`}
              aria-pressed={channel.phantom}
              title={`48 V phantom ${channel.phantom ? "on" : "off"} — press twice to change it`}
              onClick={(event) => {
                event.stopPropagation();
                onTogglePhantom({
                  channelId: channel.id,
                  channelName: channel.name,
                  phantom: !channel.phantom,
                });
              }}
            />
            <AudioStripGainKey
              channelId={channel.id}
              disabled={!actionsAllowed}
              gain={gain}
              label={`${channel.name} preamp gain`}
              lockedReason={lockedReason}
              onCommit={(nextGain) => {
                setDraftValue(gainDraftKey, nextGain);
                commitChannelContinuous({ channelId: channel.id, gain: nextGain });
                clearDraftValueLater(gainDraftKey);
              }}
              onPreview={(nextGain) => setDraftValue(gainDraftKey, nextGain)}
            />
          </>
        ) : (
          <>
            <span className={styles.stripTag}>{channel.stereo ? "stereo" : "mono"}</span>
            <span className={styles.stripSends} data-testid={`audio-lane-sends-${channel.id}`}>
              {otherSends.map((send) => (
                <span key={send.id} className={styles.stripSendRow}>
                  <span>{send.name}</span>
                  <b>{formatAudioDb(send.level)}</b>
                </span>
              ))}
            </span>
          </>
        )}
      </div>

      <div className={styles.stripKeys}>
        <Tooltip content={`Mute ${channel.name} (M)`}>
          <Key
            mode="toggle"
            cap="M"
            engaged={channel.mute}
            locked={!actionsAllowed}
            reason={lockedReason}
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
        </Tooltip>
        <Tooltip content={`Solo ${channel.name} (S)`}>
          <Key
            mode="toggle"
            cap="S"
            engaged={channel.solo}
            locked={!actionsAllowed}
            reason={lockedReason}
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
        </Tooltip>
      </div>

      {channel.clip ? (
        <Key
          mode="danger"
          cap="Clip"
          className={styles.stripClip}
          size="small"
          testId={`audio-lane-clip-${channel.id}`}
          aria-label={`Clear clip for ${channel.name}`}
          title="Clear clip hold"
          onClick={(event) => {
            event.stopPropagation();
            onClearClip(channel.id);
          }}
        />
      ) : null}

      <AudioStripFader
        clip={channel.clip}
        disabled={!actionsAllowed}
        empty={meterEmpty}
        label={`${channel.name} send level`}
        level={channel.meterLeft}
        levelRight={channel.stereo ? channel.meterRight : undefined}
        meterId={channel.id}
        meterKind="channel"
        meterLabel={`${channel.name} meter`}
        onCommit={(value) => {
          setDraftValue(sendDraftKey, value);
          throttledSendCommit.schedule({
            channelId: channel.id,
            fader: value,
            mixTargetId: selectedMixTargetId ?? undefined,
          });
          throttledSendCommit.flush();
          clearDraftValueLater(sendDraftKey);
        }}
        onPreview={(value) => {
          setDraftValue(sendDraftKey, value);
          throttledSendCommit.schedule({
            channelId: channel.id,
            fader: value,
            mixTargetId: selectedMixTargetId ?? undefined,
          });
        }}
        peak={channel.peakHoldLeft}
        peakRight={channel.stereo ? channel.peakHoldRight : undefined}
        value={sendLevel}
      />
    </article>
  );
}

export function AudioOutputLane({
  actionsAllowed,
  clearDraftValueLater,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  lockedReason,
  meterEmpty,
  mixTarget,
  onSelect,
  onUpdateMixTarget,
  setDraftValue,
  selected,
}: {
  actionsAllowed: boolean;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  lockedReason?: string;
  meterEmpty?: boolean;
  mixTarget: AudioMixTargetEntry;
  onSelect: (mixTargetId: string) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  selected: boolean;
}) {
  const volumeDraftKey = `mixTarget:${mixTarget.id}:volume`;
  const volume = useAudioControlDraftValue(draftStore, volumeDraftKey, getDraftValue(volumeDraftKey, mixTarget.volume));
  const throttledVolumeCommit = useMemo(
    () => createThrottledCommit<AudioMixTargetUpdate>(commitMixTargetContinuous, AUDIO_THROTTLE_FADER_MS),
    [commitMixTargetContinuous]
  );

  return (
    <article
      className={styles.strip}
      data-audio-output-id={mixTarget.id}
      data-role={mixTarget.role}
      data-selected={selected}
      data-testid={`audio-output-${mixTarget.id}`}
      onClick={() => onSelect(mixTarget.id)}
    >
      <div className={styles.stripHead}>
        <span className={styles.stripName} data-testid={`audio-lane-name-${mixTarget.id}`}>
          {mixTarget.name}
        </span>
        <span className={styles.stripSub}>{outputSubtitle(mixTarget)}</span>
      </div>

      <Readout
        className={styles.stripReadout}
        value={formatAudioDb(volume)}
        testId={`audio-lane-readout-${mixTarget.id}`}
      />

      <div className={styles.stripPre}>
        <span className={styles.stripTag} data-active={selected} data-testid={`audio-lane-tag-${mixTarget.id}`}>
          {selected ? "mix target" : outputTag(mixTarget)}
        </span>
        <span className={styles.stripLamps}>
          <LampWord cap={false} tone={mixTarget.dim ? "attention" : "off"}>
            dim
          </LampWord>
          <LampWord cap={false} tone={mixTarget.mono ? "attention" : "off"}>
            mono
          </LampWord>
        </span>
      </div>

      <div className={styles.stripKeys}>
        <Key
          mode="toggle"
          cap="M"
          engaged={mixTarget.mute}
          locked={!actionsAllowed}
          reason={lockedReason}
          take
          className={styles.stripKey}
          data-control="mute"
          data-active={mixTarget.mute}
          aria-label={`Mute ${mixTarget.name}`}
          aria-pressed={mixTarget.mute}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateMixTarget({ mixTargetId: mixTarget.id, mute: !mixTarget.mute });
          }}
        />
      </div>

      <AudioStripFader
        disabled={!actionsAllowed}
        empty={meterEmpty}
        label={`${mixTarget.name} output level`}
        level={mixTarget.meterLeft}
        levelRight={mixTarget.mono ? mixTarget.meterLeft : mixTarget.meterRight}
        meterId={mixTarget.id}
        meterKind="mixTarget"
        meterLabel={`${mixTarget.name} meter`}
        onCommit={(value) => {
          setDraftValue(volumeDraftKey, value);
          throttledVolumeCommit.schedule({ mixTargetId: mixTarget.id, volume: value });
          throttledVolumeCommit.flush();
          clearDraftValueLater(volumeDraftKey);
        }}
        onPreview={(value) => {
          setDraftValue(volumeDraftKey, value);
          throttledVolumeCommit.schedule({ mixTargetId: mixTarget.id, volume: value });
        }}
        peak={mixTarget.peakHoldLeft}
        peakRight={mixTarget.peakHoldRight}
        value={volume}
      />
    </article>
  );
}
