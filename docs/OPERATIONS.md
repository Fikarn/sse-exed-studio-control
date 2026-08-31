# Operations

This document describes runtime behavior and operator recovery for the native `SSE ExEd Studio Control` desktop runtime.

## Expected Runtime Behavior

### Startup

- The selected native shell starts first. In the current published operator-rollout build (`v2.2.1`), the selected shipping shell is Tauri. The Qt/QML fallback runtime has been retired; QtIFW remains only as the installer/update wrapper.
- The shell validates runtime paths and bundled assets, then launches the bundled Rust engine.
- The shell waits for `engine.ready`, `health.snapshot`, `app.snapshot`, and the relevant domain snapshots before routing into commissioning or the dashboard.

### Shutdown

- Closing the main window asks for confirmation before the app fully quits.
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

1. Open the Audio workspace.
2. Review the native health and audio summaries.
3. Confirm the TotalMix OSC metering checklist below still matches the workstation.
4. Re-run the audio commissioning probe if needed.
5. If the console is still unavailable, restart the app and confirm the failure is not limited to one session.

### RME TotalMix OSC Metering Checklist

The audio page is a control surface for the fixed RME Fireface UFX III workstation. Production meters are trusted only when live TotalMix OSC peak packets arrive.

1. In TotalMix, configure three OSC remote slots for the app:
   - slot 1: hardware inputs, outgoing to the app base receive port, incoming from the app base send port
   - slot 2: software playback, outgoing to app receive `+1`, incoming from app send `+1`
   - slot 3: hardware outputs, outgoing to app receive `+2`, incoming from app send `+2`
2. Enable `Send Peak Level` on all three TotalMix OSC slots.
3. Keep each slot on the expected bank/bus with enough faders per bank for the fixed surface mapping.
4. Run the audio commissioning probe. It passes only after mapped meter packets are received; a successful UDP bind alone is not verification.
5. If the app reports `STALE` or `OFFLINE`, treat the displayed meters as unavailable until packet flow is restored. Do not trust simulated movement unless the UI explicitly shows simulated input mode.
6. Treat audio-page meters as live console channel-strip meters: the visible reference is `-18 dBFS`, meter-point over is separate from the latched channel clip state, and the operator can toggle or reset the held peak marks from the audio canvas peak controls.

### Audio Control Output

Audio-page edits are transmitted to TotalMix over the Global OSC remote (send port base `+3`, default `7004`), using RME's official Global OSC protocol (2026-07-21 table). Everything is addressed by 0-based hardware channel number, so the TotalMix mixer layout never shifts control targets, and every value is absolute state — app and console cannot invert against each other.

- Channel faders ride `/mix/{in|pb}/{ch}/{out}/faderlin` (linear 0..1, the app's own fader scale) to the requested submix — Main (out 0), Phones 1 (out 8), or Phones 2 (out 10). Output levels ride `/output/{ch}/faderlin`.
- Mute (`/input|playback|output/{ch}/mute`), solo (`/mix/{in|pb}/{ch}/0/solo`, main submix), phantom (`/input/{ch}/48v`), phase, pad, instrument, and auto-set are absolute 0/1 states.
- Dim, mono, and talkback are control-room functions (`/controlroom/dim|mainmono|talkback`) — sent for the main out, app-local for the phones targets.
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

1. Launch the packaged native app and confirm it reaches the expected target surface.
2. Confirm lighting, audio, and support summaries show the expected ready state.
3. Trigger a test light scene recall if lighting is in scope.
4. Confirm the audio page reports live RME TotalMix OSC metering, not simulated, stale, or offline metering.
5. Trigger an audio sync or snapshot recall if audio is in scope.
6. Export a manual support backup before the session starts.

## Bridge Qualification

Release validation must prove the local control-surface bridge can bind, listen, and serve real HTTP requests on `127.0.0.1`.

- `npm run native:bridge:mac:verify`
- `npm run native:bridge:win:verify`

Those lanes start the packaged engine on a dedicated localhost port, then verify `/api/deck/context`, `/api/deck/lcd`, `/api/deck/action`, `/api/deck/light-action`, and `/api/deck/audio-action` against the live bridge. Treat a bind failure as a release blocker, not as an acceptable warning.

For the current handoff state, use [docs/HANDOFF.md](./HANDOFF.md). The historical parity appendix is preserved at [docs/archive/NATIVE_PARITY_HANDOFF.md](./archive/NATIVE_PARITY_HANDOFF.md) for reference only.
