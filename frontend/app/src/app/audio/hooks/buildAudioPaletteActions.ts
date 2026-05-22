/**
 * Pure builder that produces the array of `PaletteAction` entries the audio
 * workspace registers with the command palette. Extracted from
 * `useAudioPaletteRegistration` so the hook stays under the ≤ 200-line
 * budget and the action shapes are testable without React.
 *
 * Why a pure function: there is no React state here — every action closes
 * over callbacks the workspace passes in, plus the palette-registration
 * model snapshot. Same lifetime as the registration effect itself, but
 * sidestepping React lets the file count against helper budgets instead
 * of hook budgets.
 */
import type { PaletteAction } from "@sse/design-system";

import { AUDIO_FADER_UNITY } from "../audioFormatting";
import type { AudioPaletteRegistrationModel } from "./useAudioPaletteRegistration";
import type { AudioChannelGroupSelectionRequest } from "../audioViewModel";

export interface BuildAudioPaletteActionsArgs {
  captureSnapshot: () => void;
  clearAllSolo: () => void;
  clearClips: (channelId?: string) => void;
  model: AudioPaletteRegistrationModel;
  nextBank: () => void;
  previousBank: () => void;
  recallSnapshot: (snapshotId: string) => void;
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
}

export function buildAudioPaletteActions(args: BuildAudioPaletteActionsArgs): PaletteAction[] {
  const {
    captureSnapshot,
    clearAllSolo,
    clearClips,
    model,
    nextBank,
    previousBank,
    recallSnapshot,
    renameChannel,
    resetPeakHolds,
    saveCurrentSnapshot,
    selectChannel,
    selectOutputMixTarget,
    syncAudio,
    togglePeakHold,
    updateChannel,
  } = args;

  const {
    allSelectableChannels: paletteChannels,
    mixTargets: paletteMixTargets,
    selectedChannel: paletteSelectedChannel,
    selectedMixTargetId: paletteSelectedMixTargetId,
    selectedSnapshot: paletteSelectedSnapshot,
    snapshots: paletteSnapshots,
  } = model;

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

  return [...channelActions, ...outputActions, ...snapshotActions, ...actionActions];
}
