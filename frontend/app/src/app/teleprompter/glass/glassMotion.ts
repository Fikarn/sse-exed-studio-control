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
