/**
 * Pure helpers, constants, and type aliases shared by the audio inspector
 * surfaces (Overview, Sends, Output mode).
 *
 * Everything here is stateless and side-effect free — no React, no DOM
 * dependencies — so future inspector sub-files can import freely without
 * pulling extra component context with them.
 */
import type { ShellStore } from "@sse/engine-client";

import { formatAudioRole } from "../../audioFormatting";
import type { AudioWorkspaceViewModel } from "../../audioViewModel";

export type AudioChannelUpdate = Parameters<ShellStore["updateAudioChannel"]>[0];
export type AudioMixTargetUpdate = Parameters<ShellStore["updateAudioMixTarget"]>[0];
export type SelectedAudioChannel = NonNullable<AudioWorkspaceViewModel["selectedChannel"]>;

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
