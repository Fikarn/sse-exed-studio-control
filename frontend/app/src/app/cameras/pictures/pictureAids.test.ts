import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CROSS_ALPHA,
  CROSS_ARM,
  GUIDE_ALPHA,
  GUIDE_WIDTH,
  MARKER_DASH,
  MARKER_WIDTH,
  PEAKING_INK,
  PEAKING_STEP,
  STRIPE_DARK_ALPHA,
  STRIPE_LIGHT_ALPHA,
  STRIPE_PERIOD,
  ZEBRA_LEVEL,
  brightness,
  peakingMask,
  peakingOverlay,
  zebraMask,
  zebraOverlay,
} from "./pictureAids";

// The picture aids are worked out from pixels: a small picture written by
// hand says what each marks.

/** A picture of grey pixels, one brightness (0..255) each, row by row. */
function greys(rows: number[][]): { pixels: Uint8ClampedArray; width: number; height: number } {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const pixels = new Uint8ClampedArray(width * height * 4);
  rows.flat().forEach((grey, index) => {
    pixels.set([grey, grey, grey, 255], index * 4);
  });
  return { pixels, width, height };
}

const rowsOf = (mask: Uint8Array, width: number) =>
  Array.from({ length: mask.length / width }, (_, row) => Array.from(mask.slice(row * width, (row + 1) * width)));

describe("the picture aids", () => {
  it("reads brightness as the eye weighs the colours", () => {
    expect(brightness(255, 255, 255)).toBeCloseTo(1, 5);
    expect(brightness(0, 0, 0)).toBe(0);
    expect(brightness(0, 255, 0)).toBeCloseTo(0.7152, 4);
    expect(brightness(255, 0, 0)).toBeCloseTo(0.2126, 4);
    expect(brightness(0, 0, 255)).toBeCloseTo(0.0722, 4);
  });

  it("marks with zebras what is at or over 95 %", () => {
    const { pixels, width, height } = greys([
      [255, 243, 242, 128],
      [0, 250, 241, 255],
    ]);
    // 243 / 255 is 95.3 %, 242 / 255 is 94.9 %.
    expect(rowsOf(zebraMask(pixels, width, height), width)).toEqual([
      [1, 1, 0, 0],
      [0, 1, 0, 1],
    ]);
    expect(rowsOf(zebraMask(pixels, width, height, 0.5), width)).toEqual([
      [1, 1, 1, 1],
      [0, 1, 1, 1],
    ]);
  });

  it("marks with peaking both sides of an edge, and nothing on a slope", () => {
    const edge = greys([
      [20, 20, 200, 200],
      [20, 20, 200, 200],
      [20, 20, 200, 200],
    ]);
    expect(rowsOf(peakingMask(edge.pixels, edge.width, edge.height), edge.width)).toEqual([
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 1, 1, 0],
    ]);
    const below = greys([
      [20, 20, 20],
      [200, 200, 200],
    ]);
    expect(rowsOf(peakingMask(below.pixels, below.width, below.height), below.width)).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ]);
    // A slope of 10 a pixel (4 % of the range) is soft: out of focus, or a ramp.
    const slope = greys([[100, 110, 120, 130, 140]]);
    expect(Array.from(peakingMask(slope.pixels, slope.width, slope.height))).toEqual([0, 0, 0, 0, 0]);
  });

  it("paints the zebras as stripes and the peaking in the display's blue, and nothing elsewhere", () => {
    const mask = new Uint8Array(16 * 2).fill(1);
    mask[3] = 0;
    const zebras = zebraOverlay(mask, 16, 2);
    const pixel = (overlay: Uint8ClampedArray, index: number) => Array.from(overlay.slice(index * 4, index * 4 + 4));
    expect(pixel(zebras, 0)).toEqual([255, 255, 255, 230]);
    expect(pixel(zebras, 3)).toEqual([0, 0, 0, 0]);
    expect(pixel(zebras, 8)).toEqual([0, 0, 0, 153]);
    // One row down the stripes have moved one pixel: they slant.
    expect(pixel(zebras, 16 + 7)).toEqual([0, 0, 0, 153]);
    expect(pixel(zebras, 16 + 15)).toEqual([255, 255, 255, 230]);

    const peaking = peakingOverlay(mask, 16, 2);
    expect(pixel(peaking, 0)).toEqual([124, 196, 255, 255]);
    expect(pixel(peaking, 3)).toEqual([0, 0, 0, 0]);
  });
});

// In the app's window the pictures helper draws the aids (`aids.rs`): with these numbers,
// held here by reading its source, so that neither can move without the other.
describe("the pictures helper's aids", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, "../../../../../../native/pictures-link/src/aids.rs"), "utf8");
  /** The value of `pub const NAME: … = …;` in `aids.rs`, as written. */
  const rust = (name: string) => {
    const value = source.match(new RegExp(`pub const ${name}: [^=]+ = ([^;]+);`))?.[1];
    if (value === undefined) throw new Error(`aids.rs has no ${name} any more; update this test`);
    return value;
  };
  const number = (name: string) => Number(rust(name));
  const list = (name: string) => [...rust(name).matchAll(/[\d.]+/g)].map((match) => Number(match[0]));

  it("has the page's numbers, every one", () => {
    expect(number("ZEBRA_LEVEL")).toBe(ZEBRA_LEVEL);
    expect(number("PEAKING_STEP")).toBe(PEAKING_STEP);
    expect(number("STRIPE_PERIOD")).toBe(STRIPE_PERIOD);
    expect(number("STRIPE_LIGHT_ALPHA")).toBe(STRIPE_LIGHT_ALPHA);
    expect(number("STRIPE_DARK_ALPHA")).toBe(STRIPE_DARK_ALPHA);
    expect(list("PEAKING_INK")).toEqual([...PEAKING_INK]);
    expect(number("GUIDE_WIDTH")).toBe(GUIDE_WIDTH);
    expect(number("GUIDE_ALPHA")).toBe(GUIDE_ALPHA);
    expect(number("CROSS_ARM")).toBe(CROSS_ARM);
    expect(number("CROSS_ALPHA")).toBe(CROSS_ALPHA);
    expect(number("MARKER_WIDTH")).toBe(MARKER_WIDTH);
    expect(list("MARKER_DASH")).toEqual([...MARKER_DASH]);
  });

  it("works out brightness as the page does", () => {
    expect(source).toContain(
      "(0.2126 * f64::from(rgb[0]) + 0.7152 * f64::from(rgb[1]) + 0.0722 * f64::from(rgb[2])) / 255.0"
    );
    expect(brightness(255, 255, 255)).toBeCloseTo(1, 12);
  });
});
