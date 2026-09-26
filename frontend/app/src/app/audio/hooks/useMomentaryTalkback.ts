/**
 * Momentary talkback (2026-09 audit remediation, Slice 6 — operator decision 4).
 *
 * Talkback is a hold, never a latch. This hook owns the whole hold lifecycle
 * for one surface: engage on pointer-down, or on Space / Enter while the
 * button has focus, re-send the hold every `AUDIO_TALKBACK_HEARTBEAT_MS`
 * while held (the engine's watchdog releases a hold that is not renewed
 * within 2 s), and release on pointer-up, pointer-cancel, lost capture,
 * key-up, window blur, a hidden document, unmount, or the audio gate closing.
 * `hold(false)` is sent exactly once per hold; `hold(true)` is sent on engage
 * and then once per heartbeat.
 *
 * New pages program, Slice 3 (D7): the page-wide `T` hold key is gone. The
 * on-screen key (and Space / Enter on it when focused) and the deck's TALK
 * are the ways to talk.
 *
 * The engine keeps one watchdog for every surface (this hook, the Stream
 * Deck's TALK key and any mix-target update that turns talkback on), so a
 * release from any of them releases everywhere and nothing can latch.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useLiveCallback } from "../../shared/useLiveCallback";

/** How often a held talkback is re-sent; the engine watchdog allows 2 s. */
export const AUDIO_TALKBACK_HEARTBEAT_MS = 750;

export interface UseMomentaryTalkbackArgs {
  /** False while the audio gate is closed or no monitor target exists. */
  enabled: boolean;
  /** Sends `audio.talkback.hold { engaged }` for the current monitor target. */
  hold: (engaged: boolean) => void;
  heartbeatMs?: number;
}

export interface MomentaryTalkbackButtonProps {
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onKeyUp: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onLostPointerCapture: () => void;
  onPointerCancel: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
}

export function useMomentaryTalkback({
  enabled,
  hold,
  heartbeatMs = AUDIO_TALKBACK_HEARTBEAT_MS,
}: UseMomentaryTalkbackArgs) {
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendHold = useLiveCallback(hold);

  const release = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    if (heartbeatRef.current !== null) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    setHolding(false);
    sendHold(false);
  }, [sendHold]);

  const engage = useCallback(() => {
    if (holdingRef.current || !enabled) return;
    holdingRef.current = true;
    setHolding(true);
    sendHold(true);
    heartbeatRef.current = setInterval(() => sendHold(true), heartbeatMs);
  }, [enabled, heartbeatMs, sendHold]);

  // Losing the right to talk (gate closed, target gone) releases at once.
  useEffect(() => {
    if (!enabled) release();
  }, [enabled, release]);

  // Unmounting mid-hold releases too — the engine would release 2 s later
  // anyway, but the operator should not have to wait for the watchdog.
  useEffect(() => () => release(), [release]);

  // A hold ends when the window loses focus or the document is hidden, so a
  // pointer or key released elsewhere never leaves talkback open.
  useEffect(() => {
    const onBlur = () => release();
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") release();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [release]);

  const buttonProps: MomentaryTalkbackButtonProps = {
    // A long press on touch must not open a context menu mid-hold.
    onContextMenu: (event) => event.preventDefault(),
    onKeyDown: (event) => {
      if (event.repeat) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        engage();
      }
    },
    onKeyUp: (event) => {
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        release();
      }
    },
    onLostPointerCapture: () => release(),
    onPointerCancel: () => release(),
    onPointerDown: (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom and some pointer types have no capture; the window listeners
        // and the engine watchdog still bound the hold.
      }
      engage();
    },
    onPointerUp: () => release(),
  };

  return { buttonProps, engage, holding, release };
}
