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
    expect(screen.getByText("0 to 100 %")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Set value" }));
    expect(onConfirm).toHaveBeenCalledWith(35); // 37 snapped to the nearest 5
  });

  it("rejects an out-of-range value (Set value disabled)", () => {
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
    expect(screen.getByRole("button", { name: "Set value" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Set value" }));
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

  // New pages program, Slice 3 (decision 8): with the Backspace / Delete /
  // Alt+double-click resets gone, the typed-entry dialog carries the way back
  // to a control's default as a key of its own.
  describe("the Reset key", () => {
    it("shows only when the control has a default", () => {
      render(
        <NumberEntryDialog
          title="Set Host preamp gain"
          fieldLabel="Gain"
          initialValue={12}
          min={0}
          max={60}
          suffix="dB"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(screen.queryByRole("button", { name: /^Reset to/ })).not.toBeInTheDocument();
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Cancel", "Set value"]);
    });

    it("names the default with its unit and confirms exactly that value", () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      render(
        <NumberEntryDialog
          title="Set Host preamp gain"
          fieldLabel="Gain"
          initialValue={12}
          min={0}
          max={60}
          suffix="dB"
          resetValue={0}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );
      const reset = screen.getByRole("button", { name: "Reset to 0 dB" });
      // It sits beside Cancel and Set value, in the dialog's own key row.
      expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
        "Reset to 0 dB",
        "Cancel",
        "Set value",
      ]);
      // The typed draft does not matter: Reset confirms the default.
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "37" } });
      fireEvent.click(reset);
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onConfirm).toHaveBeenCalledWith(0);
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("reads a percentage default and takes a label of its own", () => {
      const { unmount } = render(
        <NumberEntryDialog
          title="Set Fixture intensity"
          fieldLabel="Intensity"
          initialValue={40}
          min={0}
          max={100}
          suffix="%"
          resetValue={100}
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(screen.getByRole("button", { name: "Reset to 100 %" })).toBeInTheDocument();
      unmount();

      render(
        <NumberEntryDialog
          title="Set Host send"
          fieldLabel="Send"
          initialValue={-12}
          min={-65}
          max={6}
          suffix="dB"
          resetValue={0}
          resetLabel="unity"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      );
      expect(screen.getByRole("button", { name: "Reset to unity" })).toBeInTheDocument();
    });

    it("is disabled while a commit is in flight", () => {
      const onConfirm = vi.fn();
      render(
        <NumberEntryDialog
          busy
          title="Set Host preamp gain"
          fieldLabel="Gain"
          initialValue={12}
          min={0}
          max={60}
          suffix="dB"
          resetValue={0}
          onConfirm={onConfirm}
          onCancel={() => {}}
        />
      );
      const reset = screen.getByRole("button", { name: "Reset to 0 dB" });
      expect(reset).toBeDisabled();
      fireEvent.click(reset);
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });
});
