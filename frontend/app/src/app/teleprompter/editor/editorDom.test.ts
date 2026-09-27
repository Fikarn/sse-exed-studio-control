import { describe, expect, it } from "vitest";

import {
  cueHighlightRanges,
  domPlaceOf,
  paragraphElements,
  paragraphsMarkup,
  positionOf,
  readParagraph,
  readScript,
  renderParagraph,
} from "./editorDom";
import type { Paragraph } from "./editorModel";

// The script editor's markup (new pages program, Slice 6b): what it draws for
// a paragraph, how it reads back whatever the browser's own editing wrote,
// and the round trip between a place in the model and a place in the page.

const run = (text: string, format: Partial<{ bold: boolean; italic: boolean; underline: boolean }> = {}) => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  ...format,
});

function editorWith(paragraphs: Paragraph[]): HTMLElement {
  const root = document.createElement("div");
  for (const paragraph of paragraphs) root.appendChild(renderParagraph(document, paragraph, "p"));
  document.body.replaceChildren(root);
  return root;
}

describe("the script editor's markup", () => {
  const cueAndBold: Paragraph = {
    runs: [run("[PAUSE]\nGood "), run("morning", { bold: true, italic: true }), run(".")],
  };

  it("draws formatting as the browser's own tags, a line break as <br>, an empty paragraph with a line to type in", () => {
    const root = editorWith([cueAndBold, { runs: [] }]);
    const [first, second] = paragraphElements(root);
    expect(first!.innerHTML).toBe("[PAUSE]<br>Good <b><i>morning</i></b>.");
    expect(second!.querySelectorAll("br")).toHaveLength(1);
    expect(readScript(root)).toEqual([cueAndBold, { runs: [] }]);
  });

  it("reads what the browser's editing writes: nested tags, a style that turns bold off, its own trailing <br>", () => {
    const element = document.createElement("p");
    element.innerHTML = 'A <strong>b<span style="font-weight: normal;">c</span></strong> <em>d</em> <u>e</u><br>';
    expect(readParagraph(element)).toEqual({
      runs: [
        run("A "),
        run("b", { bold: true }),
        run("c "),
        run("d", { italic: true }),
        run(" "),
        run("e", { underline: true }),
      ],
    });
    const empty = document.createElement("p");
    empty.innerHTML = "<br>";
    expect(readParagraph(empty)).toEqual({ runs: [] });
    const twoLines = document.createElement("p");
    twoLines.innerHTML = "a<br><br>";
    expect(readParagraph(twoLines)).toEqual({ runs: [run("a\n")] });
  });

  it("reads text the browser left outside a paragraph as one of its own", () => {
    const root = document.createElement("div");
    root.innerHTML = "Typed after deleting everything<p>Then a paragraph</p>";
    expect(readScript(root)).toEqual([
      { runs: [run("Typed after deleting everything")] },
      { runs: [run("Then a paragraph")] },
    ]);
  });

  it("maps every place of the model to the page and back", () => {
    const paragraphs: Paragraph[] = [cueAndBold, { runs: [] }, { runs: [run("Last line\n")] }];
    const root = editorWith(paragraphs);
    const lengths = [cueAndBold.runs.reduce((sum, r) => sum + r.text.length, 0), 0, 10];
    for (let paragraph = 0; paragraph < paragraphs.length; paragraph += 1) {
      for (let offset = 0; offset <= lengths[paragraph]!; offset += 1) {
        const place = domPlaceOf(root, { paragraph, offset });
        expect(place, `${paragraph}:${offset}`).not.toBeNull();
        expect(positionOf(root, place!.node, place!.offset), `${paragraph}:${offset}`).toEqual({ paragraph, offset });
      }
    }
    expect(readScript(root)).toEqual(paragraphs);
  });

  it("writes pasted paragraphs as markup the browser inserts, and reads it back the same", () => {
    const pasted: Paragraph[] = [
      { runs: [run("One ", { bold: true }), run("<two>")] },
      { runs: [run("Three", { underline: true })] },
    ];
    expect(paragraphsMarkup(pasted)).toBe("<p><b>One </b>&lt;two&gt;</p><p><u>Three</u></p>");
    const root = document.createElement("div");
    root.innerHTML = paragraphsMarkup(pasted);
    expect(readScript(root)).toEqual(pasted);
  });

  it("finds the cues to highlight, across the tags inside them", () => {
    const root = editorWith([
      { runs: [run("Say [look at "), run("CAM 2", { bold: true }), run("] now")] },
      { runs: [] },
    ]);
    const ranges = cueHighlightRanges(root);
    expect(ranges.map((range) => range.toString())).toEqual(["[look at CAM 2]"]);
  });
});
