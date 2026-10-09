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
 * The seconds since the hardware link's last report of the glass, counted
 * once a second while the text scrolls; 0 while it stands still. What the
 * report gave (the time left, a cue's seconds ahead) goes down by it until
 * the next report (2026-10-09: the Overview's cue times, D47).
 */
export function usePrompterElapsed(glass: PrompterGlassSummary | null | undefined): number {
  const playing = glass?.playing ?? false;
  // A new report starts the count again from its own figure.
  const receivedAt = useMemo(() => ({ glass, at: Date.now() }), [glass]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!playing) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [playing, receivedAt]);
  return playing ? Math.max(0, now - receivedAt.at) / 1000 : 0;
}

/**
 * The time left on the glass now, in seconds: the hardware link's figure,
 * counted down once a second while the text scrolls. `null` while nothing is
 * on the prompter. Nothing ticks while the text stands still.
 */
export function usePrompterTimeLeft(glass: PrompterGlassSummary | null | undefined): number | null {
  const elapsed = usePrompterElapsed(glass);
  const reported = glass?.timeLeftSeconds ?? null;
  if (reported === null) return null;
  return Math.max(0, reported - elapsed);
}
