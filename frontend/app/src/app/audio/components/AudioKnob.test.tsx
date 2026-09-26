import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioKnob } from "./AudioKnob";

// New pages program, Slice 3 (decisions 8–10): a focused knob takes the arrows
// (one step), Page Up / Page Down (five steps) and Home / End, and nothing with
// Shift, Ctrl or Alt. Backspace / Delete and Alt+double-click no longer reset
// it; the typed entry's "Reset to <default>" key does.
describe("AudioKnob", () => {
  afterEach(cleanup);

  function renderKnob(props: Partial<Parameters<typeof AudioKnob>[0]> = {}) {
    const onCommit = vi.fn();
    render(
      <AudioKnob
        ariaLabel="Host Band 2 EQ gain"
        defaultValue={0}
        max={20}
        min={-20}
        numericSuffix="dB"
        onCommit={onCommit}
        step={0.5}
        value={6}
        {...props}
      />
    );
    return { knob: screen.getByRole("slider", { name: props.ariaLabel ?? "Host Band 2 EQ gain" }), onCommit };
  }

  it("moves one plain step for an arrow with Shift held", () => {
    const { knob, onCommit } = renderKnob();
    fireEvent.keyDown(knob, { key: "ArrowUp", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(6.5);
  });

  it("takes Page Up and Page Down as five steps and Home and End as the ends", () => {
    const { knob, onCommit } = renderKnob();
    fireEvent.keyDown(knob, { key: "PageUp" });
    expect(onCommit).toHaveBeenLastCalledWith(8.5);
    fireEvent.keyDown(knob, { key: "PageDown" });
    expect(onCommit).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(knob, { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(-20);
    fireEvent.keyDown(knob, { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(20);
  });

  it("is not reset by Backspace or Delete; typed entry's Reset key resets it", () => {
    const { knob, onCommit } = renderKnob();
    fireEvent.keyDown(knob, { key: "Backspace" });
    fireEvent.keyDown(knob, { key: "Delete" });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.keyDown(knob, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Reset to 0 dB" }));
    expect(onCommit).toHaveBeenLastCalledWith(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens typed entry on a double-click, whether or not Alt is held", () => {
    const { knob, onCommit } = renderKnob();
    // jsdom has no PointerEvent, so the press is a mouse event of that type.
    act(() => {
      knob.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, detail: 2, altKey: true }));
    });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Set Host Band 2 EQ gain" })).not.toBeNull();
  });

  it("names a ratio's default the way the knob prints it", () => {
    const { knob, onCommit } = renderKnob({
      ariaLabel: "Host compressor ratio",
      defaultLabel: "3:1",
      defaultValue: 3,
      max: 20,
      min: 1,
      numericSuffix: ":1",
      value: 5,
    });
    fireEvent.keyDown(knob, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Reset to 3:1" }));
    expect(onCommit).toHaveBeenLastCalledWith(3);
  });

  it("offers no Reset key where the knob has no default", () => {
    const { knob } = renderKnob({ ariaLabel: "Host Band 2 EQ Q", defaultValue: undefined, numericSuffix: undefined });
    fireEvent.keyDown(knob, { key: "Enter" });
    expect(screen.getByRole("dialog", { name: "Set Host Band 2 EQ Q" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /^Reset to/ })).toBeNull();
  });
});
