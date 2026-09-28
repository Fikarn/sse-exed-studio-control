# Roadmap

What is being built now, what comes next, and the decisions that bind the work.
The ledgers this file replaces are in git history at the tag `archive/records-2026-09`.

## Now: streamlining

One pull request each, in this order. Then the Cameras page.

- [x] Step 1: the catch-up pull request merged (#230).
- [x] Step 2: rulebook and docs. A short `AGENTS.md`, this roadmap, `docs/CHECKLIST.md`; the ledgers deleted.
- [x] Step 3: CI from ten jobs to four; the ceremony gates out; one local command, `npm run check`.
- [x] Step 4: builds, in two pull requests.
  - [x] Development runs. `npm run app` starts the app on its own saved data with simulated devices; a development build refuses the studio's data and is an app of its own; the shell starts the engine beside it and no other; a release build keeps the overflow checks.
  - [x] Studio builds. `npm run release` makes one from `main`, keeps it in `builds\` beside the repository and tries it on scratch data; only that command makes a build the studio's kind; `npm run release:verified` names the build the studio starts. The installer, update, signing, evidence and release scripts are removed.
- [x] Step 5: screenshots and the layout gate. Header and footer captured once; one set of limits in place of each page's ratchets. Done with the themes' removal, which was two thirds of the gate's boards.
- [ ] Step 6: product code.
  - [x] Graphite and Bone out (D25).
  - [x] Talkback out (D26).
  - [x] Dead code out: the engine's `dev-fixtures` feature and its method, the update folder, eight unused components of the design system and three of the app, the unused `shared-graphics` package, five environment switches nothing set, and the warning about a `db.json`.
  - [x] Three changes of behaviour: one recovery screen and one startup screen; the shell finds its saved display by its place before its name, since Windows' display numbers can swap; the test double of the engine is a chunk of its own, which the app's window never loads. And a fourth: a development build's Companion export asks Companion nothing, so the gate's bridge lane leaves the studio's Companion alone.
- [ ] Step 7: local cleanup.

## Next: the Cameras and Teleprompter pages

Built so far: the Teleprompter page and its editor, the prompter and the cameras' model in the engine, and the simulated cameras. What is left, in the agreed order:

- [ ] The Cameras page
- [ ] The two Stream Deck pages, PROMPTER and CAMERAS
- [ ] The Prompter XL's window
- [ ] The camera pictures
- [ ] The Pocket 6K Pro over Bluetooth
- [ ] The BGH1s over the network (waits on the owner)
- [ ] The close-out

A schema change brings a migration test that starts from schema 7, the studio data's, and makes the whole jump in one start.

### The Cameras page (was Slice 9)

One pull request. Built against the simulated cameras from board 2 (`docs/design/boards/A-cameras-2.html`), as D10, D11 and D19 amend it.

Build:

- the Cameras tab, the header's Cameras lamp, and a `REC` chip while CAM 1 records, which opens the page;
- the selected camera big (the whole frame at 1680 × 945, or 1:1) and the other two small, with one selection for picture, plate and dials;
- the aids as the page's own switches, off at every start: framing guides, zebras, focus peaking, the 2:1 / 4:1 loupe beside the small pictures, the 1:1 view;
- still test pictures in a canvas (`data-picture`) until the camera pictures are built;
- a camera section in Setup / Support, not a sixth setup step: the BGH1s' addresses, the Pocket's pairing (`CAMERA_NO_LINK` until its link is built), each camera's vMix input;
- the store's read of `cameras.snapshot`, a mapping for `cameras.changed`, and `cameras` seeds in `fixtures.json`;
- a test hook on the fixture double (the engine's test double in TypeScript): a camera changes a value, stops answering, answers again;
- the page's cases in `no-shortcuts.spec.ts`.

Decided:

- Whenever CAM 1 is released, the `REC` chip is amber and reads "not read while released". It reads CAM 1's state in `checks.cameras`; the contract does not change.
- The page's Recent list is a camera-only read of the action log, new in the engine, `v1.md` and the fixture double. It shows the log's camera rows in the log's sentences, with `Screen` as their source until the deck pages exist.
- `cameras.setup.update` refuses a non-empty address with `CAMERA_NO_LINK` while the build has no network link, and Setup says why. The simulated cameras take one. Removing an address, the vMix input and `Forget` stay allowed. An archive restore then skips the addresses and says so; a database restore brings back what it holds.
- "Try CAM n again", "Try again" and "Read all cameras again" are one `cameras.snapshot`, which leaves no event and no row: the page says it tried when nothing changes. The page reads again once a second while open, only through `cameras.*`.
- `CAMERA_ALREADY_HELD` from `Connect` is worded as already held, not as a fault, and the page reads again.
- An `UNREACHABLE` CAM 1 that last reported recording reads amber, "last known". Its timecode is shown as last read, never advanced by the page.
- `NOT SET UP` comes with the model's sentence and a way to Setup's camera section. `REC` is locked while CAM 1 is not paired. An unreachable camera has no `Release`.
- Other pages' test data stays unseeded, so their Cameras lamp reads amber, "not set up", as the studio build's will until the real links exist.
- What the board draws and nothing backs goes: the look-only state, false colour, the waveform, the "Proposal" marks, rows and times that nothing records. Its bank section waits for the deck pages.
- The header's worst case (Scene drift, Solo, Prompter playing and `REC` together) fits at 2560.

Ask the owner first: nothing is open.

### The two Stream Deck pages, PROMPTER and CAMERAS (were Slices 7 and 12)

Built together: they share the split of `native/rust-engine/src/exports.rs` (done first), the page chain (D5) and Setup's deck steps, which draw every page's keys and dials. They bring the bridge's actions and feedback and the Companion export. The page's word on the deck is the engine's: `teleprompter`, `cameras`.

PROMPTER is `docs/design/teleprompter.md` §9: dials for speed, position, text size and paragraph; `PLAY`, `BACK`, `TOP`, `◂ CUE` and `CUE ▸`; the strip. `PLAY` and the speed dial's push go the deck's locked grey while nothing is drawn on the glass (`checks.prompter.screen.draws` is false), and at a script's end until a jump moves the place back. Every control is grey while nothing is on the prompter.

CAMERAS:

- `CAM 1`–`CAM 3` choose the camera the dials drive. Amber is selected, and it is the page's selection.
- `BANK` switches the dials between exposure (ISO · shutter · iris · ND), colour (white balance · tint) and focus (a push is one-shot autofocus where the lens allows).
- `REC` always acts on CAM 1. One press starts; a second within 3 s, while the key reads `STOP?`, stops. While CAM 1 records the key shows `REC` with a red lamp, on a dark key.
- The strip shows the selected camera's values. There is no `PLAY` key.
- The dials' bank gets a home in the engine, which has none for the cameras yet, for the page and the deck to read. The Cameras page gains its "what the dials set" section: the bank keys, the dials' hints, the footer's dials.
- Recent actions gains the deck's camera rows, with `Stream Deck` as their source.

Ask the owner first: nothing is open.

### The Prompter XL's window (was Slice 5b)

The shell's second window shows the glass (`PrompterGlass`) on the screen Windows names `Prompter XL`, and on no other. `docs/design/teleprompter.md` §7 has how it looks and behaves.

- Studio Control's own window is held on its display when screens come and go.
- The shell finds the screen through Windows' display configuration (`QueryDisplayConfig`, `DisplayConfigGetDeviceInfo`), polled: Tauri gives no screen names, refresh rates or display-change events. The target's name gives `Prompter XL`, the source's name gives Tauri's monitor, and two targets on one source are `DUPLICATED`.
- The shell reports the screen (`prompter.screen.report`) at the start, after an engine restart and on every poll, so the next report repairs a lost one. It leaves the refresh rate out when Windows gives none: the engine refuses 0.
- The window gets a capability of its own, to listen to the engine's events and nothing else, and an entry point of its own with a read-only client that never starts, stops or restarts the engine.
- The app still ends when the main window closes: Tauri exits only when the last window closes.
- The window is built through `webview_window_from_config` in `shell_windows.rs`, which gives it no clipboard permission.

Guards:

- "The studio build" is defined in code: a build `npm run release` made (`studio_build()` in `native/protocol/rust/src/development.rs`). Anything else draws the glass into an ordinary window, and a test holds that.
- A test over plain monitor snapshots, run in CI, proves the window opens only on a screen named `Prompter XL`.
- The display calls are `unsafe`. The shell's one allowance (`set_browser_accelerator_keys_off`) becomes a named list, each entry with its reason.
- `native/tauri-shell/src/main.rs` is split first.

Find out first, on the workstation and drawing nothing: that the display route works.

Ask the owner first: WebView2 saves the main window's clipboard answer in the profile that every window shares, and the glass must be kept out of it. Try both ways (`GetNonDefaultPermissionSettings` shows what the profile holds), then ask which:

- a profile of its own for the glass (`incognito`, or a data directory of its own); or
- the shell's own `PermissionRequested` handler for the main window, which allows the read with `SetSavesInProfile(false)` and clears any saved answer. It adds a second `unsafe` call.

### The camera pictures, NDI from vMix (was Slice 10)

- The page shows the three inputs vMix publishes over NDI on this PC, each by its vMix input from Setup (`setup.vmixInput`), at 25 frames a second, with neither the page nor vMix dropping a frame.
- Without vMix or its NDI option the page says so (`NO PICTURES`, `PICTURE MISSING`), and the controls still work.
- The aids are worked out on this PC and drawn on this screen only.
- Setup / Support carries NDI's attribution: a link to ndi.video and the trademark line.
- The NDI runtime ships in the build's folder and loads at run time, so every build works without it installed.

Find out first, and write down what it changes between engine, shell and pages:

- The frames' route. Today the engine reaches the page only through its line-by-line pipe, and the page may connect only to the shell (`connect-src ipc:` in `tauri.conf.json`). (a) The engine serves JPEG frames on 127.0.0.1 behind the bridge's token, with the policy widened for that address. (b) The engine hands the frames to the shell over a second channel, and the shell passes them on as raw data. (c) The shell receives NDI itself, which puts device I/O outside the engine.
- Where the SDK's calls live. The NDI and LUMIX SDKs need `unsafe` code, which the engine forbids: a crate of their own that names each allowance, or a helper process. A new crate's licence is read first (`libloading` is ISC).
- That finding the sources stays on this PC. NDI searches every network adapter unless told otherwise.
- The processor's load of three pictures decoded while vMix records.

Ask the owner first: route (c), if it is wanted. It is an architecture decision.

### The Pocket 6K Pro over Bluetooth (was Slice 11)

- The engine speaks Blackmagic's published Bluetooth protocol for CAM 1. Battery and card time are not in it, and read "not reported".
- Pairing (`cameras.setup.pair`) happens once, in Setup, with the owner present, through Windows' own pairing on the `windows` crate.
- A watch reads the camera between requests, off the request loop. A change on the camera shows within about a second, and a silent camera never holds up a request.

Guards:

- No test can reach a Bluetooth call. The one function that opens the adapter calls the guard first, and a test build reads the guard's sentence as CAM 1's `UNREACHABLE` sentence.
- Nothing ever writes the Pocket's status characteristic: a write there can switch the camera off. A test holds it.
- A step from a value that is not on the model's list moves from the nearest listed option in the step's direction, and is refused when the value cannot be read. Today's code steps from the list's first option. The fix comes with a Rust test through `body_sets`.
- The `paired` flag that a database backup brings back is held to Windows' own pairing.

Find out first: whether the service carries timecode, whether it reports focus as a lens position, and whether the display LUT reaches the HDMI output that vMix gets.

Ask the owner first: a start takes a released camera back without a press. Does that disturb the iPad?

### The BGH1s over the network (was Slice 13)

It starts once the owner has made the two checks under "Waiting on the owner".

- The engine drives CAM 2 and CAM 3 through Panasonic's LUMIX SDK (C++, 64-bit Windows, in beta) over Ethernet, at the addresses Setup holds and no other. Setup takes an address again.
- The address guard runs before every connection: a test build refuses a camera address that is not on this PC.
- The watch between requests and the rule for steps are the Pocket's, with their tests.
- The page shows only what the SDK reports back, and `Release` promises only what the owner's check showed.

Find out first what the SDK does on the wire:

- Does it connect to a given address without searching? If it can only search, D18 goes back to the owner.
- Does it connect to 127.0.0.1 at a given port, as a fake BGH1 needs? If not, the tests stop at a camera interface backed by the simulated camera, and the wording of rule 1 (D15) goes back to the owner.
- What does it report back, not only accept: the exposure and white-balance modes, the resolutions and frame rates it lists, a focus position?

Ask the owner first: does taking a BGH1 back at a start disturb LUMIX Tether?

### The close-out

- The docs brought up to date: the operator's manual gains the two pages, and the "not built yet" notes leave `docs/HARDWARE.md`.
- A new studio build, with the old one kept as the way back. The studio data goes from schema 7 to 10 in one start, behind the pre-migration backup.
- A new Stream Deck profile, and the owner's Full Reset & Import in Companion.
- The studio walk: all of `docs/CHECKLIST.md`.

## Found, to check

Found while the operator's manual was rewritten from the code (2026-09-28). Each was read in the code and none has been tried on the app yet. Check each, then fix it or drop it. The ones most likely to hurt a live session come first.

- [ ] **Setup unpublishes at one press.** A press on any runner step, or on `Run all probes`, unpublishes a published setup at once and locks Lighting, Audio and Teleprompter until `Publish setup`.
- [ ] **`Restore latest` and `Restore path` act at one press.** A database restore replaces all saved data and restarts the hardware link.
- [ ] **A restore from the recovery screen can arm the lights.** The light outputs take the backup's own setting, so the restart can stream to a rig that was held.
- [ ] **The deck's `Del Scene`, `Save` and `All Off` act at one press,** and the screen's `Undo` cannot bring a deleted scene back. On screen, `CUT ALL` asks first.
- [ ] **Lighting never checks the bridge during a session.** `REACHABLE` and the lamp's `ready` come from the last probe, and the probe counts a refused connection as reachable.
- [ ] **The deck's probe always passes.** It counts the pages the app holds and never reaches Companion or the deck.
- [ ] **Lighting reads `REACHABLE … the rig is following it` while the outputs are held.** Only the header's lamp says `held`.
- [ ] **`Save · press twice` saves at the first press.** No key on the Lighting page arms.
- [ ] **In Preview, `Save to the rig` does not change the rig.** It saves into the scene.
- [ ] **`DIM` and `MONO` light on screen for `Phones 1` and `Phones 2`** but nothing is sent to the desk.
- [ ] **A failed or overdue automatic backup lights no lamp,** and neither does a light-output port that could not open.
- [ ] **Lighting's `Undo` forgets its steps** when the page is left.
- [ ] **The deck's `LIGHTS` strip refreshes only on arriving at the page** and on a push of the `LIGHT` dial.
- [ ] **Developer words still reach the screen** in some of the engine's sentences, and the key `Engine log` breaks the rule against "engine".
- [ ] **A third typeface is still on screen.** Fraunces, the display face of the design before A, prints the scenes' names, the plot's pill, the scene's figures and the recovery screen's check titles. The design names two families. The layout gate lists the pages as exceptions.
- [ ] **Recent actions names the main output two ways:** `Main Out` for a key on screen or a switch at TotalMix, `main out` for the deck's `DIM`.
- [ ] **The studio's engine keeps more than one processor core busy.** Read on 2026-09-28: 509,570 s of processor time in the 4 days 18 hours since its start, 1.2 cores on average, with nobody at the desk. It is a debug build, and Companion asks it for every display once a second. Measure the first studio build the same way; if it is still high, find what takes the time.
- [ ] **Tests with a deadline failed in two slow runs of the gate** (2026-09-28): the shell's `exit_watcher_fails_pending_and_emits_event`, then the engine's `recall_pushes_the_snapshot_and_the_console_confirms_it` and `a_glass_that_goes_pauses_the_scroll_and_its_return_leaves_it_paused`, in a run where the engine's tests took 120 s (11 s alone). Each passed on the next run. The gate runs below normal priority, so whatever is busy beside it takes its time; what was busy was not found.
- [ ] **A capture lets a changed digit through.** The comparison allows 100 differing pixels, and `43` turned `42` in two places stayed under it (2026-09-28). The page tests that read the words are what catch such a change.
- [ ] **`native/protocol/v1.md` says mixer edits are accepted while `not-verified`;** the engine refuses them. The document is wrong.

## Waiting on the owner

Two checks hold the BGH1 work and nothing else (D18):

- [ ] Download the LUMIX SDK and read its licence. The download asks for a camera's 11-digit code, from its battery holder.
- [ ] On one BGH1, with nothing recording, check that it goes back to LUMIX Tether without a settings reset. Put back every setting touched.

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
- **D15** The safe path, six rules, in full as rules 5 to 10 of `docs/HARDWARE.md`. Code cites them by these numbers: (1) the BGH1s' addresses, (2) Bluetooth, (3) pictures, (4) the Prompter XL, (5) checks on the real cameras, (6) learning the BGH1's protocol.
- **D16** "Working" means the Cameras and Teleprompter checks in `docs/CHECKLIST.md`.
- **D17** The pictures come over NDI from vMix on this PC, and from nowhere else. No OBS path.
- **D18** The BGH1s through Panasonic's LUMIX SDK over Ethernet; the Pocket 6K Pro over Blackmagic's Bluetooth protocol. If the licence rules the SDK out, the decision comes back to the owner.
- **D19** Cameras from board 2, Teleprompter from board 1, in Studio only (D25). `REC` is a red lamp and the word, never a red fill. `Release` and `Update the prompter` are press twice. No false colour, no waveform. At a script's end `PLAY` stays locked until a jump moves the place back. Header lamps: Lighting · Audio · Cameras · Prompter · Surface. A camera that does not answer reads `UNREACHABLE`.
- **D20** The prompter is `docs/design/teleprompter.md`: scripts from Word, pasted text and `.txt`; 88 px standard size; speed in words a minute; only `TOP` pauses; `NOT CONNECTED` is red.
- **D21** The Teleprompter before the Cameras. What is left follows the order under "Next".
- **D22** Windows at 2560×1440, fullscreen, and nothing else. Nothing is designed, fixed or tested for another size or system.
- **D23** Superseded (2026-09-28): everything is built on the workstation. It moved the pages' work to cloud sessions.
- **D24** (2026-09-28) The lean workflow. `main` is the development line. The studio runs the latest verified build: a release build the owner has walked through `docs/CHECKLIST.md` on the real hardware. Merges to `main` need no go-ahead. No ledgers, run ids or archive tags.
- **D25** (2026-09-28) Studio, the dark theme, is the only theme. Graphite and Bone are removed.
- **D26** (2026-09-28) Talkback is removed from the app entirely. The Stream Deck's AUDIO page keeps its other keys where they were; the TALK key's place is empty.
- **D27** (2026-09-28) Studio builds. Only `npm run release` makes one, from a commit on `main`, marked while it compiles. Every other build is a development build: it refuses the studio's folders, takes the safe value of every switch that is not set, and is an app of its own. Builds are kept in `builds\` beside the repository and never deleted by a script. `npm run release:verified` names the one the studio starts and tags its commit.
