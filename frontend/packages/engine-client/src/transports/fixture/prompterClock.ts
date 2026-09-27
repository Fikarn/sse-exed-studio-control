// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { PrompterAnchor } from "../../generated/snapshots/PrompterAnchor";
import type { PrompterLayoutLine } from "../../generated/snapshots/PrompterLayoutLine";
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import type { PrompterPlace } from "../../generated/snapshots/PrompterPlace";
import { speedAt, wordsAdvanced } from "../../prompter/motion";
import {
  TOP,
  advanceByReadWords,
  clampedPlace,
  comparePlaces,
  paragraphWordCount,
  readFlags,
  readWordsFrom,
} from "./prompterModel";

// The scroll's clock as the hardware link runs it (`native/rust-engine/src/prompter/
// clock.rs`, new pages program, Slice 4). The view that draws the glass reports its
// layout (`prompter.layout.report`); the clock runs in those pixels and holds the
// place, the pace, playing or not, and the stop at `END`. Every change is an anchor
// a view draws the motion from (`../../prompter/motion.ts`). Time is `Date.now()`,
// so a page clock or Vitest's fake timers drive it.
//
// Words, not lines, carry the place from one layout to the next (review of
// 2026-09-27): the place is a paragraph and a word offset in it (6.5 is halfway
// through its seventh word), and inside a line the reading line's height is taken as
// a share of the line's words, so a new size keeps the words at the reading line.

/** Starting, stopping and changing the pace ease over 0.3 s. */
export const RAMP_MS = 300;
/** A jump moves the text in 0.2 s on the glass; the place is the target at once. */
export const JUMP_MOVE_MS = 200;
export const SPEED_MIN_WPM = 40;
export const SPEED_MAX_WPM = 300;
export const SPEED_STEP_WPM = 5;
export const SPEED_DEFAULT_WPM = 140;
/** Two word offsets this close are the same place (a cue at the reading line is not "the next cue"). */
const SAME_PLACE = 0.02;

/** A pace inside 40–300 words a minute on a 5-word step. */
export function speedIsValid(speedWpm: number): boolean {
  return (
    Number.isInteger(speedWpm) &&
    speedWpm >= SPEED_MIN_WPM &&
    speedWpm <= SPEED_MAX_WPM &&
    speedWpm % SPEED_STEP_WPM === 0
  );
}

/** A reported layout, checked against the text it lays out. */
export interface Layout {
  key: string;
  lines: PrompterLayoutLine[];
  /** Where the reading line stands when `END` reaches it. */
  endTop: number;
  /** The layout's height per read word: the pace's pixels. */
  pxPerReadWord: number;
  /** Each paragraph's words, cues included, for the words of a line. */
  paragraphWords: number[];
}

const byLine = (line: PrompterLayoutLine, place: PrompterPlace) =>
  comparePlaces({ paragraph: line.paragraph, word: line.word }, place);

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** `f64::fract` of a number that is not negative. */
const fract = (value: number) => value - Math.floor(value);

/**
 * Checks a report against the text on the glass (`Layout::new`): at least one line;
 * lines in order, each with a height, each paragraph's first line at its first word,
 * every line's word inside its paragraph; `END` below the last line. Anything else is
 * the hardware link's sentence.
 */
export function newLayout(
  key: string,
  lines: PrompterLayoutLine[],
  endTop: number,
  paragraphs: readonly PrompterParagraph[]
): Layout | string {
  const first = lines[0];
  if (!first) return "The layout has no lines.";
  if (first.paragraph !== 0 || first.word !== 0) return "The layout's first line must start the first paragraph.";
  const wordCounts = paragraphs.map(paragraphWordCount);
  let previous: PrompterLayoutLine | null = null;
  let paragraphsStarted = 0;
  for (const line of lines) {
    const finite = Number.isFinite(line.top) && Number.isFinite(line.height);
    if (!finite || line.top < 0 || line.height <= 0 || line.height > 10_000) {
      return "Each line of the layout needs a top and a height in pixels.";
    }
    const words = wordCounts[line.paragraph];
    if (words === undefined) {
      return `The layout names paragraph ${line.paragraph + 1}, and the text on the glass has ${paragraphs.length}.`;
    }
    if (line.word > 0 && line.word >= words) {
      return `The layout starts a line at word ${line.word + 1} of paragraph ${line.paragraph + 1}, which has ${words}.`;
    }
    if (previous) {
      const inOrder =
        byLine(line, { paragraph: previous.paragraph, word: previous.word }) > 0 &&
        line.top >= previous.top + previous.height - 0.5;
      if (!inOrder) return "The layout's lines are not in order.";
    }
    if (previous === null || previous.paragraph !== line.paragraph) {
      if (line.paragraph !== paragraphsStarted || line.word !== 0) {
        return `The layout must start paragraph ${paragraphsStarted + 1} on a line of its own.`;
      }
      paragraphsStarted += 1;
    }
    previous = line;
  }
  if (paragraphsStarted !== paragraphs.length) {
    return `The layout lays out ${paragraphsStarted} paragraphs, and the text on the glass has ${paragraphs.length}.`;
  }
  const last = lines[lines.length - 1]!;
  const textBottom = last.top + last.height;
  if (!Number.isFinite(endTop) || endTop < textBottom - 0.5) return "The layout's END must stand below its last line.";
  const readWords = paragraphs.reduce((sum, paragraph) => sum + readFlags(paragraph).filter(Boolean).length, 0);
  // A script of cues alone has no read word: it is paced by all its words, so it does not
  // run through in one word's time (review of 2026-09-27).
  const paceWords = readWords > 0 ? readWords : wordCounts.reduce((sum, words) => sum + words, 0);
  return {
    key,
    lines,
    endTop,
    pxPerReadWord: (textBottom - first.top) / Math.max(paceWords, 1),
    paragraphWords: wordCounts,
  };
}

/** How many of the (sorted) lines pass `predicate`, less one, and never below 0: `partition_point(…).saturating_sub(1)`. */
function lastIndexWhere(lines: PrompterLayoutLine[], predicate: (line: PrompterLayoutLine) => boolean): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (predicate(lines[middle]!)) low = middle + 1;
    else high = middle;
  }
  return Math.max(low - 1, 0);
}

/** The index of the line that holds word `word` of `paragraph`: the last line starting at or before it. */
const lineOf = (layout: Layout, paragraph: number, word: number) =>
  lastIndexWhere(layout.lines, (entry) => byLine(entry, { paragraph, word }) <= 0);

/** The index of the line at the reading line when it stands at `position`. */
const lineAt = (layout: Layout, position: number) => lastIndexWhere(layout.lines, (entry) => entry.top <= position);

/** How many words line `index` holds: up to the next line of its paragraph, else to the paragraph's end; at least one. */
export function lineWords(layout: Layout, index: number): number {
  const line = layout.lines[index]!;
  const next = layout.lines[index + 1];
  const until =
    next !== undefined && next.paragraph === line.paragraph
      ? next.word
      : (layout.paragraphWords[line.paragraph] ?? line.word + 1);
  return Math.max(until - line.word, 1);
}

/** Where the reading line stands when it is `wordOffset` words into `paragraph`; the end is `endTop`. */
export function positionOf(layout: Layout, paragraph: number, wordOffset: number, paragraphCount: number): number {
  if (paragraph >= paragraphCount) return layout.endTop;
  const offset = Math.max(wordOffset, 0);
  const index = lineOf(layout, paragraph, Math.floor(offset));
  const line = layout.lines[index]!;
  const share = clamp((offset - line.word) / lineWords(layout, index), 0, 1);
  return Math.min(line.top + share * line.height, layout.endTop);
}

/**
 * The paragraph and the word offset at the reading line when it stands at `position`
 * (`Layout::words_at`); the end is the paragraph after the last.
 */
export function wordsAtPosition(layout: Layout, position: number, paragraphCount: number): [number, number] {
  if (position >= layout.endTop) return [paragraphCount, 0];
  const index = lineAt(layout, position);
  const line = layout.lines[index]!;
  const share = clamp((position - line.top) / line.height, 0, 0.999);
  return [line.paragraph, line.word + share * lineWords(layout, index)];
}

/** The first word of the line at the reading line when it stands at `position` (`Layout::line_start_at`). */
export function lineStartAtPosition(layout: Layout, position: number): number {
  return layout.lines[lineAt(layout, position)]!.word;
}

/** One line on or back from `position`, keeping how far down the line the reading line stands. */
export function lineStep(layout: Layout, position: number, forward: boolean): number {
  const index = lineAt(layout, position);
  const line = layout.lines[index]!;
  const target = forward ? position + line.height : position - (layout.lines[index - 1] ?? line).height;
  return clamp(target, layout.lines[0]!.top, layout.endTop);
}

/** Whether the cue at `cue` (a paragraph and a word) stands after `here` (a paragraph and a word offset) by more than `SAME_PLACE`. */
export function cueAfter(cue: readonly [number, number], here: readonly [number, number]): boolean {
  return cue[0] > here[0] || (cue[0] === here[0] && cue[1] > here[1] + SAME_PLACE);
}

/** Whether the cue at `cue` stands before `here` by more than `SAME_PLACE`. */
export function cueBefore(cue: readonly [number, number], here: readonly [number, number]): boolean {
  return cue[0] < here[0] || (cue[0] === here[0] && cue[1] < here[1] - SAME_PLACE);
}

/** The motion from an anchor: where it stood, and the pace easing from one speed to another. */
export interface Motion {
  /** The anchor's moment, `Date.now()`. */
  at: number;
  paragraph: number;
  /** How far into the paragraph the reading line stands, in words: 6.5 is halfway through its seventh word. */
  wordOffset: number;
  fromWpm: number;
  toWpm: number;
  rampMs: number;
  /** A jump's start on the glass, drawn over `JUMP_MOVE_MS`. */
  moveFrom: number | null;
}

function resting(at: number, paragraph: number, wordOffset: number): Motion {
  return { at, paragraph, wordOffset, fromWpm: 0, toWpm: 0, rampMs: 0, moveFrom: null };
}

const pace = (motion: Motion) => ({ fromWpm: motion.fromWpm, toWpm: motion.toWpm, rampMs: motion.rampMs, ageMs: 0 });
const wordsMoved = (motion: Motion, elapsedMs: number) => wordsAdvanced(pace(motion), elapsedMs);
const speedOf = (motion: Motion, elapsedMs: number) => speedAt(pace(motion), elapsedMs);
const moving = (motion: Motion, elapsedMs: number) => speedOf(motion, elapsedMs) > 0 || motion.toWpm > 0;

/** The clock of the script on the glass (`GlassClock`). */
export class GlassClock {
  layout: Layout | null = null;
  playing = false;
  motion: Motion;

  private constructor(
    public scriptId: string,
    /** The text as it went on the glass. */
    public paragraphs: readonly PrompterParagraph[],
    /** The layout the view must report for the glass as it is now. */
    public layoutKey: string,
    /** The script's own pace. */
    public speedWpm: number,
    now: number,
    place: PrompterPlace
  ) {
    const start = clampedPlace(place, paragraphs);
    this.motion = resting(now, start.paragraph, start.word);
  }

  /** A clock standing at `place`, paused: how every start leaves it. */
  static paused(
    now: number,
    scriptId: string,
    paragraphs: readonly PrompterParagraph[],
    layoutKey: string,
    place: PrompterPlace,
    speedWpm: number
  ): GlassClock {
    return new GlassClock(scriptId, paragraphs, layoutKey, speedWpm, now, place);
  }

  get paragraphCount(): number {
    return this.paragraphs.length;
  }

  private elapsedMs(now: number): number {
    return Math.max(now - this.motion.at, 0);
  }

  /** The anchor's position in the layout, when laid out. */
  private anchorPosition(): number | null {
    const layout = this.layout;
    return layout ? positionOf(layout, this.motion.paragraph, this.motion.wordOffset, this.paragraphCount) : null;
  }

  /** The reading line's position at `now`, when laid out. */
  positionAt(now: number): number | null {
    const layout = this.layout;
    const base = this.anchorPosition();
    if (!layout || base === null) return null;
    return Math.min(base + wordsMoved(this.motion, this.elapsedMs(now)) * layout.pxPerReadWord, layout.endTop);
  }

  /**
   * The paragraph and the word offset at the reading line at `now`: from the layout when
   * there is one, else by counting the read words the text has moved.
   */
  wordsAt(now: number): [number, number] {
    const position = this.positionAt(now);
    if (position !== null && this.layout) return wordsAtPosition(this.layout, position, this.paragraphCount);
    const advanced = wordsMoved(this.motion, this.elapsedMs(now));
    const offset = Math.max(this.motion.wordOffset, 0);
    const travelled = fract(offset) + advanced;
    if (travelled < 1) return [this.motion.paragraph, offset + advanced];
    const start = { paragraph: this.motion.paragraph, word: Math.floor(offset) };
    const reached = advanceByReadWords(this.paragraphs, start, Math.floor(travelled));
    if (reached.paragraph >= this.paragraphCount) return [this.paragraphCount, 0];
    return [reached.paragraph, reached.word + fract(travelled)];
  }

  /** The place at `now`: the paragraph and the word at the reading line. */
  placeAt(now: number): PrompterPlace {
    const [paragraph, offset] = this.wordsAt(now);
    return { paragraph, word: Math.floor(offset) };
  }

  /** Where the text will stand when the ease under way is over: what a pause saves (review of 2026-09-27). */
  restingPlace(now: number): PrompterPlace {
    const left = Math.max(this.motion.rampMs - this.elapsedMs(now), 0);
    return this.placeAt(now + left);
  }

  atEnd(now: number): boolean {
    return this.wordsAt(now)[0] >= this.paragraphCount;
  }

  /**
   * The first word of the line at the reading line: `BACK`'s "first line of the
   * paragraph" is the line starting at word 0. Without a layout, the word at the reading line.
   */
  lineStartAt(now: number): number {
    const position = this.positionAt(now);
    if (position !== null && this.layout) return lineStartAtPosition(this.layout, position);
    return this.placeAt(now).word;
  }

  /** Folds the motion so far into a new anchor at `now`, keeping the pace and what is left of an ease. */
  private rebase(now: number) {
    const elapsed = this.elapsedMs(now);
    const [paragraph, wordOffset] = this.wordsAt(now);
    this.motion = {
      at: now,
      paragraph,
      wordOffset,
      fromWpm: speedOf(this.motion, elapsed),
      toWpm: this.motion.toWpm,
      rampMs: Math.max(this.motion.rampMs - elapsed, 0),
      moveFrom: null,
    };
  }

  /** `PLAY`: from where the reading line is, easing up to the pace. The caller refuses it at the end or unlaid. */
  play(now: number) {
    this.rebase(now);
    this.motion.toWpm = this.speedWpm;
    this.motion.rampMs = RAMP_MS;
    this.playing = true;
  }

  /** Pause: the text eases to a stop over 0.3 s. */
  pause(now: number) {
    if (!this.playing) return;
    this.rebase(now);
    this.motion.toWpm = 0;
    this.motion.rampMs = RAMP_MS;
    this.playing = false;
  }

  /** A new pace: eased to at once while playing, else kept for the next play. */
  setSpeed(now: number, speedWpm: number) {
    this.speedWpm = speedWpm;
    if (this.playing) {
      this.rebase(now);
      this.motion.toWpm = speedWpm;
      this.motion.rampMs = RAMP_MS;
    }
  }

  /**
   * A jump to `wordOffset` words into `paragraph`: the place is the target at once, the
   * glass draws a 0.2 s move, the scroll goes on — or stops for `TOP` (`pause`).
   */
  jump(now: number, paragraph: number, wordOffset: number, pause: boolean) {
    const from = this.positionAt(now);
    if (pause) this.playing = false;
    const speed = this.playing ? this.speedWpm : 0;
    const [target, offset] = this.clamped(paragraph, wordOffset);
    this.motion = {
      at: now,
      paragraph: target,
      wordOffset: offset,
      fromWpm: speed,
      toWpm: speed,
      rampMs: 0,
      moveFrom: from,
    };
  }

  /** A word offset the text on the glass has: inside its paragraph, or the end. */
  private clamped(paragraph: number, wordOffset: number): [number, number] {
    if (paragraph >= this.paragraphCount) return [this.paragraphCount, 0];
    const words = paragraphWordCount(this.paragraphs[paragraph]!);
    return [paragraph, clamp(wordOffset, 0, Math.max(words - 0.001, 0))];
  }

  /** Stops the text where it is, at once: after a restore (D12). */
  hold(now: number) {
    const [paragraph, wordOffset] = this.wordsAt(now);
    this.playing = false;
    this.motion = resting(now, paragraph, wordOffset);
  }

  /** The glass is to be laid out again: the words at the reading line are kept, the motion goes on in words. */
  relayout(now: number, layoutKey: string) {
    this.rebase(now);
    this.layout = null;
    this.layoutKey = layoutKey;
  }

  /**
   * New text on the glass (an Update): the reading line stands at `place` in the new
   * text — `keepShare` when that is the same word it was reading, so the share of the
   * word it had stays — the scroll goes on as it was, and the layout waits for the view.
   */
  replaceText(
    now: number,
    paragraphs: readonly PrompterParagraph[],
    layoutKey: string,
    place: PrompterPlace,
    keepShare: boolean
  ) {
    this.rebase(now);
    const share = keepShare ? fract(this.motion.wordOffset) : 0;
    this.paragraphs = paragraphs;
    const [paragraph, wordOffset] = this.clamped(place.paragraph, place.word + share);
    this.motion.paragraph = paragraph;
    this.motion.wordOffset = wordOffset;
    this.layout = null;
    this.layoutKey = layoutKey;
  }

  /** A reported layout for the glass as it is now: the anchor moves into its pixels, the motion so far kept. */
  acceptLayout(now: number, layout: Layout) {
    const elapsed = this.elapsedMs(now);
    const base = positionOf(layout, this.motion.paragraph, this.motion.wordOffset, this.paragraphCount);
    const position = Math.min(base + wordsMoved(this.motion, elapsed) * layout.pxPerReadWord, layout.endTop);
    const [paragraph, wordOffset] = wordsAtPosition(layout, position, this.paragraphCount);
    this.motion = {
      at: now,
      paragraph,
      wordOffset,
      fromWpm: speedOf(this.motion, elapsed),
      toWpm: this.motion.toWpm,
      rampMs: Math.max(this.motion.rampMs - elapsed, 0),
      moveFrom: null,
    };
    this.layout = layout;
  }

  /** Stops the text at `END` once the reading line reached it: `PLAY` goes out. True when it stopped now. */
  settle(now: number): boolean {
    if (!moving(this.motion, this.elapsedMs(now)) || !this.atEnd(now)) return false;
    this.playing = false;
    this.motion = resting(now, this.paragraphCount, 0);
    return true;
  }

  /** How long until the text reaches `END` at the motion it has; `null` when it does not move or is not laid out. */
  timeToEndMs(now: number): number | null {
    const layout = this.layout;
    const base = this.anchorPosition();
    const started = this.elapsedMs(now);
    if (!layout || base === null || !moving(this.motion, started) || this.motion.toWpm <= 0) return null;
    const reached = (elapsed: number) =>
      base + wordsMoved(this.motion, elapsed) * layout.pxPerReadWord >= layout.endTop;
    if (reached(started)) return 0;
    let high = started + 1000;
    while (!reached(high)) {
      high = started + (high - started) * 2;
      if (high - started > 1e9) return null;
    }
    let low = started;
    for (let step = 0; step < 60; step += 1) {
      const middle = (low + high) / 2;
      if (reached(middle)) high = middle;
      else low = middle;
    }
    return high - started;
  }

  /** The time left until `END` reaches the reading line at the pace, in seconds, and whether it is estimated. */
  timeLeft(now: number): [number, boolean] {
    const wordsAMinute = Math.max(this.speedWpm, 1);
    const position = this.positionAt(now);
    if (position !== null && this.layout) {
      const pixelsASecond = (this.layout.pxPerReadWord * wordsAMinute) / 60;
      return [Math.max((this.layout.endTop - position) / pixelsASecond, 0), false];
    }
    return [(readWordsFrom(this.paragraphs, this.placeAt(now)) * 60) / wordsAMinute, true];
  }

  /** The whole script's length at its pace, from the top to `END`. */
  length(): [number, boolean] {
    const wordsAMinute = Math.max(this.speedWpm, 1);
    if (this.layout) {
      const pixelsASecond = (this.layout.pxPerReadWord * wordsAMinute) / 60;
      return [(this.layout.endTop - this.layout.lines[0]!.top) / pixelsASecond, false];
    }
    return [(readWordsFrom(this.paragraphs, TOP) * 60) / wordsAMinute, true];
  }

  /** The anchor as a view reads it at `now`. */
  anchor(now: number): PrompterAnchor {
    const layout = this.layout;
    return {
      layoutKey: this.layoutKey,
      place: { paragraph: this.motion.paragraph, word: Math.floor(Math.max(this.motion.wordOffset, 0)) },
      wordOffset: this.motion.wordOffset,
      position: this.anchorPosition(),
      endPosition: layout ? layout.endTop : null,
      pxPerReadWord: layout ? layout.pxPerReadWord : null,
      playing: this.playing,
      atEnd: this.atEnd(now),
      fromWpm: this.motion.fromWpm,
      toWpm: this.motion.toWpm,
      rampMs: this.motion.rampMs,
      moveFromPosition: this.motion.moveFrom,
      moveMs: this.motion.moveFrom !== null ? JUMP_MOVE_MS : 0,
      ageMs: this.elapsedMs(now),
    };
  }
}
