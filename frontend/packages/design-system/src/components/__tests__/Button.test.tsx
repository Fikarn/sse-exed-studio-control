import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../Button";

// plan PR 6 / workstream D2: Button is the most-imported design-system
// primitive (22 call sites across frontend/app). Tests cover render,
// every documented variant + size, keyboard activation, loading + disabled
// behavior, and aria-busy.

describe("Button", () => {
  it("renders as a button element by default", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button");
  });

  it("applies every documented variant", () => {
    for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      const button = screen.getByRole("button", { name: variant });
      // CSS-module class names are hashed but contain the variant token.
      expect(button.className).toMatch(new RegExp(variant));
      unmount();
    }
  });

  it("applies every documented size", () => {
    for (const size of ["default", "compact"] as const) {
      const { unmount } = render(<Button size={size}>{size}</Button>);
      const button = screen.getByRole("button", { name: size });
      expect(button.className).toMatch(new RegExp(size));
      unmount();
    }
  });

  it("activates on Enter and Space when focused", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<Button onClick={onClick}>Submit</Button>);

    const button = screen.getByRole("button", { name: "Submit" });
    button.focus();
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("marks itself busy + disabled when loading", () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button disabled onClick={onClick}>
        Inert
      </Button>
    );
    await user.click(screen.getByRole("button", { name: "Inert" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders the leadingVisual slot when provided", () => {
    render(<Button leadingVisual={<span data-testid="leading-icon">★</span>}>With icon</Button>);
    expect(screen.getByTestId("leading-icon")).toBeInTheDocument();
  });
});
