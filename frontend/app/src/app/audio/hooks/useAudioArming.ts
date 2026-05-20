import { useEffect, useRef, useState } from "react";

import { type AudioArmedAction } from "../audioArming";
import type { AudioFeedbackTone } from "../audioFormatting";
import { useLiveCallback } from "../../shared/useLiveCallback";

export interface AudioArmingFeedback {
  message: string;
  tone: AudioFeedbackTone;
}

export interface AudioArmingResetTriggers {
  lastRecalledSnapshotId?: string | null;
  lastSnapshotRecallAt?: string | number | null;
  selectedChannelId?: string | null;
  selectedMixTargetId?: string | null;
}

export interface UseAudioArmingArgs {
  resetTriggers: AudioArmingResetTriggers;
  setFeedback: (feedback: AudioArmingFeedback | null) => void;
}

export interface UseAudioArmingResult {
  armedAction: AudioArmedAction | null;
  armOrApplyAction: (candidate: Omit<AudioArmedAction, "armedAt">, apply: () => void) => void;
  cancelArmedAction: () => boolean;
  clearArmedAction: () => void;
}

/**
 * Shared arm-then-apply state for the audio workspace.
 *
 * The hook owns the `armedAction` slice and the expiry timer that retires the
 * arm window after `candidate.timeoutMs`. Consumers thread `armedAction` into
 * the snapshot deck (for the countdown bar and the data-armed lane treatment)
 * and call `armOrApplyAction` from each user-initiated armed action (48V
 * phantom, snapshot recall, snapshot save).
 *
 * `clearArmedAction` is intentionally exposed for the few non-arming code
 * paths that must drop the current arm — eg. `performAction` resetting state
 * before kicking off an async store call. Direct callers should always use
 * the canonical `armOrApplyAction` + `cancelArmedAction` pair so the toast is
 * raised consistently.
 */
export function useAudioArming({ resetTriggers, setFeedback }: UseAudioArmingArgs): UseAudioArmingResult {
  const [armedAction, setArmedAction] = useState<AudioArmedAction | null>(null);
  const armedActionTimerRef = useRef<number | null>(null);

  // Why: while an arm is active, schedule a single setTimeout that retires the
  // candidate when `armedAction.timeoutMs` elapses. The cleanup branch fires
  // when the dependency changes or the component unmounts; it also runs when
  // the user applies/cancels (because setArmedAction(null) triggers a fresh
  // effect run).
  useEffect(() => {
    if (armedActionTimerRef.current !== null) {
      window.clearTimeout(armedActionTimerRef.current);
      armedActionTimerRef.current = null;
    }
    if (!armedAction) return;

    armedActionTimerRef.current = window.setTimeout(() => {
      setArmedAction(null);
      armedActionTimerRef.current = null;
    }, armedAction.timeoutMs);

    return () => {
      if (armedActionTimerRef.current !== null) {
        window.clearTimeout(armedActionTimerRef.current);
        armedActionTimerRef.current = null;
      }
    };
  }, [armedAction]);

  // Why: any external state shift that invalidates the current arm (recall
  // succeeded, snapshot rolled, selection changed, mix target changed) clears
  // the arm without raising a toast. The toast would be misleading because
  // the operator did not cancel — the engine state moved.
  useEffect(() => {
    setArmedAction(null);
  }, [
    resetTriggers.lastRecalledSnapshotId,
    resetTriggers.lastSnapshotRecallAt,
    resetTriggers.selectedChannelId,
    resetTriggers.selectedMixTargetId,
  ]);

  // Why: ensure the timer is cancelled if the workspace unmounts while an
  // arm is pending — eg. operator switches workspace mid-arm.
  useEffect(() => {
    return () => {
      if (armedActionTimerRef.current !== null) {
        window.clearTimeout(armedActionTimerRef.current);
        armedActionTimerRef.current = null;
      }
    };
  }, []);

  const cancelArmedAction = useLiveCallback(() => {
    if (!armedAction) return false;
    setArmedAction(null);
    setFeedback({ message: "Armed audio action canceled.", tone: "info" });
    return true;
  });

  const clearArmedAction = useLiveCallback(() => {
    setArmedAction(null);
  });

  const armOrApplyAction = useLiveCallback((candidateInput: Omit<AudioArmedAction, "armedAt">, apply: () => void) => {
    if (armedAction?.key === candidateInput.key) {
      setArmedAction(null);
      apply();
      return;
    }

    const candidate: AudioArmedAction = { ...candidateInput, armedAt: performance.now() };
    setArmedAction(candidate);
    setFeedback({ message: `Armed: ${candidate.label}. Repeat the same action to apply.`, tone: "info" });
  });

  return { armedAction, armOrApplyAction, cancelArmedAction, clearArmedAction };
}
