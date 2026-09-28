// Where the pictures stand, in the picture's own pixels. A camera's picture
// is 1920 × 1080 (what vMix sends); the page shows the whole of it at 87.5 %
// in the big frame, or a part of it pixel for pixel, and a smaller part
// enlarged in the loupe.

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The picture as it arrives. */
export const PICTURE = { width: 1920, height: 1080 } as const;
/** The big frame: the largest exact 16:9 the bay holds. */
export const HERO = { width: 1680, height: 945 } as const;
/** A small picture. */
export const TILE = { width: 544, height: 306 } as const;
/** The loupe beside the small pictures: a whole number of the picture's pixels at 2:1 and at 4:1. */
export const LOUPE = { width: 568, height: 272 } as const;

export type LoupeZoom = 2 | 4;
export type BigView = "whole" | "one-to-one";

export const WHOLE: Rect = { x: 0, y: 0, width: PICTURE.width, height: PICTURE.height };
export const CENTRE: Point = { x: PICTURE.width / 2, y: PICTURE.height / 2 };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** A part of the picture of this size around `point`, moved to stay inside the picture. */
function partAround(point: Point, width: number, height: number): Rect {
  return {
    x: Math.round(clamp(point.x - width / 2, 0, PICTURE.width - width)),
    y: Math.round(clamp(point.y - height / 2, 0, PICTURE.height - height)),
    width,
    height,
  };
}

/** What the loupe shows at `zoom`: each pixel of the picture `zoom` pixels wide. */
export function loupeRect(point: Point, zoom: LoupeZoom): Rect {
  return partAround(point, LOUPE.width / zoom, LOUPE.height / zoom);
}

/** The 1:1 view: a 1680 × 945 part of the picture around `point`, pixel for pixel. */
export function oneToOneRect(point: Point): Rect {
  return partAround(point, HERO.width, HERO.height);
}

/** What the big frame shows. */
export function bigRect(view: BigView, point: Point): Rect {
  return view === "one-to-one" ? oneToOneRect(point) : WHOLE;
}

/** The point of the picture under a press at `share` (0..1 each way) of a view of it. */
export function pointAt(view: Rect, share: Point): Point {
  return {
    x: Math.round(clamp(view.x + clamp(share.x, 0, 1) * view.width, 0, PICTURE.width)),
    y: Math.round(clamp(view.y + clamp(share.y, 0, 1) * view.height, 0, PICTURE.height)),
  };
}

/** How the footer and the caption name the big frame's view. */
export function bigViewWord(view: BigView): string {
  return view === "one-to-one" ? "1:1" : "87.5 %";
}
