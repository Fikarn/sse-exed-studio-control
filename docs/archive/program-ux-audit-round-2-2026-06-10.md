# SSE ExEd Studio Control — Round-2 Runtime UX Audit (Slice 15) (archived 2026-08-12)

> Discharged audit, archived 2026-08-12 during the repo-hygiene pass. Every finding is closed in this file's own status tables; current truth lives in [`docs/HANDOFF.md`](../HANDOFF.md).

**Date:** 2026-06-10 · **Branch audited:** `claude/slice-14-per-theme` (Slices 0–14 applied) · **Method:** live Playwright probes against the built app (`?fixture=…&transport=fixture`, 2560×1440) + three targeted code audits (reduced-motion loop inventory, iconography sweep, fixture-coverage matrix). This covers what the 2026-06-05 static audit could not see: interactive states, JS animation loops, overlay stacking, and runtime-only fixtures.

**How to read this:** finding IDs are `R2-*`. Each is verified (probe transcript or file:line). Severity reflects operator impact. The **fix-slice grouping** at the bottom is the proposed continuation of `docs/plans/program-ux-refinement.md` — per the plan, "this Slice spawns its own fix slices."

---

## Probe transcript highlights (evidence base)

```
palette open: true
tab1: IN  UL._list   (palette results list)
tab2: OUT BODY
tab3: OUT BUTTON "Setup / Support"   ← focus has left the open palette
tab4: OUT BUTTON "Lighting"
escape-after-focus-escape: dialogs 1 -> 1   ← Escape no longer closes it
dialogs open after Cmd+K over ? overlay: 2  ← palette stacks over the overlay
toasts after Solo: ["ok :: Solo on 1 fixture."]  (tone vocabulary live)
edge context menu: fits viewport; items = Reset to unity / Flip polarity / Rename
```

---

## Findings

### R2-GLO-01 — The command palette has no focus trap; once focus escapes, Escape stops working · **high** · a11y/correctness

**Evidence (live probe).** Open the palette (`Cmd+K`) on `lighting-populated`, press Tab: the first Tab lands on the palette's result list, the second lands on `<body>`, the third on the workspace-tab buttons behind the open palette — focus has left the dialog while it stays rendered. With focus outside, pressing Escape does **not** close it (`dialogs 1 -> 1`): the palette's Escape handling listens where focus is no longer. The operator ends up with a stuck overlay and a hidden tab order behind it. Contrast: `ShellDialog` received a real focus trap + Escape + restore in S2 (#128); DS `Dialog` has one; the palette was only given `:focus-visible` styling.

**Proposal.** Presentation-only: give `CommandPalette` (or its host `paletteContext`) the same trap recipe as `ShellDialog` — cycle Tab/Shift-Tab within the dialog, keep an Escape listener at the dialog root (or document while open), restore focus to the invoker on close. No state/engine change.

### R2-GLO-02 — `Cmd+K` stacks the palette over the open `?` shortcut overlay — two modal surfaces live at once · medium · a11y/design

**Evidence (live probe).** With the ShortcutOverlay open, `Cmd+K` opens the palette on top (`role=dialog` count = 2). The z-order is correct (S1's ladder: palette 1300 > overlay 1200), but the modal posture is undefined: two "modal" surfaces accept input, Escape order and focus restore across the pair are untested, and the overlay remains interactable-looking underneath.

**Proposal.** Opening the palette should close the shortcut overlay (single-modal posture — matches how the rest of the app behaves), or the stack must be made deliberate (overlay inert + focus chain documented + tested). Pairs naturally with R2-GLO-01's trap work.

### R2-MOT-01 — Audio meter canvas ballistics ignore `prefers-reduced-motion` · medium · a11y

**Evidence.** `AudioMeterCanvasOverlay.tsx:628/674/677` — the 30Hz rAF loop runs unconditionally. The meters are **essential telemetry** (reduced-motion must NOT freeze them), but the eased envelope-follower smoothing is decorative motion layered on the data.

**Proposal.** Keep the loop; under `matchMedia("(prefers-reduced-motion: reduce)")` skip the ballistics smoothing (snap to the target value). The CSS kill-switch (`global.css:94-103`, DS `overrides.css:1-10`) is verified present but cannot reach this loop.

### R2-MOT-02 — DMX compact strip interpolation ignores `prefers-reduced-motion` · ~~medium~~ **REFUTED** (R2-B premise check, 2026-06-10)

**Original claim.** `DMXCompactStrip.tsx:177/223` — unconditional rAF; "the inter-frame color interpolation is decorative."

**Refutation.** Implementation-time inspection of the paint loop found **no interpolation at all**: each frame paints the current cell values directly (`cell.value / 255` → fill alpha, CCT → hue) with no easing, smoothing, or inter-frame blending. The only motion an operator sees is the data itself changing — essential telemetry, exactly the category reduced-motion must NOT freeze. There is nothing decorative to snap; adding a flag would be a no-op. No change shipped.

### R2-MOT-03 — Fixture-marker chip-hover pulse ignores `prefers-reduced-motion` · low · a11y

**Evidence.** `FixtureMarker.tsx:686-688` — an SVG `<animate>` radius/opacity pulse plays on passive chip hover with no reduced-motion gate. Purely decorative. (The 1.2s **identify burst** at `:704-706` is correctly exempt — user-initiated, and the code comments the intent: "the burst is the point of the gesture.")

**Proposal.** Render the static ring without the `<animate>` children when reduced-motion is set.

**Reduced-motion inventory verdict (for the record):** 6 CSS-driven animations correctly covered by the kill-switch; 4 loops OK-essential (stage-plot pan/zoom already gates at `useStagePlotViewport.ts:367` — the 9e work did this right; playhead/session/toast timers are not motion); **2 violations confirmed** (R2-MOT-01 fixed in R2-B with a `snap` flag on `updateMeterDisplayState`, wired in both the canvas overlay and the numeric readout; R2-MOT-03 fixed by gating the `<animate>` children) and **1 refuted** (R2-MOT-02 — see above).

### R2-FIX-01 — Eleven empty/degraded fixtures exist and are functionally tested, but none is visually baselined · medium · coverage

**Evidence.** `fixtures.json` defines per-workspace empty/degraded states — `planning-empty` (:1976), `lighting-empty` (:776), `lighting-dmx-unreachable` (:812), `setup-degraded` (:175), `audio-state-assumed` (:1082), `audio-not-verified` (:1120), `audio-offline` (:1201), `audio-action-failed` (:1240) + 3 loading variants. All of the first eight are exercised by functional specs (`planning.spec.ts:288/336`, `lighting.spec.ts:360/643`, `setup.spec.ts:59/90`, `audio.spec.ts:292/296/315/832`) — and **zero** appear in `visual-review.spec.ts`'s `FIXTURES`/`PER_THEME_FIXTURES` lists, so their rendering is unlocked. This includes the 10d-2-logged gap (the Planning hero `EmptyState` renders only at 0 projects). Live captures confirm the empty states are **designed** (lighting-empty: rail "No scenes saved yet"/"No groups yet" cards + on-canvas "No fixtures on the rig yet" + ADD FIXTURE; planning-empty: the DS EmptyState hero "No projects yet. Press N to start one.") — the defect is purely that no baseline locks them.

**Proposal.** Presentation-only: add the P1/P2 set (`planning-empty`, `lighting-empty`, `setup-degraded`, `audio-state-assumed`) to a new single-viewport baseline loop (2560×1440 is enough for state-locking — the full 6-viewport ladder is layout work these states don't carry), capture darwin, bootstrap linux. ~8 PNGs, not ~100: state coverage, not another ladder.

### R2-ICO-01 — One inspector Save icon misses the surface's strokeWidth · low · polish

**Evidence.** `InspectorPalettes.tsx:300` — `<Save size={13} />` with no `strokeWidth` → lucide default 2.0, beside ~20 inspector icons at 1.75.

**Proposal.** `strokeWidth={1.75}`. One line.

### R2-ICO-02 — Two icon rendering paths make the same semantic action render at different weights · medium · ds-coherence

**Evidence.** DS `IconButton` forces 18px/1.8 (`IconButton.tsx` + its CSS); direct lucide renders pick per-site values — e.g. `AudioSnapshotDeck.tsx:134` renders a bare `Plus` at 13/2.0 in the same deck whose Save/Pencil/Trash2 render through `IconButton` at 18/1.8. Also `AudioTieredMixer.tsx:29/190` is the app's only 1.6 stroke, and SceneRail vs GroupRail render the same Add `Plus` at 18 vs 13 (`SceneRail.tsx:177/379`, `GroupRail.tsx:85`). The _emphasis pattern_ that does exist (2.0 for close/destructive/micro controls at 11–14px; 1.75–1.8 standard) is consistent but undocumented. (The static audit's icon findings against `AudioToolbar.tsx`/`AudioRail.tsx` are excluded here — those are the documented intentionally-dead hosts.)

**Proposal.** Document the two-tier stroke convention where the icons live (a comment block in DS `IconButton` is enough); extend `IconButton` with optional `size`/`strokeWidth` props so the deck's bare `Plus` can join the wrapped path; align or justify the 1.6 and the 18-vs-13 Plus. No baseline movement at rest (hover-only/inert differences) except the SnapshotDeck Plus if resized — verify when fixed.

### R2-CTX-01 — Context-menu viewport-edge flip · ~~info/residual~~ **VERIFIED CLOSED** (close-out probe, 2026-06-10)

**Original framing.** A real right-click can't reach the viewport edge in the shipped fixtures (the centered mixer never gets there), so the flip went unverified by the audit's first pass.

**Closure.** The DS `ContextMenu` measures itself and clamps before paint (`ContextMenu.tsx:37-63`). A close-out probe dispatched synthetic `contextmenu` events with edge coordinates at the strip handler — the exact path a real right-click takes — at 1280×800: center click renders at the pointer (640,400); a right-edge click at x=1270 clamps to x=1092 (1092+180 ≤ 1280); a bottom-edge click at y=790 clamps to y=696 (696+96 ≤ 800); the corner clamps both axes. **The clamp works.** A permanent Playwright test (`audio.spec.ts` "strip context menu clamps to the viewport at the edges") now locks all four positions. The danger-item state is wired (`FixtureMarker.tsx:516` passes `tone: "danger"` for Delete → DS `.itemDanger`) and danger menu paths are functionally exercised (`lighting.spec.ts:334` Delete scene). Nothing remains for the live Tauri session.

### R2-TOA-01 — Toast queue behavior confirmed; the multi-toast clause stays a deliberate deferral · info

**Evidence (live probe).** Toasts fire with the expected tone vocabulary (`data-tone="ok"` observed live). `MAX_VISIBLE_TOASTS = 1` (`toastContext.tsx:42`) queues rather than stacks — so the original audit's "three toast tones stacked" state is unreachable by design. S12 logged raising it as behavior-not-presentation; that deferral stands. No defect.

## Areas swept with no new findings

- **1280×800 density:** the worst offender (the setup runner crush) was fixed and baselined in S11; all six viewports are ladder-locked per surface.
- **Studio-preview crispness:** per-surface `studio-preview-1512x982` baselines exist and pass; the S14 backdrop tokenization kept the review viewport byte-identical at Studio.
- **Icon color discipline:** every icon (lucide + both bespoke families) inherits `currentColor` or themed tokens — zero theme-frozen fills.
- **Empty-state design quality:** both probed empty states are designed and actionable (see R2-FIX-01 — the gap is coverage, not design).
- **Dialog population:** the rename (`AudioTextDialog`) and `NumberEntryDialog` paths were live-verified in S13's portal probe; `CreateFixtureDialog`/`DMXMonitorDialog`/`ColorPicker` are functionally covered (`lighting.spec.ts`) — visual locking would ride the R2-FIX-01 mechanism if wanted.

---

## Fix-slice grouping — ALL MERGED 2026-06-10

| Slice                                  | Contents                                                                                                                                                               | Status                                                                                                 |
| :------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------- |
| **R2-A — Overlay integrity**           | R2-GLO-01 (palette focus trap + Escape-at-document + focus restore) + R2-GLO-02 (single-modal posture)                                                                 | ☑ merged — #162 (2 keyboard tests, counter-factually verified; baseline-neutral)                       |
| **R2-B — Reduced-motion completeness** | R2-MOT-01 (meter ballistics snap, both consumers) + R2-MOT-03 (pulse gate); **R2-MOT-02 refuted**                                                                      | ☑ merged — #163 (3 Vitest + 1 Playwright `emulateMedia` test; baseline-neutral; audit corrected in-PR) |
| **R2-C — State-coverage baselines**    | R2-FIX-01: the 4-fixture set at 2560×1440 (audio degraded trio + dmx-unreachable stay functional-only)                                                                 | ☑ merged — #164 (8 PNGs darwin+linux; no-scroll asserted)                                              |
| **R2-D — Icon convention**             | R2-ICO-01 (the Save outlier) + R2-ICO-02 (convention documented at DS IconButton; prop extension + 1.6 re-weight deliberately NOT shipped — logged in the doc comment) | ☑ merged — #165 (zero baselines moved)                                                                 |

**All residuals closed (2026-06-10 close-out pass):** R2-CTX-01 verified by synthetic-edge probe + locked with a permanent Playwright clamp test (see the finding above); the R2-C extension landed (audio not-verified/offline/action-failed + lighting-dmx-unreachable joined the state-coverage loop — the full designed-state set is baselined); the two outstanding chips (the 8e2 DES-07 rgba residue in DS MeterBridge/OperationalState/IconButton/ToggleButton, and the DS focus-ring token + broken `@sse-exed/tokens` import) closed in their own PR. **Nothing from either audit remains open.**
