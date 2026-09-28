// The picture aids, worked out from the picture's own pixels on this PC and
// drawn on this screen only: nothing here reaches a camera or vMix. Zebras
// mark what is at or over a brightness; peaking marks what is sharp. Both
// take the picture as 8-bit RGBA, row by row, as a canvas gives it.

/** Where the zebras start: 95 % of full brightness. */
export const ZEBRA_LEVEL = 0.95;

/** How far two neighbours must differ in brightness, of the full range, to count as sharp. */
export const PEAKING_STEP = 0.12;

/** The zebra stripes' period, in the picture's pixels. */
const STRIPE_PERIOD = 16;

/** The peaking's ink: the display's blue (`#7cc4ff`). */
const PEAKING_INK = [124, 196, 255] as const;

/** A pixel's brightness from 0 to 1 (Rec. 709 luma of the 8-bit values). */
export function brightness(red: number, green: number, blue: number): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

function brightnessAt(pixels: Uint8ClampedArray, index: number): number {
  const at = index * 4;
  return brightness(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0);
}

/** One entry a pixel: 1 where the picture is at or over `level`. */
export function zebraMask(pixels: Uint8ClampedArray, width: number, height: number, level = ZEBRA_LEVEL): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    if (brightnessAt(pixels, index) >= level) mask[index] = 1;
  }
  return mask;
}

/**
 * One entry a pixel: 1 on both sides of an edge, where a pixel and its
 * neighbour to the right or below differ by more than `step`.
 */
export function peakingMask(pixels: Uint8ClampedArray, width: number, height: number, step = PEAKING_STEP): Uint8Array {
  const mask = new Uint8Array(width * height);
  let above: Float32Array | null = null;
  let row = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    const next = new Float32Array(width);
    for (let x = 0; x < width; x += 1) next[x] = brightnessAt(pixels, y * width + x);
    row = next;
    for (let x = 0; x < width; x += 1) {
      const here = row[x] ?? 0;
      if (x + 1 < width && Math.abs((row[x + 1] ?? 0) - here) > step) {
        mask[y * width + x] = 1;
        mask[y * width + x + 1] = 1;
      }
      if (above && Math.abs((above[x] ?? 0) - here) > step) {
        mask[y * width + x] = 1;
        mask[(y - 1) * width + x] = 1;
      }
    }
    above = row;
  }
  return mask;
}

/** The zebras as a picture to lay over: slanted stripes where the mask is set, nothing elsewhere. */
export function zebraOverlay(mask: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const overlay = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] !== 1) continue;
      const light = (x + y) % STRIPE_PERIOD < STRIPE_PERIOD / 2;
      const at = (y * width + x) * 4;
      const ink = light ? 255 : 0;
      overlay[at] = ink;
      overlay[at + 1] = ink;
      overlay[at + 2] = ink;
      overlay[at + 3] = light ? 230 : 153;
    }
  }
  return overlay;
}

/** The peaking as a picture to lay over: the display's blue where the mask is set. */
export function peakingOverlay(mask: Uint8Array, width: number, height: number): Uint8ClampedArray<ArrayBuffer> {
  const overlay = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1) continue;
    const at = index * 4;
    overlay[at] = PEAKING_INK[0];
    overlay[at + 1] = PEAKING_INK[1];
    overlay[at + 2] = PEAKING_INK[2];
    overlay[at + 3] = 255;
  }
  return overlay;
}
