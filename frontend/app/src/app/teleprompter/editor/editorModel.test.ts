import { describe, expect, it } from "vitest";

import { compareWithGlass, cueRanges, normalizeRuns, sameText, withAParagraph, type Paragraph } from "./editorModel";

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
    expect(compareWithGlass(text, glass, null)).toMatchObject({ removed: 0, reordered: false, readingLine: null });
    expect([...compareWithGlass(text, glass, null).edited]).toEqual([1, 2]);
  });

  it("counts the glass's paragraphs the text no longer holds, a second copy as added, and a new order", () => {
    const glass = [para(run("One.")), para(run("Two.")), para(run("Three.")), para(run("Four."))];
    const removedTwo = [para(run("One.")), para(run("Four."))];
    expect(compareWithGlass(removedTwo, glass, null)).toMatchObject({ removed: 2, reordered: false });
    expect(compareWithGlass(removedTwo, glass, null).edited.size).toBe(0);
    const copied = [...glass, para(run("Two."))];
    expect([...compareWithGlass(copied, glass, null).edited]).toEqual([4]);
    // One edited and one removed: one fewer.
    const editedAndRemoved = [para(run("One!")), para(run("Three.")), para(run("Four."))];
    expect(compareWithGlass(editedAndRemoved, glass, null)).toMatchObject({ removed: 1 });
    const moved = [glass[1]!, glass[0]!, glass[2]!, glass[3]!];
    expect(compareWithGlass(moved, glass, null)).toMatchObject({ removed: 0, reordered: true });
    expect(compareWithGlass(glass, glass, null)).toMatchObject({ removed: 0, reordered: false });
  });

  it("finds the glass's paragraph at the reading line in the edited text: unchanged, edited or removed", () => {
    const glass = [para(run("One.")), para(run("Two.")), para(run("Three."))];
    const text = [para(run("One.")), para(run("New.")), para(run("Two.")), para(run("Three!"))];
    expect(compareWithGlass(text, glass, 1).readingLine).toEqual({ state: "unchanged", index: 2 });
    // Edited: the paragraph between its neighbours' matches.
    expect(compareWithGlass(text, glass, 2).readingLine).toEqual({ state: "edited", index: 3 });
    // Removed: nothing between its neighbours, and no other paragraph is marked for it.
    const without = [para(run("One.")), para(run("Three."))];
    expect(compareWithGlass(without, glass, 1).readingLine).toEqual({ state: "removed" });
    expect(compareWithGlass(text, glass, 5).readingLine).toBeNull();
  });

  it("knows the same text, paragraph for paragraph and formatting and all", () => {
    const text = [para(run("One "), run("two", { bold: true }))];
    expect(sameText(text, [para(run("One "), run("two", { bold: true }))])).toBe(true);
    expect(sameText(text, [para(run("One two"))])).toBe(false);
    expect(sameText(text, [...text, para()])).toBe(false);
  });

  it("gives an empty script one paragraph to type in", () => {
    expect(withAParagraph([])).toEqual([{ runs: [] }]);
  });
});
