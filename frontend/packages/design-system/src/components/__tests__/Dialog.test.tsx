import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { Dialog } from "../Dialog";

const cssOf = (name: string) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", name), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );

// plan PR 6 / workstream D2: Dialog is the modal primitive (6 imports). It
// portals to document.body, manages focus, and traps Tab. Tests cover render,
// optional slots, focus management on mount + unmount, Escape dismiss, and
// the Tab focus trap.

describe("Dialog", () => {
  it("renders the title via the role=dialog node", () => {
    render(<Dialog title="Reset scene" />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reset scene" })).toBeInTheDocument();
  });

  // Visual overhaul 2026-10 (Atrium): the dialog is the floating layer — the
  // raised surface, a key's edge, the one radius, the float shadow, marked
  // `data-level="float"` — over a flat scrim with no backdrop blur.
  it("is the floating layer over a flat scrim", () => {
    render(<Dialog title="Reset scene" />);
    expect(screen.getByRole("dialog")).toHaveAttribute("data-level", "float");
    const css = cssOf("Dialog.module.css");
    expect(css).toMatch(
      /\.dialog \{[^}]*border-radius: var\(--radius-base\);[^}]*border: 1px solid var\(--material-line2\);[^}]*background: var\(--material-raise\);[^}]*box-shadow: var\(--elevation-float\)/
    );
    expect(css).toMatch(/\.overlay \{[^}]*background: color-mix\(in srgb, var\(--material-well\) 60%, transparent\)/);
    expect(css).toMatch(/\.title \{[^}]*700 var\(--font-size-word\) \/ [^;]* var\(--font-family-ui\)/);
    expect(css).not.toMatch(/backdrop-filter|gradient\(|--elevation-plate|--radius-screen|--font-size-state/);
  });

  it("renders optional body + actions slots when provided", () => {
    render(<Dialog title="Confirm" body="Are you sure?" actions={<button type="button">OK</button>} />);
    expect(screen.getByText("Are you sure?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("renders free-form children", () => {
    render(
      <Dialog title="Pick">
        <p data-testid="custom-body">Custom content</p>
      </Dialog>
    );
    expect(screen.getByTestId("custom-body")).toBeInTheDocument();
  });

  it("moves focus into the dialog on mount", () => {
    // The Dialog implementation filters focusables on `offsetParent !==
    // null`, which JSDOM does not compute (it returns null for everything
    // not currently focused). The component then falls back to focusing
    // the dialog container itself. Either outcome is "focus moved into
    // the dialog" — which is the contract that matters for screen reader
    // users. Assert against the looser invariant.
    render(
      <Dialog
        title="Focus on mount"
        actions={
          <>
            <button type="button">First</button>
            <button type="button">Second</button>
          </>
        }
      />
    );
    const dialog = screen.getByRole("dialog");
    const focused = document.activeElement;
    expect(focused === dialog || dialog.contains(focused)).toBe(true);
  });

  it("falls back to focusing the dialog itself when no focusable children", () => {
    render(<Dialog title="No focusables" />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
  });

  it("restores focus to the previously focused element on unmount", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "Trigger";
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { unmount } = render(<Dialog title="Closes" />);
    unmount();

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("invokes onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Dialog title="Close me" onClose={onClose} />);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses labelledBy when provided for aria-labelledby", () => {
    render(<Dialog title="x" labelledBy="custom-label-id" />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-labelledby", "custom-label-id");
  });

  it("keeps Tab focus inside the dialog (does not escape to body)", async () => {
    // Same caveat as the focus-on-mount test: JSDOM does not compute
    // layout, so the production focusable filter (offsetParent !== null)
    // sees an empty list and the focus trap falls back to focusing the
    // dialog container itself. We can still assert the invariant that
    // matters: a Tab keypress while inside the dialog does NOT move
    // focus to <body> or to an element outside the dialog tree.
    const user = userEvent.setup();
    render(
      <Dialog
        title="Trap"
        actions={
          <>
            <button type="button">First</button>
            <button type="button">Last</button>
          </>
        }
      />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(document.activeElement === dialog || dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });
});
