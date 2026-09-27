import { useEffect, useMemo, useState } from "react";

import type { PrompterGlassSummary } from "@sse/engine-client";

// The prompter's times on screen (new pages program, Slice 6a): the time left
// in the header's latch and over the page's copy of the glass, and the lengths
// in the lists. The hardware link counts them (§5.3); while the text scrolls,
// the time left it reported goes down with the clock until the next report.
// This module stays with the shell (the latch is on every page), outside the
// Teleprompter's own chunk.

/** `0:37`, `4:19`, `1:02:05`: whole seconds, minutes unpadded below the hour. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * The time left on the glass now, in seconds: the hardware link's figure,
 * counted down once a second while the text scrolls. `null` while nothing is
 * on the prompter. Nothing ticks while the text stands still.
 */
export function usePrompterTimeLeft(glass: PrompterGlassSummary | null | undefined): number | null {
  const playing = glass?.playing ?? false;
  const reported = glass?.timeLeftSeconds ?? null;
  // A new report starts the count again from its own figure.
  const receivedAt = useMemo(() => ({ glass, at: Date.now() }), [glass]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!playing) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [playing, receivedAt]);
  if (reported === null) return null;
  if (!playing) return reported;
  return Math.max(0, reported - Math.max(0, now - receivedAt.at) / 1000);
}
