import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NumberEntryDialog } from "../NumberEntryDialog";

// CONTROLS-02 (Slice 8c): the shared typed-numeric-entry dialog, promoted from
// the audio-private AudioNumberDialog onto global DS tokens so it themes
// correctly wherever it portals. These lock the snap/clamp + confirm/cancel
// contract every slider consumer relies on.

describe("NumberEntryDialog", () => {
  it("renders the title, field label, suffix, and range", () => {
    render(
      <NumberEntryDialog
        title="Set Fixture intensity"
        fieldLabel="Intensity"
        initialValue={40}
        min={0}
        max={100}
        step={1}
        suffix="%"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole("dialog", { name: "Set Fixture intensity" })).toBeInTheDocument();
    expect(screen.getByText("Intensity")).toBeInTheDocument();
    expect(screen.getByText("%")).toBeInTheDocument();
    expect(screen.getByText("0 to 100")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(40);
  });

  it("snaps + clamps the typed value to the field step on confirm", () => {
    const onConfirm = vi.fn();
    render(
      <NumberEntryDialog
        title="Set value"
        fieldLabel="Value"
        initialValue={0}
        min={0}
        max={100}
        step={5}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "37" } });
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(onConfirm).toHaveBeenCalledWith(35); // 37 snapped to the nearest 5
  });

  it("rejects an out-of-range value (Set disabled)", () => {
    const onConfirm = vi.fn();
    render(
      <NumberEntryDialog
        title="Set value"
        fieldLabel="Value"
        initialValue={10}
        min={0}
        max={100}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "250" } });
    expect(screen.getByRole("button", { name: "Set" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Set" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls onCancel from the Cancel button", () => {
    const onCancel = vi.fn();
    render(
      <NumberEntryDialog
        title="Set value"
        fieldLabel="Value"
        initialValue={10}
        min={0}
        max={100}
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
});
