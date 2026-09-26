import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useAudioArming } from "../audio/hooks/useAudioArming";
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

  // Slice 3 review (#6): the Cancel key cancels and only cancels.
  it("Cancel calls onCancel once and never onConfirm; the confirm key the other way round", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close Studio Control" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

// Slice 3 review (#1, #13): "Close Studio Control?" opens over the Console, which
// stays mounted, and an armed 48 V change, recall or save listens for Esc on the
// window as well. The arm's listener is the older of the two (the arm came
// before the dialog), so the dialog has to take the Esc ahead of it: the dialog
// closes and the arm is left alone, as it was before Slice 3.
describe("ShellDialog over an armed Console action", () => {
  const armedRecall = {
    key: "snapshot-recall:snapshot-interview-block",
    label: "Recall Interview block",
    targetId: "snapshot-interview-block",
    targetKind: "snapshot-recall" as const,
    // Longer than the test, so the arm cannot lapse on its own.
    timeoutMs: 60_000,
  };

  function armThenOpenDialog() {
    const setFeedback = vi.fn();
    const arming = renderHook(() => useAudioArming({ resetTriggers: {}, setFeedback }));
    act(() => arming.result.current.armOrApplyAction(armedRecall, () => {}));
    expect(arming.result.current.armedAction?.key).toBe(armedRecall.key);
    return { arming, setFeedback, ...renderDialog() };
  }

  function expectArmKept(
    arming: ReturnType<typeof armThenOpenDialog>["arming"],
    setFeedback: ReturnType<typeof vi.fn>
  ) {
    expect(arming.result.current.armedAction?.key).toBe(armedRecall.key);
    // Only the arm's own "Armed: …" line; no "Armed audio action canceled.".
    expect(setFeedback).toHaveBeenCalledTimes(1);
    expect(setFeedback).not.toHaveBeenCalledWith(expect.objectContaining({ message: "Armed audio action canceled." }));
  }

  it("Esc with focus on Cancel closes the dialog and keeps the arm", () => {
    const { arming, onCancel, onConfirm, setFeedback } = armThenOpenDialog();
    const cancelKey = screen.getByRole("button", { name: "Cancel" });
    cancelKey.focus();
    fireEvent.keyDown(cancelKey, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expectArmKept(arming, setFeedback);
  });

  it("Esc with focus on the page closes the dialog and keeps the arm; once it is closed, Esc cancels the arm", () => {
    const { arming, onCancel, setFeedback, unmount } = armThenOpenDialog();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expectArmKept(arming, setFeedback);

    // The arm's listener is live all along: with the dialog closed, Esc is its.
    unmount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(arming.result.current.armedAction).toBeNull();
    expect(setFeedback).toHaveBeenLastCalledWith({ message: "Armed audio action canceled.", tone: "info" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
