import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "../AudioWorkspace.module.css";
import { createThrottledCommit } from "../audioContinuousControls";
import { formatAudioDb, formatMeterDb } from "../audioFormatting";
import { audioChannelSupportsGain, getAudioChannelGroup, selectedChannelSendLevel } from "../audioViewModel";
import type { AudioChannelEntry, AudioMixTargetEntry } from "../../shellData";
import { AudioFader } from "./AudioFader";
import { AudioPreampControl } from "./AudioPreampControl";
import { AudioStereoMeter } from "./AudioStereoMeter";

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

function inputPreampNumber(channelId: string) {
  const raw = Number(channelId.match(/\d+/g)?.at(-1) ?? 1);
  if (!Number.isFinite(raw)) return 1;
  return raw >= 9 ? raw - 8 : raw;
}

function formatLaneReadout(value: number) {
  return formatAudioDb(value).replace(" dB", "dB").replace("-inf", "-∞");
}

function formatLaneNumber(index: number) {
  return String(index + 1).padStart(2, "0");
}

function outputHeaderStatus(mixTarget: AudioMixTargetEntry, selected: boolean) {
  if (selected) return "ACTIVE MIX";
  if (mixTarget.role === "phones-a") return "CUE A";
  if (mixTarget.role === "phones-b") return "CUE B";
  return "SUBMIX";
}

export function AudioChannelLane({
  actionsAllowed,
  channel,
  clearDraftValue,
  commitChannelContinuous,
  feeding,
  getDraftValue,
  index,
  onClearClip,
  onOpenContextMenu,
  onSelect,
  onUpdateChannel,
  setDraftValue,
  selected,
  selectedMixTargetId,
  simulatedMeters,
}: {
  actionsAllowed: boolean;
  channel: AudioChannelEntry;
  clearDraftValue: (key: string) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  feeding: boolean;
  getDraftValue: (key: string, fallback: number) => number;
  index: number;
  onClearClip: (channelId: string) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, channelId: string) => void;
  onSelect: (channelId: string) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  selected: boolean;
  selectedMixTargetId: string | null;
  simulatedMeters: boolean;
}) {
  const sendDraftKey = `channel:${channel.id}:send:${selectedMixTargetId ?? "none"}`;
  const sendLevel = getDraftValue(sendDraftKey, selectedChannelSendLevel(channel, selectedMixTargetId));
  const gainDraftKey = `channel:${channel.id}:gain`;
  const gain = getDraftValue(gainDraftKey, channel.gain);
  const supportsPreamp = audioChannelSupportsGain(channel);
  const preampNumber = supportsPreamp ? inputPreampNumber(channel.id) : null;
  const group = getAudioChannelGroup(channel);
  const throttledSendCommit = useMemo(
    () => createThrottledCommit<AudioChannelUpdate>(commitChannelContinuous, 75),
    [commitChannelContinuous]
  );

  return (
    <article
      className={styles.channelLane}
      data-audio-channel-id={channel.id}
      data-clip={channel.clip}
      data-feeding={feeding}
      data-group={group}
      data-no-send={!feeding && !channel.mute}
      data-role={channel.role}
      data-selected={selected}
      data-testid={`audio-strip-${channel.id}`}
      onClick={() => onSelect(channel.id)}
      onContextMenu={(event) => onOpenContextMenu(event, channel.id)}
    >
      <div className={styles.laneHeader}>
        <div className={styles.laneNameBlock}>
          {preampNumber ? (
            <span className={styles.lanePreampRow}>
              <span>{String(preampNumber).padStart(2, "0")}</span>
              <span>PREAMP {preampNumber}</span>
            </span>
          ) : (
            <span className={styles.laneIndexRow}>
              <span>{formatLaneNumber(index)}</span>
              <span>{channel.stereo ? "STEREO" : "MONO"}</span>
            </span>
          )}
          <span className={styles.laneName}>{channel.name}</span>
        </div>
        {channel.clip ? (
          <span className={styles.laneHeaderBadges}>
            {channel.clip ? (
              <button
                className={styles.laneClipDot}
                aria-label={`Clear clip for ${channel.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClearClip(channel.id);
                }}
                title="Clear clip hold"
                type="button"
              />
            ) : null}
          </span>
        ) : null}
      </div>

      {supportsPreamp ? (
        <AudioPreampControl
          channelId={channel.id}
          disabled={!actionsAllowed}
          gain={gain}
          label={`${channel.name} preamp gain`}
          onCommit={(nextGain) => {
            setDraftValue(gainDraftKey, nextGain);
            commitChannelContinuous({ channelId: channel.id, gain: nextGain });
            window.setTimeout(() => clearDraftValue(gainDraftKey), 250);
          }}
          onPreview={(nextGain) => setDraftValue(gainDraftKey, nextGain)}
          variant="compact"
        />
      ) : null}

      <div className={styles.laneBody}>
        <AudioStereoMeter
          clip={channel.clip}
          left={channel.meterLeft}
          peak={channel.peakHold}
          right={channel.stereo ? channel.meterRight : channel.meterLevel * 0.84}
          simulated={simulatedMeters}
          simulationIndex={index}
          showPeakReadout={supportsPreamp || channel.role === "playback-pair"}
          showReadout={false}
          showScale
        />

        <AudioFader
          disabled={!actionsAllowed}
          label={`${channel.name} send level`}
          onCommit={(value) => {
            setDraftValue(sendDraftKey, value);
            throttledSendCommit.schedule({
              channelId: channel.id,
              fader: value,
              mixTargetId: selectedMixTargetId ?? undefined,
            });
            throttledSendCommit.flush();
            window.setTimeout(() => clearDraftValue(sendDraftKey), 250);
          }}
          onPreview={(value) => {
            setDraftValue(sendDraftKey, value);
            throttledSendCommit.schedule({
              channelId: channel.id,
              fader: value,
              mixTargetId: selectedMixTargetId ?? undefined,
            });
          }}
          showValue={false}
          value={sendLevel}
        />
      </div>

      <div className={styles.laneReadout}>{formatLaneReadout(sendLevel)}</div>

      <div className={styles.laneControls}>
        <button
          aria-label="Mute"
          className={styles.laneToggle}
          data-control="mute"
          data-active={channel.mute}
          disabled={!actionsAllowed}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateChannel({ channelId: channel.id, mute: !channel.mute });
          }}
          type="button"
        >
          M
        </button>
        <button
          aria-label="Solo"
          className={styles.laneToggle}
          data-control="solo"
          data-active={channel.solo}
          disabled={!actionsAllowed}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateChannel({ channelId: channel.id, solo: !channel.solo });
          }}
          type="button"
        >
          S
        </button>
      </div>
    </article>
  );
}

export function AudioOutputLane({
  actionsAllowed,
  clearDraftValue,
  commitMixTargetContinuous,
  getDraftValue,
  index,
  mixTarget,
  onSelect,
  onUpdateMixTarget,
  setDraftValue,
  selected,
  simulatedMeters,
}: {
  actionsAllowed: boolean;
  clearDraftValue: (key: string) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  getDraftValue: (key: string, fallback: number) => number;
  index: number;
  mixTarget: AudioMixTargetEntry;
  onSelect: (mixTargetId: string) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
  selected: boolean;
  simulatedMeters: boolean;
}) {
  const volumeDraftKey = `mixTarget:${mixTarget.id}:volume`;
  const volume = getDraftValue(volumeDraftKey, mixTarget.volume);
  const throttledVolumeCommit = useMemo(
    () => createThrottledCommit<AudioMixTargetUpdate>(commitMixTargetContinuous, 75),
    [commitMixTargetContinuous]
  );

  return (
    <article
      className={styles.outputLane}
      data-audio-output-id={mixTarget.id}
      data-role={mixTarget.role}
      data-selected={selected}
      data-testid={`audio-output-${mixTarget.id}`}
      onClick={() => onSelect(mixTarget.id)}
    >
      <div className={styles.laneHeader}>
        <div className={styles.laneNameBlock}>
          <span className={styles.laneIndexRow}>
            <span>{formatLaneNumber(index)}</span>
            <span>{outputHeaderStatus(mixTarget, selected)}</span>
          </span>
          <span className={styles.laneName}>{mixTarget.name}</span>
        </div>
      </div>

      <div className={styles.outputBody}>
        <AudioStereoMeter
          left={volume}
          peak={volume}
          right={volume * 0.96}
          simulated={simulatedMeters}
          simulationIndex={index + 12}
          showReadout={false}
          showScale
        />
        <AudioFader
          disabled={!actionsAllowed}
          label={`${mixTarget.name} output level`}
          onCommit={(value) => {
            setDraftValue(volumeDraftKey, value);
            throttledVolumeCommit.schedule({ mixTargetId: mixTarget.id, volume: value });
            throttledVolumeCommit.flush();
            window.setTimeout(() => clearDraftValue(volumeDraftKey), 250);
          }}
          onPreview={(value) => {
            setDraftValue(volumeDraftKey, value);
            throttledVolumeCommit.schedule({ mixTargetId: mixTarget.id, volume: value });
          }}
          showValue={false}
          value={volume}
        />
        <div className={styles.outputBusPanel}>
          <span>
            <small>Bus level</small>
            <strong>{formatAudioDb(volume)}</strong>
          </span>
          <div className={styles.outputMetricGrid}>
            <span>
              <small>Peak hold</small>
              <strong>
                L {formatMeterDb(volume)}
                <em>R {formatMeterDb(volume * 0.96)}</em>
              </strong>
            </span>
            <span>
              <small>LUFS short</small>
              <strong>n/a</strong>
            </span>
            <span>
              <small>Correlation</small>
              <strong>n/a</strong>
            </span>
          </div>
        </div>
      </div>

      <div className={styles.laneControls}>
        <button
          className={styles.laneToggle}
          data-control="mute"
          data-active={mixTarget.mute}
          disabled={!actionsAllowed}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateMixTarget({ mixTargetId: mixTarget.id, mute: !mixTarget.mute });
          }}
          type="button"
        >
          Mute
        </button>
        <button className={styles.laneToggle} data-control="cue" disabled type="button">
          Cue
        </button>
      </div>
    </article>
  );
}
