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

- Phase 3 audit follow-up: **complete.** All 35 items addressed plus one discovered finding (D-extra-1).
- Validation: typecheck + 160/160 Playwright specs pass (was 144 before this work — +16 new Phase 3 follow-up specs).
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

- [x] **E16.** Subtle mixTarget meter promotion landed: new `.stereoMeter[data-meter-kind="mixTarget"] .meterTrack` rule adds a stronger inset-shadow stack ("recessed hardware display" cue) and tighter outer border on Outputs meters vs Inputs. Brightness ceiling of the green LEDs themselves left unchanged — the visual win comes from the bezel, not from louder green (the implementer's "data-feeding handles parity" rationale partially survives; Output meters still win because the bezel reads as more substantial hardware). (2026-05-24)
- [x] **E17.** Playback strip density addressed via a smaller scope than the plan called for: instead of three rows (role/tag chip + send mini + M toggle), one strip in the preamp's vertical slot showing `BED · STEREO`-style group + format identity. The "Send → Main Out" mini was dropped because the existing `.laneReadout` already shows the send dB value and adding a parallel mini below would be redundant. The M toggle stays in its existing `.laneControls` slot — no need to also render it in a new strip. Motivated deviation from the plan's "three rows" but the spirit (Playback strip stops reading hollow) is delivered. (2026-05-24)
- [x] **E18.** New `AudioLaneTagStrip.tsx` + `.module.css` component rendered for `channel.role === "playback-pair"`. Uses the lane's existing `--audio-lane-accent` for the group label. Reused on any future non-preamp channel kind. (2026-05-24)
- [x] **E19.** Outputs Mute moved from the bottom `laneControls` strip into the `outputBusPanel` next to "Bus level". Reads as one cluster — level + mute — instead of a stranded button below a metric grid. The Slice 3 deletion of Dim/Mono/Talk had left the bottom row holding only Mute, which already looked like an after-thought. `audio-hierarchy.spec.ts:63` updated to find Mute at its new site (and explicitly assert Dim/Mono/Talk remain absent). (2026-05-24)

## F. Slice 5 hygiene

- [x] **F20.** Decision recorded: keep the highlight layer folded into the bezel's `inset 0 1px 0 rgba(250, 246, 230, 0.045)` box-shadow (a dedicated `<span>` for a single-pixel inner highlight isn't worth the DOM cost). Comment in `AudioHardwareReadout.module.css` now explicitly enumerates the four plan layers and identifies the implementation choice for the highlight one. (2026-05-24)
- [x] **F21.** `variant="display"` removed from `AudioHardwareReadout.tsx` and its CSS. The Slice 6 plan called for it to wrap the full EQ + Dynamics graphs, but Group G (G25/G26) landed the same amber-backlight effect at the CSS level directly on `.eqGraphFull` / `.dynamicsGraphFull` (matching the Slice 6 mini-graph pattern) because the variant would have painted a bezel-in-bezel against the graph canvases' own grid backgrounds — same problem F22 sidestepped for the preamp. (2026-05-24)
- [x] **F22.** Decision recorded as a Why-comment in `AudioInspectorChannelHardwareCard.tsx` header: the inspector small preamp is intentionally not wrapped in `AudioHardwareReadout` because the preamp is already a fully-detailed skeuomorphic element (bezel-in-bezel would read worse). (2026-05-24)

## G. Slice 6 — abandoned plan goals

- [x] **G23.** Bypassed EQ curve dims to 30% opacity via a new `.eqGraphFull[data-eq-enabled="false"] svg path { opacity: 0.3 }` rule. The graph keeps rendering (the operator sees what the EQ would do if engaged) but reads as armed-but-inactive rather than competing with active controls. (2026-05-24)
- [x] **G24.** Ghosted band handle treatment landed via `data-ghost` on each `.eqPoint`. Motivated interpretation of the plan: a band reads as ghosted when the EQ section is bypassed OR the band itself has no audible effect (`|gainDb| < 0.05`). Plan called this out as "default frequencies on first selection" — but the existing data model doesn't track "user has touched this band yet," and the gainDb-zero approximation is what an operator would actually want (any band sitting flat reads as inactive). Selected state still wins via box-shadow, so ghosted + selected is a valid composite while the operator is editing. (2026-05-24)
- [x] **G25.** Amber LED backlight on the full EQ graph landed via a new `::after` pseudo-element on `.eqGraphFull` matching the Slice 6 mini-graph pattern. NOT via `AudioHardwareReadout variant="display"` — see F21 for the rationale (bezel-in-bezel problem). The shared visual vocabulary holds; only the implementation mechanism differs. (2026-05-24)
- [x] **G26.** Amber LED backlight on the full Dynamics graph via the same `::after` pattern on `.dynamicsGraphFull`. (2026-05-24)
- [x] **G27.** Dynamics monospace readout cluster landed below the curve as a new `.dynamicsReadoutCluster` three-column grid: Threshold / Ratio / Makeup. Motivated deviation: plan called it "Ratio / Threshold / Knee" but the compressor model carries no `kneeDb` field — substituted Makeup which is in the model and operationally useful at-rest. (2026-05-24)
- [x] **G28.** Always-visible `-60 dB` / `0 dB` axis labels landed in all four corners of `.dynamicsGraphFull` via `.dynamicsAxisLabel[data-axis-position]`. Calibrates the graph so a bypassed 1:1 line reads as "the compressor is set to pass everything through" rather than "no data." Positioned absolutely; SVG viewBox / curve geometry untouched. (2026-05-24)

## H. Tests / verification

- [x] **H29.** New spec `frontend/app/tests/audio-phase-3-followups.spec.ts` covers 13 surfaces from the Phase 3 follow-up work: Slice 1 token resolution, Slice 2 warn-band rebind, Slice 5 hardware-readout wrapper presence (Bus level), lane SOLO chip rebind (D10/I32), rail Dim engaged rebind (D12), Outputs Mute in Bus header (E19), Playback tag strip (E17/E18), EQ bypass data attribute (G23), EQ ghost handles (G24), Dynamics axis labels (G28), Dynamics readout cluster (G27), banner-vs-dot mutual exclusion (H31), footer clock null fallback (C8). All 16 specs in the new file pass (13 main + 3 H30 cross-page). (2026-05-24)
- [x] **H30.** Cross-page risk gate landed as three parametrised Playwright specs in the same file: `lighting-populated`, `planning-populated`, `setup-ready` fixtures each load the shell and assert the subsystem-pill harmonization didn't slip back to legacy "info" / "idle" tones. This implements the Slice 2 plan's risk-gate as programmatic assertions rather than waiting for an operator-driven visual review. (2026-05-24)
- [x] **H31.** New test `toolbar status dot appears IFF the warning band is absent` exercises both directions: `audio-not-verified` fixture (dot visible, banner absent) and `audio-osc-disabled` (banner visible, dot absent). Regression that re-shows both surfaces simultaneously would now fail this spec. (2026-05-24)

### Discovered during follow-up work

- [x] **D-extra-1 (2026-05-24).** Slice 7's status dot was wired to `AudioToolbar.tsx`, which is dead code (component not mounted anywhere — see Phase 2 GS-AUD-44 drift entry). The plan named the wrong site. The Slice 7 spec `operator-shell.spec.ts:846 "renders audio degraded and loading fixture states"` therefore failed when run against the merged Phase 3 branch. Mirrored the dot's rendering into the live Sync button location in `AudioRail.tsx:252`, with the same `data-testid="audio-toolbar-status-dot"` so the existing spec continues to assert against it. The dead `AudioToolbar.tsx` copy is preserved for symmetry per the Phase 2 GS-AUD-44 precedent. Spec now passes.

## I. Architectural / longer-horizon

- [x] **I32.** Collapsed to one yellow. Inspector SOLO action and Sends-tab send-mode-row rebound off `--audio-solo`; lane SOLO chip rebound in D10. With no remaining consumers, the `--audio-solo: #ffd94a` token declaration removed from `AudioWorkspace.module.css` with a Why-comment explaining the Phase 2 holdover. Every SOLO surface now reads `--audio-warn-fill`; the engaged toggles read `--audio-engaged-fill`. (2026-05-24)
- [x] **I33.** `...rest` HTML-attribute pass-through removed from `AudioHardwareReadout.tsx` along with `variant="display"`. After Group G landed the EQ + Dynamics graph backlights at the CSS level (not via the wrapper, per F21's rationale), nothing consumes the pass-through. (2026-05-24)
- [x] **I34.** Open follow-up logged here: `tauri:visual:review` currently only asserts `fitsViewport`, not pixel equivalence. Phase 3 added several visual-only behaviors (warn-band rebind, peak-hold-calm tone, status dot relocation) where a pixel-diff would catch silent regressions. Worth adding as a separate effort; not blocking any current Phase 3 work. (2026-05-24)
- [x] **I35.** Rescope protocol codified in [AGENTS.md](../../AGENTS.md) under a new "Rescope protocol (sliced plans)" section. References the Phase 3 Slice 4 and Slice 6 deltas as the case study. (2026-05-24)
