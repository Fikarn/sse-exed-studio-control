# Audio Phase 3 Follow-up Fixes

Tracking ledger for the 35 findings raised in the 2026-05-24 Phase 3 audit
(see chat session transcript and the original audit report). Each item is
either landed as a checkbox below, or carries a one-line "decision recorded"
note when the original plan goal is being formally dropped.

Source plan being audited against: `~/.claude/plans/keep-the-focus-on-serene-sunset.md`
(checked into this repo at `docs/plans/audio-phase-3-gold-standard-polish.md` as
part of item A4 below).

Source progress doc that the audit found stale: [audio-ui-gold-standard-progress.md](./audio-ui-gold-standard-progress.md)
(updated as part of item A1 below).

## Status

- Phase 3 audit follow-up: **in progress**.
- Last updated: 2026-05-24.

## A. Doc / tracking drift

- [x] **A1.** Status section of [audio-ui-gold-standard-progress.md](./audio-ui-gold-standard-progress.md) updated to "Phase 3 in flight; Phase 2 closed" with a pointer to this ledger. (2026-05-24)
- [x] **A2.** Phase 3 Validation Log section added to the same doc with one row per command-type, honestly noting that per-slice rows were never landed during the original Phase 3 work — only "PR CI passed at the time each PR merged" is defensible from checked-in evidence. (2026-05-24)
- [x] **A3.** Phase 3 closeout deltas table added (8 rows, slice 0–7, each cross-referencing the open follow-up items by ID). (2026-05-24)
- [x] **A4.** Plan checked in at [audio-phase-3-gold-standard-polish.md](./audio-phase-3-gold-standard-polish.md) with a provenance note pointing back at this ledger. (2026-05-24)
- [x] **A5.** Branch posture decision: keep `audio/phase-3-closeout-a-warn-rebind` as the working branch for the entire follow-up cycle (the name no longer perfectly fits the contents, but renaming mid-flight risks losing the PR thread). After the follow-up PRs merge, delete the branch in the normal post-merge cleanup. (2026-05-24)

## B. Uncommitted-state cleanup

- [ ] **B6.** Commit (or revert) the two uncommitted CSS files (`AudioWorkspace.module.css`, `AudioSignalCanvas.module.css`) as the warn-band rebind close-out.
- [ ] **B7.** Decide on the `--audio-warn-fill = --audio-hot` local override — keep it (with a stronger Why-comment) or drop it and accept the brand.yellow tone.

## C. Slice 0 leftovers

- [ ] **C8.** [audioViewModel.ts:496](../../frontend/app/src/app/audio/audioViewModel.ts:496) — make `clock` nullable (or `{clock, sampleRate}` structured) instead of a hardcoded `"n/a · sr n/a"` placeholder.
- [ ] **C9.** Either restructure `AudioRail.tsx:93` so the appended suffix is a separate `<small>` chip, OR leave a comment pointing at `AudioLiveMeterReadout.module.css` as the actual fix site.

## D. Slice 2 unfinished rebinds

- [ ] **D10.** Lane SOLO chip — rebind `[AudioMixerLane.module.css:323-326](../../frontend/app/src/app/audio/components/AudioMixerLane.module.css:323)` from `--audio-solo` to `--audio-warn-fill`.
- [ ] **D11.** Lane `data-active` engaged states — split SOLO (warn) from EQ-in/COMP-in/Dim/Talkback (engaged); rebind the engaged-state controls to `--audio-engaged-fill`.
- [ ] **D12.** Rail `data-active` engaged states — same split on the rail side.
- [ ] **D13.** TALENT badge — locate and bind to `--audio-engaged-fill`.
- [ ] **D14.** Peak-hold-below-warn — wire the threshold check so peak-hold readouts in the safe zone render `--audio-peak-hold-calm`. Currently the token has zero consumers.
- [ ] **D15.** Cross-page subsystem pills — verify Lighting / Audio / Surface "pending" pills render on `--audio-engaged-*` (not `brand.yellow`), per Slice 2 plan rebinding map last row.

## E. Slice 4 — abandoned plan goals

- [ ] **E16.** Outputs meter `data-meter-kind="mixTarget"` styling — wider column, higher LED brightness ceiling, inner bezel. Or formally drop with rationale recorded.
- [ ] **E17.** Playback strip 3 compact rows under fader (role/tag chip, send mini, M toggle). Or formally drop.
- [ ] **E18.** Create `AudioLaneTagStrip` component if E17 lands.
- [ ] **E19.** Outputs Mute relocation — into Bus panel, freeing bottom row. Or formally drop.

## F. Slice 5 hygiene

- [ ] **F20.** [AudioHardwareReadout.module.css](../../frontend/app/src/app/audio/components/AudioHardwareReadout.module.css) — add the explicit highlight layer the plan called out, OR document in the component header that the highlight is folded into the bezel `box-shadow`.
- [ ] **F21.** [AudioHardwareReadout.tsx](../../frontend/app/src/app/audio/components/AudioHardwareReadout.tsx) `variant="display"` — consume it in Slice 6, or delete the unused variant.
- [ ] **F22.** Record the inspector small preamp re-skin decision (Slice 5 skipped it with "bezel-in-bezel" reasoning) in a checked-in note.

## G. Slice 6 — abandoned plan goals

- [ ] **G23.** Bypassed EQ curve at ~30% opacity when `selectedChannel.eq.enabled === false`. Or formally drop.
- [ ] **G24.** Ghosted band handles at default frequencies (LC 80, B1 250, B2 1k, B3 4k) with `data-ghost=true`. Or formally drop.
- [ ] **G25.** Wrap the full EQ graph in `AudioHardwareReadout variant="display"`. Or formally drop (couples with F21).
- [ ] **G26.** Wrap the full Dynamics graph in the same wrapper. Or formally drop (couples with F21).
- [ ] **G27.** Dynamics monospace Ratio / Threshold / Knee readout cluster (data already on `selectedChannel.dynamics.compressor`). Or formally drop.
- [ ] **G28.** Dynamics always-visible `-60 dB` / `0 dB` axis labels. Or formally drop.

## H. Tests / verification

- [ ] **H29.** Add audio test specs for the Phase 3 work that landed without coverage: token resolution (Slice 1), warn-band rebind (Slice 2 close-out A), hardware-readout wrapper (Slice 5), mini-graph backlight (Slice 6), banner-eligible gating (Slice 7).
- [ ] **H30.** Run cross-page risk-gate `tauri:visual:review` with `lighting-populated` / `planning-populated` / `setup-ready` fixtures (Slice 2 plan asked for this; never recorded).
- [ ] **H31.** Toolbar status dot — add a counter-test asserting the banner is _absent_ when the dot is rendered, so a regression that re-shows both is caught.

## I. Architectural / longer-horizon

- [ ] **I32.** Two yellows on the audio page (`--audio-hot` #ffd33d and `--audio-solo` #ffd94a) — decide whether the ~3-bit distinction is intentional and document, or collapse to one.
- [ ] **I33.** `AudioHardwareReadout`'s `...rest` props pass-through was added in Slice 6 for mini graphs that ended up not consuming the wrapper. Either find a real consumer or revert the addition.
- [ ] **I34.** Open a follow-up to add a pixel-diff step to `tauri:visual:review` (currently only asserts `fitsViewport`). Not blocking, but Phase 3 added several visual-only behaviors a pixel diff would catch.
- [ ] **I35.** Codify the rescope protocol: when a slice's premise turns out to be wrong, the rescope should land as a separate plan-doc edit + a new slice, not a same-numbered substitution.
