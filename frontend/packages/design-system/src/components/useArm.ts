import { useCallback, useEffect, useRef, useState } from "react";

// Visual overhaul A, Slice 3 (product brief §5, system §7): the arm-then-apply
// state one surface shares. The first press arms; a second press on the same
// key at least `dwellMs` later applies; a press on any other key re-arms that
// key instead; Escape or `timeoutMs` disarms. Only one key is armed at a time
// and a held key never repeats into an apply. The numbers are the Console's
// (350 ms dwell, 4.5 s window); the Console keeps its own `useAudioArming`
// until Slice 4 moves it onto this hook.

export const ARM_DWELL_MS = 350;
export const ARM_TIMEOUT_MS = 4500;

export interface ArmedKey {
  key: string;
  label: string;
  armedAt: number;
  timeoutMs: number;
}

export interface UseArmOptions {
  dwellMs?: number;
  timeoutMs?: number;
  /** Monotonic clock, injectable for tests. */
  now?: () => number;
  /** Called when the arm is cancelled by Escape or the timeout (not on apply). */
  onDisarm?: (armed: ArmedKey, reason: "escape" | "timeout" | "cancel") => void;
}

export interface UseArmResult {
  armed: ArmedKey | null;
  /** Arms `key`, or applies when `key` is already armed and the dwell has passed. */
  armOrApply: (key: string, label: string, apply: () => void) => void;
  cancel: () => boolean;
  clear: () => void;
  /** Milliseconds left on the current arm, for a countdown; 0 when idle. */
  remainingMs: () => number;
}

export function useArm({
  dwellMs = ARM_DWELL_MS,
  timeoutMs = ARM_TIMEOUT_MS,
  now = () => performance.now(),
  onDisarm,
}: UseArmOptions = {}): UseArmResult {
  const [armed, setArmed] = useState<ArmedKey | null>(null);
  const armedRef = useRef<ArmedKey | null>(null);
  const onDisarmRef = useRef(onDisarm);
  onDisarmRef.current = onDisarm;
  armedRef.current = armed;

  useEffect(() => {
    if (!armed) return undefined;
    const timer = window.setTimeout(() => {
      setArmed(null);
      onDisarmRef.current?.(armed, "timeout");
    }, armed.timeoutMs);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setArmed(null);
      onDisarmRef.current?.(armed, "escape");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [armed]);

  const armOrApply = useCallback(
    (key: string, label: string, apply: () => void) => {
      const current = armedRef.current;
      if (current?.key === key) {
        // Inside the dwell the repeat is a double-click, a bounced pointer or
        // a held key: the arm stays and nothing is applied.
        if (now() - current.armedAt < dwellMs) return;
        setArmed(null);
        apply();
        return;
      }
      setArmed({ key, label, armedAt: now(), timeoutMs });
    },
    [dwellMs, now, timeoutMs]
  );

  const cancel = useCallback(() => {
    const current = armedRef.current;
    if (!current) return false;
    setArmed(null);
    onDisarmRef.current?.(current, "cancel");
    return true;
  }, []);

  const clear = useCallback(() => setArmed(null), []);

  const remainingMs = useCallback(() => {
    const current = armedRef.current;
    if (!current) return 0;
    return Math.max(0, current.timeoutMs - (now() - current.armedAt));
  }, [now]);

  return { armed, armOrApply, cancel, clear, remainingMs };
}
