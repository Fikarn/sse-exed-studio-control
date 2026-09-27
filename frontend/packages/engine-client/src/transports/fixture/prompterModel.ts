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

/** Whether `sanitizeText` would change `text`: a control character other than a line break, U+2028, U+2029 or U+FEFF. */
function needsSanitizing(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    const control = (code < 0x20 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
    if (control || code === 0x2028 || code === 0x2029 || code === 0xfeff) return true;
  }
  return false;
}

/**
 * What the two word counts would read differently or the glass cannot draw
 * (`sanitize_text`): U+FEFF goes; U+0085, U+2028, U+2029, a carriage return and a
 * CR LF become a line break; a tab becomes a space; any other control character goes.
 */
export function sanitizeText(text: string): string {
  if (!needsSanitizing(text)) return text;
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

/**
 * White space waiting in `finishedParagraph` for the next character that is not white
 * space, so none ends a line or the paragraph: one space (the run it began in, its first
 * character, and whether more followed, when it is one plain space) or at most two line
 * breaks (one blank line), however long the run it stands for.
 */
type Waiting =
  | { kind: "nothing" }
  | { kind: "space"; from: number; first: string; more: boolean }
  | { kind: "breaks"; from: number[] };

const NOTHING_WAITING: Waiting = { kind: "nothing" };

/**
 * A paragraph as every import reader hands it on (`import/mod.rs`'s `finished_paragraph`):
 * each run sanitized, the white space at both ends of each line taken off, a run of white
 * space inside a line made one space (a lone no-break space stays), a run of line breaks
 * made at most one blank line, line breaks at the paragraph's start and end taken off,
 * neighbouring runs of one emphasis joined. `null` when no word is left.
 */
export function finishedParagraph(runs: readonly PrompterRun[]): PrompterParagraph | null {
  const out: PrompterRun[] = [];
  // Line breaks wait only at a line's start and white space only after a character, so
  // `waiting` holds one kind or the other.
  let waiting: Waiting = NOTHING_WAITING;
  let atLineStart = true;
  let hasText = false;
  for (const run of runs) {
    out.push(makeRun("", run));
    const index = out.length - 1;
    // A line break, a run of other white space, or a run of text: the hardware link's
    // character-by-character rules, taken a run at a time.
    for (const [token] of sanitizeText(run.text).matchAll(/\n|[^\S\n]+|\S+/gu)) {
      if (token === "\n") {
        // The white space that ended the line.
        if (!atLineStart) waiting = NOTHING_WAITING;
        if (hasText) {
          if (waiting.kind !== "breaks") waiting = { kind: "breaks", from: [index] };
          else if (waiting.from.length < 2) waiting.from.push(index);
        }
        atLineStart = true;
      } else if (/^\s/u.test(token)) {
        if (!atLineStart) {
          waiting =
            waiting.kind === "space"
              ? { ...waiting, more: true }
              : { kind: "space", from: index, first: token[0]!, more: token.length > 1 };
        }
      } else {
        if (waiting.kind === "space") out[waiting.from]!.text += waiting.more ? " " : waiting.first;
        else if (waiting.kind === "breaks") for (const from of waiting.from) out[from]!.text += "\n";
        waiting = NOTHING_WAITING;
        out[index]!.text += token;
        atLineStart = false;
        hasText = true;
      }
    }
  }
  const paragraph = normalizedParagraph({ runs: out });
  return paragraph.runs.every((run) => run.text.trim() === "") ? null : paragraph;
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

/**
 * For each word of a paragraph, whether the presenter reads it: a word with a character
 * outside every cue. One pass over the words and the cues together, both in order (review
 * of 2026-09-27: checking every character against every cue was quadratic).
 */
export function readFlags(paragraph: PrompterParagraph): boolean[] {
  const text = paragraphText(paragraph);
  const cues = cueSpans(text);
  let firstCue = 0;
  return wordSpans(text).map(([begin, end]) => {
    while (firstCue < cues.length && cues[firstCue]![1] <= begin) firstCue += 1;
    let at = begin;
    let cue = firstCue;
    while (at < end) {
      const span = cues[cue];
      if (span === undefined || span[0] > at) return true;
      at = Math.max(at, span[1]);
      cue += 1;
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
    // The paragraph's words once, and each cue line's first word found by a binary search
    // (review of 2026-09-27: counting them again for every cue line was quadratic).
    const words = wordSpans(text);
    let lineStart = 0;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      const spans = cueSpans(trimmed);
      const isCue = trimmed.length >= 2 && spans.length === 1 && spans[0]![0] === 0 && spans[0]![1] === trimmed.length;
      if (isCue) {
        const firstWordOffset = lineStart + (line.length - line.trimStart().length);
        let low = 0;
        let high = words.length;
        while (low < high) {
          const middle = (low + high) >> 1;
          if (words[middle]![0] < firstWordOffset) low = middle + 1;
          else high = middle;
        }
        targets.push({ paragraph: paragraphIndex, word: low, text: trimmed.slice(1, -1).trim() });
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

/** A match needs half the longer paragraph's words in common. */
const ALIKE = 0.5;

/** How alike two paragraphs are: the words they have in common (each as often as both have it) over the longer one's words. */
function likeness(before: PrompterParagraph, after: PrompterParagraph): number {
  const beforeWords = paragraphText(before).match(/\S+/gu) ?? [];
  const afterWords = paragraphText(after).match(/\S+/gu) ?? [];
  const longer = Math.max(beforeWords.length, afterWords.length);
  if (longer === 0) return 1;
  const counts = new Map<string, number>();
  for (const word of beforeWords) counts.set(word, (counts.get(word) ?? 0) + 1);
  let common = 0;
  for (const word of afterWords) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      counts.set(word, count - 1);
      common += 1;
    }
  }
  return common / longer;
}

/** The paragraph of `next` from `from` up to `until` most like `old`, when one is alike enough; the first of equals. */
function bestMatch(old: PrompterParagraph, next: readonly PrompterParagraph[], from: number, until: number) {
  let best: number | null = null;
  let bestLikeness = 0;
  for (let index = from; index < until; index += 1) {
    const alike = likeness(old, next[index]!);
    if (alike >= ALIKE && (best === null || alike > bestLikeness)) {
      best = index;
      bestLikeness = alike;
    }
  }
  return best;
}

/**
 * Where `place` in `old` stands in `next`, and whether its paragraph was taken away
 * (`map_place`): the paragraphs the two share at the start and at the end are the same,
 * what lies between is what changed. A place in an unchanged paragraph keeps its word. A
 * place in a changed paragraph goes to the new paragraph most like it — half its words or
 * more in common — keeping its word as far as that paragraph goes; when none is that
 * alike and the stretch kept its number of paragraphs, to the paragraph in the same
 * position; else the paragraph was taken away, and the place moves to the start of the
 * next one: the match of the next old paragraph in the stretch, or the first after it
 * (review of 2026-09-27).
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
  const match = bestMatch(old[paragraph]!, next, prefix, newChangedEnd);
  if (match !== null) return [at(match), false];
  if (oldChangedEnd - prefix === newChangedEnd - prefix) return [at(paragraph), false];
  // Taken away: the start of the next paragraph that is still there.
  let following = newChangedEnd;
  for (let later = paragraph + 1; later < oldChangedEnd; later += 1) {
    const laterMatch = bestMatch(old[later]!, next, prefix, newChangedEnd);
    if (laterMatch !== null) {
      following = laterMatch;
      break;
    }
  }
  return [clampedPlace({ paragraph: following, word: 0 }, next), true];
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

/**
 * Two texts by their characters' Unicode code points, as Rust compares `char`s (a JS
 * string compares UTF-16 units, which puts a character past U+FFFF before U+E000–U+FFFF).
 */
function byCodePoint(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return Math.sign(a.length - b.length);
}

/**
 * Names in the order a person reads a list (`natural_order`): letters without regard to
 * case, each lower-cased and then by its code point, a run of digits by its number.
 */
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
      const order = byCodePoint(a[i]!.toLowerCase(), b[j]!.toLowerCase());
      if (order !== 0) return order;
      i += 1;
      j += 1;
    }
  }
}
