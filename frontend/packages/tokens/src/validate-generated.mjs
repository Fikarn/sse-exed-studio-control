import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const required = ["generated/tokens.css", "generated/tokens.ts"];

for (const relativePath of required) {
  if (!existsSync(path.join(packageDir, relativePath))) {
    throw new Error(`Missing generated token artifact: ${relativePath}`);
  }
}

// Visual overhaul A, Slice 1: the generated CSS must carry every A family
// (one representative per family) and themes.css must re-map the material
// and the role text variants for Graphite and Bone. A stale build after a
// core.json edit fails here before it reaches a render.
const css = readFileSync(path.join(packageDir, "generated/tokens.css"), "utf8");
const A_FAMILIES = [
  "--material-bg",
  "--material-well-shade",
  "--material-strip-floor",
  "--text-text2",
  "--accent",
  "--role-amber-fill",
  "--role-green-bloom",
  "--role-red-text",
  "--role-blue-text",
  "--role-primary-ink",
  "--role-cap-fill2",
  "--display-text",
  "--display-bloom-amber",
  "--signal-meter-low",
  "--signal-cct-track",
  "--font-size-tick",
  "--font-size-hero",
  "--font-tracking-cap",
  "--radius-ctl",
  "--radius-key",
  "--radius-screen",
  "--chrome-studio-header",
  "--chrome-studio-state-display",
  "--elevation-key",
  "--elevation-float",
  "--motion-duration-press",
  "--motion-easing-mech",
  "--target-take",
  "--audio-console-bg",
  "--audio-console-housing-shadow",
];
const missing = A_FAMILIES.filter((name) => !css.includes(`${name}:`));
if (missing.length) {
  throw new Error(`Generated tokens.css lacks A tokens: ${missing.join(", ")} — run npm run frontend:tokens:build`);
}
// The deprecated aliases resolve through var() so the value has one source.
for (const alias of ["--font-size-sm: var(--font-size-tick)", "--radius-tight-sm: var(--radius-ctl)"]) {
  if (!css.includes(alias)) throw new Error(`Generated tokens.css lacks the alias ${alias}`);
}

const themes = readFileSync(path.join(packageDir, "themes.css"), "utf8");
for (const theme of ["graphite", "bone"]) {
  const start = themes.lastIndexOf(`:root[data-theme="${theme}"] {`);
  const body = themes.slice(start, themes.indexOf("}", start));
  for (const name of [
    "--material-bg",
    "--material-well",
    "--text-text2",
    "--accent",
    "--role-green-text",
    "--audio-console-bg",
  ]) {
    if (!body.includes(`${name}:`)) throw new Error(`themes.css ${theme} block lacks ${name}`);
  }
}
if (!themes.includes("[data-well]")) throw new Error("themes.css lacks the .well / [data-well] display-ink scope");

console.log("Token generated artifacts are present and carry the A families.");
