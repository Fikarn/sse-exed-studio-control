/**
 * Pure helpers, constants, and type aliases shared by the audio inspector
 * surfaces (Overview, EQ, Dynamics, Sends, Output mode).
 *
 * Everything here is stateless and side-effect free — no React, no DOM
 * dependencies — so future inspector sub-files can import freely without
 * pulling extra component context with them.
 */
import type { ShellStore } from "@sse/engine-client";

import { formatAudioRole } from "../../audioFormatting";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";

export type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
export type AudioDynamicsUpdate = Parameters<ShellStore["updateAudioChannelDynamics"]>[0];
export type AudioEqUpdate = Parameters<ShellStore["updateAudioChannelEq"]>[0];
export type AudioSendModeUpdate = Parameters<ShellStore["updateAudioChannelSendMode"]>[0];
export type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];
export type SelectedAudioChannel = NonNullable<AudioWorkspaceViewModel["selectedChannel"]>;
export type AudioEqBand = SelectedAudioChannel["eq"]["bands"][number];
export type AudioLowCut = SelectedAudioChannel["eq"]["lowCut"];
export type InspectorTab = "channel" | "eq" | "dynamics" | "sends";

/**
 * Pointer-drag anchor used by the EQ graph. Lives in the shared helpers so
 * the `useAudioInspectorEqState` hook can own the ref while the EQ tab body
 * still imports the type without pulling in the hook module.
 */
export interface EqDragRef {
  bandId: string;
  height: number;
  left: number;
  pointerId: number;
  top: number;
  width: number;
}

export const EQ_FREQUENCY_MIN = 20;
export const EQ_FREQUENCY_MAX = 20000;
export const EQ_GAIN_MIN = -20;
export const EQ_GAIN_MAX = 20;
export const EQ_Q_MIN = 0.4;
export const EQ_Q_MAX = 9.9;
export const LOW_CUT_FREQUENCY_MIN = 20;
export const LOW_CUT_FREQUENCY_MAX = 500;
export const LOW_CUT_SLOPES = [6, 12, 18, 24] as const;
export const LOW_CUT_HANDLE_ID = "lowCut";

export const EQ_FREQUENCY_MARKERS = [
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

export const EQ_GAIN_MARKERS = [
  { gainDb: 20, label: "+20 dB" },
  { gainDb: 0, label: "0 dB" },
  { gainDb: -20, label: "-20 dB" },
] as const;

export const INSPECTOR_TABS: Array<{ id: InspectorTab; label: string; testId: string }> = [
  { id: "channel", label: "Overview", testId: "audio-inspector-channel" },
  { id: "eq", label: "EQ", testId: "audio-inspector-eq" },
  { id: "dynamics", label: "Dynamics", testId: "audio-inspector-dynamics" },
  { id: "sends", label: "Sends", testId: "audio-inspector-sends" },
];

export function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function formatEqFrequency(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)} kHz`;
  }
  return `${Math.round(value)} Hz`;
}

export function formatEqBandType(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function eqBandId(value: string) {
  return value as AudioEqUpdate["bandId"];
}

export function eqBandType(value: string) {
  return value as AudioEqUpdate["bandType"];
}

export function eqPointX(frequencyHz: number) {
  const min = Math.log10(EQ_FREQUENCY_MIN);
  const max = Math.log10(EQ_FREQUENCY_MAX);
  const value = Math.log10(clamp(frequencyHz, EQ_FREQUENCY_MIN, EQ_FREQUENCY_MAX));
  return ((value - min) / (max - min)) * 100;
}

export function eqFrequencyFromPointX(percent: number) {
  const min = Math.log10(EQ_FREQUENCY_MIN);
  const max = Math.log10(EQ_FREQUENCY_MAX);
  return Math.round(10 ** (min + clamp(percent, 0, 1) * (max - min)));
}

export function eqPointY(gainDb: number) {
  return ((EQ_GAIN_MAX - clamp(gainDb, EQ_GAIN_MIN, EQ_GAIN_MAX)) / (EQ_GAIN_MAX - EQ_GAIN_MIN)) * 100;
}

export function eqGainFromPointY(percent: number) {
  return Number((EQ_GAIN_MAX - clamp(percent, 0, 1) * (EQ_GAIN_MAX - EQ_GAIN_MIN)).toFixed(1));
}

export function lowCutFrequencyFromPointX(percent: number) {
  const min = Math.log10(LOW_CUT_FREQUENCY_MIN);
  const max = Math.log10(LOW_CUT_FREQUENCY_MAX);
  return Math.round(10 ** (min + clamp(percent, 0, 1) * (max - min)));
}

export function eqOctaves(frequency: number, center: number) {
  return Math.log2(
    clamp(frequency, EQ_FREQUENCY_MIN, EQ_FREQUENCY_MAX) / clamp(center, EQ_FREQUENCY_MIN, EQ_FREQUENCY_MAX)
  );
}

export function eqBandContribution(band: AudioEqBand, frequencyHz: number) {
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

export function lowCutContribution(lowCut: AudioLowCut, frequencyHz: number) {
  if (!lowCut.enabled || frequencyHz >= lowCut.frequencyHz) return 0;
  return Math.max(EQ_GAIN_MIN, -lowCut.slopeDbPerOctave * Math.abs(eqOctaves(frequencyHz, lowCut.frequencyHz)));
}

export function eqResponseAt(eq: SelectedAudioChannel["eq"], frequencyHz: number) {
  const bandGain = eq.enabled ? eq.bands.reduce((sum, band) => sum + eqBandContribution(band, frequencyHz), 0) : 0;
  return clamp(lowCutContribution(eq.lowCut, frequencyHz) + bandGain, EQ_GAIN_MIN, EQ_GAIN_MAX);
}

export function eqResponsePath(eq: SelectedAudioChannel["eq"], points = 96) {
  return Array.from({ length: points }, (_, index) => {
    const percent = points <= 1 ? 0 : index / (points - 1);
    const frequencyHz = eqFrequencyFromPointX(percent);
    const command = index === 0 ? "M" : "L";
    return `${command} ${eqPointX(frequencyHz).toFixed(2)} ${eqPointY(eqResponseAt(eq, frequencyHz)).toFixed(2)}`;
  }).join(" ");
}

export function lowCutShadePath(lowCut: AudioLowCut) {
  const x = eqPointX(lowCut.frequencyHz);
  return `M 0 100 L 0 0 L ${x.toFixed(2)} 0 C ${(x * 0.92).toFixed(2)} 28 ${(x * 0.86).toFixed(2)} 72 ${x.toFixed(2)} 100 Z`;
}

export function channelTypeLabel(role: string) {
  if (role === "playback-pair") return "Playback";
  if (role === "front-preamp") return "Channel";
  if (role === "rear-line") return "Line";
  return formatAudioRole(role);
}

export function channelRoutingSourceText(role: string) {
  if (role === "playback-pair") return "Playback bus";
  if (role === "front-preamp") return "Mic preamp";
  if (role === "rear-line") return "Line input";
  return "Audio source";
}

export function channelOrdinalLabel(viewModel: AudioWorkspaceViewModel, channel: SelectedAudioChannel) {
  const peers = viewModel.channels.filter((entry) => entry.role === channel.role);
  const index = peers.findIndex((entry) => entry.id === channel.id);
  return String(Math.max(0, index) + 1).padStart(2, "0");
}

export function outputTypeLabel(role: string) {
  if (role === "main-out") return "Main";
  if (role === "phones-a") return "Cue A";
  if (role === "phones-b") return "Cue B";
  return formatAudioRole(role);
}

export function outputRouteText(role: string) {
  if (role === "main-out") return "Stereo monitor";
  if (role === "phones-a") return "Phones cue A";
  if (role === "phones-b") return "Phones cue B";
  return "Hardware output";
}

export function dynamicsThresholdPercent(thresholdDb: number) {
  return clamp(((thresholdDb + 80) / 80) * 100, 0, 100);
}

export function dynamicsCurvePath(processor: SelectedAudioChannel["dynamics"]["compressor"]) {
  if (!processor.enabled) {
    return "M 0 92 L 100 8";
  }
  const threshold = dynamicsThresholdPercent(processor.thresholdDb);
  const ratio = Math.max(1, processor.ratio);
  const endOutput = threshold + (100 - threshold) / ratio;
  return `M 0 100 L ${threshold.toFixed(1)} ${(100 - threshold).toFixed(1)} L 100 ${(100 - endOutput).toFixed(1)}`;
}

export function dynamicsPoint(processor: SelectedAudioChannel["dynamics"]["compressor"]) {
  const x = dynamicsThresholdPercent(processor.thresholdDb);
  return { x, y: 100 - x };
}

export function dynamicsStatusText(channel: SelectedAudioChannel) {
  const comp = channel.dynamics.compressor.enabled ? "Comp in" : "Comp bypassed";
  const gate = channel.dynamics.gate.enabled ? "Gate in" : "Gate bypassed";
  return `${comp} · ${gate}`;
}

export function eqStatusText(channel: SelectedAudioChannel) {
  const lowCut = channel.eq.lowCut.enabled ? "LC in" : "LC out";
  return `${channel.eq.enabled ? "PEQ in" : "PEQ bypassed"} · ${lowCut} · ${channel.eq.bands.length} bands`;
}
