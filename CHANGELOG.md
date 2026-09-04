# Changelog

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- **Publish now needs every probe green, or an explicit override (2026-09 audit remediation, Slice 8 — operator decision 7).** `commissioning.update { stage: "ready" }` used to unlock the dashboard whatever the probes said, two automation scripts published with zero probes run, and the Setup runner's "Run all probes" reported "completed" even when a probe failed and advanced anyway. The engine now refuses to publish while any commissioning probe is not `passed` (`COMMISSIONING_PROBES_INCOMPLETE`, naming each probe and whether it failed or was never run) unless the request carries `overrideProbes: true`; an override is recorded as `publishOverrideAt` in the commissioning snapshot, appended to the readiness summary and written to the engine log, and a later clean publish clears it. The Setup runner now reports "n of 3 probes passed" with each failure's message and stays on the probe step; Publish with a non-green probe opens "Publish with failing probes?" listing them, and "Publish anyway" sends the override. The fixture transport mirrors the refusal and can fail probes deterministically (lighting bridge `0.0.0.0`, audio send port `1`). The native acceptance, packaged acceptance and Tauri setup-support qualification scripts pass the override explicitly, because their hosts have no hardware.
- **Talkback is momentary on every surface (2026-09 audit remediation, Slice 6 — operator decision 4).** The Console page's Talkback button was a toggle: one click latched talkback on until someone clicked again, and its caption pointed at an `M` shortcut that in fact mutes the selected strip. Talkback is now a hold everywhere. Hold the button (pointer, or Space / Enter when focused) or hold `T` anywhere on the Audio page; the app sends the new `audio.talkback.hold` method on engage, re-sends it every 750 ms while held, and releases on pointer-up, key-up, window blur, a hidden document, unmount or the audio gate closing. The engine keeps one watchdog for every surface — the button, `T`, the Stream Deck `TALK` key and any `audio.mixTarget.update` that turns talkback on all arm it, any of them turning talkback off clears it — and a hold that is not renewed within 2 s is released with `/controlroom/talkback 0`. A heartbeat while talkback is already on only re-arms the deadline (no console write, no database write, no `audio.changed`), and a graceful engine stop (stdin closed) releases an active hold on the way out; a hard kill cannot, and OPERATIONS says so. The deck's `TALK` key now delegates to the same path. A talkback change made in TotalMix itself still arrives through the console link as external state and is not watched. The live check also found that the studio desk has no talkback input channel assigned in TotalMix (`/controlroom/talkchannel -1`), and that TotalMix then ignores `/controlroom/talkback 1` from every remote and answers `0`; the console link now records that as `AUDIO_TALKBACK_REFUSED` with the TotalMix instruction and drops the hold instead of silently flipping the button back (OPERATIONS commissioning step 4).
- **The engine now reads the RME console back (2026-09 audit remediation, Slice 2 — `docs/plans/audit-remediation-2026-09.md`).** Until now nothing in the app ever listened to what TotalMix said about control state: Global OSC traffic other than `/level/*` was dropped, so a fader moved in TotalMix, a mute toggled on the desk, or a write the console refused all left the app showing its own assumption. A new console link (`native/rust-engine/src/rme_console_link.rs`, applied by `audio/console_link.rs` on the metering thread) parses every Global OSC control parameter the app models (channel mute / 48V / phase / instrument / AutoSet, preamp gain in dB, output volume in dB, `/mix/…` fader (dB) and solo, control-room dim / mono / talkback, `/status/*`, `/snapshot/load/*`), applies external changes to the stored state under a new audio state lock, and emits `audio.changed { reason: "console-echo" }` so the open Console page follows the desk. Every send the app makes is now **confirmed**: live probing of the studio UFX III showed TotalMix does not echo a value back to the remote that sent it (that is an optional "re-send" mode RME warns against), so the link issues an explicit read-back after each send settles (`/sendchan/{bus}/{ch}` for channel parameters, `/sendsubmix/{out} 2` paired with `/sendstate` for mix nodes, `/sendsettings` for control-room functions), compares the reply against what was sent (faders through RME's published fader curve, new `audio/fader_curve.rs`, because the console answers in dB), lets the console win when it reports something else (e.g. a write to a channel hidden in the TotalMix layout, which the console silently drops), confirms an "off" fader by its absence from the submix reply, and after 1.5 s without confirmation downgrades console-state confidence to `assumed` with `AUDIO_CONSOLE_UNCONFIRMED` naming the parameters. `/status/connection 0` from TotalMix resets confidence to `unknown` and shows a `CONSOLE DISCONNECTED` banner. `audio.snapshot` gains `consoleLink` (`slotBound`, `connection`, `device`, `dspLoad`, `lastEchoAgeMs`, `pendingSends`, `unconfirmedSends` + names, `confirmedSends`, `adjustedSends`, `externalChanges`, `activeConsoleSnapshot`, `lastPullAt` / `lastPullValues` reserved for the Sync pull). Console-state confidence now has one writer (`helpers::confidence_setting`, guarded by a source-scan test) and stored channel / mix-target state tolerates missing or unknown fields instead of dropping the whole map. Verified live on the studio console: passive ingest set the app to the desk's real values on first contact, a −62 dB nudge on an unused send confirmed by read-back, its restore to off confirmed by absence, and a mute on the hidden playback pair 9/10 was reverted by the console within one read-back. Operator-visible consequence: on the first start against the live console, strips move to the console's real state instead of the app's remembered one.
- **Stream Deck+ audio surface: the deck is now the Audio workspace's physical control surface.** The control-surface bridge's audio slice was a demo shell — its mute/phantom/gain actions wrote a bridge-private settings blob that never reached TotalMix, the app UI, or `audio.snapshot`. It is replaced end to end (`docs/plans/streamdeck-audio-surface.md`): `POST /api/deck/audio-action` now speaks a real deck vocabulary (`dialTurn` with the app's 0.01 fader step and ×5 fast-turn acceleration or whole-dB gain steps, `dialPress` mute, `stripTap` selection, `setMixTarget` sharing the app's engine-persisted `selectedMixTargetId`, `cycleBank` inputs/playback/outputs, `toggleDialMode`, `dimToggle`, momentary `talkOn`/`talkOff` with a 2 s engine watchdog that auto-releases stuck talkback, `soloClearAll`) — every action calls the same audio-module functions as IPC dispatch, passes `ensure_audio_action_allowed`, and emits `audio.changed` through a bridge event sender so the open Audio page follows deck moves live. New LCD keys (`audio_strip_1..4`, `audio_key_1..8`, `workspace`) serve engine-baked text — channel name, level in the same dB curve the on-screen fader prints, MUTED/selection/target markers, and the gate reason instead of values when audio is not verified — and `/api/deck/context` now carries the active workspace plus the audio deck state. The Companion export was rebuilt as a native v9 full config: the AUDIO page maps the physical deck (8 keys, 4 touch-strip cells with engine-variable text, 4 push-dial encoders), the file ships a 1 s LCD-poll trigger plus three condition-true page-follow triggers that flip the deck to the AUDIO/LIGHTS/PROJECTS page when `shell.workspace` changes (the export asks the local Companion for its surfaces over loopback HTTP and binds the triggers to the physical Stream Deck, falling back to `self`), and the connection label changed to `SSE_Studio_Control` because Companion labels reject the previous spaced label, which silently broke every `$(label:variable)` reference. The Setup runner's "Verify live echo" step is real now: the bridge stamps `app.control_surface.last_event` on every successful action, `controlSurface.snapshot` exposes it, and the verify step polls it and pulses the matching mapped control — replacing a decorative diff that could never fire. Commissioning imports the exported profile via Companion's **Full Reset & Import** (the partial import path remaps actions onto a pre-existing connection and its stale prefix). Bridge qualification (`native:bridge:{mac,win}:verify`) covers the new vocabulary, including the gated-409 path. A visual-language pass then replaced the uniform white-on-black text with the app's Console vocabulary on the hardware: the active mix-target key renders solid amber, TALK goes green while live, SOLO CLR warn-yellow with the live count, muted strips drop to an ember `MUTED` treatment, the selected strip carries the amber accent, every key gets an icon (assets rendered by `scripts/deck-assets.py`, embedded base64 in the export), topbars are off for full-bleed cells, and each touch-strip segment draws a quantized fader-position bar (12 buckets, unity notch at the app scale's 0.8) that swaps per-bucket PNGs through Companion feedbacks on new machine-readable engine variables (`audio_state_*`, `audio_strip_N_state`, `audio_strip_N_level` — the level key folds mute into an `m`-prefixed bucket so the bar drops to ember when muted). The profile also now ships every custom variable it polls into, including the nine legacy planning/lighting LCD variables (generic-http silently drops stores into variables that don't exist — the pre-rebuild profile's LCD text had never rendered for this reason).
- **Native audio control output to RME TotalMix over OSC.** Channel and output-mix edits on the Audio console now reach the hardware: `update_channel` and `update_mix_target` in the `RmeTotalMixOscBackend` send classic paged TotalMix OSC commands (`send_totalmix_channel_update` / `send_totalmix_mix_target_update` in `rme_totalmix_osc`) instead of only persisting app state. Faders (`/1/volume{N}`) and front-preamp gain (`/1/micgain{N}`, normalized over the UFX III's 0–75 dB range) are sent as absolute values; mute/solo/phantom (`/1/{mute,solo,phantom}/1/{N}`) and main-out dim/mono/talkback (`/1/mainDim`, `/1/mainMono`, `/1/mainTalkback`) are TotalMix toggles sent once per operator action. Commands route to the slot that owns the surface — inputs on the base send port, playback on `+1`, outputs on `+2` — reusing the exact strip indexing the metering path already maps (the commissioned tidied-layout tables: preamps 9-12 on input strips 1-4, Main on output strip 1, Phones on 5/6), so control and meters cannot disagree about addressing, and no bank/bus state is ever mutated beyond the keepalive's own bus/bank pinning (the earlier EQ path's bank-select prefix remains the one exception). Requests with no classic-OSC command (phase, pad, instrument, auto-set, non-main submix fader sends, phones dim/mono/talkback) stay app-local and say so in the action summary. Console sync remains metering-only by design — it must not push default inventory values at a live console.
- **Audio control output migrated to TotalMix Global OSC (layout-proof, absolute values).** Channel and output-mix commands now use RME's official Global OSC protocol (2026-07-21 table) on the fourth remote's send port (base `+3`) instead of the classic banked page-1 commands: `/mix/{in|pb}/{ch}/{out}/faderlin` for per-submix channel faders (linear 0..1 — the app's own fader scale, so no curve conversion), `/output/{ch}/faderlin` for output levels, absolute `/input|playback|output/{ch}/mute`, `/mix/{in|pb}/{ch}/0/solo`, `/input/{ch}/48v|phase|pad|instrument|autoset`, real-dB `/input/{ch}/gain`, and `/controlroom/dim|mainmono|talkback`. This retires the two structural weaknesses of the classic command path: hardware channel numbering never shifts with the TotalMix mixer layout (no more strip-table recommissioning for controls), and absolute values replace TotalMix's classic toggles (app and console state can no longer invert against each other). It also unlocks previously impossible sends: non-main submix channel faders (Phones 1/2 mixes) and phase/pad/instrument/auto-set. EQ/Low Cut stays on the classic page-2 path for now; the classic remotes remain as metering fallback.
- **Layout-proof metering via TotalMix Global OSC (optional fourth remote).** Classic TotalMix OSC never streams output-bus levels, and its bank strip indexing shifts whenever the mixer's channel layout changes — both bit this studio in production. The metering thread now also binds a Global OSC slot on receive port base `+3` (default `9004`), primes and keeps the stream alive with `/sendall` + `/sendstate` to send port base `+3` (default `7004`), and consumes `/level/{in|pb|out}/{ch}` peak-dB messages on 0-based hardware channel numbering (verified against RME's official Global OSC protocol table, 2026-07-21 revision: stereo right channel = left + 1, delta-only transmission, integer trigger args accepted). While the Global stream is live it is the meter authority for every surface — inputs 1-12, playback pairs, Main out `0/1`, Phones `8/9`/`10/11` — and the layout-sensitive classic bank levels are suppressed, resuming automatically as fallback if the Global stream stops. The slot is inert until the operator commissions TotalMix remote controller 4 in Global OSC mode (requires TotalMix FX 2.1+; commissioning steps in docs/OPERATIONS.md "Metering over Global OSC").
- **Native lighting DMX output over sACN (E1.31).** The engine now transmits the operator's lighting state to the commissioned Apollo Bridge as unicast ANSI E1.31 on UDP `5568` — previously the lighting page was UI/persistence only and no packets ever reached the rig. A dedicated engine thread (`lighting_sacn_output`) renders per-universe 512-slot frames through the same `compute_dmx_channel_data` path as the operator-facing DMX monitor (grand master, identify/highlight/solo overlays, and in-flight fades included), streams changes at a 40 ms tick with 800 ms E1.31 keep-alives, and ends the stream with spec-compliant stream-terminated packets (fixtures hold last levels) whenever lighting output becomes ineligible — lighting disabled, bridge unconfigured, or nothing patched. Output starts automatically once lighting is enabled with a valid bridge IP and at least one patched fixture; this is an intentional, documented live-state write on engine start (see docs/OPERATIONS.md "Lighting output"). No protocol surface changed and no new dependencies were added (std `UdpSocket`; packets are built against the E1.31 layout with unit coverage).

- **Program-wide UI/UX refinement plan completed (PRs [#125](https://github.com/Fikarn/sse-exed-studio-control/pull/125)–[#161](https://github.com/Fikarn/sse-exed-studio-control/pull/161), 2026-06-06 → 2026-06-10) + the round-2 fix cycle and close-out (PRs [#162](https://github.com/Fikarn/sse-exed-studio-control/pull/162)–[#168](https://github.com/Fikarn/sse-exed-studio-control/pull/168)).** Sixteen dependency-ordered slices brought every operator surface to the Audio Console's bar, closing all 77 findings of the 2026-06-05 static audit (`docs/archive/program-ux-audit-2026-06-05.md`): the token foundation (undefined namespaces defined, `--z-*` ladder, shared type/motion scales), app-wide Studio/Graphite/Bone theming via global `[data-theme]` with per-theme visual baselines for every surface, one shared chrome (PreReadyFrame for pre-ready surfaces, one HealthBar primitive with `full`/`caption` variants, a 4-tone toast vocabulary with the amber `attention` tier, operator-grade copy), the shared control contract (Cmd/Ctrl=fine + typed numeric entry via the promoted DS `NumberEntryDialog`, keyboard-operable Planning board cards, real `role=slider` on ScrubLabel), per-surface deep polish (Lighting de-blue + frame-to-content stage; Planning lane-fill + full DS-primitive adoption; Setup token-true greens + scroll-within + recovery alignment; Startup/Recovery un-blanked storybook guards + presence-keyed toast offset), Audio's literal-100 closure (140 font literals onto 13 new shared type-scale steps, byte-identical), and Bone decorative tuning with full WCAG math (glass/stage-grid/minigraph/severity ≥4.5:1 badge text). The round-2 **runtime** audit (`docs/archive/program-ux-audit-round-2-2026-06-10.md`, 10 findings) then closed its own fix cycle: a real document-level focus trap + single-modal posture for the command palette (the one high finding), reduced-motion completeness for the JS animation loops (meter ballistics snap; decorative pulse gated; one finding refuted on inspection and corrected in the audit), visual locking for all 8 designed empty/degraded fixture states, the documented lucide stroke-tier convention, the last DES-07 rgba residue in DS primitives, and the DS focus-ring/`@sse/tokens` import repair. Per-surface audit scores at the start: Audio 92 → others 34–63; every gap closed or explicitly logged with an owner.
- **Test & review remediation plan completed (PRs [#99](https://github.com/Fikarn/sse-exed-studio-control/pull/99)–[#109](https://github.com/Fikarn/sse-exed-studio-control/pull/109) plus PR 11).** Eleven phased PRs landed the visual-baseline gate, the CI expansion within free-tier (`frontend-e2e`, `frontend-test`, `tauri-foundation`, `qualification`, plus `native:acceptance` extension of `rust`), local release safety (`release:preflight`, the chain-of-custody manifest at `release/manifests/<tag>.json`, hash-locked release notes, explicit-`--allow-staged` QtIFW staging), the Vitest + Playwright spec split, IPC contract test, Storybook visual lane, component/unit/script test coverage, Rust integration + contract drift + GR-meter guard + storage backward-compat tests, viewport-contract spec, rescope nudge tooling (`scripts/check-slice-rescope.mjs`), and the PR 11 finishing pass (Scaled Studio Preview baselines extended to `lighting-populated`, `planning-populated`, `setup-ready`; PR template captures studio-monitor manual sign-off, hardware-touch toggle, and rescope check; `npm run native:test:hardware` opt-in lane for `#[ignore]`-marked device tests; `scripts/legacy/README.md` documents retention rationale; AGENTS.md command map + validation lanes section refreshed). The plan lives outside the repo at `~/.claude/plans/good-research-i-would-zazzy-kay.md`; the Follow-ups section there is the audit trail for prior PR rescopes.
- Engine-owned lighting fixture catalog with a `lighting.fixtureCatalog.snapshot` protocol method, additive fixture identity fields (`definitionId`, `modeId`, `universe`, `controlValues`), universe-aware DMX validation/monitoring, scene `controlValues` capture/recall, and a catalog-backed compatibility bridge for legacy `Astra`, `Infinibar`, and `Apollo Bridge` fixture instances.
- Catalog-backed Lighting UI for adding verified fixtures by manufacturer/family/model/mode, rendering catalog visual shapes and pixel layouts in the stage plot, surfacing generated catalog controls in the inspector, and showing multi-universe DMX output without moving DMX policy into React.
- Audio gold-standard pass through finding `GS-AUD-34`: truthful controls (placeholder/no-op affordances removed), arm-then-apply safety for high-risk actions (48V, snapshot recall, palette recall, snapshot overwrite), ARIA semantics on toggles/tabs/sliders, truthful multi-solo warning summary, and `canSync`-gated warning recovery copy. Progress preserved at [docs/plans/audio-ui-gold-standard-progress.md](docs/plans/audio-ui-gold-standard-progress.md).
- RME TotalMix OSC adapter for live meter polling and Page 2 EQ/Low Cut command path. Engine-side `rme_totalmix_osc` module parses real TotalMix level/dB messages, applies console-grade peak hold/decay ballistics, and routes EQ edits through the documented OSC controls. Inventory continues to fall back to deterministic simulator output when no real packets arrive, and the new `audio_meter_fixture` module keeps fixture-driven review surfaces deterministic.
- Pro-Q-inspired EQ inspector with RME-accurate Low Cut + 3-band PEQ snapshot/request model (separate `AudioLowCutSnapshot`), smooth response curve with log frequency markers and `+20/0/-20` dB cues, distinct Low Cut handle, selected-band badge, and a single control tray. Disabled Low Cut now renders inactive instead of painting an active left-side curtain.
- Frontend display-ballistics model for inspector meter readouts (`audioMeterDisplayModel`), with fixed-width Peak L/R/Hold readouts (`AudioLiveMeterReadout`) and a compositor-accelerated meter canvas overlay (`AudioMeterCanvasOverlay`) so the inspector text and meter marks share one stabilization model.
- Audio number and text input dialogs (`AudioNumberDialog`, `AudioTextDialog`) and an `audioControlDraftStore` for arm-then-apply control drafts.
- Audio Phase 3 gold-standard polish (PRs [#88](https://github.com/Fikarn/sse-exed-studio-control/pull/88)–[#95](https://github.com/Fikarn/sse-exed-studio-control/pull/95), 2026-05-23): visible-defect cleanup (`CLOCK CLOCK`, `OutHost selected`, doubled OSC NOT VERIFIED prefix, `Active mix-28`), additive two-tier semantic token vocabulary (`color.audio.warn.*` / `color.audio.engaged.*` / `color.audio.peakHold.calm` / `shadow.glowAmber*`), single-source DIM/MONO/TALK on the rail with the Output card keeping only per-target Mute, hardware-readout wrapper around the Outputs Bus and Rail Monitor level numerals, and a banner-eligible flag that demotes "OSC not verified — never attempted" to an inline status dot next to the Sync button while preserving full-width banners for genuinely critical states. The Phase 3 plan is checked in at [docs/plans/audio-phase-3-gold-standard-polish.md](docs/plans/audio-phase-3-gold-standard-polish.md).
- Audio Phase 3 follow-up landed via [PR #97](https://github.com/Fikarn/sse-exed-studio-control/pull/97) (2026-05-24) — closed the 35 items in the [2026-05-24 audit](docs/plans/audio-ui-phase-3-followup-fixes.md): structural `clock` nullability fix, Slice 2 lane SOLO + rail Dim/Mono rebinds (engaged amber), peak-hold-calm tone on safe-zone readouts via a live `data-meter-zone` attribute on `AudioStableMeterDbPair`, AudioLaneTagStrip for Playback strips, Outputs Mute relocated into the Bus panel, bypassed-EQ-curve dim at 30% opacity + ghosted band handles when audibly inactive, amber LED backlight on the full EQ + Dynamics graphs matching the Slice 6 mini-graph pattern, a Threshold/Ratio/Makeup monospace readout cluster + always-visible `-60`/`0 dB` axis labels on the dynamics curve, and a Slice 7 dead-code bug fix (the toolbar status dot's render site was moved from the unmounted `AudioToolbar.tsx` to the live Sync button in `AudioRail.tsx`). The two near-identical Phase 2 yellows (`--audio-hot` / `--audio-solo`) collapsed to one warn token, and AGENTS.md gained a "Rescope protocol (sliced plans)" section to keep future divergences honest.

### Changed

- **The Console runs at compact density on the 1920×1080 studio monitor (2026-09 audit remediation, Slice 9 — operator decision 6).** The documented minimum live-use resolution overflowed: a `[data-layout-mode="studioFull"]` rule forced the 504 px inspector meant for 2560 onto every studioFull surface from 1920 up, the mixer kept the 2560 strip counts (4 inputs / 6 playback pairs / 3 output lanes of 220 px) in the space that was left, and each tier scrolled sideways inside its own lane grid — invisible to the 1920 test, which only checked that the document did not scroll. Density now follows the operator root width: below 2200 px the Console is compact — 4 inputs, 4 playback pairs and 3 outputs per bank (the other playback pairs are one `]` away), a 380 px inspector, tier columns 1 : 1 : 1.25 and 176 px output lanes; from 2200 px up it is the unchanged 2560 desktop density. The layout mode, the Scaled Studio Preview (which measures its 2560 logical root) and the 2560 renders are untouched. The 1920 test now asserts compact density, 4 / 4 / 3 strips, a 380 px inspector, that neither tier lane grid, the mixer, the inspector nor the workspace scrolls horizontally, and that banking reveals playback 9/10 and returns; the 2560 tests assert desktop density and six playback strips.
- **Fader dB labels follow RME's fader curve (2026-09 audit remediation, Slice 5 — operator decision 3).** The on-screen faders, the typed dB entry, the Stream Deck touch-strip labels and the simulated metering all printed a three-segment prototype law (0.7 = −10 dB, 0.8 = 0 dB) that TotalMix never used, so a fader TotalMix showed at −12.1 dB read "−24.3 dB" in the app and on the deck. Every surface now uses RME's published `faderlin` curve (`CalcFaderDB` / `CalcFaderLin`, "Fader curve" sheet of the 2026-07-21 Global OSC table, live-verified on the studio UFX III): one implementation in `@sse/engine-client` (`audio/faderCurve.ts`) for the app and the fixture transport, mirrored by the engine's `audio/fader_curve.rs` for the deck LCD (`control_surface_audio.rs`) and simulated metering, with anchor tests on both sides pinning the same table. Fader positions are unchanged (`faderlin` is still the app's 0..1 value, so stored state and snapshots recall exactly as before); only the dB the operator reads changed, and unity moved from 0.80 to RME's step 836 of 1023 (≈ 0.817): "Reset to unity", `U`, Shift-click, the unity snap and the fader detents now sit at TotalMix's 0 dB. Typed entry spans −65 dB (off, as in TotalMix) to +6 dB; −60 dB is a real send level now. The Stream Deck bar assets were regenerated with the notch at the new unity (`scripts/deck-assets.py`); operators re-export and re-import the Companion profile to pick them up (checklist B4).
- **Recalling a snapshot now pushes it to the desk (2026-09 audit remediation, Slice 4 — operator decision 2).** Recall used to rewrite the app's own state and leave TotalMix where it was. It now pushes the captured console state over the Global OSC remote in four phases — mutes that turn on, then every value (sends through RME's fader curve, preamp gain, phase, instrument, AutoSet, main solo, output faders), then mutes that turn off, then the main control room's dim and mono — so nothing is loud for a moment it should not be. 48V is never pushed: the recall report lists every channel whose 48V differs between the snapshot and the console (app state keeps the console's value), each with its own armed "Arm 48V" confirm; talkback is momentary and never part of a recall; pad has no console command. Every pushed value is registered on the console link and confirmed by read-back: app state is written first and marked `assumed`, becomes `aligned` (reason `snapshot-push`) once the console has confirmed every value, stays `assumed` and names the parameters when it has not, and follows the console when it reports something else. `audio.snapshot.recall` returns `pushed`, `confirmed`, `adjusted`, `unconfirmed` and `phantomDifferences`; the Console page shows a dismissible "Recalled …" report band with those counts and the 48V buttons. A snapshot without captured state moves only the markers and pushes nothing. In simulated input mode a recall stays app-local and aligned. The default acceptance lane (simulated) expects aligned recalls; the live lane never recalls (that pushes to the real desk — operator checklist B3).
- **Sync is now a real console pull (2026-09 audit remediation, Slice 3 — operator decision 1).** Pressing Sync used to write "aligned" without exchanging a single packet with the desk. It now asks TotalMix for a full dump over the Global OSC remote (`/sendall 2` + `/sendstate`), lets the console link ingest every parameter the app models while the metering thread applies them, waits for the dump to go quiet (measured on the studio UFX III: 3 000–3 500 messages, done 220–270 ms after the request), treats the mix nodes the console omitted as off (the dump lists only nodes above −65 dB), and only then marks the state aligned with reason `console-pull`; the Console page refetches its snapshot instead of painting its own optimistic result. If the desk does not answer within 3 s the sync fails with `AUDIO_SYNC_NO_ECHO` and names the remote and ports to check; a dump still flowing at 3 s fails with `AUDIO_SYNC_INCOMPLETE`; both leave confidence `unknown` and keep whatever arrived. `audio.sync` returns `pulledValues`, `channels`, `mixTargets`, `complete` and `connection`; the summary reads "Pulled N values from TotalMix · x channels · y outputs · z mix nodes". Sync never changes hardware. In simulated input mode there is no console to pull and sync says so.
- **Audio Console Claude Design polish + authoritative-HTML reconciliation (2026-06-04/05, branch `claude/audio-ux-polish`).** On top of the 21-finding audit pass, implemented the operator's Claude Design Console prototype (DP1–DP4): carved/molded faders + unity detents, meters ported into the live 30 Hz canvas (fixed cream→amber→red dBFS zones, cylindrical glass body, mono single-bar), tier-header title-over-meta cards, output-lane routing footers, and an inspector EQ mini-preview + chrome. Then reconciled the build against the authoritative standalone export (rendered headless + diffed region-by-region): added the input `MIC/MONO` identity chip that bridge-aligns the meter tops, thinned the EQ preview frequency axis to the design's 3 interior decades (`100/1K/10K`) while the full EQ tab keeps its dense 1-2-5 axis, and restored channel-strip fill heights (the meter block grows to fill its tier cell via `flex:1 1 240px` + `align-self:stretch` — fills at `2560×1440`, fits at `1920×1080`). Presentation-only; no engine/OSC/store changes. The meter fixed-zone CSS fallback was reverted — a perf guard (`audio.spec.ts` "no clip-path compositor churn") forbids clip-path on the 30 Hz live meters, and the canvas already paints the zones. `dev:check` + full Playwright (audio 38/38) green; the 7 `darwin` audio visual baselines regenerated (the `linux` siblings refresh from the first CI run's `playwright-test-results` artifact).
- **Audio "Console" UX polish pass (2026-06-02) — 21 audit findings closed across 5 front-end-only batches.** A fan-out UX audit (committed at [`docs/archive/audio-ux-audit-2026-06-02.md`](audio-ux-audit-2026-06-02.md)) and an adversarially-verified implementation refined the Console surface. Two shipped defects fixed: the inspector send/fader/action controls referenced five never-defined CSS classes and rendered unstyled (C01), and the monitor bar's "Listen" button silently drove the −20 dB Dim off the same flag (removed — the cluster is now Dim / Mono) (C02). Plus: status severity now reaches the chrome (the top-bar dot + canvas warning band turn `--danger` on faults) (C03); a persistent top-bar SOLO indicator with an `⌥S` clear-all (C04); typed numeric entry on the EQ/Dyn/preamp knobs, with reset relocated to `⌥`-double-click (C05); inspector-tab keyboard accelerators P/E/D/R (C06); the master monitor meter corrected to a view-only live meter that tracks Main Out — C15 (originally master-level keyboard access) was reversed in native operator review, and the live mini-meter wiring the #111 rebuild had dropped was restored; per-theme meter clip/over/peak-hold contrast (C09); Bone-theme AA fixes (C10); a `--control-disabled-opacity` token (C22); active-mix-target echo on the Inputs/Playback tier headers (C17); content-proportional mixer columns (C08); ~44 px of reclaimed vertical budget — collapsed context bar, single-row warning rail, tighter footer (C11); a rebalanced top bar, revealed snapshot actions, and a labeled CLIP pill (C21); unified inspector "engaged" + card vocabulary (C19); and a token/scale normalization that retired the legacy `--audio-*` fork onto the canonical `--bg/--fg/--accent` set (C07) and moved ~75 font literals onto the loaded Inter/JetBrains faces plus shared duration/radius scales and one segmented-control recipe (C20). All changes stay inside the architecture boundary (no device/state/DB logic in React), hold across Studio/Graphite/Bone, and preserve the no-scroll fit at `2560×1440` and `1920×1080`. Validated by `frontend:typecheck` + `lint` + Vitest + the audio Playwright behavior specs; the `darwin` audio visual baselines were regenerated (the `linux` siblings refresh on the first CI run) and `FULL_RENDER_MAX_DIFF_PX` was raised 400→800 to absorb the enlarged meter-sim + Inter-AA jitter surface. Native `2560×1440` operator sign-off pending.
- **Audio page rebuilt as the operator's "Console" surface (supersedes the Phase 3 gold-standard audio UI and the inspector-Overview / preamp-bitmap entries below — those never shipped outside this `[Unreleased]` window).** Rebuilt from a Claude Design prototype: a single warm-amber Studio theme (the Phase 3 warn-yellow / engaged-amber / talkback-green palette is retired, with Graphite/Bone alternates), a top stat bar (Console / OSC / Metering cluster, snapshot pill, theme switch), a single horizontal Inputs → Playback → Outputs mixer, a slim right inspector (hero preamp `AudioKnob`, an all-bands EQ knob grid for Low Cut + 3 PEQ bands, dynamics knobs, routing), and a bottom monitor bar. New reusable SVG-rotary `AudioKnob` plus `AudioStripPreamp`, `AudioTopBar`, and `AudioMonitorBar`; `AudioRail` is retained only as dead code. Operator-density rules still key off the logical operator surface so Scaled Studio Preview matches native `2560×1440`, and the responsive fader region keeps lane cards inside their tier grid at the `1920×1080` fallback. The snapshot deck is a uniform single-row 8-slot grid with a header capture action, amber loaded/armed states, and a per-slot mix-shape thumbnail. The full `frontend:playwright:test` suite (Playwright + `visual-review` + Storybook baselines) is green; the `darwin` audio visual baseline was regenerated (the `linux` sibling refreshes on the first CI run per `frontend/app/tests/__visual__/README.md`).
- Aligned the Tauri shell's bundle identifier from `com.sse.exedstudiocontrol.replatform` to `com.sse.exedstudiocontrol`, matching the locked product identity declared in `AGENTS.md` and `docs/RELEASE.md`. The `.replatform` suffix was a checkpoint marker added during the Qt → Tauri cutover and lost its meaning after Checkpoint D retired the Qt fallback shell. The QtIFW `packageId` (`com.sse.exedstudiocontrol.native`) is unchanged, so the maintenance-tool upgrade path from v2.2.1 to the next release continues to work and operator app-data persistence is preserved (app-data is anchored to a fixed directory name, not the bundle identifier). On macOS, operators may see a fresh Spotlight entry on first launch of the next release because `CFBundleIdentifier` changes; this is a one-time visual cue, not a data migration.
- Required pull-request status checks now cover the `dev-checks` workflow on `main`, while tagged release acceptance remains local and target-host based.
- Routine direct npm dependencies were refreshed to current Node 24-compatible releases, leaving the intentionally deferred `@types/node` 25 major upgrade out of scope.
- Added a repository code of conduct and marked active-looking completed redesign documents as historical/reference material.
- `main` branch protection now enforces restrictions for administrators as well as regular contributors.
- Selected-channel inspector rebuilt as an operator-first Overview: sticky identity/route, meter, Hardware/Software card, send fader, Mute/Solo/Unity above the panel, with stacked full-width EQ and Dynamics previews below and the Source card removed. Output selection now renders an output-specific inspector with no disabled false tabs.
- Audio compact/dense CSS now keys off the operator root, so Scaled Studio Preview emulates the native `2560x1440` studio surface exactly after scaling instead of inheriting host MacBook viewport media queries. Preamp bitmaps preserve their aspect ratio (`640/213` compact, `426/640` inspector).
- `tauri:visual:review` captures Scaled Studio Preview screenshots and records fidelity metrics for Audio fixtures alongside native viewport captures. PR 11 extended the Scaled Studio Preview baseline matrix to `setup-ready`, `lighting-populated`, `planning-populated`, and `audio-populated`, so every operator surface is now regression-tested on the proportional `2560x1440` review canvas — not just Audio. The visual-review summary at `artifacts/visual/tauri-cutover/fixture-viewport-summary.json` now records the full coverage (`fixtures`, `viewports`, `studioPreviewFixtures`, `baselines[]`), and `release:publish` ships it as an optional release asset alongside the chain-of-custody manifest.

### Fixed

- **Arm-then-apply needs a real second press (2026-09 audit remediation, Slice 7).** 48V, snapshot recall and snapshot overwrite arm on the first activation and apply on the second, but the second activation counted no matter how soon it came: a double-click on a 48V pill or a bounced Shift+digit armed and applied in one motion, and four Playwright specs encoded exactly that. A confirming activation now has to come at least 350 ms after the arm (`AUDIO_ARM_MIN_DWELL_MS`); inside the dwell the repeat is ignored and the arm stays with its countdown. Held keys are handled twice over: the Shift+digit recall and Cmd/Ctrl+S save shortcuts ignore auto-repeat events, and the dwell catches whatever gets through. The specs that double-fired now wait out the dwell, and new cases assert that an immediate second click keeps the arm and sends no recall and that a held Shift+3 never applies.
- **Engine unit tests no longer write to the live studio console (2026-09 audit remediation, Slice 2 follow-up).** Several engine tests (front-preamp update, clear-all-solo, the support restore round trip, the Stream Deck audio actions) exercise the real OSC senders with the default transport, 127.0.0.1:7001 → Global slot 7004 — which on the studio workstation is the live TotalMix. Every `cargo test`, `npm run native:test` and `npm run dev:check` run there since the control path became real (2026-08-31) pushed fixture values to the desk: Host preamp phase-inverted in instrument mode with AutoSet and a solo into Main, preamp 12 with 48V, the Main fader at −0.24 dB with dim and mono on, playback 1/2 muted and soloed. `send_osc_messages` now drops, in test builds only, any datagram aimed at a TotalMix remote port (7001–7010) unless `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1`; tests that observe datagrams bind loopback receivers on ephemeral ports and are unaffected, and the commissioning no-traffic probe test targets a dead port instead of 7001.
- **The native acceptance harness no longer writes to the live studio console (2026-09 audit remediation, Slice 2).** Since the control path became real (2026-08-31), `npm run native:acceptance` on the workstation pushed its test values to the actual desk — main volume to −0.24 dB, dim, mono and talkback on, a solo on playback 1/2 into Main, playback 1/2 muted, preamp 12 gain / 48V / phase / instrument / AutoSet — and left them there. The harness now runs the engine in simulated audio input mode by default everywhere (CI and workstation), so nothing reaches a console and the audio probe / sync / recall assertions run against the simulated console without escape flags; `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1` is the explicit workstation-only live lane, which waits for the console link to settle before every baseline and compare, writes only to unused surfaces (Phones 2, playback 7/8), never solos Main, never recalls a snapshot, requires zero unconfirmed sends, and restores what it changed in a `finally`.
- **Console writes are refused until the audio probe passes, and a send never claims the console is aligned (2026-09 audit remediation, Slice 1 — `docs/plans/audit-remediation-2026-09.md`).** The Stream Deck bridge already refused every audio action while the TotalMix link was NOT VERIFIED, but the app's own fader / mute / 48V / solo / EQ / control-room paths sent OSC anyway and then wrote `console_state_confidence = "aligned"`, so an unverified, unconfirmed UDP send was shown as proof that the console matched. `update_audio_channel`, `clear_all_audio_solo`, `update_audio_channel_eq` and `update_audio_mix_target` now pass `ensure_audio_action_allowed` first (a rename is app-local and stays allowed), validate every field before anything goes on the wire (a request mixing a valid mute with an unsupported playback gain is rejected whole, with zero datagrams), and never touch confidence — that is reserved for a completed pull or a confirmed push (Slices 2–4). `audio_capabilities` requires OSC on **and** a passed probe for mixer / processing / sync / recall, so the strips, inspector and top bar disable themselves under an `AUDIO NOT VERIFIED` banner instead of accepting edits the engine would refuse, and the primary action in that state is a new **Run audio probe** button (top bar + warning band) that runs the audio commissioning check; the engine emits `audio.changed { reason: "probe-updated" }` after an audio probe so every consumer re-derives. Refusal copy now tells the operator what to do ("Audio is not verified yet. Run the audio probe before changing console settings."). CI reachability: `probe_audio_transport` passes in simulated input mode (`SSE_AUDIO_SIMULATED_INPUT_MODE=1`, already labelled "test mode" on every audio surface) instead of the acceptance harness forging the check key, and `native-parity-acceptance.mjs` runs the probe before its first console write. Tests: the two `…_succeeds_before_probe_passes` engine tests that pinned the old behaviour are replaced by `…_is_refused_before_probe_passes` twins that watch a loopback receiver on the Global OSC slot for zero datagrams (with a positive control through the same socket), plus name-only rename, validate-before-send, simulated-mode probe, and a Playwright case on `audio-not-verified` asserting disabled controls, no Sync, and the probe button unlocking the console.
- **RME TotalMix metering mapped the wrong strips (or none) because remotes were never pinned to their buses and banks index the visible layout.** A TotalMix OSC remote's active bus is client-driven state — every remote wakes up on the Input bus, and TotalMix's settings dialog cannot pin it — so all three commissioned slots metered the input bus, and the engine's fixed strip tables assumed hardware channel numbers while TotalMix banks actually follow the hardware order of _visible_ strips (hidden channels are skipped; the control-room strips stay in hardware order with Main first even though the GUI draws them at the right edge). The per-slot keepalive now re-selects each remote's commissioned bus plus `/setBankStart 0` every second, and the metering/command strip tables were recommissioned against the studio's tidied layout (verified via the remotes' `/1/trackname{N}` state dumps): input strips 1-4 = front preamps 9-12, playback strips 1-4 = pairs 1/2-7/8, output strip 1 = Main with Phones at 5/6. Surfaces hidden from the tidied layout (line inputs 1-8, playback pairs 9-12) stay app-local instead of erroring. Documented in docs/OPERATIONS.md, along with the classic-OSC limitation that output-bus levels are not streamed (output meters stay dark; output controls still work).
- **RME TotalMix metering died permanently after any engine or TotalMix restart.** TotalMix only transmits OSC data to a remote it considers active, and it deactivates a remote whose port stops answering — so every app restart (ICMP port-unreachable on the receive ports while the engine was down) silently killed the meter stream until the operator happened to re-run the commissioning probe, whose one-shot `/native/probe` nudge was the only activation the engine ever sent. The metering thread now sends a `/native/keepalive` OSC nudge to each commissioned slot's send port every second (and immediately after binding), from the slot's own receive socket, so metering activates on engine start and self-heals after either side restarts.

- Preamp gain is constrained to whole dB at every input path: `AudioKnob` and `AudioNumberDialog` now snap their drag / keyboard / typed value to the control's `step` (the knob previously ignored `step` during the continuous drag), and the inspector hero preamp knob uses `step: 1`. The engine rejects fractional preamp gain ("gain must be an integer"), which the redesigned inspector knob (formerly `step: 0.5`, displaying "35.0") was tripping. Regression-guarded by a new `audio.spec.ts` case.
- Aligned selected product-version surfaces (`frontend/app`, Tauri config, Tauri shell crate, and Rust engine crate) with the root release version and added `release:check` coverage so drift fails fast.
- Shared Qt Installer Framework tool resolution across doctor, release verification, installer generation, and update-repository generation so local `.tools/qt-ifw` installs work consistently.

## [2.2.1] — 2026-04-24

### Fixed

- Tauri shipping runtime now defaults operator app data to a durable platform app-data directory instead of `%TEMP%` / `/tmp` when `SSE_APP_DATA_DIR` is unset, preserving workstation persistence for published installer rollout and keeping explicit runtime-directory overrides available for test and evidence lanes.

### Changed

- Operator workstation rollout runbook now rejects temporary app-data paths during final published-installer verification.

## [2.2.0] — 2026-04-24

### Added

- Selected Tauri 2 + React 19.2 + TypeScript + Vite shell as the shipping release runtime through `scripts/native-release-runtime.json`, while retaining the Qt shell as an explicit fallback runtime.
- Replacement-shell coverage for Setup/Support, Lighting, Audio, and Planning, including live Tauri workspace qualification, fixture-driven visual review at `2560x1440` and `1920x1080`, and Playwright coverage for operator-critical flows.
- QtIFW shipping-path release evidence wrappers for macOS Apple Silicon and Windows 11 `x64`, including host/tool/git/runtime summaries for the switched `native:*` Tauri release lane.
- Windows target-host evidence collection for the post-switch native release path, covering packaged smoke, clean-start smoke, packaged acceptance, bridge verification, installer/update artifacts, continuity, delivery, and real installer acceptance.

### Changed

- The `native:*` release lanes now package the selected Tauri shell beside the bundled Rust engine while preserving the existing product identity, app-data paths, QtIFW package identifier, offline installer posture, and maintenance-tool update repositories.
- The cutover plan, handoff, architecture, development, release, and Windows target-host runbooks now record Checkpoint C evidence status and the retained Qt fallback boundary.
- Lighting intentionally remains scoped to the fixed studio rig without pan/tilt controls; Audio follows the locked `Ar+ - Control-room confidence desk` spec; Planning remains a secondary run-of-show workspace.

### Fixed

- Windows release wrappers now launch nested `npm.cmd` commands through the Windows command shell, avoiding `spawnSync npm.cmd EINVAL` on paths with spaces.
- Windows post-switch evidence validation now allows the evidence collector's own ignored output directory, including Git's collapsed `?? artifacts/native-release/` status, while still rejecting unrelated dirty worktree state.
- Tauri Windows install smoke now resolves the installed shell/engine layout correctly and tolerates platform-specific generated schema drift during evidence collection.

## [2.1.0] — 2026-04-21

### Removed

- Legacy Electron/Next.js runtime and all supporting tooling: `app/`, `electron/`, `lib/`, `__tests__/`, `e2e/`, `public/`, `build/`, `data/`, `instrumentation.ts`, `sentry.*.ts`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `electron-builder.yml`, `playwright*.config.ts`, `vitest.config.ts`, `tsconfig.json`, `.eslintrc.json`, and the `legacy:*` / `electron:*` / Next.js build and test scripts in `package.json`
- Electron / Next.js / React / Sentry / Playwright / Vitest / ESLint / Tailwind / PostCSS devDependencies and dependencies
- Obsolete `parity_regression` GitHub issue template
- `docs/LEGACY_RUNTIME.md`

### Changed

- The native Qt/QML shell plus Rust engine is the only product runtime; no browser-served or Electron-served path remains in the repository
- `docs/HANDOFF.md`, `README.md`, `CONTRIBUTING.md`, `docs/RELEASE.md`, `docs/DEVELOPMENT.md`, `docs/PRODUCTIZATION_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and `docs/DESKTOP_ARCHITECTURE_PLAN.md` rewritten around the native-only product posture; historical parity appendix preserved at `docs/archive/NATIVE_PARITY_HANDOFF.md`
- CI `ci` job reduced to security audit, format check, and release metadata check; CodeQL workflow drops the obsolete `npm run build` step

### Retained

- One-way legacy importer in `native/rust-engine/src/legacy_import.rs` so operators migrating from a pre-`v2.0.0` Electron installation can bring an old `db.json` forward on first native launch

## [2.0.1] — 2026-04-21

### Added

- Native parity acceptance model: deterministic offscreen `2560x1440` captures, real-GPU onscreen spot captures via `npm run native:parity:capture -- --onscreen`, and an install-time first-launch smoke test shipped in the QtIFW installer
- Release-anchor verification script and a repo-native closeout runbook for the remaining Windows, upgrade, and fallback-retirement release work
- Deterministic native evidence set for the `audio-populated`, `lighting-populated`, and `setup-ready` scenes via the engine-backed parity capture mode
- Native screenshot gallery in `README` sourced from the deterministic `2560x1440` evidence set

### Changed

- Native operator parity is signed off on the engineering side; residual hardware-specific regressions are caught by the install-time smoke test on the target workstation instead of a pre-release operator-monitor visit
- Setup commissioning substrate tuned toward the legacy oracle: modal backdrop blur and scrim unified, accent glows raised to match legacy `globals.css`, setup framing and control-surface layout restructured
- Repository compacted around a single engineering handoff plus a detailed parity appendix; stale parity-recovery, migration-board, and closeout documents retired

### Fixed

- Native release acceptance now treats `lighting.snapshot.status` as the source of truth for scene-recall gating, avoiding false CI failures when the commissioning probe reports a transient pass before runtime state is `ready`
- Native Windows installer acceptance now defaults to a repo-local path without `~`, which avoids QtIFW rejecting the install root on real Windows hosts during release validation
- Native QML shell tests now select the configured CMake build configuration when the generator is multi-config, which fixes the Windows CI `ctest` invocation
- Windows CI native shell tests now run against the software scene-graph backend to avoid the D3D11 RHI hang on the GitHub Windows runner (the lane remains diagnostic-only until three consecutive green runs)
- Parity request URLs on the setup control-surface evidence are normalized back to legacy-visible `localhost:3000` values, preventing false divergence in operator-visible request data

## [2.0.1-rc.1] — 2026-04-17

### Added

- Release-anchor verification script and a repo-native closeout runbook for the remaining Windows, upgrade, and fallback-retirement release work

### Fixed

- Native QML shell tests now select the configured CMake build configuration when the generator is multi-config, which fixes the Windows CI `ctest` invocation
- Native Windows installer acceptance now defaults to a repo-local path without `~`, which avoids QtIFW rejecting the install root on real Windows hosts

## [2.0.0] — 2026-04-17

### Added

- Native-first desktop runtime covering planning, lighting, audio, commissioning, support, backup/restore, and Companion export through the Qt/QML shell plus Rust engine
- Offline native installers, maintenance-tool update repositories, per-platform `SHA256` manifests, and release verification gates for packaged smoke, staged delivery, installer acceptance, and continuity
- Native support tooling for runtime paths, diagnostics export, packaged acceptance, and structured installer/update artifact validation

### Changed

- Tagged releases now ship the native macOS and Windows product instead of the legacy Electron desktop path
- The browser/Next.js and Electron runtime are now explicitly treated as archival reference and rollback surfaces, with `legacy:*` commands for intentional use
- Release notes, repo guidance, and operator rollout documentation now describe controlled unsigned workstation deployment as the supported production posture

### Fixed

- Packaged smoke and release-artifact verification now use structured status and checksum validation instead of brittle log scraping
- Native packaging and staging now preserve bundle integrity more reliably and emit cleaner diagnostics during local release verification

## [1.14.0] — 2026-04-14

### Added

- Desktop app About surface with packaged version info, manual update checks, and an operator-facing open-at-login toggle
- Productization planning, release, and operations documentation for packaged installer workflows and clean-machine verification
- Local unsigned Windows packaging command for validating NSIS installer artifacts before code signing is configured

### Changed

- Locked the packaged product identity to `SSE ExEd Studio Control` with the final app identifier `com.sse.exedstudiocontrol`
- Reworked the repo landing page and release guidance around installer downloads, update behavior, and operator expectations
- Closing the main window now warns and then fully quits on both Windows and macOS instead of leaving the app running in the background
- Companion profile exports and setup messaging now use the current product name consistently
- Removed stale repo process artifacts, added a generated-artifact cleanup script, and reduced automation metadata/docs to a smaller durable set

### Fixed

- Windows local packaging no longer fails by trying to run the macOS ad-hoc signing hook during `electron-builder --win`
- Unsigned Windows packaging now produces the expected installer and updater metadata artifacts for local verification

## [1.13.0] — 2026-04-14

### Added

- Fixed-height second-monitor console shell across dashboard, planning, lighting, audio, and setup
- Production-grade studio plot for lighting with operator rail, selection HUD, viewport controls, framing presets, and safer quick actions
- Fireface UFX III console model with front preamps `9-12`, rear line inputs `1-8`, software playback returns, and explicit `Main Out` / `Phones 1` / `Phones 2` mix selection
- Explicit audio console confidence model, live meter trust states, and deliberate sync path for safer TotalMix operation
- Commissioning workspace for setup with a denser Stream Deck+ replica, support rail, and structured wizard frame
- Viewport-fit, spatial, audio-console, and accessibility E2E coverage for the operator surfaces
- Repository governance improvements: hardware profile documentation, CodeQL workflow, issue intake configuration, stronger PR template, and tighter Git ignore / attributes rules
- Changelog-driven release validation and release-note extraction scripts for tag safety and repeatable GitHub releases

### Changed

- Dashboard, planning, lighting, audio, and setup now share a more consistent console design language for panel rhythm, summary cards, toolbar treatment, and status visibility
- The audio workspace now reflects the actual live studio deployment instead of a generic channel CRUD model
- Setup/onboarding now behaves like a fixed commissioning console instead of a document-style page
- README, contributor guidance, and repository-facing documentation now describe the current product and hardware assumptions more accurately
- Standalone startup flow is now aligned with Next.js standalone output, and Playwright uses the same production-style server path
- CI now validates release metadata on every change, and the release workflow gates platform builds behind a single validation job
- Tagged releases can now be rebuilt manually through `workflow_dispatch` without inventing a new version

### Fixed

- Planning lanes are now keyboard-focusable scroll regions
- Audio sliders now have explicit labels and strip selection no longer relies on nested interactive containers
- Accessibility gaps across the shared shell and audio surface that were still failing the full axe suite
- View-state persistence and cross-view shell behavior that could conflict with the new fixed-layout console

## [1.12.0] — 2026-04-12

### Added

- Typed request DTOs for all API endpoints — replaces `Record<string, unknown>` with 20+ domain-specific interfaces (`CreateProjectRequest`, `UpdateLightRequest`, `SendOscRequest`, etc.)
- Generic `RouteContext` type and typed `withErrorHandling<C>` / `withGetHandler<C>` wrappers — eliminates `ctx: any` from all route handlers
- Dashboard decomposition — split 927-line god component (28 `useState`) into 3 focused context providers (`DashboardDataContext`, `KanbanActionsContext`, `DashboardUIContext`) with a thin rendering shell
- Memoized `tasksByProject` Map for O(T) search result counting (was O(P×T) per render)
- Error toasts on silent catches in `ProjectDetailModal` (activity load), `TimeReport` (data fetch)
- 7 new API test files with 144 tests covering deck actions, light control, light groups/scenes, audio channels, project reorder/status, and misc endpoints
- Test coverage raised from 19% to 62% lines (55% branches, 56% functions)

### Changed

- All handlers in context providers wrapped with `useCallback` for stable references
- Coverage thresholds raised to 60% lines/statements, 55% branches/functions

### Fixed

- `as any` casts removed from `electron/main.ts` (5 instances) — proper `ChildProcess` typing and `process.kill(pid, signal)` for cross-type signals
- `as any` cast removed from `AudioFader.tsx` — `writingMode: "vertical-lr"` is valid in modern TypeScript DOM lib
- CCT clamping test used wrong range for astra-bicolor (was 2800–6500, corrected to 3200–5600)

## [1.11.0] — 2026-04-12

### Added

- Hold-to-confirm for destructive live actions — All Off (2s), scene recall (1.5s), snapshot recall (1.5s) via new `HoldButton` component
- Operator readability mode — S/M/L UI scale toggle persisted in localStorage
- Unified SSE/DMX/OSC health strip in persistent header, visible from all views
- Sticky Kanban FilterBar with search result counts
- Named step indicator in Setup Wizard (replaces dot navigation), closeable with skip confirmation

### Fixed

- Modal Escape key bypassing dirty-state protection — Escape now routes through each modal's `onClose` handler
- Theme token consistency on error/404 pages
- Focus-within and touch fallbacks on hover-only action buttons

## [1.10.0] — 2026-04-12

### Added

- WCAG 2.0 AA accessibility overhaul across all views (Kanban, Lighting, Audio, Setup)
- Form accessibility — all `<label>` elements bound with `htmlFor`/`id` across 10 form files
- Toggle semantics — `aria-pressed`, `role="switch"`, `role="tablist"`/`role="tab"` on interactive controls
- Keyboard and touch accessibility — edit/delete actions visible on `focus-within` and touch devices
- Visible status filter chip row in FilterBar with `aria-keyshortcuts`
- `activeText` prop on `AudioToggleButton` for WCAG-passing dark-background combos
- `scripts/audit-contrast.ts` dev tool for verifying contrast ratios
- Extended accessibility E2E tests covering audio view, setup page, and modal state

### Changed

- Lifted `studio-500` and `studio-400` palette tokens to pass AA 4.5:1 contrast on all backgrounds
- Replaced all `gray-*`/`blue-*`/`green-*` tokens in Setup pages with `studio-*`/`accent-*`
- Bumped 51 of 52 `text-micro` (9px) usages to `text-xxs` (10px) for functional text

### Fixed

- Re-enabled axe color-contrast checks (previously disabled) on all page-level specs

## [1.9.0] — 2026-04-10

### Added

- Audio mixer view — controls RME Fireface UFX III via OSC through TotalMix FX
- `lib/osc.ts` — OSC communication layer with auto-recovery (mirrors DMX singleton pattern)
- 13 API routes under `/api/audio` for channels, snapshots, settings, and metering
- 8 audio UI components (mixer console layout with vertical channel strips)
- 3 custom hooks (`useOscPolling`, `useAudioControls`, `useMeterPolling`)
- Stream Deck+ page 4 with gain dials, mute/phantom buttons, snapshot recall
- Configurable audio channels with full preamp control (gain, fader, mute, solo, phantom 48V, phase, pad, lo-cut)
- Schema v7 with full migration backfill for existing databases

## [1.8.0] — 2026-04-09

### Added

- Top-level `AppErrorBoundary` — full-screen crash fallback wrapping the entire app (no more white screens)
- Initial load failure retry UI with exponential backoff (1s/2s/4s, max 5 attempts)
- Extended SSE disconnect notification — persistent toast after 15s, "Connection restored" on reconnect
- DMX send failure user feedback — throttled error toast in lighting view
- Rotation, marker position, and grand master save error toasts
- DMX address overlap detection — prevents two lights from sharing channels
- DMX address range validation — rejects out-of-range addresses with clear error messages
- Light type validation — rejects unknown types instead of silently defaulting
- Light name length limit (50 chars) enforced server-side and client-side
- `DiskFullError` class with 507 HTTP status for disk-full conditions
- Backup health tracking — failure counter and `getBackupHealth()` export
- SSE `db-error` event — database read failures send error events instead of disconnecting
- Activity log HTML sanitization on detail field
- Effect loop auto-pause after 3 consecutive DMX failures, auto-resume on recovery
- DMX auto-reinit rate-limit logging and `isDmxRecoveryExhausted()` getter
- Backup recovery loop capped at 20 files to prevent runaway scans
- CORS hardening — all routes use origin-validated `getCorsHeaders(req)` restricting to localhost (replaces wildcard `Access-Control-Allow-Origin: *`)
- `eslint-plugin-security` for static analysis of unsafe patterns
- Vitest coverage thresholds enforced in CI
- Stale issue/PR automation (`.github/workflows/stale.yml`)
- Accessibility E2E tests via `@axe-core/playwright`
- Repository metadata — `SECURITY.md`, `CODEOWNERS`, `.editorconfig`, CI badge, `package.json` fields

### Fixed

- `TypeError` no longer misclassified as 400 Bad Request — real app bugs now correctly return 500
- Electron server startup timeout increased from 15s to 30s with progressive splash messages
- Electron DMX shutdown timeout increased from 2s to 5s with timeout warning
- Electron splash screen status uses `JSON.stringify()` to prevent code injection via special characters
- ErrorBoundary `onRetry` prop — inline "Reload" refetches data instead of just clearing error state
- ESLint warnings resolved: missing `useCallback` deps, `<img>` replaced with Next.js `<Image>`

## [1.4.0] — 2026-03-24

### Added

- HSI canvas-based circular hue wheel (`HueWheel.tsx`) for RGB-capable lights
- Grand Master fader — global intensity multiplier (0–100%) in toolbar, applied to all dimmer channels in real time
- Light groups — organize lights into named groups (Key, Fill, etc.) with collapsible headers, count badges, and group-level ON/PARTIAL/OFF power toggle
- Compact/expanded view toggle — single-row compact mode per light (persisted in localStorage)
- Effects engine — per-light Pulse (sine wave), Strobe (hard toggle), and Candle (layered flicker) effects running server-side at 30fps with speed control (1–10)
- Scene fade recall — configurable fade duration (Instant/1s/2s/3s/5s) with server-side ease-in-out interpolation
- DMX Output Monitor — toggleable sidebar panel showing real-time channel values grouped by fixture with bar visualization (polls every 500ms)
- Visual scene cards with color swatch strips and click-to-rename
- API endpoints: `/api/lights/groups`, `/api/lights/groups/[id]`, `/api/lights/[id]/effect`, `/api/lights/dmx-monitor`

## [1.3.0] — 2026-03-24

### Added

- Auto-init DMX on Lighting view open — sACN sender initializes and syncs all fixture states automatically; no manual setup step required
- Light delete button with confirmation dialog on each `LightCard`
- Simplified bridge status indicator in toolbar (green/red dot)

## [1.2.0] — 2026-03-23

### Added

- Aputure Infinimat 2×4 support — 4-channel DMX Profile 2 (intensity, CCT, ±green/magenta tint, strobe; CCT 2000–10000K)
- GM tint control — per-light green/magenta correction slider (−100 to +100) for the Infinimat
- `gmTintToDmx()` — maps null/0 to DMX 0 ("No Effect") per fixture spec

### Fixed

- sACN `useRawDmxValues: true` — values above ~100 were being multiplied by 2.55 internally, causing sliders to max out at center position

## [1.1.0] — 2026-03-23

### Added

- Aputure Infinibar PB12 support — 8-channel DMX Mode 1 (intensity, CCT, color mix, R/G/B, effect, speed; CCT 2000–10000K, RGB-capable)
- Light type registry (`lib/light-types.ts`) — single source of truth for per-fixture DMX specs
- RGB color mode — per-channel R/G/B sliders (0–255) for RGB-capable fixtures
- CCT/RGB mode toggle on RGB-capable lights; `colorMode` field on `Light`
- Stream Deck+ dial support — 4 rotary encoders mapped to light parameters via `/api/deck/dial`

## [1.0.1] — 2026-03-20

### Fixed

- TypeScript error TS2339 in Electron build — `mainWindow` type narrowing after `createWindow()`

## [1.0.0] — 2026-03-20

### Added

- Setup Wizard replacing `WelcomeModal` — multi-step first-run onboarding (4 steps PM-only, 9 steps PM+Lighting)
- CRMX pairing guide with tabbed instructions per fixture type
- DMX address assignment step with overlap detection
- `hasCompletedSetup` setting; `POST /api/seed` accepts `{ preserveLights: true }`
- Per-test E2E DB isolation via `POST /api/backup/restore` fixture

## [0.10.0] — 2026-03-20

### Added

- `withErrorHandling()` / `withGetHandler()` wrappers — all 40+ routes covered; unhandled throws can no longer crash the server
- Global `uncaughtException` / `unhandledRejection` handlers in `lib/process-safety.ts`
- `writeDB()` atomic writes via `.tmp` + `rename`; `ENOSPC` detection and logging
- Corruption recovery in `readDB()` — scans backups, falls back to `DEFAULT_DB`
- Auto-backups every 30 min via `maybeAutoBackup()` (keeps 10 rolling backups)
- SSE keepalive ping (30s) and exponential backoff reconnect (1s → 10s cap)
- Electron: auto-restart on server crash (max 3/min), sleep/wake DMX handling, unresponsive window dialog
- Security headers: CSP (dev/prod split), `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`
- CORS validation via `getCorsHeaders(req)` (restricts to localhost)
- `ErrorBoundary` around `KanbanBoard` and `LightingView`
- Apollo Bridge TCP reachability probe and per-light "No Signal" badges
- Timer crash recovery in `migrateDB()`

## [0.9.0] — 2026-03-20

### Added

- Automated testing: Vitest (unit/API) + Playwright (E2E) with per-test DB isolation
- ESLint (Next.js rules), Prettier, Husky + lint-staged pre-commit hooks
- CI pipeline: lint, format check, build, unit tests, E2E tests on push/PR to `main`
- Fast Electron dev workflow (`electron:dev:open`)
- Apollo Bridge reachability detection (TCP probe, per-light status dots)

## [0.7.0] — 2026-03-19

### Fixed

- NaN guard on timer `lastStarted` — malformed dates produce 0 elapsed rather than corrupting `totalSeconds`
- `mutateDB()` promise chain survives write errors; callers still receive the error
- DMX sender auto-recovery on send failure (capped at 3 reinit attempts/minute)
- SSE route cleanup is idempotent; no interval leak on disconnect

## [0.6.0] — 2026-03-19

### Added

- Accessible modals — shared `<Modal>` wrapper with focus trapping, `role="dialog"`, `aria-modal`, auto-focus, focus restoration
- `isDirty` tracking on form modals with discard confirmation
- Toast notifications with stacking limit, error-specific timeouts, and accessibility
- SSE exponential backoff reconnect
- Electron window state persistence (size, position, maximized)

## [0.5.0] — 2026-03-19

### Added

- Studio lighting control via sACN/E1.31 through Litepanels Apollo Bridge
- `lib/dmx.ts` — singleton sACN Sender on `globalThis`, in-memory `dmxLiveState`, throttled sends
- Per-light intensity and CCT sliders with real-time DMX output
- Light scenes — save and recall presets across all lights
- Stream Deck+ Lights page with all-on/off and scene recall actions
- `/api/lights/*` route family

## [0.4.0] — 2026-03-19

### Added

- Windows support — NSIS installer, system tray (hide-to-tray on close, Quit from tray)
- CI/CD — GitHub Actions release workflow builds macOS DMG + Windows NSIS installer on `v*` tags

## [0.3.0] — 2026-03-19

### Added

- Stream Deck+ LCD strip feedback — Companion polls `/api/deck/lcd` for real-time display data

## [0.2.0] — 2026-03-19

### Added

- Stream Deck+ 2-page layout (Projects + Tasks), task selection via dials
- Dashboard project highlighting for selected project
- `electron-builder` switched to `utilityProcess` for reliable server spawning

## [0.1.0] — 2026-03-19

### Added

- Electron desktop app for macOS (arm64 DMG) with splash screen and window state persistence
- Stream Deck+ context-aware action API (`/api/deck/action`, `/api/deck/select`)
- Bitfocus Companion config export endpoint (`/api/companion-config`)
