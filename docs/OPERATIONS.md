# Operating Studio Control

What the operator does at the screen and the Stream Deck. The devices and their set-up are in [HARDWARE.md](HARDWARE.md), the walk that verifies a build in [CHECKLIST.md](CHECKLIST.md).

## Before a session

1. Start TotalMix FX and Companion, and vMix when the cameras are used.
2. Start the verified build: `Studio Control.cmd` in the builds folder. It opens fullscreen on the studio display, on the page last used. (Until the first build is verified there, the studio's build is the one in `release\native\windows\` in the repository.)
3. On Audio's Console press `Sync from TotalMix`: after every start the Console reads `ASSUMED` until it has read the desk, and its meters wait.
4. Read the header's lamps. `Lighting`, `Audio`, `Prompter` and `Surface` should be green and read `ready`. `Cameras` reads `not set up` until the links to the cameras are built. `Prompter` reads `not connected` while the Prompter XL is unplugged.
5. Look up any other word under [When something goes wrong](#when-something-goes-wrong).
6. If `Lighting` reads `held`, nothing reaches the rig. Look at the Lighting page and its `DMX monitor`: that is what the rig will get. Then set `Light outputs` to `ARMED` in Setup / Support.
7. Press a key on the Stream Deck and watch the screen follow. No lamp shows whether the deck answers.

## The screen

**Header.** The tabs are `Setup / Support`, `Lighting`, `Audio`, `Cameras` and `Teleprompter`. Then comes one lamp for each subsystem, with its worst state as a word: green is fine, amber wants attention, red is a fault. Pressing a lamp opens Setup / Support.

- `Lighting`. `ready`: the bridge passed its last probe, and answers during the session. `not answering`: it has stopped answering (the app looks every 5 s); nothing is locked. `held`: nothing is sent to the rig. `unsaved`: the rig differs from the recalled scene. `no bridge`: the probe has not passed. `no output`: the light output could not open its port, so nothing reaches the rig; arming does not help, restarting the hardware link does.
- `Audio`. `ready`, or the Console's state in small letters, such as `sync needed`.
- `Cameras`. `ready`: all three are held. Otherwise the worst camera's state in small letters: `released`, `not set up`, `unreachable`. Today that is `not set up`.
- `Prompter`. `ready`: the Prompter XL shows Studio Control's window. Otherwise the Teleprompter's state in small letters, such as `not connected` or `not updated`.
- `Surface`. `ready`: Companion, with the profile and its token, asked the app in the last 5 s (it asks once a second, whether the Stream Deck is plugged in or not). `no deck`, amber: it has not; Companion may be closed, or its profile lacks the right token. Nothing locks. `unavailable`: the app could not open its port. That the deck itself answers, Setup's `Verify live echo` shows.
- `Backup`, amber, after the five, only while something is wrong: `failed` when the automatic backup could not be written, `overdue` when none has been written for two days. Pressing it opens Setup / Support, where the backups are.

A latch shows while something is on: `Scene drift unsaved`, `Solo latched`, `Prompter playing 3:12 left`, `REC CAM 1`. Pressing it opens its page. The clock comes last.

**Page.** The cluster on the left, the bay in the middle, the plate on the right. The state display, top left, says what is true in one word and one sentence, and offers the way out as a key. The footer holds the page's facts, such as `Metering TotalMix · live`.

**Keys.** Amber is switched on, green is running now, a red lamp is a hazard that is on. A dashed, dim key is locked: point at it to read why. A `press twice` key arms at the first press, reads `ARMED · press again` and counts down 4.5 s (3 s for the cameras' stop and for a press that would unpublish the setup). A second press, 0.35 s later at the earliest, applies it. `Esc` cancels.

**Keyboard.** No shortcuts. Tab, Enter and Space, typing, the arrows on a slider or a list, and `Esc` do what they do in any program.

## Lighting

The state display reads one of six words.

- `REACHABLE`: the bridge passed its last probe.
- `NOT ANSWERING`, amber: the bridge has stopped answering during the session (Studio Control looks every 5 s). Nothing is locked. Check the bridge's power and its network cable; the word clears by itself when the bridge answers again. Do not run the bridge probe during a session: a probe that fails locks the rig. When the light outputs are held as well, the sentence says so, and `Open Setup` goes to the `Light outputs` switch.
- `HELD`: the light outputs are held, and nothing is sent to the rig. `Open Setup` goes to the `Light outputs` switch.
- `UNSAVED`: the rig differs from the recalled scene. `Save changes` writes the rig into the scene. `Recall it again` puts the scene back.
- `PREVIEW`: `Preview` is on. You edit offline and the rig stays as it is. `Save into the scene` writes the preview into the scene; the rig changes when the scene is recalled. `Discard` drops the edits.
- `UNREACHABLE`: the bridge has not passed its probe, and the rig's controls are locked. `Open Setup`, run the bridge probe, publish again.

Held is not a blackout: the rig keeps its last look. Scenes and fixtures still move on screen. `DMX monitor` shows every channel as it is sent, or as it would be while held.

- **Recall** is one press on a scene. `Fade` sets the fade, 0 to 10 s.
- **Save.** `Save · press twice` arms at the first press and saves the rig as a new scene at the second. `New scene` does the same at one press. `Save changes` saves over the recalled scene at one press. `Undo` takes back a scene saved.
- **Scenes.** Right-click one to rename, pin or delete it. Deleting asks first.
- **All lights.** `LIGHTING` switches every fixture on or off. `CUT ALL` takes them all to off and asks first. `Grand master` is one level over them all.
- **Select** a fixture on the plot. While `Add to selection` is lit, a press adds or removes one and a dragged box adds several. Press a group to switch it on or off.
- **Set** the selection in the plate: `Turn on`, `Turn off`, `Intensity`, `Colour temperature`, `Palettes`. Double-click a slider to type a value.
- **Find a light.** `Identify` flashes one fixture, `Find` the selection in turn. `Highlight` holds the selection at full, `Solo` takes all others to off. Press the key again to end it.
- **Undo** takes back the newest of 25 steps: a scene saved or deleted, a fixture added or deleted. It takes back no recall and no level. It keeps its steps when you leave the page and come back, and forgets them at a restore or a restart of the hardware link, when the saved data they name may have changed. A step whose scene or fixture was deleted since, on the deck or on screen, or whose scene was renamed, is refused and says why.

## Audio (the Console)

- **Rows.** `Inputs` in banks of four, turned with the arrows on the heading; `Playback`; `Outputs`: the main output and the two phones.
- **Names.** Every strip carries TotalMix's name for its channel, and is renamed in TotalMix. A channel TotalMix names nothing keeps its own.
- **Mix target.** The faders set what each strip sends into the chosen output. `DIM` and `MONO` are `Main Out`'s, whichever output is the mix target: TotalMix has neither for the phones, so their strips show neither.
- **Strip.** A fader, `M` for mute, `S` for solo. Press a strip to open it in the plate.
- **48 V** is a hazard, armed for each channel: press twice. A red lamp means it is on.
- **Gain.** `GAIN` on a preamp's strip opens typed entry, 0 to 75 dB. The plate's knob rides it.
- **Solo and clip.** The cluster names the soloed strips, with `Clear all solo`. A clipped strip shows `CLIP`; `Clear clips` clears all.
- **Snapshots** are TotalMix's own eight, under the names TotalMix last saved (it saves them when it closes); one without a name reads `Slot 3`. `active` is the one TotalMix has loaded, `changed` that it changed since. Press a slot, then again while it reads `LOAD?`, to load it in TotalMix; the Console then reads the desk. A double-click only arms it. Snapshots are stored and named in TotalMix, and 48 V does not switch with one.
- **`Sync from TotalMix`** reads the desk and changes nothing on it.

The state display reads `VERIFIED` when the probe has passed, meter data arrives and the desk has been read. Otherwise:

| State           | It means                                                                                    | Way out                 |
| --------------- | ------------------------------------------------------------------------------------------- | ----------------------- |
| `SYNC NEEDED`   | The desk is unread since the link changed                                                   | `Sync from TotalMix`    |
| `ASSUMED`       | The app has just started, TotalMix was out of touch, or a change was not confirmed in 1.5 s | `Sync from TotalMix`    |
| `NOT VERIFIED`  | Probe not run; every control locked                                                         | `Run audio probe`       |
| `STALE`         | No meter data for half a second                                                             | `Run audio probe`       |
| `OFFLINE`       | Probe failed, or no meter data for 2 s                                                      | `Run audio probe`       |
| `DISCONNECTED`  | TotalMix reports the UFX III gone                                                           | Check its USB and power |
| `ACTION FAILED` | The last action failed                                                                      | Any action that works   |

The meters wait in `SYNC NEEDED`, `ASSUMED` and `ACTION FAILED`. The app never runs the probe by itself: `OFFLINE` stays after TotalMix is back, until you press `Run audio probe`. If it keeps failing, check TotalMix against [HARDWARE.md](HARDWARE.md).

TotalMix is out of touch when its remote 4 has stopped answering: remote 4 switched off in TotalMix, or TotalMix closed. Once it answers again the Console reads `ASSUMED` and says for how long, as a change made in TotalMix meanwhile may not have arrived; `Sync from TotalMix` reads the desk whole. When TotalMix was out of touch the state display says so and for how long, until the next action. After every start of the hardware link, a restart by itself, `Restart the hardware link…` and a database restore included, a Console that was `VERIFIED` or `ASSUMED` reads `ASSUMED` until the first Sync or load, as TotalMix may have changed meanwhile; its meters wait until then.

## Teleprompter

The presenter reads the script on the Prompter XL, in a window of Studio Control's own: the script on black, and nothing else. The page shows a copy of it, line for line.

- **The Prompter XL's window** opens by itself when the Prompter XL is plugged in, and shows what the prompter held, paused. It fills that screen and is shown on no other. It takes no keyboard and shows no pointer. It closes when the Prompter XL is unplugged, and when Studio Control closes.
- **`NOT CONNECTED`.** Windows does not see the Prompter XL. A text that scrolled is paused at its place, and `PLAY` is locked. Everything else works on the page's copy, and the place it sets is where the script comes back.
- **`DUPLICATED`.** Windows shows a copy of another screen on the Prompter XL. Nothing is drawn there. In Windows' display settings, choose Extend these displays.
- **`LOW RESOLUTION`.** Windows runs the Prompter XL below 1920×1080. The script is drawn, less sharp.
- **`NOT SHOWING`.** The window does not show, or its page does not draw. The reason stands in small type under `Prompter XL` in the plate. Studio Control opens the window again by itself every few seconds; a text that scrolled is paused.
- **When the hardware link stops,** the text on the Prompter XL stands where it was. After the restart it shows the saved place, paused.

- **Scripts.** `Open file…` reads a Word document (`.docx`) or a text file (`.txt`). `Paste as a new script` takes the clipboard. `New script` opens an empty one. The app keeps its own copy and never changes the file.
- **An import** keeps text, paragraphs, bold, italic and underline. Headings and text in square brackets become cues: directions, never read aloud. It says what it left out.
- **The list** is sorted by name, so number the scripts to order them. `Earlier versions` holds older texts. `Remove` moves a script to `Removed`.
- **Edit.** `Edit script` opens the selected script. It saves as you type: `Saved 14:02`. `Live copy` brings the glass back.
- **Put on.** `Put on the prompter` is one press while the prompter is blank. The script comes on paused, at its own place. `Replace on the prompter`, `Update the prompter` and `Clear the prompter` are press twice.
- **Update.** An edit to the script on the prompter stays in the app, and the state reads `NOT UPDATED`. An update keeps the same words at the reading line.
- **Run.** Only `PLAY` starts the scroll. `BACK` goes to the start of the paragraph at the reading line. `TOP` pauses and goes to the first line. At `END` the scroll stops.
- **Speed** is in words a minute, 40 to 300 in steps of 5. Each script keeps its own; a new one starts at 140.
- **Jump** by line, paragraph or cue, or press the script bar. A jump keeps the scroll as it was.
- **The look** is one for the glass and applies at once: text size, spacing, margins, reading line, colour.

## Cameras

The links to the real cameras are not built yet. In the studio's build every camera reads `NOT SET UP` and says that its link comes with a later version, and every control and `REC` are locked. The pictures come from vMix's Outputs 2, 3 and 4 over NDI while vMix runs and sends them; with vMix closed each picture's place reads `NO PICTURE` and the state display `NO PICTURES`. The rest of this section is how the page works with a camera that is held.

- **Select** a camera with its key on the left or its small picture. The big picture, the plate and the Stream Deck's dials follow. `REC` does not: it is always CAM 1's.
- **The Stream Deck's dials** set the selected camera. `Exposure`, `Colour` and `Focus` choose what they set, as the deck's `BANK` does. The line under them says what the dials set, or why they set nothing now.
- **Pictures.** The selected camera is big, the other two small. `Whole frame` shows all of it, at 87.5 %; `1:1` shows a part pixel for pixel. The loupe shows a part at `2:1` or `4:1`. Press the big picture to move the part.
- **Aids.** `Guides`, `Peaking` and `Zebras 95 %` are drawn on this screen only and never reach a camera, vMix or a recording. They are off at every start.
- **A picture that does not arrive** leaves its place empty with the reason in it, and the Pictures rows on the left read `no picture`. While the selected camera's is missing, `Whole frame`, `1:1`, the aids and the loupe are locked; the camera's own controls still work. When every camera is held, the state display reads `PICTURE MISSING` (vMix sends pictures, and none for that camera: check in vMix that its output, 2, 3 or 4, is on and sent over NDI) or `NO PICTURES`, and `Look again` looks once more.
- **Values.** An arrow steps a value at one press. A press on the value opens the list the camera allows, or typed entry for white balance and tint. `Auto iris once`, `Auto white balance once` and `Autofocus once` run once. A value a camera does not report says so.
- **Format and look.** Resolution, frame rate, dynamic range and the display LUT are press twice: the picture drops while the camera changes. A value the camera does not allow now is locked and says why.
- **Record.** `REC` starts CAM 1 at one press. While CAM 1 records the key has a red lamp, and the header shows `REC CAM 1` on every page. Stopping is press twice, the second within 3 s.
- **The take.** The length is Studio Control's own count, from a start it saw; of a take that ran before it looked, the length is not known. The timecode is CAM 1's. CAM 1 does not report its card time over Bluetooth.
- **Release**, press twice, hands the camera to the iPad (CAM 1) or to LUMIX Tether (CAM 2, CAM 3). Studio Control then neither reads it nor sends to it, and a take it records goes on. `Connect` takes it back.
- **The camera wins.** A change made on the camera shows on the page within about a second.
- **Recent** lists the five newest camera actions and who did each. `All actions…` opens Setup / Support, which lists the actions of every page.
- **`Read all cameras again`** reads the three once and sends nothing. **`Camera setup`** opens Setup / Support's `CAMERAS`.

The state display speaks of the camera that is worst off, and of the selected one among equals.

| State         | It means                                                       | Way out                                       |
| ------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `HELD`        | Studio Control reads the camera and sends only what you press  | None is needed                                |
| `RELEASED`    | It is handed over, and not read                                | `Connect`                                     |
| `NOT SET UP`  | No pairing or no address, or no link in this version           | `Camera setup`                                |
| `UNREACHABLE` | It does not answer; its last values are amber, its keys locked | Check that it is on and in reach; `Try again` |

While CAM 1 is `UNREACHABLE` after it reported recording, `REC` reads `last known: recording` and the stop is locked until it answers: the take is left as it was. Stop it on the camera if it must end.

## Stream Deck

A control on the deck does what the same control does on screen, and the screen follows. Putting the profile on the deck is in [HARDWARE.md](HARDWARE.md).

The deck follows the app: `Lighting` turns it to `LIGHTS`, `Audio` to `AUDIO`, `Cameras` to `CAMERAS` and `Teleprompter` to `PROMPTER`. Setup / Support has no page on the deck, which stays where it is. One key on each page turns the deck alone, to the next page and round again: `AUDIO >>`, `CAMS >>`, `PROMPTER >>`, `LIGHTS >>`.

**`LIGHTS`.** `Toggle` switches the chosen light, `All On` and `All Off` all of them. `Recall` recalls the chosen scene, `Save` saves the rig as a new scene, `Del Scene` deletes the chosen scene. `All Off` and `Del Scene` ask first: a press makes the key read `OFF?` or `DEL?`, and a second press within 3 s acts. If the chosen scene or Preview changed in between, the second press does nothing. Another key of the page ends the question, and the next press asks again. The other keys act at one press. A press of `Toggle` that arrives twice within a third of a second is one press. The dials `LIGHT` and `SCENE` choose by a turn; a push switches the light or recalls the scene. `INTENSITY` moves 5 % a step and `CCT` 200 K; a push sets 100 % or 4500 K. While Preview is on they change the preview, and the strip reads `PREVIEW`.

**`AUDIO`.** `MAIN`, `PH 1` and `PH 2` choose the mix target. `BANK` puts the dials on inputs, playback or outputs. `DIM` dims `Main Out`. `GAIN` turns the input dials from send level to preamp gain. `SOLO` clears every solo. A dial's turn sets the level and its push mutes. A press of `DIM`, or a push that mutes, that arrives twice within a third of a second is one press. The strip shows name, level and the fader's position; it is not a meter.

**`CAMERAS`.** `CAM 1`, `CAM 2` and `CAM 3` select the camera, as on the page. `BANK` puts the dials on exposure (ISO, shutter, iris, ND), colour (white balance, tint) or focus, in turn, and the strip shows what each dial sets and the camera's value. A turn is one of the camera's own steps. On focus, a push of the first dial is autofocus once. Until the cameras' links are built every key but `BANK` and the three cameras' is refused, as the page's controls are locked.

`REC` is CAM 1's whichever camera is selected. One press starts. While CAM 1 records the key has a red lamp; a press makes it read `STOP?`, and a second press within 3 s stops. A press that arrives twice within a third of a second is one press. The key can read `STOP?` for up to a second after the 3 s: a press then arms the stop again, and the next stops. If the take ended meanwhile, on the camera or from the screen, the press does nothing, and the next starts a take.

**`PROMPTER`.** `PLAY` plays or pauses; a press that arrives twice within a third of a second is one press. `BACK`, `TOP`, `CUE <` and `CUE >` jump as on the page. The dials are speed (a push plays or pauses), position by line, text size (a push returns to the standard size) and paragraph. The strip shows the speed, the place, the time left and the script's name. While nothing is on the prompter every control is grey and does nothing. Until the Prompter XL's window is built `PLAY` is grey and the strip reads `XL NOT CONNECTED`; the jumps, the speed and the size work. A script is put on, replaced, updated and cleared on the screen only.

**Colours.** Amber: chosen or switched on, and the questions `STOP?`, `OFF?` and `DEL?`. Yellow `SOLO`: a solo is on. Green: running now, which is `PLAY` while the text scrolls. A red lamp: CAM 1 records. Amber words on the `CAMERAS` strip, and an amber lamp on `REC`: the last a camera reported before it stopped answering. Grey: locked, as on screen; the `AUDIO` strip gives the reason.

## Setup / Support

`RUNNER`, `SUPPORT` and `CAMERAS` choose what the bay shows. The plate on the right is always Support. `CONSOLE` opens the Console.

**The runner's steps**

1. `Import profile` exports the Stream Deck's profile for Companion.
2. `Probe hardware` holds the bridge's and TotalMix's addresses and runs the probes. The deck's probe passes when Companion asked the app in the last 5 s: start Companion with the profile imported first. A probe that failed stays failed until the probes run again, even after the lamp turns `ready`: Setup reads `SETUP REQUIRED` before a publish, `DEGRADED` after one with the override. On a published setup, running the probes again unpublishes it first (below).
3. `Map bindings` shows the deck's four pages as the app holds them: the keys and the strip where the deck has them, each dial under its cell of the strip.
4. `Verify live echo`: a control pressed on the deck pulses on screen. A key of another page turns the screen to that page.
5. `Publish` unlocks the pages, exports a backup and opens the Console. Over a probe that is not green it asks first and records it.

On a published setup, a press on a step, on `Back to …` or on `Run all probes` arms first: the state display says that `Lighting`, `Audio`, `Cameras` and `Teleprompter` would lock, and a second press within 3 s unpublishes the setup. They stay locked until `Publish setup` is pressed again. The devices and the deck keep working. A press on `Publish`, the step a published setup stands on, does nothing. Leave the runner alone during a session; the Console has its own `Run audio probe`.

**Workstation.** `UI scale` is 90, 100, 110 or 125 %. `Studio fullscreen` puts the window fullscreen on the studio display; `Reset the window layout` also forgets where it was last. `Light outputs` is `ARMED` or `HELD`; arming sends the current state at once. `Prompter XL` shows what Windows reports.

**Cameras.** `CAMERAS` holds what Studio Control needs for each camera: CAM 1's pairing and CAM 2's and CAM 3's addresses. It names the vMix output each picture comes from, CAM 1 Output 2, CAM 2 Output 3 and CAM 3 Output 4, which are set in vMix and not here. Saving sends nothing to a camera. `Forget` removes a pairing or an address. Studio Control contacts only an address entered here. Until a camera's link is built its pairing and its address are locked.

**Backups.** `Export backup` writes a backup archive. `Verify latest` checks the newest backup and changes nothing. `Restore latest` restores it. The Support screen lists every backup: press one, then `Verify path` or `Restore path`. A restore asks first and says what it replaces: a database backup replaces all the saved data, a backup archive the settings, and adds its scripts. It keeps a copy of what it replaced. A database backup restarts the hardware link. Every restore comes back with the light outputs held: arm them with `Light outputs` when the rig should follow.

**Diagnostics.** `Export diagnostics` writes a report. `Open the log` opens the log.

**Recent actions** lists the last eight actions that changed what a device receives, and who did each: `Screen`, `Stream Deck`, `Console` (a switch thrown at TotalMix) or `Start-up`. Faders and dials are not listed.

**`Restart the hardware link…`** asks first. The link and the deck drop for a few seconds; TotalMix and the lights keep their state, and the Console reads `ASSUMED` until `Sync from TotalMix`.

## When something goes wrong

| You see                      | It means                    | Do this                               |
| ---------------------------- | --------------------------- | ------------------------------------- |
| `SAVED DATA NEEDS ATTENTION` | The saved data is damaged   | `Restore latest` on that screen       |
| `THE HARDWARE LINK STOPPED`  | It stopped in the session   | Wait; after 4 stops, `Retry startup`  |
| Another word at the start    | The link did not start      | `Export diagnostics`, `Retry startup` |
| `AUDIO STOPPED` and the like | A page failed to draw       | `Reload this area`                    |
| A device does not follow     | The link may be stuck       | `Restart the hardware link…`          |
| Lighting `held`              | Nothing reaches the rig     | `Light outputs` to `ARMED`            |
| Lighting `no output`         | The output's port is taken  | `Restart the hardware link…`          |
| `Backup failed` or `overdue` | No automatic backup written | `Export backup`; check disk space     |
| Lighting `no bridge`         | Its probe has not passed    | Run it in Setup, then publish         |
| Lighting `not answering`     | The bridge went silent      | Check its power and network cable     |
| Rig dark, Lighting `ready`   | The rig does not follow     | Check the fixtures, patch, routing    |
| Audio amber or red           | Console not `VERIFIED`      | Use the key on its state display      |
| Cameras amber or red         | A camera is not `HELD`      | Use the key on its state display      |
| Surface `unavailable`        | The deck's port is taken    | Close what holds it, restart the link |
| Surface `no deck`            | Companion stopped asking    | Start Companion; import the profile   |
| The deck does nothing        | Companion is closed         | Start Companion                       |
| `401` in Companion's log     | The profile is refused      | Import the profile again              |
| Wrong display                | It opened where it was last | `Reset the window layout`             |
| Tabs locked                  | The setup is not published  | `Publish setup` in Setup / Support    |

The hardware link restarts by itself after a stop, three times in five minutes; the Console then reads `ASSUMED` until `Sync from TotalMix`. At the recovery screen only a database backup restores: `Restore latest`, which takes the newest database backup, or press one in the list and `Restore path`. It asks first. The link restarts into it, with the light outputs held.

Closing asks first. It resets and recalls nothing: TotalMix keeps its state, the light output stops and the fixtures hold their last levels.

## Saved data

Everything is in `%APPDATA%\ExEd Studio Control Native`: the database, and the `backups`, `exports` and `logs` folders.

The app backs the database up by itself and checks every copy: before it upgrades the saved data, daily, at every clean close and before a restore. It keeps the last 5, 14, 3 and 5 of them. `Export backup` adds a backup archive: the setup, the lighting and audio settings, the deck's settings and the scripts.

A newer build upgrades the saved data at its first start. An older build then refuses it. Going back means putting the backup from before the upgrade in place of the database, by hand and with the app closed. What was saved after the upgrade is lost.

Never delete the `backups` folder. It is the only way back.
