---
workspace: planning
phase: B (direction locked)
status: ready-for-phase-c
chosen_direction: D — Run-of-show timeline (lanes × time, kanban behind ⇧B)
audit_refs:
  - docs/UX_AUDIT.md §Planning workspace
  - docs/UX_AUDIT.md §C8 (identity/hero stack — closed)
  - docs/UX_AUDIT.md §C11 (Planning vs Projects naming — closed)
  - docs/UX_AUDIT.md §Recommendations #10 (workspace vs sidecar — resolved by reframing)
---

# Planning — delta spec

> Historical Qt-era reference. This spec was written for the pre-cutover QML implementation and still references removed `native/qt-shell` paths. Use it for product/design rationale only; current implementation truth lives in the Tauri frontend and active engineering docs.

Reference mockup: `docs/redesign/assets/planning/Planning-Redesign.html` (four directions A / B / C / D; **D is the chosen direction**). Claude Design proposed Direction D as a fourth option beyond the original three hypotheses and it was locked over A / B / C because it pins task #1 from `docs/OPERATIONS.md` ("scan run-of-show at a glance") to the literal UI layout in a way a kanban cannot.

Direction **D — Run-of-show timeline** reframes Planning as a schedule, not a kanban: the x-axis is show time, each project is a horizontal lane, tasks are duration blocks, and a vertical "NOW" playhead tracks the clock. The kanban board is not removed — it moves behind a `⇧B` mode toggle for deep triage. The workspace-vs-sidecar posture question (audit Rec #10) is resolved by dropping both framings: Planning is a schedule.

---

## 1. Layout

Planning stays a primary workspace under the shell header (no dock, no modal takeover — the Dir B sidecar hypothesis is explicitly rejected). The redesigned `PlanningWorkspacePanel.qml` owns the full area below the dashboard header at both `2560×1440` and `1920×1080`.

### Shell — two modes in the same workspace

Planning switches between **Timeline** (default) and **Board** via a small toggle pinned left in the workspace toolbar. This is analogous to the Setup corner-toggle but inline to the toolbar because both modes of Planning are operator-primary (unlike Setup where Support was secondary).

Toggle pair: `[● Timeline]` (active) / `[● Board]`. Both are `ConsoleButton tone: "workspaceTab"` with `active: true` on the visible mode (tone shipped in `b53fb18`). Keyboard: `⇧B` toggles between the two, `⇧T` forces Timeline (see §8).

### Mode 1 — Timeline (default)

| Region                         | Height                                    | Notes                                                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar                        | 44 px                                     | `toolbarHeight`. From left: Timeline/Board toggle · NOW readout + `[` / `●` / `]` nudges · 4-chip stat row (Lanes / On-time / Slipped / Blocked) · search · Time report · Backup · **New project + `N`** primary.     |
| Time scale header              | 36 px                                     | Hour ticks from `timelineStart` to `timelineEnd` (show-day default `09:00–22:00`). Tick at every hour; half-hour minor tick. `ConsoleTimeline` owns rendering.                                                        |
| Lane body                      | remaining                                 | One row per project, height `84` px. Left-column "lane head" 280 px wide carries project title + running-timer badge + task count. Right-column "lane body" carries absolutely-positioned schedule blocks + playhead. |
| Unscheduled tray (collapsible) | 120 px (default collapsed to 28 px strip) | Horizontal strip **below** the lane body. Holds tasks with no `scheduled_start` as card chips. Expanded on hover or focus. Drag-drop into lanes sets `scheduled_start`. See §2 for the unscheduled state.             |

At `2560×1440` with the shell header (existing) at 80 px, the timeline body has `1440 − 80 − 44 − 36 − 28 = 1252 px` of lane-stack budget before the unscheduled tray expands, fitting ~14 lanes at 84 px each. No `ScrollView` wrapper; if lanes exceed the budget the panel **compresses lane height** to `max(48 px, budget / laneCount)` — no scroll (§C7-analogue).

At `1920×1080` fallback: `1080 − 80 − 44 − 36 − 28 = 892 px` → ~10 lanes at 84 px. Same compression rule below that.

### Mode 2 — Board (kanban, reached via `⇧B`)

The kanban is retained for deep triage. Layout is **Direction A's 44 px toolbar + 4-column board** (not today's 4-layer stack). This is a pragmatic reuse of the least-reframed hypothesis — the board UI itself benefits from A's compressed toolbar regardless of which direction ships. Columns: `todo / in-progress / blocked / done`, existing `ConsoleKanbanCard` variant (see §3). The board mode does **not** render the Timeline/Board toggle — it's fixed in the same 44 px toolbar slot.

Board mode is the **only place** `ConsoleKanbanCard` renders in v2.2.0. The timeline uses a different primitive (`ConsoleScheduleBlock`, see §3).

## 2. States

Eight operator-visible states. Four are in the Dir D mockup; four more are required by the audit or by the timeline semantics.

| State                          | Timeline                                                                                                                                                                                                 | Board                                                                                            | Trigger                                                                                                                                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Snapshot loading**           | Scale renders, lanes shimmer with 5 ghosted lanes at `studio800`; NOW playhead hidden until snapshot arrives.                                                                                            | Kanban columns render with 2-card shimmer each.                                                  | `!appSnapshotLoaded` or `planningSnapshotLoaded === false`. Not covered in mockup; required (audit: no-loading-state).                                                                                       |
| **Healthy (default)**          | Lanes + blocks + playhead rendered; running blocks pulse.                                                                                                                                                | 4 columns rendered with cards.                                                                   | `appSnapshotLoaded && planningProjectCount > 0`.                                                                                                                                                             |
| **Empty (no projects)**        | Scale renders; single centered `ConsoleSurface tone: "soft"` card: _"No projects yet. Press `N` to start one."_ Unscheduled tray hidden.                                                                 | Single centered `ConsoleSurface` card with the same copy. Kanban columns render as headers only. | `planningProjectCount === 0`.                                                                                                                                                                                |
| **Zero-filter result**         | Scale + lanes render with blocks dimmed to `studio500`; overlay chip below scale: _"Filter: Blocked · 0 of 14"_ with `CLEAR` ghost button.                                                               | Columns render with a dashed "No blocked tasks" tile per filtered column.                        | `planningViewFilter !== "all" && filteredProjectCount === 0`. Not covered in mockup; required.                                                                                                               |
| **All unscheduled**            | Scale + empty lane body (no blocks rendered); unscheduled tray auto-expanded to 240 px showing all tasks; toolbar shows tip chip: _"Drag into a lane to schedule."_                                      | n/a (board mode hides the tray)                                                                  | All tasks have `scheduled_start = null`. New condition introduced by Dir D.                                                                                                                                  |
| **Past show-day (read-only)**  | Playhead pinned right-edge; scale shows the past day; blocks rendered at final state; toolbar shows `← TODAY` button to snap back.                                                                       | Unchanged.                                                                                       | `timelineDay < todayLocalDate`. Reached via `[` / `]` day-nudge (see §8). Snap back via the `TODAY` button or `0` key.                                                                                       |
| **Block in drag (reschedule)** | Dragged block shows `elevation2Shadow`; a 15-min snap grid becomes visible on the lane body; ghost target slot in `accentPrimarySoft`.                                                                   | n/a                                                                                              | `PointerHandler` drag on a `ConsoleScheduleBlock`. Writes `scheduled_start` on drop via `reschedulePlanningTask(id, ts)`.                                                                                    |
| **Block conflict (overlap)**   | Dropped block whose time window overlaps an existing block on the same lane shows a 300 ms `accentAmber` pulse; tooltip: _"Overlaps 'X'."_ No snap-to-resolve — engine allows overlap, operator decides. | n/a                                                                                              | Engine accepts the write; QML surfaces the overlap detection via a computed property on the lane. Operator recovers by dragging the block to a non-overlapping slot (another `reschedulePlanningTask` call). |

## 3. New / modified tokens and component variants

### Tokens — `ConsoleTheme.qml`

All additive:

| Token                   | Value                                    | Rationale                                                                                                                                      |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `timelineTrack`         | `= surfaceDefault` (alias)               | Named alias for the lane background so QML reads as `color: theme.timelineTrack`. If we ever move the lane fill, one token changes.            |
| `timelineNowTint`       | `Qt.rgba(accentPrimary.r, .g, .b, 0.14)` | Sage-tinted soft band (60 px wide centered on NOW) behind the 4 px vertical playhead line. Doubles as a cross-workspace "current time" marker. |
| `timelineGridLine`      | `Qt.rgba(studio500.r, .g, .b, 0.10)`     | Hour-tick vertical rules on the lane body. Half-hour minor rules use `0.05`.                                                                   |
| `timelineLaneHeight`    | `84` (px)                                | Default lane row height.                                                                                                                       |
| `timelineLaneCompact`   | `48` (px)                                | Minimum lane height under the compression rule (§1).                                                                                           |
| `timelineLaneHeadWidth` | `280` (px)                               | Left column width per lane.                                                                                                                    |
| `timelineScaleHeight`   | `36` (px)                                | Scale-row height.                                                                                                                              |
| `scheduleBlockRadius`   | `= radiusBadge` (6 px alias)             | Alias — schedule blocks reuse badge radius, which is the smallest square-ish shape in the system.                                              |

Already-shipped tokens reused: `studio*`, `accent*`, `radiusBadge / radiusCard`, `spacing2–8`, `controlHeight / compactControlHeight / toolbarHeight`, `textXxs / Xs / Sm / Md`, `elevation1* / elevation2*`, `focusRing*`, `accentPrimarySoft / accentPrimaryGlow`.

### Component variants — `Console*`

Additive, shipped as part of this workspace's PR:

| Component                | New variant or additive property                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Usage                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `ConsoleTimeline`        | **New component.** Lane-based timeline. Props: `start: date`, `end: date`, `clockNow: date`, `lanes: [{ id, title, runningTaskCount, blocks: [{ taskId, start, duration, status, title, meta, running, blocked }] }]`, `selectedBlockId`. Signals: `onBlockClicked(taskId)`, `onBlockDragReleased(taskId, newStart)`. Renders: scale row, lane head column, lane body with blocks + playhead, unscheduled-tray slot. Keyboard: `←/→` nudge selection ±15 min, `↑/↓` move selection lane ±1, `0` snap scale to now, `[`/`]` scroll ±1 hour. | Timeline mode only.                                                                              |
| `ConsoleScheduleBlock`   | **New component.** Individual timeline block. Props: `title: string`, `meta: string`, `status: string` (todo / running / blocked / done), `running: bool`, `selected: bool`, `draggable: bool`. Styles: status-tinted left bar (2 px) + fill (`studio800` base, `accentPrimarySoft` when running, `accentRed` at 20% opacity when blocked, `accentGreen` at 15% when done). Running blocks pulse `accentPrimaryGlow`. Focus ring when selected. `scheduleBlockRadius`.                                                                     | Inside `ConsoleTimeline` lane body.                                                              |
| `ConsoleStatChipRow`     | **New component.** Toolbar-height 4-chip row. Props: `stats: [{ key, label, value, tone }]` where `tone ∈ default / ok / warn / down`. Each chip renders a mono label + mono value at `textXxs` / `textSm`. Height = `compactControlHeight` (30 px). Replaces `PlanningSummaryGrid`.                                                                                                                                                                                                                                                       | Toolbar (both modes); flagged for future Dashboard header use (tracked separately, not this PR). |
| `ConsoleKanbanCard`      | **New component.** Single kanban card. Props: `title`, `meta`, `tags: [string]`, `running: bool`, `blocked: bool`, `handoffTarget: string` (null-OK), `priority: string`. Styles: `surfaceRaised` fill, `radiusCard`, 2 px status-tinted left bar. Running card pulses. Extracted from the board-rebuild so the card is not an inline 936-LOC artifact.                                                                                                                                                                                    | Board mode only.                                                                                 |
| `ConsoleButton`          | New `tone: "workspaceTab"` (if not already present from `b53fb18`; if present, reuse). No other variant change.                                                                                                                                                                                                                                                                                                                                                                                                                            | Timeline / Board toggle pair.                                                                    |
| `ConsoleUnscheduledTray` | **New component.** Horizontal collapsible strip. Props: `tasks: [{id, title, estimateSeconds, priority}]`, `expanded: bool`. Emits `onExpandedChanged`, `onTaskDragStarted(taskId)`. Collapse: shows count + "Unscheduled (N)". Expanded: chip row with scrollable tasks.                                                                                                                                                                                                                                                                  | Timeline mode only.                                                                              |

No existing `Console*` component gets a breaking change. Old tones / APIs stay registered.

**Note on `ConsoleKanbanCard` scope.** Board mode only uses this. If Board mode is further reshaped in a future redesign, the card variant stays — it's a clean primitive regardless of the board layout around it.

## 4. Dependencies needed

**None.**

- Lucide SVG icon set — already bundled (`0300988`). Reuses `clock`, `play`, `pause`, `grip-vertical` (drag handle on blocks), `arrow-left-circle`, `arrow-right-circle`, `target` (snap-to-now), `columns-3` (Board toggle), `chart-gantt` (Timeline toggle).
- QtQuick.Effects — already at Qt 6.5 floor; used for block glow + unscheduled-tray shadow.
- QtQuick.Shapes — used for the NOW playhead vertical line + soft band gradient.

**Not introduced**: QtCharts, QtQuick3D, third-party QML libraries, no new fonts.

## 5. Engine surface delta

This is the load-bearing section for Direction D. All additions are additive; no existing surface is broken.

### 5a. Schema — SQLite migration v2 → v3

Two new columns on the `tasks` table, both nullable with no default (per §6 migration plan):

```sql
ALTER TABLE tasks ADD COLUMN scheduled_start TEXT;
ALTER TABLE tasks ADD COLUMN scheduled_duration_seconds INTEGER;
CREATE INDEX IF NOT EXISTS tasks_scheduled_start_idx
  ON tasks(scheduled_start) WHERE scheduled_start IS NOT NULL;
```

Bump `STORAGE_SCHEMA_VERSION` from `2` to `3` in `native/rust-engine/src/storage.rs`. Add the migration step to the existing `migrate_schema(connection)` function as a new `if schema_version < 3` block after the existing v1→v2 block. Record `INSERT INTO schema_migrations(version) VALUES (3)` on success.

### 5b. Rust types — `native/rust-engine/src/planning.rs`

Extend `PlanningTask` (additive; serde-default so pre-v3 data deserializes cleanly):

```rust
#[serde(default, rename = "scheduledStart")]
pub scheduled_start: Option<String>,   // RFC3339
#[serde(default, rename = "scheduledDurationSeconds")]
pub scheduled_duration_seconds: Option<i64>,
```

Matching additions to `PlanningTaskRow` (storage mapper), `PlanningTaskCreateRequest`, `PlanningTaskUpdateRequest`, and `PlanningTaskContext`. `PlanningTaskUpdateRequest` gets:

```rust
#[serde(default)]
pub scheduled_start: Option<Option<String>>,            // None = don't update; Some(None) = clear
#[serde(default)]
pub scheduled_duration_seconds: Option<Option<i64>>,
```

(The double-Option pattern is existing — matches `due_date` on `PlanningTaskUpdateRequest`.)

### 5c. Rust mutation — new handler in `planning.rs`

One new request/result pair and one IPC method:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlanningTaskRescheduleRequest {
    #[serde(rename = "taskId")]
    pub task_id: String,
    #[serde(rename = "scheduledStart")]
    pub scheduled_start: Option<String>,           // None clears
    #[serde(rename = "scheduledDurationSeconds")]
    pub scheduled_duration_seconds: Option<i64>,   // None clears
}

pub struct PlanningTaskRescheduleResult { pub task: PlanningTask }
```

Dispatch registered under IPC action `planning.task.reschedule`. Implementation updates both columns atomically in a single UPDATE, returns the post-update task. No server-side overlap resolution (overlap is allowed; §2 "block conflict" state surfaces it visually).

### 5d. C++ adapter — `native/qt-shell/src/EngineProcess.*`

One new `Q_INVOKABLE`; the timeline day is a QML-side state (not a `Q_PROPERTY`, not persisted — see §7):

```cpp
Q_INVOKABLE void reschedulePlanningTask(const QString& taskId,
                                        const QVariant& scheduledStart,      // QString or QVariant::Invalid to clear
                                        const QVariant& scheduledDuration);  // qint64 or QVariant::Invalid to clear
```

The operator's current view day is held in `PlanningWorkspacePanel.qml` as a local `property date timelineDay` that defaults to `todayLocalDate()` on shell launch. The scale range is computed QML-side from `timelineDay + timelineStartHour / timelineEndHour` (the latter two persist via qsettings, see §7). No engine-side change required for the day window — the engine never knows what day the operator is looking at.

### 5e. What engine surface **does not** need to change

- `planningProjects`, `planningTasks`, `planningProjectCount`, `planningRunningTaskCount`, `planningTimeReportLoaded`, `planningTimeByProject`, `planningTimeByTask` — all reused as-is.
- Existing task mutations (`addPlanningTask`, `updatePlanningTask`, `toggleTaskComplete`, `startTaskTimer`, `stopTaskTimer`, `reorderTask`) — reused as-is. The reorder flow is unchanged (board mode). Timeline does not use reorder.
- `commissioningStage` / support surface — untouched.

## 6. Persistence migration plan (explicit)

This is the explicit migration plan CLAUDE.md requires for on-disk format changes.

**What changes on disk**

- `tasks` table gains two nullable columns (`scheduled_start TEXT`, `scheduled_duration_seconds INTEGER`).
- `schema_migrations` table gains a row `(version=3)`.

**Forward path (v2.1.x → v2.2.0)**

1. First launch of v2.2.0 runs `migrate_schema(connection)`. The existing v1→v2 block is a no-op (schema already at 2). The new v2→v3 block runs: both `ALTER TABLE` statements + the partial index, then the `schema_migrations` insert. Wrapped in a transaction — if any step fails, the DB stays at v2 and the engine fails to start with a storage error rather than running on a half-migrated schema.
2. All existing rows end up with `scheduled_start = NULL` and `scheduled_duration_seconds = NULL`. In QML these tasks render in the **unscheduled tray** (§2).
3. No user data is altered; this is a pure extension.

**Rollback path (v2.2.0 → v2.1.x)**

1. v2.1.x reads `schema_migrations`, sees `MAX(version) = 3`, but only knows how to bring a DB forward to version `2`. Today's code path runs `if schema_version < STORAGE_SCHEMA_VERSION` — if the stored version is **above** the binary's expected version, the binary **silently tolerates** the higher version (the `if` is skipped; the read path continues).
2. v2.1.x SELECT statements use explicit column lists on `tasks` that do **not** include the two new columns. SQLite tolerates the extra columns — reads succeed, the new columns are ignored.
3. INSERTs / UPDATEs from v2.1.x use explicit column lists and don't touch the new columns — existing columns update normally; `scheduled_start` / `scheduled_duration_seconds` retain whatever v2.2.0 wrote last.
4. Result: rolling back to v2.1.x loses **the ability to edit scheduling** (no UI) but does **not** lose the data — the columns persist silently and re-appear the next time v2.2.x is installed.
5. Caveat to disclose in the v2.2.0 release notes: if an operator clears all tasks in v2.1.x after a rollback, the scheduling data for those tasks goes with them (cascading delete). This is acceptable.

**Backup/export compatibility**

- `exportSupportBackup()` serializes tasks via serde — new fields are included. v2.1.x re-importing a v2.2-generated backup would deserialize the new fields via `#[serde(default)]` and then **drop them silently on the next write** (the v2.1.x schema has no column to store them). Operator-visible effect: the backup contains the schedule; v2.1.x ignores it; if v2.2 is reinstalled afterward, the tasks reappear unscheduled.

**Legacy import (`legacy_import.rs`)**

- The legacy Electron `db.json` importer is untouched. Imported tasks get `scheduled_start = None` via the existing field-default mechanism; they show up in the unscheduled tray.

**Verification gate**

- New engine unit test covers the v2→v3 migration idempotency (run twice, assert schema unchanged on second run).
- New engine unit test covers a v2 DB being loaded by a v3 binary (tasks read cleanly, both new columns are null).
- No new QML structural test is required for the migration itself; the existing engine tests under `native/rust-engine/` are the authoritative gate.

## 7. qsettings continuity

Three persistence considerations:

1. **Existing planning qsettings** (view filter, sort, selected project/task, dashboard view, deck mode) — unchanged. Keys reused verbatim.
2. **Timeline mode vs Board mode**: new qsettings key `planning.modeSection` under the planning settings prefix, values `"timeline"` / `"board"`, defaulting to `"timeline"`. Fresh installs and unknown values default to timeline.
3. **Show-day window** (scale range): two new qsettings keys `planning.timelineStartHour` (default `9`) and `planning.timelineEndHour` (default `22`). These are local-time hours. A future ticket may add a per-workspace override via a settings drawer; not in this PR.

`planning.timelineDay` is **not** persisted — it resets to `todayLocalDate()` on every shell launch. Historical days are reached via the `[` / `]` day-nudge controls (see §8).

No migration shim needed for pre-redesign qsettings — the new keys are additive.

## 8. Keyboard shortcuts

Additions and preservations — all routed through `OperatorShortcutLayer.qml`.

| Shortcut    | Context                   | Action                                                                                                 | Existing / New        |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------- |
| `N`         | Planning (both modes)     | New project (`todo` status) — existing behavior preserved.                                             | Existing — preserved. |
| `/` `S`     | Planning (both modes)     | Focus search field.                                                                                    | Existing — preserved. |
| `0`–`4`     | Planning — Board mode     | View filter `all/todo/in-progress/blocked/done`. Scoped to Board (conflicts with `0` snap-to-now).     | Existing — scoped.    |
| `⇧B`        | Planning                  | Toggle Timeline ↔ Board.                                                                               | **New**               |
| `⇧T`        | Planning                  | Force Timeline mode.                                                                                   | **New**               |
| `←` / `→`   | Timeline — block selected | Nudge selected block ±15 min. Writes via `reschedulePlanningTask`.                                     | **New**               |
| `↑` / `↓`   | Timeline — block selected | Move selected block to previous / next lane. Writes via `reschedulePlanningTask` (project reassigned). | **New**               |
| `[` / `]`   | Timeline                  | Scroll scale view ±1 hour (cosmetic; no write).                                                        | **New**               |
| `0`         | Timeline (no selection)   | Snap scale view to center on NOW.                                                                      | **New — see note.**   |
| `⇧[` / `⇧]` | Timeline                  | Change view day ±1 day.                                                                                | **New**               |
| `Enter`     | Timeline — block selected | Open project detail modal (same as click).                                                             | **New**               |

**Note on `0` ambiguity.** The existing `0` filter binding only fires inside Board mode; inside Timeline, `0` is consumed by the timeline (snap-to-now). The context guard on `OperatorShortcutLayer` needs to route `0` by `planning.modeSection` — additive, small, and required by the redesign.

## 9. Parity impact

**All existing Planning parity baselines invalidate.** Expected.

The workspace PR adds parity scenes to `scripts/native-parity-capture.mjs`:

| New scene                           | Engine scene? | Purpose                                                                                                                                                                     |
| ----------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planning-timeline-healthy`         | engine        | Timeline with 5 lanes, 2 running tasks, 1 blocked, NOW at `19:42`. Stable sample snapshot — lives in `seedCommissioningSamplePlanning`-style fixture extended for timeline. |
| `planning-timeline-empty`           | engine        | `planningProjectCount === 0` — centered empty card, scale visible.                                                                                                          |
| `planning-timeline-zero-filter`     | engine        | `planningViewFilter = "blocked"`, fixture with 0 blocked tasks. Overlay chip + dimmed blocks.                                                                               |
| `planning-timeline-all-unscheduled` | engine        | Fixture where all tasks have `scheduled_start = null`. Tray expanded; lane body empty.                                                                                      |
| `planning-timeline-drag`            | harness       | Frozen drag state on a block. `parityFrozenClock` pins the 15-min snap grid visible; selected block shows elevation2 shadow.                                                |
| `planning-board-healthy`            | engine        | Board mode rebaselined against the new 44 px toolbar + `ConsoleKanbanCard` variant.                                                                                         |
| `planning-board-zero-filter`        | engine        | Board mode with `blocked` filter and zero blocked tasks — dashed "No blocked tasks" tile per column.                                                                        |

The existing Planning scenes are rebaselined to the new timeline or board layouts per the mode that scene covered. The PR ships a `parity: rebaseline planning for v2.2 redesign` commit with two bit-identical offscreen `2560×1440` runs on each CI lane.

Determinism: the NOW playhead is clock-driven; `parityFrozenClock` on `ParityCaptureHarness.qml` pins the clock to `19:42:00 UTC` for planning scenes. Running-task pulse and block-drag shadow are animation-driven and rely on the same frozen clock to land at a specific phase.

## 10. `Main.qml` / nav-shell implications

- Planning stays a primary workspace under the shell header. No dock, no modal takeover. `DashboardHeaderPanel.qml` routing unchanged.
- The redesigned `PlanningWorkspacePanel.qml` replaces:
  - the three-label hero stack (`lines 96-125`),
  - the 920 px right-rail block containing `PlanningSummaryGrid` + `New Project` + icon rail (`lines 128-213`),
  - the narrow-screen fallback stack (`lines 216-251`),
  - the embedded empty-state card (`lines 255-297`),
  - the `ScrollView` wrapper (`lines 45-49`): the timeline fits the viewport at both `2560×1440` and `1920×1080` with no scroll (§C7-analogue). Lane compression handles over-budget cases.
- `PlanningToolbarPanel.qml` is **retained as board-mode's toolbar** — the timeline mode has its own toolbar integrated into `PlanningWorkspacePanel` (the `ConsoleStatChipRow` + `ConsoleTimeline` controls). For v2.2.0 we accept having two toolbar codepaths — one per mode — because the timeline and board toolbars solve different problems. Consolidation is a follow-up.
- `PlanningBoardPanel.qml` (936 LOC) is **retained as Board mode's implementation**. It is **not** rewritten in this redesign; only its toolbar chrome contracts to 44 px and its cards are migrated to the new `ConsoleKanbanCard`. The drag-and-drop card reorder stays drag-only in Board mode (keyboard reorder is a Medium finding deferred to a follow-up).
- `PlanningFocusPanel.qml` (265 LOC) is **removed**. Focus was not part of Dir D; the file is not referenced by any other QML surface. Deletion surface is three touchpoints: (a) delete `native/qt-shell/qml/PlanningFocusPanel.qml`, (b) drop the `qml/PlanningFocusPanel.qml` line from `native/qt-shell/CMakeLists.txt` (currently line 86), (c) delete the `test_planningFocusShortcutsTargetExpectedFields` case in `native/qt-shell/tests/qml/tst_OperatorShortcutLayer.qml` (currently line 137). The planning-focus shortcuts the test asserted are superseded by the timeline keybinds in §8; no shortcut is silently lost.
- `PlanningSummaryGrid.qml` (127 LOC) is **removed** — replaced by `ConsoleStatChipRow`. The removed file's tests are updated to point at the new component.
- `PlanningQuickActionsPanel.qml` (187 LOC), `PlanningTimeReportDialog.qml` (468 LOC), `PlanningCreateProjectDialog.qml`, `PlanningImportDialog.qml`, `PlanningProjectDetailDialog.qml` — **untouched** in this redesign. The 1357-LOC project detail dialog is flagged for its own audit (audit §Planning interactions, Medium) and remains out of scope here.

## 11. Summary of audit findings closed

| Finding                                                           | Severity  | How Direction D resolves it                                                                                                                                      |
| ----------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §Planning IA — identity redundant with dashboard header           | high      | Hero eyebrow/title/description stack removed entirely. Timeline header is `toolbarHeight` + scale row — no decorative copy.                                      |
| §Planning IA — right-rail summary grid duplicates Dashboard stats | high      | `PlanningSummaryGrid` deleted. Stats move into `ConsoleStatChipRow` in the toolbar. Dashboard header stat card for Projects is a follow-up (tracked separately). |
| §Planning IA — chrome stack up to 5 bands before the board        | high      | Timeline: 2 bands (toolbar 44 px + scale 36 px). Board: 2 bands (toolbar 44 px + column heads). Empty state is centered, not a stacked band.                     |
| §Planning states — no zero-filter-result state                    | high      | Zero-filter state explicitly specified for both modes (§2).                                                                                                      |
| §Planning states — pre-snapshot `0`s indistinguishable from empty | medium    | Snapshot-loading state specified with shimmer lanes / columns (§2).                                                                                              |
| §Planning hierarchy — Time Report hamburger `☰` glyph            | medium    | Time Report moves to a labeled toolbar button with the `clock` Lucide glyph (§1). `☰` is not used.                                                              |
| §Planning interactions — drag-only reorder, no keyboard           | medium    | Timeline mode adds full keyboard reschedule (`←/→/↑/↓/Enter`, §8). Board mode drag-only reorder is deferred to a follow-up (acknowledged).                       |
| §Recommendations #10 — workspace vs sidecar posture unresolved    | high/open | Resolved by reframing — Planning is a **schedule**, which is orthogonal to both "workspace" and "sidecar". Stated posture copy is retired.                       |
| §C8 — eyebrow/title/description decorative stacks                 | medium    | Killed on Planning surface.                                                                                                                                      |
| §C11 — Planning vs Projects vocab drift                           | low       | Operator-facing label standardizes on **Planning** in the dashboard tab, workspace title, and shortcut hint. Internal identifiers unchanged.                     |
| §Planning interactions — `PlanningProjectDetailDialog` complexity | medium    | **Deferred** — explicit follow-up per §12. Dir D does not redesign the project detail modal.                                                                     |

## 12. What is explicitly **not** in this PR

- **Directions A, B, C from the mockup** — not shipped. The HTML retains them for archival context; the delta spec locks Direction D only.
- **`PlanningProjectDetailDialog.qml` (1357 LOC) rewrite** — out of scope. The modal keeps its current shape; only the toolbar glyph that opens the Time Report changes.
- **Board-mode keyboard card reorder** — deferred. Drag-only remains in Board mode for v2.2.0.
- **Server-side overlap resolution / time-slot validation** — engine accepts any `scheduled_start` / `scheduled_duration_seconds` write. Overlap detection is a QML-only computed property surfaced via the "block conflict" state (§2).
- **Cross-day scheduling** — a task's `scheduled_start` is stored as RFC3339 so it encodes a full datetime, but the timeline UI only renders a single `planningTimelineDay` at a time. Multi-day views are a follow-up (tracked separately).
- **Recurring tasks / calendar integration** — not part of this redesign.
- **Unified toolbar across Timeline + Board modes** — accepted dual-codepath for v2.2.0; consolidation is a follow-up.
- **Dashboard header `Projects` stat-card deletion** — flagged by this spec as redundant with `ConsoleStatChipRow`, but the dashboard-header redesign already shipped (`0e70cb5`); a separate follow-up removes the stat card without requiring a second dashboard-header parity rebaseline cycle.
- **`PlanningFocusPanel.qml` replacement** — the file is deleted, not migrated. Its 265 LOC represented an experimental intermediate shape that Direction D supersedes.
- **Legacy `legacy_import.rs` changes** — out of scope per the redesign guardrails. Imported tasks land unscheduled; operator schedules them in v2.2.
