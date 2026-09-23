import { SNAPSHOT_PLACEHOLDER_LEVELS, SNAPSHOT_THUMB_BAR_COUNT } from "./audioConstants";
import type { AudioChannelEntry, AudioMixTargetEntry, AudioSnapshotEntry } from "../shellData";

// Visual overhaul A, Slice 4: the snapshot slot's mix-shape thumbnail and its
// "what changes if you load this" diff, lifted out of the retired snapshot
// deck so the A snapshot keys keep both. Pure functions over the engine's
// snapshot contents — no state of their own.

export { SNAPSHOT_PLACEHOLDER_LEVELS };

function clampSnapshotLevel(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function snapshotChannelLevel(
  channel: { fader: number; mixLevels: Record<string, number> },
  selectedMixTargetId: string | null
) {
  if (selectedMixTargetId && typeof channel.mixLevels[selectedMixTargetId] === "number") {
    return clampSnapshotLevel(channel.mixLevels[selectedMixTargetId]!);
  }
  return clampSnapshotLevel(channel.fader);
}

/** The bars of a slot's mix-shape thumbnail; null when the slot holds no mix. */
export function snapshotThumbLevels(snapshot: AudioSnapshotEntry, selectedMixTargetId: string | null) {
  const channels = snapshot.contents?.channels ? Object.values(snapshot.contents.channels) : [];
  if (!channels.length) return null;
  const levels = channels.map((channel) => snapshotChannelLevel(channel, selectedMixTargetId));
  return Array.from({ length: SNAPSHOT_THUMB_BAR_COUNT }, (_, barIndex) => {
    const sourceIndex = Math.min(levels.length - 1, Math.floor((barIndex / SNAPSHOT_THUMB_BAR_COUNT) * levels.length));
    return levels[sourceIndex] ?? 0;
  });
}

const SNAPSHOT_DIFF_SHOWN_LIMIT = 2;

export interface SnapshotDiffSummary {
  shown: Array<{ after: number; before: number; label: string }>;
  total: number;
}

export function snapshotPreviewDiffs({
  channels,
  mixTargets,
  selectedMixTargetId,
  snapshot,
}: {
  channels: readonly AudioChannelEntry[];
  mixTargets: readonly AudioMixTargetEntry[];
  selectedMixTargetId: string | null;
  snapshot: AudioSnapshotEntry;
}): SnapshotDiffSummary {
  if (!snapshot.contents) return { shown: [], total: 0 };
  const channelDiffs = channels.flatMap((channel) => {
    const stored = snapshot.contents?.channels[channel.id];
    if (!stored) return [];
    const current = snapshotChannelLevel(channel, selectedMixTargetId);
    const next = snapshotChannelLevel(stored, selectedMixTargetId);
    if (Math.abs(current - next) < 0.005) return [];
    return [{ after: next, before: current, label: channel.name }];
  });
  const mixTargetDiffs = mixTargets.flatMap((mixTarget) => {
    const stored = snapshot.contents?.mixTargets[mixTarget.id];
    if (!stored) return [];
    const current = clampSnapshotLevel(mixTarget.volume);
    const next = clampSnapshotLevel(stored.volume);
    if (Math.abs(current - next) < 0.005) return [];
    return [{ after: next, before: current, label: mixTarget.name }];
  });
  const combined = [...channelDiffs, ...mixTargetDiffs];
  return { shown: combined.slice(0, SNAPSHOT_DIFF_SHOWN_LIMIT), total: combined.length };
}
