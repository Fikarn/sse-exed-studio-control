/**
 * Wire the audio workspace's global keyboard shortcuts.
 *
 * The plan listed this hook as "pure refactor" — extract the existing
 * `handleKeyDown` + the `useEffect` that wires it to `window.keydown`.
 * The signature is intentionally fat (17 caller-side dependencies) because
 * every shortcut routes back into a workspace-owned callback or piece of
 * state; this hook is the glue layer, not an abstraction over the
 * callbacks themselves.
 *
 * Drift note (closed): the prior session deferred this extraction because
 * the wide signature relocates code without abstracting it. That was a
 * judgement call against the plan — the plan does not condition extraction
 * on signature width. Slice 5C closes the drift by biting the wide
 * signature and documenting the dependency count here.
 */
import { useEffect, type RefObject } from "react";

import { isEditableTarget, type AudioChannelEntry } from "../../shellData";
import { useLiveCallback } from "../../shared/useLiveCallback";
import type { AudioWorkspaceViewModel } from "../audioViewModel";

type SelectableSource = { id: string; kind: "channel" | "output" };

interface UseAudioKeyboardShortcutsArgs {
  cancelArmedAction: () => boolean;
  clearClips: (channelId?: string) => void;
  contextMenu: unknown;
  inspectorTab: string;
  nextBank: () => void;
  orderedSelectableSources: SelectableSource[];
  previousBank: () => void;
  recallSnapshot: (snapshotId: string) => void;
  resetChannelFaderToUnity: (channelId: string, mixTargetId: string) => void;
  saveCurrentSnapshot: () => void;
  selectChannel: (channelId: string | null) => void;
  selectOutputMixTarget: (mixTargetId: string) => void;
  setContextMenu: (value: null) => void;
  setInspectorTab: (tab: "channel" | "eq" | "dynamics" | "sends") => void;
  syncAudio: () => void;
  updateChannel: (request: { channelId: string; mute?: boolean; solo?: boolean; phase?: boolean }) => void;
  viewModel: AudioWorkspaceViewModel | null;
  visibleSelectableChannels: AudioChannelEntry[];
  warningBandRef: RefObject<HTMLDivElement | null>;
}

export function useAudioKeyboardShortcuts({
  cancelArmedAction,
  clearClips,
  contextMenu,
  inspectorTab,
  nextBank,
  orderedSelectableSources,
  previousBank,
  recallSnapshot,
  resetChannelFaderToUnity,
  saveCurrentSnapshot,
  selectChannel,
  selectOutputMixTarget,
  setContextMenu,
  setInspectorTab,
  syncAudio,
  updateChannel,
  viewModel,
  visibleSelectableChannels,
  warningBandRef,
}: UseAudioKeyboardShortcutsArgs) {
  const handleKeyDown = useLiveCallback((event: KeyboardEvent) => {
    if (!viewModel || event.defaultPrevented) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Escape" && cancelArmedAction()) {
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Escape" && contextMenu) {
      setContextMenu(null);
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Escape") {
      if (inspectorTab !== "channel") {
        setInspectorTab("channel");
        event.preventDefault();
        return;
      }
      if (viewModel.selectedChannelId) {
        selectChannel(null);
        event.preventDefault();
      }
      return;
    }

    if (isEditableTarget(event.target)) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && event.altKey && event.key.toLowerCase() === "c") {
      clearClips();
      event.preventDefault();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "s") {
      saveCurrentSnapshot();
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "[") {
      previousBank();
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "]") {
      nextBank();
      event.preventDefault();
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && /^Digit[1-8]$/.test(event.code)) {
      const snapshot = viewModel.snapshots[Number(event.code.replace("Digit", "")) - 1];
      if (snapshot) {
        recallSnapshot(snapshot.id);
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && /^Digit[1-8]$/.test(event.code)) {
      const channel = visibleSelectableChannels[Number(event.code.replace("Digit", "")) - 1];
      if (channel) {
        selectChannel(channel.id);
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "m") {
      if (viewModel.selectedChannel) {
        updateChannel({
          channelId: viewModel.selectedChannel.id,
          mute: !viewModel.selectedChannel.mute,
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "s") {
      if (viewModel.selectedChannel) {
        updateChannel({
          channelId: viewModel.selectedChannel.id,
          solo: !viewModel.selectedChannel.solo,
        });
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === "u") {
      if (viewModel.selectedChannel && viewModel.selectedMixTargetId) {
        resetChannelFaderToUnity(viewModel.selectedChannel.id, viewModel.selectedMixTargetId);
        event.preventDefault();
      }
      return;
    }

    if (
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      if (orderedSelectableSources.length > 0) {
        const currentIndex = orderedSelectableSources.findIndex((entry) =>
          viewModel.selectedChannelId
            ? entry.kind === "channel" && entry.id === viewModel.selectedChannelId
            : entry.kind === "output" && entry.id === viewModel.selectedMixTargetId
        );
        const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
        const nextIndex =
          currentIndex < 0
            ? direction > 0
              ? 0
              : orderedSelectableSources.length - 1
            : Math.max(0, Math.min(orderedSelectableSources.length - 1, currentIndex + direction));
        const nextSource = orderedSelectableSources[nextIndex];
        if (nextSource?.kind === "channel") {
          selectChannel(nextSource.id);
        } else if (nextSource?.kind === "output") {
          selectOutputMixTarget(nextSource.id);
        }
        event.preventDefault();
      }
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "Enter") {
      if (
        warningBandRef.current &&
        document.activeElement === warningBandRef.current &&
        viewModel.capabilities.canSync
      ) {
        syncAudio();
        event.preventDefault();
      }
      return;
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
