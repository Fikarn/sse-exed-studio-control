import { describe, expect, it } from "vitest";

import { paragraph } from "./glassStoryScript";
import { glassParagraph, type GlassLine } from "./glassText";

// The glass cuts a paragraph by the hardware link's own rules
// (`native/rust-engine/src/prompter/model.rs` and its tests), so its word
// indices are the place's words.

function words(line: GlassLine) {
  return line.tokens.flatMap((token) =>
    token.kind === "word" ? [`${token.word.index}:${token.word.pieces.map((p) => p.text).join("")}`] : []
  );
}

describe("the glass's text", () => {
  it("counts words as runs of characters that are not white space, across emphasis", () => {
    const cut = glassParagraph(paragraph("what did you have to un", { text: "learn", bold: true }, "?  It sounds"), 0);
    expect(cut.wordCount).toBe(8);
    expect(words(cut.lines[0])).toEqual([
      "0:what",
      "1:did",
      "2:you",
      "3:have",
      "4:to",
      "5:unlearn?",
      "6:It",
      "7:sounds",
    ]);
    const unlearn = cut.lines[0].tokens.find((token) => token.kind === "word" && token.word.index === 5);
    expect(unlearn?.kind === "word" && unlearn.word.pieces).toEqual([
      { text: "un", bold: false, italic: false, underline: false },
      { text: "learn", bold: true, italic: false, underline: false },
      { text: "?", bold: false, italic: false, underline: false },
    ]);
  });

  it("keeps a line break as a line of its own and counts on across it", () => {
    const cut = glassParagraph(paragraph("[turn to the guest]\nWelcome to the studio."), 3);
    expect(cut.index).toBe(3);
    expect(cut.lines).toHaveLength(2);
    expect(words(cut.lines[0])).toEqual(["0:[turn", "1:to", "2:the", "3:guest]"]);
    expect(words(cut.lines[1])).toEqual(["4:Welcome", "5:to", "6:the", "7:studio."]);
    expect(cut.lines[0].cueLine).toBe(true);
    expect(cut.lines[1].cueLine).toBe(false);
  });

  it("draws a word that is all cue in the cue colour, and a cue on a line with text is not a cue line", () => {
    const cut = glassParagraph(paragraph("On the screen [slide 3] you can [see"), 0);
    const cues = cut.lines[0].tokens.flatMap((token) =>
      token.kind === "word" ? [[token.word.index, token.word.cue] as const] : []
    );
    expect(cues).toEqual([
      [0, false],
      [1, false],
      [2, false],
      [3, true],
      [4, true],
      [5, false],
      [6, false],
      [7, false],
    ]);
    expect(cut.lines[0].cueLine).toBe(false);
  });

  it("closes a cue only on its own line", () => {
    const cut = glassParagraph(paragraph("[open\nclose]"), 0);
    expect(cut.lines.map((line) => line.cueLine)).toEqual([false, false]);
    const flags = cut.lines.flatMap((line) =>
      line.tokens.flatMap((token) => (token.kind === "word" ? [token.word.cue] : []))
    );
    expect(flags).toEqual([false, false]);
  });

  it("gives an empty paragraph one empty line and no word", () => {
    const cut = glassParagraph(paragraph(""), 0);
    expect(cut.wordCount).toBe(0);
    expect(cut.lines).toEqual([{ tokens: [], cueLine: false }]);
  });

  it("drops the spaces at a line's ends and keeps one between words", () => {
    const cut = glassParagraph(paragraph("  one   two  \n three"), 0);
    expect(cut.lines[0].tokens.map((token) => token.kind)).toEqual(["word", "space", "word"]);
    expect(cut.lines[1].tokens.map((token) => token.kind)).toEqual(["word"]);
  });

  it("cuts a paragraph of thousands of cue lines in one pass", () => {
    const text = Array.from({ length: 30_000 }, (_, index) => `[cue ${index}]`).join("\n");
    const started = performance.now();
    const cut = glassParagraph(paragraph(text), 0);
    expect(cut.lines).toHaveLength(30_000);
    expect(cut.lines.every((line) => line.cueLine)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
