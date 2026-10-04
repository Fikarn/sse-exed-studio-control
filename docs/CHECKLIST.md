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
- [ ] With the light outputs held, the Lighting page reads `HELD` and `Open Setup` goes to the switch.
- [ ] With the light outputs armed, a restore of a backup (Setup / Support › Support) comes back with them held: the lamp reads `held`, and the rig keeps its look until `Light outputs` is armed.
- [ ] `Light outputs` set to `Armed` in Setup / Support › Workstation: the rig follows at once.
- [ ] Set to `Held` while the rig is lit: the rig keeps its last look.
- [ ] A light selected in the list, then on the plot: the plate follows both, and the footer's values are complete.
- [ ] Through the whole walk the Lighting lamp never reads `not answering` while the bridge is on, and the rig follows steadily: the bridge watch knocks on its web page every 5 s. `engine.log` has one line that the bridge answers (a connection taken, or refused) for each start of the hardware link, and none that it stopped.
- [ ] The bridge's network cable pulled for 15 s: Lighting reads `NOT ANSWERING`, amber, nothing is locked, and there is no `Open Setup` key. Plugged back: it clears by itself within about 10 s.
- [ ] `CUT ALL` arms at the first press ("press again", a 3 s bar) and takes every light off at the second, as the deck's `ALL OFF`; let the bar run out once and nothing changes.
- [ ] A `Highlight` on a fixture: the rig shows it at full, the scene's row still reads `ON RIG` and the state display does not read `UNSAVED`; `Off` in the latch slot ends it.
- [ ] A `Highlight` on a fixture, then `CUT ALL`: the whole rig goes dark, the highlighted fixture too, and the latch slot reads `Nothing latched`. Then select every light and press `Find`; as soon as the first light has flashed, press `CUT ALL` twice: no light flashes after the cut (until 2026-10-05 the Find went on over the dark rig), and the Find key reads `Find` at once.
- [ ] The INFINIMAT (Backline Wash) has no `Strobe` on the plate and never strobes; its intensity, colour temperature and green/magenta still move it.
- [ ] Two scenes saved with `Save as a new scene` (press twice) come back after a restart, named `Scene N`; a scene deleted from its `⋯` (press twice) can be undone.
- [ ] The plot draws each fixture where it hangs in the room: Key, Fill, Back and the wash read their real places on the rulers.

## Audio console

- [ ] In TotalMix FX, remote 4 is `In Use` in `Global OSC` mode, port incoming 7004, port outgoing 9004, `Send changes` on, `Follow Submix` off.
- [ ] After a start, with the Console last `VERIFIED` or `ASSUMED`, it reads `ASSUMED`, "Studio Control has not read the desk since it started. Press Sync from TotalMix.", and `engine.log` says `The Console reads assumed until a Sync`. After `Sync from TotalMix` it reads `VERIFIED`, its meters move with the sound, and its footer reads `Metering TotalMix · live`.
- [ ] A fader moved or a mute pressed in TotalMix shows on the Console within about a second.
- [ ] `Sync from TotalMix` says how many values it read and moves nothing in TotalMix.
- [ ] On a preamp with an SM7B (48 V does it no harm), the speakers down: `M` twice, 48 V to the other state and back (two presses each), Hi-Z and AutoSet on and off again, the gain 1 dB up and back; on Phones 1, `M` twice. The Console stays `VERIFIED` and reads no `ASSUMED`: since D36 a change counts only when TotalMix's answer carries it. Everything is left as it was.
- [ ] Remote 4 off for about 30 s, a fader moved in TotalMix, remote 4 on again: the Console reads `ASSUMED` and says TotalMix was out of touch for about 30 s; `Sync from TotalMix` clears it, and the fader shows TotalMix's value. `engine.log` says when remote 4 went quiet (`TotalMix went quiet on remote 4`), when it was heard again and after how long, and how many control values TotalMix sent in the 3 s after.
- [ ] A TotalMix fader at 0 dB and at −6 dB reads the same on the Console and on the Stream Deck (`+0.0 dB` at unity on both).
- [ ] The Console's Snapshots are TotalMix's eight, under the names TotalMix shows (after TotalMix has been closed once since they were named); the one loaded reads `active`, and `changed` once a fader moves in TotalMix. `engine.log` names TotalMix's device (`TotalMix's device:`) and the names file it read (`TotalMix's names read from`).
- [ ] A slot pressed, then pressed again once it reads `LOAD?` (a double-click only arms it), loads in TotalMix: TotalMix shows that snapshot, the slot reads `active`, the strips show what TotalMix now holds, the Console reads `VERIFIED`, and 48 V stays as it was. `engine.log`'s `Load of slot N` line says whether TotalMix reported the load itself.
- [ ] An armed load moves nothing: the key reads `LOAD?` in dark red with its countdown, the state display shows the armed row, and Esc clears both.
- [ ] The strips and the outputs carry TotalMix's names; a channel renamed in TotalMix shows its new name after `Sync from TotalMix`, also with a letter beyond ASCII (`ö`), and that channel's mute still follows TotalMix. `engine.log` quotes each name the read-back carried, and has no line that a datagram from TotalMix could not be read in full. The Console has no Rename and no Capture.
- [ ] After a failed audio probe (one way: `Run audio probe` with TotalMix FX closed) every fader, mute and 48 V key is locked, dashed and dim from the chair, and says why; after a passed probe they return.
- [ ] `DIM` lights yellow on the Stream Deck and on screen, pressed on either; the outputs block under it shows `MONO` and each output's key, level and fader. With `Phones 1` as the mix target, `DIM` still dims `Main Out`, and the phones' `⋯` menus have no `Dim` or `Mono`.
- [ ] An output's fader in the left column moves that output in TotalMix, and its level reads the same as TotalMix's; `MAIN OUT` and `PHONES` on the deck light the same output key yellow on screen.

## Stream Deck

- [ ] The new profile is imported before the deck is used on the new build, not before the build is on: an old build with the new profile greys the whole deck (`/api/deck/displays` answers `400`), `PHONES` answers `400` and `RECALL` recalls at once.
- [ ] After Companion's Full Reset & Import of the new profile (Companion 5's own format, 2026-10-03), the pages are LIGHTS, AUDIO, CAMERAS and PROMPTER, and the deck follows the app's page to each of the four.
- [ ] In Companion's Surfaces, "Horizontal Swipe Changes Page" is off for the deck (the reset turns it off; the profile cannot carry it): a swipe along the strip turns no page. If it is on, turn it off.
- [ ] No key and no cell has a top bar, a yellow border while pressed or a status icon; the images fill each key and each strip cell, not letterboxed.
- [ ] The deck has the screen's look (2026-10-03): its words in the screen's faces, the keys' faces dark green-black, the strip black; at the studio's brightness every key at rest still reads apart from the black glass between keys, and its words read at arm's length.
- [ ] Every page has `REC` top left, `PLAY` under it and the page key top right; the page keys, dark green with the screen's tab words, turn the deck round: `Audio`, `Cameras`, `Prompter`, `Lighting`, the next page's dot lit. The dark keys (LIGHTS bottom row, third key; CAMERAS top row, third key; PROMPTER bottom row, third key) are black and do nothing.
- [ ] The LIGHTS strip shows its four dials (until 2026-10-03 it was black): `LIGHT 1/2` over the light's name in capitals, `INTENSITY` over `76 %` (`OFF` for a light that is off), `CCT` over `3200 K`, `SCENE 1/3` over the scene's name.
- [ ] The deck draws `◂ Cue`, `Cue ▸` and the page keys' arrows, and on the strips `·` and `°`, as they are written here.
- [ ] A key pressed on the deck acts in the app, and the deck's display follows a change made on screen within a second.
- [ ] `RECALL` reads `ON RIG` in green after a recall; `UNSAVED` in yellow after a light is changed; `scene` once the `SCENE` dial chose another scene; with the Lighting page's `Fade` at 2 s, a recall from the deck fades as one from the screen does.
- [ ] On the INFINIMAT (Backline Wash) at 8000 K, a turn of the deck's `CCT` up reads `8200 K` and the light goes cooler (until 2026-10-05 it fell to 6500 K); a push reads `6000 K`, as the plate's Reset. On an Astra a push reads `4400 K`.
- [ ] With Preview on in Lighting, the deck's lighting keys leave the rig alone, `RECALL` reads `PREVIEW` in blue, the INTENSITY and CCT values are blue, and the page shows each press; with Preview off the same keys move the rig.
- [ ] After a lighting key and a mute on the deck, a mute in TotalMix and a key on screen, Recent actions lists Stream Deck, Stream Deck, Console and Screen.
- [ ] `ALL OFF` on the deck, in coral, reads `OFF?` and "press again" in dark red at the first press and switches nothing; a second press within 3 s switches every light off. After 3 s without a second press it reads `ALL OFF` again within about a second. `REC` or `PLAY` pressed meanwhile does not end the question.
- [ ] A quick double press on `PLAY`, `DIM`, `PHONES`, a mute (a dial's push) or the `LIGHT` dial's push switches once.
- [ ] On LIGHTS, a turn of the LIGHT dial shows the next light's name, intensity and colour temperature, at once or within a second; a turn of INTENSITY, CCT or SCENE changes its own cell the same way; a light changed on screen shows on the strip within a second.
- [ ] A fast spin of the LIGHT dial: the strip catches up within a second of stopping, and `engine.log` has no line that the bridge refused a request (`503`).
- [ ] On AUDIO, `Main Out` is yellow while the dials send into Main Out; `Phones` goes to `Phones 1`, `Phones 2`, `Phones 1`, yellow; `BANK` reads the bank with its dot lit, yellow off the inputs; `DIM` is yellow while on, `SOLO` has a yellow outline, lamp and word and reads how many are on. The strip shows each strip's name, its level and a bar that follows the fader; a muted strip reads `MUTED` in yellow and its bar dims. A slow turn steps one step a detent, a fast spin further; a turn never sets a gain. While the Console is locked (TotalMix not verified) every AUDIO key is locked, a dashed outline and grey words, `Main Out`, `Phones` and `DIM` too.
- [ ] With Companion closed, the header's Surface lamp reads `no deck`, amber, within about 5 s, and nothing locks; started again, it reads `ready`.
- [ ] With the app closed, the deck's keys and cells turn grey and show no values within about 5 s; with the app started again they come back by themselves. Turned by its page key to another page than the app's before the app was closed, the deck stays on that page when it comes back: it turns only when the app's page changes.

- [ ] In Setup's `Verify live echo`, a key of each of the four pages pulses on screen, and the screen turns to the key's page.

The PROMPTER and CAMERAS pages are walked under Teleprompter and Cameras.

## Teleprompter

- [ ] `Paste as a new script` takes text copied from Word or an e-mail, with no permission prompt.
- [ ] `Open file…` loads a Word document.
- [ ] In `Edit script`, typing, Enter, Ctrl+Z, Ctrl+Y and the bar's `Bold`, `Italic`, `Underline`, `Add cue` and `Paste` work.
- [ ] Ctrl+V pastes into the editor and keeps the formatting; Ctrl+B, Ctrl+I and Ctrl+U do nothing.
- [ ] Replacing the script on the prompter needs the second press.
- [ ] After a restart the script and the place are still there, paused.
- [ ] With the Prompter XL plugged in, and again with it unplugged, the app is fullscreen on the studio display within a few seconds, and `shell.log` names the Prompter XL among the screens and says `connected`.
- [ ] With the studio display switched off and on again, the app is back on it, fullscreen, within a few seconds.
- [ ] With a script on the prompter, the jumps, the speed and the text size work from the deck's PROMPTER page, and the strip follows: `SPEED` over the words a minute, `LINE` over the share read, `PARAGRAPH` over `8 / 18` (`END` at the end), `SIZE` over `88 px`; `PLAY` shows the time left. With nothing on the prompter every control is grey.

The Prompter XL:

- [ ] Plugged in, the header's `Prompter` lamp is green within a few seconds, and `shell.log` says `The prompter's window opened on the Prompter XL`, `The prompter's page draws` and `The hardware link has the Prompter XL as CONNECTED`.
- [ ] The script reads correctly in the glass, not mirrored, and fills the Prompter XL's screen: no taskbar, no frame, no pointer.
- [ ] No other screen shows the script but the page's own copy. The page's copy and the glass break every line alike.
- [ ] While the window opens, and after it, typing in `Edit script` goes on: the window takes no keyboard. A click on the Prompter XL's screen leaves the keyboard with the app too.
- [ ] With the Prompter XL at another scale than the studio display in Windows' display settings (100 % and 125 %), the script still fills its screen.
- [ ] Play, pause, speed, position, text size and the jumps work from the page, and from the deck's PROMPTER page. `PLAY` is green while the text scrolls, and the scroll is smooth at the speeds used, with the Cameras page open.
- [ ] Unplugged while the text scrolls: the text pauses, the page reads `NOT CONNECTED`, its copy dims and reads "Not on the glass", the deck's `PLAY` is grey and reads `NO XL` on every page, and no other screen shows the script, not for a moment.
- [ ] Plugged back in: the script returns at the same place, paused.
- [ ] Set to duplicate another screen in Windows' display settings: the page reads `DUPLICATED` and the Prompter XL shows the copy, not the script. Set back to extend: the script returns.
- [ ] With the app closed the Prompter XL shows a black desktop, and Elgato Camera Hub's own prompter, if installed, is off.
- [ ] The scroll is smooth at the speeds you use, also with the Cameras page open.

## Cameras

The pictures, with vMix running and its Outputs 2, 3 and 4 sent over NDI:

- [ ] The build's folder holds the shell, the engine, `studio-control-pictures.exe`, `Processing.NDI.Lib.x64.dll` and `build.json`. When the app starts, Windows may ask about the firewall for `studio-control-pictures.exe` at the build's path. The answer is the owner's, as a firewall rule is a security setting; with Cancel, check that the pictures still come.
- [ ] All three pictures show, CAM 1 from Output 2, CAM 2 from Output 3, CAM 3 from Output 4, each `live` with `vMix Output N · 3840 × 2160 · 29.97` (or its own size and rate), with no switch; the footer reads `Pictures vMix Outputs 2 to 4 · 3 / 3`. The engine's log says the helper loaded NDI's library from the build's folder, its hash the pinned one.
- [ ] `Guides`, `Peaking` and `Zebras 95 %` draw on the big picture, zebras and peaking in the loupe, and the loupe's dashed frame on the big picture; `1:1`, 2:1 and 4:1 and a press on the big picture move them.
- [ ] With one of Outputs 2 to 4 not sent over NDI in vMix, that camera's place reads `NO PICTURE` and names the output to check; with vMix closed, `NO PICTURES` says to open vMix and send the outputs. The controls still work.
- [ ] The `⋯` in a small picture's label opens its camera's menu over the picture, and the picture stays drawn round the label and the menu. A right-click on the small picture opens the same menu at the pointer. (The picture is drawn natively over the page in the app's window, and whether a right-click there reaches the page is not known yet: if it does not, note it; the `⋯` is the way that always works.)
- [ ] The `⋯` beside a camera's key and in the plate's title open the same menu; a right-click on a camera's key does too. A menu stays on screen while it is open, and Esc closes it.

Until the links to the cameras are built:

- [ ] The Cameras lamp reads `not set up`. The page reads `NOT SET UP` and says that the link comes with a later version; every control and `REC` are locked.
- [ ] `Camera setup` opens Setup / Support's `CAMERAS`: pairing and addresses are locked and say why, and each camera's line names its vMix output: CAM 1 Output 2, CAM 2 Output 3, CAM 3 Output 4.
- [ ] Setup / Support's About ends with `NDI® is a registered trademark of Vizrt NDI AB · ndi.video`, as words.
- [ ] On the deck's CAMERAS page the three cameras' keys select, on the page too, with a beige outline on the selected one, and `BANK` turns the dials' bank, which the page's `Exposure`, `Colour` and `Focus` follow. `REC`, on every page, and the dials are grey and do nothing.
- [ ] Nothing on the page scrolls, and from the chair every word on it can be read.

Once the links are built, with the cameras on vMix's outputs:

- [ ] All three cameras show; the selected one is big enough to judge framing and exposure, and the 1:1 view sharp enough to judge focus.
- [ ] A hand waved at a camera moves on the page with no delay you can see beside vMix's own preview.
- [ ] After five minutes with the page open while vMix records, vMix's statistics show no new dropped or late frames.
- [ ] Every value on the page matches the camera's own display, on all three cameras.
- [ ] Every setting changed from the page or the deck reaches the camera, and the page shows what the camera reports.
- [ ] A change made on the camera shows on the page within about a second.
- [ ] `REC` starts CAM 1 whichever camera is selected; stopping needs the second press, on the page and on the deck (`STOP?`).
- [ ] On the deck, two quick presses of `REC` start one take and arm nothing; two quick presses on `STOP?` stop it and start no other. `STOP?` left alone reads `REC` again within about four seconds. While CAM 1 records, `REC` on every page shows the take's length, the same as the Cameras page's.
- [ ] The deck's dials step the selected camera's values in every bank, and the strip shows what the camera reports; a push of the first dial on focus runs the autofocus once.
- [ ] Resolution, frame rate, picture profile and LUT need the second press; afterwards vMix gets the picture back (its input may need to follow).
- [ ] Recent actions lists record starts and stops and the armed changes, each with Screen or Stream Deck.
- [ ] After `Release` the iPad reaches CAM 1 and LUMIX Tether reaches a BGH1; `Connect` takes the camera back.
- [ ] Closing the app while CAM 1 records leaves it recording, and a restart changes no camera setting.
- [ ] A camera switched off reads `UNREACHABLE`, and nothing else changes.

## Saved data and recovery

- [ ] After the first start on older saved data, the log's `Storage initialized` line names the new schema, and the backups folder holds a `pre-migration` copy from that start.
- [ ] After that first start, the Console's levels for Main Out, Phones 1 and Phones 2 read what TotalMix shows; Lighting's fixtures, scenes and groups are all there.
- [ ] A database backup verifies and restores: fixtures, scenes and deck bindings return.
- [ ] Five minutes after a restart of the app with a daily backup less than a day old, the backups folder has no new `-daily` copy, and `engine.log` says when the next daily is due.
- [ ] With `studio-control-engine.exe` ended in Task Manager, the screen reads `THE HARDWARE LINK STOPPED` and the hardware link starts again by itself; the Console then reads `ASSUMED` until `Sync from TotalMix`.
- [ ] Setup walks to Publish, and Support to Restore, without scrolling; the commissioning record and the archive row show.
