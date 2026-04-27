---
workspace: lighting
phase: B (direction locked)
status: ready-for-phase-c
chosen_direction: Cr — Spatial desk (refined from Direction C)
audit_refs:
  - docs/archive/UX_AUDIT.md §Lighting workspace
  - docs/archive/UX_AUDIT.md §C7 (scroll rule — closed on lighting content panel)
  - docs/archive/UX_AUDIT.md §Recommendations #11 (Use Add Light dead button — closed)
---

# Lighting — delta spec

> Historical Qt-era reference. This spec was written for the pre-cutover QML implementation and still references removed `native/qt-shell` paths. Use it for product/design rationale only; current implementation truth lives in the Tauri frontend and active engineering docs.

Reference mockups: `docs/redesign/assets/lighting/Lighting-Redesign.html` (three-direction hypothesis — A / B / C) and `docs/redesign/assets/lighting/Lighting-C-Refined.html` (**the locked direction**). Direction C was chosen over A / B, then refined: the original C's stage plot was oversized and starved the other functions (cue list, params, DMX peek). The refinement — **direction Cr — Spatial desk** — shrinks the plot to ~2.1 M px² (−29 %), widens the cue rail to 380 px, replaces floating popovers with a persistent 440 px inspector, and adds a 140 px bottom control strip for groups / scenes / DMX peek.

Direction **Cr — Spatial desk** reframes Lighting around the physical plot: the stage is the workspace. The cue list sits as a run-of-show rail on the left, the plot occupies the center, and a persistent inspector on the right answers "what am I editing?". A 140 px bottom strip carries groups + scenes + a live DMX peek. The three-panel `SplitView` (sidebar / content / spatial) is retired; the 1130-LOC `LightingSidebarPanel.qml` monolith and the 741-LOC `LightingContentPanel.qml` ScrollView wrapper are both deleted.

---

## 1. Layout

Lighting stays a primary workspace under the shell header. The redesigned `LightingWorkspacePanel.qml` owns the full area below the dashboard header at both `2560×1440` and `1920×1080`. The `SplitView` composition is removed — Cr is a fixed five-region grid, no operator-resizable splitters.

### Shell — one workspace, one canvas

There is no mode toggle (Setup's Runner toggle and Planning's Timeline↔Board toggle were mode switches between two fundamentally different views; Cr is a single view with contextual overlays). The optional **Commissioning overlay** (patch mode) is reached via `P` or the `Patch` button in the toolbar and takes over the stage canvas; it is not a separate mode in the toolbar-tab sense.

### Region grid — `2560×1440`

| Region                 | Size                 | Notes                                                                                                                                                                                                             |
| ---------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar                | full × 44 px         | `toolbarHeight`. From left: workspace title + health chip · DMX universe + `reachable` chip · 4-stat chip row (Fixtures / On / Groups / Cues) · search · `Patch` · **`+ Fixture`** primary · kebab overflow.      |
| Cue rail (left)        | 380 × (1440−44−140)  | Run-of-show cue list. Top: `GO` bar (64 px). Middle: scrollable cue list (each cue 56 px tall, status-tinted left bar, fade-in / follow meta). Bottom: `+ Cue` ghost button. One active cue at a time.            |
| Stage plot (center)    | 1740 × (1440−44−140) | Anchor. Renders the physical room: walls, stage outline, grid, camera positions, fixtures at their `spatialX / spatialY`, beam cones, selection lasso. `parityFrozen` gated for Quick Effects glow.               |
| Inspector (right)      | 440 × (1440−44−140)  | Persistent. Auto-switches tab by selection: Fixture (single) / Group (multi) / Cue (no selection, shows delta vs previous cue) / Patch (commissioning overlay). No popover variant.                               |
| Control strip (bottom) | full × 140 px        | Three columns: **Groups** (380 + left-col pad), **Scenes** (center block under plot — matches 1740 px), **DMX peek** (440 under inspector). Groups and scenes render as chip rows; DMX peek is a 12-ch hex strip. |

At `2560×1440` with the shell header (existing) at 80 px, the body budget is `1440 − 80 = 1360 px`. Toolbar 44 + strip 140 = 184. Stage plot + cue rail + inspector share `1360 − 184 = 1176 px` vertical. Horizontal at 2560: `380 + 1740 + 440 = 2560` ✓. No `ScrollView` wrapper anywhere — `§C7` rule.

### Region grid — `1920×1080` fallback

Proportional collapse:

| Region        | Size                 | Notes                                                                                                                 |
| ------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Toolbar       | full × 44 px         | Identical; the kebab overflow absorbs anything that wraps.                                                            |
| Cue rail      | 320 × (1080−44−112)  | Reduced from 380. Cue rows compact to 48 px; `GO` bar compacts to 56 px.                                              |
| Stage plot    | 1240 × (1080−44−112) | Reduced from 1740 (−500). The plot is still the largest region at 3.1× the inspector; grid ticks halve their density. |
| Inspector     | 360 × (1080−44−112)  | Reduced from 440. Tab labels drop their supporting eyebrow; value rows stay full-width.                               |
| Control strip | full × 112 px        | Groups and DMX peek columns match the cue rail / inspector widths; scenes column centers on the plot.                 |

Horizontal: `320 + 1240 + 360 = 1920` ✓. Both budgets respect the **no scroll** rule.

## 2. States

Nine operator-visible states. Seven are explicitly storyboarded in `Lighting-C-Refined.html`; two more are required by the audit (snapshot loading, zero-filter result).

| State                         | Stage plot                                                                                                                                                                 | Rail / inspector / strip                                                                                                                                                                                 | Trigger                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Snapshot loading**          | Stage outline + grid render; fixture layer renders as 3 ghosted circles pulsing `studio800`.                                                                               | Rail shows 4 shimmer cue rows; inspector renders the Cue-preview tab with shimmer bars; DMX peek renders as a blank 12-ch strip.                                                                         | `!appSnapshotLoaded` or `lightingSnapshotLoaded === false`. Required by audit (no dedicated snapshot-loading shimmer today). |
| **Healthy (default)**         | Fixtures rendered at `spatialX / spatialY`, beam cones on for `on === true`, CCT-tinted per fixture; NOW-cue fixtures glow `accentPrimaryGlow` (gated `parityFrozen`).     | Rail: active cue highlighted at `accentPrimarySoft`; inspector shows active Fixture / Cue tab; strip shows groups + scenes + live DMX.                                                                   | `appSnapshotLoaded && lightingFixtureCount > 0`. Mockup state **Cr-00 / hero**.                                              |
| **GO pressed (cross-fade)**   | Previous cue's fixtures fade out while next cue's fade in; 4 px `accentPrimary` border pulses around the plot for the first 500 ms.                                        | Rail: NOW pointer advances one row; old active cue dims to `studio600`; `GO` bar shows `GOING → Cue 14` with a progress fill.                                                                            | Operator presses `Space` or clicks `GO`. Mockup state **Cr-01**.                                                             |
| **Multi-select (lasso)**      | Drag-lasso rendered as `accentPrimarySoft` rectangle; selected fixtures get a 2 px `accentPrimary` ring.                                                                   | Inspector auto-switches to **Group** tab showing aggregate intensity / CCT (min–max range if heterogeneous) + `Save as Group…` ghost button.                                                             | `Shift+drag` on the plot. Mockup state **Cr-02**.                                                                            |
| **Section view (zoom)**       | Plot zooms to a saved section; non-section fixtures dim to `studio500` at 30 % alpha; section name pill renders top-center.                                                | Rail + inspector + strip unchanged.                                                                                                                                                                      | `1`–`9` selects a section (if saved); `Esc` returns to full plot. Mockup state **Cr-03**.                                    |
| **Commissioning (patch)**     | Stage outline renders in `studio700`; fixture layer dims to 40 %; a translucent patch overlay lists candidate DMX addresses and lets the operator drag-drop onto fixtures. | Inspector auto-switches to **Patch** tab: fixture `name`, `type`, `dmxStartAddress`, `universe`, `rig height`, `beam angle`, and an `Identify` burst button.                                             | Operator presses `P` or clicks `Patch`. Mockup state **Cr-04**.                                                              |
| **DMX unreachable**           | Stage + fixtures render as before; every fixture gets a subtle `accentRed` 1 px border.                                                                                    | Toolbar universe chip flips to `accentRed DMX unreachable`; DMX peek shows last-known values grayed to `studio500` with a `STALE ts` timestamp; `GO` bar disabled with copy _"No DMX — connect bridge"_. | `lightingHealth.reachable === false`. Mockup state **Cr-05**.                                                                |
| **Empty (first open)**        | Stage outline + grid render; fixture layer empty.                                                                                                                          | Rail: single centered `ConsoleSurface tone: "soft"` card _"No cues yet. Press `C` to add one."_; inspector: Fixture tab blanked with _"Add a fixture to begin."_ + `+ Fixture` CTA.                      | `lightingFixtureCount === 0`. Mockup state **Cr-06**.                                                                        |
| **Zero-filter / zero-search** | Fixtures matching the filter render at full intensity; non-matching fixtures dim to 20 %.                                                                                  | Rail dimmed under the filter; overlay chip top-center: _"Search: 'kino' · 0 of 14"_ with `CLEAR` ghost button.                                                                                           | `lightingSearchQuery.length > 0 && lightingSearchHitCount === 0`. Required by audit (no zero-result state today).            |

`parityFrozenClock` pins the show clock at `19:42:00 UTC` for parity capture; running-fixture pulse and cross-fade animation land at a specific phase on that clock.

## 3. New / modified tokens and component variants

### Tokens — `ConsoleTheme.qml`

All additive. Builds on the planning-era additions (`timelineTrack`, etc.) without touching them.

| Token                     | Value                                    | Rationale                                                                                          |
| ------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `stageCanvas`             | `= surfaceDefault` (alias)               | Named alias so QML reads `color: theme.stageCanvas`. One token if the plot background ever shifts. |
| `stageOutline`            | `= surfaceBorderStrong` (alias)          | Wall / stage perimeter stroke on the plot.                                                         |
| `stageGridLine`           | `Qt.rgba(studio500.r, .g, .b, 0.08)`     | 1 m grid ticks.                                                                                    |
| `stageGridMajor`          | `Qt.rgba(studio500.r, .g, .b, 0.14)`     | 5 m grid ticks.                                                                                    |
| `stageSelectionFill`      | `Qt.rgba(accentPrimary.r, .g, .b, 0.14)` | Lasso rectangle fill.                                                                              |
| `stageSelectionStroke`    | `accentPrimary`                          | 2 px fixture selection ring.                                                                       |
| `cueActiveTint`           | `accentPrimarySoft`                      | Active cue row fill in the rail.                                                                   |
| `cueNextHint`             | `Qt.rgba(accentPrimary.r, .g, .b, 0.06)` | Upcoming (next-to-fire) cue row fill.                                                              |
| `dmxReachableTint`        | `Qt.rgba(accentGreen.r, .g, .b, 0.14)`   | DMX universe chip fill when reachable.                                                             |
| `dmxUnreachableTint`      | `Qt.rgba(accentRed.r, .g, .b, 0.14)`     | DMX universe chip fill when unreachable; fixture border color when stale.                          |
| `beamConeTint`            | `Qt.rgba(accentPrimary.r, .g, .b, 0.18)` | Beam-cone base alpha. CCT-tinted variants multiply by `kelvinToColor()`.                           |
| `stagePlotMinHeight`      | `880` (px)                               | Hard floor for the plot content at `1920×1080`.                                                    |
| `cueRailWidth2k`          | `380` (px)                               | Cue rail width at `2560×1440`.                                                                     |
| `cueRailWidth1080`        | `320` (px)                               | Cue rail width at `1920×1080`.                                                                     |
| `inspectorWidth2k`        | `440` (px)                               | Inspector width at `2560×1440`.                                                                    |
| `inspectorWidth1080`      | `360` (px)                               | Inspector width at `1920×1080`.                                                                    |
| `controlStripHeight2k`    | `140` (px)                               | Bottom strip at `2560×1440`.                                                                       |
| `controlStripHeight1080`  | `112` (px)                               | Bottom strip at `1920×1080`.                                                                       |
| `cueRowHeight`            | `56` (px)                                | Cue row in the rail.                                                                               |
| `cueRowHeightCompact`     | `48` (px)                                | Cue row at `1920×1080`.                                                                            |
| `fixtureDotRadius`        | `14` (px)                                | Plotted fixture hit-target radius.                                                                 |
| `fixtureDotRadiusCompact` | `11` (px)                                | Plotted fixture radius at `1920×1080`.                                                             |

Already-shipped tokens reused verbatim: `studio*`, `accent*`, `radiusBadge / radiusCard / radiusSurface`, `spacing2–10`, `controlHeight / compactControlHeight / toolbarHeight`, `textXxs / Xs / Sm / Md / Lg`, `elevation1* / elevation2*`, `focusRing*`, `accentPrimarySoft / accentPrimaryGlow`, `timelineNowTint` (reused for the `GO`-bar progress fill), `statusColor()`.

### Component variants — `Console*`

Additive, shipped as part of this workspace's PR. **Seven new primitives** + two existing variants:

| Component             | New variant or additive property                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Usage                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `ConsoleStagePlot`    | **New component.** Stage canvas. Props: `fixtures: [{id, name, x, y, rotation, intensity, cct, on, kind, groupId}]`, `sectionBounds`, `selectionIds: [id]`, `commissioningActive: bool`, `parityFrozen: bool`. Renders: outline, 1 m + 5 m grid, fixture dots with CCT-tinted fill + beam cones when `on`, selection lasso, zoom/section overlay, identify burst. Signals: `onFixtureClicked(id)`, `onLassoReleased([ids])`, `onFixtureDragReleased(id, x, y)`, `onSectionRequested(id)`. | Stage region.                               |
| `ConsoleCueRail`      | **New component.** Run-of-show rail. Props: `cues: [{id, label, fadeInMs, fadeOutMs, followSeconds, sceneId, notes, state}]`, `activeCueId`, `nextCueId`. Signals: `onGo()`, `onBack()`, `onCueSelected(id)`, `onCueEdit(id)`, `onCueDelete(id)`, `onCueAdded(ordinal)`. Renders `GO` bar at top with progress fill during cross-fade. Keyboard: `Space` → GO, `Backspace` → BACK, `↑/↓` → move selection.                                                                                | Left rail.                                  |
| `ConsoleGoBar`        | **New component.** 64 px / 56 px `GO` / `BACK` pair + cue preview. Props: `activeCueLabel`, `nextCueLabel`, `progress: real` (0..1 during cross-fade), `disabled: bool`. Emits `onGo()`, `onBack()`.                                                                                                                                                                                                                                                                                      | Top of cue rail.                            |
| `ConsoleInspector`    | **New component.** Tabbed, 440 / 360 wide. Props: `mode: string` (fixture / group / cue / patch — auto-computed from `selectionIds.length` and `commissioningActive`), `selectionIds`, `cueDelta`, `engine`. Body delegates to one of four sub-layouts. Selection-driven tab switch is internal — external callers do not set `mode`.                                                                                                                                                     | Right region.                               |
| `ConsoleFixtureBadge` | **New component.** Plotted fixture marker. Props: `cct: int`, `intensity: int`, `on: bool`, `rotation: real`, `selected: bool`, `stale: bool`, `kind: string`, `label: string`. Styles: fill = `kelvinToColor(cct) * intensity/100` in `parity`-safe Rectangle form, beam cone as a `Canvas` or `Shape` arc, selection ring as 2 px `accentPrimary` border, stale = `accentRed` 1 px border. `parityFrozen` gates the MultiEffect glow.                                                   | Inside `ConsoleStagePlot`.                  |
| `ConsoleDmxPeek`      | **New component.** 12-channel live DMX strip. Props: `channels: [{index, value, stale, universe}]`, `stale: bool`. Renders a mono-font hex column row; per-channel bar fills in `accentPrimary` scaled to value/255. Signals: `onChannelClicked(index)` (opens full-universe DMX monitor — the existing `LightingDmxMonitorPanel.qml` modal content is re-hosted here).                                                                                                                   | Bottom strip — DMX column.                  |
| `ConsoleChipRow`      | **New component.** Horizontal scroll-free chip row with compression. Props: `items: [{id, label, tone, meta, active}]`, `maxVisible: int`. When `items.length > maxVisible`, appends a `+N` overflow chip that opens a popover menu. No `ScrollView` — compression only.                                                                                                                                                                                                                  | Groups column + scenes column in the strip. |
| `ConsoleButton`       | Reuse existing `tone: "workspaceTab"` (shipped `b53fb18`) for cue-rail header tabs (if we land the Groups-inside-rail variant). No new tone this PR.                                                                                                                                                                                                                                                                                                                                      | Cue rail header.                            |
| `ConsoleStatChipRow`  | Reuse from Planning (`68ecbd3`). New `tone: "ok"` / `tone: "warn"` not needed — already present.                                                                                                                                                                                                                                                                                                                                                                                          | Toolbar stat row.                           |

No existing `Console*` component gets a breaking change. All old props / tones remain registered. The 1130-LOC `LightingSidebarPanel.qml` and 741-LOC `LightingContentPanel.qml` are **not components** — they are workspace-specific panels that get deleted, not refactored (§10).

### JS helper — `LightingParityHelpers.js`

Extend with a canonical `kelvinToColor(k)` helper so the CCT ramp is one function, not six copies. Today the ramp is duplicated in `LightingSidebarPanel.qml:50–72`, `LightingSpatialPlotPanel.qml`, and `LightingContentPanel.qml`. The new helper returns a `color` object for any `k` in the 2700–6500 K range, with the existing thresholds preserved (`3200 → #ffb35c`, `4400 → #ffd38b`, `>4400 → #eaf0ff`) but linearly interpolated between them. `ConsoleFixtureBadge` and `ConsoleStagePlot` call this helper.

## 4. Dependencies needed

**None.**

- Lucide SVG icon set — already bundled (`0300988`). Reuses `spotlight`, `zap` (live-DMX), `zap-off` (DMX-unreachable), `play` / `skip-back` (GO / BACK), `crosshair` (section-view toggle), `grid-2x2` (stage-grid toggle), `plus-circle` (add-fixture / add-cue), `settings` (patch mode), `eye` / `eye-off` (identify-burst).
- QtQuick.Effects — Qt 6.5 floor; used for active-fixture glow and cross-fade rim pulse. **Every usage gated behind `parityFrozen`** per the Planning caveat.
- QtQuick.Shapes — used for beam-cone arcs and the lasso rectangle.

**Not introduced**: QtQuick3D (the plot is 2-D top-down), QtCharts, third-party QML libraries, no new fonts, no external beam-cone math library (simple polar geometry in-QML).

## 5. Engine surface delta

All additions are additive; no existing surface is broken.

### 5a. Persistence — blob path (decided during Phase C commit 1)

**Decision: blob path.** The whole lighting subsystem is already stored as JSON blobs under `app_settings` keys (`LIGHTING_EDITOR_STATE_KEY`, `LIGHTING_BRIDGE_IP_KEY`, etc.) — there is no `lighting_fixtures` table and no `lighting_scenes` table to ALTER. Promoting lighting to first-class SQLite tables is out of scope for the v2.2 redesign; changing the schema to add two tables just for cues would leave the rest of the subsystem on the blob path, split the authoritative source, and break the rollback-by-reinstall guarantee. We take the Phase B scope-note escape and keep everything additive on the blob.

Two additive blob keys:

- `app.lighting.cues` — JSON array of `LightingEditorCueState`.
- `app.lighting.active_cue_id` — single cue id string (empty = no active cue).

Two additive fields on the existing `LightingEditorFixtureState` blob (serde-default so pre-v2.2 JSON deserializes cleanly without migration):

- `rigZ: Option<f64>` — vertical rig height in meters, clamped 0.0–20.0.
- `beamAngleDegrees: Option<f64>` — beam angle, clamped 1.0–180.0.

For the current fixed studio hardware profile, `pan/tilt` defaults are explicitly out of scope. This phase does not add moving-head parameters to the native contract or the replacement-shell inspector.

No `STORAGE_SCHEMA_VERSION` bump, no ALTER TABLE, no new tables. Rollback to v2.1.x silently drops the new blob keys (the old binary ignores unknown settings keys) and ignores the new fixture fields (serde on the v2.1 shape would read the blob and the unknown fields are skipped). Forward-compat is free because everything is optional.

### 5b. Rust types — `native/rust-engine/src/lighting.rs`

Extend `LightingFixtureSnapshot` + `LightingEditorFixtureState` (additive; serde-default so pre-v4 data deserializes cleanly):

```rust
#[serde(rename = "rigZ", default)]
pub rig_z: Option<f64>,
#[serde(rename = "beamAngleDegrees", default)]
pub beam_angle_degrees: Option<f64>,
```

Add new cue types:

```rust
#[derive(Debug, Serialize, Clone)]
pub struct LightingCueSnapshot {
    pub id: String,
    pub ordinal: i64,
    pub label: String,
    #[serde(rename = "sceneId")]
    pub scene_id: Option<String>,
    #[serde(rename = "fadeInMs")]
    pub fade_in_ms: i64,
    #[serde(rename = "fadeOutMs")]
    pub fade_out_ms: i64,
    #[serde(rename = "followSeconds")]
    pub follow_seconds: Option<f64>,
    pub notes: Option<String>,
    pub state: String,             // "pending" | "active" | "fired"
}
```

Extend `LightingSnapshot` with:

```rust
pub cues: Vec<LightingCueSnapshot>,
#[serde(rename = "activeCueId", default)]
pub active_cue_id: Option<String>,
```

### 5c. Rust mutations — new handlers in `lighting.rs`

Four new request / result pairs and four IPC methods:

```rust
// cue.create
pub struct LightingCueCreateRequest {
    pub label: String,
    #[serde(rename = "afterCueId")]
    pub after_cue_id: Option<String>,    // None → append
    #[serde(rename = "sceneId")]
    pub scene_id: Option<String>,
    #[serde(rename = "fadeInMs")]
    pub fade_in_ms: Option<i64>,
    #[serde(rename = "fadeOutMs")]
    pub fade_out_ms: Option<i64>,
    #[serde(rename = "followSeconds")]
    pub follow_seconds: Option<f64>,
    pub notes: Option<String>,
}
pub struct LightingCueCreateResult { pub cue: LightingCueSnapshot }

// cue.update (all fields double-Option for partial updates — matches existing pattern)
pub struct LightingCueUpdateRequest {
    pub id: String,
    pub label: Option<String>,
    pub scene_id: Option<Option<String>>,
    pub fade_in_ms: Option<i64>,
    pub fade_out_ms: Option<i64>,
    pub follow_seconds: Option<Option<f64>>,
    pub notes: Option<Option<String>>,
    pub ordinal: Option<i64>,               // server re-sequences neighbors
}
pub struct LightingCueUpdateResult { pub cue: LightingCueSnapshot }

// cue.delete
pub struct LightingCueDeleteRequest { pub id: String }
pub struct LightingCueDeleteResult { pub id: String }

// cue.fire (GO / BACK / jump)
pub struct LightingCueFireRequest {
    pub id: String,                         // the cue being activated
    #[serde(rename = "fadeOverrideMs")]
    pub fade_override_ms: Option<i64>,       // None = use cue's fadeInMs
}
pub struct LightingCueFireResult {
    pub active_cue_id: String,
    #[serde(rename = "previousCueId")]
    pub previous_cue_id: Option<String>,
    #[serde(rename = "appliedFadeMs")]
    pub applied_fade_ms: i64,
}
```

IPC actions registered:

- `lighting.cue.create`
- `lighting.cue.update`
- `lighting.cue.delete`
- `lighting.cue.fire`

`lighting.cue.fire` internally invokes the existing `recall_lighting_scene` path when `scene_id.is_some()`, so the DMX-emit code path is reused. `previous_cue_id` lets QML animate the cross-fade rim without re-reading the snapshot.

### 5d. C++ adapter — `native/qt-shell/src/EngineProcess.*`

Four new `Q_INVOKABLE` methods (all mirror existing lighting-mutation signatures in the adapter — JSON params, returns are emitted via existing result signals):

```cpp
Q_INVOKABLE void createLightingCue(const QVariantMap& params);
Q_INVOKABLE void updateLightingCue(const QVariantMap& params);
Q_INVOKABLE void deleteLightingCue(const QString& id);
Q_INVOKABLE void fireLightingCue(const QString& id,
                                 const QVariant& fadeOverrideMs);   // QVariant::Invalid to use cue default
```

One new `Q_PROPERTY` on the `EngineProcess` / lighting-adapter surface:

```cpp
Q_PROPERTY(QVariantList lightingCues READ lightingCues NOTIFY lightingCuesChanged)
Q_PROPERTY(QString lightingActiveCueId READ lightingActiveCueId NOTIFY lightingActiveCueIdChanged)
```

Fires the `lightingCuesChanged` / `lightingActiveCueIdChanged` signals whenever a snapshot update lands. QML binds `ConsoleCueRail.cues` and `ConsoleCueRail.activeCueId` to these properties.

### 5e. What engine surface **does not** need to change

- `lightingSnapshot` / `lightingFixtures` / `lightingGroups` / `lightingScenes` / `lightingHealth` / `lightingDmxMonitor` — all reused as-is. Cues are an additive property; scene recall is reused by `cue.fire`.
- All existing fixture / group / scene mutations (`createLightingFixture`, `updateLightingFixture`, `deleteLightingFixture`, `setLightingAllPower`, `setLightingGroupPower`, `createLightingGroup`, `updateLightingGroup`, `deleteLightingGroup`, `updateLightingSettings`, `createLightingScene`, `updateLightingScene`, `deleteLightingScene`, `recallLightingScene`) — reused as-is. Scene recall is still a valid operator action (e.g. from the strip's scenes column) independent of the cue stack.
- `legacy_import.rs` — untouched (§6).

## 6. Persistence migration plan (explicit)

This is the explicit migration plan CLAUDE.md requires for on-disk format changes. Under the §5a blob-path decision, the _"migration"_ is the absence of one — no schema version bump, no ALTER TABLE, no new tables.

**What changes on disk**

- New `app_settings` key `app.lighting.cues` — JSON array of cue state. Written on first cue creation; absent (== empty cue stack) until then.
- New `app_settings` key `app.lighting.active_cue_id` — single cue id string. Written on first cue fire; absent (== no active cue) until then.
- The existing `LightingEditorState` blob (`app.lighting.editor_state`) gains two additive optional fields per fixture (`rigZ`, `beamAngleDegrees`). Serde defaults apply, so pre-v2.2 blobs deserialize with both fields `None`.
- `STORAGE_SCHEMA_VERSION` **does not change**. No `schema_migrations` row is inserted.

**Forward path (v2.2 planning-only → v2.2.0 full redesign)**

1. First launch reads `app.lighting.editor_state` as before — the JSON blob deserializes cleanly because `rigZ` and `beamAngleDegrees` are `#[serde(default)]`. No startup migration step runs.
2. All existing fixtures end up with `rig_z = None` and `beam_angle_degrees = None`. QML treats `None` as "use fixture-type default" (a static map keyed off `fixture_type` — Astra Bi-Color ≈ 50°, Infinibar ≈ 110°, etc.). No UI nag.
3. `app.lighting.cues` is absent. `load_lighting_cues()` returns an empty Vec. QML renders the **empty state Cr-06**: the cue rail shows the _"No cues yet"_ card and prompts `C` to add one.
4. No user data is altered; this is a pure extension.

**Rollback path (v2.2.0 → earlier v2.2 or v2.1.x)**

1. Older binary reads `app_settings` with no knowledge of `app.lighting.cues` or `app.lighting.active_cue_id`. The entries sit in the table, unread. No query fails.
2. Older binary reads `app.lighting.editor_state` and deserializes into its own `LightingEditorFixtureState` shape. `rigZ` / `beamAngleDegrees` are unknown fields to it — serde ignores them by default (no `deny_unknown_fields` in the struct).
3. The **first time** the older binary writes `app.lighting.editor_state` back (e.g., on any fixture mutation), the two new fields are dropped from the blob. Cue keys survive untouched because the older binary never touches them.
4. Result: rolling back to an earlier version loses the **cue rail UI** but does **not** lose the cue data — the `app.lighting.cues` blob persists silently and re-appears the next time v2.2.0 is installed. `rigZ` / `beamAngleDegrees` are lost on the next fixture edit in the older binary; they reset to the fixture-type default on re-upgrade.
5. Caveat for the v2.2.0 release notes: a rollback disables the GO bar (because there is no UI), so the operator reverts to manual scene recall. Acceptable for an emergency rollback flow.

**Backup/export compatibility**

- `exportSupportBackup()` serializes the lighting snapshot via serde — the new fields and the `cues` array are included as additional JSON keys. An older binary re-importing a v2.2-generated backup deserializes the existing fields via serde (ignoring the unknown keys). Operator-visible effect: the backup contains the cue stack; the older binary ignores it; if v2.2 is reinstalled afterward, the cues reappear via the `app.lighting.cues` key that the older binary never touched.

**Legacy import (`legacy_import.rs`)**

- Untouched. Imported fixtures get `rig_z = None`, `beam_angle_degrees = None`; cues never exist for legacy data (the Electron runtime had no cue concept). The operator starts with zero cues and the empty-state **Cr-06** prompt.

**Verification gate**

- New engine unit test `lighting_cue_crud_round_trip_persists_through_snapshot` covers `cue.create / cue.update / cue.delete / cue.fire` plus ordinal reorder, scene_id reference, `LIGHTING_ACTIVE_CUE_ID_KEY` writes on fire and clear-on-delete.
- New engine unit test `lighting_cue_create_rejects_missing_scene` covers the reference-integrity check.
- New engine unit test `lighting_fixture_rig_z_and_beam_angle_round_trip` covers the additive fixture fields through the editor-state blob and snapshot read-back.
- No new QML structural test is required; the existing engine tests are the authoritative gate.

## 7. qsettings continuity

Five persistence considerations:

1. **Existing lighting qsettings** (`nativeLightingWorkspace` scope — `storedViewMode`, `storedShowDmxMonitor`, `storedSidebarPreferredWidth`) — all three keys become **obsolete**. The redesign has no view-mode toggle (`expanded` / `compact` / `spatial` collapsed to one view), no DMX-monitor boolean (DMX peek is always visible in the strip; full-universe monitor is opened via `Ctrl+M` as an overlay over the stage), and no sidebar width (no splitter). We **do not migrate** these — they are read once and ignored on next save. The scope itself (`nativeLightingWorkspace`) stays for the new keys below.
2. **Inspector tab** (`fixture` / `group` / `cue` / `patch`) — deliberately **not persisted**. The tab is always computed from the current selection + `commissioningActive` state. Resetting on every launch is correct.
3. **Section view** — new key `lighting.currentSectionId` (string, nullable, default `null`). Persists the operator's last-selected section across launches. Unknown IDs default to `null`.
4. **Commissioning (patch) mode** — **not persisted**. Always `false` on launch. Going into patch mode is always a deliberate operator choice.
5. **Selected cue** — new key `lighting.selectedCueId` (string, nullable, default `null`). Persists the rail's caret position so an interrupted show resumes where it left off. The `activeCueId` comes from the engine, not qsettings — this key is only about UI caret.

No migration shim is required — the new keys are additive and the retired keys are silently ignored.

## 8. Keyboard shortcuts

Additions and preservations — all routed through `OperatorShortcutLayer.qml`. Today the lighting workspace has only `L` (focus workspace) and `Ctrl+M` (toggle DMX monitor); the rest are additive.

| Shortcut    | Context                        | Action                                                                                                           | Existing / New                                                  |
| ----------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `L`         | Global                         | Focus Lighting workspace.                                                                                        | Existing — preserved.                                           |
| `Ctrl+M`    | Lighting                       | Toggle full-universe DMX monitor overlay (the legacy `LightingDmxMonitorPanel` content re-hosted as an overlay). | Existing — preserved.                                           |
| `Space`     | Lighting                       | Fire next cue (`GO`). Calls `fireLightingCue(nextCueId, null)`.                                                  | **New**                                                         |
| `Backspace` | Lighting                       | Fire previous cue (`BACK`).                                                                                      | **New**                                                         |
| `C`         | Lighting                       | Add a cue after the currently selected one (or append if none selected).                                         | **New**                                                         |
| `E`         | Lighting — cue selected        | Edit the selected cue (fade / follow / notes inline in inspector Cue tab).                                       | **New**                                                         |
| `F`         | Lighting                       | Add a fixture — opens `LightingFixtureDialog`.                                                                   | **New — replaces dead "Use Add Light" button (audit Rec #11).** |
| `P`         | Lighting                       | Toggle commissioning (patch) overlay.                                                                            | **New**                                                         |
| `G`         | Lighting — multi-select        | Save selection as a group (opens a rename prompt in the inspector Group tab).                                    | **New**                                                         |
| `S`         | Lighting — selection non-empty | Save current fixture state as a scene (prompts for name).                                                        | **New**                                                         |
| `1`–`9`     | Lighting                       | Jump to saved section #1–9. No-op if the section is unset.                                                       | **New**                                                         |
| `0`         | Lighting                       | Clear section — return to full plot.                                                                             | **New**                                                         |
| `↑` / `↓`   | Lighting — cue-rail focused    | Move rail caret up / down (does **not** fire cue; cosmetic selection only).                                      | **New**                                                         |
| `←` / `→`   | Lighting — fixture selected    | Nudge fixture position ±0.1 m (diagonal via combos). Writes via `updateLightingFixture`.                         | **New**                                                         |
| `Esc`       | Lighting                       | Cancel lasso / clear selection / exit patch mode (priority order).                                               | **New**                                                         |
| `Enter`     | Lighting — cue selected        | Fire the selected cue regardless of its ordinal (jump). Operator confirm dialog if the cue is >2 steps away.     | **New**                                                         |

Context guard: the lighting keybinds are registered under `root.lightingShortcutsEnabled()` (new helper mirroring `planningShortcutsEnabled()`), which returns `true` iff `engineController.workspaceMode === "lighting"` and no input field has focus. The planning `0`-key ambiguity resolution pattern established in the planning delta spec (§8) is reused here — the Board-mode / Timeline-mode guard already sets the precedent for scope-routing by workspace-mode sub-state.

## 9. Parity impact

**All existing Lighting parity baselines invalidate.** Expected — there is only one today (`lighting-populated.png`), and it is rebaselined against the new layout.

The workspace PR adds parity scenes to `scripts/native-parity-capture.mjs`:

| New scene                      | Engine scene? | Purpose                                                                                                                                                   |
| ------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lighting-cr-hero`             | engine        | Healthy show at 19:42: 14 fixtures, active cue 13 of 20, one group selected. Rebaseline of the legacy `lighting-populated` scene under the new Cr layout. |
| `lighting-cr-cue-recall`       | engine        | Mid-cross-fade frame. `parityFrozenClock` pins the progress fill to 50 %; the rim pulse lands at its peak alpha via the same frozen clock.                |
| `lighting-cr-multi-select`     | harness       | 3 fixtures lasso-selected; inspector switched to Group tab showing aggregate ranges. The lasso rectangle is frozen mid-drag at `parityFrozenClock`.       |
| `lighting-cr-section-view`     | engine        | Section "Stage-Left" active; non-section fixtures dimmed to 30 %; section name pill visible.                                                              |
| `lighting-cr-patch-mode`       | engine        | Commissioning overlay active; one candidate DMX address dragged onto a fixture; inspector in Patch tab.                                                   |
| `lighting-cr-dmx-unreachable`  | engine        | `lightingHealth.reachable === false`. Toolbar universe chip in unreachable tint; `GO` bar disabled; fixture borders in `accentRed`.                       |
| `lighting-cr-empty-first-open` | engine        | `lightingFixtureCount === 0`. Cue rail shows the "No cues yet" card; inspector shows the `+ Fixture` CTA.                                                 |
| `lighting-cr-zero-search`      | engine        | `lightingSearchQuery = "kino"` with no hits; dimmed rail + overlay chip with `CLEAR` button.                                                              |
| `lighting-cr-1080-fallback`    | engine        | Full layout at `1920×1080` — gates the proportional collapse. Captured with the fallback capture-harness size per existing convention.                    |

The existing `lighting-populated.png` scene is removed from the manifest (it is superseded by `lighting-cr-hero`). The PR ships a `parity: rebaseline lighting for v2.2 redesign` commit with two bit-identical offscreen `2560×1440` runs on each CI lane (plus the one `1920×1080` fallback capture).

**Determinism caveats carried from Planning Phase C:**

- **No `layer.enabled` / MultiEffect in offscreen capture.** The active-fixture glow and cross-fade rim pulse are both Qt Quick Effects. They are gated behind `parityFrozen` the same way `ConsoleScheduleBlock` gates its pulse — in capture mode the components render flat Rectangle-only styling; runtime gets the full effect.
- **`TZ=UTC` in the capture subprocess.** The show-clock readout in the toolbar is UTC under capture and local at runtime. Acceptable for the operator workstation (also UTC). Cue-fire timestamps use the monotonic clock, not wall time, so they are phase-stable under `parityFrozenClock`.

## 10. `Main.qml` / nav-shell implications

- Lighting stays a primary workspace under the shell header. No dock, no modal takeover. `DashboardHeaderPanel.qml` routing unchanged.
- The redesigned `LightingWorkspacePanel.qml` replaces:
  - the `SplitView` composition (`lines 30-110` today) — removed entirely; replaced by a five-region `Item`-and-anchors grid.
  - the `storedViewMode` / `storedShowDmxMonitor` / `storedSidebarPreferredWidth` qsettings fanout (`lines 45-120`) — removed; replaced by the `lighting.currentSectionId` / `lighting.selectedCueId` keys in §7.
  - the `Ctrl+M` toggle **routing** stays (the binding is re-attached to the new `EngineProcess.lightingDmxMonitorOverlayVisible` property) — the binding itself moves into `OperatorShortcutLayer.qml` next to the other lighting keybinds.
- `LightingSidebarPanel.qml` (1130 LOC) is **deleted**. It was the workspace's monolithic blob — fixture list + group editor + scene rail + effect picker + CCT ramp + DMX chip + power toggles. Every one of those functions has a new home (fixtures on the plot, groups in the strip + inspector Group tab, scenes in the strip, effects in the inspector Fixture tab, CCT in the inspector Fixture tab, DMX in the strip's DMX peek, power as a fixture-inspector toggle).
- `LightingContentPanel.qml` (741 LOC) is **deleted**. It hosted the spatial plot inside a `ScrollView` (audit §C7 rule break on `lines 107-111`) and embedded the dead `Use Add Light` button (`lines 142-145`, audit Rec #11). The new `ConsoleStagePlot` is rendered directly by the workspace panel with no scroll wrapper.
- `LightingSpatialPlotPanel.qml` (950 LOC) — **most of it is extracted into `ConsoleStagePlot.qml`**. The reusable portion (plot drawing, fixture rendering, hit-testing, beam cones) becomes the new component; the workspace-specific portion (toolbar bindings, section management) stays in `LightingWorkspacePanel.qml`. Net outcome: the file is deleted and the 950 LOC redistributes to ~650 LOC in `ConsoleStagePlot` (library) + ~80 LOC in the workspace panel.
- `LightingDmxMonitorPanel.qml` (108 LOC) — **retained**, but no longer rendered inline. Becomes the body of the full-universe DMX monitor overlay (opened by `Ctrl+M` or by clicking the strip's DMX peek). The popover-variant `ConsoleDmxPeek` in the strip is a **separate** new component, not a variant of this panel — the panel is big (`lines 3-108` render a 32×16 channel grid), the peek is a 12-channel strip.
- `LightingToolbarPanel.qml` (175 LOC) — **retained**, with small edits. Its `☰` / overflow kebab stays. The 4-stat row moves to `ConsoleStatChipRow` (pattern reused from Planning). The `Patch` button is added.
- `LightingFixtureDialog.qml` (342 LOC), `LightingDeleteFixtureDialog.qml` (101 LOC) — **untouched**. They are standalone dialogs opened from the inspector Fixture tab (Add Fixture, Delete Fixture). Their internal shape is out of scope for this redesign.
- `LightingParityHelpers.js` — extended additively (`kelvinToColor(k)` — §3).

**File size delta (expected):**

- Deleted: `LightingSidebarPanel.qml` (−1130) + `LightingContentPanel.qml` (−741) + `LightingSpatialPlotPanel.qml` (−950) = **−2821 LOC**.
- Added: `LightingWorkspacePanel.qml` rewrite (target ~350 LOC, down from 196 but absorbing ~200 LOC of composition logic) + 7 new `Console*` components (target ~1700 LOC total, dominated by `ConsoleStagePlot` ≈ 650 and `ConsoleInspector` ≈ 400). = **+~2050 LOC**.
- **Net**: −770 LOC; more importantly, no single file over 700 LOC in the lighting surface.

## 11. Summary of audit findings closed

| Finding                                                                                         | Severity | How Direction Cr resolves it                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §Lighting IA — `LightingSidebarPanel.qml` is 1130 LOC, biggest monolithic file in the workspace | high     | `LightingSidebarPanel.qml` deleted. Its functions redistribute across the inspector, plot, strip, and 7 `Console*` primitives. No single lighting file over 700 LOC after.    |
| §C7 — `LightingContentPanel.qml:107-111` wraps non-spatial content in `ScrollView`              | high     | `LightingContentPanel.qml` deleted. The Cr grid is fixed-height with no scroll wrapper at either budget.                                                                      |
| §Recommendations #11 — "Use Add Light" dead button (LightingContentPanel.qml:142-145)           | blocker  | Button removed with the panel deletion. Add-fixture action is now (a) the toolbar `+ Fixture` primary, (b) the `F` keybind, (c) the inspector Fixture tab CTA in empty state. |
| §Lighting tokens — hard-coded CCT ramp duplicated across three panels                           | medium   | Single canonical `kelvinToColor(k)` in `LightingParityHelpers.js` (§3). Thresholds preserved; callers normalized.                                                             |
| §Lighting states — DMX reachability only shown in header chip, not in-workspace                 | medium   | Reachability surfaces in three places: toolbar universe chip, fixture borders (stale), `GO` bar disabled copy. Covered by parity scene `lighting-cr-dmx-unreachable`.         |
| §Lighting states — no dedicated snapshot-loading shimmer                                        | medium   | Explicit loading state (§2) — ghosted fixture dots + shimmer cue rows + blank DMX strip.                                                                                      |
| §Lighting states — `lightStateColor` ad-hoc per-panel                                           | low      | Replaced by `ConsoleTheme.statusColor()` (already exists) + the new `cueActiveTint` / `cueNextHint` tokens.                                                                   |
| §Lighting interactions — DMX hex raw values as primary surface                                  | medium   | DMX peek renders hex + bar fill (value/255). Operator reads the bar, hex stays as a secondary label. Full-universe monitor remains available on `Ctrl+M`.                     |
| §Lighting interactions — operator must bounce between 3 panels to edit a fixture                | high     | Single plot + single inspector; selecting a fixture on the plot always brings the right controls to the inspector. Zero panel-bouncing for the edit-one-fixture path.         |

## 12. What is explicitly **not** in this PR

- **Directions A and B from the first mockup, and the unrefined Direction C** — not shipped. The HTMLs retain them for archival context; the delta spec locks Direction **Cr** only.
- **`LightingFixtureDialog.qml` (342 LOC) rewrite** — out of scope. The dialog keeps its current shape; the only change is that it is opened from the new inspector tab, the toolbar button, or the `F` keybind rather than from the old sidebar.
- **3-D plot (XYZ + rig-hung)** — out of scope. The plot is 2-D top-down with a stored `rig_z` (for future use). Infinibar PB12 pixel-bar modeling is a follow-up.
- **Cross-universe DMX** — the Cr spec assumes one universe (matches the current bridge config). Multi-universe is a follow-up that will require extending the DMX peek + the universe chip.
- **Cue "link" / "block" / "auto-follow chain" semantics** — the cue model includes `follow_seconds` so auto-advance works, but richer cue-linking (jump-on-condition, GO-range, sub-cues) is a follow-up.
- **Cue import/export** — no import path from the legacy db. Operators rebuild their cue stack in v2.2 (the show is small enough that this is acceptable per §6 / legacy_import).
- **Audio-sync / MTC triggers** — out of scope.
- **Dashboard header DMX chip copy changes** — the chip text already names the universe; the reachability dot logic doesn't change.
- **`LightingToolbarPanel.qml` rewrite** — retained with edits only; a full rewrite is deferred.
- **Board-mode-equivalent "list view"** — Cr is one canvas. There is no tabular-list fallback. If field feedback demands one, it is a follow-up.
