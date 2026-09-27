import type { PrompterAnchor } from "../generated/snapshots/PrompterAnchor";

// The Teleprompter's motion from an anchor (new pages program, Slice 4): the
// front end's copy of the formula in `native/rust-engine/src/prompter/clock.rs`.
// The hardware link runs the clock; a view draws the text from the last anchor
// it was sent, with no clock of its own beyond the time since the anchor came:
//
//   words(t)    = (v0·t + (v1 − v0)·t²/(2r)) / 60        while t < r
//               = ((v0 + v1)/2·r + v1·(t − r)) / 60      after
//   position(t) = min(position + pxPerReadWord · words(ageMs + t), endPosition)
//
// with t in seconds, r the ramp in seconds and v0, v1 the pace before and after
// in words a minute. Both copies are held to the same table,
// `native/rust-engine/src/prompter/clock/motion-cases.json` (`motion.test.ts`).
//
// Every `elapsedMs` below is the time since the anchor arrived, on the view's own
// clock; the anchor's `ageMs` (how old it was when it was sent) is added to it.

/** What the pace reads of an anchor. */
export type PrompterMotion = Pick<PrompterAnchor, "fromWpm" | "toWpm" | "rampMs" | "ageMs">;

/** What the position reads of an anchor. */
export type PrompterMotionAnchor = PrompterMotion & Pick<PrompterAnchor, "position" | "endPosition" | "pxPerReadWord">;

/** The read words the text has moved `sinceAnchorMs` after the anchor's own moment. */
function wordsSinceAnchor(motion: PrompterMotion, sinceAnchorMs: number): number {
  const seconds = Math.max(sinceAnchorMs, 0) / 1000;
  const ramp = motion.rampMs / 1000;
  const from = motion.fromWpm;
  const to = motion.toWpm;
  const wordMinutes =
    ramp > 0 && seconds < ramp
      ? from * seconds + ((to - from) * seconds * seconds) / (2 * ramp)
      : ((from + to) / 2) * ramp + to * (seconds - ramp);
  return wordMinutes / 60;
}

/** The read words the text has moved since the anchor's moment, `elapsedMs` after it arrived. */
export function wordsAdvanced(anchor: PrompterMotion, elapsedMs: number): number {
  return wordsSinceAnchor(anchor, anchor.ageMs + elapsedMs);
}

/** The pace in words a minute, `elapsedMs` after the anchor arrived. */
export function speedAt(anchor: PrompterMotion, elapsedMs: number): number {
  const sinceAnchorMs = anchor.ageMs + elapsedMs;
  if (anchor.rampMs > 0 && sinceAnchorMs < anchor.rampMs) {
    return anchor.fromWpm + ((anchor.toWpm - anchor.fromWpm) * Math.max(sinceAnchorMs, 0)) / anchor.rampMs;
  }
  return anchor.toWpm;
}

/**
 * Where the reading line stands, in the glass's pixels, `elapsedMs` after the
 * anchor arrived; `null` while the anchor has no position (the layout it belongs
 * to was not reported yet). It never passes `END`.
 */
export function positionAt(anchor: PrompterMotionAnchor, elapsedMs: number): number | null {
  if (anchor.position === null) return null;
  const moved = anchor.position + (anchor.pxPerReadWord ?? 0) * wordsAdvanced(anchor, elapsedMs);
  return anchor.endPosition === null ? moved : Math.min(moved, anchor.endPosition);
}
