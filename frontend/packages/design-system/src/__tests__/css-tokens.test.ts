import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Two guards on how the pages read the tokens (docs/DESIGN.md section 10).
//
// 1. Every custom property a stylesheet or a component reads is declared
//    somewhere: in the tokens, in a stylesheet, or set by a component. A
//    renamed token fails silently in CSS (the declaration is dropped); this
//    fails it here instead.
// 2. Deprecated tokens (core.json marks them) are a ratchet: a file may not
//    read more of them than `deprecated-tokens.allowlist.json` says, and a file
//    not listed may read none. The page pull requests of the visual overhaul
//    retire them. Re-seed with `UPDATE_DEPRECATED_TOKENS=1 npx vitest run
//    css-tokens` and look at the diff: it may only go down.

const here = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(here, "../../../..");
const ROOTS = [path.join(FRONTEND, "app", "src"), path.join(FRONTEND, "packages", "design-system", "src")];
const TOKENS_CSS = path.join(FRONTEND, "packages", "tokens", "src", "generated", "tokens.css");
const CORE_JSON = path.join(FRONTEND, "packages", "tokens", "src", "tokens", "core.json");
const ALLOWLIST_PATH = path.join(here, "deprecated-tokens.allowlist.json");

const isTest = (file: string) =>
  /\.(test|spec|stories)\.tsx?$/.test(file) || file.includes(`${path.sep}__tests__${path.sep}`);

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(css|tsx?)$/.test(entry) && !isTest(full)) out.push(full);
  }
  return out;
}

const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const rel = (file: string) => path.relative(FRONTEND, file).split(path.sep).join("/");

const files = ROOTS.flatMap((root) => walk(root));
const sources = new Map(files.map((file) => [file, stripComments(readFileSync(file, "utf8"))]));

/** Names a file declares: `--x:` in CSS; `"--x"`, `'--x'` or `` `--x` `` as a style key or setProperty in TS. */
function declared(file: string, text: string) {
  const names = new Set<string>();
  if (file.endsWith(".css")) {
    for (const m of text.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) names.add(m[1]!);
  } else {
    for (const m of text.matchAll(/["'`](--[a-zA-Z0-9_-]+)["'`]/g)) names.add(m[1]!);
  }
  return names;
}

/** Names a file reads with var(). */
function read(text: string) {
  return [...text.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)].map((m) => m[1]!);
}

/** Token names core.json marks deprecated, by itself or by its group. */
function deprecatedTokens() {
  const out = new Set<string>();
  const kebab = (segment: string) => segment.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
  const visit = (node: Record<string, unknown>, trail: string[], inherited: boolean) => {
    const own = typeof node.$description === "string" && /^deprecated/i.test(node.$description);
    if ("$value" in node) {
      if (inherited || own) out.add(`--${trail.map(kebab).join("-")}`);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$") || typeof child !== "object" || child === null) continue;
      visit(child as Record<string, unknown>, [...trail, key], inherited || own);
    }
  };
  visit(JSON.parse(readFileSync(CORE_JSON, "utf8")), [], false);
  return out;
}

describe("how the pages read the tokens", () => {
  const tokens = declared(TOKENS_CSS, readFileSync(TOKENS_CSS, "utf8"));
  const everywhere = new Set(tokens);
  for (const [file, text] of sources) for (const name of declared(file, text)) everywhere.add(name);

  it("scans the app and the design system", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(tokens.size).toBeGreaterThan(200);
  });

  it("every custom property read is declared somewhere", () => {
    const undeclared: string[] = [];
    for (const [file, text] of sources) {
      for (const name of new Set(read(text))) if (!everywhere.has(name)) undeclared.push(`${rel(file)}: ${name}`);
    }
    expect(undeclared, "a var() names a custom property nothing declares — a renamed or retired token?").toEqual([]);
  });

  const deprecated = deprecatedTokens();
  const measured: Record<string, number> = {};
  for (const [file, text] of sources) {
    const count = read(text).filter((name) => deprecated.has(name)).length;
    if (count > 0) measured[rel(file)] = count;
  }
  if (process.env.UPDATE_DEPRECATED_TOKENS) {
    const ordered = Object.fromEntries(
      Object.keys(measured)
        .sort()
        .map((key) => [key, measured[key]])
    );
    writeFileSync(ALLOWLIST_PATH, JSON.stringify(ordered, null, 2) + "\n");
  }
  const allowlist: Record<string, number> = existsSync(ALLOWLIST_PATH)
    ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
    : {};

  it("knows the deprecated tokens", () => {
    expect(deprecated.has("--material-panel-top")).toBe(true);
    expect(deprecated.has("--color-background-950")).toBe(true);
    expect(deprecated.has("--material-bg")).toBe(false);
  });

  it("no file reads more deprecated tokens than its allowlist entry", () => {
    const over = Object.entries(measured)
      .filter(([file, count]) => count > (allowlist[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} > ${allowlist[file] ?? 0}`);
    expect(over, "a deprecated token gained a reader — use its replacement (core.json says which)").toEqual([]);
  });

  it("the allowlist names only files that still exist", () => {
    expect(Object.keys(allowlist).filter((file) => !existsSync(path.join(FRONTEND, file)))).toEqual([]);
  });
});
