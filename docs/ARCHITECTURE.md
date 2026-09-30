# Architecture

Studio Control is a local app for one trusted workstation. It has no cloud dependency, no accounts and no public network exposure. Its jobs are lighting, the audio console, the Stream Deck, the teleprompter and the cameras.

## The parts

| Part                      | Where                                 | Owns                                                                                          |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Engine (Rust)             | `native/rust-engine`                  | State, saved data, migrations, backups, every device, safety rules, diagnostics               |
| Shell (Tauri 2)           | `native/tauri-shell`                  | The window, starting and watching the engine, the few things only the operating system can do |
| Pages (React, TypeScript) | `frontend/app`, `frontend/packages/*` | What the operator sees and presses                                                            |
| Contract                  | `native/protocol`                     | Every request and event between the engine and the pages                                      |
| Pictures helper (Rust)    | `native/pictures-link`                | Receiving and drawing the cameras' pictures (D28, D30)                                        |

The engine is a separate process. The shell starts it, passes the pages' requests to it over its standard input, and passes its answers and events back. The engine starts the pictures helper in turn, tells it each camera's vMix input over its standard input, and hears what it receives. The helper draws the pictures itself, in a layer the shell puts over the Cameras page (D30).

## The rule

**When adding a feature, extend the engine and its contract first, then the pages.** If a change would move product state, saved data or device policy into React, it is going the wrong way. The pages show what the engine reports and send what the operator presses. They never show a state the engine has not reported.

The contract is changed at its source, `native/protocol/v1.contract.json` and `native/protocol/v1.md`, then regenerated with `npm run protocol:generate`. The generated files (`native/protocol/generated/`, `frontend/packages/engine-client/src/generated/`) are never edited by hand.

## How a feature is shaped

1. **Model.** Saved values are explicit and serialisable. Saved configuration is kept apart from passing connection state.
2. **Contract.** One snapshot shape to read, one request for every way to write, one event when the state changes.
3. **Pages.** They read snapshots through the store (`frontend/packages/engine-client/src/store/`), draw them, and send requests. No business rules.
4. **Status.** Readiness, failure and recovery are part of what the engine reports, so the operator sees a disconnected device.
5. **Tests.** Behaviour is tested at the engine first. Page tests cover what the operator does on screen.

## What protects the workstation

These are part of the design. Do not remove one because it looks like weight.

- **The Stream Deck bridge checks every request.** The engine's HTTP bridge listens on `127.0.0.1:38201`. It refuses a request without the token (`control-surface.token` in the app-data folder), a request from a browser page (any `Origin` header), and a request whose `Host` is not its own address. Any program or web page on the PC can reach that port, and this is what stops it driving the lights and the console.
- **The bridge takes only what it can afford.** Headers over 8 KiB, bodies over 16 KiB and requests slower than one second are refused. Four workers serve a queue of ninety-six, sized for the deck's busiest second: a key press that is turned away is lost, since Companion never sends one again.
- **The console's OSC ports read only TotalMix.** They bind `127.0.0.1` when TotalMix runs on this PC, and datagrams from any other address are dropped.
- **Lights can be held.** While held, nothing is sent to the rig, and only the switch on screen arms them. A hold is saved across starts, `SSE_SAFE_START=1` holds them at a start, and every restore comes back held.
- **One engine for each data folder, one studio app at a time.** The engine locks `engine.lock` in its data folder, and the shell lets only one copy of itself run. Two engines on the rig would both stream to the lights, so a development app, which can run beside the studio's, has the lights' wire cut.
- **Saved data is checked and backed up.** The database is integrity-checked at every start. A verified backup is written before a schema upgrade, daily, and at every clean close. Every commit waits for the disk. A build refuses data from a newer schema rather than damage it.
- **The shell opens and writes only inside its own folders:** the app-data, logs, backups and exports folders. The packaged pages run under a Content Security Policy with no inline or remote scripts.
- **The parsers of outside bytes have fuzz tests:** the bridge's HTTP reader, the OSC reader, the Word import and the shell's frame reader.
- **No picture passes the shell or the page.** The pictures helper draws the pictures itself, into a composition surface the shell puts topmost over the Cameras page (D30). The shell listens for the helper on 127.0.0.1 at a port the system picks, with a secret made at each start of the engine: the engine clears it from its environment and hands it to the helper on its stdin. A connection that does not say it within a second is closed, one connection is served at a time, and the secret is in no log and no answer. On that connection the helper says its process and is handed one surface, made for it, and the scenes the page reports; the shell opens the helper's process for nothing but handing it that one handle. The page's connection policy is unchanged, and a test pins it.
- **The pictures cost the pictures and nothing else.** Whatever receives them runs in the pictures helper, a process of its own (D28): a crash or a hang there never stops the lights, the console, the deck or the prompter. The engine starts it below normal priority, with all three of its pipes, from beside its own program and from nowhere else; a helper silent for 5 s is ended, one that ends is started again after 1, 2, 4 … 30 s, and it ends by itself when the engine goes. A thread of its that stops for 4 s (a draw, NDI's search, a receiver) makes it go silent, so a hang is ended the same way. Only a development build starts it, on the simulated source, or on vMix's Outputs 2 to 4 over NDI under `npm run app -- --vmix-pictures` (D33), which the helper checks again in its own environment before it loads NDI's library.
- **Tests cannot reach a device.** Test builds drop every datagram aimed at TotalMix and refuse any camera address that is not on this PC. The simulated console and the simulated cameras stand in.
- **A development build keeps off the studio.** A studio build is one `npm run release` made, marked while it compiled; every other build is a development build. It refuses `%APPDATA%\ExEd Studio Control Native`, and any folder inside it, for its saved data and its logs, before it creates or opens anything; the engine and the shell ask the same code (`native/protocol/rust/src/development.rs`). Where a switch is not set it takes the safe value: the lights held and their wire cut, the console and the cameras simulated, a bridge port of its own. It is also an app of its own (`.dev` at the end of its identifier), so the studio's saved display and browser profile are not its to write.

The app is unsigned, by decision: it runs on one workstation its developer controls.

## The shell

- **The operator's window, always fullscreen.** It opens on the display it was last on, else on the 2560×1440 display, else where it is. **Studio fullscreen** and **Reset the window layout** in Setup / Support put it back.
- **The prompter's window, on the Prompter XL.** The shell's second window shows the glass on the screen Windows names `Prompter XL`, and on no other (`shell_prompter_window.rs`). The watch over the screens opens it once the screens stand still and closes it at the look that does not find the Prompter XL. It is built hidden, put, checked and then shown; it takes no keyboard; its own events hide it when Windows moves it, and it reads `NOT SHOWING` until it is opened again. Any build but the studio's opens an ordinary window in its place. The app ends with the operator's window.
- **The shell tells the hardware link of the Prompter XL** (`prompter.screen.report`), at every look and at once when the hardware link has started. It says that the screen is there only while the window's page says that it draws, once a second.
- **The shell watches the screens.** Once a second it reads Windows' display configuration, which names each screen and shows a duplicated one as it is; Tauri does neither, and says nothing when a screen comes or goes. When the screens have changed and stand still again, a window that Windows moved is put back on its display. The display is known by its screen's own name (`HP E273q`), then by its place on the desktop. While it is away (switched off, asleep) the window stays where Windows put it, and goes back when the display returns. `shell.log` names the screens at the start and after every change, and says what was done about the window.
- **The engine sits beside the shell.** The shell starts `studio-control-engine.exe` from its own folder and from nowhere else. A build is a folder that holds both.
- **The shell starts only an engine of its own build.** Every engine carries a mark in its file that says what build it is (`development::BUILD_MARK`). The shell reads that mark before each start and never starts the program to ask. It starts the engine only when both are development builds, or both are the studio build of one commit. Anything else is refused, with a sentence on the recovery screen and the detail in `shell.log`: the other kind, another commit, no mark (an engine from before the mark), or marks that disagree. A development shell built alone into `native/target/release` would otherwise start the studio engine that `npm run release` leaves there.
- **The picture layer** (`shell_pictures.rs`, `shell_picture_layer.rs`). At each start of the engine the shell opens the pictures' listener and puts its address and secret into the engine's environment. On Windows, in a development build for now, it keeps one DirectComposition visual topmost on the main window, above WebView2's own windows; a visual takes no input, so a press goes to the page under it. When the helper connects and says hello, the layer makes a composition surface, duplicates its handle into the helper's process and says so on the connection; the helper presents into it, clear wherever the page shows no picture. The page reports where its pictures stand (`pictures_place`, the main window only): the shell turns the report into physical pixels, moves the visual to the bay's box and hands the helper the scene. It does nothing per frame. The layer hides when the page shows no picture, when the page has said nothing for 2.5 s, and while no helper is connected. Every DirectComposition object lives on the layer's own thread; its counts go to `shell.log` once a minute while anything happened.
- **Commands never block the window.** Every command that can wait runs on the blocking pool.
- **The shell watches the engine.** It polls the process every 250 ms. When the engine is gone, every waiting request is answered `ENGINE_EXITED` and the pages are told, so they can offer a restart.
- **A second launch brings the first window forward** and exits.
- **Only the main window may read the clipboard.** The Teleprompter page reads pasted text itself, so the main window is built in code with that permission (`shell_windows.rs`). WebView2 saves that answer in the window's profile, where any window on the same profile could use it. So every other window has a profile of its own (`incognito` in `tauri.conf.json`), which a test holds.
- **A window calls what its name allows.** Tauri's capabilities cover Tauri's own commands, not the shell's, so every command of the shell stands behind one gate (`shell_commands::gated`). The prompter's window may read the glass, report its layout and say that it draws; everything else refuses it, a command added later included.
- **An event goes to the windows it is for** (`shell_windows::windows_for`), each on a channel of its own (`event_channel`). The prompter's window hears what the prompter did and the hardware link's start and end, and nothing else.
- **The browser's own keys are off** (reload, find, print), so no key moves the screen.

## Where things live

Engine (`native/rust-engine/src/`):

- `lighting/`, `lighting_sacn_output.rs`: scenes, fixtures, the one lighting lock, held outputs, the sACN output.
- `audio/`, `rme_totalmix_osc.rs`, `rme_console_link.rs`: the console's state, metering, and the link that confirms every send.
- `prompter/`: scripts, the prompter's clock, the Prompter XL's state, imports.
- `cameras/`: the three cameras, the simulated cameras, the link guard, and what each picture does (`pictures.rs`).
- `pictures_helper.rs`: the pictures helper's supervision. Its lines are the protocol crate's (`native/protocol/rust/src/pictures.rs`), and the helper is `native/pictures-link`.
- `control_surface.rs`, `control_surface_http.rs`, `control_surface_pages.rs`: the Stream Deck bridge. What a key of the PROMPTER or the CAMERAS page does, and what their displays say, is in `prompter/deck.rs` and `cameras/deck.rs`, under the prompter's and the cameras' own locks.
- `exports/`: the Companion profile and the page model Setup draws. The deck's pages come from one list, `DECK_PAGES` in `pages.rs`; each page has a file of its own. The pages' test double draws the same page model, from `deckPages.json`, which a test here holds equal to it.
- `commissioning.rs`: Setup's steps and probes.
- `storage.rs`, `storage_backups.rs`, `support.rs`: the database, migrations, backups, restore, diagnostics.
- `health.rs`, `action_log.rs`, `engine_events.rs`: the health the header shows, Recent actions, events.

Shell (`native/tauri-shell/src/`): `main.rs` (the app and its window), `engine.rs` (the engine process and its watcher), `shell_commands.rs` (what the pages ask of the engine), `shell_window_layout.rs` (the display the window is on), `shell_displays.rs` and `shell_display_watch.rs` (the screens, and the watch over them), `shell_windows.rs` (building windows), `shell_paths.rs` (folders and the diagnostics report), `shell_browser_keys.rs` (WebView2's own keys, off), `shell_pictures.rs` (the pictures' link to the helper), `shell_picture_layer.rs` (the layer the helper draws into, Windows only), `shell_smoke.rs` and `shell_test_bridge.rs` (the lanes' ways in).

Pictures helper (`native/pictures-link/src/`): `main.rs` (the engine's lines, and the state it says once a second), `layer.rs` (the link to the shell and the draw loop), `renderer.rs` (Direct3D 11, Windows only: each camera's frame to a 1920 × 1080 picture, each place drawn from it, one present), `picture.rs` (what a frame may be), `card.rs` (the test card); for vMix's outputs `receive.rs` (NDI's search and a receiver thread for each camera, the newest frame handed to the draw loop), `ndi_library.rs` (NDI's library by its full path, Windows only), `ndi_sdk.rs` (its structures, and which frame is taken), `vmix.rs` (which source, when a camera receives, the minute's line) and `watch.rs` (the threads' beats).

Pages (`frontend/app/src/app/`): `OperatorShell.tsx` assembles the header, the tabs and the pages. In the app's window the Cameras page draws no picture: it says where each one stands (`cameras/pictures/picturePlaces.ts`), and the pictures helper draws them over it. In a browser it draws the double's test cards with WebGL2 (`cameras/pictures/`), which is what the page tests see. Each page is a chunk of its own (`workspaceChunks.ts`). The shared parts are in `frontend/packages/design-system` and the colours and sizes in `frontend/packages/tokens`.
