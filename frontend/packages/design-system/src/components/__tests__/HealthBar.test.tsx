import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HealthBar, type HealthBarItemData } from "../HealthBar";

// Slice 5 (CHROME-02): the HealthBar is the single footer primitive for every
// surface. The `full` variant (Lighting, Setup) is a 64px status bar; the
// `caption` variant (Audio) is a thin telemetry+shortcut <footer> strip. These
// tests lock the structural contract both variants depend on — including the
// new icon / kbdAfter / testid-passthrough props — so a future edit can't
// silently regress the byte-identical Audio footer or the Lighting full bar.

const ITEMS: HealthBarItemData[] = [
  { label: "Bridge", value: "192.168.1.10", dot: "ok" },
  { label: "Fixtures", value: "4 / 4" },
];

describe("HealthBar", () => {
  describe("full variant (default)", () => {
    it("renders a status div with items as direct children, hints, and actions", () => {
      render(
        <HealthBar
          items={ITEMS}
          hints={[{ kbd: "⌘K", label: "palette" }]}
          actions={<button type="button">toggle</button>}
        />
      );
      const bar = screen.getByRole("status", { name: "Workspace health" });
      expect(bar.tagName).toBe("DIV");
      expect(bar).toHaveTextContent("Bridge");
      expect(bar).toHaveTextContent("192.168.1.10");
      expect(bar.querySelector("kbd")?.textContent).toBe("⌘K");
      expect(screen.getByRole("button", { name: "toggle" })).toBeInTheDocument();
    });

    it("forwards testid props onto the root and hint group", () => {
      render(
        <HealthBar
          items={ITEMS}
          hints={[{ kbd: "?", label: "help" }]}
          testId="lighting-health-bar"
          hintsTestId="lighting-hints"
        />
      );
      expect(screen.getByTestId("lighting-health-bar").tagName).toBe("DIV");
      expect(screen.getByTestId("lighting-hints")).toBeInTheDocument();
    });
  });

  describe("caption variant", () => {
    it("renders a <footer> with telemetry + shortcut containers keyed by testid", () => {
      render(
        <HealthBar
          variant="caption"
          items={[{ icon: <svg data-testid="clock-icon" />, label: "Clock", value: "12:00" }]}
          hints={[{ kbd: "⌘K", label: "palette" }]}
          testId="audio-health-bar"
          itemsTestId="audio-footer-telemetry"
          hintsTestId="audio-footer-shortcuts"
        />
      );
      const root = screen.getByTestId("audio-health-bar");
      expect(root.tagName).toBe("FOOTER");
      // The caption <footer> carries no role/aria-label (unlike the full bar).
      expect(root).not.toHaveAttribute("role");

      const telemetry = screen.getByTestId("audio-footer-telemetry");
      expect(telemetry).toHaveTextContent("Clock");
      expect(telemetry).toHaveTextContent("12:00");
      expect(screen.getByTestId("clock-icon")).toBeInTheDocument();
      expect(screen.getByTestId("audio-footer-shortcuts")).toBeInTheDocument();
    });

    it("renders the value inside <strong> and the label inside <span>", () => {
      const { container } = render(<HealthBar variant="caption" items={[{ label: "Last sync", value: "synced" }]} />);
      expect(container.querySelector("strong")?.textContent).toBe("synced");
      expect(container.querySelector("span")?.textContent).toBe("Last sync");
    });

    it("renders a bare <kbd> (no full-variant chrome class) in shortcuts", () => {
      render(
        <HealthBar variant="caption" items={[]} hints={[{ kbd: "⌘K", label: "palette" }]} hintsTestId="shortcuts" />
      );
      const kbd = screen.getByTestId("shortcuts").querySelector("kbd");
      expect(kbd?.textContent).toBe("⌘K");
      expect(kbd?.className).toBe("");
    });

    it("places the kbd before or after the label per the kbdAfter flag", () => {
      render(
        <HealthBar
          variant="caption"
          items={[]}
          hints={[
            { kbd: "[", label: "prev" },
            { kbd: "]", label: "next", kbdAfter: true },
          ]}
          hintsTestId="shortcuts"
        />
      );
      const spans = screen.getByTestId("shortcuts").querySelectorAll("span");
      // kbd-before: the kbd element is the first node, text follows.
      expect(spans[0]?.firstChild?.nodeName).toBe("KBD");
      expect(spans[0]?.textContent).toBe("[prev");
      // kbd-after: the label text comes first, kbd is the last node.
      expect(spans[1]?.lastChild?.nodeName).toBe("KBD");
      expect(spans[1]?.textContent).toBe("next]");
    });
  });
});
