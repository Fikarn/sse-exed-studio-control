# Stream Deck+ Audio Surface

Status: approved by the operator 2026-08-31; in execution on branch `studio-bringup-sacn-globalosc`.

Tracking: the per-slice `Status:` lines below are the authoritative execution record (same convention as the audio gold-standard ledger). Each slice lands as its own commit referencing the slice id; any divergence from a slice's written scope gets a `Rescope:` paragraph in that slice per the AGENTS.md rescope protocol — no silent substitution.

Goal: make the Stream Deck+ the physical control surface for the Audio workspace. When the operator app is on the Audio page, the deck shows the audio layout and its dials, keys, and touch strip drive the **same engine state and the same TotalMix Global OSC path** as the on-screen console — and the on-screen console follows every deck action live.

## Why this is a rebuild, not a wiring task

The bridge and profile machinery exist, but the audio slice of it is a demo shell:

- `POST /api/deck/audio-action` (`native/rust-engine/src/control_surface.rs:1043-1172`) supports only `toggleMute` / `togglePhantom` / `gainUp` / `gainDown` (±3 dB) / `recallSnapshot` — and everything except `recallSnapshot` reads/writes a bridge-private settings blob (`app.control_surface.audio.state`, `control_surface.rs:39`) that never reaches `update_default_audio_channel`, never reaches TotalMix, and never appears in `audio.snapshot`. Gain/mute/phantom on the deck are fake today.
- The Companion profile generator (`native/rust-engine/src/exports.rs`) puts LCD text expressions on the row-3 encoder buttons. On a Stream Deck+, Companion renders **row 2** on the touch strip; row-3 button style is never displayed on hardware. The generated AUDIO page leaves row 2 empty, so the physical strip would be blank.
- LCD variables refresh only when chained onto a button press (`lcd_refreshes`, `exports.rs:1178-1196`). There is no polling, so displayed values go stale.
- The bridge has no event path to the shell ("mutations land in SQLite silently"), so even correctly-routed deck actions would not update the open Audio page until an unrelated refetch.
- The engine already knows the active workspace (`shell.workspace`, `native/rust-engine/src/shell_settings.rs:6`, written by every `settings.update { workspace }`) — but the bridge never reads it, so nothing can follow the app page.
- The Companion install on the workstation still holds the **Electron-era profile**: 3 pages (PROJECTS/TASKS/LIGHTS), generic-http prefix `http://localhost:3000`, no AUDIO page. The current 4-page export was downloaded but never imported.

What we get to keep: the loopback HTTP bridge and its thread model, the generic-http + variables + `.companionconfig` export pattern, the planning/lighting deck pages (they drive real state), `recallSnapshot`'s proof that bridge threads can call the real audio path with only `db_path`, and the five-step commissioning runner.

## Operator model

Studio facts the layout is built around: exactly **4 front preamps** (`audio-input-9..12` — Host, Guest, Boom, Guitar DI; the only strips with gain/48V), 6 playback pairs of which the first 4 matter live (Program, FX, N-1, Music), and 3 output mixes (Main, Phones 1, Phones 2). The Stream Deck+ has exactly 4 dials. Dial _n_ ⇄ strip _n_ is the whole idea.

### AUDIO deck page layout

```
             col 1          col 2          col 3          col 4
keys row 0   → MAIN         → PH 1         → PH 2         BANK  IN|PB|OUT
keys row 1   DIM             GAIN           TALK (hold)    SOLO CLEAR
touch strip  HOST            GUEST          BOOM           GTR DI      ← name · dB · flags; tap = select
encoders     fader/gain      fader/gain     fader/gain     fader/gain  ← push = mute
```

- **Encoders (row 3)** — rotate = ±0.01 on the app fader scale per detent (matches the on-screen arrow-key step, `AudioSliderControl.tsx`), sending the strip's level into the **active mix target**. Detents arriving < 80 ms apart apply ×5 (matches Shift on screen). Push = channel mute toggle. In GAIN mode (inputs bank only), rotate = ±1 dB preamp gain (engine integer-dB constraint).
- **Touch strip (row 2)** — per-segment engine-baked text: channel name, level in dB (same piecewise curve as `audioFormatting.ts:50-73` so deck and screen always show the same number), `MUTED` flag, active-target arrow (`→MAIN`), `•` when selected. Tap = select the channel (`selectedChannelId` — the app inspector follows). Tap deliberately does **nothing audible**: Companion documents that strip swipes can be misread as presses.
- **→ MAIN / → PH 1 / → PH 2** — set the active mix target by writing the same engine-persisted `selectedMixTargetId` the app's output strips and Routing tab write. Deck and app share one selection; the tier header "Mix for →" and the deck arrows always agree.
- **BANK** — cycles which strips the dials drive: `IN` (4 preamps) → `PB` (playback pairs 1-4) → `OUT` (Main / PH1 / PH2 volumes, 4th dial idle). Deck-local engine-persisted state; the app's visual banking is untouched.
- **GAIN** — toggles inputs-bank dials between send-fader and preamp-gain. Ignored (and labeled so) on other banks.
- **TALK** — momentary: key-down → `talkback: true` on Main, key-up → `talkback: false`. The down action repeats via Companion `runWhileHeld`; the engine auto-releases talkback if pings stop for 2 s without an up (kill-switch for a lost HTTP request — a stuck-open talkback is the one failure this design refuses to allow).
- **DIM** — toggle control-room dim on Main. **SOLO CLEAR** — `audio.solo.clearAll` equivalent (the app's ⌥S).
- Every key shows live state text from engine-baked LCD variables (e.g. `DIM\n−20 ON`, `BANK\nINPUTS`, `→ PH 1 •`).

### Page-follow ("when we are in the audio page")

The app leads, the deck follows. A Companion trigger polls the bridge's new `workspace` LCD key each second; condition triggers set the Stream Deck+ surface page to AUDIO / LIGHTS / PROJECTS to match `shell.workspace`. No protocol change is needed — the bridge reads the existing `shell.workspace` settings key. The deck does not push workspace changes in v1 (no loops).

### Honesty rules (carried over from the app's trust model)

- Deck actions run through `ensure_audio_action_allowed` exactly like IPC commands. When audio is gated (`AUDIO_NOT_VERIFIED` etc.), strips render the reason (`AUDIO OFFLINE`) instead of values, and actions 409.
- No meters on the deck. A 1 Hz text poll cannot honestly render level; the strip shows _state_ (name/level/flags), the screen shows meters. (A future custom Companion module with image feedbacks could revisit this; out of scope.)
- Snapshots stay off the deck. `recall` does not replay state to the console yet (`audio_backend.rs:632-638` — recall is app-DB only, confidence drops to `assumed`), so a deck snapshot key would imply a hardware action that doesn't happen. Revisit when snapshot-to-console replay lands (Global OSC `/snapshot/load/{n}` is the candidate).
- 48V, phase, pad, EQ, dynamics stay off the deck: setup-time actions with misfire cost, already served by the inspector.

## Bridge API additions (all engine-internal; no IPC contract change)

`POST /api/deck/audio-action` vocabulary (replaces the shadow-state actions; body stays `{action, value}` with `value` string-encoded):

| action                             | value                      | routes to                                                                                                                                                          |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dialTurn`                         | `"<strip 1-4>:<up\|down>"` | send fader / gain / output volume for the resolved strip via `update_default_audio_channel` / `update_default_audio_mix_target`, with per-strip acceleration state |
| `dialPress`                        | `"1".."4"`                 | mute toggle on the resolved strip                                                                                                                                  |
| `stripTap`                         | `"1".."4"`                 | `selectedChannelId` update                                                                                                                                         |
| `setMixTarget`                     | `main\|phones-a\|phones-b` | `selectedMixTargetId` update (shared with app)                                                                                                                     |
| `cycleBank`                        | —                          | deck bank `inputs→playback→outputs` (new `app.control_surface.audio.bank` setting)                                                                                 |
| `toggleDialMode`                   | —                          | `fader\|gain` (new `…audio.dial_mode` setting)                                                                                                                     |
| `dimToggle` / `talkOn` / `talkOff` | —                          | `update_default_audio_mix_target` on Main (`talkOn` re-arms the 2 s auto-release)                                                                                  |
| `soloClearAll`                     | —                          | same path as `audio.solo.clearAll`                                                                                                                                 |

`GET /api/deck/lcd` new keys: `audio_strip_1..4`, `audio_key_1..8`, `workspace`. Old keys `audio_ch_nav` / `audio_gain1..3` are removed with their actions (qualification script updated in the same slice — rescope note required if kept instead).

`GET /api/deck/context` gains `workspace` and an `audio` block (bank, dialMode, activeMixTarget, gated flag, strip identities) alongside the existing planning fields.

After any mutating audio action the bridge emits `audio.changed` so the open Audio page refetches — reuse the thread-safe event emission the RME metering thread already uses for `audio.meters`; bootstrap hands the bridge the same sender it already hands the metering thread.

## Slices

### S1 — Engine: real audio deck actions

Status: complete (2026-08-31). All vocabulary actions land in the real audio path; shadow blob deleted; legacy `audio_ch_nav`/`audio_gain1-3` LCD keys read real preamp state until S2 replaces them; `switchToDeckMode`/`recallSnapshot` retained (recall now emits `audio.changed`). Validation: `cargo fmt`/`clippy -D warnings` clean, 226 engine tests green (+14 new handler/resolution tests), and a live spawned-engine HTTP probe confirmed gating (409 before probe pass), ×5 fast-turn acceleration, watchdog talkback auto-release with no `talkOff`, and 7 `audio.changed` emissions through the stdout event pipeline. Drive-by fix in the same file: `persist_optional_setting` deleted from a nonexistent `settings` table (now `app_settings`) — latent 500 on the lighting deck's clear-selection path.

Rewire `handle_audio_action` to the vocabulary above; delete `AUDIO_STATE_KEY` and the shadow blob; add gating, per-strip acceleration, the talkback watchdog, and `audio.changed` emission from bridge threads. Strip-resolution table (bank × strip → channel/mixTarget id) with unit tests; action-handler tests against a temp DB (the file currently has zero handler coverage). Update `scripts/native-control-surface-qualification.mjs` audio round-trip to assert a `dialTurn`/`dialPress` lands in `audio.snapshot` (not the removed shadow state). Validation: `npm run native:check`, `npm run native:test`, `npm run rust:clippy`, `npm run native:bridge:win:verify` (packaged).

### S2 — Engine: LCD + context truth

Status: complete (2026-08-31). New LCD keys `audio_strip_1..4` / `audio_key_1..8` / `workspace` render engine-baked text (app-curve dB mirror with the cross-reference comment on both sides; gate reason instead of values when audio is not verified; selection markers, MUTED, GAIN mode, active-target arrows). Context now carries `workspace` plus an `audio` block (bank, dialMode, selection, gated, resolved strips). Legacy `audio_ch_nav`/`audio_gain1-3` keys removed; qualification script asserts the new keys and the context block. Validation: fmt/clippy clean, 232 engine tests green (+6), live spawned-engine probe confirmed all new keys and the context payload.

New LCD keys with engine-side app-curve dB formatting (mirror `audioFormatting.ts:50-73`; comment the mirror obligation both sides), `workspace` key reading `shell.workspace`, context additions. Tests for every key's format, gated rendering, and the workspace read. Validation: as S1.

### S3 — Companion profile v2

Status: complete (2026-08-31). The generator now emits a native Companion v9 full config (definitionId/connectionId action fields, page ids, trigger section) instead of the v6 legacy shape; connection label fixed to `SSE_Studio_Control` (spaces broke `$(label:var)` refs); the AUDIO page carries the 8-key/strip/encoder layout with `runWhileHeld` momentary TALK; four triggers ship in the file (1 s LCD poll of 13 keys + three condition-true page-follow triggers on `lcd_workspace`). Page-follow surface binding is discovered live: the export function GETs the local Companion's own `/int/export/full?format=json` (`SSE_COMPANION_URL` override, HTTP/1.0 loopback client) and binds `set_page` to the first `streamdeck:*` surface, falling back to `self` with the summary reporting `deckSurfaceId`. Spike + live validation on the workstation: trigger/event/condition/set_page shapes reverse-engineered from a real 4.2.6 export; the generated file imported into Companion 4.2.6 via **Full Reset & Import** (the "Import Preserving Unselected" path keeps the old connection and remaps actions onto its dead prefix — S5 instructions must say Full Reset & Import); post-import state verified: correct label/prefix, 4 pages, 4 enabled triggers, follow bound to `streamdeck:A00WA5391MICCZ`. Validation: fmt/clippy clean, 234 engine tests green; the stale Electron-era profile is now replaced on the workstation. Note: the running packaged app still serves the pre-S1 engine, so the live poll 400s on the new LCD keys until S5 repackages — expected mid-flight state.

Rework `audio_controls()` in `exports.rs`: row-2 strip buttons (text `$(<label>:lcd_audio_strip_N)`, tap action), row-3 encoders (`rotate_left`/`rotate_right`/press + one-strip LCD piggyback GET), the 8 keys, and the LCD-refresh + page-follow **triggers** in the exported config. Change the connection label to an underscore-safe token (`SSE_Studio_Control`) — Companion connection labels reject spaces, and every `$(label:var)` reference must match; the current spaced label is a suspected import-breaker. Update the locked export tests (`exports.rs:1206-1279`; the 80-control count grows) and `scripts/native-parity-acceptance.mjs`. **Spike first, on this workstation:** hand-build one trigger + one connection in local Companion 4.2.6, export, and diff against our generated `version: 6` config to confirm the import/upgrade path and learn the current trigger JSON shape; if trigger import proves unstable, ship the profile without triggers and document the 3 manual trigger steps in OPERATIONS instead (rescope note in this file). Validation: S1 lanes + a throwaway import into local Companion.

### S4 — Commissioning: make "Verify live echo" real

Status: complete (2026-08-31). The bridge stamps `app.control_surface.last_event` ({route, action, value, at}) on every successful deck action; `controlSurface.snapshot` exposes it as `lastEvent`; the Setup pilot polls the snapshot every 500 ms during the verify step only (new `store.refreshControlSurfaceSnapshot()`), matches the event to a control by its `body` (exact value match, selected-page then route-home preference — pure helper `setupControlEcho.ts` with Vitest coverage), and pulses the cell. The decorative signature-diff echo is deleted. Strip cells appear in the map/verify grid with distinct labels (Strip 1-4 / Dial 1-4). Validation: 235 engine tests, frontend typecheck, all Vitest suites, and the full 244-test Playwright run green on the workstation (required `npx playwright install` once — WebKit was missing on this machine, which also explains four cascade failures on the first run).

Bridge stamps `app.control_surface.last_event` (control id + timestamp) on every action; `controlSurface.snapshot` exposes it; `SetupSupportPilot` polls the snapshot (500 ms, verify stage only) and pulses the matching cell — replacing today's decorative diff that can never fire (`build_control_surface_snapshot` is a pure constant). Show the row-2 strip cells in the map/verify grid. Validation: `npm run frontend:typecheck`, `npm run frontend:test`, `npm run frontend:playwright:test`, `npm run tauri:visual:review` (Setup surface changed).

### S5 — Commission on hardware + docs

Status: live pass complete except physical sign-off (2026-09-01). Repackaged (engine + shell) and relaunched; both packaged smokes green; `native:bridge:win:verify` passed against the new package. Live commissioning surfaced one real defect the structural import test could not: **generic-http 2.7's `jsonResultDataVariable` stores into a pre-existing CUSTOM variable** (referenced `$(custom:name)`) and is a silent no-op when the variable doesn't exist — so the profile's LCD could never render (nor could the legacy profile's, ever). Fixed in the generator: the export now ships the 13 `lcd_*` custom variables in `custom_variables` and every display/text/condition reference uses `custom:` instead of the connection label; re-imported via Full Reset & Import. Verified live on production afterwards: the 1 s poll populates real engine text into the variables (`• Host\n-∞ dB\n→MAIN`), page-follow moved the physical deck to the AUDIO page on its own (surface `last_page_id` = audio page id), and a full-chain press test through Companion's own HTTP press API flipped `selectedMixTargetId` main→phones-a→main with instant strip/key re-bakes and `audio.changed` echo into the open app.

Rescope: the planned "walk Setup steps 3→5" is deliberately left to the operator — the physical remainder is exactly what needs human hands and ears: confirm the deck's strip legibility, ride the dials against TotalMix (fader/mute/dim/talk on the real console), pulse-check the Verify step by pressing hardware controls, judge detent step (0.01) and fast-turn ×5 feel, then Publish. Everything reachable without touching the hardware has been verified live.

On the workstation: import the regenerated profile into Companion 4.2.6 (replacing the stale `localhost:3000` config), walk runner steps 3→5, verify each control end-to-end (deck → TotalMix console readback → app UI echo), tune detent step / acceleration / LCD legibility live, operator sign-off, Publish. Docs: OPERATIONS "Stream Deck Audio Surface" section (layout diagram, trigger setup, recovery), CHANGELOG entry. Optional: `#[ignore]` hardware test in the `native:test:hardware` lane (currently empty).

## Risks / open decisions

- **Companion v6-config import into 4.2.6** — S3 spike resolves; fallback is reverse-engineering the current export shape from a fresh 4.2 export.
- **Trigger-driven surface page-set needs the surface id** — the SD+ serial is known (`A00WA5391MICCZ`); confirm the internal action's surface addressing during the spike.
- **Per-detent HTTP latency on fast spins** — loopback POSTs should absorb it; acceleration reduces event count; measure during S5 before considering coalescing.
- Operator-vetoable calls made here: **MONO left off the deck** (rare; app-only) in favor of BANK; **tap = select** rather than solo (accidental-tap safety); **snapshots and 48V off the deck** (honesty/safety). Each is one key/action swap if overruled.
