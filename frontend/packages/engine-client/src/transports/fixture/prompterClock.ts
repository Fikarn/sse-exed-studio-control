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
  endOf,
  paragraphWordCount,
  readFlags,
  readWordsFrom,
  samePlace,
} from "./prompterModel";

// The scroll's clock as the hardware link runs it (`native/rust-engine/src/prompter/
// clock.rs`, new pages program, Slice 4). The view that draws the glass reports its
// layout (`prompter.layout.report`); the clock runs in those pixels and holds the
// place, the pace, playing or not, and the stop at `END`. Every change is an anchor
// a view draws the motion from (`../../prompter/motion.ts`). Time is `Date.now()`,
// so a page clock or Vitest's fake timers drive it.

/** Starting, stopping and changing the pace ease over 0.3 s. */
export const RAMP_MS = 300;
/** A jump moves the text in 0.2 s on the glass; the place is the target at once. */
export const JUMP_MOVE_MS = 200;
export const SPEED_MIN_WPM = 40;
export const SPEED_MAX_WPM = 300;
export const SPEED_STEP_WPM = 5;
export const SPEED_DEFAULT_WPM = 140;
/** A place this close to a line's top reads as that line's start. */
const AT_LINE_START = 0.02;

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
}

const byLine = (line: PrompterLayoutLine, place: PrompterPlace) =>
  comparePlaces({ paragraph: line.paragraph, word: line.word }, place);

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
  return { key, lines, endTop, pxPerReadWord: (textBottom - first.top) / Math.max(readWords, 1) };
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

/** Where the reading line stands for a place `fraction` of the way down its line; the end is `endTop`. */
export function positionOf(layout: Layout, place: PrompterPlace, fraction: number, paragraphCount: number): number {
  if (place.paragraph >= paragraphCount) return layout.endTop;
  const line = layout.lines[lastIndexWhere(layout.lines, (entry) => byLine(entry, place) <= 0)]!;
  return Math.min(line.top + Math.min(Math.max(fraction, 0), 1) * line.height, layout.endTop);
}

/** The place at the reading line when it stands at `position`, and how far down its line. */
export function placeAtPosition(layout: Layout, position: number, paragraphCount: number): [PrompterPlace, number] {
  if (position >= layout.endTop) return [{ paragraph: paragraphCount, word: 0 }, 0];
  const line = layout.lines[lastIndexWhere(layout.lines, (entry) => entry.top <= position)]!;
  const fraction = Math.min(Math.max((position - line.top) / line.height, 0), 0.999);
  return [{ paragraph: line.paragraph, word: line.word }, fraction];
}

/** One line on or back from `position`, keeping how far down the line the reading line stands. */
export function lineStep(layout: Layout, position: number, forward: boolean): number {
  const index = lastIndexWhere(layout.lines, (entry) => entry.top <= position);
  const line = layout.lines[index]!;
  const target = forward ? position + line.height : position - (layout.lines[index - 1] ?? line).height;
  return Math.min(Math.max(target, layout.lines[0]!.top), layout.endTop);
}

/** The motion from an anchor: where it stood, and the pace easing from one speed to another. */
export interface Motion {
  /** The anchor's moment, `Date.now()`. */
  at: number;
  place: PrompterPlace;
  /** How far down its line the place stands, 0 to 1. */
  fraction: number;
  fromWpm: number;
  toWpm: number;
  rampMs: number;
  /** A jump's start on the glass, drawn over `JUMP_MOVE_MS`. */
  moveFrom: number | null;
}

function resting(at: number, place: PrompterPlace, fraction: number): Motion {
  return { at, place, fraction, fromWpm: 0, toWpm: 0, rampMs: 0, moveFrom: null };
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
    this.motion = resting(now, clampedPlace(place, paragraphs), 0);
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

  /** The reading line's position at `now`, when laid out. */
  positionAt(now: number): number | null {
    const layout = this.layout;
    if (!layout) return null;
    const base = positionOf(layout, this.motion.place, this.motion.fraction, this.paragraphCount);
    return Math.min(base + wordsMoved(this.motion, this.elapsedMs(now)) * layout.pxPerReadWord, layout.endTop);
  }

  /** The place at `now` and how far down its line: from the layout, else by counting the read words moved. */
  placeAt(now: number): [PrompterPlace, number] {
    const position = this.positionAt(now);
    if (position !== null && this.layout) return placeAtPosition(this.layout, position, this.paragraphCount);
    const advanced = wordsMoved(this.motion, this.elapsedMs(now));
    if (advanced < 1) return [this.motion.place, this.motion.fraction];
    return [advanceByReadWords(this.paragraphs, this.motion.place, Math.floor(advanced)), 0];
  }

  atEnd(now: number): boolean {
    return this.placeAt(now)[0].paragraph >= this.paragraphCount;
  }

  /** Folds the motion so far into a new anchor at `now`, keeping the pace and what is left of an ease. */
  private rebase(now: number) {
    const elapsed = this.elapsedMs(now);
    const [place, fraction] = this.placeAt(now);
    this.motion = {
      at: now,
      place,
      fraction,
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

  /** A jump: the place is the target at once, the glass draws a 0.2 s move, the scroll goes on — or stops for `TOP`. */
  jump(now: number, place: PrompterPlace, fraction: number, pause: boolean) {
    const from = this.positionAt(now);
    if (pause) this.playing = false;
    const speed = this.playing ? this.speedWpm : 0;
    this.motion = {
      at: now,
      place: clampedPlace(place, this.paragraphs),
      fraction,
      fromWpm: speed,
      toWpm: speed,
      rampMs: 0,
      moveFrom: from,
    };
  }

  /** The glass is to be laid out again: the words at the reading line are kept, the motion goes on in words. */
  relayout(now: number, layoutKey: string) {
    this.rebase(now);
    this.layout = null;
    this.layoutKey = layoutKey;
  }

  /** New text on the glass (an Update): the place is `place` in the new text, the scroll goes on as it was. */
  replaceText(now: number, paragraphs: readonly PrompterParagraph[], layoutKey: string, place: PrompterPlace) {
    const [, fraction] = this.placeAt(now);
    this.rebase(now);
    this.paragraphs = paragraphs;
    this.motion.place = clampedPlace(place, paragraphs);
    this.motion.fraction = samePlace(place, this.motion.place) ? fraction : 0;
    this.layout = null;
    this.layoutKey = layoutKey;
  }

  /** A reported layout for the glass as it is now: the anchor moves into its pixels, the motion so far kept. */
  acceptLayout(now: number, layout: Layout) {
    const elapsed = this.elapsedMs(now);
    const base = positionOf(layout, this.motion.place, this.motion.fraction, this.paragraphCount);
    const position = Math.min(base + wordsMoved(this.motion, elapsed) * layout.pxPerReadWord, layout.endTop);
    const [place, fraction] = placeAtPosition(layout, position, this.paragraphCount);
    this.motion = {
      at: now,
      place,
      fraction,
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
    this.motion = resting(now, endOf(this.paragraphs), 0);
    return true;
  }

  /** How long until the text reaches `END` at the motion it has; `null` when it does not move or is not laid out. */
  timeToEndMs(now: number): number | null {
    const layout = this.layout;
    const started = this.elapsedMs(now);
    if (!layout || !moving(this.motion, started) || this.motion.toWpm <= 0) return null;
    const base = positionOf(layout, this.motion.place, this.motion.fraction, this.paragraphCount);
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
    return [(readWordsFrom(this.paragraphs, this.placeAt(now)[0]) * 60) / wordsAMinute, true];
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
      place: { ...this.motion.place },
      lineFraction: this.motion.fraction,
      position: layout ? positionOf(layout, this.motion.place, this.motion.fraction, this.paragraphCount) : null,
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

  /** Whether the reading line stands at the start of its line. */
  atLineStart(now: number): boolean {
    return this.placeAt(now)[1] < AT_LINE_START;
  }
}
