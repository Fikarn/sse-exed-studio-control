# Roadmap

What is being built now, what comes next, and the decisions that bind the work.
The ledgers this file replaces are in git history at the tag `archive/records-2026-09`.

## Now: the Cameras and Teleprompter pages

Built so far: the Teleprompter page and its editor, the prompter and the cameras' model in the engine, the simulated cameras, the Cameras page with Setup's camera section, and the deck's PROMPTER and CAMERAS pages. What is left, in the agreed order:

- [x] The Cameras page (#243, #244)
- [x] The two Stream Deck pages, PROMPTER and CAMERAS (#246, #247, #248)
- [x] The Prompter XL's window (#249, #250, #251)
- [ ] The camera pictures
- [ ] The Pocket 6K Pro over Bluetooth
- [ ] The BGH1s over the network (waits on the owner)
- [ ] The close-out

A schema change brings a migration test that starts from schema 7, the studio data's, and makes the whole jump in one start.

### The Cameras page (was Slice 9)

Built, in two pull requests, against the simulated cameras and from board 2 (`docs/design/boards/A-cameras-2.html`), as D10, D11 and D19 amend it.

- [x] What the page needs from the hardware link (#243): the Recent list in `cameras.snapshot`, Setup and a restore that take no address without a link, and the store's read of the cameras with the requests the page sends.
- [x] The page, with Setup's camera section, its test data and its page tests (#244).

The pictures are still test pictures in a canvas (`data-picture`), and the studio's build reads every camera `NOT SET UP` until its link is built. The page tests reach the simulated cameras through `window.__SSE_TEST_CAMERAS__`: a camera changes a value, stops answering, answers again.

Decided while it was built, and kept by the work that follows:

- Whenever CAM 1 is released, the `REC` chip is amber and reads "not read while released". It reads CAM 1's state in `checks.cameras`; the contract does not change.
- The page's Recent list is a camera-only read of the action log, new in the engine, `v1.md` and the fixture double: `cameras.snapshot` carries the five newest rows as `recent`. It shows the log's camera rows in the log's sentences, with `Screen` as their source until the deck pages exist. A log that cannot be read is `null` there and never fails the read.
- `cameras.setup.update` refuses a non-empty address with `CAMERA_NO_LINK` while the build has no network link, and Setup says why. The simulated cameras take one. Removing an address, the vMix input and `Forget` stay allowed. An archive restore then skips the addresses and says so; a database restore brings back what it holds. Each camera's `setup.noLink` carries the refusal's sentence, so Setup can lock the field and say why before anything is pressed.
- "Try CAM n again", "Try again" and "Read all cameras again" are one `cameras.snapshot`, which leaves no event and no row: the page says it tried when nothing changes. The page reads again once a second while open, only through `cameras.*`.
- `CAMERA_ALREADY_HELD` from `Connect` is worded as already held, not as a fault, and the page reads again.
- An `UNREACHABLE` CAM 1 that last reported recording reads amber, "last known". Its timecode is shown as last read, never advanced by the page.
- `NOT SET UP` comes with the model's sentence and a way to Setup's camera section. In a build with no link to the camera the sentence says that, not what to enter in Setup. `REC` is locked while CAM 1 is not paired. An unreachable camera has no `Release`.
- Other pages' test data stays unseeded, so their Cameras lamp reads amber, "not set up", as the studio build's will until the real links exist.
- What the board draws and nothing backs goes: the look-only state, false colour, the waveform, the "Proposal" marks, rows and times that nothing records. Its bank section waits for the deck pages.
- The header's worst case (Scene drift, Solo, Prompter playing and `REC` together) fits at 2560.
- The stop's arm window is 3 s, the deck's (D14); every other armed key keeps 4.5 s.
- The state display speaks of the camera that is worst off, and of the selected one among equals.
- A camera's key prints what the camera reports on one line, whole: a page test measures the longest line of each camera's lists. Of a camera that does not answer the line is amber and ends in `last read`; when it was read stands in the state display and the plate.
- The test pictures are test cards without words, one to three squares naming the camera. The aids are worked out from the picture's pixels, as they will be from a camera's.
- Also gone from the board, since nothing backs them: the cameras' names (Main, Wide, Operator), the time a camera was released, and the BGH1's warning of a settings reset (D18's check is not made).
- Setup's address field shows `no address` when Setup holds none, never an example.
- The cluster's keys stand in one place whatever the cameras' state (`docs/DESIGN.md`, section 1): the take's rows keep their height and say what they say on one line, the card's on two. A page test holds the keys' places on every board and through a take.

### The two Stream Deck pages, PROMPTER and CAMERAS (were Slices 7 and 12)

Built, in three pull requests, against the simulated cameras. The profile reaches the studio's deck when the owner imports it, at the close-out.

- [x] The split of `native/rust-engine/src/exports.rs` into `exports/`, with the profile unchanged (#246).
- [x] The hardware link's part (#247): the two pages' keys, dials and displays (`prompter/deck.rs`, `cameras/deck.rs`), the bridge's two routes, the page chain (D5), the dials' bank, the export and the contract. It had its one independent review, and a second look at what the review changed.
- [x] The pages' part (#248): the Cameras page's section on what the dials set, Setup's deck steps with four pages, the manual and the checklist.

PROMPTER is `docs/design/teleprompter.md` §9, CAMERAS is D14. In the studio's build the CAMERAS page selects and turns the bank, and refuses `REC` and the dials until the cameras' links are built; the PROMPTER page refuses `PLAY` while the Prompter XL shows no script.

Decided while they were built, and kept by the work that follows:

- The page keys make a ring of one key a page, at the second row's last place: LIGHTS > AUDIO > CAMERAS > PROMPTER > LIGHTS. AUDIO's stands in `TALK`'s old place, the second row's third, which D26 called empty: its last place holds `SOLO CLR`. The owner can overrule it before the import.
- The cue keys read `CUE <` and `CUE >`, in plain characters: nothing in development shows that Companion draws `◂` and `▸`. The strips use `¶`, `·` and `°`, which the walk checks.
- A key of either page runs under the prompter's or the cameras' lock, through the functions the screen's requests run, and the screen hears of it once the key is stamped and its row written.
- The dials' bank and the deck's armed stop are kept in the hardware link's memory, as the selection is: exposure, and no arm, after a start.
- `REC` on the deck starts a take with one press and stops it with two, and with nothing else. A press sooner than 350 ms after it armed the stop, started a take or stopped one is the same press again. An armed stop stops the take it was made for and no other: when that take is over, or may be (the screen stopped it, it ended on the camera itself, another began there, CAM 1 did not answer for a while), a press within the 3 s ends the arm and sends nothing. The cost is one swallowed press, when a take ends under an armed stop and the next is wanted at once.
- The key's display follows the deck's poll, so it can read `STOP?` for up to a second after the 3 s. For those 4.25 s a press starts no take. The stop's own window stays 3 s: after it, a press on a take that still runs arms again.
- The hardware link tells a take from the next by what CAM 1 reports when it is read, once a second. A take that ends and another that begins on the camera itself between two reads are one to it.
- A display never reads a camera by itself. One poll of the deck reads the cameras once, a key once, and the key's own read answers its displays. A page's texts are kept for 250 ms.
- The poll stays one request a display, 41 of them a second (43 since the LIGHTS page's `OFF?` and `DEL?`), the way proven on the real deck. The bridge's queue is 96 for a worst instant of 62 (64 since).
- A take started or stopped at the deck is a row in Recent actions with `Stream Deck`. The armed stop, a selection, the bank, a detent and every key of the PROMPTER page are none.
- While nothing is on the prompter the deck's size dial is refused with the rest (§9); the screen's look sets the size at any time.
- Setup draws the deck from the hardware link's page model, and the pages' test double draws the same model from `deckPages.json`, which a test of the hardware link holds equal. A cell of the strip that only shows is a `display` there. Setup's echo goes by the route a key was sent on, and its Verify step turns to the page of the key that was pressed.

### The Prompter XL's window (was Slice 5b)

The shell's second window shows the glass (`PrompterGlass`) on the screen Windows names `Prompter XL`, and on no other. `docs/design/teleprompter.md` §7 has how it looks and behaves.

Built, in three pull requests. It has not drawn on the Prompter XL yet: only a studio build does, and the Prompter XL was not plugged in. The walk tries it (`docs/CHECKLIST.md`).

- [x] The shell's `main.rs` is split (#249).
- [x] The display route, and the window held on its display (#250). Found out first, on the workstation and drawing nothing: the route works. It names the studio's three screens and shows the primary's copy as a copy. The Prompter XL was not plugged in then. Its name as Windows gives it was read on 2026-09-28 from the EDID Windows keeps (`DISPLAY\IDI1921`): exactly `Prompter XL`, first mode 1920×1080, the name the shell looks for.
- [x] The glass window, its page and the report (#251). It had its one independent review, and a second look at what the review changed.

What the work holds to:

- Studio Control's own window is held on its display when screens come and go. The display is saved by the window commands and by the watch over the screens while they stand still, no longer at every move of the window. It is known by its screen's own name, then by its place, and remembered while it is away.
- The shell finds the screen through Windows' display configuration (`QueryDisplayConfig`, `DisplayConfigGetDeviceInfo`), polled: Tauri gives no screen names, refresh rates or display-change events. The target's name gives `Prompter XL`, the source's name gives Tauri's monitor, and two targets on one source are `DUPLICATED`.
- The shell reports the screen (`prompter.screen.report`) at the start, after an engine restart and on every poll, so the next report repairs a lost one. It leaves the refresh rate out when Windows gives none: the engine refuses 0.
- The window gets a capability of its own, to listen to the engine's events and nothing else, and an entry point of its own with a read-only client that never starts, stops or restarts the engine.
- The app still ends when the main window closes: Tauri exits only when the last window closes.
- The window is built through `webview_window_from_config` in `shell_windows.rs`, which gives it no clipboard permission.

Guards:

- "The studio build" is defined in code: a build `npm run release` made (`studio_build()` in `native/protocol/rust/src/development.rs`). Anything else draws the glass into an ordinary window, and a test holds that.
- A test over plain monitor snapshots, run in CI, proves the window opens only on a screen named `Prompter XL`.
- The display calls are `unsafe`. The shell's allowances are a named list, each entry with its reason (`SHELL_UNSAFE` in `scripts/check-no-shortcuts.test.mjs`).

What the map of the shell found, for the glass window's pull request:

- `scripts/tauri-smoke.mjs` allows one window in `tauri.conf.json`. It learns the second.
- A capability cannot keep the glass window to listening: the shell's own commands are gated by none. The shell refuses the glass window in code, by its label, everything but its reads.
- `security.capabilities` is a list, and a capability that is not in it is ignored.
- The hardware link's events go to every window, the meters 30 times a second among them. They go to a window by its name.
- The shell sends no request of its own yet, and reads no event: it learns of `engine.ready` to report after a restart.

Decided while it was built, and kept by the work that follows:

- The glass has a profile of its own (`incognito` on its window's entry), and a test holds that every window but the main one has. Both ways were tried on 2026-09-28. The leak is real: once the main window had read the clipboard, a second window on its profile read it too. The other way, a handler of the shell's own that does not save the answer, does not work: the read is allowed and comes back empty. **The owner can overrule it** for a data directory of the glass's own, which does the same with a second browser process and files on disk.
- The hardware link hears that the Prompter XL is connected only while the window's page says that it draws, once a second, through one command of its own. Without it a glass that stopped drawing would read `CONNECTED`, and `PLAY` would scroll where nobody can read. A page that does not draw within 10 s, or stops for 5 s, is `NOT SHOWING`, and its window is opened again after 5 s. The design's "Try again" key is not needed.
- While the window opens, the hardware link is told nothing and keeps what it had. Once it was told that the glass draws, it is told at once when the glass does not, and a text that scrolls pauses.
- The window is put and sized to cover the Prompter XL, not made fullscreen: the fullscreen call made it the window the keyboard goes to, which the design forbids. Tried on one of the workstation's own screens with a black page and no script. The cost: a window that takes no keyboard cannot ask Windows to hide a taskbar under it (`docs/HARDWARE.md`).
- When Windows moves the window (a screen went), the window's own events hide it at once, and the next look closes it. Where the Prompter XL is still there, the window is `NOT SHOWING` and opens again after 5 s: a window moved again and again was opened again at once, without end (the review).
- The prompter's window may call two of the shell's commands, and send two requests: `prompter.glass.snapshot` and `prompter.layout.report`. It needs nothing of `prompter.snapshot`.
- Every command of the shell stands behind one gate that goes by the window's name, so a command added later is refused to the prompter's window until a test says otherwise.
- Events go to a window by its name with one emit and a filter. A listener that names no target hears every emit, whichever window it was for, so the prompter's page names its own window.
- When the hardware link is gone, the glass stands where the text was: nothing scrolls by itself, and nobody could pause it.
- A development build's prompter is an ordinary window with a frame, and the hardware link is told of a screen of 1920×1080 at 60 Hz, so that the prompter can be tried in a development run.
- The state's sentence for `NOT SHOWING` says that the window is opened again by itself, and the plate shows the reason as the shell words it. What keeps the page from drawing is said in the page's own words, never an error's.
- The hardware link is told the newest report, and one that had the glass as drawing is told at every look that it does not, until it draws again. The review found that an older report could overtake a newer one, and a text could scroll on with nothing on the glass.
- Each window hears the hardware link on a channel of its own: Tauri runs an event as script in every page that listens to its channel.
- The window is put on the Prompter XL twice: on a screen of another scale Windows sizes and places it again. Read in the window library's code, not tried: the walk tries a Prompter XL at another scale than the studio display.

### The camera pictures, NDI from vMix (was Slice 10)

- The page shows the three inputs vMix publishes over NDI on this PC, each by its vMix input from Setup (`setup.vmixInput`), at the rate vMix sends, with neither the page nor vMix dropping a frame. The studio records at 3840×2160 29.97, 1920×1080 29.97 and 1920×1080 25 (the owner, 2026-09-29); a 4K picture is scaled to 1920×1080 before it reaches the page, so the page, the 1:1 view and the loupe stay as designed.
- Without vMix or its NDI option the page says so (`NO PICTURES`, `PICTURE MISSING`), and the controls still work.
- The aids are worked out on this PC and drawn on this screen only.
- Setup / Support carries NDI's attribution: a link to ndi.video and the trademark line.
- The NDI runtime ships in the build's folder and loads at run time, so every build works without it installed.

Found out on 2026-09-28, reading only (the note `camera-pictures-note-2026-09-28.md` in the owner's plans folder), and decided on 2026-09-29 (D28):

- The frames' route is (b). A helper process of its own receives NDI; the engine starts, steers and stops it, below normal priority. The helper sends each frame, as a level-converted JPEG, straight to the shell over one loopback connection guarded by a secret the shell makes at each start. The page pulls the newest frame through a call of the shell's, behind its window gate, and draws it with WebGL2, the aids as shaders. The page's connection policy stays as it is, no secret reaches the page, and the engine never holds a picture. Route (c) is refused: a crash in NDI would close the operator's window and the prompter's glass.
- The SDK's calls live in the helper, `deny` with a named list of `unsafe` like the shell's: an NDI crash or hang costs the pictures and nothing else, and the engine stays `forbid`. The helper loads the runtime by full path from its own folder. The LUMIX SDK gets a helper of its own later.
- The sources stay on this PC: the helper runs on NDI settings of its own (`NDI_CONFIG_DIR`, 127.0.0.1 the only extra address, no multicast), and connects to a source only on 127.0.0.1 with the source's port.
- The load: three pictures received at full bandwidth, scaled in the helper; roughly under one core of 32, to be measured while vMix records.

Still to find out, on the PC: what vMix's NDI sources are called and what each sends (size, rate, full NDI or HX); whether NDI's own settings keep it off the two networks; whether vMix keeps zero dropped frames with NDI on while it records; JPEG against raw frames (the first measurement settles it).

Ask the owner first: the NDI SDK's licence (the runtime in the build folder, the notices), the two new crates (`libloading`, a JPEG encoder), a firewall rule if NDI's settings cannot keep it off the networks, and vMix's licence (expired 2026-09-24).

### The Pocket 6K Pro over Bluetooth (was Slice 11)

- The engine speaks Blackmagic's published Bluetooth protocol for CAM 1. Battery and card time are not in it, and read "not reported".
- Pairing (`cameras.setup.pair`) happens once, in Setup, with the owner present, through Windows' own pairing on the `windows` crate.
- A watch reads the camera between requests, off the request loop. A change on the camera shows within about a second, and a silent camera never holds up a request.
- A value that keeps moving by itself (an auto setting) must not keep the pages reading: every `cameras.*` request reads the cameras and says `reported`, and the pages' store answers `cameras.changed` with a read. With the simulated cameras that ends after one read.

Guards:

- No test can reach a Bluetooth call. The one function that opens the adapter calls the guard first, and a test build reads the guard's sentence as CAM 1's `UNREACHABLE` sentence.
- Nothing ever writes the Pocket's status characteristic: a write there can switch the camera off. A test holds it.
- A step from a value that is not on the model's list moves from the nearest listed option in the step's direction, and is refused when the value cannot be read. Today's code steps from the list's first option. The fix comes with a Rust test through `body_sets`.
- The `paired` flag that a database backup brings back is held to Windows' own pairing.

Find out first: whether the service carries timecode, whether it reports focus as a lens position, and whether the display LUT reaches the HDMI output that vMix gets.

Ask the owner first: a start takes a released camera back without a press. Does that disturb the iPad?

### The BGH1s over the network (was Slice 13)

It starts once the owner has read the SDK's licence (under "Waiting on the owner").

- The engine drives CAM 2 and CAM 3 through Panasonic's LUMIX SDK (C++, 64-bit Windows, in beta) over Ethernet, as D29 allows: the SDK's search finds them, and the engine connects only to a camera whose address Setup holds. Setup takes an address again.
- The SDK runs in a helper process of its own, as NDI does (D28), so a crash or a hang in it costs CAM 2 and CAM 3 and nothing else.
- The watch between requests and the rule for steps are the Pocket's, with their tests.
- The page shows only what the SDK reports back. A BGH1's `Release` lets the camera go and promises nothing of LUMIX Tether (D29). The words that still name LUMIX Tether for a BGH1 change with this part: the cameras' model in the engine and the double (`app`), the Release key and its sentences, `docs/OPERATIONS.md` and `docs/CHECKLIST.md`.

What the SDK does on the wire, read on 2026-09-29 from its document, its headers and its library's strings (nothing run). The SDK the owner downloaded is `LumixRemoteControlLibrary` v2.0.0 of 2021-04-28 ("Tether SDK Beta2.01" in the library); it came without a licence file:

- **It connects only after a search.** No call takes an address: `Get_PnPDeviceInfo` searches (10 s by default) and `Select_PnPDevice` connects to the n-th camera found. The search is SSDP, an `M-SEARCH` to `239.255.255.250` for `urn:schemas-upnp-org:device:MediaServer:1`, sent from every network adapter; a camera answers with its PTP/IP port (15740), and the SDK then speaks PTP/IP there and HTTP (`/cam.cgi`). Its own reconnect searches again. D18 went back to the owner, who took D29.
- **It cannot be pointed at 127.0.0.1**, so no fake BGH1 can stand in for a camera. The tests stop at a camera interface backed by the simulated camera, and no test or development build starts the SDK's helper: its search leaves this PC. Rule 1's wording (D15, `docs/HARDWARE.md`) follows that; the owner sees the new wording before the part starts.
- **What it reports back:** the value and the list of choices for ISO, shutter, white balance (with its Kelvin value and the A-B and G-M shifts), aperture, exposure compensation, AF mode and area, the camera mode, and the movie settings (C-movie mode, HDMI mode, quality, recording mode). Focus is driven in steps (`Rec_Ctrl_Lens`); no call reads a focus position. Recording starts and stops (`MoveRec_Ctrl_Start`, `_Stop`).
- **A LAN connection has a password,** registered at the first connection and after every network reset of the camera, and given at every connection after that. Setup will hold it.
- **After LUMIX Tether, the SDK cannot connect** until the camera's network settings are reset in its menu (Panasonic's note). A reset also clears the password.
- Its live view works for one camera at a time. The pictures come over NDI (D17) and never from it.

Ask the owner first: does taking a BGH1 back at a start disturb LUMIX Tether?

### The close-out

- The docs brought up to date: the operator's manual gains the two pages, and the "not built yet" notes leave `docs/HARDWARE.md`.
- A new studio build, with the old one kept as the way back. The studio data goes from schema 7 to 10 in one start, behind the pre-migration backup.
- A new Stream Deck profile, and the owner's Full Reset & Import in Companion.
- The studio walk: all of `docs/CHECKLIST.md`.

## Found, to check

Found while the operator's manual was rewritten from the code (2026-09-28). Each was read in the code and none has been tried on the app yet. Check each, then fix it or drop it. The ones most likely to hurt a live session come first.

- [x] **Setup unpublishes at one press.** A press on any runner step, or on `Run all probes`, unpublishes a published setup at once and locks Lighting, Audio, Cameras and Teleprompter until `Publish setup`. Fixed in #252: such a press arms first and a second within 3 s applies; `Back to …` did the same and arms too, and a press on `Publish` itself sends nothing.
- [x] **`Restore latest` and `Restore path` act at one press.** A database restore replaces all saved data and restarts the hardware link. Fixed in #252: they ask first, in Setup and on the recovery screen, and say what the restore replaces.
- [x] **A restore from the recovery screen can arm the lights.** The light outputs take the backup's own setting, so the restart can stream to a rig that was held. Fixed in #253: every restore comes back held, a database backup's at the start that applies it (a refused one too) and an archive's in its transaction.
- [x] **The deck's `Del Scene`, `Save` and `All Off` act at one press,** and the screen's `Undo` cannot bring a deleted scene back. On screen, `CUT ALL` asks first. Fixed in #254: `All Off` and `Del Scene` read `OFF?` and `DEL?` and act at a second press within 3 s, on the keys themselves, since the LIGHTS page has no strip cells; `Save` stays one press. The new profile carries it.
- [x] **Lighting never checks the bridge during a session.** `REACHABLE` and the lamp's `ready` come from the last probe, and the probe counts a refused connection as reachable. Fixed in #260: the studio build looks at the bridge every 5 s as the probe does; two silent looks make Lighting read `NOT ANSWERING`, amber, and the lamp `not answering`, and nothing is locked (the owner, 2026-09-29: the sACN stream does not need port 80). The refusal rule stays: on Windows a refusal is reported about 2 s after it, past the probe's 1.5 s, so it reads as silence, and the studio's probe passing shows the bridge takes the connection.
- [x] **The deck's probe always passes.** It counts the pages the app holds and never reaches Companion or the deck. Fixed in #261: the bridge notes when a request with the token last arrived (Companion asks once a second); the probe passes only when one came in the last 5 s, and the Surface lamp reads `no deck`, amber, while none has. It locks nothing (the owner, 2026-09-29).
- [x] **Lighting reads `REACHABLE … the rig is following it` while the outputs are held.** Only the header's lamp says `held`. Fixed in #255: the state display reads `HELD`, amber, with `Open Setup`.
- [x] **`Save · press twice` saves at the first press.** No key on the Lighting page arms. Fixed in #252. `New scene` still saves at one press: it promises no second.
- [x] **In Preview, `Save to the rig` does not change the rig.** It saves into the scene. The words were wrong, not the key: it reads `Save into the scene` since #252, and the sentence says the rig takes the edits when the scene is recalled.
- [x] **`DIM` and `MONO` light on screen for `Phones 1` and `Phones 2`** but nothing is sent to the desk. Fixed in #255: the phones' strips show neither, the Console's `Dim` and `Mono` act on Main Out whatever the mix target (as the deck's `DIM`), and a phones target reads neither, whatever older saved data holds.
- [x] **A failed or overdue automatic backup lights no lamp,** and neither does a light-output port that could not open. Fixed in #255: a `Backup` chip after the five lamps while the backup failed or is overdue, and the Lighting lamp's `no output`, red. Overdue counts from the hardware link's start at the earliest.
- [ ] **Lighting's `Undo` forgets its steps** when the page is left.
- [ ] **The deck's `LIGHTS` strip refreshes only on arriving at the page** and on a push of the `LIGHT` dial.
- [x] **Developer words still reach the screen** in some of the engine's sentences, and the key `Engine log` breaks the rule against "engine". Fixed in #255 for the key (`Open the log`) and the sentences seen in ordinary use: Setup's state sentence, the probes' details and refusals, the deck's bridge, the Console's Global OSC sentence, Lighting's refusals, the log's fallbacks and the log lines the recovery screen quotes. `operator_words.rs` holds them. Left as they were: the health and lighting summaries (the recovery screen and DEGRADED), the audio settings summary, the archive and database verify sentences, "not exposed by the native editor state" on a stale id, raw storage errors, and the shell's start errors.
- [x] **A third typeface is still on screen.** Fraunces, the display face of the design before A, prints the scenes' names, the plot's pill, the scene's figures and the recovery screen's check titles. The design names two families. The layout gate lists the pages as exceptions. Fixed in #256: Inter prints them, and the fixture's name at the top of the plate, `Loading the rig…` and the three dialog titles of the shell, which were in Fraunces too, at the weight and the size each had. The token is retired, the fonts are no longer loaded, and the gate has no exception left for it. The package `@fontsource-variable/fraunces` left `frontend/app/package.json` and the lock file on 2026-09-29, with the owner's word.
- [x] **Recent actions names the main output two ways:** `Main Out` for a key on screen or a switch at TotalMix, `main out` for the deck's `DIM`. Fixed in #255: the deck's row takes the name from the hardware link, `Dim on: Main Out`.
- [ ] **The studio's engine keeps more than one processor core busy.** Read on 2026-09-28: 509,570 s of processor time in the 4 days 18 hours since its start, 1.2 cores on average, with nobody at the desk. It is a debug build, and Companion asks it for every display once a second. Measure the first studio build the same way; if it is still high, find what takes the time.
- [ ] **Tests and lanes leave their scratch folders behind.** About 13,000 of them stood in `%TEMP%` on 2026-09-28, 675 MB, named `sse-*` and `studio-control-*`. Most are from scripts that are gone; find which tests still leave one.
- [ ] **Tests with a deadline failed in two slow runs of the gate** (2026-09-28): the shell's `exit_watcher_fails_pending_and_emits_event`, then the engine's `recall_pushes_the_snapshot_and_the_console_confirms_it` and `a_glass_that_goes_pauses_the_scroll_and_its_return_leaves_it_paused`, in a run where the engine's tests took 120 s (11 s alone). Each passed on the next run. The gate runs below normal priority, so whatever is busy beside it takes its time; what was busy was not found.
- [ ] **A capture lets a changed digit through.** The comparison allows 100 differing pixels, and `43` turned `42` in two places stayed under it (2026-09-28). The page tests that read the words are what catch such a change.
- [x] **`native/protocol/v1.md` says mixer edits are accepted while `not-verified`;** the engine refuses them. The document is wrong. Corrected in #255 for `audio.channel.update` and `audio.mixTarget.update`.
- [ ] **The deck's poll opens 43 connections a second,** one a display, which leaves about 5,000 closed sockets waiting in Windows at any time. One request for all the displays of a page would make it four. It needs a way to fill many Companion variables from one answer, tried on the real deck.
- [ ] **A slow read of a camera would hold the bridge.** A display waits for its page's texts while they are read, so with a real link that answers slowly the poll's displays can hold all four workers. Measure it when the first real link is built.
- [x] **A key the deck was refused leaves no line in the log.** The bridge logs what it refuses itself (a token, a full queue), not what a page refuses (`REC` while CAM 1 is released). Fixed in #254: one `WARN` line a refused key, with the key and the reason.
- [x] **`PLAY`, `DIM`, a mute and `Toggle` on the deck have no dwell.** A press that arrives twice switches twice. `REC` has one. Fixed in #254: the bridge drops a second press within 350 ms, counted from the press that acted; each strip's mute has its own.
- [x] **Setup's runner offers `Start with Import profile` on every step,** also when the first steps are done. Its press also moved the saved setup back to step 1. Fixed in #259: the key names the step the saved setup stands at (`Continue with Map bindings`) and goes there.
- [ ] **The shell can end by itself, with code 0, about 40 s after a start.** CI's Setup/Support lane failed so ("Tauri shell exited early … with code 0") on `main` after #251 and twice on #253, at different steps, while the same code passed on other runs. Not found by reading. The timing fits a development build's prompter window whose page does not draw under xvfb: it is closed after 10 s and opened again after 5 s, and the exit comes near the third close; Tauri ends the app when its last window closes. Whether a studio build can do it with the Prompter XL is not known: the walk watches for it. Found on 2026-09-28 (#255).
- [ ] **The AUDIO dials' acceleration reads when a detent is handled, not when it arrived.** A fast turn (two detents within 80 ms) steps five times as far. A detent that waits behind the deck's poll can be taken for part of a fast turn. The deck's other keys count from the arrival since #254. Found in its review; not a regression.
- [x] **The recovery screen's `Restore latest` can pick a backup archive.** It takes the newest backup of either kind, and while the saved data does not open only a database backup restores, so the restore is refused with a sentence. Found in #252. Fixed in #259: it takes the newest database backup, the card reads `Latest database backup`, and after a storage failure the sentence says only a database backup restores.

## Waiting on the owner

One check holds the BGH1 work and nothing else (D18, D29):

- [ ] Read the LUMIX SDK's licence: may `Lmxptpif.dll` ship in the build's folder? The SDK was downloaded on 2026-09-29, to `BGH1 SDK\` beside the repository, and came without a licence file; the download page may have shown it.
- [x] ~~On one BGH1, check that it goes back to LUMIX Tether without a settings reset.~~ No longer holds the work: a BGH1's `Release` promises nothing of LUMIX Tether (D29), since Panasonic's document says the SDK cannot connect after LUMIX Tether until the camera's network settings are reset.
- [ ] When the part is built, a Windows firewall rule that keeps the SDK's helper off the lighting network (D29). The owner makes it.

One question about the lights, with no hurry:

- [ ] Should the studio build hold the lights at every start? Today a hold is saved: held lights stay held across starts, and armed lights are armed again at the next start, so the rig follows the app at once. Setting `SSE_SAFE_START=1` for the Windows account makes every start held, at the cost of arming once per start, also after the hardware link restarts mid-session. Recommended: leave it as it is.

Dependency updates wait on the owner's word. Asked on 2026-09-28, with no hurry: may the assistant take them itself once a month, when the checks pass, and never with `npm audit fix`? Recommended: yes. Open now:

- pull requests #217 (`getrandom`), #219 (`tauri-plugin-single-instance`), #223 (`qs`), #233 (the actions group), #234 (the npm group, whose checks fail) and #235 (`jsdom`, whose checks fail);
- alerts #7 (`esbuild`, low) and #1 (`glib`, medium).

`fuzzysort`, which nothing imported, is removed, so #193 closes by itself. `glib` sits in Tauri's Linux-only part, which the Windows build never compiles, and no fix fits yet. Dependabot's alert stays open until a fix exists.

## Decide later

Four larger changes, each decided on its own:

- **Replace the fixture double** with recorded data for the layout tests and the real engine for the behaviour tests. It ends writing every engine feature twice. It needs a simulated lighting output, which shows what the rig would be sent while the lights are held, and a way for a page test to reach a real engine. Try one page first.
- **Replace the JSON backup archive** with the database backup the engine already makes. It removes the archive's code and a new format with every page. It needs the owner's word on what is lost: an archive restore adds scripts and never removes one. The engine's `shell.window.*` settings go with it: nothing reads them, but the archive's format carries them.
- **Collapse migrations 1–10 into one baseline.** It removes the upgrade chain and the code that only explains retired features. It needs the studio data at schema 10, and a decision on whether older database backups must still restore.
- **Move CI to a Windows runner.** CI would then compile and test the Windows-only code, and the Linux-only leftovers could go. It needs the four-job CI (step 3) and a measure of a Windows runner's time and cost.

Two follow-ups from the visual overhaul were never decided. Decide or drop:

- **F1** The Stream Deck marks the selected strip amber; on screen amber means engaged and a selection is neutral. Changing it means new deck drawings, new Companion colours and a profile import.
- **F2** Per-channel `ASSUMED` marks on the Console. The engine reports one confidence for the whole desk; single marks need a field for each channel and mix target.

## Done: the streamlining

Seven steps on 2026-09-28, pull requests #230 to #242. What it decided is D24 to D27, and the rulebook it left is `AGENTS.md`.

- The ledgers became eleven documents, CI's ten jobs four, and `npm run check` the one gate.
- A development build keeps off the studio by itself. Only `npm run release` makes a studio build, and keeps it in `builds\`.
- Out of the program: the Graphite and Bone themes, talkback, the installer's leftovers, the engine's developer-only fixtures, unused components and switches. One recovery screen, and a window that finds its display by its place.
- The owner got the commands for what stands on the workstation outside git.

## Decisions

Code comments cite these numbers. D1 to D23 date from 2026-09-24 to 2026-09-27.

- **D1** The app opens on the page last used. New saved data and every return key open the Console.
- **D2** Schema 8 removed Planning's saved data behind the pre-migration backup. Upgrades are one-way: going back means restoring that backup.
- **D3** Backups from before Planning left still restore, with their Planning part skipped. The `db.json` import is retired.
- **D4** Tabs: Setup / Support · Lighting · Audio · Cameras · Teleprompter.
- **D5** Deck pages: LIGHTS · AUDIO · CAMERAS · PROMPTER, chained by the page keys. The deck follows the app's page, and its page keys move the deck alone.
- **D6** No keyboard shortcuts, key hints or command palette. Tab, Enter or Space on the focused control, typing, the arrow keys on a focused slider or list, and Esc stay.
- **D7** Superseded by D26 (2026-09-28). It took out talkback's `T` key and left its button and the deck's `TALK`.
- **D8** Lighting: F2 is gone. A scene is renamed by double-clicking its name or from its right-click menu.
- **D9** Cameras: see what the three cameras see, and set them. Teleprompter: Studio Control draws the script on the Prompter XL, and the operator at the PC runs it.
- **D10** For each camera: connection, ISO, shutter, white balance and tint, iris, ND, focus, resolution, frame rate, picture profile or LUT; recording and card time for CAM 1 only. Only values a camera reports back are shown, and a value it cannot report says so.
- **D11** One press: exposure, colour, focus and record start; the prompter's scroll, speed and jumps. Press twice: record stop, resolution, frame rate, profile and LUT; replacing, updating or clearing the script on the prompter. Never offered: formatting a card, firmware, factory reset.
- **D12** Never: take a picture input from vMix or OBS, or cost them a frame; change a camera or a recording unasked (the camera wins a disagreement); contact an address that was not entered in Setup, scan the network, or touch a camera's network or Bluetooth settings; show the presenter the script anywhere but on the Prompter XL (the page's own copy is allowed); move off the studio display; jump, scroll unasked, or lose the place or a script.
- **D13** Studio Control holds the cameras whenever it runs. `Release` hands one to the iPad (Bluetooth+) or LUMIX Tether, and `Connect` takes it back.
- **D14** The deck: CAMERAS has `CAM 1`–`CAM 3`, `BANK` and `REC` (always CAM 1; `STOP?` within 3 s); PROMPTER has four dials and `PLAY`, `BACK`, `TOP`, `◂ CUE` and `CUE ▸`. Formats, looks and changing the script on the prompter stay on screen.
- **D15** The safe path, six rules, in full as the six numbered rules for the cameras and the prompter under "Safety rules" in `docs/HARDWARE.md` (1 to 6 there; the line said "rules 5 to 10" until 2026-09-28). Code cites them by these numbers: (1) the BGH1s' addresses, (2) Bluetooth, (3) pictures, (4) the Prompter XL, (5) checks on the real cameras, (6) learning the BGH1's protocol.
- **D16** "Working" means the Cameras and Teleprompter checks in `docs/CHECKLIST.md`.
- **D17** The pictures come over NDI from vMix on this PC, and from nowhere else. No OBS path.
- **D18** The BGH1s through Panasonic's LUMIX SDK over Ethernet; the Pocket 6K Pro over Blackmagic's Bluetooth protocol. If the licence rules the SDK out, the decision comes back to the owner. Amended by D29.
- **D19** Cameras from board 2, Teleprompter from board 1, in Studio only (D25). `REC` is a red lamp and the word, never a red fill. `Release` and `Update the prompter` are press twice. No false colour, no waveform. At a script's end `PLAY` stays locked until a jump moves the place back. Header lamps: Lighting · Audio · Cameras · Prompter · Surface. A camera that does not answer reads `UNREACHABLE`.
- **D20** The prompter is `docs/design/teleprompter.md`: scripts from Word, pasted text and `.txt`; 88 px standard size; speed in words a minute; only `TOP` pauses; `NOT CONNECTED` is red.
- **D21** The Teleprompter before the Cameras. What is left follows the order under "Next".
- **D22** Windows at 2560×1440, fullscreen, and nothing else. Nothing is designed, fixed or tested for another size or system.
- **D23** Superseded (2026-09-28): everything is built on the workstation. It moved the pages' work to cloud sessions.
- **D24** (2026-09-28) The lean workflow. `main` is the development line. The studio runs the latest verified build: a release build the owner has walked through `docs/CHECKLIST.md` on the real hardware. Merges to `main` need no go-ahead. No ledgers, run ids or archive tags.
- **D25** (2026-09-28) Studio, the dark theme, is the only theme. Graphite and Bone are removed.
- **D26** (2026-09-28) Talkback is removed from the app entirely. The Stream Deck's AUDIO page keeps its other keys where they were; the TALK key's place is empty.
- **D27** (2026-09-28) Studio builds. Only `npm run release` makes one, from a commit on `main`, marked while it compiles. Every other build is a development build: it refuses the studio's folders, takes the safe value of every switch that is not set, and is an app of its own. Builds are kept in `builds\` beside the repository and never deleted by a script. `npm run release:verified` names the one the studio starts and tags its commit.
- **D28** (2026-09-29) The camera pictures come by route (b): a helper process of its own receives NDI from vMix on this PC only, started, steered and stopped by the engine, and hands each frame to the shell over a secret-guarded loopback connection; the page pulls the newest frame through the shell. The shell never receives NDI (route c).
- **D29** (2026-09-29) The LUMIX SDK takes no address: it connects to a camera its own search found (SSDP, from every network adapter), and searches again to reconnect. The owner allows the search, with limits. The SDK runs in a helper process of its own; the engine connects only to a found camera whose address Setup holds and refuses every other; a Windows firewall rule, made by the owner, keeps the helper off the lighting network; no test or development build starts it. A BGH1's `Release` promises nothing of LUMIX Tether, since the SDK cannot connect after LUMIX Tether until the camera's network settings are reset. D12's "scan the network" and D13's hand-off to LUMIX Tether are amended for the BGH1s only.
