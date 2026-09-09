import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Visual overhaul A, Slice 9 (system §6): "Hover changes an edge, never a
// position."
//
// A control that lifts, grows or slides under the pointer makes a dense
// instrument feel loose, and on a touch-driven studio monitor it fires on
// every stray hover. This reads every stylesheet in the design system and the
// app and fails on a `:hover` rule that declares a property which moves the
// element. A press may still move (§6 gives a key press 100 ms), so `:active`
// is not read; nor is `:focus-visible`, whose ring is an edge already.

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [path.resolve(here, ".."), path.resolve(here, "../../../../app/src")];

// The properties that move an element in its own box or out of flow. `margin`
// and the inset properties are here because a hover that nudges a margin is a
// jump by another name.
const MOVING = /(?:^|[\s;{])(transform|translate|scale|rotate|top|left|right|bottom|inset|margin[a-z-]*)\s*:/g;
// A transform that resolves to standing still is not a move.
const STILL = new Set(["none", "translateY(0)", "translateY(0px)", "translateX(0)", "translate(0)", "scale(1)"]);

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "generated") continue;
      out.push(...cssFiles(full));
    } else if (entry.endsWith(".css")) {
      out.push(full);
    }
  }
  return out;
}

/** Every rule in a stylesheet as [selector, block], at-rules flattened. */
function rules(css: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let depth = 0;
  let buffer = "";
  let selector = "";
  for (const character of css) {
    if (character === "{") {
      depth += 1;
      if (depth === 1) {
        selector = buffer.trim();
        buffer = "";
      } else {
        buffer += character;
      }
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        out.push([selector, buffer]);
        buffer = "";
        selector = "";
      } else {
        buffer += character;
      }
    } else {
      buffer += character;
    }
  }
  return out.flatMap(([sel, block]) =>
    sel.startsWith("@") && block.includes("{")
      ? rules(block).map(([inner, innerBlock]): [string, string] => [`${sel} >> ${inner}`, innerBlock])
      : [[sel, block] as [string, string]]
  );
}

function hoverMovers(css: string, file: string): string[] {
  const found: string[] = [];
  for (const [selector, block] of rules(css)) {
    if (!selector.includes(":hover")) continue;
    for (const match of block.matchAll(MOVING)) {
      const property = match[1];
      const end = block.indexOf(";", match.index ?? 0);
      const value = block.slice((match.index ?? 0) + match[0].length, end === -1 ? undefined : end).trim();
      if (STILL.has(value)) continue;
      found.push(`${file}  ${selector.replace(/\s+/g, " ").slice(0, 80)}  ->  ${property}: ${value.slice(0, 40)}`);
    }
  }
  return found;
}

describe("hover changes an edge, never a position (system §6)", () => {
  it("no :hover rule in the design system or the app moves the element", () => {
    const offenders = ROOTS.flatMap((root) =>
      cssFiles(root).flatMap((file) => hoverMovers(readFileSync(file, "utf8"), path.relative(root, file)))
    );
    expect(offenders, `hover must change an edge, not a position:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("reads a rule it should catch, and lets an edge change through", () => {
    expect(hoverMovers(".key:hover { transform: translateY(-1px); }", "x.css")).toHaveLength(1);
    expect(hoverMovers("@layer components { .key:hover { scale: 1.05; } }", "x.css")).toHaveLength(1);
    expect(hoverMovers(".key:hover { border-color: red; box-shadow: 0 0 0 1px red; }", "x.css")).toEqual([]);
    expect(hoverMovers(".key:active { transform: scale(1.05); }", "x.css")).toEqual([]);
    expect(hoverMovers(".key:hover { transform: none; }", "x.css")).toEqual([]);
  });
});
