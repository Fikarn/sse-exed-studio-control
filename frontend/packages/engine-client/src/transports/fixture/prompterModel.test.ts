import { describe, expect, it } from "vitest";

import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import { GlassClock, lineStep, newLayout, placeAtPosition, type Layout } from "./prompterClock";
import {
  advanceByReadWords,
  clampedPlace,
  counted,
  cueSpans,
  cueTargets,
  endOf,
  formatCount,
  makeRun,
  mapPlace,
  naturalOrder,
  normalizedParagraph,
  plainParagraph,
  readWordCount,
  readWordsFrom,
  sanitizeText,
  wordCount,
  wordSpans,
} from "./prompterModel";
import { layoutOf } from "./prompterTestSupport";

// The double's script model and clock, held to the hardware link's own unit tests
// (`prompter/model.rs`, `edits.rs`, `snapshot.rs` and `clock/tests.rs`), case for case.

const text = (paragraphs: string[]) => paragraphs.map(plainParagraph);
const place = (paragraph: number, word: number) => ({ paragraph, word });
const script = (paragraphs: number, words: number) =>
  Array.from({ length: paragraphs }, (_, paragraph) =>
    plainParagraph(Array.from({ length: words }, (_, word) => `p${paragraph}w${word}`).join(" "))
  );
/** The clock tests' `layout_of`: END half a 1,080 px screen below the last paragraph's gap. */
function laidOut(paragraphs: PrompterParagraph[], key: string, perLine: number, height: number): Layout {
  const { lines, endTop } = layoutOf(paragraphs, perLine, height);
  const layout = newLayout(key, lines, endTop + 540, paragraphs);
  if (typeof layout === "string") throw new Error(layout);
  return layout;
}

describe("the double's script model", () => {
  it("counts words as runs of characters that are not white space", () => {
    const words = "  Hej  då,\nvärlden\u00a0igen ";
    expect(wordSpans(words).map(([begin, end]) => words.slice(begin, end))).toEqual(["Hej", "då,", "världen", "igen"]);
  });

  it("reads a cue as bracketed text on one line, and leaves cue words out of the pace", () => {
    const line = "Say [PAUSE] then [look at\nCAM 2] and [end]";
    expect(cueSpans(line).map(([begin, end]) => line.slice(begin, end))).toEqual(["[PAUSE]", "[end]"]);
    const paragraphs = text(["[INTRO]", "Welcome to the studio [smile] today."]);
    expect(wordCount(paragraphs)).toBe(7);
    expect(readWordCount(paragraphs)).toBe(5);
  });

  it("takes only a cue on a line of its own as a jump target", () => {
    expect(cueTargets(text(["[ Intro ]", "Hello [smile] there.\n[PAUSE]\nAgain."]))).toEqual([
      { paragraph: 0, word: 0, text: "Intro" },
      { paragraph: 1, word: 3, text: "PAUSE" },
    ]);
  });

  it("sanitizes to one kind of line break and no controls, and joins runs of one emphasis", () => {
    expect(sanitizeText("\uFEFFa\r\nb\rc\u2028d\te\u0007f\u0085g")).toBe("a\nb\nc\nd ef\ng");
    expect(
      normalizedParagraph({
        runs: [
          makeRun("Hello "),
          makeRun(""),
          makeRun("there "),
          makeRun("now", { bold: true, italic: false, underline: false }),
        ],
      }).runs
    ).toEqual([makeRun("Hello there "), makeRun("now", { bold: true, italic: false, underline: false })]);
  });

  it("writes counts as the operator reads them", () => {
    expect([7, 1240, 30000, 1234567].map(formatCount)).toEqual(["7", "1,240", "30,000", "1,234,567"]);
    expect(counted(1, "cue", "cues")).toBe("1 cue");
    expect(counted(1240, "word", "words")).toBe("1,240 words");
  });

  it("sorts names with numbers in their natural order", () => {
    expect(["10 Outro", "2 Guest", "01 Intro", "b roll", "A take"].sort(naturalOrder)).toEqual([
      "01 Intro",
      "2 Guest",
      "10 Outro",
      "A take",
      "b roll",
    ]);
    expect(naturalOrder("Take 2", "Take 2")).toBe(0);
    expect(naturalOrder("Take", "Take 2")).toBeLessThan(0);
  });

  it("counts read words on from a place, and keeps a place inside its script", () => {
    const paragraphs = text(["[INTRO]", "One two [smile] three", "Four five"]);
    expect(readWordsFrom(paragraphs, place(0, 0))).toBe(5);
    expect(readWordsFrom(paragraphs, place(1, 2))).toBe(3);
    expect(advanceByReadWords(paragraphs, place(0, 0), 2)).toEqual(place(1, 2));
    expect(advanceByReadWords(paragraphs, place(0, 0), 3)).toEqual(place(2, 0));
    expect(advanceByReadWords(paragraphs, place(0, 0), 99)).toEqual(endOf(paragraphs));
    const short = script(3, 4);
    expect(clampedPlace(place(1, 9), short)).toEqual(place(1, 3));
    expect(clampedPlace(place(7, 1), short)).toEqual(endOf(short));
  });
});

describe("the double's map of a place through an edit", () => {
  it("keeps the words of an unchanged paragraph", () => {
    const old = text(["a b c", "d e f", "g h i"]);
    expect(mapPlace(old, text(["new first", "a b c", "d e f", "g h i"]), place(1, 2))).toEqual([place(2, 2), false]);
    expect(mapPlace(old, text(["a b c", "d e f", "g h i", "added at the end"]), place(2, 1))).toEqual([
      place(2, 1),
      false,
    ]);
  });

  it("keeps the word of a changed paragraph as far as it goes", () => {
    const old = text(["a b c", "d e f g h", "i j"]);
    const next = text(["a b c", "d e changed", "i j"]);
    expect(mapPlace(old, next, place(1, 1))).toEqual([place(1, 1), false]);
    expect(mapPlace(old, next, place(1, 4))).toEqual([place(1, 2), false]);
  });

  it("moves the place on from a deleted paragraph, to the end when nothing follows", () => {
    expect(mapPlace(text(["a b", "gone now", "c d", "e f"]), text(["a b", "c d", "e f"]), place(1, 1))).toEqual([
      place(1, 0),
      true,
    ]);
    const next = text(["a b"]);
    expect(mapPlace(text(["a b", "gone"]), next, place(1, 0))).toEqual([endOf(next), true]);
    expect(mapPlace(text(["a", "b"]), text(["a", "b", "c"]), place(2, 0))).toEqual([place(3, 0), false]);
  });
});

describe("the double's clock", () => {
  it("refuses a layout that does not fit the text", () => {
    const paragraphs = script(2, 6);
    const lines = (entries: Array<[number, number, number]>) =>
      entries.map(([paragraph, word, top]) => ({ paragraph, word, top, height: 100 }));
    expect(
      typeof newLayout(
        "k",
        lines([
          [0, 0, 0],
          [0, 3, 100],
          [1, 0, 250],
        ]),
        900,
        paragraphs
      )
    ).toBe("object");
    const refusals: Array<[Array<[number, number, number]>, number, string]> = [
      [
        [
          [0, 1, 0],
          [1, 0, 150],
        ],
        900,
        "The layout's first line must start the first paragraph.",
      ],
      [
        [
          [0, 0, 0],
          [1, 0, 150],
          [2, 0, 300],
        ],
        900,
        "The layout names paragraph 3, and the text on the glass has 2.",
      ],
      [
        [
          [0, 0, 0],
          [0, 9, 100],
          [1, 0, 250],
        ],
        900,
        "The layout starts a line at word 10 of paragraph 1, which has 6.",
      ],
      [
        [
          [0, 0, 0],
          [1, 0, 50],
        ],
        900,
        "The layout's lines are not in order.",
      ],
      [
        [
          [0, 0, 0],
          [1, 2, 150],
        ],
        900,
        "The layout must start paragraph 2 on a line of its own.",
      ],
      [
        [
          [0, 0, 0],
          [1, 0, 150],
        ],
        200,
        "The layout's END must stand below its last line.",
      ],
    ];
    for (const [entries, end, sentence] of refusals) {
      expect(newLayout("k", lines(entries), end, paragraphs)).toBe(sentence);
    }
    expect(newLayout("k", [{ paragraph: 0, word: 0, top: -1, height: 10 }], 900, paragraphs)).toBe(
      "Each line of the layout needs a top and a height in pixels."
    );
  });

  it("steps one line and stays inside the script", () => {
    const layout = laidOut(script(3, 10), "k", 5, 100);
    expect(lineStep(layout, 30, true)).toBeCloseTo(130, 9);
    expect(lineStep(layout, 130, false)).toBeCloseTo(30, 9);
    expect(lineStep(layout, 0, false)).toBe(0);
    expect(lineStep(layout, layout.endTop, true)).toBe(layout.endTop);
    expect(placeAtPosition(layout, layout.endTop, 3)).toEqual([place(3, 0), 0]);
  });

  // §4.1 and §5.2: a new look keeps the words at the reading line; the motion goes on in
  // words until the new layout is reported, then in its pixels.
  it("keeps the words at the reading line through a new look, and carries a scroll on", () => {
    const now = 1_000_000;
    const paragraphs = script(12, 30);
    const clock = GlassClock.paused(now, "script-a", paragraphs, "g1-l0", place(0, 0), 120);
    clock.acceptLayout(now, laidOut(paragraphs, "g1-l0", 6, 100));
    clock.play(now);
    const before = clock.placeAt(now + 10_000)[0];
    clock.relayout(now + 10_000, "g1-l1");
    expect(clock.anchor(now + 10_000).position).toBeNull();
    expect(clock.placeAt(now + 10_000)[0]).toEqual(before);
    const inWords = clock.placeAt(now + 30_000)[0];
    expect(inWords.paragraph * 30 + inWords.word).toBeGreaterThan(before.paragraph * 30 + before.word);
    expect(clock.timeLeft(now + 30_000)[1]).toBe(true);
    clock.acceptLayout(now + 30_000, laidOut(paragraphs, "g1-l1", 6, 100));
    expect(clock.placeAt(now + 30_000)[0].paragraph).toBe(inWords.paragraph);
    expect(clock.playing).toBe(true);
    expect(clock.timeLeft(now + 30_000)[1]).toBe(false);
  });

  it("estimates the time from the words until a layout comes", () => {
    const now = 1_000_000;
    const paragraphs = script(4, 35);
    const clock = GlassClock.paused(now, "script-a", paragraphs, "g1-l0", place(0, 0), 140);
    expect(clock.timeLeft(now)).toEqual([60, true]);
    expect(clock.length()).toEqual([60, true]);
    expect(clock.timeToEndMs(now)).toBeNull();
    clock.acceptLayout(now, laidOut(paragraphs, "g1-l0", 5, 100));
    const [exact, estimated] = clock.timeLeft(now);
    expect(estimated).toBe(false);
    expect(exact).toBeGreaterThan(60);
  });
});
