// ui-census.mjs — the human-readable UI census of the program (visual
// overhaul A, Slice 0), from the same code path as `tests/ui-contract.spec.ts`.
//
//   node scripts/ui-census.mjs [--out DIR] [--base URL] [--fixtures a,b] [--themes studio,bone] [--write-ratchets]
//
// Renders every fixture at 2560×1440 in three themes against the built app
// (`dist`, served by `vite preview` on 4173 — started here when nothing
// answers, the same server the Playwright specs use), writes one PNG + JSON per
// board under `artifacts/ui-census/` (git-ignored; Playwright wipes `test-results/`),
// `census.md` (the tables of the write-ups) and `contrast.md` (the
// pixel-sampled failures per board), and with `--write-ratchets` re-seeds
// `tests/ui-contract.ratchets.json` at the current numbers. Run from
// `frontend/app` after `npm run build --workspace frontend/app`.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { FIXTURES, SURFACE, THEMES, boardName } from "../tests/helpers/ui-contract/boards.mjs";
import { measureBoard, openBoard, ratchetFrom } from "../tests/helpers/ui-contract/measure.mjs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) {
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next && !next.startsWith("--") ? next : "1";
  }
}
const BASE = args.base || "http://127.0.0.1:4173";
const OUT = path.resolve(args.out || path.join(APP_DIR, "..", "..", "artifacts", "ui-census"));
const fixtures = args.fixtures ? args.fixtures.split(",") : FIXTURES;
const themes = args.themes ? args.themes.split(",") : THEMES;
const RATCHET_PATH = path.join(APP_DIR, "tests", "ui-contract.ratchets.json");
fs.mkdirSync(OUT, { recursive: true });

async function reachable(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

let server = null;
if (!(await reachable(BASE))) {
  if (args.base) throw new Error(`${BASE} does not answer`);
  if (!fs.existsSync(path.join(APP_DIR, "dist", "index.html")))
    throw new Error("frontend/app/dist is missing: run `npm run build --workspace frontend/app` first");
  server = spawn("npm", ["run", "preview", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"], {
    cwd: APP_DIR,
    shell: process.platform === "win32",
    stdio: "ignore",
  });
  const started = Date.now();
  while (!(await reachable(BASE))) {
    if (Date.now() - started > 30_000) throw new Error("vite preview did not start on 4173");
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch();
const rows = [];
const contrastLines = ["## Pixel-sampled contrast per board (text ≥ 4.5:1, ≥ 3:1 when large; disabled exempt)", ""];
const ratchets = fs.existsSync(RATCHET_PATH) ? JSON.parse(fs.readFileSync(RATCHET_PATH, "utf8")) : {};
try {
  for (const theme of themes) {
    for (const fixture of fixtures) {
      const name = boardName(fixture, theme);
      const context = await browser.newContext({
        baseURL: BASE,
        viewport: { width: SURFACE.width, height: SURFACE.height },
        deviceScaleFactor: 1,
        colorScheme: theme === "bone" ? "light" : "dark",
        timezoneId: "Europe/Stockholm",
      });
      const page = await context.newPage();
      try {
        await openBoard(page, fixture, theme);
        const { census, contrast, png, measures } = await measureBoard(page);
        fs.writeFileSync(path.join(OUT, `${name}.png`), png);
        fs.writeFileSync(
          path.join(OUT, `${name}.json`),
          JSON.stringify({ name, fixture, theme, measures, contrast, census })
        );
        rows.push({ name, ...measures });
        ratchets[name] = ratchetFrom(measures);
        contrastLines.push(
          `- **${name}**: ${contrast.fails.length} failing of ${contrast.measured} measured text nodes`
        );
        for (const f of contrast.fails.slice(0, 20))
          contrastLines.push(`  - ${f.ratio}:1 ${f.size}px w${f.weight} "${f.text}" ${f.el} fg ${f.color} bg ${f.bg}`);
        console.log(
          name.padEnd(40),
          `text=${measures.text} sizes=${measures.sizeCount} min=${measures.minFontSize} small<24=${measures.smallTargets} radiiOff=${measures.radiiOff} contrast=${measures.contrastFails}/${measures.contrastMeasured} shadows=${measures.shadows} neg=${measures.shadowNegative} blur>8=${measures.blurOver8} grad=${measures.gradients} anim=${measures.runningAnimations} scroll=${measures.scroll} off=${measures.offViewport} copy=${measures.copyHits}`
        );
      } catch (error) {
        console.log("FAIL", name, String(error).slice(0, 300));
        rows.push({ name, error: String(error).slice(0, 120) });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  if (server) server.kill();
}

const md = [
  `## UI census (per board, ${SURFACE.label}, 1:1)`,
  "",
  "| board | text | sizes (px:count) | min | upper | families | ≥700 | targets | <24 | min | take | take<28 | radii off | contrast fails / measured | shadows | neg-offset | blur>8 (unlit) | gradients (off) | backdrop | anim | css-anim | transitions | scroll | off-viewport | regions | copy hits |",
  "| --- | ---: | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |",
];
for (const r of rows) {
  if (r.error) {
    md.push(`| ${r.name} | capture failed: ${r.error} |`);
    continue;
  }
  md.push(
    `| ${r.name} | ${r.text} | ${r.fontSizes} | ${r.minFontSize} | ${r.uppercase} | ${r.families} | ${r.bold} | ${r.targets} | ${r.smallTargets} | ${r.minTarget} | ${r.take} | ${r.smallTake} | ${r.radiiOff} | ${r.contrastFails} / ${r.contrastMeasured} | ${r.shadows} | ${r.shadowNegative} | ${r.blurOver8} (${r.blurOver8Unlit}) | ${r.gradients} (${r.gradientsOff}) | ${r.backdropBlur} | ${r.runningAnimations} | ${r.cssAnimated} | ${r.transitions} | ${r.scroll}${r.scrolls ? " SCROLLS" : ""} | ${r.offViewport} | ${r.regionsPresent}${r.regionsOff.length ? " off: " + r.regionsOff.join(", ") : ""} | ${r.copyHits} |`
  );
}
fs.writeFileSync(path.join(OUT, "census.md"), md.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "contrast.md"), contrastLines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "census.json"), JSON.stringify(rows, null, 1));
console.log("\nwrote", path.join(OUT, "census.md"));
if (args["write-ratchets"]) {
  const ordered = Object.fromEntries(
    Object.keys(ratchets)
      .sort()
      .map((k) => [k, ratchets[k]])
  );
  fs.writeFileSync(RATCHET_PATH, JSON.stringify(ordered, null, 2) + "\n");
  console.log("wrote", RATCHET_PATH);
}
