---
workspace: lighting
phase: D (locked, implemented)
status: premium-complete
chosen_direction: D — Scene desk
supersedes: Cr — Spatial desk
prototype: docs/redesign/assets/lighting/Lighting-D-Scene-Desk.html
implementation_plan: docs/redesign/lighting-direction-d-implementation-plan.md
premium_plan: docs/redesign/lighting-d-premium-plan.md
audit_refs:
  - docs/archive/UX_AUDIT.md §Lighting workspace
---

# Lighting — Direction D delta spec

> Direction **D — Scene desk** supersedes the locked **Cr — Spatial desk** direction. The visual proposal is the v6 prototype at [Lighting-D-Scene-Desk.html](./assets/lighting/Lighting-D-Scene-Desk.html); render at 2560×1440 on the BetterDisplay review surface for operator-size review. The base 4-PR implementation sequence lives in [lighting-direction-d-implementation-plan.md](./lighting-direction-d-implementation-plan.md), and the completed premium pass lives in [lighting-d-premium-plan.md](./lighting-d-premium-plan.md). This file is the design-spec record — what the workspace _is_ for two operator personas, not how to build it.

## Why D supersedes Cr

Cr modelled Lighting as a theatrical playback console: cue rail, GO bar, cross-fade animation, follow chains. The recording-studio operator does not run that playbook. The work is **scene recall** — pick a saved look, fine-tune two or three fixtures during a take, save the variant. The cue model added vocabulary (`active cue`, `next cue`, `fade in`, `follow seconds`, `cross-fade`) that operators consistently mapped to scenes, and the GO bar + cue rail dominated screen real estate that the persistent inspector and stage plot needed.

D removes the cue model entirely and reorganises around two recall-driven personas:

1. **Standard recording op** — recalls scenes, occasionally nudges a fixture intensity. Spends ~95 % of session time in the recall path.
2. **Senior setup op** — patches new fixtures, edits scene contents, re-saves. Spends most of their time in the inspector + stage plot, occasionally entering patch overlay.

Both share one canvas; there is no mode toggle. The senior op's edit path is the standard op's recall path with the inspector populated.

## Inheritance from Cr

Direction D **preserves** these Cr commitments unchanged:

- **Stage plot anchor.** The 2-D top-down spatial canvas remains the workspace's centerpiece. Fixtures render at `spatialX / spatialY`; beam cones use `beamAngleDegrees` and CCT-tinted gradients.
- **Patch fields.** `dmxStartAddress`, `rigZ`, `beamAngleDegrees`, `Identify` burst — same engine fields, same operator surface, no fixture pan/tilt.
- **12 m × 8 m room.** Studio dimensions are constants; multi-universe DMX, 3-D plot, and per-fixture Z-position editing remain out of scope.
- **1920×1080 fallback.** The collapsed budget for laptop displays still respects the no-scroll rule.
- **Persistence path.** Lighting state lives on `appSnapshot.lighting` (engine-driven) and `appSnapshot.shell.lighting` (frontend UI state). No schema bump.

## What D supersedes

D **replaces** these Cr decisions:

| Cr model                                                                     | D model                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5-region grid (toolbar / cue rail / plot / inspector / control strip)        | 3-region body (rail / plot / inspector) + full-width health bar                                                                                                                                                             |
| Cue rail on the left (380 px) — list of cues with NOW pointer                | Rail (380 px) with **Master** at top, **Scenes** mid, **Groups** + **Actions** below                                                                                                                                        |
| Cue model (`LightingCueSnapshot`, `lighting.cue.*` IPC, `app.lighting.cues`) | No cue model. Scenes are the only saved-state primitive. Cue plumbing is orphaned by D and removed in [PR 4](./lighting-direction-d-implementation-plan.md#pr-4--cue-cleanup-deferred).                                     |
| Bottom 140 px control strip (Groups + Scenes + DMX peek)                     | Master / Scenes / Groups in the rail; DMX peek moves into the inspector's **Patch** tab                                                                                                                                     |
| `GO` bar + cross-fade animation                                              | No GO bar. Recall is instantaneous. Drift between current fixture state and active scene shows as a **Modified** chip on the recall `PlotPill`.                                                                             |
| 9 storyboard states                                                          | 3 storyboard states (A / B / C — see §2)                                                                                                                                                                                    |
| Sections (1–9 saved zooms) — fully storyboarded                              | `currentSectionId` is persisted but visually de-emphasised; full sections UI is a follow-up                                                                                                                                 |
| Shell: top monitor rail + left workspace rail                                | Single 92 px shell header at the top; cross-workspace impact (Setup / Planning / Audio inherit the new shell automatically) shipped in [PR 1 §1.4](./lighting-direction-d-implementation-plan.md#14-appshellframe-redesign) |
| IBM Plex Sans / Mono                                                         | Inter (UI) + Fraunces (display) + JetBrains Mono (data); bundled via `@fontsource-variable` per [PR 1 §1.2](./lighting-direction-d-implementation-plan.md#12-fonts)                                                         |

## 1. Layout

### Region grid — 2560×1440

The viewport budget is split into four horizontal bands:

| Band         | Height                             | Owner                                                                                                                                  |
| ------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Shell header | 92 px (`--size-shell-height`)      | `AppShellFrame` (cross-workspace) — `Crest` · brand divider · "Studio Control" wordmark · `NavItem` row · clock + `monitorItems` chips |
| Toolbar      | 44 px (`--size-toolbar-height`)    | Lighting workspace — title + icon · stats chips (Fix / On / Grp / Scn) · search · `+ Fixture` primary · `Patch` (`P`) · kebab          |
| Body         | 1240 px (residual)                 | Lighting workspace — rail (380) · plot (1740) · inspector (440)                                                                        |
| Health bar   | 64 px (`--size-health-bar-height`) | Lighting workspace — full-width status strip                                                                                           |

Vertical sum: 92 + 44 + 1240 + 64 = 1440 ✓.

Horizontal split inside the body: 380 + 1740 + 440 = 2560 ✓. No `ScrollView` wrapper anywhere — the no-scroll rule from the audit (§C7) carries forward.

### Region grid — 1920×1080 fallback

Proportional collapse of the body's three columns:

| Body column | 2560 width | 1920 width |
| ----------- | ---------- | ---------- |
| Rail        | 380        | 320        |
| Plot        | 1740       | 1240       |
| Inspector   | 440        | 360        |

Health bar height drops to 56 px; toolbar stays 44 px; shell header stays 92 px. Vertical: 92 + 44 + 868 + 56 = 1060 (with the title bar accounted for elsewhere).

## 2. States

D's three storyboard states (visualised verbatim in the v6 prototype):

| State                                  | Personas    | What changes                                                                                                                                                                                                                                                                                                                                                                                                                    | Trigger                                                     |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **A · Standard op recall**             | Standard op | Plot renders the active scene's fixtures with CCT-tinted beam pools. `PlotPill` (default state) overlays the plot top-center showing `Recall: <Scene name>`. Inspector is on the **Scene** tab with read-only scene metadata. Health bar all green.                                                                                                                                                                             | Default; operator selects a scene tile from the rail.       |
| **B · Senior op fixture edit + drift** | Senior op   | Operator selects one fixture on the plot; inspector flips to the **Fixture** tab; drift is detected (current fixture state diverges from saved scene state). `PlotPill` switches to the `modified` variant (`yellow` border + dot + `· Modified` mod label). Auto-save item in the health bar shows `attn` + `Unsaved changes`.                                                                                                 | Selecting a fixture and editing intensity / CCT / on-state. |
| **C · Patch overlay**                  | Senior op   | Plot dims to 40 % opacity; a translucent patch overlay renders DMX address tags on each fixture (`PatchAddressTag`). `PlotPill` switches to the `patch` variant (`blue` border + glass-bg-blue background + `· DMX overlay` mod). Inspector switches to the **Patch** tab, exposing `dmxStartAddress`, `rigZ`, `beamAngleDegrees`, and the `Identify` burst button. DMX peek (12 ch hex strip) renders inline in the Patch tab. | `P` keybind or toolbar `Patch` button.                      |

Other operator-visible conditions (degraded / loading / empty / zero-search) are inherited from the existing primitives — `StatusBand` for degraded, snapshot shimmer for loading, `EmptyState` for empty, search-pill for zero-result. They are not separate D storyboard states because the prototype does not redraw them differently than the existing primitives already render.

## 3. New / modified tokens and primitives

[PR 1 (Foundation)](./lighting-direction-d-implementation-plan.md#pr-1--foundation) is landed. The token + primitive surface for D is:

### Tokens — `frontend/packages/tokens/src/tokens/core.json`

Added under existing scales (alongside-existing namespacing, no removals):

- `color.brand.{green, greenHot, greenSoft, greenGlow, greenBorder, darkGreen, darkGreenMid, darkGreenSoft, yellow, yellowSoft, yellowBorder, blue, blueHot, blueSoft, blueBorder, burgundy, burgundySoft, coral, coralSoft, sky}` — D's expanded SSE palette
- `color.brand.text.{primary, secondary, muted, faint}` — warm-beige body text family (nested under `brand.text` to avoid collision with the existing `color.text.{strong, muted, subtle}`)
- `color.bg.{deep, canvas, default, soft, raised, strong, elevated, stroke, hairline, border, borderStrong}` — D's near-neutral surface palette
- `color.cct.{2700..6500}` — brand-biased CCT ramp for fixture markers
- `color.glass.{bg, bgBlue, border}` — backdrop-blur surfaces (PlotPill / PlotMeta)
- `radius.tight.{xs, sm, md, lg, xl}` (3 / 4 / 6 / 8 / 12 px) + `radius.pill` (999 px) — D's sharp scale; the existing `radius.{sm, md, lg}` (8 / 14 / 20) "soft" scale survives for non-D consumers
- `size.{shellHeight, healthBarHeight}` (92 / 64 px)
- `shadow.{insetHi, insetHiStrong, sm, md, lg, glass, glowGreen, glowYellow, glowBlue}` — D's elevation + glow scales
- `font.family.{ui, display}` — Inter + Fraunces; `font.family.mono` repointed to JetBrains Mono Variable; `font.family.sans` aliased to `{font.family.ui}` for backward compat

The canonical source is `core.json` (style-dictionary read), not the orphan `src/source/tokens.json`. Style-dictionary v5 resolves `{token.ref}` references at build time; the kebab-case CSS variable names are derived from the JSON path (`color.brand.darkGreenMid` → `--color-brand-dark-green-mid`).

### Primitives — `frontend/packages/design-system/src/components/`

Net-new in PR 1 (cross-workspace reuse plausible):

- `Crest` — wraps the official SSE Executive Education horizontal white logo PNG, `size: "sm" | "md" | "lg"` (36 / 52 / 72 px)
- `NavItem` — workspace nav button with optional 16 px Lucide icon and active state (gradient background + 3 px glowing underline on `--color-brand-green`); consumed by the new `AppShellFrame` shell header
- `StatusDot` — semantic status dot, `state: "ok" | "attn" | "err" | "info"`, `size: "sm" | "md"`, `glow?` default on
- `HealthBar` + `HealthItem` — full-width status strip with N items + optional kbd-shortcut hint
- `PlotPill` — glass overlay pill with backdrop-blur, `state: "default" | "modified" | "patch"`
- `PlotMeta` — small mono info chip with backdrop-blur, `tone: "default" | "blue"`

Workspace-only (kept under `frontend/app/src/app/lighting/components/`, not promoted to the design system) — these arrive in [PR 3 §3.1](./lighting-direction-d-implementation-plan.md#31-component-decomposition):

`MasterCard`, `RailDivider`, `RailHead`, `SceneTile`, `SceneThumbnail`, `GroupChip`, `StagePlot`, `StudioFloor`, `FixtureMarker`, `LightPool`, `StagePlotGrid`, `PatchOverlay`, `PatchAddressTag`, `LightingInspector`, `InspectorScene`, `InspectorFixture`, `InspectorGroup`, `InspectorPatch`, `LightingInspectorTabs`, `DMXPeek`, `DMXChannel`, `IdentifyBurstButton`, `LightingHealthBar`.

The existing `CueRail` design-system primitive becomes orphaned — D has no cues. It stays in the design system through PR 3 (no breaking API removal in PR 1) and is marked for deletion in [PR 4](./lighting-direction-d-implementation-plan.md#pr-4--cue-cleanup-deferred).

## 4. Engine surface delta

**For D's visual: none.** The existing engine snapshots and IPC handlers cover D's full operator surface:

- `lighting.snapshot` (read), `lighting.dmxMonitor.snapshot` (read)
- `lighting.fixture.{create, update, delete}`
- `lighting.group.{create, update, delete, power}`
- `lighting.scene.{create, update, delete, recall}`
- `lighting.power.all`
- `lighting.settings.update`

Two engine-side observations from Phase 0 are baked into D's design rather than fixed in the engine:

- **No DMX refresh-rate field.** `LightingDmxMonitorSnapshot` is `{ channels: [...] }` only — no `refreshHz` or universe-id field (Phase 0 V4). The Health bar's Universe item shows `12 / 512 ch`, not `12 / 512 ch · 44 Hz` as the prototype's illustrative copy implied. Adding a Hz field is an engine extension, out of scope.
- **No fixture mounting field.** `LightingFixtureSnapshot` carries `rigZ` and `beamAngleDegrees` already (Cr §5b) but no mounting type. D derives the mounting visually from the fixture `type` string in the frontend — Apollo → grid panel, Infinimat → grid soft, Infinibar → wall bar, Astra → stand, default → stand. No protocol change.

**Orphaned by D and removed in PR 4:**

- `lighting.cue.{create, update, delete, fire}` IPC handlers
- `LightingCueSnapshot` type, `cues` and `activeCueId` fields on `LightingSnapshot`
- All cue test fixtures and engine unit tests

## 5. Persistence

**Base D shipped without an on-disk format change.** The later premium palette wave introduced storage schema v6 for per-attribute palette pools. Direction D's scene desk shape remains additive on the same `appSnapshot` ownership boundary Cr used.

- `app.lighting.fixtures`, `app.lighting.groups`, `app.lighting.scenes` — unchanged.
- `app.shell.lighting.currentSectionId` — preserved (sections still useful even without cues).
- `app.shell.lighting.selectedCueId` — orphaned by D, ignored by the frontend, deleted by a one-shot startup migration in [PR 4](./lighting-direction-d-implementation-plan.md#pr-4--cue-cleanup-deferred).
- `app.lighting.cues`, `app.lighting.active_cue_id` — orphaned by D, ignored by the frontend, deleted by the same PR 4 migration.
- **New** `app.shell.lighting.sceneThumbs: Record<sceneId, string>` — frontend-only blob holding cached SVG-as-data-URI thumbnails for scene tiles. `LightingSceneSnapshot` is ts-rs-generated and strict (Phase 0 V5), so the thumb cache cannot live on the engine snapshot — the blob path is the only viable placement. Written through the existing `appSnapshot.shell.lighting` plumbing in `frontend/app/src/app/shellData.ts` (same channel as `currentSectionId`).
- **New in premium Wave 34** `app.lighting.palettes` + `app.lighting.paletteOrder` — engine-owned intensity/CCT palette pools seeded by the v5 -> v6 migration. Palette application writes concrete fixture values and does not create scene palette references.

A v2.2.1 operator launching the completed Direction D / premium build sees their fixtures, groups, scenes, orders, pins, color tags, and preview-independent live state preserved. Cue keys are migrated away by the Direction D cleanup, and palette defaults are seeded once during the v5 -> v6 migration. Backward-compat downgrade from v6 to pre-palette code is unsupported by policy — operators do not roll back releases on the fixed studio host.

## 6. Keyboard shortcuts

| Key                      | Action                                            |
| ------------------------ | ------------------------------------------------- |
| `P`                      | Toggle patch overlay                              |
| `S`                      | Smart-save current scene state                    |
| `Cmd/Ctrl+Shift+S`       | Save current fixture state as a new scene         |
| `F`                      | Open the **Add Fixture** dialog                   |
| `Esc`                    | Clear selection / exit patch overlay              |
| `H` / `Shift+H`          | Toggle Highlight / Solo on the current selection  |
| `Shift+I`                | Find selected fixtures with sequential pulses     |
| `Cmd/Ctrl+Shift+P`       | Open palette quick apply                          |
| `Cmd+M` / `Ctrl+M`       | Open the full DMX universe monitor                |
| `Cmd+1..4` / `Ctrl+1..4` | Workspace switch (inherited from `OperatorShell`) |
| `?`                      | Toggle the shortcut overlay (inherited)           |

**De-listed from Cr** (cue-related; gone): `Space` (GO), `Backspace` (back-step), `C` (add cue), `E` (edit cue), and Cr-style section recall on `1`-`9`. Pure digits now recall scene slots; view bookmarks use `Shift+1`-`3` / `Cmd+Shift+1`-`3`.

## 7. What is explicitly **not** in scope

- **Cue model resurrection.** Direction D's product memory rules out re-introducing cues; if a future requirement demands cue-style chains, that is a separate workspace, not this one.
- **3-D plot / rig-hung visualisation.** The plot stays 2-D top-down with `rigZ` stored for future use. Infinibar PB12 pixel-bar modelling remains a follow-up.
- **Multi-universe DMX.** Single universe matches the bridge config and the studio's current rig. Multi-universe is a follow-up that will require extending the DMX peek + the Universe health item.
- **Sections UI polish.** `currentSectionId` is persisted and routable but visually de-emphasised. Section creation / save / edit UI is a follow-up.
- **Studio layout settings UI.** The 12 m × 8 m room, walls, backdrop, control-booth window, bench, talent marks, and cameras are baked in `studioLayout.ts` as a constant. The shape is designed so a future `lighting.studioLayout.update` IPC could write the same blob without component changes; the editor UI is a follow-up.
- **Scene thumbnail engine route.** Scene thumbnails are cached as data URIs on a frontend-only blob. If [PR 3](./lighting-direction-d-implementation-plan.md#pr-3--lighting-workspace-rewrite) verification reveals the engine scene metadata is editable, the engine route is the fallback; otherwise the frontend blob is canonical.
- **Audio-sync / MTC triggers** — out of scope, same as Cr.
- **Cross-workspace shell rollback** — the shell change shipped in PR 1 affects Setup / Planning / Audio. There is no Cr-shell flag to roll back to; visual review across all four workspaces is the gate (covered in [PR 1 §1.6](./lighting-direction-d-implementation-plan.md#16-pr-1-validation)).
