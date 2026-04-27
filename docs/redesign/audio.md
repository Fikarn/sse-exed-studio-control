---
workspace: audio
phase: B (direction locked)
status: ready-for-phase-c
chosen_direction: Ar+ - Control-room confidence desk
audit_refs:
  - docs/archive/UX_AUDIT.md §Audio workspace
  - docs/archive/UX_AUDIT.md §C4 (token discipline - closed on the migrated audio shell)
---

# Audio - delta spec

There is no separate HTML direction deck for Audio. This document is the direction lock. It is intentionally **not** derived from the legacy QML Audio workspace. The design source is:

- the operator tasks and failure modes called out in `docs/archive/UX_AUDIT.md`
- the fixed-hardware constraints in `docs/HARDWARE_PROFILE.md`
- the replatform shell patterns already proven in the Lighting and Planning migrations
- the operator posture of this product: one person running a small but ultra-premium studio from one fixed workstation

Direction **Ar+ - Control-room confidence desk** treats Audio as a fixed operator desk, not a scrollable form and not a mini digital console. This page is for one operator who needs confidence, speed, and polish more than breadth.

The workspace is organized around four questions:

1. Are levels and OSC health good right now?
2. Which submix am I editing?
3. What does the selected channel need?
4. Can I safely recall a known-good state?

The answer is a four-region layout: a compact toolbar, a full-width meter bridge for at-a-glance scanning, a left rail for mix targets plus snapshot recall, a center banked strip desk, and a persistent right column that starts with a dedicated **Control Room** zone before the selected-channel inspector. No scroll, no responsive collapse, no hidden second screen.

---

## 1. Layout

Audio stays a primary workspace under the shell header at both `2560x1440` and `1920x1080`. It is a single-screen workspace. There is no mode toggle equivalent to Planning's Timeline/Board or Setup's Runner/Support split.

### Shell - one workspace, one desk

The migrated Audio surface owns the full area below the dashboard header. The workspace is a fixed-height grid, not a `ScrollView`. If the content does not fit, the layout is wrong.

### Region grid - `2560x1440`

| Region       | Size                        | Notes                                                                                                                                                                                          |
| ------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar      | `44 px`                     | `toolbarHeight`. Left to right: active mix-target title, OSC/trust state, sync action, bank controls, density toggle, current snapshot readout. Search is intentionally not a primary control. |
| Warning band | `40 px` when present        | Inline trust/degraded posture. Visible only when the current engine state is anything other than healthy and aligned.                                                                          |
| Meter bridge | `136 px`                    | Full-width compact meter overview for every channel in the current snapshot. This is the fast confidence surface.                                                                              |
| Left rail    | `300 px`                    | Two stacked cards: `Mix Targets` and `Snapshots`. Mix-target selection remains the loudest rail item.                                                                                          |
| Mixer bank   | flexible, minimum `1400 px` | Two visual density modes: `Overview` (`12` strips) and `Precision` (`8` strips). No horizontal scrolling. Bank paging is explicit.                                                             |
| Right column | `460 px`                    | Top: persistent `Control Room` zone. Bottom: selected-channel inspector. If no channel is selected, the lower panel becomes a session/help card.                                               |

### Region grid - `1920x1080` fallback

The same structure stays intact. Nothing collapses into a single column.

| Region       | Size                                                               |
| ------------ | ------------------------------------------------------------------ |
| Toolbar      | `44 px`                                                            |
| Warning band | `40 px` when present                                               |
| Meter bridge | `104 px`                                                           |
| Left rail    | `280 px`                                                           |
| Right column | `380 px`                                                           |
| Mixer bank   | flexible, minimum `1180 px` in `Overview`, `960 px` in `Precision` |

### Detailed behavior

- The **meter bridge** always shows the full channel inventory from `audio.snapshot.channels`, grouped by role order as published by the engine. Clicking a bridge meter selects that channel and pages the bank to make the strip visible.
- The **mixer bank** is explicitly banked and has two density modes:
  - `Overview` is the default and shows more strips with slightly lighter controls.
  - `Precision` shows fewer strips with larger meters and faders for critical adjustment.
- The current engine-owned `fadersPerBank` setting remains the authority for bank size where it already applies; the shell density mode is visual, not a new product-state concept.
- The **left rail** is authoritative for "which mix am I editing?" and "which saved snapshot can I recall?".
- The **right column** is authoritative for monitoring confidence:
  - the upper `Control Room` card surfaces monitor/speaker/phones state and monitor actions
  - the lower panel is authoritative for a single selected channel
- Detailed controls do not float over the strip bank.

---

## 2. Visual standard

Audio must feel like a finished premium control surface, not an internal tool and not a generic web mixer.

### Material and hierarchy rules

- The page should read as **quiet, expensive, and deliberate**.
- The strongest visual priorities are:
  1. current mix target
  2. signal state and meter activity
  3. degraded/trust state
  4. selected channel
- Persistent surfaces must not all feel equally loud. If the left rail, strip bank, and right column compete equally, the hierarchy is wrong.
- Use layered surfaces and restrained depth instead of heavy borders everywhere.
- Typography should do more hierarchy work than color. Mono should be used for state, labels, and numeric readouts; Sans for names and actions.

### Signal-first rendering rules

- Meters should feel production-ready on the target display:
  - clean scale rhythm
  - visible peak hold
  - decisive clip indication
  - obvious selected-state overlay
- Faders and toggles must look purpose-built, not like default app controls.
- Warning posture should be narrow and specific, not a generic red slab.

### Motion rules

- Meter motion is real-time and data-driven.
- Selection, bank changes, density changes, sync success, and snapshot recall should transition smoothly and briefly.
- Motion should clarify state, not decorate it.
- No playful bounce, overshoot, or consumer-app animation language.

---

## 3. States

Audio needs explicit operational states. "Connected" is not enough.

| State                      | Surface behavior                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Snapshot loading           | Toolbar + rails render skeletons; meter bridge renders shimmer bars; bank renders skeleton strips; right column renders quiet placeholders. No fake zeroes.                                                  |
| Ready / verified / aligned | OSC chip shows `VERIFIED`, sync action is enabled, meter bridge is live, mix rail and strip bank are fully interactive.                                                                                      |
| Ready / verified / assumed | OSC chip shows `ASSUMED`; warning-band copy becomes `STATE ASSUMED - using last synced console state.` The page remains fully usable, but recall stays visually cautious until the operator runs `Sync`.     |
| Not verified               | Warning-band copy becomes `OSC NOT VERIFIED - run Sync before trusting recall or current fader state.` Rail and inspector remain visible so the operator can correct settings without leaving the workspace. |
| OSC disabled               | Warning-band copy becomes `OSC DISABLED - page is read-only until transport is re-enabled.` Strips render read-only; meters render the disabled posture from `meteringState`.                                |
| Disconnected               | Warning-band copy becomes `CONSOLE UNREACHABLE - audio may still be passing, but control state is not current.` Sync is still present; last-action code/message surfaces in the session card.                |
| Action failed              | Warning band stays compact but specific: `SYNC FAILED`, `SNAPSHOT RECALL FAILED`, or the engine-supplied action summary.                                                                                     |
| Selected channel           | Matching meter-bridge item, strip, and inspector header all highlight together.                                                                                                                              |
| No selected channel        | The lower right panel becomes a contextual help card: current mix target, last recall, sync status, and keyboard hints. The upper `Control Room` card stays persistent.                                      |
| Snapshot recalled          | Snapshot row flashes a success state, toolbar readout shows `Recalled {snapshotName}`, and the session card updates `lastSnapshotRecallAt`.                                                                  |

The state model is driven entirely by `audio.snapshot.status`, `verified`, `connected`, `oscEnabled`, `meteringState`, `consoleStateConfidence`, and the last-action fields already exposed by the engine.

---

## 4. Components and tokens

Audio stays inside the existing console design system. No ad-hoc spacing or raw hex literals.

### Existing primitives reused

- `ConsoleButton` - toolbar actions, bank navigation, snapshot recall
- `ConsoleSurface` - toolbar cards, rail cards, right-column cards
- `ConsoleBadge` / `ConsoleStatusBadge` - OSC state, selected mix-target state, last-action status
- `ConsoleSlider` - strip fader and inspector fader/gain controls
- `ConsoleStatChip` - compact session readouts

### New primitives introduced additively

- `ConsoleMeterBridge`
  Full-width compact meter overview. Owns grouping, clip tint, selected-state outline, and bank-page hinting.
- `ConsoleMixerStrip`
  The main bank strip primitive: label, stereo-aware meter, fader, mute, solo, and small capability chips for phantom/pad/instrument/auto-set where supported.
- `ConsoleMixTargetRail`
  Vertical target selector with a loud active state and role chips.
- `ConsoleSnapshotList`
  Dense list of recallable snapshots with `current`, `last recalled`, and quick-recall affordances.
- `ConsoleControlRoomPanel`
  Persistent monitoring surface for speaker/phones state and monitor actions such as `dim`, `mono`, `talkback`, and speaker selection.
- `ConsoleChannelInspector`
  Selected-channel detail surface used by both the bank click path and the meter-bridge click path.
- `ConsoleDeskDensityToggle`
  Compact two-state control for `Overview` vs `Precision`.

### Token rules

- Use `ConsoleTheme` spacing tokens only.
- Keep the toolbar at `44 px`, matching the Planning and Lighting migrated surfaces.
- Keep meter contrast and clip color consistent with dashboard/health semantics; do not introduce an audio-only palette.
- Audio remains dark-only and IBM Plex-based.
- Audio should use fewer, stronger surfaces than Planning. This page should feel more like premium equipment software than a general productivity workspace.

---

## 5. Interaction model

The desk is optimized for five operator tasks from the audit:

1. **Scan channel meters**
   The meter bridge is the fast read. The strip bank is the detailed read.
2. **Adjust a channel**
   Select from bridge or strip, then use the strip or inspector controls.
3. **Recall a mix snapshot**
   Recall from the left-rail snapshot list; confirmation comes back through the toolbar and session card.
4. **Switch between mix targets**
   The left rail is the primary target selector. The active target is echoed in the toolbar title.
5. **Verify OSC connection**
   The toolbar chip and warning band make verification state impossible to miss.

### Mix-target hierarchy

The active target is rendered in three places so the operator never loses context:

- toolbar title: `EDITING {targetName}`
- active row in the `Mix Targets` rail
- upper `Control Room` / session card

### Strip model

Each strip shows:

- channel name + short name
- stereo or mono marker
- live meter with peak hold and clip state
- fader
- mute / solo
- capability row only for fields supported by that channel

Detailed toggles like phantom, pad, instrument, phase, and auto-set live in the inspector so the strip face stays readable at operator distance.

### Control Room model

The top-right `Control Room` card is not generic metadata. It is a working operator surface. It should show:

- current monitor output / speaker target
- monitor level / dim / mono state
- talkback state when available
- current phones target / cue state when available

For this product, that card is more important than exposing deep per-channel secondary options.

### Snapshot model

Snapshots are treated as **known-good operator states**, not a giant live-console scene system.

- The rail is compact and recall-first.
- `Current / last recalled` state should be visually obvious.
- Full `Workspace/Layout` recall is a separate concept and is not mixed into the audio snapshot rail.

---

## 6. Keyboard

Audio gets an explicit keyboard model. This closes the audit finding that channel selection is currently click-only, but keeps the command set small and high-value.

| Key            | Behavior                                                                                |
| -------------- | --------------------------------------------------------------------------------------- |
| `A`            | Enter Audio from anywhere in the shell.                                                 |
| `[` / `]`      | Previous / next strip bank page.                                                        |
| `1-8`          | Select strip `1-8` in the current visible bank.                                         |
| `Shift+1-8`    | Recall snapshot row `1-8` from the visible snapshot rail.                               |
| `M`            | Toggle mute on the selected channel.                                                    |
| `S`            | Toggle solo on the selected channel.                                                    |
| `Up / Down`    | Move selection to the previous / next visible strip.                                    |
| `Left / Right` | Move mix-target selection left / right within the published mix-target order.           |
| `V`            | Toggle `Overview` / `Precision` density.                                                |
| `Enter`        | Run `Sync` when focus is in the warning band, otherwise activate the focused rail item. |
| `Esc`          | Clear selected channel first, then return focus to the bank.                            |

Guard rule: shortcuts are active only when `workspaceMode === "audio"` and no text field is focused.

---

## 7. Engine surface delta

Phase C Audio migration should start from the current engine contract. **No protocol additions are required to begin the migrated workspace.**

### Current surfaces to use as-is

- `audio.snapshot`
- `audio.sync`
- `audio.snapshot.recall`
- `audio.channel.update`
- `audio.mixTarget.update`
- `audio.settings.update`
- `commissioning.check.run` with `target: "audio"`

### Engine-owned state that remains authoritative

- selected channel: `audio.settings.update.selectedChannelId`
- selected mix target: `audio.settings.update.selectedMixTargetId`
- bank size: `audio.settings.update.fadersPerBank`
- OSC runtime settings and expectations: `audio.settings.update`
- connection / verification / degraded state: `audio.snapshot`

### Shell-local transient state

These do **not** belong in the engine:

- current bank page index
- current density mode
- current keyboard focus ring

They are view state, not product state.

### What this spec does **not** require from Rust

- no new mixer math
- no new device-policy logic
- no new persistence tables
- no new snapshot fields for Phase C baseline

If later slices need richer channel grouping or additional console diagnostics, they must be added additively after the baseline migration lands.

---

## 8. Verification and degraded posture

Audio must explicitly separate verification from mere connectivity.

### Toolbar health cluster

The toolbar shows:

- OSC status chip derived from `verified`, `connected`, and `oscEnabled`
- `Sync` action
- last-sync time when available
- current snapshot readout when available

Status copy:

- `VERIFIED`
- `ASSUMED`
- `NOT VERIFIED`
- `DISABLED`
- `OFFLINE`

### Warning band

When Audio is anything other than `verified + aligned`, the workspace shows a warning band directly under the toolbar. The band is not dismissible. It persists until the engine snapshot says the state is healthy again.

The copy must be **specific** rather than generic:

- `STATE ASSUMED`
- `OSC NOT VERIFIED`
- `OSC DISABLED`
- `CONSOLE UNREACHABLE`
- `ACTION FAILED`

### Right-column session card

The upper right-column session / control-room stack always shows:

- current mix target
- `consoleStateConfidence`
- `lastConsoleSyncAt`
- `lastActionStatus`
- `lastActionCode` / `lastActionMessage` when present

This makes troubleshooting possible inside the workspace and answers the audit's "OSC not verified needs explicit design" finding.

---

## 9. Parity and visual gates

Audio is an operator-critical surface. It needs deterministic captures for both layout fit and meter/readability postures.

### Required parity scenes

- `audio-ready-overview`
- `audio-ready-precision`
- `audio-state-assumed`
- `audio-not-verified`
- `audio-osc-disabled`
- `audio-offline`
- `audio-selected-channel`
- `audio-1920-fallback`

### Visual gates

- No scrollbars at `2560x1440`.
- No scrollbars at `1920x1080`.
- Strip bank remains readable at operator distance in both target sizes and both density modes.
- Warning-band copy remains visible without overlapping the meter bridge.
- Active mix target is visually obvious in toolbar + rail + control-room card simultaneously.
- The page should be screenshot-ready as a product surface, not just functionally correct.

As with the other migrated workspaces, Playwright and fixture coverage are the replacement-shell gate until cutover, while Qt parity remains the shipping gate.

---

## 10. File and component implications

Audio should follow the same migration pattern as Lighting and Planning:

- add Audio-specific view-model helpers in the replacement shell rather than embedding transformation logic in the component body
- keep React/QML derived from engine snapshots and explicit commands only
- prefer additive `Console*` primitives over ad-hoc one-off UI

Expected replacement-shell building blocks:

- `AudioWorkspace` surface in the React shell
- shared audio selectors/helpers beside the existing shell-data helpers
- fixture-driven scenarios for healthy / assumed / degraded / selected / fallback states
- focused browser tests for bank selection, density switching, mix-target switching, sync posture, and snapshot recall

---

## 11. Summary of audit findings closed

| Audit finding                             | Severity | Resolution in this spec                                                                                                                  |
| ----------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| No protective scroll or content-fits gate | high     | Audio is defined as a fixed-height desk with explicit `2560x1440` and `1920x1080` fits. No `ScrollView`, no stacked responsive collapse. |
| Meter legibility unverified               | high     | Full-width meter bridge plus a banked strip desk is the core layout, not an afterthought. Parity scenes explicitly cover it.             |
| `OSC not verified` lacks explicit design  | high     | Toolbar status chip, warning band, and the right-column session stack all surface verification state and last-action details.            |
| No keyboard channel selection             | medium   | `1-8`, bank paging, directional navigation, density toggle, and mute/solo shortcuts are part of the locked keyboard model.               |
| Mix-target hierarchy unclear              | medium   | Active target is repeated in the toolbar title, left rail, and the dedicated control-room/session card.                                  |
| No theme-token usage / numeric literals   | medium   | Audio is explicitly required to use `ConsoleTheme` tokens and additive `Console*` components only.                                       |

---

## 12. What is explicitly **not** in this phase

- A routing matrix / patchbay redesign
- FX, EQ, dynamics, or plugin-style channel processing views
- Pan / balance controls that are not already exposed in the engine contract
- Audition / pre-fader-listen controls beyond what the current native engine already supports
- Multi-window audio tools or floating strip dialogs
- Scroll-based "show more strips" behavior
- A design derived from the legacy QML workspace layout
- Any movement of audio device logic or persistence logic into React
- Multi-screen live-console workflows, roaming-tablet workflows, or multi-operator assumptions

Phase C should implement the operator-critical mixer desk first. Wider audio-console features are follow-up work only if the engine contract and operator need justify them.
