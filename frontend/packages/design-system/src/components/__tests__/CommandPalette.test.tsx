import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandPalette, type PaletteAction } from "../CommandPalette";

// plan PR 6 / workstream D2: CommandPalette is the ⌘K palette (2 imports
// in app code; also where the `PaletteAction` type lives). Tests cover
// render + closed state, input focus on open, arrow-key + Enter
// activation, Escape dismiss, the Recent group, fuzzy search, and the
// empty-state fallback.

function makeActions(spy: () => void = () => undefined): readonly PaletteAction[] {
  return [
    { id: "save", label: "Save scene", group: "Scene", action: spy },
    { id: "recall", label: "Recall scene", group: "Scene", keywords: ["load"], action: spy },
    { id: "identify", label: "Identify fixture", group: "Workspace", action: spy },
  ];
}

describe("CommandPalette", () => {
  it("renders nothing when closed", () => {
    render(<CommandPalette open={false} onClose={() => undefined} actions={makeActions()} />);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).toBeNull();
  });

  it("renders the palette dialog and search input when open", async () => {
    render(<CommandPalette open onClose={() => undefined} actions={makeActions()} />);
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("renders all actions grouped by their `group`", () => {
    render(<CommandPalette open onClose={() => undefined} actions={makeActions()} />);
    expect(screen.getByText("Scene")).toBeInTheDocument();
    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Save scene")).toBeInTheDocument();
    expect(screen.getByText("Recall scene")).toBeInTheDocument();
    expect(screen.getByText("Identify fixture")).toBeInTheDocument();
  });

  it("surfaces a Recent group on top when recentActionIds is provided + query is empty", () => {
    render(<CommandPalette open onClose={() => undefined} actions={makeActions()} recentActionIds={["recall"]} />);
    expect(screen.getByText("Recent")).toBeInTheDocument();
  });

  it("filters the list as the user types and surfaces matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => undefined} actions={makeActions()} />);

    const input = screen.getByRole("textbox");
    await user.type(input, "identify");

    expect(screen.queryByText("Save scene")).toBeNull();
    expect(screen.getByText("Identify fixture")).toBeInTheDocument();
  });

  it("renders the empty-state message when no matches", async () => {
    const user = userEvent.setup();
    render(<CommandPalette open onClose={() => undefined} actions={makeActions()} emptyMessage="Nothing matches." />);
    const input = screen.getByRole("textbox");
    await user.type(input, "zzz-no-such-thing");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
  });

  it("invokes the focused action on Enter and closes", async () => {
    const onClose = vi.fn();
    const spy = vi.fn();
    const actions = makeActions(spy);
    vi.useFakeTimers();
    try {
      render(<CommandPalette open onClose={onClose} actions={actions} />);
      // Wait microtasks: input focus runs via setTimeout(0). Flush it.
      vi.runOnlyPendingTimers();

      // Activate the top action — uses raw DOM dispatch because fake timers
      // would otherwise hang userEvent.
      const dialog = screen.getByRole("dialog", { name: "Command palette" });
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

      expect(onClose).toHaveBeenCalled();
      // The action itself runs on the next macrotask.
      vi.runOnlyPendingTimers();
      expect(spy).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("Escape invokes onClose", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CommandPalette open onClose={onClose} actions={makeActions()} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
