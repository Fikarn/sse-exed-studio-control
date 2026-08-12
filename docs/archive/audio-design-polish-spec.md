# Audio Console — Claude Design polish implementation spec (2026-06-04) (archived 2026-08-12)

> Historical design spec for the merged Audio Console polish (PR #121), archived 2026-08-12. Current truth lives in [`docs/HANDOFF.md`](../HANDOFF.md).

Implements the polished design in the handoff bundle. The **authoritative source** is the
prototype's two appended override blocks. Extract them verbatim before implementing:

```
SRC="/Users/EdvinLandvik/Downloads/audiio-ui-june-2026/project/Audio Console.html"
awk '/<style id="channel-strip-refine"/{f=1} f{print} f&&/<\/style>/{f=0; exit}' "$SRC"   # the big block
awk '/<style id="om-polish-2"/{f=1} f{print} f{if(/<\/style>/){exit}}' "$SRC"             # the small block
```

Those blocks are the exact target styling, with detailed `/* … */` comments explaining the
intent of every rule. Recreate the **visual result** in our real CSS modules / components —
do not copy the prototype's flattened structure.

## How to translate the prototype selectors

The prototype is one flattened stylesheet, so every rule is scoped `._audioShell_plinz_15 ._X_hash …`.
In our code each `._X_hash` is a CSS-module class; **drop the `._audioShell_plinz_15` prefix** (the
module hash already scopes it) and write the rule in that class's own module file using the plain
local class name. Hash → module map:

| prototype hash                                                                           | real module (`frontend/app/src/app/audio/components/…`)                                        |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `plinz` (`_audioShell`)                                                                  | `../AudioWorkspace.module.css` — the scope; **drop this prefix**                               |
| `qa743` (`_sliderControl/_sliderTrack/_sliderFill/_sliderCap`)                           | `AudioSliderControl.module.css`                                                                |
| `1v9ge` (`_laneBody/_outputBody/_laneControls/_laneToggle/_outputLane`)                  | `AudioMixerLane.module.css`                                                                    |
| `1watb` (`_stripPreamp/_label`)                                                          | `AudioStripPreamp.module.css`                                                                  |
| `91bq0` (`_meterTrack/_meterFill/_meterNominal/_stereoMeter/_meterPair/_meterMonoBadge`) | `AudioStereoMeter.module.css` (+ canvas, see DP2)                                              |
| `csamr` (`_masterTrack/_masterFill/_masterPeak`)                                         | `AudioMonitorBar.module.css` (+ canvas, see DP2)                                               |
| `xxuvc` (`_tierLabel/_tierHeaderLead/_tierTitleBlock/_tierMixFor`)                       | `AudioTieredMixer.module.css`                                                                  |
| `eug50` (`_inspectorTitle/_inspectorStickyHardwareCard/_eyebrow`)                        | `AudioInspector.module.css`                                                                    |
| `2t30e` (`_eqGraphFull/_eqPoint/_eqValueBadge`)                                          | `AudioInspectorEqTab.module.css`                                                               |
| `1aql0` (`_statValue`)                                                                   | `AudioTopBar.module.css`                                                                       |
| `ipts1` (`_laneTagStrip`)                                                                | `AudioLaneTagStrip.module.css`                                                                 |
| `tbi6b` (`_wrapper/_trigger`)                                                            | `@sse/design-system` Tooltip — **do NOT edit the design system**; scope structurally (see DP1) |
| `pp2` (`_eqPreviewCard`)                                                                 | **new element** Claude Design added — new markup + CSS (see DP4)                               |
| `_outputFooter/_outputFooterRole/_outputFooterDest` (no hash)                            | **new element** — new markup + CSS (see DP3)                                                   |

Cross-module rules (a selector spanning two modules, e.g. `.laneControls .laneToggle`) live in the
**parent's** module and reach the child via its stable `data-*` attribute or plain descendant
selector — never by importing another module's hashed class.

## HARD RULES (unchanged from the audit work)

- **Architecture boundary:** presentation only. New elements (output footer, EQ preview) bind to
  view-model data that is ALREADY threaded; no new engine/OSC/store data.
- **Live meters stay live:** meters are painted by the `AudioMeterCanvasOverlay` canvas (the CSS
  fill is hidden under it via `[data-canvas-metering] [data-meter-fill]{opacity:0}`), so meter
  _visual_ changes (zones/bloom/glass) must be ported into the **canvas draw functions** — CSS-only
  meter styling will not show in the running app. (DP2.)
- **Three themes** (Studio/Graphite/Bone) and **no-scroll** at 2560×1440 + 1920×1080.
- **Preserve every testid**; update affected tests; never weaken an assertion to hide a regression.
- Validate before returning: `npm run frontend:typecheck` + `npm run lint` only (no watch/build/Playwright — bare `vitest` hangs; the batch gate runs the rest).

---

## DP1 — Channel-strip faders & controls (`AudioSliderControl` / `AudioMixerLane` / `AudioStripPreamp` .module.css)

From `channel-strip-refine`, the rules above "POLISH PASS 2". Merge each into the matching real rule:

- **Carved fader slot** — `.sliderControl[data-orientation="vertical"] .sliderTrack`: width 6px, radius 3px, recessed gradient + inset shadows.
- **Travel fill** — `.sliderFill` (vertical) width 6px / opacity 1 / subtle fg gradient; `[data-selected="true"] .sliderFill` → accent gradient.
- **Molded cap + grip** — `.sliderCap` (vertical) 26×17, radius 3px, layered gradient + shadows + transition; `.sliderCap::after` grip (centre bar + two faint ridges); `:hover`; `[data-selected="true"]` accent grip + glow.
- **Unity (0 dB) detents** — NEW `.sliderControl[data-orientation="vertical"]::before/::after` notches at `bottom:80%` flanking the slot; accent on `[data-selected="true"]`.
- **Tighten meter↔fader** — `.laneBody`,`.outputBody`: `gap: 9px; padding-right: 4px` (currently gap 14, padding `14px 8px 14px 0` → make `14px 4px 14px 0`).
- **Mute/Solo 50/50** — channel M/S are wrapped in `<Tooltip>`, so the buttons cluster left. Make each Tooltip wrapper take half and the button fill it: `.laneControls{gap:6px} .laneControls > *{flex:1 1 0;min-width:0} .laneControls .laneToggle{width:100%}` and ensure the Tooltip trigger between them is full-width (descendant `.laneControls > * > *{display:block;width:100%}` or equivalent). Verify the output-lane single-M `.laneControls` (a direct `.laneToggle`, no Tooltip) still looks right.
- **Mic-gain cluster** — `.stripPreamp{justify-content:center;gap:9px}` + `.label{flex:0 1 auto;align-items:flex-start}`.

## DP2 — Meters → port into the live canvas (`AudioMeterCanvasOverlay.tsx` + `AudioStereoMeter.module.css` + `AudioMonitorBar.module.css`)

From `channel-strip-refine` #4/#5 + POLISH PASS 3. The prototype expresses these as CSS on `.meterFill`/`.masterFill`, but in the running app the canvas paints over them — so **port the visual design into the canvas draw functions** (`drawMeterBody`, `drawMiniMeter`, the master mini-meter path, `drawNominalReference`, `drawPeakLine`) while keeping the live 30 Hz behavior + meter-frame data source:

- **Fixed dBFS colour zones** (NOT painted on the moving fill): cream/`--audio-meter-low-hot` safe → amber `oklch(80% 0.155 82)` caution → red `--audio-meter-over`/`--meter-hi` clip, anchored to fixed dBFS positions (nominal −18 dBFS ≈ 30% from top; red only in the top ~2 dB), **blooming** between zones, not snapping. Translate the prototype's vertical gradient stops into the canvas body gradient; for the horizontal master meter use the left→right stops from POLISH PASS 3.
- **Cylindrical glass body + recessed top edge** — paint the prototype's `::before` highlight/shadow as a canvas overlay over each fill.
- **−18 dBFS nominal line** — `drawNominalReference` tinted from the track bg (`color-mix(--audio-meter-bg 60%, transparent)`, opacity ~0.6), visible on the fill in all themes.
- **Recessed trough** — `.meterTrack`/`.masterTrack` background gradient (these CSS rules DO apply — the track shows in the unlit region; keep them as CSS) + `border-radius: 2.5px`.
- **Mono → single bar** (CSS, `AudioStereoMeter`): `[data-meter-mirror-right="true"] .meterPair{grid-template-columns:1fr}` + hide the right track; **drop `.meterMonoBadge`** (`display:none`). Confirm the canvas geometry/painting handles the single-track mono case (it keys off the track rects).
- **Master meter** (`AudioMonitorBar` `.masterTrack/.masterFill/.masterPeak`): the master is canvas-painted via the mini-meter path you wired earlier — port the zone/glass/peak-tick design into that mini-meter draw + keep the CSS track/peak structure from POLISH PASS 3 (height 9px, peak tick 2px with dark outline, amber→red hairline at 92%).

## DP3 — Tier headers + output-lane footer (`AudioTieredMixer` + `AudioMixerLane`, .tsx + .module.css)

From POLISH PASS 3 ("Tier header" + "Output meter bridge" + tag-chip):

- **Tier header title-over-meta card** — the bank-spec `<small>` is moved INTO each tier lead (markup, in `AudioTieredMixer.tsx`) so the lead wraps to two rows: `.tierHeaderLead{flex-wrap:wrap;align-items:baseline;column-gap:11px;row-gap:5px}`, `.tierTitleBlock{flex:0 0 100%}`, the `<small>` muted/ellipsised/left-aligned with a hairline left border; `.tierLabel` padding tweaks; equalize the three tier-header heights.
- **Output-lane routing footer** — NEW `.outputFooter` element pinned to each output lane's bottom (markup in `AudioMixerLane.tsx`): a `.outputFooterRole` (mono, uppercase, the bus role) → `.outputFooterDest` (the destination, e.g. UFX III) from the **mix-target view-model** (role + destination already in the model). `[data-selected]` lights the role accent. Then the **meter-bridge alignment fix**: output lanes get a `::after` knob-slot spacer; with the footer they double up — so `.outputLane:has(.outputFooter)::after{content:none}` and `.outputFooter{min-height:61px;…}` fills the knob slot.
- **Tag-chip cap** — `.outputLane > .laneTagStrip{width:104px;align-self:center}`.

## DP4 — Inspector EQ preview + chrome (`AudioInspector` / `AudioInspectorEqTab` / `AudioTopBar`)

From `channel-strip-refine` #2/#3, `om-polish-2`, and the in-place `_eqValueBadge strong` edit:

- **EQ mini-preview** — NEW `.eqPreviewCard` in the inspector overview (markup in `AudioInspector.tsx`) that renders the REAL EQ graph component (`eqGraphFull`) non-interactive (shrunk `.eqPoint` 18px/7px, `pointer-events:none`), with the value badge restyled. Reuse the existing EQ curve data (presentation only).
- **Hardware-card eyebrow** left-align: `.inspectorStickyHardwareCard .eyebrow{text-align:left}`.
- **Inspector hero title** weight: `.inspectorTitle{font-weight:600;letter-spacing:-0.015em}` (from `om-polish-2`).
- **Status values** uppercase: `.statValue{text-transform:uppercase;letter-spacing:0.03em}` (from `om-polish-2`, `AudioTopBar`).
- **EQ value badge** mono: `.eqValueBadge strong{font-family:var(--font-mono);font-weight:600;letter-spacing:0.02em}` (keeps the existing 11px).
