import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MultiValueSlider } from "../MultiValueSlider";

// New pages program, Slice 3 review (#11): the `resetValue` doc said a plain
// double-click resets ALL values to it. The double-click is ScrubSlider's, and
// MultiValueSlider takes the value it reports as a new average: every value
// shifts by the same amount, so a mixed selection keeps its spread and only a
// uniform one lands on the value. These pin what the doc now says.

function renderBulkSlider(values: number[]) {
  const onValuesCommit = vi.fn();
  render(
    <MultiValueSlider
      ariaLabel="Intensity"
      values={values}
      min={0}
      max={100}
      step={1}
      resetValue={50}
      onValuesChange={() => {}}
      onValuesCommit={onValuesCommit}
    />
  );
  const slider = screen.getByRole("slider", { name: "Intensity" });
  // jsdom has no layout and its pointer capture throws on a synthetic pointer:
  // a 100 px track from 0, so a click at clientX N points at the value N.
  slider.setPointerCapture = () => {};
  slider.releasePointerCapture = () => {};
  slider.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 10, width: 100, height: 10, toJSON: () => ({}) }) as DOMRect;
  return { onValuesCommit, slider };
}

// A plain double-click at clientX: two taps well inside ScrubSlider's 360 ms.
// Native dispatch so the pointer events carry `button` and `clientX` (jsdom has
// no PointerEvent).
function doubleClick(slider: HTMLElement, clientX: number) {
  const Ctor = window.PointerEvent ?? MouseEvent;
  for (const type of ["pointerdown", "pointerup", "pointerdown", "pointerup"]) {
    act(() => {
      slider.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, clientX }));
    });
  }
}

describe("MultiValueSlider reset", () => {
  it("moves a mixed selection's average to the reset value and keeps its spread", () => {
    const { onValuesCommit, slider } = renderBulkSlider([20, 60]);
    // At the average (40), so the first tap's click-to-jump moves nothing.
    doubleClick(slider, 40);
    expect(onValuesCommit).toHaveBeenLastCalledWith([30, 70]);
  });

  it("lands a uniform selection on the reset value", () => {
    const { onValuesCommit, slider } = renderBulkSlider([20, 20]);
    doubleClick(slider, 20);
    expect(onValuesCommit).toHaveBeenLastCalledWith([50, 50]);
  });
});
