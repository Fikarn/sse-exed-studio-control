import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu, type ContextMenuItem } from "../ContextMenu";

// The right-click menus of before, drawn by the one menu at the pointer
// (visual overhaul B): the API stays; a disabled item is drawn disabled and
// passed over, a danger item is coral and stands last after a divider, Enter
// presses the focused item, Esc closes.

function makeItems(onSelect: () => void): readonly ContextMenuItem[] {
  return [
    { id: "rename", label: "Rename", onSelect },
    { id: "duplicate", label: "Duplicate", onSelect, disabled: true },
    { id: "delete", label: "Delete", onSelect, tone: "danger" },
  ];
}

describe("ContextMenu", () => {
  it("renders a role=menu with one menuitem per supplied item, on the floating layer", () => {
    render(<ContextMenu x={10} y={10} onClose={() => undefined} items={makeItems(() => undefined)} />);

    const menu = screen.getByRole("menu");
    expect(menu.closest("[data-level='float']")).not.toBeNull();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.textContent)).toEqual(["Rename", "Duplicate", "Delete"]);
  });

  it("uses the provided ariaLabel when supplied", () => {
    render(
      <ContextMenu x={0} y={0} onClose={() => undefined} ariaLabel="Scene actions" items={makeItems(() => undefined)} />
    );
    expect(screen.getByRole("menu", { name: "Scene actions" })).toBeInTheDocument();
  });

  it("draws a danger item coral, last, after a divider", () => {
    render(<ContextMenu x={0} y={0} onClose={() => undefined} items={makeItems(() => undefined)} />);
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("data-tone", "danger");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("marks disabled items as disabled and does not invoke them", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={0} y={0} onClose={() => undefined} items={makeItems(onSelect)} />);

    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" });
    expect(duplicate).toHaveAttribute("aria-disabled", "true");
    await user.click(duplicate);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("puts the focus on the first enabled item; Enter presses it and the menu closes first", async () => {
    const order: string[] = [];
    const user = userEvent.setup();
    render(
      <ContextMenu x={0} y={0} onClose={() => order.push("close")} items={makeItems(() => order.push("select"))} />
    );
    expect(screen.getByRole("menuitem", { name: "Rename" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(order).toEqual(["close", "select"]);
  });

  it("ArrowDown passes over disabled items to the next enabled one", async () => {
    const user = userEvent.setup();
    render(<ContextMenu x={0} y={0} onClose={() => undefined} items={makeItems(() => undefined)} />);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  });

  it("Escape invokes onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={makeItems(() => undefined)} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
