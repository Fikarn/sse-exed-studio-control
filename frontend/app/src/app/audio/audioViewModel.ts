import type { AudioSnapshot } from "@sse/engine-client";

import {
  getAudioChannels,
  getAudioMixTargets,
  getAudioSnapshots,
  type AudioChannelEntry,
  type AudioMixTargetEntry,
  type AudioSnapshotEntry,
  type SnapshotRecord,
} from "../shellData";
import { describeAudioStatus, formatAudioDb, type AudioDensityMode } from "./audioFormatting";

export type AudioTierId = "hardware-inputs" | "software-playback" | "hardware-outputs";
export type AudioGroupTierId = Extract<AudioTierId, "hardware-inputs" | "software-playback">;
export type AudioChannelGroup = "talent" | "line" | "bed" | "fx" | "remote";
export type AudioChannelGroupSelections = Record<AudioGroupTierId, AudioChannelGroup[]>;

export interface AudioChannelGroupSelectionRequest {
  group: AudioChannelGroup;
  mode: "single" | "toggle" | "invert";
  tierId: AudioGroupTierId;
}

export interface AudioTierViewModel {
  channels: AudioChannelEntry[];
  chips: Array<{ id: AudioChannelGroup; label: string; active?: boolean; testId: string }>;
  id: AudioTierId;
  label: string;
  meta: string;
  shortLabel: string;
  testId: string;
}

export interface AudioOutputTierViewModel {
  id: "hardware-outputs";
  label: string;
  mixTargets: AudioMixTargetEntry[];
  shortLabel: string;
  testId: string;
}

export interface AudioWorkspaceViewModel {
  activeMixReadout: {
    db: string;
    lufs: string;
    meterLeft: number;
    meterRight: number;
  };
  actionsAllowed: boolean;
  activeChannelGroups: AudioChannelGroupSelections;
  appSummary: string;
  audioSnapshot: AudioSnapshot;
  bankStart: number;
  capabilities: AudioSnapshot["capabilities"];
  channels: AudioChannelEntry[];
  clampedBankIndex: number;
  clippedChannels: AudioChannelEntry[];
  density: AudioDensityMode;
  fadersPerBank: number;
  feedingChannelIds: string[];
  footerTelemetry: {
    clock: string;
    endpoint: string;
    lastSync: string;
    metering: string;
    osc: string;
  };
  healthStats: {
    clippedChannels: number;
    mutedChannels: number;
    soloedChannels: number;
    activeSends: number;
  };
  hardwareInputs: AudioTierViewModel;
  hardwareInputBankSize: number;
  mixTargets: AudioMixTargetEntry[];
  meterSimulationActive: boolean;
  meterSimulationDetail: string;
  meterSimulationLabel: string;
  outputAccent: string;
  selectedChannel: AudioChannelEntry | null;
  selectedChannelId: string | null;
  selectedMixTarget: AudioMixTargetEntry | null;
  selectedMixTargetId: string | null;
  selectedSourceGroup: AudioChannelGroup | "output" | "none";
  selectedSourceLabel: string;
  selectedSourceMeta: string;
  selectedSourceTier: "inputs" | "playback" | "outputs" | "none";
  selectedSnapshot: AudioSnapshotEntry | null;
  silentChannelIds: string[];
  soloedChannel: AudioChannelEntry | null;
  snapshots: AudioSnapshotEntry[];
  softwarePlayback: AudioTierViewModel;
  softwarePlaybackBankSize: number;
  hardwareOutputs: AudioOutputTierViewModel;
  sourceTiers: AudioTierViewModel[];
  status: ReturnType<typeof describeAudioStatus>;
  totalBanks: number;
  unsupportedFeatures: {
    clipReset: boolean;
    dynamics: boolean;
    eq: boolean;
    masterView: boolean;
    pfl: boolean;
    prePostSend: boolean;
    snapshotCapture: boolean;
    soloSend: boolean;
  };
  visibleStripCount: number;
  viewMode: "submix" | "master";
}

const AUDIO_GROUP_LABELS: Record<AudioChannelGroup, string> = {
  bed: "Bed",
  fx: "FX",
  line: "Line",
  remote: "Remote",
  talent: "Talent",
};

const AUDIO_GROUP_ORDER: AudioChannelGroup[] = ["talent", "line", "bed", "fx", "remote"];

const OUTPUT_ACCENTS: Record<string, string> = {
  "main-out": "#5dc5e8",
  "phones-a": "#e8a341",
  "phones-b": "#b388f5",
};

function outputAccentForRole(role: string | null | undefined) {
  return role ? (OUTPUT_ACCENTS[role] ?? "#5dc5e8") : "#5dc5e8";
}

export function audioChannelSupportsGain(channel: AudioChannelEntry | null) {
  return channel?.role === "front-preamp";
}

export function audioChannelSupportsPhantom(channel: AudioChannelEntry | null) {
  return channel?.role === "front-preamp";
}

export function audioChannelSupportsPad(channel: AudioChannelEntry | null) {
  const _ = channel;
  return false;
}

export function audioChannelSupportsInstrument(channel: AudioChannelEntry | null) {
  return channel?.role === "front-preamp";
}

export function audioChannelSupportsAutoSet(channel: AudioChannelEntry | null) {
  return channel?.role === "front-preamp";
}

export function audioChannelSupportsPhase(channel: AudioChannelEntry | null) {
  return Boolean(channel && channel.role !== "playback-pair");
}

export function getChannelTierId(channel: AudioChannelEntry): AudioTierId {
  return channel.role === "playback-pair" ? "software-playback" : "hardware-inputs";
}

export function getAudioChannelGroup(channel: AudioChannelEntry): AudioChannelGroup {
  if (channel.role === "front-preamp") {
    return "talent";
  }

  if (channel.role !== "playback-pair") {
    return channel.name.toLowerCase().includes("remote") ? "remote" : "line";
  }

  const channelLabel = `${channel.name} ${channel.shortName}`.toLowerCase();
  if (channelLabel.includes("fx")) {
    return "fx";
  }
  if (channelLabel.includes("program") || channelLabel.includes("music")) {
    return "bed";
  }
  return "remote";
}

export function selectedChannelSendLevel(channel: AudioChannelEntry | null, mixTargetId: string | null) {
  if (!channel || !mixTargetId) {
    return 0;
  }

  return typeof channel.mixLevels[mixTargetId] === "number" ? channel.mixLevels[mixTargetId] : channel.fader;
}

function selectedSourceTier(
  channel: AudioChannelEntry | null,
  selectedMixTarget: AudioMixTargetEntry | null
): AudioWorkspaceViewModel["selectedSourceTier"] {
  if (!channel) return selectedMixTarget ? "outputs" : "none";
  return channel.role === "playback-pair" ? "playback" : "inputs";
}

function selectedSourceMeta(
  channel: AudioChannelEntry | null,
  selectedMixTarget: AudioMixTargetEntry | null,
  selectedMixTargetId: string | null
) {
  if (!channel) return selectedMixTarget ? `Selected output · ${selectedMixTarget.name}` : "No source selected";
  const targetName = selectedMixTarget?.name ?? "selected output";
  const sendLevel = selectedChannelSendLevel(channel, selectedMixTargetId);
  const tier =
    channel.role === "playback-pair" ? "Playback bus" : channel.role === "front-preamp" ? "Mic preamp" : "Line input";
  return `${tier} · ${channel.stereo ? "stereo" : "mono"} · ${sendLevel <= 0 ? "no send" : `routed to ${targetName}`}`;
}

function footerEndpoint(snapshot: AudioSnapshot) {
  const host = typeof snapshot.sendHost === "string" && snapshot.sendHost.trim() ? snapshot.sendHost : "n/a";
  const receive = typeof snapshot.receivePort === "number" ? snapshot.receivePort : null;
  const send = typeof snapshot.sendPort === "number" ? snapshot.sendPort : null;
  if (receive === null && send === null) return host;
  if (receive === null) return `${host} · ${send}`;
  if (send === null) return `${host} · ${receive}`;
  return `${host} · ${receive}/${send}`;
}

function usesSimulatedMetering(snapshot: AudioSnapshot) {
  const adapterMode = String(snapshot.adapterMode ?? "").toLowerCase();
  return adapterMode.includes("simulated") || adapterMode === "fixture";
}

export function isChannelFeedingMixTarget(channel: AudioChannelEntry, mixTargetId: string | null) {
  if (channel.mute || !mixTargetId) return false;
  return selectedChannelSendLevel(channel, mixTargetId) >= 0.01;
}

function bankChannels(channels: AudioChannelEntry[], bankIndex: number, visibleStripCount: number) {
  const bankStart = bankIndex * visibleStripCount;
  return channels.slice(bankStart, bankStart + visibleStripCount);
}

function filterChannelsByGroups(channels: AudioChannelEntry[], activeGroups: readonly AudioChannelGroup[]) {
  if (activeGroups.length === 0) {
    return channels;
  }
  const active = new Set(activeGroups);
  return channels.filter((channel) => active.has(getAudioChannelGroup(channel)));
}

function orderedGroupsForChannels(channels: AudioChannelEntry[]) {
  const present = new Set(channels.map((entry) => getAudioChannelGroup(entry)));
  return AUDIO_GROUP_ORDER.filter((groupId) => present.has(groupId));
}

function activeGroupsForTier(
  activeChannelGroups: AudioChannelGroupSelections,
  tierId: AudioGroupTierId,
  availableGroups: readonly AudioChannelGroup[]
) {
  const available = new Set(availableGroups);
  return activeChannelGroups[tierId].filter((groupId) => available.has(groupId));
}

function audioCapabilities(snapshot: AudioSnapshot): AudioSnapshot["capabilities"] {
  return (
    snapshot.capabilities ?? {
      canEditMixerState: snapshot.oscEnabled === true,
      canSync: snapshot.oscEnabled === true,
      canRecallConsoleSnapshot:
        snapshot.oscEnabled === true && String(snapshot.status ?? "not-verified") === "ready",
      canEditProcessing: snapshot.oscEnabled === true,
      canClearClips: snapshot.oscEnabled === true,
      canCaptureSnapshot: snapshot.oscEnabled === true,
      canUseMasterView: snapshot.oscEnabled === true,
    }
  );
}

export function buildAudioViewModel({
  appSnapshot,
  audioSnapshot,
  bankIndex,
  density,
  activeChannelGroups,
}: {
  appSnapshot: SnapshotRecord | null;
  audioSnapshot: AudioSnapshot;
  bankIndex: number;
  density: AudioDensityMode;
  activeChannelGroups: AudioChannelGroupSelections;
}): AudioWorkspaceViewModel {
  const channels = getAudioChannels(audioSnapshot);
  const mixTargets = getAudioMixTargets(audioSnapshot);
  const snapshots = getAudioSnapshots(audioSnapshot);
  const status = describeAudioStatus(audioSnapshot);
  const capabilities = audioCapabilities(audioSnapshot);
  const viewMode = audioSnapshot.viewMode === "master" ? "master" : "submix";
  const selectedMixTargetId =
    typeof audioSnapshot.selectedMixTargetId === "string"
      ? audioSnapshot.selectedMixTargetId
      : (mixTargets[0]?.id ?? null);
  const selectedMixTarget = mixTargets.find((entry) => entry.id === selectedMixTargetId) ?? mixTargets[0] ?? null;
  const selectedChannelId =
    typeof audioSnapshot.selectedChannelId === "string" ? audioSnapshot.selectedChannelId : null;
  const selectedChannel = channels.find((entry) => entry.id === selectedChannelId) ?? null;
  const outputAccent = outputAccentForRole(selectedMixTarget?.role);
  const fadersPerBank = Math.max(
    1,
    Math.min(24, typeof audioSnapshot.fadersPerBank === "number" ? audioSnapshot.fadersPerBank : 12)
  );
  const visibleStripCount = Math.min(density === "desktop" ? 12 : 8, fadersPerBank);
  const hardwareInputBankSize = Math.min(density === "desktop" ? 4 : 8, fadersPerBank);
  const softwarePlaybackBankSize = density === "desktop" ? 6 : 4;
  const hardwareSourceChannels = channels.filter((entry) => entry.role !== "playback-pair");
  const softwarePlaybackSourceChannels = channels.filter((entry) => entry.role === "playback-pair");
  const hardwareInputGroups = orderedGroupsForChannels(hardwareSourceChannels);
  const softwarePlaybackGroups = orderedGroupsForChannels(softwarePlaybackSourceChannels);
  const activeHardwareInputGroups = activeGroupsForTier(
    activeChannelGroups,
    "hardware-inputs",
    hardwareInputGroups
  );
  const activeSoftwarePlaybackGroups = activeGroupsForTier(
    activeChannelGroups,
    "software-playback",
    softwarePlaybackGroups
  );
  const hardwareInputChannels = filterChannelsByGroups(hardwareSourceChannels, activeHardwareInputGroups);
  const softwarePlaybackChannels = filterChannelsByGroups(
    softwarePlaybackSourceChannels,
    activeSoftwarePlaybackGroups
  );
  const totalBanks = Math.max(
    1,
    Math.ceil(hardwareInputChannels.length / hardwareInputBankSize),
    Math.ceil(softwarePlaybackChannels.length / softwarePlaybackBankSize)
  );
  const clampedBankIndex = Math.min(Math.max(0, bankIndex), totalBanks - 1);
  const bankStart = clampedBankIndex * hardwareInputBankSize;
  const selectedSnapshot =
    snapshots.find((entry) => entry.id === audioSnapshot.lastRecalledSnapshotId) ??
    snapshots.find((entry) => entry.lastRecalled) ??
    null;
  const feedingChannelIds = channels
    .filter((entry) => isChannelFeedingMixTarget(entry, selectedMixTargetId))
    .map((entry) => entry.id);
  const silentChannelIds = channels
    .filter((entry) => !isChannelFeedingMixTarget(entry, selectedMixTargetId) && !entry.mute)
    .map((entry) => entry.id);

  const visibleHardwareInputs = bankChannels(hardwareInputChannels, clampedBankIndex, hardwareInputBankSize);
  const visibleSoftwarePlayback = bankChannels(softwarePlaybackChannels, clampedBankIndex, softwarePlaybackBankSize);
  const clippedChannels = channels.filter((entry) => entry.clip);
  const soloedChannel = channels.find((entry) => entry.solo) ?? null;
  const selectedGroup = selectedChannel ? getAudioChannelGroup(selectedChannel) : selectedMixTarget ? "output" : "none";
  const selectedTier = selectedSourceTier(selectedChannel, selectedMixTarget);
  const meterSimulationActive = usesSimulatedMetering(audioSnapshot);
  const meterSimulationLabel = "TEST METER SIMULATION";
  const meterSimulationDetail = "Test meter simulation · not hardware";

  const hardwareInputs: AudioTierViewModel = {
    channels: visibleHardwareInputs,
    chips: hardwareInputGroups.map((groupId) => ({
      active: activeHardwareInputGroups.includes(groupId),
      id: groupId,
      label: AUDIO_GROUP_LABELS[groupId],
      testId: `audio-tier-chip-inputs-${groupId}`,
    })),
    id: "hardware-inputs",
    label: "Inputs",
    meta: `${visibleHardwareInputs.length} ch · UFX III preamps · 24-bit / 48 kHz`,
    shortLabel: "Inputs",
    testId: "audio-hardware-inputs-tier",
  };
  const softwarePlayback: AudioTierViewModel = {
    channels: visibleSoftwarePlayback,
    chips: softwarePlaybackGroups.map((groupId) => ({
      active: activeSoftwarePlaybackGroups.includes(groupId),
      id: groupId,
      label: AUDIO_GROUP_LABELS[groupId],
      testId: `audio-tier-chip-playback-${groupId}`,
    })),
    id: "software-playback",
    label: "Playback",
    meta: `${visibleSoftwarePlayback.length} ch · post · stereo pairs`,
    shortLabel: "Playback",
    testId: "audio-software-playback-tier",
  };

  return {
    activeMixReadout: {
      db: formatAudioDb(selectedMixTarget?.volume ?? 0),
      lufs: "n/a",
      meterLeft: selectedMixTarget?.volume ?? 0,
      meterRight: (selectedMixTarget?.volume ?? 0) * 0.94,
    },
    actionsAllowed: capabilities.canEditMixerState,
    activeChannelGroups: {
      "hardware-inputs": activeHardwareInputGroups,
      "software-playback": activeSoftwarePlaybackGroups,
    },
    appSummary: String(appSnapshot?.summary ?? audioSnapshot.summary ?? "Audio desk active."),
    audioSnapshot,
    bankStart,
    capabilities,
    channels,
    clampedBankIndex,
    clippedChannels,
    density,
    fadersPerBank,
    feedingChannelIds,
    footerTelemetry: {
      clock: "clock n/a · sr n/a",
      endpoint: footerEndpoint(audioSnapshot),
      lastSync: audioSnapshot.lastConsoleSyncAt ?? "not yet",
      metering: meterSimulationActive
        ? meterSimulationDetail
        : `${String(audioSnapshot.meteringState ?? "unknown")} · ${
            audioSnapshot.expectedPeakData ? "peak expected" : "peak n/a"
          }`,
      osc: audioSnapshot.oscEnabled ? "enabled" : "disabled",
    },
    hardwareInputs,
    hardwareInputBankSize,
    hardwareOutputs: {
      id: "hardware-outputs",
      label: "Outputs",
      mixTargets,
      shortLabel: "Outputs",
      testId: "audio-hardware-outputs-tier",
    },
    healthStats: {
      activeSends: channels.filter((entry) => selectedChannelSendLevel(entry, selectedMixTargetId) > 0.01).length,
      clippedChannels: clippedChannels.length,
      mutedChannels: channels.filter((entry) => entry.mute).length,
      soloedChannels: channels.filter((entry) => entry.solo).length,
    },
    mixTargets,
    meterSimulationActive,
    meterSimulationDetail,
    meterSimulationLabel,
    outputAccent,
    selectedChannel,
    selectedChannelId,
    selectedMixTarget,
    selectedMixTargetId,
    selectedSourceGroup: selectedGroup,
    selectedSourceLabel: selectedChannel?.name ?? selectedMixTarget?.name ?? "No source",
    selectedSourceMeta: selectedSourceMeta(selectedChannel, selectedMixTarget, selectedMixTargetId),
    selectedSourceTier: selectedTier,
    selectedSnapshot,
    silentChannelIds,
    soloedChannel,
    snapshots,
    softwarePlayback,
    softwarePlaybackBankSize,
    sourceTiers: [hardwareInputs, softwarePlayback],
    status,
    totalBanks,
    unsupportedFeatures: {
      clipReset: !capabilities.canClearClips,
      dynamics: !capabilities.canEditProcessing,
      eq: !capabilities.canEditProcessing,
      masterView: !capabilities.canUseMasterView,
      pfl: true,
      prePostSend: false,
      snapshotCapture: !capabilities.canCaptureSnapshot,
      soloSend: false,
    },
    visibleStripCount,
    viewMode,
  };
}
