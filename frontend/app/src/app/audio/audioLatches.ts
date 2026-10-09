import type { AudioWorkspaceViewModel } from "./audioViewModel";

// The Console's way out of its state and its latches, as words the pages
// draw (2026-10-09, the Overview, D47). The Console's cluster drew them
// inline; the Overview shows the same latches in its own latch slot and the
// same way out in its status card, so they live here, pure, for both. The
// pages keep their own keys and test ids.

/** The way out of the state the hardware link reports, by its word. */
export type AudioWayOut = "probe" | "sync" | "setup" | "failed";

export function audioWayOut(label: string): AudioWayOut | null {
  switch (label) {
    case "NOT VERIFIED":
    case "STALE":
    case "OFFLINE":
    case "DISCONNECTED":
      return "probe";
    case "ASSUMED":
    case "SYNC NEEDED":
      return "sync";
    case "DISABLED":
      return "setup";
    case "ACTION FAILED":
      // ACTION FAILED clears when the next action succeeds, so the way out is
      // the action itself: a Sync.
      return "failed";
    default:
      return null;
  }
}

/** Why a key the desk refuses is locked, in the desk's own words. */
export function audioDeskLockReason(status: AudioWorkspaceViewModel["status"]): string {
  return status.warningBody ?? `The desk is ${status.label}.`;
}

export interface AudioLatchView {
  id: "solo" | "clip";
  /** The latch's word: `Solo`, `Clip`. */
  who: "Solo" | "Clip";
  /** What it holds, as the Console says it: `1 on FX 3/4`, `1 over 0 dBFS`. */
  text: string;
  /** The strips it holds, by their TotalMix names. */
  names: string[];
  /** The key that clears it. */
  clear: {
    label: "Clear all" | "Clear";
    ariaLabel: string;
    /** Refused by the desk: the key is locked, with the reason in reach. */
    locked: boolean;
    reason: string;
  };
}

/**
 * The Console's latches, Solo first, then a held clip. A hidden strip's solo
 * counts, as the Console counts it (its Clear all leaves a hidden strip, D45).
 */
export function audioLatches(
  viewModel: Pick<
    AudioWorkspaceViewModel,
    "actionsAllowed" | "capabilities" | "clippedChannels" | "soloedChannels" | "status"
  >
): AudioLatchView[] {
  const latches: AudioLatchView[] = [];
  const soloed = viewModel.soloedChannels.map((channel) => channel.name);
  if (soloed.length > 0) {
    latches.push({
      id: "solo",
      who: "Solo",
      text: `${soloed.length} on ${soloed.join(", ")}`,
      names: soloed,
      clear: {
        label: "Clear all",
        ariaLabel: "Clear all solo",
        locked: !viewModel.actionsAllowed,
        reason: audioDeskLockReason(viewModel.status),
      },
    });
  }
  const clipped = viewModel.clippedChannels.map((channel) => channel.name);
  if (clipped.length > 0) {
    latches.push({
      id: "clip",
      who: "Clip",
      text: `${clipped.length} over 0 dBFS`,
      names: clipped,
      clear: {
        label: "Clear",
        ariaLabel: "Clear clips",
        locked: !viewModel.capabilities.canClearClips,
        reason: "OSC control is off",
      },
    });
  }
  return latches;
}
