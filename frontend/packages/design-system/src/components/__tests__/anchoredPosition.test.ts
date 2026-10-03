import { describe, expect, it } from "vitest";

import { placeFloating, pointRect } from "../anchoredPosition";

const viewport = { width: 2560, height: 1440 };
const menu = { width: 320, height: 400 };

describe("placeFloating", () => {
  it("puts the layer on its preferred side, aligned as asked", () => {
    const anchor = { left: 100, top: 100, width: 36, height: 36 };
    const result = placeFloating({ anchor, floating: menu, viewport, placement: "bottom-start" });
    expect(result).toMatchObject({ left: 100, top: 140, side: "bottom", placement: "bottom-start", clamped: false });
  });

  it("flips to the opposite side when the preferred one has no room", () => {
    const anchor = { left: 100, top: 1300, width: 36, height: 36 };
    const result = placeFloating({ anchor, floating: menu, viewport, placement: "bottom-start" });
    expect(result?.side).toBe("top");
    expect(result?.top).toBe(1300 - 4 - 400);
  });

  it("opens to the pointer's left at the right edge, as every program's menu does", () => {
    const result = placeFloating({
      anchor: pointRect(2500, 300),
      floating: menu,
      viewport,
      placement: "bottom-start",
      offset: 2,
    });
    expect(result?.placement).toBe("bottom-end");
    expect(result?.left).toBe(2500 - 320);
  });

  it("slides along its side to stay on the screen", () => {
    const anchor = { left: 2540, top: 100, width: 16, height: 16 };
    const result = placeFloating({ anchor, floating: { width: 200, height: 40 }, viewport, placement: "bottom" });
    expect(result?.left).toBe(2560 - 8 - 200);
    expect(result?.arrow).toBeGreaterThan(100);
  });

  it("squeezes onto the screen when no side has room", () => {
    const tall = { width: 320, height: 1500 };
    const result = placeFloating({
      anchor: { left: 100, top: 700, width: 36, height: 36 },
      floating: tall,
      viewport,
      placement: "bottom-start",
    });
    expect(result?.clamped).toBe(true);
    expect(result?.top).toBe(8);
  });

  it("never covers a rectangle it must avoid, and moves to another side to clear it", () => {
    const anchor = { left: 500, top: 500, width: 100, height: 36 };
    const takeKey = { left: 480, top: 540, width: 160, height: 64 };
    const result = placeFloating({
      anchor,
      floating: { width: 200, height: 32 },
      viewport,
      placement: "bottom",
      avoid: [takeKey],
    });
    expect(result?.side).toBe("top");
  });

  it("slides to another alignment before it gives up a side", () => {
    const anchor = { left: 500, top: 500, width: 100, height: 36 };
    // A key under the anchor's left half only: the tooltip can sit under its
    // right half (aligned to the anchor's end) without covering it.
    const takeKey = { left: 300, top: 540, width: 260, height: 64 };
    const above = { left: 300, top: 400, width: 600, height: 96 };
    const result = placeFloating({
      anchor,
      floating: { width: 40, height: 32 },
      viewport,
      placement: "bottom",
      avoid: [takeKey, above],
    });
    expect(result?.side).toBe("bottom");
    expect(result?.placement).toBe("bottom-end");
  });

  it("refuses every place when each one would cover a take-time control", () => {
    const anchor = { left: 500, top: 500, width: 100, height: 36 };
    const around = { left: 0, top: 0, width: 2560, height: 1440 };
    const result = placeFloating({
      anchor,
      floating: { width: 200, height: 32 },
      viewport,
      placement: "bottom",
      avoid: [around],
      fallbackSides: ["right", "left"],
    });
    expect(result).toBeNull();
  });
});
