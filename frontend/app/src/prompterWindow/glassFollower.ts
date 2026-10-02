import {
  anchorOrder,
  EngineRequestError,
  noteAnchorArrival,
  type EventEnvelope,
  type EventName,
  type GlassLink,
  type PrompterAnchor,
  type PrompterGlassSnapshot,
} from "@sse/engine-client";

import type { PrompterGlassText } from "../app/teleprompter/glass/PrompterGlass";

// What the prompter's window draws, and how it follows the hardware link
// (the Prompter XL's window). The page holds no prompter state: the text, the
// look, the place and the pace are the hardware link's. It reads what the
// glass draws (`prompter.glass.snapshot`), hears what the prompter did
// (`prompter.changed`, which carries the anchor) and draws the last anchor it
// was given with the time since it came.
//
// - A press of the take (play, pause, a pace, a jump) moves the text by its
//   event's anchor alone, at once. Anything else may have changed what is
//   drawn (the text, the look, a colour, which needs no new layout and so no
//   new key), and the glass is read again.
// - The hardware link's end stops the text where it stands: nothing scrolls
//   by itself (D12), and with the hardware link gone nobody could pause it.
//   Its start reads the glass again: it starts paused, at the saved place.
// - Fix C (2026-10-02): every anchor carries the hardware link's number. An
//   anchor with a higher number is drawn, one with the number already drawn
//   leaves the text and its moment alone (a read that says the same), and a
//   lower one, which came late from another thread, is dropped. The numbers
//   count within one run of the hardware link: after its end or its start the
//   follower hears no anchor until a read answers, and draws that read's
//   anchor whatever its number; an answer from before the end or the start
//   is not drawn, and the glass is read again.
// - A read that fails is tried again in a second. A hardware link that
//   answers and refuses is a problem the shell is told of.
// - A page that cannot listen cannot follow the take: that is a problem the
//   shell is told of, whatever a read says, and the shell opens the window
//   again.

/** What the page draws. */
export interface GlassView {
  /** `null` while nothing is on the prompter, and until the glass was read: black. */
  text: PrompterGlassText | null;
  anchor: PrompterAnchor | null;
  /** The hardware link is gone: the text stands where it stood this long after the anchor came. */
  stoppedAfterMs: number | null;
  /** Why the glass could not be read, in the hardware link's words. */
  problem: string | null;
}

export const NOTHING_DRAWN: GlassView = { text: null, anchor: null, stoppedAfterMs: null, problem: null };

/** A read that failed is tried again after this long. */
const READ_AGAIN_MS = 1000;

/**
 * What keeps the page from drawing when it cannot listen. The shell words
 * the sentence around it ("The window's page could not draw: …"), and the
 * Teleprompter page shows that sentence.
 */
export const CANNOT_HEAR = "it cannot hear the hardware link.";

/** The events of the take: the text is the same, and the anchor says where it stands. */
const MOVES_THE_TEXT: ReadonlySet<string> = new Set(["played", "paused", "speed", "jumped", "at-end", "laid-out"]);

function textOf(snapshot: PrompterGlassSnapshot): PrompterGlassText | null {
  if (!snapshot.layoutKey) return null;
  return {
    layoutKey: snapshot.layoutKey,
    paragraphs: snapshot.paragraphs,
    look: snapshot.look,
    sizePx: snapshot.sizePx,
  };
}

function anchorOf(payload: unknown): PrompterAnchor | null {
  if (!payload || typeof payload !== "object") return null;
  const anchor = (payload as { anchor?: unknown }).anchor;
  if (!anchor || typeof anchor !== "object") return null;
  return typeof (anchor as { layoutKey?: unknown }).layoutKey === "string" ? (anchor as PrompterAnchor) : null;
}

export interface GlassFollowerOptions {
  /** The page's clock, in milliseconds. */
  now?: () => number;
  /** A failure nobody is told of otherwise: the console's. */
  onFailure?: (error: unknown, doing: string) => void;
}

/**
 * Follows the hardware link and calls `onView` with what to draw whenever it
 * changes. Answers what stops it.
 */
export function followGlass(
  link: GlassLink,
  onView: (view: GlassView) => void,
  options: GlassFollowerOptions = {}
): () => void {
  const now = options.now ?? (() => performance.now());
  const failed = options.onFailure ?? (() => {});
  let view = NOTHING_DRAWN;
  /** When the anchor that is drawn came. */
  let anchorAt = 0;
  /** The hardware link's runs as the follower counts them: its end and its start each begin another. */
  let run = 0;
  /** Since the hardware link's end or start: no anchor is heard until a read answers, and its anchor is drawn whatever its number. */
  let relinking = false;
  let reading = false;
  let again = false;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopListening: (() => void) | null = null;
  /** Why the page cannot follow the take, whatever a read says. */
  let deaf: string | null = null;

  const show = (next: Partial<GlassView>) => {
    view = { ...view, ...next };
    onView(view);
  };

  const readLater = () => {
    if (stopped || retry !== null) return;
    retry = setTimeout(() => {
      retry = null;
      void read();
    }, READ_AGAIN_MS);
  };

  const read = async (): Promise<void> => {
    if (stopped) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    const runAsked = run;
    try {
      const snapshot = await link.readGlass();
      if (stopped) return;
      // An answer from before the hardware link's end or start: read again.
      if (runAsked !== run) {
        again = true;
        return;
      }
      // It answered: a read that waited to be tried again is not needed.
      if (retry !== null) clearTimeout(retry);
      retry = null;
      const text = textOf(snapshot);
      let anchor = view.anchor;
      const next = snapshot.anchor;
      if (next === null) {
        anchor = null;
      } else if (relinking || anchorOrder(view.anchor, next) === "take") {
        // Newer than what is drawn (an event that came while the glass was
        // read is not: its anchor stays), or the first answer of a run.
        anchor = next;
        anchorAt = now();
        noteAnchorArrival(next, anchorAt);
      }
      relinking = false;
      show({ text, anchor, stoppedAfterMs: null, problem: deaf });
    } catch (error) {
      if (stopped) return;
      if (error instanceof EngineRequestError && error.code !== "ENGINE_EXITED") {
        show({ problem: error.message });
      } else {
        failed(error, "reading the glass");
      }
      readLater();
    } finally {
      reading = false;
      if (again && !stopped) {
        again = false;
        void read();
      }
    }
  };

  const hear = (event: EventEnvelope<EventName>) => {
    if (stopped) return;
    if (event.event === "engine.exited") {
      // The text stands where it is. Whether the hardware link is back is
      // asked once a second: an end can be told of a hardware link that has
      // been replaced already.
      if (view.anchor !== null && view.stoppedAfterMs === null) {
        show({ stoppedAfterMs: Math.max(now() - anchorAt, 0) });
      }
      run += 1;
      relinking = true;
      readLater();
      return;
    }
    if (event.event === "engine.ready") {
      run += 1;
      relinking = true;
      void read();
      return;
    }
    if (event.event !== "prompter.changed") return;
    // Since the end or the start, the read brings the truth.
    if (relinking) {
      void read();
      return;
    }
    const heardAt = now();
    const anchor = anchorOf(event.payload);
    const reason = typeof event.payload.reason === "string" ? event.payload.reason : "";
    if (anchor !== null && view.text !== null && anchor.layoutKey === view.text.layoutKey) {
      if (anchorOrder(view.anchor, anchor) === "take") {
        anchorAt = heardAt;
        noteAnchorArrival(anchor, anchorAt);
        show({ anchor, stoppedAfterMs: null });
      }
      if (MOVES_THE_TEXT.has(reason)) return;
    }
    void read();
  };

  // The glass is read at once, and again when the page listens: what the
  // prompter did between the two would be heard by nobody.
  void read();
  link.listen(hear).then(
    (stop) => {
      if (stopped) {
        stop();
        return;
      }
      stopListening = stop;
      void read();
    },
    (error: unknown) => {
      failed(error, "listening to the hardware link");
      if (stopped) return;
      deaf = CANNOT_HEAR;
      show({ problem: deaf });
    }
  );

  return () => {
    stopped = true;
    if (retry !== null) clearTimeout(retry);
    retry = null;
    stopListening?.();
  };
}
