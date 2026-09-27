import type {
  PrompterCue,
  PrompterGlassSnapshot,
  PrompterGlassSummary,
  PrompterHealthCheck,
  PrompterLook,
  PrompterScriptSummary,
  PrompterSnapshot,
} from "@sse/engine-client";

import { glassParagraphs, type GlassParagraph } from "./glass/glassText";
import type { PrompterGlassText } from "./glass/PrompterGlass";
import { formatDuration } from "./prompterTime";

// The Teleprompter page's model (new pages program, Slice 6a): what the page
// shows, worked out from what the hardware link reports — the prompter's state
// (`prompter.snapshot`), the text on the glass (`prompter.glass.snapshot`) and
// the Prompter XL's check (`health.snapshot`'s `checks.prompter`). Nothing
// here is a state of its own: the words and sentences for the Prompter XL and
// for `NOT UPDATED` are the hardware link's, and the rest (`ON SCREEN`,
// `READY`, the place, the lengths) is read from its figures (the proposal §5,
// §8). Pure functions, so the page's logic is tested without a browser.

export type PrompterTone = "ok" | "attention" | "error";

export interface PrompterStateView {
  tone: PrompterTone;
  word: string;
  sentence: string;
  /** The Prompter XL's mode (`1920×1080 · 60 Hz`), while Windows sees it. */
  meta: string | null;
  /** The way out the state display offers (§8): Update, or Put on the prompter. */
  wayOut: "update" | "put-on" | null;
}

/** The state display (§8): the Prompter XL's fault first, then `NOT UPDATED`, `LOW RESOLUTION`, `ON SCREEN`, `READY`. */
export function prompterStateView(
  snapshot: PrompterSnapshot,
  check: PrompterHealthCheck | null,
  hasScripts: boolean
): PrompterStateView {
  const { screen, glass } = snapshot;
  const meta = screenMode(snapshot);
  if (!screen.draws) {
    return { tone: toneOf(screen.tone), word: screen.word, sentence: screen.sentence, meta, wayOut: null };
  }
  if (glass?.notUpdated) {
    const sentence =
      check?.word === "NOT UPDATED"
        ? check.summary
        : `${glass.name} was edited after it went on the prompter. The prompter still shows the earlier text.`;
    return { tone: "attention", word: "NOT UPDATED", sentence, meta, wayOut: "update" };
  }
  if (screen.tone !== "ok") {
    return { tone: toneOf(screen.tone), word: screen.word, sentence: screen.sentence, meta, wayOut: null };
  }
  if (glass) {
    const doing = glass.playing
      ? `Playing at ${glass.speedWpm} words a minute.`
      : glass.atEnd
        ? "At the end."
        : `Paused at paragraph ${Math.min(glass.place.paragraph + 1, glass.paragraphCount)} of ${glass.paragraphCount}.`;
    return {
      tone: "ok",
      word: "ON SCREEN",
      sentence: `The Prompter XL shows ${glass.name}. ${doing}`,
      meta,
      wayOut: null,
    };
  }
  return {
    tone: "ok",
    word: "READY",
    sentence: hasScripts
      ? "The Prompter XL is connected and blank. Choose a script and put it on the prompter."
      : "The Prompter XL is connected and blank. Open a script's file to put it on the prompter.",
    meta,
    wayOut: hasScripts ? "put-on" : null,
  };
}

function toneOf(tone: string): PrompterTone {
  return tone === "error" ? "error" : tone === "attention" ? "attention" : "ok";
}

/** `1920×1080 · 60 Hz`, or `1920×1080`, while Windows sees the Prompter XL; `null` otherwise. */
export function screenMode(snapshot: PrompterSnapshot): string | null {
  const { screen } = snapshot;
  if (screen.width === null || screen.height === null) return null;
  const size = `${screen.width}×${screen.height}`;
  return screen.refreshHz === null ? size : `${size} · ${screen.refreshHz} Hz`;
}

/**
 * The text the page's copy of the glass draws: the glass's own text with the
 * look it was laid out in, and the take's colours from the current look. The
 * text arrives with its layout key, so the geometry that decides the key
 * (the size, the spacing, the margins, the numbers) comes with it, and the
 * copy never draws one text in another text's key; the colour, the dimming
 * and the reading line need no new layout and come from the current look.
 */
export function glassTextOf(
  snapshot: PrompterSnapshot | null,
  glassSnapshot: PrompterGlassSnapshot | null
): PrompterGlassText | null {
  if (!snapshot?.glass || !glassSnapshot?.layoutKey) return null;
  const look: PrompterLook = {
    ...snapshot.look,
    standardSizePx: glassSnapshot.look.standardSizePx,
    lineSpacingPercent: glassSnapshot.look.lineSpacingPercent,
    marginPercent: glassSnapshot.look.marginPercent,
    paragraphNumbers: glassSnapshot.look.paragraphNumbers,
  };
  return {
    layoutKey: glassSnapshot.layoutKey,
    paragraphs: glassSnapshot.paragraphs,
    look,
    sizePx: glassSnapshot.sizePx,
  };
}

/** Each paragraph's read words (cues are directions, never read aloud), by the hardware link's rules. */
export function readWordsOf(paragraphs: readonly GlassParagraph[]): number[] {
  return paragraphs.map((paragraph) =>
    paragraph.lines.reduce(
      (sum, line) => sum + line.tokens.filter((token) => token.kind === "word" && !token.word.cue).length,
      0
    )
  );
}

/** The read words before a word of a paragraph. */
function readWordsBefore(paragraph: GlassParagraph, word: number): number {
  let count = 0;
  for (const line of paragraph.lines) {
    for (const token of line.tokens) {
      if (token.kind === "word" && token.word.index < word && !token.word.cue) count += 1;
    }
  }
  return count;
}

export interface PlaceView {
  /** `¶ 8 of 18 · 44 %`, or `END`. */
  text: string;
  /** The share of the read words before the reading line, 0..1. */
  share: number;
}

/** The place as the page prints it (§5.2): the paragraph, and how far into the script's read words. */
export function placeView(glass: PrompterGlassSummary, text: readonly GlassParagraph[]): PlaceView {
  if (glass.atEnd || glass.place.paragraph >= glass.paragraphCount) {
    return { text: "END", share: 1 };
  }
  const words = readWordsOf(text);
  const total = words.reduce((sum, count) => sum + count, 0);
  const paragraph = text[glass.place.paragraph];
  const before =
    words.slice(0, glass.place.paragraph).reduce((sum, count) => sum + count, 0) +
    (paragraph ? readWordsBefore(paragraph, glass.place.word) : 0);
  const share = total > 0 ? Math.min(before / total, 1) : 0;
  return {
    text: `¶ ${glass.place.paragraph + 1} of ${glass.paragraphCount} · ${Math.round(share * 100)} %`,
    share,
  };
}

export interface ParagraphRow {
  index: number;
  /** A cue that opens the paragraph on a line of its own, brackets kept, drawn in the cue colour. */
  cue: string | null;
  /** The paragraph's words after it, on one line. */
  text: string;
  /** How long it reads at the pace, `0:14`. */
  length: string;
}

/** The cluster's paragraph list: one row a paragraph, the cue that opens it apart. */
export function paragraphRows(text: readonly GlassParagraph[], speedWpm: number): ParagraphRow[] {
  const words = readWordsOf(text);
  return text.map((paragraph, index) => {
    const lines = paragraph.lines.map((line) => ({
      cueLine: line.cueLine,
      text: line.tokens
        .map((token) => (token.kind === "space" ? " " : token.word.pieces.map((piece) => piece.text).join("")))
        .join(""),
    }));
    const opening = lines[0]?.cueLine ? lines[0].text : null;
    const rest = (opening !== null ? lines.slice(1) : lines).map((line) => line.text).filter(Boolean);
    return {
      index,
      cue: opening,
      text: rest.join(" "),
      length: formatDuration(speedWpm > 0 ? (words[index] * 60) / speedWpm : 0),
    };
  });
}

/**
 * The paragraphs the list has room for, around the place: all of them when
 * they fit, else a window that keeps the place's paragraph in view (a list
 * never scrolls, system §10).
 */
export function paragraphWindow(count: number, place: number, room: number): { from: number; to: number } {
  if (count <= room) return { from: 0, to: count };
  const before = Math.floor(room / 3);
  const from = Math.min(Math.max(place - before, 0), count - room);
  return { from, to: from + room };
}

export interface ScriptBarSegment {
  index: number;
  /** Its share of the bar, 0..1: its read words, and never less than a sliver. */
  share: number;
  /** Already read: before the paragraph at the reading line. */
  read: boolean;
}

/** The whole script at one width (§6.2): a segment a paragraph in proportion to its read words. */
export function scriptBar(text: readonly GlassParagraph[], placeParagraph: number): ScriptBarSegment[] {
  const words = readWordsOf(text).map((count) => Math.max(count, 1));
  const total = words.reduce((sum, count) => sum + count, 0);
  return words.map((count, index) => ({ index, share: count / total, read: index < placeParagraph }));
}

/** Where a paragraph starts on the script bar, 0..1. */
export function barStart(segments: readonly ScriptBarSegment[], paragraph: number): number {
  return segments.slice(0, paragraph).reduce((sum, segment) => sum + segment.share, 0);
}

/** The paragraph under a press on the bar, `fraction` 0..1 across it. */
export function paragraphAt(segments: readonly ScriptBarSegment[], fraction: number): number {
  let edge = 0;
  for (const segment of segments) {
    edge += segment.share;
    if (fraction < edge) return segment.index;
  }
  return Math.max(segments.length - 1, 0);
}

/** The cue keys under the copy: the first 24, in order (§6.2). */
export function cueKeys(cues: readonly PrompterCue[]): PrompterCue[] {
  return cues.slice(0, 24);
}

/** `4:19 at 140 · 581 words` */
export function scriptLine(script: PrompterScriptSummary): string {
  return `${formatDuration(script.lengthSeconds)} at ${script.speedWpm} · ${script.readWords.toLocaleString("en-GB")} words`;
}

/** `14:02`, the studio's local time of a saved-data time. */
export function clockTime(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

/** The plate's line under the script's name. */
export function scriptDetail(script: PrompterScriptSummary): string {
  const from = script.sourceFileName ? `From ${script.sourceFileName} · ` : "";
  const paragraphs = `${script.paragraphCount} ${script.paragraphCount === 1 ? "paragraph" : "paragraphs"}`;
  const saved = clockTime(script.changedAt);
  return `${from}${paragraphs} · ${scriptLine(script)}${saved ? ` · saved ${saved}` : ""}`;
}

/** Cut the glass's text once, as the glass does (`glassText.ts`). */
export function cutGlassText(glassSnapshot: PrompterGlassSnapshot | null): GlassParagraph[] {
  return glassSnapshot ? glassParagraphs(glassSnapshot.paragraphs) : [];
}

/** Why the take's keys are locked, or `null` (§8: every run key locks while nothing is on the prompter). */
export function runLockReason(snapshot: PrompterSnapshot | null): string | null {
  return snapshot?.glass ? null : "Nothing is on the prompter. Put a script on it first.";
}

/** Why `PLAY` is locked, or `null`: nothing on, nothing drawn on the glass, the end, no layout yet. */
export function playLockReason(snapshot: PrompterSnapshot | null): string | null {
  const nothing = runLockReason(snapshot);
  if (nothing || !snapshot?.glass) return nothing;
  const { glass, screen } = snapshot;
  if (glass.playing) return null;
  if (!screen.draws) return screen.sentence;
  if (glass.atEnd) return "At the end. A jump back to an earlier place unlocks PLAY.";
  if (!glass.laidOut) return "The text is being laid out on the glass.";
  return null;
}

/** The time left over the copy (§5.3): `2:30`, `of 4:19`, and `ends 14:31` while playing or `if played from here` while paused. */
export function timeLeftParts(
  glass: PrompterGlassSummary,
  timeLeftSeconds: number,
  now: Date
): { left: string; of: string; ends: string | null } {
  const ends = glass.playing
    ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
        new Date(now.getTime() + timeLeftSeconds * 1000)
      )
    : null;
  return {
    left: formatDuration(timeLeftSeconds),
    of: `of ${formatDuration(glass.lengthSeconds)}`,
    ends: ends !== null ? `ends ${ends}` : glass.atEnd ? null : "if played from here",
  };
}
