import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUDIO_FADER_UNITY } from "../audioFormatting";
import { AudioSliderControl } from "./AudioSliderControl";

// New pages program, Slice 3 (decisions 9 and 10): a focused slider (the
// plate's sends, the plate's monitor level) takes the arrows, Page Up / Page
// Down and Home / End, and nothing with Shift, Ctrl or Alt. Before, Shift made
// an arrow five steps and Shift+press jumped to unity.
describe("AudioSliderControl keys", () => {
  afterEach(cleanup);

  function renderSlider(props: Partial<Parameters<typeof AudioSliderControl>[0]> = {}) {
    const onCommit = vi.fn();
    render(
      <AudioSliderControl
        label="Host send to Main Out"
        onCommit={onCommit}
        orientation="horizontal"
        value={0.5}
        {...props}
      />
    );
    return { onCommit, slider: screen.getByRole("slider", { name: "Host send to Main Out" }) };
  }

  it("moves one plain step for an arrow with Shift held", () => {
    const { onCommit, slider } = renderSlider();
    fireEvent.keyDown(slider, { key: "ArrowUp", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(0.51);
    fireEvent.keyDown(slider, { key: "ArrowDown", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(0.5);
  });

  it("takes Page Up and Page Down as five steps and Home and End as the ends", () => {
    const { onCommit, slider } = renderSlider();
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(onCommit).toHaveBeenLastCalledWith(0.55);
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(1);
  });

  it("does not jump to unity on a press with Shift held", () => {
    const { onCommit, slider } = renderSlider({ snapUnity: true, value: 0.2 });
    // jsdom has no pointer capture and no PointerEvent: the press is a mouse
    // event of that type, and it starts a drag, which captures.
    slider.setPointerCapture = vi.fn();
    act(() => {
      slider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, shiftKey: true }));
    });
    expect(onCommit).not.toHaveBeenCalledWith(AUDIO_FADER_UNITY);
    expect(onCommit).not.toHaveBeenCalled();
    expect(slider.getAttribute("data-dragging")).toBe("true");
  });
});
