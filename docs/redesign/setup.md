---
workspace: setup
phase: B (direction locked)
status: ready-for-phase-c
chosen_direction: B — runner (5-step wizard + Support dashboard toggle)
audit_refs:
  - docs/archive/UX_AUDIT.md §Setup workspace
  - docs/archive/UX_AUDIT.md §C1 (modal mode — kept)
  - docs/archive/UX_AUDIT.md §C2 (Support restored — global prep, done in 91d6e6a)
  - docs/archive/UX_AUDIT.md §C4, §C5, §C6, §C7, §C8, §C10, §C11
---

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

# Setup — delta spec

Reference mockup: `docs/redesign/assets/setup/Setup-Redesign.html` (three directions A / B / C; B is the chosen direction).

Direction **B — Runner** reshapes Setup as a linear 5-step commissioning runner. Step state is already engine-backed (`commissioningStage` / `commissioningSteps`); the redesign surfaces those steps as a visible track instead of burying them as a footnote line. Support surfaces get a dedicated full-width mode, entered via a corner toggle, so the operator never looks at half a Support screen while trying to commission hardware.

---

## 1. Layout

Setup stays a modal mode (per §C1 — see `Main.qml:2573` guard). The header is hidden; the Setup panel owns the full `2560×1440` surface.

### Shell — two modes in the same workspace

The Setup surface switches between two modes via a small corner toggle, **not** via a top tab bar. This replaces the `visible: true` section-tabs bar the Phase C global prep turned back on in `91d6e6a` — the toggle is less chrome and reads unambiguously as a mode swap.

Corner toggle sits top-right, below the Back-to-Console row. States: `[● Runner]` (active) / `[● Support]` (active). `ConsoleButton` `tone: "chip"`, `active: true` on the currently visible mode. Keyboard: `⇧S` toggles modes (see §8).

### Mode 1 — Runner (default, full-screen commissioning)

| Region               | Height    | Notes                                                                                                                                                                   |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Top utility row      | 44 px     | `Back to Console` on left (existing; gated on `startupTargetSurface === "dashboard"`). Mode toggle on right.                                                            |
| Step progress header | 96 px     | 5-segment `ConsoleStepHeader` (see §3). Segments flow left→right, active segment has `bgStepActive` fill + 3 px `accentPrimary` bottom rule.                            |
| Step body (centered) | remaining | Centered column, max-width **1400 px** at `2560×1440` (intentional letterbox). Content varies per step — see **Steps** below.                                           |
| Footer action bar    | 72 px     | Sticky bottom; left = `BACK` (ghost), right = primary action for the current step (`CONTINUE`, `PROBE`, `RESUME`, `PUBLISH ⏎`). Keyboard `⏎` binds to the right action. |

The intentional 1400 px centering is deliberate per §Setup density: the runner is a focused task, not a live-operation surface, and a wide column breaks the visual hierarchy of the step cards. At `1920×1080` fallback the column scales to `min(width - 64px, 1400)` which resolves to 1856 px — no letterbox at fallback resolution.

### Steps — 1 through 5

| #   | Stage id (engine) | Label            | Primary action                                             | Engine method                                                                                               |
| --- | ----------------- | ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `import`          | Import profile   | Drop target for Companion `config.companionconfig` file    | `loadParityFixture(fixtureId)` or bring-your-own file                                                       |
| 2   | `probe`           | Probe hardware   | Run three probes in sequence (control-surface, DMX, audio) | `runControlSurfaceProbe()`, `runLightingProbe(ip, universe)`, `runAudioProbe(host, sendPort, recvPort)`     |
| 3   | `map`             | Map bindings     | Full-bleed Stream Deck+ surface grid + binding detail card | existing `controlSurfaceSnapshot` drives the grid                                                           |
| 4   | `verify`          | Verify live echo | Press physical button → echo pulse appears in the grid     | `controlSurfaceSnapshotChanged` signal; no dedicated echo signal needed — delta on the snapshot is the echo |
| 5   | `publish`         | Publish          | Summary card + `PUBLISH ⏎` commits → switches to Planning  | `setWorkspaceMode("planning")` + `exportSupportBackup()` to auto-snapshot                                   |

Step advancement goes through `updateCommissioningStage(stage)` — already engine-backed, no new `Q_INVOKABLE` required. The engine owns stage-transition validity; QML never jumps stage on its own.

### Mode 2 — Support (full-width dashboard, triggered by corner toggle)

Replaces the scroll-happy stacked Support section that Phase C global prep restored from `visible: false`. Layout is a 12-column grid over the same 1400 px centered column. Grid cells:

| Cell                     | Cols | Region                       | Notes                                                                                                                                                                     |
| ------------------------ | ---- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero copy banner         | 12   | Top                          | Single-line prompt: `What went wrong?` — uses textMd, studio200.                                                                                                          |
| Restore                  | 8    | Primary (left, spans 2 rows) | Latest backup meta (`supportLatestBackupPath`, `supportBackupCount`, date) + `RESTORE NOW` primary action. Backup picker below as `ConsoleButton tone: "ghost"` per-file. |
| Diagnostics              | 4    | Right top                    | 3 probe tiles: Control surface / DMX / OSC. Each tile shows last check status + a `PROBE` button (wires into the same three `runXxxProbe()` methods as Runner step 2).    |
| Install & Update         | 4    | Right middle                 | Installer help panel content — existing text, now wearing `ConsoleSurface`.                                                                                               |
| Reference paths (footer) | 12   | Bottom strip                 | Horizontal rail: Archive / Update repo / App data / Diagnostics / Logs — mono, textXxs. Uses `ConsoleButton tone: "monoRail"` (already shipped in `b53fb18`).             |

## 2. States

Six operator-visible states. Two were not covered in the Direction B mockups but are still required by the audit.

| State                          | Runner                                                                                                                                | Support                                                                                                                                                             | Trigger                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Snapshot loading**           | Step header collapses to a single `STARTING ENGINE…` line centered; body shows a 1.2 s `accentAmber` pulse.                           | Same collapsed header line; body hidden.                                                                                                                            | `!appSnapshotLoaded` or `startupPhase !== "ready"`. Not covered by Dir B mockups; required. |
| **Step healthy (default)**     | Active step card with `bgStepActive`; preceding steps marked `✓` in `accentPrimary`; following steps dimmed `studio500`.              | n/a                                                                                                                                                                 | `commissioningStage` matches one of the five stages.                                        |
| **Step error (probe failure)** | Active step card carries a `ConsoleBadge tone: "rail"` `accentRed` chip with the error message; footer primary becomes `RETRY`.       | n/a                                                                                                                                                                 | Matching `commissioningChecks[*].status === "error"`.                                       |
| **Step verify live-echo**      | Step 3/4 grid cell of the pressed button pulses `accentPrimary` for 300 ms on snapshot delta; "Waiting for press…" copy above.        | n/a                                                                                                                                                                 | `commissioningStage === "verify"` + `controlSurfaceSnapshotChanged` signal delta.           |
| **Jump-around warning**        | Clicking a future step opens an inline `ConsoleModal` — "Skip ahead? Preceding steps haven't been confirmed." with `SKIP` / `CANCEL`. | n/a                                                                                                                                                                 | User clicks a step header > `indexOf(commissioningStage)`.                                  |
| **Empty backups (Support)**    | n/a                                                                                                                                   | Restore cell shows an empty-state panel: `No backups yet.` + `EXPORT FIRST BACKUP` primary (wires `exportSupportBackup()`). Diagnostics + Install cells unaffected. | `supportBackupCount === 0`. Not covered by Dir B mockups; required.                         |

## 3. New / modified tokens and component variants

### Tokens — `ConsoleTheme.qml`

Two new tokens; both additive:

| Token                | Value                                                                   | Rationale                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bgStepActive`       | `Qt.rgba(theme.accentPrimary.r, .g, .b, 0.08)` layered over `studio900` | Sage-tinted fill for the active wizard step card. Reads as "current" without competing with the `accentPrimary` underline.          |
| `stepIndicatorWidth` | `72` (px)                                                               | Layout primitive so the 5 step segments compute to a predictable header width (`5 × 72 + 4 × gap + endcaps = 96 px header height`). |

Already-shipped tokens reused: `elevation1*`, `focusRing*`, `accentPrimaryGlow`, `accentPrimarySoft`, `studio*`, `textXxs/Xs/Sm/Md`.

### Component variants — `Console*`

Additive, shipped as part of this workspace's PR:

| Component            | New variant or additive property                                                                                                                                                                                                                                        | Usage                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `ConsoleStepHeader`  | **New component.** Horizontal 5-segment wizard track. Props: `model: [{ id, label, status }]`, `activeId`, `onSegmentClicked(id)`. Renders segments as `stepIndicatorWidth` chips with a 3 px bottom rule in `accentPrimary` on active; check glyph on completed.       | Runner header only.                                         |
| `ConsoleSurfaceGrid` | **New component.** Physical Stream Deck+ grid renderer. Props: `buttons: [8]`, `encoders: [4]`, `touchStrip: { active }`, `highlightId`, `onCellPressed(id)`. Uses bundled Lucide glyphs inside each cell. Has two variants: static (map) and live (verify echo pulse). | Steps 3 (Map) + 4 (Verify).                                 |
| `ConsoleButton`      | New `tone: "stepFooter"` — full-height footer buttons with elevation1 and a stronger `accentPrimary` for the right-side primary. Additive; existing tones untouched.                                                                                                    | Runner footer action bar (`BACK` / `CONTINUE` / `PUBLISH`). |
| `ConsoleBadge`       | Reuses `tone: "rail"` (shipped in `b53fb18`) for step-error chip. No change.                                                                                                                                                                                            | Step error state.                                           |
| `ConsoleTextField`   | No variant change; replace stale `QtQuick.Controls.TextField` usage in the restored Support code (from §C2 prep) as part of this workspace's PR.                                                                                                                        | Support — restore path field, any other form inputs.        |
| `ConsoleButton`      | No variant change; replace stale `QtQuick.Controls.Button` usages from the restored Support code with `ConsoleButton` using existing tones (`primary` / `ghost` / `monoRail`).                                                                                          | Support — all action buttons.                               |

No existing `Console*` component gets a breaking change. Old tones / APIs stay registered.

## 4. Dependencies needed

**None.**

- Lucide SVG icon set — already bundled (`0300988`). Reuses `clipboard-list`, `wrench`, `triangle-alert`, `arrow-left`, `circle-help`, `external-link`. No new icons needed.
- QtQuick.Effects — already at Qt 6.5 floor; used for step-card elevation and the active-step glow.
- QtQuick.Shapes — not used for Setup.

**Not introduced**: QtCharts, QtQuick3D, third-party QML libraries.

## 5. Engine surface delta

**None required for v2.2.0.**

All five wizard steps map onto existing engine surface:

| Step       | Engine surface consumed                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Import  | `commissioningStage`, `loadParityFixture(fixtureId, replaceExistingData)`, `seedCommissioningSamplePlanning(replace)`                                                     |
| 2. Probe   | `runControlSurfaceProbe()`, `runLightingProbe(bridgeIp, universe)`, `runAudioProbe(sendHost, sendPort, receivePort)`, `commissioningChecks`, `commissioningChecksChanged` |
| 3. Map     | `controlSurfaceSnapshot`, `controlSurfaceAvailable`, `controlSurfaceStatus`, `controlSurfaceSnapshotChanged`                                                              |
| 4. Verify  | Same as step 3 — echo = snapshot delta on press. No dedicated `deckButtonPressed` signal needed.                                                                          |
| 5. Publish | `setWorkspaceMode("planning")`, `exportSupportBackup()` (for automatic snapshot on publish)                                                                               |

Stage transitions: `updateCommissioningStage(stage)` already exists; engine owns transition validity.

Support mode consumes: `supportBackupCount`, `supportBackupFiles`, `supportLatestBackupPath`, `supportBackupDir`, `exportSupportBackup()`, `restoreSupportBackup(path)`, `openAppDataDirectory()`, `openDiagnosticsDirectory()`, `openLogsDirectory()`, `openEngineLogFile()`, `openSupportBackupDirectory()`, `exportShellDiagnostics()`, `exportCompanionConfig()`.

If the per-step "what's the next valid stage" logic turns out to live in QML today (it may, given how thin `updateCommissioningStage` looks from the shell side), that stays in QML for v2.2.0 — we don't move it engine-side as part of this redesign. An engine-side validator is a follow-up ticket, not a blocker here.

## 6. `Main.qml` / nav-shell implications

- Setup stays **modal** (§C1 resolved). `Main.qml:2573` guard (`visible: workspaceMode !== "setup"` on `DashboardHeaderPanel`) is preserved. The header Setup entry (dashboard-header PR) remains the only on-screen entry.
- The redesigned `SetupWorkspacePanel.qml` replaces:
  - the hero eyebrow/title/description stack (`lines 139-162` today — §C8 finding),
  - the three-up KPI row (Deck Pages / Active Page / Workflow — the Workflow card is the fake-metric per §Setup hierarchy),
  - the left-rail stack of `SetupQuickSetupPanel` / `SetupConnectionProbePanel` / `SetupGuidePanel` / `SetupInstallerHelpPanel` (the individual panels are retained as subcomponents, but their IA is folded into per-step bodies: `SetupQuickSetupPanel` → step 1; `SetupConnectionProbePanel` → step 2; `SetupGuidePanel` → Support mode footer reference rail; `SetupInstallerHelpPanel` → Support mode Install & Update cell).
  - the `ScrollView` wrapper (`lines 84-98`): the runner fits `1440 − 44 − 96 − 72 = 1228 px` body at `2560×1440`, which is enough for any single step. No scroll (§C7).
  - the section-tab bar re-enabled in `91d6e6a` — replaced by the corner Runner/Support toggle.
- `SetupControlSurfacePanel.qml` (1292 LOC) is retained as the step 3/4 body implementation; it gets a new `mode: "map"` / `mode: "verify"` property so the same panel can render the static map and the live-echo pulse variants. The existing 1292 LOC is not rewritten in this redesign — it gets restyled into the runner shell.
- `SetupWizardOverlay.qml` (706 LOC) is **not** part of the new runner flow. It's retained untouched in v2.2.0 for the legacy `needsWizard` path; whether it's eventually subsumed by the runner is a follow-up, not part of this PR.

## 7. qsettings continuity

Two persistence considerations:

1. **Runner step state**: engine-owned via `commissioningStage`. No qsettings key.
2. **Setup corner-toggle mode** (Runner vs Support): new qsettings key `setup.activeSection` stored under the shell settings prefix (`SHELL_SETTINGS_PREFIX`), defaulting to `"commissioning"`. On a fresh install or when the stored value is unrecognised, the runner is the default mode.
3. **Pre-redesign qsettings reads** (from the §C2 restoration in `91d6e6a`): the existing `activeSection` property on `SetupWorkspacePanel` already uses this shape (`"commissioning"` / `"support"`). The new key name matches. No migration shim needed — a pre-redesign qsettings store reads cleanly into the new layout.

Any other keys in the Support subpanels (restore path input, etc.) were never previously persisted and remain ephemeral.

## 8. Keyboard shortcuts

Additions and preservations — all routed through `OperatorShortcutLayer.qml` for consistency with the rest of the app.

| Shortcut  | Context                                       | Action                                                      | Existing / New                               |
| --------- | --------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| `⇧S`      | Anywhere                                      | Enter Setup (`setWorkspaceMode("setup")`)                   | **New** (closes §Setup-no-shortcut finding). |
| `Esc`     | Setup, `startupTargetSurface === "dashboard"` | Back to Console                                             | Existing — preserved.                        |
| `⇧Tab`    | Runner                                        | Previous step (calls `updateCommissioningStage(prev)`)      | **New**                                      |
| `Tab`     | Runner                                        | Next step (calls `updateCommissioningStage(next)`)          | **New**                                      |
| `⏎`       | Runner, any step                              | Invoke footer primary (CONTINUE / PROBE / RESUME / PUBLISH) | **New**                                      |
| `J` / `K` | Step 3 (Map), Step 4 (Verify)                 | Previous / next binding in the binding detail card          | **New** (per Dir B mockup).                  |
| `1`–`4`   | Step 3 (Map)                                  | Jump to page N                                              | **New** (per Dir B mockup).                  |

All "**New**" shortcuts are additive and scoped — `J` / `K` / `1–4` are only live when the runner's step body has focus, so they don't collide with global bindings. `⇧Tab` / `Tab` / `⏎` inside the runner are scoped to the runner root container.

## 9. Parity impact

**All five Setup parity baselines invalidate.** Expected.

The workspace PR adds two additional scenes to the parity script (`scripts/native-parity-capture.mjs`) to cover Support mode and the verify-live-echo frame. Proposed names:

| New scene                  | Engine scene? | Purpose                                                                                                           |
| -------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `setup-support-ready`      | engine        | Support mode with at least one backup (happy path).                                                               |
| `setup-support-empty`      | engine        | Support mode with `supportBackupCount === 0` (empty-backups state from §2).                                       |
| `setup-runner-verify-live` | harness       | Step 4 verify body with a frozen echo pulse on a specific button cell — `parityFrozenClock` pins the pulse frame. |

The existing five scenes (`setup-required`, `setup-control-selected`, `setup-control-page-nav`, `setup-control-dial-selected`, `setup-ready`) are rebaselined to the new runner layout. The PR will ship a `parity: rebaseline setup for v2.2 redesign` commit with two bit-identical offscreen `2560×1440` runs on each CI lane.

Determinism: the verify-live-echo pulse is animation-driven; the `parityFrozenClock` hook on `ParityCaptureHarness.qml` root already pins it — the capture at the harness clock = `14:22:08 UTC` shows the pulse at exactly 160 ms into its 300 ms tween.

## 10. Reference assets

- `docs/redesign/assets/setup/Setup-Redesign.html` — full three-direction Claude Design output (A / B / C). **B is the chosen direction.** The A and C variants are retained in the file as archival context; the delta spec locks Direction B only.

No per-state PNGs in this initial commit; the HTML mockup's built-in state tiles (01 import-drop, 02 probe-error, 03 verify-echo, 04 jump-warning, 05 publish-commit) cover all documented states except empty-backups and snapshot-loading, which are QML-implementation-only.

## 11. Summary of audit findings closed

| Finding                                                    | Severity | How this direction resolves it                                                                                                                    |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| §Setup / §C2 — Support section was dead                    | blocker  | Phase C global prep (`91d6e6a`) already restored it. This workspace restyles it into a dedicated full-width Support mode + operator-clear toggle. |
| §C4 — Ad-hoc font sizes / letter-spacing literals          | high     | All runner + Support typography comes from `textXxs/Xs/Sm/Md`. No raw `font.pixelSize` in the redesigned panel.                                   |
| §Setup hierarchy — Workflow KPI is fake-metric             | high     | The 3-up KPI row is removed entirely. The step header IS the workflow indicator.                                                                  |
| §Setup interactions — plain `Button` / `TextField`         | high     | Replaced with `ConsoleButton` / `ConsoleTextField` as part of this PR (the restored Support code from §C2 carries the stale primitives today).    |
| §Setup density — 1720 px letterbox wastes 420 px / side    | medium   | Runner centers at 1400 px (intentional for focus); Support spans full 1400 px with a 12-col grid. Letterbox is deliberate, not accidental.        |
| §Setup interactions — no keyboard shortcut for Setup       | medium   | `⇧S` added via `OperatorShortcutLayer`.                                                                                                           |
| §C5 — Single-character icons                               | medium   | All runner + Support glyphs come from the bundled Lucide set (`0300988`).                                                                         |
| §C6 — Missing alpha / focus / elevation tokens             | medium   | Resolved in `f1836d8`; this workspace consumes `focusRing*`, `elevation1*`, `accentPrimaryGlow` via `ConsoleStepHeader` and the footer bar.       |
| §C7 — Scroll during commissioning                          | medium   | Runner fits within viewport at `2560×1440`; no `ScrollView` wrapper.                                                                              |
| §C8 — Hero eyebrow / title / description stack             | medium   | Killed. The step header is the title + progress in one band.                                                                                      |
| §Setup interactions — `Setup` button conflates mode/status | medium   | Dashboard-header PR already separated the Setup icon (`wrench`) from the health chips.                                                            |
| Letter-spacing literals `1.6 / 2.4`                        | low      | Tokenized via the `letterSpacingEyebrow` token added in `f1836d8`.                                                                                |
| Raw hex colors in Support code                             | low      | Replaced with `studio*` / `accent*` tokens as part of the Support restyle.                                                                        |

## 12. What is explicitly **not** in this PR

- **Direction C — Inspector tree**. Not shipped. The HTML mockup retains Direction C for archival context only.
- **Direction A — Retune**. Not shipped.
- **Engine-side stage-transition validation**. If it lives in QML today, it stays in QML for v2.2.0. A dedicated follow-up ticket covers moving transition validity into the Rust engine.
- **New device protocols / persistence-format changes / `legacy_import.rs` edits**. Out of scope per the redesign guardrails.
- **`SetupWizardOverlay.qml` (706 LOC) rewrite**. Retained unchanged in v2.2.0 for the legacy `needsWizard` path. Whether the runner eventually subsumes it is a follow-up.
- **`SetupControlSurfacePanel.qml` internal rewrite**. The 1292 LOC panel is restyled into the runner shell and gains a `mode: "map"` / `mode: "verify"` property, but its internal architecture is not rewritten here.
- **Dedicated "deck button pressed" engine signal**. Not added — the verify step reads from `controlSurfaceSnapshotChanged` delta. If a future ticket wants a dedicated signal for lower-latency echo, that is additive and tracked separately.
- **Latency / update-available readouts in the Setup footer**. Those are dashboard-header tokens, deferred per `dashboard-header.md §5`; they don't appear on the Setup surface either.
