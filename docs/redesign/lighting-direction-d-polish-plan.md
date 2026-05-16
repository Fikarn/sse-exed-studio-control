# Lighting Direction D — Post-ship polish plan (Waves 5–15)

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

Scope: 21 UX/functional gaps identified after Direction D shipped to `origin/main` at `a392abc`. Plan was authored 2026-04-28 against polish branch `fix/lighting-d-wave-1-polish` (tip `39260b3`, 8 prior commits). Each wave is one focused commit. Validation: `npm run typecheck` + `npm run dev:check` after every wave; `cargo test -p sse-exed-rust-engine lighting::` after Wave 6 (engine touched); full §3.8 validation lanes after all waves land.

## Locked decisions

- **Nav guard scope:** Lighting-only hook first; lift to OperatorShell later if Audio/Setup adopt.
- **Undo scope:** Structural ops only (scene + fixture create/delete). Slider commits are NOT undoable.
- **Repositioning snap:** 0.5 m grid by default; hold Alt to free-position.
- **DMX monitor shortcut:** `⌘⇧M` (`⌘M` is reserved by macOS/Tauri for window-minimize).
- **Identify burst design:** Snapshot overlay (no continuous DMX broadcast loop in engine). Burst entries on `LightingState`; lazy expiration on next snapshot read.
- **Undo of fixture create when scene-referenced:** Refused with toast; stack entry dropped.

## Wave order (locked)

| #   | Wave                                               | Items closed   | Size     |
| --- | -------------------------------------------------- | -------------- | -------- |
| 5   | Search filter + Grand Master IPC + dead rail stubs | P0 #1 #2 #4    | ~150 LOC |
| 6   | Identify burst (engine IPC + snapshot overlay)     | P0 #3          | ~250 LOC |
| 7   | Confirm modals + delete fixture + nav guard        | P1 #5 #6 #8    | ~280 LOC |
| 8   | Undo/redo (structural)                             | P1 #7          | ~200 LOC |
| 9   | Fixture repositioning + position fields            | P2 #11         | ~350 LOC |
| 10  | Bulk fixture select                                | P2 #12         | ~250 LOC |
| 11  | Patch auto-advance + group drift arrow             | P2 #9 #10      | ~80 LOC  |
| 12  | Health bar (version + session + local time)        | P3 #14 #15 #16 | ~50 LOC  |
| 13  | CCT gradient + button spinners                     | P3 #17 #18     | ~120 LOC |
| 14  | Bridge banner + empty state + Tooltip + applied    | P3 #19 #20 #21 | ~280 LOC |
| 15  | DMX monitor modal (⌘⇧M)                            | P2 #13         | ~180 LOC |

Total: ~2,190 LOC across ~32 files, 11 commits. Engine touched in Wave 6 only — additive, no schema bump.

## 21 items closed (review numbering)

P0 — wired controls dead today:

1. Toolbar search filters nothing.
2. Grand master slider is local state only.
3. Identify burst is fake (no engine IPC).
4. Rail "Reorder" / "Manage" are inert `<span>` stubs.

P1 — destructive op safeguards + recovery: 5. No confirm before scene delete. 6. No delete-fixture UI; when added, no confirm. 7. No undo/redo. 8. No "unsaved changes" prompt on workspace switch.

P2 — missing prototype-implied features: 9. Patch Apply doesn't auto-advance to next unpaired fixture. 10. Group chip drift arrow direction missing (shows dot only). 11. Fixtures can't be repositioned (no drag, no arrow nudge, no editable position fields). 12. No bulk fixture select (shift-click + bulk inspector). 13. ⌘⇧M opens "full DMX monitor" modal — doesn't exist.

P3 — polish, copy, time-zone: 14. App version hardcoded `v2.2.2`. 15. Session timer resets on reload. 16. Last-saved time displayed in UTC. 17. CCT slider has no min/max bounds visual or colour gradient. 18. Busy state shown only via toast; no inline button spinner. 19. Bridge-unreachable banner missing. 20. Empty state for "0 fixtures" shows nothing welcoming. 21. No tooltips on drift dot, status pill abbreviations, etc.

## Per-wave details

### Wave 5 — Search filter + Grand Master IPC + dead stubs (P0 #1 #2 #4)

Frontend changes:

- `frontend/packages/engine-client/src/types.ts:36-39` — extend `LightingSettingsUpdateRequest` with `grandMaster?: number`. Engine already accepts this via `parse.rs:275-276`; only the type lies.
- `frontend/app/src/app/lighting/LightingWorkspace.tsx` — replace local `grandMaster` state with derived value from `lightingSnapshot.grandMaster` (fallback 100). `handleGrandMasterChange` debounces 200 ms then awaits `store.updateLightingSettings({ grandMaster })`.
- Same file — promote `searchQuery` from passive state to a real filter; pass to `LightingRail` and `StagePlot`.
- `LightingRail.tsx` — pass `searchQuery` to `SceneRail` + `GroupRail`. Delete the two dead `<span>` stubs (lines 135-141).
- `SceneRail.tsx`, `GroupRail.tsx` — accept `searchQuery`, filter rendered entries by case-insensitive substring on name. Empty filter renders all.
- `StagePlot.tsx` — pass `searchQuery` to `FixtureMarker` map; markers not matching get `dimmed=true`.
- `FixtureMarker.tsx` — accept `dimmed?: boolean`; render at opacity 0.4 + label fill darkened.

Validation: typecheck + dev:check. Manual: drag grand master → observe scaling on plot. Search "two" → only matching scenes/markers visible.

Commit: `fix(lighting): wave 5 — search filter + grand master IPC + dead rail stubs`

### Wave 6 — Identify burst (P0 #3)

Engine changes:

- `native/rust-engine/src/lighting/mod.rs` — register `lighting.fixture.identify` IPC. Payload `{ fixtureId: string, durationMs?: number }`; default 1200, max 5000.
- `native/rust-engine/src/lighting/identify.rs` (NEW) — `IdentifyBurst { started_at: Instant, duration_ms: u64 }` stored in `HashMap<FixtureId, IdentifyBurst>` on `LightingState`. Handler validates fixture exists (404 otherwise), inserts entry. Concurrent burst on same fixture replaces.
- `native/rust-engine/src/lighting/snapshot.rs` — `read_lighting_snapshot` and `read_lighting_dmx_monitor_snapshot` consult the burst map. For active bursts, fixture's `intensity=100`, `on=true`, `cct=fixture.max_cool_kelvin` are reported instead of stored values. Stored values untouched. Expired entries pruned lazily.
- `native/rust-engine/src/lighting/tests.rs` — three new unit tests: snapshot reports overlay during active burst; reports stored values after expiration; rejects unknown fixtureId.

Frontend changes:

- `frontend/packages/engine-client/src/types.ts` — add `identifyLightingFixture(fixtureId: string, durationMs?: number)` to `ShellStore`.
- `frontend/packages/engine-client/src/createShellStore.ts` — wire to new IPC.
- `LightingWorkspace.tsx:438 handleIdentifyBurst` — replace fake feedback with `await store.identifyLightingFixture(fixtureId)`.

Validation: cargo tests + typecheck + dev:check. Manual: select fixture → press Identify → DMX peek channel snaps to 255 then back.

Commit: `feat(lighting): real identify burst — engine IPC + snapshot overlay`

### Wave 7 — Confirm modals + delete fixture + nav guard (P1 #5 #6 #8)

New design-system primitive:

- `frontend/packages/design-system/src/components/ConfirmDialog.tsx` (NEW) — wraps Dialog; props `{ title, body, confirmLabel, cancelLabel?, danger?, onConfirm, onCancel }`. Stories file follows existing primitive pattern.

Frontend changes:

- `InspectorScene.tsx:231-241` — Delete button opens local `confirmingDelete` state; ConfirmDialog renders when truthy.
- `InspectorFixture.tsx` — add Delete button at bottom (danger variant) + ConfirmDialog. New `onDeleteFixture` prop.
- `LightingWorkspace.tsx` — `handleDeleteFixture` calls `store.deleteLightingFixture(fixtureId)`. Engine handler exists at `app.rs:227`.
- `engine-client/src/types.ts` + `createShellStore.ts` — add `deleteLightingFixture`.
- `frontend/app/src/app/lighting/useUnsavedScenePrompt.ts` (NEW) — hook listening to `beforeunload` + intercepting workspace switch. Wraps OperatorShell's `setWorkspace` calls (lines 116, 124, 159, 380) when `isDirty=true`. Lighting-local; lift later if needed.
- `LightingWorkspace.tsx` — wire `useUnsavedScenePrompt({ isDirty: isSceneModified })`.

Commit: `fix(lighting): wave 7 — confirm modals + delete fixture + nav guard`

### Wave 8 — Undo/redo for structural ops (P1 #7)

Frontend infrastructure:

- `frontend/app/src/app/lighting/useUndoStack.ts` (NEW) — `undoStack`, `redoStack` (cap 25 each, LRU). Entry shape `{ id, label, undo: () => Promise<void>, redo: () => Promise<void> }`. `push(entry)` clears redo. Cmd+Z / Cmd+Shift+Z gated by `!isEditableTarget`.

Wired into:

- `handleSaveScene` — push undo as deleteScene + remove thumb; redo recreates.
- `handleDeleteScene` — push undo as createScene + restore thumb + recall (snapshot taken pre-delete); redo deletes again.
- `handleAddFixture` — push undo as deleteFixture; redo recreates.
- `handleDeleteFixture` — push undo as createFixture + updateFixture(positions); redo deletes again.

Edge case: undoing fixture create when scene-referenced is refused with feedback toast `"Cannot undo: fixture is referenced by N scenes"`.

Toast on undo/redo: `"Undid 'Delete scene Talking head' · ⌘⇧Z to redo"`.

Commit: `feat(lighting): undo/redo stack for structural ops (⌘Z / ⌘⇧Z)`

### Wave 9 — Fixture repositioning + position fields (P2 #11)

Frontend:

- `frontend/app/src/app/lighting/useFixtureDrag.ts` (NEW) — pointer-based drag for FixtureMarker. Uses SVG CTM for client→viewBox conversion. Snaps to 0.5 m by default; Alt for free-positioning. Commits `spatialX/spatialY` via existing `updateLightingFixture` IPC on pointerup.
- `FixtureMarker.tsx` — accept `onPositionCommit`. While dragging, render ghost at drag position + dashed shadow at original. Render dragged marker last in the SVG `<g>` so it paints above siblings.
- `StagePlot.tsx` — split fixture map: non-dragged first, dragged separately last. Keyboard nudge: arrow keys ±0.1 m on selected fixture; Shift+arrow ±0.5 m. Same IPC.
- `InspectorFixture.tsx` — ADD Stage X / Stage Y / Rig height / Beam angle fields (none exist today). Same draft+commit pattern as intensity/CCT.

Commit: `feat(lighting): fixture repositioning — drag + arrow nudge + editable position fields`

### Wave 10 — Bulk fixture select (P2 #12)

Frontend:

- `LightingWorkspace.tsx` — promote selection to `Set<string>`. Helpers `toggleFixture`, `clearSelection`, `selectOnly`. `persistedSelectedFixtureId` continues tracking primary only; multi-select is ephemeral.
- `FixtureMarker.tsx` — `onSelect(id, { additive: boolean })`. Shift+click sets additive.
- `StagePlot.tsx` — wire shift-click. Marquee select (drag-rect) is OUT OF SCOPE.
- `InspectorFixture.tsx` — when `selectedFixtureIds.size > 1`, render bulk mode: title `{N} fixtures selected`, sliders commit to all via `Promise.all`.
- Tab derivation: bulk select forces `fixture` tab.

Commit: `feat(lighting): bulk fixture select + bulk inspector`

### Wave 11 — Patch auto-advance + group drift arrow (P2 #9 #10)

Frontend:

- `InspectorPatch.tsx` — after Apply success, find next fixture with `dmxStartAddress < 1` and select it. If none remain, exit patch mode + toast `"All fixtures patched."`
- `GroupChip.tsx` — accept `levelDelta?: number`. Render `▲` / `▼` glyph + signed delta when `Math.abs(delta) >= 1`.
- `LightingWorkspace.tsx:159 railGroupEntries` — compute `levelDelta = currentAvgIntensity - sceneAvgIntensityForThisGroup`.

Commit: `fix(lighting): patch auto-advance + group chip drift direction`

### Wave 12 — Health bar accuracy (P3 #14 #15 #16)

Build + frontend:

- `frontend/app/vite.config.ts` — add `define: { __APP_VERSION__: JSON.stringify(pkg.version) }`. Type declaration in a global types file.
- `LightingHealthBar.tsx:8` — `APP_VERSION = \`v${**APP_VERSION**}\``.
- Same file:10 — replace module-load `SESSION_STARTED_AT` with localStorage `app.session.startedAt`. Logic: read; if absent OR `now - stored > 24h`, write `now` and use it; else keep stored.
- `LightingWorkspace.tsx:475-478 lastSavedLabel` — `toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })`. Drop "UTC" suffix.

Commit: `fix(lighting): health bar — version from package, session-persists, local time`

### Wave 13 — CCT gradient + button spinners (P3 #17 #18)

Frontend:

- `InspectorFixture.tsx` — wrap CCT slider in custom track with linear gradient (warm `#f0dfb8` → mid `#ebe5d2` → cool `#d4dde2`). Show min/max K labels under track.
- `Button.tsx` — add `loading?: boolean` prop. When true, render small CSS-keyframe spinner in `leadingVisual` slot, set `aria-busy=true`, disable interaction, keep label.
- `InspectorScene.tsx`, `InspectorPatch.tsx`, `MasterCard.tsx`, `IdentifyBurstButton.tsx`, `LightingRail.tsx` — replace `disabled={busy}` patterns with `loading={busy}`.

Commit: `fix(lighting): wave 13 — CCT gradient + inline button spinners`

### Wave 14 — Bridge banner + empty state + Tooltip primitive (P3 #19 #20 #21)

New design-system primitive:

- `frontend/packages/design-system/src/components/Tooltip.tsx` (NEW) — `{ children, content, placement?, delay? }`. Hover/focus reveal; CSS-based positioning. Story + ARIA `aria-describedby`.

Frontend:

- `frontend/app/src/app/lighting/components/LightingBridgeBanner.tsx` (NEW) — `<StatusBand>` (existing) red-tinted when `lightingSnapshot.reachable === false`. Copy: `"DMX bridge unreachable at {ip}. Lighting commands won't reach fixtures."`
- `LightingWorkspace.tsx` — render banner above `.body` (between toolbar and body grid).
- `StagePlot.tsx` — when `fixtures.length === 0`, render `<EmptyState title="No fixtures yet" message="Click + Fixture in the toolbar to add your first fixture." />` centred over the plot. Grid + floor still render as backdrop.
- Apply Tooltip to: toolbar stat chip abbreviations, GroupChip drift dot, HealthBar items, StagePlotControls buttons.

Commit: `fix(lighting): wave 14 — bridge banner + empty state + tooltips`

### Wave 15 — Full DMX monitor modal (P2 #13)

Frontend:

- `frontend/app/src/app/lighting/components/DMXMonitorDialog.tsx` (NEW) — Dialog primitive. 16-col × 32-row 512-channel grid. Each cell: hex value + 4 px bar. Cells assigned to a known fixture get blue tint; Tooltip on hover shows fixture name.
- `LightingWorkspace.tsx:451 keydown handler` — Cmd+Shift+M / Ctrl+Shift+M opens modal. State `dmxMonitorOpen`. Escape closes (Dialog handles).
- `LightingHealthBar.tsx` hint copy: `"⌘ ⇧ M / full DMX monitor"`.

Commit: `feat(lighting): full DMX monitor modal (⌘⇧M)`

## Out of scope

- Marquee (drag-rect) selection on the stage plot — flagged in Wave 10, deferred.
- Lifting `useUnsavedScenePrompt` to OperatorShell for cross-workspace use — deferred per default.
- Including slider commits in undo stack — deferred per default.
- Tokenising the CCT gradient hex values.
- Documentation updates (HANDOFF.md, lighting.md) — polish branch hasn't touched docs.

## Post-wave

After all 11 waves land:

1. Re-run full §3.8 lanes: `tauri:visual:review` + `tauri:workspaces:qualify` + `native:acceptance`.
2. Auto-revert generated artefacts before the lane runs (especially `tauri/gen/schemas` after Wave 6).
3. Push + PR is a separate conversation requiring per-invocation explicit go-ahead.
