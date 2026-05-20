# Audio Workspace Gold-standard Audit

> Design/reference record. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`; use this file for rationale and follow-up planning, not as an active implementation contract.

Authored 2026-05-19 against the local audio worktree. The repo was already dirty when this audit was written, so every source reference below points at the current checked-out files rather than a clean `origin/main` SHA.

Scope: the selected Tauri shell audio workspace and every operator-facing path visible in that workspace: fixed-layout fit, live meters, faders, preamp knobs, EQ points, output selection, snapshots, context menus, keyboard shortcuts, focus states, animations, and degradation states. The bar used here is a high-end studio console: interaction should feel immediate, visually stable, keyboard-reachable, non-blocking, and consistent at both `2560x1440` and the required `1920x1080` fallback.

## Evidence Captured

- `npm run build --workspace frontend/app` passed. Production bundle highlights: app JS `664.68 kB` gzip `167.91 kB`, vendor JS `283.15 kB` gzip `89.93 kB`, CSS `305.83 kB` gzip `45.42 kB`.
- `npx playwright test --config frontend/app/playwright.config.ts -g "audio"` passed: 26 tests in 12.3 s.
- Production preview passive meter probe at `2560x1440` and `1920x1080`: 22 meters, 1263 DOM nodes, no sampled rAF frames over 24 ms or 50 ms, `audio.snapshot` stayed at initial 1, and the audio workspace/rail/signal/inspector each rendered only once during passive meter ticks.
- Production preview fader drag probe at `2560x1440`: a 40-step drag of the FX 3/4 send caused `audioWorkspace`, `audioRail`, `audioSignalCanvas`, and `audioInspector` to render +62 times each. Request deltas were `audio.channel.update` +5, `audio.snapshot` +11, and `audio.settings.update` +1.
- Production preview fit probe:
  - `2560x1440`: document has no global scroll.
  - `1920x1080`: document has no global scroll, but the active channel inspector panel reported `scrollHeight 742`, `clientHeight 578`, `overflow: hidden`; the "Stereo link" and "Auto fade" buttons were below the visible panel.
- Production preview focus/dialog probe:
  - Snapshot rename opened `window.prompt("Rename audio snapshot", ...)`.
  - Channel context-menu rename opened `window.prompt("Rename audio channel", ...)`.
  - Five snapshot recall buttons had `display: contents` and measured as zero-width/zero-height focusable elements.

## P1 Findings

### A-P1-01. Required `1920x1080` fallback clips inspector controls

The no-scroll rule is satisfied at the document level, but the active channel inspector is internally clipped at the fallback size. In the production probe, `audio-inspector-channel` had `scrollHeight 742`, `clientHeight 578`, and `overflow: hidden`; its "Stereo link" and "Auto fade" controls were rendered below the panel bottom. That means a required workstation mode can hide reachable controls without a scroll affordance.

Sources:

- `frontend/app/src/app/audio/AudioWorkspace.module.css:2886` sets `.inspectorPanel { overflow: hidden; }`.
- `frontend/app/src/app/audio/components/AudioInspector.tsx:233` mounts the inspector as one fixed aside with tabs and a sticky top section.

Gold-standard target: every tab should have an explicit fixed-density layout that fits `1920x1080`, or the lower inspector content needs a deliberate, visible internal paging/section switch. Hidden overflow with controls below the viewport is not acceptable for operator-critical UI.

### A-P1-02. Fader and preamp drags re-render the full audio workspace

Continuous controls keep drag drafts in `AudioWorkspace` root state. Every pointer move updates `controlDrafts`, which invalidates the root and all major panels. The measured 40-step fader drag produced +62 renders each for `audioWorkspace`, `audioRail`, `audioSignalCanvas`, and `audioInspector`.

Sources:

- `frontend/app/src/app/audio/AudioWorkspace.tsx:91` owns `controlDrafts` at workspace scope.
- `frontend/app/src/app/audio/components/AudioSliderControl.tsx:134` calls preview on pointer move.
- `frontend/app/src/app/audio/components/AudioMixerLane.tsx:171` writes draft state and schedules commits during fader preview.
- `frontend/app/src/app/audio/components/AudioPreampControl.tsx:186` previews preamp movement on every pointer move.

Gold-standard target: hot drag state should stay local to the control or in a narrowly subscribed external store. The rest of the console should not re-render while a fader cap or gain knob is under the pointer.

### A-P1-03. Continuous command refresh path over-fetches snapshots

The same fader probe produced 5 channel updates but 11 full `audio.snapshot` requests. The store refreshes after every audio command that does not return a full snapshot, and it also refreshes again for non-meter `audio.changed` events.

Sources:

- `frontend/packages/engine-client/src/store/createShellStore.ts:579` refreshes `audio.snapshot` for every non-meter `audio.changed`.
- `frontend/packages/engine-client/src/store/createShellStore.ts:734` refreshes `audio.snapshot` after audio requests that do not return a snapshot.

Gold-standard target: continuous audio commands should either return/apply a minimal authoritative patch or coalesce a single post-drag refresh. A control drag must not create an IPC refresh storm.

### A-P1-04. EQ point dragging commits every pointer move

The EQ graph is even more direct than faders: pointer move calls `commitEqPointFromPointer`, and that calls `onUpdateChannelEq` immediately. There is no draft preview layer, no throttle, and no commit-on-release behavior.

Sources:

- `frontend/app/src/app/audio/components/AudioInspector.tsx:216` calculates EQ point values from pointer coordinates.
- `frontend/app/src/app/audio/components/AudioInspector.tsx:225` sends `onUpdateChannelEq`.
- `frontend/app/src/app/audio/components/AudioInspector.tsx:866` calls the commit path on every captured pointer move.

Gold-standard target: EQ graph manipulation should animate locally at pointer rate and commit at a controlled cadence or on release. It should not turn every graph pixel into a separate engine update.

### A-P1-05. Native blocking dialogs break the premium shell

Snapshot rename, channel rename, snapshot delete, fader numeric entry, and preamp numeric entry use browser-native `prompt`/`confirm`. These are visually off-brand, block the UI thread, interrupt live metering, and cannot participate in the design system's validation, keyboard flow, or danger-state styling.

Sources:

- `frontend/app/src/app/audio/AudioWorkspace.tsx:276` snapshot rename prompt.
- `frontend/app/src/app/audio/AudioWorkspace.tsx:284` channel rename prompt.
- `frontend/app/src/app/audio/AudioWorkspace.tsx:290` snapshot delete confirm.
- `frontend/app/src/app/audio/components/AudioFader.tsx:29` fader numeric prompt.
- `frontend/app/src/app/audio/components/AudioPreampControl.tsx:250` preamp numeric prompt.

Gold-standard target: use shell-native modal/popover primitives with inline validation, branded danger confirmation, focus trap, Escape/Enter behavior, and no live-meter freeze.

### A-P1-06. Live meters and textual readouts can disagree

Compact meter ticks update the canvas overlay without re-rendering React, which is good for passive performance. But several visible labels, halos, and dB readouts still read from the React snapshot. During live compact metering, the canvas bars can move while the rail halo, active-mix dB number, and inspector "Peak L / R" text stay stale until a full snapshot refresh.

Sources:

- `frontend/packages/engine-client/src/store/createShellStore.ts:394` publishes compact meter frames outside the React snapshot path.
- `frontend/app/src/app/audio/components/AudioRail.tsx:52` derives `masterGlow` from `viewModel.activeMixReadout`.
- `frontend/app/src/app/audio/components/AudioSignalCanvas.tsx:177` passes fallback active-mix meter values from the view model.
- `frontend/app/src/app/audio/components/AudioSignalCanvas.tsx:297` renders the active-mix dB label from fallback values.
- `frontend/app/src/app/audio/components/AudioInspector.tsx:195` and `AudioInspector.tsx:285` render inspector meter numbers from the snapshot.

Gold-standard target: either all live meter-adjacent UI reads from the same external meter frame, or non-live labels are visually marked as held/reference values. Moving bars next to stale dB text feels broken.

## P2 Findings

### A-P2-01. Canvas overlay repaints the full shell-sized canvas every frame

The canvas overlay avoids React re-rendering, but it still clears and repaints the entire overlay every rAF. At Retina scale, this can become a very large backing store over the full audio page. The current passive probe was clean, but this is still an avoidable hot-path cost.

Sources:

- `frontend/app/src/app/audio/components/AudioMeterCanvasOverlay.tsx:392` sizes the canvas by device pixel ratio.
- `frontend/app/src/app/audio/components/AudioMeterCanvasOverlay.tsx:514` clears the full canvas every frame.

Gold-standard target: dirty-rect meter repainting, or smaller layered canvases scoped to meter bands, so future meter count or DPI increases do not tax the whole page.

### A-P2-02. Canvas drawing allocates gradients and writes attributes in the rAF loop

`drawMeterBody` and `drawMiniMeter` create gradients while painting. The paint loop also writes multiple `data-*` attributes every frame for test/debug visibility. Both are minor individually, but they are avoidable work on the hottest path in the audio page.

Sources:

- `frontend/app/src/app/audio/components/AudioMeterCanvasOverlay.tsx:264` creates the main meter gradient per draw.
- `frontend/app/src/app/audio/components/AudioMeterCanvasOverlay.tsx:322` creates the mini-meter gradient per draw.
- `frontend/app/src/app/audio/components/AudioMeterCanvasOverlay.tsx:550` writes canvas dataset fields every frame.

Gold-standard target: cache gradients by geometry/color key and gate test/debug attributes behind changed values or a test-only flag.

### A-P2-03. Snapshot recall buttons are zero-box focus targets

Populated snapshot tiles wrap the recall surface in a `button` styled as `display: contents`. Runtime focus probing found the recall buttons are keyboard-focusable but measure as `0x0`, which means default focus indication has no reliable painted box. This weakens keyboard confidence on a high-risk action: recalling a console snapshot.

Sources:

- `frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx:174` renders the recall button.
- `frontend/app/src/app/audio/AudioWorkspace.module.css:2455` sets `.snapshotRecallSurface { display: contents; }`.

Gold-standard target: make the full tile or a contained surface the real focusable box, with an explicit focus ring around the tile and a clear active/pressed state.

### A-P2-04. Snapshot row actions are tiny hover-revealed text controls

Save/Rename/Delete are hidden until hover/focus and are only 18 px tall with 8 px text. They are technically reachable, but they do not meet the same interaction quality as the rest of the operator console, especially for destructive actions.

Sources:

- `frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx:252` renders the hidden action cluster.
- `frontend/app/src/app/audio/AudioWorkspace.module.css:2466` hides the cluster by default.
- `frontend/app/src/app/audio/AudioWorkspace.module.css:2486` styles the action buttons at `min-height: 18px` and `font-size: 8px`.

Gold-standard target: reserve a stable icon action strip or contextual action menu with larger hit targets, tooltips, confirmation styling, and no layout surprise.

### A-P2-05. Context menu is not a complete menu interaction model

The channel context menu is positioned and clamped, but it is not focused on open, does not provide roving keyboard navigation, does not close on outside pointer down, and shows five disabled future actions with "Unsupported actions require engine support." Opening it also sends a selected-channel settings update.

Sources:

- `frontend/app/src/app/audio/AudioWorkspace.tsx:425` opens the menu and updates selected channel settings.
- `frontend/app/src/app/audio/AudioWorkspace.tsx:499` only handles Escape at the workspace level.
- `frontend/app/src/app/audio/components/AudioContextMenu.tsx:31` renders the menu without focus management.
- `frontend/app/src/app/audio/components/AudioContextMenu.tsx:75` renders disabled unsupported actions.

Gold-standard target: use a shared menu primitive with focus on open, Arrow/Home/End navigation, outside-click dismissal, disabled-item policy, and no extra settings IPC unless selection is actually intended.

### A-P2-06. Slider pointer handling does layout reads on every move and can bubble into lane selection

`AudioSliderControl` calls `getBoundingClientRect()` during pointer move. Lane faders live inside clickable lane articles, and slider events do not stop propagation, so drag/click interaction can also select the strip. The fader probe observed a separate `audio.settings.update` during drag.

Sources:

- `frontend/app/src/app/audio/components/AudioSliderControl.tsx:91` reads layout for pointer value calculation.
- `frontend/app/src/app/audio/components/AudioSliderControl.tsx:134` does that during pointer move.
- `frontend/app/src/app/audio/components/AudioMixerLane.tsx:91` selects a channel from the lane click handler.

Gold-standard target: cache the slider rect on pointer down, update on resize/cancel only when needed, and isolate drag controls from parent selection side effects.

### A-P2-07. Timed draft cleanup and throttled commits have no cancellation API

Many controls call `window.setTimeout(() => clearDraftValue(...), 250)` after commits. The shared throttler returns only `flush` and `schedule`, with no `cancel` or unmount cleanup. This is small, but it creates stale-write risk if a control unmounts during a drag, bank switch, density switch, or workspace change.

Sources:

- `frontend/app/src/app/audio/audioContinuousControls.ts:1` exposes the throttler.
- `frontend/app/src/app/audio/audioContinuousControls.ts:22` schedules the pending flush.
- `frontend/app/src/app/audio/components/AudioMixerLane.tsx:136`, `AudioMixerLane.tsx:169`, and `AudioMixerLane.tsx:288` schedule draft clears.
- `frontend/app/src/app/audio/components/AudioInspector.tsx:932`, `AudioInspector.tsx:957`, `AudioInspector.tsx:982`, `AudioInspector.tsx:1083`, `AudioInspector.tsx:1107`, `AudioInspector.tsx:1131`, `AudioInspector.tsx:1155`, `AudioInspector.tsx:1179`, and `AudioInspector.tsx:1249` do the same for inspector controls.

Gold-standard target: continuous-control hooks should own timer cleanup and expose cancel/flush semantics tied to component lifecycle.

### A-P2-08. Bulk actions fan out into per-channel command storms

Clear all solo loops over every soloed channel and sends an update per channel. With the current store behavior, that can fan out into multiple command requests and snapshot refreshes for a single operator action.

Sources:

- `frontend/app/src/app/audio/AudioWorkspace.tsx:381` loops soloed channels.
- `frontend/app/src/app/audio/AudioWorkspace.tsx:384` calls `updateChannel` for each item.

Gold-standard target: a single engine command such as `audio.solo.clearAll` or a batched update with one authoritative response.

### A-P2-09. Motion and focus policy is incomplete

The audio CSS has one explicit `:focus-visible` rule, for the warning band, while most custom controls rely on browser defaults. The CSS also has snapshot pulse animation and hover opacity transitions but no `prefers-reduced-motion` override.

Sources:

- `frontend/app/src/app/audio/AudioWorkspace.module.css:292` is the only `focus-visible` match in this stylesheet.
- `frontend/app/src/app/audio/AudioWorkspace.module.css:2476` transitions snapshot action opacity.
- `frontend/app/src/app/audio/AudioWorkspace.module.css:2510` applies the snapshot recall pulse animation.
- `frontend/app/src/app/audio/AudioWorkspace.module.css:3745` defines `snapshotPulse`.

Gold-standard target: a deliberate audio-wide focus-ring system for every button/slider/menu item and a reduced-motion media query that disables or shortens nonessential pulses/transitions.

## P3 Findings

### A-P3-01. Rail monitor card clips content at both target sizes

The production fit probe found the rail monitor card content is slightly larger than its hidden viewport at both `2560x1440` and `1920x1080` (`scrollWidth 378`, `clientWidth 350`; height also exceeds the card). Some of that is intentional truncation, but it should be audited visually because the card is the page's primary status affordance.

Sources:

- `frontend/app/src/app/audio/components/AudioRail.tsx:55` renders the monitor card.
- `frontend/app/src/app/audio/AudioWorkspace.module.css` rail card rules around the monitor card use hidden overflow in the fixed left rail.

Gold-standard target: primary monitor status should fit without accidental clipping in both required viewport modes.

### A-P3-02. Palette registration signature serializes channel state on every relevant render

The audio palette registration signature is built with `JSON.stringify` over selected channel, mix target, and snapshot metadata. This is not a current bottleneck, but it sits on the workspace render path and will scale with command palette richness.

Sources:

- `frontend/app/src/app/audio/audioViewModel.ts:117` builds the signature.
- `frontend/app/src/app/audio/audioViewModel.ts:121` starts the serialized payload.
- `frontend/app/src/app/audio/AudioWorkspace.tsx:475` computes the signature from the view model.

Gold-standard target: derive a smaller stable signature from explicit version fields or changed IDs, not a JSON serialization of broad view-model slices.

### A-P3-03. RME metering thread polls aggressively and clones before publish

The native RME meter bridge starts once at engine startup and polls on a 5 ms loop. It clones a compact snapshot before publishing. This may be acceptable for one fixed workstation, but it should be validated on the target host with the real Fireface UFX III attached.

Sources:

- `native/rust-engine/src/main.rs:377` starts RME meter streaming.
- `native/rust-engine/src/rme_totalmix_osc.rs:553` publishes compact meter payloads.
- `native/rust-engine/src/rme_totalmix_osc.rs:555` clones the snapshot.
- `native/rust-engine/src/rme_totalmix_osc.rs:576` sleeps for 5 ms per loop.

Gold-standard target: measure CPU and jitter on hardware, then either keep the loop with evidence or move to a better wake-up/coalescing strategy.

## Recommended Remediation Order

1. Fix `1920x1080` inspector clipping first; it violates the binding fallback target.
2. Move hot drag drafts out of `AudioWorkspace` root and coalesce command/snapshot refreshes.
3. Replace native dialogs with design-system modal/popover flows.
4. Decide the live-meter consistency model: either wire all visible live readouts to the meter frame or clearly separate live canvas from held/reference text.
5. Upgrade snapshot and context-menu interaction primitives.
6. Optimize the canvas paint loop after the semantic/interaction issues are stable.
