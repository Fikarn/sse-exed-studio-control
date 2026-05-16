---
workspace: dashboard-header
phase: B (direction locked)
status: ready-for-phase-c
chosen_direction: D — monitor rail + single-row tabs
audit_refs:
  - docs/archive/UX_AUDIT.md §Dashboard Header Panel
  - docs/archive/UX_AUDIT.md §C1, §C4, §C5, §C6, §C8, §C9, §C10, §C11
---

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

# Dashboard header — delta spec

Reference composite (Directions A / B / C / D): `docs/redesign/assets/dashboard-header/directions-composite.png`.

Direction **D** is the locked direction. D separates reference data (monitor rail, row 1) from interactive nav (tab strip, row 2), which makes the tabs the visually loudest element without sacrificing always-on telemetry.

---

## 1. Layout

Two rows, total height **90 px** (6.3 % of 2560×1440).

### Row 1 — monitor rail (22 px)

All-caps, IBM Plex Mono, `theme.textXxs` (10 px), `theme.studio500` base colour, word separator is U+2002 en-space.

Left cluster (fixed order, label-prefixed):

| Token                     | Source                             | Notes                                                                                                                                                                 |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENGINE {engineVersion}`  | `engineController.engineVersion`   | Existing.                                                                                                                                                             |
| `PROTO {protocolVersion}` | `engineController.protocolVersion` | Existing. Composite string; no per-protocol split for v2.2.0.                                                                                                         |
| `UPTIME {hh:mm:ss}`       | QML-derived                        | Track the QML process's own uptime from `Component.onCompleted`. Engine uptime requires an engine-side start-timestamp surface — **deferred**, not in this workspace. |

Right cluster (fixed order):

| Token                                  | Source                                                                  | Notes                                                             |
| -------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `DMX {READY\|DOWN}`                    | `engineController.lightingReachable`                                    | Existing.                                                         |
| `OSC {VERIFIED\|CONNECTED\|OFF\|DOWN}` | `engineController.audioConnected` + `audioVerified` + `audioOscEnabled` | Existing composite.                                               |
| `STORAGE {storageDetails}`             | `engineController.storageDetails`                                       | Existing. Label string used as-is; no engine reformatting.        |
| `{HH:MM:SS UTC}`                       | QML timer                                                               | Pure QML. Timer increments every second, no engine signal needed. |

### Row 2 — tab strip (68 px)

Layered left-to-right:

1. **Brand mark** — 24 px mono glyph ("Studio Control" wordmark collapsible to a dot glyph below 1680 px), `theme.studio200`. No hero copy. Clickable as a no-op for now (reserved for a future brand action).
2. **Session marker** — optional, mono, `theme.studio500`. Derived from `Qt.application.displayName` + the machine hostname at runtime (Qt's `SysInfo`). If hostname is unavailable, hide the marker. No new Q_PROPERTY needed.
3. **Workspace tabs** — three `ConsoleButton` with a new `tone: "workspaceTab"` variant (see §3). Each tab:
   - Icon (stroked, 18 px, from the bundled icon set — see §4).
   - Title: `Planning` / `Lighting` / `Audio`. Note the Planning rename (§C11).
   - Active tab gets a subtitle line (mono, `theme.textXxs`, `theme.studio500`) derived from existing state:
     - Planning → looked-up project name: `planningProjects[*].name` where `id === planningSelectedProjectId`. Empty string if no selection.
     - Lighting → `universe {lightingUniverse} · {lightingFixtureCount} fixtures`. Empty if `lightingFixtureCount === 0`.
     - Audio → `{audioSendHost}:{audioSendPort}` when `audioSendHost.length > 0`.
   - Keyboard shortcut badge (`K` / `L` / `A`) via existing `OperatorShortcutLayer`. Fixes §C10 once the Planning label matches its shortcut.
4. **Operator Health pill** — `ConsoleBadge` variant with `accentGreen` / `accentAmber` / `accentRed` tint depending on `engineController.healthStatus`. Sized one tier larger than Tier-2 chips so it's the unmistakable at-a-glance element (§C1 — resolves Operator Health dominance).
5. **Density chips** — `90 / 100 / 108` as three small `ConsoleButton` tone `"chip"`. Clearly grouped visually, no longer interleaved with health (§C9).
6. **About** (ⓘ), **Help** (?), **Enter Setup** (⚙) — three icon buttons. Setup uses the icon set's `wrench` glyph to read as commissioning/service rather than settings. Keep one-of-many-utility semantics, but keep the Setup glyph visually distinct (subtle outline variant).

## 2. States

| State                     | Monitor rail                                                                                                                                                   | Tab strip                                                                                                                                                                                                                                                                                                                                                                                                                  | Trigger                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Healthy**               | Normal.                                                                                                                                                        | Healthy pill.                                                                                                                                                                                                                                                                                                                                                                                                              | `healthStatus === "healthy"` and all protocols reachable.                                                                                                                                               |
| **Snapshot loading**      | Rail collapses to `STARTING ENGINE…` only (one 24 px centered status line).                                                                                    | Tabs dim to `studio600`, pill reads `STARTING` with a 1.2 s pulse using `theme.accentAmber`.                                                                                                                                                                                                                                                                                                                               | `!appSnapshotLoaded` or `startupPhase !== "ready"`.                                                                                                                                                     |
| **Degraded**              | Rail shows normal data; affected tokens (DMX / OSC) flip colour to `accentAmber`.                                                                              | Pill reads `DEGRADED` in amber.                                                                                                                                                                                                                                                                                                                                                                                            | `healthStatus === "degraded"`.                                                                                                                                                                          |
| **Hardware disconnected** | Rail background shifts to a **red-black** (`Qt.rgba(accentRed.r,g,b, 0.10)` over `studio950`). Affected tokens (`DMX DOWN` / `OSC DOWN`) in `accentRed`.       | A **30 px striped alert banner** slides in **between** the rail and the tab strip. Banner: `HARDWARE UNREACHABLE  —  DMX + OSC down  —  last reply 14:22:08` + two action buttons (`Retry` → `engineController.reconnectHardware()` if available, `Open Setup` → `engineController.setWorkspaceMode("setup")`). Total header height grows to 120 px while the banner is present. Banner is non-dismissable until resolved. | `lightingReachable === false` **AND** `audioConnected === false`. (Single-protocol outage stays at "degraded", does not slide the banner.)                                                              |
| **Update available**      | Whisper `UPDATE 4.3.0 AVAILABLE` clause next to `ENGINE {engineVersion}` in `accentPrimary`. Plus the About icon carries a 4 px sage pip. No popover on hover. | No change.                                                                                                                                                                                                                                                                                                                                                                                                                 | **Deferred** — requires maintenance-tool update detection. Not implemented in the v2.2.0 dashboard-header PR; slot exists in QML, wired to a `false` constant until a follow-up ticket adds the signal. |

## 3. New / modified tokens and component variants

### Tokens — `ConsoleTheme.qml`

No new tokens required. The additive tokens shipped in `f1836d8` already cover:

- `focusRing`, `focusRingWidth`, `focusRingOffset` — for the tab focus ring (§C10 focus resolution).
- `accentPrimarySoft`, `accentPrimaryGlow` — for active-tab underline + subtle glow.
- `elevation1Shadow`/`OffsetY`/`Blur`, `elevation2*` — for the Operator Health pill lift.

### Component variants — `Console*`

Additive, shipped as part of this workspace's PR:

| Component       | Change                                                                                                                                                                                                                                                                                                                                     | Usage                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ConsoleButton` | New `tone: "workspaceTab"` — taller (`toolbarHeight` instead of `controlHeight`), 12 px horizontal padding, optional `subtitle` property (mono, textXxs, studio500) rendered under the title. `active: true` paints a 3 px `accentPrimary` underline flush with the tab's bottom edge + a subtle top-down sage wash (`accentPrimaryGlow`). | Row 2 workspace tabs.                                                                                                       |
| `ConsoleButton` | New `tone: "monoRail"` — 22 px height, mono, 6 px padding, no background, transparent; used for rare interactive tokens in the rail (not used today, reserved).                                                                                                                                                                            | —                                                                                                                           |
| `ConsoleBadge`  | New `tone: "operator"` — larger than default (`height: 30`, pill radius, lift via elevation1).                                                                                                                                                                                                                                             | Operator Health pill in row 2.                                                                                              |
| `ConsoleBadge`  | New `tone: "rail"` — ultra-compact (`height: 16`, radius 4, mono textXxs, no border).                                                                                                                                                                                                                                                      | Rail readouts like `DMX READY` use this instead of raw Labels so the `healthy/degraded/down` tint logic lives in one place. |

No existing `Console*` component gets a breaking change. Old tones stay registered; nothing currently uses `"workspaceTab"` / `"operator"` / `"rail"`.

## 4. Dependencies needed

**Required**: a bundled SVG icon set. The composite uses stroke-based monochrome icons for brand mark, tab icons, About, Help, Setup, and external-link. Picking **Lucide** for:

- MIT license, parity-safe.
- Stroke-based, 1.5 px weight at default → crisp at `2560×1440` and still legible at `1920×1080` fallback.
- Small footprint: ship only the 8–12 icons the header actually needs, rasterised as SVG resources in `qrc`, no runtime dependency.
- Reversible: rollback is removing the `qrc` entries and 8 files.

Icons to bundle for the dashboard-header PR:

`lucide/planning` → `clipboard-list`, `lucide/lighting` → `lamp`, `lucide/audio` → `audio-waveform`, `lucide/setup` → `wrench`, `lucide/about` → `info`, `lucide/help` → `circle-help`, `lucide/external` → `external-link`, `lucide/back` → `arrow-left`, `lucide/alert` → `triangle-alert`.

The icon set passes all six dependency-policy criteria (justified — §C5 replacement; parity-safe — static SVGs; MIT license; ships as `qrc` resources, zero install delta; single-purpose; grep-findable removal).

Pre-approved runtime modules potentially used:

- **QtQuick.Effects** (already available at Qt 6.5 floor) — for the subtle sage glow on the active tab and the elevation on the Operator Health pill.
- **QtQuick.Shapes** — not used for the header.

**Not used, not introduced**: QtCharts, QtQuick3D, third-party QML libraries.

## 5. Engine surface delta

**None required for v2.2.0.**

The direction reuses existing `Q_PROPERTY` surface. Two readouts in the mockup are explicitly deferred rather than expanding the engine surface:

- `LATENCY {x.x ms}` — requires protocol-round-trip instrumentation on the Rust side. Not part of v2.2.0 dashboard-header; the token is omitted from the rail layout for v2.2.0. (Tracked for a separate ticket under `docs/PRODUCTIZATION_PLAN.md`.)
- `UPDATE {version} AVAILABLE` — requires QtIFW maintenance-tool update-repo polling. Not part of v2.2.0; the QML slot exists but is wired to `false`. (Tracked separately.)

If a future ticket adds these, they are additive properties on `EngineProcess` (e.g. `Q_PROPERTY(int ioLatencyMs …)`, `Q_PROPERTY(QString updateAvailableVersion …)`) feeding already-budgeted rail positions.

## 6. `Main.qml` / nav-shell implications

- Workspace tab labels and icons: Planning tab renames from **Projects** → **Planning** everywhere in the header (resolves §C11). Internal state remains `planningmode === "planning"`.
- Header visibility: per §C1, Setup stays a **modal mode** — `DashboardHeaderPanel` continues to be hidden (`visible: workspaceMode !== "setup"`). The **Enter Setup** gear button in the header is the only on-screen entry. Escape from Setup back to Planning remains via the existing Setup back-button.
- Shortcut layer: `OperatorShortcutLayer` already maps `K` to Planning. No change.
- Overall header implicit height becomes `monitorRail.height + tabRow.height + (hardwareDisconnectedBanner.visible ? 30 : 0)` — 90 px normal, 120 px during a dual-protocol outage. Below the 12 % vertical-budget ceiling in both states.

## 7. qsettings continuity

No persisted state in the header itself. The dashboard-header PR does not touch qsettings keys.

## 8. Keyboard shortcuts

All existing shortcuts preserved. The Planning tab label finally matches the `K` binding (closes §C10 as a label-side fix). No new shortcuts introduced; any new utility (About / Help / Enter Setup) remains click-only to keep the shortcut surface small.

## 9. Parity impact

**All dashboard-header parity baselines invalidate.** Expected — the redesign is ground-up for this surface. The workspace PR will ship a `parity: rebaseline dashboard-header for v2.2 redesign` commit with two bit-identical offscreen `2560×1440` runs on each CI lane.

## 10. Reference assets

- `docs/redesign/assets/dashboard-header/directions-composite.png` — composite of A / B / C / D. D is the chosen direction; the A/B/C variants remain in the composite as archival context.

(Additional per-state isolated PNGs can be added later if needed; the composite covers all four non-happy states for Direction D.)

## 11. Summary of audit findings closed

| Finding                                        | Severity | How this direction resolves it                                                                                                                 |
| ---------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| §C1 — Setup nav asymmetry                      | high     | Setup is modal-only; header entry is a distinct wrench icon, no tab peer.                                                                      |
| §C4 — Ad-hoc font sizes / raw hex              | high     | All sizes come from `textXxs/Xs/Sm/Md`; all colours from `studio*` / `accent*` tokens. Monorail = Plex Mono textXxs.                           |
| §C5 — Single-character icons                   | medium   | Replaced with Lucide SVG icon set.                                                                                                             |
| §C6 — Missing alpha / focus / elevation tokens | medium   | Resolved in `f1836d8`; this workspace consumes those tokens.                                                                                   |
| §C8 — Hero eyebrow copy waste                  | medium   | Killed. Active tab title doubles as the screen title.                                                                                          |
| §C9 — Scale chip placement                     | low      | Chips visually grouped with utility icons on the far right, separated from health.                                                             |
| §C10 — K vs P vs Projects                      | low      | Planning label finally matches the `K` shortcut. Icon derives from Lucide.                                                                     |
| §C11 — Planning / Projects drift               | low      | "Planning" everywhere, across header, workspace, and stat labels (removes the stat label duplication in §C1 since stats are removed entirely). |
| Operator-Health hierarchy                      | medium   | Oversized sage pill on far-right tab row; Tier-2 readouts mono in the rail.                                                                    |
| Hardware-disconnected signal                   | medium   | 30 px striped red banner between rail and tabs with direct actions. Impossible to miss under studio lighting.                                  |
| Snapshot-loading state                         | medium   | Rail collapses to one pulsing line; tabs dim.                                                                                                  |

## 12. What is explicitly **not** in this PR

- Latency readout (engine instrumentation required; deferred).
- Update-available detection (maintenance-tool polling required; deferred).
- Per-protocol OSC/sACN version split (engine-side `protocolVersion` composition required; deferred).
- Stats row / stat cards — removed. The Planning stat card duplicated the tab label and was wrong on other workspaces.
- The hero copy card — removed.
