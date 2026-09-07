import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, type StatusTone } from "../StatusBadge";

// plan PR 6 / workstream D2: StatusBadge is a purely-visual label primitive
// (7 imports). Visual overhaul A, Slice 3 (system §8): its tones are the
// shared state vocabulary — ok · attention · error · info · neutral — and the
// pre-A names (healthy, ready, connected, degraded, warning, idle) stay as
// aliases onto them until Slice 11. Old assertion: the seven legacy tones only.

const TONES: readonly StatusTone[] = ["ok", "attention", "error", "info", "neutral"];
const LEGACY: ReadonlyArray<[StatusTone, string]> = [
  ["healthy", "ok"],
  ["ready", "ok"],
  ["connected", "ok"],
  ["degraded", "attention"],
  ["warning", "attention"],
  ["idle", "neutral"],
  ["error", "error"],
];

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
      expect(badge).toHaveAttribute("data-tone", tone);
      unmount();
    }
  });

  it("keeps the legacy tone names as aliases onto the shared vocabulary", () => {
    for (const [legacy, canonical] of LEGACY) {
      const { unmount } = render(<StatusBadge label={legacy} tone={legacy} />);
      const badge = screen.getByText(legacy);
      expect(badge.className).toMatch(new RegExp(legacy));
      expect(badge).toHaveAttribute("data-tone", canonical);
      unmount();
    }
  });
});
