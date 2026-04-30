# Lighting Direction D — Premium implementation plan (Waves 24–34)

Authored 2026-04-30 against `origin/main` at `c285541`. This plan turns the 28 findings in [lighting-d-premium-target.md](lighting-d-premium-target.md) into a concrete, sequenced wave structure that a future Claude Code session can pick up and execute without re-discovery.

The companion docs are the source of truth for **what** to build:

- [lighting-d-premium-target.md](lighting-d-premium-target.md) — the 28-item ranked target list (T1 / T2 / T3).
- [lighting-direction-d-followups.md](lighting-direction-d-followups.md) — F1–F12 spec detail.
- [lighting-d-industry-audit.md](lighting-d-industry-audit.md) — I1–I10 + P1–P5 spec detail with citations.

This plan is the source of truth for **when** and **how** to build it.

---

## How to use this plan

A future session picking this up does these three things in order:

1. **Read the standing rules** below — they apply to every wave and are not repeated per-wave.
2. **Pick the next unstarted wave** from the wave summary table. Each wave's per-wave spec is self-contained and links to per-item specs in the companion docs.
3. **Execute the wave operational pattern** below. The pattern is mechanical: branch → work → local validation → PR → retarget if stacked → merge → loop.

When the plan disagrees with the companion docs on item-level details (file pointers, comparator descriptions), the companion docs win — they're per-item specs, this plan is the wave structure around them.

The plan covers **Waves 24 through 34** — 11 waves closing all 28 findings plus 5 calibration items explicitly skipped.

---

## Standing rules (apply to every wave)

These are durable invariants from prior session memory + AGENTS.md. Do not relitigate per wave.

1. **Auto-revert generated artifacts before staging.** `tauri/gen/schemas` and `frontend/packages/tokens/src/generated/*` regenerate on build; revert them unless that's the intended diff.
2. **Explicit per-invocation go-ahead for invasive ops.** Force-pushes, branch pushes, PR merges, persisted-state mutations, release-evidence cycles, system installs all need confirmation in chat. A previous wave's permission does NOT carry over.
3. **WIP commits over `git stash -u`.** When preserving WIP before a destructive op, use a named `wip/` branch + real commit. Stash gets lost.
4. **Local `npm run dev:check` is the verification surface.** GitHub Actions CI is intentionally unpaid — red CI is baseline noise.
5. **Windows target-host validation runs in a separate Windows-Claude session against `origin/main`.** The Mac side does not run `tauri:smoke:win`. Engine-touching waves trigger a Windows session; frontend-only waves don't.
6. **Visual review on BetterDisplay 2560×1440 is binding for UI work.** `npm run tauri:dev` on BetterDisplay-mirrored 2560×1440 — not the default Retina logical desktop. Type checking and tests verify code correctness, not feature correctness.
7. **Native test floor: 118 engine + 6 shell = 124 (lighting subset 27).** Each wave must hold or grow this floor — never shrink.
8. **`tauri.conf.json` `dragDropEnabled: false` is a permanent default** — do not re-enable.

---

## Pre-flight (single session, before Wave 24)

Before any code work on Waves 24+, do these three things in one session:

### Pre-flight 1: Wave 23 runtime smoke (~15 min)

`npm run tauri:dev` on BetterDisplay 2560×1440. Walk through:

- **Wave 23.D — title-bar drift indicator**: recall a scene, drift it (toggle a fixture), check the macOS title bar shows ` · ●`. Save changes; the dot disappears. Switch workspaces and back; behavior holds.
- **Wave 23.B/C — dnd-kit drag-reorder + pin**: drag a scene tile to a new position. Pin a scene. Pin → reorder → unpin sequence keeps the pinned cluster ahead. Drag while a search filter is active is correctly disabled. Keyboard sensor (Space pickup, arrows, Space drop) works.

Capture any defects to a notes scratch file under `/tmp/`. **Do not fix during pre-flight** — file as separate sub-tasks via `mcp__ccd_session__spawn_task` so the wave plan stays clean.

### Pre-flight 2: Quick prototype-vs-current sanity at c285541 (~30 min)

Open [docs/redesign/assets/lighting/Lighting-D-Scene-Desk.html](docs/redesign/assets/lighting/Lighting-D-Scene-Desk.html) in a browser tab, `npm run tauri:dev` in another. Spot-compare each surface for any drift since Wave 23. Per-surface checklist:

- Toolbar (header proportions, stat chips, search, buttons)
- Scene rail (tile structure, group chips, master card)
- Stage plot (markers, light pools, plot pill, plot meta)
- Inspector (tab strip, panels, slider chrome)
- Health bar (item ordering, hint copy)

Capture drift items to the same scratch file.

### Pre-flight 3: Triage notes to spawn-tasks or accept (~5 min)

Each notes-scratch item: spawn a separate task via `mcp__ccd_session__spawn_task` if it's a discrete bug, or fold into the relevant wave below if it's polish. Don't carry an unstructured bug list into Wave 24.

**Pre-flight success criterion:** A clean Wave 23 baseline + spawned-task chips for any discovered defects.

---

## Wave operational pattern (applies to every wave)

The mechanical loop for each wave. A future session can execute this without referring back to context.

### 1. Branch + worktree

- Branch name format: `claude/wave-{N}-{kebab-summary}` (e.g. `claude/wave-24-row-actions`).
- For stacked sub-PRs within a wave, use `claude/wave-{N}{a|b|c}-{kebab-summary}`.
- Work happens in the active worktree (this session is in `optimistic-hawking-d95fc3`); do not create a new worktree per wave unless explicitly told to.

### 2. Work

- **Read the wave's per-wave spec end-to-end before any code.** Includes the per-item links into the companion docs.
- **Use TodoWrite to track per-wave items**: one in_progress at a time; mark completed immediately on landing.
- **Check the dependency line** in the per-wave spec. If a prerequisite wave hasn't shipped, escalate to the user instead of duplicating its work locally.
- **Engine changes ship atomically with their frontend consumers** in the same PR. Don't merge a half-shipped IPC.
- **New design-system primitives ship with their first consumer**, not as a primitive-only PR. Lighting use-site is the validation surface.

### 3. Local validation (every wave, every PR)

These run on the Mac host. Each lane must pass before pushing.

```
npm run format:check       # prettier; auto-fix with `npm run format` (writes) if needed
npm run dev:check          # typecheck + lint + tests; native floor 118+6=124
npm run native:acceptance  # auto-chains native:engine:build per PR #34
```

For UI changes, **also**:

- `npm run tauri:dev` on BetterDisplay 2560×1440 for interactive visual review.
- `npm run tauri:visual:review` if layout/operator presentation changed (10 screenshots, target 0 failures).

For workspace qualification (only if explicitly requested per AGENTS.md §3.8):

- `npm run tauri:workspaces:qualify`

### 4. PR

- Single PR per wave when items share a coherent theme.
- Stacked sub-PRs (24a / 24b / 24c) when a wave splits cleanly along engine-vs-frontend or two unrelated themes.
- PR title: `feat(lighting): wave {N} — {summary}` or `feat(lighting): wave {N}{a|b} — {sub-summary}`.
- PR body: list each closed finding by ID (`F#`, `I#`, `P#`) + one-line description. Reference the companion doc.
- Use `gh pr create` from the worktree.

### 5. Stacking + merging (when sub-PRs)

GitHub auto-CLOSES stacked PRs whose base branch is deleted at merge time, with no API recovery. The 2026-04-29 run confirmed: **explicit `gh pr edit <next> --base main` between merges is the safe path.** Do not pass `--delete-branch` to `gh pr merge` while the next PR in the stack still targets the source.

Order: **merge → retarget next → merge → retarget next → … → batch-delete source branches at the end.**

### 6. Windows target-host (engine-touching waves only)

After landing on `origin/main`, hand off to a Windows-Claude session against the new HEAD with the [windows_target_host_validation.md](https://github.com/Fikarn/sse-exed-studio-control/blob/main/windows_target_host_validation.md) flow:

```
npm ci
npm run dev:check
npm run native:acceptance
npm run tauri:smoke:win
```

The Mac side does NOT run these — keep the lanes separate.

### 7. Definition of done (per wave)

- All findings in the wave's "Closes findings" list are implemented per spec.
- `npm run dev:check` exits 0 with native test count ≥ floor.
- Visual review on BetterDisplay shows no regressions in the changed surfaces.
- For engine-touching waves: Windows `tauri:smoke:win` green against the wave's merge SHA.
- PR merged to `main`; source branch deleted.
- Caveats noted in the per-wave spec are addressed.

---

## Wave summary table

| Wave | Theme                                       | Tier impact  | Engine  | Items               |
| ---- | ------------------------------------------- | ------------ | ------- | ------------------- |
| 24   | Row-action discovery foundation             | 2× T1, 1× T3 | No      | F3, F1, I8          |
| 25   | Right-click context menus                   | 1× T1, 1× T3 | No      | F8, F11             |
| 26   | Stage plot polish                           | 3× T1, 1× T2 | No      | F4, F2, I1, F9      |
| 27   | Slider precision                            | 1× T1, 2× T2 | No      | F7, I5, I10         |
| 28   | Command surface                             | 2× T1, 1× T2 | No      | F6, I3, I6          |
| 29   | Identify family expansion                   | 1× T1, 1× T3 | **Yes** | I2, F12             |
| 30   | Scene/group rail finish                     | 4× T2, 1× T3 | **Yes** | F5, I4, F10, X1, P5 |
| 31   | Cross-cutting refinements                   | 3× T3        | No      | I7, I9, P4          |
| 32   | Manual cross-fade on recall                 | 1× T3        | **Yes** | P2                  |
| 33   | Blind / preview-edit mode (architectural)   | 1× T2        | **Yes** | P1                  |
| 34   | Per-attribute palette pools (architectural) | 1× T2        | **Yes** | P3                  |

**Tier closure milestones:**

- After **Wave 29**: all 10 Tier 1 items closed → workspace clears the "feels like a finished pro tool" bar.
- After **Wave 32**: all Tier 1 + 8/10 Tier 2 + 8/8 Tier 3 closed → workspace at premium feel.
- After **Wave 34**: all 28 items closed → premium production-ready bar fully reached.

---

## Wave 24 — Row-action discovery foundation

**Closes findings:**

- **F3** (T1) — toast bottom-right + inline Undo. [followups.md](lighting-direction-d-followups.md#f3-toast-placement--inline-undo-action)
- **F1** (T1) — inline rename (double-click name → edit in place). [followups.md](lighting-direction-d-followups.md#f1-inline-rename-double-click-name--edit-in-place)
- **I8** (T3) — group inspector remove-from-group affordance. [audit.md](lighting-d-industry-audit.md#i8-group-inspector-remove-fixture-from-group-affordance-on-member-rows)

**Depends on:** None. Ship first.

**Engine touches:** No.

**New design-system primitives:**

- `<InlineRename>` — double-click to edit; commits on blur/Enter; reverts on Esc; reuses RenameDialog's whitespace+empty validation.
- Toast portal mounted in `OperatorShell.tsx` (cross-workspace; replaces per-workspace top-banner).

**Frontend files touched:**

- [OperatorShell.tsx](frontend/app/src/app/OperatorShell.tsx) — toast portal at root.
- [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — `setFeedback` shape extended; `handleSaveScene`/`handleDeleteScene`/`handleDeleteFixture` wire `action: { label: "Undo", onClick: () => undoStack.undo() }`.
- [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) — name becomes `<InlineRename>`.
- [InspectorScene.tsx](frontend/app/src/app/lighting/components/InspectorScene.tsx), [InspectorFixture.tsx](frontend/app/src/app/lighting/components/InspectorFixture.tsx), [InspectorGroup.tsx](frontend/app/src/app/lighting/components/InspectorGroup.tsx) — name rows become `<InlineRename>`. Pencil icon hidden behind hover or removed in favor of double-click discovery.
- [InspectorGroup.tsx:99](frontend/app/src/app/lighting/components/InspectorGroup.tsx:99) — member rows get hover-revealed `<IconButton icon={X} tone="ghost" size="sm" />` that calls `onAssignFixtureGroup(fixtureId, null)` after a `ConfirmDialog`.

**New IPCs:** None.

**Validation lanes:**

- `npm run format:check` (auto-fix with `npm run format` if needed)
- `npm run dev:check`
- `npm run native:acceptance`
- `npm run tauri:dev` on BetterDisplay 2560×1440 — toast positioning bottom-right; inline rename behavior on all 4 surfaces; group remove flow.

**PR pattern:** Single PR.

**Branch:** `claude/wave-24-row-actions`.

**Caveats / risks:**

- Existing `feedback` toast slides down from top via `sseToastIn` keyframe — replace with bottom-right slide-in.
- Auto-dismiss timing remains 3.5 s for non-error tones; error tones still sticky.
- Inline rename Esc must restore original text and blur cleanly.
- Hover-reveal × button on member rows: opacity 0 by default, 1 on row hover; do not display on touch (will need `@media (hover: hover)` guard if Tauri ever runs touch).

**Definition of done:**

- Three findings closed per spec.
- Standing rules + wave operational pattern's local validation lanes pass.
- Visual review approved on BetterDisplay.

---

## Wave 25 — Right-click context menus

**Closes findings:**

- **F8** (T1) — right-click context menus for SceneTile, GroupChip, FixtureMarker. [followups.md](lighting-direction-d-followups.md#f8-right-click-context-menus)
- **F11** (T3) — patch-mode persistent on-screen exit affordance. [followups.md](lighting-direction-d-followups.md#f11-patch-mode-persistent-exit-affordance)

**Depends on:** **Wave 24** — F8 wires "Rename" menu items into Wave 24's `<InlineRename>` primitive (alternative path: Rename menu still opens the modal `<RenameDialog>` if Wave 24 hasn't shipped, but inline is the premium target).

**Engine touches:** No.

**New design-system primitives:**

- `<ContextMenu>` — Radix-style positioning, viewport-edge clamping, keyboard navigation (Up/Down + Enter + Esc), no portal trap. Follows existing `<Dialog>` / `<Tooltip>` API conventions.

**Frontend files touched:**

- [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) — onContextMenu opens menu with: Rename / Duplicate (TBD — see caveat) / Pin or Unpin / Delete.
- [GroupChip.tsx](frontend/app/src/app/lighting/components/GroupChip.tsx) — Rename / Inspect / Delete.
- [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) — Rename / Identify / Delete.
- [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx) — when patch mode active, render persistent `<Button tone="primary" leadingVisual={X}>Exit patch mode</Button>` replacing the "Patch mode" eyebrow.

**New IPCs:** None.

**Validation lanes:** Same as Wave 24 + verify on right-click at all three call sites + verify patch-mode exit pill works alongside `P` shortcut.

**PR pattern:** Single PR.

**Branch:** `claude/wave-25-context-menus`.

**Caveats / risks:**

- Native `oncontextmenu` must be suppressed on the surfaces we own (call sites only), not globally — operators may want native context menus on text inputs.
- "Duplicate scene" semantics: in current model "Save as new" captures live rig state, not the saved scene. True duplicate (snapshot of saved scene → new scene with copy of fixtureStates) needs a new IPC `lighting.scene.duplicate { sceneId }`. **Decision required at start of wave**: ship Duplicate (engine touch) or omit Duplicate from menu and revisit in P1 blind mode (Wave 33). Recommended: omit Duplicate in Wave 25, fold into Wave 33.
- Keyboard navigation through the menu must respect `isEditableTarget` so it doesn't steal arrow keys from inputs.

**Definition of done:**

- F8 + F11 closed per spec.
- Right-click on all three call sites opens the menu; arrow-key + Enter/Esc navigation works; viewport-edge clamping verified.
- Standing rules + local validation pass.

---

## Wave 26 — Stage plot polish

**Closes findings:**

- **F4** (T1) — live position overlay during fixture drag. [followups.md](lighting-direction-d-followups.md#f4-live-position-overlay-during-fixture-drag)
- **F2** (T1) — marquee (rubber-band) selection on the stage plot. [followups.md](lighting-direction-d-followups.md#f2-marquee-rubber-band-selection-on-the-stage-plot)
- **I1** (T1) — glanceable intensity bar on each marker. [audit.md](lighting-d-industry-audit.md#i1-glanceable-intensity-bar-on-each-fixture-marker-eos-magic-sheet-pattern)
- **F9** (T2) — smart guides during fixture reposition. [followups.md](lighting-direction-d-followups.md#f9-smart-guides-during-fixture-reposition)

**Depends on:** None. Could ship before Wave 24 if scheduling preferred.

**Engine touches:** No.

**New design-system primitives:** None — all in lighting components.

**Frontend files touched:**

- [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) — F4 floating chip during ghost; I1 intensity bar at marker base; F9 alignment-line emission during drag.
- [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) — F2 marquee layer (background pointerdown → rect → hit-test on release); F9 alignment-line render layer; CCT-gradient `<defs>` block for I1 bars.
- New hook `useMarqueeSelection.ts` — rectangle state, viewBox transform, hit-testing.

**New IPCs:** None.

**Validation lanes:** Same as Wave 24 + careful interaction testing under pan/zoom.

**PR pattern:** Single PR.

**Branch:** `claude/wave-26-plot-polish`.

**Caveats / risks:**

- F2 marquee math must use `getScreenCTM()` of the stage `<g>` so it stays correct under zoom/pan (same trick as fixture drag in Wave 9).
- I1 intensity bar positioning varies by marker shape (square/rounded/wall-bar/stand) — calculate from marker bounding-box bottom edge.
- F9 alignment lines: emit horizontal/vertical guides when the dragged fixture's `spatialX` or `spatialY` is within 0.1 m of another fixture's same axis. Suppress if Alt held (free positioning). Snap-to-0.5 m takes precedence over guides.
- F4 chip positioning: 8 px right + 4 px below cursor; flip to left/above near right/bottom edge.

**Definition of done:**

- All four findings closed per spec.
- Marquee multi-select works; shift+marquee adds; selection persists into bulk inspector.
- Intensity bar visible on every fixture marker; CCT-tinted gradient.
- Smart guides appear only during drag and only when colinear within 0.1 m.
- Live position chip appears at cursor during drag.
- Standing rules + local validation pass.

---

## Wave 27 — Slider precision

**Closes findings:**

- **F7** (T1) — fine-adjust modifiers (Shift / ⌘ / double-click reset). [followups.md](lighting-direction-d-followups.md#f7-fine-adjust--scrub-on-sliders)
- **I5** (T2) — mixed indicator + relative delta entry on bulk-inspector sliders. [audit.md](lighting-d-industry-audit.md#i5-mixed-indicator--relative-delta-entry-on-bulk-inspector-sliders-figma-multi-edit-pattern)
- **I10** (T2) — scrub-on-numeric-label for inspector text inputs. [audit.md](lighting-d-industry-audit.md#i10-scrub-on-numeric-label-for-inspector-text-inputs-logic-pro--figma-idiom)

**Depends on:** None.

**Engine touches:** No.

**New design-system primitives:**

- `<ScrubSlider>` — replaces native `<input type="range">` with a custom track + thumb that supports Shift/⌘/double-click; keyboard (Home/End/PageUp/PageDown/arrows/digits) preserved; ARIA semantics preserved.
- `<MultiValueSlider>` — extends ScrubSlider for heterogeneous selection; renders ghost min/max thumbs; number field reads `Mixed (52–78)`; accepts delta input (`+5`, `+10%`, `-5`, `65`).
- `<ScrubLabel>` — wraps a `<label>` to expose drag-horizontal scrub for paired text inputs; ew-resize cursor on hover.

**Frontend files touched:**

- New design-system primitives in `frontend/packages/design-system/src/components/`.
- [InspectorFixture.tsx](frontend/app/src/app/lighting/components/InspectorFixture.tsx) — intensity/CCT sliders → `<ScrubSlider>`; spatial inputs labels → `<ScrubLabel>`.
- [InspectorFixtureBulk.tsx](frontend/app/src/app/lighting/components/InspectorFixtureBulk.tsx) — bulk intensity/CCT sliders → `<MultiValueSlider>`.
- [MasterCard.tsx](frontend/app/src/app/lighting/components/MasterCard.tsx) — grand-master slider → `<ScrubSlider>`.
- New util `parseDeltaExpression(input: string, currentValues: number[]): number[]` for I5 delta math.

**New IPCs:** None.

**Validation lanes:** Same as Wave 24 + careful precision testing (Shift drag at 200px range with 200K CCT step; ⌘ drag covers full range cleanly; double-click reset returns to default).

**PR pattern:** Single PR.

**Branch:** `claude/wave-27-slider-precision`.

**Caveats / risks:**

- Don't break the existing 200 ms debounced grand-master commit pattern in [LightingWorkspace.tsx:520](frontend/app/src/app/lighting/LightingWorkspace.tsx:520).
- Native input behavior (Tab focus, screen-reader announcements) must survive the swap. Stories required for design-system review.
- I5 delta expression parser: robust against malformed input (e.g. `+abc` should reject silently or show a tone="info" toast).
- ScrubLabel must work alongside the existing `inputMode=decimal` text inputs in InspectorFixture — drag-on-label changes the input value, doesn't block typing.

**Definition of done:**

- F7 + I5 + I10 closed per spec.
- All three primitives in design-system with Storybook stories.
- Standing rules + local validation pass.

---

## Wave 28 — Command surface

**Closes findings:**

- **F6** (T1) — ⌘K command palette. [followups.md](lighting-direction-d-followups.md#f6-cmdk-command-palette)
- **I3** (T1) — searchable shortcuts overlay bound to `?`. [audit.md](lighting-d-industry-audit.md#i3-searchable-shortcuts-overlay-bound-to--linear-pattern)
- **I6** (T2) — recent scenes at top of palette + ⌘F search. [audit.md](lighting-d-industry-audit.md#i6-recent-scenes-section-at-top-of-search--palette-vs-code-quick-open-pattern)

**Depends on:** None.

**Engine touches:** No (engine already tracks `lastRecalledAt`).

**New design-system primitives:**

- `<CommandPalette>` — search input + result list + keyboard nav. Action registry shape `{ id, label, group, keywords?, action: () => void, when?: () => boolean }`.

**New runtime dep:** `fuzzysort` (~5 KB minified). Add to `frontend/app/package.json`.

**Frontend files touched:**

- New design-system primitive in `frontend/packages/design-system/src/components/`.
- [OperatorShell.tsx](frontend/app/src/app/OperatorShell.tsx) — register cross-workspace actions; expose `<CommandPalette>` mounted at root.
- [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — register lighting-specific actions (recall scene N, save changes, toggle patch mode, open DMX monitor, etc.).
- [KeyboardShortcutsPopover.tsx](frontend/app/src/app/lighting/components/KeyboardShortcutsPopover.tsx) — restructure to searchable overlay; bind to `?`.
- New `useRecentScenes` hook — ring buffer of last 8 `(sceneId, timestamp)` events, populated from `recall` + `save` handlers in [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx).

**New IPCs:** None.

**Validation lanes:** Same as Wave 24.

**PR pattern:** Stacked sub-PRs **28a** (CommandPalette + I6 recent scenes) → **28b** (`?` shortcuts overlay restructure). Reason: 28a is a cross-workspace primitive deserving its own review; 28b is lighting-only.

**Branches:** `claude/wave-28a-command-palette`, `claude/wave-28b-shortcuts-overlay`.

**Caveats / risks:**

- Action registry must be cross-workspace from day 1 (OperatorShell mounts the palette). Lighting-specific actions registered via context, scoped via `when?` predicate.
- Fuzzy match should prefer recency on empty query (I6 wires to recent scenes).
- `?` keydown must not fire when an editable target is focused — reuse the existing `isEditableTarget` guard.

**Definition of done:**

- F6 + I3 + I6 closed per spec.
- ⌘K opens palette anywhere except editable targets.
- ? opens shortcuts overlay; search filters live.
- Recent scenes appear at top of empty-query palette and ⌘F search dropdown; pressing Enter on empty query recalls the most recent.
- Standing rules + local validation pass.

---

## Wave 29 — Identify family expansion

**Closes findings:**

- **I2** (T1) — Highlight / Solo modes for selected fixtures. [audit.md](lighting-d-industry-audit.md#i2-highlight--solo-modes-for-selected-fixtures-eos-highlight--grandma3-solo)
- **F12** (T3) — identify "find" mode (sequential pulses). [followups.md](lighting-direction-d-followups.md#f12-identify-find-mode)

**Depends on:** None.

**Engine touches:** **YES.** [native/rust-engine/src/lighting/identify.rs](native/rust-engine/src/lighting/identify.rs) refactor: `identify_bursts` becomes a generic `output_overrides` registry that supports three modes — `burst` (current 1.2 s pulse), `highlight` (sustained 100 % at neutral CCT), `solo` (per-fixture dim-everything-else). `read_lighting_snapshot` overlays active modes without mutating stored fixture state.

**New IPCs:**

- `lighting.fixture.highlight { fixtureIds: string[], mode: "highlight" | "solo" | "off" }`
- `lighting.fixture.identifySequence { fixtureIds: string[], stepMs: number, durationMs: number }`

**New design-system primitives:** None — uses existing `<ToggleButton>` and Tooltip.

**Frontend files touched:**

- [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx) — add Highlight + Solo + Find toolbar buttons between Patch and Add fixture.
- [FixtureMarker.tsx](frontend/app/src/app/lighting/components/FixtureMarker.tsx) — visual treatment for highlight/solo states (red outline; reused identify pulse animation for sequential mode).
- [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — H / Shift+H / Shift+I keyboard bindings; auto-clear Highlight/Solo on workspace switch + Esc.
- Engine-client TypeScript: add `highlightFixtures`, `identifySequence` methods on `ShellStore`.

**New native tests required:**

- `output_override_highlight_overlays_intensity_and_neutral_cct`
- `output_override_solo_dims_unselected`
- `output_override_off_clears_overlay`
- `identify_sequence_steps_through_in_order`
- `identify_sequence_respects_unreachable_bridge`

**Validation lanes:**

- All Wave 24 lanes.
- **Windows target-host pass** against the merge SHA — `npm run tauri:smoke:win`.

**PR pattern:** Single PR (atomic engine + frontend change).

**Branch:** `claude/wave-29-identify-family`.

**Caveats / risks:**

- Highlight + Solo cannot both be active simultaneously; engine rejects mode override conflict; toolbar buttons exclusive-toggle.
- Sequential identify must auto-stop on workspace switch and Esc.
- Engine schema is additive only — no schema bump (overlay state is transient runtime, not persisted).
- Mac native test count must grow by 5 (123 → 128 engine, lighting subset 27 → 32).

**Definition of done:**

- I2 + F12 closed per spec.
- Engine native tests grow by 5; all green.
- Mac validation passes.
- **Windows validation passes** against the merge SHA — separate Windows-Claude session.

---

## Wave 30 — Scene/group rail finish

**Closes findings:**

- **F5** (T2) — drag-reorder for groups. [followups.md](lighting-direction-d-followups.md#f5-drag-reorder-for-groups-parallel-to-scenes)
- **I4** (T2) — color tags for scenes and groups. [audit.md](lighting-d-industry-audit.md#i4-color-tags-for-scenes-and-groups--ableton-live-pattern)
- **X1 hover preview** (T2) — hover scene tile previews into inspector. [premium-target.md](lighting-d-premium-target.md#tier-2--strongly-elevates-premium-feel)
- **F10** (T2) — empty-state CTA buttons. [followups.md](lighting-direction-d-followups.md#f10-empty-state-cta-buttons)
- **P5** (T3) — aggregate scene-shape mini-graph on tile. [audit.md](lighting-d-industry-audit.md#p5-aggregate-scene-shape-mini-graph-on-tiles-resolve-scopes-inspiration)

**Depends on:**

- Wave 25 — soft dep; I4 color picker invoked from context menu. If Wave 25 hasn't shipped, ship I4 with a `C` keyboard shortcut + Inspector "Color" row instead.

**Engine touches:** **YES.** Add `color_index: Option<u8>` to scene + group records (palette index, 0..7, or null). Add `group_order: Vec<String>` parallel to existing `scene_order` on `LightingEditorState`. New IPCs: `lighting.group.reorder { groupId, beforeGroupId | null }`. Color goes through existing `LightingSceneUpdateRequest` / `LightingGroupUpdateRequest` (already shipped Wave 17) — additive optional field.

**New IPCs:**

- `lighting.group.reorder { groupId: string, beforeGroupId: string | null }`

**New design-system primitives:**

- `<ColorPicker>` — 8-swatch palette popover + Clear option.
- `<EmptyState>` (existing) extended with `action?: { label, onClick, variant? }` prop.

**Frontend files touched:**

- [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) — 4 px left accent bar (I4); P5 8-bar histogram in bottom 12 px (or alongside thumbnail per design decision); hover-preview wiring (X1).
- [GroupChip.tsx](frontend/app/src/app/lighting/components/GroupChip.tsx) — color accent.
- [GroupRail.tsx](frontend/app/src/app/lighting/components/GroupRail.tsx) — dnd-kit reorder, lifting the SceneRail pattern from PR #41.
- [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — `handleHoverPreview(sceneId)` + 300 ms timer; `onReorderGroup` handler; color update handlers.
- [InspectorScene.tsx](frontend/app/src/app/lighting/components/InspectorScene.tsx), [InspectorGroup.tsx](frontend/app/src/app/lighting/components/InspectorGroup.tsx) — Color row.
- [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) (empty state) → "Add fixture" CTA wired to `requestAddFixture`.
- [SceneRail.tsx](frontend/app/src/app/lighting/components/SceneRail.tsx) (empty state) → "Save first scene" CTA wired to `onSaveScene`.
- [GroupRail.tsx](frontend/app/src/app/lighting/components/GroupRail.tsx) (empty state) → "Add group" CTA wired to `onCreateGroup`.

**New native tests required:**

- `lighting_scene_color_round_trip`
- `lighting_group_color_round_trip`
- `lighting_group_reorder_move_before_anchor`
- `lighting_group_reorder_move_to_end`
- `normalize_lighting_editor_state_rebuilds_group_order`

**Validation lanes:**

- All Wave 24 lanes.
- **Windows target-host pass** — engine schema change.

**PR pattern:** Stacked sub-PRs **30a** (engine + F5 group reorder + I4 color tags) → **30b** (frontend polish: X1 hover, F10 CTAs, P5 mini-graph).

**Branches:** `claude/wave-30a-rail-engine`, `claude/wave-30b-rail-polish`.

**Caveats / risks:**

- Scene tile real estate trade-off: thumbnail + name + meta + last-recalled + pin + state badge + color bar + (potentially) mini-graph all compete in ~100×60. **Decision required at start of Wave 30b**: ship P5 mini-graph as alternative-to thumbnail (tile gets cleaner), or skip P5 to Wave 32+ if real estate is tight.
- Group order migration: `normalize_lighting_editor_state` must populate `group_order` from insertion order on first load (mirror `scene_order` Wave 23.B/C migration).
- Hover preview 300 ms delay must not conflict with click-to-recall — clear timer on click.
- F10 EmptyState `action` prop is a primitive contract change; touches every workspace's EmptyState consumers — add a `hasAction` story so Storybook regression-checks.

**Definition of done:**

- All five findings closed per spec.
- Group reorder works identically to scene reorder.
- Color tags persist across reload.
- Hover preview triggers after 300 ms; cancels on mouseout/click.
- Empty states surface CTAs.
- (If shipping) P5 mini-graph renders cleanly without breaking thumbnail layout.
- Mac + Windows validation pass.

---

## Wave 31 — Cross-cutting refinements

**Closes findings:**

- **I7** (T3) — saved view bookmarks for stage plot pan/zoom. [audit.md](lighting-d-industry-audit.md#i7-saved-view-bookmarks-for-stage-plot-panzoom-capture-views-scoped)
- **I9** (T3) — selection chip strip. [audit.md](lighting-d-industry-audit.md#i9-always-visible-selection-bar-chip-strip-figma-multi-edit--grandma3-channel-sheet)
- **P4** (T3) — persistent compact DMX strip in bottom bar. [audit.md](lighting-d-industry-audit.md#p4-persistent-compact-dmx-strip-in-the-bottom-bar-daw-meter-bridge-idiom)

**Depends on:** None.

**Engine touches:** No.

**New design-system primitives:**

- `<ChipStrip>` — generic horizontal scrollable chip list (potentially reusable across workspaces).

**Frontend files touched:**

- [useStagePlotViewport.ts](frontend/app/src/app/lighting/useStagePlotViewport.ts) — add `viewBookmarks: { 1, 2, 3 }` persisted to localStorage; `saveViewBookmark(slot)` / `recallViewBookmark(slot)`.
- [StagePlotControls.tsx](frontend/app/src/app/lighting/components/StagePlotControls.tsx) — View dropdown (3 numbered slots).
- New `<SelectionChipStrip>` component mounted in [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) above the health bar, conditional on `selectedFixtureIds.size > 0`.
- New `<DMXCompactStrip>` mounted in [LightingHealthBar.tsx](frontend/app/src/app/lighting/components/LightingHealthBar.tsx) (or above it); read from `lightingDmxMonitorSnapshot`; use `requestAnimationFrame` batching for 30 Hz updates.

**New IPCs:** None.

**Validation lanes:** Same as Wave 24 + perf check on DMX strip at 30+ fixtures × 4 channels.

**PR pattern:** Single PR or 31a/31b split if visual review surfaces issues with the DMX strip render budget.

**Branch:** `claude/wave-31-cross-cutting-refinements`.

**Caveats / risks:**

- View-bookmark keyboard shortcut: `Shift+1/2/3` collides with current `1-9` quick recall semantically. **Decision required at start of wave**: use `[`/`]`/`\` instead, or accept the asymmetry, or use a chord (`G 1` / `G 2` / `G 3`).
- DMX strip render budget: 120 cells × 30 Hz × per-cell DOM updates would tank the workspace. Use a single `<canvas>` and a single rAF loop, not per-cell React state.
- Selection chip strip: must NOT duplicate state with the bulk inspector — read from the same `selectedFixtureIds` set.

**Definition of done:**

- All three findings closed per spec.
- Frame rate stays >= 60 fps during a 30-fixture animated scene with DMX strip on.
- Mac validation passes.

---

## Wave 32 — Manual cross-fade on recall

**Closes findings:**

- **P2** (T3) — manual fade time on recall. [audit.md](lighting-d-industry-audit.md#p2-manual-fade-time-on-recall-eos-sneak--time)

**Depends on:** None.

**Engine touches:** **YES.** Cross-fade interpolator: per-channel sample loop running on the engine output thread, interpolating between current state and target state over `fade_ms`. Tunable-white pair correlation: intensity + CCT must interpolate together so midpoints don't pass through off-axis colors. Cancel semantics: a second recall mid-fade snaps to current sample as new origin and starts a new fade. New optional param on `lighting.scene.recall { sceneId, fadeMs }`.

**New IPCs:**

- `lighting.scene.recall` gains optional `fadeMs?: number` parameter (defaults to 0 = snap, current behavior).

**New design-system primitives:** None.

**Frontend files touched:**

- [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx) — fade-time chip (default 0 s); click opens numeric scrubber (or use Wave 27's `<ScrubLabel>`).
- [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — `handleRecallScene` reads fade-time chip state; `T` keyboard binding while hovering a scene tile.
- [SceneTile.tsx](frontend/app/src/app/lighting/components/SceneTile.tsx) — mid-fade progress bar (data attribute driven from snapshot).
- Engine-client: add `fadeMs?` param.

**New native tests required:**

- `recall_with_fade_interpolates_intensity`
- `recall_with_fade_correlates_cct_pair`
- `recall_mid_fade_cancels_and_restarts_from_sample`
- `recall_fade_zero_is_snap_behavior`

**Validation lanes:**

- All Wave 24 lanes.
- **Windows target-host pass** — engine output-thread change.

**PR pattern:** Single PR (atomic engine + frontend).

**Branch:** `claude/wave-32-cross-fade`.

**Caveats / risks:**

- Tunable-white interpolation must NOT lerp intensity and CCT independently — that introduces ugly midpoints. Recommended: lerp `(on*intensity, cct)` as a paired vector, fade `on` separately on rising edge only.
- Mid-fade IPC contention: a `lighting.fixture.update` during a fade should override the fade for that fixture (live edit beats interpolation).
- Default `fadeMs = 0` keeps existing behavior. No migration concerns.

**Definition of done:**

- P2 closed per spec.
- Engine tests grow by 4; all green.
- Visible mid-fade progress on the recalled tile.
- Mac + Windows validation pass.

---

## Wave 33 — Blind / Preview-edit mode (architectural)

**Closes findings:**

- **P1** (T2) — blind / preview-edit mode. [audit.md](lighting-d-industry-audit.md#p1-blind--preview-edit-mode-eos-blind-grandma3-blind)

**Depends on:** None functionally; benefits from Wave 28 command palette being shipped first so "Toggle preview mode" is one of the registered commands.

**Engine touches:** **YES, architectural.** New parallel `preview_state: HashMap<FixtureId, FixtureState>` alongside the live state on `LightingEditorState`. New IPC `lighting.editor.previewMode { enabled }` toggles the editor mode — when active, `lighting.fixture.update` writes to `preview_state` not live state; `lighting.scene.update { captureCurrentState: true }` reads from `preview_state`; `lighting.scene.recall` swaps `preview_state` to the recalled scene's saved state without affecting live output.

**Storage compatibility:** `preview_state` is transient runtime, not persisted. No `STORAGE_SCHEMA_VERSION` bump needed.

**This wave needs its own design + plan doc before code.** Open `docs/redesign/lighting-d-wave-33-blind-mode.md` and answer:

1. How does multi-fixture multi-select interact with preview mode? (Likely: same.)
2. What happens if the operator recalls a scene during preview mode? (Likely: swaps preview buffer, doesn't touch output.)
3. What happens to drift detection? (Likely: drift-vs-preview-buffer instead of drift-vs-output.)
4. What does the Save flow look like? (Likely: Save commits `preview_state` into the active scene's saved state; exits preview mode.)
5. Does the bridge banner change in preview mode? (Likely: no — bridge can be reachable but rig isn't being driven.)
6. Patch mode interaction? (Likely: preview mode unavailable during patch mode; toggles disabled.)
7. Inspector visual treatment? (Banner: "Editing offline · Save to commit". Slider chrome: subtle red tone? Or just the banner?)
8. Stage plot visual treatment? (Markers ghost to ~50 % opacity; light pools dim.)

**New IPCs:**

- `lighting.editor.previewMode { enabled: boolean }`
- `lighting.fixture.update` gains an implicit "writes to preview if preview mode active" semantic.

**New design-system primitives:**

- `<PreviewBanner>` — sustained banner (different from one-shot StatusBand) communicating preview mode + Save action.

**Frontend files touched:**

- [LightingToolbar.tsx](frontend/app/src/app/lighting/components/LightingToolbar.tsx) — Preview toggle button.
- [StagePlot.tsx](frontend/app/src/app/lighting/components/StagePlot.tsx) — ghosted styling when preview active.
- [LightingInspector.tsx](frontend/app/src/app/lighting/components/LightingInspector.tsx), Inspector\* panes — preview banner and value-source toggle.
- [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — drift detection logic shifts to preview-buffer when active.

**New native tests required:** TBD per design doc — minimum 8–10 covering buffer separation, recall behavior, save commit, mode toggle, patch-mode interaction.

**Validation lanes:**

- All Wave 24 lanes.
- **Windows target-host pass.**
- **Soak time before merge**: at least 2 sessions of `tauri:dev` use across both personas before merging.

**PR pattern:** Single PR after the design doc is approved by the user.

**Branch:** `claude/wave-33-blind-mode`.

**Caveats / risks:**

- Highest-complexity wave in this plan. Allow 2–3 sessions of design + 2–3 sessions of implementation.
- The dual-state architecture is ergonomically risky — operators must NEVER be unsure whether they're editing live or offline. Visual treatment must be unmistakable.
- Recovery path: a regression here is high-impact (lost edits). Land the `lighting.editor.previewMode` IPC + engine plumbing as a separate PR sub-step (33a) before any UI ships (33b), with a feature flag default-off.

**Definition of done:**

- P1 closed per spec.
- Design doc reviewed + approved by user before code work begins.
- Native tests cover all buffer separation invariants.
- Mac + Windows validation pass.
- Two soak sessions on `tauri:dev` clean.

---

## Wave 34 — Per-attribute palette pools (architectural)

**Closes findings:**

- **P3** (T2) — per-attribute palette pools (CCT + intensity presets). [audit.md](lighting-d-industry-audit.md#p3-per-attribute-palette-pools--cct-and-intensity-presets-hog-4-palettes--grandma3-preset-pools)

**Depends on:** None functionally. Wave 27's slider primitives are nice-to-have for the palette-edit dialogs.

**Engine touches:** **YES, architectural.** New top-level concept. `LightingPalette { id, name, kind: "intensity" | "cct", value: f64, color_index: Option<u8> }`. New `palettes: Vec<LightingPalette>` field on `LightingEditorState`. Persisted. New IPCs: `lighting.palette.list`, `lighting.palette.create`, `lighting.palette.update`, `lighting.palette.delete`, `lighting.palette.apply { paletteId, fixtureIds }`. Storage `STORAGE_SCHEMA_VERSION` bumps from current value (5) to 6 with migration that seeds default palettes (4 intensity, 4 CCT).

**This wave needs its own design + plan doc before code.** Open `docs/redesign/lighting-d-wave-34-palettes.md` and answer:

1. Default palette set on first migration (Warm 2700, Studio 4000, Daylight 5600, Cool 6500 + 10/25/50/100 % intensity)?
2. Edit-palette UX: inline (right-click → Edit) or modal? Probably inline + modal-rename.
3. Reorder + delete + create UX in the palette pool view.
4. Apply-on-click behavior: applies to current selection only? Or auto-saves to active scene? Probably selection-only, no auto-save.
5. ⌘⇧P quick popover layout — full pool or favorites-first?
6. Color tags on palettes too (small)?
7. Conflict with bulk inspector slider: applying a palette is the same as setting a value on the selection.

**New IPCs:** 5 new (list/create/update/delete/apply).

**New design-system primitives:**

- `<PaletteTile>` — small tile rendering palette name + value swatch.
- `<PalettePool>` — grid of PaletteTiles with reorder / create / edit affordances.

**Frontend files touched:**

- New `frontend/app/src/app/lighting/components/InspectorPalettes.tsx` pane.
- [LightingInspectorTabs.tsx](frontend/app/src/app/lighting/components/LightingInspectorTabs.tsx) — add Palettes tab.
- [LightingWorkspace.tsx](frontend/app/src/app/lighting/LightingWorkspace.tsx) — palette handlers + ⌘⇧P quick popover.

**New native tests required:** TBD per design doc — minimum 12 covering CRUD, persistence, migration, apply-to-selection, conflict semantics.

**Validation lanes:**

- All Wave 24 lanes.
- **Windows target-host pass** — schema bump.

**PR pattern:** Single PR after the design doc is approved by the user.

**Branch:** `claude/wave-34-palettes`.

**Caveats / risks:**

- Architectural. Allow 2 sessions of design + 3–4 sessions of implementation.
- Schema bump from 5 → 6 requires a migration; must seed defaults so existing users see populated palettes on first launch.
- Don't repeat the cue-cleanup mistake — palettes are a NEW concept, not a renamed cue model. Keep separation strict.

**Definition of done:**

- P3 closed per spec.
- Design doc reviewed + approved by user.
- Schema migration tested (5 → 6) with seed data preservation.
- Mac + Windows validation pass.

---

## Item-to-wave mapping

Quick lookup for "which wave closes finding X":

| ID  | Title                                         | Wave | Tier |
| --- | --------------------------------------------- | ---- | ---- |
| F1  | Inline rename                                 | 24   | 1    |
| F2  | Marquee selection on plot                     | 26   | 1    |
| F3  | Toast bottom-right + inline Undo              | 24   | 1    |
| F4  | Live position overlay during drag             | 26   | 1    |
| F5  | Drag-reorder for groups                       | 30   | 2    |
| F6  | ⌘K command palette                            | 28   | 1    |
| F7  | Fine-adjust on sliders                        | 27   | 1    |
| F8  | Right-click context menus                     | 25   | 1    |
| F9  | Smart guides during fixture reposition        | 26   | 2    |
| F10 | Empty-state CTA buttons                       | 30   | 2    |
| F11 | Patch-mode persistent on-screen exit          | 25   | 3    |
| F12 | Identify "find" mode (sequential)             | 29   | 3    |
| I1  | Glanceable intensity bar on markers           | 26   | 1    |
| I2  | Highlight / Solo modes                        | 29   | 1    |
| I3  | Searchable shortcuts overlay (`?`)            | 28   | 1    |
| I4  | Color tags for scenes / groups                | 30   | 2    |
| I5  | Mixed indicator + delta entry on bulk sliders | 27   | 2    |
| I6  | Recent scenes at top of search/palette        | 28   | 2    |
| I7  | Saved view bookmarks for plot                 | 31   | 3    |
| I8  | Group inspector remove-from-group affordance  | 24   | 3    |
| I9  | Selection chip strip                          | 31   | 3    |
| I10 | Scrub-on-numeric-label                        | 27   | 2    |
| X1  | Hover preview on scene tiles                  | 30   | 2    |
| P1  | Blind / preview-edit mode                     | 33   | 2    |
| P2  | Manual fade time on recall                    | 32   | 3    |
| P3  | Per-attribute palette pools                   | 34   | 2    |
| P4  | Persistent compact DMX strip                  | 31   | 3    |
| P5  | Aggregate scene-shape mini-graph on tile      | 30   | 3    |

---

## Validation tooling cheat-sheet

(Copy-paste reference for any wave.)

**Mac-side (every wave):**

```
npm run format:check          # prettier; format:fix to auto-fix
npm run dev:check             # typecheck + lint + tests; native floor 118+6=124
npm run native:engine:build   # engine build only (chained into native:acceptance)
npm run native:acceptance     # runtime harness; auto-builds engine via PR #34's chain
npm run tauri:dev             # interactive review on BetterDisplay 2560×1440
npm run tauri:visual:review   # Playwright screenshots (10 frames; target 0 failures)
```

**Mac-side (only when explicitly requested):**

```
npm run tauri:workspaces:qualify   # full workspace qualification
```

**Windows target-host (engine-touching waves only, separate Windows-Claude session against origin/main):**

```
npm ci                       # if dependencies changed
npm run dev:check
npm run native:acceptance
npm run tauri:smoke:win
```

---

## Architectural waves (33, 34) — design-doc requirement

Waves 33 and 34 each warrant their own design + plan doc before code work. Save them as:

- `docs/redesign/lighting-d-wave-33-blind-mode.md`
- `docs/redesign/lighting-d-wave-34-palettes.md`

Each design doc must include:

1. UX flow + visual states (with prototype-in-HTML mockups if helpful).
2. Engine state + IPC additions.
3. Persistence + migration plan.
4. Decision log (alternatives considered + rejected).
5. Sub-PR plan (33a engine plumbing → 33b UI; 34a engine + migration → 34b UI).
6. Test plan.
7. Soak protocol.

Get user approval on each design doc before opening Wave-N PR.

---

## Out of scope — explicitly not adopting

These patterns are common in lighting consoles but don't fit the recall-driven dual-persona product model. Calibration only; do NOT add them as findings later.

- **N1.** Keypad command-line syntax (Eos / GrandMA3 / Hog 4) — F6 ⌘K palette covers discoverability without the syntax.
- **N2.** Encoder-wheel attribute paradigm — fixtures have 2 meaningful attributes; sliders are right.
- **N3.** World / filter system — 40-fixture studio doesn't have a programming-scope problem.
- **N4.** Cue stack / sequence player — recording sessions are non-linear; cue model removed in PR #32.
- **N5.** Effect engine — studio recording is intentionally undynamic.

Full rationale in [lighting-d-premium-target.md](lighting-d-premium-target.md#out-of-scope--explicitly-not-adopting).

---

## Source documents

- [lighting-d-premium-target.md](lighting-d-premium-target.md) — the 28-item ranked target list.
- [lighting-direction-d-followups.md](lighting-direction-d-followups.md) — F1–F12 spec detail.
- [lighting-d-industry-audit.md](lighting-d-industry-audit.md) — I1–I10 + P1–P5 spec detail with citations.
- [lighting-direction-d-implementation-plan.md](lighting-direction-d-implementation-plan.md) — original Direction D plan (Waves 1–4).
- [lighting-direction-d-polish-plan.md](lighting-direction-d-polish-plan.md), [lighting-direction-d-audit-fix-plan.md](lighting-direction-d-audit-fix-plan.md), [lighting-direction-d-polish-waves-19-22-plan.md](lighting-direction-d-polish-waves-19-22-plan.md) — wave plans for already-shipped polish (Waves 5–23).

---

## Appendix: prior-wave operational lessons

(Distilled from the auto-memory entry covering Waves 1–23. Apply to Waves 24+.)

- **PR-merge cleanup gotcha**: GitHub auto-closes any PR whose base branch is deleted at merge time, with no API recovery. When stacking, never delete a base branch while a child PR still targets it. Order: merge → retarget child → delete base when chain advances past it.
- **Stacking mid-merge retarget**: the 2026-04-29 run confirmed `gh pr edit <next> --base main` is the safe explicit path between merges. Auto-retarget only fires on source-branch deletion, not on merge alone.
- **Edit tool oddity on small files**: Wave 13 hit a case where `Edit` to `Button.tsx` silently no-op'd despite a success message; needed a `Write` to actually land. Watch for similar oddities on small files; verify with `git diff` before claiming progress.
- **Scene-thumb render-loop pitfall** (Wave 14 follow-up `e9bcadc`): orchestrator effects that trigger `store.set*` IPCs and depend on the snapshot can spin if the transport doesn't echo the write back. Lesson: do read-modify-write in a `useMemo` with write-backs only on user actions, OR track attempted ids in a ref.
- **Body-squish layout fix** (`1211765`): conditional banners + flex layout work; rigid CSS grid templates with fixed row counts break when conditional children appear. Use `display: flex; flex-direction: column` with `flex: 1 1 auto` on the body.
- **Phantom CSS vars**: many existing primitives reference vars the build doesn't emit. Don't introduce new phantom-var references; use only emitted tokens. Cleanup pass deferred.
- **First-launch / recall-bridge-unreachable handling**: the `previewSceneId` mechanic in [LightingWorkspace.tsx:155](frontend/app/src/app/lighting/LightingWorkspace.tsx:155) must remain — it's the hard-won fix for the inspector showing "No scene" when recall fails in dev / pre-probe states. Don't refactor without preserving this contract.
- **Drift detection in degraded states**: when bridge unreachable + scene drifted, `isSceneModified` compares live state to previewed scene, and the "Modified" pill flickers. Wave 16 addressed this at the UI level by showing "Preview" instead of "Modified" with neutral border. Preserve that downgrade behavior.
