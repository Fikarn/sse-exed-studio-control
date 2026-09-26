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
- Studio Control's Windows files are not code-signed: the operator decided on 2026-09-23 to stay unsigned on the single workstation (production readiness Appendix B item 7). Keep Windows' **Smart App Control** switched off on the studio workstation (Windows Security › App & browser control › Smart App Control). When it is on, it checks every program as it starts and blocks unsigned ones, so neither the window nor the hardware link would start. A build downloaded from GitHub Releases shows a SmartScreen prompt the first time; choose "More info", then "Run anyway".

### Restart / recovery

- Restart routing is driven from the engine snapshot.
- Machines with completed commissioning route back to `dashboard`.
- Clean-start or reset machines route back to `commissioning`.
- Corrupt storage, runtime-path failures, and protocol mismatches surface recovery details through the native health and support snapshots.
- If the hardware link stops during a session (the display reads `THE HARDWARE LINK STOPPED`, code `ENGINE_EXITED`), Studio Control restarts it on its own: one, two and four seconds after the first, second and third stop within five minutes. A fourth stop within those five minutes stays on the recovery surface; use Retry startup once the desk and the rig are ready, and export diagnostics if it keeps stopping.
- One Studio Control runs per workstation. Launching it again brings the running window to the front. If the display reads `STUDIO CONTROL IS ALREADY OPEN` (code `ENGINE_ALREADY_RUNNING`), another copy — possibly one still closing — holds the app-data directory; close it, then start again.

### Keys

Studio Control binds no key of its own (2026-09 new pages, Slice 3): every action is a control on the screen or a key on the Stream Deck, and no screen shows a key or a key hint. The keyboard does what it does in any Windows program:

- Tab moves between controls; Enter or Space presses the control that has focus.
- Typing fills a field; Enter in a field confirms it, and Esc in a rename field puts the old name back.
- On a slider, fader or knob that has focus, the arrow keys move it one step, Home and End to its ends, and Page Up and Page Down a larger step where it has one (the Console's knobs and plate sliders and Lighting's sliders do; the strip faders and the Main level do not); Enter opens its typed entry where it has one (the strip faders, the knobs, the Grand master, a fixture's sliders), and typed entry offers "Reset to <default>". A talent mark that has focus moves 0.1 m with the arrow keys.
- Esc closes a dialog, a right-click menu, the colour picker and the search field's Recent list, and cancels an armed key.

The web view's own keys are switched off, so F5, Ctrl+R and Ctrl+Shift+R never reload the screen during a show, and the find, print, zoom and back keys do nothing; copy, paste and select-all still work in fields. Alt+F4 still asks "Close Studio Control?". Studio Control always fills its screen; there is no windowed layout. It opens on the screen it was last on; if that screen is not connected, on the studio monitor (and with neither connected, on the screen Windows gives it). The window keys are in Setup / Support › Workstation: **Studio fullscreen** puts Studio Control fullscreen on the studio monitor, and **Reset the window layout** does the same and forgets the screen it was last on. **Reset the window layout** is on the recovery screens too.

## Lighting Output

The engine streams the lighting state to the commissioned bridge as unicast sACN (ANSI E1.31) on UDP `5568`.

- Output is active only while all three hold: lighting is enabled, the commissioned bridge IP is a valid IPv4 address, and at least one fixture is patched.
- While active, the engine transmits the current state continuously: changed frames within one 40 ms tick, unchanged frames re-sent as keep-alives about every 800 ms. Scene fades, the grand master, and identify/highlight/solo overlays are rendered into the wire exactly as the DMX monitor shows them.
- This is an intentional live-state write on engine start: when the app launches with commissioned lighting and armed light outputs, the rig immediately receives the persisted fixture state. Review fixture on/off state before launch if the studio must stay dark — or start held ("Holding the light outputs" below) and look first.
- When output becomes ineligible (lighting toggled off, bridge cleared, all fixtures deleted), the engine sends E1.31 stream-terminated packets and stops. Fixtures then hold their last received levels per DMX convention; use Cut all or fixture controls to black out before disabling output.
- The bridge must be configured to route the app's sACN universe to its DMX/CRMX output, and each physical fixture must match the patched DMX address, mode, and universe shown on the lighting page.
- The Stream Deck's lighting keys do what the same control on the Lighting page does, and the page follows a key at once. While Preview is on, a key changes the preview and not the light output: the deck's intensity and colour temperature displays show the previewed number with `PREVIEW` on a third line, and Recall loads the scene into the preview. With Preview off the keys move the rig. A key and the page pressed at the same moment both take effect; neither overwrites the other.
- A change reaches the light output within one 40 ms tick of being stored. A changed bridge address or universe is picked up the same way; anything that changed the saved data without going through the app is picked up within two seconds.

### Holding the light outputs (safe start)

Setup / Support › Workstation has a **Light outputs** switch: **Armed** (the default, and what every launch was before the switch existed) or **Held** (2026-09 production readiness, Slice 11).

- **Held means nothing is sent to the rig** — no frame, no keep-alive. A launch that starts held puts no sACN packet on the wire at all. Holding while the app is streaming ends the stream the way a receiver expects: three stream-terminated packets per universe, then silence.
- **Held is not a blackout.** The rig keeps its last look, or does whatever the bridge does when its source goes away (the Apollo Bridge holds the last levels). To make the room dark, use Cut all _while armed_, then hold.
- Everything else keeps working while held: scenes recall, fixtures move, the Stream Deck's lighting keys act, and the DMX monitor shows **what would be sent**. While held, the monitor and the wire differ on purpose — that is what lets you look before anything reaches the rig. The header's Lighting lamp reads `held` on every workspace, and the switch says `nothing is sent to the rig`.
- Arming sends the current state within one 40 ms tick. Look at the Lighting page and the DMX monitor first: what they show is what the rig gets.
- **Safe start:** start Studio Control with the environment variable `SSE_SAFE_START=1` and it holds the light outputs before anything could stream. For the installed app on Windows, either set it for the workstation account once (`setx SSE_SAFE_START 1` in a Command Prompt, then start the app again; remove it with `reg delete HKCU\Environment /v SSE_SAFE_START /f`), or keep a second shortcut whose target is `cmd /c "set SSE_SAFE_START=1 && start "" "<path to the installed Studio Control executable>""`. `0`, `false`, `off`, `no` and an empty value mean no; anything else holds.
- **The hold is remembered.** A safe start writes the hold into the saved data, and only the switch arms again: the next launch without the variable is still held, and an operator who held the rig and closed the app finds it held. A launch never arms on its own. With the variable set for the account, every launch starts held and you arm each session from Setup / Support.
- **A restore never arms a held rig, and never holds an armed one.** A backup archive does not carry the switch, and restoring one leaves it as it is. A database restore replaces the whole saved data, so Studio Control carries the switch over from the database it replaces. The one case it cannot: a restore from the recovery surface after the saved data failed its check — the old database cannot be read, so the restored database's own setting stands. Start with `SSE_SAFE_START=1` if that restart must not stream.
- The hold, the arming and a safe start are rows in Recent actions (below), and `engine.log` says `Light outputs held` / `Light outputs armed` when the output follows.

## Operator Recovery

### Lights stop responding

1. Look at the header's Lighting lamp. `held` means the light outputs are held and nothing is sent: arm them from Setup / Support › Workstation ("Holding the light outputs" above).
2. Open the Lighting workspace and review the native health and lighting summaries.
3. Re-run the lighting commissioning probe if needed.
4. If the bridge is still unavailable, restart the app and confirm the same issue reproduces before changing hardware state.
5. Setup / Support › Recent actions says who last switched lights off or held the outputs — the screen, the Stream Deck, or the start of the app.

### Audio stops responding

1. Open the Audio workspace and read the state display down the left; it names the state, says what happened
   and what to do, and carries the key that does it. When everything is right it reads `VERIFIED`.
   - `NOT VERIFIED` — the audio probe has not passed since TotalMix's address or ports last changed in Setup. Every control on the Console is locked until it does; press **Run audio probe** on the state display.
   - `OFFLINE`, saying the app cannot see or change the desk — the last audio probe failed. Studio Control keeps that result and never runs the probe again on its own, so a probe that failed days ago still reads `OFFLINE` after TotalMix is back. Press **Run audio probe**.
   - `OFFLINE`, saying TotalMix is not sending meter data, or `STALE` — the probe passed, but no meter data has arrived from TotalMix for two seconds (`OFFLINE`) or for more than half a second (`STALE`). Work through the metering checklist below.
   - `DISCONNECTED` — TotalMix itself reports the interface is gone (`/status/connection 0`). Check the UFX III's USB link and power.
   - `ASSUMED` — a send was not confirmed by the desk within 1.5 s, or a recall was only partly confirmed. Press
     **Sync from TotalMix**: it pulls the desk's real state and never changes hardware.
   - `SYNC NEEDED` — the probe passed and TotalMix meters are arriving, but the desk has not been read since the link changed, so the meters wait (see "When the Console's meters stay still" below). Press **Sync from TotalMix** on the state display; it reads the desk and changes nothing.
   - `ACTION FAILED` with the code `AUDIO_TALKBACK_REFUSED` beside it — TotalMix has no talkback input channel assigned (see step 4 under Metering over Global OSC). Any other code there names the action that failed; its sentence says what to do.
2. Review the native health and audio summaries.
3. Confirm the TotalMix OSC checklists below still match the workstation (Global OSC remote 4 for control and metering, remotes 1-3 as the classic metering fallback).
4. Re-run the audio commissioning probe if needed.
5. If the desk is still unavailable, restart the app and confirm the failure is not limited to one session.

### When the Console's meters stay still

The Console moves its meters only while OSC control is on, the last action on it did not fail, and it knows what the desk is set to (2026-09 production readiness, seen on the workstation on 2026-09-21).

- **The desk counts as unread** after the audio probe passes for the first time, after TotalMix reported the interface gone and back, and after a Sync that got no answer or was cut short. Since 2026-09-23 the state display then reads `SYNC NEEDED`, "The desk has not been read since the link changed, so the meters wait. Press Sync from TotalMix — it reads the desk and changes nothing.", and carries the **Sync from TotalMix** key; before, it read `VERIFIED` with no key. `DISABLED`, `DISCONNECTED`, `OFFLINE`, `NOT VERIFIED`, `STALE`, `ASSUMED` and `ACTION FAILED` come before it. Press **Sync from TotalMix** once: it reads the desk without changing it, and the meters move from then on (a mix recall the desk confirms in full does the same). Studio Control keeps that confirmation when it is closed and opened again, so an ordinary restart does not ask for it.
- **A change the desk did not confirm** within 1.5 s leaves the display on `ASSUMED`, with the meters still until a Sync.
- **An action that failed** leaves the display on `ACTION FAILED`, with the meters stopped until the next action that works. No Sync is needed for that, though the display offers one.
- **The address and ports typed into Setup's probe fields** are saved by the probe itself and leave the confirmation as it was. (A change of TotalMix's address, ports or OSC switch through the audio settings request does count as unread and also resets the probe, so `NOT VERIFIED` shows until it passes again; no screen sends that request today.)

The Console's footer says what the meters are fed by and whether data is arriving: **Metering** `TotalMix · live` while meter data arrives (a meter message within the last half second), `stale` after half a second without one, `offline` after two seconds. It is measured, not assumed — but for a moment after the Console fetches its state it can read `live` until the next meter update, about a quarter of a second later, corrects it.

### RME TotalMix OSC Metering Checklist

The audio page is a control surface for the fixed RME Fireface UFX III workstation. Production meters are trusted only when live TotalMix OSC peak packets arrive. Metering prefers the Global OSC remote 4 described in the next section; the three classic remotes below remain the fallback and still feed the page-2 EQ path.

1. In TotalMix, configure three OSC remote slots for the app, each with IP `127.0.0.1` (the app reads the console at the TotalMix address set in Setup and nothing else):
   - slot 1: hardware inputs, outgoing to the app base receive port, incoming from the app base send port
   - slot 2: software playback, outgoing to app receive `+1`, incoming from app send `+1`
   - slot 3: hardware outputs, outgoing to app receive `+2`, incoming from app send `+2`
2. Enable `Send Peak Level` on all three TotalMix OSC slots.
3. Keep each slot on the expected bank/bus with enough faders per bank for the fixed surface mapping.
4. Run the audio commissioning probe. It passes only after mapped meter packets are received; a successful UDP bind alone is not verification. (Test benches that set `SSE_AUDIO_SIMULATED_INPUT_MODE=1` pass the probe without TotalMix and say so in the result.)
5. If the app reports `STALE` or `OFFLINE`, treat the displayed meters as unavailable until packet flow is restored. Do not trust simulated movement unless the UI explicitly shows simulated input mode.
6. Treat audio-page meters as live console channel-strip meters: the visible reference is `-18 dBFS`, meter-point over is separate from the latched channel clip state, and the operator can toggle or reset the held peak marks from the audio canvas peak controls.

The four receive ports the engine listens on (the base receive port and `+1`, `+2`, `+3` — `9001`–`9004` on the workstation) are bound to `127.0.0.1` whenever the TotalMix address in Setup is `127.0.0.1` or `localhost`, and to every interface only when TotalMix runs on another machine; in both cases only datagrams from that TotalMix address are read, and a packet from any other host is dropped and noted in the engine log (`WARN`, once a minute per source). TotalMix must therefore send to `127.0.0.1` — the remote IP in `Options → Settings → OSC` for every remote the app uses, which is how the workstation is commissioned — and `netstat -an | findstr 900` shows the four ports on `127.0.0.1` while the app runs (2026-09 production readiness, Slice 6).

### Audio Control Output

Audio-page edits are transmitted to TotalMix over the Global OSC remote (send port base `+3`, default `7004`), using RME's official Global OSC protocol (2026-07-21 table). Everything is addressed by 0-based hardware channel number, so the TotalMix mixer layout never shifts control targets, and every value is absolute state — app and console cannot invert against each other.

- The desk link reads the desk back. TotalMix does not echo a write to the remote that sent it, so after every send the engine asks for the touched channel (`/sendchan`, `/sendsubmix`) and marks the send **Confirmed** when the reply matches, **Adjusted** when the desk kept a different value (the desk wins), or unconfirmed after 1.5 s (badge `ASSUMED`, the count in the status line). Changes made in TotalMix itself flow into the app the same way (**External**, within about 200 ms). The `aligned` badge is written only after a complete pull or a fully confirmed push — never by an ordinary edit.
- **Sync from TotalMix = pull.** `/sendall` + `/sendstate` over remote 4, the answer is ingested, then `aligned`. Sync never changes hardware. `AUDIO_SYNC_NO_ECHO` means remote 4 did not answer: check it is In Use in Global OSC mode; `AUDIO_SYNC_INCOMPLETE` keeps what arrived and stays `unknown`.
- **Recall = push, except 48 V.** A snapshot recall sends mutes-on first, then faders, gains, polarity, solo and output levels, then mutes-off, then dim / mono, and waits for the confirmations; 48 V is never sent — differences are listed on the Console's signal canvas and each one is armed and confirmed
  per channel.
- **Gating.** While the audio probe has not passed — never run since the last change of TotalMix's address or ports, or failed the last time it ran — or OSC is switched off in Setup (the state display reads `NOT VERIFIED`, `OFFLINE` after a failed probe, or `DISABLED`), Studio Control refuses every write to the desk and the app and the deck disable the controls with the reason; app-local edits (names, snapshot slots, settings) stay allowed. A request with any invalid field is rejected before a single OSC message leaves.
- **Arm-then-apply** (48 V, snapshot recall, snapshot overwrite) needs a second press at least 350 ms after the first; held keys do not repeat.
- Channel faders ride `/mix/{in|pb}/{ch}/{out}/faderlin` (linear 0..1, the app's own fader scale; the dB the app prints for a position follows RME's published fader curve, unity at step 836 of 1023) to the requested submix — Main (out 0), Phones 1 (out 8), or Phones 2 (out 10). Output levels ride `/output/{ch}/faderlin`.
- Mute (`/input|playback|output/{ch}/mute`), solo (`/mix/{in|pb}/{ch}/0/solo`, main submix), phantom (`/input/{ch}/48v`), phase, pad, instrument, and auto-set are absolute 0/1 states.
- Dim, mono, and talkback are control-room functions (`/controlroom/dim|mainmono|talkback`) — sent for the main out, app-local for the phones targets.
- Talkback is momentary on every surface: hold the Talkback button in the app, or `TALK` on the deck. The app re-sends the hold every 750 ms and the engine releases 2 s after the last hold from any surface, so a dropped request, a closed window or an unplugged deck can never leave talkback open, and a click never latches. A graceful engine stop releases an active hold; a hard kill cannot — if the engine dies mid-hold, release talkback in TotalMix.
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
4. For talkback, assign the studio's talkback microphone as the Talkback input channel in `Options → Settings → Mixer` (TotalMix reports the choice as `/controlroom/talkchannel`; `-1` means none). With no channel assigned TotalMix ignores `/controlroom/talkback` from every remote and answers `0`; the Console's state display then reads `ACTION FAILED` with the code `AUDIO_TALKBACK_REFUSED` and this instruction, and the deck's `TALK` key never goes green. Found live on the studio UFX III on 2026-09-04 — the channel was unassigned.

### Stream Deck Audio Surface

When the app is on the Audio workspace, the Stream Deck+ is its physical control surface. Companion drives the deck from the generated profile; every deck action calls the same engine audio path as the Console does, so the desk, the app UI and the deck cannot disagree.

Layout of the AUDIO deck page:

- Keys, top row: `→ MAIN`, `→ PH 1`, `→ PH 2` set the active mix target (the same engine-persisted selection as the app's output strips — the tier header "Mix for →" and the deck always agree), and `BANK` cycles which strips the dials drive: inputs (the four front preamps) → playback (pairs 1-4) → outputs (Main / Phones 1 / Phones 2, fourth dial idle).
- Keys, bottom row: `DIM` toggles control-room dim on Main; `GAIN` switches the input dials between send-fader and whole-dB preamp gain; `TALK` is momentary talkback on Main (hold to talk — the engine auto-releases 2 s after the hold stops arriving, so a lost request can never leave talkback open); `SOLO CLR` clears every solo.
- Touch strip: one segment per strip — name, level in the same dB the on-screen fader shows, and a drawn fader-position bar with the unity notch at RME's 0 dB fader position (step 836 of 1023, about 82 % of the throw — the same curve the on-screen fader prints). The bar is position, not a level meter. After the 2026-09 fader-curve update, re-export the Companion profile from Setup and re-import it (Full Reset & Import) so the deck picks up the regenerated bar images. Muted strips drop to the ember palette with `MUTED`; the selected strip carries the `•` marker and the amber accent. Tapping a segment selects that channel in the app inspector (deliberately silent — strip swipes can register as taps).
- Dials: rotate rides the strip's level (`0.01` per detent, the step an arrow key gives a focused fader in the app; detents faster than 80 ms apply ×5); push toggles the strip's mute.

State color follows the app's Console vocabulary: the active mix-target key is solid amber, `TALK` turns green while live, `SOLO CLR` turns warn-yellow with the live count, `DIM` and `GAIN` go amber while engaged, and a non-input dial bank tints the `BANK` key. The colors come from Companion feedbacks on custom variables the engine publishes (`lcd_audio_state_*`, `lcd_audio_strip_N_state/level`); the bar graphics are PNG assets rendered by `scripts/deck-assets.py` and embedded in the exported profile.

Trust rules: deck actions pass the same gating as app commands — when audio is not verified, the strips show the reason (`AUDIO / NOT VERIFIED`), cells grey out, and actions are refused. The deck shows state, not meters, and has no snapshot or 48 V controls by design.

Deck freshness comes from the profile's `SSE audio LCD poll` trigger (1 s) plus per-action refreshes. The deck has two pages, LIGHTS (page 1) and AUDIO (page 2), and follows the app: `SSE follow app - lighting` turns it to LIGHTS when Lighting opens and refreshes the four LIGHTS texts as it arrives, and `SSE follow app - audio` turns it to AUDIO when the Console opens; Setup has no deck page, so the deck stays where it is. LIGHTS' `AUDIO >>` key turns the deck to AUDIO. Since the new pages program's Slice 2 there are no PROJECTS or TASKS pages: a profile exported before then must be exported again and imported with Full Reset & Import — until it is, its PROJECTS and TASKS keys are refused (`400`) and so are its page keys' requests (`501`), while Companion's own page turns still work.

The bridge answers only requests that carry this workstation's bridge token. The app creates the token once per install (`control-surface.token` in the app-data directory, next to the saved data) and writes it into every request of the exported Stream Deck profile — the keys, the dials and the LCD poll. A profile exported before 2026-09-10 carries no token, and Companion's requests are refused with `401`: export the profile again from Setup step 1 and import it with Full Reset & Import. The token is never shown on screen and is not part of a diagnostics export; the exported profile file contains it, so keep that file with the app-data directory and do not share it.

To commission or re-commission the deck:

1. Start Companion (it must be running so the export can bind the page-follow triggers to the physical Stream Deck — the export summary reports the bound surface id; without Companion running it falls back to `self` and page-follow will not move the deck).
2. In Setup step 1, download the Companion profile and import it in Companion's Import / Export page using **Full Reset & Import**. Do not use "Import Preserving Unselected": it keeps any existing generic-http connection and remaps the profile's actions onto that connection's old base URL, and the `$(SSE_Studio_Control:…)` display variables stop resolving.
3. Walk Setup steps 3-5: on Verify, press the physical controls and watch the matching cell pulse (the bridge stamps every action; the panel polls it live). The page keys (`AUDIO >>`) only turn Companion's page and send nothing to Studio Control, so they do not pulse.

### Control-surface bridge stops responding

1. Open Setup or Support and verify the control-surface base URL is present in native diagnostics.
2. If the app is up but the deck keys do nothing and Companion's log shows `401`, the Stream Deck profile predates the bridge token or was exported on another install: export it again from Setup step 1 and import it with Full Reset & Import.
3. Read the refusals in `engine.log` by their count, not by how often they appear. The app writes at most one line per refusal status per minute, and each line ends with how many more refusals with that status it stands for: `(1512 more with this status since the last such line)` means nearly every request is being refused, not one a minute. A `503` (`The bridge is busy with other requests`) means more requests arrived at once than the bridge holds. Since 2026-09-22 it holds the profile's worst moment, the once-a-second LCD poll meeting the busiest key, so a steady run of `503`s points at something else sending to the bridge.
4. If the bridge is unavailable, restart the app before changing deck mappings or network assumptions.
5. If the problem persists, collect diagnostics and confirm the host can still bind `127.0.0.1` on the configured control-surface port.
6. Reinstall the latest known-good native build only after preserving the app-data directory and the latest support backup.

### Saved data looks wrong or missing

1. Export a native support backup immediately if the app is still responsive.
2. In Setup / Support, Verify the latest known-good backup archive or database backup, then restore it.
3. Confirm the restore reports the rollback backup path it wrote before anything changed.

Planning left Studio Control in the new pages program (Slices 1 and 2, 2026-09), and its data with it: the first start of that build removes the projects, tasks, activity log and Planning settings from the saved data, behind a `pre-migration` copy (Data Safety below). A backup written before then still restores, without its Planning part; when it holds Planning data, Verify says so before you restore ("Its Planning data will not be restored; Planning is no longer part of Studio Control."), and the restore says so again after its own sentence ("Planning data in this backup was not restored; Planning is no longer part of Studio Control."). A saved page of Planning comes back as the Console. An export from the old Studio Control (a `db.json`) is no longer restored (new pages program, Slice 2b): Verify says "<file name> is an export from the old Studio Control (db.json); this version no longer restores those. Restore a backup archive or a database backup instead.", and Restore refuses it with the same sentence before anything is written, a rollback backup included. Any other JSON file that is not a backup archive is refused the same way ("<path> is not a Studio Control backup archive.").

### The app fails before the dashboard

1. Open the recovery surface.
2. Export diagnostics — the report lands in the app-data `exports` folder as `diagnostics-<UTC timestamp>.json`, and the Diagnostics key opens that folder — and note the Engine log path.
3. If the display reads `SAVED DATA NEEDS ATTENTION` (code `STORAGE_CORRUPT` or `STORAGE_MIGRATION_FAILED`), the database failed its integrity check or could not be upgraded. The sentence names the file and the newest database backup; the file itself was left untouched, and nothing was migrated. The hardware link stays up for exactly one job here (production readiness Slice 7): the recovery surface lists the backups folder — the JSON backup archives and the `db-<timestamp>-<reason>.sqlite3` database backups — and Restore latest, or a backup named in the Restore-from-path field, restores a database backup from it: the backup is checked first, Studio Control restarts its hardware link, and the restart moves the backup into place, keeping the damaged file as `backups/db-<timestamp>-replaced.sqlite3`. After `STORAGE_MIGRATION_FAILED` the newest `…-pre-migration.sqlite3` copy holds the data exactly as it was before the upgrade attempt. Only files inside the backups folder can be named; a backup from elsewhere is copied into that folder first (the Archive key opens it). A JSON backup archive cannot be applied while the saved data is unreadable — restore a database backup first, then the archive from Setup / Support if it is the newer one.
4. If the display reads `STUDIO CONTROL IS ALREADY OPEN` (code `ENGINE_ALREADY_RUNNING`), another copy of the app holds the app-data directory: find its window (a second launch brings it to the front), or wait for a copy that is still closing, then start again. Nothing was changed.
5. If startup still fails, reinstall the latest known-good native build without deleting the app-data directory.

### What the recovery screen says

The state display on the recovery screen names what happened in a word, says it in a sentence, and prints the code small beside it — the code is for a support ticket and for this table (2026-09 production readiness, Slices 3, 5, 7 and 9).

| The screen says                        | Code                                                    | What happened                                                         | What to do                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `SAVED DATA NEEDS ATTENTION`           | `STORAGE_CORRUPT`                                       | The saved data failed its check at start; the file was left as it was | Restore a database backup from the recovery surface ("The app fails before the dashboard", step 3)                                              |
| `SAVED DATA NEEDS ATTENTION`           | `STORAGE_MIGRATION_FAILED`                              | An upgrade of the saved data could not finish; nothing was changed    | The newest `…-pre-migration.sqlite3` backup holds the data as it was before the attempt; restore it and export diagnostics                      |
| `THE HARDWARE LINK STOPPED`            | `ENGINE_EXITED`                                         | The hardware link stopped during the session                          | Nothing: Studio Control restarts it on its own, three times in five minutes. After a fourth stop, Retry startup once the desk and rig are ready |
| `STUDIO CONTROL IS ALREADY OPEN`       | `ENGINE_ALREADY_RUNNING`                                | Another copy of the app holds the saved data                          | Use the window that is open (a second launch brings it to the front), or wait for a copy that is still closing                                  |
| `PROTOCOL MISMATCH`                    | `PROTOCOL_MISMATCH`                                     | The window and the hardware link come from different builds           | Install Studio Control again from one package: the window and the hardware link must be the same build                                          |
| `STARTUP FAILED`                       | `ENGINE_STARTUP_FAILED`, `ENGINE_READY_TIMEOUT`, others | The hardware link did not come up                                     | Export diagnostics, then Retry startup                                                                                                          |
| `THIS SCREEN STOPPED`                  | —                                                       | The window failed to draw                                             | Export diagnostics, then Reload; the desk, the rig and the deck keep their state                                                                |
| `LIGHTING STOPPED`, `AUDIO STOPPED`, … | —                                                       | One workspace failed to draw                                          | Reload this area; the rest keeps working ("When part of the screen stops" below)                                                                |

Two refusals come from Setup / Support rather than the recovery screen: `SUPPORT_RESTORE_UNSUPPORTED_VERSION` (the backup was written by a newer Studio Control; install that version, or pick an older backup) and `PATH_OUTSIDE_APP_DATA` (a folder key was asked for a folder outside Studio Control's own; nothing was opened). A Stream Deck profile exported before 2026-09-10 is refused with `401` in Companion's log ("Control-surface bridge stops responding" above).

## Data Safety

- Primary store: native SQLite database (`studio-control.sqlite3` in the app-data directory); every commit waits for the disk
- Integrity: the database is checked at every start; a file that fails the check stops the start-up at the recovery surface instead of being opened and migrated (`STORAGE_CORRUPT`, see above)
- Database backups: the app writes verified copies of the whole database to the app-data `backups` directory as `db-<UTC timestamp>-<reason>.sqlite3` — `pre-migration` before any schema upgrade (keeps 5), `daily` five minutes after start and every 24 h (keeps 14), `shutdown` at every graceful close (keeps 3), `pre-restore` before a database restore (keeps 5), and `replaced` for the file a database restore moved aside (keeps 5; the one copy the app never verified — it is whatever was there). Each verified copy is integrity-checked before it counts; a copy that fails is deleted
- Backup/export path: native support backup archives (commissioning, the lighting and audio settings, and every shell and Stream Deck setting, JSON, format 5 — since the new pages program's Slice 2 they carry no Planning; format 4 did) written under the same backup directory; the rollback archives a restore writes there (`native-pre-restore-*.json`) keep the last 5, and the diagnostics `exports` folder keeps thirty days
- Verify: Setup / Support's Verify latest (and Verify path) reads a backup without changing anything and says whether this app can restore it — a backup archive must be a format this app reads, a database backup must open and pass its integrity check with a schema this app knows; junk answers with the reason
- Restore path: from Setup / Support or the recovery surface, and only from files inside the backups folder — a JSON backup archive is applied in place (a `db.json` from the old Studio Control, or any other JSON file that is not a backup archive, is refused before anything is written; "Saved data looks wrong or missing" above); a database backup is checked, staged as `restore-pending.sqlite3` and applied by the restart Studio Control performs on its own ("The app fails before the dashboard" above). An archive or database written by a newer Studio Control is refused (`SUPPORT_RESTORE_UNSUPPORTED_VERSION`). A backup written before Planning left (an archive of format 4 or older, a database backup at schema 7 or older) restores without its Planning data: the archive's Planning part is skipped, and a database backup is upgraded to schema 8 by the restart that applies it ("Saved data looks wrong or missing" above)
- One file on a graceful close: while the app runs, the newest changes sit in the database's write-ahead log (`studio-control.sqlite3-wal`) beside the database; closing the app folds them into `studio-control.sqlite3` and empties the log. After a close that was not graceful (the process was ended, the power went) both files belong together — copy both, or start the app once and close it, before copying the database by hand. A database restore folds the log in before it moves the replaced file aside, so the `replaced` copy is complete either way
- Rollback safety: an archive restore writes a rollback archive first; a database restore writes a `pre-restore` database backup first and keeps the replaced file
- Upgrades are one-way for the saved data: a newer Studio Control upgrades the database at its first start (schema 7 added the action log; schema 8, from the new pages program's Slice 2, removes Planning's four tables and every Planning setting and turns a saved Planning page into the Console) and writes a `pre-migration` copy first; an older Studio Control then refuses the upgraded database ("newer than this engine binary"). Going back means reinstalling the older app and, with the app closed, putting that `pre-migration` copy in place of `studio-control.sqlite3` (delete `studio-control.sqlite3-wal` and `-shm` beside it) — everything recorded after the upgrade is lost

## Health Signals

### Health status

`health.snapshot`'s `status` says how the hardware link is doing, and it moves on its own (2026-09 production readiness, Slice 8): `ok`; `attention` when something could not bind its port — the Stream Deck bridge (`SSE_CONTROL_SURFACE_PORT`, `38201` by default: another program holds it, or a second copy of the app is still closing), a TotalMix meter port, the light-output socket; `warning` when the last database backup failed or is older than two days; `error` when the saved data is not usable (the recovery surface shows this one). Held light outputs are not a fault: the light-output entry stays `ok` and says `Light outputs held` in its sentence. The Setup / Support surface prints the health sentence when a commissioning probe is not green, and the Deck lamp in the monitor follows the bridge. A diagnostics export carries the whole snapshot, including `checks.engine` — one entry per subsystem with its state, the engine's sentence and when it was reported.

### Recent actions

Setup / Support lists the newest eight rows of the action log under **Recent actions**, newest first, each with who did it: **Screen** (a request from the app), **Stream Deck** (a key through the bridge), **Console** (a switch thrown at TotalMix that the desk reported back), **Watchdog** (talkback released because nobody held it) and **Start-up** (a safe start; a database restore applied at start). A diagnostics export carries the newest fifty; the saved data keeps the newest 5,000.

- A row is a discrete action that changed what a device receives: lights and groups on or off, Cut all, a scene recall, a palette, identify and highlight, a patch change, the bridge address, arming or holding the light outputs; mute, solo, 48 V, phase, pad, instrument, AutoSet, dim, mono, talkback, EQ and dynamics switches, a Console snapshot recall, the TotalMix address; an applied backup archive.
- A ride is not a row: a fader, a gain, an intensity, a colour temperature, the grand master, a Stream Deck dial detent. Neither is a change staged in the lighting Preview (it never reached the rig — the recall that later puts it there is a row), a refused action (the state display and `engine.log` carry those), or a selection.
- A row is written to disk before the action is confirmed, so the list survives a crash. It moves when Setup / Support is opened and when the Light outputs switch is used; it does not tick while you watch it.
- A database restore brings the restored database's own, older list; the start that applied it adds a Start-up row saying so.

### Logs

- `engine.log` in the logs folder (`SSE_LOG_DIR`, `<app-data>/logs` by default; the Diagnostics keys open it). It rotates at 5 MiB into `engine.log.1` … `engine.log.5`, newest first; the recovery surface and the diagnostics export carry its last 12 lines.
- `shell.log` beside it keeps everything the hardware link wrote to its standard error stream — the failures before its own log exists, a crash — with the same rotation. A release build has no console, so this file is the only place those lines go.
- `SSE_ENGINE_LOG_LEVEL` (`DEBUG`, `INFO`, `WARN`, `ERROR`; default `INFO`) sets what the engine writes; `DEBUG` adds one line per request with its timing, for a support session only.
- A warning at a start, "A db.json at <path> was left alone: Studio Control no longer imports db.json files." (new pages program, Slice 2b), means an old `db.json` is still staged at `<app-data>/import/db.json`, or is the file `SSE_LEGACY_DB_PATH` names (a variable naming no file is not mentioned); when both are there the one line names both ("A db.json at <a> and at <b> was left alone: …"). Nothing was read from either and the saved data is as it was; move the file out of the `import` folder, or delete the file or clear the variable, and the line goes.

### Engine snapshots

- `health.snapshot`
- `app.snapshot`
- `commissioning.snapshot`
- `lighting.snapshot`
- `audio.snapshot`
- `support.snapshot`

### When part of the screen stops

A workspace that fails to draw says so in its own area — `LIGHTING STOPPED`, `AUDIO STOPPED` — and the rest of Studio Control keeps working (2026-09 production readiness, Slice 9): the header, the lamps, the other tabs, the restart and close dialogs. Press **Reload this area**; if it stops again, carry on in the other workspaces and export diagnostics from Setup / Support. If the whole window shows `THIS SCREEN STOPPED`, press **Export diagnostics** and then **Reload**. Neither stops the hardware link: TotalMix keeps its state, the lights keep their levels and the Stream Deck keeps working while the screen comes back.

A band at the foot of the screen — "Studio Control hit a problem in the background" — means a request to the hardware link failed or an error was caught without anything on screen changing. It says how many and since when; **Dismiss** puts it away until the next one. One or two after a restart of the hardware link are expected. If it keeps coming back, export diagnostics from Setup / Support: the file lists each failure with its time.

### Shell indicators

- startup target and current workspace
- commissioning readiness and hardware profile
- lighting readiness, last scene recall, and fixture inventory summary
- audio readiness, last sync or recall state, and channel inventory summary
- support backup count, restore guidance, and recovery details

## Recommended Checks Before A Live Session

1. Launch the packaged native app and confirm it reaches the expected target surface, fullscreen on the studio monitor (display 3, 2560×1440 at 100 % scaling — the only size the app is built for). If it opens on the other screen, press **Reset the window layout** in Setup / Support › Workstation, on the right (or on the recovery screen, if Studio Control stopped there).
2. Confirm lighting, audio, and support summaries show the expected ready state; the header's Lighting lamp reads `held` if the light outputs are held.
3. Trigger a test light scene recall if lighting is in scope.
4. Confirm the Console's state display reads `VERIFIED` and its footer `Metering TotalMix · live` — not simulated, stale, or offline. If it reads `NOT VERIFIED` or `OFFLINE`, run the audio probe; if the meters stay still, press **Sync from TotalMix** ("When the Console's meters stay still" above).
5. Walk the desk link checklist below if audio is in scope.
6. Export a manual support backup before the session starts.

### Console link checklist before a live session

1. Move one fader and toggle one mute in TotalMix — the app strip follows within about a second (the link is reading the desk).
2. Press **Sync** — the toast reports the values pulled, the badge goes `aligned`, and nothing moves in TotalMix.
3. Recall the session's opening snapshot — the band reports "N values pushed, N confirmed"; any 48 V difference is listed by channel and is only applied when armed there.
4. Hold **Talkback** (or the deck's `TALK`) — TotalMix's talkback lights and clears on release. If the state display reads `ACTION FAILED` with the code `AUDIO_TALKBACK_REFUSED`, assign the talkback input channel in TotalMix first.
5. On the Stream Deck, `→ MAIN` / `DIM` / `TALK` mirror the app; the Companion profile must have been re-imported after the fader-curve update (Setup step 1, Full Reset & Import).

## Bridge Qualification

Release validation must prove the local control-surface bridge can bind, listen, and serve real HTTP requests on `127.0.0.1`.

- `npm run native:bridge:win:verify`

That lane starts the packaged engine on a dedicated localhost port, reads the bridge token it wrote, then verifies `/api/deck/context`, `/api/deck/lcd`, `/api/deck/light-action`, and `/api/deck/audio-action` against the live bridge with that token (`/api/deck/action`, the PROJECTS and TASKS keys' route, left with Planning in the new pages program's Slice 2). It then proves the refusals: a request without the token or with a wrong one (`401`), a browser `Origin` (`403`), a foreign `Host` (`400`), a body over 16 KiB (`413`), a body that stops arriving (`408` within the 1 s deadline), and a percent-encoded LCD key that must reach the handler decoded; and it exports the Stream Deck profile and checks that every one of its requests carries the token, that its pages are LIGHTS and AUDIO with a page-follow trigger for each, that its keys post only to the lighting and audio routes, and that the bridge answers every LCD it reads. Treat a bind failure or a failed refusal check as a release blocker, not as an acceptable warning.

For the current handoff state, use [docs/HANDOFF.md](./HANDOFF.md). The historical parity appendix is preserved at [docs/archive/NATIVE_PARITY_HANDOFF.md](./archive/NATIVE_PARITY_HANDOFF.md) for reference only.
