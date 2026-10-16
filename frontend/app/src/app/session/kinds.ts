import { createElement, type ReactElement } from "react";

import { GreenScreenDrawing, PodcastDrawing, WebinarDrawing, type SessionRoomTone } from "@sse/design-system";
import type { SessionKind } from "@sse/engine-client";

// The three kinds of session (D51; docs/design/session.md, board 2), in the
// Session page's order. The hardware link knows them by their ids
// (`SessionKind`); the page holds their words, their tones and their
// drawings. The names are the owner's; the action log's sentence says them
// too (the hardware link's `SessionKind::name`).

export interface SessionKindView {
  id: SessionKind;
  /** The owner's name for it, as the Room prints it: `Podcast Recording`. */
  name: string;
  /** The name inside a sentence: `ends the podcast recording`. */
  inSentence: string;
  /** Its line on the Room's floor, in PT Serif italic. */
  line: string;
  /** The Room's tone: identity, never status (the Overview's tones made richer). */
  tone: SessionRoomTone;
  /** The studio as this kind of session uses it, drawn in the program's own line: the Room's drawing. */
  drawing: ReactElement;
}

export const SESSION_KINDS: readonly SessionKindView[] = [
  {
    id: "green-screen",
    name: "Green Screen Recording",
    inSentence: "green screen recording",
    line: "A presenter at the screen, with the prompter.",
    tone: "green",
    drawing: createElement(GreenScreenDrawing),
  },
  {
    id: "podcast",
    name: "Podcast Recording",
    inSentence: "podcast recording",
    line: "Voices around the table, a camera on each.",
    tone: "umber",
    drawing: createElement(PodcastDrawing),
  },
  {
    id: "webinar",
    name: "Webinar",
    inSentence: "webinar",
    line: "Live, to an audience online.",
    tone: "slate",
    drawing: createElement(WebinarDrawing),
  },
];

/** The kind's words, tone and drawing; `undefined` for a kind the page does not know. */
export function kindOf(id: SessionKind): SessionKindView | undefined {
  return SESSION_KINDS.find((kind) => kind.id === id);
}
