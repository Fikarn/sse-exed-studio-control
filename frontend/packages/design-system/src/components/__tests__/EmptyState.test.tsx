import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Star } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "../OperationalState";

// plan PR 6 / workstream D2: EmptyState is the operational F10 empty pattern
// (3 imports, re-exported from OperationalState.tsx). Tests cover render,
// the optional message + icon, the `action` CTA path (primary + variant
// override + disabled), the free-form `actions` slot, and the role=status
// affordance for screen readers.

describe("EmptyState", () => {
  it("renders title with role=status", () => {
    render(<EmptyState title="Nothing here" />);
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent("Nothing here");
  });

  it("renders the optional message when provided", () => {
    render(<EmptyState title="Empty" message="Try adding one." />);
    expect(screen.getByText("Try adding one.")).toBeInTheDocument();
  });

  it("renders no actions block when neither action nor actions is given", () => {
    const { container } = render(<EmptyState title="x" />);
    // .actions class only appears when there is something to render.
    expect(container.querySelector("[class*='actions']")).toBeNull();
  });

  it("renders the `action` CTA and invokes its onClick", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<EmptyState title="No items" action={{ label: "Add one", onClick }} />);

    const button = screen.getByRole("button", { name: "Add one" });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables the action button when action.disabled=true", () => {
    render(<EmptyState title="x" action={{ label: "Inert", onClick: () => undefined, disabled: true }} />);
    expect(screen.getByRole("button", { name: "Inert" })).toBeDisabled();
  });

  it("honors the action.variant override (ghost)", () => {
    render(<EmptyState title="x" action={{ label: "Ghosted", onClick: () => undefined, variant: "ghost" }} />);
    const button = screen.getByRole("button", { name: "Ghosted" });
    expect(button.className).toMatch(/ghost/);
  });

  it("renders the action.icon when supplied", () => {
    render(<EmptyState title="x" action={{ label: "Star it", onClick: () => undefined, icon: Star }} />);
    // lucide-react renders an SVG inside the button when icon is provided.
    const button = screen.getByRole("button", { name: "Star it" });
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("renders the free-form actions slot alongside the action CTA", () => {
    render(
      <EmptyState
        title="x"
        action={{ label: "CTA", onClick: () => undefined }}
        actions={<button type="button">Extra</button>}
      />
    );
    expect(screen.getByRole("button", { name: "CTA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Extra" })).toBeInTheDocument();
  });
});
