import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Power } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { IconButton } from "../IconButton";

// plan PR 6 / workstream D2: IconButton is the icon-only button primitive
// (2 imports). Tests cover render, every tone + size, the aria-pressed
// toggle, the badge slot, click + keyboard activation, and disabled.

describe("IconButton", () => {
  it("renders an accessible <button> with aria-label from label", () => {
    render(<IconButton icon={Power} label="Power" />);
    const button = screen.getByRole("button", { name: "Power" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("title", "Power");
  });

  it("applies every documented tone", () => {
    for (const tone of ["default", "primary", "danger", "ghost"] as const) {
      const { unmount } = render(<IconButton icon={Power} label={tone} tone={tone} />);
      const button = screen.getByRole("button", { name: tone });
      expect(button.className).toMatch(new RegExp(tone));
      unmount();
    }
  });

  it("applies every documented size", () => {
    for (const size of ["sm", "md"] as const) {
      const { unmount } = render(<IconButton icon={Power} label={size} size={size} />);
      const button = screen.getByRole("button", { name: size });
      expect(button.className).toMatch(new RegExp(size));
      unmount();
    }
  });

  it("renders the badge when supplied", () => {
    render(<IconButton icon={Power} label="Power" badge="3" />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("reflects aria-pressed when `pressed` is supplied", () => {
    const { rerender } = render(<IconButton icon={Power} label="Mute" pressed={false} />);
    expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "false");
    rerender(<IconButton icon={Power} label="Mute" pressed={true} />);
    expect(screen.getByRole("button", { name: "Mute" })).toHaveAttribute("aria-pressed", "true");
  });

  it("omits aria-pressed entirely when `pressed` is undefined", () => {
    render(<IconButton icon={Power} label="Power" />);
    const button = screen.getByRole("button", { name: "Power" });
    expect(button).not.toHaveAttribute("aria-pressed");
  });

  it("activates on Enter and Space when focused", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<IconButton icon={Power} label="Power" onClick={onClick} />);
    const button = screen.getByRole("button", { name: "Power" });
    button.focus();
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledTimes(1);

    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("does not fire onClick when disabled", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<IconButton icon={Power} label="Power" onClick={onClick} disabled />);
    await user.click(screen.getByRole("button", { name: "Power" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
