import { useEffect, useRef } from "react";
import type { ShellStore } from "@sse/engine-client";
import { Key, PlateHead, Section } from "@sse/design-system";

import styles from "./AudioInspector.module.css";
import { AudioPlateChannelFacts } from "./AudioPlateChannelFacts";
import { AudioEmptyInspector } from "./inspector/AudioEmptyInspector";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { audioChannelSupportsGain, getAudioChannelGroup, type AudioWorkspaceViewModel } from "../audioViewModel";
import { useAudioInspectorEqState } from "../hooks/useAudioInspectorEqState";
import { AudioInspectorChannelHardwareCard } from "./inspector/AudioInspectorChannelHardwareCard";
import { AudioInspectorChannelHeader } from "./inspector/AudioInspectorChannelHeader";
import { AudioInspectorChannelMeterCard } from "./inspector/AudioInspectorChannelMeterCard";
import { AudioInspectorDynamicsTab } from "./inspector/AudioInspectorDynamicsTab";
import { AudioInspectorEqTab } from "./inspector/AudioInspectorEqTab";
import { AudioInspectorOutputView } from "./inspector/AudioInspectorOutputView";
import { AudioInspectorSendsTab } from "./inspector/AudioInspectorSendsTab";
import {
  type AudioChannelUpdate,
  type AudioDynamicsUpdate,
  type AudioEqUpdate,
  type AudioMixTargetUpdate,
  type AudioSendModeUpdate,
  type PlateSection,
} from "./inspector/audioInspectorHelpers";

export type { PlateSection };

// Visual overhaul A, Slice 4c (system §7, plan Slice 4): the plate. Each
// section keeps the test id its tab panel carried, and says which section it is
// with `data-plate-section` for the accelerators and the geometry checks. The
// selected strip's preamp, its send, every mix it feeds, its EQ, its dynamics,
// its meter and the flags the desk reports — all of it visible at once, with no
// tab row to hide half of it behind. The accelerators the tabs carried bring
// their section into view instead.
export function AudioInspector({
  armedActionKey,
  clearDraftValueLater,
  commitChannelContinuous,
  commitChannelEqContinuous,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  onRenameChannel,
  onResetPeakHolds,
  onSelectMixTarget,
  onTogglePeakHold,
  revealSection,
  revealToken,
  setDraftValue,
  onUpdateChannelDynamics,
  onUpdateChannelEq,
  onUpdateChannelSendMode,
  onTogglePhantom,
  onUpdateChannel,
  onUpdateMixTarget,
  peakHoldEnabled,
  peakHoldResetToken,
  store,
  viewModel,
}: {
  armedActionKey: string | null;
  clearDraftValueLater: (key: string, delayMs?: number) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitChannelEqContinuous: (request: AudioEqUpdate) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  draftStore: AudioControlDraftStore;
  getDraftValue: (key: string, fallback: number) => number;
  onRenameChannel: (channelId: string) => void;
  onResetPeakHolds: () => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  onTogglePeakHold: () => void;
  /** The section an accelerator asked for; the plate scrolls it into view. */
  revealSection: PlateSection | null;
  /** Bumped on every ask, so pressing the same key twice still moves the plate. */
  revealToken: number;
  setDraftValue: (key: string, value: number) => void;
  onUpdateChannelDynamics: (request: AudioDynamicsUpdate) => void;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  onUpdateChannelSendMode: (request: AudioSendModeUpdate) => void;
  onTogglePhantom: (request: { channelId: string; channelName: string; phantom: boolean }) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  peakHoldEnabled: boolean;
  peakHoldResetToken: number;
  store: ShellStore;
  viewModel: AudioWorkspaceViewModel;
}) {
  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) return;
    window.__SSE_TEST_RENDER_COUNTS__.audioInspector = (window.__SSE_TEST_RENDER_COUNTS__.audioInspector ?? 0) + 1;
  });

  const selectedChannel = viewModel.selectedChannel;
  const selectedMixTarget = viewModel.selectedMixTarget;

  const eqState = useAudioInspectorEqState({
    clearDraftValueLater,
    commitChannelEqContinuous,
    getDraftValue,
    onUpdateChannelEq,
    selectedChannel,
    setDraftValue,
    viewModel,
  });

  const selectedClip = selectedChannel?.clip ?? false;
  const gainDraftKey = selectedChannel ? `channel:${selectedChannel.id}:gain` : "channel:none:gain";
  const selectedGain = useAudioControlDraftValue(
    draftStore,
    gainDraftKey,
    selectedChannel ? getDraftValue(gainDraftKey, selectedChannel.gain) : 0
  );
  const monitorDraftKey = selectedMixTarget
    ? `mixTarget:${selectedMixTarget.id}:inspector-volume`
    : "mixTarget:none:inspector-volume";
  const monitorValue = useAudioControlDraftValue(
    draftStore,
    monitorDraftKey,
    getDraftValue(monitorDraftKey, selectedMixTarget?.volume ?? 0)
  );
  const selectedGroup = selectedChannel ? getAudioChannelGroup(selectedChannel) : "";
  const selectedLeftMeter = selectedChannel?.meterLeft ?? 0;
  const selectedRightMeter = selectedChannel
    ? selectedChannel.stereo
      ? selectedChannel.meterRight
      : selectedLeftMeter
    : 0;
  const outputLeftMeter = selectedMixTarget?.meterLeft ?? 0;
  const outputRightMeter = selectedMixTarget?.mono
    ? (selectedMixTarget?.meterLevel ?? 0)
    : (selectedMixTarget?.meterRight ?? 0);
  const nextPhantomState = selectedChannel ? !selectedChannel.phantom : false;
  const phantomArmed = selectedChannel ? armedActionKey === `phantom:${selectedChannel.id}:${nextPhantomState}` : false;
  const phantomLabel = phantomArmed ? (nextPhantomState ? "Confirm 48V" : "Confirm Off") : "48V";
  const supportsGain = selectedChannel ? audioChannelSupportsGain(selectedChannel) : false;
  const eqOn = selectedChannel ? selectedChannel.eq.enabled : false;

  const plateRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const plate = plateRef.current;
    if (!plate || !revealSection) return;
    const target = plate.querySelector<HTMLElement>(`[data-plate-section="${revealSection}"]`);
    target?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [revealSection, revealToken]);

  const meterKeys = (
    <>
      <Key
        size="small"
        mode="toggle"
        engaged={peakHoldEnabled}
        testId="audio-peak-hold-toggle"
        aria-pressed={peakHoldEnabled}
        title={peakHoldEnabled ? "Disable held peak marks" : "Enable held peak marks"}
        onClick={onTogglePeakHold}
      >
        Peak hold
      </Key>
      <Key size="small" testId="audio-peak-hold-reset" title="Reset held peak marks" onClick={onResetPeakHolds}>
        Reset peaks
      </Key>
    </>
  );

  return (
    <aside
      className={styles.inspector}
      data-material="plate"
      data-region="plate"
      data-source-tier={viewModel.selectedSourceTier}
      data-testid="audio-inspector"
      ref={plateRef}
    >
      {selectedChannel ? (
        <>
          <PlateHead
            title={selectedChannel.name}
            sub={
              <AudioInspectorChannelHeader
                selectedChannel={selectedChannel}
                selectedGroup={selectedGroup}
                selectedMixTarget={selectedMixTarget}
                viewModel={viewModel}
              />
            }
            action={
              <Key size="small" testId="audio-plate-rename" onClick={() => onRenameChannel(selectedChannel.id)}>
                Rename
              </Key>
            }
            testId="audio-plate-head"
          />

          <Section
            className={styles.plateSection}
            title={supportsGain ? "Preamp" : "Software"}
            detail={supportsGain ? "mic / line gain on the UFX III" : "as the desk reports it"}
            data-plate-section="preamp"
            testId="audio-inspector-channel"
          >
            <AudioInspectorChannelHardwareCard
              clearDraftValueLater={clearDraftValueLater}
              commitChannelContinuous={commitChannelContinuous}
              gainDraftKey={gainDraftKey}
              onTogglePhantom={onTogglePhantom}
              onUpdateChannel={onUpdateChannel}
              phantomArmed={phantomArmed}
              phantomLabel={phantomLabel}
              selectedChannel={selectedChannel}
              selectedGain={selectedGain}
              setDraftValue={setDraftValue}
              viewModel={viewModel}
            />
          </Section>

          {/* One place for the sends: the mix the faders are on first, marked
              as the active mix, then every other mix this source feeds. The
              strip's own keys are a glance to the left, so the plate does not
              print a second Mute / Solo / Unity row. */}
          <Section
            className={styles.plateSection}
            title={`Send to ${selectedMixTarget?.name ?? "output"}`}
            detail="and every other mix this source feeds"
            data-plate-section="send"
            testId="audio-inspector-sends"
          >
            <AudioInspectorSendsTab
              clearDraftValueLater={clearDraftValueLater}
              commitChannelContinuous={commitChannelContinuous}
              getDraftValue={getDraftValue}
              onSelectMixTarget={onSelectMixTarget}
              onUpdateChannelSendMode={onUpdateChannelSendMode}
              selectedChannel={selectedChannel}
              setDraftValue={setDraftValue}
              viewModel={viewModel}
            />
          </Section>

          <Section
            className={styles.plateSection}
            title="Equaliser"
            detail={eqOn ? `on · ${eqState.eqBands.length} bands` : "bypassed"}
            data-plate-section="eq"
            testId="audio-inspector-eq"
          >
            <AudioInspectorEqTab
              {...eqState}
              clearDraftValueLater={clearDraftValueLater}
              onUpdateChannelEq={onUpdateChannelEq}
              selectedChannel={selectedChannel}
              setDraftValue={setDraftValue}
              viewModel={viewModel}
            />
          </Section>

          <Section
            className={styles.plateSection}
            title="Dynamics"
            detail="compressor and gate"
            data-plate-section="dynamics"
            testId="audio-inspector-dynamics"
          >
            <AudioInspectorDynamicsTab
              clearDraftValueLater={clearDraftValueLater}
              getDraftValue={getDraftValue}
              onUpdateChannelDynamics={onUpdateChannelDynamics}
              selectedChannel={selectedChannel}
              setDraftValue={setDraftValue}
              viewModel={viewModel}
            />
          </Section>

          <Section
            className={styles.plateSection}
            title="Meter"
            detail="post-fader · dBFS"
            data-plate-section="meter"
            testId="audio-plate-meter"
            actions={meterKeys}
          >
            <AudioInspectorChannelMeterCard
              peakHoldEnabled={peakHoldEnabled}
              peakHoldResetToken={peakHoldResetToken}
              selectedChannel={selectedChannel}
              selectedClip={selectedClip}
              selectedLeftMeter={selectedLeftMeter}
              selectedRightMeter={selectedRightMeter}
              store={store}
              viewModel={viewModel}
            />
          </Section>

          <Section
            className={styles.plateSection}
            title="Channel"
            detail="as the desk reports it"
            data-plate-section="channel"
            testId="audio-plate-channel"
          >
            <AudioPlateChannelFacts selectedChannel={selectedChannel} selectedMixTarget={selectedMixTarget} />
          </Section>
        </>
      ) : selectedMixTarget ? (
        <Section
          className={styles.plateSection}
          title={selectedMixTarget.name}
          detail="the mix the faders send into"
          data-plate-section="output"
          testId="audio-inspector-output-panel"
          actions={meterKeys}
        >
          <AudioInspectorOutputView
            clearDraftValueLater={clearDraftValueLater}
            commitMixTargetContinuous={commitMixTargetContinuous}
            monitorDraftKey={monitorDraftKey}
            monitorValue={monitorValue}
            onUpdateMixTarget={onUpdateMixTarget}
            outputLeftMeter={outputLeftMeter}
            outputRightMeter={outputRightMeter}
            peakHoldEnabled={peakHoldEnabled}
            peakHoldResetToken={peakHoldResetToken}
            selectedMixTarget={selectedMixTarget}
            setDraftValue={setDraftValue}
            store={store}
            viewModel={viewModel}
          />
        </Section>
      ) : (
        <AudioEmptyInspector
          description="Use 1-8, click a strip, or the command palette to select a source. Output selection stays active."
          title="No channel selected"
        />
      )}
    </aside>
  );
}
