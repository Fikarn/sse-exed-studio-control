---
workspace: audio
phase: lighting-aligned redesign plan
status: historical-reference
chosen_direction: Audio L1 - Control Room Signal Desk
prototype: docs/redesign/assets/audio/Audio-Lighting-Aligned-Desk.html
current_truth: docs/HANDOFF.md
supersedes:
  - docs/redesign/assets/audio/Audio-Redesign.html
  - earlier Ar+ / control-room confidence desk notes
---

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and historical context, not as an active implementation contract.

# Audio L1 - Control Room Signal Desk

This is the new Audio direction. Treat older Audio direction documents and prototypes as historical context only. The visual authority is the current implemented Lighting workspace: dark studio canvas, warm green operational state, sharp radius scale, mono data labels, serif workspace title, glass overlay pills, left rail, center work surface, right inspector, and full-width bottom health bar.

Audio should feel like the sibling of Lighting, not a separate application and not a miniature TotalMix clone. It should, however, preserve the operator workflow model that makes RME TotalMix fast: select a hardware output/submix, then adjust hardware-input and software-playback sends into that selected output.

## Verified Inputs

- Current Lighting implementation: `frontend/app/src/app/lighting/**`.
- Current Audio implementation: `frontend/app/src/app/audio/AudioWorkspace.tsx` and `AudioWorkspace.module.css`.
- Current protocol fields: `native/protocol/v1.md` under `audio.snapshot`, `audio.sync`, `audio.snapshot.recall`, `audio.channel.update`, `audio.mixTarget.update`, and `audio.settings.update`.
- Hardware target: RME Fireface UFX III, front preamps `9-12`, rear line inputs `1-8`, software playback, Main monitors, Phones 1, Phones 2.
- Fit verification already run for current Audio: `npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174`, 8 screenshots, 0 failures.

Official external references used for behavior only:

- RME TotalMix FX 2.0: modern graphics engine, freely scalable UI, smooth zooming in Mixer and Matrix views, DPI-aware behavior, clearer channel focus, full-channel layout color tinting, improved snapshot handling, undo/redo, and peak-meter reset.
- RME TotalMix user interface: default 3-row inline view with hardware inputs, software playback, and hardware outputs; source rows feed the selected hardware-output submix.
- RME TotalMix channel strip: numerical RMS/Peak display, green RMS/average bar, yellow peak line, red over indication, configurable peak hold / over detection / RMS reference.
- RME TotalMix control strip: Submix mode is the default/preferred operation; selecting a hardware output darkens other outputs and points source-row routing fields to that destination.
- RME TotalMix submix tools: copy, paste, mirror, clear, and loopback are hardware-output/submix operations, not generic channel operations.
- RME hardware metering: green for normal signal, yellow around `-5 dBFS`, orange around `-4 dBFS`, red around `-1 dBFS`, and fast red flash at `0 dBFS`.
- Allen & Heath SQ/dLive metering: default colors mimic traditional meters; meters have independent source points and red channel-name/meter activity for muted or active processing states.
- RME TotalMix FX: independent submixes, Control Room, snapshots, groups, OSC/Mackie remote, real-time meter state.
- RME MIDI remote: fader bank movement, selected output bus/submix selection, Main Out, Dim, Talkback, Mono, Mute, Solo, Select, and Snapshot 1-8 mappings.
- Yamaha DM3: top-panel separation of selected channel strip, main section, user-defined keys, phones section, and fader bank section.
- Yamaha DM3 fader banks: explicit input/output/custom fader bank switching.
- Yamaha DM3 setup: recall safe, custom fader bank, mute group, patch, word clock, and phantom global safety live in setup, not the primary mixing face.
- Avid S4/S6: meter layouts and spill zones validate dedicated meter surfaces and persistent banked layouts for important session elements.

Source URLs:

- https://rme-audio.de/totalmix-fx-2.0.html
- https://docs.rme-audio.com/aoxd/810-1c_totalmix_user_interface/
- https://docs.rme-audio.com/aoxd/811-1c_channel_strip/
- https://docs.rme-audio.com/aoxd/813-1c_control/
- https://docs.rme-audio.com/aoxd/840-1c_asio_direct_monitoring/
- https://docs.rme-audio.com/12mic/021-4r_meter_to_db/
- https://support.allen-heath.com/hc/en-gb/articles/4402946054417-SQ-Working-with-Chromatic-Channel-Metering
- https://support.allen-heath.com/hc/en-gb/articles/39792725104401-Meters
- https://rme-audio.de/totalmix-fx.html
- https://docs.rme-audio.com/aoxd/850-1c_midi_remote_tmfx/
- https://manual.yamaha.com/pa/mixers/dm3/rm/en-US/6153511691.html
- https://manual.yamaha.com/pa/mixers/dm3/rm/en-US/6153554571.html
- https://manual.yamaha.com/pa/mixers/dm3/rm/en-US/6296253579.html
- https://resources.avid.com/SupportFiles/ProMixing/S4_S6_Guide_v2020.11.pdf

## Product Model

Audio is a single-operator studio signal desk. The four dominant questions are:

1. Is the console state trustworthy right now?
2. Which hardware output/submix am I editing?
3. Which hardware inputs and software playback channels feed that selected submix?
4. Can I recall or re-sync a known-good state without leaving the desk?

The page must not become a full generic digital mixer. The operator is not editing arbitrary routing, EQ, dynamics, room correction, or plug-ins here. Those belong in TotalMix or Setup unless the Rust engine later exposes a specific, workstation-scoped control.

The primary workflow is therefore:

1. Select a destination in the hardware-output tier or the left `Mix targets` rail.
2. The selected output becomes the active submix everywhere: toolbar, center pill, left rail, inspector, and health bar.
3. Adjust source sends from the `Hardware Inputs` and `Software Playback` tiers into that selected output.
4. Use the bottom `Hardware Outputs` tier for monitor/phones level, dim, mono, talkback, cue, and output/submix selection.

This follows RME's Submix View mental model: source rows do not represent one global fader state; their fader positions are meaningful in the context of the currently selected hardware output.

## Operator Layering Model

The page must serve two operator types at the same time without splitting into separate junior and senior views.

Junior operator path:

- first read is trust state, active output/submix, current snapshot, and monitor health.
- primary actions are `Recall`, `Sync`, output/submix select, Dim, Mono, Talkback, Mute, Solo, and basic monitor level.
- advanced setup and destructive or confusing operations are not visible as equal-weight controls.
- if the console is healthy, the operator should be able to sit down, confirm `Main Out`, select a known-good snapshot, watch meters, and run the session.

Senior operator path:

- detailed controls live one layer deeper in the persistent inspector tabs, row context menus, command palette, and setup action.
- senior controls include channel capability controls, exact send values, submix copy/mirror/clear when the engine exposes them, OSC setup, expected peak/submix compatibility settings, and detailed failure diagnostics.
- senior operations should be reachable without changing to a different page model; the layout stays one desk and progressively reveals detail around the current selection.
- the active selection must bridge both paths: when a senior selects a playback source or output, the rail, tier, inspector, and health bar all explain the same object.

Layering rule: junior-safe operations live in the toolbar, left rail, active output tier, and health bar. Senior operations live in inspector detail, context menus, explicit setup actions, and command palette entries. Do not create two separate workspace modes.

## Visual Direction

Use the current Lighting workspace as the visual standard.

- Shell header remains shared.
- Audio toolbar mirrors Lighting toolbar: display title on the left, state chips and numeric stats next, operational controls on the right.
- Center surface is a dark, fixed signal canvas, analogous to Lighting's stage plot.
- Left rail is dense and recall-oriented, analogous to Lighting's master/scenes/groups rail.
- Right inspector is persistent, analogous to Lighting's fixture/scene inspector.
- Bottom health bar is mandatory and should carry Audio-specific trust state.
- Green means verified/aligned/live. Yellow means assumed or attention. Coral means disabled/offline/action failed. Blue is reserved for focused/selection metadata where Lighting already uses blue.
- Avoid rounded generic cards. Use `radius.tight.*`, one-pixel strokes, mono captions, subdued glass overlays, and deliberate glow only for selected/current state.
- Meter fill colors are an explicit exception to the app palette. Meters must use industry-standard signal colors: green for normal signal/nominal, yellow for warning near hot level, orange for high warning, and red for clip/over. Keep those colors restricted to live meter bars, peak holds, clip LEDs, and meter legends only; do not use them as general UI accent colors.

The current Audio surface fits but is too card-heavy and visually separate. The redesign should remove the large equal-weight card stack and make the center feel like an instrument panel laid over a studio-grade canvas.

## Metering Standard

Metering is operational instrumentation, not decoration. The meter scale and color thresholds must be stable and documented.

Reference scale:

| Mark  | Position | Meaning                                 |
| ----- | -------: | --------------------------------------- |
| `0`   |      top | full scale / clip ceiling               |
| `-6`  |      90% | loud program warning band starts nearby |
| `-12` |      80% | strong but safe digital level           |
| `-18` |      70% | nominal calibration reference area      |
| `-24` |      60% | healthy speech/program margin           |
| `-40` |    33.3% | signal present                          |
| `-60` |   bottom | floor / practically silent              |

Display mapping for current engine values:

```ts
const METER_FLOOR_DBFS = -60;

function normalizedToDbfs(value: number): number {
  if (value <= 0) return Number.NEGATIVE_INFINITY;
  return 20 * Math.log10(Math.min(1, value));
}

function dbfsToMeterPercent(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  return Math.max(0, Math.min(100, ((dbfs - METER_FLOOR_DBFS) / Math.abs(METER_FLOOR_DBFS)) * 100));
}
```

Meter semantics:

- `meterLeft` / `meterRight` are rendered as the filled level for each side after dBFS scaling, not raw linear percent.
- `peakHold` is rendered as a yellow peak line, matching RME's peak-line convention.
- `clip === true` or a measured value at/above `0 dBFS` renders a red over/clip indicator at the top of the meter.
- do not label the filled bar `RMS` unless the engine/backend explicitly supplies RMS. With the current protocol, call it `Level` or `Signal`; call `peakHold` `Peak`.
- if a future backend exposes separate RMS and peak values, mirror TotalMix: green RMS/average fill, yellow peak line, red over indication.

Threshold colors:

- green: below approximately `-5 dBFS`.
- yellow: around `-5 dBFS`.
- orange: around `-4 dBFS`.
- red: around `-1 dBFS`.
- flashing red: `0 dBFS` / over condition when the engine exposes an over-hold or clip state.

The UI must show dBFS scale marks on each tier, at minimum `0`, `-6`, `-12`, `-18`, `-24`, `-40`, and `-60`, with enough contrast to be readable at the fixed operator distance.

## Layout Spec

### 2560x1440

The frame uses the same vertical budget as Lighting:

| Band          |   Height | Notes                            |
| ------------- | -------: | -------------------------------- |
| Shell header  |    92 px | Existing `AppShellFrame`         |
| Audio toolbar |    44 px | Fixed, no wrap                   |
| Body          | residual | Rail / signal canvas / inspector |
| Health bar    |    64 px | Full width                       |

Body columns:

| Column        |                                                            Width |
| ------------- | ---------------------------------------------------------------: |
| Rail          | 280 px default, resizable if the shared column pattern is reused |
| Resizer       |                                                             6 px |
| Signal canvas |                                                         flexible |
| Resizer       |                                                             6 px |
| Inspector     |                                                   360 px default |

The center signal canvas splits internally:

- active submix pill floats top-center: `Selected output / submix Main Out`.
- `Hardware Inputs` tier at the top: physical mic/line sources.
- `Software Playback` tier in the middle: DAW/app/playback returns.
- `Hardware Outputs` tier at the bottom: Main Out, Phones 1, Phones 2, and any engine-exposed output/cue targets.
- small plot-style meta chips sit top-right: selected source, row, bank, density.

The tier split should feel inspired by TotalMix 2.0's scalable 3-row inline mixer, but translated into the Lighting surface language rather than copied.

Tier hierarchy is part of the workflow, not decoration:

- `Hardware Inputs` and `Hardware Outputs` are the primary operating tiers. Give them stronger borders, richer headers, identity rails, and more vertical allocation.
- Row identity colors must come from the brand token set, not ad hoc hues: `Hardware Inputs` use brand green `#99BA92`, `Software Playback` uses brand yellow `#E8D561`, and `Hardware Outputs` use brand blue `#3F70C8` / `#6A93DC`.
- `Software Playback` remains visible and selectable, but it should read as the secondary row. Keep its surface quieter and proportionally shorter than the top tier.
- The three rows must be visually distinct at a glance: input/source identity, playback-return identity, and output/control-room identity should not rely only on row labels.

### 1920x1080

Use the same responsive layout mode behavior as Lighting:

- rail min `240 px`, preferred `260 px`.
- inspector min `320 px`, preferred `340 px`.
- top and bottom tiers keep primary allocation; the middle playback tier compresses first.
- tier header copy tightens and lower-priority source strips collapse to narrower labels.
- lower-priority playback mute/solo buttons may collapse out of the row at fallback size; selected-channel inspector and explicit context actions carry those controls.
- health bar `56 px`.
- no document scroll.
- panel-local overflow is allowed only in compact utility modes, not in `studioFull`.

## Surface Behavior

### Toolbar

Toolbar order:

1. title: `Audio`
2. primary state chip: `OSC verified`, `State assumed`, `Not verified`, `OSC disabled`, `Offline`, or `Action failed`
3. stats: `18 ch`, `3 mix`, `5 snap`, `bank 2/2`
4. `Sync`
5. density toggle: `Overview` / `Precision`
6. bank previous / next
7. current snapshot readout and `Recall`
8. overflow menu

The toolbar should use the same button, kbd, chip, and spacing language as `LightingToolbar`.

### Left Rail

Rail sections:

1. `Control room` master card:
   - selected mix target
   - monitor level
   - state dot
   - Dim / Mono / Talkback quick buttons
2. `Mix targets`:
   - Main Out, Phones 1, Phones 2
   - selected target uses the same high-contrast selected treatment as active Lighting scene/group.
3. `Snapshots`:
   - snapshot rows are known-good states, not generic files.
   - show slot, last recalled, current marker, and recall action.
4. `Actions`:
   - Sync audio
   - Open audio setup
   - Clear selected channel

### Center Signal Canvas

The canvas is the Audio equivalent of the stage plot, with a TotalMix-informed three-tier signal workflow.

Tier model:

- `Hardware Inputs`: front preamps and rear line inputs. Their meters show input level independent of the send/fader position, matching the TotalMix distinction between input signal and submix send level.
- `Software Playback`: program, FX, N-1, music, and other app/DAW playback returns. These are source channels that feed hardware outputs; they are not themselves final destinations.
- `Hardware Outputs`: Main Out, Phones 1, Phones 2, and any exposed output/cue targets. Selecting one output changes the active submix context.

Source strips:

- `Overview` shows up to 12 visible source strips across the two source tiers, constrained by `audio.snapshot.fadersPerBank`.
- `Precision` shows up to 8 visible source strips across the two source tiers, constrained by the same engine value.
- bank index is shell-local view state.
- strips are tall, equipment-like lanes, not web cards.
- strip controls:
  - channel name, short name, role
  - stereo/mono chip
  - narrow, flat-topped vertical stereo meter pair with its own local dBFS reference scale, peak hold, and fixed reference ticks across each meter bar
  - adjacent vertical fader in a visible recessed well, with mechanical cap, 0 dB reference line, and dB readout for the selected submix send, echoing TotalMix channel-strip geometry
  - front-preamp inputs include a photorealistic gain module: dark brushed faceplate, screw-head detail, knurled rotary cap, blue LED arc, numeric dB readout, and knob rotation tied directly to the channel `gain` value
  - mute / solo
  - compact capability chips only when supported by the channel
- unsupported capabilities do not render as disabled clutter on strips. They may appear as inactive rows in the inspector only when useful for explanation.

Output strips:

- always stay visible in the bottom tier.
- selecting an output updates `selectedMixTargetId`.
- the selected output uses the output tier's brand-blue identity plus active-pill echo, while verified/live system state still uses green.
- output strip controls should match source-strip instrumentation: local dBFS scale, stereo meter pair, adjacent vertical output fader, dB readout, and monitor/cue actions.
- output strips should avoid large empty cards; when only three output targets are exposed, distribute label, meter, fader, and monitor actions horizontally while preserving the same meter/fader dimensions as the top row.
- output strips do not pretend to expose arbitrary routing; they are submix targets and output-level controls.

Row navigation:

- Up / Down moves between `Hardware Inputs`, `Software Playback`, and `Hardware Outputs`.
- Left / Right moves within the active row.
- `[ ]` continues to page the visible source bank, but output targets remain visible.
- `1-8` selects visible source strips in the current source row.
- `Shift+1-8` remains snapshot recall.

### Right Inspector

Tabs:

- `Channel`
- `Mix`
- `Session`

Default:

- if a channel is selected, `Channel` is active.
- if no channel is selected, `Mix` is active and explains the active mix target through data, not instructional copy.

Channel tab:

- selected channel title, role, mono/stereo, short name.
- send level to current mix.
- gain if supported.
- mute, solo, phase, phantom, pad, instrument, auto-set only when supported by engine role.
- live meter summary and clip state.

Mix tab:

- active target name and role.
- monitor level.
- dim, mono, talkback.
- send matrix summary for selected source across Main / Phones 1 / Phones 2.
- selected submix summary: how many hardware inputs and software playback sources are currently feeding the active output.

Output tab behavior can be folded into `Mix` for this pass. Do not add a fourth inspector tab unless implementation proves the three-tab inspector is overloaded.

Session tab:

- `consoleStateConfidence`
- `lastConsoleSyncAt`
- `lastSnapshotRecallAt`
- `lastActionStatus`
- `lastActionCode`
- `lastActionMessage`
- OSC host/ports summary.

### Health Bar

Audio health items:

- `OSC`: host and send/receive ports.
- `Confidence`: aligned / assumed / unknown.
- `Metering`: live / disabled / stale.
- `Mix`: current mix target.
- `Snapshot`: current or last recalled snapshot.
- `Session`: last sync or last action status.
- right hints: `Cmd K command palette`, `? shortcuts`, `[ ] bank`, `V density`.

## State Matrix

All states are derived from existing `audio.snapshot` fields. Do not add protocol for this pass.

State precedence must be deterministic:

1. Loading when no snapshot is present.
2. OSC disabled.
3. Offline / attention.
4. Not verified.
5. Action failed.
6. Assumed.
7. Verified.

| State            | Condition                                                                              | Treatment                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Loading          | `audioSnapshot === null`                                                               | toolbar skeleton, meter shimmer, empty canvas lanes, quiet inspector placeholders         |
| Verified         | `oscEnabled && status === "ready" && verified && consoleStateConfidence === "aligned"` | green chip, full interactivity                                                            |
| Assumed          | verified ready transport but `consoleStateConfidence === "assumed"`                    | yellow toolbar line, narrow warning strip, recall remains available but visually cautious |
| Not verified     | `status !== "ready"` or `verified !== true`                                            | yellow warning, Sync emphasized                                                           |
| Disabled         | `oscEnabled === false`                                                                 | coral/disabled health, command controls disabled, meters render dimmed                    |
| Offline          | `status === "attention"`                                                               | coral warning, last-action detail visible in Session tab                                  |
| Action failed    | `lastActionStatus === "failed"`                                                        | compact coral warning with engine message; no generic error copy                          |
| Selected channel | `selectedChannelId` set                                                                | bridge, strip, and inspector highlight together                                           |

## Interaction Model

Keyboard:

| Key              | Behavior                                                              |
| ---------------- | --------------------------------------------------------------------- |
| `A`              | open Audio workspace from shell                                       |
| `[` / `]`        | previous / next bank                                                  |
| `1-8`            | select visible strip                                                  |
| `Shift+1-8`      | recall snapshot slot                                                  |
| `M`              | mute selected channel                                                 |
| `S`              | solo selected channel                                                 |
| `V`              | toggle Overview / Precision                                           |
| `Left` / `Right` | previous / next item in the active tier                               |
| `Up` / `Down`    | move between Hardware Inputs, Software Playback, and Hardware Outputs |
| `Enter`          | Sync when warning band is focused                                     |
| `Esc`            | clear selected channel                                                |

Command palette actions:

- Sync Audio
- Select Main Out
- Select Phones 1
- Select Phones 2
- Next audio bank
- Previous audio bank
- Toggle Audio density
- Recall audio snapshot 1-8
- Clear selected audio channel

Context menus:

- snapshot row: Recall, Rename, Delete if supported by existing store methods
- strip: Select, Mute, Solo, Clear selection
- mix target: Select, Dim, Mono, Talkback where supported

## React Implementation Plan

Do this as a focused Audio frontend refactor. Do not touch Rust unless typecheck proves a protocol contract mismatch.

Use the same component folder shape as Lighting. Create local files:

- `frontend/app/src/app/audio/audioViewModel.ts`
- `frontend/app/src/app/audio/audioFormatting.ts`
- `frontend/app/src/app/audio/components/AudioToolbar.tsx`
- `frontend/app/src/app/audio/components/AudioRail.tsx`
- `frontend/app/src/app/audio/components/AudioSignalCanvas.tsx`
- `frontend/app/src/app/audio/components/AudioTieredMixer.tsx`
- `frontend/app/src/app/audio/components/AudioSourceTier.tsx`
- `frontend/app/src/app/audio/components/AudioOutputTier.tsx`
- `frontend/app/src/app/audio/components/AudioMixerLane.tsx`
- `frontend/app/src/app/audio/components/AudioInspector.tsx`
- `frontend/app/src/app/audio/components/AudioHealthBar.tsx`
- `frontend/app/src/app/audio/components/AudioFader.tsx`
- `frontend/app/src/app/audio/components/AudioStereoMeter.tsx`
- matching CSS modules only where needed

Keep `AudioWorkspace.tsx` as the orchestrator:

- read channels, mix targets, snapshots.
- own shell-local `density`, `bankIndex`, `busyAction`, and transient recall flash.
- wire store calls.
- register command-palette actions.
- handle keyboard shortcuts.
- pass derived view-model objects into child components.

View-model functions:

- `deriveAudioTrustState(snapshot)`
- `deriveAudioStats(snapshot)`
- `deriveVisibleAudioBank(channels, density, fadersPerBank, bankIndex)`
- `partitionAudioRows(channels, mixTargets)`
- `deriveActiveAudioTier(selectedChannelId, selectedMixTargetId)`
- `deriveAudioChannelCapabilities(channel)`
- `deriveMeterTone(channel, meteringState)`
- `formatAudioDb(value)`
- `formatAudioRole(role)`
- `formatAudioTimestamp(value)`

Verified design-system primitives available from `@sse/design-system`:

- `Button`
- `IconButton`
- `ToggleButton`
- `StatusBadge`
- `StatusDot`
- `HealthBar`
- `ScrubSlider`
- `ContextMenu`
- `Tooltip`
- `PlotMeta`
- `PlotPill`
- `SegmentedControl`

Use local primitives:

- `AudioFader`: vertical or horizontal fader, display-oriented, maps `0..1` to existing command values.
- `AudioStereoMeter`: SVG or div meter with dBFS scale marks, dB-scaled fill, yellow peak-hold line, clip/over indication, and disabled treatment.
- `AudioMixTargetPill`: active mix overlay matching Lighting's `PlotPill` language.

Do not promote Audio primitives into the design system in the first implementation unless a second workspace consumes them.

### Fresh Chat Implementation Slices

Implement in this order. Each slice should leave the app typecheckable.

1. **Extract helpers with no visual changes**
   - Move current inline helpers from `AudioWorkspace.tsx` into `audioFormatting.ts` and `audioViewModel.ts`.
   - Preserve existing behavior and test IDs.
   - Add unit-sized pure helpers only; do not introduce a new store or React context.

2. **Reshape the workspace grid**
   - Keep `AudioWorkspace` props unchanged: `appSnapshot`, `audioSnapshot`, `store`.
   - Replace the current card-stack layout with `toolbar / body / health` bands.
   - Body grid is `rail / resizer / signal canvas / resizer / inspector`.
   - Use CSS variables matching Lighting dimensions: `--audio-toolbar-height: 44px`, `--audio-health-height: 64px`, `--audio-rail-width: 280px`, `--audio-inspector-width: 360px`.
   - Use tier proportions that make the primary hardware tiers symmetric without leaving the output tier hollow: desktop target `inputs / playback / outputs = minmax(330px, 1fr) / minmax(255px, 0.52fr) / minmax(330px, 1fr)`.
   - At `max-width: 2000px`, set rail to `260px`, inspector to `340px`, health to `56px`, and tier targets to `minmax(250px, 1fr) / minmax(190px, 0.52fr) / minmax(250px, 1fr)`.

3. **Build the instrument surface**
   - Add `AudioTieredMixer` inside `AudioSignalCanvas`.
   - Render `Hardware Inputs`, `Software Playback`, and `Hardware Outputs` as distinct rows with brand-token visual identities: green input/source, yellow playback return, and blue output/control room.
   - Add the active submix `PlotPill`, `PlotMeta` chips, and source-bank controls.
   - Use local `AudioMixerLane` and `AudioStereoMeter`; do not force the current design-system `MeterBridge` if stereo, selected, clip, mute, and solo states require custom rendering.
   - Render unsupported channel controls by omission on lanes.
   - Keep output targets visible even when source rows are banked.

4. **Move rail and inspector behavior into components**
   - `AudioRail` owns only rendering and event callbacks for control room, mix targets, snapshots, and actions.
   - `AudioInspector` owns only rendering and event callbacks for `Channel`, `Mix`, and `Session` tabs.
   - Parent still owns selected IDs, density, bank index, busy action, and transient recall flash.

5. **Rewire interactions**
   - Preserve current keyboard behavior already covered by `frontend/app/tests/operator-shell.spec.ts`.
   - Preserve data-testid values that tests use: `audio-workspace`, `audio-warning-band`, `audio-strip-*`, `audio-snapshot-*`, `audio-toolbar-current-snapshot`, `audio-mix-target-*`.
   - Add missing test IDs only for new surfaces: `audio-tiered-mixer`, `audio-hardware-inputs-tier`, `audio-software-playback-tier`, `audio-hardware-outputs-tier`, `audio-signal-canvas`, `audio-health-bar`, `audio-inspector-channel`, `audio-inspector-mix`, `audio-inspector-session`.
   - Use `store.send("audio.*")` calls exactly as the current workspace does; no device writes outside existing commands.

6. **Fixture and test update**
   - Existing fixtures already include `audio-ready-overview`, `audio-state-assumed`, `audio-not-verified`, `audio-osc-disabled`, `audio-offline`, `audio-action-failed`, `audio-selected-channel`, `audio-loading`, and `audio-1920-fallback`.
   - Add `audio-ready-precision` only if precision mode cannot be reached deterministically through an existing test interaction.
   - Keep the 1920 no-scroll assertion in `frontend/app/tests/operator-shell.spec.ts` and extend it to assert `audio-health-bar`, `audio-signal-canvas`, and the selected strip are visible.

### Component Contracts

These contracts are implementation guidance, not a new protocol.

```ts
type AudioDensityMode = "overview" | "precision";

type AudioTrustTone = "ok" | "attn" | "err" | "info";

interface AudioTrustState {
  id: "loading" | "verified" | "assumed" | "not-verified" | "disabled" | "offline" | "action-failed";
  label: string;
  tone: AudioTrustTone;
  warningTitle: string | null;
  warningBody: string | null;
  actionsAllowed: boolean;
  metersDimmed: boolean;
}

interface AudioVisibleBank {
  bankIndex: number;
  totalBanks: number;
  visibleStripCount: number;
  channels: AudioChannelEntry[];
  selectedChannelId: string | null;
  selectedMixTargetId: string | null;
  activeTier: "hardware-inputs" | "software-playback" | "hardware-outputs";
  containsSelectedChannel: boolean;
}

interface AudioStats {
  channelCount: number;
  mixTargetCount: number;
  snapshotCount: number;
  bankLabel: string;
}

interface AudioMeterModel {
  leftDbfs: number;
  rightDbfs: number;
  peakDbfs: number;
  leftPercent: number;
  rightPercent: number;
  peakPercent: number;
  clip: boolean;
  tone: "signal" | "warn" | "hot" | "clip";
}
```

### Styling Rules For Implementation

- Start from `LightingWorkspace.module.css` surface language, not the old Audio module.
- Use design tokens where the React code already has access to them; local CSS variables may alias tokens for readability.
- Do not route live meter fill through the Lighting color palette. Define fixed audio-meter variables for green/yellow/orange/red based on professional console meter conventions, and keep those variables scoped to meter components.
- Use dB-scaled meter positioning, not raw linear amplitude height. The only acceptable raw-linear use is inside a helper that first converts normalized engine values to dBFS.
- Use radii `4px` to `8px`; no large card radii.
- Page sections are full-height work surfaces, not nested cards.
- Treat the visual pass as instrument-grade UI, not a card dashboard: restrained bevels, subtle inner highlights, low-contrast strokes, and one crisp active outline should carry the polish.
- Meter/fader geometry must use fixed or bounded dimensions so live values do not change layout.
- Meter fills must have flat precision tops. Rounded or soft meter caps are not acceptable for final monitoring visuals.
- Make the three TotalMix-inspired rows visually distinct through tier-local brand-token borders, header washes, and identity rails. Use brand green for inputs, brand yellow for playback, and brand blue for outputs; do not invent additional row colors.
- Row identity color should stay mostly in rails, thin strip accents, header washes, and selected outlines. Avoid broad saturated row backgrounds, especially brand yellow, because they can be mistaken for warning state or compete with hot meter colors.
- Keep reference information inside the relevant instrument. Do not use a large canvas drafting grid behind the Audio tiers; it competes with meter scales and fader slots.
- Use `data-selected`, `data-active`, `data-tone`, and `data-disabled` attributes for state styling, matching current app patterns.
- Do not use viewport-width font scaling or negative letter spacing.
- Do not add purple gradients, beige themes, or one-hue palettes. Audio should stay in the Lighting dark-canvas family with brand-token green, yellow, blue, and coral reserved for explicit operational meaning.

### Progressive Disclosure Rules

- The default face is junior-safe: visible status, snapshots, active output/submix, outputs, meters, and monitor actions.
- The persistent inspector is the senior workbench: exact values, capability controls, diagnostics, and session state.
- Context menus are senior shortcuts, not required for the junior path.
- Setup is explicit and named; do not hide setup operations behind ambiguous icons.
- Senior-only controls must never visually compete with `Recall`, `Sync`, output select, and monitor health.

### Store Call Mapping

Use only existing commands:

| UI action                 | Command                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Sync                      | `audio.sync`                                                                                        |
| Recall snapshot           | `audio.snapshot.recall` with `snapshotId`                                                           |
| Select/clear channel      | `audio.settings.update` with `selectedChannelId`                                                    |
| Select mix target         | `audio.settings.update` with `selectedMixTargetId`                                                  |
| Change visible fader/send | `audio.channel.update` with `channelId`, `mixTargetId`, `fader`                                     |
| Mute / solo channel       | `audio.channel.update` with `mute` or `solo`                                                        |
| Front-preamp controls     | `audio.channel.update` with supported `gain`, `phantom`, `phase`, `pad`, `instrument`, or `autoSet` |
| Control-room mix actions  | `audio.mixTarget.update` with `volume`, `mute`, `dim`, `mono`, or `talkback`                        |

The frontend may derive capability visibility from channel role for presentation, but the engine remains authoritative and may reject unsupported writes with `AUDIO_CHANNEL_FIELD_UNSUPPORTED`.

### Known Existing Behavior To Preserve

- `Overview` shows up to `min(12, fadersPerBank)` strips.
- `Precision` shows up to `min(8, fadersPerBank)` strips.
- Selecting a channel from any surface pages the bank to contain that channel.
- Selecting a hardware output changes the active submix and preserves the selected output in the bottom tier.
- Hardware-input meters show source level; their fader/send level is contextual to the selected hardware output.
- Software-playback channels feed outputs as source rows; they are not shown as final destinations.
- Recall success flashes the snapshot row and updates `audio-toolbar-current-snapshot`.
- Warning-band `Enter` runs sync when focused.
- `Esc` clears selected channel before leaving the workspace focus path.
- 1920 fallback must keep the whole workspace within the viewport.

## Acceptance Criteria

- At `2560x1440`, Audio visually matches Lighting in shell, toolbar, rail/canvas/inspector balance, typography, and surface language.
- At `1920x1080`, no document scroll and no clipped essential controls.
- Current mix target is visible in toolbar, left rail, center pill, and inspector/health.
- Selected channel is visible in its source tier, active source lane, and inspector.
- Hardware inputs, software playback, and hardware outputs are visually distinct rows, with hardware outputs functioning as submix selectors.
- Disabled/offline/assumed states are impossible to miss but do not dominate healthy operation.
- Snapshot recall, sync, mute, solo, mix target selection, density, and bank navigation remain functional.
- No device policy, DB logic, routing policy, support matrix, or persistence format moves into React.

## Validation Commands

Run in this order after implementation:

```bash
npm run frontend:typecheck
npm run frontend:playwright:test
npm run tauri:visual:review -- --fixtures=audio-ready-overview,audio-state-assumed,audio-not-verified,audio-osc-disabled,audio-offline,audio-action-failed,audio-selected-channel,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174
```

If layout or presentation changed, also launch the real app and inspect Scaled Studio Preview at 2560x1440 per `docs/DEVELOPMENT.md`.

## Prototype

The visual prototype for this plan is:

`docs/redesign/assets/audio/Audio-Lighting-Aligned-Desk.html`

Open it at 2560x1440 first. The prototype is static but intentionally uses the current Lighting surface language and should be treated as the implementation target for spacing, hierarchy, and mood.
