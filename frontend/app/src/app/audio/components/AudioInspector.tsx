import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "../AudioWorkspace.module.css";
import { type AudioControlDraftStore, useAudioControlDraftValue } from "../audioControlDraftStore";
import { createThrottledCommit } from "../audioContinuousControls";
import { AUDIO_FADER_UNITY, formatAudioDb, formatAudioRole } from "../audioFormatting";
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

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioDynamicsUpdate = Parameters<ShellStore["updateAudioChannelDynamics"]>[0];
type AudioEqUpdate = Parameters<ShellStore["updateAudioChannelEq"]>[0];
type AudioSendModeUpdate = Parameters<ShellStore["updateAudioChannelSendMode"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];
type SelectedAudioChannel = NonNullable<AudioWorkspaceViewModel["selectedChannel"]>;
type AudioEqBand = SelectedAudioChannel["eq"]["bands"][number];
type AudioLowCut = SelectedAudioChannel["eq"]["lowCut"];
export type InspectorTab = "channel" | "eq" | "dynamics" | "sends";

const EQ_FREQUENCY_MIN = 20;
const EQ_FREQUENCY_MAX = 20000;
const EQ_GAIN_MIN = -20;
const EQ_GAIN_MAX = 20;
const EQ_Q_MIN = 0.4;
const EQ_Q_MAX = 9.9;
const LOW_CUT_FREQUENCY_MIN = 20;
const LOW_CUT_FREQUENCY_MAX = 500;
const LOW_CUT_SLOPES = [6, 12, 18, 24] as const;
const LOW_CUT_HANDLE_ID = "lowCut";
const EQ_FREQUENCY_MARKERS = [
  { frequencyHz: 20, label: "20 Hz", major: true },
  { frequencyHz: 50, label: "50", major: false },
  { frequencyHz: 100, label: "100", major: true },
  { frequencyHz: 200, label: "200", major: false },
  { frequencyHz: 500, label: "500", major: false },
  { frequencyHz: 1000, label: "1 k", major: true },
  { frequencyHz: 2000, label: "2 k", major: false },
  { frequencyHz: 5000, label: "5 k", major: false },
  { frequencyHz: 10000, label: "10 k", major: true },
  { frequencyHz: 20000, label: "20 kHz", major: true },
] as const;
const EQ_GAIN_MARKERS = [
  { gainDb: 20, label: "+20 dB" },
  { gainDb: 0, label: "0 dB" },
  { gainDb: -20, label: "-20 dB" },
] as const;

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatEqFrequency(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`;
  }
  return `${Math.round(value)} Hz`;
}

function formatEqBandType(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function eqBandId(value: string) {
  return value as AudioEqUpdate["bandId"];
}

function eqBandType(value: string) {
  return value as AudioEqUpdate["bandType"];
}

function eqPointX(frequencyHz: number) {
  const min = Math.log10(EQ_FREQUENCY_MIN);
  const max = Math.log10(EQ_FREQUENCY_MAX);
  const value = Math.log10(clamp(frequencyHz, EQ_FREQUENCY_MIN, EQ_FREQUENCY_MAX));
  return ((value - min) / (max - min)) * 100;
}

function eqFrequencyFromPointX(percent: number) {
  const min = Math.log10(EQ_FREQUENCY_MIN);
  const max = Math.log10(EQ_FREQUENCY_MAX);
  return Math.round(10 ** (min + clamp(percent, 0, 1) * (max - min)));
}

function eqPointY(gainDb: number) {
  return ((EQ_GAIN_MAX - clamp(gainDb, EQ_GAIN_MIN, EQ_GAIN_MAX)) / (EQ_GAIN_MAX - EQ_GAIN_MIN)) * 100;
}

function eqGainFromPointY(percent: number) {
  return Number((EQ_GAIN_MAX - clamp(percent, 0, 1) * (EQ_GAIN_MAX - EQ_GAIN_MIN)).toFixed(1));
}

function lowCutFrequencyFromPointX(percent: number) {
  const min = Math.log10(LOW_CUT_FREQUENCY_MIN);
  const max = Math.log10(LOW_CUT_FREQUENCY_MAX);
  return Math.round(10 ** (min + clamp(percent, 0, 1) * (max - min)));
}

function eqOctaves(frequency: number, center: number) {
  return Math.log2(
    clamp(frequency, EQ_FREQUENCY_MIN, EQ_FREQUENCY_MAX) / clamp(center, EQ_FREQUENCY_MIN, EQ_FREQUENCY_MAX)
  );
}

function eqBandContribution(band: AudioEqBand, frequencyHz: number) {
  if (!band.enabled) return 0;
  const distance = eqOctaves(frequencyHz, band.frequencyHz);
  if (band.bandType === "low-shelf") {
    const transition = 1 / (1 + Math.exp(distance * Math.max(1.4, band.q * 1.1)));
    return band.gainDb * transition;
  }
  if (band.bandType === "high-shelf") {
    const transition = 1 / (1 + Math.exp(-distance * Math.max(1.4, band.q * 1.1)));
    return band.gainDb * transition;
  }
  if (band.bandType === "high-pass") {
    return frequencyHz < band.frequencyHz ? Math.max(EQ_GAIN_MIN, -12 * Math.abs(distance)) : 0;
  }
  if (band.bandType === "low-pass") {
    return frequencyHz > band.frequencyHz ? Math.max(EQ_GAIN_MIN, -12 * Math.abs(distance)) : 0;
  }
  const width = 1 / Math.max(0.36, band.q * 0.42);
  return band.gainDb * Math.exp(-(distance * distance) / (2 * width * width));
}

function lowCutContribution(lowCut: AudioLowCut, frequencyHz: number) {
  if (!lowCut.enabled || frequencyHz >= lowCut.frequencyHz) return 0;
  return Math.max(EQ_GAIN_MIN, -lowCut.slopeDbPerOctave * Math.abs(eqOctaves(frequencyHz, lowCut.frequencyHz)));
}

function eqResponseAt(eq: SelectedAudioChannel["eq"], frequencyHz: number) {
  const bandGain = eq.enabled ? eq.bands.reduce((sum, band) => sum + eqBandContribution(band, frequencyHz), 0) : 0;
  return clamp(lowCutContribution(eq.lowCut, frequencyHz) + bandGain, EQ_GAIN_MIN, EQ_GAIN_MAX);
}

function eqResponsePath(eq: SelectedAudioChannel["eq"], points = 96) {
  return Array.from({ length: points }, (_, index) => {
    const percent = points <= 1 ? 0 : index / (points - 1);
    const frequencyHz = eqFrequencyFromPointX(percent);
    const command = index === 0 ? "M" : "L";
    return `${command} ${eqPointX(frequencyHz).toFixed(2)} ${eqPointY(eqResponseAt(eq, frequencyHz)).toFixed(2)}`;
  }).join(" ");
}

function lowCutShadePath(lowCut: AudioLowCut) {
  const x = eqPointX(lowCut.frequencyHz);
  return `M 0 100 L 0 0 L ${x.toFixed(2)} 0 C ${(x * 0.92).toFixed(2)} 28 ${(x * 0.86).toFixed(2)} 72 ${x.toFixed(2)} 100 Z`;
}

const TABS: Array<{ id: InspectorTab; label: string; testId: string }> = [
  { id: "channel", label: "Overview", testId: "audio-inspector-channel" },
  { id: "eq", label: "EQ", testId: "audio-inspector-eq" },
  { id: "dynamics", label: "Dynamics", testId: "audio-inspector-dynamics" },
  { id: "sends", label: "Sends", testId: "audio-inspector-sends" },
];

function channelTypeLabel(role: string) {
  if (role === "playback-pair") return "Playback";
  if (role === "front-preamp") return "Channel";
  if (role === "rear-line") return "Line";
  return formatAudioRole(role);
}

function channelRoutingSourceText(role: string) {
  if (role === "playback-pair") return "Playback bus";
  if (role === "front-preamp") return "Mic preamp";
  if (role === "rear-line") return "Line input";
  return "Audio source";
}

function channelOrdinalLabel(
  viewModel: AudioWorkspaceViewModel,
  channel: NonNullable<AudioWorkspaceViewModel["selectedChannel"]>
) {
  const peers = viewModel.channels.filter((entry) => entry.role === channel.role);
  const index = peers.findIndex((entry) => entry.id === channel.id);
  return String(Math.max(0, index) + 1).padStart(2, "0");
}

function outputTypeLabel(role: string) {
  if (role === "main-out") return "Main";
  if (role === "phones-a") return "Cue A";
  if (role === "phones-b") return "Cue B";
  return formatAudioRole(role);
}

function outputRouteText(role: string) {
  if (role === "main-out") return "Stereo monitor";
  if (role === "phones-a") return "Phones cue A";
  if (role === "phones-b") return "Phones cue B";
  return "Hardware output";
}

function dynamicsThresholdPercent(thresholdDb: number) {
  return clamp(((thresholdDb + 80) / 80) * 100, 0, 100);
}

function dynamicsCurvePath(processor: SelectedAudioChannel["dynamics"]["compressor"]) {
  if (!processor.enabled) {
    return "M 0 92 L 100 8";
  }
  const threshold = dynamicsThresholdPercent(processor.thresholdDb);
  const ratio = Math.max(1, processor.ratio);
  const endOutput = threshold + (100 - threshold) / ratio;
  return `M 0 100 L ${threshold.toFixed(1)} ${(100 - threshold).toFixed(1)} L 100 ${(100 - endOutput).toFixed(1)}`;
}

function dynamicsPoint(processor: SelectedAudioChannel["dynamics"]["compressor"]) {
  const x = dynamicsThresholdPercent(processor.thresholdDb);
  return { x, y: 100 - x };
}

function dynamicsStatusText(channel: SelectedAudioChannel) {
  const comp = channel.dynamics.compressor.enabled ? "Comp in" : "Comp bypassed";
  const gate = channel.dynamics.gate.enabled ? "Gate in" : "Gate bypassed";
  return `${comp} · ${gate}`;
}

function eqStatusText(channel: SelectedAudioChannel) {
  const lowCut = channel.eq.lowCut.enabled ? "LC in" : "LC out";
  return `${channel.eq.enabled ? "PEQ in" : "PEQ bypassed"} · ${lowCut} · ${channel.eq.bands.length} bands`;
}

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
  const eqDragRef = useRef<{
    bandId: string;
    height: number;
    left: number;
    pointerId: number;
    top: number;
    width: number;
  } | null>(null);
  const throttledEqCommit = useMemo(
    () => createThrottledCommit<AudioEqUpdate>(commitChannelEqContinuous, 500),
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
    const cachedRect = eqDragRef.current?.bandId === band.id ? eqDragRef.current : null;
    const graph = cachedRect ? null : event.currentTarget.closest("[data-eq-graph]");
    if (!cachedRect && !(graph instanceof HTMLElement)) return;

    const rect = cachedRect ?? graph!.getBoundingClientRect();
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
      window.setTimeout(() => setEqGraphDraft(null), 250);
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
          {TABS.map((tab) => (
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
          <>
            <div className={styles.inspectorEyebrowRow}>
              <span>
                Channel · {channelTypeLabel(selectedChannel.role)} {channelOrdinalLabel(viewModel, selectedChannel)}
              </span>
              <span className={styles.inspectorTagRow}>
                <span className={styles.inspectorTag}>{selectedChannel.stereo ? "Stereo" : "Mono"}</span>
                <span className={styles.inspectorTag} data-group={selectedGroup}>
                  {selectedGroup}
                </span>
              </span>
            </div>
            <h2 className={styles.inspectorTitle}>{selectedChannel.name}</h2>
            <div className={styles.inspectorSubtitle}>
              {channelRoutingSourceText(selectedChannel.role)} · {selectedChannel.stereo ? "Stereo" : "Mono"} →{" "}
              <strong>{selectedMixTarget?.name ?? "No output"}</strong>
            </div>

            <div className={styles.bigMeterCard} data-testid="audio-inspector-metering">
              <AudioStereoMeter
                clip={selectedChannel.clip}
                left={selectedChannel.meterLeft}
                meterId={selectedChannel.id}
                meterKind="channel"
                mirrorRight={!selectedChannel.stereo}
                peakLeft={selectedChannel.peakHoldLeft}
                peakRight={selectedChannel.stereo ? selectedChannel.peakHoldRight : selectedChannel.peakHoldLeft}
                right={selectedChannel.stereo ? selectedChannel.meterRight : selectedChannel.meterLeft}
                showReadout={false}
                showScale
              />
              <div className={styles.bigMeterInfo}>
                {viewModel.meterSimulationActive ? (
                  <span className={styles.meterSimulationBadge}>TEST STAGE</span>
                ) : null}
                <div className={styles.bigMeterRow}>
                  <span>
                    <small>Level L / R</small>
                    <strong>
                      <AudioStableMeterDbPair
                        fallbackLeft={selectedLeftMeter}
                        fallbackRight={selectedRightMeter}
                        kind="channel"
                        mirrorRight={!selectedChannel.stereo}
                        meterId={selectedChannel.id}
                        mode="level"
                        peakHoldEnabled={peakHoldEnabled}
                        peakHoldResetToken={peakHoldResetToken}
                        store={store}
                        testId="audio-inspector-level-readout"
                      />
                      <em>dB</em>
                    </strong>
                  </span>
                  <span>
                    <small>Peak hold</small>
                    <strong data-tone={selectedClip ? "clip" : "warn"}>
                      <AudioStableMeterDbPair
                        fallbackLeft={selectedLeftMeter}
                        fallbackRight={selectedRightMeter}
                        kind="channel"
                        mirrorRight={!selectedChannel.stereo}
                        meterId={selectedChannel.id}
                        mode="peakHold"
                        peakHoldEnabled={peakHoldEnabled}
                        peakHoldResetToken={peakHoldResetToken}
                        store={store}
                        testId="audio-inspector-peak-hold-readout"
                      />
                      <em>dB</em>
                    </strong>
                  </span>
                </div>
                <div className={styles.bigMeterReferenceRow}>
                  <span>
                    <small>Nominal ref</small>
                    <strong>
                      -18<em>dBFS</em>
                    </strong>
                  </span>
                  <span>
                    <small>Peak warn</small>
                    <strong>-3 dBFS</strong>
                  </span>
                </div>
              </div>
            </div>

            <section
              className={`${styles.inspectorMiniCard} ${styles.sourceCard} ${styles.inspectorStickyHardwareCard}`}
              data-testid="audio-inspector-hardware-mini"
            >
              <span className={styles.eyebrow}>
                {audioChannelSupportsGain(selectedChannel) ? "Hardware" : "Software"}
              </span>
              {audioChannelSupportsGain(selectedChannel) ? (
                <div className={styles.inspectorHardwareGrid}>
                  <AudioPreampControl
                    channelId={selectedChannel.id}
                    disabled={!viewModel.actionsAllowed}
                    gain={selectedGain}
                    label={`${selectedChannel.name} preamp gain`}
                    onCommit={(nextGain) => {
                      setDraftValue(gainDraftKey, nextGain);
                      commitChannelContinuous({ channelId: selectedChannel.id, gain: nextGain });
                      clearDraftValueLater(gainDraftKey);
                    }}
                    onPreview={(nextGain) => setDraftValue(gainDraftKey, nextGain)}
                    variant="narrow"
                  />
                  <div className={styles.unsupportedToggleRow}>
                    <button
                      aria-label={`${selectedChannel.phantom ? "Disable" : "Enable"} 48V on ${selectedChannel.name}`}
                      aria-pressed={selectedChannel.phantom}
                      data-armed={phantomArmed}
                      data-active={selectedChannel.phantom}
                      disabled={!audioChannelSupportsPhantom(selectedChannel) || !viewModel.actionsAllowed}
                      onClick={() =>
                        onTogglePhantom({
                          channelId: selectedChannel.id,
                          channelName: selectedChannel.name,
                          phantom: !selectedChannel.phantom,
                        })
                      }
                      type="button"
                    >
                      {phantomLabel}
                    </button>
                    <button
                      aria-pressed={selectedChannel.instrument}
                      data-active={selectedChannel.instrument}
                      disabled={!audioChannelSupportsInstrument(selectedChannel) || !viewModel.actionsAllowed}
                      onClick={() =>
                        onUpdateChannel({ channelId: selectedChannel.id, instrument: !selectedChannel.instrument })
                      }
                      type="button"
                    >
                      Hi-Z
                    </button>
                    <button
                      aria-pressed={selectedChannel.phase}
                      data-active={selectedChannel.phase}
                      disabled={!audioChannelSupportsPhase(selectedChannel) || !viewModel.actionsAllowed}
                      onClick={() => onUpdateChannel({ channelId: selectedChannel.id, phase: !selectedChannel.phase })}
                      type="button"
                    >
                      Polarity
                    </button>
                    <button
                      aria-pressed={selectedChannel.autoSet}
                      data-active={selectedChannel.autoSet}
                      disabled={!audioChannelSupportsAutoSet(selectedChannel) || !viewModel.actionsAllowed}
                      onClick={() =>
                        onUpdateChannel({ channelId: selectedChannel.id, autoSet: !selectedChannel.autoSet })
                      }
                      type="button"
                    >
                      AutoSet
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.softwarePanelStack}>
                  <div className={styles.unavailableTelemetry} data-testid="audio-playback-telemetry-unavailable">
                    <strong>Playback telemetry not reported</strong>
                    <span>Driver buffer and latency are not exposed by the current engine snapshot.</span>
                  </div>
                  <div className={styles.detailGrid}>
                    <span>
                      <small>Stereo link</small>
                      <strong>{selectedChannel.stereo ? "Linked" : "Mono"}</strong>
                    </span>
                    <span>
                      <small>Auto fade</small>
                      <strong>Off</strong>
                    </span>
                  </div>
                </div>
              )}
            </section>

            <div className={styles.inspectorFaderCard}>
              <div className={styles.inspectorFaderHead}>
                <span>
                  Send to <strong>{selectedMixTarget?.name ?? "output"}</strong>
                </span>
                <strong>{formatAudioDb(selectedSendLevel)}</strong>
              </div>
              <div className={styles.inspectorFaderTicks} aria-hidden="true">
                <span>-inf</span>
                <span>-40</span>
                <span>-20</span>
                <span>-10</span>
                <span>0</span>
                <span>+6</span>
              </div>
              <AudioSliderControl
                className={styles.inspectorSendSlider}
                disabled={!viewModel.actionsAllowed}
                label={`${selectedChannel.name} send to selected output`}
                onCommit={(value) => {
                  setDraftValue(selectedSendDraftKey, value);
                  commitChannelContinuous({
                    channelId: selectedChannel.id,
                    fader: value,
                    mixTargetId: viewModel.selectedMixTargetId ?? undefined,
                  });
                  clearDraftValueLater(selectedSendDraftKey);
                }}
                onPreview={(value) => setDraftValue(selectedSendDraftKey, value)}
                orientation="horizontal"
                snapUnity
                value={selectedSendLevel}
                valueText={formatAudioDb(selectedSendLevel)}
              />
            </div>

            <div className={styles.inspectorActionRow}>
              <button
                aria-label={`Mute ${selectedChannel.name}`}
                aria-pressed={selectedChannel.mute}
                data-control="mute"
                data-active={selectedChannel.mute}
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateChannel({ channelId: selectedChannel.id, mute: !selectedChannel.mute })}
                type="button"
              >
                Mute
              </button>
              <button
                aria-label={`Solo ${selectedChannel.name}`}
                aria-pressed={selectedChannel.solo}
                data-control="solo"
                data-active={selectedChannel.solo}
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateChannel({ channelId: selectedChannel.id, solo: !selectedChannel.solo })}
                type="button"
              >
                Solo
              </button>
              <button
                aria-label={`Set ${selectedChannel.name} send to unity`}
                data-control="unity"
                disabled={!viewModel.actionsAllowed}
                onClick={() =>
                  onUpdateChannel({
                    channelId: selectedChannel.id,
                    fader: AUDIO_FADER_UNITY,
                    mixTargetId: viewModel.selectedMixTargetId ?? undefined,
                  })
                }
                type="button"
              >
                Unity
              </button>
            </div>
          </>
        ) : selectedMixTarget ? (
          <div data-testid="audio-inspector-output">
            <div className={styles.inspectorEyebrowRow}>
              <span>
                Output · {outputTypeLabel(selectedMixTarget.role)}{" "}
                {String(viewModel.mixTargets.indexOf(selectedMixTarget) + 1).padStart(2, "0")}
              </span>
              <span className={styles.inspectorTagRow}>
                <span className={styles.inspectorTag}>Stereo</span>
                <span className={styles.inspectorTag} data-group="output">
                  Active mix
                </span>
              </span>
            </div>
            <h2 className={styles.inspectorTitle}>{selectedMixTarget.name}</h2>
            <div className={styles.inspectorSubtitle}>
              {outputRouteText(selectedMixTarget.role)} · Hardware output → <strong>Active mix</strong>
            </div>

            <div className={styles.bigMeterCard} data-testid="audio-inspector-output-metering">
              <AudioStereoMeter
                left={selectedMixTarget.meterLeft}
                meterId={selectedMixTarget.id}
                meterKind="mixTarget"
                mirrorRight={selectedMixTarget.mono}
                peakLeft={selectedMixTarget.peakHoldLeft}
                peakRight={selectedMixTarget.peakHoldRight}
                right={selectedMixTarget.mono ? selectedMixTarget.meterLevel : selectedMixTarget.meterRight}
                showReadout={false}
                showScale
              />
              <div className={styles.bigMeterInfo}>
                {viewModel.meterSimulationActive ? (
                  <span className={styles.meterSimulationBadge}>TEST STAGE</span>
                ) : null}
                <div className={styles.bigMeterRow}>
                  <span>
                    <small>Level L / R</small>
                    <strong>
                      <AudioStableMeterDbPair
                        fallbackLeft={outputLeftMeter}
                        fallbackRight={outputRightMeter}
                        kind="mixTarget"
                        mirrorRight={selectedMixTarget.mono}
                        meterId={selectedMixTarget.id}
                        mode="level"
                        peakHoldEnabled={peakHoldEnabled}
                        peakHoldResetToken={peakHoldResetToken}
                        store={store}
                        testId="audio-inspector-output-level-readout"
                      />
                      <em>dB</em>
                    </strong>
                  </span>
                  <span>
                    <small>Peak hold</small>
                    <strong>
                      <AudioStableMeterDbPair
                        fallbackLeft={outputLeftMeter}
                        fallbackRight={outputRightMeter}
                        kind="mixTarget"
                        mirrorRight={selectedMixTarget.mono}
                        meterId={selectedMixTarget.id}
                        mode="peakHold"
                        peakHoldEnabled={peakHoldEnabled}
                        peakHoldResetToken={peakHoldResetToken}
                        store={store}
                        testId="audio-inspector-output-peak-hold-readout"
                      />
                      <em>dB</em>
                    </strong>
                  </span>
                </div>
                <div className={styles.bigMeterReferenceRow}>
                  <span>
                    <small>Nominal ref</small>
                    <strong>
                      -18<em>dBFS</em>
                    </strong>
                  </span>
                  <span>
                    <small>Peak warn</small>
                    <strong>-3 dBFS</strong>
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.inspectorFaderCard}>
              <div className={styles.inspectorFaderHead}>
                <span>
                  Monitor level <strong>{selectedMixTarget.name}</strong>
                </span>
                <strong>{formatAudioDb(monitorValue)}</strong>
              </div>
              <div className={styles.inspectorFaderTicks} aria-hidden="true">
                <span>-inf</span>
                <span>-40</span>
                <span>-20</span>
                <span>-10</span>
                <span>0</span>
                <span>+6</span>
              </div>
              <AudioSliderControl
                className={styles.inspectorSendSlider}
                disabled={!viewModel.actionsAllowed}
                label={`${selectedMixTarget.name} monitor level`}
                onCommit={(value) => {
                  setDraftValue(monitorDraftKey, value);
                  commitMixTargetContinuous({ mixTargetId: selectedMixTarget.id, volume: value });
                  clearDraftValueLater(monitorDraftKey);
                }}
                onPreview={(value) => setDraftValue(monitorDraftKey, value)}
                orientation="horizontal"
                snapUnity
                value={monitorValue}
                valueText={formatAudioDb(monitorValue)}
              />
            </div>

            <div className={styles.inspectorActionRow}>
              <button
                aria-label={`Mute ${selectedMixTarget.name}`}
                aria-pressed={selectedMixTarget.mute}
                data-control="mute"
                data-active={selectedMixTarget.mute}
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, mute: !selectedMixTarget.mute })}
                type="button"
              >
                Mute
              </button>
              <button
                aria-label={`Set ${selectedMixTarget.name} monitor level to unity`}
                data-control="unity"
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, volume: AUDIO_FADER_UNITY })}
                type="button"
              >
                Unity
              </button>
            </div>
          </div>
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
          {selectedChannel ? (
            <>
              <div className={`${styles.inspectorMiniGrid} ${styles.channelOverviewGrid}`}>
                <button
                  aria-label="Open sends tab"
                  className={`${styles.inspectorMiniCard} ${styles.routingMiniCard} ${styles.overviewPrimaryCard} ${styles.overviewRouteCard}`}
                  data-testid="audio-inspector-sends-mini"
                  onClick={() => onActiveTabChange("sends")}
                  type="button"
                >
                  <span className={styles.graphCardHead}>
                    <span className={styles.eyebrow}>Route · Sends from this source</span>
                    <span>{viewModel.mixTargets.length} destinations</span>
                  </span>
                  <span className={styles.routingGraphMini} aria-hidden="true">
                    <span className={styles.routingSourceNode}>
                      <strong>{selectedChannel.name}</strong>
                      <small>{formatAudioDb(selectedSendLevel)}</small>
                    </span>
                    <svg
                      className={styles.routingCurve}
                      viewBox="0 0 64 72"
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <path d="M1 36 C21 36 28 11 63 11" />
                      <path d="M1 36 C24 36 30 36 63 36" />
                      <path d="M1 36 C21 36 28 61 63 61" />
                    </svg>
                    <span className={styles.routingTargetStack}>
                      {viewModel.mixTargets.map((mixTarget) => {
                        const value = selectedChannelSendLevel(selectedChannel, mixTarget.id);
                        const sendMode = selectedChannel.sendModes[mixTarget.id];
                        const muted = selectedChannel.mute || sendMode?.mute === true;
                        const noSend = value <= 0.01;
                        return (
                          <span
                            className={styles.routingTargetNode}
                            data-active={mixTarget.id === viewModel.selectedMixTargetId}
                            data-send-state={muted ? "muted" : noSend ? "none" : "sending"}
                            key={mixTarget.id}
                          >
                            <strong>{mixTarget.name}</strong>
                            <small>{muted ? "muted" : formatAudioDb(value)}</small>
                          </span>
                        );
                      })}
                    </span>
                  </span>
                </button>

                <button
                  aria-label="Open EQ tab"
                  className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard} ${styles.overviewEqCard}`}
                  data-testid="audio-inspector-eq-mini"
                  onClick={() => onActiveTabChange("eq")}
                  type="button"
                >
                  <span className={styles.graphCardHead}>
                    <span className={styles.eyebrow}>EQ · {eqStatusText(selectedChannel)}</span>
                    <span className={styles.eqBandRow}>
                      <i
                        data-active={selectedChannel.eq.lowCut.enabled}
                        data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}
                      >
                        LC
                      </i>
                      {eqBands.map((band) => (
                        <i
                          data-active={selectedChannel.eq.enabled}
                          data-selected={band.id === activeEqHandleId}
                          key={band.id}
                        >
                          {band.label}
                        </i>
                      ))}
                    </span>
                  </span>
                  <span className={styles.eqGraphMini} aria-hidden="true">
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                      {lowCutShade ? <path className={styles.eqLowCutShade} d={lowCutShade} /> : null}
                      <path d={eqGraphPath} />
                    </svg>
                  </span>
                </button>

                <button
                  aria-label="Open processing tab"
                  className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard} ${styles.overviewDynamicsCard}`}
                  data-testid="audio-inspector-dynamics-mini"
                  onClick={() => onActiveTabChange("dynamics")}
                  type="button"
                >
                  <span className={styles.graphCardHead}>
                    <span className={styles.eyebrow}>Dynamics · {dynamicsStatusText(selectedChannel)}</span>
                    <span className={styles.dynamicsPills}>
                      <i data-active={selectedChannel.dynamics.compressor.enabled}>Comp</i>
                      <i data-active={selectedChannel.dynamics.gate.enabled}>Gate</i>
                    </span>
                  </span>
                  <span
                    className={styles.dynamicsGraphMini}
                    data-active={selectedChannel.dynamics.compressor.enabled}
                    aria-hidden="true"
                  >
                    <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                      <path d={dynamicsCurve} />
                      <circle cx={dynamicsCurvePoint.x} cy={dynamicsCurvePoint.y} r="3" />
                    </svg>
                    <i
                      data-active={selectedChannel.dynamics.gate.enabled}
                      style={{ "--dynamics-gate-x": `${gateThresholdX}%` } as CSSProperties}
                    />
                  </span>
                </button>
              </div>
            </>
          ) : selectedMixTarget ? (
            <div className={`${styles.inspectorMiniGrid} ${styles.outputInspectorGrid}`}>
              <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
                <span className={styles.eyebrow}>Output</span>
                <strong>
                  {outputRouteText(selectedMixTarget.role)} · {selectedMixTarget.name}
                </strong>
                <span>Active monitor mix · TotalMix output state from the engine snapshot.</span>
                <div className={styles.detailGrid}>
                  <span data-fact-size="long">
                    <small>Clock</small>
                    <strong title={viewModel.footerTelemetry.clock}>{viewModel.footerTelemetry.clock}</strong>
                  </span>
                  <span data-fact-size="long">
                    <small>Metering</small>
                    <strong title={viewModel.footerTelemetry.metering}>{viewModel.footerTelemetry.metering}</strong>
                  </span>
                </div>
              </section>

              <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
                <span className={styles.eyebrow}>Output state</span>
                <strong>{selectedMixTarget.mute ? "Muted" : "Passing signal"}</strong>
                <span>Monitor level and safety toggles are live controls for this output.</span>
                <div className={styles.detailGrid}>
                  <span>
                    <small>Level</small>
                    <strong>{formatAudioDb(monitorValue)}</strong>
                  </span>
                  <span>
                    <small>Dim</small>
                    <strong>{selectedMixTarget.dim ? "On" : "Off"}</strong>
                  </span>
                  <span>
                    <small>Mono</small>
                    <strong>{selectedMixTarget.mono ? "On" : "Off"}</strong>
                  </span>
                  <span>
                    <small>Talkback</small>
                    <strong>{selectedMixTarget.talkback ? "On" : "Off"}</strong>
                  </span>
                </div>
              </section>

              <section className={`${styles.inspectorMiniCard} ${styles.sourceCard} ${styles.subduedInspectorCard}`}>
                <span className={styles.eyebrow}>Output processing</span>
                <strong>Monitor controls active</strong>
                <span>
                  EQ, dynamics, send solo, PFL, and level test stay hidden until the engine exposes real output
                  commands.
                </span>
              </section>

              <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
                <span className={styles.eyebrow}>Trust</span>
                <strong>{viewModel.status.label}</strong>
                <span title={viewModel.status.warningBody ?? viewModel.footerTelemetry.metering}>
                  {viewModel.status.warningBody ?? viewModel.footerTelemetry.metering}
                </span>
                <div className={styles.detailGrid}>
                  <span>
                    <small>Solo</small>
                    <strong>{viewModel.healthStats.soloedChannels}</strong>
                  </span>
                  <span>
                    <small>Clips</small>
                    <strong>{viewModel.healthStats.clippedChannels}</strong>
                  </span>
                </div>
              </section>
            </div>
          ) : (
            <div className={styles.emptyInspector}>
              <h3>No channel selected</h3>
              <p>Use 1-8, click a lane, or the command palette to select a source. Output selection stays active.</p>
            </div>
          )}
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
            <div className={`${styles.placeholderPanel} ${styles.inspectorFullGraphPanel}`}>
              <div className={styles.graphCardHead}>
                <span className={styles.eyebrow}>TotalMix FX EQ · Low Cut + 3-band PEQ</span>
                <span className={styles.eqBandRow}>
                  <button
                    aria-pressed={activeEqHandleId === LOW_CUT_HANDLE_ID}
                    data-active={selectedChannel.eq.lowCut.enabled}
                    data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}
                    onClick={() => setSelectedEqBandId(LOW_CUT_HANDLE_ID)}
                    type="button"
                  >
                    LC
                  </button>
                  {eqBands.map((band) => (
                    <button
                      aria-pressed={band.id === activeEqHandleId}
                      data-active={selectedChannel.eq.enabled}
                      data-selected={band.id === activeEqHandleId}
                      key={band.id}
                      onClick={() => setSelectedEqBandId(band.id)}
                      type="button"
                    >
                      {band.label}
                    </button>
                  ))}
                </span>
              </div>
              <div className={styles.eqGraphFull} data-eq-graph="true" data-testid="audio-eq-graph">
                <div className={styles.eqGraphGuideLayer} aria-hidden="true">
                  <div className={styles.eqGraphDbMarkers} data-testid="audio-eq-db-scale">
                    {EQ_GAIN_MARKERS.map((marker) => (
                      <span
                        className={styles.eqGraphDbLabel}
                        key={marker.label}
                        style={{ "--eq-marker-y": `${eqPointY(marker.gainDb)}%` } as CSSProperties}
                      >
                        {marker.label}
                      </span>
                    ))}
                  </div>
                  <div className={styles.eqGraphFrequencyMarkers} data-testid="audio-eq-frequency-markers">
                    {EQ_FREQUENCY_MARKERS.map((marker) => (
                      <span
                        className={styles.eqGraphFrequencyMarker}
                        data-major={marker.major}
                        key={marker.frequencyHz}
                        style={{ "--eq-marker-x": `${eqPointX(marker.frequencyHz)}%` } as CSSProperties}
                      >
                        <i />
                        <small>{marker.label}</small>
                      </span>
                    ))}
                  </div>
                </div>
                <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {lowCutShade ? (
                    <path className={styles.eqLowCutShade} d={lowCutShade} data-testid="audio-eq-low-cut-shade" />
                  ) : null}
                  <path d={eqGraphPath} />
                </svg>
                <div className={styles.eqValueBadge} data-testid="audio-eq-value-badge">
                  <strong>{activeEqLabel}</strong>
                  <span>{activeEqValue}</span>
                </div>
                <div className={styles.eqPointLayer} aria-label="EQ graph band points">
                  <button
                    aria-label={`${selectedChannel.name} Low Cut EQ point`}
                    className={`${styles.eqPoint} ${styles.eqLowCutPoint}`}
                    data-active={selectedChannel.eq.lowCut.enabled}
                    data-selected={activeEqHandleId === LOW_CUT_HANDLE_ID}
                    data-testid="audio-eq-point-low-cut"
                    disabled={!viewModel.capabilities.canEditProcessing}
                    onClick={() => setSelectedEqBandId(LOW_CUT_HANDLE_ID)}
                    onPointerCancel={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      event.currentTarget.focus();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      commitLowCutFromPointer(event);
                    }}
                    onPointerMove={(event) => {
                      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      event.preventDefault();
                      event.stopPropagation();
                      commitLowCutFromPointer(event);
                    }}
                    onPointerUp={(event) => {
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                        event.preventDefault();
                        event.stopPropagation();
                        commitLowCutFromPointer(event, "flush");
                        event.currentTarget.releasePointerCapture(event.pointerId);
                      }
                    }}
                    style={
                      {
                        "--eq-point-x": `${eqPointX(lowCutFrequencyValue)}%`,
                        "--eq-point-y": `${eqPointY(0)}%`,
                      } as CSSProperties
                    }
                    type="button"
                  >
                    <span>LC</span>
                  </button>
                  {eqBands.map((band) => (
                    <button
                      aria-label={`${selectedChannel.name} Band ${band.label} EQ point`}
                      className={styles.eqPoint}
                      data-selected={band.id === activeEqHandleId}
                      data-testid={`audio-eq-point-${band.id}`}
                      disabled={!viewModel.capabilities.canEditProcessing}
                      key={band.id}
                      onClick={() => setSelectedEqBandId(band.id)}
                      onPointerCancel={(event) => {
                        eqDragRef.current = null;
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const graph = event.currentTarget.closest("[data-eq-graph]");
                        if (graph instanceof HTMLElement) {
                          const rect = graph.getBoundingClientRect();
                          eqDragRef.current = {
                            bandId: band.id,
                            height: Math.max(1, rect.height),
                            left: rect.left,
                            pointerId: event.pointerId,
                            top: rect.top,
                            width: Math.max(1, rect.width),
                          };
                        }
                        event.currentTarget.focus();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        commitEqPointFromPointer(event, band);
                      }}
                      onPointerMove={(event) => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        commitEqPointFromPointer(event, band);
                      }}
                      onPointerUp={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.preventDefault();
                          event.stopPropagation();
                          commitEqPointFromPointer(event, band, "flush");
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                        eqDragRef.current = null;
                      }}
                      style={
                        {
                          "--eq-point-x": `${eqPointX(band.frequencyHz)}%`,
                          "--eq-point-y": `${eqPointY(band.gainDb)}%`,
                        } as CSSProperties
                      }
                      type="button"
                    >
                      <span>{band.label}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.graphRangeRow} data-testid="audio-eq-range">
                <span>20 Hz</span>
                <strong>
                  {activeEqLabel} · {selectedChannel.eq.hardwareStatus}
                </strong>
                <span>20 kHz · ±20 dB</span>
              </div>
              <div className={`${styles.sendCardFull} ${styles.eqControlTray}`} data-testid="audio-eq-control-tray">
                {activeEqHandleId === LOW_CUT_HANDLE_ID ? (
                  <>
                    <div className={styles.sendCardHead}>
                      <strong>Low Cut</strong>
                      <span className={styles.sendCardTag}>
                        {selectedChannel.eq.lowCut.enabled ? "In" : "Out"} ·{" "}
                        {selectedChannel.eq.lowCut.slopeDbPerOctave} dB/oct
                      </span>
                    </div>
                    <div className={styles.eqModeRow}>
                      <button
                        aria-pressed={selectedChannel.eq.lowCut.enabled}
                        data-active={selectedChannel.eq.lowCut.enabled}
                        disabled={!viewModel.capabilities.canEditProcessing}
                        onClick={() =>
                          onUpdateChannelEq({
                            channelId: selectedChannel.id,
                            lowCutEnabled: !selectedChannel.eq.lowCut.enabled,
                          })
                        }
                        type="button"
                      >
                        {selectedChannel.eq.lowCut.enabled ? "Bypass Low Cut" : "Enable Low Cut"}
                      </button>
                      {LOW_CUT_SLOPES.map((slope) => (
                        <button
                          aria-pressed={selectedChannel.eq.lowCut.slopeDbPerOctave === slope}
                          data-active={selectedChannel.eq.lowCut.slopeDbPerOctave === slope}
                          disabled={!viewModel.capabilities.canEditProcessing}
                          key={slope}
                          onClick={() =>
                            onUpdateChannelEq({
                              channelId: selectedChannel.id,
                              lowCutSlopeDbPerOctave: slope,
                            })
                          }
                          type="button"
                        >
                          {slope}
                        </button>
                      ))}
                    </div>
                    <div className={styles.processingControlGrid}>
                      <label className={styles.processingControl}>
                        <span>Cutoff</span>
                        <AudioSliderControl
                          disabled={!viewModel.capabilities.canEditProcessing}
                          label={`${selectedChannel.name} Low Cut frequency`}
                          max={LOW_CUT_FREQUENCY_MAX}
                          min={LOW_CUT_FREQUENCY_MIN}
                          onCommit={(value) => {
                            setSelectedEqBandId(LOW_CUT_HANDLE_ID);
                            setDraftValue(lowCutFrequencyKey, value);
                            onUpdateChannelEq({
                              channelId: selectedChannel.id,
                              lowCutFrequencyHz: value,
                            });
                            clearDraftValueLater(lowCutFrequencyKey);
                          }}
                          onPreview={(value) => setDraftValue(lowCutFrequencyKey, value)}
                          orientation="horizontal"
                          step={1}
                          value={lowCutFrequencyValue}
                          valueText={formatEqFrequency(lowCutFrequencyValue)}
                        />
                        <strong>{formatEqFrequency(lowCutFrequencyValue)}</strong>
                      </label>
                    </div>
                  </>
                ) : activeEqBand ? (
                  <>
                    <div className={styles.sendCardHead}>
                      <strong>Band {activeEqBand.label}</strong>
                      <span className={styles.sendCardTag}>
                        {formatEqBandType(activeEqBand.bandType)} ·{" "}
                        {selectedChannel.eq.enabled ? "PEQ in" : "PEQ bypassed"}
                      </span>
                    </div>
                    <div className={styles.eqModeRow}>
                      <button
                        aria-pressed={selectedChannel.eq.enabled}
                        data-active={selectedChannel.eq.enabled}
                        disabled={!viewModel.capabilities.canEditProcessing}
                        onClick={() =>
                          onUpdateChannelEq({ channelId: selectedChannel.id, enabled: !selectedChannel.eq.enabled })
                        }
                        type="button"
                      >
                        {selectedChannel.eq.enabled ? "Bypass PEQ" : "Enable PEQ"}
                      </button>
                      {activeEqBandTypeOptions.map((option) => (
                        <button
                          aria-pressed={activeEqBand.bandType === option}
                          data-active={activeEqBand.bandType === option}
                          disabled={!viewModel.capabilities.canEditProcessing || activeEqBand.id === "2"}
                          key={option}
                          onClick={() =>
                            onUpdateChannelEq({
                              bandId: eqBandId(activeEqBand.id),
                              bandType: eqBandType(option),
                              channelId: selectedChannel.id,
                            })
                          }
                          type="button"
                        >
                          {formatEqBandType(option)}
                        </button>
                      ))}
                    </div>
                    <div className={styles.processingControlGrid}>
                      <label className={styles.processingControl}>
                        <span>Freq</span>
                        <AudioSliderControl
                          disabled={!viewModel.capabilities.canEditProcessing}
                          label={`${selectedChannel.name} Band ${activeEqBand.label} EQ frequency`}
                          max={EQ_FREQUENCY_MAX}
                          min={EQ_FREQUENCY_MIN}
                          onCommit={(value) => {
                            setSelectedEqBandId(activeEqBand.id);
                            setDraftValue(activeEqBandFrequencyKey, value);
                            onUpdateChannelEq({
                              bandId: eqBandId(activeEqBand.id),
                              channelId: selectedChannel.id,
                              frequencyHz: value,
                            });
                            clearDraftValueLater(activeEqBandFrequencyKey);
                          }}
                          onPreview={(value) => setDraftValue(activeEqBandFrequencyKey, value)}
                          orientation="horizontal"
                          step={10}
                          value={activeEqBandFrequencyValue}
                          valueText={formatEqFrequency(activeEqBandFrequencyValue)}
                        />
                        <strong>{formatEqFrequency(activeEqBandFrequencyValue)}</strong>
                      </label>
                      <label className={styles.processingControl}>
                        <span>Gain</span>
                        <AudioSliderControl
                          disabled={!viewModel.capabilities.canEditProcessing}
                          label={`${selectedChannel.name} Band ${activeEqBand.label} EQ gain`}
                          max={EQ_GAIN_MAX}
                          min={EQ_GAIN_MIN}
                          onCommit={(value) => {
                            setSelectedEqBandId(activeEqBand.id);
                            setDraftValue(activeEqBandGainKey, value);
                            onUpdateChannelEq({
                              bandId: eqBandId(activeEqBand.id),
                              channelId: selectedChannel.id,
                              gainDb: value,
                            });
                            clearDraftValueLater(activeEqBandGainKey);
                          }}
                          onPreview={(value) => setDraftValue(activeEqBandGainKey, value)}
                          orientation="horizontal"
                          step={0.5}
                          value={activeEqBandGainValue}
                          valueText={`${activeEqBandGainValue.toFixed(1)} dB`}
                        />
                        <strong>{activeEqBandGainValue.toFixed(1)} dB</strong>
                      </label>
                      <label className={styles.processingControl}>
                        <span>Q</span>
                        <AudioSliderControl
                          disabled={!viewModel.capabilities.canEditProcessing}
                          label={`${selectedChannel.name} Band ${activeEqBand.label} EQ Q`}
                          max={EQ_Q_MAX}
                          min={EQ_Q_MIN}
                          onCommit={(value) => {
                            setSelectedEqBandId(activeEqBand.id);
                            setDraftValue(activeEqBandQKey, value);
                            onUpdateChannelEq({
                              bandId: eqBandId(activeEqBand.id),
                              channelId: selectedChannel.id,
                              q: value,
                            });
                            clearDraftValueLater(activeEqBandQKey);
                          }}
                          onPreview={(value) => setDraftValue(activeEqBandQKey, value)}
                          orientation="horizontal"
                          step={0.1}
                          value={activeEqBandQValue}
                          valueText={`Q ${activeEqBandQValue.toFixed(1)}`}
                        />
                        <strong>Q {activeEqBandQValue.toFixed(1)}</strong>
                      </label>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
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
          {selectedChannel ? (
            <div className={`${styles.placeholderPanel} ${styles.inspectorFullGraphPanel}`}>
              <div className={styles.graphCardHead}>
                <span className={styles.eyebrow}>Dynamics · TotalMix FX</span>
                <span className={styles.dynamicsPills}>
                  <button
                    aria-pressed={selectedChannel.dynamics.compressor.enabled}
                    data-active={selectedChannel.dynamics.compressor.enabled}
                    onClick={() =>
                      onUpdateChannelDynamics({
                        channelId: selectedChannel.id,
                        enabled: !selectedChannel.dynamics.compressor.enabled,
                        section: "compressor",
                      })
                    }
                    type="button"
                  >
                    Comp
                  </button>
                  <button
                    aria-pressed={selectedChannel.dynamics.gate.enabled}
                    data-active={selectedChannel.dynamics.gate.enabled}
                    onClick={() =>
                      onUpdateChannelDynamics({
                        channelId: selectedChannel.id,
                        enabled: !selectedChannel.dynamics.gate.enabled,
                        section: "gate",
                      })
                    }
                    type="button"
                  >
                    Gate
                  </button>
                </span>
              </div>
              <div
                className={styles.dynamicsGraphFull}
                data-active={selectedChannel.dynamics.compressor.enabled}
                data-testid="audio-dynamics-curve"
                aria-hidden="true"
              >
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d={dynamicsCurve} />
                  <circle cx={dynamicsCurvePoint.x} cy={dynamicsCurvePoint.y} r="3" />
                </svg>
                <i
                  data-active={selectedChannel.dynamics.gate.enabled}
                  style={{ "--dynamics-gate-x": `${gateThresholdX}%` } as CSSProperties}
                />
              </div>
              <div className={styles.graphRangeRow} data-testid="audio-dynamics-range">
                <span>Gate {selectedChannel.dynamics.gate.thresholdDb.toFixed(0)} dB</span>
                <strong>{dynamicsStatusText(selectedChannel)}</strong>
                <span>Comp {selectedChannel.dynamics.compressor.thresholdDb.toFixed(0)} dB</span>
              </div>
              <div className={styles.sendStack}>
                {(["compressor", "gate"] as const).map((section) => {
                  const processor = selectedChannel.dynamics[section];
                  const attackKey = `channel:${selectedChannel.id}:dynamics:${section}:attack`;
                  const attackValue = getDraftValue(attackKey, processor.attackMs);
                  const makeupKey = `channel:${selectedChannel.id}:dynamics:${section}:makeup`;
                  const makeupValue = getDraftValue(makeupKey, processor.makeupDb);
                  const releaseKey = `channel:${selectedChannel.id}:dynamics:${section}:release`;
                  const releaseValue = getDraftValue(releaseKey, processor.releaseMs);
                  const thresholdKey = `channel:${selectedChannel.id}:dynamics:${section}:threshold`;
                  const thresholdValue = getDraftValue(thresholdKey, processor.thresholdDb);
                  const ratioKey = `channel:${selectedChannel.id}:dynamics:${section}:ratio`;
                  const ratioValue = getDraftValue(ratioKey, processor.ratio);
                  return (
                    <div className={styles.sendCardFull} data-active={processor.enabled} key={section}>
                      <div className={styles.sendCardHead}>
                        <strong>{section === "compressor" ? "Compressor" : "Gate"}</strong>
                        <span className={styles.sendCardTag}>{processor.enabled ? "Enabled" : "Bypassed"}</span>
                      </div>
                      <div className={styles.processingControlGrid}>
                        <label className={styles.processingControl}>
                          <span>Thresh</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${section} threshold`}
                            max={0}
                            min={-80}
                            onCommit={(value) => {
                              setDraftValue(thresholdKey, value);
                              onUpdateChannelDynamics({
                                channelId: selectedChannel.id,
                                section,
                                thresholdDb: value,
                              });
                              clearDraftValueLater(thresholdKey);
                            }}
                            onPreview={(value) => setDraftValue(thresholdKey, value)}
                            orientation="horizontal"
                            step={1}
                            value={thresholdValue}
                            valueText={`${thresholdValue.toFixed(0)} dB`}
                          />
                          <strong>{thresholdValue.toFixed(0)} dB</strong>
                        </label>
                        <label className={styles.processingControl}>
                          <span>Ratio</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${section} ratio`}
                            max={20}
                            min={1}
                            onCommit={(value) => {
                              setDraftValue(ratioKey, value);
                              onUpdateChannelDynamics({
                                channelId: selectedChannel.id,
                                ratio: value,
                                section,
                              });
                              clearDraftValueLater(ratioKey);
                            }}
                            onPreview={(value) => setDraftValue(ratioKey, value)}
                            orientation="horizontal"
                            step={0.5}
                            value={ratioValue}
                            valueText={`${ratioValue.toFixed(1)}:1`}
                          />
                          <strong>{ratioValue.toFixed(1)}:1</strong>
                        </label>
                        <label className={styles.processingControl}>
                          <span>Attack</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${section} attack`}
                            max={200}
                            min={0.1}
                            onCommit={(value) => {
                              setDraftValue(attackKey, value);
                              onUpdateChannelDynamics({
                                attackMs: value,
                                channelId: selectedChannel.id,
                                section,
                              });
                              clearDraftValueLater(attackKey);
                            }}
                            onPreview={(value) => setDraftValue(attackKey, value)}
                            orientation="horizontal"
                            step={0.1}
                            value={attackValue}
                            valueText={`${attackValue.toFixed(1)} ms`}
                          />
                          <strong>{attackValue.toFixed(1)} ms</strong>
                        </label>
                        <label className={styles.processingControl}>
                          <span>Release</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${section} release`}
                            max={1000}
                            min={10}
                            onCommit={(value) => {
                              setDraftValue(releaseKey, value);
                              onUpdateChannelDynamics({
                                channelId: selectedChannel.id,
                                releaseMs: value,
                                section,
                              });
                              clearDraftValueLater(releaseKey);
                            }}
                            onPreview={(value) => setDraftValue(releaseKey, value)}
                            orientation="horizontal"
                            step={5}
                            value={releaseValue}
                            valueText={`${releaseValue.toFixed(0)} ms`}
                          />
                          <strong>{releaseValue.toFixed(0)} ms</strong>
                        </label>
                        <label className={styles.processingControl}>
                          <span>Makeup</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${section} makeup`}
                            max={24}
                            min={-24}
                            onCommit={(value) => {
                              setDraftValue(makeupKey, value);
                              onUpdateChannelDynamics({
                                channelId: selectedChannel.id,
                                makeupDb: value,
                                section,
                              });
                              clearDraftValueLater(makeupKey);
                            }}
                            onPreview={(value) => setDraftValue(makeupKey, value)}
                            orientation="horizontal"
                            step={0.5}
                            value={makeupValue}
                            valueText={`${makeupValue.toFixed(1)} dB`}
                          />
                          <strong>{makeupValue.toFixed(1)} dB</strong>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className={styles.emptyInspector}>
              <h3>No channel selected</h3>
              <p>Dynamics controls appear here after a source strip is selected.</p>
            </div>
          )}
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
          {selectedChannel ? (
            <div className={styles.sendStack}>
              {viewModel.mixTargets.map((mixTarget) => {
                const sendDraftKey = `channel:${selectedChannel.id}:send:${mixTarget.id}`;
                const value = getDraftValue(sendDraftKey, selectedChannelSendLevel(selectedChannel, mixTarget.id));
                const sendMode = selectedChannel.sendModes[mixTarget.id] ?? {
                  linkStereo: true,
                  mute: false,
                  preFader: false,
                  solo: false,
                };
                const sendMuted = selectedChannel.mute || sendMode.mute;
                const noSend = value <= 0.01;
                const sendState = sendMuted ? "muted" : noSend ? "none" : "sending";
                const sendStatus =
                  mixTarget.id === viewModel.selectedMixTargetId
                    ? sendMuted
                      ? "Active mix muted"
                      : noSend
                        ? "Active mix no send"
                        : "Active mix"
                    : sendMuted
                      ? "Muted"
                      : noSend
                        ? "No send"
                        : "Send";
                return (
                  <div
                    className={styles.sendCardFull}
                    data-active={mixTarget.id === viewModel.selectedMixTargetId}
                    data-send-state={sendState}
                    data-testid={`audio-send-destination-${mixTarget.id}`}
                    key={mixTarget.id}
                  >
                    <div className={styles.sendCardHead}>
                      <button
                        aria-pressed={mixTarget.id === viewModel.selectedMixTargetId}
                        className={styles.sendTargetButton}
                        data-active={mixTarget.id === viewModel.selectedMixTargetId}
                        onClick={(event) => {
                          event.preventDefault();
                          onSelectMixTarget(mixTarget.id);
                        }}
                        type="button"
                      >
                        {mixTarget.name}
                      </button>
                      <span className={styles.sendCardTag}>{sendStatus}</span>
                    </div>
                    <div className={styles.sendCardRoute}>
                      <strong>{selectedChannel.name}</strong>
                      <span>→</span>
                      <strong>{mixTarget.name}</strong>
                    </div>
                    <AudioSliderControl
                      disabled={!viewModel.actionsAllowed}
                      label={`${selectedChannel.name} send to ${mixTarget.name}`}
                      onCommit={(nextValue) => {
                        setDraftValue(sendDraftKey, nextValue);
                        commitChannelContinuous({
                          channelId: selectedChannel.id,
                          fader: nextValue,
                          mixTargetId: mixTarget.id,
                        });
                        clearDraftValueLater(sendDraftKey);
                      }}
                      onPreview={(nextValue) => setDraftValue(sendDraftKey, nextValue)}
                      orientation="horizontal"
                      snapUnity
                      value={value}
                      valueText={formatAudioDb(value)}
                    />
                    <strong className={styles.sendCardValue}>{formatAudioDb(value)}</strong>
                    <div className={styles.sendModeRow}>
                      <button
                        aria-pressed={sendMode.preFader}
                        data-active={sendMode.preFader}
                        disabled={!viewModel.actionsAllowed}
                        onClick={() =>
                          onUpdateChannelSendMode({
                            channelId: selectedChannel.id,
                            mixTargetId: mixTarget.id,
                            preFader: !sendMode.preFader,
                          })
                        }
                        type="button"
                      >
                        Pre fader
                      </button>
                      <button
                        aria-pressed={sendMode.mute}
                        data-active={sendMode.mute}
                        disabled={!viewModel.actionsAllowed}
                        onClick={() =>
                          onUpdateChannelSendMode({
                            channelId: selectedChannel.id,
                            mixTargetId: mixTarget.id,
                            mute: !sendMode.mute,
                          })
                        }
                        type="button"
                      >
                        Mute send
                      </button>
                      <button
                        aria-pressed={sendMode.linkStereo}
                        data-active={sendMode.linkStereo}
                        disabled={!viewModel.actionsAllowed}
                        onClick={() =>
                          onUpdateChannelSendMode({
                            channelId: selectedChannel.id,
                            linkStereo: !sendMode.linkStereo,
                            mixTargetId: mixTarget.id,
                          })
                        }
                        type="button"
                      >
                        Link L+R
                      </button>
                      <button
                        aria-pressed={sendMode.solo}
                        data-active={sendMode.solo}
                        disabled={!viewModel.actionsAllowed}
                        onClick={() =>
                          onUpdateChannelSendMode({
                            channelId: selectedChannel.id,
                            mixTargetId: mixTarget.id,
                            solo: !sendMode.solo,
                          })
                        }
                        type="button"
                      >
                        Solo send
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyInspector}>
              <h3>No channel selected</h3>
              <p>Send levels appear here after a source strip is selected.</p>
            </div>
          )}
        </section>
      ) : null}
    </aside>
  );
}
