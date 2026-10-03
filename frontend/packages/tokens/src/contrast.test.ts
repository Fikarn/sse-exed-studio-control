import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Legibility from the token values (docs/DESIGN.md sections 4 and 5), computed
// from `tokens.css` as the browser resolves it. Every ink that carries words
// reads at 4.5:1 on every surface it is printed on (the one surface, a key's
// face, a well, the floating layer and a row under the pointer); a lit fill
// stands 3:1 from the surface around it; every fill's own ink reads at 4.5:1
// on it, and so do the inks on the Dark Green title plate. One theme, Studio.

const here = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(path.join(here, "generated", "tokens.css"), "utf8");

type Rgba = [number, number, number, number];

function declarations(css: string, selector: string) {
  const out: Record<string, string> = {};
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "g");
  for (const match of css.matchAll(re)) {
    for (const decl of match[1]!.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[decl[1]!] = decl[2]!.trim();
  }
  return out;
}

const vars = declarations(tokensCss, ":root");

function resolve(value: string, depth = 0): string {
  if (depth > 10) throw new Error(`token reference too deep: ${value}`);
  return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
    const next = vars[name];
    if (next === undefined) throw new Error(`unresolved token ${name}`);
    return resolve(next, depth + 1);
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

const colour = (name: string) => parse(resolve(`var(${name})`));
function textOn(textName: string, surfaceName: string) {
  const surface = colour(surfaceName);
  return ratio(over(colour(textName), surface), surface);
}

const SURFACES = ["--material-bg", "--material-key", "--material-well", "--material-raise", "--material-hover"];
const INKS = [
  "--text-text",
  "--text-text2",
  "--text-text3",
  "--role-green-text",
  "--role-yellow-text",
  "--role-coral-text",
  "--role-blue-text",
];

describe("legibility from the token values", () => {
  it("every ink that carries words reads at 4.5:1 on every surface", () => {
    for (const ink of INKS) {
      for (const surface of SURFACES) {
        // Blue is information on the page and its wells; it is never printed
        // in a floating layer's row under the pointer.
        if (ink === "--role-blue-text" && surface === "--material-hover") continue;
        expect(textOn(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("a lit fill stands 3:1 from the surface and the key's face around it", () => {
    for (const fill of ["--role-green-fill", "--role-yellow-fill", "--role-primary-fill"]) {
      for (const surface of ["--material-bg", "--material-key"]) {
        expect(ratio(colour(fill), colour(surface)), `${fill} vs ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("every fill's own ink reads at 4.5:1 on it", () => {
    for (const role of ["green", "yellow", "coral", "burgundy", "primary"]) {
      expect(textOn(`--role-${role}-ink`, `--role-${role}-fill`), `${role} ink on its fill`).toBeGreaterThanOrEqual(
        4.5
      );
    }
  });

  it("the title plate's inks read at 4.5:1 on Dark Green", () => {
    for (const ink of ["--text-text", "--text-text2", "--sse-beige"]) {
      expect(textOn(ink, "--sse-dark-green"), `${ink} on Dark Green`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the tooltip's black ink reads at 4.5:1 on Beige", () => {
    expect(textOn("--sse-black", "--sse-beige")).toBeGreaterThanOrEqual(4.5);
  });

  it("every colour token resolves to the palette or to its own value, never a second copy of a palette colour", () => {
    const palette = new Map(
      Object.entries(vars)
        .filter(([name]) => name.startsWith("--sse-"))
        .map(([name, value]) => [value.toLowerCase(), name])
    );
    // The glass is the presenter's picture, outside the visual system: its
    // black is the glass's own, whatever the palette's black becomes.
    const copies = Object.entries(vars)
      .filter(([name]) => !name.startsWith("--sse-") && !name.startsWith("--prompter-glass-"))
      .filter(([, value]) => palette.has(value.toLowerCase()))
      .map(([name, value]) => `${name}: ${value} (is ${palette.get(value.toLowerCase())})`);
    expect(copies).toEqual([]);
  });
});
