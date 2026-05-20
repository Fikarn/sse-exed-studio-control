import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "./AudioInspector.module.css";
import { AUDIO_DRAFT_CLEAR_MS, AUDIO_THROTTLE_EQ_MS } from "../audioConstants";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { createThrottledCommit } from "../audioContinuousControls";
import { AUDIO_DB_NEG_INFINITY, AUDIO_FADER_UNITY, deriveSendStatusLabel, formatAudioDb } from "../audioFormatting";
import {
  audioChannelSupportsAutoSet,
  audioChannelSupportsGain,
  audioChannelSupportsInstrument,
  audioChannelSupportsPhantom,
  audioChannelSupportsPhase,
  getAudioChannelGroup,
  selectedChannelSendLevel,
  type AudioWorkspaceViewModel,
} from "../audioViewModel";
import { AudioPreampControl } from "./AudioPreampControl";
import { AudioStableMeterDbPair } from "./AudioLiveMeterReadout";
import { AudioSliderControl } from "./AudioSliderControl";
import { AudioStereoMeter } from "./AudioStereoMeter";
import { AudioInspectorChannelHeader } from "./inspector/AudioInspectorChannelHeader";
import { AudioInspectorDynamicsTab } from "./inspector/AudioInspectorDynamicsTab";
import { AudioInspectorEqTab, type EqDragRef } from "./inspector/AudioInspectorEqTab";
import { AudioInspectorOutputView } from "./inspector/AudioInspectorOutputView";
import { AudioInspectorOverviewCards } from "./inspector/AudioInspectorOverviewCards";
import { AudioInspectorSendsTab } from "./inspector/AudioInspectorSendsTab";
import {
  channelOrdinalLabel,
  channelRoutingSourceText,
  channelTypeLabel,
  dynamicsCurvePath,
  dynamicsPoint,
  dynamicsStatusText,
  dynamicsThresholdPercent,
  EQ_FREQUENCY_MARKERS,
  EQ_FREQUENCY_MAX,
  EQ_FREQUENCY_MIN,
  EQ_GAIN_MARKERS,
  EQ_GAIN_MAX,
  EQ_GAIN_MIN,
  EQ_Q_MAX,
  EQ_Q_MIN,
  eqBandId,
  eqBandType,
  eqFrequencyFromPointX,
  eqGainFromPointY,
  eqPointX,
  eqPointY,
  eqResponsePath,
  eqStatusText,
  formatEqBandType,
  formatEqFrequency,
  INSPECTOR_TABS,
  LOW_CUT_FREQUENCY_MAX,
  LOW_CUT_FREQUENCY_MIN,
  LOW_CUT_HANDLE_ID,
  LOW_CUT_SLOPES,
  lowCutFrequencyFromPointX,
  lowCutShadePath,
  outputRouteText,
  outputTypeLabel,
  type AudioChannelUpdate,
  type AudioDynamicsUpdate,
  type AudioEqBand,
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
  const [selectedEqBandId, setSelectedEqBandId] = useState<string | null>(LOW_CUT_HANDLE_ID);
  const [eqGraphDraft, setEqGraphDraft] = useState<{
    bandId: string;
    frequencyHz: number;
    gainDb: number;
  } | null>(null);
  const eqDragRef = useRef<EqDragRef | null>(null);
  const throttledEqCommit = useMemo(
    () => createThrottledCommit<AudioEqUpdate>(commitChannelEqContinuous, AUDIO_THROTTLE_EQ_MS),
    [commitChannelEqContinuous]
  );

  useEffect(() => () => throttledEqCommit.cancel(), [throttledEqCommit]);

  useEffect(() => {
    if (!window.__SSE_TEST_RENDER_COUNTS__) return;
    window.__SSE_TEST_RENDER_COUNTS__.audioInspector = (window.__SSE_TEST_RENDER_COUNTS__.audioInspector ?? 0) + 1;
  });

  const selectedChannel = viewModel.selectedChannel;
  const selectedMixTarget = viewModel.selectedMixTarget;
  const outputSelectionOnly = !selectedChannel && Boolean(selectedMixTarget);
  const selectedClip = selectedChannel?.clip ?? false;
  const activeEqHandleId =
    selectedEqBandId === LOW_CUT_HANDLE_ID
      ? LOW_CUT_HANDLE_ID
      : (selectedChannel?.eq.bands.find((band) => band.id === selectedEqBandId)?.id ??
        selectedChannel?.eq.bands[0]?.id ??
        LOW_CUT_HANDLE_ID);
  const activeEqBand = selectedChannel?.eq.bands.find((band) => band.id === activeEqHandleId) ?? null;
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
  const lowCutFrequencyKey = selectedChannel
    ? `channel:${selectedChannel.id}:eq:lowCut:frequency`
    : "channel:none:eq:lowCut:frequency";
  const lowCutFrequencyValue = selectedChannel
    ? getDraftValue(lowCutFrequencyKey, selectedChannel.eq.lowCut.frequencyHz)
    : 80;
  const activeEqBandFrequencyKey =
    selectedChannel && activeEqBand
      ? `channel:${selectedChannel.id}:eq:${activeEqBand.id}:frequency`
      : "channel:none:eq:none:frequency";
  const activeEqBandFrequencyValue = activeEqBand
    ? getDraftValue(activeEqBandFrequencyKey, activeEqBand.frequencyHz)
    : 0;
  const activeEqBandGainKey =
    selectedChannel && activeEqBand
      ? `channel:${selectedChannel.id}:eq:${activeEqBand.id}:gain`
      : "channel:none:eq:none:gain";
  const activeEqBandGainValue = activeEqBand ? getDraftValue(activeEqBandGainKey, activeEqBand.gainDb) : 0;
  const activeEqBandQKey =
    selectedChannel && activeEqBand
      ? `channel:${selectedChannel.id}:eq:${activeEqBand.id}:q`
      : "channel:none:eq:none:q";
  const activeEqBandQValue = activeEqBand ? getDraftValue(activeEqBandQKey, activeEqBand.q) : 0;
  const activeEqBandTypeOptions =
    activeEqBand?.id === "1"
      ? ["bell", "low-shelf", "high-pass", "low-pass"]
      : activeEqBand?.id === "3"
        ? ["bell", "high-shelf", "low-pass", "high-pass"]
        : ["bell"];
  // Why: TotalMix Band 2 is fixed-Bell; do not surface band-type toggles for
  // it. Future RME firmware changes that unlock the shape land here as a
  // single capability swap.
  const canChangeBandType = activeEqBand?.id !== "2";
  const eqBands = selectedChannel
    ? selectedChannel.eq.bands.map((band) =>
        eqGraphDraft?.bandId === band.id
          ? { ...band, frequencyHz: eqGraphDraft.frequencyHz, gainDb: eqGraphDraft.gainDb }
          : band
      )
    : [];
  const visualEq = selectedChannel
    ? {
        ...selectedChannel.eq,
        lowCut: { ...selectedChannel.eq.lowCut, frequencyHz: lowCutFrequencyValue },
        bands: eqBands,
      }
    : null;
  const eqGraphPath = visualEq ? eqResponsePath(visualEq) : "";
  const lowCutShade = visualEq?.lowCut.enabled ? lowCutShadePath(visualEq.lowCut) : "";
  const activeEqLabel =
    activeEqHandleId === LOW_CUT_HANDLE_ID ? "Low Cut" : activeEqBand ? `Band ${activeEqBand.label}` : "EQ";
  const activeEqValue =
    activeEqHandleId === LOW_CUT_HANDLE_ID
      ? `${formatEqFrequency(lowCutFrequencyValue)} · ${selectedChannel?.eq.lowCut.slopeDbPerOctave ?? 12} dB/oct`
      : activeEqBand
        ? `${formatEqFrequency(activeEqBand.frequencyHz)} · ${activeEqBand.gainDb.toFixed(1)} dB · Q ${activeEqBand.q.toFixed(1)}`
        : "No band selected";
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

  const commitEqPointFromPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    band: AudioEqBand,
    mode: "schedule" | "flush" = "schedule"
  ) => {
    if (!selectedChannel || !viewModel.capabilities.canEditProcessing) return;
    // Why: re-read the EQ graph rect every pointer event. Caching the rect at
    // pointerDown drifted when the inspector resized mid-drag (eg. window
    // resize, scaled-preview toggle, virtual-keyboard reflow on touch hosts);
    // the cached width/left lagged and the drag jumped sideways. The
    // `eqDragRef` still anchors the active band identity and the pointer id,
    // but rect numbers are now always live.
    const graph = event.currentTarget.closest("[data-eq-graph]");
    if (!(graph instanceof HTMLElement)) return;

    const rect = graph.getBoundingClientRect();
    const frequencyPercent = (event.clientX - rect.left) / Math.max(1, rect.width);
    const gainPercent = (event.clientY - rect.top) / Math.max(1, rect.height);
    const frequencyHz = eqFrequencyFromPointX(frequencyPercent);
    const gainDb = eqGainFromPointY(gainPercent);
    const frequencyKey = `channel:${selectedChannel.id}:eq:${band.id}:frequency`;
    const gainKey = `channel:${selectedChannel.id}:eq:${band.id}:gain`;
    setSelectedEqBandId(band.id);
    setEqGraphDraft({ bandId: band.id, frequencyHz, gainDb });
    setDraftValue(frequencyKey, frequencyHz);
    setDraftValue(gainKey, gainDb);
    if (mode === "flush") {
      throttledEqCommit.schedule({
        bandId: eqBandId(band.id),
        channelId: selectedChannel.id,
        frequencyHz,
        gainDb,
      });
      throttledEqCommit.flush();
      clearDraftValueLater(frequencyKey);
      clearDraftValueLater(gainKey);
      window.setTimeout(() => setEqGraphDraft(null), AUDIO_DRAFT_CLEAR_MS);
    }
  };

  const commitLowCutFromPointer = (
    event: ReactPointerEvent<HTMLButtonElement>,
    mode: "schedule" | "flush" = "schedule"
  ) => {
    if (!selectedChannel || !viewModel.capabilities.canEditProcessing) return;
    const graph = event.currentTarget.closest("[data-eq-graph]");
    if (!(graph instanceof HTMLElement)) return;

    const rect = graph.getBoundingClientRect();
    const frequencyPercent = (event.clientX - rect.left) / Math.max(1, rect.width);
    const frequencyHz = lowCutFrequencyFromPointX(frequencyPercent);
    const frequencyKey = `channel:${selectedChannel.id}:eq:lowCut:frequency`;
    setSelectedEqBandId(LOW_CUT_HANDLE_ID);
    setDraftValue(frequencyKey, frequencyHz);
    if (mode === "flush") {
      onUpdateChannelEq({
        channelId: selectedChannel.id,
        lowCutFrequencyHz: frequencyHz,
      });
      clearDraftValueLater(frequencyKey);
    }
  };

  return (
    <aside className={styles.inspector} data-source-tier={viewModel.selectedSourceTier}>
      {outputSelectionOnly ? (
        <div
          className={`${styles.inspectorTabs} ${styles.inspectorOutputTabs}`}
          aria-label="Audio output inspector"
          role="tablist"
        >
          <button
            aria-controls="audio-inspector-output-panel"
            aria-selected="true"
            data-active="true"
            id="audio-inspector-output-tab"
            role="tab"
            type="button"
          >
            Output
          </button>
        </div>
      ) : (
        <div className={styles.inspectorTabs} aria-label="Audio inspector tabs" role="tablist">
          {INSPECTOR_TABS.map((tab) => (
            <button
              aria-controls={`${tab.testId}-panel`}
              aria-selected={tab.id === activeTab}
              data-active={tab.id === activeTab}
              id={`${tab.testId}-tab`}
              key={tab.id}
              onClick={() => onActiveTabChange(tab.id)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

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
            activeEqHandleId={activeEqHandleId}
            dynamicsCurve={dynamicsCurve}
            dynamicsCurvePoint={dynamicsCurvePoint}
            eqBands={eqBands}
            eqGraphPath={eqGraphPath}
            gateThresholdX={gateThresholdX}
            lowCutShade={lowCutShade}
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
              activeEqBand={activeEqBand}
              activeEqBandFrequencyKey={activeEqBandFrequencyKey}
              activeEqBandFrequencyValue={activeEqBandFrequencyValue}
              activeEqBandGainKey={activeEqBandGainKey}
              activeEqBandGainValue={activeEqBandGainValue}
              activeEqBandQKey={activeEqBandQKey}
              activeEqBandQValue={activeEqBandQValue}
              activeEqBandTypeOptions={activeEqBandTypeOptions}
              activeEqHandleId={activeEqHandleId}
              activeEqLabel={activeEqLabel}
              activeEqValue={activeEqValue}
              canChangeBandType={canChangeBandType}
              clearDraftValueLater={clearDraftValueLater}
              commitEqPointFromPointer={commitEqPointFromPointer}
              commitLowCutFromPointer={commitLowCutFromPointer}
              eqBands={eqBands}
              eqDragRef={eqDragRef}
              eqGraphPath={eqGraphPath}
              lowCutFrequencyKey={lowCutFrequencyKey}
              lowCutFrequencyValue={lowCutFrequencyValue}
              lowCutShade={lowCutShade}
              onUpdateChannelEq={onUpdateChannelEq}
              selectedChannel={selectedChannel}
              setDraftValue={setDraftValue}
              setSelectedEqBandId={setSelectedEqBandId}
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
