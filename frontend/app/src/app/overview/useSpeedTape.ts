import { useCallback, useEffect, useRef, useState } from "react";

import type { PrompterGlassSummary } from "@sse/engine-client";

// The speed tape's words (overview-2.md §3): whether the deck has just turned
// the pace, and the range of this take. The hardware link says only that the
// prompter changed, not who changed it (`prompter.changed`), so the page
// tells the deck's turn from its own: a pace that changes on the same script
// while no − 5 or + 5 of this page is on its way was turned on the deck.

/** How long the pointer says "turned on the deck" after a turn. */
export const TURNED_MS = 1200;
/** How long a press of this page's own − 5 or + 5 may take to come back. */
const OWN_CHANGE_MS = 2000;

export interface SpeedTapeView {
  turned: boolean;
  /** The range of this take while CAM 1 records and the pace has moved in it. */
  range: readonly [number, number] | null;
  caption: string;
}

/** The words under the pointer. */
export function speedCaption(
  turned: boolean,
  recording: boolean,
  range: readonly [number, number] | null,
  value: number
) {
  if (turned) return "turned on the deck";
  if (!recording) return "this script's own pace";
  return range && range[0] !== range[1] ? `this take ${range[0]} to ${range[1]}` : `this take at ${value}`;
}

/** CAM 1's take, as the tape reads it. */
export interface SpeedTapeTake {
  /** CAM 1 records, or did when it last answered (a last known take goes on). */
  recording: boolean;
  /** When the take began, as the hardware link counted it; `null` when it does not know. */
  startedAt: string | null;
}

/**
 * The tape's view of `glass`, and `ownChange`, which the page calls as it
 * sends its own − 5 or + 5. The range starts again with a new script and
 * with a new take: a take is known by when it began, so CAM 1 dropping for a
 * moment mid-take, which the hardware link reports as a take of unknown start,
 * keeps the range (the review of the page).
 */
export function useSpeedTape(glass: PrompterGlassSummary | null, take: SpeedTapeTake) {
  const scriptId = glass?.scriptId ?? null;
  const speed = glass?.speedWpm ?? null;
  const { recording, startedAt } = take;
  const ownUntil = useRef(0);
  const seen = useRef<{ scriptId: string | null; speed: number | null; take: string | null }>({
    scriptId,
    speed,
    take: startedAt,
  });
  const [turnedUntil, setTurnedUntil] = useState(0);
  const [range, setRange] = useState<readonly [number, number] | null>(speed === null ? null : [speed, speed]);

  useEffect(() => {
    const before = seen.current;
    const newTake = startedAt !== null && startedAt !== before.take;
    seen.current = { scriptId, speed, take: startedAt ?? before.take };
    if (speed === null) {
      setRange(null);
      return;
    }
    const restart = scriptId !== before.scriptId || newTake || before.speed === null;
    setRange((held) => (restart || !held ? [speed, speed] : [Math.min(held[0], speed), Math.max(held[1], speed)]));
    if (!restart && speed !== before.speed && Date.now() > ownUntil.current) setTurnedUntil(Date.now() + TURNED_MS);
  }, [scriptId, speed, startedAt]);

  // The pointer's keyline goes after its while, once, with nothing ticking in between.
  const [, setTick] = useState(0);
  useEffect(() => {
    const left = turnedUntil - Date.now();
    if (left <= 0) return undefined;
    const id = window.setTimeout(() => setTick((tick) => tick + 1), left);
    return () => window.clearTimeout(id);
  }, [turnedUntil]);

  const ownChange = useCallback(() => {
    ownUntil.current = Date.now() + OWN_CHANGE_MS;
  }, []);

  const turned = Date.now() < turnedUntil;
  const shownRange = recording && range && range[0] !== range[1] ? range : null;
  const view: SpeedTapeView = {
    turned,
    range: shownRange,
    caption: speedCaption(turned, recording, range, speed ?? 0),
  };
  return { view, ownChange };
}
