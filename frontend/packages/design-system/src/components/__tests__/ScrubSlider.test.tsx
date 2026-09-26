import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScrubSlider } from "../ScrubSlider";

// CONTROLS-02 / CONTROLS-01 (Slice 8c): ScrubSlider gained typed-entry. These
// lock the gesture contract so it can't silently regress — especially that a
// plain double-click opens typed entry when it is wired and only falls back to
// the reset when it is not, mirroring AudioSliderControl. The double-tap is
// timed (360ms) rather than keyed on event.detail, which is 0 on pointerdown.
// New pages program, Slice 3 (decisions 8–10): no gesture reads a key held
// while pointing, and the keyboard resets are gone — the typed-entry dialog
// carries "Reset to <default>" instead.

function renderSlider(props: Partial<React.ComponentProps<typeof ScrubSlider>> = {}) {
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(
    <ScrubSlider
      ariaLabel="Level"
      min={0}
      max={100}
      step={1}
      value={40}
      onChange={onChange}
      onCommit={onCommit}
      {...props}
    />
  );
  const slider = screen.getByRole("slider", { name: "Level" });
  // jsdom's pointer-capture can throw on a synthetic pointerId; the gesture under
  // test doesn't depend on real capture, so stub it.
  slider.setPointerCapture = () => {};
  slider.releasePointerCapture = () => {};
  slider.hasPointerCapture = () => false;
  return { onChange, onCommit, slider };
}

type Held = { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean };

// A real double-tap = two pointerdowns within 360ms. The first runs the normal
// click-to-jump (jsdom rects are 0, so it nudges to min); the second is detected
// as the double-tap by the timed guard. Native dispatch (not fireEvent) so the
// real pointerdown reaches React's handler. `held` presses keys during the
// gesture, to prove the slider does not read them.
function pointer(slider: HTMLElement, type: string, init: Held & { clientX?: number } = {}) {
  const Ctor = window.PointerEvent ?? MouseEvent;
  slider.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, button: 0, ...init }));
}

function doubleTap(slider: HTMLElement, held: Held = {}) {
  pointer(slider, "pointerdown", held);
  pointer(slider, "pointerdown", held);
}

describe("ScrubSlider typed entry and reset", () => {
  it("requests typed entry on a plain double-click when onRequestNumericValue is set", () => {
    const onRequestNumericValue = vi.fn(() => null);
    const { onChange, slider } = renderSlider({ resetValue: 100, onRequestNumericValue });
    doubleTap(slider);
    expect(onRequestNumericValue).toHaveBeenCalledWith(40);
    // A plain double-click must NOT reset when typed entry is wired.
    expect(onChange).not.toHaveBeenCalledWith(100);
  });

  it("requests typed entry on Enter when onRequestNumericValue is set", () => {
    const onRequestNumericValue = vi.fn(() => null);
    const { slider } = renderSlider({ resetValue: 100, onRequestNumericValue });
    fireEvent.keyDown(slider, { key: "Enter" });
    expect(onRequestNumericValue).toHaveBeenCalledWith(40);
  });

  it("commits a synchronously returned number from onRequestNumericValue", () => {
    const { onChange, onCommit, slider } = renderSlider({ onRequestNumericValue: () => 75 });
    fireEvent.keyDown(slider, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(75);
    expect(onCommit).toHaveBeenCalledWith(75);
  });

  // Decision 10: Alt held while double-clicking used to reset; a key held
  // while pointing is a shortcut, so the double-click is a plain one.
  it("treats an Alt+double-click as a plain double-click: typed entry, no reset", () => {
    const onRequestNumericValue = vi.fn(() => null);
    const { onChange, onCommit, slider } = renderSlider({ resetValue: 100, onRequestNumericValue });
    doubleTap(slider, { altKey: true });
    expect(onRequestNumericValue).toHaveBeenCalledWith(40);
    expect(onChange).not.toHaveBeenCalledWith(100);
    expect(onCommit).not.toHaveBeenCalledWith(100);
  });

  // Decision 8: Backspace and Delete no longer reset a focused slider.
  it("does nothing on Backspace and Delete, even with a reset target", () => {
    const { onChange, onCommit, slider } = renderSlider({ resetValue: 100 });
    fireEvent.keyDown(slider, { key: "Backspace" });
    fireEvent.keyDown(slider, { key: "Delete" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("falls back to a plain-double-click reset when no typed entry is wired", () => {
    const { onChange, onCommit, slider } = renderSlider({ resetValue: 100 });
    doubleTap(slider);
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(onCommit).toHaveBeenCalledWith(100);
  });

  it("ignores Enter when no typed entry is wired", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.keyDown(slider, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is inert when disabled", () => {
    const onRequestNumericValue = vi.fn(() => null);
    const { onChange, slider } = renderSlider({ disabled: true, resetValue: 100, onRequestNumericValue });
    doubleTap(slider);
    fireEvent.keyDown(slider, { key: "Enter" });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onRequestNumericValue).not.toHaveBeenCalled();
  });
});

describe("ScrubSlider keys and drags (decisions 9 and 10)", () => {
  it("takes the arrows, Page Up / Page Down, Home and End", () => {
    const { onChange, slider } = renderSlider({ resetValue: 100 });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(41);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(39);
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(onChange).toHaveBeenLastCalledWith(50);
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(onChange).toHaveBeenLastCalledWith(30);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it("moves one plain step on an arrow whatever modifier is held", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.keyDown(slider, { key: "ArrowUp", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(41);
    fireEvent.keyDown(slider, { key: "ArrowUp", ctrlKey: true });
    expect(onChange).toHaveBeenLastCalledWith(41);
    fireEvent.keyDown(slider, { key: "ArrowDown", altKey: true });
    expect(onChange).toHaveBeenLastCalledWith(39);
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  // The drag moves the value by the distance travelled across the track; Shift
  // (×10) and Ctrl (×0.1) used to change the rate.
  it.each([
    ["Shift", { shiftKey: true }],
    ["Ctrl", { ctrlKey: true }],
  ] as const)("drags at the plain rate with %s held", (_name, held) => {
    const { onCommit, slider } = renderSlider();
    // A 100 px track, so one pixel is one unit of the 0–100 range.
    slider.getBoundingClientRect = () =>
      ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }) as DOMRect;
    pointer(slider, "pointerdown", { clientX: 40 });
    pointer(slider, "pointermove", { clientX: 50, ...held });
    pointer(slider, "pointerup", { clientX: 50, ...held });
    expect(onCommit).toHaveBeenLastCalledWith(50);
  });
});
