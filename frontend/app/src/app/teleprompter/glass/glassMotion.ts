import { positionAt, wordsAdvanced, type PrompterAnchor } from "@sse/engine-client";

import { lineAt, positionOf, type GlassLayout, type GlassMetrics } from "./glassLayout";

// Where the glass draws the text at a moment (new pages program, Slice 5a).
// The hardware link runs the clock; the glass draws from the last anchor it was
// given and the time since it came (`motion.ts`, held to the hardware link's
// motion cases). An anchor for the layout this glass measured is drawn from its
// own pixels; one for another layout (a new look not measured yet, or the other
// view's report) is drawn from its words through this glass's layout, as
// `native/protocol/v1.md` › Teleprompter has it.

/** A jump's 0.2 s move on the glass eases out, so the text lands softly. */
function easeOut(share: number): number {
  const rest = 1 - Math.min(Math.max(share, 0), 1);
  return 1 - rest * rest * rest;
}

/** The reading line's position in `layout`'s pixels, `elapsedMs` after the anchor arrived. */
export function glassPosition(anchor: PrompterAnchor, layout: GlassLayout, elapsedMs: number): number {
  const ownPixels = anchor.layoutKey === layout.key && anchor.position !== null;
  let position: number;
  if (ownPixels) {
    position = positionAt(anchor, elapsedMs) ?? layout.endTop;
  } else if (anchor.atEnd) {
    position = layout.endTop;
  } else {
    const from = positionOf(layout, anchor.place.paragraph, anchor.wordOffset);
    position = Math.min(from + layout.pxPerReadWord * wordsAdvanced(anchor, elapsedMs), layout.endTop);
  }
  const sinceAnchor = anchor.ageMs + elapsedMs;
  if (ownPixels && anchor.moveFromPosition !== null && anchor.moveMs > 0 && sinceAnchor < anchor.moveMs) {
    const from = anchor.moveFromPosition;
    position = from + (position - from) * easeOut(sinceAnchor / anchor.moveMs);
  }
  return position;
}

/** A small correction eases out over this long (fix C, 2026-10-02): the text glides onto a new course. */
export const CORRECTION_MS = 150;
/** A larger step is drawn at once: a new course the presenter must see, not a correction. */
export const CORRECTION_MAX_PX = 24;
/** A smaller one is no correction at all. */
const CORRECTION_MIN_PX = 0.01;

/**
 * What the glass adds to a new anchor's course while it glides onto it: `by`
 * glass pixels at `from` (the page's clock), fading to exactly 0 over
 * `CORRECTION_MS`.
 */
export interface GlassCorrection {
  by: number;
  from: number;
}

/** What is left of `correction` at `at`: all of it at its start, exactly 0 from `CORRECTION_MS` on. */
export function correctionLeft(correction: GlassCorrection | null, at: number): number {
  if (!correction) return 0;
  const share = (at - correction.from) / CORRECTION_MS;
  if (share >= 1) return 0;
  return correction.by * (1 - easeOut(share));
}

/** The correction from where the text is drawn to where a new anchor puts it, at `at`, when it is small; else none. */
export function correctionFor(by: number, at: number): GlassCorrection | null {
  const size = Math.abs(by);
  return size > CORRECTION_MIN_PX && size <= CORRECTION_MAX_PX ? { by, from: at } : null;
}

/** Whether nothing moves any more: paused, its ease and its jump's move done. */
export function glassSettled(anchor: PrompterAnchor, elapsedMs: number): boolean {
  return !anchor.playing && anchor.ageMs + elapsedMs >= Math.max(anchor.rampMs, anchor.moveMs);
}

/** What the glass draws for a position: the text's shift and the dimmed band's height, in the glass's pixels. */
export interface GlassFrame {
  /** How far the text column moves up or down: the line at `position` sits centred on the reading line. */
  shift: number;
  /** The band over the text already read: down to the top of the line at the reading line. */
  readHeight: number;
}

export function glassFrame(layout: GlassLayout, metrics: GlassMetrics, position: number): GlassFrame {
  const lineTopOnGlass = metrics.readingY - metrics.lineHeight / 2;
  const shift = lineTopOnGlass - position;
  if (layout.lines.length === 0 || position >= layout.endTop) {
    return { shift, readHeight: Math.max(lineTopOnGlass, 0) };
  }
  const line = layout.lines[lineAt(layout, position)];
  return { shift, readHeight: Math.max(line.top + shift, 0) };
}
