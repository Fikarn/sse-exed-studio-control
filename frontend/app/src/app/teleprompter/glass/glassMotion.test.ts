import { positionAt } from "@sse/engine-client";
import { describe, expect, it } from "vitest";

import { glassMetrics, layoutFromMeasure, type GlassLayout } from "./glassLayout";
import { glassFrame, glassPosition, glassSettled } from "./glassMotion";
import { paragraph, standardLook, storyAnchor } from "./glassStoryScript";
import { glassParagraphs } from "./glassText";

// Where the glass draws the text (new pages program, Slice 5a): from the
// anchor's own pixels when it belongs to this glass's layout, from its words
// otherwise, with a jump's 0.2 s move and the band over the text already read.

const LINE = 100;

// Two paragraphs: six words on two lines, then four words on one; END at 900.
const LAYOUT: GlassLayout = layoutFromMeasure(
  "g3-l1",
  [
    { top: 0, wordCentres: [50, 50, 50, 150, 150, 150] },
    { top: 250, wordCentres: [300, 300, 300, 300] },
  ],
  900,
  LINE,
  glassParagraphs([paragraph("one two three four five six"), paragraph("seven eight nine ten")])
);

describe("the glass's motion", () => {
  it("draws an anchor for its own layout from the anchor's pixels, as motion.ts has it", () => {
    const anchor = storyAnchor({
      layoutKey: "g3-l1",
      position: 120,
      endPosition: 900,
      pxPerReadWord: 35,
      playing: true,
      fromWpm: 0,
      toWpm: 120,
      rampMs: 300,
      ageMs: 40,
    });
    for (const elapsed of [0, 150, 1000, 60_000]) {
      expect(glassPosition(anchor, LAYOUT, elapsed)).toBeCloseTo(positionAt(anchor, elapsed)!);
    }
    expect(glassPosition(anchor, LAYOUT, 60_000)).toBe(900);
  });

  it("draws an anchor for another layout from its words, through its own layout", () => {
    const anchor = storyAnchor({ layoutKey: "g3-l0", place: { paragraph: 0, word: 4 }, wordOffset: 4.5 });
    // Word 4.5 of the second line (words 3–5): halfway down it.
    expect(glassPosition(anchor, LAYOUT, 0)).toBeCloseTo(150);
    const playing = { ...anchor, playing: true, fromWpm: 60, toWpm: 60, rampMs: 0 };
    // One word a second at the layout's own pixels a word (350 / 10).
    expect(glassPosition(playing, LAYOUT, 1000)).toBeCloseTo(150 + LAYOUT.pxPerReadWord);
    expect(glassPosition({ ...anchor, atEnd: true }, LAYOUT, 0)).toBe(900);
  });

  it("moves a jump from where the text was over 0.2 s, and lands on the place", () => {
    const anchor = storyAnchor({
      layoutKey: "g3-l1",
      position: 250,
      endPosition: 900,
      pxPerReadWord: 35,
      moveFromPosition: 0,
      moveMs: 200,
    });
    expect(glassPosition(anchor, LAYOUT, 0)).toBeCloseTo(0);
    const halfway = glassPosition(anchor, LAYOUT, 100);
    expect(halfway).toBeGreaterThan(125);
    expect(halfway).toBeLessThan(250);
    expect(glassPosition(anchor, LAYOUT, 200)).toBe(250);
    expect(glassPosition(anchor, LAYOUT, 5000)).toBe(250);
  });

  it("settles once paused and past its ease and its move, and never while playing", () => {
    const pausing = storyAnchor({ fromWpm: 140, toWpm: 0, rampMs: 300, ageMs: 100 });
    expect(glassSettled(pausing, 100)).toBe(false);
    expect(glassSettled(pausing, 200)).toBe(true);
    expect(glassSettled(storyAnchor({ playing: true, toWpm: 140 }), 60_000)).toBe(false);
    expect(glassSettled(storyAnchor({ moveFromPosition: 0, moveMs: 200 }), 150)).toBe(false);
  });
});

describe("the glass's frame", () => {
  const metrics = { ...glassMetrics(standardLook(), 88), lineHeight: LINE, readingY: 378 };

  it("centres the line at the place on the reading line and dims what was read above it", () => {
    const atLine = glassFrame(LAYOUT, metrics, 100);
    // The line whose top is at the position sits centred on the reading line.
    expect(atLine.shift).toBe(378 - 50 - 100);
    expect(atLine.readHeight).toBe(328);
    // Halfway through it the line has moved up half a line and stays bright.
    const halfway = glassFrame(LAYOUT, metrics, 150);
    expect(halfway.readHeight).toBe(278);
    // In the gap between paragraphs the last line is still the one being read.
    expect(glassFrame(LAYOUT, metrics, 220).readHeight).toBe(208);
  });

  it("at END dims everything above END's line", () => {
    expect(glassFrame(LAYOUT, metrics, 900)).toEqual({ shift: 378 - 50 - 900, readHeight: 328 });
  });
});
