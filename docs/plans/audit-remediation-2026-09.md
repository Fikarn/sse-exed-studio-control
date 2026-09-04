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

Follow-up (same day, after the operator saw the test values return on the desk): the acceptance lane was only half the story. **The engine unit tests themselves write to the live console on the workstation.** `audio_channel_update_persists_front_preamp_controls`, `clear_all_audio_solo_…`, the `support.rs` restore round trip and the deck tests in `control_surface_audio.rs` all call the real senders with the default transport (127.0.0.1:7001, Global slot 7004), which on this machine is TotalMix; every `cargo test`, `native:test` or `dev:check` since 2026-08-31 has therefore pushed fixture values to the desk (Host preamp 9: gain 41, phase invert, instrument mode, AutoSet, a solo into Main; preamp 12: gain 40 → AutoSet-reduced, 48V, phase, AutoSet; Main fader 0.81 = −0.24 dB with dim and mono on — `/output/0/volume` reports the _effective_ level including dim, which is why the desk read −20.24 dB both before and after; playback 1/2 muted and soloed into Main). The console-link "console truth" ingested in the first live check (Host gain 41, phase / AutoSet / instrument on) was itself this pollution. Fix: `send_osc_messages` drops, under `cfg(test)`, every datagram aimed at a TotalMix remote port (7001–7010) unless `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1` (hardware lane opt-in); tests that observe datagrams already bind ephemeral loopback receivers and are unaffected (`test_guard_drops_sends_to_real_totalmix_ports_only` proves both halves); the commissioning no-traffic probe test now sends to port 1 instead of 7001 so its bus pins cannot reach the classic remotes either. The desk was restored a second time (all flags off, solos and mutes cleared, Main fader back to −20.24 dB with dim off); preamp 9 gain (41) and preamp 12 gain (26) and the playback 1/2 → Phones 1 send (−6.86 dB) are test artefacts whose prior values are unknown — operator to set. A Global OSC dump after a full `cargo test` run under the guard shows the desk unchanged.

Notes: the `rust` CI job sets `SSE_AUDIO_SIMULATED_INPUT_MODE=1` on the `native:acceptance` **step only** — `native:test` contains `audio_probe_fails_without_live_rme_meter_packets`, which must keep running unsimulated. `tauri-workspace-qualification.mjs` already probes before its audio writes and skips that block on CI, so it needed no change. The banner order in `AudioSignalCanvas` already put trust-state bands above the solo band; no change was needed for that scope item.

Operator hands: checklist B6 — reset the audio probe, confirm every fader / mute / 48V / EQ control is disabled with the reason and "Run audio probe", run it, confirm the controls return.

## Slice 2 — Console link: read-back confirmation, echo ingestion, honest confidence

Status: landed 2026-09-03 (operator verification pending — the live echo check below). Commit `Audit S2`.

**Rescope:** the plan assumed TotalMix echoes a written value back to the remote that sent it and reports faders as `faderlin`. A live probe of the studio UFX III (TotalMix FX 2.1 beta, Global OSC remote 4 on 7004/9004, 2026-09-03; `scratchpad/osc_probe.py`) showed neither: (1) TotalMix does **not** echo to the originating remote unless the per-remote "re-send" option is on, which RME's own change notes warn causes ping-pong and fader lag, so the plan's `CONFIRM_VIA_SENDCHAN` contingency is now the design — every send is confirmed by an explicit read-back (`/sendchan/{input|playback|output}/{ch}` for channel parameters, `/sendsubmix/{out} 2` for mix nodes, `/sendsettings` for control-room functions), which TotalMix answers as one burst ~30 ms later; (2) dumps and read-backs report faders in **dB** (`/mix/…/fader`, `/output/…/volume`), never `faderlin`, so the RME fader curve (`audio/fader_curve.rs`, planned for Slice 5) lands here for ingestion and comparison — Slice 5 keeps only the display/deck/frontend switch-over; (3) `/sendsubmix 2` omits nodes at or below −65 dB, so an "off" fader send is confirmed by its absence once the reply burst has gone quiet; (4) writes to channels hidden in the TotalMix layout are dropped silently (a `/playback/92/mute` write on the hidden MADI pair changed nothing) — the read-back then reports the old value and the console wins. Title changed accordingly ("echo ingestion" → "read-back confirmation, echo ingestion"). A tooling lesson worth recording: Git Bash rewrites command-line arguments that start with `/` into Windows paths (`/sendall` → `C:/Program Files/Git/sendall`), which made the first probe round look like TotalMix ignored everything; `MSYS_NO_PATHCONV=1` fixes it.

Scope (as landed): new `rme_console_link.rs` (parse every Global OSC control/status message the app models; pending-send registry keyed by parameter; read-back scheduler — `READBACK_DELAY` 120 ms after the last send to a parameter, one request per channel / submix / settings group; Confirmed / Adjusted / Stale / External / Status classification; "off" confirmed by absence once the reply burst is quiet for `REPLY_QUIET` 80 ms, with `/sendstate` paired to every submix read-back as the end-of-burst marker; `CONFIRM_TIMEOUT` 1.5 s), `audio/console_link.rs` (apply queued console changes to `channels_state` / `mix_targets_state` under the new `AUDIO_STATE_LOCK`, 100 ms flush, one write only when a value actually changed, `audio.changed { reason: "console-echo", applied, unconfirmed, connectionLost }`; expired sends → confidence `assumed` + `AUDIO_CONSOLE_UNCONFIRMED` naming the parameters; `/status/connection 0` → confidence `unknown`), `audio/fader_curve.rs` (RME `CalcFaderDB` / `CalcFaderLin`, moved up from Slice 5), single confidence writer `helpers::confidence_setting(ConsoleConfidence)` used by sync / recall / settings / console link / parity fixture, `AudioConsoleLinkSnapshot` on `AudioSnapshot.consoleLink` (ts-rs regenerated), `#[serde(default)]` on every stored-state field, `engine_events.rs` (one out-of-band event sender shared by the deck bridge and the link), store bypass of the 250 ms tail suppression for `console-echo` (deferred, not dropped, while a local mutation is in flight), `CONSOLE DISCONNECTED` banner. Senders register their commands on the link after the datagrams leave; the metering thread routes non-level Global OSC traffic to the link, sends due read-backs over the slot socket, and flushes.
Gates before: only `/level/*` parsed; `global_osc_ignores_unmapped_channels_and_status_traffic` pinned that control echoes are dropped (still true for the meter state; the link now consumes them).

Tests added:

- `rme_console_link` (11): `parses_every_global_control_address_family`, `outgoing_commands_share_keys_with_their_readbacks`, `readback_is_requested_once_the_send_settles`, `readback_reply_within_tolerance_confirms_the_send`, `readback_reply_with_a_different_value_is_adjusted_and_queued`, `stale_reply_does_not_override_a_newer_send`, `unsolicited_message_is_an_external_change`, `off_send_is_confirmed_by_absence_once_the_submix_reply_finishes`, `off_send_on_an_empty_submix_is_confirmed_by_the_status_marker` (added after the first live run exposed the empty-reply gap), `non_off_send_absent_from_the_reply_expires_as_unconfirmed`, `status_messages_drive_the_link_state_only`.
- `rme_totalmix_osc`: `service_console_link_reads_back_over_the_global_slot_and_confirms` (fake TotalMix on loopback receives `/sendchan/input/11`, replies, the link confirms).
- `audio::tests`: `console_echo_updates_channel_and_mix_target_state` (mapped params applied through the curve, unmapped ignored, re-apply is a no-op), `unconfirmed_sends_downgrade_confidence_to_assumed`, `console_disconnect_resets_confidence_to_unknown`, `stored_audio_state_tolerates_missing_and_unknown_fields`, `console_confidence_has_one_writer` (source scan).
- `audio::fader_curve`: `fader_curve_matches_rme_published_anchors` (incl. the live −61.974 dB reading for position 0.02), `fader_curve_round_trips_and_handles_off`, `fader_positions_match_within_console_quantisation`.

Tests changed: `apply_global_packet` (now unused, replaced by `route_global_packet`) was removed. **Acceptance lanes (`scripts/native-parity-acceptance.mjs`, `native-acceptance.mjs`, `native-packaged-acceptance.mjs`):** the first live-console run of the plain lane with the link active failed its restore-parity compare, because the passive `/sendall` ingest rewrote stored state asynchronously while the harness compared against a pre-ingest baseline — and the investigation showed the plain lane had been writing its test values to the **real studio desk** all along (main volume 0.81 = −0.24 dB, dim, mono, talkback, a solo on playback 1/2 into Main, playback 1/2 muted, preamp 12 gain 40 / 48V / phase / instrument / AutoSet) and leaving them there. The desk was found in that state today (twice, from the two Slice 1 / Slice 2 plain runs) and restored by hand to its evidenced prior values in a level-safe order (Main back to −20.24 dB first, then dim / mono off, solo and mute cleared, preamp 12 flags off; preamp 12 gain left at the AutoSet-reduced 26 dB because its prior value is unknown — operator to re-check). New rule: the harness runs the engine in **simulated audio input mode by default** (`acceptanceEngineEnv`), so `npm run native:acceptance` never touches a console anywhere and the probe / sync / recall assertions run against the simulated console (the `SSE_NATIVE_ACCEPTANCE_SKIP_AUDIO_SYNC` and step-level `SSE_AUDIO_SIMULATED_INPUT_MODE` CI flags are gone); `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1` is the explicit workstation live lane, which waits for the console link to settle before every baseline / compare (`awaitConsoleLinkQuiet`), writes only to Phones 2 and playback 7/8, renames the preamp instead of touching it, never solos Main and never recalls a snapshot, asserts `consoleLink.unconfirmedSends === 0`, and restores everything in a `finally`. Compares in both acceptance scripts now follow the chosen targets and include the channel name.

Validation (workstation, 2026-09-03): `cargo test -p studio-control-engine` → 261 passed (Slice 1: 241; +20 added, −1 removed... see counts above); `cargo fmt`, `npm run rust:clippy` clean; `npm run protocol:generate` (new `AudioConsoleLinkSnapshot.ts`, `AudioSnapshot.ts`) + `protocol:check` clean; `npm run frontend:typecheck` clean; `npm run frontend:test` 44 + 119 passed; Playwright `audio.spec.ts audio-meter-gating.spec.ts` → 44 passed. Live (debug engine against the studio TotalMix FX, `scratchpad/live_link_check.mjs`): probe passed, slot bound, `/status/device "Fireface UFX III (1)"`, connection `connected`; passive ingest applied 325 console values (Host gain 41, phase / AutoSet / instrument on, Phones 1 send at unity — the console's truth, not the app's defaults); `audio-playback-7-8 → Phones 2` nudge to 0.02 → `confirmedSends 1`; restore to 0.0 → `confirmedSends 2` (first run expired as unconfirmed, which is the empty-submix gap fixed by the `/sendstate` marker); mute on hidden `audio-playback-9-10` → app showed it for one read-back, then the console won (`adjustedSends 1`, mute back to false); confidence stayed `unknown` throughout (never falsely `assumed`); five `console-echo` events observed. Acceptance after the harness change: `npm run native:acceptance` (default, simulated console) → passed; `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1 npm run native:acceptance` (live TotalMix) → passed, and a Global OSC dump afterwards showed the desk exactly as before the run (Phones 2 volume off / unmuted, playback 7/8 unmuted, Main −20.24 dB, dim / mono / talkback off, no Main solo); `npx playwright test visual-review.spec.ts storybook.spec.ts` → 77 passed (no baseline moved); `npm run dev:check` → passed after a prettier pass over `AGENTS.md`.

Baselines: none moved (no fixture reaches the new banner). Operator hands: checklist B2-prep — move a fader and toggle a mute / 48V / dim in TotalMix and confirm the Console page follows within ~1 s (`externalChanges` climbs, strips move); after an app edit confirm `pendingSends` drains to 0 and `confirmedSends` climbs.

## Slice 3 — Sync = pull

Status: landed 2026-09-03 (operator verification pending — checklist B2). Commit `Audit S3`.

Scope (as landed): the pull lives in `audio/sync.rs` (not in the backend trait, which has no database or link access): gate → `AUDIO_GLOBAL_OSC_UNBOUND` unless the metering thread holds the Global slot → `begin_pull` on the console link → `/sendall 2.0` + `/sendstate 1.0` to `send_port + 3` (`send_console_pull_request`) → the metering thread ingests and flushes as usual while the IPC thread polls `pull_progress` every 20 ms → complete when the control stream (levels excluded) has been quiet for 300 ms (measured: the desk's dump is 3 000–3 500 messages and ends 220–270 ms after the request; status arrives at the start, so it cannot be the end marker) → final flush → mapped mix nodes the dump omitted are set to 0.0 (`/sendall 2` lists only nodes above −65 dB; `fader` follows for the main send) → `aligned`, reason `console-pull`, `consoleLink.lastPullAt` / `lastPullValues`, `reset_unconfirmed`. Zero control messages within 3 s → `AUDIO_SYNC_NO_ECHO`, confidence `unknown`; still flowing at 3 s → `AUDIO_SYNC_INCOMPLETE`, confidence `unknown`, what arrived stays. Simulated input mode: no pull, reason `simulated-sync`, "mirrors the app (test mode)". `AudioSyncResult` gains `pulledValues`, `channels`, `mixTargets`, `complete`, `connection`. `refresh_global_slot` sends the documented floats. Store: the local `audio.sync` patch is deleted, so a fresh `audio.snapshot` follows every sync; fixture transport mirrors the pull result. The dead `AudioBackend::sync_console` path is removed.
Gates before: `tests.rs:564` forged the probe key and asserted `aligned` with no I/O; the store showed "manual sync" + aligned from its own patch without refetching.
Tests added: `console_pull_ingests_a_fake_totalmix_dump` (fake TotalMix on loopback answers `/sendall` with a scripted dump, a pump thread stands in for the metering thread; asserts values through the curve, an omitted node → 0.0, `aligned`, `console-pull`, `lastPullValues`), `console_pull_that_never_goes_quiet_is_incomplete`, `audio_sync_without_console_echo_is_refused_and_stays_unknown` (a stale `aligned` does not survive), `audio_sync_refuses_when_the_global_slot_is_unbound`, `pull_tracker_counts_the_dump_and_reports_quiet`, `send_console_pull_request_targets_the_global_slot`, `#[ignore] live_totalmix_pull_round_trip` (hardware lane, needs `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1`), engine-client Vitest `createShellStore.test.ts` (sync → `audio.snapshot` refetched, state comes from the transport, not a local patch); the live acceptance lane asserts a complete pull with > 100 values.
Tests changed: `audio_sync_updates_console_state_when_probe_passed` → `audio_sync_in_simulated_mode_reports_aligned_without_a_pull` (old: aligned with no I/O on the default transport; new: only the simulated console aligns without a pull); `refresh_global_slot_sends_sendall_and_sendstate_to_the_slot_port` asserts `2.0` / `1.0`; `simulated_audio_backend_syncs_when_transport_and_inventory_exist` removed with the dead backend path; tests that drive the shared console link now serialise on `SHARED_LINK_TEST_LOCK` and reset it first (the loopback read-back test had started answering the pull tests' read-backs); the Slice 2 console-link tests and the Slice 3 pull tests moved to `audio/tests_console_link.rs` because `audio/tests.rs` crossed the 2 000-line `file:health` guard (`TestDir` stays in `tests.rs`, shared as `pub(super)`).
Validation (workstation, 2026-09-03): `cargo test -p studio-control-engine` → 268 passed, 1 ignored (hardware lane), stable over three consecutive full runs after the shared-link serialisation; `cargo fmt` + `npm run rust:clippy` clean; `npm run frontend:typecheck` clean; `npm run frontend:test` → 44 + 119 + 1 (the first engine-client test); Playwright `audio.spec.ts audio-meter-gating.spec.ts audio-hierarchy.spec.ts` → 46 passed; `visual-review.spec.ts storybook.spec.ts` → 77 passed, no baseline moved; `npm run native:acceptance` (default, simulated) → passed; `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1 npm run native:acceptance` → passed with a real pull from the studio desk (complete, connected, > 100 values; the harness's Phones 2 / playback 7/8 writes came back through the curve within one console step and were restored afterwards); `npm run dev:check` → passed once the audio test module was split for the `file:health` guard. A first live-lane run failed on two harness expectations that predated the pull (`manual-sync` as the reason, exact fader equality after a curve round trip) — harness fixed, not the engine. Baselines: none. Operator hands: checklist B2 — press Sync on the Console page: the toast reads "Pulled N values from TotalMix · …", the badge shows aligned, nothing on the desk moves, and a fader you moved in TotalMix beforehand shows the right dB afterwards.

## Slice 4 — Recall = push, 48V listed

Status: landed 2026-09-03 (operator verification pending — checklist B3). Commit `Audit S4`.

Scope (as landed): `audio/recall.rs` builds the push from the snapshot's captured contents against the current surface — phase 1 mutes turning on (`/{input|playback|output}/{ch}/mute 1`), phase 2 values (`/mix/{in|pb}/{ch}/{out}/faderlin` for every mapped send, absent sends → off, `/mix/…/0/solo`, `/input/{ch}/gain|phase|instrument|autoset`, `/output/{out}/faderlin`), phase 3 mutes turning off, phase 4 `/controlroom/dim|mainmono`; never `48v`, `talkback` or `pad`; `phantom_differences` for every preamp whose 48V differs. `rme_totalmix_osc::send_totalmix_recall_plan` sends the phases in bursts of 48 with a 10 ms pause and registers every command on the console link; the link's new push tracker (`begin_push` / `push_progress` / `finish_push`) counts confirmed / adjusted / unconfirmed per pushed parameter. `snapshots.rs::recall_audio_snapshot(_with_timing)`: gate → app state = contents with 48V and talkback kept from the console → `assumed` → push → wait ≤ 1.5 s (= the link's confirm timeout) → flush → `aligned` with reason `snapshot-push` when nothing is unconfirmed, otherwise `assumed` with the names in the message (the link's expiry flush reports `AUDIO_CONSOLE_UNCONFIRMED`). Snapshot without contents → markers only, nothing pushed, confidence untouched. Simulated input mode → app-local, aligned, reason `snapshot`. `AudioSnapshotRecallResult` gains `pushed`, `confirmed`, `adjusted`, `unconfirmed`, `phantomDifferences`. The dead `AudioBackend::recall_snapshot` path is removed. Frontend: `audioRecallReport.ts` parses the result; the Console page shows a dismissible "Recalled …" band (`audio-recall-report`) with the counts and one "Arm 48V on/off · channel" button per difference that runs the existing armed 48V flow; fixture transport mirrors the push (48V kept, differences listed) and the Interview block fixture carries captured contents with a 48V difference on Host.
Gates before: `tests.rs:593` asserted `assumed` + bookkeeping; the backend summary said recall is app-local; the fixture recall applied 48V straight from the snapshot.
Tests added: `recall_plan_orders_mutes_first_and_never_touches_48v_talkback_or_pad`, `recall_pushes_the_snapshot_and_the_console_confirms_it` (a loopback console model remembers the app's writes and answers `/sendchan`, `/sendsubmix 2` + `/sendstate` and `/sendsettings` from memory in dB; the recall ends `aligned` / `snapshot-push` with every value confirmed and the app back on the captured scene), `recall_without_console_answer_stays_assumed_and_lists_unconfirmed`, `recall_in_simulated_mode_is_app_local_and_aligned`; Playwright: recall shows the report band with counts and the 48V difference, the 48V pill is unchanged, arming from the band works, dismiss removes it.
Tests changed: `audio_snapshot_recall_marks_last_recalled_snapshot` (the built-in "Panel" slot has no captured state: old `assumed` → new "nothing pushed, confidence untouched"); the CRUD test's recall uses the fast timing; parity acceptance expects an aligned, fully confirmed recall on the simulated console and still never recalls on the live lane.
Validation (workstation, 2026-09-03, studio idle per the operator): `cargo test -p studio-control-engine` → 273 passed, 1 ignored; `cargo fmt` + `npm run rust:clippy` clean; `npm run frontend:typecheck` clean; Playwright `audio.spec.ts audio-arm-countdown.spec.ts audio-meter-gating.spec.ts` → 47 passed (incl. the new recall-report case). **Live recall round trip on the studio desk** (`scratchpad/live_recall_check.mjs`: probe → pull → capture the desk's own state as a temporary snapshot → two harmless deltas through the app (playback 7/8 → Phones 2 send to 0.02, Phones 2 volume 0.3 + mute) → recall → verify → delete the snapshot): first run pushed 122 values, 55 confirmed, 67 unconfirmed → three accounting gaps, not push failures: (1) "off" sends confirmed by absence were never credited to the push tracker (46), (2) a solo-off on a node the desk does not list and a mute/gain sent to the right side of a stereo-linked pair can only ever be confirmed by absence (21), (3) the pull summary counted all 94 hardware channels. After the fixes (`confirmable_by_absence`, push tracker credit, modelled-channel counts; two new link tests) the second run reported **122 pushed, 122 confirmed, 0 unconfirmed, `aligned`, reason `snapshot-push`**, both deltas back to the captured values, and a Global OSC dump afterwards showed the desk exactly as before (playback 7/8 → Phones 2 at −8.9 dB, Phones 2 off and unmuted, Main −20.24 dB, dim/mono/talkback off, snapshot slot 1 "mix 1" still active). `npm run native:acceptance` default (simulated) → passed with an aligned, fully confirmed recall; `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1` lane → passed (it still never recalls). `npm run frontend:test` → 44 + 119 + 1. Visual lanes: 7 of 77 captures moved, all for one reason — the Interview block tile now draws its captured mix-shape thumbnail because the fixture snapshot carries contents, exactly as a captured snapshot does; refreshed on win32 (`audio-populated` at 2560 + bone + graphite, `audio-action-failed`, `audio-not-verified`, `audio-offline`, `audio-state-assumed`) after inspecting the diff, then 77 passed. `npm run dev:check` → passed.
Baselines: the 7 win32 audio captures above (snapshot deck tile only); linux after Slice 12, darwin pending. Operator hands: checklist B3 — capture a snapshot, change a fader, a mute and 48V on Host in TotalMix, recall: fader and mute return in order, 48V does not, the report band names Host, arming from the band flips it.

## Slice 5 — RME fader curve everywhere

Status: landed 2026-09-04 (operator verification pending — checklist B4 + Companion re-import). Commit `Audit S5`.

Scope: `audio/fader_curve.rs` + `audioFormatting.ts` + `fixtureTransport.ts` on RME's `CalcFaderDB`/`CalcFaderLin`; `AUDIO_FADER_UNITY = 836/1023`; notch CSS from a variable; deck bar assets regenerated (`scripts/deck-assets.py`); Companion profile re-export.

What the gates asserted before: `audioFormatting.test.ts` and the Playwright test "formats audio faders with the prototype TotalMix-style law" pinned 0.7 → −10 dB and 0.8 → 0 dB; `audio_fader_db_label_mirrors_the_app_curve` pinned the same law for the deck LCD; `simulated_output_submix_uses_totalmix_fader_gain_curve` used 0.8 as unity and 0.7 as −10 dB; the `audio.spec.ts` single-source-submix test used the 0.8 / 0.7 literals; three Playwright sites typed −60 dB to mean "no send" (the old curve's floor). Nothing compared any of them with RME's published curve, and the engine, the app and the fixture transport each carried their own copy of the prototype law.

What landed:

- One TypeScript implementation, `frontend/packages/engine-client/src/audio/faderCurve.ts` (mirrors `audio/fader_curve.rs`; `AUDIO_FADER_UNITY = 836/1023`, `FADER_OFF_DB = −65`, `FADER_MAX_DB = +6`), exported from `@sse/engine-client`. `audioFormatting.ts` re-exports the constant and routes `normalizedToFaderDb` / `faderDbToNormalized` through it; the fixture transport's simulated submix gain uses it (its private 0.8 copy deleted). A typed `0` lands exactly on the unity constant.
- Engine: `control_surface_audio::audio_fader_db_label` and `audio/snapshot.rs::totalmix_fader_gain` call `fader_curve::fader_lin_to_db`; both private prototype-law copies are gone. The deck label keeps its `+0.0 dB` style and never prints `-0.0`.
- Unity notch: `AudioSliderControl` sets `--audio-fader-unity` from `AUDIO_FADER_UNITY` and the CSS notch is `calc(100% * var(--audio-fader-unity))`. Routine call (not a rescope): the plan said to declare the variable in `AudioWorkspace.module.css`; declaring it on the component that draws the notch keeps a single source and covers sliders rendered outside the workspace.
- Typed dB entry (`AudioFader`) spans −65 … +6 dB; −65 dB and below is off, as in TotalMix.
- `scripts/deck-assets.py` `UNITY_X` → 836/1023; the 26 bar PNG/.b64 pairs regenerated (notch moved from x = 110 to x = 113 on the 144 px canvas). Icons and the strip assets came out byte-identical, which also confirms the Pillow output is reproducible.
- `docs/OPERATIONS.md` (`faderlin` clause, deck unity note plus the re-export / Full Reset & Import step), CHANGELOG bullet.

Tests added: engine-client `faderCurve.test.ts` (RME anchors including the live 0.02 → −61.974 dB reading, a 1023-step round trip, off / −300 dB sentinel / non-finite handling); `audioFormatting.test.ts` anchor table, dB round trips, −65 dB = off, `formatAudioDb(0.8) = "-0.6 dB"`; Rust `audio_fader_db_label_prints_the_rme_fader_curve` at the same anchors (the Slice 2 `fader_curve_matches_rme_published_anchors` already pins the engine curve).

Tests changed (old → new → why):

- `audioFormatting.test.ts` curve block: unity 0.8 → 0 dB, 1.0 → exactly 6, −60 dB → position 0, breakpoint round trip at 0.7 / 0.75 → RME anchors (0.5 → −12.125, 649/1023 → −6, 0.7 → −3.847, 0.8 → −0.565, …), −65 dB → 0, −60 dB → 0.0333, round trips in both directions. Why: the old table encoded a prototype law TotalMix never used (decision 3).
- `audio.spec.ts` "formats audio faders with the prototype TotalMix-style law" → "… with RME's TotalMix fader curve" (same reason); the single-source-submix test uses `AUDIO_FADER_UNITY` and `faderDbToNormalized(-10)` instead of 0.8 / 0.7; three "Fader level" entries `fill("-60")` → `fill("-65")` because −60 dB is a real send level on RME's curve and −65 dB is off — the assertions that follow (`data-no-send`, snapshot preview text) are unchanged.
- Rust `audio_fader_db_label_mirrors_the_app_curve` (0.35 → −35.0, 0.7 → −10.0, 0.75 → −5.0, 0.8 → +0.0, 0.9 → +3.0, 1.0 → +6.0) → `…prints_the_rme_fader_curve` (0.35 → −23.0, 0.5 → −12.1, 649/1023 → −6.0, 0.7 → −3.8, 0.75 → −2.2, 0.8 → −0.6, unity → +0.0, 0.9 → +2.7, 1.0 → +6.0, NaN → −∞).
- Rust `simulated_output_submix_uses_totalmix_fader_gain_curve`: unity 0.8 → `fader_curve::AUDIO_FADER_UNITY`, the −10 dB position 0.7 → `fader_db_to_lin(-10.0)`; the physics it asserts (−10 dB = 0.316×, dim 0.42×) is unchanged.

Validation (workstation, 2026-09-04): engine-client Vitest 4 passed (2 files); app Vitest 44 passed; `frontend:typecheck` clean; eslint and prettier clean on the touched files; `cargo test -p studio-control-engine` → 273 passed, 1 ignored (live); `cargo fmt --check` and clippy clean; `python scripts/deck-assets.py` → 52 files changed, all 26 bar pairs and nothing else; Playwright `audio.spec.ts audio-hierarchy.spec.ts audio-arm-countdown.spec.ts audio-meter-gating.spec.ts` → 50 passed after rebuilding `dist` (the first run, against the previous evening's build, failed the three −65 dB entries because the dialog still had the old −60 dB minimum — the Playwright `webServer` is `vite preview` over `frontend/app/dist`, so behaviour specs need `npm run build --workspace frontend/app` after source edits; noted in AGENTS.md); visual lanes → 77 passed after refreshing 12 win32 audio baselines; `npm run dev:check` → passed.

Baselines moved: 12 win32 — `audio-populated` at 1440×900, 1600×960, 1728×1117, 1920×1080, 2560×1440, studio-preview 1512×982, bone and graphite 2560×1440; `audio-state-assumed`, `audio-not-verified`, `audio-offline`, `audio-action-failed` at 2560×1440. Diffs inspected: only the per-strip dB readouts, the monitor-bar MAIN level, the inspector send readout, the unity notches (up about 1.7 % of the throw) and the Guest 1 fader cap (its fixture value 0.8 is no longer unity, so its `data-unity` border went). `audio-populated` 1280×800 re-rendered byte-identical and the two audio Storybook baselines stayed within tolerance, so neither was rewritten. Linux siblings refresh after Slice 12 (CI `frontend-e2e` expected red from this slice on); darwin pending.

Operator hands: checklist B4 — TotalMix fader at 0 dB → app reads 0.0 dB with the cap on the notch, −6 dB → −6.0 dB, deck LCD prints the same — plus re-export the Companion profile from Setup and Full Reset & Import it so the touch-strip bars carry the new notch.

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
