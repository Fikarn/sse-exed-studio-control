import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { LevelBar, usedPercent } from "../LevelBar";

// The Session page's step 2 (D52; board 3): how full a drive is, a 6 px well
// in the pill's shape filled for the share used, in the drive's tone.

const css = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "LevelBar.module.css"), "utf8");

describe("LevelBar", () => {
  it("is a meter that says its drive and the share used", () => {
    render(<LevelBar used={1 - 2_200_414_797_824 / 4_096_787_476_480} label="Storage 1 (D:)" testId="disk-bar" />);
    const bar = screen.getByRole("meter", { name: "Storage 1 (D:): 46 % used" });
    expect(bar).toBe(screen.getByTestId("disk-bar"));
    expect(bar).toHaveAttribute("aria-valuenow", "46");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar.style.getPropertyValue("--level-bar-used")).toMatch(/^0\.46/);
  });

  it("takes the drive's tone: quiet while there is room, attention when low, error when nearly full", () => {
    const { rerender } = render(<LevelBar used={0.46} label="Storage 1 (D:)" testId="disk-bar" />);
    const bar = () => screen.getByTestId("disk-bar");
    expect(bar()).toHaveAttribute("data-tone", "quiet");
    expect(bar().className).not.toMatch(/attention|error/);
    rerender(<LevelBar used={0.963} tone="attention" label="Storage 1 (D:)" testId="disk-bar" />);
    expect(bar()).toHaveAttribute("data-tone", "attention");
    expect(bar().className).toMatch(/attention/);
    rerender(<LevelBar used={0.993} tone="error" label="Storage 1 (D:)" testId="disk-bar" />);
    expect(bar()).toHaveAttribute("data-tone", "error");
    expect(bar().className).toMatch(/error/);
  });

  // The share it fills and says stays between empty and full, and it says
  // 100 % only when the drive is full and 0 % only when nothing is used.
  it("holds its share between empty and full", () => {
    expect(usedPercent(0)).toBe(0);
    expect(usedPercent(0.001)).toBe(1);
    expect(usedPercent(0.463)).toBe(46);
    expect(usedPercent(0.996)).toBe(99);
    expect(usedPercent(1)).toBe(100);
    for (const [used, filled, percent] of [
      [-0.2, "0", "0"],
      [1.4, "1", "100"],
      [Number.NaN, "0", "0"],
    ] as const) {
      const { unmount } = render(<LevelBar used={used} label="Public (Z:)" testId="share-bar" />);
      const bar = screen.getByTestId("share-bar");
      expect(bar.style.getPropertyValue("--level-bar-used")).toBe(filled);
      expect(bar).toHaveAttribute("aria-valuenow", percent);
      unmount();
    }
  });

  // A 6 px well at the pill's radius, its edge a hairline; the fill in the
  // ticks' ink at rest and a lamp's yellow or coral, through tokens alone.
  it("is drawn in the system's tokens", () => {
    expect(css).toMatch(
      /\.levelBar \{[^}]*height: 6px;[^}]*border: 1px solid var\(--material-line\);[^}]*border-radius: var\(--radius-pill\);[^}]*background: var\(--material-well\);/
    );
    expect(css).toMatch(/\.fill \{[^}]*border-radius: var\(--radius-pill\);[^}]*background: var\(--text-text4\);/);
    expect(css).toMatch(/\.attention \.fill \{\s*background: var\(--role-yellow-text\);/);
    expect(css).toMatch(/\.error \.fill \{\s*background: var\(--role-coral-text\);/);
    expect(css).not.toMatch(/transition|animation|#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
