import { useEffect, useMemo, useState } from "react";
import type { AudioSnapshot } from "@sse/engine-client";

import { useLiveCallback } from "../../shared/useLiveCallback";

export interface OptimisticAudioSettings {
  selectedChannelId?: string | null;
  selectedMixTargetId?: string;
  viewMode?: "submix" | "master";
}

// Why: how long the optimistic shadow lingers when the engine round-trip
// doesn't confirm. Tuned to feel responsive (clears the optimistic ghost
// quickly) but long enough that a slow engine round-trip lands first.
const OPTIMISTIC_SETTINGS_EXPIRY_MS = 2500;

export interface UseAudioOptimisticSettingsResult {
  /**
   * The latest audio snapshot blended with any in-flight optimistic settings.
   * Returns the source snapshot unchanged when no optimistic shadow is set,
   * so view-model dependencies stay stable.
   */
  audioSnapshotForView: AudioSnapshot | null;
  /**
   * Merge an optimistic patch into the shadow. The patch persists until
   * either (a) the engine snapshot catches up and matches every patched
   * field, or (b) `OPTIMISTIC_SETTINGS_EXPIRY_MS` elapses, whichever comes
   * first.
   */
  applyOptimistic: (optimistic: OptimisticAudioSettings) => void;
  /**
   * Drop any active optimistic shadow. Used by the settings-update error
   * handler so a failed engine call doesn't leave the UI lying.
   */
  clearOptimistic: () => void;
}

/**
 * Owns the optimistic-settings layer for the audio workspace.
 *
 * The pattern: when the operator changes a selected channel / mix target /
 * view mode, we apply the change locally via `applyOptimistic` and call the
 * engine in parallel. The view-model reads from `audioSnapshotForView`, which
 * is the source snapshot merged with the optimistic shadow. Once the engine
 * snapshot reflects every patched field, the shadow clears. If the engine
 * never catches up (or errors out), the expiry timer clears it after a fixed
 * window so the UI doesn't lie forever.
 */
export function useAudioOptimisticSettings(audioSnapshot: AudioSnapshot | null): UseAudioOptimisticSettingsResult {
  const [optimisticSettings, setOptimisticSettings] = useState<OptimisticAudioSettings | null>(null);

  const audioSnapshotForView = useMemo(() => {
    if (!audioSnapshot || !optimisticSettings) return audioSnapshot;

    const hasSelectedChannel = Object.prototype.hasOwnProperty.call(optimisticSettings, "selectedChannelId");
    return {
      ...audioSnapshot,
      selectedChannelId: hasSelectedChannel
        ? (optimisticSettings.selectedChannelId ?? null)
        : audioSnapshot.selectedChannelId,
      selectedMixTargetId: optimisticSettings.selectedMixTargetId ?? audioSnapshot.selectedMixTargetId,
      viewMode: optimisticSettings.viewMode ?? audioSnapshot.viewMode,
    };
  }, [audioSnapshot, optimisticSettings]);

  // Why: when the engine snapshot matches every optimistic patch, the shadow
  // is redundant — clear it so subsequent operator changes start from the
  // engine truth, not from a stale optimistic layer.
  useEffect(() => {
    if (!optimisticSettings || !audioSnapshot) return;

    const hasSelectedChannel = Object.prototype.hasOwnProperty.call(optimisticSettings, "selectedChannelId");
    const selectedChannelMatches =
      !hasSelectedChannel || audioSnapshot.selectedChannelId === (optimisticSettings.selectedChannelId ?? null);
    const selectedMixTargetMatches =
      optimisticSettings.selectedMixTargetId === undefined ||
      audioSnapshot.selectedMixTargetId === optimisticSettings.selectedMixTargetId;
    const viewModeMatches =
      optimisticSettings.viewMode === undefined || audioSnapshot.viewMode === optimisticSettings.viewMode;

    if (selectedChannelMatches && selectedMixTargetMatches && viewModeMatches) {
      setOptimisticSettings(null);
    }
  }, [audioSnapshot, optimisticSettings]);

  // Why: if the engine never catches up (slow update, error not raised),
  // expire the shadow so the UI doesn't lie forever.
  useEffect(() => {
    if (!optimisticSettings) return;
    const timeoutId = window.setTimeout(() => setOptimisticSettings(null), OPTIMISTIC_SETTINGS_EXPIRY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [optimisticSettings]);

  const applyOptimistic = useLiveCallback((optimistic: OptimisticAudioSettings) => {
    setOptimisticSettings((current) => ({ ...(current ?? {}), ...optimistic }));
  });

  const clearOptimistic = useLiveCallback(() => {
    setOptimisticSettings(null);
  });

  return { audioSnapshotForView, applyOptimistic, clearOptimistic };
}
