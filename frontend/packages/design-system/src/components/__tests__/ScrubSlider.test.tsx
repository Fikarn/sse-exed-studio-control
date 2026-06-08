import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScrubSlider } from "../ScrubSlider";

// CONTROLS-02 / CONTROLS-01 (Slice 8c): ScrubSlider gained typed-entry +
// relocated its reset. These lock the gesture contract so it can't silently
// regress — especially the load-bearing flip that a bare double-click no longer
// resets when typed entry is wired (reset moves to Alt+double-click / Backspace /
// Delete), mirroring AudioSliderControl + AudioKnob. The double-tap is timed
// (360ms) rather than keyed on event.detail, which is 0 on pointerdown.

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

// A real double-tap = two pointerdowns within 360ms. The first runs the normal
// click-to-jump (jsdom rects are 0, so it nudges to min); the second is detected
// as the double-tap by the timed guard. Native dispatch (not fireEvent) so the
// real pointerdown reaches React's handler.
function pointerDown(slider: HTMLElement, altKey: boolean) {
  const Ctor = window.PointerEvent ?? MouseEvent;
  slider.dispatchEvent(new Ctor("pointerdown", { bubbles: true, cancelable: true, button: 0, altKey }));
}

function doubleTap(slider: HTMLElement, opts: { altKey?: boolean } = {}) {
  pointerDown(slider, opts.altKey ?? false);
  pointerDown(slider, opts.altKey ?? false);
}

describe("ScrubSlider typed entry + reset relocation", () => {
  it("requests typed entry on a bare double-click when onRequestNumericValue is set", () => {
    const onRequestNumericValue = vi.fn(() => null);
    const { onChange, slider } = renderSlider({ resetValue: 100, onRequestNumericValue });
    doubleTap(slider);
    expect(onRequestNumericValue).toHaveBeenCalledWith(40);
    // A bare double-click must NOT reset when typed entry is wired.
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

  it("resets on Alt+double-click", () => {
    const onRequestNumericValue = vi.fn(() => null);
    const { onChange, onCommit, slider } = renderSlider({ resetValue: 100, onRequestNumericValue });
    doubleTap(slider, { altKey: true });
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(onCommit).toHaveBeenCalledWith(100);
    // Alt+double-click resets — it must not open typed entry.
    expect(onRequestNumericValue).not.toHaveBeenCalled();
  });

  it("resets on Backspace and Delete", () => {
    const { onChange, onCommit, slider } = renderSlider({ resetValue: 100 });
    fireEvent.keyDown(slider, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(onCommit).toHaveBeenLastCalledWith(100);
    onChange.mockClear();
    fireEvent.keyDown(slider, { key: "Delete" });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it("falls back to bare-double-click reset when no typed entry is wired", () => {
    const { onChange, onCommit, slider } = renderSlider({ resetValue: 100 });
    doubleTap(slider);
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(onCommit).toHaveBeenCalledWith(100);
  });

  it("ignores Backspace/Delete and Enter when no resetValue / typed entry exist", () => {
    const { onChange, slider } = renderSlider();
    fireEvent.keyDown(slider, { key: "Backspace" });
    fireEvent.keyDown(slider, { key: "Delete" });
    fireEvent.keyDown(slider, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is inert when disabled", () => {
    const onRequestNumericValue = vi.fn(() => null);
    const { onChange, slider } = renderSlider({ disabled: true, resetValue: 100, onRequestNumericValue });
    doubleTap(slider);
    doubleTap(slider, { altKey: true });
    fireEvent.keyDown(slider, { key: "Enter" });
    fireEvent.keyDown(slider, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onRequestNumericValue).not.toHaveBeenCalled();
  });

  it("still nudges by step on arrow keys", () => {
    const { onChange, slider } = renderSlider({ resetValue: 100 });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(41);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(39);
  });
});
