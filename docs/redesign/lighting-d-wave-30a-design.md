# Wave 30a — Engine design pass (rail finish — engine half)

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

Authored 2026-05-01 against `origin/main` at `6b0346b4` (Wave 29 merge / PR #55). Native floor 123 engine + 6 shell = 129 (lighting subset 32). Companion docs: [lighting-d-premium-plan.md §"Wave 30"](lighting-d-premium-plan.md), [lighting-direction-d-followups.md#f5](lighting-direction-d-followups.md#f5-drag-reorder-for-groups-parallel-to-scenes), [lighting-d-industry-audit.md#i4](lighting-d-industry-audit.md#i4-color-tags-for-scenes-and-groups--ableton-live-pattern).

This doc locks down the schema, IPC, migration, and test shape for the engine sub-PR. The frontend half (X1 hover, F10 CTAs, P5 mini-graph, ColorPicker primitive, GroupRail dnd-kit, EmptyState extension, hover preview) ships in **30b** as a frontend-only sub-PR after 30a merges. 30a's frontend deliverable is the engine-client TS surface + ts-rs regen so the engine work is visible end-to-end (no UI yet).

## Scope (30a)

- **Persisted-state additions**:
  - `LightingEditorGroupState.color_index: Option<u8>` (palette index 0..7, or `None`).
  - `LightingEditorSceneState.color_index: Option<u8>` (same).
  - `LightingEditorState.group_order: Vec<String>` parallel to `scene_order`.
- **New IPC**: `lighting.group.reorder { groupId, beforeGroupId | null }`.
- **Extended IPCs**: `lighting.scene.update` and `lighting.group.update` accept optional `colorIndex` (omit = unchanged, `null` = clear, `0..7` = set).
- **Snapshot extensions**: `LightingSceneSnapshot.color_index` + `LightingGroupSnapshot.color_index` (both `Option<u8>`).
- **Engine-client TS surface**: `reorderLightingGroup` method; `updateLightingScene`/`updateLightingGroup` request shapes gain `colorIndex?: number | null`. ts-rs regen ships the `colorIndex` field on the snapshot types.
- **Native tests** added (count is a decision — see Test plan).

Frontend UI (color picker, group dnd-kit, color accents on tile/chip, empty-state CTAs, hover preview, mini-graph) is **out of scope for 30a**. It lands in 30b.

## Schema

### Persisted records

```rust
// types.rs — additive fields on existing persisted structs.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorGroupState {
    pub id: String,
    pub name: String,
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightingEditorSceneState {
    pub id: String,
    pub name: String,
    #[serde(rename = "fixtureStates")]
    pub fixture_states: Vec<LightingEditorSceneFixtureState>,
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
}

pub struct LightingEditorState {
    // ...existing fields...
    #[serde(default, rename = "sceneOrder")]
    pub scene_order: Vec<String>,
    #[serde(default, rename = "pinnedSceneIds")]
    pub pinned_scene_ids: Vec<String>,
    /// Display order for groups. Mirrors `scene_order`. Empty on legacy
    /// state — populated from groups insertion order on first load.
    /// Reordered via `lighting.group.reorder`; create / delete keep the
    /// vec in sync.
    #[serde(default, rename = "groupOrder")]
    pub group_order: Vec<String>,
}
```

Why `#[serde(default)]` everywhere: legacy persisted state (pre-30a) has none of these fields. Without `default`, deserialize fails on first load post-deploy and the operator's editor state silently resets to defaults (the `unwrap_or_else(default_lighting_editor_state)` fallback in [editor_state.rs:35](native/rust-engine/src/lighting/editor_state.rs:35)). With `default`, legacy state loads cleanly with `None`/empty and `normalize_lighting_editor_state` rebuilds `group_order` (see Migration). Same pattern Wave 23.B/C used for `scene_order` + `pinned_scene_ids`.

Why `Option<u8>` for `color_index`: 8 swatches in the picker spec → 0..=7 fits comfortably in a `u8`, and `None` cleanly expresses "no color" (rendered as no accent bar). Range validation enforced at the parser layer (see IPC) and again in normalize-load (defensive — clamp + drop out-of-range values to `None`).

### Snapshot

```rust
// types.rs

pub struct LightingSceneSnapshot {
    // ...existing fields...
    pub pinned: bool,
    /// Operator-assigned color tag (Ableton-style). Palette index 0..=7
    /// or `None` for no tag. Frontend renders as a 4 px left accent bar
    /// (#fb7185 #fb923c #facc15 #a3e635 #34d399 #22d3ee #a78bfa #f472b6).
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
}

pub struct LightingGroupSnapshot {
    pub id: String,
    pub name: String,
    #[serde(rename = "fixtureCount")]
    pub fixture_count: usize,
    #[serde(default, rename = "colorIndex")]
    pub color_index: Option<u8>,
}
```

Both snapshot structs already carry `#[cfg_attr(feature = "ts-rs", derive(ts_rs::TS))]` — so `node scripts/protocol/generate-protocol-artifacts.mjs` regenerates the matching TypeScript snapshot types under `frontend/packages/engine-client/src/generated/snapshots/`. The regen diff ships in 30a's PR (per Wave 29 lesson).

## Migration

`normalize_lighting_editor_state` ([editor_state.rs:84-212](native/rust-engine/src/lighting/editor_state.rs:84)) is the single load-time funnel. Two additions, both mirroring the existing `scene_order` pattern at lines 184–194:

```rust
// After groups normalization (line 145), rebuild group_order:
// preserve existing order entries that point to live groups, then
// append any group not yet listed (legacy state pre-30a has empty
// group_order and rebuilds from insertion order).
let mut group_order: Vec<String> = existing
    .group_order
    .iter()
    .filter(|id| groups.iter().any(|group| &group.id == *id))
    .cloned()
    .collect();
for group in &groups {
    if !group_order.iter().any(|id| id == &group.id) {
        group_order.push(group.id.clone());
    }
}
```

Color-index defensive clamp during the existing scene + group rebuild branches:

```rust
color_index: scene.color_index.filter(|index| *index < 8),
// Same on group branch.
```

`default_lighting_editor_state` populates `group_order` from groups insertion order (mirroring line 73's `scene_order`):

```rust
let group_order = groups.iter().map(|group| group.id.clone()).collect();
LightingEditorState {
    // ...
    scene_order,
    pinned_scene_ids: Vec::new(),
    group_order,
}
```

`create_lighting_group` appends the new id to `group_order` (mirroring [scenes.rs:111](native/rust-engine/src/lighting/scenes.rs:111)). `delete_lighting_group` retains-not on `group_order` (mirroring [scenes.rs:228-233](native/rust-engine/src/lighting/scenes.rs:228)).

No `STORAGE_SCHEMA_VERSION` bump. The change is purely additive serde — schema bump is reserved for transformative migrations (Wave 34's palettes will need one).

## IPC

### `lighting.group.reorder` (new)

Mirror `lighting.scene.reorder` shape verbatim — same parser tolerances, same handler structure, same error code:

```
{ groupId: string, beforeGroupId: string | null }
```

- `groupId`: required, trimmed, non-empty.
- `beforeGroupId`: optional. Null / missing / whitespace-only string → "move to end". Self-anchor → reject. Numeric / non-string non-null → reject.
- Handler validates both ids exist as live groups; rejects with `LIGHTING_GROUP_NOT_FOUND`.
- Result `LightingGroupReorderResult { group_id, summary }`.

Dispatcher entry in `app.rs:208-225` (between `group.create` and `group.update`):

```rust
"lighting.group.reorder" => self.dispatch_lighting_mutate(
    request,
    parse_lighting_group_reorder_request,
    reorder_lighting_group,
    "group-reordered",
),
```

Method registry: append `"lighting.group.reorder"` to [native/protocol/v1.contract.json](native/protocol/v1.contract.json) `methods` (alphabetical position between `group.delete` and `group.update`).

### `lighting.scene.update` (extended)

Add `colorIndex` as a third optional field. The existing at-least-one rule (`name || captureCurrentState`) becomes `name || captureCurrentState || colorIndex`.

Parser changes:

```rust
let color_index = params
    .get("colorIndex")
    .map(parse_optional_color_index)
    .transpose()?;

if name.is_none() && !capture_current_state && color_index.is_none() {
    return Err(String::from(
        "lighting.scene.update requires a name, captureCurrentState, or colorIndex",
    ));
}
```

`LightingSceneUpdateRequest` gains `pub color_index: Option<Option<u8>>`. Outer `Option`: was-the-field-supplied. Inner `Option<u8>`: the new value (None = clear, Some(idx) = set). Mirrors the existing pattern on `LightingFixtureUpdateRequest.group_id: Option<Option<String>>`.

Handler in `update_lighting_scene` ([scenes.rs:142-203](native/rust-engine/src/lighting/scenes.rs:142)):

```rust
if let Some(color_index) = request.color_index {
    scene.color_index = color_index;  // None or Some(idx)
}
```

### `lighting.group.update` (extended + relaxed)

Currently requires `name` ([parse.rs:319-334](native/rust-engine/src/lighting/parse.rs:319)). Relax: `name` becomes optional; require at least one of `name` or `colorIndex`.

Parser:

```rust
let name = params
    .get("name")
    .map(|value| parse_required_group_name(Some(value)))
    .transpose()?;
let color_index = params
    .get("colorIndex")
    .map(parse_optional_color_index)
    .transpose()?;

if name.is_none() && color_index.is_none() {
    return Err(String::from(
        "lighting.group.update requires a name or colorIndex",
    ));
}
```

`LightingGroupUpdateRequest`: `name: String` → `name: Option<String>`. `color_index: Option<Option<u8>>` added.

Handler in `update_lighting_group` ([groups.rs:41-84](native/rust-engine/src/lighting/groups.rs:41)) updates whichever fields were supplied; summary text adapts (`renamed` / `recolored` / `updated` based on which fields changed).

Backward compatibility: existing callers always send `name` — relaxation is additive and safe. Frontend `updateLightingGroup` invocations from PR #41 / Wave 17 keep working.

### Shared helper: `parse_optional_color_index`

```rust
pub(super) fn parse_optional_color_index(value: &Value) -> Result<Option<u8>, String> {
    if value.is_null() {
        return Ok(None);
    }
    let raw = value
        .as_i64()
        .ok_or_else(|| String::from("colorIndex must be an integer 0..7 or null"))?;
    if !(0..=7).contains(&raw) {
        return Err(String::from("colorIndex must be an integer 0..7 or null"));
    }
    Ok(Some(raw as u8))
}
```

## Test plan

The plan doc and orientation brief specified **5 tests**. Wave 23 PR #42 was a follow-up specifically to fill an under-tested IPC surface (lighting subset 15 → 27, +12 tests). For Wave 30a I'm proposing a **decision** between:

- **Option α (5 tests, brief-aligned)** — minimum viable, lighting subset 32 → 37:
  1. `lighting_scene_color_round_trip` — set + clear via `lighting.scene.update`; snapshot reflects.
  2. `lighting_group_color_round_trip` — set + clear via `lighting.group.update`; snapshot reflects.
  3. `lighting_group_reorder_move_before_anchor` — handler moves id to anchor's position.
  4. `lighting_group_reorder_move_to_end` — handler with `None` anchor pushes to end.
  5. `lighting_normalize_populates_group_order_for_legacy_state` — empty `group_order` rebuilds from groups insertion order; orphans drop on load.

- **Option β (9 tests, scene-parity)** — matches scene reorder + pin coverage as it stands today, lighting subset 32 → 41:
  - All 5 of α, **plus**:
  6. `lighting_group_reorder_parser_accepts_valid_payloads` — anchor / null / omitted / blank / trimmed.
  7. `lighting_group_reorder_parser_rejects_invalid_payloads` — empty / blank / non-string / self-anchor / numeric anchor.
  8. `lighting_group_reorder_rejects_unknown_ids` — unknown group + unknown anchor → `LIGHTING_GROUP_NOT_FOUND`.
  9. `lighting_group_update_parser_relaxation` — name-only, color-only, both, neither (rejects).

  Plus optionally a 10th: `lighting_scene_update_parser_accepts_color_only` — confirms the relaxed at-least-one rule for the scene update path.

**Recommendation: Option β (9–10 tests).** Reasons:

- PR #42 set the precedent: parser tests + handler tests + reject-path tests + normalize tests are the standing bar for IPC additions in lighting.
- The new `lighting.group.reorder` parser is a duplicate of the scene one; mirroring its tests is mechanical (~20 LOC each) and protects against silent drift if the helpers diverge.
- The group-update parser relaxation is a contract change (name was required); test coverage for the new relaxed semantics is cheap and high-value.
- Test floor 123 → 132 engine, lighting subset 32 → 41. Still well under any meaningful budget.

If user prefers minimum viable for shipping speed, Option α is fine — the deferred parser/reject tests can ship as a follow-up PR (the PR #42 pattern).

## Surface area summary

| Layer               | File                                                                                                                                                         | Change                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine types        | [native/rust-engine/src/lighting/types.rs](native/rust-engine/src/lighting/types.rs)                                                                         | +`color_index` on 2 persisted structs + 2 snapshot structs; +`group_order` on `LightingEditorState`; +`LightingGroupReorderRequest` / `LightingGroupReorderResult`; relax `LightingGroupUpdateRequest.name` to `Option<String>`; add `color_index` to scene/group update requests. |
| Engine load-time    | [native/rust-engine/src/lighting/editor_state.rs](native/rust-engine/src/lighting/editor_state.rs)                                                           | `default_lighting_editor_state` populates `group_order`; `normalize_lighting_editor_state` rebuilds `group_order` + clamps `color_index`; snapshot helpers expose color.                                                                                                           |
| Engine handlers     | [native/rust-engine/src/lighting/scenes.rs](native/rust-engine/src/lighting/scenes.rs)                                                                       | `update_lighting_scene` writes `color_index`.                                                                                                                                                                                                                                      |
| Engine handlers     | [native/rust-engine/src/lighting/groups.rs](native/rust-engine/src/lighting/groups.rs)                                                                       | `update_lighting_group` writes `color_index` + relaxed name; new `reorder_lighting_group`; `create_lighting_group` appends to `group_order`; `delete_lighting_group` removes from `group_order`.                                                                                   |
| Engine parsers      | [native/rust-engine/src/lighting/parse.rs](native/rust-engine/src/lighting/parse.rs)                                                                         | `parse_optional_color_index` helper; extend scene/group update parsers; new `parse_lighting_group_reorder_request`.                                                                                                                                                                |
| Engine snapshot     | [native/rust-engine/src/lighting/snapshot.rs](native/rust-engine/src/lighting/snapshot.rs)                                                                   | Group snapshot loop emits in `group_order` (mirror scene loop at lines 80–106); both scene + group snapshots populate `color_index`.                                                                                                                                               |
| Dispatcher          | [native/rust-engine/src/app.rs](native/rust-engine/src/app.rs)                                                                                               | Wire `lighting.group.reorder` parser + handler.                                                                                                                                                                                                                                    |
| Protocol contract   | [native/protocol/v1.contract.json](native/protocol/v1.contract.json)                                                                                         | Append `lighting.group.reorder` to `methods`.                                                                                                                                                                                                                                      |
| Engine-client TS    | `frontend/packages/engine-client/src/types.ts` + `createShellStore.ts` + dev `fixtureTransport.ts`                                                           | Add `reorderLightingGroup`; extend update request shapes with `colorIndex?: number \| null`.                                                                                                                                                                                       |
| Generated artifacts | `frontend/packages/engine-client/src/generated/snapshots/*` + `frontend/packages/engine-client/src/generated/protocol.ts` + `native/protocol/v1.schema.json` | Regen via `node scripts/protocol/generate-protocol-artifacts.mjs`. Diff intentional.                                                                                                                                                                                               |
| Tests               | [native/rust-engine/src/lighting/tests.rs](native/rust-engine/src/lighting/tests.rs)                                                                         | +5 (Option α) or +9–10 (Option β).                                                                                                                                                                                                                                                 |

## Decisions required (resolve before code)

1. **Test count: α (5) or β (9–10)?** Recommend β.
2. **Group snapshot ordering**: should group snapshots emit in `group_order` (parallel to the scene loop's `scene_order` use)? Recommend yes — closes the asymmetry that motivated F5 in the first place. Snapshot loop change is ~10 LOC. (Unstated in plan doc but follows naturally; flagging for explicit confirmation.)
3. **30a frontend scope**: confirm "engine-client TS only, no UI" — UI ships in 30b. Recommend yes per orientation brief; flag because plan doc §"Wave 30" is more permissive (lists F5/I4 UI in 30a).
4. **Color-index value range**: 0..=7 (8 colors) per I4 spec. Recommend yes; flag because if frontend later wants a 9th "Clear" swatch encoded as a value (instead of `null`), 0..=7 would need expanding. Going with `null = clear` keeps the range unambiguous.

## Validation lanes (30a)

- `npm ci` (worktree fresh install).
- `npm run format:check`.
- `npm run dev:check` — native floor must grow per chosen test option (123 → 128 for α, 123 → 132 for β).
- `npm run native:acceptance`.
- Skip `tauri:dev` interactive review for 30a — no UI changes. Visual review fires in 30b.
- After merge: separate Windows-Claude session against new HEAD with `npm ci` + `dev:check` + `native:acceptance` + `tauri:smoke:win`.

## Risks

- **`group_order` migration off-by-one**: legacy state with mid-life groups (created post-Wave-17 group-create IPC) needs `group_order` to honor the persisted-fixture-derived insertion order from `append_missing_group_states`. The migration code above filters then appends — same idempotent shape Wave 23.B/C used and shipped clean.
- **ts-rs regen drift**: forgotten regen step ships engine field without TS exposure → frontend gets `colorIndex: undefined` even when engine emits a value. Mitigation: regen is a single-script invocation, runs as part of dev:check transitively (TS compile catches missing fields). Wave 29 lesson explicit.
- **Snapshot ordering change for groups**: switching group emission to follow `group_order` is a behavior change for existing operators. Today groups emit in `editor_state.groups` vec order which is roughly insertion order. The migration populates `group_order` from that same insertion order, so ordering is unchanged on first load. Risk-free.
- **Backward-compat on group update**: relaxing `name` to optional breaks no callers (all existing callers pass `name`). Forward-compat preserved by the at-least-one rule.

---

## Out of scope for 30a (lands in 30b)

- `<ColorPicker>` design-system primitive.
- `<EmptyState action?>` extension + a `hasAction` Storybook story.
- SceneTile 4 px color accent bar.
- GroupChip color accent.
- GroupRail dnd-kit reorder UI.
- InspectorScene + InspectorGroup color row.
- StagePlot / SceneRail / GroupRail empty-state CTA wiring (F10).
- Hover preview 300 ms timer (X1).
- P5 mini-graph (decision required at 30b start: ship as alternative-to thumbnail or defer to Wave 32+).

These all consume the engine-client TS surface that 30a ships.
