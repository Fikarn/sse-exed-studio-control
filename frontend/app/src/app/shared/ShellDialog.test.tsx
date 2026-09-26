import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShellDialog } from "./ShellDialog";

// New pages program, Slice 3 (D6). The shell's window key handler, which went
// with the shortcuts, was what closed "Close Studio Control?", "Restart the
// hardware link?" and "Retry startup?" when Escape arrived after focus had left
// the dialog. The dialog listens on the window itself now, so Escape closes it
// wherever focus is.

afterEach(() => {
  cleanup();
});

function renderDialog(onCancel = vi.fn(), onConfirm = vi.fn()) {
  const view = render(
    <ShellDialog
      body="Closing ends Studio Control's link to the desk, the rig and the deck."
      confirmLabel="Close Studio Control"
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Close Studio Control?"
    />
  );
  return { ...view, onCancel, onConfirm };
}

describe("ShellDialog", () => {
  it("cancels on Esc pressed while focus is on the page, outside the dialog", () => {
    const { onCancel, onConfirm } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Close Studio Control?" })).toBeTruthy();

    // Focus leaves the dialog, as after a click on the backdrop.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels once on Esc pressed inside the dialog", () => {
    const { onCancel } = renderDialog();
    const cancelKey = screen.getByRole("button", { name: "Cancel" });
    cancelKey.focus();
    fireEvent.keyDown(cancelKey, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stops listening once it is closed", () => {
    const { onCancel, unmount } = renderDialog();
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps focus where the operator put it when the shell draws again", () => {
    const { rerender } = renderDialog();
    const confirmKey = screen.getByRole("button", { name: "Close Studio Control" });
    confirmKey.focus();
    expect(document.activeElement).toBe(confirmKey);

    // The shell passes a new inline callback on every render (its clock ticks
    // every 15 s); a render must not pull focus back to the first key.
    const latestCancel = vi.fn();
    rerender(
      <ShellDialog
        body="Closing ends Studio Control's link to the desk, the rig and the deck."
        confirmLabel="Close Studio Control"
        onCancel={latestCancel}
        onConfirm={() => {}}
        title="Close Studio Control?"
      />
    );
    expect(document.activeElement).toBe(confirmKey);

    // And Esc reaches the callback of the latest render.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(latestCancel).toHaveBeenCalledTimes(1);
  });
});
