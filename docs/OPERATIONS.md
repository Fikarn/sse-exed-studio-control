# Operations

This document describes runtime behavior and operator recovery for the native `SSE ExEd Studio Control` desktop runtime.

## Expected Runtime Behavior

### Startup

- The selected native shell starts first. In the current published operator-rollout build (`v2.2.1`), the selected shipping shell is Tauri. The Qt/QML fallback runtime has been retired; QtIFW remains only as the installer/update wrapper.
- The shell validates runtime paths and bundled assets, then launches the bundled Rust engine.
- The shell waits for `engine.ready`, `health.snapshot`, `app.snapshot`, and the relevant domain snapshots before routing into commissioning or the dashboard.

### Shutdown

- Closing the main window (the X button, Alt+F4, or the system close) asks for confirmation first, in every shell state including startup and recovery. If a lighting scene has unsaved changes, that prompt comes first.
- Confirming stops the engine gracefully: the shell closes the engine's stdin, the engine's request loop ends and releases any talkback hold on its way out, and the shell waits up to two seconds before it would force-kill. Then the window closes and the app quits. Engine restarts use the same graceful stop.
- What the hardware does: TotalMix keeps whatever state it has (nothing is recalled or reset), sACN output stops and fixtures hold their last levels, and the Stream Deck goes idle. A hard kill of the engine (task manager, power loss) cannot release talkback — release it in TotalMix.
- Automation that must close the shell without a dialog sets `SSE_SHELL_SKIP_CLOSE_CONFIRM=1`; the smoke and qualification lanes do not need it (they run `--smoke-test` or stop the process tree).
- The engine remains the owner of persisted state, recovery details, and device-facing safety behavior.
- Logs and support diagnostics stay available from the native recovery and support surfaces.

### Close / quit / update

- Closing the native shell is a full workstation-control shutdown, not a browser-tab close.
- Native updates are delivered through offline installers and maintenance-tool update repositories, not through background Electron-style auto-update polling.
- Apply updates deliberately during a safe workstation window and preserve the app-data directory unless you are intentionally resetting the machine.

### Restart / recovery

- Restart routing is driven from the engine snapshot.
- Machines with completed commissioning route back to `dashboard`.
- Clean-start or reset machines route back to `commissioning`.
- Corrupt storage, runtime-path failures, and protocol mismatches surface recovery details through the native health and support snapshots.

## Lighting Output

The engine streams the lighting state to the commissioned bridge as unicast sACN (ANSI E1.31) on UDP `5568`.

- Output is active only while all three hold: lighting is enabled, the commissioned bridge IP is a valid IPv4 address, and at least one fixture is patched.
- While active, the engine transmits the current state continuously: changed frames within one 40 ms tick, unchanged frames re-sent as keep-alives about every 800 ms. Scene fades, the grand master, and identify/highlight/solo overlays are rendered into the wire exactly as the DMX monitor shows them.
- This is an intentional live-state write on engine start: when the app launches with commissioned lighting, the rig immediately receives the persisted fixture state. Review fixture on/off state before launch if the studio must stay dark.
- When output becomes ineligible (lighting toggled off, bridge cleared, all fixtures deleted), the engine sends E1.31 stream-terminated packets and stops. Fixtures then hold their last received levels per DMX convention; use Cut all or fixture controls to black out before disabling output.
- The bridge must be configured to route the app's sACN universe to its DMX/CRMX output, and each physical fixture must match the patched DMX address, mode, and universe shown on the lighting page.

## Operator Recovery

### Lights stop responding

1. Open the Lighting workspace.
2. Review the native health and lighting summaries.
3. Re-run the lighting commissioning probe if needed.
4. If the bridge is still unavailable, restart the app and confirm the same issue reproduces before changing hardware state.

### Audio stops responding

1. Open the Audio workspace and read the Console badge; it names the problem and its way out:
   - `NOT VERIFIED` — the audio probe has not passed since the last transport change. Every console control is locked until it does; press **Run audio probe** in the top bar.
   - `DISCONNECTED` — TotalMix itself reports the interface is gone (`/status/connection 0`). Check the UFX III's USB link and power.
   - `OFFLINE` / `STALE` — no meter data is arriving from TotalMix. Work through the metering checklist below.
   - `ASSUMED` — a send was not confirmed by the console within 1.5 s, or a recall was only partly confirmed. Press **Sync**: it pulls the real console state and never changes hardware.
   - `TALKBACK REFUSED` — TotalMix has no talkback input channel assigned (see step 4 under Metering over Global OSC).
2. Review the native health and audio summaries.
3. Confirm the TotalMix OSC checklists below still match the workstation (Global OSC remote 4 for control and metering, remotes 1-3 as the classic metering fallback).
4. Re-run the audio commissioning probe if needed.
5. If the console is still unavailable, restart the app and confirm the failure is not limited to one session.

### RME TotalMix OSC Metering Checklist

The audio page is a control surface for the fixed RME Fireface UFX III workstation. Production meters are trusted only when live TotalMix OSC peak packets arrive. Metering prefers the Global OSC remote 4 described in the next section; the three classic remotes below remain the fallback and still feed the page-2 EQ path.

1. In TotalMix, configure three OSC remote slots for the app:
   - slot 1: hardware inputs, outgoing to the app base receive port, incoming from the app base send port
   - slot 2: software playback, outgoing to app receive `+1`, incoming from app send `+1`
   - slot 3: hardware outputs, outgoing to app receive `+2`, incoming from app send `+2`
2. Enable `Send Peak Level` on all three TotalMix OSC slots.
3. Keep each slot on the expected bank/bus with enough faders per bank for the fixed surface mapping.
4. Run the audio commissioning probe. It passes only after mapped meter packets are received; a successful UDP bind alone is not verification. (Test benches that set `SSE_AUDIO_SIMULATED_INPUT_MODE=1` pass the probe without TotalMix and say so in the result.)
5. If the app reports `STALE` or `OFFLINE`, treat the displayed meters as unavailable until packet flow is restored. Do not trust simulated movement unless the UI explicitly shows simulated input mode.
6. Treat audio-page meters as live console channel-strip meters: the visible reference is `-18 dBFS`, meter-point over is separate from the latched channel clip state, and the operator can toggle or reset the held peak marks from the audio canvas peak controls.

### Audio Control Output

Audio-page edits are transmitted to TotalMix over the Global OSC remote (send port base `+3`, default `7004`), using RME's official Global OSC protocol (2026-07-21 table). Everything is addressed by 0-based hardware channel number, so the TotalMix mixer layout never shifts control targets, and every value is absolute state — app and console cannot invert against each other.

- The console link reads the desk back. TotalMix does not echo a write to the remote that sent it, so after every send the engine asks for the touched channel (`/sendchan`, `/sendsubmix`) and marks the send **Confirmed** when the reply matches, **Adjusted** when the console kept a different value (the console wins), or unconfirmed after 1.5 s (badge `ASSUMED`, the count in the status line). Changes made in TotalMix itself flow into the app the same way (**External**, within about 200 ms). The `aligned` badge is written only after a complete pull or a fully confirmed push — never by an ordinary edit.
- **Sync = pull.** `/sendall` + `/sendstate` over remote 4, the answer is ingested, then `aligned`. Sync never changes hardware. `AUDIO_SYNC_NO_ECHO` means remote 4 did not answer: check it is In Use in Global OSC mode; `AUDIO_SYNC_INCOMPLETE` keeps what arrived and stays `unknown`.
- **Recall = push, except 48V.** A snapshot recall sends mutes-on first, then faders, gains, polarity, solo and output levels, then mutes-off, then dim / mono, and waits for the confirmations; 48V is never sent — differences are listed in the band under the top bar and each one is armed and confirmed per channel.
- **Gating.** While the badge is not `READY` (probe not passed, transport disabled, console disconnected) the engine refuses every console write and the app and the deck disable the controls with the reason; app-local edits (names, snapshot slots, settings) stay allowed. A request with any invalid field is rejected before a single OSC message leaves.
- **Arm-then-apply** (48V, snapshot recall, snapshot overwrite) needs a second press at least 350 ms after the first; held keys do not repeat.
- Channel faders ride `/mix/{in|pb}/{ch}/{out}/faderlin` (linear 0..1, the app's own fader scale; the dB the app prints for a position follows RME's published fader curve, unity at step 836 of 1023) to the requested submix — Main (out 0), Phones 1 (out 8), or Phones 2 (out 10). Output levels ride `/output/{ch}/faderlin`.
- Mute (`/input|playback|output/{ch}/mute`), solo (`/mix/{in|pb}/{ch}/0/solo`, main submix), phantom (`/input/{ch}/48v`), phase, pad, instrument, and auto-set are absolute 0/1 states.
- Dim, mono, and talkback are control-room functions (`/controlroom/dim|mainmono|talkback`) — sent for the main out, app-local for the phones targets.
- Talkback is momentary on every surface: hold the Talkback button or `T` in the app, or `TALK` on the deck. The app re-sends the hold every 750 ms and the engine releases 2 s after the last hold from any surface, so a dropped request, a closed window or an unplugged deck can never leave talkback open, and a click never latches. A graceful engine stop releases an active hold; a hard kill cannot — if the engine dies mid-hold, release talkback in TotalMix.
- Preamp gain is sent in real dB (`/input/{ch}/gain`) for the front preamps 9-12.
- The TotalMix Channel Layout gates whether TotalMix accepts control on hidden channels ("Receive on hidden channels" in the Global OSC details); keep the channels the operator drives visible, or enable that option.
- EQ and Low Cut edits still use the classic page-2 path on the first classic remote; the classic remotes otherwise serve as metering fallback, and the engine keeps pinning their bus/bank each second.
- Per RME's protocol notes, disable "Follow Submix" / submix lock on the Global OSC remote.

### Metering over Global OSC (TotalMix FX 2.1+)

All metering prefers TotalMix's Global OSC interface on a dedicated fourth remote. The engine listens on receive port base `+3` (default `9004`) and primes/keeps the stream alive with `/sendall` + `/sendstate` to send port base `+3` (default `7004`); `/level/{in|pb|out}/{ch}` peak-dB messages (RME's official Global OSC protocol table, 2026-07-21 revision) feed every meter surface on 0-based hardware channel numbering — inputs 1-12, playback pairs (right channel = left + 1), Main out `0/1`, Phones `8/9` and `10/11`. Hardware numbering never shifts with the mixer layout, so while this stream is live it is the meter authority and the layout-sensitive classic bank levels are suppressed (they remain as fallback if the Global OSC stream stops). Per RME's protocol notes, the Channel Layout still gates Global OSC data for hidden channels — keep the mapped channels (front preamps 9-12, playback pairs in use, Main and Phones outputs) visible in the layout. The slot is inert until commissioned.

To commission it on the workstation:

1. TotalMix FX must be version `2.1` or newer (Global OSC is the 2.1 headline feature; `2.0x` does not have it). The 2.1 beta is distributed on the RME TotalMix FX beta page as a manual file replacement — keep a backup of the previous `TotalMixFX_x64.exe` for rollback.
2. In `Options → Settings → OSC`, select remote controller `4`: `In Use` checked, compatibility/mode set to `Global OSC`, IP `127.0.0.1`, port incoming `7004`, port outgoing `9004`, and enable the send-changes/send-status details if the dialog offers them. Leave remotes 1-3 untouched in classic mode.
3. No app restart is needed — the engine re-primes the slot within seconds and the Main Out / Phones meters go live.
4. For talkback, assign the studio's talkback microphone as the Talkback input channel in `Options → Settings → Mixer` (TotalMix reports the choice as `/controlroom/talkchannel`; `-1` means none). With no channel assigned TotalMix ignores `/controlroom/talkback` from every remote and answers `0`; the app then shows `TALKBACK REFUSED` with this instruction and the deck's `TALK` key never goes green. Found live on the studio UFX III on 2026-09-04 — the channel was unassigned.

### Stream Deck Audio Surface

When the app is on the Audio workspace, the Stream Deck+ is its physical control surface. Companion drives the deck from the generated profile; every deck action calls the same engine audio path as the on-screen console, so the console, the app UI, and the deck cannot disagree.

Layout of the AUDIO deck page:

- Keys, top row: `→ MAIN`, `→ PH 1`, `→ PH 2` set the active mix target (the same engine-persisted selection as the app's output strips — the tier header "Mix for →" and the deck always agree), and `BANK` cycles which strips the dials drive: inputs (the four front preamps) → playback (pairs 1-4) → outputs (Main / Phones 1 / Phones 2, fourth dial idle).
- Keys, bottom row: `DIM` toggles control-room dim on Main; `GAIN` switches the input dials between send-fader and whole-dB preamp gain; `TALK` is momentary talkback on Main (hold to talk — the engine auto-releases 2 s after the hold stops arriving, so a lost request can never leave talkback open); `SOLO CLR` clears every solo.
- Touch strip: one segment per strip — name, level in the same dB the on-screen fader shows, and a drawn fader-position bar with the unity notch at RME's 0 dB fader position (step 836 of 1023, about 82 % of the throw — the same curve the on-screen fader prints). The bar is position, not a level meter. After the 2026-09 fader-curve update, re-export the Companion profile from Setup and re-import it (Full Reset & Import) so the deck picks up the regenerated bar images. Muted strips drop to the ember palette with `MUTED`; the selected strip carries the `•` marker and the amber accent. Tapping a segment selects that channel in the app inspector (deliberately silent — strip swipes can register as taps).
- Dials: rotate rides the strip's level (`0.01` per detent, the app's keyboard step; detents faster than 80 ms apply ×5 like Shift); push toggles the strip's mute.

State color follows the app's Console vocabulary: the active mix-target key is solid amber, `TALK` turns green while live, `SOLO CLR` turns warn-yellow with the live count, `DIM` and `GAIN` go amber while engaged, and a non-input dial bank tints the `BANK` key. The colors come from Companion feedbacks on custom variables the engine publishes (`lcd_audio_state_*`, `lcd_audio_strip_N_state/level`); the bar graphics are PNG assets rendered by `scripts/deck-assets.py` and embedded in the exported profile.

Trust rules: deck actions pass the same gating as app commands — when audio is not verified, the strips show the reason (`AUDIO / NOT VERIFIED`), cells grey out, and actions are refused. The deck shows state, not meters, and has no snapshot or 48V controls by design.

Deck freshness comes from the profile's `SSE audio LCD poll` trigger (1 s) plus per-action refreshes; the `SSE follow app - …` triggers flip the deck to the AUDIO / LIGHTS / PROJECTS page whenever the app workspace changes.

To commission or re-commission the deck:

1. Start Companion (it must be running so the export can bind the page-follow triggers to the physical Stream Deck — the export summary reports the bound surface id; without Companion running it falls back to `self` and page-follow will not move the deck).
2. In Setup step 1, download the Companion profile and import it in Companion's Import / Export page using **Full Reset & Import**. Do not use "Import Preserving Unselected": it keeps any existing generic-http connection and remaps the profile's actions onto that connection's old base URL, and the `$(SSE_Studio_Control:…)` display variables stop resolving.
3. Walk Setup steps 3-5: on Verify, press the physical controls and watch the matching cell pulse (the bridge stamps every action; the panel polls it live).

### Control-surface bridge stops responding

1. Open Setup or Support and verify the control-surface base URL is present in native diagnostics.
2. If the bridge is unavailable, restart the app before changing deck mappings or network assumptions.
3. If the problem persists, collect diagnostics and confirm the host can still bind `127.0.0.1` on the configured control-surface port.
4. Reinstall the latest known-good native build only after preserving the app-data directory and the latest support backup.

### Planning data looks wrong or missing

1. Export a native support backup immediately if the app is still responsive.
2. Use native restore with the latest known-good support backup or a legacy `db.json` export.
3. Confirm the recovery surface reports the rollback backup path created before restore.

### The app fails before the dashboard

1. Open the recovery surface.
2. Export diagnostics and note the engine log path.
3. If storage is corrupt, restore from the latest support backup.
4. If startup still fails, reinstall the latest known-good native build without deleting the app-data directory.

## Data Safety

- Primary store: native SQLite database
- Backup/export path: native support backup archives written under the app-data backup directory
- Restore path: native support restore from a support archive or legacy `db.json`
- Rollback safety: restore creates a pre-restore backup before applying changes

## Health Signals

### Engine snapshots

- `health.snapshot`
- `app.snapshot`
- `commissioning.snapshot`
- `lighting.snapshot`
- `audio.snapshot`
- `support.snapshot`

### Shell indicators

- startup target and current workspace
- commissioning readiness and hardware profile
- lighting readiness, last scene recall, and fixture inventory summary
- audio readiness, last sync or recall state, and channel inventory summary
- support backup count, restore guidance, and recovery details

## Recommended Checks Before A Live Session

1. Launch the packaged native app and confirm it reaches the expected target surface. On the `1920x1080` studio monitor the Console runs at compact density (4 input / 4 playback / 3 output strips, the rest banked with `[` `]`); nothing should scroll sideways.
2. Confirm lighting, audio, and support summaries show the expected ready state.
3. Trigger a test light scene recall if lighting is in scope.
4. Confirm the Console badge reads `READY` with live RME TotalMix OSC metering — not simulated, stale, or offline. If it reads `NOT VERIFIED`, run the audio probe.
5. Walk the console link checklist below if audio is in scope.
6. Export a manual support backup before the session starts.

### Console link checklist before a live session

1. Move one fader and toggle one mute in TotalMix — the app strip follows within about a second (the link is reading the desk).
2. Press **Sync** — the toast reports the values pulled, the badge goes `aligned`, and nothing moves in TotalMix.
3. Recall the session's opening snapshot — the band reports "N values pushed, N confirmed"; any 48V difference is listed by channel and is only applied when armed there.
4. Hold **Talkback** (or `T`, or the deck's `TALK`) — TotalMix's talkback lights and clears on release. If the app says `TALKBACK REFUSED`, assign the talkback input channel in TotalMix first.
5. On the Stream Deck, `→ MAIN` / `DIM` / `TALK` mirror the app; the Companion profile must have been re-imported after the fader-curve update (Setup step 1, Full Reset & Import).

## Bridge Qualification

Release validation must prove the local control-surface bridge can bind, listen, and serve real HTTP requests on `127.0.0.1`.

- `npm run native:bridge:mac:verify`
- `npm run native:bridge:win:verify`

Those lanes start the packaged engine on a dedicated localhost port, then verify `/api/deck/context`, `/api/deck/lcd`, `/api/deck/action`, `/api/deck/light-action`, and `/api/deck/audio-action` against the live bridge. Treat a bind failure as a release blocker, not as an acceptable warning.

For the current handoff state, use [docs/HANDOFF.md](./HANDOFF.md). The historical parity appendix is preserved at [docs/archive/NATIVE_PARITY_HANDOFF.md](./archive/NATIVE_PARITY_HANDOFF.md) for reference only.
