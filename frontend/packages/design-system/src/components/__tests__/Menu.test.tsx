import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Menu, type MenuEntry, type MenuProps } from "../Menu";
import { MenuButton } from "../MenuButton";
import { useArm } from "../useArm";

// Visual overhaul B (DESIGN.md §9): the one menu. Its head names the object,
// items state their value in words at the right, a disabled item says why,
// the destructive item sits last and arms in place while the menu stays open,
// and Esc first disarms, then closes and gives the focus back.

function entries(
  handlers: { level?: () => void; autoSet?: (next: boolean) => void; clear?: () => void } = {}
): MenuEntry[] {
  return [
    { id: "level", label: "Set fader level…", value: "−3.8 dB", onSelect: handlers.level ?? (() => undefined) },
    { id: "send", label: "Set Main Out send to 0 dB", onSelect: () => undefined },
    { kind: "divider" },
    {
      kind: "check",
      id: "autoset",
      label: "AutoSet",
      checked: true,
      onCheckedChange: handlers.autoSet ?? (() => undefined),
    },
    { id: "clear", label: "Clear clip", onSelect: handlers.clear ?? (() => undefined), disabledReason: "no clip held" },
  ];
}

/** A menu with the surface's arm state (no dwell, so a test presses twice at once). */
function Harness(props: Partial<MenuProps> & { onConfirm?: () => void; onClose?: MenuProps["onClose"] }) {
  const arm = useArm({ dwellMs: 0 });
  return (
    <Menu
      open
      anchor={{ x: 100, y: 100 }}
      head={{ title: "Host", detail: "Preamp 1 · mic" }}
      items={entries()}
      destructive={{
        id: "phantom",
        label: "Turn 48 V off…",
        armedLabel: "Press again to turn 48 V off",
        onConfirm: props.onConfirm ?? (() => undefined),
        testId: "phantom-off",
      }}
      arm={arm}
      {...props}
      onClose={props.onClose ?? (() => undefined)}
    />
  );
}

describe("Menu", () => {
  it("is a floating layer whose head names the menu", () => {
    render(<Harness />);
    const menu = screen.getByRole("menu", { name: "Host" });
    expect(menu.closest("[data-level='float']")).not.toBeNull();
    expect(screen.getByText("Preamp 1 · mic")).toBeInTheDocument();
  });

  it("states values, a toggle's value in words, and a disabled item's reason at the right", () => {
    render(<Harness />);
    expect(screen.getByRole("menuitem", { name: /Set fader level/ })).toHaveTextContent("−3.8 dB");
    const autoSet = screen.getByRole("menuitemcheckbox", { name: /AutoSet/ });
    expect(autoSet).toHaveAttribute("aria-checked", "true");
    expect(autoSet).toHaveTextContent("on");
    const clear = screen.getByRole("menuitem", { name: /Clear clip/ });
    expect(clear).toHaveAttribute("aria-disabled", "true");
    expect(clear).toHaveTextContent("no clip held");
  });

  it("runs a command and closes", async () => {
    const level = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness items={entries({ level })} onClose={onClose} />);
    await user.click(screen.getByRole("menuitem", { name: /Set fader level/ }));
    expect(level).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("select");
  });

  it("turns a toggle over", async () => {
    const autoSet = vi.fn();
    const user = userEvent.setup();
    render(<Harness items={entries({ autoSet })} />);
    await user.click(screen.getByRole("menuitemcheckbox", { name: /AutoSet/ }));
    expect(autoSet).toHaveBeenCalledWith(false);
  });

  it("never presses a disabled item", async () => {
    const clear = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness items={entries({ clear })} onClose={onClose} />);
    await user.click(screen.getByRole("menuitem", { name: /Clear clip/ }));
    expect(clear).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("puts the destructive item last, after a divider", () => {
    render(<Harness />);
    const items = Array.from(document.querySelectorAll("[data-menu-item]"));
    expect(items[items.length - 1]).toHaveTextContent("Turn 48 V off…");
    expect(screen.getAllByRole("separator").length).toBe(2);
  });

  it("arms the destructive item in place, keeps the menu open, and does it on the second press", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onConfirm={onConfirm} onClose={onClose} />);
    const item = screen.getByTestId("phantom-off");
    await user.click(item);
    expect(item).toHaveAttribute("data-armed", "true");
    expect(item).toHaveTextContent("Press again to turn 48 V off");
    expect(screen.getByTestId("phantom-off-countdown")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(item);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("select");
  });

  it("disarms on Esc and stays open; the next Esc closes", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const item = screen.getByTestId("phantom-off");
    await user.click(item);
    expect(item).toHaveAttribute("data-armed", "true");
    await user.keyboard("{Escape}");
    expect(item).toHaveAttribute("data-armed", "false");
    expect(onClose).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledWith("escape");
  });

  it("keeps its Esc from the page under it", async () => {
    const pageEscape = vi.fn();
    const user = userEvent.setup();
    window.addEventListener("keydown", pageEscape);
    try {
      render(<Harness />);
      screen.getByRole("menu").focus();
      await user.keyboard("{Escape}");
      expect(pageEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", pageEscape);
    }
  });

  it("leaves the page's own armed key for the Esc after the menu has closed", async () => {
    const user = userEvent.setup();
    function Page() {
      const arm = useArm({ dwellMs: 0 });
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => arm.armOrApply("save", "Save scene", () => undefined)}>
            {arm.armed ? "armed" : "at rest"}
          </button>
          <Menu
            open={open}
            anchor={{ x: 10, y: 10 }}
            onClose={() => setOpen(false)}
            items={[{ id: "a", label: "Rename", onSelect: () => undefined }]}
            initialFocus="first"
          />
        </>
      );
    }
    render(<Page />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "at rest" }));
    });
    screen.getByRole("menuitem", { name: "Rename" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "armed" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "at rest" })).toBeInTheDocument();
  });

  it("never confirms its armed item on a held Enter's repeats", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} initialFocus="first" />);
    const item = screen.getByTestId("phantom-off");
    item.focus();
    fireEvent.pointerEnter(item);
    fireEvent.keyDown(item, { key: "Enter" });
    expect(item).toHaveAttribute("data-armed", "true");
    fireEvent.keyDown(item, { key: "Enter", repeat: true });
    fireEvent.keyDown(item, { key: "Enter", repeat: true });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.keyDown(item, { key: "Enter" });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("disarms when the pointer moves to another item", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const item = screen.getByTestId("phantom-off");
    await user.click(item);
    expect(item).toHaveAttribute("data-armed", "true");
    await user.hover(screen.getByRole("menuitem", { name: /Set Main Out send/ }));
    expect(item).toHaveAttribute("data-armed", "false");
  });

  it("disarms when the arm window runs out, and stays open", () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      render(<Harness onClose={onClose} />);
      const item = screen.getByTestId("phantom-off");
      fireEvent.click(item);
      expect(item).toHaveAttribute("data-armed", "true");
      act(() => {
        vi.advanceTimersByTime(4600);
      });
      expect(item).toHaveAttribute("data-armed", "false");
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves through its items with the arrows and presses one with Enter", async () => {
    const level = vi.fn();
    const user = userEvent.setup();
    render(<Harness items={entries({ level })} initialFocus="first" />);
    expect(screen.getByRole("menuitem", { name: /Set fader level/ })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /Set Main Out send/ })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");
    expect(level).toHaveBeenCalledTimes(1);
  });

  it("closes on a press outside", () => {
    const onClose = vi.fn();
    render(
      <>
        <button type="button">elsewhere</button>
        <Harness onClose={onClose} />
      </>
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(onClose).toHaveBeenCalledWith("outside");
  });

  it("marks the chosen one of a group of choices", () => {
    render(
      <Harness
        items={[
          { kind: "label", id: "show", label: "Show" },
          { kind: "radio", id: "rig", label: "Rig", checked: true, onSelect: () => undefined },
          { kind: "radio", id: "coverage", label: "Coverage", checked: false, onSelect: () => undefined },
        ]}
      />
    );
    expect(screen.getByRole("group", { name: "Show" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Rig" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Coverage" })).toHaveAttribute("aria-checked", "false");
  });
});

function ObjectWithMenu({ onSelect = () => undefined }: { onSelect?: () => void }) {
  const objectRef = useRef<HTMLDivElement | null>(null);
  const [opened, setOpened] = useState(0);
  return (
    <div>
      <div ref={objectRef} data-testid="strip">
        Host
      </div>
      <MenuButton
        buttonLabel="Host menu"
        contextTarget={objectRef}
        onOpenChange={(open) => open && setOpened((n) => n + 1)}
        menu={{ head: { title: "Host" }, items: [{ id: "level", label: "Set fader level…", onSelect }] }}
      />
      <output data-testid="opened">{opened}</output>
    </div>
  );
}

describe("MenuButton", () => {
  it("is the ⋯ key: it says it opens a menu and whether it is open", async () => {
    const user = userEvent.setup();
    render(<ObjectWithMenu />);
    const button = screen.getByRole("button", { name: "Host menu" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button.getAttribute("aria-controls")).toBe(screen.getByRole("menu").id);
    await user.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("gives the focus back to the ⋯ when the menu closes on Esc", async () => {
    const user = userEvent.setup();
    render(<ObjectWithMenu />);
    const button = screen.getByRole("button", { name: "Host menu" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: /Set fader level/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("opens the same menu at the pointer on a right-click on its object", () => {
    render(<ObjectWithMenu />);
    fireEvent.contextMenu(screen.getByTestId("strip"), { clientX: 300, clientY: 200 });
    expect(screen.getByRole("menu", { name: "Host" })).toBeInTheDocument();
    expect(screen.getByTestId("opened")).toHaveTextContent("1");
  });
});
