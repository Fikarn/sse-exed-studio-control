import { describe, expect, it } from "vitest";

import {
  CENTRE,
  OVERVIEW_HERO,
  OVERVIEW_TILE,
  WHOLE,
  bigRect,
  bigViewWord,
  loupeRect,
  oneToOneRect,
  overviewLoupeRect,
  pointAt,
} from "./pictureGeometry";

describe("where the pictures stand", () => {
  it("shows in the loupe a part of the picture around the point, each pixel enlarged", () => {
    expect(loupeRect(CENTRE, 2)).toEqual({ x: 818, y: 472, width: 284, height: 136 });
    expect(loupeRect(CENTRE, 4)).toEqual({ x: 889, y: 506, width: 142, height: 68 });
  });

  it("keeps the loupe and the 1:1 view inside the picture", () => {
    expect(loupeRect({ x: 0, y: 0 }, 2)).toMatchObject({ x: 0, y: 0 });
    expect(loupeRect({ x: 1920, y: 1080 }, 2)).toMatchObject({ x: 1636, y: 944 });
    expect(oneToOneRect(CENTRE)).toEqual({ x: 120, y: 68, width: 1680, height: 945 });
    expect(oneToOneRect({ x: 0, y: 0 })).toMatchObject({ x: 0, y: 0 });
    expect(oneToOneRect({ x: 1920, y: 1080 })).toMatchObject({ x: 240, y: 135 });
  });

  it("shows the whole picture or a part of it pixel for pixel", () => {
    expect(bigRect("whole", { x: 10, y: 10 })).toBe(WHOLE);
    expect(bigRect("one-to-one", CENTRE)).toEqual(oneToOneRect(CENTRE));
    expect(bigViewWord("whole")).toBe("87.5 %");
    expect(bigViewWord("one-to-one")).toBe("1:1");
  });

  it("finds the point of the picture under a press on a view of it", () => {
    expect(pointAt(WHOLE, { x: 0.5, y: 0.5 })).toEqual(CENTRE);
    expect(pointAt(WHOLE, { x: 0, y: 1 })).toEqual({ x: 0, y: 1080 });
    expect(pointAt(oneToOneRect(CENTRE), { x: 0.25, y: 0.5 })).toEqual({ x: 540, y: 541 });
    expect(pointAt(WHOLE, { x: 1.4, y: -2 })).toEqual({ x: 1920, y: 0 });
  });

  // The Overview (D47): CAM 1 at two thirds, the small pictures and the loupe at a sixth.
  it("shows the Overview's pictures at whole scales, and its loupe a small picture's size", () => {
    expect([OVERVIEW_HERO.width / 1920, OVERVIEW_HERO.height / 1080]).toEqual([2 / 3, 2 / 3]);
    expect([OVERVIEW_TILE.width / 1920, OVERVIEW_TILE.height / 1080]).toEqual([1 / 6, 1 / 6]);
    expect(overviewLoupeRect(CENTRE, 2)).toEqual({ x: 880, y: 495, width: 160, height: 90 });
    expect(overviewLoupeRect(CENTRE, 4)).toEqual({ x: 920, y: 518, width: 80, height: 45 });
    expect(overviewLoupeRect({ x: 1920, y: 1080 }, 2)).toMatchObject({ x: 1760, y: 990 });
  });
});
