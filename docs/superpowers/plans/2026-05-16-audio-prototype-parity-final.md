# Audio Prototype Parity Final Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` before implementation. Track progress in `docs/audio-prototype-parity-progress.md` after every task.

**Goal:** Finish the actual audio page implementation against the single authoritative prototype at `/Users/EdvinLandvik/Desktop/2/desk-v10.html`.

**Architecture:** Keep the existing two-process boundary. React renders the operator UI only. The Rust engine and protocol remain responsible for state, persistence, device policy, OSC/TotalMix behavior, and validation.

**Tech stack:** Tauri 2 shell, React 19.2, TypeScript, Vite, Playwright, Rust engine, native protocol contract.

---

## Source Of Truth

- Use only `/Users/EdvinLandvik/Desktop/2/desk-v10.html` as the prototype. Ignore all other audio prototypes.
- Prototype source anchors to inspect before editing:
  - Signature moments: lines near `27-31`.
  - App root: line near `10700`, `<main class="app" data-density="desktop" data-view="submix" id="app">`.
  - Rail target rows: lines near `10783-10820`.
  - Snapshot strip: lines near `11121-11140`.
  - EQ and dynamics inspector structure: lines near `11367-11416`.
  - Command palette implementation: lines near `15480-15895`.
  - Global keyboard behavior: lines near `15914-16100`.
- Prototype caveats that are not implementation requirements:
  - `Shift +` snapshot capture is advertised but not wired in the prototype global key handler.
  - The topbar search icon is visually present but the wired command-palette opener is Cmd/Ctrl+K and the footer link.
  - Do not implement either as required parity unless the user explicitly decides that product behavior.

## Progress Rules

- Before editing code, update `docs/audio-prototype-parity-progress.md` with:
  - `git status --short`
  - current branch
  - `wc -l /Users/EdvinLandvik/Desktop/2/desk-v10.html`
  - note that raw `file://` Browser access is blocked and read-only localhost preview is the approved workaround.
- Update the progress table after every task.
- Allowed statuses: `todo`, `in_progress`, `verified`, `blocked:<exact reason>`.
- A task may become `verified` only after its verification command exits `0`.
- Do not proceed past a failing task without recording the exact failure in the progress file.
- Do not invent substitute behavior for any blocked row.

## Task T1: Layout Contract

**Modify:**

- `frontend/app/tests/operator-shell.spec.ts`
- `frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx`
- `frontend/app/src/app/audio/AudioWorkspace.module.css`

**Steps:**

- [ ] Add `data-testid="audio-snapshot-deck"` to the root `<section>` in `AudioSnapshotDeck.tsx`.
- [ ] In `operator-shell.spec.ts`, add a helper that reads bounding boxes for:
  - `audio-workspace`
  - `audio-signal-canvas`
  - `audio-tiered-mixer`
  - `audio-hardware-outputs-tier`
  - `audio-snapshot-deck`
  - `audio-health-bar`
- [ ] The helper must assert:
  - document scroll height and width do not exceed the viewport by more than 1 px;
  - canvas is inside workspace;
  - tiered mixer is inside canvas;
  - output tier is inside tiered mixer and canvas;
  - snapshot deck is inside canvas;
  - output tier bottom is less than or equal to snapshot deck top plus 1 px;
  - health bar is below the canvas and inside workspace.
- [ ] Apply the helper to `audio-populated` at `2560x1440`.
- [ ] Apply the helper to `audio-1920-fallback` at `1920x1080`.
- [ ] Fix `studioFull` CSS row minimums and snapshot deck sizing so the `1920x1080` assertion passes in the actual shell frame. Known current problem: the output tier overflows below the canvas at `1920x1080`.

**Verification:**

Run:

```bash
npm run playwright:test --workspace frontend/app -- --grep "audio workspace|1920|audio"
```

Mark `T1` verified only when the new geometry assertions pass at both viewport sizes.

## Task T2: Protocol Documentation Drift

**Modify:**

- `native/protocol/v1.md`

**Steps:**

- [ ] Update `audio.channel.eq.update` docs to match implemented parser fields:
  - `channelId`
  - `enabled`
  - `bandId`
  - `bandEnabled`
  - `frequencyHz`
  - `gainDb`
  - `q`
- [ ] Remove stale EQ docs for `bypass` and `gain`.
- [ ] Update `audio.channel.dynamics.update` docs to match implemented parser fields:
  - `channelId`
  - required `section`
  - `enabled`
  - `thresholdDb`
  - `ratio`
  - `attackMs`
  - `releaseMs`
  - `makeupDb`
- [ ] Remove stale dynamics docs for `processorId` and `threshold`.
- [ ] Update `audio.channel.send.update` docs to use `linkStereo`, not `linked`.
- [ ] Do not change `native/protocol/v1.contract.json` for this task unless the checked-in protocol check requires generated artifacts.

**Verification:**

Run:

```bash
npm run protocol:check
```

## Task T3: Prototype Signature Visuals

**Modify:**

- `frontend/app/src/app/audio/components/AudioRail.tsx`
- `frontend/app/src/app/audio/components/AudioSignalCanvas.tsx`
- `frontend/app/src/app/audio/components/AudioSnapshotDeck.tsx`
- `frontend/app/src/app/audio/AudioWorkspace.module.css`
- `frontend/app/tests/operator-shell.spec.ts`

**Steps:**

- [ ] Add a visible master halo element with `data-testid="audio-master-halo"`.
- [ ] Drive the halo from selected mix target meter or volume already present in the view model. Do not create synthetic device state.
- [ ] Add routing overlay element with `data-testid="audio-routing-overlay"` for selected source to active output.
- [ ] The overlay must only represent current fixture/state data. Do not invent extra channels or routing state.
- [ ] Replace deterministic snapshot thumbnail bars in `AudioSnapshotDeck.tsx` with bars derived from `snapshot.contents.channels[*].mixLevels[selectedMixTargetId]`.
- [ ] If a snapshot has no `contents`, render the existing stable empty/placeholder shape and label it as no captured contents.
- [ ] Add snapshot preview text that shows numeric before/after dB values for at least the first two changed channels or mix targets when `snapshot.contents` exists.
- [ ] Keep current save, rename, delete, recall actions unless a test proves they conflict with prototype parity.

**Verification:**

Run:

```bash
npm run playwright:test --workspace frontend/app -- --grep "audio"
```

Required assertions:

- halo is visible on `audio-populated`;
- routing overlay is visible when a source and output are selected;
- saved snapshot thumbnail changes when a channel fader changes;
- snapshot hover preview includes numeric before/after text when contents exist.

## Task T4: Inspector Processing Depth

**Modify:**

- `frontend/app/src/app/audio/components/AudioInspector.tsx`
- `frontend/app/src/app/audio/AudioWorkspace.module.css`
- `frontend/app/tests/operator-shell.spec.ts`

**Steps:**

- [ ] EQ tab must expose editable `gainDb`, `frequencyHz`, and `q` for each band using existing `audio.channel.eq.update`.
- [ ] EQ graph points must be selectable and draggable. Dragging commits `frequencyHz` and `gainDb` for that band.
- [ ] Band type and slope must remain display-only unless existing types already expose writable fields. Do not add new protocol fields for them.
- [ ] Dynamics tab must expose compressor and gate `thresholdDb`, `ratio`, `attackMs`, `releaseMs`, and `makeupDb` using existing `audio.channel.dynamics.update`.
- [ ] Do not add gate `range` or `hold` fields in this pass. Add a progress row note: `blocked:gate range/hold require protocol/product decision`.
- [ ] Keep sends tab behavior as-is unless touched by test failures.

**Verification:**

Run:

```bash
npm run playwright:test --workspace frontend/app -- --grep "audio EQ|audio dynamics|audio"
```

Required assertions:

- EQ frequency, Q, and gain sliders/controls update their aria values;
- dragging an EQ point changes the selected band;
- compressor attack, release, and makeup controls update their aria values;
- gate threshold, ratio, attack, release, and makeup controls update their aria values.

## Task T5: Command And Interaction Parity

**Modify:**

- `frontend/packages/design-system/src/components/CommandPalette.tsx`
- `frontend/app/src/app/audio/AudioWorkspace.tsx`
- `frontend/app/src/app/audio/audioViewModel.ts`
- `frontend/app/src/app/audio/components/AudioTieredMixer.tsx`
- `frontend/app/tests/operator-shell.spec.ts`

**Steps:**

- [ ] Preserve action groups during typed command-palette search. Current component collapses typed results into `Results`; audio parity needs grouped search results.
- [ ] Audio action groups must be exactly:
  - `Channels`
  - `Outputs`
  - `Snapshots`
  - `Actions`
- [ ] Audio command labels must match prototype style:
  - `Select FX 3/4`
  - `Solo FX 3/4`
  - `Mute FX 3/4`
  - `Switch active mix to Main Out`
  - `Recall snapshot 1`
- [ ] Match prototype arrow behavior:
  - ordered selection is hardware inputs, then playback, then outputs;
  - `ArrowLeft` and `ArrowUp` move one item backward;
  - `ArrowRight` and `ArrowDown` move one item forward;
  - if a slider or knob has focus, arrow keys continue adjusting that control instead.
- [ ] Implement prototype group-chip behavior:
  - normal click single-selects the group and clicking the active chip clears the filter;
  - Shift-click toggles that group in a multi-select set;
  - Alt-click inverts selected groups for that tier.
- [ ] Update `audioViewModel.ts` types from a single active group to the minimum structure needed for per-tier multi-select without changing engine state.
- [ ] Make tier dead-space clicks clear selected channel when clicking tier label or empty lane area, while not clearing selection from buttons, sliders, menus, or strip bodies.
- [ ] Do not move the rail/canvas target picker unless a test explicitly documents the move. Current app already has rail target rows and a canvas picker; the parity issue is behavior and grouping, not a mandatory relocation.

**Verification:**

Run:

```bash
npm run playwright:test --workspace frontend/app -- --grep "audio command|audio group|audio workspace|audio"
```

Required assertions:

- typed command search for `fx` shows grouped sections, not only `Results`;
- `Select FX 3/4`, `Solo FX 3/4`, and `Mute FX 3/4` appear under the correct groups;
- arrow navigation reaches an output lane;
- Shift-click and Alt-click group filters behave as specified;
- clicking tier dead space clears channel selection.

## Task T6: Fixture Coverage

**Modify:**

- `frontend/packages/test-fixtures/src/index.ts`
- `frontend/app/tests/operator-shell.spec.ts`

**Steps:**

- [ ] Add a derived fixture `audio-no-send` based on `audio-populated`.
- [ ] In `audio-no-send`, set `audio-playback-3-4` mix level for `audio-mix-main` to `0`.
- [ ] Test that `audio-playback-3-4` renders `data-no-send="true"` when the selected mix target is `audio-mix-main`.
- [ ] Add a snapshot contents test:
  - open `audio-populated`;
  - save current snapshot or create a captured snapshot;
  - change one fader;
  - hover the saved/captured snapshot;
  - assert numeric before/after preview text is visible.

**Verification:**

Run:

```bash
npm run playwright:test --workspace frontend/app -- --grep "audio-no-send|snapshot|audio"
```

## Final Verification

Run all commands in order:

```bash
npm run build --workspace frontend/app
npm run protocol:check
npm run playwright:test --workspace frontend/app -- --grep audio
npm run tauri:visual:review
```

If `npm run tauri:visual:review` cannot run, record the exact blocker and the exact command for the user to run.

## Final Handoff Requirements

The fresh session final response must include:

- changed files;
- progress ledger status summary;
- verification commands and results;
- any `blocked:<exact reason>` rows;
- confirmation that no other prototype was used.
