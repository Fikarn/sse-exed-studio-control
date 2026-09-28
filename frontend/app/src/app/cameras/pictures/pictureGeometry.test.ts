import { describe, expect, it } from "vitest";

import { CENTRE, WHOLE, bigRect, bigViewWord, loupeRect, oneToOneRect, pointAt } from "./pictureGeometry";

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
});
