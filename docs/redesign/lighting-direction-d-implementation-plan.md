---
workspace: lighting
phase: D (direction locked, implementation queued)
status: historical-reference
chosen_direction: D — Scene desk
supersedes: Cr — Spatial desk (docs/redesign/lighting.md)
prototype: docs/redesign/assets/lighting/Lighting-D-Scene-Desk.html
authored: 2026-04-27
current_truth: docs/HANDOFF.md
---

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

# Lighting · Direction D — Scene desk · Implementation Plan

> Self-contained plan. A fresh Claude Code session should be able to load `MEMORY.md` (auto), `CLAUDE.md` → `AGENTS.md`, `docs/HANDOFF.md`, then this file, and start coding without further discovery. All file paths verified against the worktree at write time.

## Status & meta

- **Direction D — Scene desk** supersedes the locked Direction Cr in [docs/redesign/lighting.md](./lighting.md). The visual proposal is the v6 prototype at [docs/redesign/assets/lighting/Lighting-D-Scene-Desk.html](./assets/lighting/Lighting-D-Scene-Desk.html). Open it on the BetterDisplay 2560 × 1440 review surface to see operator size.
- Product memory in `~/.claude/projects/.../memory/project_lighting_workspace_product_model.md` records the two-persona, recall-driven, no-cue model. **Do not reintroduce cue concepts.**
- Brand integration follows the SSE Brand Guidelines Vol.01 (palette, typeface posture). The codebase already has `--accent-primary: #99BA92` (SSE Green) — no rebrand of the primary, just additive complementary semantics + typeface migration.

## Phase 0 — Discovery findings (2026-04-27)

These were verified before this plan was written. Subsequent sessions can trust the citations.

### F1. Token system

- **Canonical source**: [frontend/packages/tokens/src/source/tokens.json](../../frontend/packages/tokens/src/source/tokens.json). Build script: [frontend/packages/tokens/scripts/build-tokens.mjs](../../frontend/packages/tokens/scripts/build-tokens.mjs) reads ONLY this file, flattens, emits CSS / TS / docs into `src/generated/`.
- **Orphan**: [frontend/packages/tokens/src/tokens/core.json](../../frontend/packages/tokens/src/tokens/core.json) exists but is not consumed by the build script. Treat it as a parallel exploration; the canonical source is `tokens.json`. Do not edit `core.json` for D — propose deleting in PR 1 or PR 4 to avoid future confusion.
- **Existing palette** (relevant to D):
  - `color.accent.primary = #99BA92` ✓ already SSE Green — keep
  - `color.accent.primarySoft / primaryGlow` ✓ keep
  - `color.studio.{050..950}` — neutral cool greyscale; **D shifts to warm-tinted darks**, so we add new green-tinted surface tokens additively rather than recoloring `studio-*` (avoid breaking other workspaces)
  - `color.surface.{default, soft, raised, strongTop, strongBottom, border, borderStrong, stroke}` ✓ keep names; values may shift to warm-tinted in D; verify no other workspace depends on the cool grey hue at the borderline
  - `color.shell.*`, `color.stage.*`, `color.focus.ring` — tokens exist already
  - `font.family.{ui, mono}` = IBM Plex Sans / Mono → **D migrates to Inter (UI) + Fraunces (display) + JetBrains Mono (data)**
  - `radius.{badge, card, soft, surface, surfaceStrong, pill}` (6 / 10 / 18 / 20 / 24 / 999) — **D wants sharper 4–8 px architecture**; add new `radius.{xs, sm, md, lg}` (3 / 4 / 6 / 8 px) without removing the soft scale (other workspaces use it)
  - `space.{2..10}` (4..20 px) ✓ adequate
  - `size.toolbarHeight = 44` ✓
- **D-specific token additions** required (see PR 1 §1):
  - `color.brand.{green, darkGreen, yellow, blue, blueHot, burgundy, coral, sky}` + `Soft`/`Border` variants
  - `color.text.{primary, secondary, muted, faint}` (Beige Light family)
  - `color.bg.{deep, canvas}` (warm-tinted near-black)
  - `color.cct.{2700..6500}` (brand-biased ramp)
  - `color.glass.{bg, border}` and `shadow.{insetHi, sm, md, lg, glass, glowGreen, glowYellow, glowBlue}`
  - `font.family.{display, ui, mono}` repointed
  - `size.shellHeight = 92px` (was 76 / not parameterised), `size.healthBarHeight = 64px`

### F2. Design-system inventory

[frontend/packages/design-system/src/index.ts](../../frontend/packages/design-system/src/index.ts) exports:

`AppShellFrame` · `Button` · `CueRail` · `DenseList`/`DenseListRow`/`DenseTable` · `Dialog` · `EmptyState`/`DegradedState` · `IconButton` · `InspectorPanel`/`InspectorSection` · `MeterBridge` · `MetricCard` · `SegmentedControl` · `StatusBadge` · `StatusBand` · `StatusPill` · `Surface` · `ToggleButton` · `Toolbar`/`ToolbarGroup`

What we can reuse:

- **`Toolbar` / `ToolbarGroup`** — fits the workspace toolbar row
- **`InspectorPanel` / `InspectorSection`** — likely fits Direction D's inspector if its API supports tabs (verify in PR 3.0)
- **`StatusBadge` / `StatusPill` / `StatusBand`** — for the chip / health vocabulary; verify tone variants cover green/yellow/blue/burgundy/coral
- **`ToggleButton`** — verify it can serve as the master toggle and per-fixture power toggle
- **`Surface`** — backing card (already used in Lighting today)
- **`Button`** — for primary / ghost / patch actions
- **`Dialog`** — for any modal flows (delete fixture, save scene)
- **`SegmentedControl`** — possibly for inspector tab strip if `InspectorPanel` does not own tabs

What needs net-new in design-system (cross-workspace reuse plausible):

- **`Crest`** — wraps the official SSE ExEd PNG/SVG with size variants
- **`NavItem`** — workspace nav button with optional 16 px line icon + active state (consumed by `AppShellFrame` rewrite)
- **`StatusDot`** — single semantic dot (`ok`/`attn`/`err`/`info`) used in chips, health, plot pills
- **`HealthBar`** + `HealthItem` — full-width status bar with N items (Audio / Setup may reuse)
- **`PlotPill`** — glass overlay (backdrop-blur, border-top highlight) — Audio meter overlays could also benefit
- **`PlotMeta`** — small mono info chip in glass treatment

What lives only in the Lighting workspace (not promoted to design-system):

- `MasterCard`, `RailDivider`, `RailHead`, `SceneTile`, `SceneThumbnail`, `GroupChip` (Lighting-flavoured), `StagePlot` + sub-components (`StudioFloor`, `FixtureMarker`, `LightPool`, `PatchAddressTag`), `DMXPeek`, `DMXChannel`, `IdentifyBurstButton`

**Existing `CueRail` primitive** is currently used to render Cr's cue list. Direction D has no cues. Decision: leave the primitive in design-system (no breaking removal in PR 1), strip its consumer in PR 3, mark for deletion in PR 4 (cue cleanup). No exports change in PR 1.

### F3. App shell — single source of truth

- The shell is **centralised**: [frontend/packages/design-system/src/components/AppShellFrame.tsx](../../frontend/packages/design-system/src/components/AppShellFrame.tsx). The only consumer is [frontend/app/src/app/OperatorShell.tsx](../../frontend/app/src/app/OperatorShell.tsx). Changes to `AppShellFrame` propagate uniformly across all workspaces.
- **Current shell layout** (from [AppShellFrame.module.css](../../frontend/packages/design-system/src/components/AppShellFrame.module.css)):
  - Top: `monitorRail` strip with brand wordmark + status pills (`monitorItems`)
  - Left: `workspaceRail` vertical column with workspace buttons (`workspaces`)
  - Center: `main` with optional `mainHeader` (eyebrow / title / subtitle)
  - Right: optional `contextRail` (`contextSections`)
- **D restructures this:**
  - Replace top monitorRail + left workspaceRail with **a single top header** (~92 px) that contains: SSE ExEd brand mark · vertical divider · workspace nav (horizontal, with icons) · clock / status. Status pills from `monitorItems` are folded into the workspace nav row as small chips, OR removed (per F4 they don't carry critical info during a session).
  - `mainHeader` (eyebrow / title / subtitle) is **deprecated** for Direction D. Set the existing `hideMainHeader` to default `true` going forward; workspaces own their own toolbar.
  - `contextRail` survives (may be used by Setup/Planning), but Lighting passes empty `contextSections`.
- Cross-workspace impact is real: Setup, Planning, Audio, Stream Deck inherit the new shell automatically. Their content does not change.

### F4. Lighting workspace today

- Single file: [frontend/app/src/app/lighting/LightingWorkspace.tsx](../../frontend/app/src/app/lighting/LightingWorkspace.tsx) (3,649 LOC). Imports only `Button`, `StatusBadge`, `Surface` from design-system; everything else is hand-rolled inside.
- Uses CSS Modules: [LightingWorkspace.module.css](../../frontend/app/src/app/lighting/LightingWorkspace.module.css) — large, paired with the monolith.
- Helpers: [lightingHelpers.ts](../../frontend/app/src/app/lighting/lightingHelpers.ts) (CCT ramp, beam geometry, fixture color, room dims constant `LIGHTING_ROOM_WIDTH_METERS = 12`, section definitions, search predicates, formatting), [lightingPatch.ts](../../frontend/app/src/app/lighting/lightingPatch.ts) (DMX patch logic).
- Lassoo / multi-select / sections / cues are all wired today — Direction D removes cues and de-emphasises lasso (out of scope but not a blocker; can be left in or removed based on PR 3 scope discipline).
- Snapshot consumption (`getLightingFixtures`, `getLightingScenes`, `getLightingCues`, `getLightingGroups`, etc.) is already encapsulated in `../shellData.ts`.
- **Persisted UI state** lives on `appSnapshot.shell.lighting`: `selectedCueId`, `currentSectionId`. D will keep `currentSectionId` (sections remain useful even without cues) and stop reading `selectedCueId`.

### F5. Engine / IPC surface

- **`LightingFixtureSnapshot`** (in [frontend/packages/engine-client/src/generated/snapshots/LightingFixtureSnapshot.ts](../../frontend/packages/engine-client/src/generated/snapshots/LightingFixtureSnapshot.ts)) — verified to exist. Confirmed by Cr §5b that `rigZ` and `beamAngleDegrees` are already shipped. **Mounting type (grid / stand / wall) is NOT in the snapshot.** Decision (per "go with your defaults"): for Direction D, **derive mounting visually from the fixture `type` string** in a frontend helper. No engine/protocol change required.
  - Apollo Bridge → grid (panel)
  - Astra Bi-Color → stand (small panel)
  - Aputure Infinimat → grid (large soft)
  - Infinibar PB12 → wall / backdrop (linear bar)
  - Default → stand
- **`LightingDmxMonitorSnapshot`** — exists; verify in PR 3.0 whether it carries refresh-rate (Hz). If not, the Health bar shows a static "—" for refresh rate or omits it. Adding refresh rate to the engine snapshot is out of scope for D; treat as a follow-up if the operator demands it.
- **`LightingSpatialMarker`** type exists in the snapshots — could in principle carry walls / cameras / talent marks. **Decision**: do not use yet. For D, render the studio floor (12 m × 8 m, walls, backdrop, door, control booth, bench, talent marks, cameras) from a **hardcoded `studioLayout` constant** in a new file [frontend/app/src/app/lighting/studioLayout.ts](../../frontend/app/src/app/lighting/studioLayout.ts). Shape the constant so it could later be replaced by a persisted blob without component changes (object literal with same fields the renderer expects). A settings UI to edit it is a future phase.
- **IPC handlers in scope for D** (no protocol change):
  - `lighting.snapshot` (read)
  - `lighting.dmxMonitor.snapshot` (read)
  - `lighting.fixture.create / update / delete`
  - `lighting.group.create / update / delete / power`
  - `lighting.scene.create / update / delete / recall`
  - `lighting.power.all`
  - `lighting.settings.update`
- **IPC orphaned by D** (Phase 4 cleanup):
  - `lighting.cue.create / update / delete / fire`
  - Persistence keys `app.lighting.cues`, `app.lighting.active_cue_id`
  - `LightingCueSnapshot` type, `cues` and `activeCueId` fields on `LightingSnapshot`

### F6. Fonts

The repo currently uses IBM Plex via `--font-family-ui` and `--font-family-mono`. There are no `@font-face` declarations against bundled `.woff2` files — IBM Plex appears to come from system fallback. For Direction D we need:

- **Fraunces** (display, variable opsz axis) — SIL OFL 1.1
- **Inter** (UI body) — SIL OFL 1.1
- **JetBrains Mono** (data) — Apache 2.0

All three are redistributable. PR 1 bundles `.woff2` files locally under [frontend/app/src/assets/fonts/](../../frontend/app/src/assets/fonts/) (create directory) and adds `@font-face` declarations to a new global stylesheet (or to [frontend/packages/design-system/src/styles/global.css](../../frontend/packages/design-system/src/styles/global.css)). **No CDN fetch at runtime** — studio is offline-first.

## Plan-of-record (4 PRs)

| #                     | PR title                                                                                       | Branch suggestion                | Touches                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| **PR 1**              | `feat(design-system): brand-aligned tokens, typeface migration, shell upgrade for Direction D` | `feat/lighting-d-foundation`     | Tokens, fonts, design-system primitives, AppShellFrame redesign                                    |
| **PR 2**              | `docs(redesign): Lighting Direction D — Scene desk supersedes Cr`                              | `docs/lighting-direction-d`      | `docs/redesign/lighting.md` rewrite, this plan moves to "executing", `docs/HANDOFF.md` line update |
| **PR 3**              | `feat(lighting): Direction D — Scene desk workspace rewrite`                                   | `feat/lighting-direction-d-impl` | `LightingWorkspace.tsx` decomposition, new sub-components, helpers                                 |
| **PR 4** _(deferred)_ | `chore(lighting): remove orphaned cue model`                                                   | `chore/lighting-remove-cues`     | Engine + protocol + persistence cleanup                                                            |

Run them in order. PR 2 can land between PR 1 and PR 3, OR PR 3 can land first and PR 2 follow within the same week — but PR 1 must precede PR 3 because PR 3 consumes its primitives.

---

## PR 1 — Foundation

### 1.1 Token additions

Edit [frontend/packages/tokens/src/source/tokens.json](../../frontend/packages/tokens/src/source/tokens.json). Append (do not remove existing keys):

**Note on the build script.** [build-tokens.mjs](../../frontend/packages/tokens/scripts/build-tokens.mjs) does **not** resolve token references like `{color.accent.primary}` — it passes `$value` through verbatim into the generated CSS. So all `$value` entries below use literal hex / rgba; the alias relationship to `accent.primary` lives in commentary, not in the value.

```json
{
  "color": {
    "brand": {
      "green": { "$type": "color", "$value": "#99BA92" },
      "greenHot": { "$type": "color", "$value": "#b5d4ad" },
      "greenSoft": { "$type": "color", "$value": "rgba(153, 186, 146, 0.16)" },
      "greenGlow": { "$type": "color", "$value": "rgba(153, 186, 146, 0.10)" },
      "greenBorder": { "$type": "color", "$value": "rgba(153, 186, 146, 0.55)" },

      "darkGreen": { "$type": "color", "$value": "#1f4d38" },
      "darkGreenMid": { "$type": "color", "$value": "#2c6a4f" },
      "darkGreenSoft": { "$type": "color", "$value": "rgba(31, 77, 56, 0.5)" },

      "yellow": { "$type": "color", "$value": "#e8d561" },
      "yellowSoft": { "$type": "color", "$value": "rgba(232, 213, 97, 0.16)" },
      "yellowBorder": { "$type": "color", "$value": "rgba(232, 213, 97, 0.5)" },

      "blue": { "$type": "color", "$value": "#3f70c8" },
      "blueHot": { "$type": "color", "$value": "#6a93dc" },
      "blueSoft": { "$type": "color", "$value": "rgba(63, 112, 200, 0.16)" },
      "blueBorder": { "$type": "color", "$value": "rgba(63, 112, 200, 0.55)" },

      "burgundy": { "$type": "color", "$value": "#6b1f1f" },
      "burgundySoft": { "$type": "color", "$value": "rgba(107, 31, 31, 0.16)" },

      "coral": { "$type": "color", "$value": "#ed7c5e" },
      "coralSoft": { "$type": "color", "$value": "rgba(237, 124, 94, 0.16)" },

      "sky": { "$type": "color", "$value": "#c8d4dd" }
    },
    "text": {
      "primary": { "$type": "color", "$value": "#faf6e6" },
      "secondary": { "$type": "color", "$value": "#d4cdb3" },
      "muted": { "$type": "color", "$value": "#8a8470" },
      "faint": { "$type": "color", "$value": "#5a5547" }
    },
    "bg": {
      "deep": { "$type": "color", "$value": "#0a0d0a" },
      "canvas": { "$type": "color", "$value": "#0e110e" }
    },
    "cct": {
      "2700": { "$type": "color", "$value": "#ef8e5a" },
      "3200": { "$type": "color", "$value": "#f3a87a" },
      "3800": { "$type": "color", "$value": "#f6c39a" },
      "4400": { "$type": "color", "$value": "#f0dfb8" },
      "5000": { "$type": "color", "$value": "#ebe5d2" },
      "5600": { "$type": "color", "$value": "#d4dde2" },
      "6500": { "$type": "color", "$value": "#c8d4dd" }
    },
    "glass": {
      "bg": { "$type": "color", "$value": "rgba(8, 10, 8, 0.78)" },
      "bgBlue": { "$type": "color", "$value": "rgba(7, 12, 22, 0.82)" },
      "border": { "$type": "color", "$value": "rgba(250, 246, 230, 0.08)" }
    }
  },
  "radius": {
    "xs": { "$type": "dimension", "$value": "3px" },
    "sm": { "$type": "dimension", "$value": "4px" },
    "md": { "$type": "dimension", "$value": "6px" },
    "lg": { "$type": "dimension", "$value": "8px" }
  },
  "size": {
    "shellHeight": { "$type": "dimension", "$value": "92px" },
    "healthBarHeight": { "$type": "dimension", "$value": "64px" }
  },
  "shadow": {
    "insetHi": { "$type": "shadow", "$value": "inset 0 1px 0 rgba(250, 246, 230, 0.05)" },
    "insetHiStrong": { "$type": "shadow", "$value": "inset 0 1px 0 rgba(250, 246, 230, 0.08)" },
    "sm": { "$type": "shadow", "$value": "0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(250, 246, 230, 0.04)" },
    "md": { "$type": "shadow", "$value": "0 4px 12px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(250, 246, 230, 0.05)" },
    "lg": { "$type": "shadow", "$value": "0 12px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(250, 246, 230, 0.06)" },
    "glass": { "$type": "shadow", "$value": "0 8px 24px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(250, 246, 230, 0.10)" }
  },
  "font": {
    "family": {
      "ui": { "$type": "fontFamily", "$value": "\"Inter\", system-ui, sans-serif" },
      "mono": { "$type": "fontFamily", "$value": "\"JetBrains Mono\", ui-monospace, monospace" },
      "display": { "$type": "fontFamily", "$value": "\"Fraunces\", \"Source Serif 4\", Georgia, serif" }
    }
  }
}
```

Note that `font.family.ui` and `font.family.mono` are repointed (was IBM Plex). `font.family.display` is new. If any current consumer relies on the IBM Plex string literal, search for `IBM Plex` across the repo and either repoint or leave a fallback alias. The CSS variable name (`--font-family-ui`) is unchanged.

After editing, run:

```bash
npm --prefix frontend/packages/tokens run build
```

Verify the output at `src/generated/tokens.css` includes the new variables. **Auto-revert generated artifacts before staging** per project rule (per [project_lighting_workspace_product_model.md](file:///Users/EdvinLandvik/.claude/projects/-Users-EdvinLandvik-Projects-EdvinProjectManagerCodex/memory/feedback_auto_revert_generated_artifacts.md)) — only commit the source edit, the build script regenerates on next CI / dev pass.

### 1.2 Fonts

1. Create [frontend/app/src/assets/fonts/](../../frontend/app/src/assets/fonts/) (verify directory does not exist; if it does, drop into it).
2. Download `.woff2` files (variable where available):
   - `Fraunces[opsz,wght].woff2` — Google Fonts → Download family → Fraunces VF
   - `Inter[wght].woff2` — Google Fonts → Inter VF
   - `JetBrainsMono[wght].woff2` — JetBrains official
3. Add `@font-face` declarations in [frontend/packages/design-system/src/styles/global.css](../../frontend/packages/design-system/src/styles/global.css):

```css
@font-face {
  font-family: "Fraunces";
  src: url("/assets/fonts/Fraunces[opsz,wght].woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("/assets/fonts/Inter[wght].woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "JetBrains Mono";
  src: url("/assets/fonts/JetBrainsMono[wght].woff2") format("woff2-variations");
  font-weight: 100 800;
  font-style: normal;
  font-display: swap;
}
```

Adjust the `url()` paths to match the project's Vite asset-resolution conventions (check [frontend/app/vite.config.ts](../../frontend/app/vite.config.ts)). If Vite expects `import.meta.url`-resolved imports, expose the fonts via a TS module or `public/` — verify in PR 1.0.

License files (`OFL.txt`, `LICENSE`) live alongside each font; commit them.

### 1.3 Design-system primitive additions

Add to [frontend/packages/design-system/src/components/](../../frontend/packages/design-system/src/components/):

| File                               | Purpose                                       | Public API sketch                                                                                                           |
| ---------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Crest.tsx`                        | SSE ExEd brand mark                           | `<Crest size="sm" \| "md" \| "lg" alt? />` — wraps the official PNG asset (path TBD per F-asset; see open verification §V1) |
| `NavItem.tsx`                      | Workspace nav button with icon + active state | `<NavItem id label icon active onClick />`                                                                                  |
| `StatusDot.tsx`                    | Semantic status dot                           | `<StatusDot state="ok" \| "attn" \| "err" \| "info" size? />` — used in chips, health, plot pills                           |
| `HealthBar.tsx` + `HealthItem.tsx` | Full-width status strip                       | `<HealthBar items={[{label, dot, value, suffix?}]} hint?={kbd, label} />`                                                   |
| `PlotPill.tsx`                     | Glass overlay pill                            | `<PlotPill state="default" \| "modified" \| "patch">` (children)                                                            |
| `PlotMeta.tsx`                     | Glass info chip                               | `<PlotMeta label value tone? />`                                                                                            |

Update [frontend/packages/design-system/src/index.ts](../../frontend/packages/design-system/src/index.ts) to export the new primitives + their prop types.

Add Storybook stories where the existing pattern is followed ([frontend/packages/design-system/src/stories/DesignSystemPrimitives.stories.tsx](../../frontend/packages/design-system/src/stories/DesignSystemPrimitives.stories.tsx)) — at least one story per new primitive showing default + each tone variant.

### 1.4 AppShellFrame redesign

Edit [frontend/packages/design-system/src/components/AppShellFrame.tsx](../../frontend/packages/design-system/src/components/AppShellFrame.tsx) and its module CSS.

**API change**: extend `RailItem` with `icon?: ReactNode`. Either accept a Lucide icon component, or accept an `iconName` string and resolve via a name → SVG map in the design-system. The latter is more locked-down; the former more flexible. **Default**: accept `ReactNode` for `icon` (same pattern as `IconButton`).

**Layout change**: collapse `monitorRail` (top) + `workspaceRail` (left) into a single horizontal **shellHeader** (~92 px). Grid template:

```
shellHeader  shellHeader  shellHeader  → var(--size-shell-height)
main         main         contextRail  → 1fr
```

Render order inside the shell header (left → right):

1. `<Crest size="md" />`
2. Vertical divider
3. Product name in display font (`"Studio Control"`)
4. (Optional) thin divider
5. `<nav>` of `<NavItem>` instances for `workspaces`
6. Spacer
7. `monitorItems` rendered as `<StatusPill>` chips (or removed — see open verification §V2)
8. Clock / hero metric

Active state styling per v6: `linear-gradient(180deg, brand.greenSoft, brand.greenGlow)` background, brighter icon (`brand.green`), 3 px glowing underline (`brand.green` with `box-shadow: 0 0 12px brand.green`).

**Behavioural change**: `hideMainHeader` defaults to `true` going forward. The `mainHeader` block (eyebrow / title / subtitle) is retained for any non-D consumers but no longer rendered by default. Audio / Setup / Planning workspaces should be checked to confirm none rely on it; if they do, opt them in via `hideMainHeader={false}`.

**Update the consumer**: [frontend/app/src/app/OperatorShell.tsx](../../frontend/app/src/app/OperatorShell.tsx) — pass `icon` props on each workspace `RailItem`. Lucide icons:

- Setup: `Sliders` (or similar)
- Planning: `Calendar`
- Lighting: `Sun` (already used as toolbar title)
- Audio: `Mic` (or `AudioWaveform`)
- Stream Deck: `LayoutGrid`

If Lucide is not yet a dep, add `lucide-react`. Verify in PR 1.0 — search for existing icon usage.

### 1.5 PR 1 file list (high-level)

- `frontend/packages/tokens/src/source/tokens.json` — additive
- `frontend/packages/tokens/src/generated/*` — regenerated, **revert before staging**
- `frontend/app/src/assets/fonts/*` — new (3 font files + license files)
- `frontend/packages/design-system/src/styles/global.css` — `@font-face` block
- `frontend/packages/design-system/src/components/Crest.tsx` + `.module.css`
- `frontend/packages/design-system/src/components/NavItem.tsx` + `.module.css`
- `frontend/packages/design-system/src/components/StatusDot.tsx` + `.module.css`
- `frontend/packages/design-system/src/components/HealthBar.tsx` + `.module.css`
- `frontend/packages/design-system/src/components/HealthItem.tsx` (or co-located in HealthBar)
- `frontend/packages/design-system/src/components/PlotPill.tsx` + `.module.css`
- `frontend/packages/design-system/src/components/PlotMeta.tsx` + `.module.css`
- `frontend/packages/design-system/src/components/AppShellFrame.tsx` + `.module.css` — substantial rewrite
- `frontend/packages/design-system/src/index.ts` — exports
- `frontend/packages/design-system/src/stories/DesignSystemPrimitives.stories.tsx` — additive stories
- `frontend/app/src/app/OperatorShell.tsx` — pass `icon` per workspace
- `package.json` (root and/or `frontend/app`) — `lucide-react` dep if missing

### 1.6 PR 1 validation

```bash
npm install
npm --prefix frontend/packages/tokens run build
npm run dev:check
npm run native:acceptance
npm run tauri:visual:review     # focus: shell header on all 5 workspaces
```

Then on Windows-Claude session: `npm run tauri:smoke:win`.

Visual review on the BetterDisplay-mirrored 2560 × 1440 surface. Capture before/after of Setup, Planning, Lighting, Audio, Stream Deck shell chrome; the workspace bodies should be unchanged from current shape (just lose the left rail / regain the top header).

**Auto-revert** `frontend/packages/tokens/src/generated/*` and `tauri/gen/schemas/*` before commit.

---

## PR 2 — Documentation supersession

Single docs PR. Three files:

### 2.1 Rewrite [docs/redesign/lighting.md](./lighting.md)

Replace the YAML frontmatter:

```yaml
---
workspace: lighting
phase: D (locked, executing)
status: implementing
chosen_direction: D — Scene desk
supersedes: Cr — Spatial desk
prototype: docs/redesign/assets/lighting/Lighting-D-Scene-Desk.html
implementation_plan: docs/redesign/lighting-direction-d-implementation-plan.md
audit_refs:
  - docs/archive/UX_AUDIT.md §Lighting workspace
---
```

Body: rewrite as the Direction D delta spec. Preserve from Cr:

- Stage plot anchor (the spatial canvas remains the centerpiece)
- In-scope patch fields: `dmxStartAddress`, `rigZ`, `beamAngleDegrees`, `Identify` burst
- No fixture pan/tilt
- 12 m × 8 m room dimensions
- 1920 × 1080 fallback profile (collapsed)
- Persistence: blob path, no schema bump

Supersede:

- 5-region grid with cue rail / cue list / GO bar / control strip → 3-region body (rail / plot / inspector) + full-width health bar
- Cue model removed (theatrical playback vocabulary doesn't fit recording studio)
- Section view + sections (1-9 keys) — keep the `currentSectionId` persistence path (sections still useful) but de-emphasise visually; section-view is a future feature
- DMX peek moves from bottom strip → inspector Patch tab
- Master + Scenes + Groups now live in the rail (top-to-bottom hierarchy)

Section structure of the new doc:

1. **Layout** — 3-region body + full-width health, with grid math at 2560×1440 and 1920×1080
2. **States** — A (hero / standard op recall), B (senior op fixture edit + drift), C (patch overlay). Reference the v6 prototype for visual truth.
3. **New / modified tokens & primitives** — point at the Phase 0 findings in this plan
4. **Engine surface delta** — none for D's visual. `lighting.cue.*` is orphaned, removed in PR 4.
5. **Persistence** — `app.lighting.cues`, `app.lighting.active_cue_id`: orphaned by D, kept until PR 4. New scene metadata blob may include `thumbDataUri` for cached scene tile thumbnails (see PR 3 §3.3).
6. **Keyboard shortcuts** — `P` (patch overlay), `S` (save current as scene), `F` (add fixture), `Esc` (clear selection / exit patch), `Cmd+M` (full DMX monitor). `Space` / `Backspace` / `C` / `E` are de-listed (cue-related, gone).
7. **What's not in scope** — sections UI polish, multi-universe DMX, fixture audio sync, settings UI for studio layout

### 2.2 Update [docs/HANDOFF.md](../HANDOFF.md)

Find the line "The `Lighting` pass is closed against the current checked-in plan…". Update to reflect Direction D as the new locked pass, with the prototype + implementation plan as the references.

### 2.3 Add ADR if needed

If F5's "no protocol change" assumption holds (verified in PR 3.0), no ADR needed. If we end up adding fixture mounting metadata to the engine, write [docs/adr/0002-lighting-fixture-mounting.md](../adr/0002-lighting-fixture-mounting.md) recording the contract change. **Default**: skip ADR.

### 2.4 PR 2 validation

```bash
npm run dev:check        # docs lint / link check
```

Visual: open the rendered docs in the preview; verify the prototype iframe / link works.

---

## PR 3 — Lighting workspace rewrite

The big PR. Decompose the 3,649-LOC monolith into a thin orchestrator + dedicated components.

### 3.0 Pre-flight (1 hour, before code)

Verify in this order:

1. Open [LightingFixtureSnapshot.ts](../../frontend/packages/engine-client/src/generated/snapshots/LightingFixtureSnapshot.ts) — confirm field list (`spatialX`, `spatialY`, `rigZ`, `beamAngleDegrees`, `intensity`, `cct`, `on`, `type`, `kind`, `name`, `id`, `groupId`, `dmxStartAddress`, `universe`).
2. Open [LightingDmxMonitorSnapshot.ts](../../frontend/packages/engine-client/src/generated/snapshots/LightingDmxMonitorSnapshot.ts) — confirm channel list shape, look for `refreshHz` or similar.
3. Open [LightingSnapshot.ts](../../frontend/packages/engine-client/src/generated/snapshots/LightingSnapshot.ts) — confirm `selectedFixtureId`, `selectedSceneId`, `activeSceneId` (or equivalent), and the orphaned `cues` / `activeCueId`.
4. Confirm `InspectorPanel` API supports a tab strip; if not, plan a thin `<InspectorTabs>` wrapper.
5. Confirm `ToggleButton` can serve as the master toggle (size / on-state / event API).
6. Open [frontend/app/src/app/lighting/LightingWorkspace.module.css](../../frontend/app/src/app/lighting/LightingWorkspace.module.css) for current style scope; nothing should leak out of `lighting/`.

### 3.1 Component decomposition

New files under [frontend/app/src/app/lighting/](../../frontend/app/src/app/lighting/):

```
LightingWorkspace.tsx                 # orchestrator (~300 LOC target)
LightingWorkspace.module.css          # remaining workspace-level styles only

studioLayout.ts                       # hardcoded studio room constants
fixtureMounting.ts                    # type → mounting-class derivation

components/
  LightingToolbar.tsx                 # search, stats, +Fixture, Patch, kebab
  LightingRail.tsx                    # Master + Scenes + Groups + Actions
    MasterCard.tsx
    SceneRail.tsx
    SceneTile.tsx
    SceneThumbnail.tsx                # mini SVG render
    GroupRail.tsx
    GroupChip.tsx                     # Lighting-flavoured (consumes design-system StatusDot)
    RailDivider.tsx
    RailHead.tsx
  StagePlot.tsx                       # the spatial canvas
    StudioFloor.tsx                   # walls, backdrop, door, booth, bench, talent, cameras
    FixtureMarker.tsx                 # type-aware shape
    LightPool.tsx                     # CCT-tinted radial gradient
    StagePlotGrid.tsx                 # 0.5/1/5m grid hierarchy
    PatchOverlay.tsx                  # patch-mode dimming + DMX address tags
    PatchAddressTag.tsx
  LightingInspector.tsx               # tab orchestrator
    InspectorScene.tsx
    InspectorFixture.tsx
    InspectorGroup.tsx
    InspectorPatch.tsx                # houses DMX peek + identify burst
    DMXPeek.tsx
    DMXChannel.tsx
    IdentifyBurstButton.tsx
  LightingHealthBar.tsx               # full-width health bar consuming engine signals
```

### 3.2 State machine

A single `lightingUiMode` state value in the orchestrator controls cross-cutting visuals:

```ts
type LightingUiMode = "recall" | "patch";
```

Plus per-tab inspector state derived from selection:

```ts
type InspectorTab = "scene" | "fixture" | "group" | "patch";

function deriveInspectorTab(opts: {
  uiMode: LightingUiMode;
  selectedFixtureId: string | null;
  selectedGroupId: string | null;
}): InspectorTab {
  if (opts.uiMode === "patch") return "patch";
  if (opts.selectedFixtureId) return "fixture";
  if (opts.selectedGroupId) return "group";
  return "scene";
}
```

Drift detection: compare current fixture states against the active scene's saved fixture states. If any differ, `isModified === true`.

### 3.3 Scene thumbnails

Per V5: `LightingSceneSnapshot` is generated by ts-rs from the Rust struct — frontend cannot extend the schema without an engine + protocol change. So scene thumbnails MUST live on a frontend-side blob.

**Strategy:**

- On scene save / update / first-render, render a tiny SVG (160 × 110 viewBox) of the stage state for that scene, serialise to data URI via `XMLSerializer.serializeToString` + `btoa`.
- Store on a new frontend-side blob: `app.shell.lighting.sceneThumbs: Record<string, string>` (scene id → data URI). Read/write through the existing shell-state plumbing in [frontend/app/src/app/shellData.ts](../../frontend/app/src/app/shellData.ts) — same path used today for `selectedCueId` and `currentSectionId`.
- On scene render, prefer the cached thumb; fall back to live render for scenes without an entry yet.
- No engine migration required: the blob is additive, written on first interaction with each scene. An older binary reading the blob would ignore the unknown key.
- Cleanup: when a scene is deleted (`lighting.scene.delete`), purge its thumb entry. PR 3 wires this in the orchestrator.

### 3.4 Studio layout constant

[frontend/app/src/app/lighting/studioLayout.ts](../../frontend/app/src/app/lighting/studioLayout.ts):

```ts
export interface StudioLayout {
  roomWidthMeters: number;
  roomDepthMeters: number;
  walls: {
    backdrop: boolean;
    door?: { wall: "north" | "east" | "south" | "west"; offsetMeters: number; widthMeters: number };
    controlBoothWindow?: { wall: "south"; offsetMeters: number; widthMeters: number };
  };
  setElements: Array<{
    kind: "bench";
    xMeters: number;
    yMeters: number;
    widthMeters: number;
    depthMeters: number;
    label: string;
  }>;
  talentMarks: Array<{ xMeters: number; yMeters: number; label?: string }>;
  cameras: Array<{ id: string; xMeters: number; yMeters: number; rotationDegrees: number; label: string }>;
}

export const STUDIO_LAYOUT: StudioLayout = {
  roomWidthMeters: 12,
  roomDepthMeters: 8,
  walls: {
    backdrop: true,
    door: { wall: "east", offsetMeters: 5.6, widthMeters: 1.3 },
    controlBoothWindow: { wall: "south", offsetMeters: 2.2, widthMeters: 1.7 },
  },
  setElements: [{ kind: "bench", xMeters: 6, yMeters: 2.3, widthMeters: 1.4, depthMeters: 0.3, label: "Bench" }],
  talentMarks: [
    { xMeters: 4.7, yMeters: 4.7 },
    { xMeters: 6.0, yMeters: 4.7 },
    { xMeters: 7.3, yMeters: 4.7 },
  ],
  cameras: [
    { id: "cam-a", xMeters: 6.0, yMeters: 7.2, rotationDegrees: 0, label: "CAM A" },
    { id: "cam-b", xMeters: 9.4, yMeters: 6.7, rotationDegrees: -25, label: "CAM B" },
  ],
};
```

The shape is designed so a future `lighting.studioLayout.update` IPC could write this same blob.

### 3.5 Fixture mounting derivation

[frontend/app/src/app/lighting/fixtureMounting.ts](../../frontend/app/src/app/lighting/fixtureMounting.ts):

```ts
export type FixtureMounting = "grid-panel" | "grid-soft" | "stand" | "wall-bar";

export function deriveMounting(fixtureType: string): FixtureMounting {
  const t = fixtureType.trim().toLowerCase();
  if (t.includes("apollo")) return "grid-panel";
  if (t.includes("infinimat")) return "grid-soft";
  if (t.includes("infinibar")) return "wall-bar";
  if (t.includes("astra")) return "stand";
  return "stand";
}
```

`FixtureMarker` switches on this value to render the right shape.

### 3.6 Health bar wiring

Six items, each backed by a tiny selector function over the snapshot:

| Item      | Source                                                                                                                                                                 | Default state                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Bridge    | `lightingSnapshot.health.reachable` + latency (verify field name; from `lighting_backend.rs`)                                                                          | `ok` if reachable; `err` if not   |
| Universe  | `lightingDmxMonitorSnapshot.channels.length` (count of in-use channels) — **per V4 there is no Hz field; do NOT show `· 44 Hz` from the prototype**                    | `ok` always; format `12 / 512 ch` |
| Fixtures  | `fixtures.length` patched (count of fixtures with `dmxStartAddress > 0`)                                                                                               | `ok` if all patched               |
| Auto-save | derived from a frontend-side dirty flag tracking unsaved drift against active scene; format `Saved · last 19:38 UTC` or `Unsaved changes`                              | `ok` if clean; `attn` if dirty    |
| Session   | `Date.now() - appSnapshot.shell.appStartedAt` (verify field; if missing, use `useEffect` startup-mark in the React tree) → format `Xh Ym`                              | static                            |
| App       | constant from `frontend/app/package.json` version, exposed via Vite `import.meta.env.VITE_APP_VERSION` (verify env wiring; `BUILD_VERSION` available in similar shape) | static                            |

Note: the prototype's `· 44 Hz` Universe suffix was illustrative only. PR 3 omits it.

### 3.7 PR 3 file list (high-level)

- `frontend/app/src/app/lighting/LightingWorkspace.tsx` — substantial rewrite (3,649 → ~300 LOC orchestrator)
- `frontend/app/src/app/lighting/LightingWorkspace.module.css` — heavily reduced (most styles move to per-component module CSS files under `components/`)
- `frontend/app/src/app/lighting/studioLayout.ts` — new (the room constant)
- `frontend/app/src/app/lighting/fixtureMounting.ts` — new (type → marker shape derivation)
- `frontend/app/src/app/lighting/sceneThumbnails.ts` — new (data-URI render + blob persistence helper, see §3.3)
- `frontend/app/src/app/lighting/components/` — new directory with ~22 files (see §3.1), including a `LightingInspectorTabs.tsx` since `InspectorPanel` does not have a tab strip (V7)
- `frontend/app/src/app/lighting/lightingHelpers.ts` — extend with thumbnail rendering helper; trim section-related helpers if sections are de-emphasised
- `frontend/app/src/app/lighting/lightingPatch.ts` — retained as-is for patch-mode logic
- `frontend/app/src/app/shellData.ts` — additions: `getSceneThumb(state, sceneId)`, `setSceneThumb`, dirty-flag selector for Auto-save, session-uptime selector. Same plumbing pattern as `selectedCueId` / `currentSectionId` today

### 3.8 PR 3 validation

```bash
npm run dev:check
npm run native:test
npm run native:acceptance
npm run tauri:visual:review
npm run tauri:workspaces:qualify     # exercises Lighting + Audio + Planning across persistence
```

Windows-Claude session: `npm run tauri:smoke:win` and, before tag, `npm run native:release:win:evidence`.

Visual capture: re-baseline the lighting parity scenes against Direction D's layout (the Cr-era parity scenes are mostly orthogonal but the hero scene needs a re-baseline). Use the prototype as the visual reference.

**Auto-revert generated artifacts** (`tauri/gen/schemas`, `tokens.css`) before staging.

**Persistence backward-compat**: confirm an operator with v2.2.1 data can launch v2.2.2 (with D) and see all fixtures / scenes / groups intact. The orphaned cues sit in the blob unread; the next save preserves them. No migration needed.

---

## PR 4 — Cue cleanup (deferred)

Run only after PR 3 has been on the operator workstation for at least one full recording session (sanity check that nothing relies on cue plumbing).

### 4.1 Engine

The lighting engine code lives under [native/rust-engine/src/lighting/](../../native/rust-engine/src/lighting/) (directory, not a single file) plus [native/rust-engine/src/lighting_backend.rs](../../native/rust-engine/src/lighting_backend.rs) for bridge connection.

- Remove cue handlers from [native/rust-engine/src/app.rs](../../native/rust-engine/src/app.rs): `lighting.cue.create / update / delete / fire`
- Remove cue types from `native/rust-engine/src/lighting/types.rs` and any cue-related logic in `native/rust-engine/src/lighting/snapshot.rs` / `editor_state.rs`: `LightingCueSnapshot`, `LightingCueCreate/Update/Delete/FireRequest/Result`. Drop `cues` and `active_cue_id` fields from `LightingSnapshot`.
- Remove persistence plumbing for `app.lighting.cues` and `app.lighting.active_cue_id`. Add a one-shot startup migration that deletes these blob keys (so operator data doesn't carry orphaned bytes forever).
- The full lighting source layout in current Checkpoint-D-era engine: `lighting/types.rs`, `lighting/editor_state.rs`, `lighting/helpers.rs`, `lighting/fixtures.rs`, `lighting/snapshot.rs`, `lighting/parse.rs`, `lighting/legacy_import.rs`. Search `LightingCue` across these to find every reference.

### 4.2 Protocol / engine-client

- Regenerate snapshot types. The generated `LightingCueSnapshot.ts` (in [frontend/packages/engine-client/src/generated/snapshots/](../../frontend/packages/engine-client/src/generated/snapshots/)) is removed; `LightingSceneFixtureSnapshot.ts` and others should drop cue references. Run the protocol regen lane (e.g. `npm run native:foundation` or the explicit format-protocol script — verify the script name in PR 4.0 by checking the workflow names in [.github/workflows/dev-checks.yml](../../.github/workflows/dev-checks.yml)).

### 4.3 Frontend

- Remove `getActiveLightingCue`, `getNextLightingCue`, `getLightingCues` from `shellData.ts`
- Remove `formatLightingCueFadeSeconds`, `lightingCueTone` from `lightingHelpers.ts`
- Remove the `CueRail` primitive from design-system if no other consumer remains

### 4.4 Tests

- Remove `lighting_cue_*` engine unit tests
- Add `lighting_cue_keys_purged_on_first_launch_v2_2_2` for the migration

### 4.5 PR 4 validation

Same as PR 3 + persistence backward/forward compat: a v2.2.1 operator launching v2.2.2 (with D + cleanup) sees their data preserved minus the orphaned cue blob.

---

## Risk register

Phase-0 risks were resolved during the final verification pass (see "Open verifications — resolved" for details on V1–V8). Remaining real risks below.

| Risk                                                                         | Likelihood | Impact | Mitigation                                                                                                                                                          |
| ---------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storybook stories file may not build cleanly with new primitives             | Low        | Low    | PR 1: try the additions; if Storybook config is stale in this repo, skip the story additions, primitives still ship                                                 |
| AppShellFrame redesign breaks Setup / Planning / Audio / StreamDeck visually | Medium     | Medium | PR 1 ships visual review for ALL five workspaces, not just Lighting; capture before/after on BetterDisplay 2560×1440                                                |
| Scene-thumbnail blob writes race with engine snapshot writes                 | Low        | Low    | Write through the existing `appSnapshot.shell.lighting` plumbing — same channel as `selectedCueId` / `currentSectionId`; serialised by the shell store              |
| Persistence backward-compat broken (operator can't downgrade)                | Very Low   | High   | No on-disk format changes; new keys are additive (`sceneThumbs`); cue keys are read-tolerated unread until PR 4                                                     |
| Health-bar Auto-save dirty-flag drifts from real save state                  | Medium     | Low    | Use a hash of the scene's current fixture states vs. saved scene fixture states; recompute on every snapshot tick                                                   |
| `appStartedAt` / version env var doesn't exist                               | Medium     | Low    | Fall back to a React-mount time captured in `OperatorShell` mount (close enough for a session-uptime display); read `package.json` version at build via Vite define |
| Persistence forward/backward compat broken by font/path changes              | Very Low   | High   | None of PR 1's edits touch `app.*` blobs; confirm with `dev:check`                                                                                                  |
| Studio layout hardcoding wrong defaults vs. real studio                      | Medium     | Low    | Easy to re-edit; settings UI follow-up; no operator data damage                                                                                                     |

## Decisions (resolved per "go with your defaults")

| #   | Decision                     | Resolution                                                                                                                                                                                       |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | PR sequencing                | 4 PRs in order: Foundation → Docs → Lighting → Cleanup                                                                                                                                           |
| D2  | Phase 0 done first           | ✓ Captured in this plan; PR 1 starts immediately                                                                                                                                                 |
| D3  | Font distribution            | Bundle `.woff2` locally; no CDN at runtime                                                                                                                                                       |
| D4  | Cue cleanup                  | Deferred to PR 4                                                                                                                                                                                 |
| D5  | Cross-workspace shell change | Ship in PR 1; Setup/Planning/Audio/StreamDeck inherit automatically                                                                                                                              |
| D6  | Studio layout                | Hardcoded constant in [studioLayout.ts](../../frontend/app/src/app/lighting/studioLayout.ts), shape designed to support a future persisted blob without component changes; settings UI follow-up |
| D7  | Fixture mounting             | Derive from fixture `type` string in [fixtureMounting.ts](../../frontend/app/src/app/lighting/fixtureMounting.ts); no engine change                                                              |
| D8  | Scene thumbnails             | Cached data-URI on a frontend-side blob (default); fall back to engine-side scene metadata if PR 3.0 reveals it's editable                                                                       |
| D9  | Section view                 | Keep `currentSectionId` persistence; visual de-emphasis; full sections UI is a follow-up                                                                                                         |
| D10 | `monitorItems` pills         | Fold into top header (right of nav, left of clock)                                                                                                                                               |

## Open verifications — resolved

All 8 V-items were resolved during the final plan pass on 2026-04-27. Ground truth follows; no pre-flight needed before PR 1.

### V1 — SSE ExEd brand assets ✓ PRESENT

[docs/redesign/assets/lighting/logos/](./assets/lighting/logos/) contains:

- `SSE_Logo_Unit_ExecutiveEducation_White_RGB.png` (47 KB) — horizontal lockup, white-on-dark. **Used by the prototype.** Use this in `<Crest size="md">`.
- `SSE_Logo_Unit_ExecutiveEducation_vertical_white_RGB.png` (72 KB) — vertical lockup. Reserve for splash / about screen.

### V2 — `monitorItems` consumers ✓ SINGLE

Only [frontend/app/src/app/OperatorShell.tsx](../../frontend/app/src/app/OperatorShell.tsx):302, 371. Built via `buildMonitorItems(shellState.healthSnapshot)`. Folding the pills into the new top header (per D10) preserves the data path; just relocate the render site inside `AppShellFrame`.

### V3 — `lucide-react` dependency ✓ PRESENT

Already declared in [frontend/packages/design-system/package.json](../../frontend/packages/design-system/package.json) at `^1.11.0`. **No new dep needed.** Import as `import { Sun, Calendar, Mic, Sliders, LayoutGrid } from "lucide-react"`.

### V4 — `LightingDmxMonitorSnapshot` refresh rate ✗ ABSENT

The snapshot is `{ channels: Array<LightingDmxChannelSnapshot> }` only. **No refresh-rate field, no universe-id field, no Hz.** Update plan: the Health bar's Universe item shows `12 / 512 ch` only (drop the `· 44 Hz` suffix from the prototype). If a Hz signal is desired later, that's an engine snapshot extension — out of scope for D.

### V5 — Scene metadata schema ⚠ STRICT (ts-rs generated)

`LightingSceneSnapshot` is `{ id, name, fixtureCount, fixtureStates, lastRecalled, lastRecalledAt }`. The file is generated by ts-rs from the Rust struct. **The frontend cannot add `thumbDataUri` to the engine schema without a Rust + protocol change.** Plan correction: scene thumbnails MUST go on a frontend-side blob keyed by scene id — D8's "fallback" path is the actual path. Use `app.shell.lighting.sceneThumbs: Record<sceneId, string>` written through the existing shell-state plumbing (see `appSnapshot.shell.lighting` access pattern in `LightingWorkspace.tsx:83-84`).

### V6 — Vite asset convention ✓ DEFAULT (use `public/`)

[frontend/app/vite.config.ts](../../frontend/app/vite.config.ts) is minimal — no asset-resolution customisation. Use Vite's default `public/` directory for absolute-path assets. **PR 1 places fonts at [frontend/app/public/fonts/](../../frontend/app/public/fonts/)** (create directory) and references them as `/fonts/Fraunces[opsz,wght].woff2` etc. in `@font-face`. Vite serves `public/` content at root.

### V7 — `InspectorPanel` tab support ✗ ABSENT

Existing API (verified in [InspectorPanel.tsx](../../frontend/packages/design-system/src/components/InspectorPanel.tsx)): `eyebrow`, `title`, `status`, `actions`, `children`. **No tab strip.** PR 3 builds a thin `LightingInspectorTabs` component co-located in `frontend/app/src/app/lighting/components/` that renders the four tab buttons (Scene / Fixture / Group / Patch) and pipes them into `InspectorPanel`'s `children` slot. If we promote it to design-system later, it would replace `InspectorPanel`'s `eyebrow` prop with an optional `tabs` prop. Defer that promotion until Audio inspector also wants tabs.

### V8 — `hideMainHeader` consumers ✓ ALREADY EXPLICIT

[OperatorShell.tsx](../../frontend/app/src/app/OperatorShell.tsx):369-372 already passes `hideMainHeader={hideFrameMainHeader}` plus `eyebrow=` / `subtitle=` props explicitly. **No default change needed in `AppShellFrame`.** Plan correction: D's workspaces (Lighting first) ensure `hideFrameMainHeader === true` for their workspace mode. The `eyebrow` / `subtitle` props remain available for any non-D consumer.

## How to start the next session

The next Claude Code session should:

1. Confirm the prototype renders correctly: open [Lighting-D-Scene-Desk.html](./assets/lighting/Lighting-D-Scene-Desk.html) on the BetterDisplay 2560×1440 surface.
2. Read this file end-to-end (V1–V8 are already resolved; "Open verifications — resolved" has the ground truth).
3. Branch off `claude/naughty-bhaskara-71d3b3` (or current `main`-ish base — confirm with the user) onto `feat/lighting-d-foundation`. Begin PR 1.
4. Each PR follows the standing memory rules: auto-revert generated artifacts (`tauri/gen/schemas/*`, `frontend/packages/tokens/src/generated/*`), explicit go-ahead before invasive ops (release-evidence cycles, force-pushes, system installs), WIP commits over stash for safety snapshots, target-host validation via Windows-Claude session.

When PR 3 reaches review-ready, capture before/after screenshots on the BetterDisplay surface and save under `release/<snapshot>/lighting-d/` for the visual record.

### Pre-existing uncommitted state at plan-write time

The worktree currently has 3 untracked files from this planning session:

- `docs/redesign/assets/lighting/Lighting-D-Scene-Desk.html` (the v6 prototype)
- `docs/redesign/assets/lighting/logos/` (the official SSE ExEd brand assets)
- `docs/redesign/lighting-direction-d-implementation-plan.md` (this file)

No tracked file is modified. The next session should propose committing these 3 untracked artefacts (likely as part of PR 2 — Documentation supersession — or as a small `chore(docs): check in v6 prototype + logos + implementation plan` commit before PR 1) so they survive across worktrees and are referenced from the supersession doc.

---

**End of plan.** Authored 2026-04-27 against worktree `naughty-bhaskara-71d3b3`.
