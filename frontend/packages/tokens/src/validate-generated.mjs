import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const required = ["generated/tokens.css", "generated/tokens.ts", "fonts.css"];

for (const relativePath of required) {
  if (!existsSync(path.join(packageDir, relativePath))) {
    throw new Error(`Missing token artifact: ${relativePath}`);
  }
}

// The generated CSS must carry every family of the visual system (one
// representative each, docs/DESIGN.md). A stale build after a core.json edit
// fails here before it reaches a render.
const css = readFileSync(path.join(packageDir, "generated/tokens.css"), "utf8");
const FAMILIES = [
  "--sse-green",
  "--sse-dark-green",
  "--sse-beige-light",
  "--material-bg",
  "--material-key",
  "--material-well",
  "--material-raise",
  "--material-hover",
  "--material-line2",
  "--text-text",
  "--text-text3",
  "--accent",
  "--role-yellow-fill",
  "--role-green-ink",
  "--role-coral-text",
  "--role-blue-text",
  "--role-burgundy-fill",
  "--role-primary-ink",
  "--role-cap-fill",
  "--signal-meter-low",
  "--signal-cct-track",
  "--font-family-ui",
  "--font-family-display",
  "--font-family-serif",
  "--font-family-glass",
  "--font-size-tick",
  "--font-size-head",
  "--font-size-display",
  "--font-weight-bold",
  "--font-tracking-display",
  "--radius-base",
  "--chrome-studio-header",
  "--chrome-studio-state-display",
  "--elevation-float",
  "--elevation-tip",
  "--motion-duration-press",
  "--motion-easing-mech",
  "--target-take",
];
const missing = FAMILIES.filter((name) => !css.includes(`${name}:`));
if (missing.length) {
  throw new Error(`Generated tokens.css lacks tokens: ${missing.join(", ")} — run npm run frontend:tokens:build`);
}

// Names that are gone and must not come back: a second name for a size, a
// radius or a duration the scale already names; the hue families' old names
// (amber is Yellow and red is Coral since the SSE palette, 2026-10-03); the
// weights PT Sans does not have.
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
  "--radius-md:",
  "--radius-lg:",
  "--radius-xl:",
  "--radius-surface:",
  "--radius-tight-xs:",
  "--radius-tight-md:",
  "--motion-duration-fast:",
  "--role-amber-",
  "--role-red-",
  "--display-amber",
  "--display-red",
  "--font-weight-medium:",
  "--font-weight-semibold:",
]) {
  if (css.includes(gone)) {
    throw new Error(`Generated tokens.css re-introduces the retired name ${gone.replace(/:$/, "")}`);
  }
}

// One theme, Studio (D25): nothing re-maps the tokens for another.
if (/data-theme/.test(css)) {
  throw new Error("A token stylesheet names a theme: Studio is the only one, and it is the :root block");
}

// SSE Adelia is SSE's licensed face and this repository is public: no font
// file of it is ever committed, and fonts.css reaches it by local() only.
const fonts = readFileSync(path.join(packageDir, "fonts.css"), "utf8");
const adelia = fonts.match(/@font-face\s*\{[^}]*"SSE Adelia"[^}]*\}/)?.[0] ?? "";
if (!adelia || /url\(/.test(adelia)) {
  throw new Error("fonts.css must declare SSE Adelia with local() sources only");
}
const fontDir = path.join(packageDir, "fonts");
if (existsSync(fontDir)) {
  const { readdirSync } = await import("node:fs");
  const stray = readdirSync(fontDir).filter((file) => /adelia/i.test(file));
  if (stray.length) throw new Error(`SSE Adelia must never be committed: ${stray.join(", ")}`);
}

console.log("Token artifacts are present and carry every family.");
