# Lighting Direction D — Polish follow-ups (post-Waves 19–23)

Authored 2026-04-29 after Waves 19–22 (PRs #35–#38) and Wave 23 (PRs #39–#41) shipped, closing all 64 audit findings. This document captures industry-standard interaction patterns the lighting workspace **doesn't yet match** but didn't surface in the original 64-finding audit. None of these are bugs; they're "feels like a pro tool" gaps identified by comparing the workspace against Notion, Linear, Figma, Logic Pro, ETC Eos / GrandMA3, Vectorworks, and Ableton.

A future Claude Code session can pick any of these as a focused initiative. Each is sized as a rough indication of LOC.

## High-impact

### F1. Inline rename (double-click name → edit in place)

**Current**: pencil-icon → `<RenameDialog>` modal. Used for scenes, fixtures, groups.

**Industry**: Linear, Trello, Notion, Figma, Slack — double-click the name, it becomes editable, Enter commits, Escape cancels. Modals here interrupt flow because rename is a frequent action.

**Surface**: SceneTile name, InspectorFixture / InspectorScene / InspectorGroup name rows. Reuse `RenameDialog`'s validation logic in an `InlineRename` primitive (~100 LOC for the primitive + ~30 LOC per call site).

### F2. Marquee (rubber-band) selection on the stage plot

**Current**: click to select, shift+click to add. Was explicitly deferred in Wave 10 of the polish-plan ("OUT OF SCOPE").

**Industry**: AutoCAD, Vectorworks, Capture, Figma, every visualizer. Drag in empty plot space → rectangle → fixtures inside the rectangle become selected. Shift+marquee to add.

**Surface**: [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx). Hit-test the rectangle against fixture marker positions in viewBox space. ~150 LOC; needs a `useMarqueeSelection` hook + visual rectangle layer.

### F3. Toast placement + inline Undo action

**Current**: top banner. Auto-dismiss for non-error toasts after 3.5 s (Wave 20.F).

**Industry**: Linear, Notion, Slack, VS Code, Figma — toasts in **bottom-right** (or bottom-center for app-wide), often with an inline action button ("Undo", "Show details"). Top banners are reserved for incident-class state (which we already use `<StatusBand>` for).

**Surface**: [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) feedback rendering. `setFeedback` already supports `tone`; extend the shape to include an optional `action: { label, onClick }`. Move the rendering to a bottom-right portal in `OperatorShell`. Wire delete-scene / delete-fixture / save-scene to surface an "Undo" action button — current ⌘Z works but isn't discoverable. ~120 LOC.

### F4. Live position overlay during fixture drag

**Current**: position is read in the inspector after commit; nothing during the drag.

**Industry**: Vectorworks, Capture, Figma, Sketch, AutoCAD all show a small floating chip ("X: 4.5 m, Y: 2.0 m") next to the cursor while a marker / shape is being dragged. The single most useful drag affordance on a stage plot.

**Surface**: extend [useFixtureDrag.ts](frontend/app/src/app/lighting/useFixtureDrag.ts) to expose the in-flight `(xMeters, yMeters)`. Render a small SVG `<text>` overlay in [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) tracking the cursor while drag is active. ~30 LOC.

### F5. Drag-reorder for groups (parallel to scenes)

**Current**: scenes drag-reorder via `@dnd-kit/sortable` (Wave 23 PR #41). Groups don't.

**Industry**: any tool with a list of orderable items lets you reorder them all the same way.

**Surface**: same dnd-kit pattern, applied to [GroupRail.tsx](frontend/app/src/app/lighting/components/GroupRail.tsx). Engine already has `LightingEditorState.scene_order` — add a parallel `group_order` field, an `lighting.group.reorder` IPC, and an `onReorderGroup` handler in the workspace. Lift the pattern from PR #41. ~250 LOC across engine + frontend.

## Medium-impact

### F6. Cmd+K command palette

**Current**: ⌘F focuses the toolbar search (Wave 22.C). No global command surface.

**Industry**: Linear, Notion, GitHub, Slack, Figma — single keystroke opens a fuzzy-searchable command + entity surface. "Recall scene Talking Head" / "Pin Backlit warm" / "Toggle patch mode" are all one keystroke + a few characters.

**Surface**: new design-system primitive `<CommandPalette>` (search input + result list + keyboard nav). Fed by an action registry exported from each workspace. Fuzzy match via a small library (`fuzzysort` ~5 KB). ~400 LOC. Worth a separate plan-and-design pass.

### F7. Fine-adjust + scrub on sliders

**Current**: 0–100 single-resolution drag.

**Industry**: Logic Pro, Ableton, Figma — Shift+drag for fine increments (×0.1), Cmd+drag for coarse (×10), double-click value to reset to default, drag-on-numeric-label to scrub-via-text. CCT slider going 2700→6500 K across ~200 px especially benefits — without fine-adjust it's "flick and hope".

**Surface**: extend the slider primitives in [LightingInspector.module.css](frontend/app/src/app/lighting/components/LightingInspector.module.css) + the slider call sites in [InspectorFixture.tsx](frontend/app/src/app/lighting/components/InspectorFixture.tsx) / [InspectorFixtureBulk.tsx](frontend/app/src/app/lighting/components/InspectorFixtureBulk.tsx) / [MasterCard.tsx](frontend/app/src/app/lighting/components/MasterCard.tsx). Either build into the slider directly or extract a `<ScrubSlider>` primitive in the design-system. ~200 LOC.

### F8. Right-click context menus

**Current**: inline action chips for most actions. No right-click discovery.

**Industry**: macOS Finder, Logic Pro mixer strips, Figma layers, Ableton clips — right-click is the expected discovery path for Rename / Duplicate / Delete / Pin / etc.

**Surface**: new design-system primitive `<ContextMenu>` (Radix-style, follows existing `<Dialog>` / `<Tooltip>` API). Hookups on `SceneTile` (rename / duplicate / pin / delete), `GroupChip` (rename / delete / inspect), `FixtureMarker` (rename / pin? / delete / identify). ~200 LOC for the primitive + ~30 LOC per call site.

## Lower-impact polish

### F9. Smart guides during fixture reposition

Vectorworks and Figma show alignment lines when a dragged fixture is colinear with another. Useful for symmetric rigs.

### F10. Empty-state CTA buttons

Wave 21 standardised the copy. Linear-style empty states also include a primary action button ("Add fixture" inside the empty plot, "Save first scene" inside the empty rail).

### F11. Patch-mode persistent exit affordance

`P` keyboard hint exists but no on-screen "Exit patch mode" button. Discoverable patch-mode exit would help non-power-users.

### F12. Identify "find" mode

ETC Eos has a sequential identify that pulses fixtures one by one. Useful for finding a misplaced rig fixture. Niche but loved by lighting ops.

---

## How to use this list

A future session running on `main` can pick any item. F4 (live position overlay) is the smallest and most visible win — an obvious starter. F1 (inline rename) and F5 (group drag-reorder) are natural follow-ups since they reuse patterns already in the codebase.

F6 (command palette) and F7 (fine-adjust sliders) are bigger and deserve their own plan + design pass before implementation.

The rest can be picked up opportunistically.

## Out of scope for this document

- Engine schema changes beyond what F5 / F6 minimally need.
- Onboarding tours / new-user flows.
- Multi-user / presence features.
- §3.8 release-evidence cycles.
- Windows target-host validation outside the standard `tauri:smoke:win` lane.
