import type { PrompterAnchor } from "../generated/snapshots/PrompterAnchor";

// When each anchor came (fix C, 2026-10-02), on the page's clock
// (`performance.now()`), kept with the anchor object itself. Whoever takes an
// anchor from the hardware link notes when it came (the store for the page's
// copy, the follower for the Prompter XL's window), and the glass draws from
// that moment, not from when React got round to it: a copy mounted again, or
// a second copy of the same anchor, draws the text where it is now. An anchor
// a view keeps (an unchanged read) keeps its moment, so nothing re-anchors.

const arrivals = new WeakMap<PrompterAnchor, number>();

/** Notes when `anchor` came; the first note stands. */
export function noteAnchorArrival(anchor: PrompterAnchor, at: number): void {
  if (!arrivals.has(anchor)) arrivals.set(anchor, at);
}

/** When `anchor` came, when someone noted it. */
export function anchorArrival(anchor: PrompterAnchor): number | null {
  return arrivals.get(anchor) ?? null;
}
