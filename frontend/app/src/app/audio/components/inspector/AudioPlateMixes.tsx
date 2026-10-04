import { MenuButton, Section, Slider, Tooltip, type UseArmResult } from "@sse/design-system";

import styles from "../AudioInspector.module.css";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../../audioControlDraftStore";
import { AUDIO_FADER_UNITY, AUDIO_FADER_UNITY_SNAP, formatAudioDb } from "../../audioFormatting";
import { selectedChannelSendLevel } from "../../audioViewModel";
import { channelSendMode } from "../audioChannelMenu";
import type { AudioMixTargetEntry } from "../../../shellData";
import type { AudioChannelUpdate, AudioSendModeUpdate, SelectedAudioChannel } from "./audioInspectorHelpers";

// The other mixes this source feeds (visual overhaul, the Console; Atrium's
// OTHER MIXES): a row each, its name, its send as a slider and a value, and
// the send's modes in the row's ⋯. The mix target's send is the strip's fader,
// its one home, so it has no row here.

export function AudioPlateMixes({
  actionsAllowed,
  arm,
  channel,
  clearDraftValueLater,
  commitChannelContinuous,
  draftStore,
  getDraftValue,
  menuLock,
  mixTargets,
  onSelectMixTarget,
  onUpdateChannelSendMode,
  selectedMixTarget,
  setDraftValue,
}: {
  actionsAllowed: boolean;
  arm: UseArmResult;
  channel: SelectedAudioChannel;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  menuLock: string | null;
  mixTargets: readonly AudioMixTargetEntry[];
  onSelectMixTarget: (mixTargetId: string) => void;
  onUpdateChannelSendMode: (request: AudioSendModeUpdate) => void;
  selectedMixTarget: AudioMixTargetEntry | null;
  setDraftValue: (key: string, value: number) => void;
}) {
  const others = mixTargets.filter((mixTarget) => mixTarget.id !== selectedMixTarget?.id);
  return (
    <Section
      title={
        <Tooltip
          content={`The sends into the other mixes. The send into ${selectedMixTarget?.name ?? "the mix target"} is the strip's fader.`}
          placement="left"
        >
          <span>Other mixes</span>
        </Tooltip>
      }
      className={styles.section}
      data-plate-section="send"
      testId="audio-inspector-sends"
    >
      {others.length === 0 ? (
        <span className={styles.quiet}>No other mix</span>
      ) : (
        <div className={styles.mixRows}>
          {others.map((mixTarget) => (
            <AudioPlateMixRow
              key={mixTarget.id}
              actionsAllowed={actionsAllowed}
              arm={arm}
              channel={channel}
              clearDraftValueLater={clearDraftValueLater}
              commitChannelContinuous={commitChannelContinuous}
              draftStore={draftStore}
              getDraftValue={getDraftValue}
              menuLock={menuLock}
              mixTarget={mixTarget}
              onSelectMixTarget={onSelectMixTarget}
              onUpdateChannelSendMode={onUpdateChannelSendMode}
              setDraftValue={setDraftValue}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function AudioPlateMixRow({
  actionsAllowed,
  arm,
  channel,
  clearDraftValueLater,
  commitChannelContinuous,
  draftStore,
  getDraftValue,
  menuLock,
  mixTarget,
  onSelectMixTarget,
  onUpdateChannelSendMode,
  setDraftValue,
}: {
  actionsAllowed: boolean;
  arm: UseArmResult;
  channel: SelectedAudioChannel;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  menuLock: string | null;
  mixTarget: AudioMixTargetEntry;
  onSelectMixTarget: (mixTargetId: string) => void;
  onUpdateChannelSendMode: (request: AudioSendModeUpdate) => void;
  setDraftValue: (key: string, value: number) => void;
}) {
  const draftKey = `channel:${channel.id}:send:${mixTarget.id}`;
  const value = useAudioControlDraftValue(
    draftStore,
    draftKey,
    getDraftValue(draftKey, selectedChannelSendLevel(channel, mixTarget.id))
  );
  const mode = channelSendMode(channel, mixTarget.id);
  const sendMuted = channel.mute || mode.mute;
  const noSend = value <= 0.01;
  const commit = (next: number) => {
    setDraftValue(draftKey, next);
    commitChannelContinuous({ channelId: channel.id, fader: next, mixTargetId: mixTarget.id });
    clearDraftValueLater(draftKey);
  };
  const setMode = (patch: Omit<AudioSendModeUpdate, "channelId" | "mixTargetId">) =>
    onUpdateChannelSendMode({ channelId: channel.id, mixTargetId: mixTarget.id, ...patch });

  return (
    <div
      className={styles.mixRow}
      data-active={false}
      data-send-state={sendMuted ? "muted" : noSend ? "none" : "sending"}
      data-testid={`audio-send-destination-${mixTarget.id}`}
    >
      <span className={styles.mixName}>{mixTarget.name}</span>
      <Slider
        label={`${channel.name} send to ${mixTarget.name}`}
        value={value}
        unity={AUDIO_FADER_UNITY}
        snapUnity
        unitySnap={AUDIO_FADER_UNITY_SNAP}
        locked={!actionsAllowed}
        valueText={formatAudioDb(value)}
        onChange={(next) => setDraftValue(draftKey, next)}
        onCommit={commit}
      />
      <span className={styles.mixValue} data-muted={sendMuted ? "" : undefined}>
        {sendMuted ? "muted" : formatAudioDb(value)}
      </span>
      <MenuButton
        buttonLabel={`Send to ${mixTarget.name} menu`}
        buttonTestId={`audio-send-menu-${mixTarget.id}`}
        size="sm"
        menu={{
          head: { title: `Send to ${mixTarget.name}`, detail: channel.name },
          items: [
            {
              kind: "check",
              id: "pre-fader",
              label: "Pre fader",
              checked: mode.preFader,
              onCheckedChange: (preFader) => setMode({ preFader }),
              disabledReason: menuLock,
              testId: `audio-send-pre-fader-${mixTarget.id}`,
            },
            {
              kind: "check",
              id: "mute",
              label: "Mute send",
              checked: mode.mute,
              onCheckedChange: (mute) => setMode({ mute }),
              disabledReason: menuLock,
              testId: `audio-send-mute-${mixTarget.id}`,
            },
            {
              kind: "check",
              id: "link",
              label: "Link L+R",
              checked: mode.linkStereo,
              onCheckedChange: (linkStereo) => setMode({ linkStereo }),
              disabledReason: menuLock,
              testId: `audio-send-link-${mixTarget.id}`,
            },
            {
              kind: "check",
              id: "solo",
              label: "Solo send",
              checked: mode.solo,
              onCheckedChange: (solo) => setMode({ solo }),
              disabledReason: menuLock,
              testId: `audio-send-solo-${mixTarget.id}`,
            },
            { kind: "divider", id: "target-divider" },
            {
              id: "target",
              label: "Make mix target",
              onSelect: () => onSelectMixTarget(mixTarget.id),
              disabledReason: menuLock,
            },
          ],
          arm,
        }}
      />
    </div>
  );
}
