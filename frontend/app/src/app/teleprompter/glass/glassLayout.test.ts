import { describe, expect, it } from "vitest";

import { glassMetrics, layoutFromMeasure, layoutProblem, lineAt, positionOf, type GlassLayout } from "./glassLayout";
import { paragraph, standardLook } from "./glassStoryScript";
import { glassParagraphs } from "./glassText";

// The glass's layout (new pages program, Slice 5a): what it reports to the
// hardware link, and the helpers that mirror `Layout` in
// `native/rust-engine/src/prompter/clock.rs`.

const LINE = 100;

describe("the glass's metrics", () => {
  it("turn the look into the glass's pixels, the arrow 64 px clear of the text as on board 1", () => {
    const metrics = glassMetrics(standardLook(), 88);
    expect(metrics.lineHeight).toBeCloseTo(123.2);
    expect(metrics.paragraphGap).toBeCloseTo(61.6);
    expect(metrics.marginPx).toBeCloseTo(230.4);
    expect(metrics.columnLeft).toBeCloseTo(230.4);
    expect(metrics.arrowLeft).toBeCloseTo(120.4);
    expect(metrics.readingY).toBeCloseTo(378);
    expect(metrics.endGap).toBe(540);
  });

  it("keep the text clear of the arrow and the paragraph numbers when the margin leaves no room", () => {
    const bare = glassMetrics(standardLook({ marginPercent: 0 }), 160);
    expect(bare.marginPx).toBe(0);
    expect(bare.columnLeft).toBe(8 + 46 + 64);
    expect(bare.arrowLeft).toBe(8);
    const numbered = glassMetrics(standardLook({ paragraphNumbers: true }), 88);
    expect(numbered.columnLeft).toBeCloseTo(230.4);
    expect(numbered.arrowLeft).toBeGreaterThanOrEqual(8);
    // The arrow, 24 px, then three digits and their gap, then the text.
    expect(numbered.arrowLeft + 46 + 24).toBeCloseTo(
      numbered.columnLeft - numbered.numberGap - 3 * 0.62 * numbered.numberSize
    );
  });
});

describe("the glass's metrics, continued", () => {
  it("keep room for the script's last paragraph number beside the arrow", () => {
    const look = standardLook({ paragraphNumbers: true, marginPercent: 0 });
    const few = glassMetrics(look, 160, 12);
    const many = glassMetrics(look, 160, 1_001);
    // A fourth digit moves the text one digit further in; the arrow stays clear of it.
    expect(many.columnLeft - few.columnLeft).toBeCloseTo(0.62 * many.numberSize);
    expect(many.arrowLeft + 46 + 24).toBeCloseTo(many.columnLeft - many.numberGap - 4 * 0.62 * many.numberSize);
  });
});

describe("what the hardware link would refuse (Layout::new)", () => {
  const line = (paragraph: number, word: number, top: number) => ({ paragraph, word, top, height: LINE });
  const layout = (overrides: Partial<GlassLayout> = {}): GlassLayout => ({
    key: "g1-l0",
    lines: [line(0, 0, 0), line(0, 3, 100), line(1, 0, 250), line(2, 0, 400)],
    endTop: 1_000,
    pxPerReadWord: 10,
    paragraphWords: [5, 0, 2],
    ...overrides,
  });

  it("takes a layout in order, every paragraph with a line and END below", () => {
    expect(layoutProblem(layout())).toBeNull();
    // Half a pixel of overlap is a measure's wobble, and taken.
    expect(
      layoutProblem(layout({ lines: [line(0, 0, 0), line(0, 3, 99.6), line(1, 0, 250), line(2, 0, 400)] }))
    ).toBeNull();
  });

  it("refuses what the hardware link refuses", () => {
    expect(layoutProblem(layout({ lines: [] }))).toBe("no lines");
    expect(layoutProblem(layout({ lines: [line(0, 1, 0)] }))).toMatch(/first line/);
    // An empty paragraph one line tall with the next less than half a pixel short of it (review of Slice 5a's push).
    expect(layoutProblem(layout({ lines: [line(0, 0, 0), line(0, 3, 100), line(1, 0, 250), line(2, 0, 349.2)] }))).toBe(
      "the lines are not in order"
    );
    // A glass measured while it was not drawn: every top 0.
    expect(layoutProblem(layout({ lines: [line(0, 0, 0), line(0, 3, 0), line(1, 0, 0), line(2, 0, 0)] }))).toBe(
      "the lines are not in order"
    );
    expect(
      layoutProblem(layout({ lines: [line(0, 0, 0), line(0, 5, 100), line(1, 0, 250), line(2, 0, 400)] }))
    ).toMatch(/past its paragraph's words/);
    expect(layoutProblem(layout({ lines: [line(0, 0, 0), line(0, 3, 100), line(2, 0, 400)] }))).toBe(
      "a paragraph does not start on a line of its own"
    );
    expect(layoutProblem(layout({ lines: [line(0, 0, 0), line(0, 3, 100), line(1, 0, 250)] }))).toBe(
      "a paragraph has no line"
    );
    expect(layoutProblem(layout({ endTop: 450 }))).toBe("END is not below");
    expect(layoutProblem(layout({ lines: [line(0, 0, -1)] }))).toBe("a line has no top");
  });
});

describe("the glass's layout", () => {
  const text = glassParagraphs([paragraph("one two three four five"), paragraph(""), paragraph("[CUE]\nsix seven")]);

  it("starts a line at the first word on it, gives an empty paragraph a line, and finds END", () => {
    const layout = layoutFromMeasure(
      "g1-l0",
      [
        // Three words on the first line, two on the second.
        { top: 0, wordCentres: [50, 50, 50, 150, 150] },
        { top: 250, wordCentres: [] },
        // A cue line (a smaller face, its centre still inside its line) and a line of text.
        { top: 400, wordCentres: [452, 550, 550] },
      ],
      1600,
      LINE,
      text
    );
    expect(layout.key).toBe("g1-l0");
    expect(layout.lines).toEqual([
      { paragraph: 0, word: 0, top: 0, height: LINE },
      { paragraph: 0, word: 3, top: 100, height: LINE },
      { paragraph: 1, word: 0, top: 250, height: LINE },
      { paragraph: 2, word: 0, top: 400, height: LINE },
      { paragraph: 2, word: 1, top: 500, height: LINE },
    ]);
    expect(layout.endTop).toBe(1600);
    expect(layout.paragraphWords).toEqual([5, 0, 3]);
    // Seven read words ([CUE] is a direction) over the text from its top to
    // the last line's bottom.
    expect(layout.pxPerReadWord).toBeCloseTo(600 / 7);
  });

  it("keeps its lines in order when a measure wobbles", () => {
    const layout = layoutFromMeasure(
      "k",
      [{ top: 0, wordCentres: [50, 151, 149, 250] }],
      400,
      LINE,
      glassParagraphs([paragraph("a b c d")])
    );
    expect(layout.lines.map((line) => line.word)).toEqual([0, 1, 3]);
  });

  it("paces a script of cues alone by all its words", () => {
    const cues = glassParagraphs([paragraph("[ONE] [TWO]")]);
    const layout = layoutFromMeasure("k", [{ top: 0, wordCentres: [50, 50] }], 700, LINE, cues);
    expect(layout.pxPerReadWord).toBeCloseTo(50);
  });

  it("places the reading line from words as the hardware link does", () => {
    const layout = layoutFromMeasure(
      "k",
      [
        { top: 0, wordCentres: [50, 50, 50, 150, 150] },
        { top: 250, wordCentres: [] },
        { top: 400, wordCentres: [450, 450, 450] },
      ],
      1600,
      LINE,
      text
    );
    expect(positionOf(layout, 0, 0)).toBe(0);
    // Word 1.5 of three on the first line: halfway down it.
    expect(positionOf(layout, 0, 1.5)).toBeCloseTo(50);
    expect(positionOf(layout, 0, 4)).toBeCloseTo(150);
    expect(positionOf(layout, 1, 0)).toBe(250);
    expect(positionOf(layout, 3, 0)).toBe(1600);
    expect(lineAt(layout, 0)).toBe(0);
    expect(lineAt(layout, 199)).toBe(1);
    expect(lineAt(layout, 220)).toBe(1);
    expect(lineAt(layout, 260)).toBe(2);
    expect(lineAt(layout, 5000)).toBe(3);
  });
});
