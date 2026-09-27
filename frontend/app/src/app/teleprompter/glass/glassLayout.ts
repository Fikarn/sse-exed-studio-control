import type { PrompterLayoutLine, PrompterLook } from "@sse/engine-client";

import type { GlassParagraph } from "./glassText";

// The glass's geometry and its layout (new pages program, Slice 5a). The glass
// is the Prompter XL's own screen, 1920×1080, laid out at that width in CSS
// pixels whatever size it is drawn at, so the glass on the Prompter XL and the
// page's copy of it break every line alike. Its layout is what the hardware
// link's clock runs on (`prompter.layout.report`, Slice 4): every line's
// paragraph, first word, top and height, and where the reading line stands
// when `END` reaches it. The helpers below mirror `Layout` in
// `native/rust-engine/src/prompter/clock.rs`, so the glass can place the text
// from the words when an anchor belongs to another layout.

export const GLASS_WIDTH = 1920;
export const GLASS_HEIGHT = 1080;
/** A cue line and `END` are drawn at 70 % of the size (the proposal §4.1). */
export const CUE_SCALE = 0.7;

/** The reading arrow: 46 px wide, 64 px clear of the text (board 1), 24 px clear of a paragraph number. */
const ARROW_WIDTH = 46;
const ARROW_GAP = 64;
const ARROW_GAP_TO_NUMBER = 24;
/** The arrow is never closer than this to the glass's edge. */
const EDGE = 8;
/** A paragraph number's size, and a digit's width: room is kept for three digits, or the script's last number's. */
const NUMBER_SCALE = 0.6;
const DIGIT_EM = 0.62;

/** The look in the glass's pixels. */
export interface GlassMetrics {
  sizePx: number;
  /** Every line is this tall, a cue line and `END` included. */
  lineHeight: number;
  /** Half a line between paragraphs. */
  paragraphGap: number;
  /** The look's margin each side. */
  marginPx: number;
  /**
   * The text column's left edge: the margin, or further in when the margin
   * leaves no room for the arrow (and the paragraph numbers, when shown), so
   * the arrow and the numbers never cover a word.
   */
  columnLeft: number;
  arrowLeft: number;
  numberSize: number;
  /** Between a paragraph number and its first word. */
  numberGap: number;
  /** The reading line, from the top. */
  readingY: number;
  /** `END` stands this far below the last line: half a screen. */
  endGap: number;
}

/** What of the look the glass's geometry reads (a `PrompterLook` is one). */
export type GlassLook = Pick<
  PrompterLook,
  "lineSpacingPercent" | "marginPercent" | "paragraphNumbers" | "readingLinePercent"
>;

/** `paragraphs` is how many the text has: its last number needs room beside the arrow. */
export function glassMetrics(look: GlassLook, sizePx: number, paragraphs = 0): GlassMetrics {
  const lineHeight = (sizePx * look.lineSpacingPercent) / 100;
  const marginPx = (GLASS_WIDTH * look.marginPercent) / 100;
  const numberSize = sizePx * NUMBER_SCALE;
  const numberGap = sizePx * 0.3;
  const digits = Math.max(3, String(paragraphs).length);
  const numbersRoom = look.paragraphNumbers ? numberSize * digits * DIGIT_EM + numberGap : 0;
  const arrowGap = look.paragraphNumbers ? ARROW_GAP_TO_NUMBER : ARROW_GAP;
  const columnLeft = Math.max(marginPx, EDGE + ARROW_WIDTH + arrowGap + numbersRoom);
  return {
    sizePx,
    lineHeight,
    paragraphGap: lineHeight / 2,
    marginPx,
    columnLeft,
    arrowLeft: columnLeft - numbersRoom - arrowGap - ARROW_WIDTH,
    numberSize,
    numberGap,
    readingY: (GLASS_HEIGHT * look.readingLinePercent) / 100,
    endGap: GLASS_HEIGHT / 2,
  };
}

/** A layout the glass measured, with what it needs to place text from words. */
export interface GlassLayout {
  key: string;
  lines: PrompterLayoutLine[];
  endTop: number;
  /** The layout's height per read word: the pace's pixels. */
  pxPerReadWord: number;
  /** Each paragraph's words, cues included. */
  paragraphWords: number[];
}

/** One paragraph as measured: its top and the vertical centre of each word. */
export interface MeasuredParagraph {
  top: number;
  wordCentres: number[];
}

/**
 * The layout from what was measured. A word sits on the line its centre falls
 * in (every line is `lineHeight` tall, so a smaller cue on a line of its own
 * still falls in it); a line starts at the first word on it; a paragraph with
 * no word is one line. Lines are kept in order even if a measure wobbles.
 */
export function layoutFromMeasure(
  key: string,
  measured: readonly MeasuredParagraph[],
  endTop: number,
  lineHeight: number,
  text: readonly GlassParagraph[]
): GlassLayout {
  const lines: PrompterLayoutLine[] = [];
  measured.forEach((paragraph, index) => {
    if (paragraph.wordCentres.length === 0) {
      lines.push({ paragraph: index, word: 0, top: paragraph.top, height: lineHeight });
      return;
    }
    let lastLine = -1;
    paragraph.wordCentres.forEach((centre, word) => {
      const line = Math.max(lastLine, Math.floor(Math.max(0, centre - paragraph.top) / lineHeight));
      if (line !== lastLine) {
        lines.push({ paragraph: index, word, top: paragraph.top + line * lineHeight, height: lineHeight });
        lastLine = line;
      }
    });
  });
  const last = lines[lines.length - 1];
  const first = lines[0];
  const textBottom = last ? last.top + last.height : 0;
  const readWords = text.reduce(
    (sum, paragraph) =>
      sum +
      paragraph.lines.reduce(
        (lineSum, line) => lineSum + line.tokens.filter((token) => token.kind === "word" && !token.word.cue).length,
        0
      ),
    0
  );
  const allWords = text.reduce((sum, paragraph) => sum + paragraph.wordCount, 0);
  // A script of cues alone is paced by all its words (clock.rs, review of
  // 2026-09-27).
  const paceWords = readWords > 0 ? readWords : allWords;
  return {
    key,
    lines,
    endTop,
    pxPerReadWord: first ? (textBottom - first.top) / Math.max(paceWords, 1) : 0,
    paragraphWords: text.map((paragraph) => paragraph.wordCount),
  };
}

/**
 * Why the hardware link would refuse this layout, in `Layout::new`'s order
 * (`clock.rs`), or `null` when it would take it. The glass reports only a
 * layout it would take: one measured while the glass was not drawn (every top
 * 0) is measured again rather than sent.
 */
export function layoutProblem(layout: GlassLayout): string | null {
  const { lines, paragraphWords } = layout;
  const first = lines[0];
  if (!first) return "no lines";
  if (first.paragraph !== 0 || first.word !== 0) return "the first line does not start the first paragraph";
  let started = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previous = index > 0 ? lines[index - 1] : null;
    if (!Number.isFinite(line.top) || !Number.isFinite(line.height) || line.top < 0) return "a line has no top";
    if (line.height <= 0 || line.height > 10_000) return "a line has no height";
    const words = paragraphWords[line.paragraph];
    if (words === undefined) return "a line names a paragraph the text does not have";
    if (line.word > 0 && line.word >= words) return "a line starts past its paragraph's words";
    if (previous) {
      const after =
        line.paragraph > previous.paragraph || (line.paragraph === previous.paragraph && line.word > previous.word);
      if (!after || line.top < previous.top + previous.height - 0.5) return "the lines are not in order";
    }
    if (!previous || previous.paragraph !== line.paragraph) {
      if (line.paragraph !== started || line.word !== 0) return "a paragraph does not start on a line of its own";
      started += 1;
    }
  }
  if (started !== paragraphWords.length) return "a paragraph has no line";
  const last = lines[lines.length - 1];
  if (!Number.isFinite(layout.endTop) || layout.endTop < last.top + last.height - 0.5) return "END is not below";
  return null;
}

/** The last index whose value is at or before `limit` (`partition_point` less one). */
function lastAtOrBefore<T>(items: readonly T[], before: (item: T) => boolean): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(items[middle])) low = middle + 1;
    else high = middle;
  }
  return Math.max(low - 1, 0);
}

function lineOf(layout: GlassLayout, paragraph: number, word: number): number {
  return lastAtOrBefore(
    layout.lines,
    (line) => line.paragraph < paragraph || (line.paragraph === paragraph && line.word <= word)
  );
}

/** The index of the line at the reading line when it stands at `position`. */
export function lineAt(layout: GlassLayout, position: number): number {
  return lastAtOrBefore(layout.lines, (line) => line.top <= position);
}

function lineWords(layout: GlassLayout, index: number): number {
  const line = layout.lines[index];
  const next = layout.lines[index + 1];
  const until =
    next && next.paragraph === line.paragraph ? next.word : (layout.paragraphWords[line.paragraph] ?? line.word + 1);
  return Math.max(until - line.word, 1);
}

/** Where the reading line stands when it is `wordOffset` words into `paragraph`; the end is `endTop`. */
export function positionOf(layout: GlassLayout, paragraph: number, wordOffset: number): number {
  if (layout.lines.length === 0 || paragraph >= layout.paragraphWords.length) return layout.endTop;
  const offset = Math.max(wordOffset, 0);
  const index = lineOf(layout, paragraph, Math.floor(offset));
  const line = layout.lines[index];
  const share = Math.min(Math.max((offset - line.word) / lineWords(layout, index), 0), 1);
  return Math.min(line.top + share * line.height, layout.endTop);
}
