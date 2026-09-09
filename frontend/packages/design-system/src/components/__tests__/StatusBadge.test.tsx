import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, type StatusTone } from "../StatusBadge";

// plan PR 6 / workstream D2: StatusBadge is a purely-visual label primitive
// (7 imports). Visual overhaul A, Slice 3 (system §8): its tones are the shared
// state vocabulary — ok · attention · error · info · neutral. Slice 11: the
// pre-A names (healthy, ready, connected, degraded, warning, idle) were aliases
// onto those five and are gone, so the alias case goes with them — there is one
// vocabulary now, and this asserts that it is the whole of it.

const TONES: readonly StatusTone[] = ["ok", "attention", "error", "info", "neutral"];

describe("StatusBadge", () => {
  it("renders the supplied label", () => {
    render(<StatusBadge label="ONLINE" tone="ok" />);
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

  // Slice 11 removed "keeps the legacy tone names as aliases onto the shared
  // vocabulary". Reason: the aliases it guarded are gone, so the behaviour it
  // asserted no longer exists. What replaces it is the type — `StatusTone` is
  // `SharedStatusTone` now, so a caller that still says "healthy" does not
  // compile, which is a stronger guard than a runtime class check (these unit
  // tests resolve CSS-module keys through a proxy, so every class name
  // "exists" here whatever the stylesheet holds).
});
