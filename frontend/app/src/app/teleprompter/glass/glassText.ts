import type { PrompterParagraph } from "@sse/engine-client";

// The glass's text (new pages program, Slice 5a): a script's paragraphs cut
// into what the glass draws — visual lines (a paragraph's line breaks), words
// and the spaces between them, each piece with its emphasis — under the
// hardware link's own rules for words and cues
// (`native/rust-engine/src/prompter/model.rs`: `word_spans`, `cue_spans`,
// `cue_targets`), so the word the glass draws first on a line is the word the
// hardware link counts there, and the layout it reports lines up with the
// place it keeps.
//
// - A word is a run of characters that are not white space, across runs of
//   different emphasis (`un` + bold `learn` is one word).
// - A cue is a `[` and the next `]` on the same line; a `[` with no `]` before
//   the line ends is text. A word that is all cue is drawn in the cue colour.
// - A line that holds a cue and nothing else is a cue line: the cue colour,
//   italic, at 70 % of the size (the proposal §4.1).

export interface GlassPiece {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export interface GlassWord {
  /** The word's index in its paragraph, cues included: the place's word. */
  index: number;
  pieces: GlassPiece[];
  /** Every character of the word is inside a cue. */
  cue: boolean;
}

export type GlassToken = { kind: "word"; word: GlassWord } | { kind: "space" };

export interface GlassLine {
  tokens: GlassToken[];
  /** The line holds a cue and nothing else. */
  cueLine: boolean;
}

export interface GlassParagraph {
  index: number;
  lines: GlassLine[];
  wordCount: number;
}

interface Char {
  ch: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

// The hardware link reads white space as Rust's `char::is_whitespace`; after
// its cleaning (U+0085 is a line break, U+FEFF is gone) that is the same set
// as JavaScript's `\s`.
const WHITE_SPACE = /\s/u;

/** `[start, end)` indices of the cues in `chars`, brackets included. */
function cueRanges(chars: readonly Char[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: number | null = null;
  chars.forEach((entry, index) => {
    if (entry.ch === "[" && open === null) open = index;
    else if (entry.ch === "]" && open !== null) {
      ranges.push([open, index + 1]);
      open = null;
    } else if (entry.ch === "\n") open = null;
  });
  return ranges;
}

function piecesOf(chars: readonly Char[]): GlassPiece[] {
  const pieces: GlassPiece[] = [];
  for (const entry of chars) {
    const last = pieces[pieces.length - 1];
    if (last && last.bold === entry.bold && last.italic === entry.italic && last.underline === entry.underline) {
      last.text += entry.ch;
    } else {
      pieces.push({ text: entry.ch, bold: entry.bold, italic: entry.italic, underline: entry.underline });
    }
  }
  return pieces;
}

/** One paragraph, cut into lines, words and spaces. */
export function glassParagraph(paragraph: PrompterParagraph, index: number): GlassParagraph {
  // Characters by code point, as the hardware link walks them.
  const chars: Char[] = [];
  for (const run of paragraph.runs) {
    for (const ch of run.text) chars.push({ ch, bold: run.bold, italic: run.italic, underline: run.underline });
  }
  // Which characters sit inside a cue, in one pass (the cues are in order and
  // apart), so a paragraph of thousands of cue lines costs no more than its
  // length (Slice 4's review found the quadratic walk in the hardware link).
  const cueChar = new Array<boolean>(chars.length).fill(false);
  for (const [start, end] of cueRanges(chars)) cueChar.fill(true, start, end);

  const lines: GlassLine[] = [{ tokens: [], cueLine: false }];
  const lineChars: Char[][] = [[]];
  let wordIndex = 0;
  let word: { chars: Char[]; cue: boolean } | null = null;
  const closeWord = () => {
    if (!word) return;
    lines[lines.length - 1].tokens.push({
      kind: "word",
      word: { index: wordIndex, pieces: piecesOf(word.chars), cue: word.cue },
    });
    wordIndex += 1;
    word = null;
  };
  chars.forEach((entry, at) => {
    if (entry.ch === "\n") {
      closeWord();
      lines.push({ tokens: [], cueLine: false });
      lineChars.push([]);
      return;
    }
    lineChars[lineChars.length - 1].push(entry);
    if (WHITE_SPACE.test(entry.ch)) {
      closeWord();
      const tokens = lines[lines.length - 1].tokens;
      if (tokens.length > 0 && tokens[tokens.length - 1].kind !== "space") tokens.push({ kind: "space" });
      return;
    }
    if (!word) word = { chars: [], cue: true };
    word.chars.push(entry);
    if (!cueChar[at]) word.cue = false;
  });
  closeWord();

  lines.forEach((line, lineIndex) => {
    // A space at a line's end draws nothing and would only move the break.
    while (line.tokens.length > 0 && line.tokens[line.tokens.length - 1].kind === "space") line.tokens.pop();
    const trimmed = lineChars[lineIndex]
      .map((entry) => entry.ch)
      .join("")
      .trim();
    // `cue_targets`: the trimmed line is exactly one cue.
    const lineCues = cueRanges([...trimmed].map((ch) => ({ ch, bold: false, italic: false, underline: false })));
    line.cueLine =
      trimmed.length >= 2 && lineCues.length === 1 && lineCues[0][0] === 0 && lineCues[0][1] === [...trimmed].length;
  });
  return { index, lines, wordCount: wordIndex };
}

export function glassParagraphs(paragraphs: readonly PrompterParagraph[]): GlassParagraph[] {
  return paragraphs.map((paragraph, index) => glassParagraph(paragraph, index));
}
