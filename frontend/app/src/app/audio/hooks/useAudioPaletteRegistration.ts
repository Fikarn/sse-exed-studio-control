/**
 * Register audio actions with the command palette.
 *
 * Owns both the palette-registration model derivation (signature-keyed ref
 * so the palette effect doesn't churn on every meter frame) AND the
 * registration effect itself. The signature is intentionally fat (17
 * caller-side dependencies + a viewModel + a registration callback)
 * because every palette action routes back into a workspace-owned
 * callback; this hook is the glue layer, not an abstraction over the
 * callbacks themselves.
 *
 * Drift note (closed): the prior session deferred this extraction because
 * the wide signature relocates code without abstracting it. Slice 5C
 * closes the drift by biting the wide signature and documenting the
 * dependency count here.
 */
import { useEffect, useMemo, useRef } from "react";

import type { PaletteAction } from "@sse/design-system";

import { AUDIO_FADER_UNITY } from "../audioFormatting";
import {
  buildAudioPaletteRegistrationSignature,
  type AudioChannelGroupSelectionRequest,
  type AudioWorkspaceViewModel,
} from "../audioViewModel";
import type { AudioChannelEntry } from "../../shellData";

export interface AudioPaletteRegistrationModel {
  allSelectableChannels: AudioChannelEntry[];
  mixTargets: AudioWorkspaceViewModel["mixTargets"];
  selectedChannel: AudioWorkspaceViewModel["selectedChannel"];
  selectedMixTargetId: AudioWorkspaceViewModel["selectedMixTargetId"];
  selectedSnapshot: AudioWorkspaceViewModel["selectedSnapshot"];
  snapshots: AudioWorkspaceViewModel["snapshots"];
}

interface UseAudioPaletteRegistrationArgs {
  captureSnapshot: () => void;
  clearAllSolo: () => void;
  clearClips: (channelId?: string) => void;
  nextBank: () => void;
  previousBank: () => void;
  recallSnapshot: (snapshotId: string) => void;
  register: (actions: PaletteAction[]) => () => void;
  renameChannel: (channelId: string, currentName: string) => void;
  resetPeakHolds: () => void;
  saveCurrentSnapshot: () => void;
  selectChannel: (channelId: string | null, options?: { groupSelection?: AudioChannelGroupSelectionRequest }) => void;
  selectOutputMixTarget: (mixTargetId: string) => void;
  syncAudio: () => void;
  togglePeakHold: () => void;
  updateChannel: (request: {
    channelId: string;
    fader?: number;
    mute?: boolean;
    solo?: boolean;
    phase?: boolean;
    mixTargetId?: string;
  }) => void;
  viewModel: AudioWorkspaceViewModel | null;
}

/**
 * Returns the palette-registration model alongside subscribing to the
 * palette. The model is exposed so the caller (AudioWorkspace) can pass
 * it through to any consumer that needs the same memoised view (none
 * today, but stable identity is useful for the render-budget tests).
 */
export function useAudioPaletteRegistration({
  captureSnapshot,
  clearAllSolo,
  clearClips,
  nextBank,
  previousBank,
  recallSnapshot,
  register,
  renameChannel,
  resetPeakHolds,
  saveCurrentSnapshot,
  selectChannel,
  selectOutputMixTarget,
  syncAudio,
  togglePeakHold,
  updateChannel,
  viewModel,
}: UseAudioPaletteRegistrationArgs): AudioPaletteRegistrationModel | null {
  const allSelectableChannels = useMemo(() => {
    if (!viewModel) return [];
    return [
      ...viewModel.channels.filter((channel) => channel.role !== "playback-pair"),
      ...viewModel.channels.filter((channel) => channel.role === "playback-pair"),
    ];
  }, [viewModel]);

  const paletteRegistrationSignature = viewModel
    ? buildAudioPaletteRegistrationSignature(viewModel, allSelectableChannels)
    : "";
  const paletteRegistrationRef = useRef<{
    model: AudioPaletteRegistrationModel | null;
    signature: string;
  }>({ model: null, signature: "" });
  if (paletteRegistrationRef.current.signature !== paletteRegistrationSignature) {
    paletteRegistrationRef.current = {
      model: viewModel
        ? {
            allSelectableChannels,
            mixTargets: viewModel.mixTargets,
            selectedChannel: viewModel.selectedChannel,
            selectedMixTargetId: viewModel.selectedMixTargetId,
            selectedSnapshot: viewModel.selectedSnapshot,
            snapshots: viewModel.snapshots,
          }
        : null,
      signature: paletteRegistrationSignature,
    };
  }
  const paletteRegistrationModel = paletteRegistrationRef.current.model;

  useEffect(() => {
    if (!paletteRegistrationModel) return;
    const {
      allSelectableChannels: paletteChannels,
      mixTargets: paletteMixTargets,
      selectedChannel: paletteSelectedChannel,
      selectedMixTargetId: paletteSelectedMixTargetId,
      selectedSnapshot: paletteSelectedSnapshot,
      snapshots: paletteSnapshots,
    } = paletteRegistrationModel;

    const channelActions: PaletteAction[] = paletteChannels.map((channel, index) => ({
      id: `audio:channel:${channel.id}`,
      label: `Select ${channel.name}`,
      group: "Channels",
      keywords: ["audio", "channel", "source", channel.name, channel.shortName, channel.role],
      shortcut: index < 8 ? `${index + 1}` : undefined,
      action: () => selectChannel(channel.id),
    }));

    const outputActions: PaletteAction[] = paletteMixTargets.map((mixTarget) => ({
      id: `audio:mix-target:${mixTarget.id}`,
      label: `Switch active mix to ${mixTarget.name}`,
      group: "Outputs",
      keywords: ["audio", "mix", "target", "submix", "output", mixTarget.name, mixTarget.shortName, mixTarget.role],
      action: () => selectOutputMixTarget(mixTarget.id),
    }));

    const snapshotActions: PaletteAction[] = paletteSnapshots.slice(0, 8).map((snapshot, index) => ({
      id: `audio:snapshot:${snapshot.id}`,
      label: `Recall snapshot ${index + 1}`,
      group: "Snapshots",
      keywords: ["audio", "snapshot", "recall", snapshot.name, `${index + 1}`],
      shortcut: `⇧${index + 1}`,
      action: () => recallSnapshot(snapshot.id),
    }));

    const actionActions: PaletteAction[] = [
      {
        id: "audio:sync",
        label: "Sync console",
        group: "Actions",
        keywords: ["audio", "osc", "sync", "console"],
        action: syncAudio,
      },
      {
        id: "audio:bank:previous",
        label: "Previous bank",
        group: "Actions",
        keywords: ["audio", "mixer", "bank", "previous"],
        shortcut: "[",
        action: previousBank,
      },
      {
        id: "audio:bank:next",
        label: "Next bank",
        group: "Actions",
        keywords: ["audio", "mixer", "bank", "next"],
        shortcut: "]",
        action: nextBank,
      },
      {
        id: "audio:clear-selected-channel",
        label: "Clear selected channel",
        group: "Actions",
        keywords: ["audio", "selection", "clear", "esc"],
        shortcut: "Esc",
        action: () => selectChannel(null),
      },
      {
        id: "audio:clear-all-solo",
        label: "Clear all solo",
        group: "Actions",
        keywords: ["audio", "solo", "clear"],
        action: clearAllSolo,
      },
      {
        id: "audio:clear-clips",
        label: "Clear clips",
        group: "Actions",
        keywords: ["audio", "clip", "clear", "reset"],
        shortcut: "⌥C",
        action: () => clearClips(),
      },
      {
        id: "audio:meters:toggle-peak-hold",
        label: "Toggle meter peak hold",
        group: "Actions",
        keywords: ["audio", "meter", "peak", "hold", "toggle"],
        action: togglePeakHold,
      },
      {
        id: "audio:meters:reset-peak-holds",
        label: "Reset meter peak holds",
        group: "Actions",
        keywords: ["audio", "meter", "peak", "hold", "reset"],
        action: resetPeakHolds,
      },
      {
        id: "audio:clear-selected-clip",
        label: "Clear selected channel clip",
        group: "Actions",
        keywords: [
          "audio",
          "clip",
          "clear",
          "selected",
          "clear selected channel clip",
          "clear selected audio clip",
          paletteSelectedChannel?.name ?? "",
        ],
        action: () => {
          if (paletteSelectedChannel) {
            clearClips(paletteSelectedChannel.id);
          }
        },
      },
      {
        id: "audio:rename-selected-channel",
        label: "Rename selected channel",
        group: "Actions",
        keywords: [
          "audio",
          "rename",
          "channel",
          "selected",
          "rename selected channel",
          "rename selected audio",
          paletteSelectedChannel?.name ?? "",
        ],
        action: () => {
          if (paletteSelectedChannel) {
            renameChannel(paletteSelectedChannel.id, paletteSelectedChannel.name);
          }
        },
      },
      {
        id: "audio:toggle-selected-polarity",
        label: "Toggle selected polarity",
        group: "Actions",
        keywords: [
          "audio",
          "phase",
          "polarity",
          "invert",
          "selected",
          "toggle selected polarity",
          "toggle selected audio polarity",
          paletteSelectedChannel?.name ?? "",
        ],
        action: () => {
          if (paletteSelectedChannel) {
            updateChannel({
              channelId: paletteSelectedChannel.id,
              phase: !paletteSelectedChannel.phase,
            });
          }
        },
      },
      {
        id: "audio:snapshot:capture",
        label: "Capture new snapshot",
        group: "Actions",
        keywords: ["audio", "snapshot", "capture", "new"],
        action: captureSnapshot,
      },
      {
        id: "audio:snapshot:save-current",
        label: "Save current snapshot",
        group: "Actions",
        keywords: ["audio", "snapshot", "save", paletteSelectedSnapshot?.name ?? ""],
        shortcut: "⌘S",
        action: saveCurrentSnapshot,
      },
      {
        id: "audio:reset-selected-fader",
        label: "Reset selected fader to unity",
        group: "Actions",
        keywords: [
          "audio",
          "reset",
          "selected",
          "fader",
          "unity",
          "reset selected fader",
          "reset selected audio",
          paletteSelectedChannel?.name ?? "",
        ],
        shortcut: "U",
        action: () => {
          if (paletteSelectedChannel && paletteSelectedMixTargetId) {
            updateChannel({
              channelId: paletteSelectedChannel.id,
              fader: AUDIO_FADER_UNITY,
              mixTargetId: paletteSelectedMixTargetId,
            });
          }
        },
      },
      ...paletteChannels.flatMap((channel): PaletteAction[] => [
        {
          id: `audio:solo:${channel.id}`,
          label: `Solo ${channel.name}`,
          group: "Actions",
          keywords: ["audio", "solo", channel.name, channel.shortName, channel.role],
          action: () => {
            updateChannel({
              channelId: channel.id,
              solo: !channel.solo,
            });
          },
        },
        {
          id: `audio:mute:${channel.id}`,
          label: `Mute ${channel.name}`,
          group: "Actions",
          keywords: ["audio", "mute", channel.name, channel.shortName, channel.role],
          action: () => {
            updateChannel({
              channelId: channel.id,
              mute: !channel.mute,
            });
          },
        },
      ]),
    ];
    const audioActions: PaletteAction[] = [...channelActions, ...outputActions, ...snapshotActions, ...actionActions];

    return register(audioActions);
  }, [
    clearAllSolo,
    clearClips,
    captureSnapshot,
    saveCurrentSnapshot,
    nextBank,
    previousBank,
    recallSnapshot,
    register,
    renameChannel,
    resetPeakHolds,
    selectChannel,
    selectOutputMixTarget,
    syncAudio,
    togglePeakHold,
    updateChannel,
    paletteRegistrationModel,
  ]);

  return paletteRegistrationModel;
}
