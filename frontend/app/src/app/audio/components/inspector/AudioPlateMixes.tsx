import { EmptyLine, MenuButton, Section, Slider, Tooltip, type UseArmResult } from "@sse/design-system";

import styles from "../AudioInspector.module.css";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../../audioControlDraftStore";
import { AUDIO_FADER_UNITY, AUDIO_FADER_UNITY_SNAP, formatAudioDb } from "../../audioFormatting";
import { selectedChannelSendLevel } from "../../audioViewModel";
import type { AudioMixTargetEntry } from "../../../shellData";
import type { AudioChannelUpdate, SelectedAudioChannel } from "./audioInspectorHelpers";

// The other mixes this source feeds (visual overhaul, the Console; Atrium's
// OTHER MIXES): a row each, its name, its send as a slider and a value, and
// a ⋯ that makes it the mix target. The mix target's send is the strip's
// fader, its one home, so it has no row here. A send has no modes of its own:
// TotalMix has no pre fader, mute, link or solo per send (2026-10-04). The
// visual overhaul's polish (2026-10-05): a send's value prints its unit at
// half size in the quiet ink, as the strips' and the outputs' do; a value the
// desk has not confirmed is drawn in doubt; no other mix is the design
// system's empty line.

export function AudioPlateMixes({
  actionsAllowed,
  arm,
  channel,
  clearDraftValueLater,
  commitChannelContinuous,
  doubt,
  draftStore,
  getDraftValue,
  menuLock,
  mixTargets,
  onSelectMixTarget,
  selectedMixTarget,
  setDraftValue,
}: {
  actionsAllowed: boolean;
  arm: UseArmResult;
  channel: SelectedAudioChannel;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  /** The desk has not confirmed the sends: each value carries the dashed yellow keyline (DESIGN.md §4). */
  doubt: boolean;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  menuLock: string | null;
  mixTargets: readonly AudioMixTargetEntry[];
  onSelectMixTarget: (mixTargetId: string) => void;
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
        <EmptyLine>No other mix</EmptyLine>
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
              doubt={doubt}
              draftStore={draftStore}
              getDraftValue={getDraftValue}
              menuLock={menuLock}
              mixTarget={mixTarget}
              onSelectMixTarget={onSelectMixTarget}
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
  doubt,
  draftStore,
  getDraftValue,
  menuLock,
  mixTarget,
  onSelectMixTarget,
  setDraftValue,
}: {
  actionsAllowed: boolean;
  arm: UseArmResult;
  channel: SelectedAudioChannel;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  doubt: boolean;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  menuLock: string | null;
  mixTarget: AudioMixTargetEntry;
  onSelectMixTarget: (mixTargetId: string) => void;
  setDraftValue: (key: string, value: number) => void;
}) {
  const draftKey = `channel:${channel.id}:send:${mixTarget.id}`;
  const value = useAudioControlDraftValue(
    draftStore,
    draftKey,
    getDraftValue(draftKey, selectedChannelSendLevel(channel, mixTarget.id))
  );
  const sendMuted = channel.mute;
  const noSend = value <= 0.01;
  const commit = (next: number) => {
    setDraftValue(draftKey, next);
    commitChannelContinuous({ channelId: channel.id, fader: next, mixTargetId: mixTarget.id });
    clearDraftValueLater(draftKey);
  };

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
      <span
        className={styles.mixValue}
        data-muted={sendMuted ? "" : undefined}
        data-doubt={doubt ? "" : undefined}
        data-testid={`audio-send-value-${mixTarget.id}`}
      >
        {sendMuted ? (
          "muted"
        ) : (
          <>
            {formatAudioDb(value).replace(/ dB$/, "")}
            <span className={styles.unit}> dB</span>
          </>
        )}
      </span>
      <MenuButton
        buttonLabel={`Send to ${mixTarget.name} menu`}
        buttonTestId={`audio-send-menu-${mixTarget.id}`}
        size="sm"
        menu={{
          head: { title: `Send to ${mixTarget.name}`, detail: channel.name },
          items: [
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
