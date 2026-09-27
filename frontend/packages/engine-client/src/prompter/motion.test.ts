/// <reference types="node" />
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { positionAt, speedAt, wordsAdvanced, type PrompterMotionAnchor } from "./motion";

// First step 1a of the new pages program's Slice 4: the front end's copy of the
// motion formula and the hardware link's (`clock.rs`) are held to one table, read
// here from the file the Rust test includes, so a case changed on one side only
// fails on both.

interface MotionCase {
  name: string;
  anchor: {
    position: number;
    endPosition: number;
    pxPerReadWord: number;
    fromWpm: number;
    toWpm: number;
    rampMs: number;
    ageMs: number;
  };
  at: Array<{ elapsedMs: number; position: number }>;
}

const MOTION_CASES = JSON.parse(
  readFileSync(
    resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../native/rust-engine/src/prompter/clock/motion-cases.json"
    ),
    "utf-8"
  )
) as { cases: MotionCase[] };

const TOLERANCE = 1e-6;

describe("the prompter's motion", () => {
  it("reads the shared cases", () => {
    expect(MOTION_CASES.cases.length).toBeGreaterThanOrEqual(6);
  });

  it.each(MOTION_CASES.cases.map((entry) => [entry.name, entry] as const))("%s", (_name, entry) => {
    for (const point of entry.at) {
      const position = positionAt(entry.anchor, point.elapsedMs);
      expect(position, `${entry.name} at ${point.elapsedMs} ms`).not.toBeNull();
      expect(Math.abs(position! - point.position), `${entry.name} at ${point.elapsedMs} ms: ${position}`).toBeLessThan(
        TOLERANCE
      );
    }
  });

  it("has no position before the layout is reported", () => {
    const anchor: PrompterMotionAnchor = {
      position: null,
      endPosition: null,
      pxPerReadWord: null,
      fromWpm: 0,
      toWpm: 140,
      rampMs: 300,
      ageMs: 0,
    };
    expect(positionAt(anchor, 1000)).toBeNull();
    // The words still move: the hardware link counts them until a layout comes.
    // Half the ramp's 0.3 s at the average pace, then 60 s at 140 words a minute.
    expect(wordsAdvanced(anchor, 60_300)).toBeCloseTo(140 + 0.35, 9);
  });

  it("eases the pace over the ramp and adds the anchor's age", () => {
    const easing = { fromWpm: 100, toWpm: 200, rampMs: 300, ageMs: 0 };
    expect(speedAt(easing, 0)).toBe(100);
    expect(speedAt(easing, 150)).toBe(150);
    expect(speedAt(easing, 300)).toBe(200);
    expect(speedAt(easing, 5000)).toBe(200);
    expect(speedAt({ ...easing, ageMs: 150 }, 0)).toBe(150);
    expect(speedAt({ ...easing, rampMs: 0 }, 0)).toBe(200);
    expect(wordsAdvanced({ ...easing, ageMs: 300 }, 0)).toBeCloseTo(wordsAdvanced(easing, 300), 12);
    expect(wordsAdvanced(easing, -50)).toBe(0);
  });
});
