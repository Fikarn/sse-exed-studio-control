# UX Audit — SSE ExEd Studio Control (archived 2026-04-27)

> Historical Qt-era reference, archived after the Tauri shipping switch shipped in `v2.2.x`. This audit predates the cutover and still references removed `native/qt-shell` paths. Use it for product/UX rationale only; current implementation truth lives in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/HANDOFF.md`](../HANDOFF.md), and [`docs/DEVELOPER_QUICKSTART.md`](../DEVELOPER_QUICKSTART.md). Active per-workspace UX direction lives in [`docs/redesign/`](../redesign/).

Phase A deliverable of the `redesign/v2.2` effort. Written against the current native shell (`native/qt-shell/qml/` at the branch point from `main`). Purpose: ground the redesign in the actual code, not in generic UX intuition.

Severity scale: **blocker** (operator can't do the job), **high** (slows or misleads the operator), **medium** (polish / consistency), **low** (nice-to-have).

Primary target: fullscreen `2560×1440`. Fallback: `1920×1080`. No scroll during normal operation. Authoritative constraints: `docs/HARDWARE_PROFILE.md`, `docs/ARCHITECTURE.md`.

---

## Cross-cutting findings

These surface in multiple workspaces and should be addressed once in Phase C global prep rather than re-fixed per workspace.

### C1. The shell has two nav surfaces, and they disagree on what "Setup" is (high)

`Main.qml:142-158, 2565-2628` composes the operator surface as:

- `DashboardHeaderPanel` pinned to the top — but hidden when `workspaceMode === "setup"` (line 2573).
- `StackLayout` below it with 5 indices: Planning (0), Lighting (1), Audio (2), Setup (3), and a diagnostic fallback (4).

Inside the header (`DashboardHeaderPanel.qml:469-503`) the workspace tabs are "Lights / Audio / Projects" — three items, matching Planning + Lighting + Audio. Setup is promoted separately as a button in the status row (`DashboardHeaderPanel.qml:294-303`) and, once selected, hides the header entirely. So Setup is treated simultaneously as (a) a fourth workspace in the state machine, (b) an auxiliary button in the header, and (c) a full-screen takeover that escapes the header.

This is visible to the operator as: Lights/Audio/Projects feel like peers; Setup feels like a modal mode. That mismatch is fine if intentional (Setup is operationally a separate mode), but the current surface doesn't signal it — the Setup button looks like any other status chip.

Recommendation: in Phase B, decide deliberately whether Setup is a peer workspace (then surface it in the primary nav alongside Lights/Audio/Projects and keep the header visible inside it) or a modal mode (then remove the Setup button from the header status row and replace it with an explicit "Enter Setup Mode" affordance with a clear exit).

### C2. Dead code inside `SetupWorkspacePanel` (high)

`SetupWorkspacePanel.qml:292-312` and `368-665` mark the entire Support section layout as `visible: false`. That means Backup Archive, Available Backups, Restore And Diagnostics, Install And Update, and Runtime Paths are in the source but unreachable from the operator surface. The section-toggle tab bar (Commissioning / Support, lines 292-312) is also hidden.

Three possibilities:

- The Support section has been moved elsewhere (to `docs/OPERATIONS.md`, to an external tool, to the About dialog) and the dead code just hasn't been deleted yet. **Most likely** — the commissioning section grew into the whole workspace.
- The Support section is behind a feature gate that's always off.
- It's work-in-progress.

Recommendation: resolve this before the Setup redesign starts. Either delete the dead section outright in Phase C global prep or surface it as a real operator path. Do not redesign around hidden code.

### C3. Diagnostic fallback panel in the production shell (medium)

`Main.qml:2629-2688` defines StackLayout index 4 — a plain `Rectangle` with raw hex colors (`#0c1320`, `#35506b`, `#d6dce5`, `#8ea4c0`, `#f5f7fb`) bypassing `ConsoleTheme`. It's shown when `workspaceMode` is none of `planning|lighting|audio|setup`. In practice no operator path reaches it, but it's in the binary and is theme-incompatible.

Recommendation: in Phase C global prep, either delete index 4 or replace it with a `ConsoleSurface`-styled "Unknown workspace — return to Planning" recovery surface.

### C4. Ad-hoc font sizes and raw hex colors bypass `ConsoleTheme` (high)

`ConsoleTheme` exposes size tokens `textXxs (10) / textXs (12) / textSm (13) / textMd (14) / textLg (20) / textXl (24) / textHero (30)`. Grep across QML surfaces these literal pixel sizes used outside the token scale: `9`, `10`, `11`, `13`, `18`, `19`, `21`, `23`, `24`. Multiple of these appear in `DashboardHeaderPanel.qml` (e.g. `font.pixelSize: 9` for the product tagline, `21/19/24` for the dynamic hero title, `11` for the hero description) and in `SetupWorkspacePanel.qml` (e.g. 10, 18, 23).

Similarly, the Support section and the Main.qml fallback use raw hex (`#101826`, `#2a3b55`, `#8ea4c0`, `#f5f7fb`, `#0c1320`, `#24344a`, `#b4c0cf`) instead of `theme.surface*` / `theme.studio*` tokens.

Recommendation: in Phase C global prep, add the missing size tokens that real designs need (e.g. `textXxxs (9)` for eyebrows, `textLgAlt (18/19)`, `textXlAlt (21/23)` if genuinely needed, or retune the existing scale). Then fix the ad-hoc literals per workspace as they get redesigned. Main.qml fallback + Setup Support section cleanup lands in Phase C global prep.

### C5. Icon language is single-character labels and Unicode glyphs (medium)

Inventory of "icons" currently drawn by rendering text:

- `"L"` (lights tab/stat), `"A"` (audio), `"P"` / `"K"` (projects/planning tab), `"i"` (about), `"?"` (help), `"+"` / `"−"` (collapse toggle, add), `"←"` (`←`), `"☰"` (`☰`), `"↑"` / `"↓"` (`↑` / `↓`).

This leans on `IBM Plex Sans` / `IBM Plex Mono` to render glyphs as icon substitutes. It is inconsistent (Unicode chars mix with ASCII letters), low-precision at `2560×1440`, and provides no semantic affordance beyond letter.

Recommendation: pre-approved in the plan — adopt a bundled SVG icon set (Phosphor, Lucide, or Tabler — one set, not a mix) as a `qrc` resource. Add a thin `ConsoleIcon` component variant in Phase C global prep so per-workspace delta specs can name icons by key.

### C6. Theme has no alpha / elevation / focus tokens (medium)

Multiple files compute `Qt.rgba(theme.studio950.r, theme.studio950.g, theme.studio950.b, 0.36)` or similar to fake alpha tints of theme colors (examples in `DashboardHeaderPanel.qml:307`, `LightingSidebarPanel.qml:175`, `LightingContentPanel.qml:101`, `LightingWorkspacePanel.qml:143`, `Main.qml:107,116`). This is arithmetic that should be named tokens.

`ConsoleTheme` also has no explicit focus-ring color/width tokens and no elevation/shadow tokens — the redesign will want both, and `QtQuick.Effects` (already available at the Qt 6.5 floor) is the right tool for shadows. Pre-approved per plan.

Recommendation: in Phase C global prep, add additive tokens:

- `surfaceScrim` (and `surfaceScrimStrong`) — named replacements for the `Qt.rgba(studio950, 0.36/0.5/0.28)` pattern.
- `focusRing`, `focusRingWidth` — a single visible-focus treatment used by every interactive `Console*`.
- `elevation1 / elevation2` — opacity-composed shadows for `QtQuick.Effects.MultiEffect`, used by `ConsoleSurface` tones above "soft".
- `accentPrimarySoft` — the `Qt.rgba(accentPrimary, 0.18)` that shell background Circle #1 uses.

### C7. Scroll containers exist inside workspaces that are meant to be no-scroll on the target surface (medium)

Per `docs/HARDWARE_PROFILE.md`, no scroll during normal operation at `2560×1440`. Today:

- `PlanningWorkspacePanel.qml:45-49` wraps the entire panel in a `ScrollView`.
- `SetupWorkspacePanel.qml:84-98` wraps the entire setup panel in a `ScrollView`, centered at `width: Math.min(parent.width, 1720)` — so at 2560 width, the setup page is letterboxed to 1720 and can still scroll vertically.
- `LightingContentPanel.qml:107-111` wraps its non-spatial content in a `ScrollView`.

In practice at `2560×1440` these likely don't scroll — content fits. The ScrollView is a failsafe for smaller viewports. But it's not a gate: nothing in the code enforces "fit at `2560×1440`". A content change could silently introduce a scrollbar on the operator surface.

Recommendation: the per-workspace `contentFitsViewport()` function already exists in three of these panels; surface its result in verification. Add a "does content fit" assertion to the acceptance workflow for the primary task state and each non-happy state at `2560×1440`. Keep the ScrollView as a 1920×1080 fallback, but treat any scroll activity at `2560×1440` as a regression.

### C8. Hero/eyebrow decorative copy consumes the vertical budget it gates (medium)

Three surfaces open with a 3-stack of "eyebrow + title + description" decorative copy that doesn't drive an operator action: `DashboardHeaderPanel.qml:381-409` (Hero card), `PlanningWorkspacePanel.qml:86-126` (Planning Workspace intro), `SetupWorkspacePanel.qml:139-162` (Commissioning Workspace intro). Each consumes ~90–120 vertical pixels at scale 1.0.

On the primary `2560×1440` operator surface, vertical space is the scarce resource. Decorative copy belongs in `docs/OPERATIONS.md`, on the About dialog, or during onboarding — not in the permanent operator chrome.

Recommendation: per workspace, reclaim that vertical space for real operator content (more rows in the stats grid, more kanban columns visible without scroll, larger keyboard-shortcut-at-a-glance row). Demote eyebrow/title/description text to a tooltip-on-hover of the workspace label, or to a one-line context strip.

### C9. `scaleFactor` control placement is disconnected from what it scales (low)

`DashboardHeaderPanel.qml:318-332` shows three chip buttons `90 / 100 / 108`. They bind to `root.rootWindow.dashboardUiScale`. That scale is then propagated to every workspace (`Main.qml` passes it to each panel). Placement in the status row alongside DMX / OSC health chips misleads the operator — it looks like a health readout.

The control itself is useful (operators tune density based on viewing distance) but the placement does not communicate what it does. `108` means "relaxed operator view", `90` means "dense". The 3-chip is opaque without tooltip.

Recommendation: move to a preferences surface (inside the About dialog or a lightweight "View" menu). If it stays in-header, replace the `90/100/108` labels with symbolic density ("Compact / Standard / Relaxed") and isolate the cluster visually from the status badges.

### C10. Keyboard shortcuts are inconsistent with their visible labels (low)

`OperatorShortcutLayer.qml:30-34` registers `K` for Planning. `DashboardHeaderPanel.qml:496` labels the Planning tab `shortcut: "K"`. But the tab label is "Projects" and the iconText is `"P"`. So: label says Projects, icon says P, shortcut says K. Three identities for the same workspace.

The `K` choice likely exists because `P` collides with something else (no other shortcut registers `P` today, so it's free — the collision might be historical). Either way, the triple identity is a discoverability issue.

Recommendation: align on one identity per workspace. If the shortcut is `K`, the iconText should be `K` (or a real icon with a visible `K` chip next to it). Audit other shortcuts for the same drift.

### C11. "Planning" vs "Projects" vocabulary drift (low)

The workspace is called `planning` internally (`engineController.workspaceMode`), labeled "Planning Workspace" in `PlanningWorkspacePanel.qml:97`, and labeled "Projects" in the dashboard tab (`DashboardHeaderPanel.qml:495`) and the stat card label (`DashboardHeaderPanel.qml:444`).

Recommendation: pick one operator-facing noun (Planning or Projects — they're not synonyms; "Projects" is the noun operators manipulate, "Planning" is the activity) and use it in every operator-visible surface. Internal identifiers can stay.

### C12. `Q_PROPERTY` surface is broad and every workspace binds directly to the engine (structural — information)

Every workspace panel takes `required property var engineController` and drills into dozens of live properties (`lightingFixtures`, `planningProjectCount`, `audioChannelCount`, `operatorUiReady`, `appSnapshotLoaded`, etc.). This is the intended architecture — engine holds state, QML reads it. Not a finding to fix, but a dependency to keep in mind: the redesign cannot introduce new product state in QML; any new surface that needs data needs an engine-side `Q_PROPERTY` on the C++ adapter (`native/qt-shell/src/`) fed by the Rust engine.

---

## Dashboard Header Panel

File: `native/qt-shell/qml/DashboardHeaderPanel.qml` (509 LOC).

### Purpose + primary operator tasks

Top-of-screen permanent strip visible during Planning / Lighting / Audio. Communicates (a) product identity, (b) global health (storage / operator / DMX / OSC), (c) workspace nav (Lights / Audio / Projects + Setup escape hatch), (d) density control (scale chips), (e) About / Help. Primary operator tasks from `docs/OPERATIONS.md`: glance health, switch workspace.

### IA findings

- The header is simultaneously: brand ribbon, health dashboard, primary workspace nav, density control, and help entry point. Five jobs in one strip. See §C1 — Setup is promoted and escapes.
- The hero "copy card" (eyebrow + title + description) changes per workspace, but isn't an operator task — it's welcome copy. See §C8.
- Stats grid ("Lights / Audio / Projects" with counts) overlaps in identity with the workspace tabs directly below it. Both are labeled `L / A / P`, both take up a horizontal strip, both are about the three primary workspaces.

### Navigation findings

- Setup is nav-asymmetric. See §C1. **High.**
- The header itself claims `ConsoleSurface` `tone: "strong"` (`line 103`) — the visual weight says "this is the primary nav", but the workspace tabs are buried in a `tone: "soft"` surface below the hero+stats row. Tabs should be the most visually prominent nav element; they are not.

### Density findings

- At `2560×1440` fullscreen, the header is three vertical rows (`top bar / hero+stats / tabs row`). Implicit height = `headerContent.implicitHeight * scaleFactor + 24` — roughly 220–260 px depending on scaleFactor. That's 15–18% of the vertical budget spent on permanent chrome. With the workspace panel needing the same vertical space for its own toolbar, the combined chrome is pushing 25% of the viewport.
- Below 1180 px width the tagline hides; below 1400 px hero + stats stack vertically. These thresholds push the header past 300 px on 1920×1080 — the fallback resolution. **High** at fallback.

### Hierarchy issues

- Four status badges (`Saved Locally / Operator Health / DMX / OSC`) render with identical weight (`ConsoleStatusBadge` with only color differing). Operator Health is the one you need to scan in a crisis; it should be larger or isolated. Storage / DMX / OSC are reference readouts.
- The Setup button sits mid-cluster alongside scale chips, About, and Help. Setup is a workspace switch; About and Help are help. Mixing them dilutes Setup's semantics (§C1 again).

### Interaction issues

- About / Help buttons use `iconText: "i"` and `"?"` — §C5. **Medium.**
- Scale chips `90 / 100 / 108` lack affordance without tooltip — §C9.
- Tabs eyebrow text (`"Live lighting levels, scenes, and DMX health"` etc.) is always visible at `font.pixelSize: ~10`. At `2560×1440` operator distance, that's unreadable; it becomes visual noise. The eyebrow is useful during onboarding, not during live operation.
- No visible focus ring on the tab buttons when the operator tabs through with keyboard. `Console*` components need a focus token (§C6).

### Consistency issues

- Ad-hoc `font.pixelSize: 9, 11, 21, 19, 24` — §C4.
- Dynamic font size on hero title (`root.width >= 1500 ? 24 : root.width >= 1120 ? 21 : 19`) is the only place in the codebase that scales a font by width threshold. Every other surface uses scaleFactor. This is bespoke logic that drifts under redesign.
- `Qt.rgba(theme.studio950.r, theme.studio950.g, theme.studio950.b, 0.5)` on line 307 — §C6.
- `ConsoleStatCard` iconText uses single letters (§C5).

### States covered today

- `controllerReady`: yes, engine-starting state handled.
- `healthy / degraded / failed / starting`: yes, via `operatorHealthLabel` + `operatorHealthTone`.
- `lighting disabled / DMX reachable / DMX unreachable`: yes.
- `audio OSC off / connected / verified / down`: yes.

### States **not** covered

- No dedicated "snapshot-loading" shimmer on the stats row — counts just read as `0` (`String(root.lightingStatValue())` — `lightingStatValue()` returns `0` unless workspace is `lighting`). That's also misleading: the L / A / P stats only show non-zero for the active workspace. On the Planning workspace you see `Lights: 0`, which is not true — it's "current workspace is not lighting".
- No hardware-disconnected banner — just the small DMX / OSC chips change color. Under studio lighting that color change is easy to miss.
- No "update available" affordance — maintenance-tool updates arrive silently.

### Severity summary

- **High:** §C1 (nav asymmetry with Setup), §C4 (ad-hoc sizes), total vertical budget (especially at 1920×1080).
- **Medium:** §C5 (icons), §C6 (alpha tokens), §C8 (hero decorative copy), confusing stat-card semantics, missing snapshot-loading state, weak hardware-disconnected signal.
- **Low:** §C9 (scale chip placement), §C10 (K vs P), §C11 (Planning vs Projects).

---

## Planning workspace

Files: `PlanningWorkspacePanel.qml` (342), `PlanningBoardPanel.qml` (936), `PlanningProjectDetailDialog.qml` (1357), `PlanningTimeReportDialog.qml` (468), `PlanningToolbarPanel.qml`, `PlanningCreateProjectDialog.qml`, `PlanningImportDialog.qml`, `PlanningSummaryGrid.qml`.

### Purpose + primary operator tasks

Always-on sidecar workspace for project prep, handoffs, and timers. Primary tasks (from `docs/OPERATIONS.md`): scan run-of-show, add a new project (shortcut `N`), reorder a kanban card between status columns, open a project detail, mark tasks done, review time report, export / import backup.

### IA findings

- Planning is currently four layers tall in the workspace below the shell header: `(1) Planning overview strip (eyebrow + title + description + summary grid + action rail)` → `(2) PlanningToolbarPanel (filters / sort / search)` → `(3) PlanningBoardPanel (kanban)` → `(4) PlanningTimeReportDialog/CreateProjectDialog/ImportDialog (modal)`. Combined with the shell header, five chrome rows before the kanban board.
- The overview strip repeats identity (`"Planning Workspace"` eyebrow + description) that is redundant with the dashboard header's hero copy when the Planning tab is active. Two decorative layers back-to-back. **High.**
- Summary grid (`PlanningSummaryGrid`) is embedded in the overview strip at widescreen, and laid out below at narrow. It duplicates the Dashboard header's stat card for Projects — same number, different presentation.

### Navigation findings

- Planning as "always-on sidecar" is a stated product posture (`"Prep, handoffs, and timers stay visible without stealing the console"`) but implemented as a full workspace that hides Lighting / Audio when active. The sidecar framing implies a secondary surface (docked panel, collapsible drawer) — the current IA is a primary workspace.
- No explicit "back to lighting" nav inside Planning — the operator uses the dashboard header tabs. Fine, but means the header is mandatory for navigation out.
- Kanban drag-and-drop exists (`beginProjectDrag / finishProjectDrag / dropIndexForSlot`) — complex interaction without obvious keyboard equivalent.

### Density findings

- Overview strip at widescreen reserves 920 px for the right-side summary + action rail (`line 130-213`) and the remaining left-side for the 3-label decorative copy. A lot of real estate for context.
- Kanban: 4 columns (`todo / in-progress / blocked / done`). At `2560×1440` each column gets ~620 px — generous. But with the overview + toolbar + header stack above, vertical budget for cards per column is ~900 px — good, but tight if cards grow tall.
- `PlanningBoardPanel` is 936 LOC in one file — density of logic, not UI. That's an implementation density finding — see §Consistency.

### Hierarchy issues

- New Project is the primary action; it appears as a `ConsoleButton` in the overview rail but its visual weight is the same as the adjacent icon-only Export / Import buttons (§C5).
- Time Report toggle uses `iconText: "☰"` (hamburger) — a generic menu glyph for a specific action.
- Empty state (`line 255-297`) competes with the toolbar row below it — when there are no projects, the operator sees: overview strip → "No projects yet" card → toolbar → empty kanban. Four stacked strips of chrome before the action.

### Interaction issues

- `N` shortcut creates a project with `"todo"` default status. Good. But only active when Planning workspace has focus — operator might press N elsewhere expecting a new project.
- `S` and `/` both focus planning search. Fine redundancy; typical.
- `0 / 1 / 2 / 3 / 4` set view filter. No visible legend in the workspace — the operator either knows these or they're invisible.
- Project drag-and-drop works, but no keyboard-move equivalent.
- `PlanningProjectDetailDialog.qml` is 1357 LOC — deep modal with many sub-surfaces. Likely needs its own audit inside Phase B Planning work.
- `contentFitsViewport()` returns whether content fits; not surfaced anywhere to the operator.

### Consistency issues

- `font.pixelSize: theme.textSm + 1` on line 110 — arithmetic on a token. Either add a `textSmPlus` token or accept the inconsistency.
- Layout `maximumWidth: root.widescreenMonitor ? 760 : Number.POSITIVE_INFINITY` on line 114 — hardcoded 760. Candidate for a `copyMaxWidth` token.
- Mixes `compact: true` icon-tone buttons with full-size primary buttons in the same rail (visually OK, but inconsistent with how Lighting structures its rails).

### States

- `planningProjectCount === 0` → empty state. Covered.
- No explicit "filter returned zero projects" state (e.g. filter = `blocked`, no blocked projects). Kanban just shows empty columns.
- No "loading projects snapshot" state — before `appSnapshotLoaded` the counts are `0`, indistinguishable from empty.
- No "import-in-progress" state — it's a modal.

### Severity summary

- **High:** redundant identity with dashboard header (§C8 applied here), IA stack is too tall, no zero-filter-result state.
- **Medium:** drag-only reorder (no keyboard move), `PlanningProjectDetailDialog` complexity needs its own audit pass, Time Report glyph unclear.
- **Low:** Projects vs Planning drift (§C11), dynamic viewport threshold (1450 px) duplicated across workspaces.

---

## Lighting workspace

Files: `LightingWorkspacePanel.qml` (195), `LightingToolbarPanel.qml`, `LightingSidebarPanel.qml` (1130), `LightingContentPanel.qml` (738), `LightingSpatialPlotPanel.qml` (950), `LightingFixtureDialog.qml`, `LightingDeleteFixtureDialog.qml`.

### Purpose + primary operator tasks

Fixture and scene control. Primary tasks: DMX on/off, brightness / CCT / color per fixture or group, scene recall, scene save, fixture add / edit / delete, group add / rename / delete, spatial fixture placement, DMX monitor for wire-level diagnostics.

### IA findings

- Shell is `LightingToolbarPanel` on top + horizontal `SplitView` with `LightingContentPanel` (fill) and `LightingSidebarPanel` (preferred width 348/376 px, min 340 px). In spatial mode, content panel swaps to `LightingSpatialPlotPanel`. Three real surfaces, composed as 2 layout slots + a toggle.
- `viewMode` has three states: `expanded / compact / spatial`. Persisted in QSettings. `compact` vs `expanded` is a density toggle on the content side; `spatial` swaps the content type entirely. That's a mixed-intent property — could be split.
- Sidebar owns scene list, group list, add-light dialog trigger, settings drawer, DMX monitor toggle. Content owns fixture cards / fixture-in-group list / spatial plot (when `viewMode === "spatial"`). Clean separation.
- `LightingSidebarPanel` is 1130 LOC for what the audit can see is: fixture list + scene list + group list + settings form + delete/rename modals. This is the biggest monolithic file in the workspace.

### Navigation findings

- SplitView allows the operator to drag the sidebar width — state is persisted. Good.
- No keyboard shortcut switches `viewMode` — operator must click into the toolbar. `docs/DEVELOPMENT.md` lists `lighting-populated` / `lighting-add-open` etc. as verify actions, but no runtime shortcuts for view mode toggles.
- Scenes and groups both live in the sidebar; they behave similarly (rename / delete dialogs, list rendering) but are separate lists. Could be presented as one list-of-lists with clearer grouping.

### Density findings

- At `2560×1440` with sidebar at 376 px, content area is ~2180 px — plenty for a fixture grid. LightingContentPanel uses `ScrollView` (§C7) so vertical overflow is handled but not gated.
- Spatial view overrides the content's ScrollView. Spatial viewport is full content-panel size — good.
- Sidebar's three internal sections (fixtures / scenes / groups + settings) each need vertical space; 1130 LOC hints at a lot of cram. Needs a scroll? Unclear from the excerpt read; likely a per-section scroll.

### Hierarchy issues

- Master grand-master slider and DMX enable toggle live in settings (sidebar drawer) — these are the most-reached-for controls during a live take and are two clicks deep.
- DMX reachability shows in the Dashboard header chip (`DMX Ready / DMX Down`) but not as a prominent in-workspace indicator. If the operator's focus is in the lighting workspace and DMX drops, they must glance up at the header.

### Interaction issues

- `closeTransientDialogs` resets modal state on workspace switch — good hygiene.
- Section collapse (`LightingContentPanel.toggleSection`) persists in `collapsedSections` object but not to QSettings. Collapse state resets on restart. Might be intentional (fresh state per run) — worth confirming with operator.
- `lightStateColor` (`LightingSidebarPanel.qml:50-72`) maps RGB / HSI / CCT state to a preview swatch. Hard-coded CCT ramp (`3200 → #ffb35c`, `4400 → #ffd38b`, `>4400 → #eaf0ff`). Reasonable but ad-hoc — a `kelvinToColor()` helper in ParityHelpers would centralize it.
- Fixture cards are driven by `LightingParityHelpers.fixtureSections` — groups fixtures. Within a section, ordering is engine-driven.

### Consistency issues

- `Qt.rgba(theme.studio950.r, ..., 0.36)` (sidebar) and `Qt.rgba(theme.studio950.r, ..., 0.28)` (workspace root) — two different scrim strengths for effectively the same effect. §C6.
- Toolbar and sidebar both render `viewMode` toggle affordances (`onViewModeSelected` signal exists on both). Duplicated affordance — check whether both are always visible.
- `LightingFixtureDialog.qml` is not read yet but based on spatial/group/scene dialog patterns is likely another monolithic modal — common shape for the Planning Project Detail dialog.

### States

- `lightingSnapshotLoaded` gates settings dirty check — covered.
- No fixtures: `LightingContentPanel.qml:123-147` shows empty state with a "Use Add Light" button (button text literally says "Use Add Light" — imperative, slightly odd phrasing; button has no onClick, it's a hint).
- `lightingEnabled === false`: DMX Off — header chip, but no in-workspace banner.
- `lightingReachable === false`: DMX Down — header chip, no banner.
- No "bridge IP unreachable, retrying" transient state.

### Severity summary

- **Blocker:** `LightingContentPanel.qml:142-145` has a `ConsoleButton { text: "Use Add Light"; dense: true }` with **no `onClicked` handler** — it's a dead button. If an operator with zero fixtures clicks it, nothing happens. **Verify this is dead code.**
- **High:** grand-master and DMX enable buried in settings, no in-workspace DMX-down banner, scenes/groups sidebar is a 1130 LOC monolith.
- **Medium:** viewMode overload (compact/expanded/spatial), ad-hoc CCT-to-color ramp, no keyboard shortcuts for view-mode switching.
- **Low:** collapse state not persisted, section-icon toggle uses `+ / −` glyph literals (§C5).

---

## Audio workspace

Files: `AudioWorkspacePanel.qml` (118), `AudioToolbarPanel.qml`, `AudioMixTargetsPanel.qml`, `AudioChannelsPanel.qml`, `AudioSelectedStripPanel.qml`.

### Purpose + primary operator tasks

TotalMix-style mixer for RME Fireface UFX III via OSC. Primary tasks: scan channel meters, adjust a channel, recall a mix snapshot, switch between mix targets (outputs / submixes), verify OSC connection.

### IA findings

- Top row: `AudioToolbarPanel` + `AudioMixTargetsPanel`. Bottom row: `AudioChannelsPanel` + `AudioSelectedStripPanel`. At narrow widths (< 1180 px) collapses to a single column.
- `AudioMixTargetsPanel` in the top row mirrors the "which bus am I editing" concept — in TotalMix this is the sub-output row. Reasonable placement.
- `AudioSelectedStripPanel` (right side at wide, below at narrow) shows detail for one selected channel. Matches TotalMix's channel-detail pattern.
- Three responsive breakpoints: `stackedLayout` (<1180), `wideLayout` (≥1320), `fullscreenOperatorLayout` (≥2200). At `2560×1440` all three are true → fullscreenOperatorLayout. `AudioToolbarPanel` is pinned to `preferredWidth: 1120`, `AudioMixTargetsPanel` to `1360` (totals ~2480) — should fit 2560.

### Navigation findings

- No sub-nav within Audio. Single-screen workspace. Good.
- Shortcut `A` enters Audio from anywhere (OperatorShortcutLayer).
- No explicit "select next channel" keyboard — operator clicks.

### Density findings

- At `2560×1440` with no scroll container wrapping the panel (unlike Planning and Setup) — the workspace relies on implicit layout fitting. If content overflows vertically, things get clipped without a scroll. Check `contentFitsViewport()` — it exists but is a predicate, not a guard.
- `AudioChannelsPanel` and `AudioSelectedStripPanel` need enough height for meters to be readable at operator distance. Unknown without reading them; meter-legibility is the single most important density gate for this workspace.

### Hierarchy issues

- Four co-equal panels with no size negotiation other than `Layout.preferredWidth` hints. If the channel count grows, the Channels panel compresses rather than scrolling. Unclear behavior beyond the RME UFX III's fixed channel count.
- No clear "primary mix target" indicator in the panel title bar — it's inside `AudioMixTargetsPanel` content.

### Interaction issues

- No audition / pre-fader toggle visible in the shell composition (may be inside Channels panel — needs a deeper read during Phase B).
- No keyboard channel selection.
- `project memory` notes: RME UFX III / TotalMix verification still has TODOs — that's an open engine-side question, not a UX finding. But the UX redesign should design around "OSC not verified" as a real state, not just "OSC connected".

### Consistency issues

- `AudioWorkspacePanel` uses raw `spacing: 10/12` instead of theme tokens. Likely propagates into child panels.
- No `ConsoleTheme` usage in the shell file (lines 1-118) — all spacing is numeric literals.

### States

- `workspaceMode !== "audio"` hides the panel. Good.
- `audioOscEnabled / audioConnected / audioVerified` are on engineController (read by DashboardHeader) — but how they surface inside the workspace is unclear from the shell file alone.
- No "RME device not detected" explicit state visible at the workspace shell level.

### Severity summary

- **High:** no protective scroll or content-fits gate at the workspace level — vertical overflow is silent; meter legibility is unverified; "OSC not verified" state needs explicit design.
- **Medium:** no numeric-token usage (§C4), no keyboard channel-select, mix-target hierarchy unclear.
- **Low:** no audit of `AudioChannelsPanel` / `AudioSelectedStripPanel` details yet — needs a pass during Phase B Audio brief.

**Note:** Audio has the largest gap between current audit depth and what Phase B needs. The TotalMix-style mix surface deserves a dedicated subaudit before Claude Design ideation starts. Budget extra time here.

---

## Setup workspace

Files: `SetupWorkspacePanel.qml` (670), `SetupControlSurfacePanel.qml` (1292), `SetupWizardOverlay.qml` (706), `SetupQuickSetupPanel.qml`, `SetupConnectionProbePanel.qml`, `SetupGuidePanel.qml`, `SetupInstallerHelpPanel.qml`.

### Purpose + primary operator tasks

Control-surface commissioning: Bitfocus Companion + Stream Deck+ profile import, action test, page / button / dial mapping, connection probe, guide / installer help. Primary tasks: import a Companion profile, test an action (button or dial), inspect a Stream Deck+ page mapping, reach backup / diagnostics (currently dead — see §C2).

### IA findings

- Setup is full-screen (dashboard header hidden when `workspaceMode === "setup"` — `Main.qml:2573`). The only workspace that hides the header. See §C1.
- Current layout at `wideLayout` (≥ 800 px): left rail (320-352 px) with `SetupQuickSetupPanel / SetupConnectionProbePanel / SetupGuidePanel / SetupInstallerHelpPanel` stacked; right column dominated by `SetupControlSurfacePanel` (min 760 px).
- Support section **entirely hidden** (§C2). That's 5 operator-critical surfaces (Backup Archive / Available Backups / Restore And Diagnostics / Install And Update / Runtime Paths) sitting in the file as `visible: false`.
- Header is itself a 3-up summary (`Deck Pages / Active Page / Workflow: Import first`) in 146 px cards. Not a strip-minimal header — more like a dashboard.
- `SetupWorkspacePanel` wraps all of it in a `ScrollView` centered at `Math.min(parent.width, 1720)`. At `2560×1440` the setup content letterboxes to 1720 px and remains scrollable.

### Navigation findings

- "Back to Console" button in the top-right (`line 164-172`) — takes the operator back to `planning` workspace. Good recovery hatch. Enabled only when `startupTargetSurface === "dashboard"` — meaning during initial commissioning (startupTargetSurface === "commissioning") the back button is disabled, which is correct (the operator shouldn't escape until commissioning finishes).
- No sub-nav between Commissioning and Support because Support is hidden. If Support returns, the section tab bar exists already — just needs `visible: true`.
- `SetupControlSurfacePanel` has its own page / button / dial selection — a mini-nav within the setup workspace. 1292 LOC deep; likely multi-level itself.

### Density findings

- 1720 px max width at 2560 leaves ~420 px of black letterbox on each side. Intentional — setup is not the primary live surface — but wastes the primary monitor's real estate during commissioning.
- The three KPI cards (Deck Pages / Active Page / Workflow) are each 146 px wide; three of them plus spacing = ~490 px. Fine at 1720 px max width.
- `ScrollView` is active (§C7): the page is designed to scroll. For commissioning that's fine — setup is not the no-scroll surface.

### Hierarchy issues

- "Workflow: Import first" is a KPI card that's actually a static text label (not a metric). It occupies the same visual slot as Deck Pages and Active Page (which are real metrics). Mismatch.
- `SetupQuickSetupPanel`, `SetupConnectionProbePanel`, `SetupGuidePanel`, `SetupInstallerHelpPanel` stack in the left rail with equal visual weight. Only one is the primary task per commissioning step, but they look co-equal.
- `SetupControlSurfacePanel` (the right column; 1292 LOC) is visually dominant — the actual control-surface map. Good, that's the main task.

### Interaction issues

- `Button` (plain QtQuick Controls) used for Export Backup / Open Backups / Refresh / Restore Backup / etc. in the Support section (`lines 423-659`) — but this code is dead (§C2), so the inconsistency with `ConsoleButton` isn't operator-visible. Still a cleanup cost.
- `TextField` (plain QtQuick Controls) on line 533 for restore path — not `ConsoleTextField`. Same dead-code caveat.
- `Setup` is reachable via the dashboard header's Setup button but not via any keyboard shortcut. `docs/DEVELOPMENT.md` lists `setup-required` and `setup-ready` as verify actions (engine-driven), but no operator shortcut.

### Consistency issues

- `font.pixelSize: 10, 13, 18, 23` — §C4. Letter-spacing literals `1.6, 2.4` — should be a `letterSpacingEyebrow` token.
- Raw hex colors in the Support section (`"#101826"`, `"#2a3b55"`, `"#f5f7fb"`, `"#8ea4c0"`, `"#dcfce7"`, `"#b4c0cf"`) — dead code per §C2 but should be deleted or thematized.
- `Qt.rgba(theme.accentPrimary.r, ..., 0.8)` (line 141) — §C6 again. Same pattern for `theme.accentGreen` in Workflow card.

### States

- `startupTargetSurface === "commissioning"` vs `"dashboard"` drives whether Setup is the startup surface and whether Back-to-Console is enabled. Covered.
- `controlSurfacePages.length === 0` — the Active Page card renders `"None"`. Fine.
- `supportSnapshotLoaded === false` — shows "Support snapshot is waiting for the engine." (dead code).
- No "profile import in progress" explicit state (would live inside `SetupQuickSetupPanel`).

### Severity summary

- **Blocker:** §C2 dead support section — operators have no path to backup / restore / diagnostics / runtime paths from the UI. If these are needed during an incident, the operator has no surface. **Verify the intended product path for these tasks.**
- **High:** §C4 ad-hoc sizes, plain `Button` / `TextField` mixed with `ConsoleButton`, Workflow KPI is fake-metric.
- **Medium:** 1720 px letterbox at 2560 wastes space during commissioning, no keyboard shortcut for Setup entry.
- **Low:** letter-spacing literals, hex colors in dead code.

---

## Decisions resolved post-audit

### §C1 — Setup is a modal mode (not a peer workspace)

Setup keeps the current full-screen behavior (dashboard header hidden while `workspaceMode === "setup"`). Rationale: commissioning and incident recovery are separate operator mental modes; mixing them with live-operation chrome dilutes both. The current `Main.qml:2573` guard remains.

Redesign work required:

- Keep header-hidden behavior as-is.
- Promote the Setup entry affordance in the dashboard header: separate the `Setup` button from the DMX / OSC health chips so it reads as a mode switch, not a status readout. Addresses §C9's placement concern from the same direction.
- Keep "Back to Console" button behavior gated on `startupTargetSurface === "dashboard"` (correct today — prevents escape during initial commissioning).

### §C2 — Restore the Support section under a Commissioning / Support tab toggle

The hidden Support surfaces (Backup Archive, Available Backups, Restore And Diagnostics, Install And Update, Runtime Paths) are operator-critical during incidents and must be reachable from the UI. The tab bar mechanism already exists in `SetupWorkspacePanel.qml:292-312` behind `visible: false`.

Phase C global prep work:

- Enable the tab bar.
- Replace plain `Button` / `TextField` with `ConsoleButton` / `ConsoleTextField`.
- Replace raw hex colors in the Support section with `ConsoleTheme` tokens (some tokens may need to be added first — see §C4 / §C6).
- Land before the Setup workspace enters per-workspace Phase B design direction, so the redesign covers the real operator paths rather than phantom code.

## Cross-cutting action list feeding Phase B

The audit surfaces these concrete items to resolve before or during Phase B Claude Design ideation:

1. **Decide Setup's nav identity** (§C1). Phase B nav-model question #1 — the redesign can't ship with the current ambiguity.
2. **Decide the dead Support section's fate** (§C2). Before redesigning Setup, either restore the surfaces or delete the code.
3. **Delete or thematize the StackLayout index 4 fallback** (§C3). Phase C global prep.
4. **Add missing theme tokens** (§C4, §C6): font-size additions, `surfaceScrim*`, `focusRing*`, `elevation*`. Phase C global prep.
5. **Adopt one bundled SVG icon set** (§C5). Phase C global prep; add a `ConsoleIcon` variant.
6. **Define "content-fits-viewport" as a parity gate at `2560×1440`** (§C7). Acceptance workflow addition; no code change — just new verification step.
7. **Kill decorative eyebrow/title/description triplets inside workspaces** (§C8). Reclaim vertical budget; per-workspace delta spec choice.
8. **Move `dashboardUiScale` control to a dedicated density menu** (§C9).
9. **Align workspace label / iconText / shortcut triple identity** (§C10, §C11).
10. **Decide if Planning is a workspace or a sidecar** (Planning workspace IA). Impacts whether Planning gets its own full surface or a docked panel.
11. **Fix `"Use Add Light"` dead-button in `LightingContentPanel`** (Lighting blocker). Standalone bugfix candidate, not redesign work — can land on `main` directly before the redesign starts.
12. **Budget a dedicated Audio sub-audit during Phase B** — the shell file alone doesn't cover meter legibility and channel-level interaction.

## Glossary

- **Workspace** — one of `planning / lighting / audio / setup`. Drives `engineController.workspaceMode`.
- **Operator surface** — the operator-facing rendering at `2560×1440` on the fixed second monitor.
- **Parity capture** — deterministic offscreen `2560×1440` PNG under `artifacts/parity/native/workstation/`.
- **No-scroll rule** — operator content must fit without scrolling at the primary target resolution.
- **ConsoleTheme** — the single tokens source for the design system (`native/qt-shell/qml/ConsoleTheme.qml`).
- **Console\*** — the custom component library that consumes `ConsoleTheme`. Extend additively; do not bypass.

## What this audit did not cover

- `PlanningProjectDetailDialog.qml` (1357 LOC) — deferred to Phase B Planning brief.
- `SetupControlSurfacePanel.qml` (1292 LOC) — deferred to Phase B Setup brief.
- `SetupWizardOverlay.qml` (706 LOC) — deferred to Phase B Setup brief.
- `AudioChannelsPanel.qml` / `AudioSelectedStripPanel.qml` — deferred to Phase B Audio brief (see Audio severity note).
- Parity fixture content + operator-verify action surfaces — audit scope was operator-visible chrome, not test fixtures.
- Fit at `1920×1080` fallback — noted as a general concern; no per-workspace measurement taken.
