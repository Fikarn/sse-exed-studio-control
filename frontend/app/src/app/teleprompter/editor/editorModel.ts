import type { PrompterParagraph, PrompterRun } from "@sse/engine-client";

// The script editor's model (new pages program, Slice 6b; the proposal §6.3):
// the script as the hardware link keeps it — paragraphs of runs, each run with
// its bold, italic and underline. The browser edits the text itself (its
// typing, its undo; `ScriptEditor`), and the editor reads the script back
// from the page; what is here says what the text is and what the glass shows
// of it. A place in the text is a paragraph and a character offset in it (a
// line break inside a paragraph is the character "\n", as the glass reads it).

export type Paragraph = PrompterParagraph;

export interface Position {
  paragraph: number;
  offset: number;
}

export interface Format {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export const PLAIN: Format = { bold: false, italic: false, underline: false };

/** An empty script still has one paragraph to type in. */
export function withAParagraph(paragraphs: readonly Paragraph[]): Paragraph[] {
  return paragraphs.length > 0 ? [...paragraphs] : [{ runs: [] }];
}

export function paragraphText(paragraph: Paragraph): string {
  return paragraph.runs.map((run) => run.text).join("");
}

export function paragraphLength(paragraph: Paragraph): number {
  let length = 0;
  for (const run of paragraph.runs) length += run.text.length;
  return length;
}

function sameFormat(a: Format, b: Format): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;
}

/** Adjacent runs of one format joined, empty runs dropped. */
export function normalizeRuns(runs: readonly PrompterRun[]): PrompterRun[] {
  const out: PrompterRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const last = out[out.length - 1];
    if (last && sameFormat(last, run)) {
      out[out.length - 1] = { ...last, text: last.text + run.text };
    } else {
      out.push({ text: run.text, bold: run.bold, italic: run.italic, underline: run.underline });
    }
  }
  return out;
}

/** The cues of a paragraph's text: each `[ … ]`, as the glass marks them (the proposal §4.2). */
export function cueRanges(text: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];
  const pattern = /\[[^[\]\n]*\]/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }
  return ranges;
}

/** A paragraph's identity for comparing two texts: its runs, formatting and all. */
const paragraphKeys = new WeakMap<Paragraph, string>();
export function paragraphKey(paragraph: Paragraph): string {
  const cached = paragraphKeys.get(paragraph);
  if (cached !== undefined) return cached;
  const key = JSON.stringify(
    normalizeRuns(paragraph.runs).map((run) => [run.text, run.bold, run.italic, run.underline])
  );
  paragraphKeys.set(paragraph, key);
  return key;
}

/** Whether two texts are the same, paragraph by paragraph, formatting and all. */
export function sameText(a: readonly Paragraph[], b: readonly Paragraph[]): boolean {
  return a.length === b.length && a.every((paragraph, index) => paragraphKey(paragraph) === paragraphKey(b[index]!));
}

/** What the editor's text changes on the glass (the script on the prompter, edited since it went on; §6.3). */
export interface GlassComparison {
  /** The editor's paragraphs the glass does not show as they are: edited, added, or a further copy of one. */
  edited: Set<number>;
  /** How many paragraphs fewer the text holds where it differs: the glass's unmatched ones, less the text's edited ones. */
  removed: number;
  /** Nothing edited, added or removed, but the paragraphs stand in another order. */
  reordered: boolean;
  /** The glass's paragraph at the reading line in the editor's text: unchanged, edited, or gone. */
  readingLine: { state: "unchanged" | "edited"; index: number } | { state: "removed" } | null;
}

/**
 * Compares the editor's text with the glass's, paragraph for paragraph, each
 * paragraph of the glass matched once: a paragraph of the text with no match
 * left is edited (or added); the glass's paragraphs left over, beyond the
 * edited ones that took their place, are removed. The
 * glass's paragraph at the reading line is found by its text, nearest where
 * it was; when the text no longer holds it, the paragraphs between its
 * neighbours' matches say whether it was edited (there is one) or removed.
 */
export function compareWithGlass(
  text: readonly Paragraph[],
  glass: readonly Paragraph[],
  glassPlace: number | null
): GlassComparison {
  const left = new Map<string, number>();
  for (const paragraph of glass) {
    const key = paragraphKey(paragraph);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  const where = new Map<string, number[]>();
  const edited = new Set<number>();
  text.forEach((paragraph, index) => {
    const key = paragraphKey(paragraph);
    const indices = where.get(key);
    if (indices) indices.push(index);
    else where.set(key, [index]);
    const count = left.get(key) ?? 0;
    if (count > 0) left.set(key, count - 1);
    else edited.add(index);
  });
  let unmatched = 0;
  for (const count of left.values()) unmatched += count;
  const removed = Math.max(unmatched - edited.size, 0);
  const reordered =
    edited.size === 0 &&
    removed === 0 &&
    text.some((paragraph, index) => paragraphKey(paragraph) !== paragraphKey(glass[index]!));

  /** The text's paragraph that holds the glass's paragraph `at`, nearest its index there. */
  const matchOf = (at: number): number | null => {
    let best: number | null = null;
    for (const index of where.get(paragraphKey(glass[at]!)) ?? []) {
      if (best === null || Math.abs(index - at) < Math.abs(best - at)) best = index;
    }
    return best;
  };
  let readingLine: GlassComparison["readingLine"] = null;
  if (glassPlace !== null && glass[glassPlace]) {
    const match = matchOf(glassPlace);
    if (match !== null) {
      readingLine = { state: "unchanged", index: match };
    } else {
      let before = -1;
      for (let at = glassPlace - 1; at >= 0; at -= 1) {
        const found = matchOf(at);
        if (found !== null) {
          before = found;
          break;
        }
      }
      let after = text.length;
      for (let at = glassPlace + 1; at < glass.length; at += 1) {
        const found = matchOf(at);
        if (found !== null && found > before) {
          after = found;
          break;
        }
      }
      readingLine = after > before + 1 ? { state: "edited", index: before + 1 } : { state: "removed" };
    }
  }
  return { edited, removed, reordered, readingLine };
}
