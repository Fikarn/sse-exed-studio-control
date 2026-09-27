import { describe, expect, it } from "vitest";

import {
  cueRanges,
  editedParagraphs,
  normalizeRuns,
  readingLineIn,
  withAParagraph,
  type Paragraph,
} from "./editorModel";

// The script editor's model (new pages program, Slice 6b): what the script's
// text is, and what the glass shows of it.

const run = (text: string, format: Partial<{ bold: boolean; italic: boolean; underline: boolean }> = {}) => ({
  text,
  bold: false,
  italic: false,
  underline: false,
  ...format,
});
const para = (...runs: ReturnType<typeof run>[]): Paragraph => ({ runs });

describe("the script editor's model", () => {
  it("joins runs of one format and drops empty ones", () => {
    expect(normalizeRuns([run("a"), run(""), run("b"), run("c", { bold: true })])).toEqual([
      run("ab"),
      run("c", { bold: true }),
    ]);
  });

  it("finds the cues of a paragraph as the glass marks them", () => {
    expect(cueRanges("[PAUSE] Hello [look at CAM 2].")).toEqual([
      { from: 0, to: 7 },
      { from: 14, to: 29 },
    ]);
    expect(cueRanges("no [cue")).toEqual([]);
  });

  it("marks the paragraphs the glass does not show as they are, formatting and all", () => {
    const glass = [para(run("One.")), para(run("Two.")), para(run("Three."))];
    const text = [para(run("One.")), para(run("New.")), para(run("Two.", { bold: true })), para(run("Three."))];
    expect([...editedParagraphs(text, glass)]).toEqual([1, 2]);
  });

  it("finds the glass's paragraph at the reading line in the edited text, nearest where it was", () => {
    const glass = [para(run("One.")), para(run("Two.")), para(run("Three."))];
    const text = [para(run("One.")), para(run("New.")), para(run("Two.")), para(run("Three!"))];
    expect(readingLineIn(text, glass, 1)).toBe(2);
    // The paragraph at the reading line was edited: the place it had.
    expect(readingLineIn(text, glass, 2)).toBe(2);
    expect(readingLineIn(text, glass, 5)).toBeNull();
  });

  it("gives an empty script one paragraph to type in", () => {
    expect(withAParagraph([])).toEqual([{ runs: [] }]);
  });
});
