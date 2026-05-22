/**
 * Register audio actions with the command palette.
 *
 * Owns both the palette-registration model derivation (signature-keyed ref
 * so the palette effect doesn't churn on every meter frame) AND the
 * registration effect itself. Action definitions live in the pure
 * `buildAudioPaletteActions` helper so this hook stays under the ≤ 200
 * line plan budget.
 */
import { useEffect, useMemo, useRef } from "react";

import type { PaletteAction } from "@sse/design-system";

import {
  buildAudioPaletteRegistrationSignature,
  type AudioChannelGroupSelectionRequest,
  type AudioWorkspaceViewModel,
} from "../audioViewModel";
import type { AudioChannelEntry } from "../../shellData";
import { buildAudioPaletteActions } from "./buildAudioPaletteActions";

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
    const audioActions = buildAudioPaletteActions({
      captureSnapshot,
      clearAllSolo,
      clearClips,
      model: paletteRegistrationModel,
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
    });
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
