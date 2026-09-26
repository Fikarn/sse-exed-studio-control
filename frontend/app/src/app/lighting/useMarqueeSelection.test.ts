import { act, cleanup, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMarqueeSelection } from "./useMarqueeSelection";

// New pages program, Slice 3 (decision 10): a box dragged with Shift held used
// to add to the selection. Keys held while pointing went with the shortcuts;
// the plot toolbar's Add to selection key says whether a box adds, and a click
// on the empty plot clears the selection whether or not it is lit.

afterEach(() => {
  cleanup();
});

// An SVG whose screen matrix is the identity: client px are plot cm.
function identitySvg() {
  const matrix = { inverse: () => matrix };
  return {
    querySelector: () => null,
    getScreenCTM: () => matrix,
    createSVGPoint: () => {
      const point = { x: 0, y: 0, matrixTransform: () => ({ x: point.x, y: point.y }) };
      return point;
    },
  } as unknown as SVGSVGElement;
}

// A plain pointer: no key is held, and none is read.
function pointer(clientX: number, clientY: number) {
  return {
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    currentTarget: { setPointerCapture: () => {}, releasePointerCapture: () => {} },
  } as unknown as ReactPointerEvent<SVGSVGElement>;
}

function setup(additive: boolean) {
  const onCommit = vi.fn();
  const onBackgroundClick = vi.fn();
  const hook = renderHook(() =>
    useMarqueeSelection({
      svgRef: { current: identitySvg() },
      additive,
      onCommit,
      onBackgroundClick,
      resolveTargets: () => [
        { id: "fixture-key", xCm: 50, yCm: 50 },
        { id: "fixture-back", xCm: 500, yCm: 500 },
      ],
    })
  );
  const drag = (from: [number, number], to: [number, number]) => {
    act(() => hook.result.current.onPointerDown(pointer(...from)));
    act(() => hook.result.current.onPointerMove(pointer(...to)));
    act(() => hook.result.current.onPointerUp(pointer(...to)));
  };
  return { drag, hook, onBackgroundClick, onCommit };
}

describe("useMarqueeSelection", () => {
  it("a box adds to the selection while Add to selection is lit", () => {
    const lit = setup(true);
    lit.drag([0, 0], [100, 100]);
    expect(lit.onCommit).toHaveBeenCalledWith(["fixture-key"], { additive: true });
    expect(lit.onBackgroundClick).not.toHaveBeenCalled();

    // A click on the empty plot still clears the selection.
    lit.drag([700, 700], [701, 701]);
    expect(lit.onBackgroundClick).toHaveBeenCalledTimes(1);
    expect(lit.onCommit).toHaveBeenCalledTimes(1);
  });

  it("a box replaces the selection while Add to selection is off", () => {
    const off = setup(false);
    off.drag([0, 0], [600, 600]);
    expect(off.onCommit).toHaveBeenCalledWith(["fixture-key", "fixture-back"], { additive: false });
  });
});
