import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Visual overhaul A, Slice 1 — the themes' legibility from the token values
// (system §4, plan S1 gate): in every theme, `text2` reads at 4.5:1 on bg,
// panel and key, and (as the display ink) on the well; every role text reads
// at 4.5:1 on bg and panel; every display ink reads at 4.5:1 on the well; and
// a lit fill's edge, drawn with the theme's stronger hairline, stands 3:1
// from the plate and the key around it. Computed from `tokens.css` (Studio)
// and `themes.css` (Graphite, Bone) exactly as the browser would resolve them.

const here = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(path.join(here, "generated", "tokens.css"), "utf8");
const themesCss = readFileSync(path.join(here, "themes.css"), "utf8");

type Rgba = [number, number, number, number];

function declarations(css: string, selector: string, occurrence: "first" | "all" = "all") {
  const out: Record<string, string> = {};
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  for (const match of css.matchAll(re)) {
    for (const decl of match[1]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[decl[1]!] = decl[2]!.trim();
    if (occurrence === "first") break;
  }
  return out;
}

const studio = declarations(tokensCss, ":root");
const themes: Record<string, Record<string, string>> = {
  studio,
  graphite: { ...studio, ...declarations(themesCss, ':root[data-theme="graphite"]') },
  bone: { ...studio, ...declarations(themesCss, ':root[data-theme="bone"]') },
};
const wellOverrides: Record<string, Record<string, string>> = {
  studio: declarations(themesCss, ".well,\n[data-well]"),
  graphite: declarations(themesCss, ".well,\n[data-well]"),
  bone: {
    ...declarations(themesCss, ".well,\n[data-well]"),
    ...declarations(themesCss, ':root[data-theme="bone"] .well,\n:root[data-theme="bone"] [data-well]'),
  },
};

function resolve(vars: Record<string, string>, value: string, depth = 0): string {
  if (depth > 10) throw new Error(`token reference too deep: ${value}`);
  return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
    const next = vars[name];
    if (next === undefined) throw new Error(`unresolved token ${name}`);
    return resolve(vars, next, depth + 1);
  });
}

function parse(value: string): Rgba {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4, 6), 16), 1];
  m = v.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/);
  if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]!];
  throw new Error(`cannot parse colour ${value}`);
}

const over = (top: Rgba, bottom: Rgba): Rgba => [
  top[0] * top[3] + bottom[0] * (1 - top[3]),
  top[1] * top[3] + bottom[1] * (1 - top[3]),
  top[2] * top[3] + bottom[2] * (1 - top[3]),
  1,
];
const luminance = ([r, g, b]: Rgba) => {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: Rgba, b: Rgba) => {
  const la = luminance(a);
  const lb = luminance(b);
  return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
};

function colour(vars: Record<string, string>, name: string) {
  return parse(resolve(vars, `var(${name})`));
}
function textOn(vars: Record<string, string>, textName: string, surfaceName: string) {
  const surface = colour(vars, surfaceName);
  return ratio(over(colour(vars, textName), surface), surface);
}

describe("A themes — legibility from the token values", () => {
  for (const [theme, vars] of Object.entries(themes)) {
    describe(theme, () => {
      it("text2 reads at 4.5:1 on bg, panel and key", () => {
        for (const surface of ["--material-bg", "--material-panel", "--material-key"]) {
          expect(textOn(vars, "--text-text2", surface), `${theme} text2 on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("every role text reads at 4.5:1 on bg and panel", () => {
        for (const role of ["amber", "green", "red", "blue"]) {
          for (const surface of ["--material-bg", "--material-panel"]) {
            expect(
              textOn(vars, `--role-${role}-text`, surface),
              `${theme} ${role} text on ${surface}`
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it("the display inks read at 4.5:1 on the well", () => {
        const well = { ...vars, ...wellOverrides[theme] };
        for (const ink of [
          "--display-text",
          "--display-text2",
          "--role-green-text",
          "--role-amber-text",
          "--role-red-text",
          "--role-blue-text",
        ]) {
          expect(textOn(well, ink, "--material-well"), `${theme} ${ink} on the well`).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("a lit fill's hairline edge stands 3:1 from the plate and the key", () => {
        const line2 = colour(vars, "--material-line2");
        for (const role of ["amber", "green", "red"]) {
          const edge = over(line2, colour(vars, `--role-${role}-fill`));
          for (const surface of ["--material-panel", "--material-key"]) {
            expect(
              ratio(edge, colour(vars, surface)),
              `${theme} ${role} fill edge vs ${surface}`
            ).toBeGreaterThanOrEqual(3);
          }
        }
      });

      it("a role ink reads at 4.5:1 on its own fill", () => {
        for (const role of ["amber", "green", "red", "primary"]) {
          expect(
            textOn(vars, `--role-${role}-ink`, `--role-${role}-fill`),
            `${theme} ${role} ink on fill`
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }
});
