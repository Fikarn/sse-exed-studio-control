import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Toast, type ToastTone } from "../Toast";

// Slice 6a (GLO-06 / CHROME-08): the Toast gained a 4th `attention` (amber)
// tone for blocked-action / degraded-but-not-failed advisories. These tests
// lock the tone vocabulary + the role mapping (only `error` announces
// assertively) so a future edit can't silently drop or re-route a tone.

const TONES: readonly ToastTone[] = ["ok", "attention", "error", "info"];

describe("Toast", () => {
  it("renders every tone with a matching data-tone", () => {
    for (const tone of TONES) {
      const { unmount } = render(<Toast tone={tone} message="hi" onDismiss={() => {}} />);
      const tile = document.querySelector(`[data-tone="${tone}"]`);
      expect(tile, `data-tone=${tone}`).not.toBeNull();
      unmount();
    }
  });

  it("announces only error assertively (role=alert); the rest are polite status", () => {
    const { unmount } = render(<Toast tone="error" message="boom" onDismiss={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    unmount();

    for (const tone of ["ok", "attention", "info"] as const) {
      const { unmount: u } = render(<Toast tone={tone} message="note" onDismiss={() => {}} />);
      const tile = document.querySelector(`[data-tone="${tone}"]`);
      expect(tile).toHaveAttribute("role", "status");
      u();
    }
  });

  it("renders the optional title above the message", () => {
    render(<Toast tone="attention" title="Heads up" message="Exit preview first." onDismiss={() => {}} />);
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Exit preview first.")).toBeInTheDocument();
  });

  it("wires the action and dismiss buttons", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast tone="ok" message="Done." action={{ label: "Undo", onClick: onAction }} onDismiss={onDismiss} />);
    screen.getByRole("button", { name: "Undo" }).click();
    expect(onAction).toHaveBeenCalledOnce();
    screen.getByRole("button", { name: "Dismiss" }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
