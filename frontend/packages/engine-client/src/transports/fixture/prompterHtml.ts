// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import type { PrompterRun } from "../../generated/snapshots/PrompterRun";
import { PLAIN, finishedParagraph, makeRun, paragraphText, sanitizeText, type RunMarks } from "./prompterModel";

// A paste that held formatting: the clipboard's HTML, from Word, a browser or Google
// Docs (the proposal §3.1 and §3.2; the hardware link's `prompter/import/html.rs`).
// A small reader, not a browser: it keeps the paragraphs (p, div, li, table cells), a
// line break (br), bold, italic and underline (b, strong, i, em, cite, u and the `style`
// properties font-weight, font-style and text-decoration, which override the tag, as
// Google Docs' `<b style="font-weight:normal">` wrapper needs), a heading as a cue, a
// bullet as "– " and a number as "N. ". Styles, scripts and comments are skipped. The
// editor's Paste (`prompter.paste.convert`, Slice 6b) reads with it too.

const BLOCKS = new Set([
  "address",
  "article",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "footer",
  "header",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "td",
  "th",
  "tr",
  "ul",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "wbr"]);
/** Elements whose content is never text on the glass. */
const SKIPPED = new Set(["head", "noscript", "script", "style", "template", "title", "xml"]);
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

/** `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;` and numeric references; any other is left as written. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/g, (whole, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      const valid = code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return valid ? String.fromCodePoint(code) : "\ufffd";
    }
    return ENTITIES[name] ?? whole;
  });
}

function attributes(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    found[match[1]!.toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return found;
}

/**
 * The marks inside an element: its parent's, the tag's, then its `style`'s, as the hardware
 * link's `child_frame` sets them. An `<ins>` is a tracked insertion taken as accepted, not an
 * underline; a declaration's `!important` is read past.
 */
function marksOf(name: string, attrs: Record<string, string>, parent: RunMarks): RunMarks {
  const marks = { ...parent };
  if (name === "b" || name === "strong") marks.bold = true;
  if (name === "i" || name === "em" || name === "cite") marks.italic = true;
  if (name === "u") marks.underline = true;
  for (const declaration of (attrs.style ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .trim()
      .toLowerCase()
      .replace(/(?:!important)+$/, "")
      .trim();
    if (property === "font-weight") {
      // `font_weight_is_bold`: a word, or a whole number (600 and over is bold).
      if (value === "bold" || value === "bolder") marks.bold = true;
      else if (value === "normal" || value === "lighter") marks.bold = false;
      else if (/^\+?[0-9]+$/.test(value) && Number(value) <= 0xffffffff) marks.bold = Number(value) >= 600;
    } else if (property === "font-style") {
      if (value.startsWith("italic") || value.startsWith("oblique")) marks.italic = true;
      else if (value === "normal") marks.italic = false;
    } else if (property === "text-decoration" || property === "text-decoration-line") {
      if (value.includes("underline")) marks.underline = true;
      else if (value.includes("none")) marks.underline = false;
    }
  }
  return marks;
}

interface Open {
  name: string;
  marks: RunMarks;
}

/** The paragraphs of the clipboard's HTML; none when it holds no word. */
export function readHtml(html: string): PrompterParagraph[] {
  return readHtmlCounted(html).paragraphs;
}

/** The paragraphs of the clipboard's HTML and how many pictures (`img`) it left out. */
export function readHtmlCounted(html: string): { paragraphs: PrompterParagraph[]; pictures: number } {
  let pictures = 0;
  const paragraphs: PrompterParagraph[] = [];
  const stack: Open[] = [];
  const lists: Array<{ ordered: boolean; next: number }> = [];
  let runs: PrompterRun[] = [];
  let headingDepth = 0;
  let pendingSpace: RunMarks | null = null;
  let lineStart = true;
  /** The bullet or number the paragraph starts with, so an empty list item leaves nothing. */
  let listPrefix: string | null = null;

  const marks = () => stack[stack.length - 1]?.marks ?? PLAIN;
  const push = (text: string, runMarks: RunMarks) => runs.push(makeRun(text, runMarks));

  const endParagraph = () => {
    const taken = runs;
    const prefix = listPrefix?.trim();
    runs = [];
    pendingSpace = null;
    lineStart = true;
    listPrefix = null;
    if (headingDepth > 0) {
      // A heading is a cue on a line of its own (§4.2), as the hardware link's `cue_paragraph`
      // makes it: one line; a heading that already is one cue stays as it is, and square
      // brackets inside any other become round ones, so the cue cannot end early.
      const line = sanitizeText(taken.map((run) => run.text).join(""))
        .split(/\s+/u)
        .filter(Boolean)
        .join(" ");
      if (line === "" || line === prefix) return;
      const isOneCue = /^\[[^\]\n]*\]$/u.test(line);
      const cue = isOneCue ? line : `[${line.replace(/\[/g, "(").replace(/\]/g, ")")}]`;
      paragraphs.push({ runs: [makeRun(cue)] });
      return;
    }
    // White space collapses as the paragraph is finished, as every reader's does
    // (`finished_paragraph`): a run inside a line is one space, a lone no-break space
    // stays, a run of line breaks is at most one blank line, none at either end.
    const paragraph = finishedParagraph(taken);
    if (paragraph === null || paragraphText(paragraph) === prefix) return;
    paragraphs.push(paragraph);
  };

  const text = (raw: string) => {
    // A no-break space is a character here, as in the hardware link's reader; it is
    // `finishedParagraph` that keeps a lone one and makes a run with others one space.
    for (const part of decodeEntities(raw).split(/([ \t\n\r\f]+)/)) {
      if (part === "") continue;
      if (/^[ \t\n\r\f]+$/.test(part)) {
        if (!lineStart && pendingSpace === null) pendingSpace = marks();
        continue;
      }
      if (pendingSpace !== null) push(" ", pendingSpace);
      pendingSpace = null;
      push(part, marks());
      lineStart = false;
    }
  };

  const lineBreak = () => {
    const last = runs[runs.length - 1];
    if (lineStart && last?.text.endsWith("\n")) {
      // Two breaks in a row part two paragraphs, as an empty line does in a .txt.
      last.text = last.text.slice(0, -1);
      endParagraph();
      return;
    }
    push("\n", marks());
    pendingSpace = null;
    lineStart = true;
  };

  const open = (name: string, attrs: Record<string, string>) => {
    if (name === "br") return lineBreak();
    if (name === "img") pictures += 1;
    if (BLOCKS.has(name)) endParagraph();
    if (HEADINGS.has(name)) headingDepth += 1;
    if (name === "ul" || name === "ol") {
      const start = Number.parseInt(attrs.start ?? "", 10);
      lists.push({ ordered: name === "ol", next: Number.isFinite(start) ? start : 1 });
    }
    if (VOID.has(name)) return;
    stack.push({ name, marks: marksOf(name, attrs, marks()) });
    if (name === "li") {
      const list = lists[lists.length - 1];
      listPrefix = list?.ordered ? `${list.next++}. ` : "– ";
      push(listPrefix, PLAIN);
    }
  };

  const close = (name: string) => {
    if (BLOCKS.has(name)) endParagraph();
    if (HEADINGS.has(name)) headingDepth = Math.max(headingDepth - 1, 0);
    if (name === "ul" || name === "ol") lists.pop();
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      if (stack[index]!.name === name) {
        stack.length = index;
        break;
      }
    }
  };

  const lower = html.toLowerCase();
  const tag = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/y;
  let at = 0;
  while (at < html.length) {
    const lt = html.indexOf("<", at);
    if (lt < 0) {
      text(html.slice(at));
      break;
    }
    if (lt > at) text(html.slice(at, lt));
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      at = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      at = end < 0 ? html.length : end + 1;
      continue;
    }
    tag.lastIndex = lt;
    const match = tag.exec(html);
    if (!match) {
      text("<");
      at = lt + 1;
      continue;
    }
    at = lt + match[0].length;
    const name = match[2]!.toLowerCase();
    if (match[1]) {
      close(name);
    } else if (SKIPPED.has(name)) {
      const end = lower.indexOf(`</${name}`, at);
      const after = end < 0 ? -1 : html.indexOf(">", end);
      at = after < 0 ? html.length : after + 1;
    } else {
      open(name, attributes(match[3]!));
      if (match[3]!.trimEnd().endsWith("/") && !VOID.has(name)) close(name);
    }
  }
  endParagraph();
  return { paragraphs, pictures };
}
