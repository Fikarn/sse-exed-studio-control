import { useEffect, useRef } from "react";
import { useArm, type UseArmResult } from "@sse/design-system";

import type { AudioArmCandidate, AudioArmedAction } from "../audioArming";
import { AUDIO_ARM_MIN_DWELL_MS, AUDIO_ARM_TIMEOUT_MS } from "../audioConstants";
import type { AudioFeedbackTone } from "../audioFormatting";
import { useLiveCallback } from "../../shared/useLiveCallback";

export interface AudioArmingFeedback {
  message: string;
  tone: AudioFeedbackTone;
}

export interface AudioArmingResetTriggers {
  /** The TotalMix snapshot slot the desk holds (2026-10-01). */
  loadedSnapshotSlot?: number | null;
  selectedChannelId?: string | null;
  selectedMixTargetId?: string | null;
}

export interface UseAudioArmingArgs {
  /** Monotonic clock, injectable for tests. Defaults to `performance.now`. */
  now?: () => number;
  resetTriggers: AudioArmingResetTriggers;
  setFeedback: (feedback: AudioArmingFeedback | null) => void;
}

export interface UseAudioArmingResult {
  /**
   * The Console's one arm, for every menu on the page (`Menu`'s `arm`): a
   * menu's destructive item and a key on the page are never armed at once.
   */
  arm: UseArmResult;
  armedAction: AudioArmedAction | null;
  armOrApplyAction: (candidate: AudioArmCandidate, apply: () => void) => void;
  cancelArmedAction: () => boolean;
  clearArmedAction: () => void;
}

/**
 * The Console's arm-then-apply state: the design system's `useArm` with the
 * Console's numbers (the 350 ms dwell, the 4.5 s window) and its reset rules.
 * (`setFeedback(null)` clears the page's last line when something is armed.)
 *
 * The visual overhaul's Console pull request moved it onto `useArm`, so the
 * strip's 48 V, the plate's 48 V, the snapshot keys and every menu's
 * destructive item share one arm: arming one disarms any other. `useArm` owns
 * the dwell, the window, the Esc that cancels an arm (left alone when a layer
 * above took it) and the held Enter whose repeats never confirm one.
 *
 * What the Console adds:
 * - an arm made against the desk as it was is dropped when the desk moves
 *   under it (TotalMix loaded another snapshot, the selection or the mix target
 *   changed), with no message: the operator did not cancel it;
 * - an arm the operator cancels with Esc says so once. Arming says nothing
 *   here: the state display's armed row and the key itself say it.
 */
export function useAudioArming({
  now = () => performance.now(),
  resetTriggers,
  setFeedback,
}: UseAudioArmingArgs): UseAudioArmingResult {
  const setFeedbackRef = useRef(setFeedback);
  setFeedbackRef.current = setFeedback;

  const arm = useArm({
    dwellMs: AUDIO_ARM_MIN_DWELL_MS,
    timeoutMs: AUDIO_ARM_TIMEOUT_MS,
    now,
    // A menu closing or the pointer leaving its armed item cancels too
    // ("cancel"), and the timeout ends an arm by itself: neither is news.
    onDisarm: (_armed, reason) => {
      if (reason === "escape") setFeedbackRef.current({ message: "Armed audio action canceled.", tone: "info" });
    },
  });

  const { clear } = arm;
  useEffect(() => {
    clear();
  }, [clear, resetTriggers.loadedSnapshotSlot, resetTriggers.selectedChannelId, resetTriggers.selectedMixTargetId]);

  // A new arm, from a key or a menu, clears the last line the page printed, so
  // an old "canceled" never stands beside a live arm (found in the pull
  // request's review: arming used to overwrite it with its own line).
  const armedKey = arm.armed?.key;
  const armedAt = arm.armed?.armedAt;
  useEffect(() => {
    if (armedKey !== undefined) setFeedbackRef.current(null);
  }, [armedKey, armedAt]);

  const armOrApplyAction = useLiveCallback((candidate: AudioArmCandidate, apply: () => void) => {
    arm.armOrApply(candidate.key, candidate.label, apply, candidate.timeoutMs);
  });

  return {
    arm,
    armedAction: arm.armed,
    armOrApplyAction,
    cancelArmedAction: arm.cancel,
    clearArmedAction: arm.clear,
  };
}
