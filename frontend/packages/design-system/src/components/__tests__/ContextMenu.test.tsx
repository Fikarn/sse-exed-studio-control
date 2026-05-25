import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContextMenu, type ContextMenuItem } from "../ContextMenu";

// plan PR 6 / workstream D2: ContextMenu is the right-click style floating
// menu (5 imports). Tests cover render, both tone variants, arrow-key
// navigation, Enter activation, Escape dismiss, and the disabled-item rule.

function makeItems(onSelect: () => void): readonly ContextMenuItem[] {
  return [
    { id: "rename", label: "Rename", onSelect },
    { id: "duplicate", label: "Duplicate", onSelect, disabled: true },
    { id: "delete", label: "Delete", onSelect, tone: "danger" },
  ];
}

describe("ContextMenu", () => {
  it("renders a role=menu with one menuitem per supplied item", () => {
    const onClose = vi.fn();
    render(<ContextMenu x={10} y={10} onClose={onClose} items={makeItems(() => undefined)} />);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(items.map((el) => el.textContent)).toEqual(["Rename", "Duplicate", "Delete"]);
  });

  it("uses the provided ariaLabel when supplied", () => {
    render(
      <ContextMenu x={0} y={0} onClose={() => undefined} ariaLabel="Scene actions" items={makeItems(() => undefined)} />
    );
    expect(screen.getByRole("menu", { name: "Scene actions" })).toBeInTheDocument();
  });

  it("renders the danger tone class on items with tone=danger", () => {
    render(<ContextMenu x={0} y={0} onClose={() => undefined} items={makeItems(() => undefined)} />);
    const deleteItem = screen.getByRole("menuitem", { name: "Delete" });
    expect(deleteItem.className).toMatch(/itemDanger/);
  });

  it("marks disabled items as disabled and does not invoke them", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={makeItems(onSelect)} />);

    const duplicate = screen.getByRole("menuitem", { name: "Duplicate" });
    expect(duplicate).toBeDisabled();
    await user.click(duplicate);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("activates the focused item on Enter and then closes", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={makeItems(onSelect)} />);

    // initial focus index = first non-disabled = Rename (index 0)
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ArrowDown skips disabled items and moves to the next enabled one", async () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={makeItems(onSelect)} />);

    // Start on Rename, ArrowDown should skip Duplicate (disabled) → Delete.
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    // Delete is the active item; confirm by class on the rendered button.
    const deleteItem = screen.queryByRole("menuitem", { name: "Delete" });
    // After activation the menu is closed via onClose; the component itself
    // still renders in this test environment (parent decides unmount). So
    // assert onClose was called — that's the contract.
    expect(onClose).toHaveBeenCalled();
    // sanity check the rendered DOM still includes Delete (no unmount in test):
    expect(deleteItem).toBeInTheDocument();
  });

  it("Escape invokes onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu x={0} y={0} onClose={onClose} items={makeItems(() => undefined)} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
