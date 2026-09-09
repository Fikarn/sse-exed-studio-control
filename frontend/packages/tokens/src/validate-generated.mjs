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
// Visual overhaul A, Slice 11: the deprecated aliases are gone. This used to
// assert that each still resolved through var() so the value had one source;
// now it asserts the opposite — that nothing re-introduces a second name for a
// size, a radius or a duration the A scale already names.
for (const gone of [
  "--font-size-sm:",
  "--font-size-md:",
  "--font-size-md-tight:",
  "--font-size-lg:",
  "--font-size-lg-tight:",
  "--font-size-xl:",
  "--radius-sm:",
  "--radius-tight-sm:",
  "--radius-tight-lg:",
  "--radius-tight-xl:",
  // Slice 11 follow-up: these five were re-pointed onto a canonical step
  // rather than removed, which left the value right and the name a second
  // one. They are renamed at their call sites now, and `--radius-xl` — 24 px,
  // a fifth radius §5 does not allow — went with them, unread by anything.
  "--radius-md:",
  "--radius-lg:",
  "--radius-xl:",
  "--radius-surface:",
  "--radius-tight-xs:",
  "--radius-tight-md:",
  "--motion-duration-fast:",
]) {
  if (css.includes(gone)) {
    throw new Error(`Generated tokens.css re-introduces the retired alias ${gone.slice(0, -1)}`);
  }
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
