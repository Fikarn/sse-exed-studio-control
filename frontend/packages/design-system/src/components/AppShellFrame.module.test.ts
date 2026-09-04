import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 2026-09 audit remediation, Slice 10: the shell header gradient ended in a
// Studio-only literal (#060706) that Bone inherited as a black band, and the
// header action chips carried cream rgba() literals. Every colour in this
// stylesheet must come from a theme token so Graphite and Bone re-theme the
// chrome from themes.css alone.
describe("AppShellFrame.module.css", () => {
  const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "AppShellFrame.module.css");
  const css = readFileSync(cssPath, "utf8");

  it("paints no hex colour literals", () => {
    const literals = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(literals, `hex literals in AppShellFrame.module.css: ${literals.join(", ")}`).toEqual([]);
  });

  it("paints no rgb()/rgba()/hsl() literals", () => {
    const literals = css.match(/\b(?:rgba?|hsla?)\(/g) ?? [];
    expect(literals, `colour-function literals in AppShellFrame.module.css: ${literals.length}`).toEqual([]);
  });

  it("themes the header gradient bottom and the action-chip glass through tokens", () => {
    expect(css).toContain("var(--color-shell-header-bottom)");
    expect(css).toContain("var(--color-shell-action-glass-top)");
    expect(css).toContain("var(--color-shell-action-glass-hover-top)");
  });
});
