import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusDot, type StatusDotSize, type StatusDotState } from "../StatusDot";

// plan PR 6 / workstream D2: StatusDot is a purely-visual indicator (3
// imports). Renders an aria-hidden span — no interactive behavior, so
// tests cover render + every variant + the optional glow toggle.

const TONES: readonly StatusDotState[] = ["ok", "attn", "err", "info"];
const SIZES: readonly StatusDotSize[] = ["sm", "md"];

describe("StatusDot", () => {
  it("renders an aria-hidden span by default", () => {
    const { container } = render(<StatusDot tone="ok" />);
    const span = container.querySelector("span");
    expect(span).not.toBeNull();
    expect(span).toHaveAttribute("aria-hidden", "true");
  });

  it("applies every documented tone", () => {
    for (const tone of TONES) {
      const { unmount, container } = render(<StatusDot tone={tone} />);
      const span = container.querySelector("span");
      expect(span?.className).toMatch(new RegExp(tone));
      unmount();
    }
  });

  it("applies every documented size", () => {
    for (const size of SIZES) {
      const { unmount, container } = render(<StatusDot tone="ok" size={size} />);
      const span = container.querySelector("span");
      expect(span?.className).toMatch(new RegExp(size));
      unmount();
    }
  });

  it("includes the glow class when glow=true (default)", () => {
    const { container } = render(<StatusDot tone="ok" />);
    const span = container.querySelector("span");
    expect(span?.className).toMatch(/glow/);
  });

  it("omits the glow class when glow=false", () => {
    const { container } = render(<StatusDot tone="ok" glow={false} />);
    const span = container.querySelector("span");
    expect(span?.className).not.toMatch(/glow/);
  });

  it("merges a caller-supplied className", () => {
    const { container } = render(<StatusDot tone="ok" className="extra-class" />);
    const span = container.querySelector("span");
    expect(span?.className).toMatch(/extra-class/);
  });
});
