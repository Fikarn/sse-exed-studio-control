# Architecture

Studio Control is a local app for one trusted workstation. It has no cloud dependency, no accounts and no public network exposure. Its jobs are lighting, the audio console, the Stream Deck, the teleprompter and the cameras.

## The parts

| Part                      | Where                                 | Owns                                                                                          |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Engine (Rust)             | `native/rust-engine`                  | State, saved data, migrations, backups, every device, safety rules, diagnostics               |
| Shell (Tauri 2)           | `native/tauri-shell`                  | The window, starting and watching the engine, the few things only the operating system can do |
| Pages (React, TypeScript) | `frontend/app`, `frontend/packages/*` | What the operator sees and presses                                                            |
| Contract                  | `native/protocol`                     | Every request and event between the engine and the pages                                      |
| Pictures helper (Rust)    | `native/pictures-link`                | Receiving the cameras' pictures (D28)                                                         |

The engine is a separate process. The shell starts it, passes the pages' requests to it over its standard input, and passes its answers and events back. The engine starts the pictures helper in turn, tells it each camera's vMix input over its standard input, and hears what it receives.

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
- **The frames never reach the page's network.** The shell listens for the pictures helper on 127.0.0.1 at a port the system picks, with a secret made at each start of the engine: the engine clears it from its environment and hands it to the helper on its stdin. A connection that does not say it within a second is closed, one connection sends at a time, a header is checked before a byte of its picture is kept, and the secret is in no log and no answer. The page takes the newest frame through the IPC it already has; its connection policy is unchanged, and a test pins it.
- **The pictures cost the pictures and nothing else.** Whatever receives them runs in the pictures helper, a process of its own (D28): a crash or a hang there never stops the lights, the console, the deck or the prompter. The engine starts it below normal priority, with all three of its pipes, from beside its own program and from nowhere else; a helper silent for 5 s is ended, one that ends is started again after 1, 2, 4 … 30 s, and it ends by itself when the engine goes. Its one source is simulated for now, and only a development build starts it.
- **Tests cannot reach a device.** Test builds drop every datagram aimed at TotalMix and refuse any camera address that is not on this PC. The simulated console and the simulated cameras stand in.
- **A development build keeps off the studio.** A studio build is one `npm run release` made, marked while it compiled; every other build is a development build. It refuses `%APPDATA%\ExEd Studio Control Native`, and any folder inside it, for its saved data and its logs, before it creates or opens anything; the engine and the shell ask the same code (`native/protocol/rust/src/development.rs`). Where a switch is not set it takes the safe value: the lights held and their wire cut, the console and the cameras simulated, a bridge port of its own. It is also an app of its own (`.dev` at the end of its identifier), so the studio's saved display and browser profile are not its to write.

The app is unsigned, by decision: it runs on one workstation its developer controls.

## The shell

- **The operator's window, always fullscreen.** It opens on the display it was last on, else on the 2560×1440 display, else where it is. **Studio fullscreen** and **Reset the window layout** in Setup / Support put it back.
- **The prompter's window, on the Prompter XL.** The shell's second window shows the glass on the screen Windows names `Prompter XL`, and on no other (`shell_prompter_window.rs`). The watch over the screens opens it once the screens stand still and closes it at the look that does not find the Prompter XL. It is built hidden, put, checked and then shown; it takes no keyboard; its own events hide it when Windows moves it, and it reads `NOT SHOWING` until it is opened again. Any build but the studio's opens an ordinary window in its place. The app ends with the operator's window.
- **The shell tells the hardware link of the Prompter XL** (`prompter.screen.report`), at every look and at once when the hardware link has started. It says that the screen is there only while the window's page says that it draws, once a second.
- **The shell watches the screens.** Once a second it reads Windows' display configuration, which names each screen and shows a duplicated one as it is; Tauri does neither, and says nothing when a screen comes or goes. When the screens have changed and stand still again, a window that Windows moved is put back on its display. The display is known by its screen's own name (`HP E273q`), then by its place on the desktop. While it is away (switched off, asleep) the window stays where Windows put it, and goes back when the display returns. `shell.log` names the screens at the start and after every change, and says what was done about the window.
- **The engine sits beside the shell.** The shell starts `studio-control-engine.exe` from its own folder and from nowhere else. A build is a folder that holds both.
- **The frames' route** (`shell_pictures.rs`). At each start of the engine the shell opens the pictures' listener and puts its address and secret into the engine's environment. It keeps the newest frame of each camera; `pictures_next` hands it to the page once, as an `ArrayBuffer`, and a frame nobody took is replaced by the next. Only the main window may call it. The counts go to `shell.log` once a minute while frames arrive.
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

Shell (`native/tauri-shell/src/`): `main.rs` (the app and its window), `engine.rs` (the engine process and its watcher), `shell_commands.rs` (what the pages ask of the engine), `shell_window_layout.rs` (the display the window is on), `shell_displays.rs` and `shell_display_watch.rs` (the screens, and the watch over them), `shell_windows.rs` (building windows), `shell_paths.rs` (folders and the diagnostics report), `shell_browser_keys.rs` (WebView2's own keys, off), `shell_pictures.rs` (the pictures' frame route), `shell_smoke.rs` and `shell_test_bridge.rs` (the lanes' ways in).

Pages (`frontend/app/src/app/`): `OperatorShell.tsx` assembles the header, the tabs and the pages. Each page is a chunk of its own (`workspaceChunks.ts`). The shared parts are in `frontend/packages/design-system` and the colours and sizes in `frontend/packages/tokens`.
