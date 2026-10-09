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

  it("themes the surface, the raised layer, its lines and the chrome heights through the tokens", () => {
    expect(css).toContain("var(--material-bg)");
    expect(css).toContain("var(--material-line)");
    expect(css).toContain("var(--material-bar)");
    expect(css).toContain("var(--material-bar-line)");
    expect(css).toContain("var(--material-platter)");
    expect(css).toContain("var(--radius-panel)");
    expect(css).toContain("var(--chrome-studio-header)");
    expect(css).toContain("var(--chrome-studio-cluster)");
    expect(css).toContain("var(--chrome-studio-plate)");
  });

  // The skylight (D48): the logotype first, at the frame's margin, with half
  // its height clear before the rule; no product name in the header (it ends
  // the footer); the clock in PT Sans at the right margin.
  it("sets the logotype first with its clear space, no product name, and the clock in PT Sans", () => {
    expect(code).toMatch(/\.rule \{[^}]*width: 1px[^}]*margin: 0 20px/);
    expect(code).not.toMatch(/\.product\b/);
    expect(code).not.toMatch(/\.eyebrow\b/);
    expect(code).toMatch(/\.clock \{[^}]*var\(--font-family-ui\)/);
  });

  it("keeps the frame's margin at both of the header's sides and none in the bay", () => {
    expect(code).toMatch(/\.header \{[^}]*padding: 0 calc\(var\(--chrome-studio-margin\)/);
    expect(code).toMatch(/\.bay \{[^}]*\}/);
    expect(code.match(/\.bay \{[^}]*\}/)?.[0]).not.toMatch(/padding/);
  });

  // The raised layer is flat too: depth from a lighter surface and a light
  // edge, never a gradient or a cast shadow.
  it("is flat: no gradient, no shadow but a platter's light edge, no backdrop blur, no retired plate material", () => {
    expect(code).not.toMatch(/gradient\(/);
    const shadows = code.match(/box-shadow\s*:[^;]*;/g) ?? [];
    expect(shadows).toEqual(["box-shadow: var(--elevation-edge-light);"]);
    expect(code).not.toMatch(/backdrop-filter\s*:/);
    expect(code).not.toMatch(/var\(--(?:material-panel|material-bay)/);
    expect(code.match(/var\(--elevation-[a-z-]+\)/g)).toEqual(["var(--elevation-edge-light)"]);
  });
});
