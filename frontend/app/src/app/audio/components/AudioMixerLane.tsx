import { useMemo, type MouseEvent as ReactMouseEvent } from "react";
import type { ShellStore } from "@sse/engine-client";
import { Tooltip } from "@sse/design-system";

import styles from "./AudioMixerLane.module.css";
import { AUDIO_THROTTLE_FADER_MS } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { createThrottledCommit } from "../audioContinuousControls";
import { formatAudioDb } from "../audioFormatting";
import { audioChannelSupportsGain, getAudioChannelGroup, selectedChannelSendLevel } from "../audioViewModel";
import type { AudioChannelEntry, AudioMixTargetEntry } from "../../shellData";
import { AudioFader } from "./AudioFader";
import { AudioLaneTagStrip } from "./AudioLaneTagStrip";
import { AudioStereoMeter } from "./AudioStereoMeter";
import { AudioStripPreamp } from "./AudioStripPreamp";

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

function outputGlyphKind(role: string): "speaker" | "phones" | "line" {
  if (role === "phones-a" || role === "phones-b") return "phones";
  if (role === "main-out") return "speaker";
  return "line";
}

function OutputDestinationGlyph({ kind, active }: { kind: "speaker" | "phones" | "line"; active: boolean }) {
  const fill = active ? "var(--accent)" : "var(--fg-3)";
  if (kind === "phones") {
    return (
      <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 7v-1a4 4 0 0 1 8 0v1" stroke={fill} strokeWidth="1.2" strokeLinecap="round" />
        <rect x="1.5" y="6.5" width="2" height="3.5" rx=".7" fill={fill} />
        <rect x="8.5" y="6.5" width="2" height="3.5" rx=".7" fill={fill} />
      </svg>
    );
  }
  if (kind === "line") {
    return (
      <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <circle cx="6" cy="6" r="4" stroke={fill} strokeWidth="1.2" />
        <circle cx="6" cy="6" r="1.3" fill={fill} />
      </svg>
    );
  }
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 4.5h1.5L7 2.5v7L4.5 7.5H3z" fill={fill} />
      <path d="M8.5 4.5c1 1 1 2 0 3" stroke={fill} strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
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
          {/* Badges row — prototype shows 48V / HiZ / Ø on the strip when
              engaged. Reserved (min-height) on preamp-capable strips so the
              meter baseline stays aligned whether or not a badge is lit. */}
          {supportsPreamp ? (
            <span className={styles.laneBadges}>
              {channel.phantom ? <span className={`${styles.laneBadge} ${styles.laneBadgePhantom}`}>48V</span> : null}
              {channel.instrument ? <span className={styles.laneBadge}>HiZ</span> : null}
              {channel.phase ? <span className={styles.laneBadge}>Ø</span> : null}
            </span>
          ) : null}
        </div>
        {channel.clip ? (
          <span className={styles.laneHeaderBadges}>
            <button
              className={styles.laneClipPill}
              aria-label={`Clear clip for ${channel.name}`}
              onClick={(event) => {
                event.stopPropagation();
                onClearClip(channel.id);
              }}
              title="Clear clip hold"
              type="button"
            >
              CLIP
            </button>
          </span>
        ) : null}
      </div>

      {supportsPreamp ? null : channel.role === "playback-pair" ? (
        // Phase 3 follow-up E17/E18: playback strips have no preamp control,
        // so the same vertical slot used to read as missing content. The
        // tag strip names the group + format using the already-available
        // viewModel data — no new engine state required.
        <AudioLaneTagStrip group={(group ?? "playback").toUpperCase()} stereo={channel.stereo} />
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

      {supportsPreamp ? (
        <AudioStripPreamp
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
        />
      ) : null}
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

  const glyphKind = outputGlyphKind(mixTarget.role);
  const pairLabel =
    mixTarget.role === "phones-a"
      ? "Phones · A"
      : mixTarget.role === "phones-b"
        ? "Phones · B"
        : mixTarget.role === "main-out"
          ? "Stereo"
          : "Line";

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
            {selected ? <span className={styles.outputActiveMark}>ACTIVE</span> : null}
          </span>
          <span className={styles.outputNameRow}>
            <OutputDestinationGlyph kind={glyphKind} active={selected} />
            <span className={styles.laneName}>{mixTarget.name}</span>
          </span>
          <span className={styles.outputPair}>{pairLabel}</span>
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
      </div>

      <div className={styles.laneReadout}>{formatLaneReadout(volume)}</div>

      <div className={styles.laneControls}>
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
          M
        </button>
      </div>
    </article>
  );
}
