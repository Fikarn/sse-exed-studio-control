import { describe, expect, it } from "vitest";

import { computeContentFitTransform } from "./useStagePlotViewport";

// DENSITY-04 — the fitContent ("Frame") mode frames the populated rig by computing
// a {zoom, panX, panY} transform that centers the content bbox in the room viewBox.
// The transform maps a content point p -> pan + zoom*p (translate THEN scale), so a
// correct fit puts the bbox center on the viewBox center. Room = 12x8 m studio:
// widthCm 1200, depthCm 800, gutterCm 56 -> viewBox 0/-56/1200/856, center (600, 372).
const ROOM = { widthCm: 1200, depthCm: 800, gutterCm: 56 };
const VIEWBOX_CENTER_X = 600;
const VIEWBOX_CENTER_Y = -56 + (800 + 56) / 2; // 372

const maps = (t: { zoom: number; panX: number; panY: number }, cx: number, cy: number) => ({
  x: t.panX + t.zoom * cx,
  y: t.panY + t.zoom * cy,
});

describe("computeContentFitTransform", () => {
  it("frames + centers a populated bbox inside the room viewBox", () => {
    // 400x200 cm box centered at (600, 400).
    const t = computeContentFitTransform({ minX: 400, minY: 300, maxX: 800, maxY: 500 }, ROOM);
    // span after 10% pad: 480 x 240 -> zoom = min(1200/480, 856/240) = 2.5 (the X limit).
    expect(t.zoom).toBeCloseTo(2.5, 4);
    const center = maps(t, 600, 400);
    expect(center.x).toBeCloseTo(VIEWBOX_CENTER_X, 3);
    expect(center.y).toBeCloseTo(VIEWBOX_CENTER_Y, 3);
  });

  it("returns identity (full room) for a null bbox (empty rig)", () => {
    expect(computeContentFitTransform(null, ROOM)).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it("returns identity for a non-finite bbox", () => {
    expect(computeContentFitTransform({ minX: Number.NaN, minY: 0, maxX: 100, maxY: 100 }, ROOM)).toEqual({
      zoom: 1,
      panX: 0,
      panY: 0,
    });
  });

  it("floors the framed span (MIN_SPAN) so a single-point rig does not blow up the zoom", () => {
    // A zero-span (single fixture) bbox: without the 2 m floor this would divide by ~0.
    const t = computeContentFitTransform({ minX: 600, minY: 400, maxX: 600, maxY: 400 }, ROOM);
    expect(Number.isFinite(t.zoom)).toBe(true);
    expect(t.zoom).toBeGreaterThan(1);
    expect(t.zoom).toBeLessThanOrEqual(5); // never exceeds MAX_ZOOM
    // still centered on the point
    const center = maps(t, 600, 400);
    expect(center.x).toBeCloseTo(VIEWBOX_CENTER_X, 3);
    expect(center.y).toBeCloseTo(VIEWBOX_CENTER_Y, 3);
  });

  it("clamps zoom to MIN_ZOOM for content larger than the room", () => {
    // A bbox far bigger than the room would compute zoom << 0.4; clamp to MIN_ZOOM.
    const t = computeContentFitTransform({ minX: -2000, minY: -2000, maxX: 4000, maxY: 4000 }, ROOM);
    expect(t.zoom).toBeCloseTo(0.4, 4);
  });
});
