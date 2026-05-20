import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";
import { Tooltip } from "@sse/design-system";

import styles from "./AudioMixerLane.module.css";
import { AUDIO_THROTTLE_FADER_MS } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
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
  return formatAudioDb(value).replace(" dB", "dB");
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
  clearDraftValueLater,
  commitChannelContinuous,
  draftStore,
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
}: {
  actionsAllowed: boolean;
  channel: AudioChannelEntry;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  draftStore: AudioControlDraftStore;
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
  const preampNumber = supportsPreamp ? inputPreampNumber(channel.id) : null;
  const group = getAudioChannelGroup(channel);
  const throttledSendCommit = useMemo(
    () => createThrottledCommit<AudioChannelUpdate>(commitChannelContinuous, AUDIO_THROTTLE_FADER_MS),
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
      onContextMenuCapture={(event) => onOpenContextMenu(event, channel.id)}
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
            clearDraftValueLater(gainDraftKey);
          }}
          onPreview={(nextGain) => setDraftValue(gainDraftKey, nextGain)}
          variant="compact"
        />
      ) : null}

      <div className={styles.laneBody}>
        <AudioStereoMeter
          clip={channel.clip}
          left={channel.meterLeft}
          meterId={channel.id}
          meterKind="channel"
          mirrorRight={!channel.stereo}
          peakLeft={channel.peakHoldLeft}
          peakRight={channel.stereo ? channel.peakHoldRight : channel.peakHoldLeft}
          right={channel.stereo ? channel.meterRight : channel.meterLeft}
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
          showValue={false}
          value={sendLevel}
        />
      </div>

      <div className={styles.laneReadout}>{formatLaneReadout(sendLevel)}</div>

      <div className={styles.laneControls}>
        <Tooltip content={`Mute ${channel.name} (M)`}>
          <button
            aria-label={`Mute ${channel.name}`}
            aria-pressed={channel.mute}
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
        </Tooltip>
        <Tooltip content={`Solo ${channel.name} (S)`}>
          <button
            aria-label={`Solo ${channel.name}`}
            aria-pressed={channel.solo}
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
        </Tooltip>
      </div>
    </article>
  );
}

export function AudioOutputLane({
  actionsAllowed,
  clearDraftValueLater,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  index,
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
  index: number;
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
          left={mixTarget.meterLeft}
          meterId={mixTarget.id}
          meterKind="mixTarget"
          mirrorRight={mixTarget.mono}
          peakLeft={mixTarget.peakHoldLeft}
          peakRight={mixTarget.peakHoldRight}
          right={mixTarget.mono ? mixTarget.meterLevel : mixTarget.meterRight}
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
            clearDraftValueLater(volumeDraftKey);
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
                L {formatMeterDb(mixTarget.peakHoldLeft)}
                <em>R {formatMeterDb(mixTarget.peakHoldRight)}</em>
              </strong>
            </span>
            <span>
              <small>Nominal ref</small>
              <strong>-18 dBFS</strong>
            </span>
            <span>
              <small>Peak warn</small>
              <strong>-3 dBFS</strong>
            </span>
          </div>
        </div>
      </div>

      <div className={styles.laneControls} data-output-controls="true">
        <button
          aria-label={`Mute ${mixTarget.name}`}
          aria-pressed={mixTarget.mute}
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
        <button
          aria-label={`Dim ${mixTarget.name}`}
          aria-pressed={mixTarget.dim}
          className={styles.laneToggle}
          data-control="dim"
          data-active={mixTarget.dim}
          disabled={!actionsAllowed}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateMixTarget({ mixTargetId: mixTarget.id, dim: !mixTarget.dim });
          }}
          type="button"
        >
          Dim
        </button>
        <button
          aria-label={`Mono ${mixTarget.name}`}
          aria-pressed={mixTarget.mono}
          className={styles.laneToggle}
          data-control="mono"
          data-active={mixTarget.mono}
          disabled={!actionsAllowed}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateMixTarget({ mixTargetId: mixTarget.id, mono: !mixTarget.mono });
          }}
          type="button"
        >
          Mono
        </button>
        <button
          aria-label={`Talkback ${mixTarget.name}`}
          aria-pressed={mixTarget.talkback}
          className={styles.laneToggle}
          data-control="talk"
          data-active={mixTarget.talkback}
          disabled={!actionsAllowed}
          onClick={(event) => {
            event.stopPropagation();
            onUpdateMixTarget({ mixTargetId: mixTarget.id, talkback: !mixTarget.talkback });
          }}
          type="button"
        >
          Talk
        </button>
      </div>
    </article>
  );
}
