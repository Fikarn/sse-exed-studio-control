import { useCallback, useEffect, useRef, useState } from "react";

// Visual overhaul A, Slice 3 (product brief §5, system §7): the arm-then-apply
// state one surface shares. The first press arms; a second press on the same
// key at least `dwellMs` later applies; a press on any other key re-arms that
// key instead; Escape or `timeoutMs` disarms. Only one key is armed at a time
// and a held key never repeats into an apply: the dwell does not see to that
// (Windows repeats a held key after about 500 ms, past the 350 ms dwell), the
// window listener below does, by cancelling a held Enter's repeats while a key
// is armed. The numbers are the Console's (350 ms dwell, 4.5 s window); the
// Console keeps its own `useAudioArming` until Slice 4 moves it onto this
// hook. New pages program, Slice 3 (D6): Esc is plain keyboard operation and
// stays — the window listener below lives only while a key is armed — but
// nothing on screen advertises it any more.

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
      // Enter held on the focused key repeats, and the browser presses the key
      // again on every repeat. A cancelled keydown is not pressed, so a held
      // Enter never confirms the arm; confirming takes a fresh press. Space
      // presses a key once, when it is let go, so it has no repeats to stop.
      if (event.key === "Enter" && event.repeat) {
        event.preventDefault();
        return;
      }
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
        // Inside the dwell the second press is a double-click or a bounced
        // pointer: the arm stays and nothing is applied. A held Enter's repeats
        // do not reach here; the window listener above cancels them.
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
