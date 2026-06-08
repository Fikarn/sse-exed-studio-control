import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusPill } from "../StatusPill";

// DES-07 (Slice 8e): StatusPill's prop was renamed `status` -> `tone` to align
// with every other status primitive. These lock the label + the tone->color
// mapping (driven by the inline --tone CSS var) + the info default.

const TONE_VARS: Record<string, string> = {
  ok: "var(--color-primary-500)",
  attention: "var(--color-warning-500)",
  error: "var(--color-danger-500)",
  info: "var(--color-info-500)",
};

describe("StatusPill", () => {
  it("renders the label", () => {
    const { getByText } = render(<StatusPill label="Connected" tone="ok" />);
    expect(getByText("Connected")).toBeInTheDocument();
  });

  it("maps each tone to its semantic color var", () => {
    for (const [tone, expected] of Object.entries(TONE_VARS)) {
      const { container, unmount } = render(<StatusPill label="x" tone={tone as keyof typeof TONE_VARS} />);
      const pill = container.firstElementChild as HTMLElement;
      expect(pill.style.getPropertyValue("--tone")).toBe(expected);
      unmount();
    }
  });

  it("defaults to the info tone", () => {
    const { container } = render(<StatusPill label="x" />);
    const pill = container.firstElementChild as HTMLElement;
    expect(pill.style.getPropertyValue("--tone")).toBe(TONE_VARS.info);
  });
});
