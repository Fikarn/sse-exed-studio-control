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

/**
 * The paragraphs of the editor's text that the glass does not show as they
 * are (the script on the prompter, edited since it went on; §6.3): each one
 * whose text and formatting no paragraph of the glass's text has.
 */
export function editedParagraphs(text: readonly Paragraph[], glass: readonly Paragraph[]): Set<number> {
  const shown = new Set(glass.map(paragraphKey));
  const edited = new Set<number>();
  text.forEach((paragraph, index) => {
    if (!shown.has(paragraphKey(paragraph))) edited.add(index);
  });
  return edited;
}

/** Where the glass's paragraph at the reading line is in the editor's text: the same paragraph nearest its old index, else that index. */
export function readingLineIn(
  text: readonly Paragraph[],
  glass: readonly Paragraph[],
  glassParagraph: number
): number | null {
  const at = glass[glassParagraph];
  if (!at) return null;
  const key = paragraphKey(at);
  let best: number | null = null;
  text.forEach((paragraph, index) => {
    if (paragraphKey(paragraph) !== key) return;
    if (best === null || Math.abs(index - glassParagraph) < Math.abs(best - glassParagraph)) best = index;
  });
  return best ?? Math.min(glassParagraph, text.length - 1);
}
