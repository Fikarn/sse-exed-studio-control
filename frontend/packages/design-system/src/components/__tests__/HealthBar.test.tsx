import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HealthBar, type HealthBarItemData } from "../HealthBar";

// Slice 5 (CHROME-02): the HealthBar is the single footer primitive for every
// surface. The `full` variant (Lighting, Setup) is a 64px status bar; the
// `caption` variant (Audio) is a thin telemetry <footer> strip. These tests
// lock the structural contract both variants depend on — including the icon
// and testid-passthrough props — so a future edit can't silently regress the
// byte-identical Audio footer or the Lighting full bar. New pages program,
// Slice 3 (D6): the key-hint slot went with the keys, so neither variant
// prints a <kbd>.

const ITEMS: HealthBarItemData[] = [
  { label: "Bridge", value: "192.168.1.10", dot: "ok" },
  { label: "Fixtures", value: "4 / 4" },
];

describe("HealthBar", () => {
  describe("full variant (default)", () => {
    it("renders a status div with items as direct children and actions, and no key hint", () => {
      render(<HealthBar items={ITEMS} actions={<button type="button">toggle</button>} />);
      const bar = screen.getByRole("status", { name: "Workspace health" });
      expect(bar.tagName).toBe("DIV");
      expect(bar).toHaveTextContent("Bridge");
      expect(bar).toHaveTextContent("192.168.1.10");
      expect(bar.querySelector("kbd")).toBeNull();
      expect(screen.getByRole("button", { name: "toggle" })).toBeInTheDocument();
    });

    it("forwards the testid prop onto the root", () => {
      render(<HealthBar items={ITEMS} testId="lighting-health-bar" />);
      expect(screen.getByTestId("lighting-health-bar").tagName).toBe("DIV");
    });
  });

  describe("caption variant", () => {
    it("renders a <footer> with the telemetry container keyed by testid", () => {
      render(
        <HealthBar
          variant="caption"
          items={[{ icon: <svg data-testid="clock-icon" />, label: "Clock", value: "12:00" }]}
          testId="audio-health-bar"
          itemsTestId="audio-footer-telemetry"
        />
      );
      const root = screen.getByTestId("audio-health-bar");
      expect(root.tagName).toBe("FOOTER");
      // The caption <footer> carries no role/aria-label (unlike the full bar).
      expect(root).not.toHaveAttribute("role");
      expect(root.querySelector("kbd")).toBeNull();

      const telemetry = screen.getByTestId("audio-footer-telemetry");
      expect(telemetry).toHaveTextContent("Clock");
      expect(telemetry).toHaveTextContent("12:00");
      expect(screen.getByTestId("clock-icon")).toBeInTheDocument();
    });

    it("renders the value inside <strong> and the label inside <span>", () => {
      const { container } = render(<HealthBar variant="caption" items={[{ label: "Last sync", value: "synced" }]} />);
      expect(container.querySelector("strong")?.textContent).toBe("synced");
      expect(container.querySelector("span")?.textContent).toBe("Last sync");
    });
  });

  describe("presence marker", () => {
    it("carries the inert data-health-bar attribute on both variant roots", () => {
      // GLO-11 (S12): the app's toast stack keys its bottom offset on
      // `html:not(:has([data-health-bar]))` — if this marker disappears,
      // toasts dock at the true edge UNDER the mounted bar.
      const { unmount } = render(<HealthBar items={ITEMS} testId="full-bar" />);
      expect(screen.getByTestId("full-bar")).toHaveAttribute("data-health-bar");
      unmount();

      render(<HealthBar variant="caption" items={ITEMS} testId="caption-bar" />);
      expect(screen.getByTestId("caption-bar")).toHaveAttribute("data-health-bar");
    });
  });
});
