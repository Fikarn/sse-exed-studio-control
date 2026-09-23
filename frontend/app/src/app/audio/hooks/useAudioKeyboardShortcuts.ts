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
import { useEffect } from "react";

import { isEditableTarget, type AudioChannelEntry } from "../../shellData";
import { useLiveCallback } from "../../shared/useLiveCallback";
import type { AudioWorkspaceViewModel } from "../audioViewModel";
import { PLATE_SECTION_KEYS, type PlateSection } from "../components/inspector/audioInspectorHelpers";

type SelectableSource = { id: string; kind: "channel" | "output" };

interface UseAudioKeyboardShortcutsArgs {
  cancelArmedAction: () => boolean;
  clearAllSolo: () => void;
  clearClips: (channelId?: string) => void;
  contextMenu: unknown;
  nextBank: () => void;
  orderedSelectableSources: SelectableSource[];
  previousBank: () => void;
  recallSnapshot: (snapshotId: string) => void;
  resetChannelFaderToUnity: (channelId: string, mixTargetId: string) => void;
  saveCurrentSnapshot: () => void;
  selectChannel: (channelId: string | null) => void;
  selectOutputMixTarget: (mixTargetId: string) => void;
  setContextMenu: (value: null) => void;
  revealPlateSection: (section: PlateSection) => void;
  updateChannel: (request: { channelId: string; mute?: boolean; solo?: boolean; phase?: boolean }) => void;
  viewModel: AudioWorkspaceViewModel | null;
  visibleSelectableChannels: AudioChannelEntry[];
}

export function useAudioKeyboardShortcuts({
  cancelArmedAction,
  clearAllSolo,
  clearClips,
  contextMenu,
  nextBank,
  orderedSelectableSources,
  previousBank,
  recallSnapshot,
  resetChannelFaderToUnity,
  saveCurrentSnapshot,
  selectChannel,
  selectOutputMixTarget,
  setContextMenu,
  revealPlateSection,
  updateChannel,
  viewModel,
  visibleSelectableChannels,
}: UseAudioKeyboardShortcutsArgs) {
  const handleKeyDown = useLiveCallback((event: KeyboardEvent) => {
    if (!viewModel || event.defaultPrevented) return;
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;
    const cmdOrCtrl = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (plain && event.key === "Escape" && cancelArmedAction()) {
      event.preventDefault();
      return;
    }
    if (plain && event.key === "Escape" && contextMenu) {
      setContextMenu(null);
      event.preventDefault();
      return;
    }
    if (plain && event.key === "Escape") {
      // Visual overhaul A, Slice 4c: the plate has no tabs to back out of, so
      // Escape goes straight to letting the strip go.
      if (viewModel.selectedChannelId) {
        selectChannel(null);
        event.preventDefault();
      }
      return;
    }

    if (isEditableTarget(event.target)) return;

    // Plate accelerators. Only meaningful when a channel is selected — an
    // output-only selection shows the output's own section, so the keys stay
    // inert there. P/Q → Preamp, E → EQ, D → Dynamics, R → Sends; the plate
    // brings the section into view. No overlap with m/s/u.
    if (plain && viewModel.selectedChannel) {
      const section = PLATE_SECTION_KEYS[key];
      if (section) {
        revealPlateSection(section);
        event.preventDefault();
        return;
      }
    }

    if (!event.metaKey && !event.ctrlKey && event.altKey && key === "c") {
      clearClips();
      event.preventDefault();
      return;
    }
    if (!event.metaKey && !event.ctrlKey && event.altKey && key === "s") {
      if (viewModel.healthStats.soloedChannels > 0) {
        clearAllSolo();
        event.preventDefault();
      }
      return;
    }
    if (cmdOrCtrl && !event.altKey && key === "s") {
      // A held key auto-repeats; a repeat is never the confirming press of an
      // armed action (2026-09 audit Slice 7 — the dwell in useAudioArming is
      // the second guard).
      if (!event.repeat) saveCurrentSnapshot();
      event.preventDefault();
      return;
    }
    if (plain && event.key === "[") {
      previousBank();
      event.preventDefault();
      return;
    }
    if (plain && event.key === "]") {
      nextBank();
      event.preventDefault();
      return;
    }
    if (plain && event.shiftKey && /^Digit[1-8]$/.test(event.code)) {
      const snapshot = viewModel.snapshots[Number(event.code.replace("Digit", "")) - 1];
      if (snapshot) {
        // Key repeat arms once and never confirms (2026-09 audit Slice 7).
        if (!event.repeat) recallSnapshot(snapshot.id);
        event.preventDefault();
      }
      return;
    }
    if (plain && /^Digit[1-8]$/.test(event.code)) {
      const channel = visibleSelectableChannels[Number(event.code.replace("Digit", "")) - 1];
      if (channel) {
        selectChannel(channel.id);
        event.preventDefault();
      }
      return;
    }
    if (plain && key === "m" && viewModel.selectedChannel) {
      updateChannel({ channelId: viewModel.selectedChannel.id, mute: !viewModel.selectedChannel.mute });
      event.preventDefault();
      return;
    }
    if (plain && key === "s" && viewModel.selectedChannel) {
      updateChannel({ channelId: viewModel.selectedChannel.id, solo: !viewModel.selectedChannel.solo });
      event.preventDefault();
      return;
    }
    if (plain && key === "u" && viewModel.selectedChannel && viewModel.selectedMixTargetId) {
      resetChannelFaderToUnity(viewModel.selectedChannel.id, viewModel.selectedMixTargetId);
      event.preventDefault();
      return;
    }
    if (plain && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
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
        if (nextSource?.kind === "channel") selectChannel(nextSource.id);
        else if (nextSource?.kind === "output") selectOutputMixTarget(nextSource.id);
        event.preventDefault();
      }
      return;
    }
    // Visual overhaul A, Slice 4: the state display's way-out key is a real
    // key, so Enter on it syncs natively; the focused-warning-band shortcut
    // this replaced had no target once the band went.
  });

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}
