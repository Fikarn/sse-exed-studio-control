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

**Header.** `Studio Control` at the left; then the tabs, `Setup / Support`, `Lighting`, `Audio`, `Cameras` and `Teleprompter`. Each page's tab carries that page's lamp with its worst state as a word: green is fine, amber wants attention, red is a fault. The open page's tab carries none, because its state display says it, but keeps the room of it, so no tab moves when the page changes. Before the app is ready the lamps are hollow and read `pending`, or `not read` after a start that failed. The deck's lamp, `Surface`, follows the tabs; pressing it opens Setup / Support. The SSE logotype stands at the right.

- `Lighting`. `ready`: the bridge passed its last probe, and answers during the session. `not answering`: it has stopped answering (the app looks every 5 s); nothing is locked. `held`: nothing is sent to the rig. `unsaved`: the rig differs from the recalled scene. `unreachable`: the probe has not passed. `no output`: the light output could not open its port, so nothing reaches the rig; arming does not help, restarting the hardware link does.
- `Audio`. `ready`, or the Console's state in small letters, such as `sync needed`.
- `Cameras`. `ready`: all three are held. Otherwise the worst camera's state in small letters: `released`, `not set up`, `unreachable`. Today that is `not set up`.
- `Teleprompter`. `ready`: the Prompter XL shows Studio Control's window. `playing` and the time left while the prompter scrolls. Otherwise the Teleprompter's state in small letters, such as `not connected` or `not updated`, which wins over `playing`.
- `Surface`. `ready`: Companion, with the profile and its token, asked the app in the last 5 s (it asks once a second, whether the Stream Deck is plugged in or not). `no deck`, amber: it has not; Companion may be closed, or its profile lacks the right token. Nothing locks. `unavailable`: the app could not open its port. That the deck itself answers, Setup's `Verify live echo` shows.
- `Backup`, amber, after `Surface`, only while something is wrong: `failed` when the automatic backup could not be written, `overdue` when none has been written for two days. Pressing it opens Setup / Support, where the backups are.

A latch shows while something is on, on every page but its own, which shows it itself: `SOLO` (the Console shows it in its latch slot; on Lighting, which has a Solo of its own, it reads `AUDIO SOLO`), `SCENE DRIFT` (only while the Lighting tab says something worse than `unsaved`). Pressing it opens its page. `REC` has a slot of its own before the clock, on every page: quiet while nothing records, `REC CAM 1` in coral while CAM 1 records, amber `last known` when CAM 1 stopped answering while it recorded, amber `not read while released` while CAM 1 is released. Pressing it opens the Cameras page. The clock comes last.

**Page.** The cluster on the left, the bay in the middle, the plate on the right. The state display, top left, says what is true in one word and one sentence of at most two lines (point at a sentence cut short to read it whole), and offers the way out as a key; its `⋯` opens the page's menu. Under it, the latch slot shows what is latched and the key that clears it, or `Nothing latched`. The footer holds the page's facts, such as `Metering TotalMix · live`.

**Keys.** Amber is switched on, green is running now, a red lamp is a hazard that is on. A dashed, dim key is locked: point at it to read why. A `press twice` key arms at the first press, reads `ARMED · press again` and counts down 4.5 s (3 s for the cameras' stop and for a press that would unpublish the setup). A second press, 0.35 s later at the earliest, applies it. `Esc` cancels.

**Keyboard.** No shortcuts. Tab, Enter and Space, typing, the arrows on a slider or a list, and `Esc` do what they do in any program.

## Lighting

The state display reads one of six words.

- `REACHABLE`: the bridge passed its last probe.
- `NOT ANSWERING`, amber: the bridge has stopped answering during the session (Studio Control looks every 5 s). Nothing is locked. Check the bridge's power and its network cable; the word clears by itself when the bridge answers again. Do not run the bridge probe during a session: a probe that fails locks the rig. When the light outputs are held as well, the sentence says so, and `Open Setup` goes to the `Light outputs` switch.
- `HELD`: the light outputs are held, and nothing is sent to the rig. `Open Setup` goes to the `Light outputs` switch.
- `UNSAVED`: the rig differs from the scene on the rig, as the deck's `RECALL` says too (a `Highlight`, a `Solo`, an `Identify` and a running fade do not count). `Save changes` writes the rig into that scene. `Recall it again` puts the scene back.
- `PREVIEW`: `Preview` is on. You edit offline and the rig stays as it is. `Save into the scene` writes the preview into the scene; the rig changes when the scene is recalled. `Discard` drops the edits. The `Grand master` waits while previewing: it acts on the rig itself.
- `UNREACHABLE`: the bridge has not passed its probe (or its address changed since). A recall is refused: the Scenes head says `recalls refused`, and a scene row still shows its scene on the plate. `LIGHTING`, the `Grand master` and the Save row are locked; the rest still reaches the rig, the plot and `CUT ALL` included. `Open Setup`, run the bridge probe, publish again.

Held is not a blackout: the rig keeps its last look. Scenes and fixtures still move on screen. `DMX monitor` (the state display's `⋯`) shows every channel as it is sent, or as it would be while held.

- **The page's `⋯`** on the state display holds `Add fixture…`, `Patch`, `Preview`, `DMX monitor…`, `DMX strip` and `Open Setup`.
- **Recall** is one press on a scene's row. A scene on the rig says `ON RIG` or `UNSAVED`, the preview's `PREVIEW`, as the deck's `RECALL`. `Fade` sets the fade, 0 to 10 s, for every recall, here and on the deck.
- **Save.** `Save as a new scene`, the row under the scenes, arms at the first press and saves the rig as a new scene (`Scene N`) at the second. `Save changes` saves over the scene on the rig at one press. `Undo` takes back a scene saved.
- **Scenes.** A scene's `⋯`, or a right-click on its row, recalls it, saves the rig into it, renames, pins or colours it, and deletes it: `Delete scene…` arms in place and deletes at the second press. When there are more scenes than fit, they come in pages.
- **All lights.** `LIGHTING` switches every fixture on or off. `CUT ALL` takes them all to off: press, and press again within 3 s, as the deck's `ALL OFF`. A cut, or `LIGHTING` off, also ends a `Highlight`, a `Solo` and every `Identify` or `Find` flash, so the rig goes dark; in Preview it cuts the preview only. `Grand master` is one level over them all.
- **The plot** is the room at its real metres, with a ruler on its top and left edge. Its `⋯` in the bar under it, or a right-click on its floor, frames the rig or fits the room, chooses what it shows, the symbol key, and saves or clears views `1`, `2`, `3`; a press on a saved view recalls it.
- **Select** a fixture on the plot. While `Add to selection` is lit, a press adds or removes one and a dragged box adds several. The bar under the plot names the selection; `Clear` empties it. Press a group's key to switch it on or off; its `⋯` shows it on the plate, renames, colours or deletes it.
- **Set** the selection in the plate: `Light`, lit while the fixture is on (a group's plate has `Group`, several fixtures `Selection`), `Intensity`, `Colour temperature`, `Palettes`. A small mark under a slider is the level the scene on the rig keeps, yellow while the rig has left it. Double-click a slider to type a value. `Edit…` beside `Placement` opens the place on the plot, which the rig does not use. The plate's title `⋯` (or a right-click on the fixture on the plot) holds `Delete fixture…`, which arms in place.
- **Palettes.** A press applies a palette to the selection; its `⋯` edits, moves, colours or deletes it.
- **Find a light.** `Identify` flashes one fixture, `Find` the selection in turn. `Highlight` holds the selection at full, `Solo` takes all others to off; while either is on it stands under the state display with `Off`. Press the key again to end it; `CUT ALL`, `LIGHTING` off and the deck's `ALL OFF` end it too.
- **Undo** takes back the newest of 25 steps: a scene saved or deleted, a fixture added or deleted. It takes back no recall and no level. It keeps its steps when you leave the page and come back, and forgets them at a restore or a restart of the hardware link, when the saved data they name may have changed. A step whose scene or fixture was deleted since, on the deck or on screen, or whose scene was renamed, is refused and says why.

## Audio (the Console)

- **Rows.** `Inputs` in banks of four, turned with the arrows on the heading (`1 / 3` between them); `Playback`. The fader scale stands beside each row's first strip.
- **Outputs.** In the left column, under `DIM` and `MONO`: `Main Out`, `Phones 1` and `Phones 2`, each a row of its key, its level, `M`, its fader and its meter. This is the one place an output's level is set; its `⋯` sets it by number or to 0 dB, and shows the output on the plate.
- **Names.** Every strip carries TotalMix's name for its channel, and is renamed in TotalMix. A channel TotalMix names nothing keeps its own.
- **Mix target.** The lit output (yellow, `mix target`) is the mix the faders send into: press an output's key to make it the target. `DIM` and `MONO` are `Main Out`'s, whichever output is the mix target: TotalMix has neither for the phones, so their menus have neither.
- **Strip.** Its name, the level it sends into the mix target, `M` for mute, `S` for solo, the fader. Press a strip to open it in the plate. Its `⋯`, or a right-click on it, holds the rest: the level and the gain by number, the send to 0 dB, Hi-Z, polarity, AutoSet and the clip.
- **48 V** is a hazard, armed for each channel: press twice. A red lamp means it is on. The strip's `⋯` ends in `Turn 48 V off…`, also pressed twice.
- **Gain** shows on a preamp's strip. `Set preamp gain…` in the strip's `⋯` types it, 0 to 75 dB; the plate's knob rides it.
- **Groups.** A row's `⋯` shows only some groups (Talent, Line, Bed, FX, Remote); the heading then says which, and `Show all` brings every strip back.
- **Plate.** The whole strip, without scrolling: its preamp (an input's), the other mixes it feeds (a row's `⋯` makes that mix the target) and its meter. Each section's `⋯` holds its switches. The equaliser, the Low Cut and the dynamics are set in TotalMix.
- **Solo and clip.** The latch slot names the soloed strips, with `Clear all`; a clip latches beside it, with `Clear`.
- **Snapshots** are TotalMix's own eight, under the names TotalMix last saved (it saves them when it closes); one without a name reads `Slot 3`. `ACTIVE`, with a green lamp, is the one TotalMix has loaded, `CHANGED`, with a yellow lamp, that it changed since. Press a slot, then again while it reads `LOAD?`, to load it in TotalMix; the Console then reads the desk. A double-click only arms it. Snapshots are stored and named in TotalMix, and 48 V does not switch with one.
- **The page's `⋯`** holds `Sync from TotalMix`, which reads the desk and changes nothing on it, `Run audio probe`, `Clear clips`, `Peak hold`, `Reset peaks` and `Open Setup`.

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

A change counts as confirmed when TotalMix reports it; a send or a solo turned off also counts when TotalMix's list of that mix leaves it out, as TotalMix lists no send at or below −65 dB. A change TotalMix does not report reads `ASSUMED`. While TotalMix has not confirmed the desk, every level the Console prints (the strips', the outputs' and the plate's other mixes) carries a dashed yellow keyline; the state display counts the values TotalMix confirmed, and the last sync is in the footer. One TotalMix reports with another value goes back to TotalMix's value: the desk wins, and for a switch `Recent actions` shows it as a change at TotalMix.

The meters wait in `SYNC NEEDED`, `ASSUMED` and `ACTION FAILED`. The app never runs the probe by itself: `OFFLINE` stays after TotalMix is back, until you press `Run audio probe`. If it keeps failing, check TotalMix against [HARDWARE.md](HARDWARE.md).

TotalMix is out of touch when its remote 4 has stopped answering: remote 4 switched off in TotalMix, or TotalMix closed. Once it answers again the Console reads `ASSUMED` and says for how long, as a change made in TotalMix meanwhile may not have arrived; `Sync from TotalMix` reads the desk whole. When TotalMix was out of touch the state display says so and for how long, until the next action. After every start of the hardware link, a restart by itself, `Restart the hardware link…` and a database restore included, a Console that was `VERIFIED` or `ASSUMED` reads `ASSUMED` until the first Sync or load, as TotalMix may have changed meanwhile; its meters wait until then.

## Teleprompter

The presenter reads the script on the Prompter XL, in a window of Studio Control's own: the script on black, and nothing else. The page shows a copy of it, line for line.

- **The Prompter XL's window** opens by itself when the Prompter XL is plugged in, and shows what the prompter held, paused. It fills that screen and is shown on no other. It takes no keyboard and shows no pointer. It closes when the Prompter XL is unplugged, and when Studio Control closes.
- **`NOT CONNECTED`.** Windows does not see the Prompter XL. A text that scrolled is paused at its place, and `PLAY` is locked. Everything else works on the page's copy, and the place it sets is where the script comes back.
- **`DUPLICATED`.** Windows shows a copy of another screen on the Prompter XL. Nothing is drawn there. In Windows' display settings, choose Extend these displays.
- **`LOW RESOLUTION`.** Windows runs the Prompter XL below 1920×1080. The script is drawn, less sharp.
- **`NOT SHOWING`.** The window does not show, or its page does not draw. The reason, in Windows' words, stands at the foot of the plate under `NOT SHOWING` while it lasts. Studio Control opens the window again by itself every few seconds; a text that scrolled is paused. `Prompter XL…` in the footer shows the screen as Windows reports it.
- **When the hardware link stops,** the text on the Prompter XL stands where it was. After the restart it shows the saved place, paused.

- **Scripts.** The page's `⋯`, at the top right of the state display, holds `Open file…`, which reads a Word document (`.docx`) or a text file (`.txt`), `Paste as a new script`, which takes the clipboard, and `New script`, an empty one. With no script yet and the Prompter XL `READY`, `Open file…` is the state display's own key too. The app keeps its own copy and never changes the file.
- **An import** keeps text, paragraphs, bold, italic and underline. Headings and text in square brackets become cues: directions, never read aloud. It says what it left out.
- **The list** is sorted by name, so number the scripts to order them. Each script has a `⋯` on its row, and a right-click on the row opens the same menu: `Select`, `Put on the prompter` or `Replace on the prompter…`, `Edit script`, `Rename…`, `Earlier versions…`, which opens beside the plate with `Bring back`, and `Remove`, which moves the script to Removed. The plate's title has the selected script's `⋯` too, with `Edit script`, `Rename…`, `Earlier versions…` and `Remove`; its Put on or Replace is the key under its name. The Scripts `⋯` shows Removed; a removed script's `⋯` has `Restore` and `Delete for good…`, which asks in the menu, press again, and cannot be undone.
- **Edit.** `Edit script` opens the selected script. It saves as you type: `Saved 14:02`. `Live copy` brings the glass back.
- **Put on.** `Put on the prompter`, under the script's name on the plate, is one press while the prompter is blank. The script comes on paused, at its own place. `Replace on the prompter`, `Update the prompter` and `Clear the prompter` are press twice: the first press turns the key dark red with "press again" and a countdown, and the state display says what the second does. A script's `Replace on the prompter…` selects it and arms the plate's key; the second press is on that key.
- **Update.** An edit to the script on the prompter stays in the app, and the state reads `NOT UPDATED` with `Update the prompter` in its display. An update keeps the same words at the reading line.
- **Run.** Only `PLAY` starts the scroll. `BACK` goes to the start of the paragraph at the reading line. `TOP` pauses and goes to the first line. At `END` the scroll stops.
- **Speed** is in words a minute, 40 to 300 in steps of 5. Each script keeps its own; a new one starts at 140.
- **Jump** by line, paragraph or cue, or press the script bar. A jump keeps the scroll as it was.
- **Size** is in the take, beside the speed: 4 px a press, from 48 to 160 px, and `Standard` returns to 88 px. It works while nothing is on the prompter too.
- **The look** is one for the glass and applies at once. The plate shows it; `Change…` opens the spacing, margins, reading line, colour, dimming, the line across and the paragraph numbers beside the plate. A slider sends when you let it go.

## Cameras

CAM 1's link is built: pair it once in Setup (Setup / Support, below), and Studio Control holds it over Bluetooth. CAM 2's and CAM 3's are not built yet: they read `NOT SET UP` and say that their link comes with a later version, and their controls are locked. The pictures come from vMix's Outputs 2, 3 and 4 over NDI while vMix runs and sends them; with vMix closed each picture's place reads `NO PICTURE` and the state display `NO PICTURES`. The rest of this section is how the page works with a camera that is held.

- **Select** a camera with its key on the left or its small picture. The big picture, the plate and the Stream Deck's dials follow. `REC` does not: it is always CAM 1's.
- **A camera's `⋯`**, beside its key, in its small picture's label and in the plate's title, or a right-click on its key, its small picture or the plate's title, opens its menu: `Select`, `Read CAM n again` (`Connect CAM n` while it is released, `Try CAM n again` while it does not answer), `Camera setup`, and `Release CAM n…` last.
- **The Stream Deck's dials** set the selected camera. `Exposure`, `Colour` and `Focus` choose what they set, as the deck's `BANK` does. The line under them says what the dials set, or why they set nothing now.
- **Pictures.** The selected camera is big, the other two small. `Whole frame` shows all of it, at 87.5 %; `1:1` shows a part pixel for pixel. The loupe shows a part at `2:1` or `4:1`. Press the big picture to move the part.
- **Aids.** `Guides`, `Peaking` and `Zebras 95 %` are drawn on this screen only and never reach a camera, vMix or a recording. They are off at every start.
- **A picture that does not arrive** leaves its place empty with the reason in it, and the Pictures rows on the left read `NO PICTURE`. While the selected camera's is missing, `Whole frame`, `1:1`, the aids and the loupe are locked; the camera's own controls still work. When every camera is held, the state display reads `PICTURE MISSING` (vMix sends pictures, and none for that camera: check in vMix that its output, 2, 3 or 4, is on and sent over NDI) or `NO PICTURES`, and `Look again` looks once more.
- **Values.** An arrow steps a value at one press. A press on the value opens, beside the plate, the list the camera allows (the camera's value is outlined; a press, or the arrows and Enter, picks one), or a field for white balance and tint (`Set value` or Enter; the value goes to the camera's nearest step). Esc, the value again or a press anywhere else closes either without a change, and the pictures stay drawn meanwhile. The list follows the camera: a value changed on the camera while it is open moves its outline. `Auto iris once`, `Auto white balance once` and `Autofocus once` run once. A value a camera does not report says so.
- **Format and look.** The plate shows the resolution, the frame rate, the dynamic range and the display LUT as the camera reports them; `Change…` beside `Format` or `Profile and LUT` opens their keys beside the plate, the camera's value outlined. Each is press twice: the first press arms the key in place (`ARMED` and a countdown on the key, and the state display says what the second press does), the second sets it, and the picture drops while the camera changes. Closing the keys (Esc, `Change…` again, a press anywhere else) drops the arm, and so does a camera that stops answering. A value the camera does not allow now is locked, and the reason stands under its row.
- **Record.** `REC` starts CAM 1 at one press. While CAM 1 records the key has a red lamp, and the header shows `REC CAM 1` on every page. Stopping is press twice, the second within 3 s.
- **The take.** The length is Studio Control's own count, from a start it saw; of a take that ran before it looked, the length is not known. The timecode is CAM 1's. CAM 1 does not report its card time over Bluetooth.
- **Release**, press twice, hands the camera to the iPad (CAM 1) or to LUMIX Tether (CAM 2, CAM 3). Studio Control then neither reads it nor sends to it, and a take it records goes on. `Connect` takes it back; until then the camera stays released, through a close and a start too, so the iPad keeps CAM 1 until you take it back. It is the plate's key, or `Release CAM n…` in a camera's menu: in the selected camera's menu it arms in place and the second press releases; in another camera's menu it selects that camera and arms the plate's key, and the second press is there.
- **The camera wins.** A change made on the camera shows on the page within about a second.
- **Recent** lists the five newest camera actions and who did each. `All actions…` opens Setup / Support, which lists the actions of every page.
- **`Read all cameras again`** reads the three once and sends nothing. **`Camera setup`** opens Setup / Support's `Cameras`.

The state display speaks of the camera that is worst off, and of the selected one among equals.

| State         | It means                                                       | Way out                                       |
| ------------- | -------------------------------------------------------------- | --------------------------------------------- |
| `HELD`        | Studio Control reads the camera and sends only what you press  | None is needed                                |
| `RELEASED`    | It is handed over, and not read                                | `Connect`                                     |
| `NOT SET UP`  | No pairing (or Windows lost it), no address, or no link yet    | `Camera setup`                                |
| `UNREACHABLE` | It does not answer; its last values are amber, its keys locked | Check that it is on and in reach; `Try again` |

While CAM 1 is `UNREACHABLE` after it reported recording, `REC` reads `last known 09:11 · STOP is locked until CAM 1 answers`: the take is left as it was. Stop it on the camera if it must end.

## Stream Deck

A control on the deck does what the same control does on screen, and the screen follows. Putting the profile on the deck is in [HARDWARE.md](HARDWARE.md).

Every page has the same frame. `REC` is top left and `PLAY` under it, so a take never needs a page change. The key top right, in dark green, names the next page with the screen's tab word and turns the deck alone to it, round again: `Audio`, `Cameras`, `Prompter`, `Lighting`; its dots are the four pages, the next one lit. A key that belongs to a dial sits above it. The strip shows each dial's name over its value, and a tap on it does nothing. A dark key does nothing.

The deck follows the app: `Lighting` turns it to `LIGHTS`, `Audio` to `AUDIO`, `Cameras` to `CAMERAS` and `Teleprompter` to `PROMPTER`. Setup / Support has no page on the deck, which stays where it is.

**`REC` and `PLAY`, on every page.** `REC` is CAM 1's, whatever page or camera the deck is on. One press starts. While CAM 1 records the key has a coral outline, lamp and word and the take's length, counted as the Cameras page counts it; a press makes it read `STOP?` and "press again" in dark red, and a second press within 3 s stops. A press that arrives twice within a third of a second is one press. The key can read `STOP?` for up to a second after the 3 s: a press then arms the stop again, and the next stops. If the take ended meanwhile, on the camera or from the screen, the press does nothing, and the next starts a take. While CAM 1 does not answer mid-take it has a dashed yellow outline and a yellow lamp and reads `LAST KNOWN`, and the stop is locked; while CAM 1 is released or not set up it reads `locked`. `PLAY` plays or pauses, with the time left under it; it is green while the text scrolls, and grey with `END` at the script's end, `NO XL` while the Prompter XL shows nothing, `--` while nothing is on the prompter. A press of `PLAY` that arrives twice within a third of a second is one press.

**`LIGHTS`.** `ALL ON` and `ALL OFF` switch every fixture; `ALL OFF`, in coral, asks first: a press makes the key read `OFF?` and "press again" in dark red, and a second press within 3 s acts. If Preview changed in between, the second press does nothing. Another key of the page ends the question, and the next press asks again. `SAVE` saves the rig as a new scene, which the `SCENE` dial then has chosen. `RECALL` puts the chosen scene on the rig with the Lighting page's `Fade`, and says under its word whether a press would change the rig: `ON RIG` (green) while the rig holds the scene, `UNSAVED` (yellow) while it was recalled and the rig changed since, `PREVIEW` (blue) while Preview is on; `scene` when a press changes the rig. Deleting a scene stays on the screen. The dials: `LIGHT` chooses a light, and a push switches it on or off; `INTENSITY` moves 5 % a step, a push sets 100 %, and it reads `OFF` while the light is off; `CCT` moves 200 K a step inside the light's own range, a push sets the middle of it, as the plate's Reset (4400 K on an Astra, 6000 K on the INFINIMAT and the INFINIBAR); `SCENE` chooses a scene, and a push recalls it as `RECALL` does. While Preview is on they change the preview, and the values are blue.

**`AUDIO`.** `Main Out` makes Main Out the mix target, the dials' home, and is yellow while it is. `Phones` goes to Phones 1, then Phones 2, then Phones 1 again, and reads which while it is yellow: a take never starts with the dials riding a phones mix by mistake. `BANK` puts the dials on inputs, playback or outputs, with a dot for each, and is yellow off the inputs: the dials are not on the microphones. `DIM` dims `Main Out` by 20 dB and is yellow while it does. `SOLO` clears every solo; while any is on it has a yellow outline, lamp and word, with how many and `Clear all`, as the screen's latch. A dial's turn sets the level into the mix target and its push mutes; the preamp gain is set on screen. A press of `DIM`, or a push that mutes, that arrives twice within a third of a second is one press. The strip shows each strip's name, its level and a bar for the fader's position, `MUTED` in yellow; it is not a meter. While the Console is locked the keys are locked (a dashed outline, grey words) and the strip gives the reason.

**`CAMERAS`.** `CAM 1`, `CAM 2` and `CAM 3` select the camera, as on the page; the selected one has a beige outline, and beside each name a lamp and under it its state in the screen's words and colours: `HELD` green, `RELEASED` and `NOT SET UP` yellow, `UNREACHABLE` coral. While the camera does not answer, a dashed yellow outline sits round each value on the strip: its last values. `BANK` puts the dials on exposure (ISO, shutter, iris, ND), colour (white balance, tint) or focus, in turn, and the strip shows what each dial sets and the camera's value. A turn is one of the camera's own steps. On focus, a push of the first dial is autofocus once. A camera that is not held takes nothing from the dials, as the page's controls are locked; `REC` is refused while CAM 1 is not held. Until their link is built, CAM 2 and CAM 3 are never held.

**`PROMPTER`.** `◂ CUE` and `CUE ▸` jump to the cue before or after, and `BACK` to the start of the paragraph, as on the page; `TOP` pauses and goes to the first line. The dials are `SPEED` (5 words a minute a step; a push plays or pauses), `LINE` (a line back or on; the cell shows how much has been read), `PARAGRAPH` (a paragraph back or on; the cell shows which, or `END`) and `SIZE` (4 px a step; a push returns to the standard size). While nothing is on the prompter every control is grey and does nothing. While the Prompter XL shows nothing `PLAY` is grey and reads `NO XL`; the jumps, the speed and the size work. A script is put on, replaced, updated and cleared on the screen only.

**Colours.** The deck has the screen's colours, words and forms. A yellow key: chosen or switched on (the mix target, `DIM`, `BANK` off the inputs). Green: running now, which is `PLAY` while the text scrolls and a scene the rig holds. An outline with a lamp and its word: latched, yellow for `SOLO`, coral for `REC` recording. Coral words and edge: a key that switches everything off. Dark red with "press again": the key asks, and a second press within 3 s acts. A beige outline: the selected camera. A dashed yellow outline: the last a camera reported before it stopped answering. Blue: Preview. A dashed grey outline: locked; the `AUDIO` strip gives the reason. Every key grey and every value gone: the deck has not heard the app for 4 s; it comes back by itself when the app answers again.

## Setup / Support

`Runner`, `Support` and `Cameras` choose what the bay shows. The plate on the right is always Support. The state display's `⋯` holds `Export backup`, `Open the log` and `Back to the Console`, which opens the Console once the setup is published. A step's sentence, and a section's, is the tooltip on its name.

**The runner's steps**

1. `Import profile` exports the Stream Deck's profile for Companion into the exports folder the screen names: `Export and continue` also opens `Probe hardware`, `Export only` does not. Start Companion first; in Companion, import it with `Full Reset & Import`.
2. `Probe hardware` holds the bridge's and TotalMix's addresses and runs the probes. Each probe saves the address it asks, whether it passes or not: the lights and the Console follow it. The deck's probe passes when Companion asked the app in the last 5 s: start Companion with the profile imported first. A probe that failed stays failed until the probes run again, even after the lamp turns `ready`: Setup reads `SETUP REQUIRED` before a publish, `DEGRADED` after one with the override. On a published setup, running the probes again unpublishes it first (below).
3. `Map bindings` shows the deck's four pages as the profile draws them: the eight keys (the page key dark green, a dark key black), the strip under them, and each dial under its cell of the strip: its push reads `PUSH`, then its two turns.
4. `Verify live echo`: a control pressed on the deck lights its cell on screen. A key of another page turns the screen to that page.
5. `Publish` unlocks the pages, exports a backup and opens the Console. Over a probe that is not green it asks first and records it.

On a published setup, a step, `Back to …` and `Run all probes` read `press twice`. The first press arms the key, dark red with a 3 s countdown, in its own place and height; the state display says where the second press goes and that `Lighting`, `Audio`, `Cameras` and `Teleprompter` would lock, and a second press within 3 s unpublishes the setup. They stay locked until `Publish setup` is pressed again. The devices and the deck keep working. A press on `Publish`, the step a published setup stands on, does nothing. Leave the runner alone during a session; the Console has its own `Run audio probe`.

**Workstation.** `UI scale` is 90, 100, 110 or 125 %. `Studio fullscreen` puts the window fullscreen on the studio display; `Reset the window layout` also forgets where it was last. `Light outputs` reads `ARMED` or `HELD`, with `Armed` and `Held` under it; arming sends the current state at once. `Prompter XL` shows what Windows reports.

**Cameras.** `Cameras` shows `Camera setup`: what Studio Control needs for each camera: CAM 1's pairing and CAM 2's and CAM 3's addresses. It names the vMix output each picture comes from, CAM 1 Output 2, CAM 2 Output 3 and CAM 3 Output 4, which are set in vMix and not here. Saving sends nothing to a camera. `Forget CAM n…`, the last item of the camera's `⋯` (or a right-click on it), removes a pairing or an address: it asks in the menu, press again. Studio Control contacts only an address entered here. Until a camera's link is built its address is locked (CAM 2 and CAM 3).

**Pairing CAM 1.** Once, with the camera beside you. Switch on the Pocket's Bluetooth and close the iPad's app (a Pocket held by the iPad cannot be found). Press `Pair CAM 1`: the line under CAM 1 reads `Looking for CAM 1…`, for a minute at most. The camera then shows a 6-digit PIN, and a `PIN` row opens: type the PIN and press `Pair` within 30 seconds. CAM 1 then reads `paired` and `HELD`, and the camera's Bluetooth menu names `Studio Control`. A camera not found, a wrong PIN or a PIN too late says so on that line, and nothing is saved: press `Pair CAM 1` again. `Forget CAM 1…` also stops a pairing that runs. Windows keeps its own pairing after `Forget`; the next pairing replaces it. If Windows loses the pairing (removed in Windows' Bluetooth settings), CAM 1 reads `NOT SET UP` and says so: pair it again.

**Backups.** `Export backup` writes a backup archive. `Verify latest` checks the newest backup and changes nothing. `Restore latest…` restores it. They are on the plate and in its `⋯`. The Support screen lists every backup, eight a page: press one to put its path in the field, then `Verify path` or `Restore path…`; each backup's `⋯` has `Verify` and `Restore…`. A restore asks first and says what it replaces: a database backup replaces all the saved data, a backup archive the settings, and adds its scripts. It keeps a copy of what it replaced. A database backup restarts the hardware link. Every restore comes back with the light outputs held: arm them with `Light outputs` when the rig should follow.

**Diagnostics.** `Export diagnostics` writes a report. `Open the log` opens the log. While the text plays, the log gets one line a minute from the prompter, `Prompter, the last minute: …`: the longest its lock was held and waited for, and by what; what it saved, refused and failed to save, and its longest write; and how many anchors went to the glass and the page. After a take that stuttered, it says where the time went.

**Recent actions** lists the last eight actions that changed what a device receives, and who did each: `Screen`, `Stream Deck`, `Console` (a switch thrown at TotalMix) or `Start-up`. Faders and dials are not listed.

**`Restart the hardware link…`** asks first. The link and the deck drop for a few seconds; TotalMix and the lights keep their state, and the Console reads `ASSUMED` until `Sync from TotalMix`.

## When something goes wrong

| You see                      | It means                    | Do this                               |
| ---------------------------- | --------------------------- | ------------------------------------- |
| `SAVED DATA DAMAGED`         | The saved data is damaged   | `Restore latest…` on that screen      |
| `LINK STOPPED`               | It stopped in the session   | Wait; after 4 stops, `Retry startup`  |
| `ALREADY OPEN`               | The app runs already        | Use the window that is open           |
| Another word at the start    | The link did not start      | `Export diagnostics`, `Retry startup` |
| `AUDIO STOPPED` and the like | A page failed to draw       | `Reload this area`                    |
| A device does not follow     | The link may be stuck       | `Restart the hardware link…`          |
| Lighting `held`              | Nothing reaches the rig     | `Light outputs` to `ARMED`            |
| Lighting `no output`         | The output's port is taken  | `Restart the hardware link…`          |
| `Backup failed` or `overdue` | No automatic backup written | `Export backup`; check disk space     |
| Lighting `unreachable`       | Its probe has not passed    | Run it in Setup, then publish         |
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

The hardware link restarts by itself after a stop, three times in five minutes; the Console then reads `ASSUMED` until `Sync from TotalMix`. At the recovery screen only a database backup restores: `Restore latest…`, which takes the newest database backup, or press one in the list and `Restore path…` (an archive there is locked, and the screen says why). It asks first. The link restarts into it, with the light outputs held.

Closing asks first. It resets and recalls nothing: TotalMix keeps its state, the light output stops and the fixtures hold their last levels.

## Saved data

Everything is in `%APPDATA%\ExEd Studio Control Native`: the database, and the `backups`, `exports` and `logs` folders.

The app backs the database up by itself and checks every copy: before it upgrades the saved data, daily, at every clean close and before a restore. It keeps the last 5, 14, 3 and 5 of them. `Export backup` adds a backup archive: the setup, the lighting and audio settings, the deck's settings and the scripts.

A newer build upgrades the saved data at its first start. An older build then refuses it. Going back means putting the backup from before the upgrade in place of the database, by hand and with the app closed. What was saved after the upgrade is lost.

Never delete the `backups` folder. It is the only way back.
