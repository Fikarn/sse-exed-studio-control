import { describe, expect, it } from "vitest";

import type { PrompterParagraph } from "../../generated/snapshots/PrompterParagraph";
import {
  GlassClock,
  cueAfter,
  cueBefore,
  lineStartAtPosition,
  lineStep,
  lineWords,
  newLayout,
  positionOf,
  wordsAtPosition,
  type Layout,
} from "./prompterClock";
import {
  advanceByReadWords,
  clampedPlace,
  comparePlaces,
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
  readFlags,
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

  // The hardware link's `a_paragraph_of_many_cue_lines_counts_in_one_pass` (review of
  // 2026-09-27): the cue lines and the read words are counted in one pass each. (The
  // hardware link's case holds 30,000 lines under a time limit; the double's holds the
  // same answers on fewer.)
  it("counts a paragraph of many cue lines, and a word part cue, part text", () => {
    const paragraph = plainParagraph(Array.from({ length: 3_000 }, () => `[${"a".repeat(60)}]`).join("\n"));
    const cues = cueTargets([paragraph]);
    expect(cues).toHaveLength(3_000);
    expect(cues[2_999]!.word).toBe(2_999);
    expect(readFlags(paragraph).every((read) => !read)).toBe(true);
    expect(readFlags(plainParagraph("a[b] [c]d [e][f] g"))).toEqual([true, true, false, true]);
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

  // Rust compares `char`s by their code points; a JS string compares UTF-16 units, which
  // puts a character past U+FFFF (a surrogate pair from U+D800) before U+E000–U+FFFF.
  it("orders letters by their code points after lower-casing, as the hardware link does", () => {
    const fullWidthA = "\uFF21";
    const boldA = "\u{1D400}";
    expect(naturalOrder(fullWidthA, boldA)).toBeLessThan(0);
    expect(naturalOrder(boldA, fullWidthA)).toBeGreaterThan(0);
    expect(naturalOrder("Ära", "ära")).toBe(0);
    expect(naturalOrder("ä", "z")).toBeGreaterThan(0);
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

  // The hardware link's `an_update_of_several_edits_keeps_the_reading_paragraph` (review of
  // 2026-09-27): an Update gathers every edit since the script went on. A paragraph cut
  // above the reading line while the reading paragraph got a typo fixed, and one added
  // above it while it was edited, both keep the reading line on its paragraph.
  it("keeps the reading paragraph through an Update of several edits", () => {
    expect(
      mapPlace(
        text(["a b c", "cut this one", "we read here now", "z z"]),
        text(["a b c", "we read hear now", "z z"]),
        place(2, 3)
      )
    ).toEqual([place(1, 3), false]);
    expect(
      mapPlace(
        text(["a b c", "we read here now", "z z"]),
        text(["a b c", "a new thought above", "we read here, now", "z z"]),
        place(1, 2)
      )
    ).toEqual([place(2, 2), false]);
  });

  // A paragraph taken away (none alike, and the stretch changed its size) moves the place
  // to the next old paragraph's match, not merely to the end of the changed stretch; one
  // rewritten in a stretch of the same size stays in its position.
  it("moves a place from a deleted paragraph to the match of the next one", () => {
    const old = text(["a b c", "gone for good", "the next one here", "z z"]);
    const next = text(["a b c", "a fresh line", "another fresh line", "the next one, here", "z z"]);
    expect(mapPlace(old, next, place(1, 2))).toEqual([place(3, 0), true]);
    const rewritten = text(["a b c", "all new words", "the next one, here", "z z"]);
    expect(mapPlace(old, rewritten, place(1, 2))).toEqual([place(1, 2), false]);
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
    expect(wordsAtPosition(layout, layout.endTop, 3)).toEqual([3, 0]);
  });

  // Review of 2026-09-27: inside a line the reading line's height is a share of the line's
  // words, so a word offset turns into a height and back again.
  it("turns a word offset into a height inside its line and back", () => {
    const paragraphs = script(2, 12);
    const layout = laidOut(paragraphs, "k", 5, 100);
    // Paragraph 0: lines of 5, 5 and 2 words; paragraph 1 starts at 350 px.
    expect([0, 1, 2, 3].map((index) => lineWords(layout, index))).toEqual([5, 5, 2, 5]);
    expect(positionOf(layout, 0, 7.5, 2)).toBeCloseTo(150, 9);
    expect(positionOf(layout, 0, 11, 2)).toBeCloseTo(250, 9);
    expect(positionOf(layout, 1, 2.5, 2)).toBeCloseTo(400, 9);
    expect(positionOf(layout, 2, 0, 2)).toBe(layout.endTop);
    const [paragraph, offset] = wordsAtPosition(layout, 150, 2);
    expect(paragraph).toBe(0);
    expect(offset).toBeCloseTo(7.5, 9);
    expect(lineStartAtPosition(layout, 150)).toBe(5);
    expect(lineStartAtPosition(layout, 20)).toBe(0);
  });

  // §4.1 and §5.2, the hardware link's `a_new_look_keeps_the_words_at_the_reading_line`: the
  // motion goes on in words until the new layout is reported, then in its pixels, and the
  // word at the reading line is the same word in both (review of 2026-09-27: the place was
  // the line's first word and a share of the line's height, so a new size moved the
  // reading line by up to a line).
  it("keeps the words at the reading line through a new look", () => {
    const now = 1_000_000;
    const paragraphs = script(12, 30);
    for (const [perLineAfter, heightAfter] of [
      [5, 140],
      [20, 70],
      [7, 120],
    ] as const) {
      const clock = GlassClock.paused(now, "script-a", paragraphs, "g1-l0", place(0, 0), 150);
      clock.acceptLayout(now, laidOut(paragraphs, "g1-l0", 10, 100));
      clock.jump(now, 6, 19.4, false);
      expect(clock.wordsAt(now + 10)[1]).toBeCloseTo(19.4, 2);
      clock.relayout(now + 10, "g1-l1");
      expect(clock.anchor(now + 10).position).toBeNull();
      expect(clock.wordsAt(now + 10)[1]).toBeCloseTo(19.4, 2);
      clock.acceptLayout(now + 20, laidOut(paragraphs, "g1-l1", perLineAfter, heightAfter));
      const [paragraph, offset] = clock.wordsAt(now + 20);
      expect(paragraph).toBe(6);
      expect(Math.abs(offset - 19.4), `${perLineAfter} words a line: word ${offset}`).toBeLessThan(0.01);
      expect(clock.placeAt(now + 20).word).toBe(19);
      expect(clock.anchor(now + 20)).toMatchObject({ place: { paragraph: 6, word: 19 } });
      expect(clock.anchor(now + 20).wordOffset).toBeCloseTo(19.4, 2);
    }
  });

  // The hardware link's `a_layout_arriving_mid_scroll_carries_the_motion_on`: nothing jumps
  // when a layout arrives while the text scrolls; in the moments before a view reports it,
  // the words and the pixels agree to a small part of a word.
  it("carries a scroll on through a layout arriving mid-scroll", () => {
    const now = 1_000_000;
    const paragraphs = script(12, 30);
    const clock = GlassClock.paused(now, "script-a", paragraphs, "g1-l0", place(0, 0), 120);
    clock.acceptLayout(now, laidOut(paragraphs, "g1-l0", 6, 100));
    clock.play(now);
    const before = clock.placeAt(now + 10_000);
    clock.relayout(now + 10_000, "g1-l1");
    const inWords = clock.wordsAt(now + 10_200);
    expect(comparePlaces(clock.placeAt(now + 10_200), before)).toBeGreaterThanOrEqual(0);
    expect(clock.timeLeft(now + 10_200)[1]).toBe(true);
    clock.acceptLayout(now + 10_200, laidOut(paragraphs, "g1-l1", 6, 100));
    const inPixels = clock.wordsAt(now + 10_200);
    expect(inPixels[0]).toBe(inWords[0]);
    expect(Math.abs(inPixels[1] - inWords[1])).toBeLessThan(0.1);
    expect(clock.playing).toBe(true);
    expect(clock.timeLeft(now + 10_200)[1]).toBe(false);
  });

  // Review of 2026-09-27: without a layout the place moves in words; a share of a word
  // plus less than a word more stays in the word (`travelled < 1`), and past it the read
  // words carry the share on.
  it("moves the place in words without a layout", () => {
    const now = 1_000_000;
    const clock = GlassClock.paused(now, "script-a", text(["one two three four five six"]), "g1-l0", place(0, 0), 120);
    clock.jump(now, 0, 2.3, false);
    clock.play(now);
    // 0.3 words over the 0.3 s ease, then 2 words a second.
    const [paragraph, offset] = clock.wordsAt(now + 400);
    expect(paragraph).toBe(0);
    expect(offset).toBeCloseTo(2.8, 9);
    expect(clock.wordsAt(now + 750)[1]).toBeCloseTo(3.5, 9);
    expect(clock.wordsAt(now + 60_000)).toEqual([1, 0]);
  });

  // The hardware link's `a_pause_rests_where_its_ease_stops` (review of 2026-09-27): a pause
  // saves where the 0.3 s ease stops the text, not where it was at the press.
  it("rests a pause where its ease stops", () => {
    const now = 1_000_000;
    const paragraphs = script(4, 40);
    const clock = GlassClock.paused(now, "script-a", paragraphs, "g1-l0", place(0, 0), 300);
    clock.acceptLayout(now, laidOut(paragraphs, "g1-l0", 5, 100));
    clock.jump(now, 0, 4.9, false);
    clock.play(now);
    clock.pause(now + 300);
    const atPress = clock.placeAt(now + 300);
    const resting = clock.restingPlace(now + 300);
    expect(comparePlaces(resting, atPress)).toBeGreaterThan(0);
    expect(resting).toEqual(clock.placeAt(now + 5_000));
  });

  // The hardware link's `a_script_of_cues_alone_is_paced_by_its_words` (review of
  // 2026-09-27): a script with no read word is paced by all its words.
  it("paces a script of cues alone by its words", () => {
    const paragraphs = Array.from({ length: 20 }, (_, index) => plainParagraph(`[CUE ${index}]`));
    const layout = laidOut(paragraphs, "k", 5, 100);
    // Forty words (two to a cue) share the height.
    const textHeight = layout.lines[layout.lines.length - 1]!.top + 100;
    expect(layout.pxPerReadWord).toBeCloseTo(textHeight / 40, 9);
  });

  // The hardware link's `the_pace_comes_from_the_full_lines_of_running_text`
  // (the walk of 2026-10-07, finding 13): the pace's pixels per read word come
  // from the full lines of running text, not from the whole height.
  it("paces by the full lines of running text", () => {
    const paragraphs = [...script(2, 7), plainParagraph("[CUE]")];
    // Three words a line (3, 3, 1): four full lines of three read words at 100 px.
    expect(laidOut(paragraphs, "k", 3, 100).pxPerReadWord).toBeCloseTo(100 / 3, 9);
    // No line wraps: the lines that hold a read word, without the gaps.
    expect(laidOut(script(3, 2), "k", 5, 100).pxPerReadWord).toBeCloseTo(50, 9);
  });

  // Review of 2026-09-27: a cue at the reading line is not "the next cue" nor the one
  // before; it takes more than 0.02 of a word.
  it("tells a cue from the reading line by more than a fiftieth of a word", () => {
    expect(cueAfter([2, 5], [2, 5])).toBe(false);
    expect(cueAfter([2, 5], [2, 4.99])).toBe(false);
    expect(cueAfter([2, 5], [2, 4.9])).toBe(true);
    expect(cueAfter([3, 0], [2, 9.5])).toBe(true);
    expect(cueBefore([2, 5], [2, 5.01])).toBe(false);
    expect(cueBefore([2, 5], [2, 5.1])).toBe(true);
    expect(cueBefore([1, 9], [2, 0])).toBe(true);
  });

  it("holds the text where it is, at once", () => {
    const now = 1_000_000;
    const paragraphs = script(4, 40);
    const clock = GlassClock.paused(now, "script-a", paragraphs, "g1-l0", place(0, 0), 140);
    clock.acceptLayout(now, laidOut(paragraphs, "g1-l0", 5, 100));
    clock.play(now);
    const held = clock.wordsAt(now + 2_000);
    clock.hold(now + 2_000);
    expect(clock.playing).toBe(false);
    expect(clock.wordsAt(now + 9_000)).toEqual(held);
    expect(clock.anchor(now + 9_000)).toMatchObject({ toWpm: 0, fromWpm: 0, moveFromPosition: null });
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
