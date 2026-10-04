import { useEffect, useState } from "react";
import type { ShellStore } from "@sse/engine-client";
import { MenuButton, PlateHead, Readouts, type UseArmResult } from "@sse/design-system";

import styles from "./AudioInspector.module.css";
import { buildChannelMenu, channelSendMode } from "./audioChannelMenu";
import { AudioGainEntryDialog, AudioLevelEntryDialog } from "./AudioEntryDialogs";
import { AudioPlateDynamics } from "./inspector/AudioPlateDynamics";
import { AudioPlateEq } from "./inspector/AudioPlateEq";
import { AudioPlateMeter } from "./inspector/AudioPlateMeter";
import { AudioPlateMixes } from "./inspector/AudioPlateMixes";
import { AudioPlatePreamp } from "./inspector/AudioPlatePreamp";
import { usePlateValueEntry } from "./inspector/usePlateValueEntry";
import {
  channelOrdinalLabel,
  channelTypeLabel,
  type AudioChannelUpdate,
  type AudioDynamicsUpdate,
  type AudioEqUpdate,
  type AudioSendModeUpdate,
} from "./inspector/audioInspectorHelpers";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { useAudioInspectorEqState } from "../hooks/useAudioInspectorEqState";
import {
  audioChannelSupportsGain,
  getAudioChannelGroup,
  selectedChannelSendLevel,
  type AudioWorkspaceViewModel,
} from "../audioViewModel";

// The plate (visual overhaul, the Console): the selection whole on one plate
// that never scrolls. A channel: its title plate (the name, one line of what it
// is, the strip's own menu), then its preamp (an input's), the other mixes it
// feeds, its equaliser, its dynamics and its meter. An output: its title plate
// and its meter; its level's one home is the cluster. Editing that needs more
// room than a row opens beside the row (a band's, a processor's popover).

type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];

export interface AudioInspectorProps {
  arm: UseArmResult;
  armedActionKey: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitChannelEqContinuous: (request: AudioEqUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onClearClip: (channelId: string) => void;
  onResetPeakHolds: () => void;
  onResetToUnity: (channelId: string) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onTogglePeakHold: () => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateChannelDynamics: (request: AudioDynamicsUpdate) => void;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  onUpdateChannelSendMode: (request: AudioSendModeUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  setDraftValue: (key: string, value: number) => void;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}

export function AudioInspector(props: AudioInspectorProps) {
  const { viewModel } = props;
  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) return;
    window.__SSE_TEST_RENDER_COUNTS__.audioInspector = (window.__SSE_TEST_RENDER_COUNTS__.audioInspector ?? 0) + 1;
  });

  return (
    <aside className={styles.plate} data-source-tier={viewModel.selectedSourceTier} data-testid="audio-inspector">
      {viewModel.selectedChannel ? (
        <AudioChannelPlate key={viewModel.selectedChannel.id} {...props} />
      ) : viewModel.selectedMixTarget ? (
        <AudioOutputPlate {...props} />
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>No channel selected</span>
          <span className={styles.quiet}>Press a strip to see it here.</span>
        </div>
      )}
    </aside>
  );
}

function AudioChannelPlate({
  arm,
  armedActionKey,
  clearDraftValueLater,
  commitChannelContinuous,
  commitChannelEqContinuous,
  draftStore,
  getDraftValue,
  onClearClip,
  onResetPeakHolds,
  onResetToUnity,
  onSelectMixTarget,
  onTogglePeakHold,
  onTogglePhantom,
  onUpdateChannel,
  onUpdateChannelDynamics,
  onUpdateChannelEq,
  onUpdateChannelSendMode,
  peakHoldEnabled,
  peakHoldResetToken,
  setDraftValue,
  store,
  viewModel,
}: AudioInspectorProps) {
  const channel = viewModel.selectedChannel!;
  const selectedMixTarget = viewModel.selectedMixTarget;
  const [entry, setEntry] = useState<"level" | "gain" | null>(null);
  const { ask, dialog } = usePlateValueEntry();
  const menuLock = viewModel.actionsAllowed ? null : `desk ${viewModel.status.label}`;
  const lockedReason = viewModel.actionsAllowed ? undefined : (viewModel.status.warningBody ?? undefined);
  const canEdit = viewModel.capabilities.canEditProcessing;

  const eqState = useAudioInspectorEqState({
    clearDraftValueLater,
    commitChannelEqContinuous,
    getDraftValue,
    onUpdateChannelEq,
    selectedChannel: channel,
    setDraftValue,
    viewModel,
  });

  const gainDraftKey = `channel:${channel.id}:gain`;
  const gain = useAudioControlDraftValue(draftStore, gainDraftKey, getDraftValue(gainDraftKey, channel.gain));
  const sendDraftKey = `channel:${channel.id}:send:${selectedMixTarget?.id ?? "none"}`;
  const sendLevel = useAudioControlDraftValue(
    draftStore,
    sendDraftKey,
    getDraftValue(sendDraftKey, selectedChannelSendLevel(channel, selectedMixTarget?.id ?? null))
  );
  const commitGain = (next: number) => {
    setDraftValue(gainDraftKey, next);
    commitChannelContinuous({ channelId: channel.id, gain: next });
    clearDraftValueLater(gainDraftKey);
  };

  // One line under the name: what the strip is, as the desk reports it.
  const linked = channelSendMode(channel, selectedMixTarget?.id ?? null).linkStereo;
  const sub = [
    `${channelTypeLabel(channel.role)} ${channelOrdinalLabel(viewModel, channel)}`,
    channel.stereo ? `stereo${linked ? ", linked" : ""}` : "mono",
    `group ${getAudioChannelGroup(channel)}`,
  ].join(" · ");

  const menu = buildChannelMenu({
    channel,
    gain,
    sendLevel,
    selectedMixTarget,
    mixTargets: viewModel.mixTargets,
    menuLock,
    onRequestLevel: () => setEntry("level"),
    onRequestGain: () => setEntry("gain"),
    onResetToUnity,
    onClearClip,
    onUpdateChannel,
    onUpdateChannelSendMode,
    testIdPrefix: "audio-plate-menu",
  });

  return (
    <>
      <PlateHead
        title={channel.name}
        sub={sub}
        action={
          <MenuButton buttonLabel={`${channel.name} menu`} buttonTestId="audio-plate-menu" menu={{ ...menu, arm }} />
        }
        testId="audio-plate-head"
      />

      {audioChannelSupportsGain(channel) ? (
        <AudioPlatePreamp
          actionsAllowed={viewModel.actionsAllowed}
          armedActionKey={armedActionKey}
          channel={channel}
          gain={gain}
          lockedReason={lockedReason}
          onCommitGain={commitGain}
          onPreviewGain={(next) => setDraftValue(gainDraftKey, next)}
          onTogglePhantom={onTogglePhantom}
          onUpdateChannel={onUpdateChannel}
        />
      ) : null}

      <AudioPlateMixes
        actionsAllowed={viewModel.actionsAllowed}
        arm={arm}
        channel={channel}
        clearDraftValueLater={clearDraftValueLater}
        commitChannelContinuous={commitChannelContinuous}
        draftStore={draftStore}
        getDraftValue={getDraftValue}
        menuLock={menuLock}
        mixTargets={viewModel.mixTargets}
        onSelectMixTarget={onSelectMixTarget}
        onUpdateChannelSendMode={onUpdateChannelSendMode}
        selectedMixTarget={selectedMixTarget}
        setDraftValue={setDraftValue}
      />

      <AudioPlateEq
        arm={arm}
        ask={ask}
        canEdit={canEdit}
        channel={channel}
        clearDraftValueLater={clearDraftValueLater}
        eqState={eqState}
        menuLock={menuLock}
        onUpdateChannelEq={onUpdateChannelEq}
        setDraftValue={setDraftValue}
      />

      <AudioPlateDynamics
        arm={arm}
        ask={ask}
        canEdit={canEdit}
        channel={channel}
        clearDraftValueLater={clearDraftValueLater}
        getDraftValue={getDraftValue}
        menuLock={menuLock}
        onUpdateChannelDynamics={onUpdateChannelDynamics}
        setDraftValue={setDraftValue}
      />

      <AudioPlateMeter
        arm={arm}
        extraItems={[
          {
            id: "clear-clip",
            label: "Clear clip",
            onSelect: () => onClearClip(channel.id),
            disabledReason: channel.clip ? null : "no clip held",
          },
        ]}
        kind="channel"
        meterId={channel.id}
        name={channel.name}
        left={channel.meterLeft}
        right={channel.stereo ? channel.meterRight : channel.meterLeft}
        peakLeft={channel.peakHoldLeft}
        peakRight={channel.stereo ? channel.peakHoldRight : channel.peakHoldLeft}
        mirrorRight={!channel.stereo}
        clip={channel.clip}
        onResetPeakHolds={onResetPeakHolds}
        onTogglePeakHold={onTogglePeakHold}
        peakHoldEnabled={peakHoldEnabled}
        peakHoldResetToken={peakHoldResetToken}
        plateSection="meter"
        sectionTestId="audio-plate-meter"
        meteringTestId="audio-inspector-metering"
        levelTestId="audio-inspector-level-readout"
        peakHoldTestId="audio-inspector-peak-hold-readout"
        store={store}
      />

      {entry === "level" ? (
        <AudioLevelEntryDialog
          title={`Set ${channel.name} send level`}
          value={sendLevel}
          onCancel={() => setEntry(null)}
          onConfirm={(next) => {
            setEntry(null);
            setDraftValue(sendDraftKey, next);
            commitChannelContinuous({ channelId: channel.id, fader: next, mixTargetId: selectedMixTarget?.id });
            clearDraftValueLater(sendDraftKey);
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
      {dialog}
    </>
  );
}

function AudioOutputPlate({
  arm,
  onResetPeakHolds,
  onTogglePeakHold,
  peakHoldEnabled,
  peakHoldResetToken,
  store,
  viewModel,
}: AudioInspectorProps) {
  const mixTarget = viewModel.selectedMixTarget!;
  const isMainOut = mixTarget.role === "main-out";
  const targeted = mixTarget.id === viewModel.selectedMixTargetId;
  const rows = [
    { id: "routing", label: "Feeds", value: "Hardware output" },
    {
      id: "mute",
      label: "Mute",
      value: mixTarget.mute ? "on" : "off",
      tone: mixTarget.mute ? ("attention" as const) : undefined,
    },
    ...(isMainOut
      ? [
          {
            id: "dim",
            label: "Dim",
            value: mixTarget.dim ? "−20 dB" : "off",
            tone: mixTarget.dim ? ("attention" as const) : undefined,
          },
          {
            id: "mono",
            label: "Mono",
            value: mixTarget.mono ? "on" : "off",
            tone: mixTarget.mono ? ("attention" as const) : undefined,
          },
        ]
      : []),
  ];
  return (
    <div data-testid="audio-inspector-output" className={styles.outputPlate}>
      <PlateHead
        title={mixTarget.name}
        sub={targeted ? "Output · the mix target: the strips' faders send into it" : "Output"}
        testId="audio-plate-head"
      />
      <AudioPlateMeter
        arm={arm}
        facts={<Readouts rows={rows} />}
        kind="mixTarget"
        meterId={mixTarget.id}
        name={mixTarget.name}
        left={mixTarget.meterLeft}
        right={mixTarget.mono ? mixTarget.meterLeft : mixTarget.meterRight}
        peakLeft={mixTarget.peakHoldLeft}
        peakRight={mixTarget.peakHoldRight}
        mirrorRight={mixTarget.mono}
        onResetPeakHolds={onResetPeakHolds}
        onTogglePeakHold={onTogglePeakHold}
        peakHoldEnabled={peakHoldEnabled}
        peakHoldResetToken={peakHoldResetToken}
        plateSection="output"
        sectionTestId="audio-inspector-output-panel"
        meteringTestId="audio-inspector-output-metering"
        levelTestId="audio-inspector-output-level-readout"
        peakHoldTestId="audio-inspector-output-peak-hold-readout"
        store={store}
        title="Output"
      />
    </div>
  );
}
