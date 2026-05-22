import { useEffect } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioInspector.module.css";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { getAudioChannelGroup, selectedChannelSendLevel, type AudioWorkspaceViewModel } from "../audioViewModel";
import { useAudioInspectorEqState } from "../hooks/useAudioInspectorEqState";
import { AudioInspectorChannelHeader } from "./inspector/AudioInspectorChannelHeader";
import { AudioInspectorDynamicsTab } from "./inspector/AudioInspectorDynamicsTab";
import { AudioInspectorEqTab } from "./inspector/AudioInspectorEqTab";
import { AudioInspectorOutputView } from "./inspector/AudioInspectorOutputView";
import { AudioInspectorOverviewCards } from "./inspector/AudioInspectorOverviewCards";
import { AudioInspectorSendsTab } from "./inspector/AudioInspectorSendsTab";
import { AudioInspectorTabStrip } from "./inspector/AudioInspectorTabStrip";
import {
  dynamicsCurvePath,
  dynamicsPoint,
  dynamicsThresholdPercent,
  type AudioChannelUpdate,
  type AudioDynamicsUpdate,
  type AudioEqUpdate,
  type AudioMixTargetUpdate,
  type AudioSendModeUpdate,
  type InspectorTab,
} from "./inspector/audioInspectorHelpers";

export type { InspectorTab };

export function AudioInspector({
  armedActionKey,
  clearDraftValueLater,
  commitChannelContinuous,
  commitChannelEqContinuous,
  commitMixTargetContinuous,
  draftStore,
  getDraftValue,
  activeTab,
  onActiveTabChange,
  onSelectMixTarget,
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
  activeTab: InspectorTab;
  onActiveTabChange: (tab: InspectorTab) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
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
  const outputSelectionOnly = !selectedChannel && Boolean(selectedMixTarget);

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
  const selectedSendDraftKey = selectedChannel
    ? `channel:${selectedChannel.id}:send:${viewModel.selectedMixTargetId ?? "none"}`
    : "channel:none:send:none";
  const selectedSendLevel = useAudioControlDraftValue(
    draftStore,
    selectedSendDraftKey,
    selectedChannel
      ? getDraftValue(selectedSendDraftKey, selectedChannelSendLevel(selectedChannel, viewModel.selectedMixTargetId))
      : 0
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
  const dynamicsCurve = selectedChannel ? dynamicsCurvePath(selectedChannel.dynamics.compressor) : "";
  const dynamicsCurvePoint = selectedChannel ? dynamicsPoint(selectedChannel.dynamics.compressor) : { x: 0, y: 100 };
  const gateThresholdX = selectedChannel ? dynamicsThresholdPercent(selectedChannel.dynamics.gate.thresholdDb) : 0;
  const nextPhantomState = selectedChannel ? !selectedChannel.phantom : false;
  const phantomArmed = selectedChannel ? armedActionKey === `phantom:${selectedChannel.id}:${nextPhantomState}` : false;
  const phantomLabel = phantomArmed ? (nextPhantomState ? "Confirm 48V" : "Confirm Off") : "48V";

  useEffect(() => {
    if (outputSelectionOnly && activeTab !== "channel") {
      onActiveTabChange("channel");
    }
  }, [activeTab, onActiveTabChange, outputSelectionOnly]);

  return (
    <aside className={styles.inspector} data-source-tier={viewModel.selectedSourceTier}>
      <AudioInspectorTabStrip
        activeTab={activeTab}
        onActiveTabChange={onActiveTabChange}
        outputSelectionOnly={outputSelectionOnly}
      />

      <div className={styles.inspectorSticky}>
        {selectedChannel ? (
          <AudioInspectorChannelHeader
            clearDraftValueLater={clearDraftValueLater}
            commitChannelContinuous={commitChannelContinuous}
            gainDraftKey={gainDraftKey}
            onTogglePhantom={onTogglePhantom}
            onUpdateChannel={onUpdateChannel}
            peakHoldEnabled={peakHoldEnabled}
            peakHoldResetToken={peakHoldResetToken}
            phantomArmed={phantomArmed}
            phantomLabel={phantomLabel}
            selectedChannel={selectedChannel}
            selectedClip={selectedClip}
            selectedGain={selectedGain}
            selectedGroup={selectedGroup}
            selectedLeftMeter={selectedLeftMeter}
            selectedMixTarget={selectedMixTarget}
            selectedRightMeter={selectedRightMeter}
            selectedSendDraftKey={selectedSendDraftKey}
            selectedSendLevel={selectedSendLevel}
            setDraftValue={setDraftValue}
            store={store}
            viewModel={viewModel}
          />
        ) : selectedMixTarget ? (
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
        ) : (
          <div className={styles.emptyInspector}>
            <h3>No channel selected</h3>
            <p>Use 1-8, click a lane, or the command palette to select a source. Output selection stays active.</p>
          </div>
        )}
      </div>

      {activeTab === "channel" ? (
        <section
          aria-labelledby={outputSelectionOnly ? "audio-inspector-output-tab" : "audio-inspector-channel-tab"}
          className={styles.inspectorPanel}
          data-testid={outputSelectionOnly ? "audio-inspector-output-panel" : "audio-inspector-channel"}
          id={outputSelectionOnly ? "audio-inspector-output-panel" : "audio-inspector-channel-panel"}
          role="tabpanel"
        >
          <AudioInspectorOverviewCards
            {...eqState}
            dynamicsCurve={dynamicsCurve}
            dynamicsCurvePoint={dynamicsCurvePoint}
            gateThresholdX={gateThresholdX}
            monitorValue={monitorValue}
            onActiveTabChange={onActiveTabChange}
            selectedChannel={selectedChannel}
            selectedMixTarget={selectedMixTarget}
            selectedSendLevel={selectedSendLevel}
            viewModel={viewModel}
          />
        </section>
      ) : null}

      {activeTab === "eq" ? (
        <section
          aria-labelledby="audio-inspector-eq-tab"
          className={styles.inspectorPanel}
          data-testid="audio-inspector-eq"
          id="audio-inspector-eq-panel"
          role="tabpanel"
        >
          {selectedChannel ? (
            <AudioInspectorEqTab
              {...eqState}
              clearDraftValueLater={clearDraftValueLater}
              onUpdateChannelEq={onUpdateChannelEq}
              selectedChannel={selectedChannel}
              setDraftValue={setDraftValue}
              viewModel={viewModel}
            />
          ) : (
            <div className={styles.emptyInspector}>
              <h3>No channel selected</h3>
              <p>EQ controls appear here after a source strip is selected.</p>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "dynamics" ? (
        <section
          aria-labelledby="audio-inspector-dynamics-tab"
          className={styles.inspectorPanel}
          data-testid="audio-inspector-dynamics"
          id="audio-inspector-dynamics-panel"
          role="tabpanel"
        >
          <AudioInspectorDynamicsTab
            clearDraftValueLater={clearDraftValueLater}
            getDraftValue={getDraftValue}
            onUpdateChannelDynamics={onUpdateChannelDynamics}
            selectedChannel={selectedChannel}
            setDraftValue={setDraftValue}
            viewModel={viewModel}
          />
        </section>
      ) : null}

      {activeTab === "sends" ? (
        <section
          aria-labelledby="audio-inspector-sends-tab"
          className={styles.inspectorPanel}
          data-testid="audio-inspector-sends"
          id="audio-inspector-sends-panel"
          role="tabpanel"
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
        </section>
      ) : null}
    </aside>
  );
}
