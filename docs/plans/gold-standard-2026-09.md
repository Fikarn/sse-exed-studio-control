# Gold standard 2026-09 — sliced plan

Status: proposed 2026-09-04, revised 2026-09-05 for brief v1.1 (the material model), on branch `ui-gold-standard-2026-09` (cut from `audit-remediation-2026-09` @ 7f273fe). No slice has started; no source has been edited. Waiting for the operator's approval and the decisions in §Decisions. When approved, the four documents of this pass (brief, review, the two mocks, this plan) land first as `Gold: brief, review, mocks, plan`.

Tracking: the per-slice `Status:` lines below are the authoritative execution record. Each slice lands as its own commit `Gold S<N>: <what landed>` (baseline refreshes as `Gold S<N> (baselines): …`); any divergence from a slice's written scope gets a bold `**Rescope:**` paragraph under that slice per the AGENTS.md rescope protocol — no silent substitution. Every slice records before it closes: what the existing gates asserted before the change, the tests added that would have caught the finding, every test that had to change (old assertion → new assertion → reason), the baselines inspected before refresh, the CHANGELOG bullet per operator-visible change, and `npm run dev:check` green before the commit.

Goal: make the four workspaces one instrument that meets `docs/redesign/gold-standard-brief-2026-09.md` (v1.1), closing the findings in `docs/redesign/gold-standard-review-2026-09.md` in cost order, with the design system and tokens as the only vehicle.

Sources: the brief (§ references below), the review (C/H/M/L ids), the mocks `docs/redesign/assets/gold-standard/Skeleton-Four-Workspaces.html` (open with `?board=audio&state=Assumed&theme=bone`, press `1` for 1:1) and `State-Vocabulary.html`, and the evidence folder `../../../gold-standard-evidence-2026-09/` next to the repo (captures, metrics, the probe scripts; `mocks-v1.1/` holds the rendered boards and their pixel-sampled contrast).

## Non-negotiables (from the operator, 2026-09-04)

1. The design system and tokens remain the vehicle: redesign them where the brief needs it, never bypass them. A workspace composes primitives; it does not re-implement one.
2. All three themes pass legibility (brief §6: text ≥ 4.5:1 pixel-sampled, components, lamps and key edges ≥ 3:1) on every surface before a slice closes.
3. Existing behaviour tests move with a changed contract; none is deleted. Every moved assertion is recorded as old → new → reason.
4. No front-end change may display state the engine does not report. Where the brief asks for a state the snapshot does not carry (§Boundary), the front-end shows the engine's own words and count until the contract carries the field.
5. Test ids (`data-testid="audio-…"`, `lighting-…`, `planning-…`, `setup-…`, `[data-toolbar-primary]`) are extended, never renamed.

## Decisions for the operator (confirm before Slice 1)

| #   | Decision                                                                                                                                                                                                                                                                                                                              | Recommendation         | Where it bites                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| D1  | Setup / Support renders inside the shell frame with the four tabs and the subsystem lamps (H1), and the pre-ready surfaces (startup, recovery) share the same header with the tabs disabled.                                                                                                                                          | Yes.                   | S2, S7. Mock: Setup board.                                                                   |
| D2  | The Console's monitor section (Talk, master meter and level, Dim, Mono) moves into a fixed left rail with the snapshots and the console-link panel (as mocked), giving the tiers ~1,000 px of fader travel at 2560; the alternative is to keep the horizontal strip and only pin its row. Both close C1.                              | The rail.              | S4. Mock: Audio board; the 1280 rule is a 64 px key rail so Talk never enters a drawer.      |
| D3  | Chrome budget per §13: header 64 / 56 / 52, top bar 48 / 44 / 40, footer 40 / 36 / 32, rail 320 / 280 / key rail, inspector 480 / 380 / drawer.                                                                                                                                                                                       | Yes.                   | S2. Replaces the 92 (84) px header, the 44 / 56 / 75 px top bars and the 64 / 22 px footers. |
| D4  | Selection uses the theme accent on every workspace; amber is reserved for engaged (a lit key that is down) and attention (outline, lamp) forms; the Console's private accent and theme block go (H4). The Stream Deck's touch-strip selection marker stays amber until an engine-side follow-up (F1) re-colours the generated assets. | Yes, with F1 logged.   | S1, S4.                                                                                      |
| D5  | Planning's task and project details move from an overlay into the right inspector column; the time report stays a dialog (H11).                                                                                                                                                                                                       | Yes.                   | S6. Mock: Planning board.                                                                    |
| D6  | The type floor becomes 10 px for ticks and 11 px for anything actionable, replacing the 9.5 px floor decided in the 2026-09 audit (Slice 10 there). This overrides an earlier operator decision and is listed here for that reason.                                                                                                   | Yes.                   | S1, S4, S5; `audio-legibility.spec.ts` thresholds move.                                      |
| D7  | The theme switch leaves the Console's top bar and lives in the command palette and in Setup › Workstation.                                                                                                                                                                                                                            | Yes.                   | S4.                                                                                          |
| D8  | Command buttons are sentence-case Inter everywhere, including dialogs; hardware-mirroring keys (`DIM`, `MONO`, `TALK`, `M`, `S`, `48 V`, `→ MAIN`) carry stamped mono caps in the deck's own words (brief §5 "keys versus buttons").                                                                                                  | Yes.                   | S3.                                                                                          |
| D9  | **(v1.1)** The material model of brief §4: one top-left light, five elevation levels as tokens (well / chassis / panel / key / floating), keys that go down for a press and stay down while engaged, lamps that light instantly, wells for every value. Replaces the flat hairline language of v1.0.                                  | Yes.                   | S1 (tokens), S3 (Key, Lamp, Well), every workspace slice. Mocks: both, re-rendered.          |
| D10 | **(v1.1)** A static chassis grain at ≤ 4 % (Studio / Graphite) and 5 % (Bone), as a token the tokens package owns; the only texture allowed. Visual baselines absorb it once.                                                                                                                                                         | Yes; easy to set to 0. | S1, S9.                                                                                      |
| D11 | **(v1.1)** Bone becomes the light industrial chassis (warm grey floor, white sheen, warm shade); Studio stays the powder-coated dark chassis with cream sheen; Graphite the brushed dark steel with cool sheen. Same physics in all three.                                                                                            | Yes.                   | S1, S10.                                                                                     |

## Boundary (engine and protocol impact, stated up front)

- **Per-value doubt marks (C2)** need a field the snapshot does not carry: `audio.snapshot` reports one global `consoleStateConfidence` and the last action's status / code / message; per-send Confirmed / Adjusted / External / unconfirmed is engine-internal (`native/protocol/v1.md` §audio.snapshot). Proposed contract addition, engine-side and outside this front-end plan: `channels[].confidence` and `mixTargets[].confidence` (`"confirmed" | "adjusted" | "external" | "unconfirmed" | "unknown"`) plus `unconfirmedCount`. Until it lands, S4 renders the global badge, the band with the engine's own sentence, and the engine's count — never a per-value mark. This is tracked as follow-up **F2**; S4's status line will say which of the two it shipped.
- **Deck marker colour (D4)** is a `scripts/deck-assets.py` + Companion feedback change (follow-up **F1**), not a front-end change.
- Everything else in this plan is React, CSS modules, tokens, stories, tests and docs; no persistence, device or policy logic moves into React.

## Slice 0 — Measurement lanes: the brief's §15 becomes executable

Status: not started.

Scope: turn the evidence probes into repository gates so every later slice moves a number.

- `frontend/app/tests/ui-contract.spec.ts` (new). For every fixture in `fixtures.json` × {2560x1440, 1920x1080, 1280x800} × {studio, graphite, bone}: no page scroll; computed type census (min size, interactive min size, distinct sizes, families); corner-radius census; enabled pointer targets ≥ threshold; idle running animations after a 1 s settle; chrome geometry (`header`, `[data-testid$="-toolbar"|"-topbar"]`, `[data-health-bar]`, rail, inspector, state badge x-band) once S2 lands; pixel-sampled contrast computed **in-page** (screenshot → data URL → canvas → inner-ring median per text box, exactly `probe/contrast.py`'s method, so no new dependency); **(v1.1)** the light and level census: every outer `box-shadow` offset ≥ 0 in x and y, blur ≤ 8 px outside `[data-level="floating"]`, every shadow value equal to one of the five elevation tokens, no shadow on a level-0 element; **(v1.1)** press physics: for a sample of keys, `:active` computed transform is `translateY(1px)` and the shadow is the down token, `:hover` transform is none; **(v1.1)** lamps: every element with `data-lamp` has a text sibling within 8 px and no running animation. Thresholds live in `tests/helpers/ui-contract-thresholds.ts` as per-fixture ratchets seeded from the evidence (`metrics/dom-census-report.md`, `metrics/contrast-pixel-sampled.md`) and may only tighten.
- `frontend/app/scripts/ui-census.mjs` (new): the human-readable census (the tables in the review's §2) from the same code path, for a fixture set and a port.
- `frontend/packages/design-system/src/__tests__/css-literals.test.ts` (new): scans every `*.module.css` under `frontend/` for hex / `rgb()` / `hsl()` colour literals, `font-size: <px>`, `border-radius: <px>` and raw `box-shadow:` literals against `css-literals.allowlist.json`; fails on any file that gained literals; a companion assertion fails if the allowlist contains an entry that no longer exists (so it only shrinks). Seeds: Audio 117 colour, Lighting 81 font-size, Audio 37 radius, DS 30 colour.
- `scripts/check-operator-copy.mjs` (new, wired into `scripts:test`): scans string literals in `frontend/app/src/**/*.{ts,tsx}` for the brief §10 forbidden words (engine, backend, transport, IPC, snapshot outside the audio scene primitive, OSC ping, raw `AUDIO_*` codes shown to the operator) with an allowlist; reports in S0, gates from S8.

Gates before: page scroll only on 5 fixtures × 6 sizes in `visual-review.spec.ts`; layout mode in `viewport-contract.spec.ts` (1 test); the 9.5 px / 3:1 Console floor and the 4.5:1 nav labels in `audio-legibility.spec.ts` (2 tests); colour literals only in `AppShellFrame.module.css` (3 assertions). Nothing measured radii, targets, chrome, motion, light direction, or contrast outside the Console.
Gates after: 27 fixtures × 9 renders under the ratchets above; the literal and copy scans report their seed counts; the light census reports its seed (the review counts 129 shadows on the idle Console with mixed directions).
Tests added: `ui-contract.spec.ts`, `css-literals.test.ts`, `check-operator-copy.test.mjs` (unit test of the scanner).
Tests changed: none.
Baselines: none.
CHANGELOG: none (no operator-visible change).
Commit: `Gold S0: UI contract lanes (type, contrast, targets, radii, chrome, light, motion, literals, copy)`.

## Slice 1 — Tokens and themes: the scale, the roles, the material

Status: not started. Depends on D6, D9, D10, D11.

Scope (`frontend/packages/tokens`, `OperatorLayoutProvider.module.css`):

- `font.size` becomes the eight steps of brief §5 (`tick 10, caption 11, dense 12, body 13, emphasis 14, title 16, display 20, hero 28`) with paired `font.lineHeight` and a `font.tracking.stamped = 0.06em`; the 20 existing names stay as deprecated aliases onto the nearest step (removed in S11). `--operator-font-size-*` re-based on the same steps; the UI-scale factor multiplies them uniformly.
- `radius` becomes `ctl 4, card 8, float 12, pill`; old names alias (removed in S11).
- **(v1.1) Material set per theme** in `themes.css`: `--surface-well / -chassis / -panel / -float`, `--sheen`, `--shade`, `--shade-edge`, `--shade-deep`, `--chassis-grain` (SVG data URI) and `--chassis-grain-opacity` (.04 / .035 / .05; 0 turns it off). Studio = powder-coated dark with cream sheen; Graphite = brushed dark steel with cool sheen; Bone = light warm workshop chassis with white sheen and warm shade (D11).
- **(v1.1) Elevation tokens** built from the material set: `--elev-well`, `--elev-panel`, `--elev-key`, `--elev-key-down`, `--elev-float`, `--edge-machined`; the old `shadow.*` family aliases onto them (removed in S11). Every shadow in the program will resolve to one of these six.
- Semantic roles per theme: `--color-role-accent / -accent-soft / -accent-ink / -focus`, `-engaged / -engaged-ink`, `-attention / -attention-soft`, `-error / -error-soft / -error-ink`, `-live / -live-ink`, `-info / -info-soft`; `motion.duration` → `lamp 60, key 100, state 160, enter 200, exit 120, move 160` and `motion.easing.mechanical = cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Text ramp re-derived so `text.muted` clears 4.5:1 on well, chassis, panel and float in each theme (evidence: Bone `#6E6A5A` at 3.5–4.4:1, Graphite `#7E8A8C` at 3.99). Values are solved by the S0 contrast probe, not by eye; the v1.1 mocks were sampled the same way and pass (evidence `mocks-v1.1/contrast.md`).
- The Console's private `[data-audio-theme]` block is re-expressed through the role and material tokens with aliases so the Console is pixel-identical after S1 (the accent split and the physics are S4's job).

Gates before: `validate-generated.mjs`; `AppShellFrame.module.test.ts`; `audio-legibility.spec.ts`; the S0 ratchets.
Gates after: the same, plus `themes.contrast.test.ts` (new Vitest in the tokens package computing WCAG ratios from the token values: muted ≥ 4.5 on the four surfaces, every role ≥ 3:1 on panel, `sheen` over `panel` ≥ 1.2:1 and `shade-edge` over `panel` ≥ 1.3:1 so machined edges read in every theme); S0 literal allowlist unchanged.
Tests added: `themes.contrast.test.ts`.
Tests changed: none (aliases keep every consumer).
Baselines: muted-text and grain changes move visual baselines on every surface; inspect each diff, refresh win32, note linux/darwin as pending.
CHANGELOG: `Changed — Muted labels read at 4.5:1 in Studio, Graphite and Bone (eyebrows, tile subtitles, footer labels, planning ticks).` · `Changed — The three themes are three materials under one light: powder-coated dark, brushed steel, light workshop chassis.`
Commit: `Gold S1: token scale (8 type steps, 4 radii, state roles, material and elevation tokens, motion) and theme re-derivation`.

## Slice 2 — One shell skeleton on every surface

Status: not started. Depends on D1, D3, S1.

Scope (`packages/design-system`, `app/src/app/OperatorShell.tsx`, `shellData.ts`, `shared/PreReadyFrame.tsx`):

- `AppShellFrame`: header 64 / 56 / 52 by layout mode on the chassis with a machined bottom edge; nav labels at the title step; the subsystem chips become a **LampStrip** in a recessed groove: lamp + label + detail + target (2560), lamp + label + detail (1920), lamp + label (1280) so nothing truncates (M1); clock at the emphasis step.
- New `WorkspaceTopBar` primitive with fixed slots (title · context · state badge · search · actions · overflow), 48 / 44 / 40, chassis with a machined bottom edge; slot ids exposed as `data-topbar-slot`; it hosts whatever `[data-toolbar-primary]` ids a workspace already declares.
- `HealthBar`: one variant, one recessed row, 40 / 36 / 32; items `LABEL value` with an optional lamp; labels drop before values under pressure; hints keep their gap; one key slot. The `caption` variant is removed.
- Tone map: `statusTone.ts` gains `toneForSubsystem(healthCheck, workspaceState)`; `buildMonitorItems` and each workspace's badge derive from it so the lamp and the badge never disagree (C3). The lamp reflects the worst state its workspace currently shows.
- Setup / Support and the pre-ready surfaces render inside `AppShellFrame` (D1); `PreReadyFrame` is reduced to the "tabs disabled" variant of the header for startup and recovery.

Gates before: `shell.spec.ts` (8), `viewport-contract.spec.ts` (1), `visual-review.spec.ts` `assertLightingResponsive` (primary ids `add, overflow, patch, preview, search, status, title`), `storybook.spec.ts` (23 baselines), `audio-legibility` nav 4.5:1, `setup.spec.ts` (10), `startup.spec.ts` (5).
Gates after: the same, plus `ui-contract` chrome geometry (heights within ±2 px per viewport; badge slot x-band within ±24 px across the four workspaces), the light census on the shell (header, top bar and footer carry only `--edge-machined` and `--elev-well`), plus new tests below.
Tests added: `shell.spec.ts` "subsystem lamp tone equals the workspace badge tone on lighting-dmx-unreachable, audio-offline and audio-action-failed" (would have caught C3); `setup.spec.ts` "Setup renders inside the shell with the workspace tabs and the lamp strip"; DS Vitest for `WorkspaceTopBar` (slot order, overflow collapse), `LampStrip` (lit / unlit, word within 8 px) and the single `HealthBar` (labels drop before values).
Tests changed: `startup.spec.ts` "startup-loading fixture hides every operator workspace surface" (old: no nav rendered → new: nav rendered disabled, no workspace body; reason: brief §3, header on every surface); `setup.spec.ts` "renders the setup/support pilot shell" (old: PreReadyFrame root → new: AppShellFrame + WorkspaceTopBar; reason: D1); `audio-legibility` nav test selector if the nav class moves (assertion unchanged).
Baselines: every visual and Storybook baseline moves (header height); inspect each PNG before refresh.
CHANGELOG: `Changed — The shell header is 64 px and identical on every surface; Setup / Support sits inside it with the workspace tabs and the subsystem lamps visible.` · `Fixed — The header's subsystem lamps show the same severity the workspace shows (bridge unreachable, console offline, failed action).` · `Changed — One recessed footer on every workspace; at 1280 it keeps every value readable.`
Commit: `Gold S2: one shell skeleton (header, workspace top bar, footer, lamp strip, tone map) on every surface`.

## Slice 3 — State vocabulary primitives and the physics

Status: not started. Depends on D8, D9, S1.

Scope (`packages/design-system`, stories):

- **Key** (new, level +2): rest / down / engaged / live / hazard / armed / disabled physics from the elevation tokens; a press translates 1 px down and inverts the shadow for 100 ms; engaged stays down and lit (`role.engaged`), live stays down and lit green for the hold, hazard down and lit red; disabled is flat at 45 % with a `reason`; the cap is stamped (mono, caption, +0.06em) with an optional icon in the cap's ink. Modes: `ToggleKey`, `MomentaryKey` (hold semantics from `useMomentaryTalkback`), `ArmKey` (arm-then-apply from `useAudioArming`: keyline, `ARMED`, countdown ring; `data-testid="audio-arm-countdown"` stays on the ring). `ToggleButton` becomes an alias of `ToggleKey`.
- **Lamp** (new): the 8 px LED in a well, lit / unlit, with its word; **LampStrip** composes lamps in a groove. `StatusDot` aliases `Lamp`.
- **Well** (new, level −1): base of `Input`, `Search`, `Screen` and `MeterWell`; focus lights the accent edge.
- **Panel** (level +1) replaces `Surface`'s blur-and-shadow with `--elev-panel`; `InspectorPanel`, `Rail`, tiles and bands sit on it.
- `StatusBadge`: one 28 px pill (lamp + mono word), tones `ok | attention | error | info | neutral`, `size="sm"` (20 px) for in-canvas tags; replaces the tile, lane and chip badges. `StatusBand`: 44 px panel; word · sentence · exactly one action; the only banner. `StatusChip`: a key in the lamp groove.
- `Button` (command): sentence case, Inter, 32 / 28 px, the same press physics as `Key`, `reason` prop; `IconButton` follows; `SegmentedControl` becomes a well with one raised key; `Tabs` a row of keys with the engaged one down.
- `LoadingState` (skeleton at the host's geometry, `aria-busy`); `EmptyState` stacks under 320 px (H5) and never splits copy from its action; `Dialog` / `ConfirmDialog` on level +3 with one focus ring, focus on Cancel when `danger`, verb labels; `Toast` tones per brief §8; `Tooltip` shared.
- Storybook: one story per primitive per theme, with the physics states; `State-Vocabulary.html` is the reference.

Gates before: DS Vitest 122 tests in 19 files; `storybook.spec.ts` 23 baselines; `audio-arm-countdown.spec.ts` (3); `audio-talkback.spec.ts` (4).
Gates after: the same, plus the new DS tests, plus new Storybook baselines (inspected, not just generated); the S0 press-physics and lamp checks pass on the Storybook pages.
Tests added: `Key.test.tsx` (down on press, up on release, engaged stays down, disabled has no transform and exposes the reason, cap is uppercase mono), `ArmKey.test.tsx` (dwell, timeout, Esc, second press on the same key only), `Lamp.test.tsx` (lit / unlit, word adjacency, no animation), `LoadingState.test.tsx`, `EmptyState.test.tsx` narrow layout (single column under 320 px), `StatusBand.test.tsx` (exactly one action), `Dialog.test.tsx` focus on Cancel when `danger`, `Button.test.tsx` `reason` tooltip and press physics.
Tests changed: `StatusBadge.test.tsx` (old tone names `healthy | degraded | …` → new `ok | attention | …`; reason: brief §7; old names alias until S11); `Button.test.tsx` (old: uppercase class → new: sentence case; reason: D8); `StatusDot.test.tsx` (old: dot states → new: Lamp lit / unlit; reason: D9); `Surface.test.tsx` (old: blur + drop shadow → new: `--elev-panel`; reason: D9); `HealthBar.test.tsx` (caption variant removed in S2).
Baselines: Storybook 23 → about 40; every changed PNG inspected before refresh.
CHANGELOG: `Changed — Controls are keys: they go down when pressed and stay down, lit, while engaged; lamps light instantly and never pulse.` · `Changed — Command buttons and dialogs use sentence case; one shared badge, band and lamp design carries every state.` · `Fixed — Empty states no longer wrap one word per line in narrow panels.`
Commit: `Gold S3: physics primitives (Key, Lamp, Well, Panel) and the state vocabulary (badge, band, chip, ArmKey, LoadingState, EmptyState)`.

## Slice 4 — The Console on the shared skeleton

Status: not started. Depends on S1–S3, D2, D4, D6, D7, F2 (see Boundary).

Scope (`app/src/app/audio`):

- Grid pinned by named areas (`topbar / band / body / footer`), the monitor section in the rail per D2 (`TALK` momentary key, `DIM` and `MONO` keys, the master meter well and level), no feedback banner anywhere in the grid: arming and action results render on the key (ArmKey) and in the state slot / toast (C1, M5).
- Strips: each fader is a key riding in a groove (well); each meter a well; `M` / `S` are keys with stamped caps; 48 V is a hazard key (down and red when on); the selected strip carries the accent keyline; tiers are panels in a bay (screen).
- Doubt: if F2 has landed, every unconfirmed value carries `data-confidence="unconfirmed"` and the dashed attention keyline on its cap; otherwise the badge, the band with the engine's sentence, and the engine's count only (C2, non-negotiable 4).
- Disabled: keys flat at 45 % with the gate's reason via `reason` (C2).
- One `StatusBadge` in the top-bar slot; title "Audio"; Sync fixed in the action group; the band carries its own action; solo reported once (lamp strip in the shell, band in the console) (M2).
- Selection = theme accent; engaged fill for the active target, Solo, Dim, Mono; the private theme block and the top-bar theme switch removed (D4, D7, H4); palette actions `system:theme:{studio,graphite,bone}` added; Setup › Workstation gets the same control (S7).
- Footer → shared `HealthBar` (H3, L5). At 1280 the rail collapses to a 64 px key rail (`TALK`, `DIM`, `MONO`), the snapshot list moves into the inspector drawer and the inspector becomes a drawer before any fader loses travel (H10).
- Type on the scale (60 % of nodes leave 9.5 px), targets ≥ 24 px, take-time keys ≥ 28 px (M6), EQ graph and frequency labels at the caption step ≥ 4.5:1 (H7).

Gates before: `audio.spec.ts` (40), `audio-hierarchy.spec.ts` (3), `audio-inspector-polish.spec.ts` (6), `audio-arm-countdown.spec.ts` (3), `audio-talkback.spec.ts` (4), `audio-render-budget.spec.ts` (2), `audio-meter-gating.spec.ts` (2), `audio-legibility.spec.ts` (2), `audio-constants.spec.ts`, `audio-file-structure.spec.ts`; visual baselines for `audio-populated` at six sizes plus Scaled Studio Preview, Bone and Graphite; S0 ratchets for the audio fixtures.
Gates after: the same plus the new tests; `ui-contract` audio ratchets tightened to min 10 px, interactive 11 px, radii ≤ 4, targets ≥ 24, idle animations 0, light census clean (every shadow one of the six tokens, no mixed direction).
Tests added: `audio.spec.ts` "arming a snapshot recall leaves the monitor section, the top bar and every strip at the same bounding box" (would have caught C1); "audio-state-assumed shows the engine's unconfirmed count in the band and, when the snapshot carries per-channel confidence, marks each unconfirmed cap" (C2, F2-aware); "audio-not-verified renders gated keys flat at ≤ 0.5 opacity with a reason" (C2); "the theme is set from the palette and persists" (D7); "Dim, Mono and the active mix target are keys that stay down and lit while engaged" (D9).
Tests changed: `audio-hierarchy.spec.ts` "output lane exposes inline Mute; monitor bar owns Dim / Mono / Talkback" (old: horizontal `audio-monitor-bar` strip → new: the rail's monitor card with the same test id; reason: D2); `audio-arm-countdown.spec.ts` (old: 2 px countdown bar in the tile → new: ArmKey ring and word, same test id and timing; reason: brief §8); `audio-talkback.spec.ts` (old: talkback button class → new: `MomentaryKey` with the same test id, down and lit for the hold; reason: D9); `audio-legibility.spec.ts` (old: 9.5 px floor and 3:1 → new: 10 px ticks, 11 px actionable, 4.5:1 pixel-sampled; reason: D6, brief §5–§6); `audio.spec.ts` theme-switch cases (old: `audio-theme-*` buttons → new: palette actions; reason: D7); `audio.spec.ts` band titles that move to sentence case land in S8, not here.
Baselines: every audio baseline and the Scaled Studio Preview set; inspect before refresh. Operator checklist B1, B2, B3.
CHANGELOG: `Fixed — Arming a recall or receiving an action result no longer moves Talk, Dim, Mono and the master meter to the bottom of the Console.` · `Changed — The Console's monitor section, snapshots and console-link panel live in a fixed left rail; the tiers get the full height; faders ride in grooves and M / S / DIM / MONO / TALK are keys that go down and light.` · `Changed — Locked console controls are flat, dimmed and say why.` · `Changed — Selection uses the theme accent; amber means engaged or attention; the theme switch moved to the command palette and Setup.` · `Fixed — At 1280×800 the Console keeps its take-time keys in a narrow rail and shows its faders before its snapshot list.`
Commit: `Gold S4: the Console on the shared skeleton — pinned monitor section, keys and wells, honest doubt and locks, one accent`.

## Slice 5 — Lighting on the shared skeleton

Status: not started. Depends on S1–S3.

Scope (`app/src/app/lighting`): `LightingToolbar` → `WorkspaceTopBar` (primary ids kept); footer → shared; the stage plot as a screen (well); rail 320 / 280 / drawer whose tiles scale down, never up, with a visible edge when the list overflows (M8); the master card is a key (`ON`) plus a fader in a groove and `Cut all` a hazard-tinted command; `EmptyState` stacked (H5); the master card shows the engine's `lightingEnabled` truthfully and says why output is off (M3); the bridge band carries the probe action (M3); the current-scene lamp stops pulsing (M7); patch mode swaps the Patch key in place instead of inserting a chip at the left (L6); inspector header never wraps; DMX monitor sized to show all 512 channels at 2560 (L1); Delete moves into the danger zone (L2); 8.5 / 9 px text moves to tick / caption (H8); sliders become keys in grooves with ≥ 24 px thumbs and chip removes reach 24 px (M6).

Gates before: `lighting.spec.ts` (27), `visual-review.spec.ts` `assertLightingResponsive` (primary ids, stage minimums, overflow menu labels) and lighting baselines at six sizes, Scaled Studio Preview, Bone and Graphite; S0 lighting ratchets.
Gates after: the same plus the new tests; `ui-contract` lighting ratchets tightened (min 10 / 11 px, radii ≤ 4, targets ≥ 24, idle animations 0, no clipped footer values at 1280, light census clean).
Tests added: `lighting.spec.ts` "empty rail and plot states render title, sentence and action in one column at 2560 and 1280" (H5); "bridge unreachable: the band exposes the probe action and the master key reflects `lightingEnabled`" (M3); "entering patch mode keeps every primary toolbar control's x-position" (L6); "the scene list shows an overflow edge at 1280 instead of running off the viewport" (M8).
Tests changed: `visual-review.spec.ts` `assertLightingResponsive` only if a primary id is added (none renamed); `lighting.spec.ts` cases that click the footer's `DMX strip` toggle (same label, now a key in the footer).
Baselines: all lighting baselines; inspect before refresh. Operator checklist B4.
CHANGELOG: `Fixed — Empty Lighting panels read as sentences again.` · `Fixed — When the bridge is unreachable the master key says so and the band offers the probe.` · `Changed — Lighting's top bar and footer match the other workspaces; the plot is a screen; at 1280 the footer keeps every value readable and the scene list shows where it continues.` · `Changed — The current-scene lamp no longer pulses.`
Commit: `Gold S5: Lighting on the shared skeleton — screen, rail, keys, empty and degraded states, patch mode in place`.

## Slice 6 — Planning on the shared skeleton

Status: not started. Depends on S1–S3, D5.

Scope (`app/src/app/planning`): `WorkspaceTopBar` that never wraps (search · Board | Timeline segmented well · Time report · New project · overflow); the stat cards become a rail panel; rail = projects + unscheduled + today; the timeline and the board are screens (wells) with task blocks as small panels; inspector = the selected task or project (the detail overlay retires; the time report stays a dialog) (H11, D5); overlapping timeline blocks stack into sub-rows and never clip their titles (H11); DS `Button` and `SegmentedControl` replace the pill buttons (M9); cards get the 2 px focus ring (M4); the hand-drawn clock becomes Lucide (M11); the empty state carries the "New project" action (L4).

Gates before: `planning.spec.ts` (14); planning baselines at six sizes, Scaled Studio Preview, Bone and Graphite; S0 planning ratchets.
Gates after: the same plus the new tests; `ui-contract` planning ratchets (top bar 48 / 44 / 40 and never taller, targets ≥ 24, focus ring present, light census clean).
Tests added: `planning.spec.ts` "the top bar is 48 / 44 / 40 px at the three viewports and never wraps"; "planning-overlap renders overlapping tasks in separate sub-rows with no clipped title"; "selecting a task populates the inspector; Escape clears it"; "a focused card shows a 2 px accent outline".
Tests changed: `planning.spec.ts` cases that open the detail overlay (old: dialog with `planning-project-detail` → new: inspector column with the same test id on its root; reason: D5, brief §3).
Baselines: all planning baselines; inspect before refresh.
CHANGELOG: `Changed — Planning follows the shared layout: projects in the rail, the board or timeline as a screen in the middle, the selected task in the inspector; the toolbar no longer wraps at 1920 and 1280.` · `Fixed — Overlapping timeline tasks stack instead of clipping each other's titles.`
Commit: `Gold S6: Planning on the shared skeleton — rail, inspector, non-overlapping timeline`.

## Slice 7 — Setup / Support and the pre-ready surfaces

Status: not started. Depends on S2, S3, D1.

Scope (`app/src/app/setup`, `app/src/app/startup`): runner steps in the rail as lamps (done lit accent, current lit amber, pending unlit), the step body in the canvas, health / deck echo / support in the inspector; the deck echo is a grid of keys mirroring the deck's page that go down and light as the operator presses the physical keys; Support mode swaps the canvas under the same chrome; the degraded band renders only when the health tone is not ok and lists the checks that are not ok, never the healthy summary (H12); "Control surface" label (H12); the step body fits 1280×800 without internal scroll (C4); recovery surfaces (protocol mismatch, bootstrap failed) use the skeleton with the incident as the canvas and diagnostics as the inspector, fitting 1920 and 1280 (C4); the Install & Update panel shows only the host OS, only in Support (M10); startup steps in operator words (copy lands in S8, structure here); the Workstation panel hosts the theme setting (D7).

Gates before: `setup.spec.ts` (10) including "runner panels scroll within their tracks at 1280x800 (SET-11)", `startup.spec.ts` (5) including "recovery shell scrolls within the frame at 1920x1080 (SET-11)"; setup-ready and protocol-mismatch baselines; S0 setup ratchets (off-viewport elements at 1280 and 1920).
Gates after: the same plus the new tests; `ui-contract` asserts no off-viewport element on any setup or pre-ready fixture at any viewport.
Tests added: `setup.spec.ts` "the Publish step body and its actions are fully visible at 1280x800 without scrolling" (C4); "the health band never shows a healthy summary under an attention title" (H12); "Support mode keeps the shell header, tabs and lamps" (H1); "the deck echo key for a pressed control goes down and lights" (`setupControlEcho`); `startup.spec.ts` "recovery surfaces fit 1920x1080 and 1280x800 without scrolling" (C4).
Tests changed: `setup.spec.ts` SET-11 (old: panels scroll within tracks → new: the step body needs no scroll; only unbounded lists (backups, diagnostics) scroll; reason: brief §13); `startup.spec.ts` SET-11 (same); `setup.spec.ts` "renders the setup/support pilot shell" (moved in S2).
Baselines: setup and pre-ready baselines at all sizes; inspect before refresh. Operator checklist B5.
CHANGELOG: `Fixed — Setup's Publish step and the recovery screens fit 1280×800 and 1920×1080 without hiding their controls.` · `Changed — Setup / Support and the recovery screens use the same layout as the workspaces: steps as lamps in the rail, the step in the middle, health and the deck echo (keys that light as you press the deck) in the inspector.` · `Fixed — The Setup health band no longer says "Attention required" over "System healthy".`
Commit: `Gold S7: Setup / Support and the pre-ready surfaces on the shared skeleton, fitting utility mode`.

## Slice 8 — Operator copy pass and the copy gate

Status: not started. Depends on S0's scanner.

Scope: every operator-facing string per brief §10 — forbidden words replaced (the desk link, Studio Control, TotalMix, the bridge, the deck), "Loading the console…" / "Loading the rig…" / "Loading planning…", startup steps ("Starting Studio Control", "Connecting to the desk", "Loading the rig"), recovery sentences with what to do next, raw `AUDIO_*` codes behind a "Details" disclosure, "TotalMix did not answer" instead of "OSC ping", one label per action ("Sync" everywhere), dialog titles as questions with verb buttons, band titles in the state vocabulary ("Not verified", not "AUDIO NOT VERIFIED"), key caps in the deck's words (`TALK`, `DIM`, `→ MAIN`, `SOLO CLR`), the macOS text gone on Windows. `check-operator-copy.mjs` turns from report to gate.

Gates before: the S0 copy scanner reports its seed count (recorded in the status line when S0 lands); specs assert the current strings (`audio.spec.ts` band titles, `setup.spec.ts` step and dialog copy, `startup.spec.ts` diagnostic fields).
Gates after: scanner at 0 hits; every string assertion updated (old string → new string → reason recorded in the status line).
Tests added: the scanner is the test; `startup.spec.ts` "every recovery band names a next step".
Tests changed: string assertions in `audio.spec.ts`, `setup.spec.ts`, `startup.spec.ts`, `shell.spec.ts` (dialog titles), listed one by one in the status line.
Baselines: every surface whose text changed; inspect before refresh.
CHANGELOG: `Changed — Operator copy names the desk, the bridge and the deck; every error band says what happened and what to do next; key caps read like the Stream Deck's.`
Commit: `Gold S8: operator copy pass and the copy gate`.

## Slice 9 — Calm surfaces, light and motion

Status: not started. Depends on S1, S3.

Scope: every remaining shadow resolves to one of the six elevation tokens (the S0 light census reaches zero unknown shadows and zero wrong-direction shadows); hover never translates (Button, Key, lamp chips); gradients only where they are information; idle animations 0 on ready surfaces (the startup pulse stays on pre-ready); motion tokens applied to every transition (lamp 60, key 100, state 160, enter 200, exit 120, move 160; mechanical easing; no overshoot); the chassis grain applied once at the shell root (D10); `prefers-reduced-motion` removes enter / exit / move animations and the meter display smoothing while the peak-hold and fall ballistics stay (R2-MOT-01, brief §9).

Gates before: S0 idle-animation, light and shadow / gradient / blur census (Audio 129 shadows / 110 gradients / 0 blur, Lighting 48 / 34 / 6, mixed directions); `Dialog`, `Toast`, `CommandPalette` already gate their enter animations on `prefers-reduced-motion`.
Gates after: `ui-contract` idle running animations = 0 on every ready fixture; unknown or wrong-direction shadows = 0; blur > 8 px only on `[data-level="floating"]`; a DS Vitest asserting no `transform: translate` in `:hover` rules and exactly `translateY(1px)` in `:active` rules of `Key.module.css` and `Button.module.css`; `audioMeterDisplayModel.test.ts` gains the reduced-motion case.
Tests added: the two above.
Tests changed: none.
Baselines: hover states are not in baselines; the grain and shadow normalisation move several — inspect before refresh.
CHANGELOG: `Changed — Every shadow on screen comes from one light; controls no longer jump on hover; nothing animates on an idle surface; reduced-motion settings are respected by the meters' display smoothing.`
Commit: `Gold S9: one light, calm surfaces and the motion policy`.

## Slice 10 — Bone and Graphite pass the legibility gate everywhere

Status: not started. Depends on S1, S4–S7.

Scope: walk every fixture in Graphite and Bone with the pixel-sampled gate; fix what remains (Bone lit keys carry light ink on amber ink, ticks lose their 40 % alpha, planning captions and Graphite setup side labels move to the re-derived muted; machined edges read ≥ 1.3:1 in Bone); refresh the Bone and Graphite baselines; operator eyeball on the studio monitor (B6).

Gates before: S0 contrast ratchets per theme (seed: Bone Lighting 65 / 162, Audio 79–83 / 392; Studio Audio 7, Planning 25; Graphite Setup 8).
Gates after: 0 failures at 4.5:1 for text at the caption step and above, 0 at 3:1 for ticks, lamps, keylines and key edges, in all three themes, on all 27 fixtures at all three viewports.
Tests added: none beyond tightening the ratchets to zero.
Tests changed: `audio-legibility.spec.ts` final thresholds (already moved in S4).
Baselines: Bone and Graphite sets; inspect before refresh.
CHANGELOG: `Fixed — Bone and Graphite are legible on every surface (every label clears 4.5:1, every lamp, keyline and key edge 3:1).`
Commit: `Gold S10: Bone and Graphite pass the legibility gate on every surface`.

## Slice 11 — Close-out

Status: not started.

Scope: remove the deprecated token aliases (old font sizes, radii, `shadow.*`) and the old badge / band / dot prop names once no consumer remains; `docs/HARDWARE_PROFILE.md` density table → brief §13 numbers; `docs/OPERATIONS.md` badge and key names if any changed in S8; `docs/DEVELOPMENT.md` lanes (`ui-contract.spec.ts`, `ui-census.mjs`, the copy scanner); `docs/HANDOFF.md` entry; CHANGELOG grouping under Unreleased; the linux baseline refresh from the CI artifact once the branch is pushed; darwin pending the next macOS host visit; Appendix B signed by the operator; follow-ups F1 and F2 filed as issues.

Gates before / after: the full `frontend:playwright:test` matrix, `dev:check`, `tauri:visual:review`.
Tests added / changed: none.
CHANGELOG: none beyond grouping.
Commit: `Gold S11: close-out — alias removal, docs, baselines, operator sign-off`.

## Validation per slice (the same every time)

1. `npm run frontend:typecheck` and `npm run frontend:test`.
2. `npm run build --workspace frontend/app` **before** any Playwright run (the specs serve `dist`).
3. `cd frontend/app && npx playwright test ui-contract.spec.ts <workspace specs touched>`.
4. Visual: `npm run frontend:storybook:build`, then `npx playwright test visual-review.spec.ts storybook.spec.ts`; copy `*-diff.png` out of `test-results`, inspect every changed PNG, then refresh win32 only (`--update-snapshots`), commit as `Gold S<N> (baselines): …`.
5. `npm run dev:check` green, then the slice commit with a What / Why / Tests / Verified body.
6. Never run `tauri:setup-support:qualify` concurrently with Playwright (both bind 4173).

## Appendix A — Gate honesty map (finding → guard after this plan)

| Finding                      | Guard                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| C1 monitor section jumps     | `audio.spec.ts` bounding-box invariance across arm / action result; `ui-contract` chrome geometry                    |
| C2 doubt and locks invisible | `audio.spec.ts` confidence and flat-key tests; F2 for per-value marks                                                |
| C3 lamp vs workspace tone    | `shell.spec.ts` tone-equality test; shared `toneForSubsystem`                                                        |
| C4 utility mode clipped      | `setup.spec.ts` / `startup.spec.ts` no-scroll tests; `ui-contract` off-viewport = 0                                  |
| H1, H2, H3 skeleton          | `ui-contract` chrome heights and badge x-band; DS Vitest for `WorkspaceTopBar`, `LampStrip`, `HealthBar`             |
| H4 second accent             | `css-literals.test.ts` (no private theme literals); `ui-contract` colour census                                      |
| H5 empty states              | `EmptyState.test.tsx` narrow layout; `lighting.spec.ts`                                                              |
| H6 loading states            | `LoadingState.test.tsx`; visual baselines for the loading fixtures                                                   |
| H7 theme legibility          | pixel-sampled contrast in `ui-contract`; `themes.contrast.test.ts`                                                   |
| H8 type                      | `ui-contract` type floor and size count; `audio-legibility`                                                          |
| H9 buttons / radii / chips   | `ui-contract` radii ≤ 4; `css-literals` radius literals; `Key.test.tsx`, `Button.test.tsx`                           |
| H10 Console at 1280          | `audio-hierarchy` 1920 case plus a new 1280 case                                                                     |
| H11 planning                 | `planning.spec.ts` no-wrap and sub-row tests                                                                         |
| H12 copy                     | `check-operator-copy.mjs`                                                                                            |
| M4 focus / dialogs           | `Dialog.test.tsx`; `planning.spec.ts` focus ring                                                                     |
| M6 targets                   | `ui-contract` targets ≥ 24, take-time keys ≥ 28                                                                      |
| M7 motion, light             | `ui-contract` idle animations = 0, light census = 0 unknown / wrong-direction shadows; DS hover / active rule Vitest |

## Appendix B — Operator checklist (studio monitor, signed by date)

Sign-off state: none signed; every item opens with its slice.

1. After S2: on the studio monitor at 2560×1440, the header is one row, every subsystem lamp is readable from the chair, and Setup shows the tabs and lamps.
2. After S4 (B1): arm a snapshot recall on the console; nothing on the screen moves; the key goes down and the ring counts down on it; Esc brings it back up.
3. After S4 (B2): with TotalMix remote 4 disabled, change a fader on the desk, re-enable, and watch the ASSUMED badge, the band's count and (once F2 lands) the dashed caps; press Sync; everything clears.
4. After S4 (B3): confirm the deck's amber selection marker against the on-screen accent and decide F1; press `DIM` on the deck and on screen — both keys read down and lit.
5. After S5 (B4): switch the monitor to 1920×1080; the footer values are complete; the Console's playback bank shows 4 / 4 / 3.
6. After S7 (B5): at 1280×800 (windowed), walk Setup to Publish and Support › Restore without scrolling the step body; `TALK`, `DIM`, `MONO` remain in the key rail on the Console.
7. After S10 (B6): Bone and Graphite from the chair: eyebrows, tile subtitles, footer labels and the machined edges readable without leaning in.
8. After S9: hover every control on each workspace; nothing moves; press one — it goes down one pixel and comes back; the idle Console and Lighting surfaces are still; the grain is visible from 40 cm and invisible from the chair.
9. After S4: locked keys in the not-verified state are flat and dimmed from the chair and their tooltip says why.

## Baseline refresh procedure

win32: `cd frontend/app && npm exec playwright test visual-review.spec.ts storybook.spec.ts -- --update-snapshots`, inspect every changed PNG before `git add`, commit as `Gold S<N> (baselines): …`. linux: from the CI `playwright-test-results` artifact once the branch is pushed (`frontend/app/tests/__visual__/README.md`); `frontend-e2e` is expected red between S2 and the linux refresh and each slice's Validation line says so. darwin: pending the next macOS host visit (listed in HANDOFF.md).

## Follow-ups (outside this front-end plan)

- **F1** — Stream Deck touch-strip selection marker: amber → accent, in `scripts/deck-assets.py` and the Companion feedback colours; re-export and Full Reset & Import.
- **F2** — Protocol addition for per-channel / per-mix-target `confidence` and `unconfirmedCount` on `audio.snapshot`, engine-side, so the Console can mark unconfirmed values in place.
- **F3** — The audio-loading fixture never hydrates by design; a `loaded-then-loading` fixture would let the LoadingState geometry be baselined against the loaded layout.
