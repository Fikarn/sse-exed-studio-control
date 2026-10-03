import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOOLTIP_DELAY_MS, Tooltip } from "../Tooltip";

// Visual overhaul B (DESIGN.md §9): the helper sentences are tooltips. The
// sentence is always the trigger's description; the tooltip opens after a
// rest of the pointer, at once on keyboard focus, closes on Esc, blur or a
// press, is drawn in a portal on the floating layer, and never covers a
// control used during a take.

function box(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2560 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 1440 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("describes its trigger with the sentence, and draws nothing at rest", () => {
    render(
      <Tooltip content="Faders set the sends into this mix">
        <button type="button">Main Out</button>
      </Tooltip>
    );
    const describedBy = screen.getByText("Main Out").parentElement?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Faders set the sends into this mix");
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens after the pointer rests, on the floating layer, in a portal", () => {
    const { container } = render(
      <Tooltip content="hint">
        <span>trigger</span>
      </Tooltip>
    );
    fireEvent.pointerEnter(screen.getByText("trigger").parentElement!.parentElement!);
    act(() => {
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 50);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(60);
    });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("hint");
    expect(tooltip).toHaveAttribute("data-level", "float");
    expect(container.contains(tooltip)).toBe(false);
  });

  it("closes when the pointer leaves, on Esc, and on a press", () => {
    render(
      <Tooltip content="hint" delayMs={0}>
        <span>trigger</span>
      </Tooltip>
    );
    const wrapper = screen.getByText("trigger").parentElement!.parentElement!;
    fireEvent.pointerEnter(wrapper);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.pointerEnter(wrapper);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("trigger"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    // A press keeps it closed until the pointer leaves.
    fireEvent.pointerEnter(wrapper);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerLeave(wrapper);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerEnter(wrapper);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("opens at once on keyboard focus and closes on blur", async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        <Tooltip content="reveal me">
          <button type="button">trigger</button>
        </Tooltip>
      </>
    );
    await user.tab();
    await user.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("reveal me");
    await user.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("never covers a take-time control: it takes another side", () => {
    render(
      <>
        <Tooltip content="hint" placement="bottom" delayMs={0}>
          <span data-testid="trigger">trigger</span>
        </Tooltip>
        <button type="button" data-take="" data-testid="dim">
          DIM
        </button>
      </>
    );
    vi.spyOn(screen.getByTestId("trigger").parentElement!, "getBoundingClientRect").mockReturnValue(
      box(500, 500, 100, 36)
    );
    vi.spyOn(screen.getByTestId("dim"), "getBoundingClientRect").mockReturnValue(box(400, 540, 300, 64));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(32);
    fireEvent.pointerEnter(screen.getByTestId("trigger").parentElement!.parentElement!);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveAttribute("data-side", "top");
  });

  it("does not open when every place would cover a take-time control", () => {
    render(
      <>
        <Tooltip content="hint" placement="bottom" delayMs={0}>
          <span data-testid="trigger">trigger</span>
        </Tooltip>
        <div data-take="" data-testid="block" />
      </>
    );
    vi.spyOn(screen.getByTestId("trigger").parentElement!, "getBoundingClientRect").mockReturnValue(
      box(500, 500, 100, 36)
    );
    vi.spyOn(screen.getByTestId("block"), "getBoundingClientRect").mockReturnValue(box(0, 0, 2560, 1440));
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(32);
    fireEvent.pointerEnter(screen.getByTestId("trigger").parentElement!.parentElement!);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("stays when it is held open, whatever is pressed", () => {
    render(
      <Tooltip content="held" open>
        <span>t</span>
      </Tooltip>
    );
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerDown(screen.getByText("t"));
    expect(screen.getByRole("tooltip")).toHaveAttribute("data-visible", "true");
  });

  it("closes when the page under it scrolls", () => {
    render(
      <Tooltip content="hint" delayMs={0}>
        <span>t</span>
      </Tooltip>
    );
    fireEvent.pointerEnter(screen.getByText("t").parentElement!.parentElement!);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.scroll(window);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("applies maxWidth to the tooltip", () => {
    render(
      <Tooltip content="x" maxWidth={240} delayMs={0}>
        <span>t</span>
      </Tooltip>
    );
    fireEvent.pointerEnter(screen.getByText("t").parentElement!.parentElement!);
    expect(screen.getByRole("tooltip")).toHaveStyle({ maxWidth: "240px" });
  });
});
