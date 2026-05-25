import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, type StatusTone } from "../StatusBadge";

// plan PR 6 / workstream D2: StatusBadge is a purely-visual label primitive
// (7 imports). Tests cover render + every documented tone. No interactive
// behavior to exercise.

const TONES: readonly StatusTone[] = ["healthy", "ready", "connected", "degraded", "warning", "idle", "error"];

describe("StatusBadge", () => {
  it("renders the supplied label", () => {
    render(<StatusBadge label="ONLINE" tone="healthy" />);
    expect(screen.getByText("ONLINE")).toBeInTheDocument();
  });

  it("applies every documented tone", () => {
    for (const tone of TONES) {
      const { unmount } = render(<StatusBadge label={tone} tone={tone} />);
      const badge = screen.getByText(tone);
      expect(badge.className).toMatch(new RegExp(tone));
      unmount();
    }
  });
});
