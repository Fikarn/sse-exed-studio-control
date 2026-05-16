# Lighting Direction D — Industry-comparator audit

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

Authored 2026-04-30 against `origin/main` at `c285541` — post Direction D Waves 1–23 + PR #42 (Wave 23 IPC tests) + PR #43 (eslint/prettier worktree-ignore hardening). Native test floor 118 engine + 6 shell = 124. F1–F12 polish gaps captured separately in [lighting-direction-d-followups.md](lighting-direction-d-followups.md).

This audit looks at the lighting workspace through a different lens than the prior 64-finding audit (which was prototype-vs-implementation) and the F1–F12 follow-ups (which were industry-pattern matches against general productivity tools). Here we compare the workspace against **lighting-specific consoles** (ETC Eos Family, MA Lighting GrandMA3, ChamSys MagicQ, Hog 4 PC, Avolites Titan, Capture, Vectorworks Spotlight, QLab) and **adjacent high-end professional tools** (Logic Pro, Ableton Live, DaVinci Resolve, Figma, Linear, VS Code, Notion). Goal: identify interaction / visual / feature patterns those tools use that would meaningfully raise the lighting workspace toward "shipping-quality professional tool" feel, **without duplicating F1–F12**.

Findings are sized by rough LOC and ranked by impact-per-effort. Each item is self-contained — a future session can pick any one to depth-implement. Each cites the source tool (with link) and gives a concrete spec, not just a vague pattern.

A separate section at the bottom documents patterns we explicitly should NOT adopt — calibration on what's intentionally absent from the product model.

---

## Highest-impact findings

### I1. Glanceable intensity bar on each fixture marker (Eos magic-sheet pattern)

**Source:** [ETC Eos Magic Sheet Object Library](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/19_Magic_Sheets/Magic_Sheet_Editor/Magic_Sheet_Object_Library.htm) — magic-sheet symbols can include intensity bars and color-linked fills that update live.

**Current state:** Intensity is already conveyed three ways on the plot:

1. Marker dot opacity scales with intensity (`max(0.3, intensity/100)` when on, 0.18 off) — [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx)
2. Light pool radial gradient on the floor (radius driven by beam angle + rig height, opacity by intensity) — [LightPool.tsx:13](frontend/app/src/app/lighting/components/LightPool.tsx:13)
3. Numeric meta line above marker: `{intensity}% · {cct}K · {mounting}` — [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx)

**Gap:** All three require either spatial inference (light pool overlap) or focused reading (meta line). Eos magic sheets add a fourth, dedicated, unambiguous intensity bar that gives at-a-glance comparison across many fixtures simultaneously — the mode operators actually scan in.

**Pattern:** A 4 × 24 px rounded vertical bar attached to the bottom edge of the marker shape. Bar height fills proportionally to intensity (0 → empty, 100 → full). Bar fill = CCT-mapped gradient (`#FFB070` warm → `#9FC8FF` cool) so the bar's color also reads CCT at a glance. Bar fades out cleanly when fixture is `off`.

**Why it fits:** Two personas both scan the plot: the recording op confirms scene state at a glance, the senior op verifies during build. The pattern adds a "comparable shape" to every marker so 12 fixtures' intensities can be ranked in one glance, which the meta line can't do (text doesn't sort visually). The inspector keeps the precise numeric authority; the plot gets a dashboard.

**Surface:** [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) — render the bar inside the existing `<g>`. Computed values already in scope (intensity, cct, on).

**Rough LOC:** ~60 LOC + a CCT-gradient `<defs>` block in [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx).

---

### I2. Highlight / Solo modes for selected fixtures (Eos `[Highlight]` / GrandMA3 Solo)

**Sources:**

- [ETC Highlight, Next, and Last](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Performing_a_Dimmer_and_Device_Check_with_Highlight,_Next,_and_Last) — `[Highlight]` brings selected channels to full at neutral white; `[Sneak]` returns them.
- [GrandMA3 Programmer](https://help2.malighting.com/Page/grandMA3/operate_programmer/en/1.4) — Highlight + Solo buttons. Solo = unselected go to 0.

**Current state:** [`identifyLightingFixture`](frontend/app/src/app/lighting/components/IdentifyBurstButton.tsx) fires a 1.2 s pulse (full / on / max-cct) overlay on a single fixture without mutating stored state — engine-side overlay in `identify_bursts`. F12 in followups proposes sequential identify across many fixtures.

**Gap:** Identify is a momentary fire-and-forget. Highlight/Solo is **sustained while held / toggled**. The recording op needs sustained when verifying "which fixture is which" during a session pause. The senior op needs sustained Solo during stage build to see one fixture's coverage in isolation.

**Pattern:**

- **Highlight (`H`)** — toggle. While active, every fixture in the multi-select gets an output override of 100 % intensity at neutral CCT (no stored-state mutation). Toolbar button shows red outline + "Highlight active — values not saved" tooltip. Auto-clears on `Escape` and on workspace switch.
- **Solo (`Shift+H`)** — toggle. Sustained version of Highlight, plus every _unselected_ on-fixture is overridden to 0 %.

**Why it fits:** Reuses the existing identify engine pattern (server-side output overlay that doesn't mutate stored fixture state). Multi-select is already a frontend concept. The two personas both benefit.

**Surface:**

- New IPC: `lighting.fixture.highlight { fixtureIds, mode: "highlight" | "solo" | "off" }`. Engine-side: extend [`identify.rs`](native/rust-engine/src/lighting/identify.rs) into a generic "output override" registry.
- New design-system primitive `<ToggleButton>` already exists. Add two buttons to the [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx) toolbar between Patch and Add fixture.

**Rough LOC:** ~150 LOC frontend + ~80 LOC engine. Engine work because the override layer needs to compose with existing identify bursts and not stomp them.

---

### I3. Searchable shortcuts overlay bound to `?` (Linear pattern)

**Source:** [Linear keyboard-shortcuts changelog](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help) — `?` opens a categorized, searchable shortcuts panel that highlights only shortcuts active in the current view.

**Current state:** [`KeyboardShortcutsPopover.tsx`](frontend/app/src/app/lighting/components/KeyboardShortcutsPopover.tsx) — kebab-menu trigger, static content, grouped by Scenes / Patch / Selection / Quick recall / Edit / Stage plot / Monitor. No search, no `?` shortcut.

**Gap:** With 18+ shortcuts and growing (`P`, `S`, `1-9`, `⌘Z`, `⌘⇧Z`, `⌘F`, `⌘A`, `⌘S`, `⌘⇧S`, `⌘⇧M`, `Esc`, arrows, plus future F6 `⌘K`, I2 `H`/`Shift+H`), operators forget what's available. Static popover requires scanning. A searchable, `?`-bound overlay is the universal pattern from Linear, GitHub, GitLab, Notion, Slack, Discord.

**Pattern:** Press `?` (or `Shift+/`) anywhere except an editable target — opens a centered modal. Search box auto-focused. Below: shortcut rows grouped by section, filtered live by keystroke. Active-context shortcuts at the top, disabled ones (e.g. ⌘Z when stack empty) greyed with reason tooltip. `Esc` or `?` again closes.

**Why it fits:** Pure UI layer over existing data — the popover already has the structured shortcut list. Both personas benefit: standard op explores ("what does P do?"); senior op finds a shortcut by description ("save"). Cheap, high discoverability return.

**Surface:** [KeyboardShortcutsPopover.tsx](frontend/app/src/app/lighting/components/KeyboardShortcutsPopover.tsx) restructure + new `?` keydown handler in [LightingWorkspace.tsx:1025](frontend/app/src/app/lighting/LightingWorkspace.tsx:1025).

**Rough LOC:** ~140 LOC. Convert popover content to a structured array, add search filter, add `?` binding.

---

### I4. Color tags for scenes (and groups) — Ableton Live pattern

**Source:** [Ableton Live Session View](https://www.ableton.com/en/manual/session-view/) — every scene and clip can carry a user-assigned accent color from a fixed palette, surfaced on the launch button + slot + track header.

**Current state:** [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) renders thumbnail + name + on-count meta + last-recalled relative time + pin icon + state badge (Active / Modified / Preview). No color tag. After Wave 23.A (virtualization at 30+ scenes), the rail can hold many more tiles, and they all look alike.

**Gap:** Operators in studio recording naturally form implicit categories — "studio A looks", "studio B looks", "approved vs pending", "talking head vs B-roll". Color tagging makes those categories visible. With 30+ scenes the rail benefits enormously from visual landmarks beyond the name.

**Pattern:**

- Right-click scene tile → "Color" submenu (when F8 context menus ship) OR `C` shortcut on selected scene → color picker popover.
- 8-swatch palette: `#fb7185 #fb923c #facc15 #a3e635 #34d399 #22d3ee #a78bfa #f472b6` + "Clear".
- Tile renders a 4 px left accent bar in chosen color. Color also dots before the scene name in command-palette / search results.
- Group chips below the rail get the same affordance.

**Why it fits:** Uses brand-y saturated hues (not the warm-cool axis already meaning CCT, so no semantic conflict). Adds engine-side persistence: `scene_color: Option<u8>` (palette index, or null) on scene + group records. Cheap to add without breaking existing rail behavior. Pinning + active state still work — color is orthogonal.

**Surface:**

- Engine: add `color_index: Option<u8>` to scene + group records; new IPCs `lighting.scene.setColor` / `lighting.group.setColor` (or fold into existing update IPCs as optional field — preferred since `LightingSceneUpdateRequest` already exists from Wave 17).
- Frontend: 4 px accent bar in [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) + [GroupChip.tsx](frontend/app/src/app/lighting/components/GroupChip.tsx); color picker primitive in design-system.

**Rough LOC:** ~250 LOC across engine + frontend. The picker is reusable in the design-system.

**Caveat:** F8 (right-click context menus) is the natural trigger for this. Either ship I4 with its own `C` shortcut and an inline button, or wait until F8 lands and bundle.

---

### I5. "Mixed" indicator + relative delta entry on bulk-inspector sliders (Figma multi-edit pattern)

**Source:** [Figma multi-edit](https://forum.figma.com/product-updates-3/meet-multi-edit-35320) + [Joey Banks — Multi-editing in Figma](https://medium.com/@joeyabanks/everything-to-know-about-multi-editing-in-figma-edd58369fd20). When selection has heterogeneous values, inspector shows "Mixed"; users can type math expressions like `Mixed + 10` to delta-shift the entire selection.

**Current state:** [InspectorFixtureBulk.tsx](frontend/app/src/app/lighting/components/InspectorFixtureBulk.tsx) — sliders for intensity + CCT, fan-out via `Promise.all`. No "mixed" indicator. The displayed value is the average. Dragging slams every fixture to the slider's value, destroying any prior balance.

**Gap:** When a selection of 4 key lights is at 80 / 75 / 78 / 82 % and the senior op wants "all up by 10 %", today's inspector either (a) requires four separate drags, or (b) flattens them all to one value. There's no relative-delta primitive. F7 covers fine-adjust on a _single_ slider; this is the multi-select counterpart.

**Pattern:**

- When bulk-selection intensity values differ, the slider track shows two ghost thumb dots at min and max. The primary thumb sits at the median. The number field reads `Mixed (52–78)`.
- Dragging the primary thumb shifts every fixture's value by the same delta (preserving balance) until any fixture clamps at 0 or 100, at which point the affected fixture sticks and others continue.
- Typing a number sets all to that value (current behavior).
- Typing `+5` applies +5 to each. Typing `+10%` scales each by 1.10 (multiplicative). Typing `-5` does -5 to each.
- Same treatment for CCT slider.

**Why it fits:** Senior op's daily mode is "preserve the balance, shift the level". Without delta-input, that's impossible without breaking from sliders to terminal-style values. Cheap to add — slider primitive becomes a bit more complex, but commit handlers already accept arbitrary values.

**Surface:** [InspectorFixtureBulk.tsx:80](frontend/app/src/app/lighting/components/InspectorFixtureBulk.tsx) for the bulk sliders + a new shared expression-parser util (`parseDeltaExpression(input, currentValues): number[]`).

**Rough LOC:** ~180 LOC. Slider behavior + delta parser + UI tweaks. Probably want a small primitive `<MultiValueSlider>` in the design-system.

---

### I6. Recent-scenes section at top of search / palette (VS Code Quick Open pattern)

**Source:** [VS Code Tips and Tricks — Quick Open](https://code.visualstudio.com/docs/getstarted/tips-and-tricks) + [Quick Open by recency](https://simon.heimlicher.com/technology/vscode-quick-open-recently/) — `⌘P` with no query shows recently opened files at the top, marked with a clock icon. Pressing Enter on empty query opens most recent.

**Current state:** Toolbar search filters scene/group rails + dimmed plot markers. Engine tracks `lastRecalled` flag + `lastRecalledAt` per scene. No "recent" surface. The rail sort follows pinned-then-display-order (post-Wave-23). No surface-level recency.

**Gap:** Operators in a recording session bounce between 2–3 frequent scenes ("intro", "interview", "B-roll"). Today they re-find them via the rail or by typing the name. Recency makes the _frequent_ case instant.

**Pattern:**

- When `⌘F` opens the toolbar search dropdown with empty query, show a "Recent" section listing the last 5–8 scenes touched (recall + save events), most-recent first, each with a clock icon.
- When F6 (⌘K command palette) ships, same recency section at the top with empty query.
- Pressing `Enter` on empty query recalls the most recent.
- `Up/Down` navigates, `Enter` recalls, `Esc` closes.

**Why it fits:** Engine already has `lastRecalledAt` — just needs surfacing. Pairs naturally with F6 but works standalone. Trivial to implement. Highly visible on first use.

**Surface:** [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx) for the dropdown surface OR new `<SceneRecentDropdown>` component opened on `⌘F`. If F6 ships first, fold I6 into the palette.

**Rough LOC:** ~120 LOC standalone, ~40 LOC if folded into F6.

**Caveat:** Decide ship-order: standalone (immediate value), or wait for F6 (cleaner architecture). Recommend standalone — F6 is documented as needing its own plan + design pass, and I6 is needed regardless.

---

### I7. Saved view bookmarks for stage plot pan/zoom (Capture views, scoped)

**Source:** [Capture Design Tab](https://www.capture.se/Manual/en-UK/2024/DesignTab.html) — multiple persistent views with their own zoom / pan / camera state.

**Current state:** [useStagePlotViewport.ts](frontend/app/src/app/lighting/useStagePlotViewport.ts) — wheel-to-zoom (clamp 0.4–5×), pointer pan (4 px threshold), button zoom-in/out, double-click reset (250 ms eased). No saved positions.

**Gap:** Senior op zoomed into the talent-mark cluster to inspect a key-light position must double-click reset to see the whole stage, then zoom + pan to get back. Saved views give richer recall.

**Pattern:** A "View" dropdown in [StagePlotControls.tsx](frontend/app/src/app/lighting/components/StagePlotControls.tsx) with 3 numbered slots. Each slot stores `{ zoom, panX, panY }`. Right-click slot → "Save current view". Click slot → animate camera to those values over 200 ms (matching existing reset easing). Shortcuts: `Shift+1` / `Shift+2` / `Shift+3` recall (collides with no current binding). Active slot gets a filled dot.

**Why it fits:** Pure frontend feature. Persisted to `localStorage` like the column-resize values. 3 fixed slots avoids state explosion. Visible in 30 s of operator use.

**Caveat:** `Shift+1`–`Shift+3` doesn't currently collide, but the existing `1`–`9` quick-recall would feel asymmetric. Consider `[`, `]`, `\` instead, or accept the asymmetry. Decision to be made when implementing.

**Surface:** Extend [useStagePlotViewport.ts](frontend/app/src/app/lighting/useStagePlotViewport.ts) with `saveViewBookmark(slot)` / `recallViewBookmark(slot)`. Extend [StagePlotControls.tsx](frontend/app/src/app/lighting/components/StagePlotControls.tsx) UI.

**Rough LOC:** ~130 LOC.

---

### I8. Group inspector "remove fixture from group" affordance on member rows

**Source:** N/A — this isn't an industry-borrowed pattern, it's a gap surfaced during the audit cross-reference. Calling it out because it's small and visible.

**Current state:** [InspectorGroup.tsx:99](frontend/app/src/app/lighting/components/InspectorGroup.tsx:99) — member rows are `<button>`s that navigate to that fixture's inspector tab. There's no remove-from-group affordance on the row. The only way to remove a fixture from a group is to navigate to the fixture inspector and use the group `<select>` to pick "—".

**Gap:** Senior op managing a group naturally wants to manage _from the group_. Today they have to context-switch to each member fixture. Inspector convention violation.

**Pattern:** Add a small `IconButton` (X icon, ghost tone, `sm` size) on the right edge of each member row. Click → confirm dialog `"Remove '{fixture}' from '{group}'?"` → calls existing `onAssignFixtureGroup(fixtureId, null)`.

**Why it fits:** Tiny scope. Reuses the existing IPC + handler. The button only needs hover-reveal (so it doesn't dominate the row) — pattern matches Linear / GitHub list-row hover affordances.

**Surface:** [InspectorGroup.tsx:99](frontend/app/src/app/lighting/components/InspectorGroup.tsx:99). Add `onAssignFixtureGroup` prop already wired in [LightingInspector.tsx](frontend/app/src/app/lighting/components/LightingInspector.tsx).

**Rough LOC:** ~30 LOC.

---

### I9. Always-visible selection-bar chip strip (Figma multi-edit + GrandMA3 channel sheet)

**Sources:** [Figma multi-edit](https://forum.figma.com/product-updates-3/meet-multi-edit-35320), [GrandMA3 Programmer](https://help2.malighting.com/Page/grandMA3/operate_programmer/en/1.4) — selected channels shown as highlighted tiles in the channel sheet.

**Current state:** Selection state is shown in two places:

1. Plot markers with `selected` class (green dashed ring) — [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx)
2. Bulk inspector chip list when `selectedFixtures.length > 1` — [InspectorFixtureBulk.tsx](frontend/app/src/app/lighting/components/InspectorFixtureBulk.tsx)

**Gap:** With 6 fixtures shift-clicked, the operator can see the green rings on the plot but can't tell at a glance _which fixtures_. The bulk inspector lists them but only when the inspector is on that tab. A horizontal chip strip near the canvas would always show the selection, regardless of inspector tab.

**Pattern:** A 32 px horizontal strip docked above the bottom health bar (or floating bottom-left over the plot), shown only when ≥ 1 fixture is selected. Each chip = `[#] {abbreviated name}` with a small CCT-tinted intensity dot. Click chip = remove from selection. Hover chip = corresponding plot marker pulses.

**Why it fits:** Helps confidence in _what's about to change_ before any slider moves. Recoverable selection without "shift-clicking again to undo".

**Caveat:** Real estate cost. The bottom health bar is 64 px; this would add 32 px more (or replace it conditionally). Less impact than I3 / I5 / I6.

**Surface:** New `<SelectionChipStrip>` component, mounted in [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) above the health bar, conditional on `selectedFixtureIds.size > 0`.

**Rough LOC:** ~100 LOC.

---

### I10. Scrub-on-numeric-label for inspector text inputs (Logic Pro / Figma idiom)

**Source:** [Logic Pro channel-strip controls](https://support.apple.com/guide/logicpro/channel-strip-controls-lgcpbc219210/mac) + Figma's drag-on-property-label behavior. Drag horizontally on the _label_ of a numeric input → value scrubs without focusing the input.

**Current state:** [InspectorFixture.tsx](frontend/app/src/app/lighting/components/InspectorFixture.tsx) has 4 numeric text inputs: Stage X, Stage Y, Rig height, Beam angle. They commit on blur or Enter. No drag-scrub.

**Gap:** F7 (in followups) covers fine-adjust on _sliders_. Scrub-on-label is a different idiom for non-slider numeric values where a slider would be too coarse (1–180° beam angle range, 0.05 m position precision). Operators in Logic Pro and Figma use this idiom many times per minute; precision pros expect it.

**Pattern:** Hover the label (`Stage X (m)`) → cursor becomes `ew-resize`. Pointer-down + drag horizontally → value scrubs at 0.05 m / px (or 1° / px for beam angle), or 0.005 m / px (10× fine) with Shift, or 0.5 m / px (10× coarse) with `⌘`. Live value preview during scrub. Release commits.

**Why it fits:** All 4 inputs already have draft / commit semantics. Drag-scrub is additive. Pairs with F7 (slider fine-adjust) for full precision-control coverage.

**Surface:** Extract a `<ScrubLabel>` design-system primitive that wraps a `<label>` and exposes `onScrub(delta)`. Apply in [InspectorFixture.tsx](frontend/app/src/app/lighting/components/InspectorFixture.tsx) for spatial inputs.

**Rough LOC:** ~150 LOC including the design-system primitive.

---

## Promising-but-bigger (need plan + design pass before code)

### P1. Blind / Preview-edit mode (Eos `[Blind]`, GrandMA3 blind)

**Sources:** [Eos Recording and Editing Cues from Blind](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/12_Cues_and_Cue_Lists/08_Recording_and_Editing_Cues_from_Blind/About_Recording_and_Editing_Cues_from_Blind.htm), [GrandMA3 Edit or Update Presets](https://help2.malighting.com/Page/grandMA3/presets_edit/en/1.7).

**Why it matters:** Senior op may want to construct a new look during a live session while the recording op is monitoring. Today, every slider drag is on-air. Blind separates editing-buffer from output-buffer — edits land into the saved scene only on commit.

**Why bigger:** Requires engine-level concept of "edit buffer separate from output buffer", state-routing in the inspector, clear visual treatment so operators never lose track of which mode they're in. 2–3 weeks of engine + UI design. Highest-value of the bigger bets — directly addresses the dual-persona workflow tension.

**Sketch:** Toolbar toggle "Preview" (red badge when active). Stage plot fades non-overlay markers to a ghosted state. Inspector shows "Editing offline · Save to commit". Recall during preview swaps the buffer, not the output. Save commits and exits preview. New IPC: `lighting.editor.previewMode { enabled }`; engine maintains a parallel `preview_state` next to live state.

---

### P2. Manual fade time on recall (Eos `[Sneak]` + `[Time]`)

**Source:** [Eos manual control fade timing](https://community.etcconnect.com/control_consoles/eos-family-consoles/f/eos-family/24817/manual-controls-fade-timing).

**Why it matters:** Recall today is binary (instant DMX jump). Operators in recording often want a 1–3 s cross-fade matching a graceful camera transition.

**Why bigger:** Requires engine cross-fade interpolator, scheduling, cancel semantics on second recall mid-fade. Tunable-white pairs (intensity / CCT) need correlated interpolation so midpoints don't pass through ugly off-axis colors.

**Sketch:** Small "Fade time" chip in toolbar (default 0 s). Click → numeric scrubber. Recall uses that time. `T` while hovering a scene tile sets time. Mid-fade shows a thin progress bar on the recalled tile. New IPC parameter on `lighting.scene.recall`; engine maintains a `cross_fade` sample loop.

---

### P3. Per-attribute palette pools — CCT and intensity presets (Hog 4 palettes / GrandMA3 preset pools)

**Sources:** [Hog 4 Palettes & Directories](https://www.etcconnect.com/webdocs/Controls/HOG/HTML/en/sect-palettes.htm), [GrandMA3 Preset Pools](https://help2.malighting.com/Page/grandMA3/presets_pools/en/1.4).

**Why it matters:** "All selected fixtures to 4000 K" is a daily senior-op micro-task. Today: drag the CCT slider. Palettes make it one-click. Theatrical consoles all have per-attribute palettes precisely because attribute-level recall is faster than full-scene recall when only one dimension needs changing.

**Why bigger:** New top-level concept — not a scene, not a fixture, not a group. New storage model, new UI dock, new patch-mode UX (skip palettes during patch). Worth doing — single highest-leverage workflow accelerator from theatrical consoles that maps cleanly to tunable-white. Architecture decision, not a polish wave.

**Sketch:** Right inspector adds a 4th tab "Palettes" with two sub-pools: Intensity (10 / 25 / 50 / 100 % named presets) and CCT (Warm 2700 / Studio 4000 / Daylight 5600 / Cool 6500 — names + values editable). Tile + apply-on-click. `⌘⇧P` opens a quick palette popover near the cursor.

---

### P4. Persistent compact DMX strip in the bottom bar (DAW meter-bridge idiom)

**Source:** Logic / Pro Tools meter bridges. [Hog 4 Spreadsheets](https://www.etcconnect.com/webdocs/Controls/HOG/HTML/en/sect-w_w_spreadsheets.htm) for the lighting equivalent.

**Why it matters:** ⌘⇧M is opt-in — operators don't always know to open it. A glanceable always-on "is anything firing" strip catches dropped frames, stuck channels, bridge weirdness early.

**Why bigger:** Steals real estate from the bottom bar (no-scroll dense layout means trade-offs). Render budget at 30+ fixtures × 4 channels = 120 cells × 30 Hz needs perf attention.

**Sketch:** Small toggle in health bar "DMX strip". When on, 60 px row above health bar with one-pixel-wide cells per channel (intensity in CCT-tinted gradient). Hover any cell → fixture + channel tooltip. Click strip → opens existing ⌘⇧M full grid.

---

### P5. Aggregate "scene shape" mini-graph on tiles (Resolve scopes inspiration)

**Source:** [DaVinci Resolve scopes](https://www.blackmagicdesign.com/products/davinciresolve/color) — visual aggregation of state for recognition.

**Why it matters:** Thumbnails are useful but lossy. A mini-histogram visually summarizes "is this a 3-fixture key-light scene or a 12-fixture wide wash". Recall feels more confident.

**Why bigger:** Tile real estate is already crowded (thumbnail + name + meta + last-recalled + pin + state badge + I4 color bar). Needs design exploration for cohabitation. Probably alternative-to rather than additive-with the existing thumbnail.

**Sketch:** Bottom 12 px of tile: 8 vertical bars sorted high-to-low, height = fixture intensity, fill = CCT tint. Replaces thumbnail's bottom strip or sits next to it.

---

## Out of scope — explicitly not adopting

These patterns are popular in lighting consoles but don't fit the recall-driven dual-persona product model. Documenting them here is calibration: this is what we _are_ and what we _aren't_.

### N1. Keypad command-line syntax (`Channel 1 Thru 5 At 50 Enter`)

[Eos](https://shop.bmisupply.com/Resources/en/ItemDocuments/45011028/BMI.ETC.Eos.Family.Manual.pdf), GrandMA3, Hog 4 all use a typed command line for selection + value entry.

**Why not:** Optimized for theatrical programmers handling 100+ channels who think abstractly. Our universe is small (~40 fixtures) and visual (markers on a stage plot). Selection is cmd-click + groups + multi-select. A command line would be a barrier for the recording op without leverage gain. F6 (⌘K palette) gives the discoverability win without the syntax.

### N2. Encoder-wheel attribute paradigm

GrandMA3 / Hog 4 dedicate 4–6 rotary encoders mapped to feature groups (Intensity / Color / Position / etc) with paging through attributes. ([GrandMA3 Encoder Toolbar](https://help2.malighting.com/Page/grandMA3/ws_eb_encoder_toolbar/en/1.4))

**Why not:** This pattern exists because moving-light fixtures have ~30 attributes per fixture (pan/tilt/zoom/iris/gobo1/...). Our fixtures have **two** meaningful attributes: intensity and CCT. Two big sliders in the inspector are objectively the right control surface. An encoder strip would add chrome with zero leverage.

### N3. World / filter system

[GrandMA3 Worlds and Filters](https://help.malighting.com/grandMA3/2.3/HTML/worldfilter.html) — define a subset of fixtures + attributes that the console pretends are the only ones in the show.

**Why not:** Worlds solve programming 1500 fixtures across 4 stages where you scope your work. A 40-fixture single-room studio doesn't have that problem. Groups + multi-select cover 100 % of our scoping needs. Adding worlds would be conceptual debt for an imaginary problem.

### N4. Cue stack / sequence player with go-button playback

[QLab cue lists](https://qlab.app/docs/v5/fundamentals/cue-lists/), [GrandMA3 Sequence Sheet](https://help2.malighting.com/Page/grandMA3/cue_sequence_sheet/en/1.2), Eos cue lists, ChamSys playbacks — linear list of cues advanced with a Go button.

**Why not:** Cue stacks model linear theatrical time — the show advances through cues in sequence. A recording session is _non-linear_ — operators bounce between scenes based on what's happening on camera. Direction D's product brief is explicit: "scene picker, NOT cue stack". The cue model was already removed in PR #32.

### N5. Effect engine (chases, sine waves, oscillators)

[Eos Effects Workbook](https://www.etcconnect.com/uploadedFiles/Main_Site/Documents/Public/Video_Tutorial/EosFamily_ET_Effects_INT_Wrkbk.pdf) — every theatrical console.

**Why not:** Studio recording is intentionally undynamic — set a look and hold it for the take. Concert-style chases / strobes / rainbows are out of scope. Adding an effects layer would imply huge engine surface (effects tab, parameters, layered effects, opacity, base values) and violate the polish-wave constraint.

---

## How to use this list

A future session can pick any I-item to depth-implement. F1–F12 in [lighting-direction-d-followups.md](lighting-direction-d-followups.md) and these I-items can be interleaved freely — they don't depend on each other except where noted (I4 pairs with F8; I6 pairs with F6; I10 complements F7).

If picking by impact-per-LOC, ranked order is:

1. **I8** (group inspector remove affordance, ~30 LOC) — smallest, real gap
2. **I3** (searchable shortcuts overlay, ~140 LOC) — high discoverability return
3. **I1** (intensity bar on markers, ~60 LOC) — single most visible plot upgrade
4. **I2** (Highlight / Solo modes, ~230 LOC across engine + frontend) — most "feels like a lighting tool" upgrade
5. **I6** (recent scenes in search, ~120 LOC) — daily-use accelerator
6. **I5** (mixed indicator + delta entry, ~180 LOC) — senior-op precision
7. **I4** (color tags for scenes / groups, ~250 LOC) — scales with rail size
8. **I7** (view bookmarks, ~130 LOC) — niche but loved
9. **I10** (scrub-on-label, ~150 LOC) — pairs with F7
10. **I9** (selection chip strip, ~100 LOC) — overlap with bulk inspector reduces value

The promising-but-bigger items (P1–P5) deserve their own plan + design pass before any implementation work. P1 (blind / preview mode) and P3 (per-attribute palettes) are the highest-leverage of the bigger bets.

---

## Sources

### Lighting consoles

- ETC Eos Family: [Magic Sheet Object Library](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/19_Magic_Sheets/Magic_Sheet_Editor/Magic_Sheet_Object_Library.htm), [Highlight, Next and Last](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Performing_a_Dimmer_and_Device_Check_with_Highlight,_Next,_and_Last), [Recording and Editing Cues from Blind](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/12_Cues_and_Cue_Lists/08_Recording_and_Editing_Cues_from_Blind/About_Recording_and_Editing_Cues_from_Blind.htm), [Eos Snapshots](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/04_System_Basics/09_Snapshots/Snapshots.htm), [Manual control fade timing thread](https://community.etcconnect.com/control_consoles/eos-family-consoles/f/eos-family/24817/manual-controls-fade-timing)
- MA Lighting GrandMA3: [Programmer](https://help2.malighting.com/Page/grandMA3/operate_programmer/en/1.4), [Preset Pools](https://help2.malighting.com/Page/grandMA3/presets_pools/en/1.4), [Encoder Toolbar](https://help2.malighting.com/Page/grandMA3/ws_eb_encoder_toolbar/en/1.4), [Worlds and Filters](https://help.malighting.com/grandMA3/2.3/HTML/worldfilter.html), [Edit or Update Presets](https://help2.malighting.com/Page/grandMA3/presets_edit/en/1.7)
- High End Hog 4: [Palettes and Directories](https://www.etcconnect.com/webdocs/Controls/HOG/HTML/en/sect-palettes.htm), [Spreadsheets](https://www.etcconnect.com/webdocs/Controls/HOG/HTML/en/sect-w_w_spreadsheets.htm)
- ChamSys MagicQ: [Palettes](https://secure.chamsys.co.uk/docs/magicq/manual/palletes.html), [Programmer](https://secure.chamsys.co.uk/docs/magicq/programmer/programmer.html)
- Avolites Titan: [Cue Playback](https://manual.avolites.com/docs/cues/cue-playback/), [Playback Controls](https://manual.avolites.com/docs/running-the-show/playback-controls/)
- Capture: [2024 Design Tab](https://www.capture.se/Manual/en-UK/2024/DesignTab.html)
- QLab: [Cue Lists v5](https://qlab.app/docs/v5/fundamentals/cue-lists/)
- Vectorworks Spotlight: [Formatting label legend layout (2024)](https://app-help.vectorworks.net/2024/eng/VW2024_Guide/LightingDesign1/Formatting_the_label_legend_layout.htm)

### High-end professional tools

- Logic Pro: [Channel strip controls](https://support.apple.com/guide/logicpro/channel-strip-controls-lgcpbc219210/mac)
- Ableton Live: [Session View v12](https://www.ableton.com/en/manual/session-view/)
- DaVinci Resolve: [Color page](https://www.blackmagicdesign.com/products/davinciresolve/color)
- Figma: [Multi-edit announcement](https://forum.figma.com/product-updates-3/meet-multi-edit-35320), [Multi-editing in Figma — Joey Banks](https://medium.com/@joeyabanks/everything-to-know-about-multi-editing-in-figma-edd58369fd20)
- Linear: [Keyboard-shortcuts changelog](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help), [Invisible details](https://medium.com/linear-app/invisible-details-2ca718b41a44)
- VS Code: [Tips and Tricks](https://code.visualstudio.com/docs/getstarted/tips-and-tricks), [Quick Open by recency](https://simon.heimlicher.com/technology/vscode-quick-open-recently/)
- Notion: [Intro to databases](https://www.notion.com/help/intro-to-databases)

---

## Out of scope for this audit

- F1–F12 polish gaps already documented in [lighting-direction-d-followups.md](lighting-direction-d-followups.md) — not duplicated here.
- Engine schema changes beyond what listed items minimally require.
- Onboarding tours / new-user flows.
- Multi-user / presence / streaming features.
- Internationalization (single-locale studio).
- §3.8 release-evidence cycles.
- Windows target-host validation outside the standard `tauri:smoke:win` lane.
