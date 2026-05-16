import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { ShellStore } from "@sse/engine-client";

import styles from "../AudioWorkspace.module.css";
import { AUDIO_FADER_UNITY, formatAudioDb, formatAudioRole, formatMeterDb } from "../audioFormatting";
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
import { AudioSliderControl } from "./AudioSliderControl";

type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
type AudioDynamicsUpdate = Parameters<ShellStore["updateAudioChannelDynamics"]>[0];
type AudioEqUpdate = Parameters<ShellStore["updateAudioChannelEq"]>[0];
type AudioSendModeUpdate = Parameters<ShellStore["updateAudioChannelSendMode"]>[0];
type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];
type SelectedAudioChannel = NonNullable<AudioWorkspaceViewModel["selectedChannel"]>;
type AudioEqBand = SelectedAudioChannel["eq"]["bands"][number];
export type InspectorTab = "channel" | "eq" | "dynamics" | "sends";

const EQ_FREQUENCY_MIN = 20;
const EQ_FREQUENCY_MAX = 20000;
const EQ_GAIN_MIN = -12;
const EQ_GAIN_MAX = 12;
const EQ_Q_MIN = 0.1;
const EQ_Q_MAX = 12;

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

const TABS: Array<{ id: InspectorTab; label: string; testId: string }> = [
  { id: "channel", label: "Channel", testId: "audio-inspector-channel" },
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

function channelSourceText(role: string) {
  if (role === "playback-pair") return "Playback engine";
  if (role === "front-preamp") return "RME UFX III mic preamp";
  if (role === "rear-line") return "Rear line input";
  return "Audio source";
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

function channelDriverText(role: string) {
  if (role === "playback-pair") return "Driver: n/a · playback bus";
  if (role === "front-preamp") return "Driver: RME UFX III · mic preamp";
  return "Driver: Core Audio";
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

export function AudioInspector({
  clearDraftValue,
  commitChannelContinuous,
  commitMixTargetContinuous,
  getDraftValue,
  activeTab,
  onActiveTabChange,
  onSelectMixTarget,
  setDraftValue,
  onUpdateChannelDynamics,
  onUpdateChannelEq,
  onUpdateChannelSendMode,
  onUpdateChannel,
  onUpdateMixTarget,
  viewModel,
}: {
  clearDraftValue: (key: string) => void;
  commitChannelContinuous: (request: AudioChannelUpdate) => void;
  commitMixTargetContinuous: (request: AudioMixTargetUpdate) => void;
  getDraftValue: (key: string, fallback: number) => number;
  activeTab: InspectorTab;
  onActiveTabChange: (tab: InspectorTab) => void;
  onSelectMixTarget: (mixTargetId: string) => void;
  setDraftValue: (key: string, value: number) => void;
  onUpdateChannelDynamics: (request: AudioDynamicsUpdate) => void;
  onUpdateChannelEq: (request: AudioEqUpdate) => void;
  onUpdateChannelSendMode: (request: AudioSendModeUpdate) => void;
  onUpdateChannel: (request: AudioChannelUpdate) => void;
  onUpdateMixTarget: (request: AudioMixTargetUpdate) => void;
  viewModel: AudioWorkspaceViewModel;
}) {
  const [selectedEqBandId, setSelectedEqBandId] = useState<string | null>(null);
  const selectedChannel = viewModel.selectedChannel;
  const selectedMixTarget = viewModel.selectedMixTarget;
  const activeEqBandId =
    selectedChannel?.eq.bands.find((band) => band.id === selectedEqBandId)?.id ??
    selectedChannel?.eq.bands[0]?.id ??
    null;
  const gainDraftKey = selectedChannel ? `channel:${selectedChannel.id}:gain` : "channel:none:gain";
  const selectedGain = selectedChannel ? getDraftValue(gainDraftKey, selectedChannel.gain) : 0;
  const selectedSendDraftKey = selectedChannel
    ? `channel:${selectedChannel.id}:send:${viewModel.selectedMixTargetId ?? "none"}`
    : "channel:none:send:none";
  const selectedSendLevel = selectedChannel
    ? getDraftValue(selectedSendDraftKey, selectedChannelSendLevel(selectedChannel, viewModel.selectedMixTargetId))
    : 0;
  const monitorDraftKey = selectedMixTarget
    ? `mixTarget:${selectedMixTarget.id}:inspector-volume`
    : "mixTarget:none:inspector-volume";
  const monitorValue = getDraftValue(monitorDraftKey, selectedMixTarget?.volume ?? 0);
  const selectedGroup = selectedChannel ? getAudioChannelGroup(selectedChannel) : "";
  const selectedRightMeter = selectedChannel
    ? selectedChannel.stereo
      ? selectedChannel.meterRight
      : selectedChannel.meterLevel * 0.84
    : 0;
  const selectedPeak = selectedChannel
    ? Math.max(selectedChannel.peakHold, selectedChannel.meterLeft, selectedRightMeter)
    : 0;
  const outputRightMeter = monitorValue * 0.96;
  const outputPeak = Math.max(monitorValue, outputRightMeter);
  const eqGraphPath = selectedChannel
    ? selectedChannel.eq.bands
        .map((band, index) => {
          const command = index === 0 ? "M" : "L";
          return `${command} ${eqPointX(band.frequencyHz).toFixed(2)} ${eqPointY(band.gainDb).toFixed(2)}`;
        })
        .join(" ")
    : "";

  const commitEqPointFromPointer = (event: ReactPointerEvent<HTMLButtonElement>, band: AudioEqBand) => {
    if (!selectedChannel || !viewModel.capabilities.canEditProcessing) return;
    const graph = event.currentTarget.closest("[data-eq-graph]");
    if (!(graph instanceof HTMLElement)) return;

    const rect = graph.getBoundingClientRect();
    const frequencyPercent = (event.clientX - rect.left) / Math.max(1, rect.width);
    const gainPercent = (event.clientY - rect.top) / Math.max(1, rect.height);
    setSelectedEqBandId(band.id);
    onUpdateChannelEq({
      bandId: eqBandId(band.id),
      channelId: selectedChannel.id,
      frequencyHz: eqFrequencyFromPointX(frequencyPercent),
      gainDb: eqGainFromPointY(gainPercent),
    });
  };

  return (
    <aside className={styles.inspector} data-source-tier={viewModel.selectedSourceTier}>
      <div className={styles.inspectorTabs} aria-label="Audio inspector tabs">
        {TABS.map((tab) => (
          <button
            data-active={tab.id === activeTab}
            key={tab.id}
            onClick={() => onActiveTabChange(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

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

            <div
              className={styles.bigMeterCard}
              data-simulated-meter={viewModel.meterSimulationActive}
              data-testid="audio-inspector-metering"
            >
              <div className={styles.bigMeter} aria-hidden="true">
                <span>
                  <i style={{ height: `${Math.round(selectedChannel.meterLeft * 100)}%` }} />
                  <b style={{ bottom: `${Math.round(selectedChannel.peakHold * 100)}%` }} />
                </span>
                <span>
                  <i style={{ height: `${Math.round(selectedRightMeter * 100)}%` }} />
                  <b style={{ bottom: `${Math.round(selectedPeak * 96)}%` }} />
                </span>
              </div>
              <div className={styles.bigMeterInfo}>
                {viewModel.meterSimulationActive ? (
                  <span className={styles.meterSimulationBadge}>TEST STAGE</span>
                ) : null}
                <div className={styles.bigMeterRow}>
                  <span>
                    <small>Peak L / R</small>
                    <strong>
                      {formatMeterDb(selectedChannel.meterLeft)} / {formatMeterDb(selectedRightMeter)}
                      <em>dB</em>
                    </strong>
                  </span>
                  <span>
                    <small>Hold</small>
                    <strong data-tone={selectedChannel.clip ? "clip" : "warn"}>
                      {formatMeterDb(selectedPeak)}
                      <em>dB</em>
                    </strong>
                  </span>
                </div>
                <div className={styles.bigMeterRow}>
                  <span>
                    <small>LUFS short</small>
                    <strong>
                      n/a<em>LU</em>
                    </strong>
                  </span>
                  <span>
                    <small>Correlation</small>
                    <strong>n/a</strong>
                  </span>
                </div>
              </div>
            </div>

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
                  window.setTimeout(() => clearDraftValue(selectedSendDraftKey), 250);
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
                data-control="mute"
                data-active={selectedChannel.mute}
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateChannel({ channelId: selectedChannel.id, mute: !selectedChannel.mute })}
                type="button"
              >
                Mute
              </button>
              <button
                data-control="solo"
                data-active={selectedChannel.solo}
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateChannel({ channelId: selectedChannel.id, solo: !selectedChannel.solo })}
                type="button"
              >
                Solo
              </button>
              <button data-control="pfl" disabled type="button">
                PFL
              </button>
              <button
                data-control="reset"
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
                Reset
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

            <div
              className={styles.bigMeterCard}
              data-simulated-meter={viewModel.meterSimulationActive}
              data-testid="audio-inspector-output-metering"
            >
              <div className={styles.bigMeter} aria-hidden="true">
                <span>
                  <i style={{ height: `${Math.round(monitorValue * 100)}%` }} />
                  <b style={{ bottom: `${Math.round(outputPeak * 100)}%` }} />
                </span>
                <span>
                  <i style={{ height: `${Math.round(outputRightMeter * 100)}%` }} />
                  <b style={{ bottom: `${Math.round(outputPeak * 96)}%` }} />
                </span>
              </div>
              <div className={styles.bigMeterInfo}>
                {viewModel.meterSimulationActive ? (
                  <span className={styles.meterSimulationBadge}>TEST STAGE</span>
                ) : null}
                <div className={styles.bigMeterRow}>
                  <span>
                    <small>Peak L / R</small>
                    <strong>
                      {formatMeterDb(monitorValue)} / {formatMeterDb(outputRightMeter)}
                      <em>dB</em>
                    </strong>
                  </span>
                  <span>
                    <small>Hold</small>
                    <strong>{formatMeterDb(outputPeak)}dB</strong>
                  </span>
                </div>
                <div className={styles.bigMeterRow}>
                  <span>
                    <small>LUFS short</small>
                    <strong>
                      n/a<em>LU</em>
                    </strong>
                  </span>
                  <span>
                    <small>Correlation</small>
                    <strong>n/a</strong>
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
                  window.setTimeout(() => clearDraftValue(monitorDraftKey), 250);
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
                data-control="mute"
                data-active={selectedMixTarget.mute}
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, mute: !selectedMixTarget.mute })}
                type="button"
              >
                Mute
              </button>
              <button data-control="cue" disabled type="button">
                Cue
              </button>
              <button data-control="pfl" disabled type="button">
                PFL
              </button>
              <button
                data-control="reset"
                disabled={!viewModel.actionsAllowed}
                onClick={() => onUpdateMixTarget({ mixTargetId: selectedMixTarget.id, volume: AUDIO_FADER_UNITY })}
                type="button"
              >
                Reset
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
        <section className={styles.inspectorPanel} data-testid="audio-inspector-channel">
          {selectedChannel ? (
            <>
              <div className={styles.inspectorMiniGrid}>
                <button
                  aria-label="Open tone tab"
                  className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard}`}
                  data-testid="audio-inspector-eq-mini"
                  onClick={() => onActiveTabChange("eq")}
                  type="button"
                >
                  <span className={styles.graphCardHead}>
                    <span className={styles.eyebrow}>EQ · TotalMix FX</span>
                    <span className={styles.eqBandRow}>
                      <i>LC</i>
                      <i data-active="true">LO</i>
                      <i data-active="true">MID</i>
                      <i>HI</i>
                    </span>
                  </span>
                  <span className={styles.eqGraphMini} aria-hidden="true">
                    <svg viewBox="0 0 120 42" preserveAspectRatio="none">
                      <path d="M0 25 C24 25 25 16 38 18 C52 21 70 29 86 20 C95 14 97 16 104 20 C111 25 116 24 120 24" />
                    </svg>
                  </span>
                </button>

                <button
                  aria-label="Open processing tab"
                  className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard}`}
                  data-testid="audio-inspector-dynamics-mini"
                  onClick={() => onActiveTabChange("dynamics")}
                  type="button"
                >
                  <span className={styles.graphCardHead}>
                    <span className={styles.eyebrow}>Dynamics</span>
                    <span className={styles.dynamicsPills}>
                      <i>Comp</i>
                      <i>Gate</i>
                    </span>
                  </span>
                  <span className={styles.dynamicsGraphMini} aria-hidden="true">
                    <svg viewBox="0 0 120 42" preserveAspectRatio="none">
                      <path d="M2 39 L56 23 L118 8" />
                      <circle cx="74" cy="18" r="3" />
                    </svg>
                    <i />
                  </span>
                </button>

                <button
                  aria-label="Open routing tab"
                  className={`${styles.inspectorMiniCard} ${styles.routingMiniCard}`}
                  data-testid="audio-inspector-sends-mini"
                  onClick={() => onActiveTabChange("sends")}
                  type="button"
                >
                  <span className={styles.graphCardHead}>
                    <span className={styles.eyebrow}>Sends from this channel</span>
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
                        return (
                          <span
                            className={styles.routingTargetNode}
                            data-active={mixTarget.id === viewModel.selectedMixTargetId}
                            key={mixTarget.id}
                          >
                            <strong>{mixTarget.name}</strong>
                            <small>{formatAudioDb(value)}</small>
                          </span>
                        );
                      })}
                    </span>
                  </span>
                </button>

                <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
                  <span className={styles.eyebrow}>Source</span>
                  <strong>
                    {channelSourceText(selectedChannel.role)} · {selectedChannel.name}
                  </strong>
                  <span>{channelDriverText(selectedChannel.role)}</span>
                  <div className={styles.detailGrid}>
                    <span>
                      <small>Group</small>
                      <strong>{selectedGroup}</strong>
                    </span>
                    <span>
                      <small>Polarity</small>
                      <strong>{selectedChannel.phase ? "Flipped" : "Normal"}</strong>
                    </span>
                  </div>
                </section>

                <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
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
                          window.setTimeout(() => clearDraftValue(gainDraftKey), 250);
                        }}
                        onPreview={(nextGain) => setDraftValue(gainDraftKey, nextGain)}
                        variant="narrow"
                      />
                      <div className={styles.unsupportedToggleRow}>
                        <button
                          data-active={selectedChannel.phantom}
                          disabled={!audioChannelSupportsPhantom(selectedChannel) || !viewModel.actionsAllowed}
                          onClick={() =>
                            onUpdateChannel({ channelId: selectedChannel.id, phantom: !selectedChannel.phantom })
                          }
                          type="button"
                        >
                          48V
                        </button>
                        <button
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
                          data-active={selectedChannel.phase}
                          disabled={!audioChannelSupportsPhase(selectedChannel) || !viewModel.actionsAllowed}
                          onClick={() =>
                            onUpdateChannel({ channelId: selectedChannel.id, phase: !selectedChannel.phase })
                          }
                          type="button"
                        >
                          Polarity
                        </button>
                        <button
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
                      <div className={styles.detailGrid}>
                        <span>
                          <small>Buffer status</small>
                          <strong>n/a</strong>
                        </span>
                        <span>
                          <small>Latency</small>
                          <strong>n/a</strong>
                        </span>
                      </div>
                      <div className={styles.unsupportedToggleRow}>
                        <button data-active={selectedChannel.stereo} data-readonly="true" type="button">
                          Stereo link
                        </button>
                        <button aria-label="Auto fade" data-active={false} data-readonly="true" type="button">
                          Auto fade <small>off</small>
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : selectedMixTarget ? (
            <div className={styles.inspectorMiniGrid}>
              <button
                aria-label="Open output EQ tab"
                className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard}`}
                data-testid="audio-inspector-eq-mini"
                onClick={() => onActiveTabChange("eq")}
                type="button"
              >
                <span className={styles.graphCardHead}>
                  <span className={styles.eyebrow}>Output EQ</span>
                  <span className={styles.eqBandRow}>
                    <i>LC</i>
                    <i>LO</i>
                    <i>MID</i>
                    <i>HI</i>
                  </span>
                </span>
                <span className={styles.eqGraphMini} aria-hidden="true">
                  <svg viewBox="0 0 120 42" preserveAspectRatio="none">
                    <path d="M0 28 C26 28 35 26 48 26 C65 26 72 30 88 24 C101 19 108 22 120 22" />
                  </svg>
                </span>
              </button>

              <button
                aria-label="Open output dynamics tab"
                className={`${styles.inspectorMiniCard} ${styles.inspectorGraphCard}`}
                data-testid="audio-inspector-dynamics-mini"
                onClick={() => onActiveTabChange("dynamics")}
                type="button"
              >
                <span className={styles.graphCardHead}>
                  <span className={styles.eyebrow}>Output dynamics</span>
                  <span className={styles.dynamicsPills}>
                    <i>Comp</i>
                    <i>Lim</i>
                  </span>
                </span>
                <span className={styles.dynamicsGraphMini} aria-hidden="true">
                  <svg viewBox="0 0 120 42" preserveAspectRatio="none">
                    <path d="M2 36 L62 22 L118 18" />
                    <circle cx="82" cy="20" r="3" />
                  </svg>
                  <i />
                </span>
              </button>

              <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
                <span className={styles.eyebrow}>Output</span>
                <strong>
                  {outputRouteText(selectedMixTarget.role)} · {selectedMixTarget.name}
                </strong>
                <span>Hardware telemetry unavailable</span>
                <div className={styles.detailGrid}>
                  <span>
                    <small>Clock</small>
                    <strong>{viewModel.footerTelemetry.clock}</strong>
                  </span>
                  <span>
                    <small>Metering</small>
                    <strong>{viewModel.footerTelemetry.metering}</strong>
                  </span>
                </div>
              </section>

              <section className={`${styles.inspectorMiniCard} ${styles.sourceCard}`}>
                <span className={styles.eyebrow}>Unavailable controls</span>
                <div className={styles.unsupportedToggleRow}>
                  <button disabled type="button">
                    PFL
                  </button>
                  <button disabled type="button">
                    Cue solo
                  </button>
                  <button disabled type="button">
                    Clip reset
                  </button>
                  <button disabled type="button">
                    Capture
                  </button>
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
        <section className={styles.inspectorPanel} data-testid="audio-inspector-eq">
          {selectedChannel ? (
            <div className={`${styles.placeholderPanel} ${styles.inspectorFullGraphPanel}`}>
              <div className={styles.graphCardHead}>
                <span className={styles.eyebrow}>Parametric EQ · TotalMix FX</span>
                <span className={styles.eqBandRow}>
                  {selectedChannel.eq.bands.map((band) => (
                    <button
                      data-active={band.enabled}
                      data-selected={band.id === activeEqBandId}
                      key={band.id}
                      onClick={() =>
                        onUpdateChannelEq({
                          bandEnabled: !band.enabled,
                          bandId: eqBandId(band.id),
                          channelId: selectedChannel.id,
                        })
                      }
                      type="button"
                    >
                      {band.label}
                    </button>
                  ))}
                </span>
              </div>
              <div className={styles.eqGraphFull} data-eq-graph="true">
                <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d={eqGraphPath} />
                </svg>
                <div className={styles.eqPointLayer} aria-label="EQ graph band points">
                  {selectedChannel.eq.bands.map((band) => (
                    <button
                      aria-label={`${selectedChannel.name} ${band.label} EQ point`}
                      className={styles.eqPoint}
                      data-selected={band.id === activeEqBandId}
                      data-testid={`audio-eq-point-${band.id}`}
                      disabled={!viewModel.capabilities.canEditProcessing}
                      key={band.id}
                      onClick={() => setSelectedEqBandId(band.id)}
                      onPointerCancel={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
                      }}
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.currentTarget.focus();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        commitEqPointFromPointer(event, band);
                      }}
                      onPointerMove={(event) => {
                        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                        event.preventDefault();
                        commitEqPointFromPointer(event, band);
                      }}
                      onPointerUp={(event) => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                          commitEqPointFromPointer(event, band);
                          event.currentTarget.releasePointerCapture(event.pointerId);
                        }
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
              <button
                data-active={selectedChannel.eq.enabled}
                disabled={!viewModel.capabilities.canEditProcessing}
                onClick={() =>
                  onUpdateChannelEq({ channelId: selectedChannel.id, enabled: !selectedChannel.eq.enabled })
                }
                type="button"
              >
                {selectedChannel.eq.enabled ? "Bypass EQ" : "Enable EQ"}
              </button>
              <div className={styles.sendStack}>
                {selectedChannel.eq.bands.map((band) => {
                  const frequencyKey = `channel:${selectedChannel.id}:eq:${band.id}:frequency`;
                  const frequencyValue = getDraftValue(frequencyKey, band.frequencyHz);
                  const gainKey = `channel:${selectedChannel.id}:eq:${band.id}:gain`;
                  const gainValue = getDraftValue(gainKey, band.gainDb);
                  const qKey = `channel:${selectedChannel.id}:eq:${band.id}:q`;
                  const qValue = getDraftValue(qKey, band.q);
                  return (
                    <div className={styles.sendCardFull} data-active={band.id === activeEqBandId} key={band.id}>
                      <div className={styles.sendCardHead}>
                        <strong>{band.label}</strong>
                        <span className={styles.sendCardTag}>
                          {formatEqBandType(band.bandType)} · {band.enabled ? "In" : "Out"} · slope fixed
                        </span>
                      </div>
                      <div className={styles.processingControlGrid}>
                        <label className={styles.processingControl}>
                          <span>Freq</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${band.label} EQ frequency`}
                            max={EQ_FREQUENCY_MAX}
                            min={EQ_FREQUENCY_MIN}
                            onCommit={(value) => {
                              setSelectedEqBandId(band.id);
                              setDraftValue(frequencyKey, value);
                              onUpdateChannelEq({
                                bandId: eqBandId(band.id),
                                channelId: selectedChannel.id,
                                frequencyHz: value,
                              });
                              window.setTimeout(() => clearDraftValue(frequencyKey), 250);
                            }}
                            onPreview={(value) => setDraftValue(frequencyKey, value)}
                            orientation="horizontal"
                            step={10}
                            value={frequencyValue}
                            valueText={formatEqFrequency(frequencyValue)}
                          />
                          <strong>{formatEqFrequency(frequencyValue)}</strong>
                        </label>
                        <label className={styles.processingControl}>
                          <span>Q</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${band.label} EQ Q`}
                            max={EQ_Q_MAX}
                            min={EQ_Q_MIN}
                            onCommit={(value) => {
                              setSelectedEqBandId(band.id);
                              setDraftValue(qKey, value);
                              onUpdateChannelEq({
                                bandId: eqBandId(band.id),
                                channelId: selectedChannel.id,
                                q: value,
                              });
                              window.setTimeout(() => clearDraftValue(qKey), 250);
                            }}
                            onPreview={(value) => setDraftValue(qKey, value)}
                            orientation="horizontal"
                            step={0.1}
                            value={qValue}
                            valueText={`Q ${qValue.toFixed(1)}`}
                          />
                          <strong>Q {qValue.toFixed(1)}</strong>
                        </label>
                        <label className={styles.processingControl}>
                          <span>Gain</span>
                          <AudioSliderControl
                            disabled={!viewModel.capabilities.canEditProcessing}
                            label={`${selectedChannel.name} ${band.label} EQ gain`}
                            max={EQ_GAIN_MAX}
                            min={EQ_GAIN_MIN}
                            onCommit={(value) => {
                              setSelectedEqBandId(band.id);
                              setDraftValue(gainKey, value);
                              onUpdateChannelEq({
                                bandId: eqBandId(band.id),
                                channelId: selectedChannel.id,
                                gainDb: value,
                              });
                              window.setTimeout(() => clearDraftValue(gainKey), 250);
                            }}
                            onPreview={(value) => setDraftValue(gainKey, value)}
                            orientation="horizontal"
                            step={0.5}
                            value={gainValue}
                            valueText={`${gainValue.toFixed(1)} dB`}
                          />
                          <strong>{gainValue.toFixed(1)} dB</strong>
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
              <p>EQ controls appear here after a source strip is selected.</p>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "dynamics" ? (
        <section className={styles.inspectorPanel} data-testid="audio-inspector-dynamics">
          {selectedChannel ? (
            <div className={`${styles.placeholderPanel} ${styles.inspectorFullGraphPanel}`}>
              <div className={styles.graphCardHead}>
                <span className={styles.eyebrow}>Dynamics · TotalMix FX</span>
                <span className={styles.dynamicsPills}>
                  <button
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
              <div className={styles.dynamicsGraphFull} aria-hidden="true">
                <svg viewBox="0 0 120 80" preserveAspectRatio="none">
                  <path d="M4 74 L54 44 L116 22" />
                  <circle cx="78" cy="33" r="3" />
                </svg>
                <i />
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
                              window.setTimeout(() => clearDraftValue(thresholdKey), 250);
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
                              window.setTimeout(() => clearDraftValue(ratioKey), 250);
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
                              window.setTimeout(() => clearDraftValue(attackKey), 250);
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
                              window.setTimeout(() => clearDraftValue(releaseKey), 250);
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
                              window.setTimeout(() => clearDraftValue(makeupKey), 250);
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
        <section className={styles.inspectorPanel} data-testid="audio-inspector-sends">
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
                return (
                  <div
                    className={styles.sendCardFull}
                    data-active={mixTarget.id === viewModel.selectedMixTargetId}
                    key={mixTarget.id}
                  >
                    <div className={styles.sendCardHead}>
                      <button
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
                      <span className={styles.sendCardTag}>
                        {mixTarget.id === viewModel.selectedMixTargetId ? "Active mix" : "Send"}
                      </span>
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
                        window.setTimeout(() => clearDraftValue(sendDraftKey), 250);
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
