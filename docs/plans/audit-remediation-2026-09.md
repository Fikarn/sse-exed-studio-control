# Audit remediation 2026-09

Status: approved by the operator 2026-09-03; in execution on branch `audit-remediation-2026-09` (cut from `studio-bringup-sacn-globalosc`, which must land first).

Tracking: the per-slice `Status:` lines below are the authoritative execution record. Each slice lands as its own commit `Audit S<N>: <what landed>` (baseline refreshes as `Audit S<N> (baselines): …`); any divergence from a slice's written scope gets a bold `**Rescope:**` paragraph under that slice per the AGENTS.md rescope protocol — no silent substitution. Every slice records three things before it closes: what the existing gates asserted before the change, the tests added that would have caught the original finding, and every test that had to change (old assertion → new assertion → reason).

Goal: make the audio console tell the operator the truth about the RME desk (Sync pulls real console state, Recall reaches the console, the engine reads console state back, fader dB matches TotalMix), make live controls behave as labelled (momentary talkback, arm-then-apply with a dwell), fit the documented 1920×1080 minimum, implement the documented close confirmation, fix the Bone header and the audio legibility floor, gate Publish on probes, and stop trusting gates that do not test the behaviour they are named for. Source: the 2026-09-02 program audit (`../../studio-control-audit-2026-09-02.html` next to the repo).

## Locked decisions (operator, 2026-09-03)

1. Sync = pull (`/sendall` 2.0 + `/sendstate` 1.0 → ingest → aligned). Never changes hardware.
2. Recall = push everything except 48V (mutes-on, values, mutes-off, dim/mono). 48V differences are listed; each needs its own armed confirm.
3. Fader curve = RME's published `faderlin` curve in the app. Positions stay 1:1; labels become true; unity 0.80 → 836/1023.
4. Talkback = momentary only (hold button or `T`; release on pointerup/pointercancel/keyup/blur/hidden; engine watchdog 2 s). No latch.
5. Gating = match the deck: audio status ≠ `ready` refuses hardware-facing edits engine-side and disables them in the UI, with "Run audio probe".
6. 1920×1080 = compact density below 2200 px logical width (4 inputs / 4 playback banked / 3 outputs, inspector 380 px), guarded by a no-horizontal-overflow test.
7. Publish gate = refuse unless all probes passed, unless `overrideProbes: true`; the UI confirm names the failing probes.
8. Extras: Windows key glyphs, operator copy cleanup, DMX decimal values, confirm before "Load sample planning", commit the win32 visual baselines.
9. Also: arm-then-apply minimum dwell, close confirmation, validate-before-send, never write `aligned` after an unconfirmed send.

Routine calls: talkback released from any surface releases everywhere; a graceful engine stop releases an active hold (a hard kill cannot — documented); the lighting Cut-all dialog names the preview buffer while preview is active.

## Gate honesty — what the green lanes proved before this plan

- CI never invoked `audio.sync` or `audio.snapshot.recall` (`SSE_NATIVE_ACCEPTANCE_SKIP_AUDIO_SYNC=1`; `scripts/native-parity-acceptance.mjs:802-840`); the audio probe's result was asserted only by type.
- The deck audio path was verified on CI through its 409 refusal only (`scripts/native-control-surface-qualification.mjs:389-407`).
- `audio/tests.rs:564,593` forged `app.commissioning.check.audio.status=passed` and asserted a confidence string; no `audio::`-layer test observed a UDP datagram.
- `audio_channel_update_succeeds_before_probe_passes` and `audio_mix_target_update_succeeds_before_probe_passes` asserted `aligned` after an unverified, unconfirmed send.
- Playwright audio specs run on a fixture transport whose probe always passes; talkback coverage was one attribute-presence assertion; four specs double-activated arm-then-apply immediately and expected the apply.
- `expectNoDocumentScroll` reads only the document, so per-tier horizontal scroll at 1920 was invisible; `audio-file-structure.spec.ts` asserts files exist.
- Publish was asserted as "planning becomes visible"; `scripts/native-acceptance.mjs` and `scripts/tauri-setup-support-qualification.mjs` published with zero probes.
- The 75 win32 visual baselines were untracked, so the local visual gate compared against whatever was last generated.

**Rescope:** none yet. A slice whose premise changes on inspection gets its own `**Rescope:**` paragraph under its heading and a renamed title that matches what landed.

## Slice 0 — Branch, ledger, win32 baselines

Status: complete (2026-09-03). Branch cut from `d9cbd94`; ledger added; the 75 untracked `*-win32.png` baselines were verified against the current tree before being tracked; AGENTS.md now lists win32 as a committed baseline platform.

Scope: cut `audit-remediation-2026-09`; add this ledger; prove the 75 untracked `*-win32.png` baselines match the current tree (build + storybook + `visual-review.spec.ts` + `storybook.spec.ts`, no snapshot update), then track them; AGENTS.md lists win32 as a committed baseline platform.
Gates before: the local visual gate was not real (untracked baselines).
Tests added: none. Tests changed: none.
Validation: `npm run build --workspace frontend/app && npm run frontend:storybook:build && cd frontend/app && npm exec playwright test visual-review.spec.ts storybook.spec.ts` → 77 passed (29.3 s), zero snapshot writes, so the tracked files are exact captures of this tree.
Baselines: committed (win32: 52 visual-review + 23 storybook). Operator hands: none.

## Slice 1 — Gating unification, validate-before-send, CI reachability

Status: landed 2026-09-03 (operator verification pending — checklist B6). Commit `Audit S1`.

Scope: `update_audio_channel` / `clear_all_audio_solo` / `update_audio_channel_eq` / `update_audio_mix_target` gate first (`ensure_audio_action_allowed`, hardware fields only; renames stay allowed), validate before sending, stop writing confidence; `audio_capabilities` requires `status == "ready"` for mixer/processing/sync; "Run audio probe" in the audio top bar and `audio.changed { reason: "probe-updated" }` after an audio probe; trust-state banners outrank the solo band; operator copy for refusals; `probe_audio_transport` passes in simulated input mode and the `rust` CI job sets `SSE_AUDIO_SIMULATED_INPUT_MODE=1` so acceptance reaches `ready` honestly.
Gates before: `tests.rs:806/:905` asserted success + `aligned` while NOT VERIFIED; nothing asserted zero datagrams on refusal.
Tests added:

- Rust `audio::tests`: `audio_channel_update_is_refused_before_probe_passes` and `audio_mix_target_update_is_refused_before_probe_passes` (loopback receiver bound on the Global OSC slot `send_port + 3`; `AUDIO_NOT_VERIFIED`, state unchanged, confidence `unknown`, **zero datagrams**; then a positive control through the same socket once the probe key is set, so the "nothing was sent" assertion is proven live); `audio_channel_name_only_update_is_allowed_before_probe_passes`; `audio_channel_update_validates_before_sending` (playback `gain` + valid `mute` in one request → `AUDIO_CHANNEL_FIELD_UNSUPPORTED`, zero datagrams, the mute did not half-apply; positive control). `commissioning::tests::audio_probe_passes_in_simulated_input_mode` (setting-driven simulated mode → probe `passed`, audio snapshot `ready`, `can_edit_mixer_state` / `can_sync` true).
- Playwright `audio.spec.ts` ("audio not verified" case): full `AUDIO NOT VERIFIED` band, no Sync button, `audio-topbar-probe` present, FX 3/4 send slider `aria-disabled="true"`, "Mute Host" disabled; clicking the band's "Run audio probe" removes the band, restores Sync and re-enables both controls.

Tests changed (old → new → why):

- `audio_channel_update_succeeds_before_probe_passes` → `audio_channel_update_is_refused_before_probe_passes`: success + `aligned` while NOT VERIFIED → refusal, no state change, no I/O. Decision 5; the old test pinned the finding.
- `audio_mix_target_update_succeeds_before_probe_passes` → `audio_mix_target_update_is_refused_before_probe_passes`: same.
- `audio_channel_update_persists_front_preamp_controls`: final `console_state_confidence == "aligned"` → `"unknown"`. An edit is a UDP send, not a confirmation.
- `clear_all_audio_solo_returns_full_snapshot_and_is_idempotent`: ran with no probe state → now sets the passed key (solo is a console write); `aligned` → `unknown`.
- `support::tests::restore_support_backup_round_trips_native_archive`: sets the passed key before its audio mutations (they are gated now); the restore rolls it back with everything else.
- `audio.spec.ts` not-verified case: status dot + Sync enabled + refusal toast after click → disabled controls + probe button (the old assertions encoded the finding).
- `scripts/native-parity-acceptance.mjs`: the audio probe now runs **before** the first console write and must pass (the bind-denied escape is gone — the gate would refuse the writes anyway, so the harness stops with the probe's reason); under `SSE_NATIVE_ACCEPTANCE_SKIP_AUDIO_SYNC=1` the post-mutation expectation moved from `consoleStateConfidence === "aligned"` to `"unknown"` (the old value was the finding).

Validation (workstation, 2026-09-03): `cargo test -p studio-control-engine` → 241 passed, 0 failed (238 before: +5 added, −2 replaced); `cargo fmt --all` + `npm run rust:clippy` clean; `npm run frontend:typecheck` clean; `npm run frontend:test` → 44 + 119 passed; `npx playwright test audio.spec.ts` → 39 passed; `npx playwright test visual-review.spec.ts storybook.spec.ts` → 77 passed after the two baseline refreshes below; `npm run native:acceptance` (plain, live TotalMix FX running) → "Native acceptance passed: import, restart, and rollback are deterministic." with the audio probe passing live and sync/recall asserted; CI shape `SSE_AUDIO_SIMULATED_INPUT_MODE=1 SSE_NATIVE_ACCEPTANCE_SKIP_AUDIO_SYNC=1 npm run native:acceptance` → passed (probe message "Simulated audio input mode: the audio probe passes without TotalMix (test mode)…", console writes accepted, confidence stays `unknown`); a first CI-shape run failed on the old `aligned` expectation, which is the harness change recorded above; `npm run dev:check` → passed end to end (format, lint, script tests, file health, rustfmt, clippy, protocol, typecheck, Vitest, native check, native test — 241 engine tests) after a prettier pass over four touched files.

Baselines: win32 `audio-not-verified-2560x1440` (full NOT VERIFIED band with "Run audio probe" + Setup, probe button in the top bar, strips/inspector locked) and `audio-offline-2560x1440` (CONSOLE UNREACHABLE band now offers the probe instead of a Sync that would be refused; strips locked). Both captures inspected. linux refresh after Slice 12, darwin pending a macOS host.

Notes: the `rust` CI job sets `SSE_AUDIO_SIMULATED_INPUT_MODE=1` on the `native:acceptance` **step only** — `native:test` contains `audio_probe_fails_without_live_rme_meter_packets`, which must keep running unsimulated. `tauri-workspace-qualification.mjs` already probes before its audio writes and skips that block on CI, so it needed no change. The banner order in `AudioSignalCanvas` already put trust-state bands above the solo band; no change was needed for that scope item.

Operator hands: checklist B6 — reset the audio probe, confirm every fader / mute / 48V / EQ control is disabled with the reason and "Run audio probe", run it, confirm the controls return.

## Slice 2 — Console link: echo ingestion, confirmation tracking, honest confidence

Status: planned.

Scope: new `rme_console_link.rs` (parse every Global OSC control/status message; pending-send confirmation with tolerances; Confirmed / Adjusted / External / Status classification; `CONFIRM_TIMEOUT` 1.5 s), `audio/console_link.rs` (apply echoes to `channels_state` / `mix_targets_state` under a new `AUDIO_STATE_LOCK`, 100 ms coalesced flush, `audio.changed { reason: "console-echo" }`), single confidence writer `write_confidence` (`aligned` only after a complete pull or a fully confirmed push; `assumed` on push start or expiry; `unknown` on transport change / disconnect / unbound slot), `AudioConsoleLinkSnapshot` on `AudioSnapshot.consoleLink`, `#[serde(default)]` on stored state structs, `engine_events.rs`, `/status/connection` → CONSOLE UNREACHABLE.
Gates before: only `/level/*` parsed; `global_osc_ignores_unmapped_channels_and_status_traffic` pinned that control echoes are dropped.
Tests added / changed: per the plan (listed at landing). Validation: (filled at landing). Baselines: none. Operator hands: live echo check (fader, mute, 48V, dim from TotalMix appear in the app; `pendingSends` drains after an app edit). Contingency: `CONFIRM_VIA_SENDCHAN` if TotalMix does not echo to the originating remote.

## Slice 3 — Sync = pull

Status: planned.

Scope: `RmeTotalMixOscBackend::sync_console` pulls (`AUDIO_GLOBAL_OSC_UNBOUND`, `/sendall` 2.0 + `/sendstate` 1.0, dump-complete detection, absent mix nodes → 0.0, `aligned` with reason `console-pull`; `AUDIO_SYNC_NO_ECHO` / `AUDIO_SYNC_INCOMPLETE` → `unknown`); `refresh_global_slot` sends floats; store refetches after sync; operator copy.
Gates before: `tests.rs:564` forged the probe key and asserted `aligned` with no I/O.
Tests added: fake-TotalMix dump tests, no-echo refusal, hardware-lane round trip, engine-client store Vitest. Tests changed: the forged sync test replaced; `refresh_global_slot_sends_sendall_and_sendstate_to_the_slot_port` asserts floats.
Validation: (filled at landing). Baselines: none. Operator hands: checklist B2.

## Slice 4 — Recall = push, 48V listed

Status: planned.

Scope: phased replay (mutes-on, values, mutes-off, dim/mono) via `send_totalmix_recall_plan` with pacing; never `48v`/`talkback`/`pad`; `phantomDifferences` returned and current 48V state kept; `assumed` until the plan's pending set drains (`aligned`, reason `snapshot-push`); UI follow-up band with per-channel "Arm 48V" through the existing arm flow.
Gates before: `tests.rs:593` asserted `assumed` + bookkeeping; backend summary said recall is app-local.
Tests added: wire-order + never-48V loopback test, unconfirmed listing, echo-confirmed → aligned, Playwright band. Tests changed: `audio_snapshot_recall_marks_last_recalled_snapshot` (asserts `unconfirmed`); parity acceptance recall expectations.
Validation: (filled at landing). Baselines: none. Operator hands: checklist B3.

## Slice 5 — RME fader curve everywhere

Status: planned.

Scope: `audio/fader_curve.rs` + `audioFormatting.ts` + `fixtureTransport.ts` on RME's `CalcFaderDB`/`CalcFaderLin`; `AUDIO_FADER_UNITY = 836/1023`; notch CSS from a variable; deck bar assets regenerated (`scripts/deck-assets.py`); Companion profile re-export.
Gates before: `audioFormatting.test.ts` and `audio_fader_db_label_mirrors_the_app_curve` pinned the wrong curve.
Tests added: RME anchor tables both sides, round trips, deck label parity. Tests changed: the two curve tests and the Playwright dB assertions that hard-coded 0.8 (they encoded the wrong curve).
Validation: (filled at landing). Baselines: all audio sizes + audio stories (win32 now, linux after Slice 12). Operator hands: checklist B4 + Companion re-import.

## Slice 6 — Talkback momentary, shared watchdog, `audio.talkback.hold`

Status: planned.

Scope: `audio/talkback.rs` (watchdog moved from the deck module, testable expiry); `update_audio_mix_target` arms/clears on any `talkback` write; new IPC method `audio.talkback.hold`; deck delegates; frontend `useMomentaryTalkback` (pointer hold, heartbeat 750 ms, `T` keydown/keyup, blur/hidden/unmount release), caption "Hold · T", no toggle path left.
Gates before: one attribute-presence assertion; watchdog expiry untested.
Tests added: watchdog deadline, arming on mix-target write, heartbeat re-arm, hook Vitest, Playwright hold/release/blur/no-latch. Tests changed: `audio-hierarchy.spec.ts:49-53` extended to hold semantics.
Validation: (filled at landing). Baselines: audio (caption). Operator hands: checklist B5.

## Slice 7 — Arm-then-apply minimum dwell

Status: planned.

Scope: `AUDIO_ARM_MIN_DWELL_MS = 350`; same-key activation inside the dwell keeps the arm; key repeat ignored.
Gates before: four specs double-activated immediately and expected the apply.
Tests added: immediate second click keeps the arm and issues no recall; key repeat ignored; constant pinned. Tests changed: `audio-arm-countdown.spec.ts:39-44`, `audio.spec.ts:202-204, :947-948, ~:1353` wait ≥ 400 ms between activations (the immediate double-fire was the defect).
Validation: (filled at landing). Baselines: none. Operator hands: none.

## Slice 8 — Publish gate with explicit override

Status: planned.

Scope: engine refuses `stage: ready` while any probe is not `passed` (`COMMISSIONING_PROBES_INCOMPLETE`) unless `overrideProbes: true` (recorded); `runAllProbes` reports failures honestly and stops advancing; Publish confirm names failing probes; fixture transport can fail probes; automation scripts carry the override explicitly.
Gates before: publish asserted as "planning visible"; two scripts published with zero probes.
Tests added: engine refusal/override tests; Playwright failing-probe → dialog → cancel/confirm. Tests changed: none expected.
Validation: (filled at landing). Baselines: none. Operator hands: none.

## Slice 9 — 1920×1080 compact density + overflow test

Status: planned.

Scope: audio density from `bodyWidth < 2200`; view-model table desktop 4/6/12, compact 4/4/8; remove the `[data-layout-mode="studioFull"]` 504 px inspector override that out-specified the 380 px container rule; compact tier columns and 176 px output lanes; `expectNoHorizontalOverflow` helper.
Gates before: the 1920 test checked visibility, document scroll and vertical containment only.
Tests added: lane-grid/inspector/workspace no-overflow at 1920, 4/4/3 strips, inspector 380 ± 1, banking, compact view-model Vitest, desktop assertions at 2560. Tests changed: none.
Validation: (filled at landing). Baselines: audio 1280–1920. Operator hands: checklist B7.

## Slice 10 — Bone header, microtype floor, legibility spec

Status: planned.

Scope: `--color-shell-header-bottom` token per theme; audio microtype ≥ 9.5 px via `--audio-type-micro`; text never painted `--fg-4`; Studio/Graphite `--audio-caption-muted` → `--fg-3` raised to 0.56; DS HealthBar caption literal → token; `audio-legibility.spec.ts` (font floor, contrast ≥ 3:1, nav labels ≥ 4.5:1 per theme); CSS literal scan.
Gates before: per-theme baselines pinned the broken render; no contrast or font-floor test.
Tests added / changed: per the plan. Validation: (filled at landing). Baselines: bone 2560 all fixtures, all audio sizes, footer everywhere. Operator hands: eyeball on the studio monitor.

## Slice 11 — Close confirmation + graceful engine stop

Status: planned.

Scope: `CloseRequested` → `prevent_close` + `shell://close-requested` unless confirmed or `SSE_SHELL_SKIP_CLOSE_CONFIRM=1`; `shell_confirm_close` (flag, graceful `EngineBridge::stop`, destroy); frontend listener → unsaved-scene guard → `ShellDialog`; fixture hook for Playwright.
Gates before: nothing; automation kills the process or uses `--smoke-test`.
Tests added: close-policy unit test; `shell.spec.ts` dialog. Native close path is operator-verified and not CI-covered.
Validation: (filled at landing). Baselines: none. Operator hands: checklist B8.

## Slice 12 — Extras: key glyphs, operator copy, DMX decimal, seed confirm

Status: planned.

Scope: `shortcutGlyphs.ts` + 13 render sites; Cut-all dialog names the preview; developer-worded engine/frontend messages rewritten; DMX monitor decimal 0–255; confirm before "Load sample planning".
Gates before: none for glyphs/copy; DMX hex untested; seed unconfirmed.
Tests added: glyph formatter Vitest + kbd assertion; DMX cell value; seed confirm flow. Tests changed: lighting/setup specs touched by the new dialogs.
Validation: (filled at landing). Baselines: health-bar kbd text, shell stories (linux/win32). Operator hands: none.

## Slice 13 — Docs, CHANGELOG, final lanes, operator sign-off

Status: planned.

Scope: OPERATIONS / HARDWARE_PROFILE / DEVELOPMENT / HANDOFF / AGENTS updates; CHANGELOG `[Unreleased]` bullets verified; final lanes (`dev:check`, `frontend:playwright:test`, `native:acceptance` without the skip flag, `native:test:hardware`, `native:bridge:win:verify`, `tauri:build` → `native:package:win:local` → smokes); Appendix B signed by the operator; every slice closed `complete (date)`.

## Appendix A — Gate honesty map (finding → guard after this plan)

| Finding                                        | Guard                                                                                                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sync marked aligned with no I/O                | `audio_sync_without_console_echo_is_refused_and_stays_unknown`, `console_pull_ingests_a_fake_totalmix_dump`, `#[ignore] live_totalmix_pull_round_trip` |
| Recall app-local                               | `recall_pushes_console_state_in_mute_first_order_and_never_48v`, acceptance recall assertions, Playwright 48V band                                     |
| No console read-back                           | console-link ingest tests; operator check B2                                                                                                           |
| `aligned` written by edits / unconfirmed sends | `expired_sends_downgrade_confidence_to_assumed`; rewritten edit tests; source-scan test limiting `"aligned"` writers                                   |
| Send before validate                           | `audio_channel_update_validates_before_sending` (zero datagrams)                                                                                       |
| App edits allowed while NOT VERIFIED           | `…_is_refused_before_probe_passes` ×2; Playwright disabled-controls test                                                                               |
| CI reached `ready` by forging/skipping         | simulated-mode probe + `SSE_AUDIO_SIMULATED_INPUT_MODE` in the `rust` job                                                                              |
| Fader dB ≠ TotalMix                            | anchor tables both sides; deck label test                                                                                                              |
| Talkback latch                                 | watchdog deadline test; Playwright hold/release/blur                                                                                                   |
| Arm double-fire                                | immediate-second-click-ignored test                                                                                                                    |
| 1920 overflow                                  | `expectNoHorizontalOverflow` at 1920 + baseline                                                                                                        |
| Publish without probes                         | engine refusal test; setup dialog test; scripts carry `overrideProbes`                                                                                 |
| Close without confirm                          | policy unit test; `shell.spec.ts` dialog; operator check B8                                                                                            |
| Bone header literal / microtype                | `audio-legibility.spec.ts`; CSS literal scan                                                                                                           |
| Mac glyphs on Windows                          | glyph Vitest; kbd assertion                                                                                                                            |
| Untracked win32 baselines                      | committed in Slice 0                                                                                                                                   |

## Appendix B — Operator hardware checklist

1. TotalMix remote 4 (Global OSC, in 7004 / out 9004): "Send changes" on, "Follow Submix" off, remote active.
2. After Slice 3: move a fader and toggle a mute in TotalMix → app follows within ~1 s; press Sync → toast reports the value count, badge aligned, nothing moved in TotalMix.
3. After Slice 4: capture a snapshot, change a fader, a mute and 48V on Host in TotalMix, recall → fader and mute return in order, 48V does not, the band names Host, arming from the band flips it.
4. After Slice 5: TotalMix fader at 0 dB → app 0.0 dB at the notch; −6 dB → app −6.0; deck LCD the same; Companion profile re-imported.
5. After Slice 6: hold the button → TotalMix talkback lights; release → clears; hold `T` → same; graceful stop mid-hold releases it.
6. After Slice 1: reset the audio probe → every fader/mute/48V disabled with the reason and "Run audio probe"; run it → controls return.
7. After Slice 9: studio monitor at 1920×1080 → no tier scrolls; 4/4/3 strips visible.
8. After Slice 11: X / Alt+F4 → dialog; Cancel keeps the session; Confirm quits and no `studio-control-engine.exe` remains.

## Baseline refresh procedure

win32: `cd frontend/app && npm exec playwright test visual-review.spec.ts storybook.spec.ts -- --update-snapshots`, inspect every changed PNG before `git add`, commit as `Audit S<N> (baselines): …`. linux: once after Slice 12 from the CI `playwright-test-results` artifact (`frontend/app/tests/__visual__/README.md`); `frontend-e2e` is expected red for Slices 5–12 and each Validation line says so. darwin: pending the next macOS host visit (listed in HANDOFF.md).
