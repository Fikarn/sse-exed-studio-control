import { describe, expect, it } from "vitest";

import type { PrompterLayoutLine } from "../generated/snapshots/PrompterLayoutLine";
import { pacePixels } from "./pace";

// The pace's pixels per read word (the walk of 2026-10-07, finding 13): from
// the full lines of running text, as `clock.rs`'s `pace_pixels`.

const LINE = 100;
const line = (paragraph: number, word: number, top: number): PrompterLayoutLine => ({
  paragraph,
  word,
  top,
  height: LINE,
});
const read = (words: number) => Array.from({ length: words }, () => true);

describe("the pace's pixels per read word", () => {
  it("come from the full lines of running text: the gaps, the cue lines and the short last lines are left out", () => {
    // Two paragraphs of seven words, three a line (3, 3, 1), half a line
    // between them, then a cue on a line of its own.
    const lines = [
      line(0, 0, 0),
      line(0, 3, 100),
      line(0, 6, 200),
      line(1, 0, 350),
      line(1, 3, 450),
      line(1, 6, 550),
      line(2, 0, 700),
    ];
    const flags = [read(7), read(7), [false]];
    // Four full lines of three read words at 100 px; until 2026-10-08 the
    // whole 800 px over the 14 read words, 57 px a word.
    expect(pacePixels(lines, [7, 7, 1], flags, 800)).toBeCloseTo(100 / 3, 9);
  });

  it("take the lines that hold a read word when no line wraps", () => {
    const lines = [line(0, 0, 0), line(1, 0, 150), line(2, 0, 300)];
    expect(pacePixels(lines, [2, 2, 2], [read(2), read(2), read(2)], 400)).toBeCloseTo(50, 9);
  });

  it("count a line's read words only, so a cue inside a full line does not slow it", () => {
    // Five words a line, the second of them a cue: four read words a line.
    const lines = [line(0, 0, 0), line(0, 5, 100), line(0, 10, 200)];
    const flags = [[true, false, true, true, true, true, false, true, true, true, true]];
    expect(pacePixels(lines, [11], flags, 300)).toBeCloseTo(100 / 4, 9);
  });

  it("pace a script of cues alone by all its words over the whole height", () => {
    const lines = [line(0, 0, 0), line(1, 0, 100)];
    expect(
      pacePixels(
        lines,
        [2, 2],
        [
          [false, false],
          [false, false],
        ],
        200
      )
    ).toBeCloseTo(50, 9);
    expect(pacePixels([line(0, 0, 0)], [0], [[]], 100)).toBeCloseTo(100, 9);
  });
});
