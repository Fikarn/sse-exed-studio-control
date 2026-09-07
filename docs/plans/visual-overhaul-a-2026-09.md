# Visual overhaul A — sliced plan

Status: approved 2026-09-07 (D1–D14) on branch `ui-gold-standard-2026-09`. No slice has started; no source, token or test has been edited. Implementation runs in a new session from `visual-overhaul-a-2026-09-session-prompt.md`. It supersedes `docs/plans/gold-standard-2026-09.md` (the v1.1 plan), whose discipline it keeps and whose slices it re-scopes to Concept A.

Tracking: the per-slice `Status:` lines are the authoritative execution record. Each slice lands as its own commit `A S<N>: <what landed>` (baseline refreshes as `A S<N> (baselines): …`); any divergence from a slice's written scope gets a bold `*Rescoped:*` note in its status line before the commit, per the rescope protocol in `AGENTS.md`.

**Rescope:** none yet. A slice whose premise changes on inspection gets its own `**Rescope:**` paragraph under its heading (the form `scripts/check-slice-rescope.mjs` keys on) and a renamed title that matches what landed.

Goal: make the four workspaces the one instrument the A mocks show, measured by the same probe that measured the mocks, closing the review's findings (`docs/redesign/gold-standard-review-2026-09.md`) in cost order, with the design system and tokens as the only vehicle.

Sources: the product brief (`docs/redesign/claude-design-product-brief-2026-09.md`), the system (`docs/redesign/system-a-2026-09.md`), the tokens (`docs/redesign/system/tokens-a-2026-09.css` + `.json`), the mocks (`docs/redesign/assets/concepts/A-*.html`, open with `?state=…&theme=…&vw=…`, press `1` for 1:1), the four write-ups (`console-concepts`, `console-a-states`, `workspaces-a`, `viewports-a`, all `-2026-09.md`), and the evidence folder (`../gold-standard-evidence-2026-09/concepts/`, 69 boards, `probe/concepts.mjs`).

**Revision 2026-09-07.** The operator ruled that `2560×1440` is the only resolution that matters; `1920×1080` and `1280×800` are no longer relevant. D4 is rewritten for one surface, D9 is withdrawn, and every gate below runs at 2560 only. The polish pass that followed is in `docs/redesign/polish-a-2026-09.md`.

## Non-negotiables (unchanged from the operator, 2026-09-04)

1. The design system and tokens remain the vehicle: redesign them where the system needs it, never bypass them. A workspace composes primitives; it does not re-implement one.
2. All three themes pass legibility (text ≥ 4.5:1 pixel-sampled, components, lamps and keylines ≥ 3:1) on every surface before a slice closes.
3. Existing behaviour tests move with a changed contract; none is deleted. Every moved assertion is recorded as old → new → reason.
4. No front-end change may display state the engine does not report. Where a mock shows a state the snapshot does not carry (§Boundary), the front-end shows the engine's own words and count until the contract carries the field.
5. Test ids (`data-testid="audio-…"`, `lighting-…`, `planning-…`, `setup-…`, `[data-toolbar-primary]`) are extended, never renamed.

## Decisions for the operator (approved 2026-09-07)

**Approved by the operator on 2026-09-07: D1–D14 as recommended, D4 and D9 confirmed.** The plan is in force as amended; implementation runs in a new session (`visual-overhaul-a-2026-09-session-prompt.md` is the prompt for it). Still: commit only when the operator asks.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| D1  | The **cluster rule** replaces the workspace top bar on all four workspaces: header · cluster · bay · plate · footer, the cluster's first element a fixed-height **state display** (180 px) carrying the badge word, the engine's sentence and the way-out key.                                                                                                                                                                                                                                                                           | system §2, console-a-states    |
| D2  | **Material v2**: plates with a top sheen, a recessed bay, black backlit wells in every theme, machined keys, blooms only on lit states, one light from above. This replaces the v1.1 physical model (keys do not travel; a press is a 100 ms edge change).                                                                                                                                                                                                                                                                               | system §5, console-a-states §1 |
| D3  | **Type**: a 12 px floor and the nine-step scale (12 / 13 / 14 / 15 / 16 / 20 / 24 / 32 / 44), at most eight steps on any board; Inter + JetBrains Mono; Fraunces retired. This overrides the 9.5 px floor of the 2026-09 audit and the 10 / 11 px floor of the v1.1 plan.                                                                                                                                                                                                                                                                | system §3                      |
| D4  | **One surface**: `2560×1440` is the only resolution that matters (operator, 2026-09-07). Chrome: header 56, footer 40, cluster 424, plate 416, gutters 16; the Console shows 4 / 6 / 3 strips. The 1920 and 1280 layouts in the mocks are a fallback, not a deliverable; every gate runs at 2560. The existing 1920 / 1280 guards (`audio-legibility`, `viewport-contract`, the 6-size scroll check) stay as fallback guards per non-negotiable 3; S2 records the ruling in `AGENTS.md` §Hardware target and `docs/HARDWARE_PROFILE.md`. | operator 2026-09-07            |
| D5  | **Colour roles**: selection is a neutral keyline; amber is engaged (fill) and attention (lamp / keyline); green is live and ok; red is hazard and error, with at most one red command per surface at rest; **blue is added** for information (preview). The Console's private accent and theme block go.                                                                                                                                                                                                                                 | system §4                      |
| D6  | **48 V on** is a red lamp and word on the key, not a red-filled key; arming a change gets the full amber arm treatment.                                                                                                                                                                                                                                                                                                                                                                                                                  | console-concepts §6            |
| D7  | **Locked** (not verified, offline, disconnected, disabled) is a dashed outline at 55 % with `aria-disabled`, the reason in the state display and on every tier header; never opacity alone.                                                                                                                                                                                                                                                                                                                                              | console-a-states §2            |
| D8  | The state display's way-out key **duplicates** the same command in the cluster's standing actions (Sync, Run audio probe); the duplication is deliberate.                                                                                                                                                                                                                                                                                                                                                                                | console-a-states §2            |
| D9  | Withdrawn with D4: utility mode is not a deliverable. The key rail, the drawer and the short names stay in the mocks as a fallback and are not gated.                                                                                                                                                                                                                                                                                                                                                                                    | operator 2026-09-07            |
| D10 | Planning's `ON TIME` / `SLIPPED` word is derived from the same slipped / blocked counts the workspace computes today, labelled as the app's reading, until the engine owns a planning status (F3).                                                                                                                                                                                                                                                                                                                                       | workspaces-a §6                |
| D11 | Lighting: scene recall is one press with its fade; saving over a scene is arm-then-apply; `CUT ALL` is the surface's one red command; "Delete fixture…" is plain.                                                                                                                                                                                                                                                                                                                                                                        | workspaces-a §2                |
| D12 | Setup's step screen is content-height on the bay floor; Publish becomes "Publish with override…" (red keyline, dialog) when a probe is not green; the theme switch lives only in Support › Workstation and the palette.                                                                                                                                                                                                                                                                                                                  | workspaces-a §4                |
| D13 | Theme names stay Studio, Graphite, Bone (the `data-theme` keys and tests keep working); their materials are re-derived per D2.                                                                                                                                                                                                                                                                                                                                                                                                           | system §5                      |
| D14 | The **measurement probe** becomes a repository gate (S0) with the system's thresholds: floor 12, ≤ 8 sizes, radii ⊆ {4, 8, 12, pill}, targets 24 / 28 / 32, pixel-sampled contrast, light census (no negative offsets, blur > 8 only lit or drawer), idle animations 0, chrome ± 2 px, copy scan.                                                                                                                                                                                                                                        | system §10                     |

## Boundary (engine and protocol impact, stated up front)

- **F1 — Deck selected-strip accent.** The deck marks the selected strip amber; on screen amber means engaged and selection is neutral. `scripts/deck-assets.py` + Companion feedback colours; not a front-end change.
- **F2 — Per-value doubt marks.** `audio.snapshot` reports one global confidence and a count; the `assumed` mock marks three values because that is the target. Until a per-channel / per-mix-target `confidence` field lands, the Console shows the badge, the sentence and the count only (non-negotiable 4).
- **F3 — Planning status.** No engine field; D10 applies.
- **F4 — Engine copy.** `OFFLINE`'s code line still says "Console did not answer OSC ping"; `lastActionMessage` strings are engine-side and the copy pass (S8) can only wrap them.
- Everything else is React, CSS modules, tokens, stories, tests and docs; no persistence, device or policy logic moves into React.

## Slice 0 — Measurement lanes: the system's §10 becomes executable

Status: **landed 2026-09-07** (commit pending the operator's word). Four lanes, seeded at the current program's numbers: `frontend/app/tests/ui-contract.spec.ts` (27 fixtures × 2560×1440 × three themes = 81 boards + the state-display x-band check; ratchets in `tests/ui-contract.ratchets.json`, re-seeded only at a slice close with `node scripts/ui-census.mjs --write-ratchets` from `frontend/app`, whose diff is the "numbers that moved" report; the census, PNGs and `contrast.md` land in `artifacts/ui-census/`), `frontend/packages/design-system/src/__tests__/css-literals.test.ts` (allowlist `css-literals.allowlist.json`, re-seeded with `UPDATE_CSS_LITERALS=1`), and `scripts/check-operator-copy.mjs` + its test (ratchet `scripts/operator-copy.ratchet.json`). The census and the pixel sampler are ports of the evidence probe and reproduce the review's numbers (Studio Audio 7, Planning 24, Graphite Setup 8, Bone Lighting 64, Bone Audio 72 of 383). Seeds, whole program: contrast fails 1 414 across 81 boards (Bone Audio 633, Bone Lighting 340, Studio Planning 80); type floor 8.5 px (Lighting), 9.5 px (Console, Setup), 9.89 px (Planning), 10 px (pre-ready); up to 16 distinct sizes (Lighting) and 14 (Console); 207 Console targets under 24 px per theme, 77 Lighting, 29 Planning; radii outside {4, 8, 12, pill} on 2 020 Console elements per theme; 129 shadows on the idle Console, 0 with a negative offset (the review's 129 confirmed), 47 blurs over 8 px on unlit elements, 997 gradients off policy (no `[data-material]` / `[data-signal]` hooks exist yet); idle animations 1 on every Lighting board (the scene-tile pulse), 1 on startup-loading (the spinner), 8 on Planning; 1 target off the viewport on planning-populated; copy hits 42 in source (engine 26, snapshot outside the Console 14, transport 2) and 6 on every pre-ready board; no board scrolls; `[data-region]` present on 0 of 5 (Slice 2 declares them); no `data-take` controls yet (Slice 3 marks them); CSS literals colour 149 · font-size 119 · radius 81 · box-shadow 115 across 59 stylesheets. Two departures from the plan's letter, both measured rather than assumed: disabled controls are exempt from the contrast count (as the evidence sampler exempts them through opacity, and WCAG 1.4.3), and the spec allows one retry because one board in three full runs measured a node either side of its seed under parallel load before an explicit animation settle was added (three clean full runs since, two with the settle); lamps, keylines and key edges at 3:1 are measured from Slice 3, when the `Lamp` / `Key` hooks exist to sample. The `npm run scripts:test` glob is single-quoted and finds no tests on this Windows workstation (a pre-existing quirk; CI on Linux and a double-quoted glob run all 80).

Scope: turn `gold-standard-evidence-2026-09/probe/concepts.mjs` + `contrast.py` into repository gates so every later slice moves a number.

- `frontend/app/tests/ui-contract.spec.ts` (new): for every fixture in `fixtures.json` × 2560x1440 × {studio, graphite, bone}: no page scroll; type census (min ≥ 12, distinct ≤ 8, families ⊆ {Inter, JetBrains Mono}); radii ⊆ {4, 8, 12, pill}; targets ≥ 24 (enabled), `data-take` ≥ 28; pixel-sampled contrast from the screenshot with the evidence sampler's rules (inner ring for text on a surface, interior mode for text on a filled control, SVG `fill`, opacity < 0.9 exempt); light census (shadows with negative outer offsets = 0; blur > 8 px only on `[data-lit]` or `[data-level="float"]`; gradients only on `[data-material]` or `[data-signal]`); idle running animations = 0; `[data-region]` heights within ± 2 px of D4; the state display's x-band identical across workspaces. Seeded as ratchets at the current program's numbers; tightened per slice.
- `frontend/app/scripts/ui-census.mjs` (new): the human-readable census (the tables in the write-ups) from the same code path.
- `frontend/packages/design-system/src/__tests__/css-literals.test.ts` (new): colour / font-size / radius / box-shadow literals in `*.module.css` against an allowlist that shrinks per slice.
- `scripts/check-operator-copy.mjs` (new, in `scripts:test`): the forbidden words (engine, backend, transport, IPC, snapshot outside the audio scene primitive, "OSC ping", raw `AUDIO_*` codes as the first line of a band).

Gates before: page scroll on 5 fixtures × 6 sizes in `visual-review.spec.ts`; `viewport-contract.spec.ts`; the 9.5 px / 3:1 floor in `audio-legibility.spec.ts`; the colour-literal Vitest on `AppShellFrame.module.css`.
Gates after: 27 fixtures × 3 renders (2560, three themes) under the ratchets; the literal and copy scans report their seed counts; the light census reports the seed (129 shadows, mixed directions on the idle Console).
Tests added: `ui-contract.spec.ts`, `css-literals.test.ts`, `check-operator-copy.test.mjs`.
Tests changed: none. Baselines: none. CHANGELOG: none.
Commit: `A S0: UI contract lanes (type, contrast, targets, radii, chrome, light, motion, literals, copy)`.

## Slice 1 — Tokens and themes: the A token set lands

Status: **landed 2026-09-07** (commit pending the operator's word). Depends on D2, D3, D5, D13. `core.json` grew from 255 to 400 leaves: `material` (14, with `stripFloor` / `stripFloorSel` from the polish pass), `text` (2), `accent`, `role.{amber, green, red, blue, primary, cap}` (24), `display` (10, with the blooms), `signal` (9, with the ramp and CCT gradients), `font.size.{tick … hero}` + `lineHeight` + `tracking`, `radius.{ctl, key, screen}`, `chrome.studio.*` (7, D4's one surface), `elevation.*` (22, every recipe as a `var()` string so it re-themes), `motion.duration.{lamp, press, state, enter, exit, move}` + `easing.mech`, `target.*` (3). `themes.css` re-maps material, text, accent and the role variants for Graphite and Bone exactly as the proposal file does, and scopes the display inks on `.well, [data-well]` (Bone lifts `display.text2`). The old names stay: six font sizes, four radii and `motion.duration.fast` whose values coincide with an A token are references onto it (`--font-size-sm: var(--font-size-tick)`, byte-identical output); the rest stay literal and deprecated until S11. The Console's private `[data-audio-theme]` blocks are gone: their 30 values per theme moved verbatim into `audio.console.*` (Studio in `core.json`, Graphite and Bone in `themes.css`, driven by the global `data-theme`), and `.audioShell` maps its private names onto them — an honest reading of "re-expressed with aliases": none of the Console's values coincides with a role token, so the family is a deprecated bridge for S4 to retire rather than a role alias. `validate-generated.mjs` asserts one representative per A family, the alias form and the theme blocks. Tests added: `themes.contrast.test.ts` (15 cases: text2 on bg / panel / key, role text on bg / panel, display inks on the well, a lit fill's line2 edge ≥ 3:1 against plate and key, role ink on its own fill, all three themes). Tests changed: none. Baselines: none — visual-review and Storybook (77) pass against the committed PNGs, `audio-legibility` (7) passes, `ui-contract` (82) holds every ratchet. Numbers moved: `AudioWorkspace.module.css` colour literals 58 → 1 (the allowlist re-seeded); the census ratchets re-seeded with an empty diff. One lesson recorded: the first rewrite of the Console stylesheet dropped the 192 lines after the theme blocks, which every audio baseline and the Bone legibility spec caught (`composes` of a missing class renders `undefined`) — the tail was restored verbatim from git before the lanes went green.

Scope (`frontend/packages/tokens`):

- `core.json` gains the A families from `tokens-a-2026-09.json`: `material.{bg, bay, panel, panelTop, key, keyTop, well, line, line2, sheen, shade, wellShade}`, `text.{text, text2}`, `accent`, `role.{amber, green, red, blue}.{fill, fillTop, ink, text, bloom}`, `display.{text, text2, green, amber, red, blue}`, `signal.{meterLow, meterMid, meterHot, meterOver, peak, peakBloom, cctTrack}`, `font.size.{tick 12 … hero 44}`, `radius.{ctl 4, key 8, screen 12, pill}`, `chrome.<viewport>.*`, `elevation.*`, `motion.*`, `target.*`. `themes.css` re-maps `material`, `text`, `accent` and the role text variants for Graphite and Bone exactly as the proposal file does; `.well` scopes the display inks.
- The 20 existing font-size names, the old radii, `shadow.*` and the old role names stay as **aliases** onto the new tokens (removed in S11); the generated `tokens.css` and `validate-generated.mjs` cover the new families.
- The Console's private `[data-audio-theme]` block is re-expressed through the role tokens with aliases so the Console is pixel-identical after S1.

Gates before: `validate-generated.mjs`; `AppShellFrame.module.test.ts`; `audio-legibility.spec.ts`; the S0 ratchets.
Gates after: the same plus `themes.contrast.test.ts` (new Vitest computing WCAG ratios from token values: `text2` ≥ 4.5 on bg, panel, key and well per theme; every role text ≥ 4.5 on bg and panel; display inks ≥ 4.5 on well; role fills ≥ 3:1 edge with their hairline).
Tests added: `themes.contrast.test.ts`. Tests changed: none (aliases). Baselines: none (aliases keep every render).
CHANGELOG: none (no operator-visible change yet).
Commit: `A S1: the A token set (material, roles, display inks, signal, type, radii, chrome, elevation, motion) with aliases`.

## Slice 2 — The shell skeleton: header, footer, the cluster grid, the drawer

Status: **landed 2026-09-07** (commit pending the operator's word). Depends on D1, D4, S1. `AppShellFrame` is the A grid on every surface: a 56 px header (the square crest, `Studio Control` over the `SSE Executive Education` eyebrow, four `Tab`s with their `Ctrl` hints aria-hidden so the accessible names stay the workspace names, the Lighting / Audio / Surface `LampChip`s, the Solo and Scene drift latches as amber chips, the clock), a body of `cluster | bay | plate` at D4's widths through optional `cluster` / `plate` slots (the bay alone until a workspace fills them in S4–S7), and a `Footer` slot; every region declares `data-region`, the header and footer `data-material="plate"`, the active tab `data-material="key"`, lit lamps `data-lit`. New primitives `Tab`, `Lamp`, `LampChip`, `Footer`, `Crest variant="mark"` with DS tests (12) and stories (3). `statusTone.ts` gains `worstTone` / `toneForSubsystem`; the shell derives each lamp from the engine's health check and the workspace's own state (the Console's `describeAudioStatus`, the rig's `reachable`, scene drift), so `ACTION FAILED` and an unreachable bridge are red in the header (C3). Setup / Support and the startup and recovery surfaces render inside the same frame: every tab locked (dashed, `aria-disabled`, D7) before the engine is ready, the operator tabs locked until the engine's startup target says the dashboard is unlocked; `PreReadyFrame` is deleted. `--operator-shell-height` is the chrome token times the UI scale. D4 is recorded in `AGENTS.md` §Hardware target and `docs/HARDWARE_PROFILE.md`. The workspace top bars and footers are untouched (S4–S7 move their controls; the `[data-toolbar-primary]` ids have not moved). Tests added: `shell.spec.ts` "the header lamp's tone equals the workspace's state tone on lighting-dmx-unreachable / audio-offline / audio-action-failed" (against the Console's warning band and the bridge banner, which now carry `data-tone`, until the state display lands in S4) and "Setup renders inside the shell with tabs and lamps" (header height within 2 px of 56, leaving Setup from the Lighting tab); `ShellPrimitives.test.tsx`. Not written: the plan's "at 1280 the plate is a drawer and the cluster is 232 px" — D4 / D9 withdrew utility mode before this slice started, so no drawer exists to test. Tests changed, old → new → reason: `startup.spec.ts` "renders startup and recovery fixture states" and "startup-loading fixture hides every operator workspace surface" (no `Workspace command rail` → the navigation is visible and every tab `aria-disabled`; D1); `setup.spec.ts` "renders the setup/support pilot shell from fixtures" (no rail → Setup tab `aria-current`, Audio tab locked on setup-required; D1); `audio-legibility.spec.ts` nav test (header stops `--color-bg-deep` / `--color-shell-header-bottom` → `--material-panel-top` / `--material-bg`; the header is the A plate); `storybook.spec.ts` (the clock is frozen for every shell story and Setup stories await audio hydration; the header clock and lamps); `AppShellFrame.module.test.ts` (the old header tokens → the A plate and chrome tokens). Baselines: all 77 visual and Storybook baselines moved (the header) plus 3 new stories; every header was inspected on a contact sheet of all 65 captures and four full boards before the refresh. Numbers moved (ratchets re-seeded, 81 boards): `regionsPresent` 0 → 1 on every board (header 56 ± 2 holds); distinct sizes down on 63 boards (sum 933 → 753); text outside Inter / JetBrains Mono 405 → 324 (the Fraunces product name); contrast fails 1 414 → 1 313 (down on 25 boards; up by one on bootstrap-failed, protocol-mismatch and lighting-dmx-unreachable in Studio / Graphite, where old bay nodes shifted 36 px up onto a pixel that samples at 4.50 and 4.35 — not header text); blur over 8 px on unlit elements 339 → 276 (the old monitor-dot glows); gradients off policy 3 939 → 3 420; type floor rose on 18 boards (the old 9.89 px header text). CSS literal allowlist tightened: `AppShellFrame.module.css` font-size 4 / radius 1 / box-shadow 1 → 0.

Scope (`packages/design-system`, `app/src/app/OperatorShell.tsx`, `shellData.ts`, `shared/PreReadyFrame.tsx`):

- `AppShellFrame` becomes the A grid: `Header` 56 (crest, product with the SSE Executive Education eyebrow, `Tab` ×4, `LampChip` ×3, `Latch` chips, the clock) · body `cluster | bay | plate` at D4's widths with `[data-region]` ids · `Footer` 40 (`Label value` items that drop labels before values, hint kbds, one action slot).
- Tone map: `statusTone.ts` gains `toneForSubsystem(healthCheck, workspaceState)`; the header lamps and each workspace's state display derive from it, so the lamp mirrors the worst state its workspace shows (C3) — `ACTION FAILED` is red in the header.
- The workspace top bars (`AudioTopBar`, `LightingToolbar`, Planning's toolbar) are removed as chrome; their controls move into the cluster or the bay header per the mocks (S4–S7 do the moves; S2 removes the slot and keeps their `[data-toolbar-primary]` ids on the elements' new homes via a compatibility mapping).
- Setup / Support and the pre-ready surfaces render inside `AppShellFrame` (the header with the tabs disabled on startup and recovery).

Gates before: `shell.spec.ts` (8), `viewport-contract.spec.ts` (1), `visual-review.spec.ts` `assertLightingResponsive`, `storybook.spec.ts` (23), `audio-legibility` nav 4.5:1, `setup.spec.ts` / `startup.spec.ts` frame tests.
Gates after: the same, plus `ui-contract` chrome geometry (heights ± 2 px; the state display slot's x-band within ± 8 px across the four workspaces), the light census on the shell.
Tests added: `shell.spec.ts` "the header lamp's tone equals the workspace's state display tone on lighting-dmx-unreachable, audio-offline and audio-action-failed"; "Setup renders inside the shell with tabs and lamps"; "at 1280 the plate is a drawer and the cluster is 232 px".
Tests changed: `startup.spec.ts` "startup-loading fixture hides every operator workspace surface" (old: no nav → new: nav rendered disabled; reason: D1); `setup.spec.ts` "renders the setup/support pilot in its own frame" (old: `PreReadyFrame` → new: `AppShellFrame`; reason: D1).
Baselines: every visual and Storybook baseline moves (header height); inspect each PNG before refresh.
CHANGELOG: `Changed — One header on every surface, including Setup / Support and the recovery screens; the subsystem lamps show the same severity the workspace shows.`
Commit: `A S2: the shell skeleton (header, footer, cluster grid, drawer, tone map) on every surface`.

## Slice 3 — The primitives

Status: not started. Depends on D2, D5, D6, D7, S1.

Scope (`packages/design-system`, stories):

- `StateDisplay` (new): tone `ok | attention | error | info`, word, sentence, code, meta, actions, the armed row; fixed height (180 px); the radial tone tint; test id `<workspace>-state-display`.
- `Key` (new, one primitive): modes `command | primary | danger | toggle | momentary | arm | hazard | segmented`, `engaged`, `live`, `locked` (dashed at 55 %, `aria-disabled`, `reason`), `cap` (mono uppercase) vs label; `ArmKey` carries the countdown bar and keeps `data-testid="audio-arm-countdown"`; `Button` aliases `Key mode="command"`.
- `Lamp`, `LampChip`, `LampWord`, `Latch`.
- `Well` family: `Readout` (with `doubt`), `Slider` (unity notch, cap), `Groove` (the 44 px target column with the 18 px slot; promoted from Audio, shared with Lighting's intensity), `Meter` (mono / stereo, ramp + emissive layer, reference, peak, clip; `empty`, `stale`), `Field`, `Screen`.
- `Plate` sections: `PlateHead`, `Section`, `Fields`, `Readouts`, `ControlRow`, `Danger` (no tab row: every section is visible at once).
- `Drawer` (level +3), `Dialog` / `ConfirmDialog` / `CommandPalette` / `Toast` re-skinned onto the level +3 recipe with one focus ring and sentence-case verbs; `LoadingState` (skeleton at the host's geometry), `EmptyState` (stacks under 320 px).
- Storybook: one story per primitive per theme, with every mode; `A-system-sheet.html` is the reference.

Gates before: DS Vitest 122 tests; `storybook.spec.ts`; `audio-arm-countdown.spec.ts` (3); `audio-talkback.spec.ts` (4).
Gates after: the same plus the new DS tests and new Storybook baselines (inspected); the S0 light and target checks pass on the Storybook pages.
Tests added: `StateDisplay.test.tsx` (fixed height (180 px), tone word colour, actions render, armed row), `Key.test.tsx` (modes, engaged / live fills, locked exposes the reason and `aria-disabled`, cap is uppercase mono, ≥ 24 / 28 px), `ArmKey.test.tsx` (dwell, timeout, Esc, second press on the same key only), `Lamp.test.tsx` (lit / unlit, word within 8 px), `Well.test.tsx` (display inks in every theme), `Meter.test.tsx` (empty / stale / ramp stops), `Drawer.test.tsx`.
Tests changed: `StatusBadge.test.tsx` (old tone names → `ok | attention | error | info`; reason: system §8; aliases until S11); `Button.test.tsx` (uppercase class → sentence case; reason: system §9).
Baselines: Storybook 23 → about 45; every changed PNG inspected before refresh.
CHANGELOG: `Changed — One family of keys, lamps, wells and state displays carries every state in the program; lit keys bloom, locked keys are outlined and say why.`
Commit: `A S3: the primitives (StateDisplay, Key family, Lamp, Well family, Plate sections, Drawer) and the re-skinned overlays`.

## Slice 4 — The Console

Status: not started. Depends on S1–S3, D6, D7, D8, D9, F2.

Scope (`app/src/app/audio`): the A-cockpit mock in all ten states at 2560×1440.

- Cluster: `StateDisplay` (badge word from `describeAudioStatus`, sentence, code, meta with the confirmed count and last sync, the way-out key), the solo latch row, `TALKBACK` momentary key, `DIM` / `MONO` toggles, the mix-target segmented well (long caps / the deck's short caps at 1280), the main-level hero and slider, the master meter, eight snapshot keys (`ArmKey`; numbered at 1280), the standing actions. No feedback banner in the grid; arming renders on the key and in the display (C1).
- Bay: thirteen strips in three tiers (4 / 4 / 3 banked below 2200 px with the tier note and the footer bank item), each strip head → readout → preamp rows (48 V hazard key + gain, or tag + other sends, or tag + dim / mono lamps) → M / S → fader block (`Groove` with the 44 px target, `Meter` with glow); the selected strip keylined; `doubt` per value when F2 has landed, else the display's count only.
- Plate: the selected strip's sends, EQ, meter readouts, keys and the channel flags (stereo link, send mode, compressor, gate), every section visible at once; no tab row.
- States: `locked` (not verified, offline, disconnected, disabled), `no-meter` (offline, disconnected), `stale`, `talkback-refused` (the key's red keyline and hint), `action-failed` (Dismiss), `armed`.
- The private theme block and the top-bar theme switch removed (D5, D12); palette actions `system:theme:{studio,graphite,bone}`; footer → shared `Footer`.

Gates before: `audio.spec.ts` (40), `audio-hierarchy.spec.ts` (3), `audio-inspector-polish.spec.ts` (6), `audio-arm-countdown.spec.ts` (3), `audio-talkback.spec.ts` (4), `audio-render-budget.spec.ts` (2), `audio-meter-gating.spec.ts` (2), `audio-legibility.spec.ts`; the S0 audio ratchets.
Gates after: the same plus the new tests; `ui-contract` audio ratchets tightened to the system's thresholds (floor 12, ≤ 8 sizes, radii 4, targets 24 / 28 / 32, idle 0, light clean, 0 contrast fails in three themes).
Tests added: `audio.spec.ts` "arming a snapshot recall leaves the state display, every cluster key and every strip at the same bounding box" (C1); "audio-not-verified renders every console write as `aria-disabled` with a dashed outline and the reason on each tier header" (C2); "audio-state-assumed shows the engine's count in the state display and, when the snapshot carries per-channel confidence, a doubt keyline on each unconfirmed readout" (F2-gated); "audio-offline empties the meters and prints `—` in the readouts"; "audio-action-failed turns the header lamp red" (C3); "at 1920 the playback tier shows four pairs and the bank item reads `1–4 · 1–4 of 6 · 1–3`"; "at 1280 the strips print the deck's short names and the plate opens as a drawer".
Tests changed: `audio-hierarchy.spec.ts` "output lane exposes inline Mute; monitor bar owns Dim / Mono / Talkback" (old: `audio-monitor-bar` strip → new: the cluster with the same test id on its root; reason: D1); `audio-arm-countdown.spec.ts` (old: banner text → new: the display's armed row and the key's bar; reason: C1); `audio-legibility.spec.ts` (old 9.5 px / 3:1 → new 12 px / 4.5:1; reason: D3).
Baselines: every audio baseline and the Scaled Studio Preview set; inspect before refresh. Operator checklist B1–B3.
CHANGELOG: `Fixed — Arming a recall or receiving an action result no longer moves Talk, Dim, Mono and the master meter.` · `Changed — The Console's state, talkback, dim, mono, mix target, main level, master meter and snapshots live in a fixed cluster on the left; locked controls are outlined and say why; unconfirmed values are marked on the value itself once the desk reports them.` · `Changed — The Console shares the program's accent and theme.`
Commit: `A S4: the Console on the cluster rule — state display, keys and wells, honest locks and doubt`.

## Slice 5 — Lighting

Status: not started. Depends on S1–S3, D11.

Scope (`app/src/app/lighting`): the A-lighting mock in its four states at 2560×1440 — the state display (`REACHABLE` / `UNREACHABLE` / `UNSAVED` / `PREVIEW` from `reachable`, the scene drift detector and preview mode), `LIGHTING` toggle + `CUT ALL` danger key, the grand master hero, scene keys with the fade and "Save · press twice" (`ArmKey`), group rows, standing actions; the plot as a `Screen` at the rendered size (fixtures at real positions, beams tinted by CCT, camera and subject marks, patch mode tags); the plate with Identify (momentary), on / off, intensity and CCT sliders, position and patch fields, "In scene …" readouts, "Delete fixture…"; unreachable locks the rig controls and prints the lock note on the plot header; the `Scene unsaved` latch in the header; the existing `[data-toolbar-primary]` ids on their new homes.

Gates before: `lighting.spec.ts` (27), `visual-review.spec.ts` `assertLightingResponsive`, lighting baselines at six sizes, Bone and Graphite; S0 lighting ratchets.
Gates after: the same plus the new tests; `ui-contract` lighting ratchets tightened; no clipped footer values (H3).
Tests added: `lighting.spec.ts` "unreachable: the state display carries the bridge sentence and the probe key, every rig control is `aria-disabled` and dashed, the header lamp is red" (M3, C3); "unsaved: the header shows the `Scene unsaved` latch and the current scene key says so"; "preview: the plot carries the blue keyline and the state display offers Save to the rig / Discard"; "empty rail and plot states render title, sentence and action in one column at 2560 and 1280" (H5); "the plot keeps 12:8 at all three viewports and never scrolls".
Tests changed: `visual-review.spec.ts` `assertLightingResponsive` only if a primary id is added (none renamed); `lighting.spec.ts` cases that click the footer's DMX strip toggle (same label, now a key in the cluster's actions).
Baselines: all lighting baselines; inspect before refresh. Operator checklist B4.
CHANGELOG: `Changed — Lighting follows the cluster rule: the bridge state first, then Lighting on, Cut all, the grand master, the scenes and the groups; the plot is a backlit screen at real scale.` · `Fixed — When the bridge is unreachable the rig controls are outlined, the state display says why and offers the probe.`
Commit: `A S5: Lighting on the cluster rule — state display, plot screen, keys, unreachable / unsaved / preview`.

## Slice 6 — Planning

Status: not started. Depends on S1–S3, D10.

Scope (`app/src/app/planning`): the A-planning mock — the day's state display (`ON TIME` / `SLIPPED`, derived, with the counts), running timers as live rows, Timeline · Board segmented well, the day keys, project keys, standing actions; the timeline as a `Screen` (lanes per project, cards at start with duration bars, second row on overlap, edge cards hanging left, every other hour labelled below 90 px/h, the now marker at the bottom, the unscheduled tray); filters and search on the screen header; the plate with the selected task (the `RUNNING` live key, schedule fields, checklist, notes, "Delete task…"); the board view on the same screen.

Gates before: `planning.spec.ts` (14); planning baselines; S0 planning ratchets.
Gates after: the same plus the new tests; `ui-contract` planning ratchets (no wrap, targets, focus ring, light clean).
Tests added: `planning.spec.ts` "the cluster and the screen header never wrap" (H11); "planning-overlap renders overlapping cards in a second row with no clipped title"; "a card whose box would pass 22:00 hangs to the left of its start and its bar is clipped at the axis end"; "selecting a task populates the plate; Escape clears it"; "a running timer renders the live key in the plate and the row in the cluster".
Tests changed: `planning.spec.ts` cases that open the detail overlay (old: dialog `planning-project-detail` → new: the plate with the same test id on its root; reason: D1).
Baselines: all planning baselines; inspect before refresh.
CHANGELOG: `Changed — Planning follows the cluster rule: the day's state, the running timers, the view and the projects on the left; the timeline is a backlit screen whose cards never overlap; the selected task on the right.`
Commit: `A S6: Planning on the cluster rule — state display, timers, timeline screen, plate`.

## Slice 7 — Setup / Support and the pre-ready surfaces

Status: not started. Depends on S2, S3, D12.

Scope (`app/src/app/setup`, `app/src/app/startup`): the A-setup mock in its three states at 2560×1440 — the commissioning state display (`READY` / `DEGRADED` / `SETUP REQUIRED` with the engine's sentence and the way-out key), Runner · Support, step keys (done / current / pending lamps), probe rows with result sentences, standing actions; the step screen at content height (two columns) with the fact cards, the record rows, the commissioning record, the archive rows and the Publish keys (override variant when a probe is not green, with the dialog); the Support plate (theme and UI scale segmented wells, backups, diagnostics, sample data, versions, "Restart the bridge…" as the one red command); the recovery and startup surfaces on the same skeleton with the tabs disabled, no element off-viewport (C4).

Gates before: `setup.spec.ts` (10) incl. SET-11, `startup.spec.ts` (5) incl. SET-11; setup-ready and protocol-mismatch baselines; S0 setup ratchets.
Gates after: the same plus the new tests; `ui-contract` asserts no off-viewport element on any setup or pre-ready fixture.
Tests added: `setup.spec.ts` "the Publish keys and every probe result are fully visible without scrolling" (C4); "degraded: the display offers Run all probes and Publish becomes Publish with override…"; "setup-required: step 1 is current, the others pending, the three header lamps mirror the probes" (H12); "Support keeps the shell header, tabs and lamps" (H1); `startup.spec.ts` "every recovery band names a next step".
Tests changed: `setup.spec.ts` SET-11 (old: panels scroll within tracks → new: the step screen needs no scroll; only unbounded lists scroll; reason: system §2); `startup.spec.ts` SET-11 (same); "renders the setup/support pilot in its own frame" (moved in S2).
Baselines: setup and pre-ready baselines at all sizes; inspect before refresh. Operator checklist B5.
CHANGELOG: `Fixed — Setup's Publish step and the recovery screens fit the studio monitor with every control visible.` · `Changed — Setup / Support follows the cluster rule: the commissioning state first, the steps and probes as keys, the step on a backlit screen, Support always at hand.`
Commit: `A S7: Setup / Support and the pre-ready surfaces on the cluster rule`.

## Slice 8 — Operator copy pass and the copy gate

Status: not started. Depends on S0's scanner.

Scope: every operator-facing string per system §9 — forbidden words replaced (the desk link, Studio Control, TotalMix, the bridge, the deck); "Loading the console…" / "Loading the rig…" / "Loading planning…"; startup steps in the operator's words; recovery bands with a next step; key caps in the deck's words; numbers with sign and unit; the engine's sentences printed verbatim with codes small (F4 for the engine's own strings).

Gates before: the S0 copy scanner's seed count; specs asserting current strings.
Gates after: scanner at 0 hits; every string assertion updated (old → new → reason in the status line).
Tests added: the scanner is the test. Tests changed: string assertions in `audio.spec.ts`, `setup.spec.ts`, `startup.spec.ts`, `shell.spec.ts`, listed one by one.
Baselines: every surface whose text changed; inspect before refresh.
CHANGELOG: `Changed — Operator copy names the desk, the bridge and the deck; every state says what happened and what to do next; key caps read like the Stream Deck's.`
Commit: `A S8: operator copy pass and the copy gate`.

## Slice 9 — Calm surfaces, light and motion

Status: not started. Depends on S1, S3.

Scope: every remaining shadow resolves to one of the elevation tokens (negative offsets 0; blur > 8 only lit or drawer); gradients only on plates, keys, caps, meters and the CCT track; hover changes an edge only; idle animations 0 (the Lighting scene-tile pulse goes); `prefers-reduced-motion` removes enter / exit / move and the meters' display smoothing (R2-MOT-01); the marker chip hover pulse goes (R2-MOT-03).

Gates before: S0 light and motion census seeds.
Gates after: `ui-contract` idle animations = 0 on every ready fixture; light census clean; a DS Vitest asserting no `transform` in `:hover` rules.
Tests added: the two above. Tests changed: none. Baselines: several move (shadow normalisation); inspect before refresh.
CHANGELOG: `Changed — Every shadow on screen comes from one light; controls no longer jump on hover; nothing animates on an idle surface; reduced-motion settings are respected.`
Commit: `A S9: one light, calm surfaces and the motion policy`.

## Slice 10 — Graphite and Bone pass the legibility gate everywhere

Status: not started. Depends on S1, S4–S7.

Scope: walk every fixture in Graphite and Bone with the pixel-sampled gate; fix what remains with the token rules already proven on the mocks (display inks on wells, darkened text variants in Bone, primary-key kbd inks, edge labels anchored inward, tick labels padded).

Gates before: S0 contrast ratchets per theme (seed: Bone Lighting 65 / 162, Audio 79–83 / 392; Studio Audio 7, Planning 25; Graphite Setup 8).
Gates after: 0 failures at 4.5:1 for text ≥ 12 px, 0 at 3:1 for lamps, keylines and key edges, in all three themes, on all 27 fixtures.
Tests added: none beyond tightening the ratchets to zero. Tests changed: `audio-legibility.spec.ts` final thresholds (moved in S4).
Baselines: Bone and Graphite sets; inspect before refresh. Operator checklist B6.
CHANGELOG: `Fixed — Bone and Graphite are legible on every surface.`
Commit: `A S10: Graphite and Bone pass the legibility gate on every surface`.

## Slice 11 — Close-out

Status: not started.

Scope: remove the deprecated token aliases and the old badge / band / dot / button prop names once no consumer remains; `docs/HARDWARE_PROFILE.md` density table → D4's numbers; `docs/OPERATIONS.md` state words and key names; the Storybook and visual baselines refreshed on win32 with linux from CI and darwin pending; the operator checklist signed.

Gates before / after: the full `frontend:playwright:test` matrix, `dev:check`, `tauri:visual:review`.
Commit: `A S11: close-out — alias removal, docs, baselines, operator sign-off`.

## Validation per slice (the same every time)

1. `npm run frontend:typecheck` and `npm run frontend:test`.
2. `npm run build --workspace frontend/app` **before** any Playwright run (the specs serve `dist`).
3. `cd frontend/app && npx playwright test ui-contract.spec.ts <workspace specs touched>`.
4. Visual: `npm run frontend:storybook:build`, then `npx playwright test visual-review.spec.ts storybook.spec.ts`; copy `*-diff.png` out of `test-results`, inspect every changed PNG, then refresh win32 only, commit as `A S<N> (baselines): …`.
5. `npm run dev:check` green, then the slice commit with a What / Why / Tests / Verified body.
6. Never run `tauri:setup-support:qualify` concurrently with Playwright (both bind 4173).

## Appendix A — Gate honesty map (finding → guard after this plan)

| Finding                      | Guard                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| C1 monitor section jumps     | `audio.spec.ts` bounding-box invariance across arm / action result; `ui-contract` chrome geometry |
| C2 doubt and locks invisible | `audio.spec.ts` locked-outline and count tests; the doubt keyline test once F2 lands              |
| C3 lamp vs workspace tone    | `shell.spec.ts` tone-equality; shared `toneForSubsystem`                                          |
| C4 Publish step clipped      | `setup.spec.ts` / `startup.spec.ts` no-scroll tests; `ui-contract` off-viewport = 0               |
| H1, H2, H3 skeleton          | `ui-contract` chrome heights and state-display x-band; DS Vitest for `AppShellFrame`, `Footer`    |
| H4 second accent             | `css-literals.test.ts`; `ui-contract` colour census                                               |
| H5 empty states              | `EmptyState.test.tsx`; `lighting.spec.ts`                                                         |
| H6 loading states            | `LoadingState.test.tsx`; visual baselines for the loading fixtures                                |
| H7 theme legibility          | pixel-sampled contrast in `ui-contract`; `themes.contrast.test.ts`                                |
| H8 type                      | `ui-contract` floor 12 and ≤ 8 sizes                                                              |
| H9 buttons / radii / chips   | `ui-contract` radii; `css-literals`; `Key.test.tsx`                                               |
| H10 Console at 1280          | withdrawn with D4 (2560×1440 only); the fallback layout is not gated                              |
| H11 planning                 | `planning.spec.ts` no-wrap and second-row tests                                                   |
| H12 copy                     | `check-operator-copy.mjs`                                                                         |
| M4 focus / dialogs           | `Dialog.test.tsx`; `planning.spec.ts` focus ring                                                  |
| M6 targets                   | `ui-contract` targets ≥ 24, take-time ≥ 28                                                        |
| M7 motion, light             | `ui-contract` idle = 0, light census; DS hover rule Vitest                                        |

## Appendix B — Operator checklist (studio monitor, signed by date)

Sign-off state: none signed; every item opens with its slice.

1. After S2: on the studio monitor, the header is one row, every lamp is readable from the chair, and Setup shows the tabs and lamps.
2. After S4 (B1): arm a snapshot recall; nothing moves; the key goes amber with its countdown and the display shows the armed row; Esc clears both.
3. After S4 (B2): with TotalMix remote 4 disabled, move a desk fader, re-enable, watch `ASSUMED`, the count and (once F2 lands) the doubt keylines; press Sync; everything clears.
4. After S4 (B3): press `DIM` on the deck and on screen — both are lit amber; hold `TALK` — the on-screen key is green for exactly the hold; confirm the deck's selected-strip colour against F1.
5. After S5 (B4): select a fixture from the cluster list and then on the plot; the plate follows both; the footer values are complete.
6. After S7 (B5): walk Setup to Publish and Support › Restore without scrolling the step; the commissioning record and the archive row are visible; the Console's cluster keeps `TALKBACK`, `DIM`, `MONO`, the target keys and the level.
7. After S10 (B6): Bone and Graphite from the chair: every readout, eyebrow and lamp readable without leaning in.
8. After S9: hover every control; nothing moves; the idle surfaces are still; the only motion is the meters.
9. After S4: locked keys in the not-verified state are dashed and dim from the chair, and the tier header says why.

## Baseline refresh procedure

win32: `cd frontend/app && npm exec playwright test visual-review.spec.ts storybook.spec.ts -- --update-snapshots`, inspect every changed PNG before `git add`, commit as `A S<N> (baselines): …`. linux: from the CI `playwright-test-results` artifact once the slice is pushed. darwin: pending.

## Follow-ups (outside this front-end plan)

- **F1** — Deck selected-strip accent amber → neutral, in `scripts/deck-assets.py` and the Companion feedback colours; re-export and Full Reset & Import.
- **F2** — Per-channel / per-mix-target `confidence` and `unconfirmedCount` on `audio.snapshot`, engine-side.
- **F3** — A planning status on the engine's planning snapshot, if the operator wants `ON TIME` to be reported rather than derived.
- **F4** — Engine-side copy of `lastActionMessage` strings ("Console did not answer OSC ping" → the operator's words).
