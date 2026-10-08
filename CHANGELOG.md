# Changelog

What changed in SSE ExEd Studio Control for the person at the desk, newest first.
One bullet per change the operator can notice, two lines at most, in the operator's words, with the pull request number. Tests, CI and refactors get no entry.
The long text of the entries written before 2026-09-28 is in git history, at the tag `archive/records-2026-09`.

## [Unreleased]

### Changed

- The INFINIBAR PB12s take Aputure's profile 1, `CCT & RGB`, the one the studio's bars run: the plate offers Intensity, CCT, Green/Magenta, Red, Green and Blue; a colour shows as soon as one is set, the white light comes back when all three are 0, and nothing Studio Control sends can strobe a bar. Before, `Red` switched a bar off and `Speed` strobed it (#NNN).
- CAM 1, the Pocket 6K Pro, tried on the camera: `Pair CAM 1` finds it with the PC's antenna on, its values show after the connection, and the page's `REC`, take length and `Timecode` follow a take started from the page or on the camera (#321).
- Setup pairs CAM 1, the Pocket 6K Pro, over Windows' own Bluetooth: `Pair CAM 1` looks for the camera, the camera shows a 6-digit PIN, and you type it in Setup; then Studio Control holds CAM 1 and names itself on the camera. A pairing Windows has lost reads `NOT SET UP` and can be made again (#319).
- A camera released to the iPad or LUMIX Tether stays released when Studio Control starts again, until `Connect`; `Forget` and a new pairing or address end it too. Before, every start took the camera back (#318).
- A camera's step keys and the deck's dials step from the value the camera reports, also when it is not on the list: to the nearest listed value in the step's direction. A setting the camera has not reported, or reports as `Auto`, cannot be stepped, and the refusal says so (#312).

- The header's tabs stay where they are when the page changes: the open tab keeps the room of its word. Lighting's tab says `unreachable`, as its page does; on Lighting the Console's latch reads `AUDIO SOLO`. Before the app is ready the lamps are hollow and read `pending`, or `not read` after a failed start (#311).
- Every state display's sentence fits its two lines: the long ones are shorter (the Prompter XL's, a camera released or out of Bluetooth reach, TotalMix's Global OSC, the protocol). Point at a sentence cut short to read it whole (#311).
- A locked key keeps its state: a solo, a mix target or `LIGHTING` on shows its word and dashed edge in yellow or green while it is locked, instead of looking off (#311).
- The Console marks every level TotalMix has not confirmed with a dashed yellow keyline, and at rest says its own sentence, not Setup's. Levels print the real minus (−3.8 dB); the snapshot TotalMix holds reads `ACTIVE`; the bank keys are ‹ › (#311).
- Lighting's colour tags are quiet tints from the brand (Clay, Ochre, Sand, Olive, Slate, Mist, Plum, Heather); each saved tag keeps its slot, and a colour-temperature palette has none. The plate's on/off keys read `Light`, `Group`, `Selection` (#311).
- The Lighting plot names the door and the booth window and draws no camera until the cameras' places are known; it no longer says `locked` while the bridge is unreachable, and the Scenes head says `recalls refused` (#311).
- Cameras: `REC`'s lamp stands by its word; the plate's Connect and Try again are plain keys; a last-read value has its dashed keyline on the value alone, and the caption names the camera once (#311).
- Teleprompter: scripts are rows on hairlines with their pace in words a minute; the footer shows the Prompter XL's mode alone; cues stand upright; the cue keys, Go to paragraph and Go are one row; Edit script keeps the page's margin (#311).
- Setup / Support: the step screen fills the bay, its title at the plate's size; the probes are named by their hardware (Deck, Lighting bridge, TotalMix); Import's key reads `Export and continue`; backups lead with their time (#311).
- The start-up screen lists its steps across the middle and the hardware on the right; the recovery screen lists each place once with its `Open` key. The shell's own dialogs look like every other dialog (#311).

- Setup / Support is drawn anew: on a published setup the steps, `Back to …` and `Run all probes` read `press twice` and arm dark red with a countdown, in their own height; `Export backup`, `Open the log` and `Back to the Console` are the state display's `⋯`; the deck's map is drawn as the deck, the page key dark green and the strip one strip; the helper sentences are tooltips; the Support plate fits without scrolling (#310).
- Support lists the backups eight a page, each with a `⋯` (Verify, `Restore…`, which asks as before); a camera's `Forget CAM n…` is its `⋯`'s last item and asks, press again; the light outputs read `ARMED` or `HELD` (#310).
- The recovery screen's keys are one kind; it says the whole sentence and its code in the middle, and `NOT READ` for what it could not ask. Its words fit the display: `LINK STOPPED`, `SAVED DATA DAMAGED`, `ALREADY OPEN`. `Back to Console`, which could not leave it, went (#310).
- Times read on the 24-hour clock everywhere, `22 Apr 2026, 09:12`, as the clock does: the Console's last sync and names, and Lighting's `saved` time too (#310).
- The Teleprompter page is drawn anew: the text size stands beside the speed with `− 4`, `+ 4` and `Standard`, and works with nothing on the prompter; Open file…, Paste as a new script and New script are the page's `⋯`; the look's settings open beside the plate with `Change…`, the Prompter XL's from the footer; state words are in capitals and a current choice has a beige outline (#307).
- Every script has a `⋯` (or a right-click) with Select, Put on or Replace, Edit, Rename, Earlier versions and Remove; Removed is the Scripts `⋯`'s view. `Delete for good…` asks in its menu, press again, not in a dialog. Replace, Update and Clear turn dark red with a countdown and keep their size (#307).
- The Cameras page is drawn anew: each camera has a `⋯` beside its key, in its small picture's label and in the plate's title (or a right-click), with Select, Read again or Connect, Camera setup and Release; the state words are in capitals; a current choice has a beige outline instead of a yellow fill; the helper sentences are tooltips (#306).
- A value's list, the white balance and tint field, and the format's and look's keys open beside the plate, and the pictures stay drawn while they are open; the list and the field hid every picture until now. Closing the format's or the look's keys drops a key armed in them (#306).
- `CUT ALL`, `LIGHTING` off and the deck's `ALL OFF` take a highlighted, soloed or flashing light off too, and end the Highlight, the Solo and a Find; a highlighted light used to stay at full after a cut. In Preview they still cut the preview only (#305).
- The deck's `CCT` dial turns inside the light's own range (the INFINIMAT's 2000–10000 K, not 2700–6500 K), and a push sets the middle of it, as the plate's Reset: 6000 K on the INFINIMAT and the INFINIBAR, 4400 K on an Astra (#305).
- The Lighting page is drawn anew: the plot stands at the fixtures' real places with metres on its edges and names beside the marks, and one bar under it (the selection, Highlight, Solo, Find, the zoom, views 1 to 3, the plot's `⋯`); the scenes are rows with their word (`ON RIG`, `UNSAVED`, `PREVIEW`), the plate fits without scrolling (#304).
- A new scene is saved with the row under the scenes, `Save as a new scene`, pressed twice; the plate's `Save changes` writes into the scene the rig has left. `CUT ALL` arms at the first press and cuts at the second, within 3 s (#304).
- Every fixture, scene, group and palette has a `⋯` (or a right-click) with the same items, and the plot's floor too; `Delete …` arms in the menu, press again, and can be undone. Patch, Preview, Add fixture and the DMX monitor are the page's `⋯` (#304).
- `UNSAVED` comes from the hardware link and says what the deck's `RECALL` says: a Highlight, Solo or Identify no longer counts as a change to the scene (#304).
- The INFINIMAT's `Strobe` and the LS 600d Pro's `FX` and `Speed` leave the plate: the lights never got them (D37, #304).
- A change on the Console counts as confirmed only when TotalMix reports it, a send or solo turned off also when TotalMix's list of the mix leaves it out. A change TotalMix's answer about a channel leaves out, or that gets no answer, reads `ASSUMED` until `Sync from TotalMix`; before, it could count as confirmed though TotalMix had dropped it (the right side of a linked pair, an answer cut short) (#303).
- After every start the Console reads `ASSUMED` until `Sync from TotalMix`, as TotalMix may have changed while the app was closed; it read `VERIFIED` from before (#284).
- After TotalMix has been out of touch (its remote 4 switched off, or TotalMix closed), the Console reads `ASSUMED` once TotalMix answers again, says for how long, and asks for `Sync from TotalMix`; it read `VERIFIED` with values TotalMix no longer held (#284).
- The plate's equaliser and Low Cut leave the Console: they went to TotalMix over its old page-2 commands, whose on/off only flipped TotalMix's switch, which could land on another mic, and which nothing read back. Set the EQ in TotalMix. The plate is now the preamp, the other mixes and the meter (#302).
- The plate's dynamics leave the Console: the compressor and the gate were only kept by the app and never reached TotalMix, whose dynamics are one compressor and expander per input (#301).
- The sends' modes leave the Console: Pre fader, Mute send, Link L+R and Solo send were only kept by the app and never reached TotalMix, which has none of them per send. A strip's `S` is unchanged (#300).
- The Console is drawn anew: the outputs are rows in the left column under `DIM` and `MONO`; the strips have one-line names, bigger `M` and `S` and the gain shown; the plate fits without scrolling; every strip, output and section has a `⋯` (or a right-click), and the Console row is the page's `⋯`. Unity reads `+0.0 dB`, as on the deck (#299).
- The frame is the new design's: an 80 px header with each page's lamp and word in its tab (the open page's in its own display), a `REC` slot that never moves, the clock and the SSE logotype; every page's plate on the right at the same width; `Nothing latched` under every state display, with a `⋯` for the page's commands. Start-up and recovery stand on the same frame (#298).
- The Stream Deck takes the screen's look: its words in the screen's faces and colours, `SOLO` as the screen's latch, one armed form ("press again" in dark red), the selected camera in beige, the page keys dark green with the tab words and a dot a page. It reaches the deck with the next export and Full Reset & Import in Companion (#297).
- The right-click menus are drawn anew: bigger rows that stay on the screen, a coral delete last, and the focus back where it was when they close. The colour-tag picker has bigger swatches (#296).
- Tooltips are Beige notes that open after a short rest and never cover a key used during a take; the strip's `M` and `S` have none, their names say it (#296).
- The Stream Deck has a new layout, in Companion 5's own format: `REC` and `PLAY` on every page, the page key top right, every dial's name and value on the strip (the LIGHTS strip was black), no top bars. GAIN, Del Scene and the AUDIO strip taps leave the deck; `PHONES` goes round the phones mixes, and a quick double press moves it once. It reaches the deck with the next export and Full Reset & Import, which goes with the new build: an older build greys the new profile's deck (#294).
- The deck's `RECALL` fades with the Lighting page's `Fade`, which is now remembered, and says `ON RIG`, `UNSAVED` or `PREVIEW`; `REC` shows the take's length; the deck greys when it cannot hear the app. It reads all its displays in one request a second (#294).

### Added

- The Cameras page shows the three cameras' pictures from vMix's Outputs 2, 3 and 4 over NDI, with Guides, Peaking, Zebras and the loupe; NDI's library comes in the build's folder. With vMix closed, `NO PICTURES` says to open vMix and send the outputs (#278, #279).
- Setup / Support's About names NDI's trademark and ndi.video: the cameras' pictures come over NDI (#277).
- A Teleprompter page runs the take: PLAY, BACK, TOP, the speed in words a minute, steps by line, paragraph and cue. The prompter is paused after every start and stops by itself only at END (#225, #227).
- The Teleprompter shows a copy of the glass, line for line, with the place and the time left. The Prompter XL's own window comes later (#226, #227).
- Scripts come from a Word file (.docx), a text file or pasted text, read on this PC without Word. Each script keeps its last 20 versions, and a removed script can be restored (#225, #227).
- Edit script opens the editor: Bold, Italic, Underline, Add cue, Undo, Redo and Paste, saved as it is typed. New script and Paste as a new script sit beside Open file…; Rename opens a dialog (#228).
- The header has a Prompter lamp and, while the text scrolls, a green latch with the time left on every page, which opens the Teleprompter (#227).
- A Cameras page shows the selected camera big and the other two small, and sets it: exposure, colour and focus at one press, format and look at two. A value a camera does not report says so (#244).
- `REC` starts CAM 1 at one press and stops it at two, the second within 3 s, whichever camera is selected. While it records the header shows `REC CAM 1` on every page, which opens Cameras (#244).
- `Release`, press twice, hands a camera to the iPad or LUMIX Tether, and `Connect` takes it back. A camera that does not answer reads `UNREACHABLE`, with its last values in amber (#244).
- Guides, peaking, zebras, a 1:1 view and a loupe are drawn on this screen only and are off at every start. Until the cameras' pictures are built, the pictures are test pictures (#244).
- Setup / Support has a `CAMERAS` screen: CAM 1's pairing, the BGH1s' addresses and each camera's vMix input. Saving sends nothing to a camera (#244).
- The header has a Cameras lamp. Until the links to the real cameras are built it reads `not set up`, every camera says that its link comes with a later version, and `REC` is locked (#244).
- The Stream Deck has four pages, LIGHTS, AUDIO, CAMERAS and PROMPTER, and follows the app to each. A key on every page turns the deck to the next. They reach the deck with the next import of the profile (#247).
- The deck's CAMERAS page selects the camera, puts the dials on exposure, colour or focus, and has `REC`: one press starts CAM 1, two stop it (`STOP?`). The Cameras page shows and sets what the dials set (#247, #248).
- The deck's PROMPTER page has `PLAY`, `BACK`, `TOP`, the two cue keys and dials for speed, position, text size and paragraph. Its strip shows the speed, the place, the time left and the script's name (#247).
- The hardware link keeps the three cameras (Pocket 6K Pro, two BGH1) and their setup; the links to the real cameras come later. A start or a restore sends nothing to a camera (#229).
- The saved data holds the Teleprompter's scripts and look (schema 9) and the cameras' setup (schema 10); backups carry both (formats 6 and 7). A restore adds scripts and never removes one (#225, #229).
- Light outputs: Armed / Held, in Setup / Support › Workstation. Held, nothing is sent to the rig, which is not a blackout; the hold is remembered, and no start or restore arms the rig (#201).
- Recent actions, in Setup / Support, lists every switch that reached a device and who made it: Screen, Stream Deck, Console (a switch at TotalMix) or Start-up (#201, #239).
- The saved data is checked at every start; damaged data stops the start at SAVED DATA NEEDS ATTENTION and is left as it was. It is backed up on its own before an upgrade, daily and at every close (#201).
- Setup / Support and the recovery screen list the backups, verify one without changing anything and restore it, database backups included. A backup from a newer Studio Control is refused (#201).
- A stopped hardware link restarts on its own, and a slow one no longer freezes the window. A page that fails says so (LIGHTING STOPPED, Reload this area) while the rest keeps working (#201).
- Closing the window asks "Close Studio Control?" first, and a second copy of Studio Control hands over to the one already open, which comes to the front (#201).
- Publish needs every probe green. With one that is not, the key reads Publish with override… and the override is recorded; Run all probes says how many of the three passed (#201).
- The Console drives the desk: faders, mutes, solos, 48 V, gain, dim and mono reach TotalMix. Each change is read back, a change at TotalMix shows on screen, and the desk wins (#85, #201).
- Live meters come from TotalMix (its remote controller 4, Global OSC): the right channels whatever its layout, the outputs too, and back on their own after the app or TotalMix restarts (#85, #201).
- The Stream Deck+ is the Console's control surface: the AUDIO page has seven keys, four touch strips (name, level, fader bar) and four dials. The screen follows the deck, and the deck the screen (#201).
- Lighting drives the rig: the light output goes to the Apollo bridge over sACN as soon as lighting is on, the bridge has an address and a fixture is patched, unless the light outputs are held (#201).
- Add fixture picks a verified fixture from a catalog by manufacturer, family, model and mode. The DMX monitor shows every universe, and DMX values read 0–255, not hex (#73, #201).
- New controls for what only keys did: Previous bank and Next bank on the Console's Inputs (to Line 1–8); Undo (25 steps), Stop on Find and Add to selection in Lighting; Reset in typed entry (#216).

### Changed

- The pages take the SSE brand's look: a near-black ground with a trace of Dark Green, Beige Light text, SSE Green, Yellow and Coral only for state, PT Sans with SSE Adelia for state words and section heads, flat keys and a matte light cap on every fader. The pages' own layouts follow page by page (#293).
- The Console's Snapshots are TotalMix's own eight, under the names TotalMix last saved; `active` and `changed` say what TotalMix has loaded. Press a slot twice (`LOAD?`) to load it in TotalMix, and the Console then reads the desk (#282).
- The Console's strips and outputs carry TotalMix's names; a channel is renamed in TotalMix (#282).
- Setup / Support's `CAMERAS` names the vMix output each camera's picture comes from, CAM 1 Output 2, CAM 2 Output 3, CAM 3 Output 4, and no longer takes a vMix input; the Cameras page names it too (`vMix Output 2 · 3840 × 2160 · 29.97`) (#277).
- The Cameras page says when a picture does not arrive: its place reads `NO PICTURE` with the reason, and the state display `PICTURE MISSING` or `NO PICTURES`. Until the pictures are built, the studio's build shows `NO PICTURE` where the test pictures were (#264).
- Lighting's `Undo` keeps its steps when you leave the page and come back; it forgot them. A restore or a restart of the hardware link still clears them (#263).
- On the deck's LIGHTS page each dial's display follows its turn: the next light's name, intensity and colour temperature, the next scene. A change made on screen shows within a second. They followed only an arrival on the page. It reaches the deck with the next import of the profile (#262).
- An AUDIO dial on the deck speeds up only when two detents arrive within 80 ms of each other, however late they are handled: a slow turn that waited behind the displays' poll could jump five steps (#262).
- The header's Surface lamp reads `no deck`, amber, when Companion has not asked Studio Control for anything in 5 s (Companion closed, or a profile without the right token), and Setup's deck probe passes only when it has. The probe always passed. Nothing locks. A probe's own `Run probe` key says whether it passed; it always said it had (#261).
- Lighting reads `NOT ANSWERING`, amber, and its header lamp `not answering`, when the bridge stops answering during a session: Studio Control looks every 5 s. Nothing is locked, and the word clears when the bridge answers again (#260).
- The recovery screen's `Restore latest` restores the newest database backup; it could pick a newer backup archive, which cannot be restored while the saved data does not open (#259).
- In Setup, before the setup is published, the state display's key goes to the step the setup stands at (`Continue with Map bindings`). It read `Start with Import profile` on every step and sent the runner back to step 1 (#259).
- Lighting's scene names, the plot's pill, the scene's title and figures, the fixture's name, the recovery screen's check titles and the shell's dialog titles are printed in Inter, as the rest of the app is: Fraunces, the old display face, is gone (#256).
- Lighting reads `HELD` while the light outputs are held; it read `REACHABLE`, "the rig is following it" (#255).
- `DIM` and `MONO` are `Main Out`'s whichever output is the mix target, and the phones' strips no longer show them: nothing was ever sent for the phones (#255).
- The header shows a `Backup` chip while the automatic backup failed or is overdue, and the Lighting lamp reads `no output` when the light output could not open its port. Both went unseen (#255).
- `Engine log` is `Open the log`, and the sentences from the hardware link on Setup, the Console, Lighting and the recovery screen are in plain words (#255).
- Recent actions names the main output `Main Out` for the deck's `DIM` too (#255).
- On the deck, `All Off` and `Del Scene` ask first: the key reads `OFF?` or `DEL?` in amber, and a second press within 3 s acts. `Save` stays one press. They reach the deck with the next import of the profile (#254).
- On the deck, a press of `PLAY`, `DIM`, a mute or `Toggle` that arrives twice within a third of a second switches once (#254).
- Every restore comes back with the light outputs held, a database backup's and an archive's alike; arm them in Setup / Support when the rig should follow. A restore from the recovery screen could arm a rig that was held (#253).
- On a published setup, a step, `Back to …` or `Run all probes` in Setup arms first and says what would lock; a second press within 3 s unpublishes it. They unpublished it at one press (#252).
- `Restore latest` and `Restore path` ask first and say what the restore replaces, in Setup / Support and on the recovery screen (#252).
- Lighting's `Save · press twice` arms at the first press and saves the new scene at the second, as it says; it saved at the first (#252).
- In Lighting's Preview the key reads `Save into the scene`: it saves the preview into the scene, and the rig takes it when the scene is recalled. It read `Save to the rig` (#252).
- The Prompter XL shows the script: Studio Control opens a window of its own on it when it is plugged in, and closes it when it is unplugged. `PLAY` unlocks while the script is on the glass (#251).
- Until the links to the cameras are built, a restore leaves a camera's address out and says which (#243).
- Setup's `Map bindings` shows each dial's three controls under its cell of the strip, and its page tabs are keys like any other. In `Verify live echo` a key of another page turns the screen to its page (#248).
- In Setup, the state display of a setup that is not published counts the probes that passed once all have; it read "nothing verified yet" (#248).
- The window stays on its display when a screen is plugged in or out, and goes back to it when the display was switched off and returns. Windows could move it, and the next start then opened on the display it was moved to (#250).
- A stop of the hardware link during a session shows the same recovery screen as a failed start, with `Export diagnostics`, the restore keys and the log's last lines (#241).
- The window opens on the display it was last on, found by its place on the desktop. Windows' display numbers can swap between starts, and the window then opened on the other display (#241).
- A start that fails because the two program files are of different builds says so in plain words (#238).
- Studio Control is started with `Studio Control.cmd` in the builds folder, which always starts the verified build. Older builds stay beside it, each in a folder named by its day (#237).
- Studio Control always opens fullscreen, on the display it was last on or else the 2560×1440 one. Reset the window layout is in Setup / Support › Workstation and on the recovery screens (#216, #221).
- The first start of this build upgrades the saved data to schema 10. An older Studio Control then refuses it, so going back means the older app and the backup copy written before the upgrade (#201, #229).
- The Stream Deck bridge answers only the exported profile, which carries a token; the meters hear only TotalMix's own address. Export the profile again and import it with Full Reset & Import (#201).
- Setup / Support's status follows what fails in the background: a port that would not open, a backup that failed or is over two days old. A band at the foot of the page counts what failed unseen (#201).
- Sync from TotalMix reads the whole desk and changes nothing on it. The Console reads SYNC NEEDED, and the meters wait, while the desk has not been read since the link changed (#201, #204).
- Recalling a snapshot sets the desk, in order: mutes on, every value, mutes off, dim and mono. 48 V is never recalled: the report lists the channels that differ, each with its own Arm 48V (#201).
- Fader dB readings match TotalMix (RME's fader curve) on screen and on the Stream Deck. Unity is TotalMix's 0 dB, typed entry runs from −65 dB (off) to +6 dB, and fader positions are unchanged (#201).
- The Console takes no change until the audio probe has passed: each tier says "locked · run the audio probe", every refused control is outlined and says why, and Run audio probe is on the left (#201).
- 48 V, a snapshot's recall and a snapshot's save arm on the first press and apply on a second, separate press at least 350 ms later; a double-click no longer applies them (#85, #201).
- The Audio page is the Console: a mixer of Inputs, Playback and Outputs and, on the left, its state, the way out, Dim, Mono, the mix target, the main level and eight snapshots (#111, #201, #239).
- A strip reads in one order: name, level, source, Mute and Solo, fader and meter; 48 V and the preamp gain, in whole dB, are on the strip. The panel shows the whole selected channel, without tabs (#201).
- Lighting says what the rig is doing on the left, above Lighting on, Cut all, the grand master, scenes, groups and the rig's actions. The panel shows the whole selected fixture, without tabs (#201).
- Setup says where commissioning stands: READY, DEGRADED or SETUP REQUIRED. Each of its five steps fits a page without scrolling, and Support, always on the right, has the interface size (#201, #238).
- One header on every page, recovery screens included: the page tabs, the lamps and the latches. A lamp shows the worst state of its page, and a bar along the bottom carries the page's facts (#201).
- The screen names each piece of gear one way (the desk, the bridge, the deck, the hardware link), and every state says what happened and what to do next (#201).
- Nothing on the Console or the Lighting panel is printed under 12 px or is under 24 px to press, and every label is legible. Nothing moves under the pointer or on an idle page (#201).
- With Preview on, the Stream Deck's lighting keys stage their change and show PREVIEW, and the rig does not move. All On / All Off with no fixture patched is refused (#201).

### Removed

- The Console keeps no snapshots of its own: `Capture`, saving over a slot, renaming and deleting one, and a channel's `Rename` are gone; storing and naming happen in TotalMix. Snapshots captured in an older build stay in the saved data, unused (#282).
- The recovery screen has no `Install & Update` card, and no page has an `Update folder` key: they belonged to the installer, which is gone (#240).
- Talkback is gone: the Console has no Talkback key and the Stream Deck's AUDIO page no TALK key, whose place is empty. Export the profile again and import it with Full Reset & Import (#239).
- The Graphite and Bone themes are gone, with their keys in Setup / Support: Studio Control has one look, Studio (#238).
- The Planning page is gone, and the first start of this build drops its saved data (projects and tasks) after a backup copy. An older backup restores without its Planning part (#211, #213).
- The Stream Deck profile has two pages, LIGHTS and AUDIO: PROJECTS and TASKS are gone, and the Teleprompter and the Cameras have no deck page yet. Export and import the profile again (#213).
- Every keyboard shortcut and key hint is gone, with the command palette and the shortcut guide; each has a control on screen. Tab, Enter, Space, the arrows and Esc still work on what has the focus (#216).
- Studio Control runs on Windows at 2560×1440, fullscreen, and nothing else: the smaller layouts, the Windowed key, Studio Preview and the macOS build are gone (#221).
- A db.json from the old (Electron) Studio Control is no longer imported or restored. Verify and Restore say so, and ask for a backup archive or a database backup instead (#215).

### Fixed

- On the Lighting plate, setting one of a light's colour or effect controls (the INFINIBAR's Red, Green, Blue, FX, Speed) no longer puts its others back to 0 on the light (#304).
- A channel name with a letter beyond ASCII (`ö`) shows on the Console, and that channel's mute, gain and other values arrive with it; such a name lost the channel's whole report (#284).
- The daily database backup is written a day after the last one; every start of the app wrote one more, so restarts pushed older days out of the 14 kept (#284).
- A Stream Deck key is answered before the displays the deck asked for just before it, and sixteen places are kept for keys when the deck's link is busy. `engine.log` gets a line a minute about the deck's link while the prompter plays, or when the link was slow or busy (#291).
- `shell.log` names every screen's refresh rate, also when one changes, and warns when a screen runs below 50 Hz: a copy of the main screen at 30 Hz made the prompter's text scroll unevenly (#292).
- The prompter's text no longer steps back when a press and the glass's own read cross, or after the hardware link restarts: the glass and the Teleprompter's copy draw only the newest place, and glide over a small correction (#289, #290).
- The prompter's text no longer jumps when the deck's dials are turned while vMix records to the same drive: the place, pace and size are saved by a writer of their own, and the deck's PROMPTER keys and displays wait for no disk. Closing Studio Control now saves the last place (#287, #288).
- The Stream Deck's AUDIO and LIGHTS displays are read about ten times faster, which leaves the deck's link more room while the prompter plays, and the lights' output no longer keeps a processor core busy (#286).
- The prompter's text no longer jumps back or hangs when the speed is turned, the dial pushed or play pressed while a paragraph break, or the run to `END`, passes the reading line; it moved back by up to half a line, and up to half a screen before `END`.
- A change sent in two parts no longer reads as unconfirmed when TotalMix answered both at once; a recall could leave the Console `ASSUMED` with sends that were in fact set (#282).
- Enter in Lighting's empty search field no longer recalls a scene with its Recent list closed; a held Enter no longer confirms an armed key; a dialog no longer takes focus back every few seconds (#216).
- Lighting's Undo works after Add fixture, and an Undo whose scene or fixture has been deleted says why and lets the older steps through (#216).
- Enter on a focused scene tile recalls the scene, and on a focused group chip switches the group; the Lighting page shows an Identify or Find flash ending (#204).
- A Phones send edit no longer changes the channel's stored Main level, and a desk change or a Sync that meets an edit or a recall no longer leaves the wrong value on screen (#201, #204).
- The Stream Deck's displays no longer lag, and a key press is no longer lost, while the bridge is busy; a lighting key pressed while the Lighting page saves no longer drops one of the two changes (#201).
- The header's lamps, Setup's Stream Deck bridge row and the recovery screen's checks read ready, in green, when they are; on the workstation they showed yellow (#201).
- Backup times show the real date on the Backups rows, Latest backup, the Publish step and the recovery screen; they read January 1970 (#208).
- When a change reported by TotalMix cannot be saved, the Console reads SYNC NEEDED until Sync from TotalMix has read the desk again, instead of keeping an older value than the desk (#210).
- All thirteen strips fit the Console: Phones 1 and 2 are no longer cut or hidden while it is locked, no scrollbar shows under the Playback lane, and a strip key's tooltip holds its words (#201, #221).

## [2.2.1] — 2026-04-24

### Fixed

- Tauri shipping runtime now defaults operator app data to a durable platform app-data directory instead of `%TEMP%` / `/tmp` when `SSE_APP_DATA_DIR` is unset, preserving workstation persistence for published installer rollout and keeping explicit runtime-directory overrides available for test and evidence lanes.

### Changed

- Operator workstation rollout runbook now rejects temporary app-data paths during final published-installer verification.

## [2.2.0] — 2026-04-24

### Added

- Selected Tauri 2 + React 19.2 + TypeScript + Vite shell as the shipping release runtime through `scripts/native-release-runtime.json`, while retaining the Qt shell as an explicit fallback runtime.
- Replacement-shell coverage for Setup/Support, Lighting, Audio, and Planning, including live Tauri workspace qualification, fixture-driven visual review at `2560x1440` and `1920x1080`, and Playwright coverage for operator-critical flows.
- QtIFW shipping-path release evidence wrappers for macOS Apple Silicon and Windows 11 `x64`, including host/tool/git/runtime summaries for the switched `native:*` Tauri release lane.
- Windows target-host evidence collection for the post-switch native release path, covering packaged smoke, clean-start smoke, packaged acceptance, bridge verification, installer/update artifacts, continuity, delivery, and real installer acceptance.

### Changed

- The `native:*` release lanes now package the selected Tauri shell beside the bundled Rust engine while preserving the existing product identity, app-data paths, QtIFW package identifier, offline installer posture, and maintenance-tool update repositories.
- The cutover plan, handoff, architecture, development, release, and Windows target-host runbooks now record Checkpoint C evidence status and the retained Qt fallback boundary.
- Lighting intentionally remains scoped to the fixed studio rig without pan/tilt controls; Audio follows the locked `Ar+ - Control-room confidence desk` spec; Planning remains a secondary run-of-show workspace.

### Fixed

- Windows release wrappers now launch nested `npm.cmd` commands through the Windows command shell, avoiding `spawnSync npm.cmd EINVAL` on paths with spaces.
- Windows post-switch evidence validation now allows the evidence collector's own ignored output directory, including Git's collapsed `?? artifacts/native-release/` status, while still rejecting unrelated dirty worktree state.
- Tauri Windows install smoke now resolves the installed shell/engine layout correctly and tolerates platform-specific generated schema drift during evidence collection.

## [2.1.0] — 2026-04-21

### Removed

- Legacy Electron/Next.js runtime and all supporting tooling: `app/`, `electron/`, `lib/`, `__tests__/`, `e2e/`, `public/`, `build/`, `data/`, `instrumentation.ts`, `sentry.*.ts`, `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `electron-builder.yml`, `playwright*.config.ts`, `vitest.config.ts`, `tsconfig.json`, `.eslintrc.json`, and the `legacy:*` / `electron:*` / Next.js build and test scripts in `package.json`
- Electron / Next.js / React / Sentry / Playwright / Vitest / ESLint / Tailwind / PostCSS devDependencies and dependencies
- Obsolete `parity_regression` GitHub issue template
- `docs/LEGACY_RUNTIME.md`

### Changed

- The native Qt/QML shell plus Rust engine is the only product runtime; no browser-served or Electron-served path remains in the repository
- `docs/HANDOFF.md`, `README.md`, `CONTRIBUTING.md`, `docs/RELEASE.md`, `docs/DEVELOPMENT.md`, `docs/PRODUCTIZATION_PLAN.md`, `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md`, and `docs/DESKTOP_ARCHITECTURE_PLAN.md` rewritten around the native-only product posture; historical parity appendix preserved at `docs/archive/NATIVE_PARITY_HANDOFF.md`
- CI `ci` job reduced to security audit, format check, and release metadata check; CodeQL workflow drops the obsolete `npm run build` step

### Retained

- One-way legacy importer in `native/rust-engine/src/legacy_import.rs` so operators migrating from a pre-`v2.0.0` Electron installation can bring an old `db.json` forward on first native launch

## [2.0.1] — 2026-04-21

### Added

- Native parity acceptance model: deterministic offscreen `2560x1440` captures, real-GPU onscreen spot captures via `npm run native:parity:capture -- --onscreen`, and an install-time first-launch smoke test shipped in the QtIFW installer
- Release-anchor verification script and a repo-native closeout runbook for the remaining Windows, upgrade, and fallback-retirement release work
- Deterministic native evidence set for the `audio-populated`, `lighting-populated`, and `setup-ready` scenes via the engine-backed parity capture mode
- Native screenshot gallery in `README` sourced from the deterministic `2560x1440` evidence set

### Changed

- Native operator parity is signed off on the engineering side; residual hardware-specific regressions are caught by the install-time smoke test on the target workstation instead of a pre-release operator-monitor visit
- Setup commissioning substrate tuned toward the legacy oracle: modal backdrop blur and scrim unified, accent glows raised to match legacy `globals.css`, setup framing and control-surface layout restructured
- Repository compacted around a single engineering handoff plus a detailed parity appendix; stale parity-recovery, migration-board, and closeout documents retired

### Fixed

- Native release acceptance now treats `lighting.snapshot.status` as the source of truth for scene-recall gating, avoiding false CI failures when the commissioning probe reports a transient pass before runtime state is `ready`
- Native Windows installer acceptance now defaults to a repo-local path without `~`, which avoids QtIFW rejecting the install root on real Windows hosts during release validation
- Native QML shell tests now select the configured CMake build configuration when the generator is multi-config, which fixes the Windows CI `ctest` invocation
- Windows CI native shell tests now run against the software scene-graph backend to avoid the D3D11 RHI hang on the GitHub Windows runner (the lane remains diagnostic-only until three consecutive green runs)
- Parity request URLs on the setup control-surface evidence are normalized back to legacy-visible `localhost:3000` values, preventing false divergence in operator-visible request data

## [2.0.1-rc.1] — 2026-04-17

### Added

- Release-anchor verification script and a repo-native closeout runbook for the remaining Windows, upgrade, and fallback-retirement release work

### Fixed

- Native QML shell tests now select the configured CMake build configuration when the generator is multi-config, which fixes the Windows CI `ctest` invocation
- Native Windows installer acceptance now defaults to a repo-local path without `~`, which avoids QtIFW rejecting the install root on real Windows hosts

## [2.0.0] — 2026-04-17

### Added

- Native-first desktop runtime covering planning, lighting, audio, commissioning, support, backup/restore, and Companion export through the Qt/QML shell plus Rust engine
- Offline native installers, maintenance-tool update repositories, per-platform `SHA256` manifests, and release verification gates for packaged smoke, staged delivery, installer acceptance, and continuity
- Native support tooling for runtime paths, diagnostics export, packaged acceptance, and structured installer/update artifact validation

### Changed

- Tagged releases now ship the native macOS and Windows product instead of the legacy Electron desktop path
- The browser/Next.js and Electron runtime are now explicitly treated as archival reference and rollback surfaces, with `legacy:*` commands for intentional use
- Release notes, repo guidance, and operator rollout documentation now describe controlled unsigned workstation deployment as the supported production posture

### Fixed

- Packaged smoke and release-artifact verification now use structured status and checksum validation instead of brittle log scraping
- Native packaging and staging now preserve bundle integrity more reliably and emit cleaner diagnostics during local release verification

## Before 2.0.0

Versions 0.1.0 to 1.14.0 (March and April 2026) were the Electron app that 2.0.0 replaced. Their entries are in git history.
