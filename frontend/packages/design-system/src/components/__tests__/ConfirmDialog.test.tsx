import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "../ConfirmDialog";

// plan PR 6 / workstream D2: ConfirmDialog wraps Dialog with a two-button
// confirm/cancel pattern (2 imports). Tests cover render with default +
// custom labels, body slot, click activation of both buttons, the danger
// variant, busy state disabling both buttons, and Escape -> onCancel.

describe("ConfirmDialog", () => {
  it("renders with default Confirm + Cancel labels", () => {
    render(<ConfirmDialog title="Delete?" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Delete?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("renders the optional body", () => {
    render(
      <ConfirmDialog
        title="Reset"
        body="All scene state will be lost."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(screen.getByText("All scene state will be lost.")).toBeInTheDocument();
  });

  it("honors custom confirmLabel + cancelLabel", () => {
    render(
      <ConfirmDialog
        title="x"
        confirmLabel="Discard"
        cancelLabel="Keep"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  });

  it("renders the confirm button with the danger variant when danger=true", () => {
    render(<ConfirmDialog title="x" danger onConfirm={() => undefined} onCancel={() => undefined} />);
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm.className).toMatch(/danger/);
  });

  it("invokes onConfirm when the confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="x" onConfirm={onConfirm} onCancel={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel when the cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="x" onConfirm={() => undefined} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("disables both buttons when busy=true", () => {
    render(<ConfirmDialog title="x" busy onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("invokes onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog title="x" onConfirm={() => undefined} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
