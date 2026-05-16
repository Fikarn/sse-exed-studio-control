# Lighting Direction D — Premium production-ready target

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

Authored 2026-04-30 against `origin/main` at `c285541`. Direction D Waves 1–23 + post-merge hygiene PRs all shipped; native test floor 118 engine + 6 shell = 124. This document consolidates every gap between the current state and an ultra-premium, production-ready final state.

The criterion here is **does the absence of this item make the product feel less than premium?** — not LOC, not implementation effort, not impact-per-effort.

Items are grouped into three tiers:

- **Tier 1** — gap is a premium-feel red flag. A user familiar with high-end pro tools will notice the absence within 30 seconds of use.
- **Tier 2** — gap is felt during sustained use. Operators won't hit the wall on first use, but workflows feel coarser without it.
- **Tier 3** — refinements that compound into perceived quality. Individually small, collectively the difference between "competent" and "ultra-premium".

Within each tier, items are sub-grouped by surface (stage plot / scene rail / inspector / toolbar+shortcuts / cross-cutting). This is the gap list the workspace must close to reach the premium bar.

A separate "Out of scope" section at the bottom catalogues patterns common in lighting consoles that we explicitly should NOT adopt — calibration on what we _aren't_.

Each item carries a tag for its origin: **F#** = pre-existing follow-up from [lighting-direction-d-followups.md](lighting-direction-d-followups.md); **I#** = industry-comparator finding from [lighting-d-industry-audit.md](lighting-d-industry-audit.md); **P#** = promising-but-bigger bet from the same audit.

---

## Tier 1 — Required for premium feel

### Stage plot

**1. Live position overlay during fixture drag** (F4)
Floating chip near cursor showing `X: 4.5 m, Y: 2.0 m` while a fixture marker is being dragged. Every spatial tool — Vectorworks, Capture, Figma, Sketch, AutoCAD — does this. Without it, drag is a blind action you only verify after release.
_Surface:_ [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) — render an SVG `<text>` chip while `ghost` is set.

**2. Marquee (rubber-band) selection on the stage plot** (F2)
Drag in empty plot space → rectangle → fixtures inside become selected. Shift+marquee adds. Every visualizer (AutoCAD, Vectorworks, Capture, Figma) supports this. Without it, multi-select feels primitive — operators are limited to cmd-click or select-all.
_Surface:_ [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) — `useMarqueeSelection` hook + visual rectangle layer.

**3. Glanceable intensity bar on each fixture marker** (I1)
A 4 × 24 px CCT-tinted vertical bar attached to each marker; height fills proportionally to intensity. ETC Eos magic-sheet pattern. The plot already conveys intensity three ways (marker dot opacity, light pool, meta-line text), but none gives at-a-glance comparison across many fixtures simultaneously — the mode operators actually scan in. The bar adds the missing dashboard quality.
_Surface:_ [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) — render bar inside existing `<g>`.

**4. Highlight / Solo modes for selected fixtures** (I2)
Sustained version of the existing identify burst. **Highlight** (`H`): selected fixtures override to 100 % at neutral CCT (output overlay, no stored-state mutation). **Solo** (`Shift+H`): unselected on-fixtures override to 0 %. Both auto-clear on `Escape`. ETC Eos `[Highlight]` and GrandMA3 Solo. Without these, "which fixture is which" requires the F12 sequential pulse or visual hunting. Basic lighting-tool expectation.
_Surface:_ New IPC `lighting.fixture.highlight`; toolbar buttons in [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx); engine override layer parallel to identify bursts in [identify.rs](native/rust-engine/src/lighting/identify.rs).

### Scene rail

(no Tier 1 gaps — rail is in strong shape)

### Inspector

**5. Inline rename (double-click name → edit in place)** (F1)
Linear, Trello, Notion, Figma, Slack, every modern productivity tool. Modal-rename interrupts flow on a frequent action. The current pencil-icon → `RenameDialog` modal pattern feels 2010-era.
_Surface:_ New `<InlineRename>` primitive in design-system; replaces pencil pattern at SceneTile name, InspectorFixture / InspectorScene / InspectorGroup name rows.

**6. Fine-adjust modifiers on sliders** (F7)
Shift+drag for ×0.1 fine, ⌘+drag for ×10 coarse, double-click value to reset to default. Logic Pro, Ableton, Figma, every premium slider. Without these, the CCT slider going 2700 → 6500 K across ~200 px is "flick and hope". Pro tool slider expectation.
_Surface:_ Slider primitives in [LightingInspector.module.css](frontend/app/src/app/lighting/components/LightingInspector.module.css) + call sites in [InspectorFixture.tsx](frontend/app/src/app/lighting/components/InspectorFixture.tsx) / [InspectorFixtureBulk.tsx](frontend/app/src/app/lighting/components/InspectorFixtureBulk.tsx) / [MasterCard.tsx](frontend/app/src/app/lighting/components/MasterCard.tsx).

### Toolbar / shortcuts

**7. ⌘K command palette** (F6)
Single keystroke opens a fuzzy-searchable surface for actions and entities. "Recall scene Talking Head" / "Pin Backlit warm" / "Toggle patch mode" all become one keystroke + a few characters. Linear, Notion, GitHub, Slack, Figma, VS Code — universal in modern pro tools. Without it, every action requires hunting in menus or keyboard shortcuts.
_Surface:_ New `<CommandPalette>` design-system primitive (search + result list + keyboard nav). Action registry exported per workspace. Fuzzy match via a small library (`fuzzysort` or similar).

**8. Searchable shortcuts overlay bound to `?`** (I3)
Static `KeyboardShortcutsPopover` (kebab menu in toolbar) becomes a searchable, context-aware overlay opened by `?`. Linear pattern. With 18+ shortcuts and growing, static reference is not findable. Universal in modern pro tools (GitHub, GitLab, Notion, Slack, Discord).
_Surface:_ [KeyboardShortcutsPopover.tsx](frontend/app/src/app/lighting/components/KeyboardShortcutsPopover.tsx) restructure + new `?` keydown in [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx).

### Cross-cutting

**9. Toast placement + inline Undo action** (F3)
Move feedback toasts from top banner to bottom-right portal. Add optional `action: { label, onClick }` to the `setFeedback` shape; wire delete-scene / delete-fixture / save-scene to surface inline "Undo" buttons. Top banners are reserved for incident-class state (already covered by `<StatusBand>`). Without inline Undo, ⌘Z exists but is invisible.
_Surface:_ [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) feedback rendering; portal in [OperatorShell.tsx](frontend/app/src/app/OperatorShell.tsx).

**10. Right-click context menus** (F8)
Universal discovery affordance for Rename / Duplicate / Delete / Pin / etc. macOS Finder, Logic Pro mixer strips, Figma layers, Ableton clips — every premium app. Without them, rich actions are buried in inspector chrome and the workspace feels static.
_Surface:_ New `<ContextMenu>` design-system primitive (Radix-style). Hookups on `SceneTile`, `GroupChip`, `FixtureMarker`.

---

## Tier 2 — Strongly elevates premium feel

### Stage plot

**11. Smart guides during fixture reposition** (F9)
Vectorworks and Figma show alignment lines when a dragged fixture is colinear with another. Subtle, useful for symmetric rigs.
_Surface:_ [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) drag math + render layer in [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx).

**12. Drag-reorder for groups** (F5)
Parallel to scene drag-reorder shipped in Wave 23 PR #41. Engine schema partially ready (`scene_order` exists; `group_order` is the parallel). Asymmetric reorder support is jarring once noticed.
_Surface:_ Engine `LightingEditorState.group_order`, new `lighting.group.reorder` IPC. Frontend: lift the dnd-kit pattern from [SceneRail.tsx](frontend/app/src/app/lighting/components/SceneRail.tsx) into [GroupRail.tsx](frontend/app/src/app/lighting/components/GroupRail.tsx).

### Scene rail

**13. Color tags for scenes and groups** (I4)
Right-click → "Color" submenu (under Tier 1 #10 context menus); 8 brand-y swatches + Clear. 4 px left accent bar on tile + dot on name in palette/search results. Same affordance for group chips. Ableton Live pattern. With 30+ scenes (Wave 23.A virtualized), all tiles look alike — color gives operators visual landmarks ("approved looks", "studio A", "B-roll").
_Surface:_ Engine adds `color_index: Option<u8>` on scene + group; fold into existing update IPCs (already added in Wave 17). Frontend: 4 px accent bar in [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) + [GroupChip.tsx](frontend/app/src/app/lighting/components/GroupChip.tsx); color picker primitive in design-system.

**14. Hover preview for scene tiles** (new — surfaced in cross-reference; tracked as **X1** in the implementation plan)
After a 300 ms hover, the inspector previews the hovered scene's contents (treated like a click that sets `previewSceneId`, but doesn't fire the recall IPC). Mouseout reverts. Eos and Capture preview presets on hover. Without it, operators must commit to a click to see what's in a scene — useful for scenes with cryptic names or post-virtualization for unfamiliar tiles.
_Surface:_ [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) `onPointerEnter` + delay timer; reuse existing `previewSceneId` mechanic in [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx).

**15. Recent scenes at top of search and palette** (I6)
When `⌘F` toolbar search opens with empty query, show "Recent" section with last 5–8 touched scenes (recall + save events), most-recent first. Same recency at top of Tier 1 #7 palette. VS Code Quick Open pattern. Engine already tracks `lastRecalledAt`; just needs a surface. Pairs naturally with the palette but works standalone.
_Surface:_ [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx) dropdown OR fold into the command palette.

### Inspector

**16. "Mixed" indicator + relative delta entry on bulk-inspector sliders** (I5)
When bulk-selection values differ, slider track shows two ghost thumb dots at min and max. Number field reads `Mixed (52–78)`. Dragging the primary thumb shifts every fixture's value by the same delta (preserves balance). Typing `+5` applies +5; `+10%` scales each by 1.10. Figma multi-edit pattern. Without it, bulk operations either fan out without preserving balance or require fan-out per fixture.
_Surface:_ [InspectorFixtureBulk.tsx](frontend/app/src/app/lighting/components/InspectorFixtureBulk.tsx) + new `<MultiValueSlider>` design-system primitive.

**17. Scrub-on-numeric-label for inspector text inputs** (I10)
Hover label `Stage X (m)` → cursor `ew-resize` → drag horizontally scrubs value. Fine with Shift, coarse with ⌘. Logic Pro / Figma idiom. Pairs with #6 to give complete numeric-precision coverage across sliders + text inputs.
_Surface:_ New `<ScrubLabel>` design-system primitive; apply in [InspectorFixture.tsx](frontend/app/src/app/lighting/components/InspectorFixture.tsx) for Stage X / Y / Rig height / Beam angle.

### Cross-cutting

**18. Empty-state CTA buttons** (F10)
Wave 21 standardised empty-state copy. Premium tools (Linear, Notion) also include primary action buttons in empty states ("Add fixture" inside the empty plot, "Save first scene" inside the empty rail). Without CTAs, empty states are dead-ends.
_Surface:_ `<EmptyState>` design-system primitive already exists; add `action` prop. Apply at empty plot in [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx), empty rail in [SceneRail.tsx](frontend/app/src/app/lighting/components/SceneRail.tsx), empty group rail in [GroupRail.tsx](frontend/app/src/app/lighting/components/GroupRail.tsx).

**19. Blind / Preview-edit mode** (P1)
Toolbar toggle. While active, slider edits land into an offline edit buffer; rig keeps showing whatever scene was last recalled live. Save commits. Eos `[Blind]` / GrandMA3 blind. Solves the dual-persona tension: senior op builds new looks during a live session without disturbing the recording. Premium consoles all have this; absence forces "save as new and rebuild" or "wait until between takes".
_Surface:_ New IPC `lighting.editor.previewMode { enabled }`; engine maintains a parallel `preview_state` next to live state. Toolbar toggle, ghosted plot markers when active, inspector banner "Editing offline · Save to commit".

**20. Per-attribute palette pools — CCT and intensity presets** (P3)
New right-inspector tab "Palettes" with two sub-pools: Intensity (10 / 25 / 50 / 100 % named) and CCT (Warm 2700 / Studio 4000 / Daylight 5600 / Cool 6500 — names + values editable). Tile + apply-on-click on selection. `⌘⇧P` quick popover. Hog 4 / GrandMA3 / Eos pattern. "All selected fixtures to 4000 K" is a daily senior-op micro-task; today it's drag-the-slider-and-eyeball, palettes make it one-click.
_Surface:_ Engine adds `LightingPalette` records + IPCs. New `InspectorPalettes` pane. New design-system `<PaletteTile>`.

---

## Tier 3 — Refinements that compound

### Stage plot

**21. Saved view bookmarks for stage plot pan/zoom** (I7)
Three numbered slots in [StagePlotControls.tsx](frontend/app/src/app/lighting/components/StagePlotControls.tsx) storing `{ zoom, panX, panY }`. Right-click slot to save current; click slot to recall (animated 200 ms). Capture views pattern, scoped down. Persisted to `localStorage`.

**22. Identify "find" mode (sequential pulses)** (F12)
ETC Eos pattern. Sequential identify pulses fixtures one by one. Useful for finding a misplaced rig fixture. Niche but loved by lighting ops. Different from Tier 1 #4 Highlight — that's sustained-on-selected; this is sequential-across-all.

### Scene rail

**23. Aggregate scene-shape mini-graph on tile** (P5)
Bottom 12 px of tile: 8 vertical bars sorted high-to-low, height = fixture intensity, fill = CCT tint. Two scenes are visually distinguishable even at the same name. DaVinci Resolve scopes inspiration. Alternative-to or complementary-with #13 color tags.

### Inspector

**24. Group inspector "remove fixture from group" affordance** (I8)
Hover-revealed × button on member rows in [InspectorGroup.tsx](frontend/app/src/app/lighting/components/InspectorGroup.tsx). Today removing a fixture from a group requires navigating to that fixture's inspector and using the group `<select>`. Inspector convention violation; fix is small.

**25. Patch-mode persistent on-screen exit affordance** (F11)
`P` keyboard hint exists but no on-screen "Exit patch mode" button. Discoverable patch-mode exit would help non-power users.

### Toolbar / shortcuts

(no Tier 3 gaps beyond what's already in Tier 1 #7 / #8)

### Cross-cutting

**26. Always-visible selection-bar chip strip** (I9)
32 px horizontal strip docked above health bar showing a chip per selected fixture. Click chip → remove from selection. Hover chip → corresponding marker pulses. Figma multi-edit / GrandMA3 channel sheet pattern. Partial overlap with the bulk inspector reduces uniqueness, but always-visible affords confidence.

**27. Manual fade time on recall** (P2)
"Fade time" chip in toolbar (default 0 s); `T` while hovering a tile sets time. Mid-fade progress bar on the recalled tile. Eos `[Sneak]` + `[Time]`. Engine cross-fade interpolator with correlated tunable-white interpolation. Recall feels more cinematic.

**28. Persistent compact DMX strip in bottom bar** (P4)
Toggle in health bar "DMX strip"; when on, 60 px row of one-pixel-wide cells per channel with CCT-tinted intensity gradient. Click strip → opens existing ⌘⇧M full grid. DAW meter-bridge / Hog 4 spreadsheets idiom. Glanceable always-on "is anything firing" without invoking the modal.

---

## Out of scope — explicitly not adopting

These patterns are common in lighting consoles but don't fit the recall-driven dual-persona product model. Documenting them here is calibration: this is what we _are_ and what we _aren't_.

**N1. Keypad command-line syntax** (`Channel 1 Thru 5 At 50 Enter`) — Eos / GrandMA3 / Hog 4. Optimized for 100+ channel theatrical programmers. Our universe is small (~40 fixtures) and visual. F6 ⌘K palette gives the discoverability win without the syntax.

**N2. Encoder-wheel attribute paradigm** — GrandMA3 / Hog 4 dedicate 4–6 rotary encoders mapped to feature groups. Pattern exists for moving-light fixtures with ~30 attributes. Our fixtures have **two** meaningful attributes (intensity + CCT). Two big sliders in the inspector are objectively right.

**N3. World / filter system** — GrandMA3 worlds. Solves programming 1500 fixtures across 4 stages. A 40-fixture single-room studio doesn't have that problem. Groups + multi-select cover 100 % of our scoping needs.

**N4. Cue stack / sequence player with go-button playback** — QLab, Eos cue lists, GrandMA3 sequences, ChamSys playbacks. Models linear theatrical time. A recording session is non-linear — operators bounce between scenes based on what's happening on camera. Direction D's product brief explicitly excludes the cue model; cue code was removed in PR #32.

**N5. Effect engine** (chases, sine-waves, oscillators on attributes) — every theatrical console. Studio recording is intentionally undynamic — set a look and hold it for the take. Concert-style chases / strobes / rainbows are out of scope.

---

## Sources

### Lighting consoles

- ETC Eos Family: [Magic Sheet Object Library](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/19_Magic_Sheets/Magic_Sheet_Editor/Magic_Sheet_Object_Library.htm), [Highlight, Next and Last](https://support.etcconnect.com/ETC/Consoles/Eos_Family/Software_and_Programming/Performing_a_Dimmer_and_Device_Check_with_Highlight,_Next,_and_Last), [Recording and Editing Cues from Blind](https://www.etcconnect.com/WebDocs/Controls/EosFamilyOnlineHelp/en/Content/12_Cues_and_Cue_Lists/08_Recording_and_Editing_Cues_from_Blind/About_Recording_and_Editing_Cues_from_Blind.htm), [Manual fade timing thread](https://community.etcconnect.com/control_consoles/eos-family-consoles/f/eos-family/24817/manual-controls-fade-timing)
- MA Lighting GrandMA3: [Programmer](https://help2.malighting.com/Page/grandMA3/operate_programmer/en/1.4), [Preset Pools](https://help2.malighting.com/Page/grandMA3/presets_pools/en/1.4), [Edit or Update Presets](https://help2.malighting.com/Page/grandMA3/presets_edit/en/1.7)
- High End Hog 4: [Palettes and Directories](https://www.etcconnect.com/webdocs/Controls/HOG/HTML/en/sect-palettes.htm), [Spreadsheets](https://www.etcconnect.com/webdocs/Controls/HOG/HTML/en/sect-w_w_spreadsheets.htm)
- ChamSys MagicQ: [Palettes](https://secure.chamsys.co.uk/docs/magicq/manual/palletes.html)
- Capture: [2024 Design Tab](https://www.capture.se/Manual/en-UK/2024/DesignTab.html)

### Pro tools (cross-pollination)

- Logic Pro: [Channel strip controls](https://support.apple.com/guide/logicpro/channel-strip-controls-lgcpbc219210/mac)
- Ableton Live: [Session View v12](https://www.ableton.com/en/manual/session-view/)
- Figma: [Multi-edit announcement](https://forum.figma.com/product-updates-3/meet-multi-edit-35320), [Multi-editing in Figma — Joey Banks](https://medium.com/@joeyabanks/everything-to-know-about-multi-editing-in-figma-edd58369fd20)
- Linear: [Keyboard-shortcuts changelog](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help), [Invisible details](https://medium.com/linear-app/invisible-details-2ca718b41a44)
- VS Code: [Tips and Tricks](https://code.visualstudio.com/docs/getstarted/tips-and-tricks)

### Internal references

- [lighting-direction-d-followups.md](lighting-direction-d-followups.md) — F1–F12 (industry-pattern matches against general productivity tools)
- [lighting-d-industry-audit.md](lighting-d-industry-audit.md) — I1–I10 + P1–P5 (lighting-console + pro-tool comparators with full per-item spec)
- [lighting-direction-d-implementation-plan.md](lighting-direction-d-implementation-plan.md) — original Direction D plan
- [lighting-direction-d-polish-plan.md](lighting-direction-d-polish-plan.md), [lighting-direction-d-audit-fix-plan.md](lighting-direction-d-audit-fix-plan.md), [lighting-direction-d-polish-waves-19-22-plan.md](lighting-direction-d-polish-waves-19-22-plan.md) — wave plans for already-shipped polish
