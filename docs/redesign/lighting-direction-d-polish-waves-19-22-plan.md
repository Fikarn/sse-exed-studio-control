# Lighting Direction D — Polish plan (Waves 19–22)

Scope: 64 UI/UX/front-end audit findings against the lighting workspace post-Wave-18 (branch `claude/charming-pare-155614`, base `ca2780e`). Authored 2026-04-29. Each wave is one focused commit; the codebase is shippable at every step. Wave 23 contains items that need explicit user go-ahead and is not part of the standing run.

## Standing rules carried forward

- Auto-revert generated artefacts (`tauri/gen/schemas`, `frontend/packages/tokens/src/generated/*`) before staging unless the diff is the intended change.
- Explicit go-ahead before invasive ops: persisted-state mutations, force-pushes, system installs, branch pushes, PR merges, release-evidence cycles. Wave 23 items need this.
- WIP commits on a named branch over `git stash` for safety snapshots.
- Local `npm run dev:check` is the verification surface; GitHub Actions CI is intentionally unpaid — treat red CI as baseline noise.
- Windows target-host validation (`tauri:smoke:win`) runs in a separate Windows-Claude session against `origin/main`; Mac side does not run it.
- No engine work in this plan. No new IPC names. No protocol contract changes.

## Locked decisions

- **CCT slider gradient:** extend to the full ramp 2700K → 6500K (currently only 4400K mid-range is shown via hardcoded hexes). Direct token references exist for the entire ramp.
- **`Cut all` terminology:** retain. Audit-fix-plan #43 already accepted this. Finding #43 is closed by validating the prior decision; no rename in this run.
- **`Re-apply scene` → `Recall scene`:** revert audit-fix-plan #27. Industry convention. Operators expect "Recall".
- **busyAction refactor (#61):** Set-based, not Map-based. One key per in-flight mutation.
- **Drift-state plot pill text:** "Active scene · modified" when modified, "Active scene" otherwise. Restores discoverability without re-introducing the redundancy that audit-fix-plan #28 trimmed (only present in modified state).
- **PlotPill / PlotMeta:** migrate the lighting workspace's custom implementations to the design-system primitives (`@sse/design-system`).
- **Animations respect `prefers-reduced-motion: reduce`:** every keyframed animation introduced by Waves 20-22 wraps in `@media (prefers-reduced-motion: no-preference)`.
- **Wave 23 items deferred:** require explicit go-ahead per standing rules.

## Wave order (locked)

| #   | Wave                                        | Findings closed                                                                                                                  | Size     |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 19  | Token cleanup & hardcoded-value migration   | #1, #2, #3, #4, #5, #6, #7, #8, #59, #64                                                                                         | ~600 LOC |
| 20  | Premium-feel micro-interactions             | #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21, #22, #23, #24, #25                                               | ~700 LOC |
| 21  | A11y + microcopy + minor functional         | #26, #27, #28, #29, #30, #31, #32, #33, #34, #35, #36, #37, #38, #39, #40, #41, #42, #43, #44, #45, #46, #47, #48, #51, #52, #53 | ~500 LOC |
| 22  | Functional / behavioural improvements       | #49, #50, #57, #58, #60, #61, #62                                                                                                | ~400 LOC |
| 23  | Larger features (require explicit go-ahead) | #54, #55, #56, #63                                                                                                               | gated    |

## Pre-work — verify before starting (5 min)

Run all of these before touching code. Stop and report if any step fails.

```bash
# 1. Branch state clean
git status
git log --oneline -3
# Expect: at branch tip, no uncommitted changes

# 2. Tokens still surface what the plan assumes
grep -E '"cct"|"brand"|"danger"' frontend/packages/tokens/src/tokens/core.json | head
# Expect: cct ramp 2700-6500 + brand.* family + danger.500

# 3. Hardcodes the plan targets are still present (fail-fast if Wave 19 has already partially landed)
grep -n "f0dfb8\|ebe5d2\|d4dde2" frontend/app/src/app/lighting/components/LightingInspector.module.css
grep -n "rgba(213, 106, 101" frontend/app/src/app/lighting/
grep -n "color-surface-500" frontend/app/src/app/lighting/lightingHelpers.ts
# Expect: all three return matches

# 4. Design-system primitives the plan references still exist with the assumed API
test -f frontend/packages/design-system/src/components/PlotPill.tsx
test -f frontend/packages/design-system/src/components/PlotMeta.tsx
test -f frontend/packages/design-system/src/components/ConfirmDialog.tsx
test -f frontend/packages/design-system/src/components/Dialog.tsx
grep -n 'state\?: "default" | "modified" | "patch"' frontend/packages/design-system/src/components/PlotPill.tsx
grep -n 'tone\?: "default" | "blue"' frontend/packages/design-system/src/components/PlotMeta.tsx
# Expect: all four files exist; PlotPill states + PlotMeta tones present

# 5. Verify CreateFixtureDialog + RenameDialog keyboard contracts (closes #57)
#    These are forms inside Dialog: Enter submits, Escape cancels (via Dialog onClose), focus traps to first input.
#    Read RenameDialog.tsx — focus + select on mount confirmed (lines 42-48).
#    Read CreateFixtureDialog.tsx — handleSubmit on form submit confirmed (line 82-86).
#    Both wrap in <Dialog> which provides Escape→onClose. Verify Dialog.tsx maintains focus trap during the run.
cat frontend/packages/design-system/src/components/Dialog.tsx | grep -n "useEffect\|focus\|trap"
# Expect: focus management present. If absent, add focus trap to Dialog.tsx in Wave 21.

# 6. Baseline lints clean
npm run frontend:typecheck
npm run lint
# Expect: both green
```

## Wave 19 — Token cleanup & hardcoded-value migration

Mechanical only. No behaviour changes. Closes #1-8, #59, #64.

### 19.A Token additions to `frontend/packages/tokens/src/tokens/core.json`

All token additions are consolidated here. Run `npm run frontend:tokens:build` after editing; verify the regenerated `frontend/packages/tokens/src/generated/tokens.css` and `tokens.ts` contain only additions.

**Under `color.brand`** (insert in alphabetical proximity to existing keys):

```json
"coralBorder": { "$value": "rgba(237, 124, 94, 0.5)" },
"coralGlow":   { "$value": "rgba(237, 124, 94, 0.06)" },
"yellowGlow":  { "$value": "rgba(232, 213, 97, 0.06)" },
"darkGreenAmbient": { "$value": "rgba(31, 77, 56, 0.12)" }
```

**Extend `color.danger`** (the existing object only has `500`):

```json
"danger": {
  "500": { "$value": "#D56A65" },
  "soft":         { "$value": "rgba(213, 106, 101, 0.16)" },
  "softStrong":   { "$value": "rgba(213, 106, 101, 0.28)" },
  "glow":         { "$value": "rgba(213, 106, 101, 0.06)" },
  "border":       { "$value": "rgba(213, 106, 101, 0.5)" },
  "borderStrong": { "$value": "rgba(213, 106, 101, 0.7)" }
}
```

**New `color.fixture`** (after `color.cct`):

```json
"fixture": {
  "shellFill":   { "$value": "rgba(8, 9, 10, 0.92)" },
  "shellStroke": { "$value": "rgba(212, 205, 179, 0.4)" },
  "ghostStroke": { "$value": "rgba(153, 186, 146, 0.45)" }
}
```

**New `color.stage`**:

```json
"stage": {
  "gridMajor":   { "$value": "rgba(212, 205, 179, 0.20)" },
  "gridMinor":   { "$value": "rgba(212, 205, 179, 0.10)" },
  "gridFaint":   { "$value": "rgba(212, 205, 179, 0.05)" },
  "beamLine":    { "$value": "rgba(212, 205, 179, 0.18)" },
  "doorStroke":  { "$value": "rgba(212, 205, 179, 0.32)" }
}
```

(Grid alphas raised from current 0.16/0.08/0.04 to 0.20/0.10/0.05 — closes #59 inline.)

**New `color.studio`**:

```json
"studio": {
  "wall":          { "$value": "#4d5544" },
  "wallStroke":    { "$value": "#6b7560" },
  "element":       { "$value": "rgba(108, 116, 96, 0.18)" },
  "elementStroke": { "$value": "rgba(108, 116, 96, 0.5)" },
  "talentRing":    { "$value": "rgba(232, 213, 97, 0.45)" },
  "talentDot":     { "$value": "rgba(232, 213, 97, 0.7)" },
  "cameraFill":    { "$value": "rgba(108, 169, 209, 0.22)" },
  "cameraStroke":  { "$value": "rgba(108, 169, 209, 0.6)" }
}
```

**Extend `color.glass`** (existing has `bg`, `bgBlue`, `border`):

```json
"bgStrong": { "$value": "rgba(8, 10, 8, 0.85)" },
"bgSubtle": { "$value": "rgba(8, 10, 8, 0.65)" }
```

**New entries under `shadow`** (after `glowBlue`):

```json
"glowGreenSm":          { "$value": "0 0 12px rgba(153, 186, 146, 0.35)" },
"glowGreenDot":         { "$value": "0 0 5px rgba(153, 186, 146, 0.55)" },
"glowGreenDotSubtle":   { "$value": "0 0 6px rgba(153, 186, 146, 0.55)" },
"glowYellowSm":         { "$value": "0 0 8px rgba(232, 213, 97, 0.35)" },
"glowYellowDot":        { "$value": "0 0 5px rgba(232, 213, 97, 0.55)" },
"glowYellowDotSubtle":  { "$value": "0 0 6px rgba(232, 213, 97, 0.55)" },
"thumbRing":            { "$value": "0 0 0 2px rgba(153, 186, 146, 0.18)" }
```

**Validation after token edits:**

```bash
node -e "require('./frontend/packages/tokens/src/tokens/core.json')"
# Expect: silent (valid JSON)
npm run frontend:tokens:build
# Expect: success; tokens.css and tokens.ts updated
git diff frontend/packages/tokens/src/generated/ | head -100
# Expect: only additions, no renames or removals
```

Naming convention: source `camelCase` → CSS `kebab-case`. So `brand.coralBorder` → `--color-brand-coral-border`, `shadow.glowGreenSm` → `--shadow-glow-green-sm`. Consistent with existing pattern (`shadow.insetHi` → `--shadow-inset-hi` at [tokens.css:105](frontend/packages/tokens/src/generated/tokens.css)).

### 19.B File-by-file replacements

#### 19.B.1 — `LightingInspector.module.css` CCT slider gradient (closes #1)

[frontend/app/src/app/lighting/components/LightingInspector.module.css:484](frontend/app/src/app/lighting/components/LightingInspector.module.css)

Replace:

```css
.sliderCct {
  background: linear-gradient(90deg, #f0dfb8 0%, #ebe5d2 50%, #d4dde2 100%);
}
```

With the full ramp:

```css
.sliderCct {
  background: linear-gradient(
    90deg,
    var(--color-cct-2700) 0%,
    var(--color-cct-3200) 16%,
    var(--color-cct-3800) 32%,
    var(--color-cct-4400) 50%,
    var(--color-cct-5000) 66%,
    var(--color-cct-5600) 83%,
    var(--color-cct-6500) 100%
  );
}
```

#### 19.B.2 — `PatchAddressTag.tsx` (closes #2)

[frontend/app/src/app/lighting/components/PatchAddressTag.tsx:23-37](frontend/app/src/app/lighting/components/PatchAddressTag.tsx)

Drive `<rect>` and `<text>` styling via inline `style` so CSS vars resolve. Replace the body of the `<g>` with:

```tsx
<rect
  x={-width / 2} y={-height / 2}
  width={width} height={height} rx={3}
  style={{
    fill: "var(--color-glass-bg-blue)",
    stroke: "var(--color-brand-blue-border)",
    strokeWidth: 1,
  }}
/>
<text
  x={0} y={padY - 1}
  fontSize={11} fontWeight={600} textAnchor="middle"
  style={{
    fontFamily: "var(--font-family-mono)",
    fill: "var(--color-brand-blue-hot)",
  }}
>
  {text}
</text>
```

#### 19.B.3 — `FixtureMarker.tsx` constants (closes #3)

[frontend/app/src/app/lighting/components/FixtureMarker.tsx:39-45](frontend/app/src/app/lighting/components/FixtureMarker.tsx)

Replace the 6 module-level color constants with CSS-var strings:

```ts
const SHELL_FILL = "var(--color-fixture-shell-fill)";
const SHELL_STROKE = "var(--color-fixture-shell-stroke)";
const SELECTED_STROKE = "var(--color-brand-green)";
const GHOST_STROKE = "var(--color-fixture-ghost-stroke)";
const LABEL_NAME_FILL = "var(--color-brand-text-secondary)";
const LABEL_META_FILL = "var(--color-brand-text-muted)";
```

The constants are passed as `fill={…}` / `stroke={…}` JSX props in:

- `shapeForMounting` switch (lines 58, 62, 66, 70) — wrap each `<rect>` / `<circle>` to use `style={{ fill: SHELL_FILL, stroke: SHELL_STROKE, strokeWidth: 1 }}` (drop the `fill=` / `stroke=` attributes).
- Ghost circle (line 250) — same pattern with `GHOST_STROKE`.
- Selected stroke circle (line 261) — same with `SELECTED_STROKE`.
- Focus ring circle (line 274) — same with `SELECTED_STROKE`.
- Label `<text>` fills (lines 287, 299) — `style={{ fill: LABEL_NAME_FILL, fontFamily: "var(--font-family-mono)" }}` and likewise for meta.

#### 19.B.4 — `StudioFloor.tsx` (closes #4)

[frontend/app/src/app/lighting/components/StudioFloor.tsx](frontend/app/src/app/lighting/components/StudioFloor.tsx)

Replace lines 7-12 module-level constants:

```ts
const WALL_COLOR = "var(--color-studio-wall)";
const WALL_STROKE = "var(--color-studio-wall-stroke)";
const FLOOR_COLOR = "var(--color-bg-deep)";
const TEXT_MUTED = "var(--color-brand-text-faint)";
const ELEMENT_FILL = "var(--color-studio-element)";
const ELEMENT_STROKE = "var(--color-studio-element-stroke)";
```

Replace inline rgba on lines 38, 49-50, 86-90, 100-104 — drive each via `style`:

- Door stroke (line 38): `style={{ stroke: "var(--color-stage-door-stroke)", strokeWidth: 1 }}` (drop `stroke=` attr).
- Control booth window (lines 49-50): `style={{ fill: "var(--color-brand-blue-soft)", stroke: "var(--color-brand-blue-border)", strokeWidth: 1 }}`.
- Talent mark ring + dot (lines 86-90): `style={{ stroke: "var(--color-studio-talent-ring)" }}` for the ring, `style={{ fill: "var(--color-studio-talent-dot)" }}` for the inner dot.
- Camera polygon (lines 100-104): `style={{ fill: "var(--color-studio-camera-fill)", stroke: "var(--color-studio-camera-stroke)", strokeWidth: 1 }}`.

Replace `fontFamily="Inter, system-ui, sans-serif"` on lines 70 and 104 with `style={{ fontFamily: "var(--font-family-ui)", fill: TEXT_MUTED }}` (and drop the `fill=` / `fontFamily=` attrs).

#### 19.B.5 — `StagePlot.tsx` beam-line stroke (closes #5)

[frontend/app/src/app/lighting/components/StagePlot.tsx:159](frontend/app/src/app/lighting/components/StagePlot.tsx)

Replace `stroke="rgba(212, 205, 179, 0.18)"` with `style={{ stroke: "var(--color-stage-beam-line)" }}` and drop the `stroke=` attribute. Keep `strokeWidth` and `strokeDasharray` as-is for now (Wave 20.K replaces the dashed line with a gradient).

#### 19.B.6 — `StagePlotGrid.tsx` (part of #4 / #59)

[frontend/app/src/app/lighting/components/StagePlotGrid.tsx:18-23, 38-42](frontend/app/src/app/lighting/components/StagePlotGrid.tsx)

Replace both stroke-selection ternaries (x and y loops):

```ts
const stroke =
  axis % FIVE_M === 0
    ? "var(--color-stage-grid-major)"
    : axis % ONE_M === 0
      ? "var(--color-stage-grid-minor)"
      : "var(--color-stage-grid-faint)";
```

Apply via `style={{ stroke }}` on each `<line>`.

#### 19.B.7 — `StagePlot.module.css` fallback drops (closes #6)

[frontend/app/src/app/lighting/components/StagePlot.module.css:157, 162](frontend/app/src/app/lighting/components/StagePlot.module.css)

```css
.plotMetaSelected {
  border-color: var(--color-brand-blue-border);
}
.plotMetaSelected .plotMetaLabel,
.plotMetaSelected .plotMetaValue {
  color: var(--color-brand-blue);
}
```

(Drop both rgba/hex fallbacks. Tokens exist; fallback alpha (0.45) didn't even match the token's value (0.55).)

#### 19.B.8 — `StagePlot.module.css` other hardcodes (also #25 vignette tweak)

[frontend/app/src/app/lighting/components/StagePlot.module.css:5, 17, 53, 68, 86, 91, 135](frontend/app/src/app/lighting/components/StagePlot.module.css)

Replacements:

```css
.plotShell {
  background:
    radial-gradient(circle at top, var(--color-brand-dark-green-ambient), transparent 55%), var(--color-bg-deep);
  /* existing: position, overflow, etc. */
}

.plotShell::after {
  background: radial-gradient(ellipse at center, transparent 65%, rgba(0, 0, 0, 0.25) 100%);
  /* softened vignette: 60→65% transparent, 0.45→0.25 outer alpha (closes #25) */
}

.plotEmpty > * {
  background: var(--color-glass-bg-strong);
  /* was rgba(8, 10, 8, 0.85) */
}

.plotPill {
  background: var(--color-glass-bg);
  /* was rgba(8, 10, 8, 0.78) */
}

.plotPillDot {
  box-shadow: var(--shadow-glow-green-dot-subtle);
}

.plotPillModified .plotPillDot {
  box-shadow: var(--shadow-glow-yellow-dot-subtle);
}

.plotMeta {
  background: var(--color-glass-bg-subtle);
  /* was rgba(8, 10, 8, 0.65) */
}
```

Note: the `.plotPill` and `.plotMeta` rules become orphans after Wave 20.L migrates these to design-system primitives. Don't delete them yet — Wave 20.L is the right time.

#### 19.B.9 — `LightingWorkspace.module.css` feedback gradients

[frontend/app/src/app/lighting/LightingWorkspace.module.css:50, 55](frontend/app/src/app/lighting/LightingWorkspace.module.css)

```css
.feedback[data-tone="error"] {
  background: linear-gradient(180deg, var(--color-danger-soft), var(--color-danger-glow));
}
.feedback[data-tone="ok"] {
  background: linear-gradient(180deg, var(--color-brand-green-soft), var(--color-brand-green-glow));
}
```

#### 19.B.10 — `LightingRail.module.css` (multi-site)

[frontend/app/src/app/lighting/components/LightingRail.module.css](frontend/app/src/app/lighting/components/LightingRail.module.css)

Lines 192-193 (master toggle on):

```css
.masterToggleOn {
  border-color: var(--color-brand-green-border);
  background: linear-gradient(180deg, var(--color-brand-green) 0%, var(--color-brand-green-border) 100%);
  box-shadow: var(--shadow-glow-green-sm);
}
```

Line 257 (slider thumb):

```css
.masterSlider::-webkit-slider-thumb {
  /* existing */
  box-shadow: var(--shadow-thumb-ring);
}
```

Lines 276-277 (emergencyCut):

```css
.emergencyCut {
  /* existing */
  background: linear-gradient(180deg, var(--color-danger-soft), var(--color-danger-glow));
  border: 1px solid var(--color-danger-border);
}
```

Line 288 (emergencyCut hover):

```css
.emergencyCut:hover {
  background: linear-gradient(180deg, var(--color-danger-soft-strong), var(--color-danger-soft));
}
```

Lines 374, 383 (tile badge dots):

```css
.tileBadgeDot {
  box-shadow: var(--shadow-glow-green-dot);
}
.tileModified .tileBadgeDot {
  box-shadow: var(--shadow-glow-yellow-dot);
}
```

Lines 438, 559 (`rgba(153, 186, 146, 0.04)`):
Replace with `var(--color-brand-green-glow)` (existing token; alpha 0.10 — slightly more glow but visually consistent).

#### 19.B.11 — `LightingToolbar.module.css`

[frontend/app/src/app/lighting/components/LightingToolbar.module.css](frontend/app/src/app/lighting/components/LightingToolbar.module.css)

Line 29 (patch hairline):

```css
.toolbar[data-patch-mode="true"]::before {
  /* existing */
  box-shadow: var(--shadow-glow-yellow-sm);
}
```

Line 60 (patchEyebrow):

```css
.patchEyebrow {
  /* existing */
  background: linear-gradient(180deg, var(--color-brand-yellow-soft) 0%, var(--color-brand-yellow-glow) 100%);
}
```

Lines 102, 107-108 (chip variants):

```css
.chipGreen {
  /* existing color, border-color, etc. */
  background: linear-gradient(180deg, var(--color-brand-green-soft) 0%, var(--color-brand-green-glow) 100%);
}
.chipErr {
  color: var(--color-brand-coral);
  border-color: var(--color-brand-coral-border);
  background: linear-gradient(180deg, var(--color-brand-coral-soft) 0%, var(--color-brand-coral-glow) 100%);
}
```

#### 19.B.12 — `LightingInspector.module.css` collisionCard

[LightingInspector.module.css:596](frontend/app/src/app/lighting/components/LightingInspector.module.css)

```css
.collisionCard {
  /* existing */
  background: linear-gradient(180deg, var(--color-brand-yellow-soft) 0%, var(--color-brand-yellow-glow) 100%);
}
```

(Visual difference between original 0.04 alpha and new 0.06 token alpha is negligible; consolidating to one token.)

#### 19.B.13 — `lightingHelpers.ts` `lightingFixtureColor` (closes #64)

[frontend/app/src/app/lighting/lightingHelpers.ts:29-43](frontend/app/src/app/lighting/lightingHelpers.ts)

The current implementation references `--color-surface-500` which **does not exist** (verified: tokens.css generates `--color-surface-600/700/800/900` only). Off-state color resolves to `unset`. The on-state hex literals (`#ffb35c`, `#ffd38b`, `#eaf0ff`) don't match any CCT token.

Replace with the full CCT ramp (matching the slider gradient from 19.B.1):

```ts
export function lightingFixtureColor(cct: number, on: boolean) {
  if (!on) {
    return "var(--color-brand-text-faint)";
  }
  if (cct <= 2900) return "var(--color-cct-2700)";
  if (cct <= 3500) return "var(--color-cct-3200)";
  if (cct <= 4100) return "var(--color-cct-3800)";
  if (cct <= 4700) return "var(--color-cct-4400)";
  if (cct <= 5300) return "var(--color-cct-5000)";
  if (cct <= 6000) return "var(--color-cct-5600)";
  return "var(--color-cct-6500)";
}
```

Consumers ([FixtureMarker.tsx:102](frontend/app/src/app/lighting/components/FixtureMarker.tsx), [LightPool.tsx:17](frontend/app/src/app/lighting/components/LightPool.tsx), [InspectorScene.tsx:200](frontend/app/src/app/lighting/components/InspectorScene.tsx)) all pass the result to inline `style` or SVG `fill` — CSS-var strings work in those contexts.

#### 19.B.14 — Universe casing (closes #7)

Standardize on uppercase `U`. Touch:

- [LightingBridgeBanner.tsx:21](frontend/app/src/app/lighting/components/LightingBridgeBanner.tsx) — change `u${universe}` to `U${universe}`.
- [InspectorPatch.tsx:122](frontend/app/src/app/lighting/components/InspectorPatch.tsx) — change `u{universe}` to `U{universe}`.
- [InspectorPatch.tsx:175](frontend/app/src/app/lighting/components/InspectorPatch.tsx) — verify [lightingPatch.ts](frontend/app/src/app/lighting/lightingPatch.ts) `lightingFixturePatchSummary` renders uppercase `U`. Update if it doesn't.
- [DMXMonitorDialog.tsx:63, 87](frontend/app/src/app/lighting/components/DMXMonitorDialog.tsx) — change both `DMX universe u${universe}` to `DMX universe U${universe}` (title and aria-label).

Toolbar already uses uppercase. HealthBar already uses uppercase.

#### 19.B.15 — `SceneTile.tsx` ARIA fix (closes #8)

[SceneTile.tsx:55-57](frontend/app/src/app/lighting/components/SceneTile.tsx)

Drop `aria-pressed`. Keep `aria-current` and `aria-label`:

```tsx
<button
  type="button"
  className={stateClass}
  onClick={() => onRecall(id)}
  aria-current={isActive ? "true" : undefined}
  aria-label={ariaLabel}
>
```

### 19.C Validation gate for Wave 19

```bash
npm run frontend:typecheck
npm run lint
grep -rn "rgba(213, 106, 101\|rgba(8, 9, 10\|f0dfb8\|6A93DC\|ffb35c\|color-surface-500" frontend/app/src/
# Expect: no matches anywhere in lighting/
git diff frontend/packages/tokens/src/generated/ | head -40
# Expect: only additions matching 19.A
```

`npm run tauri:dev`, navigate to Lighting:

- CCT slider gradient now spans warm-orange → cool-blue across the full visible track.
- Stage plot grid is more legible (slightly higher contrast than before).
- Patch tags, fixture markers, studio elements visually unchanged (token swap is identity).

Auto-revert any other generated artefacts (`tauri/gen/schemas`) before staging.

---

## Wave 20 — Premium-feel micro-interactions

Adds the motion, focus, and tactile feedback that pro tools have. Closes #9-25.

### 20.A Slider thumb hover/focus/active rings (closes #9, partial #29)

[LightingRail.module.css:250-267](frontend/app/src/app/lighting/components/LightingRail.module.css) and [LightingInspector.module.css:466-481](frontend/app/src/app/lighting/components/LightingInspector.module.css).

Add `transition` to existing thumb selectors and introduce `:hover`, `:focus-visible`, `:active` variants for both `::-webkit-slider-thumb` and `::-moz-range-thumb`. Pattern (apply identically to `.masterSlider` and `.slider`):

```css
.slider::-webkit-slider-thumb {
  /* existing styles preserved */
  transition:
    transform var(--motion-duration-fast) ease,
    box-shadow var(--motion-duration-fast) ease;
}
.slider:hover::-webkit-slider-thumb {
  transform: scale(1.15);
  box-shadow: var(--shadow-thumb-ring);
}
.slider:focus-visible {
  outline: none; /* outline goes on the thumb via box-shadow */
}
.slider:focus-visible::-webkit-slider-thumb {
  transform: scale(1.15);
  box-shadow:
    var(--shadow-thumb-ring),
    0 0 0 2px var(--color-brand-green);
}
.slider:active::-webkit-slider-thumb {
  transform: scale(1.05);
}
.slider::-moz-range-thumb {
  /* existing */
  transition:
    transform var(--motion-duration-fast) ease,
    box-shadow var(--motion-duration-fast) ease;
}
.slider:hover::-moz-range-thumb,
.slider:focus-visible::-moz-range-thumb {
  transform: scale(1.15);
  box-shadow: var(--shadow-thumb-ring);
}
```

### 20.B Button primitive `:active` state (closes #10 propagating)

[frontend/packages/design-system/src/components/Button.module.css](frontend/packages/design-system/src/components/Button.module.css). Add after the `.button:hover` block (line 27):

```css
.button:active {
  transform: translateY(0);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
}
.button:active:not(.primary):not(.danger) {
  background-color: var(--color-bg-soft);
}
```

Extend the `.button` `transition` (line 17-20) to cover `box-shadow`:

```css
transition:
  transform var(--motion-duration-fast) ease,
  box-shadow var(--motion-duration-fast) ease,
  border-color var(--motion-duration-fast) ease,
  background-color var(--motion-duration-fast) ease;
```

**Also fix Button's danger variant hardcodes** (lines 88-94, same pattern as Wave 19):

```css
.danger {
  background: linear-gradient(180deg, var(--color-danger-soft-strong), var(--color-danger-soft));
  border-color: var(--color-danger-border);
  color: var(--color-danger-500);
}
.danger:hover {
  border-color: var(--color-danger-border-strong);
}
```

This change propagates to all Button consumers (dashboard, audio, setup, lighting). Smoke-test those workspaces with `tauri:dev` before staging.

### 20.C Custom button `:active` states (closes #10 fully)

For each custom button selector listed below, add the `:active` rule plus the `box-shadow`/`transform` to the existing transition list. Pattern:

```css
.<selector > :active {
  transform: translateY(0);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
}
```

Selectors to touch:

- [LightingRail.module.css](frontend/app/src/app/lighting/components/LightingRail.module.css): `.headButton`, `.tile`, `.tileAdd`, `.action`, `.emergencyCut`, `.masterToggle`, `.groupChip`, `.groupChipInspect`, `.groupChipAdd`
- [LightingInspector.module.css](frontend/app/src/app/lighting/components/LightingInspector.module.css): `.tab`, `.memberRow`, `.sceneFixtureChipButton`
- [LightingToolbar.module.css](frontend/app/src/app/lighting/components/LightingToolbar.module.css): `.kebab`
- [LightingWorkspace.module.css](frontend/app/src/app/lighting/LightingWorkspace.module.css): `.feedbackDismiss`
- [StagePlotControls.module.css](frontend/app/src/app/lighting/components/StagePlotControls.module.css): `.button`

### 20.D Scene tile recall transition + dot pulse (closes #11)

[LightingRail.module.css:310-328](frontend/app/src/app/lighting/components/LightingRail.module.css)

Update `.tile` transition list to use the standard easing token:

```css
.tile {
  /* existing */
  transition:
    border-color 200ms var(--motion-easing-standard),
    background 200ms var(--motion-easing-standard),
    transform var(--motion-duration-fast) ease,
    box-shadow var(--motion-duration-fast) ease;
}
```

Add keyframes after the existing `.tile*` rules:

```css
@keyframes ssePulseGreenDot {
  0%,
  100% {
    box-shadow: var(--shadow-glow-green-dot);
  }
  50% {
    box-shadow: 0 0 12px rgba(153, 186, 146, 0.85);
  }
}
@keyframes ssePulseYellowDot {
  0%,
  100% {
    box-shadow: var(--shadow-glow-yellow-dot);
  }
  50% {
    box-shadow: 0 0 12px rgba(232, 213, 97, 0.85);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .tileActive .tileBadgeDot {
    animation: ssePulseGreenDot 1.6s ease-in-out infinite;
  }
  .tileModified .tileBadgeDot {
    animation: ssePulseYellowDot 1.6s ease-in-out infinite;
  }
}
```

### 20.E Lucide icon replacements (closes #15, #16, #18)

#### 20.E.1 GroupChip drift triangles (closes #15)

[GroupChip.tsx:35-41, 60-62](frontend/app/src/app/lighting/components/GroupChip.tsx)

Replace unicode triangles with Lucide icons:

```tsx
import { ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
// ...
const TrendIcon = levelDelta > 0 ? TrendingUp : TrendingDown;
const deltaText = meaningfulDelta ? `${levelDelta > 0 ? "+" : ""}${Math.round(levelDelta)}` : "";
// ...
{
  meaningfulDelta || drifted ? (
    <span className={styles.groupChipDelta} aria-hidden="true">
      <TrendIcon size={11} strokeWidth={2.5} />
      {deltaText ? <span>{deltaText}</span> : null}
    </span>
  ) : null;
}
```

Add `.groupChipDelta` class to [LightingRail.module.css](frontend/app/src/app/lighting/components/LightingRail.module.css):

```css
.groupChipDelta {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 4px;
  font-family: var(--font-family-mono);
  font-size: 10px;
}
```

#### 20.E.2 StagePlotControls glyphs (closes #16)

[StagePlotControls.tsx:17-31](frontend/app/src/app/lighting/components/StagePlotControls.tsx)

Replace text glyphs with Lucide:

```tsx
import { Minus, Plus, RotateCcw } from "lucide-react";
// ...
<Minus aria-hidden="true" size={14} strokeWidth={2} />
// ...
<Plus aria-hidden="true" size={14} strokeWidth={2} />
// ...
<RotateCcw aria-hidden="true" size={14} strokeWidth={2} />
```

#### 20.E.3 Feedback dismiss button (closes #18)

[LightingWorkspace.tsx:1034-1042](frontend/app/src/app/lighting/LightingWorkspace.tsx)

Add `import { X } from "lucide-react";` to the top. Replace the `×` literal with:

```tsx
<button type="button" className={styles.feedbackDismiss} onClick={() => setFeedback(null)} aria-label="Dismiss">
  <X aria-hidden="true" size={12} strokeWidth={2} />
</button>
```

Update `.feedbackDismiss` in [LightingWorkspace.module.css](frontend/app/src/app/lighting/LightingWorkspace.module.css) to `display: inline-flex; align-items: center; justify-content: center;`.

### 20.F Toast auto-dismiss (closes #17)

[LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — add an effect after the existing `feedback` state declaration:

```tsx
useEffect(() => {
  if (!feedback) return;
  if (feedback.tone === "error") return; // errors are sticky until manual dismiss
  const timer = window.setTimeout(() => setFeedback(null), 3500);
  return () => window.clearTimeout(timer);
}, [feedback]);
```

Add slide-in animation in [LightingWorkspace.module.css](frontend/app/src/app/lighting/LightingWorkspace.module.css):

```css
@media (prefers-reduced-motion: no-preference) {
  .feedback {
    animation: sseToastIn 200ms var(--motion-easing-standard);
  }
}
@keyframes sseToastIn {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 20.G Master toggle inset shadow + master card on-state glow (closes #13, #14)

[LightingRail.module.css:170-194, 125-128](frontend/app/src/app/lighting/components/LightingRail.module.css)

```css
.masterToggle {
  /* existing */
  box-shadow: var(--shadow-inset-hi); /* always — gives off-state depth */
}
.masterToggleOn {
  /* existing border-color, background */
  box-shadow: var(--shadow-glow-green-sm), var(--shadow-inset-hi-strong);
}
.masterOn {
  /* existing */
  box-shadow: var(--shadow-glow-green);
}
```

(`--shadow-glow-green` is the existing premium glow token at [core.json:152](frontend/packages/tokens/src/tokens/core.json), includes inset hi + 28px green shadow.)

### 20.H Plot patch-mode filter softening (closes #12)

[StagePlot.module.css:20-26](frontend/app/src/app/lighting/components/StagePlot.module.css)

```css
.plotShell {
  /* existing — add transition */
  transition: filter var(--motion-duration-normal) ease;
}
.plotShellPatch {
  filter: brightness(0.78) saturate(0.85); /* softened from 0.7 / 0.8 */
}
```

`var(--motion-duration-normal)` = 180ms.

### 20.I Beam pool intensity recalibration (closes #21)

[LightPool.tsx:18](frontend/app/src/app/lighting/components/LightPool.tsx)

Replace:

```ts
const opacity = Math.min(0.45, 0.15 + (intensity / 100) * 0.3);
```

With:

```ts
const normalized = Math.max(0, Math.min(1, intensity / 100));
const opacity = 0.18 + Math.pow(normalized, 0.85) * 0.44;
```

Caps at 0.62; non-linear curve preserves visible difference between 80% and 100%.

### 20.J Fixture marker depth filter (closes #22)

[FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx)

Strategy: hoist a single `<defs>` to [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) so all markers share one `<filter>` (avoids 30 inline def blocks at scale).

In `StagePlot.tsx` after line 124 `<g transform={viewport.transform}>`:

```tsx
<defs>
  <filter id="sse-fixture-shadow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" />
    <feOffset dx="0" dy="1" result="offsetblur" />
    <feComponentTransfer>
      <feFuncA type="linear" slope="0.45" />
    </feComponentTransfer>
    <feMerge>
      <feMergeNode />
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>
</defs>
```

In `FixtureMarker.tsx` line 253, apply to the inner shape group:

```tsx
<g transform={`translate(${renderX}, ${renderY}) rotate(${rotationDegrees})`} filter="url(#sse-fixture-shadow)">
```

### 20.K Beam length indicator gradient (closes #23)

[StagePlot.tsx:147-164](frontend/app/src/app/lighting/components/StagePlot.tsx)

Replace each `<line>` with a per-fixture linear gradient:

```tsx
<g key={`beam-${fixture.id}`}>
  <defs>
    <linearGradient
      id={`beam-grad-${fixture.id}`}
      x1={xMeters * 100}
      y1={yMeters * 100}
      x2={xMeters * 100}
      y2={yMeters * 100 + length}
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0%" style={{ stopColor: "var(--color-stage-beam-line)", stopOpacity: 0.6 }} />
      <stop offset="100%" style={{ stopColor: "var(--color-stage-beam-line)", stopOpacity: 0 }} />
    </linearGradient>
  </defs>
  <line
    x1={xMeters * 100}
    y1={yMeters * 100}
    x2={xMeters * 100}
    y2={yMeters * 100 + length}
    stroke={`url(#beam-grad-${fixture.id})`}
    strokeWidth={1}
  />
</g>
```

Drops the dashed style; gradient does the visual fade.

### 20.L Migrate to design-system PlotPill / PlotMeta (closes #24 partially)

[StagePlot.tsx:84-109](frontend/app/src/app/lighting/components/StagePlot.tsx)

Add imports: `import { PlotPill, PlotMeta } from "@sse/design-system";`

Replace the custom JSX with primitive consumers. The plot pill's modified-state text indicator is restored here per the locked decision (closes #53):

```tsx
{
  !patchMode && activeSceneName ? (
    <div className={styles.plotPillSlot}>
      <PlotPill state={isSceneModified && bridgeReachable ? "modified" : "default"}>
        <span className={styles.plotPillLabel}>
          {isSceneModified && bridgeReachable ? "Active scene · modified" : "Active scene"}
        </span>
        <span className={styles.plotPillName}>{activeSceneName}</span>
      </PlotPill>
    </div>
  ) : null;
}

<div className={styles.plotOverlaysSlot} role="region" aria-label="Stage plot context">
  {selectedFixture ? <PlotMeta label="Selected" value={selectedFixture.name} tone="blue" /> : null}
  <PlotMeta label="Floor" value={`${layout.roomWidthMeters} m × ${layout.roomDepthMeters} m`} />
  <PlotMeta label="Grid" value="0.5 / 1 / 5 m" />
</div>;
```

(`role="region"` + `aria-label` un-hides the meta from SR — closes #27.)

In [StagePlot.module.css](frontend/app/src/app/lighting/components/StagePlot.module.css), replace `.plotPill*` and `.plotMeta*` blocks with positioning-only slots:

```css
.plotPillSlot {
  position: absolute;
  top: 16px;
  left: 16px;
  z-index: 2;
}
.plotOverlaysSlot {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-end;
}
.plotPillLabel {
  /* keep existing label styling */
}
.plotPillName {
  /* keep existing name styling */
}
```

Drop these now-orphaned rules: `.plotPill`, `.plotPillModified`, `.plotPillDot`, `.plotPillMod`, `.plotMeta`, `.plotMetaLabel`, `.plotMetaValue`, `.plotMetaSelected`.

### 20.M PlotPill / PlotMeta drop-shadow (closes #24)

[frontend/packages/design-system/src/components/PlotPill.module.css](frontend/packages/design-system/src/components/PlotPill.module.css) and [PlotMeta.module.css](frontend/packages/design-system/src/components/PlotMeta.module.css). Read both first to verify what shadow (if any) is present. If absent, add:

```css
/* PlotPill.module.css */
.pill {
  box-shadow: var(--shadow-md);
}

/* PlotMeta.module.css */
.meta {
  box-shadow: var(--shadow-sm);
}
```

Affects all consumers — smoke-test other workspaces (Audio, Setup) for visual regression.

### 20.N Scene tile thumbnail aspect-ratio (closes #19)

[LightingRail.module.css:396, 408](frontend/app/src/app/lighting/components/LightingRail.module.css). Find both `aspect-ratio: 16 / 11;` (`.thumb` and `.thumbPlaceholder`); replace with `aspect-ratio: 16 / 9;`.

### 20.O Animated plot reset (closes #20)

[useStagePlotViewport.ts](frontend/app/src/app/lighting/useStagePlotViewport.ts) — read the file first to understand current state shape.

If `reset()` currently sets state synchronously, refactor to animate via `requestAnimationFrame` over 250ms:

```ts
const reset = useCallback(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    return;
  }
  const startZoom = zoomRef.current;
  const startPan = { ...panRef.current };
  const startTime = performance.now();
  const DURATION_MS = 250;
  const ease = (t: number) => 1 - Math.pow(1 - t, 4); // approximates cubic-bezier(0.22, 1, 0.36, 1)
  const tick = (now: number) => {
    const t = Math.min(1, (now - startTime) / DURATION_MS);
    const eased = ease(t);
    setZoom(startZoom + (1 - startZoom) * eased);
    setPan({ x: startPan.x * (1 - eased), y: startPan.y * (1 - eased) });
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, []);
```

(If the existing implementation uses different state names, adapt accordingly.)

### 20.P Validation gate for Wave 20

```bash
npm run frontend:typecheck
npm run lint
```

Manual `tauri:dev` smoke (Lighting + at least one other workspace for Button/PlotPill/PlotMeta propagation):

- Drag any slider — thumb scales on hover, glows on focus.
- Click any button — feel a depression.
- Recall a scene — green dot pulses; tile transitions smoothly.
- Toggle patch mode — plot fades in/out (180ms ease) rather than snapping.
- Save scene → toast appears, slides in, auto-dismisses ~3.5s later.
- Stage plot reset (button or double-click) — animates smoothly.
- Beam pool at 100% intensity is noticeably brighter than 50%.
- Fixture markers have subtle drop-shadow depth.
- Scene tile thumbnails are 16:9, not 16:11.
- Other workspaces (Audio, Setup) — no Button visual regression.

Test reduced motion: System Settings → Accessibility → Display → Reduce motion → check that pulse animations and toast slide-in stop.

Auto-revert generated artefacts before staging.

---

## Wave 21 — A11y + microcopy + minor functional

Closes #26-48, #51-53. ~500 LOC.

### 21.A Inspector tablist arrow-key navigation (closes #26)

[LightingInspectorTabs.tsx](frontend/app/src/app/lighting/components/LightingInspectorTabs.tsx)

Add a keyboard handler that implements the WAI-ARIA tablist pattern (←/→/Home/End move between tabs; focus follows):

```tsx
import { type KeyboardEvent } from "react";
// ...
const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
  const idx = visibleTabs.indexOf(active);
  if (idx < 0) return;
  let nextIdx: number | null = null;
  switch (event.key) {
    case "ArrowLeft":
      nextIdx = (idx - 1 + visibleTabs.length) % visibleTabs.length;
      break;
    case "ArrowRight":
      nextIdx = (idx + 1) % visibleTabs.length;
      break;
    case "Home":
      nextIdx = 0;
      break;
    case "End":
      nextIdx = visibleTabs.length - 1;
      break;
  }
  if (nextIdx === null) return;
  event.preventDefault();
  const nextTab = visibleTabs[nextIdx]!;
  onChange(nextTab);
  const nextEl = event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
    `#${LIGHTING_TAB_BUTTON_ID[nextTab]}`
  );
  nextEl?.focus();
};
```

Wire to each `<button>`'s `onKeyDown={handleKeyDown}`.

### 21.B DMX Monitor `role="row"` insertion (closes #31)

[DMXMonitorDialog.tsx:87-105](frontend/app/src/app/lighting/components/DMXMonitorDialog.tsx)

Wrap cells in 16-cell rows:

```tsx
<div className={styles.grid} role="grid" aria-label={`DMX universe U${universe} channels`}>
  {Array.from({ length: Math.ceil(cells.length / 16) }, (_, rowIdx) => (
    <div key={rowIdx} role="row" className={styles.row}>
      {cells.slice(rowIdx * 16, (rowIdx + 1) * 16).map((cell) => {
        const tooltip = cell.assigned
          ? `Ch ${cell.channel} · ${cell.fixtureName} · ${cell.channelLabel}`
          : `Ch ${cell.channel} · unassigned`;
        const className = cell.assigned ? `${styles.cell} ${styles.cellAssigned}` : styles.cell;
        const fillPercent = Math.max(0, Math.min(100, (cell.value / 255) * 100));
        return (
          <div key={cell.channel} className={className} role="gridcell" title={tooltip}>
            {/* existing cell content */}
          </div>
        );
      })}
    </div>
  ))}
</div>
```

Add `.row { display: contents; }` to [DMXMonitorDialog.module.css](frontend/app/src/app/lighting/components/DMXMonitorDialog.module.css) — keeps the existing 16-column grid layout while satisfying ARIA spec.

### 21.C Plot overlay SR exposure + CCT scale describedby (closes #27, #28)

#### #27 closed by Wave 20.L `role="region"` on `.plotOverlaysSlot`.

#### #28 — CCT scale describedby

[InspectorFixture.tsx:271-296](frontend/app/src/app/lighting/components/InspectorFixture.tsx)

```tsx
const cctScaleId = useId();
// ...
<input
  aria-label="Fixture CCT"
  aria-describedby={cctScaleId}
  /* existing */
/>;
{
  /* ... */
}
<div id={cctScaleId} className={styles.cctScale}>
  <span>{cctRange.min}K · warm</span>
  <span>{cctRange.max}K · cool</span>
</div>;
```

Drop the existing `aria-hidden="true"` on `.cctScale`.

### 21.D Slider `:focus-visible` (closes #29)

Already covered by Wave 20.A. No additional work — finding closes when 20.A lands.

### 21.E FixtureMarker focus + name handling (closes #30, #34, #35)

[FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx)

#### Truncate long names visually

Replace [line 118](frontend/app/src/app/lighting/components/FixtureMarker.tsx) `displayName = name.toUpperCase()` with:

```ts
const truncated = name.length > 18 ? `${name.slice(0, 17)}…` : name;
```

Use `truncated` (not uppercased) in the `<text>` element, applying `text-transform: uppercase` via inline `style`:

```tsx
<text
  /* existing position */
  fontSize={10}
  fontWeight={600}
  letterSpacing={0.8}
  style={{
    fill: LABEL_NAME_FILL,
    fontFamily: "var(--font-family-mono)",
    textTransform: "uppercase",
  }}
  pointerEvents="none"
>
  {truncated}
</text>
```

The `aria-label` at line 237 already uses the original `name` — SR users still get the full mixed-case name.

#### Focus-detection simplification (#30)

The existing manual `keyboardFocused` state with try/catch (lines 220-233) compensates for SVG `:focus-visible` quirks. Keep as-is — it works and removing it adds risk. Document with a code comment summarising the audit-fix-plan #29 rationale and close finding #30 as "verified, retained intentionally".

### 21.F Group chip aria trim (closes #36)

[GroupChip.tsx:43-45](frontend/app/src/app/lighting/components/GroupChip.tsx)

Replace:

```tsx
const powerAriaLabel = `${name} — ${fixtureLabel}${on ? `, ${level}%` : ""}${driftSuffix}, currently ${
  on ? "on" : "off"
}. Click to turn ${on ? "off" : "on"}.`;
```

With:

```tsx
const powerAriaLabel = `${name}, ${fixtureLabel}${on ? ` at ${level}%` : ""}${driftSuffix}, ${on ? "on" : "off"}. Toggle ${on ? "off" : "on"}.`;
```

### 21.G ConfirmDialog focus behaviour (closes #37)

Verified in Pre-work: ConfirmDialog has no explicit autofocus, defaults to first focusable child (cancel button — first in `actions`). This is the safe default for destructive prompts.

If the Pre-work check showed `Dialog.tsx` has no focus management, **add it**:

```tsx
const dialogRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  );
  firstFocusable?.focus();
}, []);
```

If autofocus already exists, mark #37 closed-by-verification.

### 21.H stage plot `role="application"` + SR-only instruction (closes #33)

Keep `role="application"` on the plot (arrow nudge is a documented design feature). Add an SR-only instruction inside the plot for context.

[StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) — add at the top of the inner JSX (just after the opening `<div role="application">`):

```tsx
<div className={styles.srOnly}>
  Stage plot. Use Tab to focus a fixture, then arrow keys to nudge its position. Hold Shift for 0.5 m steps.
</div>
```

Add `.srOnly` to [StagePlot.module.css](frontend/app/src/app/lighting/components/StagePlot.module.css):

```css
.srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### 21.I Multi-select / select-all gating (closes #38)

The shift-click-only path is the limitation. Wave 22.A adds ⌘A select-all. #38 closes when 22.A lands; nothing to do here.

### 21.J Master state name disambiguation (closes #39)

[MasterCard.tsx:43](frontend/app/src/app/lighting/components/MasterCard.tsx)

```tsx
const stateName = !bridgeReachable
  ? "Lighting offline"
  : anyOn
    ? "Lighting on"
    : fixtureTotal === 0
      ? "No fixtures"
      : "All fixtures off";
```

### 21.K Empty-state verb consistency (closes #40, #42)

Standardize on **Choose** for select-from-list, **Add** for create.

[LightingInspector.tsx:236](frontend/app/src/app/lighting/components/LightingInspector.tsx):

```tsx
<p className={styles.empty}>
  Choose a fixture on the stage plot to see its controls. Or use the toolbar search to find one by name.
</p>
```

[LightingInspector.tsx:253](frontend/app/src/app/lighting/components/LightingInspector.tsx):

```tsx
<p className={styles.empty}>Choose a group from the rail (chevron icon) to see its members.</p>
```

[GroupRail.tsx:53](frontend/app/src/app/lighting/components/GroupRail.tsx):

```tsx
<p className={styles.empty}>
  No groups yet.
  {onCreateGroup ? " Use + New group below to add one." : " Add fixtures to groups via the inspector."}
</p>
```

[InspectorPatch.tsx:57](frontend/app/src/app/lighting/components/InspectorPatch.tsx):

```tsx
<p className={styles.empty}>
  Choose a fixture on the stage plot to edit its DMX address. Press <kbd className={styles.kbd}>P</kbd> to leave patch
  mode.
</p>
```

### 21.L "+ Fixture button" → "Add fixture" (closes #41)

[LightingToolbar.tsx:122-126](frontend/app/src/app/lighting/components/LightingToolbar.tsx)

```tsx
<Button
  size="compact"
  variant="primary"
  onClick={onAddFixture}
  leadingVisual={<Plus aria-hidden="true" size={13} strokeWidth={2} />}
>
  Add fixture
</Button>
```

[StagePlot.tsx:230](frontend/app/src/app/lighting/components/StagePlot.tsx) empty-state copy already references `+ Fixture button` — update to `Add fixture button` for consistency:

```tsx
message =
  "Add your first fixture with the Add fixture button in the toolbar to start patching DMX addresses and saving scenes.";
```

### 21.M "Cut all" — locked retain (closes #43)

No change. Audit-fix-plan #43 accepted "Cut all"; this run validates that decision. Add a code comment at [MasterCard.tsx:89](frontend/app/src/app/lighting/components/MasterCard.tsx):

```tsx
{
  /* Naming: "Cut all" retained per audit-fix-plan #43 + Waves 19-22 plan locked decision. */
}
```

### 21.N "Re-apply scene" → "Recall scene" (closes #44)

[InspectorScene.tsx:236](frontend/app/src/app/lighting/components/InspectorScene.tsx)

Replace `Re-apply scene` with `Recall scene`.

### 21.O "Provenance" → "Last activity" (closes #45)

[InspectorScene.tsx:214](frontend/app/src/app/lighting/components/InspectorScene.tsx)

```tsx
<h3 className={styles.sceneSectionHead}>Last activity</h3>
```

### 21.P Group inspector "mixed" suffix removal (closes #46)

[InspectorGroup.tsx:65-69](frontend/app/src/app/lighting/components/InspectorGroup.tsx)

```tsx
<div className={styles.fixtureSubline}>
  <StatusDot state={dotState} size="sm" />
  {onCount}/{fixtures.length} on
</div>
```

(Drop the `{mixed ? " · mixed" : ""}` suffix.)

### 21.Q Bridge banner copy compaction (closes #47)

[LightingBridgeBanner.tsx:19-28](frontend/app/src/app/lighting/components/LightingBridgeBanner.tsx)

```tsx
const target = bridgeIp.trim() ? `${bridgeIp} · U${universe}` : `U${universe}`;
return (
  <StatusBand
    tone="error"
    title="DMX bridge unreachable"
    summary={`Lighting commands won't reach the rig until the bridge (${target}) responds. Check the network connection or run the bridge probe in Setup.`}
  />
);
```

### 21.R CreateFixtureDialog autoname gap fix (closes #48)

Add helper to [lightingHelpers.ts](frontend/app/src/app/lighting/lightingHelpers.ts):

```ts
export function nextLightingFixtureName(fixtures: ReadonlyArray<{ name: string }>): string {
  const usedNumbers = new Set<number>();
  const pattern = /^Fixture (\d+)$/;
  for (const fixture of fixtures) {
    const match = pattern.exec(fixture.name);
    if (match) usedNumbers.add(Number.parseInt(match[1]!, 10));
  }
  let candidate = 1;
  while (usedNumbers.has(candidate)) candidate += 1;
  return `Fixture ${candidate}`;
}
```

Use in [LightingWorkspace.tsx:1217](frontend/app/src/app/lighting/LightingWorkspace.tsx):

```tsx
defaultName={nextLightingFixtureName(fixtures)}
```

### 21.S Plot pill modified text indicator (closes #53)

Closed by Wave 20.L (the `state="modified"` PlotPill child renders "Active scene · modified" text).

### 21.T Identify "Identifying…" → "Bursting…"

[IdentifyBurstButton.tsx:75](frontend/app/src/app/lighting/components/IdentifyBurstButton.tsx)

```tsx
{
  active ? "Bursting…" : "Identify";
}
```

(Not in original 64; adjacent improvement caught during Wave 21 review. Mark in PR description as a sub-finding.)

### 21.U Stage plot grid contrast (closes #59)

Closed by Wave 19.A token alpha bumps (0.16/0.08/0.04 → 0.20/0.10/0.05).

### 21.V Search result count (closes #51)

[LightingRail.tsx:88-122](frontend/app/src/app/lighting/components/LightingRail.tsx)

Add a small helper near the top of the file (or co-locate in lightingHelpers.ts):

```ts
function filteredCount<T>(items: readonly T[], field: (item: T) => string, q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return items.length;
  return items.filter((item) => field(item).toLowerCase().includes(needle)).length;
}
```

Update both `RailHead count` props:

```tsx
<RailHead
  label="Scenes"
  count={
    patchMode
      ? "paused"
      : searchQuery
        ? `${filteredCount(scenes, (s) => s.name, searchQuery)} of ${scenes.length}`
        : `${scenes.length} saved`
  }
  /* ... */
/>
// ... and similarly for Groups RailHead
```

### 21.W Health bar bridge value/suffix de-duplication (closes #52)

[LightingHealthBar.tsx:84-88](frontend/app/src/app/lighting/components/LightingHealthBar.tsx)

```ts
{
  label: "Bridge",
  dot: reachable ? "ok" : "err",
  value: bridgeIp ? `${bridgeIp} · U${universe}` : `U${universe} · no IP`,
  suffix: reachable ? undefined : "unreachable",
},
```

### 21.X Validation gate for Wave 21

```bash
npm run frontend:typecheck
npm run lint
```

Manual smoke:

- Tab into inspector tabs, press ←/→ — focus moves between tabs.
- Open DMX monitor (⌘⇧M) — inspect via SR (VoiceOver: ⌘F5) — grid announces rows + cells.
- Tab into stage plot — SR announces the instruction.
- Long fixture name "Astra Bicolor Key Top Left" — plot shows "ASTRA BICOLOR K…"; SR reads full name.
- Universe shows "U1" everywhere.
- Add fixture, delete one, add another — name fills the gap.
- Search "Foo" — rail header shows "0 of 12" or similar count.
- Identify burst — button says "Bursting…" while active.

Auto-revert generated artefacts before staging.

---

## Wave 22 — Functional / behavioural improvements

Closes #49, #50, #57, #58, #60, #61, #62. ~400 LOC. No persisted-state changes.

### 22.A ⌘A select all fixtures (closes #38, #49 partial)

[LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) keyboard handler (line ~914 onwards). The handler already gates on `isEditableTarget(event.target)` (line 916) so ⌘A in the toolbar search field still selects input text.

Add a branch after the existing modifier+z handling:

```tsx
if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a") {
  event.preventDefault();
  const all = new Set(fixtures.map((f) => f.id));
  setExtraSelectedFixtureIds(all);
  if (!persistedSelectedFixtureId && fixtures.length > 0) {
    void store.updateLightingSettings({ selectedFixtureId: fixtures[0]!.id });
  }
  return;
}
```

Document in [KeyboardShortcutsPopover.tsx](frontend/app/src/app/lighting/components/KeyboardShortcutsPopover.tsx) Selection group:

```tsx
{ keys: ["⌘", "A"], description: "Select all fixtures" },
```

### 22.B Number keys 1-9 quick recall (closes #50)

[LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) keyboard handler — add inside the existing un-modified-key block (after the `s` handler, before `Escape`):

```tsx
if (/^[1-9]$/.test(event.key)) {
  const idx = Number.parseInt(event.key, 10) - 1;
  if (idx < scenes.length) {
    event.preventDefault();
    void handleRecallScene(scenes[idx]!.id);
  }
  return;
}
```

Existing `isEditableTarget` gate (line 916) prevents firing while typing in inputs.

Document in [KeyboardShortcutsPopover.tsx](frontend/app/src/app/lighting/components/KeyboardShortcutsPopover.tsx):

```tsx
{ heading: "Quick recall", entries: [{ keys: ["1"], description: "Recall scene 1 · 2-9 for the next 8 scenes" }] }
```

### 22.C ⌘F focus toolbar search (closes #49)

[LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) keyboard handler:

```tsx
if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
  event.preventDefault();
  document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  return;
}
```

Document in shortcuts popover (Search heading or merge into existing Selection):

```tsx
{ keys: ["⌘", "F"], description: "Focus toolbar search" }
```

### 22.D Identify burst pulses plot marker (closes #62)

State threading:

[LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — add state and extend `handleIdentifyBurst`:

```tsx
const [identifyingIds, setIdentifyingIds] = useState<ReadonlySet<string>>(() => new Set());

const handleIdentifyBurst = useEffectEvent(async (fixtureId: string, fixtureName: string) => {
  setIdentifyingIds((prev) => {
    const next = new Set(prev);
    next.add(fixtureId);
    return next;
  });
  window.setTimeout(() => {
    setIdentifyingIds((prev) => {
      const next = new Set(prev);
      next.delete(fixtureId);
      return next;
    });
  }, 1200);
  // existing IPC body retained:
  setBusyAction(`fixture-identify:${fixtureId}`);
  try {
    await store.identifyLightingFixture(fixtureId);
    setFeedback({ message: `Identify burst sent to '${fixtureName}'.`, tone: "ok" });
  } catch (error) {
    reportError(error, "Identify burst failed.");
  } finally {
    setBusyAction(null);
  }
});
```

Pass to `<StagePlot>`:

```tsx
<StagePlot
  /* existing props */
  identifyingFixtureIds={identifyingIds}
/>
```

[StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) — add prop, pass through to FixtureMarker:

```ts
identifyingFixtureIds?: ReadonlySet<string>;
```

```tsx
<FixtureMarker
  /* existing */
  identifying={identifyingFixtureIds?.has(fixture.id) ?? false}
/>
```

[FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) — add prop and render an extra SVG circle when `identifying`:

```tsx
{
  identifying ? (
    <circle
      cx={renderX}
      cy={renderY}
      r={mounting === "wall-bar" ? 36 : 22}
      fill="none"
      style={{ stroke: "var(--color-brand-green)" }}
      strokeWidth={2}
      pointerEvents="none"
    >
      <animate attributeName="r" values="14;28;14" dur="0.4s" repeatCount="3" />
      <animate attributeName="opacity" values="1;0.3;1" dur="0.4s" repeatCount="3" />
    </circle>
  ) : null;
}
```

(Total animation 1.2s matches engine burst duration. SVG `<animate>` runs natively without `prefers-reduced-motion` checks — if reduced motion is critical here, gate via JS by checking `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and rendering a static circle instead.)

### 22.E Skeleton "Connecting" state (closes #60)

[LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — early return for null snapshot, after destructuring:

```tsx
if (!lightingSnapshot) {
  return (
    <div className={styles.shell}>
      <div className={styles.connectingState} role="status" aria-live="polite">
        <p className={styles.connectingTitle}>Connecting to lighting engine…</p>
        <p className={styles.connectingHint}>
          Loading the rust engine snapshot. This usually takes a fraction of a second.
        </p>
      </div>
    </div>
  );
}
```

Add styles to [LightingWorkspace.module.css](frontend/app/src/app/lighting/LightingWorkspace.module.css):

```css
.connectingState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 24px;
}
.connectingTitle {
  font-family: var(--font-family-display);
  font-variation-settings: "opsz" 24;
  font-weight: 600;
  font-size: 18px;
  color: var(--color-brand-text-primary);
  margin: 0;
}
.connectingHint {
  font-family: var(--font-family-ui);
  font-size: 12px;
  color: var(--color-brand-text-muted);
  margin: 0;
  max-width: 340px;
  text-align: center;
}
```

### 22.F DMX monitor max-height responsive (closes #58)

[DMXMonitorDialog.module.css:42](frontend/app/src/app/lighting/components/DMXMonitorDialog.module.css)

```css
max-height: min(540px, 70vh);
```

### 22.G `busyAction` Set refactor (closes #61)

Refactor `busyAction: string | null` to `busyActions: ReadonlySet<string>` to prevent parallel-mutation stomping.

[LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx):

```tsx
const [busyActions, setBusyActions] = useState<ReadonlySet<string>>(() => new Set());
const startBusy = useCallback((key: string) => {
  setBusyActions((prev) => {
    const n = new Set(prev);
    n.add(key);
    return n;
  });
}, []);
const finishBusy = useCallback((key: string) => {
  setBusyActions((prev) => {
    const n = new Set(prev);
    n.delete(key);
    return n;
  });
}, []);
```

Replace every `setBusyAction("X")` ... `setBusyAction(null)` pair with `startBusy("X")` ... `finishBusy("X")`. Audit all call sites — the file has ~17 such pairs.

Update consumer prop interface — `LightingInspector` and child inspectors take `busyAction: string | null`. Two options:

1. **Keep prop name, change semantics**: pass `busyActions` as a `ReadonlySet<string>` but rename prop to `busyActions`. Requires touching all consumers.
2. **Compatibility shim**: keep `busyAction: string | null` prop signature, derive from set as "first active key or null". Loses information but minimal touch.

**Recommended: Option 1** (clean refactor). Touch [LightingInspector.tsx](frontend/app/src/app/lighting/components/LightingInspector.tsx) and downstream:

- Replace `busyAction: string | null` with `busyActions: ReadonlySet<string>`.
- Replace every `busyAction === "X"` check with `busyActions.has("X")`.
- Replace every `busyAction?.startsWith("X")` check with `Array.from(busyActions).some((key) => key.startsWith("X"))` or add a helper `busyHasPrefix(busyActions, prefix)`.

Files affected (search for `busyAction`):

- LightingWorkspace.tsx (state + handler edits)
- LightingInspector.tsx (prop + threading)
- InspectorScene.tsx, InspectorFixture.tsx, InspectorFixtureBulk.tsx, InspectorGroup.tsx, InspectorPatch.tsx (consume specific keys)

Run `grep -rn "busyAction" frontend/app/src/app/lighting/` first to inventory all sites before editing.

### 22.H CreateFixtureDialog / RenameDialog keyboard contract (closes #57)

Closed by Pre-work verification. If Pre-work showed both dialogs have the expected behaviour (Enter submits, Escape cancels via Dialog onClose, focus + select on mount), no code change. If verification revealed a gap, fix it here:

- **Enter submits**: both dialogs use `<form onSubmit={handleSubmit}>` — Enter inside any input triggers submit. ✓
- **Escape cancels**: provided by `<Dialog onClose={onCancel}>` — verify Dialog.tsx wires Escape to onClose. If not, add to Dialog.tsx.
- **Focus on mount**: RenameDialog explicitly focuses + selects (line 42-48). CreateFixtureDialog has no explicit focus call — rely on Dialog's autofocus (Wave 21.G fix). Verify this matches expected behaviour.
- **Focus return on close**: standard Dialog responsibility. Verify if absent.

### 22.I Validation gate for Wave 22

```bash
npm run frontend:typecheck
npm run lint
grep -rn "busyAction" frontend/app/src/app/lighting/
# Expect: no remaining references to old singular busyAction
```

Manual smoke:

- ⌘A — every fixture marker shows selection ring.
- 1-9 — recalls scenes by index.
- ⌘F — toolbar search receives focus.
- Click Identify — fixture marker pulses for 1.2s.
- Hard-reload `tauri:dev` — see "Connecting to lighting engine…" briefly.
- Resize window vertically — DMX monitor modal scales.
- Trigger two parallel mutations (e.g. start saving Scene A, immediately rename Scene B) — both spinners visible simultaneously, neither stomps the other.
- All Wave 21 keyboard shortcut popover entries present.

Cross-wave gate: `npm run dev:check` (full lint, typecheck, rust:fmt, clippy, protocol, native:check, native:test). Auto-revert generated artefacts before staging.

---

## Wave 23 — Larger features (require explicit go-ahead)

Do not start any of these without confirming with the user, scoping the persistence story, and locking the migration plan. Per memory: "Explicit go-ahead required for invasive operations".

### 23.A Scene rail virtualization (#54)

Add `react-window` dep. Threshold: virtualize when `scenes.length > 30`. Use `FixedSizeGrid` (rail is 2-col grid). Interaction with 23.B drag-reorder must be planned together.

### 23.B Drag-to-reorder scenes (#55)

Requires new persisted field on `LightingSceneSnapshot` (e.g. `displayIndex: number`) plus new IPC `lighting.scene.reorder { sceneId, beforeSceneId | null }`. Engine schema change — invasive.

### 23.C Favorites / Pinned / Recent (#56)

Requires new persisted state. Either `LightingSceneSnapshot.pinned: boolean` or a parallel `pinnedSceneIds: readonly string[]` on the lighting snapshot. Engine schema change — invasive.

### 23.D Title-bar drift indicator (#63)

When `isSceneModified === true`, append " · ●" to the window title via `@tauri-apps/api/window`. Touches Tauri shell; minor scope. Doable additively but worth confirming with user since it touches OS-visible state.

---

## Cross-wave validation

After all four waves land:

```bash
npm run dev:check
```

Expected: all green (format, lint, rust:fmt, clippy, protocol:check, frontend:typecheck, native:check, native:test).

`npm run tauri:visual:review` per AGENTS.md "Visual Review Discipline". Inspect on BetterDisplay 2560×1440. Do not run §3.8 release-evidence cycles without explicit go-ahead.

Windows target-host (`tauri:smoke:win`) runs in the Windows-Claude session against `origin/main` after merge. Mac side does not run it.

## Finding closure checklist

Track here as each wave lands. Tick when verified passing the wave validation gate.

| #   | Title                                     | Wave                                     | Closed |
| --- | ----------------------------------------- | ---------------------------------------- | ------ |
| 1   | CCT slider hardcoded hexes                | 19.B.1                                   |        |
| 2   | PatchAddressTag SVG hardcodes             | 19.B.2                                   |        |
| 3   | FixtureMarker constants                   | 19.B.3                                   |        |
| 4   | StudioFloor hardcodes                     | 19.B.4                                   |        |
| 5   | StagePlot beam-line stroke                | 19.B.5                                   |        |
| 6   | StagePlot.module.css fallback drops       | 19.B.7                                   |        |
| 7   | Universe casing drift                     | 19.B.14                                  |        |
| 8   | SceneTile aria-pressed + aria-current     | 19.B.15                                  |        |
| 9   | Slider thumb hover/focus rings            | 20.A                                     |        |
| 10  | Button :active states                     | 20.B + 20.C                              |        |
| 11  | Scene tile recall transition              | 20.D                                     |        |
| 12  | Plot patch-mode filter                    | 20.H                                     |        |
| 13  | Master toggle inset shadow                | 20.G                                     |        |
| 14  | Master card on-state glow                 | 20.G                                     |        |
| 15  | GroupChip drift triangles                 | 20.E.1                                   |        |
| 16  | StagePlotControls glyphs                  | 20.E.2                                   |        |
| 17  | Toast auto-dismiss                        | 20.F                                     |        |
| 18  | Feedback dismiss × → X icon               | 20.E.3                                   |        |
| 19  | Scene tile thumb 16/11 → 16/9             | 20.N                                     |        |
| 20  | Plot reset animation                      | 20.O                                     |        |
| 21  | Beam pool intensity recalibration         | 20.I                                     |        |
| 22  | Fixture marker depth                      | 20.J                                     |        |
| 23  | Beam length indicator gradient            | 20.K                                     |        |
| 24  | Plot pill / meta migration + drop-shadow  | 20.L + 20.M                              |        |
| 25  | Vignette softening                        | 19.B.8                                   |        |
| 26  | Inspector tablist arrow-key nav           | 21.A                                     |        |
| 27  | Plot overlays SR exposure                 | 20.L (region role)                       |        |
| 28  | CCT scale aria-describedby                | 21.C                                     |        |
| 29  | Slider :focus-visible                     | 20.A                                     |        |
| 30  | FixtureMarker focus simplification        | 21.E                                     |        |
| 31  | DMX Monitor role="row"                    | 21.B                                     |        |
| 32  | Native title attrs (3 sites)              | retained per audit-fix-plan #33 — verify |        |
| 33  | role="application" reconsideration        | 21.H                                     |        |
| 34  | Long fixture name truncation              | 21.E                                     |        |
| 35  | name.toUpperCase() → CSS                  | 21.E                                     |        |
| 36  | Group chip aria trim                      | 21.F                                     |        |
| 37  | ConfirmDialog autofocus                   | Pre-work + 21.G                          |        |
| 38  | Select-all affordance                     | 22.A                                     |        |
| 39  | "Lighting paused" disambiguation          | 21.J                                     |        |
| 40  | Empty-state verb consistency              | 21.K                                     |        |
| 41  | "+ Fixture button" → "Add fixture"        | 21.L                                     |        |
| 42  | Inspector empty mentions search           | 21.K                                     |        |
| 43  | "Cut all" — locked retain                 | 21.M                                     |        |
| 44  | "Re-apply scene" → "Recall scene"         | 21.N                                     |        |
| 45  | "Provenance" → "Last activity"            | 21.O                                     |        |
| 46  | Group "mixed" suffix removal              | 21.P                                     |        |
| 47  | Bridge banner copy                        | 21.Q                                     |        |
| 48  | CreateFixtureDialog autoname gaps         | 21.R                                     |        |
| 49  | ⌘F focus search                           | 22.C                                     |        |
| 50  | 1-9 quick recall                          | 22.B                                     |        |
| 51  | Search result count                       | 21.V                                     |        |
| 52  | Health bar bridge value/suffix            | 21.W                                     |        |
| 53  | Plot pill modified text                   | 20.L + 21.S                              |        |
| 54  | Scene rail virtualization                 | 23.A — gated                             |        |
| 55  | Drag-to-reorder scenes                    | 23.B — gated                             |        |
| 56  | Favorites / Recents                       | 23.C — gated                             |        |
| 57  | Dialog keyboard contract                  | Pre-work + 22.H                          |        |
| 58  | DMX monitor max-height responsive         | 22.F                                     |        |
| 59  | Stage plot grid contrast                  | 19.A token alpha bumps                   |        |
| 60  | Skeleton/connecting state                 | 22.E                                     |        |
| 61  | busyAction parallel-mutation              | 22.G                                     |        |
| 62  | Identify burst plot pulse                 | 22.D                                     |        |
| 63  | Title-bar drift indicator                 | 23.D — gated                             |        |
| 64  | lightingFixtureColor surface-500 dead ref | 19.B.13                                  |        |

## Risk & rollback

- **Generated tokens.css**: if Wave 19 token regeneration produces unexpected diffs, revert all of Wave 19 and re-investigate the Style Dictionary config. `core.json` is the contract.
- **Button :active in design-system (20.B)**: changes propagate to all consumers. Smoke other workspaces.
- **`lightingFixtureColor` change (19.B.13)**: affects beam pool, fixture marker dot, scene chip swatch. Visual change but not behavioural. If the new ramp looks wrong, revert just that function.
- **busyAction refactor (22.G)**: non-trivial; ~17 call sites. Run typecheck after each consumer migration to catch missed sites early.
- **Animations (20.D, 20.F, 22.D)**: respect `prefers-reduced-motion`. Verify via macOS System Settings → Accessibility → Display → Reduce motion.

## Out of scope (explicitly NOT in this plan)

- The 5 "edge cases worth a quick test" items deferred from audit-fix-plan: long-name layouts beyond truncation in 21.E, 30+ scene virtualization beyond 23.A, narrow-window responsive (binding constraint is fixed-resolution), zoom extremes beyond what 20.O addresses, bridge flicker fault injection.
- Engine schema changes — none in Waves 19-22; gated to user approval in Wave 23.
- New IPC names — none.
- Storybook stories for the few new lighting primitives or for design-system additions.
- §3.8 release-evidence cycles, target-host validation outside of normal run, public signing.
- Onboarding tours, presence indicators, multi-user features.
