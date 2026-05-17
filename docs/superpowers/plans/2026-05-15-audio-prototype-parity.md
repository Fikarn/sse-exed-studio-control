# Audio Prototype Parity Closure Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` when explicitly authorized, otherwise use `superpowers:executing-plans`. Keep the progress tracker updated after every goal. Do not skip acceptance checks.

**Goal:** Bring the real Tauri Audio working space to visual parity with the parity-session `desk-v10.html`, excluding the shared shell/header/branding bar.

**Architecture:** Keep Audio as a React view over engine-owned `audio.snapshot` state and existing mutation commands. Render prototype-equivalent UI states when engine or fixture data exposes them, but do not invent persistent audio policy, hardware truth, EQ, dynamics, LUFS, PFL, clip reset, snapshot capture, or master-view behavior in React.

**Tech Stack:** Tauri 2 preview shell `sse-exed-tauri-shell`, React 19.2, TypeScript, Vite, CSS modules, Playwright, existing `@sse/design-system` and `@sse/engine-client`.

---

## Summary

Bring the real Tauri Audio working space to visual parity with the parity-session `desk-v10.html`, excluding the shared shell/header/branding bar.

The implementation must match prototype layout, density, tier structure, warning surfaces, inspector variants, snapshot deck shape, and footer treatment. It must not force live Audio to default to prototype demo data. Real values such as selected channel, snapshot names, meter levels, and verification state may differ, but the UI must render the prototype-equivalent state whenever engine or fixture data exposes it.

Engine-owned gaps stay honest: no fake persistent EQ, dynamics, LUFS, PFL, clip reset, snapshot capture, master-view state, or hardware telemetry mutations in React.

## Progress Protocol

Before implementation starts, create a visible task tracker with these exact goals and keep it updated after every task:

| ID  | Goal                                                                                        | Status  |
| --- | ------------------------------------------------------------------------------------------- | ------- |
| G0  | Save this replacement plan to `docs/superpowers/plans/2026-05-15-audio-prototype-parity.md` | Pending |
| G1  | Build the Audio view-model contract for prototype-capable state                             | Pending |
| G2  | Replace the oversized Audio warning/status treatment with prototype-compatible surfaces     | Pending |
| G3  | Match the prototype canvas context bar and warning stack                                    | Pending |
| G4  | Match Inputs, Playback, and Outputs tier headers and lane density                           | Pending |
| G5  | Match channel strip, fader, meter, preamp, and output-card layouts                          | Pending |
| G6  | Match inspector variants for input, playback, output, sends, EQ, and dynamics               | Pending |
| G7  | Match snapshot deck structure, slot treatment, and unavailable capture behavior             | Pending |
| G8  | Match footer telemetry and shortcut layout                                                  | Pending |
| G9  | Validate at 2560x1440 Studio Preview and 1920x1080 fallback                                 | Pending |

During implementation, use the visible progress tool with one in-progress item at a time. Each checkpoint must report:

`Progress: G# complete. Closed diffs: D#. Still open: D#.`

Do not start a new goal until the prior goal's acceptance checks pass.

## Diff Coverage Map

Every difference from the visual comparison must be closed by one of these goals:

| Diff ID | Difference To Close                                                                                            | Goal |
| ------- | -------------------------------------------------------------------------------------------------------------- | ---- |
| D1      | Global `OSC NOT VERIFIED` band dominates the workspace; prototype uses in-canvas warnings                      | G2   |
| D2      | Missing solo banner, clip banner, solo chip, and clear actions                                                 | G3   |
| D3      | Context bar content, density controls, active mix meter, stats, and LUFS placeholder shape differ              | G3   |
| D4      | Missing visible `Inputs`, `Playback`, `Outputs` tier headers, icons, chips, and metadata                       | G4   |
| D5      | Current canvas has large empty gaps and sparse lane distribution                                               | G4   |
| D6      | Channel strips do not match prototype meter/fader/control/preamp proportions                                   | G5   |
| D7      | Output cards lack prototype detail-block hierarchy and selected active-mix treatment                           | G5   |
| D8      | Inspector does not render the prototype playback-channel shape when playback is selected                       | G6   |
| D9      | Inspector input/preamp and unsupported EQ/dynamics/sends states need prototype-compatible structure            | G6   |
| D10     | Snapshot deck names may differ, but deck shape, selected state, empty slots, capture tile, and previews differ | G7   |
| D11     | Footer content/layout differs from prototype telemetry and shortcut bar                                        | G8   |
| D12     | 2560x1440 and 1920x1080 no-scroll fit must be preserved                                                        | G9   |

## Implementation Changes

### G1 - View Model Contract

- Update `frontend/app/src/app/audio/audioViewModel.ts`.
- Add explicit derived fields for prototype surfaces:
  - `selectedSourceLabel`
  - `selectedSourceTier`
  - `selectedSourceMeta`
  - `selectedSourceGroup`
  - `soloedChannel`
  - `clippedChannels`
  - `footerTelemetry`
  - `activeMixReadout`
  - `outputAccent`
  - `unsupportedFeatures`
- Preserve real engine data. Do not inject prototype demo values into live state.
- Acceptance: TypeScript consumers can render prototype surfaces without re-deriving these fields in components.

### G2 - Audio Status Treatment

- Update `AudioWorkspace.tsx`, `AudioSignalCanvas.tsx`, and `AudioWorkspace.module.css`.
- Replace the oversized Audio `OSC NOT VERIFIED` working-space band with a compact prototype-compatible trust strip or inline state treatment.
- Keep degraded/not-verified/offline state visible and truthful.
- Acceptance: `D1` is closed without hiding status state.

### G3 - Canvas Context Bar And Warning Stack

- Update `AudioSignalCanvas.tsx`.
- Render context bar in this order:
  - Editing label
  - output target picker
  - selected source metadata
  - Submix/Master posture
  - input/playback/output stats
  - LUFS placeholder or readout
  - active mix meter
  - Desktop/Touch density switch
- Render solo and clip bands inside the canvas.
- `Clear all solo` must call existing `updateAudioChannel` paths.
- `Clear clips` must be disabled with unavailable treatment until engine support exists.
- Acceptance: `D2` and `D3` are closed.

### G4 - Tier Headers And Lane Density

- Update `AudioTieredMixer.tsx` and `AudioWorkspace.module.css`.
- Render compact headers for Inputs, Playback, and Outputs:
  - icon
  - tier number
  - title
  - group chips
  - right-side metadata
- Remove the large empty gap between input and playback tiers.
- Acceptance: `D4` and `D5` are closed at 2560x1440.

### G5 - Strip, Meter, Fader, Preamp, And Output Layouts

- Update `AudioMixerLane.tsx`, `AudioFader.tsx`, `AudioPreampControl.tsx`, `AudioStereoMeter.tsx`, and `AudioWorkspace.module.css`.
- Match prototype proportions for:
  - input strip meter/fader/preamp/control grouping
  - playback strip selected/solo/no-send states and large dB readout
  - output strip active-mix state, bus level, peak hold, LUFS/correlation placeholders, mute/cue row
- Acceptance: `D6` and `D7` are closed.

### G6 - Inspector Variants

- Update `AudioInspector.tsx`.
- Render three state-specific inspector variants:
  - input/preamp
  - playback bus
  - hardware output
- Channel tab must include:
  - big meter
  - send-to-active-mix control
  - Mute/Solo/PFL/Reset action row
  - EQ mini
  - Dynamics mini
  - Sends mini
  - Source
  - context-specific hardware/software panel
- EQ and Dynamics tabs stay read-only.
- Sends tab renders one destination card per mix target and disables unsupported pre/post/link/solo-send controls.
- Acceptance: `D8` and `D9` are closed.

### G7 - Snapshot Deck

- Update `AudioSnapshotDeck.tsx` and `AudioWorkspace.module.css`.
- Match prototype deck layout:
  - capture tile
  - 8 slots
  - selected/current styling
  - populated/empty slot treatment
  - hover preview posture
  - mini meter thumbnails
- Keep snapshot names from engine/fixture data. Do not hardcode prototype names into live data.
- Acceptance: `D10` is closed.

### G8 - Footer Telemetry

- Update `AudioHealthBar.tsx` and `AudioWorkspace.module.css`.
- Replace generic footer with prototype-compatible telemetry groups:
  - OSC status
  - endpoint when available
  - metering status
  - clock/sample rate when available
  - last sync
  - command palette
  - shortcuts
  - bank navigation
- Render unavailable telemetry as muted `n/a` or unknown states, not invented values.
- Acceptance: `D11` is closed.

### G9 - Validation

- Update focused tests in `frontend/app/tests/operator-shell.spec.ts`.
- Audio workspace tests must assert:
  - context bar order is present
  - tier headers for Inputs/Playback/Outputs are visible
  - solo and clip bands render from fixture state
  - disabled clip clear exists
  - playback selection renders playback inspector variant
  - input selection renders preamp inspector variant
  - snapshot deck has capture tile and 8 slots
  - footer has telemetry and shortcut groups
- Interaction tests must assert:
  - `Clear all solo` clears solo via existing channel updates
  - `Master` view remains disabled
  - unsupported EQ, Dynamics, PFL, clip reset, and snapshot capture controls remain disabled
  - faders/custom controls still drag and numeric entry still works
- Run:

```bash
npx playwright test frontend/app/tests/operator-shell.spec.ts -g "audio"
npm run frontend:typecheck
npm run lint
npm run tauri:visual:review -- --fixtures=audio-populated,audio-state-assumed,audio-not-verified,audio-offline,audio-action-failed,audio-1920-fallback --sizes=2560x1440,1920x1080 --port=4174
```

- Final visual acceptance must use the open Tauri shell in Studio Preview or the fixed studio monitor. Browser-only evidence is insufficient for signoff.
- Acceptance: `D12` is closed.

## Assumptions Locked

- Save target: replace `docs/superpowers/plans/2026-05-15-audio-prototype-parity.md`.
- Prototype authority: parity-session `desk-v10.html`; durable checked-in reference is `docs/redesign/assets/audio/Audio-Lighting-Aligned-Desk.html`.
- Scope: Audio working space only; shared header/branding bar remains unchanged.
- Data policy: layout/component parity only. Do not force exact prototype demo values into live state.
- Architecture boundary: no device policy, persistence, or fake hardware truth moves into React.
