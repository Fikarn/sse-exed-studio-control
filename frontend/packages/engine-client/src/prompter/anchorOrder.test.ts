import { describe, expect, it } from "vitest";

import type { PrompterAnchor } from "../generated/snapshots/PrompterAnchor";
import { anchorOrder } from "./anchorOrder";

function anchor(revision: number, layoutKey = "g1-l1000"): PrompterAnchor {
  return {
    layoutKey,
    place: { paragraph: 0, word: 0 },
    wordOffset: 0,
    position: 0,
    endPosition: 1000,
    pxPerReadWord: 20,
    playing: true,
    atEnd: false,
    fromWpm: 140,
    toWpm: 140,
    rampMs: 0,
    moveFromPosition: null,
    moveMs: 0,
    ageMs: 0,
    revision,
  };
}

describe("anchorOrder (fix C)", () => {
  it("takes the first anchor and a higher number, whatever its key", () => {
    expect(anchorOrder(null, anchor(1))).toBe("take");
    expect(anchorOrder(anchor(3), anchor(4))).toBe("take");
    expect(anchorOrder(anchor(3), anchor(4, "g2-l1000"))).toBe("take");
  });

  it("keeps its own for an equal number on the same key, and drops a lower one", () => {
    expect(anchorOrder(anchor(3), anchor(3))).toBe("keep");
    expect(anchorOrder(anchor(3), anchor(2))).toBe("drop");
    expect(anchorOrder(anchor(3), anchor(2, "g2-l1000"))).toBe("drop");
  });

  it("takes an equal number on another key, and an anchor without a number", () => {
    expect(anchorOrder(anchor(3), anchor(3, "g2-l1000"))).toBe("take");
    expect(anchorOrder(anchor(3), { ...anchor(3), revision: undefined as unknown as number })).toBe("take");
    expect(anchorOrder({ ...anchor(3), revision: Number.NaN }, anchor(1))).toBe("take");
  });
});
