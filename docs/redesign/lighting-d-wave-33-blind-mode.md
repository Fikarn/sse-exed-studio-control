# Wave 33 - Blind / preview-edit mode design

Authored 2026-05-01 against `claude/wave-31-cross-cutting-refinements` after Wave 32 fade recall work. Companion docs: [lighting-d-premium-plan.md Wave 33](lighting-d-premium-plan.md#wave-33--blind--preview-edit-mode-architectural), [lighting-d-industry-audit.md#p1](lighting-d-industry-audit.md#p1-blind--preview-edit-mode-eos-blind-grandma3-blind).

This is an approval-gated design doc. Do not implement Wave 33 code until this doc is reviewed and accepted. The feature changes operator trust boundaries: the UI must make it impossible to confuse offline edits with live rig output.

## Goal

Let an operator edit a scene offline while the live rig remains unchanged. In preview mode, fixture edits, scene recalls, palette applies, and scene-save capture operate on an engine-owned preview buffer. Live output is untouched until the operator explicitly exits preview and recalls a scene live later.

## Non-goals

- No cue stack, sequence playback, or keypad command-line syntax.
- No frontend-owned preview state. React may choose which engine-owned value source to display, but the engine owns live state, preview state, persistence, and IPC semantics.
- No "save and drive rig" default. Preview mode is offline-first; saving updates stored scene data, not live DMX output.
- No persistence of unfinished preview sessions across engine restart.

## Decisions

1. Multi-fixture multi-select behaves exactly as live mode. Selection is still the operator scope; bulk sliders write every selected fixture in the preview buffer.
2. Recalling a scene during preview mode loads that scene's saved fixture states into the preview buffer and marks it as the preview target. It does not update `lastRecalledSceneId`, live fixture output, or DMX output.
3. Drift detection compares the preview buffer against the preview target scene while preview mode is active. Live drift indicators are suppressed in favor of a preview-specific "offline edits" state.
4. Save commits the preview buffer into the active preview scene's saved `fixtureStates`, exits preview mode, and leaves live output unchanged. Save As creates a new scene from the preview buffer, selects it, exits preview mode, and leaves live output unchanged.
5. The bridge banner does not change. Bridge reachability is still true or false independently of preview mode. A separate sustained preview banner carries the offline-edit warning.
6. Patch mode and preview mode are mutually exclusive. Preview cannot be enabled in patch mode; patch cannot be enabled while preview is active. The toolbar disables the conflicting toggle and explains the reason in a tooltip.
7. Inspector treatment is unmistakable but not alarm-red: a sustained amber/blue `PreviewBanner` says `Editing offline` and offers `Save`, `Discard`, and `Exit preview`. Sliders show a preview-source eyebrow.
8. Stage plot treatment uses preview values for marker intensity/pools while active, with ghosted live markers available as a subtle outline only when the preview differs from live. No large overlay that steals plot space.

## UX Flow

### Enter Preview

- Toolbar gains a `Preview` toggle between `Find` and `Add fixture`.
- Command palette registers `Toggle lighting preview mode`.
- Keyboard shortcut: `B` toggles preview mode when lighting is focused and no editable target is active. `B` is disabled in patch mode.
- On entry, the engine seeds the preview buffer from current live fixture state. If an active scene exists, it becomes the initial preview target.

### Edit Offline

- Fixture sliders, group power, all-power, palette apply, and stage-plot fixture edits write to preview state.
- The rail still shows the live active scene, but the inspector and plot use the preview target when preview mode is active.
- Hover preview remains inspector-only. It must not mutate the preview buffer.

### Recall In Preview

- Clicking a scene tile while preview is active loads the scene's saved states into preview state.
- The tile receives a preview ring, not the live recalled state treatment.
- The toast says `Scene loaded into preview.` not `Scene recalled.`

### Save

- `S` and `Cmd/Ctrl+S` commit the preview buffer into the preview target scene and exit preview.
- `Cmd/Ctrl+Shift+S` opens Save As, creates a scene from the preview buffer, selects it, and exits preview.
- Save never drives live output. A separate live recall is required.

### Discard / Exit

- `Esc` clears selection as today; it does not discard preview by itself.
- The preview banner has `Discard` and `Exit preview`.
- If there are unsaved preview edits, `Exit preview` opens a confirm dialog with `Save`, `Discard`, and `Cancel`.

## Visual States

- Toolbar preview toggle:
  - Off: secondary button, enabled unless patch mode is active.
  - On: primary/amber button with `B` key hint.
  - Disabled: tooltip `Exit patch mode before preview editing.`
- Sustained banner:
  - Text: `Editing offline`
  - Detail: `Live rig is unchanged. Save to commit scene data, or discard.`
  - Actions: `Save`, `Discard`
- Inspector:
  - Preview eyebrow above controls: `Preview values`
  - Modified state: `Offline edits` instead of `Modified`
- Stage plot:
  - Preview marker fill uses preview intensity.
  - Live marker outline remains at low opacity only when live and preview differ.
  - Light pools use preview values so the offline look is legible.

## Engine State

The current engine command model reloads persisted editor state per command. A transient preview buffer cannot live only as a serde-skipped field on `LightingEditorState`, because it would be lost between IPC calls. Wave 33 must introduce engine-owned runtime state alongside the DB-backed editor state.

Proposed runtime shape:

```rust
pub struct LightingPreviewRuntimeState {
    pub enabled: bool,
    pub target_scene_id: Option<String>,
    pub dirty: bool,
    pub fixture_states: HashMap<String, LightingEditorSceneFixtureState>,
}
```

Ownership:

- Stored in the Rust engine process, behind the same synchronization boundary as other runtime shell state.
- Not serialized to SQLite settings.
- Cleared on engine restart, startup failure, or explicit discard.
- Seeded from live editor fixtures when preview is enabled.

Snapshot additions:

```rust
pub struct LightingSnapshot {
    // existing fields...
    #[serde(rename = "previewMode")]
    pub preview_mode: bool,
    #[serde(rename = "previewDirty")]
    pub preview_dirty: bool,
    #[serde(rename = "previewSceneId")]
    pub preview_scene_id: Option<String>,
    #[serde(rename = "previewFixtures")]
    pub preview_fixtures: Vec<LightingFixtureSnapshot>,
}
```

`fixtures` remains live output. `previewFixtures` is populated only when preview mode is active. The frontend chooses `previewFixtures` for inspector and plot rendering in preview mode, but live output remains available for comparison.

## IPC Contract

New IPC:

```json
lighting.editor.previewMode { "enabled": true }
```

Result:

```json
{
  "enabled": true,
  "dirty": false,
  "summary": "Lighting preview mode enabled."
}
```

Extended semantics:

- `lighting.fixture.update`
  - Live mode: unchanged.
  - Preview mode: updates `preview.fixture_states`; returns a fixture snapshot from preview state with `source: "preview"`.
- `lighting.group.power`
  - Preview mode: updates preview states for group fixtures only.
- `lighting.power.all`
  - Preview mode: updates every preview fixture.
- `lighting.scene.recall`
  - Live mode: unchanged.
  - Preview mode: copies scene `fixtureStates` into preview buffer, sets `preview_scene_id`, sets `dirty = false`, emits `lighting.changed` reason `scene-preview-recalled`.
- `lighting.scene.update { captureCurrentState: true }`
  - Live mode: captures live fixture state.
  - Preview mode: captures preview buffer and exits preview mode after successful persist.
- `lighting.scene.create`
  - Live mode: captures live fixture state.
  - Preview mode: captures preview buffer and exits preview mode after successful persist.

New command:

```json
lighting.editor.previewDiscard {}
```

This clears preview runtime state without touching persisted scenes or live fixture state.

## Persistence

- No `STORAGE_SCHEMA_VERSION` bump.
- No on-disk preview session.
- Save/Save As are normal scene persistence writes. Once saved, the changed scene data survives rollback the same way other scene edits do.
- If the engine crashes while preview is active, the next launch starts in live mode with no preview buffer. This is intentional and must be surfaced in tests.

## Patch Mode Interaction

Patch mode is a live configuration mode. It changes fixture identity and addressing, so it is incompatible with offline fixture-value editing.

Rules:

- Enter preview while patch mode active: reject with `LIGHTING_PREVIEW_PATCH_MODE_CONFLICT`.
- Enter patch while preview active: reject unless preview is clean and discarded first.
- Frontend disables the conflicting toolbar buttons and command palette actions.
- Tests cover both IPC rejection and UI disablement.

## Decision Log

- Rejected frontend-only preview buffer: violates architecture boundary and breaks command palette/IPC parity.
- Rejected persisted preview sessions: creates migration and recovery risk for an intentionally temporary editing mode.
- Rejected Save driving live output: makes "blind" mode ambiguous and high-risk during recording.
- Rejected bridge-banner repurposing: reachability and preview mode are orthogonal; overloading the banner weakens both signals.
- Rejected red error styling: preview mode is intentional, not a fault. Use sustained amber/blue warning styling.

## Sub-PR Plan

### 33a - Engine runtime and IPC

- Add runtime preview state to the Rust engine process.
- Add `lighting.editor.previewMode` and `lighting.editor.previewDiscard`.
- Extend snapshot with preview fields.
- Route fixture/group/all-power/scene recall/scene save semantics through preview when enabled.
- Regenerate protocol artifacts and engine-client types.
- Feature flag UI entry points off by default.

### 33b - Frontend preview UX

- Add toolbar Preview toggle and command palette action.
- Add `<PreviewBanner>` primitive.
- Switch inspector/plot value source to preview fixtures when active.
- Add save/discard/exit flows and dirty confirmation.
- Add visual review fixtures for preview clean, preview dirty, preview recall, patch conflict.

## Test Plan

Native minimum:

1. Enabling preview seeds buffer from current live state.
2. Fixture update in preview changes preview buffer only.
3. Group power in preview changes matching preview fixtures only.
4. All-power in preview changes all preview fixtures only.
5. Scene recall in preview swaps preview buffer and leaves live `lastRecalledSceneId` unchanged.
6. Save in preview commits preview buffer to scene state and exits preview.
7. Save As in preview creates a scene from preview buffer and exits preview.
8. Discard clears preview buffer and leaves live/persisted state unchanged.
9. Patch conflict rejects preview enable.
10. Engine restart clears preview state.

Frontend minimum:

- Toolbar toggle and banner render at 2560x1440 and 1920x1080.
- Preview recall toast says preview, not live recall.
- Dirty preview state blocks silent exit.
- Patch mode disables preview toggle.
- Keyboard `B` toggles preview outside editable targets only.

## Validation

- `cargo test` for preview runtime tests.
- `npm run protocol:generate`
- `npm run frontend:foundation`
- `npm run native:check`
- `npm run tauri:visual:review -- --fixtures=lighting-preview-clean,lighting-preview-dirty,lighting-preview-patch-conflict --sizes=2560x1440,1920x1080`
- Windows target-host pass before merge.
- Two `tauri:dev` soak sessions: senior operator flow and recording-operator flow.

## Approval Checkpoint

Implementation should not start until this doc is approved. The highest-risk decision is the runtime state owner: preview state must be engine-owned and process-transient, not stored in React and not persisted to SQLite.
