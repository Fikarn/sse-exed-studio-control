import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { Toast, type ToastTone } from "../Toast";

const cssOf = (name: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", name), "utf8");

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

  // Atrium: a toast is a tile of the floating layer — the raised surface, the
  // menu's edge and the floating shadow — and its tone is its lamp alone.
  it("is a tile of the floating layer whose tone is its lamp", () => {
    render(<Toast tone="error" title="Action failed" message="boom" onDismiss={() => {}} />);
    const tile = screen.getByRole("alert");
    expect(tile).toHaveAttribute("data-level", "float");
    expect(tile.querySelector("[data-lamp='error']")).toHaveAttribute("data-lit");
    const css = cssOf("Toast.module.css");
    expect(css).toMatch(/\.toast \{[^}]*border: 1px solid var\(--material-line2\)/);
    expect(css).toMatch(/\.toast \{[^}]*background: var\(--material-raise\)/);
    expect(css).toMatch(/\.toast \{[^}]*box-shadow: var\(--elevation-float\)/);
    expect(css).not.toMatch(/data-tone/);
  });

  it("wires the action and dismiss buttons", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    render(<Toast tone="ok" message="Done." action={{ label: "Undo", onClick: onAction }} onDismiss={onDismiss} />);
    screen.getByRole("button", { name: "Undo" }).click();
    expect(onAction).toHaveBeenCalledOnce();
    screen.getByRole("button", { name: "Dismiss message" }).click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
