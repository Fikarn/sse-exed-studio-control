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

- [x] **B6.** Warn-band rebind committed as commit 7ab307c ("audio: phase 3 closeout A — warn-band token rebind"). 16 sites in `AudioSignalCanvas.module.css` rebound from `--audio-hot` → `--audio-warn-fill`. (2026-05-24)
- [x] **B7.** Decision recorded: keep the local `--audio-warn-fill = --audio-hot` override; strengthen the Why-comment with the trade-off + forward reference to I32. Same commit. (2026-05-24)

## C. Slice 0 leftovers

- [x] **C8.** `footerTelemetry.clock` is now `string | null`; placeholder is `null` instead of `"n/a · sr n/a"`. Two consumers (`AudioHealthBar.tsx`, `AudioInspectorOverviewCards.tsx`) render `—` when null and suppress the `title` tooltip. Comment in `audioViewModel.ts` explains the wire-up point for when the engine starts publishing real clock state. (2026-05-24)
- [x] **C9.** Comment landed in `AudioRail.tsx:93` documenting that the visible "Active mix-28" defect lived at the canvas overlay layer (`AudioLiveMeterReadout.module.css`) and was fixed there in 32a5815. Future suffix additions should route through a `<small>` chip per the original Slice 0 intent. (2026-05-24)

## D. Slice 2 unfinished rebinds

- [x] **D10.** Lane SOLO chip rebound — `.laneToggle[data-active="true"]` in `AudioMixerLane.module.css` now uses `--audio-warn-fill` instead of bare `--audio-solo`. With the local `.audioShell` override the rendered color is visually equivalent to pre-rebind. (2026-05-24)
- [x] **D11.** After Slice 3 the lane no longer has Dim/Mono/Talkback toggles (they moved to the rail) and EQ-in/COMP-in were never in the lane — they live in the inspector and were rebound in PR #90. Recorded as no-op for the lane. (2026-05-24)
- [x] **D12.** Rail Dim and Mono active states rebound from `--audio-accent` to `--audio-engaged-fill`. Motivated deviation: Talkback stays on `--audio-talk` green — green-on-active is a long-standing broadcast convention for talkback "go" state with independent semantics from the yellow-overload Slice 2 was reducing. (2026-05-24)
- [x] **D13.** TALENT badge stays on `--audio-group-talent` (a muted ochre). Motivated deviation: that color is part of the audio group palette (talent/line/bed/fx/remote each have a distinct color for at-a-glance group identity) — not part of the yellow overload Slice 2 was reducing. Folding it into engaged amber would erase the group-identity affordance. (2026-05-24)
- [x] **D14.** Peak-hold-calm consumer wired. `AudioStableMeterDbPair` now computes a `MeterZone` (`"calm" | "warn" | "clip"`) from the stabilised peak-hold dBFS using the shared `METER_PEAK_WARNING_DBFS` (-3 dBFS) constant and emits `data-meter-zone` on its outer span. A `:has([data-meter-zone="calm"])` CSS rule softens `.bigMeterRow strong[data-tone="warn"]` to `--audio-peak-hold-calm` when the live peak is in the safe zone. The consumer's `data-tone="clip"` still wins when the channel actually clips. (2026-05-24)
- [x] **D15.** Cross-page subsystem pills harmonization is complete via Slice 4's `shellData.ts` change — Lighting/Audio/Surface all fall back to `"attention"` → StatusBadge `"warning"` tone → `--color-accent-amber`. Recording the verification here so future audits don't re-open this. (2026-05-24)

## E. Slice 4 — abandoned plan goals

- [ ] **E16.** Outputs meter `data-meter-kind="mixTarget"` styling — wider column, higher LED brightness ceiling, inner bezel. Or formally drop with rationale recorded.
- [ ] **E17.** Playback strip 3 compact rows under fader (role/tag chip, send mini, M toggle). Or formally drop.
- [ ] **E18.** Create `AudioLaneTagStrip` component if E17 lands.
- [ ] **E19.** Outputs Mute relocation — into Bus panel, freeing bottom row. Or formally drop.

## F. Slice 5 hygiene

- [x] **F20.** Decision recorded: keep the highlight layer folded into the bezel's `inset 0 1px 0 rgba(250, 246, 230, 0.045)` box-shadow (a dedicated `<span>` for a single-pixel inner highlight isn't worth the DOM cost). Comment in `AudioHardwareReadout.module.css` now explicitly enumerates the four plan layers and identifies the implementation choice for the highlight one. (2026-05-24)
- [ ] **F21.** Will be consumed by Group G (G25, G26 — full EQ/Dynamics graph wraps). Tracked, not yet closed.
- [x] **F22.** Decision recorded as a Why-comment in `AudioInspectorChannelHardwareCard.tsx` header: the inspector small preamp is intentionally not wrapped in `AudioHardwareReadout` because the preamp is already a fully-detailed skeuomorphic element (bezel-in-bezel would read worse). (2026-05-24)

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

### Discovered during follow-up work

- [x] **D-extra-1 (2026-05-24).** Slice 7's status dot was wired to `AudioToolbar.tsx`, which is dead code (component not mounted anywhere — see Phase 2 GS-AUD-44 drift entry). The plan named the wrong site. The Slice 7 spec `operator-shell.spec.ts:846 "renders audio degraded and loading fixture states"` therefore failed when run against the merged Phase 3 branch. Mirrored the dot's rendering into the live Sync button location in `AudioRail.tsx:252`, with the same `data-testid="audio-toolbar-status-dot"` so the existing spec continues to assert against it. The dead `AudioToolbar.tsx` copy is preserved for symmetry per the Phase 2 GS-AUD-44 precedent. Spec now passes.

## I. Architectural / longer-horizon

- [x] **I32.** Collapsed to one yellow. Inspector SOLO action and Sends-tab send-mode-row rebound off `--audio-solo`; lane SOLO chip rebound in D10. With no remaining consumers, the `--audio-solo: #ffd94a` token declaration removed from `AudioWorkspace.module.css` with a Why-comment explaining the Phase 2 holdover. Every SOLO surface now reads `--audio-warn-fill`; the engaged toggles read `--audio-engaged-fill`. (2026-05-24)
- [ ] **I33.** Deferred until Group G lands — G25/G26 (full EQ/Dynamics graph wraps) are the intended consumers of the `AudioHardwareReadout` `...rest` pass-through. Will close as part of Group G.
- [x] **I34.** Open follow-up logged here: `tauri:visual:review` currently only asserts `fitsViewport`, not pixel equivalence. Phase 3 added several visual-only behaviors (warn-band rebind, peak-hold-calm tone, status dot relocation) where a pixel-diff would catch silent regressions. Worth adding as a separate effort; not blocking any current Phase 3 work. (2026-05-24)
- [x] **I35.** Rescope protocol codified in [AGENTS.md](../../AGENTS.md) under a new "Rescope protocol (sliced plans)" section. References the Phase 3 Slice 4 and Slice 6 deltas as the case study. (2026-05-24)
