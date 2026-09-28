import type { CameraNumber } from "@sse/engine-client";

import { peakingMask, peakingOverlay, zebraMask, zebraOverlay } from "./pictureAids";
import { PICTURE } from "./pictureGeometry";

// The test pictures the page shows until the camera pictures are built (NDI
// from vMix): a still test card for each camera, drawn here in the picture's
// own 1920 × 1080 pixels, so the 1:1 view and the loupe are true parts of
// it. A card holds what the aids are for: bars, a ramp and steps that reach
// full brightness for the zebras, and line pairs down to one pixel for the
// peaking. It holds no words, so it never waits for a font: the cameras are
// told apart by one, two or three squares at the top left.

/** The bars at 75 %: white, yellow, cyan, green, magenta, red, blue. */
const BARS = ["#bfbfbf", "#bfbf00", "#00bfbf", "#00bf00", "#bf00bf", "#bf0000", "#0000bf"] as const;

/** The card's field, from its left edge to its right. */
const FIELD = { left: 120, right: 1800 } as const;
const FIELD_WIDTH = FIELD.right - FIELD.left;

/** The line pairs' widths, in pixels, from coarse to one pixel. */
const LINE_WIDTHS = [8, 4, 2, 1] as const;

function grey(share: number): string {
  const level = Math.round(Math.max(0, Math.min(1, share)) * 255);
  return `rgb(${level}, ${level}, ${level})`;
}

/** Draws camera `camera`'s test card over the whole of a 1920 × 1080 canvas. */
export function drawTestPicture(context: CanvasRenderingContext2D, camera: CameraNumber) {
  context.save();
  context.fillStyle = "#1c1c1f";
  context.fillRect(0, 0, PICTURE.width, PICTURE.height);

  // Which camera: one, two or three squares.
  context.fillStyle = "#bfbfbf";
  for (let index = 0; index < camera; index += 1) {
    context.fillRect(FIELD.left + index * 64, 40, 48, 48);
  }

  // The bars.
  const barWidth = FIELD_WIDTH / BARS.length;
  BARS.forEach((colour, index) => {
    context.fillStyle = colour;
    context.fillRect(FIELD.left + index * barWidth, 120, barWidth, 440);
  });

  // The ramp, black to white.
  const ramp = context.createLinearGradient(FIELD.left, 0, FIELD.right, 0);
  ramp.addColorStop(0, "#000000");
  ramp.addColorStop(1, "#ffffff");
  context.fillStyle = ramp;
  context.fillRect(FIELD.left, 600, FIELD_WIDTH, 120);

  // Eleven steps, 0 % to 100 %.
  const stepWidth = FIELD_WIDTH / 11;
  for (let step = 0; step <= 10; step += 1) {
    context.fillStyle = grey(step / 10);
    context.fillRect(Math.round(FIELD.left + step * stepWidth), 740, Math.ceil(stepWidth), 80);
  }

  // Line pairs, white on black: four blocks, each of lines one width wide.
  context.fillStyle = "#000000";
  context.fillRect(FIELD.left, 860, 800, 140);
  context.fillStyle = "#ffffff";
  LINE_WIDTHS.forEach((width, block) => {
    const left = FIELD.left + block * 200 + 12;
    for (let x = 0; x + width <= 176; x += width * 2) {
      context.fillRect(left + x, 872, width, 116);
    }
  });

  // Patches: full white, 18 % grey, a skin tone and black.
  ["#ffffff", grey(0.18), "#c08b6d", "#000000"].forEach((colour, index) => {
    context.fillStyle = colour;
    context.fillRect(1000 + index * 200, 860, 184, 140);
  });

  // The frame's centre and its edge, to check the framing against the guides.
  context.strokeStyle = "#bfbfbf";
  context.lineWidth = 4;
  context.beginPath();
  context.arc(PICTURE.width / 2, 340, 180, 0, Math.PI * 2);
  context.stroke();
  context.strokeRect(2, 2, PICTURE.width - 4, PICTURE.height - 4);
  context.restore();
}

/** A picture and, once asked for, what its aids lay over it. */
export interface PictureSource {
  picture: HTMLCanvasElement;
  zebras: () => HTMLCanvasElement | null;
  peaking: () => HTMLCanvasElement | null;
}

function blankCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = PICTURE.width;
  canvas.height = PICTURE.height;
  return canvas;
}

/** An aid's overlay as a canvas, worked out from the picture's pixels. */
function overlayOf(
  picture: HTMLCanvasElement,
  paint: (pixels: Uint8ClampedArray, width: number, height: number) => Uint8ClampedArray<ArrayBuffer>
): HTMLCanvasElement | null {
  const read = picture.getContext("2d");
  const overlay = blankCanvas();
  const write = overlay.getContext("2d");
  if (!read || !write) return null;
  const { width, height } = PICTURE;
  const pixels = read.getImageData(0, 0, width, height).data;
  write.putImageData(new ImageData(paint(pixels, width, height), width, height), 0, 0);
  return overlay;
}

const sources = new Map<CameraNumber, PictureSource | null>();

/**
 * Camera `camera`'s picture, drawn once and kept. Its aids are worked out the
 * first time one is switched on. `null` where there is nothing to draw on
 * (no canvas: a test's page).
 */
export function pictureSource(camera: CameraNumber): PictureSource | null {
  const kept = sources.get(camera);
  if (kept !== undefined) return kept;
  const picture = blankCanvas();
  const context = picture.getContext("2d", { willReadFrequently: true });
  if (!context) {
    sources.set(camera, null);
    return null;
  }
  drawTestPicture(context, camera);
  let zebras: HTMLCanvasElement | null | undefined;
  let peaking: HTMLCanvasElement | null | undefined;
  const source: PictureSource = {
    picture,
    zebras: () =>
      (zebras ??= overlayOf(picture, (pixels, width, height) =>
        zebraOverlay(zebraMask(pixels, width, height), width, height)
      )),
    peaking: () =>
      (peaking ??= overlayOf(picture, (pixels, width, height) =>
        peakingOverlay(peakingMask(pixels, width, height), width, height)
      )),
  };
  sources.set(camera, source);
  return source;
}
