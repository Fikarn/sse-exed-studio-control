# Operating Studio Control

What the operator does at the screen and the Stream Deck. The devices and their set-up are in [HARDWARE.md](HARDWARE.md), the walk that verifies a build in [CHECKLIST.md](CHECKLIST.md).

## Before a session

1. Start TotalMix FX and Companion, and vMix when the cameras are used.
2. Start the verified build. It opens fullscreen on the studio display, on the page last used.
3. Read the header's lamps. `Lighting`, `Audio` and `Surface` should be green and read `ready`. `Prompter` reads `not connected` until the Prompter XL's window is built.
4. Look up any other word under [When something goes wrong](#when-something-goes-wrong).
5. If `Lighting` reads `held`, nothing reaches the rig. Look at the Lighting page and its `DMX monitor`: that is what the rig will get. Then set `Light outputs` to `ARMED` in Setup / Support.
6. Press a key on the Stream Deck and watch the screen follow. No lamp shows whether the deck answers.

## The screen

**Header.** The tabs are `Setup / Support`, `Lighting`, `Audio` and `Teleprompter`. Then comes one lamp for each subsystem, with its worst state as a word: green is fine, amber wants attention, red is a fault. Pressing a lamp opens Setup / Support.

- `Lighting`. `ready`: the bridge passed its last probe; the app never checks the bridge by itself. `held`: nothing is sent to the rig. `unsaved`: the rig differs from the recalled scene. `no bridge`: the probe has not passed.
- `Audio`. `ready`, or the Console's state in small letters, such as `sync needed`.
- `Prompter`. `ready`, or the Teleprompter's state in small letters. Today that is `not connected`.
- `Surface`. `ready`: the app listens for the Stream Deck. `unavailable`: it could not open its port.

A latch shows while something is on: `Scene drift unsaved`, `Solo latched`, `Prompter playing 3:12 left`. Pressing it opens its page. The clock comes last.

**Page.** The cluster on the left, the bay in the middle, the plate on the right. The state display, top left, says what is true in one word and one sentence, and offers the way out as a key. The footer holds the page's facts, such as `Metering TotalMix · live`.

**Keys.** Amber is switched on, green is running now, a red lamp is a hazard that is on. A dashed, dim key is locked: point at it to read why. A `press twice` key arms at the first press, reads `ARMED · press again` and counts down 4.5 s. A second press, 0.35 s later at the earliest, applies it. `Esc` cancels.

**Keyboard.** No shortcuts. Tab, Enter and Space, typing, the arrows on a slider or a list, and `Esc` do what they do in any program.

## Lighting

The state display reads one of four words.

- `REACHABLE`: the bridge passed its last probe. It reads so while the outputs are held too: only the header's lamp says `held`.
- `UNSAVED`: the rig differs from the recalled scene. `Save changes` writes the rig into the scene. `Recall it again` puts the scene back.
- `PREVIEW`: `Preview` is on. You edit offline and the rig stays as it is. `Save to the rig` writes the preview into the scene; the rig changes when the scene is recalled. `Discard` drops the edits.
- `UNREACHABLE`: the bridge has not passed its probe, and the rig's controls are locked. `Open Setup`, run the bridge probe, publish again.

Held is not a blackout: the rig keeps its last look. Scenes and fixtures still move on screen. `DMX monitor` shows every channel as it is sent, or as it would be while held.

- **Recall** is one press on a scene. `Fade` sets the fade, 0 to 10 s.
- **Save.** `Save · press twice` and `New scene` save the rig as a new scene. `Save changes` saves over the recalled one. Each acts at the first press: no key on this page arms.
- **Scenes.** Right-click one to rename, pin or delete it. Deleting asks first.
- **All lights.** `LIGHTING` switches every fixture on or off. `CUT ALL` takes them all to off and asks first. `Grand master` is one level over them all.
- **Select** a fixture on the plot. While `Add to selection` is lit, a press adds or removes one and a dragged box adds several. Press a group to switch it on or off.
- **Set** the selection in the plate: `Turn on`, `Turn off`, `Intensity`, `Colour temperature`, `Palettes`. Double-click a slider to type a value.
- **Find a light.** `Identify` flashes one fixture, `Find` the selection in turn. `Highlight` holds the selection at full, `Solo` takes all others to off. Press the key again to end it.
- **Undo** takes back the newest of 25 steps: a scene saved or deleted, a fixture added or deleted. It takes back no recall and no level, and forgets its steps when you leave the page.

## Audio (the Console)

- **Rows.** `Inputs` in banks of four, turned with the arrows on the heading; `Playback`; `Outputs`: `Main Out`, `Phones 1`, `Phones 2`.
- **Mix target.** The faders set what each strip sends into the chosen output. `DIM` and `MONO` reach the desk only for `Main Out`.
- **Strip.** A fader, `M` for mute, `S` for solo. Press a strip to open it in the plate.
- **48 V** is a hazard, armed for each channel: press twice. A red lamp means it is on.
- **Gain.** `GAIN` on a preamp's strip opens typed entry, 0 to 75 dB. The plate's knob rides it.
- **Solo and clip.** The cluster names the soloed strips, with `Clear all solo`. A clipped strip shows `CLIP`; `Clear clips` clears all.
- **Snapshots.** Eight slots. `Capture` fills the first empty one. Recall is press twice. Point at a slot to see what it would change, and to save over it (press twice), rename or delete it.
- **A recall** reports `12 values pushed, 12 confirmed`. It never sends 48 V: each difference is listed with its own `Arm 48 V` key.
- **`Sync from TotalMix`** reads the desk and changes nothing on it.

The state display reads `VERIFIED` when the probe has passed, meter data arrives and the desk has been read. Otherwise:

| State           | It means                                  | Way out                 |
| --------------- | ----------------------------------------- | ----------------------- |
| `SYNC NEEDED`   | The desk is unread since the link changed | `Sync from TotalMix`    |
| `ASSUMED`       | A change was not confirmed in 1.5 s       | `Sync from TotalMix`    |
| `NOT VERIFIED`  | Probe not run; every control locked       | `Run audio probe`       |
| `STALE`         | No meter data for half a second           | `Run audio probe`       |
| `OFFLINE`       | Probe failed, or no meter data for 2 s    | `Run audio probe`       |
| `DISCONNECTED`  | TotalMix reports the UFX III gone         | Check its USB and power |
| `ACTION FAILED` | The last action failed                    | Any action that works   |

The meters wait in `SYNC NEEDED`, `ASSUMED` and `ACTION FAILED`. The app never runs the probe by itself: `OFFLINE` stays after TotalMix is back, until you press `Run audio probe`. If it keeps failing, check TotalMix against [HARDWARE.md](HARDWARE.md).

## Teleprompter

The Prompter XL's own window is not built yet, so the page reads `NOT CONNECTED` and `PLAY` is locked. Everything else works on the page's copy of the glass.

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

Not built yet.

## Stream Deck

A control on the deck does what the same control does on screen, and the screen follows. Putting the profile on the deck is in [HARDWARE.md](HARDWARE.md).

The deck follows the app: `Lighting` turns it to `LIGHTS`, `Audio` to `AUDIO`. The other pages have no deck page yet. `AUDIO >>` turns the deck alone.

**`LIGHTS`.** `Toggle` switches the chosen light, `All On` and `All Off` all of them. `Recall` recalls the chosen scene, `Save` saves the rig as a new scene, `Del Scene` deletes the chosen scene. Every key acts at one press and asks nothing. The dials `LIGHT` and `SCENE` choose by a turn; a push switches the light or recalls the scene. `INTENSITY` moves 5 % a step and `CCT` 200 K; a push sets 100 % or 4500 K. While Preview is on they change the preview, and the strip reads `PREVIEW`.

**`AUDIO`.** `MAIN`, `PH 1` and `PH 2` choose the mix target. `BANK` puts the dials on inputs, playback or outputs. `DIM` dims `Main Out`. `GAIN` turns the input dials from send level to preamp gain. `SOLO` clears every solo. A dial's turn sets the level and its push mutes. The strip shows name, level and the fader's position; it is not a meter.

**Colours.** Amber: chosen or switched on. Yellow `SOLO`: a solo is on. Grey, with `AUDIO` and a reason on the strip: locked, as the Console is. Green means running now; no key on the deck uses it yet.

## Setup / Support

`RUNNER` and `SUPPORT` choose what the bay shows. The plate on the right is always Support. `CONSOLE` opens the Console.

**The runner's steps**

1. `Import profile` exports the Stream Deck's profile for Companion.
2. `Probe hardware` holds the bridge's and TotalMix's addresses and runs the probes. The deck's probe does not reach the deck.
3. `Map bindings` shows the deck's pages, keys and dials as the app holds them.
4. `Verify live echo`: a control pressed on the deck pulses on screen.
5. `Publish` unlocks the pages, exports a backup and opens the Console. Over a probe that is not green it asks first and records it.

A press on a step or on `Run all probes` unpublishes the setup at once: `Lighting`, `Audio` and `Teleprompter` lock until `Publish setup` is pressed again. The devices and the deck keep working. Leave the runner alone during a session; the Console has its own `Run audio probe`.

**Workstation.** `UI scale` is 90, 100, 110 or 125 %. `Studio fullscreen` puts the window fullscreen on the studio display; `Reset the window layout` also forgets where it was last. `Light outputs` is `ARMED` or `HELD`; arming sends the current state at once. `Prompter XL` shows what Windows reports.

**Backups.** `Export backup` writes a backup archive. `Verify latest` checks the newest backup and changes nothing. `Restore latest` restores it, at one press. The Support screen lists every backup: press one, then `Verify path` or `Restore path`. A restore replaces the saved data and keeps a copy of what it replaced. A database backup restarts the hardware link. The light outputs stay armed or held as they were.

**Diagnostics.** `Export diagnostics` writes a report. `Engine log` opens the log.

**Recent actions** lists the last eight actions that changed what a device receives, and who did each: `Screen`, `Stream Deck`, `Console` (a switch thrown at TotalMix) or `Start-up`. Faders and dials are not listed.

**`Restart the hardware link…`** asks first. The link and the deck drop for a few seconds; TotalMix and the lights keep their state.

## When something goes wrong

| You see                      | It means                    | Do this                               |
| ---------------------------- | --------------------------- | ------------------------------------- |
| `SAVED DATA NEEDS ATTENTION` | The saved data is damaged   | `Restore latest` on that screen       |
| `THE HARDWARE LINK STOPPED`  | It stopped in the session   | Wait; after 4 stops, `Retry startup`  |
| Another word at the start    | The link did not start      | `Export diagnostics`, `Retry startup` |
| `AUDIO STOPPED` and the like | A page failed to draw       | `Reload this area`                    |
| A device does not follow     | The link may be stuck       | `Restart the hardware link…`          |
| Lighting `held`              | Nothing reaches the rig     | `Light outputs` to `ARMED`            |
| Lighting `no bridge`         | Its probe has not passed    | Run it in Setup, then publish         |
| Rig dark, Lighting `ready`   | The probe may be old        | Check the bridge's power and cable    |
| Audio amber or red           | Console not `VERIFIED`      | Use the key on its state display      |
| Surface `unavailable`        | The deck's port is taken    | Close what holds it, restart the link |
| The deck does nothing        | Companion is closed         | Start Companion                       |
| `401` in Companion's log     | The profile is refused      | Import the profile again              |
| Wrong display                | It opened where it was last | `Reset the window layout`             |
| Tabs locked                  | The setup is not published  | `Publish setup` in Setup / Support    |

The hardware link restarts by itself after a stop, three times in five minutes. At the recovery screen only a database backup restores: `Restore latest`, or press one in the list and `Restore path`. The link restarts into it, with the light outputs armed or held as that backup had them.

Closing asks first. It resets and recalls nothing: TotalMix keeps its state, the light output stops and the fixtures hold their last levels.

## Saved data

Everything is in `%APPDATA%\ExEd Studio Control Native`: the database, and the `backups`, `exports` and `logs` folders.

The app backs the database up by itself and checks every copy: before it upgrades the saved data, daily, at every clean close and before a restore. It keeps the last 5, 14, 3 and 5 of them. `Export backup` adds a backup archive: the setup, the lighting and audio settings, the deck's settings and the scripts.

A newer build upgrades the saved data at its first start. An older build then refuses it. Going back means putting the backup from before the upgrade in place of the database, by hand and with the app closed. What was saved after the upgrade is lost.

Never delete the `backups` folder. It is the only way back.
