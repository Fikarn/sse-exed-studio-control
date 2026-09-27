import { cueRanges, normalizeRuns, paragraphText, type Format, type Paragraph, type Position } from "./editorModel";

// The script editor's text on the page (new pages program, Slice 6b): each
// paragraph a `<p>`, bold, italic and underline as `<b>`, `<i>` and `<u>` —
// the markup the browser's own editing makes, so its typing, its undo and the
// bar's formatting all work on the same text — a line break as `<br>`. The
// editor reads the script back from this markup after every change, whatever
// the browser wrote (it may nest the tags, or write a style that turns one
// off), and marks the cues with the browser's highlights, never in the markup.

/** Marks a paragraph's element. */
export const PARAGRAPH_ATTRIBUTE = "data-editor-paragraph";
/** Marks the `<br>` that gives an empty last line its height; it is no character. */
const FILLER_ATTRIBUTE = "data-editor-filler";

export function isParagraphElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && (node.tagName === "P" || node.tagName === "DIV");
}

function isFiller(node: Node): boolean {
  return node instanceof HTMLElement && node.hasAttribute(FILLER_ATTRIBUTE);
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A paragraph's inner markup: its runs in `<b>`, `<i>`, `<u>`, line breaks as `<br>`. */
function innerMarkup(paragraph: Paragraph): string {
  let html = "";
  for (const run of paragraph.runs) {
    const lines = run.text.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) html += "<br>";
      if (!line) return;
      let text = escapeText(line);
      if (run.underline) text = `<u>${text}</u>`;
      if (run.italic) text = `<i>${text}</i>`;
      if (run.bold) text = `<b>${text}</b>`;
      html += text;
    });
  }
  const whole = paragraphText(paragraph);
  if (whole.length === 0 || whole.endsWith("\n")) html += `<br ${FILLER_ATTRIBUTE}="">`;
  return html;
}

/** One paragraph as the editor draws it. */
export function renderParagraph(document: Document, paragraph: Paragraph, className: string): HTMLElement {
  const element = document.createElement("p");
  element.setAttribute(PARAGRAPH_ATTRIBUTE, "");
  element.className = className;
  element.innerHTML = innerMarkup(paragraph);
  return element;
}

/** Paragraphs as markup to insert where the caret is (a paste), each a `<p>`. */
export function paragraphsMarkup(paragraphs: readonly Paragraph[]): string {
  return paragraphs.map((paragraph) => `<p>${innerMarkup(paragraph)}</p>`).join("");
}

/** The text nodes and line breaks of a paragraph, in order: the characters it holds. */
function leaves(element: Node): Node[] {
  const out: Node[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) out.push(node);
    else if (node instanceof HTMLBRElement) out.push(node);
    else for (const child of node.childNodes) walk(child);
  };
  for (const child of element.childNodes) walk(child);
  return out;
}

function characters(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  if (node instanceof HTMLBRElement) return isFiller(node) ? 0 : 1;
  let count = 0;
  for (const child of node.childNodes) count += characters(child);
  return count;
}

/** The editor's paragraph elements, in order. */
export function paragraphElements(root: HTMLElement): HTMLElement[] {
  return [...root.children].filter(isParagraphElement);
}

/** The model's place for a place in the page, or `null` when it is outside the editor's paragraphs. */
export function positionOf(root: HTMLElement, container: Node, offset: number): Position | null {
  if (!root.contains(container)) return null;
  const paragraphs = paragraphElements(root);
  if (container === root) {
    const after = [...root.childNodes].slice(offset).find(isParagraphElement);
    if (after) return { paragraph: paragraphs.indexOf(after), offset: 0 };
    const last = paragraphs.length - 1;
    return last >= 0 ? { paragraph: last, offset: characters(paragraphs[last]!) } : null;
  }
  let block: Node | null = container;
  while (block && block.parentNode !== root) block = block.parentNode;
  if (!block || !isParagraphElement(block)) return null;
  let count = 0;
  const target =
    container.nodeType === Node.TEXT_NODE
      ? { node: container, offset }
      : { node: container.childNodes[offset] ?? null, offset: 0 };
  for (const leaf of leaves(block)) {
    if (target.node && (leaf === target.node || target.node.contains(leaf))) {
      return { paragraph: paragraphs.indexOf(block), offset: count + (leaf === container ? offset : 0) };
    }
    count += characters(leaf);
  }
  return { paragraph: paragraphs.indexOf(block), offset: count };
}

/** The page's place for a place in the model: inside a text node where there is one (at its end rather than the next one's start). */
export function domPlaceOf(root: HTMLElement, position: Position): { node: Node; offset: number } | null {
  const element = paragraphElements(root)[position.paragraph];
  return element ? domPlaceIn(element, position.offset) : null;
}

/** The page's place for an offset in one paragraph's element (`domPlaceOf`, once the element is known). */
function domPlaceIn(element: HTMLElement, offset: number): { node: Node; offset: number } {
  let remaining = offset;
  for (const leaf of leaves(element)) {
    if (leaf.nodeType === Node.TEXT_NODE) {
      const length = (leaf as Text).data.length;
      if (remaining <= length) return { node: leaf, offset: remaining };
      remaining -= length;
      continue;
    }
    const parent = leaf.parentNode!;
    const index = [...parent.childNodes].indexOf(leaf as ChildNode);
    if (isFiller(leaf) || remaining === 0) return { node: parent, offset: index };
    remaining -= 1;
  }
  return { node: element, offset: element.childNodes.length };
}

/** The format an element gives what is inside it: its tag, then its own style (which can turn one off). */
function formatInside(element: HTMLElement, outer: Format): Format {
  const tag = element.tagName;
  const next = {
    bold: outer.bold || tag === "B" || tag === "STRONG",
    italic: outer.italic || tag === "I" || tag === "EM",
    underline: outer.underline || tag === "U",
  };
  const style = element.style;
  if (style?.fontWeight) {
    const weight = style.fontWeight === "bold" ? 700 : style.fontWeight === "normal" ? 400 : Number(style.fontWeight);
    if (Number.isFinite(weight)) next.bold = weight >= 600;
  }
  if (style?.fontStyle) next.italic = style.fontStyle === "italic" || style.fontStyle === "oblique";
  const decoration = style?.textDecorationLine || style?.textDecoration;
  if (decoration) next.underline = decoration.includes("underline");
  return next;
}

/** A paragraph as the page now holds it, with the formatting its tags and styles give each run. */
export function readParagraph(element: Node): Paragraph {
  const runs: Paragraph["runs"] = [];
  const walk = (node: Node, format: Format) => {
    if (node.nodeType === Node.TEXT_NODE) {
      runs.push({ text: (node as Text).data, ...format });
      return;
    }
    if (node instanceof HTMLBRElement) {
      if (!isFiller(node)) runs.push({ text: "\n", ...format });
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const inside = formatInside(node, format);
    for (const child of node.childNodes) walk(child, inside);
  };
  const plain = { bold: false, italic: false, underline: false };
  if (element instanceof HTMLElement && isParagraphElement(element)) {
    for (const child of element.childNodes) walk(child, plain);
  } else {
    walk(element, plain);
  }
  // A paragraph's last line break only makes room for the caret.
  const read = normalizeRuns(runs);
  const last = read[read.length - 1];
  if (last && last.text.endsWith("\n") && !(element instanceof HTMLElement && hasFiller(element))) {
    const trimmed = last.text.slice(0, -1);
    read[read.length - 1] = { ...last, text: trimmed };
    return { runs: normalizeRuns(read) };
  }
  return { runs: read };
}

function hasFiller(element: HTMLElement): boolean {
  return element.querySelector(`[${FILLER_ATTRIBUTE}]`) !== null;
}

/**
 * The script as the page now holds it: a paragraph for each block, and for
 * any text the browser left outside one (all of it deleted, then typed).
 */
export function readScript(root: HTMLElement): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let loose: Node[] = [];
  const flush = () => {
    if (loose.length === 0) return;
    const holder = root.ownerDocument.createElement("span");
    for (const node of loose) holder.appendChild(node.cloneNode(true));
    paragraphs.push(readParagraph(holder));
    loose = [];
  };
  for (const child of root.childNodes) {
    if (isParagraphElement(child)) {
      flush();
      paragraphs.push(readParagraph(child));
    } else {
      loose.push(child);
    }
  }
  flush();
  return paragraphs;
}

/**
 * The ranges of the cues in the editor's text, for the browser's highlights:
 * one pass over the paragraphs, each cue placed within its own paragraph's
 * element. `textOf` gives a paragraph's text when the editor has read it
 * already.
 */
export function cueHighlightRanges(root: HTMLElement, textOf?: (element: HTMLElement) => string | undefined): Range[] {
  const ranges: Range[] = [];
  for (const element of paragraphElements(root)) {
    if (!(element.textContent ?? "").includes("[")) continue;
    const lineBreakText =
      textOf?.(element) ??
      readParagraph(element)
        .runs.map((run) => run.text)
        .join("");
    for (const cue of cueRanges(lineBreakText)) {
      const start = domPlaceIn(element, cue.from);
      const end = domPlaceIn(element, cue.to);
      const range = root.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      ranges.push(range);
    }
  }
  return ranges;
}
