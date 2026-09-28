# The studio walk

The owner walks this list with a studio build, on the real hardware: `npm run release` makes one and says where it is. A build that passes is made the studio's with `npm run release:verified`, and is then the verified build the studio runs.
Walk everything for a build that changes saved data or devices. Otherwise walk the parts the changes touch, plus "Start and window".

## Start and window

- [ ] The app opens fullscreen on the studio display (2560×1440), also after a restart and the first time after an older build.
- [ ] Starting it a second time brings the same window forward.
- [ ] F5, Ctrl+R, Ctrl+Shift+R, Ctrl+P and Ctrl+F do nothing.
- [ ] Esc closes a dialog and cancels an armed key.
- [ ] Alt+F4 asks first; Cancel keeps the session, and Confirm leaves no `studio-control-engine.exe` in Task Manager.
- [ ] The tabs are Setup / Support, Lighting, Audio, Cameras and Teleprompter, and nothing says Planning.
- [ ] Setup's `CONSOLE` key opens the Console.
- [ ] `Studio fullscreen` and `Reset the window layout`, in Setup / Support › Workstation, each put the window back fullscreen.
- [ ] From the chair, the header is one row and every lamp can be read, in Setup too.
- [ ] Hovering moves nothing, and on an idle screen only the meters move.

## Lighting

- [ ] Started with `SSE_SAFE_START=1`, the header's Lighting lamp reads `held`, a recalled scene does not reach the rig, and the DMX monitor shows what would be sent.
- [ ] `Light outputs` set to `Armed` in Setup / Support › Workstation: the rig follows at once.
- [ ] Set to `Held` while the rig is lit: the rig keeps its last look.
- [ ] A light selected in the list, then on the plot: the plate follows both, and the footer's values are complete.

## Audio console

- [ ] In TotalMix FX, remote 4 is `In Use` in `Global OSC` mode, port incoming 7004, port outgoing 9004, `Send changes` on, `Follow Submix` off.
- [ ] The Console reads `VERIFIED`, its meters move with the sound, and its footer reads `Metering TotalMix · live`.
- [ ] A fader moved or a mute pressed in TotalMix shows on the Console within about a second.
- [ ] `Sync from TotalMix` says how many values it read and moves nothing in TotalMix.
- [ ] Remote 4 off, a fader moved in TotalMix, remote 4 on again: the Console reads `ASSUMED`, and `Sync from TotalMix` clears it.
- [ ] A TotalMix fader at 0 dB and at −6 dB reads the same on the Console and on the Stream Deck.
- [ ] A recalled snapshot brings back a changed fader and mute and leaves a changed 48 V alone; the Console names the channel, and arming it there switches its 48 V.
- [ ] An armed recall moves nothing: the key is amber with its countdown, the state display shows the armed row, and Esc clears both.
- [ ] After a failed audio probe (one way: `Run audio probe` with TotalMix FX closed) every fader, mute and 48 V key is locked, dashed and dim from the chair, and says why; after a passed probe they return.
- [ ] `DIM` lights amber on the Stream Deck and on screen, pressed on either; the cluster also shows `MONO`, the target keys and the level.

## Stream Deck

- [ ] After Companion's Full Reset & Import the pages are LIGHTS, AUDIO, CAMERAS and PROMPTER (the last two once built), with no PROJECTS or TASKS, and the deck follows the app's page. The AUDIO page has no `TALK` key: its place, second row, third key, is empty.
- [ ] A key pressed on the deck acts in the app, and the deck's display follows a change made on screen.
- [ ] With Preview on in Lighting, the deck's lighting keys leave the rig alone, its displays read `PREVIEW` and the page shows each press; with Preview off the same keys move the rig.
- [ ] After a lighting key and a mute on the deck, a mute in TotalMix and a key on screen, Recent actions lists Stream Deck, Stream Deck, Console and Screen.

The PROMPTER and CAMERAS pages (once built) are walked under Teleprompter and Cameras.

## Teleprompter

- [ ] `Paste as a new script` takes text copied from Word or an e-mail, with no permission prompt.
- [ ] `Open file…` loads a Word document.
- [ ] In `Edit script`, typing, Enter, Ctrl+Z, Ctrl+Y and the bar's `Bold`, `Italic`, `Underline`, `Add cue` and `Paste` work.
- [ ] Ctrl+V pastes into the editor and keeps the formatting; Ctrl+B, Ctrl+I and Ctrl+U do nothing.
- [ ] Replacing the script on the prompter needs the second press.
- [ ] After a restart the script and the place are still there, paused.

Once the Prompter XL's window is built:

- [ ] The script reads correctly in the glass, not mirrored, and on no other screen but the page's own copy.
- [ ] The app stays fullscreen on the studio display when the Prompter XL is plugged in or out.
- [ ] With the app closed the Prompter XL shows a black desktop, and Elgato Camera Hub's own prompter, if installed, is off.
- [ ] Unplugged: the page reads `NOT CONNECTED`, its copy dims and reads "Not on the glass", and no other screen shows the script.
- [ ] Plugged back in: the script returns at the same place, paused.
- [ ] Play, pause, speed, position, text size and the jumps work from the page, and from the deck's PROMPTER page (once built).
- [ ] The scroll is smooth at the speeds you use, also with the Cameras page open.

## Cameras

Until the links to the cameras are built:

- [ ] The Cameras lamp reads `not set up`. The page reads `NOT SET UP` and says that the link comes with a later version; every control and `REC` are locked.
- [ ] The pictures are test pictures, and the page says so. Guides, peaking, zebras, 1:1 and the loupe change the pictures on the screen.
- [ ] `Camera setup` opens Setup / Support's `CAMERAS`: pairing and addresses are locked and say why, and a vMix input is saved and still there after a restart.
- [ ] Nothing on the page scrolls, and from the chair every word on it can be read.

Once the links and the pictures are built:

- [ ] All three cameras show; the selected one is big enough to judge framing and exposure, and the 1:1 view sharp enough to judge focus.
- [ ] A hand waved at a camera moves on the page with no delay you can see beside vMix's own preview.
- [ ] After five minutes with the page open while vMix records, vMix's statistics show no new dropped or late frames.
- [ ] Every value on the page matches the camera's own display, on all three cameras.
- [ ] Every setting changed from the page or the deck reaches the camera, and the page shows what the camera reports.
- [ ] A change made on the camera shows on the page within about a second.
- [ ] `REC` starts CAM 1 whichever camera is selected; stopping needs the second press, on the page and on the deck (`STOP?`).
- [ ] Resolution, frame rate, picture profile and LUT need the second press; afterwards vMix gets the picture back (its input may need to follow).
- [ ] Recent actions lists record starts and stops and the armed changes, each with Screen or Stream Deck.
- [ ] After `Release` the iPad reaches CAM 1 and LUMIX Tether reaches a BGH1; `Connect` takes the camera back.
- [ ] Closing the app while CAM 1 records leaves it recording, and a restart changes no camera setting.
- [ ] A camera switched off reads `UNREACHABLE`, and nothing else changes.

## Saved data and recovery

- [ ] After the first start on older saved data, the log's `Storage initialized` line names the new schema, and the backups folder holds a `pre-migration` copy from that start.
- [ ] After that first start, the Console's snapshots are all there by name, and Main Out, Phones 1 and Phones 2 stand where they stood; Lighting's fixtures, scenes and groups are all there.
- [ ] A database backup verifies and restores: fixtures, scenes and deck bindings return.
- [ ] With `studio-control-engine.exe` ended in Task Manager, the screen reads `THE HARDWARE LINK STOPPED` and the hardware link starts again by itself.
- [ ] Setup walks to Publish, and Support to Restore, without scrolling; the commissioning record and the archive row show.
