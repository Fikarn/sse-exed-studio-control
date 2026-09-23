import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Visual overhaul A, Slice 0 — the literal scan (non-negotiable 1: the design
// system and tokens are the only vehicle). Every `*.module.css` under the app
// and the design system is scanned for colour, font-size, radius and
// box-shadow literals that bypass the tokens. The counts per file are a
// ratchet in `css-literals.allowlist.json`, seeded at the current program's
// numbers and tightened per slice: a file may not gain a literal, and a file
// not in the allowlist may carry none. Re-seed at a slice close with
// `UPDATE_CSS_LITERALS=1 npx vitest run css-literals` and inspect the diff.

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, "../../../..");
const ROOTS = [path.join(FRONTEND, "app", "src"), path.join(FRONTEND, "packages", "design-system", "src")];
const ALLOWLIST_PATH = path.join(here, "css-literals.allowlist.json");

type Category = "colour" | "fontSize" | "radius" | "shadow";
type Counts = Record<Category, number>;

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".module.css")) out.push(full);
  }
  return out;
}

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const declarations = (css: string, property: string) =>
  [...css.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, "g"))].map((m) => m[1]!.trim());

export function countLiterals(css: string): Counts {
  const clean = stripComments(css);
  const colour =
    (clean.match(/#[0-9a-fA-F]{3,8}\b/g)?.length ?? 0) + (clean.match(/\b(?:rgba?|hsla?)\(/g)?.length ?? 0);
  const literalValue = (value: string) => !/^var\(/.test(value) && !/^(none|inherit|initial|unset|0)$/.test(value);
  return {
    colour,
    fontSize: declarations(clean, "font-size").filter(literalValue).length,
    radius: declarations(clean, "border-radius").filter(literalValue).length,
    shadow: declarations(clean, "box-shadow").filter(literalValue).length,
  };
}

describe("CSS module literals", () => {
  const files = ROOTS.flatMap((root) => walk(root));
  const measured: Record<string, Counts> = {};
  for (const file of files) {
    const counts = countLiterals(readFileSync(file, "utf8"));
    if (Object.values(counts).some((n) => n > 0))
      measured[path.relative(FRONTEND, file).split(path.sep).join("/")] = counts;
  }

  if (process.env.UPDATE_CSS_LITERALS) {
    const ordered = Object.fromEntries(
      Object.keys(measured)
        .sort()
        .map((k) => [k, measured[k]])
    );
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(ordered, null, 2) + "\n");
  }

  const allowlist: Record<string, Counts> = existsSync(ALLOWLIST_PATH)
    ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
    : {};

  it("scans the app and design-system stylesheets", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("no stylesheet carries more literals than its allowlist entry", () => {
    const over: string[] = [];
    for (const [file, counts] of Object.entries(measured)) {
      const allowed = allowlist[file] ?? { colour: 0, fontSize: 0, radius: 0, shadow: 0 };
      for (const category of Object.keys(counts) as Category[]) {
        if (counts[category] > allowed[category])
          over.push(`${file}: ${category} ${counts[category]} > ${allowed[category]}`);
      }
    }
    expect(over, "literals grew — move the value into a token or tighten only downwards").toEqual([]);
  });

  it("the allowlist names only stylesheets that still exist", () => {
    const stale = Object.keys(allowlist).filter((file) => !existsSync(path.join(FRONTEND, file)));
    expect(stale).toEqual([]);
  });

  it("reports the seed totals", () => {
    const totals: Counts = { colour: 0, fontSize: 0, radius: 0, shadow: 0 };
    for (const counts of Object.values(measured))
      for (const category of Object.keys(totals) as Category[]) totals[category] += counts[category];
    expect(totals.colour + totals.fontSize + totals.radius + totals.shadow).toBeGreaterThanOrEqual(0);
    // Seed 2026-09-07 (S0): colour 149 · font-size 119 · radius 81 · box-shadow 115 across 59 files.
  });
});
