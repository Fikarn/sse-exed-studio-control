import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { Tooltip } from "../Tooltip";

// plan PR 6 / workstream D2: Tooltip wraps a trigger and reveals a bubble
// on hover / focus (5 imports). Tests cover render, both placement variants,
// aria-describedby wiring, the focus reveal (Tab brings the bubble), and
// blur dismissal.

describe("Tooltip", () => {
  it("renders the trigger child and a tooltip with the supplied content", () => {
    render(
      <Tooltip content="Helpful info">
        <span>trigger</span>
      </Tooltip>
    );
    expect(screen.getByText("trigger")).toBeInTheDocument();
    const bubble = screen.getByRole("tooltip");
    expect(bubble).toHaveTextContent("Helpful info");
  });

  it("wires aria-describedby from trigger to the tooltip id", () => {
    render(
      <Tooltip content="hint">
        <span>t</span>
      </Tooltip>
    );
    const bubble = screen.getByRole("tooltip");
    const describer = bubble.id;
    expect(describer).toBeTruthy();
    const triggerWrap = screen.getByText("t").parentElement;
    expect(triggerWrap).toHaveAttribute("aria-describedby", describer);
  });

  it("applies every documented placement variant", () => {
    for (const placement of ["top", "bottom"] as const) {
      const { unmount } = render(
        <Tooltip content={placement} placement={placement}>
          <span>{placement}</span>
        </Tooltip>
      );
      const bubble = screen.getByRole("tooltip");
      // Class names contain a hashed token, e.g. "bubbleBottom_abc123".
      const expectedFragment = placement === "bottom" ? "bubbleBottom" : "bubbleTop";
      expect(bubble.className).toMatch(new RegExp(expectedFragment));
      unmount();
    }
  });

  it("applies maxWidth as an inline style when provided", () => {
    render(
      <Tooltip content="x" maxWidth={240}>
        <span>t</span>
      </Tooltip>
    );
    const bubble = screen.getByRole("tooltip");
    expect(bubble).toHaveStyle({ maxWidth: "240px" });
  });

  it("becomes visible on focus and hides on blur", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">before</button>
        <Tooltip content="reveal me">
          <button type="button">trigger</button>
        </Tooltip>
        <button type="button">after</button>
      </>
    );

    const bubble = screen.getByRole("tooltip");
    expect(bubble).not.toHaveAttribute("data-visible");

    await user.tab(); // before
    await user.tab(); // trigger (focus inside wrapper triggers reveal)
    expect(bubble).toHaveAttribute("data-visible", "true");

    await user.tab(); // after — blur the wrapper
    expect(bubble).not.toHaveAttribute("data-visible");
  });
});
