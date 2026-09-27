// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { PrompterCue } from "../../generated/snapshots/PrompterCue";
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import type { PrompterPlace } from "../../generated/snapshots/PrompterPlace";
import type { PrompterRun } from "../../generated/snapshots/PrompterRun";

// The Teleprompter's script model as the hardware link holds it
// (`native/rust-engine/src/prompter/model.rs` and `edits.rs`, new pages program,
// Slice 4). A script is a list of paragraphs of runs that keep bold, italic and
// underline; a line break inside a paragraph is a `\n` in a run's text.
//
// A word is a run of characters that are not white space (`/\S+/u` here,
// `char::is_whitespace` there; the two differ only at U+0085 and U+FEFF, and
// `sanitizeText` takes both out of every text that comes in). A cue is text in
// square brackets on one line; a word that is all cue is never read aloud, so it
// does not count towards the pace. Offsets here are UTF-16 units where the
// hardware link counts bytes; the words and cues they find are the same.

/** The longest script: about 3½ hours at 140 words a minute. */
export const MAX_SCRIPT_WORDS = 30_000;
/** The largest file the page may send, and the largest paste. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
/** The longest name a script keeps. */
export const MAX_SCRIPT_NAME_CHARS = 80;

export type RunMarks = Pick<PrompterRun, "bold" | "italic" | "underline">;

export const PLAIN: RunMarks = { bold: false, italic: false, underline: false };

/** A run in the shape the hardware link sends it (its field order too, so two equal texts serialize alike). */
export function makeRun(text: string, marks: RunMarks = PLAIN): PrompterRun {
  return { text, bold: marks.bold, italic: marks.italic, underline: marks.underline };
}

export function plainParagraph(text: string): PrompterParagraph {
  return { runs: [makeRun(text)] };
}

export function paragraphText(paragraph: PrompterParagraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}

function sameMarks(left: RunMarks, right: RunMarks) {
  return left.bold === right.bold && left.italic === right.italic && left.underline === right.underline;
}

/** Neighbouring runs of one emphasis joined, empty runs left out (`PrompterParagraph::normalized`). */
export function normalizedParagraph(paragraph: PrompterParagraph): PrompterParagraph {
  const runs: PrompterRun[] = [];
  for (const run of paragraph.runs) {
    if (run.text === "") continue;
    const last = runs[runs.length - 1];
    if (last && sameMarks(last, run)) {
      last.text += run.text;
    } else {
      runs.push(makeRun(run.text, run));
    }
  }
  return { runs };
}

/**
 * What the two word counts would read differently or the glass cannot draw
 * (`sanitize_text`): U+FEFF goes; U+0085, U+2028, U+2029, a carriage return and a
 * CR LF become a line break; a tab becomes a space; any other control character goes.
 */
export function sanitizeText(text: string): string {
  let out = "";
  const characters = Array.from(text);
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index]!;
    if (character === "\uFEFF") continue;
    if (character === "\r") {
      if (characters[index + 1] === "\n") index += 1;
      out += "\n";
    } else if (character === "\u0085" || character === "\u2028" || character === "\u2029") {
      out += "\n";
    } else if (character === "\t") {
      out += " ";
    } else if (character === "\n") {
      out += "\n";
    } else {
      // `char::is_control`: the Cc category, U+0000–U+001F and U+007F–U+009F.
      const code = character.codePointAt(0)!;
      if (code >= 0x20 && (code < 0x7f || code > 0x9f)) out += character;
    }
  }
  return out;
}

/** The sanitized, normalized paragraphs the hardware link keeps for a text that came in. */
export function cleanedParagraphs(paragraphs: readonly PrompterParagraph[]): PrompterParagraph[] {
  return paragraphs.map((paragraph) =>
    normalizedParagraph({ runs: paragraph.runs.map((run) => makeRun(sanitizeText(run.text), run)) })
  );
}

/** The ranges of the words in `text`. */
export function wordSpans(text: string): Array<[number, number]> {
  return [...text.matchAll(/\S+/gu)].map((match) => [match.index!, match.index! + match[0].length]);
}

/** The ranges of the cues in `text`, brackets included: a `[` and the next `]` on the same line. */
export function cueSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let open = -1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "[" && open < 0) {
      open = index;
    } else if (character === "]") {
      if (open >= 0) spans.push([open, index + 1]);
      open = -1;
    } else if (character === "\n") {
      open = -1;
    }
  }
  return spans;
}

/** A paragraph's words, cues included: the place's word index runs over these. */
export function paragraphWordCount(paragraph: PrompterParagraph): number {
  return wordSpans(paragraphText(paragraph)).length;
}

/** Every word of a script, cues included: the length limit counts these. */
export function wordCount(paragraphs: readonly PrompterParagraph[]): number {
  return paragraphs.reduce((sum, paragraph) => sum + paragraphWordCount(paragraph), 0);
}

/** For each word of a paragraph, whether the presenter reads it: a word with a character outside every cue. */
export function readFlags(paragraph: PrompterParagraph): boolean[] {
  const text = paragraphText(paragraph);
  const cues = cueSpans(text);
  return wordSpans(text).map(([begin, end]) => {
    for (let at = begin; at < end; at += 1) {
      if (!cues.some(([cueBegin, cueEnd]) => at >= cueBegin && at < cueEnd)) return true;
    }
    return false;
  });
}

/** The words the presenter reads: the pace, the length and the time left count these. */
export function readWordCount(paragraphs: readonly PrompterParagraph[]): number {
  return paragraphs.reduce((sum, paragraph) => sum + readFlags(paragraph).filter(Boolean).length, 0);
}

/** Every cue on a line of its own, in the script's order: the jump targets. */
export function cueTargets(paragraphs: readonly PrompterParagraph[]): PrompterCue[] {
  const targets: PrompterCue[] = [];
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const text = paragraphText(paragraph);
    let lineStart = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      const spans = cueSpans(trimmed);
      const isCue = trimmed.length >= 2 && spans.length === 1 && spans[0]![0] === 0 && spans[0]![1] === trimmed.length;
      if (isCue) {
        const firstWordOffset = lineStart + (line.length - line.trimStart().length);
        const word = wordSpans(text).findIndex(([begin]) => begin === firstWordOffset);
        targets.push({ paragraph: paragraphIndex, word: Math.max(word, 0), text: trimmed.slice(1, -1).trim() });
      }
      lineStart += line.length + 1;
    }
  });
  return targets;
}

/** A count as the operator reads it: `1,240`. */
export function formatCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** `1 paragraph`, `18 paragraphs`, the count as `formatCount` writes it. */
export function counted(count: number, singular: string, plural: string): string {
  return count === 1 ? `1 ${singular}` : `${formatCount(count)} ${plural}`;
}

/** The text of a list of paragraphs as the hardware link stores and compares it. */
export function paragraphsKey(paragraphs: readonly PrompterParagraph[]): string {
  return JSON.stringify(paragraphs.map((paragraph) => ({ runs: paragraph.runs.map((run) => makeRun(run.text, run)) })));
}

export function sameParagraph(left: PrompterParagraph, right: PrompterParagraph): boolean {
  return paragraphsKey([left]) === paragraphsKey([right]);
}

export function cloneParagraphs(paragraphs: readonly PrompterParagraph[]): PrompterParagraph[] {
  return paragraphs.map((paragraph) => ({ runs: paragraph.runs.map((run) => makeRun(run.text, run)) }));
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export const TOP: PrompterPlace = { paragraph: 0, word: 0 };

export function comparePlaces(left: PrompterPlace, right: PrompterPlace): number {
  return left.paragraph - right.paragraph || left.word - right.word;
}

export function samePlace(left: PrompterPlace | null, right: PrompterPlace | null): boolean {
  if (left === null || right === null) return left === right;
  return comparePlaces(left, right) === 0;
}

/** The end: `END` at the reading line, the paragraph after the last one. */
export function endOf(paragraphs: readonly PrompterParagraph[]): PrompterPlace {
  return { paragraph: paragraphs.length, word: 0 };
}

/** The place a stored or restored script can stand on: inside the script, or its end. */
export function clampedPlace(place: PrompterPlace, paragraphs: readonly PrompterParagraph[]): PrompterPlace {
  const end = endOf(paragraphs);
  if (comparePlaces(place, end) >= 0) return end;
  const words = paragraphWordCount(paragraphs[place.paragraph]!);
  return { paragraph: place.paragraph, word: Math.min(place.word, Math.max(words - 1, 0)) };
}

/** The read words from `place` to the end. */
export function readWordsFrom(paragraphs: readonly PrompterParagraph[], place: PrompterPlace): number {
  let count = 0;
  for (let index = place.paragraph; index < paragraphs.length; index += 1) {
    const skip = index === place.paragraph ? place.word : 0;
    count += readFlags(paragraphs[index]!).slice(skip).filter(Boolean).length;
  }
  return count;
}

/** The place `words` read words on from `place`; the end when the script runs out first. */
export function advanceByReadWords(
  paragraphs: readonly PrompterParagraph[],
  place: PrompterPlace,
  words: number
): PrompterPlace {
  let left = words;
  for (let index = place.paragraph; index < paragraphs.length; index += 1) {
    const flags = readFlags(paragraphs[index]!);
    for (let word = index === place.paragraph ? place.word : 0; word < flags.length; word += 1) {
      if (left === 0) return { paragraph: index, word };
      if (flags[word]) left -= 1;
    }
  }
  return endOf(paragraphs);
}

/**
 * Where `place` in `old` stands in `next`, and whether its paragraph was taken
 * away (`map_place`): the paragraphs the two share at the start and at the end
 * are the same, what lies between is what changed.
 */
export function mapPlace(
  old: readonly PrompterParagraph[],
  next: readonly PrompterParagraph[],
  place: PrompterPlace
): [PrompterPlace, boolean] {
  const paragraph = place.paragraph;
  if (paragraph >= old.length) return [endOf(next), false];
  const shortest = Math.min(old.length, next.length);
  let prefix = 0;
  while (prefix < shortest && sameParagraph(old[prefix]!, next[prefix]!)) prefix += 1;
  const most = shortest - prefix;
  let suffix = 0;
  while (suffix < most && sameParagraph(old[old.length - 1 - suffix]!, next[next.length - 1 - suffix]!)) suffix += 1;
  const at = (index: number) => clampedPlace({ paragraph: index, word: place.word }, next);
  if (paragraph < prefix) return [at(paragraph), false];
  const oldChangedEnd = old.length - suffix;
  const newChangedEnd = next.length - suffix;
  if (paragraph >= oldChangedEnd) return [at(paragraph - oldChangedEnd + newChangedEnd), false];
  const offset = paragraph - prefix;
  if (prefix + offset < newChangedEnd) return [at(prefix + offset), false];
  return [clampedPlace({ paragraph: newChangedEnd, word: 0 }, next), true];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** A name as the lists show it: one line, spaces collapsed, at most 80 characters; `null` when nothing is left. */
export function cleanName(raw: string): string | null {
  const collapsed = sanitizeText(raw)
    .split(/\s+/u)
    .filter((word) => word !== "")
    .join(" ");
  const name = Array.from(collapsed).slice(0, MAX_SCRIPT_NAME_CHARS).join("").trim();
  return name === "" ? null : name;
}

/** Names in the order a person reads a list: letters without regard to case, a run of digits by its number. */
export function naturalOrder(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  let i = 0;
  let j = 0;
  const isDigit = (character: string | undefined) => character !== undefined && character >= "0" && character <= "9";
  for (;;) {
    if (i >= a.length && j >= b.length) return 0;
    if (i >= a.length) return -1;
    if (j >= b.length) return 1;
    if (isDigit(a[i]) && isDigit(b[j])) {
      let leftDigits = "";
      while (isDigit(a[i])) leftDigits += a[i++];
      let rightDigits = "";
      while (isDigit(b[j])) rightDigits += b[j++];
      const leftNumber = leftDigits.replace(/^0+/, "");
      const rightNumber = rightDigits.replace(/^0+/, "");
      const order =
        leftNumber.length - rightNumber.length || (leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0);
      if (order !== 0) return order;
    } else {
      const leftLower = a[i]!.toLowerCase();
      const rightLower = b[j]!.toLowerCase();
      if (leftLower !== rightLower) return leftLower < rightLower ? -1 : 1;
      i += 1;
      j += 1;
    }
  }
}
