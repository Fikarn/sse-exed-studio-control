import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// 2026-09 audit remediation, Slice 10: the shell header gradient ended in a
// Studio-only literal (#060706) that Bone inherited as a black band, and the
// header action chips carried cream rgba() literals. Every colour in this
// stylesheet must come from a token so the chrome has one source. Visual
// overhaul A, Slice 2: every chrome height is a chrome token. Visual overhaul
// 2026-10 (Atrium): the chrome is one flat surface (the base) parted by
// hairlines; the header's plate gradient and the bay's recess are gone.
describe("AppShellFrame.module.css", () => {
  const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "AppShellFrame.module.css");
  const css = readFileSync(cssPath, "utf8");
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

  it("paints no hex colour literals", () => {
    const literals = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(literals, `hex literals in AppShellFrame.module.css: ${literals.join(", ")}`).toEqual([]);
  });

  it("paints no rgb()/rgba()/hsl() literals", () => {
    const literals = css.match(/\b(?:rgba?|hsla?)\(/g) ?? [];
    expect(literals, `colour-function literals in AppShellFrame.module.css: ${literals.length}`).toEqual([]);
  });

  it("themes the surface, its hairlines and the chrome heights through the tokens", () => {
    expect(css).toContain("var(--material-bg)");
    expect(css).toContain("var(--material-line)");
    expect(css).toContain("var(--chrome-studio-header)");
    expect(css).toContain("var(--chrome-studio-cluster)");
    expect(css).toContain("var(--chrome-studio-plate)");
  });

  it("sets the product name in SSE Adelia capitals, the eyebrow and the clock in PT Sans", () => {
    expect(code).toMatch(
      /\.product \{[^}]*var\(--font-size-word\) \/ 1 var\(--font-family-display\)[^}]*text-transform: uppercase/
    );
    expect(code).toMatch(
      /\.eyebrow \{[^}]*var\(--font-size-label\)[^}]*var\(--font-family-ui\)[^}]*color: var\(--text-text3\)/
    );
    expect(code).toMatch(/\.clock \{[^}]*var\(--font-family-ui\)/);
  });

  it("is flat: no gradient, no shadow, no backdrop blur, no retired plate material", () => {
    expect(code).not.toMatch(/gradient\(/);
    expect(code).not.toMatch(/box-shadow\s*:/);
    expect(code).not.toMatch(/backdrop-filter\s*:/);
    expect(code).not.toMatch(/var\(--(?:material-panel|material-bay|elevation-)/);
  });
});
