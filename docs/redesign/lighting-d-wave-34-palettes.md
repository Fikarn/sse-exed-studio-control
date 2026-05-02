# Wave 34 - Per-attribute palette pools design

Authored 2026-05-01 against `claude/wave-31-cross-cutting-refinements` after Wave 32 fade recall work. Companion docs: [lighting-d-premium-plan.md Wave 34](lighting-d-premium-plan.md#wave-34--per-attribute-palette-pools-architectural), [lighting-d-industry-audit.md#p3](lighting-d-industry-audit.md#p3-per-attribute-palette-pools--cct-and-intensity-presets-hog-4-palettes--grandma3-preset-pools).

This was the approval-gated design doc for Wave 34. Wave 34 added a persisted lighting concept and a storage migration, so the implementation was deliberately reviewed before code landed.

## Implementation Status

Implemented and validated through PR #65 on `codex/wave-34-palettes`, then tightened by the closeout branch:

- schema v6 palette migration, CRUD, ordering, application, patch conflict, and preview-buffer application are implemented in the Rust engine and engine-client fixture transport.
- the inspector Palettes tab ships as a compact in-workspace implementation in `InspectorPalettes.tsx`; the expected `PaletteTile` / `PalettePool` abstractions were not split into separate files for v1 because the first consumer did not need cross-surface reuse.
- patch mode now locks palette create, edit, reorder, delete, and apply, with explicit copy telling the operator to exit patch mode before editing or applying palettes.
- `Cmd/Ctrl+Shift+P` opens a dedicated palette quick popover with focused search, recent palette applications, intensity and CCT sections, and read-only no-selection / patch-mode states.
- visual-review coverage now includes `lighting-palettes-preview-active` in addition to selected, empty, and patch-disabled palette fixtures.

## Goal

Give operators one-click attribute presets for the daily lighting tasks that should not require full scene recall: setting selected fixtures to a known intensity or CCT. Palette application behaves like a bulk slider edit on the current selection; it does not auto-save the active scene.

## Non-goals

- No scene/cue model revival. Palettes are attribute presets only.
- No fixture-specific palette references in scenes. Applying a palette writes concrete fixture values.
- No automatic scene save on palette apply.
- No patch-mode palette editing or application.
- No hidden favorites system in v1. Recents are enough for the quick popover.

## Default Palette Set

Seed on first v5 -> v6 migration when no palettes exist:

Intensity:

| Name    | Kind        | Value | Color  |
| ------- | ----------- | ----: | ------ |
| Low     | `intensity` |    10 | blue   |
| Quarter | `intensity` |    25 | green  |
| Half    | `intensity` |    50 | yellow |
| Full    | `intensity` |   100 | coral  |

CCT:

| Name     | Kind  | Value | Color |
| -------- | ----- | ----: | ----- |
| Warm     | `cct` |  2700 | coral |
| Studio   | `cct` |  4000 | green |
| Daylight | `cct` |  5600 | blue  |
| Cool     | `cct` |  6500 | sky   |

Defaults are editable and deletable after migration. The migration seeds once; it does not re-create deleted defaults on later launches.

## Data Model

Persisted editor state:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingPaletteState {
    pub id: String,
    pub name: String,
    pub kind: LightingPaletteKind,
    pub value: f64,
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LightingPaletteKind {
    Intensity,
    Cct,
}

pub struct LightingEditorState {
    // existing fields...
    #[serde(default)]
    pub palettes: Vec<LightingPaletteState>,
    #[serde(default, rename = "paletteOrder")]
    pub palette_order: Vec<String>,
}
```

Snapshot:

```rust
pub struct LightingPaletteSnapshot {
    pub id: String,
    pub name: String,
    pub kind: LightingPaletteKind,
    pub value: f64,
    #[serde(rename = "colorIndex")]
    pub color_index: Option<u8>,
}

pub struct LightingSnapshot {
    // existing fields...
    pub palettes: Vec<LightingPaletteSnapshot>,
}
```

`value` stays `f64` in the protocol to keep the palette model generic, but handlers normalize to current fixture domains:

- intensity: `0..100`, rounded to nearest integer when applied.
- CCT: `MIN_FIXTURE_CCT..MAX_FIXTURE_CCT`, rounded to nearest kelvin when applied.

## Migration

`STORAGE_SCHEMA_VERSION` bumps from 5 to 6.

Migration behavior:

1. Load existing lighting editor state.
2. If `palettes` is missing or empty, insert the eight defaults above.
3. Build `paletteOrder` in default order.
4. Preserve all existing fixtures, groups, scenes, scene order, pinned scenes, color tags, and group order.
5. Persist schema version 6 only after the lighting editor state write succeeds.

Rollback posture:

- A v6 database can be reinstalled back to v5-era app code, but v5 code will ignore unknown `palettes` fields only if serde defaults remain tolerant. Because this is a schema bump, release notes must state that palette edits are a forward-version feature.
- No fixture or scene value format changes.

## IPC Contract

### `lighting.palette.list`

Request: `{}`.

Returns:

```json
{
  "palettes": [{ "id": "palette-intensity-half", "name": "Half", "kind": "intensity", "value": 50, "colorIndex": 2 }]
}
```

The normal `lighting.snapshot` also includes `palettes`; `list` exists for command-level tests, support tooling, and future palette-only refreshes.

### `lighting.palette.create`

Request:

```json
{ "name": "Interview", "kind": "cct", "value": 4300, "colorIndex": 1 }
```

Rules:

- `name`: required, trimmed, max 40 chars.
- `kind`: `intensity` or `cct`.
- `value`: validated against the selected kind.
- `colorIndex`: optional `null` or `0..7`.
- New palettes append to the end of their kind group.

### `lighting.palette.update`

Request:

```json
{ "paletteId": "palette-cct-studio", "name": "Studio 4200", "value": 4200, "colorIndex": null }
```

At least one of `name`, `value`, `colorIndex`, or `beforePaletteId` is required.

Rules:

- `kind` is immutable. Changing intensity to CCT is delete + create.
- Reorder is represented by `beforePaletteId`; null moves to end of same kind.
- Reordering cannot cross kind boundaries.

### `lighting.palette.delete`

Request:

```json
{ "paletteId": "palette-cct-cool" }
```

Deletes the palette and removes it from `paletteOrder`. There is no dependency cleanup because scenes store concrete values, not palette references.

### `lighting.palette.apply`

Request:

```json
{ "paletteId": "palette-cct-studio", "fixtureIds": ["fixture-key", "fixture-fill"] }
```

Rules:

- `fixtureIds` is required and must contain at least one live fixture id.
- Unknown ids reject with `LIGHTING_FIXTURE_NOT_FOUND`.
- Patch mode rejects with `LIGHTING_PALETTE_PATCH_MODE_CONFLICT`.
- Preview mode, once Wave 33 is present, applies to the preview buffer.
- Live mode applies to live fixture state.

Apply semantics:

- Intensity palette mirrors the intensity slider:
  - value > 0 sets `intensity` and `on = true`.
  - value = 0 sets `intensity = 0` and `on = false`.
- CCT palette mirrors the CCT slider:
  - sets `cct`.
  - preserves `on` and `intensity`.

Applying a palette marks the active scene as drifted exactly like a bulk slider edit. It does not save.

## UX

### Inspector Palettes Tab

Add a fourth lighting inspector tab: `Palettes`.

Layout:

- Selection summary at top: `2 fixtures selected` or `Select fixtures to apply palettes`.
- Two full-width sections:
  - `Intensity`
  - `CCT`
- Each section renders a dense grid of `<PaletteTile>`.
- A trailing `+` tile opens create flow for that kind.

Tile states:

- Default: name + value.
- Hover: show apply affordance.
- Disabled: no selected fixtures or patch mode active.
- Context menu: `Rename`, `Edit value`, `Color`, `Delete`.
- F2 on focused tile starts inline rename.
- Drag within section reorders.

### Edit Palette UX

- Name edits are inline on the tile.
- Value edits use a compact modal because the value domain differs by kind and needs validation.
- Color uses the existing 8-swatch color tag popover.
- Delete uses a confirm dialog with palette name.

### Apply Behavior

- Click applies to current selection only.
- No selection: tiles are disabled with tooltip `Select fixtures to apply`.
- Applying does not auto-save the active scene.
- Applying during preview mode edits the preview buffer and updates the preview banner dirty state.

### Quick Popover

Shortcut: `Cmd/Ctrl+Shift+P`.

Content:

- Search input focused by default.
- Recent palette applications at top, capped at 6, sourced from the same frontend recents ring pattern as scene recalls.
- Intensity and CCT sections below recents.
- Enter applies highlighted palette to current selection.
- No selected fixtures: popover opens read-only and says `Select fixtures to apply`.

No favorites in v1. If operators need favorites after use, add a separate `favorite` field later.

## Design-System Primitives

### `<PaletteTile>`

Props:

- `name`
- `kind`
- `value`
- `colorIndex`
- `selected`
- `disabled`
- `busy`
- `onApply`
- `onRename`
- `onEditValue`
- `onDelete`
- `onColorChange`

Rendering:

- 8 px max radius, consistent with existing tiles.
- 4 px accent strip for color tag.
- Intensity value renders as `50%`.
- CCT value renders as `4000K`.

### `<PalettePool>`

Props:

- `kind`
- `palettes`
- `selectionCount`
- reorder callbacks
- create callback

The primitive owns grid layout, roving focus, and drag target styling; it does not own IPC or persistence.

## Frontend Integration

Files expected:

- `frontend/app/src/app/lighting/components/InspectorPalettes.tsx`
- `frontend/app/src/app/lighting/components/PaletteTile.tsx`
- `frontend/app/src/app/lighting/components/PalettePool.tsx`
- `frontend/app/src/app/lighting/components/LightingInspectorTabs.tsx`
- `frontend/app/src/app/lighting/LightingWorkspace.tsx`
- `frontend/app/src/app/shared/paletteContext.tsx` for quick-popover recents registration only.

Implementation note: v1 kept palette tile and pool rendering inside `InspectorPalettes.tsx` to avoid a premature abstraction. Split `PaletteTile` / `PalettePool` only when a second consumer or Storybook primitive review makes that reuse valuable.

Workspace handlers:

- `handleApplyPalette(paletteId, fixtureIds)`
- `handleCreatePalette(request)`
- `handleUpdatePalette(request)`
- `handleDeletePalette(paletteId)`
- `handleReorderPalette(paletteId, beforePaletteId)`

Command palette / quick popover:

- Register `Apply palette: {name}` actions only when selected fixtures exist and patch mode is inactive.
- `Cmd/Ctrl+Shift+P` opens the dedicated palette popover, not the global command palette.

## Interaction With Other Modes

- Patch mode: palette tab is visible but editing and application are disabled with `Exit patch mode to edit or apply palettes`.
- Preview mode: palette apply writes to preview buffer and marks preview dirty.
- Highlight/Solo/Find overlays: palette apply is allowed; overlays remain visual overrides and do not change saved palette semantics.
- Scene fade recall: independent. Palettes set current fixture values; they do not fade unless a later recall uses fade.

## Decision Log

- Rejected auto-save-on-apply: applying a palette should be equivalent to moving a slider, so normal drift/save flows remain predictable.
- Rejected storing palette references in scenes: this would make old scenes change when a palette is edited, which is surprising and risky.
- Rejected hidden favorites in v1: recents solve speed without a new persisted bit.
- Rejected cross-kind reorder: intensity and CCT are distinct pools and should remain scannable.
- Rejected patch-mode application: patch mode is addressing/configuration, not look editing.

## Sub-PR Plan

### 34a - Engine, migration, protocol

- Add `LightingPaletteState`, snapshot type, validation helpers, defaults, and migration v5 -> v6.
- Add five palette IPCs.
- Add engine-client methods and generated TS bindings.
- Add native tests for CRUD, migration, ordering, delete, apply, and patch conflict.

### 34b - Frontend palette UI

- Add inspector tab, design-system primitives, quick popover, keyboard shortcut, and recents.
- Add Playwright coverage for apply/create/edit/delete/reorder.
- Add visual review fixtures for no selection, selected fixtures, patch disabled, preview active.

## Test Plan

Native minimum:

1. v5 -> v6 migration seeds eight defaults.
2. Migration preserves existing fixtures, scenes, groups, orders, pins, and color tags.
3. Create validates kind/value/name/color and appends to kind group.
4. Update renames, edits value, clears color, and rejects invalid values.
5. Delete removes palette and order entry.
6. Reorder moves within kind and rejects cross-kind anchors.
7. Apply intensity sets selected fixture intensity and power.
8. Apply CCT sets selected fixture CCT and preserves power/intensity.
9. Apply rejects empty selection.
10. Apply rejects unknown fixture id.
11. Apply rejects patch mode.
12. Preview-mode apply writes preview buffer once Wave 33 exists.

Frontend minimum:

- Palettes tab renders both pools at 2560x1440 and 1920x1080 without scroll in normal operation.
- No-selection disabled state is clear.
- Apply marks active scene as modified.
- Create/edit/delete/reorder flows round-trip through store.
- `Cmd/Ctrl+Shift+P` opens quick popover outside editable targets only.

## Validation

- `cargo test` for palette and migration tests.
- `npm run protocol:generate`
- `npm run frontend:foundation`
- `npm run native:check`
- `npm run tauri:visual:review -- --fixtures=lighting-palettes-selected,lighting-palettes-empty,lighting-palettes-patch-disabled,lighting-palettes-preview-active --sizes=2560x1440,1920x1080`
- Windows target-host pass because of the schema bump.

## Approval Checkpoint

Approved before implementation. The critical decisions were: apply to current selection only, no auto-save, no scene palette references, defaults seed once on v5 -> v6, and patch mode disables palette editing and application.
