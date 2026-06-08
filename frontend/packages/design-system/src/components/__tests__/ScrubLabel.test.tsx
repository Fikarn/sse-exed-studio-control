import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScrubLabel } from "../ScrubLabel";

// CONTROLS-06 (Slice 8b): ScrubLabel was a pointer-only role=presentation
// affordance; it is now a real role=slider with arrow / Home / End / PageUp-Down
// keyboard nudges. These tests lock the ARIA contract + the RAW-step keyboard
// behaviour (fine/coarse stay pointer-only, mirroring ScrubSlider) so a future
// edit can't silently reintroduce the snap-grid no-op / float-drift bug or
// regress the accessible-name distinction that keeps it from double-announcing
// against its paired <input>.

describe("ScrubLabel", () => {
  it("exposes the role=slider ARIA contract from its props", () => {
    render(
      <ScrubLabel
        value={5}
        min={0}
        max={10}
        step={1}
        ariaLabel="Stage X"
        formatValue={(value) => `${value} m`}
        onChange={() => {}}
      >
        Stage X (m)
      </ScrubLabel>
    );
    const slider = screen.getByRole("slider", { name: "Stage X" });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "10");
    expect(slider).toHaveAttribute("aria-valuenow", "5");
    expect(slider).toHaveAttribute("aria-valuetext", "5 m");
    expect(slider).toHaveAttribute("tabindex", "0");
    // Visible label text is still rendered for sighted users.
    expect(slider).toHaveTextContent("Stage X (m)");
  });

  it("nudges by a raw step on arrow / Page / Home / End keys", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <ScrubLabel value={5} min={0} max={10} step={1} ariaLabel="Stage X" onChange={onChange} onCommit={onCommit}>
        Stage X (m)
      </ScrubLabel>
    );
    const slider = screen.getByRole("slider", { name: "Stage X" });

    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith(4);
    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(onChange).toHaveBeenLastCalledWith(10); // 5 + 10, clamped to max
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(onChange).toHaveBeenLastCalledWith(0); // 5 - 10, clamped to min
    fireEvent.keyDown(slider, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(slider, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(10);

    // onCommit fires alongside each committed key (mirrors pointerup).
    expect(onCommit).toHaveBeenCalled();
  });

  it("ignores fine/coarse modifiers on the keyboard (raw step only)", () => {
    const onChange = vi.fn();
    render(
      <ScrubLabel value={5} min={0} max={10} step={1} ariaLabel="Stage X" onChange={onChange}>
        Stage X (m)
      </ScrubLabel>
    );
    const slider = screen.getByRole("slider", { name: "Stage X" });
    fireEvent.keyDown(slider, { key: "ArrowRight", metaKey: true });
    expect(onChange).toHaveBeenLastCalledWith(6); // not a ×0.1 fine nudge
    fireEvent.keyDown(slider, { key: "ArrowRight", shiftKey: true });
    expect(onChange).toHaveBeenLastCalledWith(6); // not a ×10 coarse nudge
  });

  it("is inert and untabbable when disabled", () => {
    const onChange = vi.fn();
    render(
      <ScrubLabel value={5} min={0} max={10} step={1} ariaLabel="Stage X" disabled onChange={onChange}>
        Stage X (m)
      </ScrubLabel>
    );
    const slider = screen.getByRole("slider", { name: "Stage X" });
    expect(slider).toHaveAttribute("tabindex", "-1");
    expect(slider).toHaveAttribute("aria-disabled", "true");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps an accessible name distinct from a paired input (no double-announce)", () => {
    render(
      <div>
        <ScrubLabel value={5} min={0} max={10} step={1} ariaLabel="Stage X" onChange={() => {}}>
          Stage X (m)
        </ScrubLabel>
        <input aria-label="Stage X position in metres" defaultValue="5" />
      </div>
    );
    expect(screen.getByRole("slider").getAttribute("aria-label")).toBe("Stage X");
    expect(screen.getByRole("textbox").getAttribute("aria-label")).toBe("Stage X position in metres");
    // Distinct names => the two affordances do not read as the same control.
    expect(screen.getByRole("slider").getAttribute("aria-label")).not.toBe(
      screen.getByRole("textbox").getAttribute("aria-label")
    );
  });
});
