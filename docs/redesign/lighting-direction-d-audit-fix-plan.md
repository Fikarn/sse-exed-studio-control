# Lighting Direction D — audit fix plan (Waves 16–18)

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

Self-contained reference for the 43-item UI/UX/front-end audit raised against
`fix/lighting-d-wave-1-polish` after Waves 5–15 landed. The audit was made
against the live source (no prototype reference) thinking like the end-user.
Items are addressed across three coherent commits; the codebase is shippable
at every step.

Branch: `fix/lighting-d-wave-1-polish` past `cd6b324`. Engine touched
additively in Wave 17 only — no schema bump, no migration, no new IPC names.
All three commits stay inside the standing rules (auto-revert generated
artefacts, additive engine work only, dev:check at the end).

## Verified facts before planning

The Rust engine already supports more than the TS engine-client exposes.
This significantly narrows the work — most of the "engine doesn't support X"
worries from the audit are TS-side only.

- `LightingFixtureUpdateRequest` (in `native/rust-engine/src/lighting/types.rs:394`)
  accepts `name`, `type`, `dmxStartAddress`, `effect`, `on`, `intensity`,
  `cct`, `groupId`, `spatialX/Y`, `spatialRotation`, `rigZ`,
  `beamAngleDegrees`. The TS interface only exposes a subset.
- `LightingGroupUpdateRequest { groupId, name }` is wired through
  `parse_lighting_group_update_request`. TS has no `updateLightingGroup`.
- `LightingSceneUpdateRequest { sceneId, name?, captureCurrentState? }` is
  wired. TS has no `updateLightingScene`. Existing `handleResaveScene` does
  delete+recreate as a workaround; the IPC's `captureCurrentState: true` is
  the correct path.
- `lighting.scene.update`, `lighting.group.update`, `lighting.fixture.update`
  are all in the generated `protocol.ts`.

Design-system primitives present (memory + grep):

- `Button` (with `loading` prop, wave 13)
- `ConfirmDialog` (wave 7)
- `Tooltip` (wave 14)
- `Dialog`, `EmptyState`, `StatusBand`, `StatusDot`, `IconButton`,
  `InspectorPanel/Section`, `HealthBar`

No rename/text-input dialog primitive exists. A small `RenameDialog` will be
co-located in the lighting tree (single consumer for now); extract to
design-system later if a second consumer appears.

## Approach: 3 commits

| Commit | Wave | Theme                                         | Items                                             |
| ------ | ---- | --------------------------------------------- | ------------------------------------------------- |
| A      | 16   | Cleanup + copy + safety + small visual polish | #7–#13 (most), #16–#18, #20, #24–#28, #34–#43     |
| B      | 17   | Engine-client TS + functional gaps            | #1–#6, #14–#15, #19, #21, #23, #36 (action verbs) |
| C      | 18   | Accessibility sweep                           | #29–#33                                           |

Each commit runs typecheck before it lands. `npm run dev:check` at the end
of Commit C is the verification gate.

---

## Commit A — Wave 16: cleanup + copy + safety

Surface-level fixes only. No new features, no API surface changes.

### File-by-file change matrix

| Item                           | File                                                                          | Change                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #7 kebab dead                  | `LightingToolbar.tsx`                                                         | Wire to toggle a `KeyboardShortcutsPopover` (new co-located file). Kebab keeps `aria-label="Keyboard shortcuts"`, `aria-expanded`, `aria-haspopup="dialog"`.                                                                                                        |
| #8 false F shortcut            | `StagePlot.tsx:223`                                                           | Drop "(or press F)" from the empty-state message.                                                                                                                                                                                                                   |
| #9 universe dot stale          | `LightingHealthBar.tsx:91`                                                    | `dot: reachable ? "ok" : "info"`; suffix becomes "stale" when not reachable.                                                                                                                                                                                        |
| #10 "Auto-save" label          | `LightingHealthBar.tsx:100`                                                   | Rename label to `Scene state`. Values stay `Saved` / `Unsaved changes`.                                                                                                                                                                                             |
| #11 unpatched range            | `InspectorPatch.tsx:122-126`, `lightingPatch.ts:42`                           | Render `Unpatched` literal when `dmxStartAddress < 1`. Add `universe` arg to `lightingFixturePatchSummary` so it stops hardcoding `u1`.                                                                                                                             |
| #12 identify error path        | `IdentifyBurstButton.tsx:36-49`, `InspectorFixture.tsx`, `InspectorPatch.tsx` | Pass `bridgeReachable` through. Disable button when unreachable, with tooltip "Identify needs the DMX bridge — bridge unreachable".                                                                                                                                 |
| #13 orphan utilities           | `lightingPatch.ts:90,173`                                                     | Verify by grep, then delete `formatLightingPatchOverlapStageLabel` and `buildLightingPatchCandidates` if no callers.                                                                                                                                                |
| #16 narrow selection           | `InspectorFixtureBulk.tsx:115-124`                                            | Make per-fixture chips clickable buttons. Shift-click removes from selection; plain click focuses the single fixture.                                                                                                                                               |
| #17 modified pill caveat       | `SceneTile.tsx`, `StagePlot.tsx`                                              | Pass `bridgeReachable` down. When unreachable AND modified, badge text becomes `Preview` and tile/pill border goes neutral.                                                                                                                                         |
| #18 patch toolbar visual       | `LightingToolbar.module.css`                                                  | New `[data-patch-mode="true"]` selector adds a thin yellow top hairline + `· Patch mode` eyebrow chip on the title.                                                                                                                                                 |
| #20 cut-all confirm            | `LightingWorkspace.tsx`, `MasterCard.tsx`                                     | Wrap `handleEmergencyCut` in `ConfirmDialog` (`title="Cut all fixtures?"`, `confirmLabel="Cut all"`, `danger`).                                                                                                                                                     |
| #24 search clear               | `SceneRail.tsx`, `GroupRail.tsx`                                              | "No scenes match …" / "No groups match …" gain a "Clear search" button. New `onClearSearch` prop plumbed from workspace.                                                                                                                                            |
| #25 scene tile timestamp       | `SceneRail.tsx`, `SceneTile.tsx`                                              | Subline becomes `${onCount} on · ${avgCct}K · last ${formatRelativeTime(lastRecalledAt)}` when scene has been recalled. Reuse the formatter from `InspectorScene`.                                                                                                  |
| #26 hide rail Save in patch    | `LightingRail.tsx:86`                                                         | Render `Save` button only when `!patchMode` (parallel to the existing `+ New scene` tile gating).                                                                                                                                                                   |
| #27 "Recall again" copy        | `InspectorScene.tsx:209`                                                      | Rename to `Re-apply scene`.                                                                                                                                                                                                                                         |
| #28 Active vs Modified         | `SceneTile.tsx:43`, `StagePlot.tsx:78-83`, `InspectorScene.tsx:129`           | Settle terminology: `Active` for un-drifted active scene, `Modified` for drifted. Inspector eyebrow: `Active scene` / `Active scene · modified`. Tile badge: `Active` / `Modified`. Plot pill drops the redundant `· Modified` text — the yellow border encodes it. |
| #34 tablist semantics          | `LightingInspector.tsx`, `LightingInspectorTabs.tsx`                          | Tab buttons get `id="lighting-tab-{tab}"`. Each panel becomes `<section role="tabpanel" aria-labelledby="lighting-tab-{tab}">`.                                                                                                                                     |
| #35 shortcut style             | `LightingRail.tsx:88`                                                         | `Save (S)` plain text → `Save <kbd>S</kbd>` (matches Toolbar Patch button).                                                                                                                                                                                         |
| #36 vocab pass (partial)       | `MasterCard.tsx`, master copy                                                 | Master toggle aria-label becomes `Resume lighting` / `Pause lighting`. Eyebrow when not paused: `Master · ${onCount} live` (drops "emitting").                                                                                                                      |
| #37 "rest" copy                | `InspectorScene.tsx:131-134`                                                  | "rest" → "all dark".                                                                                                                                                                                                                                                |
| #38 mixed dot                  | `InspectorGroup.tsx:38`                                                       | `mixed ? "attn" : "info"` → `mixed ? "info" : "info"` (mixed reads as a partial state via the textual suffix, not an alert).                                                                                                                                        |
| #39 bridge banner copy         | `LightingBridgeBanner.tsx:26`                                                 | "Check the network or rerun the setup probe" → "Check the network connection or run the bridge probe in Setup."                                                                                                                                                     |
| #40 sceneTitle ellipsis        | `LightingInspector.module.css:128`                                            | Add `min-width: 0; overflow-wrap: anywhere; text-overflow: ellipsis;`. Parent `display: flex` already allows shrink.                                                                                                                                                |
| #41 position bounds            | `InspectorFixture.tsx:117-130`                                                | Clamp at commit: `spatialX∈[0, roomWidthMeters]`, `spatialY∈[0, roomDepthMeters]`, `rigZ∈[0, 8]`, `beamAngle∈[1, 180]`.                                                                                                                                             |
| #42 beam range hint            | `InspectorFixture.tsx:294`                                                    | helpText below the beam input: `Range 1°–180°. Default for ${fixtureType}: ${defaultBeamAngle}°.`                                                                                                                                                                   |
| #43 InspectorScene 0% collapse | `InspectorScene.tsx:144-150`                                                  | When `stats.onCount === 0`, collapse Avg intensity + CCT mean stats into a single `All dark` placeholder row.                                                                                                                                                       |

### New files

- `frontend/app/src/app/lighting/components/KeyboardShortcutsPopover.tsx` — small Dialog + bullet list of shortcuts (P, S, Esc, ⌘Z, ⌘⇧Z, ⌘⇧M, arrows, Shift+arrows, ⌘S/⌘⇧S added in Commit B).

### Estimated diff size

~600 LOC across ~14 files.

---

## Commit B — Wave 17: engine-client TS extensions + functional gaps

The functional unblocks. Adds TS surface for engine APIs that already exist,
plus the UI to use them.

### B.1 Engine-client TS extensions

`frontend/packages/engine-client/src/types.ts`:

- Extend `LightingFixtureUpdateRequest` with `name?: string`, `type?: string`, `spatialRotation?: number`. (Mirrors what the engine accepts; verified at `native/rust-engine/src/lighting/types.rs:394-409`.)
- Add `LightingSceneUpdateRequest { sceneId: string; name?: string; captureCurrentState?: boolean }`.
- Add `LightingGroupUpdateRequest { groupId: string; name: string }`.
- Add to `ShellStore`:
  - `updateLightingScene(request: LightingSceneUpdateRequest): Promise<JsonValue>`
  - `updateLightingGroup(request: LightingGroupUpdateRequest): Promise<JsonValue>`

`frontend/packages/engine-client/src/store/createShellStore.ts`:

- `updateLightingScene` → `performRequest("lighting.scene.update", request)`
- `updateLightingGroup` → `performRequest("lighting.group.update", request)`

`frontend/packages/engine-client/src/transports/fixtureTransport.ts`:

- Add `case "lighting.scene.update"` and `case "lighting.group.update"` handlers that mutate the in-memory fixture state, mirroring engine semantics.
- Extend the existing `case "lighting.fixture.update"` to handle the new `name` and `type` fields.

### B.2 Functional UI

| Item                          | Change                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 group create               | `+ New group` chip at end of group rail opens a `RenameDialog` for the name; submit calls `store.createLightingGroup(name)`. Empty-state copy in `GroupRail.tsx:25` becomes truthful: "No groups yet. Tap + New group below or assign fixtures via the inspector."                                                                                                              |
| #2 rename scene/fixture/group | New `RenameDialog` co-located in lighting tree. `<Pencil>` icon button next to `.fixtureName` / `.sceneTitle` / `groupName`. Calls `updateLightingFixture({ name })` / `updateLightingScene({ sceneId, name })` / `updateLightingGroup({ groupId, name })`. `handleResaveScene` switches from delete+recreate to `updateLightingScene({ sceneId, captureCurrentState: true })`. |
| #3 fixture type at creation   | New `CreateFixtureDialog`. Toolbar `+ Fixture` opens it. Fields: name (default `Fixture N`), type (select with known types: astra-bicolor, infinimat, infinibar, apollo-bridge), `dmxStartAddress` (auto-suggested via `findNextLightingFixtureStartAddress`). Replaces the silent autocreate.                                                                                  |
| #4 fixture group reassignment | InspectorFixture `Group` row becomes a `<select>` with options from `groups` + "Ungrouped" + a divider + "Create new…" that opens the create-group flow. Calls `updateLightingFixture({ groupId })`.                                                                                                                                                                            |
| #5 group nav from rail        | Rebuild `GroupChip` with two children: power button (existing toggle) + small chevron-right icon button labeled "Inspect". Inspect calls `onSelectGroup(id)` wired to `setSelectedGroupId(id)` + `setActiveTabOverride("group")`.                                                                                                                                               |
| #6 named-on-create            | Folded into #3 (fixtures) and added "Save as new scene" command (always opens `RenameDialog`). Bare-S keeps autoname for speed (covered in #14).                                                                                                                                                                                                                                |
| #14 smart S                   | Rewrite the keydown handler for bare `s`: `if (isSceneModified && activeScene) handleResaveScene() else handleSaveScene()`.                                                                                                                                                                                                                                                     |
| #15 ⌘S / ⌘⇧S                  | Add `Cmd/Ctrl+S` → `handleResaveScene` if drifted else feedback "Already saved." Add `Cmd/Ctrl+Shift+S` → opens `RenameDialog` for "Save as new".                                                                                                                                                                                                                               |
| #19 recall gating             | `handleRecallScene` short-circuits when `!bridgeReachable`: still sets `previewSceneId` (so inspector renders), skips the IPC, emits feedback "Bridge unreachable — showing scene contents only." InspectorScene's "Re-apply scene" button stays disabled-with-tooltip when unreachable. The two paths agree.                                                                   |
| #21 / #1                      | Same fix as #1.                                                                                                                                                                                                                                                                                                                                                                 |
| #23 Group tab gating          | `visibleTabs` includes `"group"` only when `selectedGroupId !== null` OR `activeTabOverride === "group"`. Removes the dead-end empty state.                                                                                                                                                                                                                                     |
| #36 (action verbs)            | Final pass on master/group action buttons.                                                                                                                                                                                                                                                                                                                                      |

### New files

- `frontend/app/src/app/lighting/components/RenameDialog.tsx` — small Dialog wrapper with a single text input + Save/Cancel.
- `frontend/app/src/app/lighting/components/CreateFixtureDialog.tsx` — same shape as RenameDialog but with name + type select + DMX hint.
- `frontend/app/src/app/lighting/components/CreateGroupDialog.tsx` — could be the same as RenameDialog with different default; if so, reuse RenameDialog with `mode="create"`.

### Estimated diff size

~700 LOC across ~10 files (mostly new dialog primitives + inspector wiring).

---

## Commit C — Wave 18: accessibility sweep

| Item                         | File(s)                                                            | Change                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #29 stage plot SR + keyboard | `FixtureMarker.tsx`, `StagePlot.tsx`                               | `<g>` markers gain `tabIndex={0}`, `role="button"`, `aria-label`, `aria-pressed={selected}`. Tab moves through markers in stage order. Enter/Space call `onSelect`. The plot's `role="application"` keeps arrow nudge working.                                                                                    |
| #30 focus-visible            | All lighting `*.module.css`                                        | Add `:focus-visible { outline: 2px solid var(--color-brand-green); outline-offset: 2px; }` to: `.tile`, `.tileAdd`, `.groupChip*`, `.headButton`, `.action`, `.tab`, `.memberRow`, `.masterToggle`, `.emergencyCut`, `.positionInput`, `.patchInput`, `.slider` thumb, `.cell` (DMX monitor), `.feedbackDismiss`. |
| #31 scene tile aria          | `SceneTile.tsx:33-49`                                              | Replace `aria-pressed` + hidden badge with `aria-label="Recall scene ${name}${active ? ' — active' : ''}${modified ? ' — modified' : ''}"`. Keep `aria-current="true"` when active. Drop `aria-hidden` on the badge.                                                                                              |
| #32 group chip aria          | `GroupChip.tsx`                                                    | Power button: `aria-label="${name} — ${fixtureCount} fixtures, ${level}%${drifted ? ', drifted' : ''}, currently ${on ? 'on' : 'off'}. Click to turn ${on ? 'off' : 'on'}"`. Inspect button: `aria-label="Inspect ${name} group"`.                                                                                |
| #33 native title → Tooltip   | `GroupChip.tsx:45`, `DMXChannel.tsx:21`, `DMXMonitorDialog.tsx:95` | Replace `title=` on GroupChip and DMXChannel with `Tooltip`. DMXMonitorDialog (512 cells) keeps native `title` for performance — switching to a single delegated popover at the grid root is out of scope here.                                                                                                   |

### Estimated diff size

~300 LOC across ~10 files.

---

## Validation

- After each commit: `npm run typecheck` (workspaces).
- At the end of Commit C: `npm run dev:check`.
- No engine work, so `npm run native:test` should pass unchanged.
- Auto-revert generated artefacts before staging per standing rule. Tokens haven't changed; protocol artefacts shouldn't change either since no new IPC names are added.
- Tauri `npm run tauri:dev` smoke check at the very end so the user can click through. Visual review (`npm run tauri:visual:review`) and the rest of the §3.8 lanes are deferred per the standing rule on invasive ops.

## Out of scope

- The 5 "edge cases worth a quick test" items from the audit (long names, 30+ scenes virtualization, narrow window responsive, zoom extremes, bridge flicker) — explicitly deferred.
- Engine work: keeping additive-only. No fixture-type swap UI side-effects beyond what the engine already accepts; no scene-update for fixture states beyond what `captureCurrentState` already does.
- Storybook stories for new primitives (`RenameDialog`, `CreateFixtureDialog`, `KeyboardShortcutsPopover`) — same posture as memory entry on deferred Storybook.
- §3.8 validation lanes (`tauri:visual:review`, `tauri:workspaces:qualify`, `native:acceptance`) — invasive per memory, separate go-ahead.

## Standing rules carried forward

- Auto-revert generated artefacts before staging.
- Explicit go-ahead before invasive ops (release-evidence cycles, force-pushes, system installs, branch pushes, PR merges, persisted-state mutations).
- WIP commits on a named branch over stash for safety snapshots.
- Local `dev:check` is the verification surface; GitHub Actions CI is intentionally unpaid — treat red CI as baseline noise.
- Windows-Claude session covers `npm run tauri:smoke:win` against whatever ends up on `origin/main`; Mac-side Claude does not run it.
