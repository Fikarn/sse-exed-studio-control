# Architecture

Studio Control is a local app for one trusted workstation. It has no cloud dependency, no accounts and no public network exposure. Its jobs are lighting, the audio console, the Stream Deck, the teleprompter and the cameras.

## The parts

| Part                      | Where                                 | Owns                                                                                          |
| ------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| Engine (Rust)             | `native/rust-engine`                  | State, saved data, migrations, backups, every device, safety rules, diagnostics               |
| Shell (Tauri 2)           | `native/tauri-shell`                  | The window, starting and watching the engine, the few things only the operating system can do |
| Pages (React, TypeScript) | `frontend/app`, `frontend/packages/*` | What the operator sees and presses                                                            |
| Contract                  | `native/protocol`                     | Every request and event between the engine and the pages                                      |

The engine is a separate process. The shell starts it, passes the pages' requests to it over its standard input, and passes its answers and events back.

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
- **The bridge takes only what it can afford.** Headers over 8 KiB, bodies over 16 KiB and requests slower than one second are refused. Four workers serve a queue of sixty-four, sized for the deck's busiest second.
- **The console's OSC ports read only TotalMix.** They bind `127.0.0.1` when TotalMix runs on this PC, and datagrams from any other address are dropped.
- **Lights can be held.** While held, nothing is sent to the rig, and only the switch on screen arms them. A hold is saved across starts, and `SSE_SAFE_START=1` holds them at a start.
- **One engine at a time.** The engine locks `engine.lock` in its data folder, and the shell lets only one copy of itself run. Two engines would both stream to the lights.
- **Saved data is checked and backed up.** The database is integrity-checked at every start. A verified backup is written before a schema upgrade, daily, and at every clean close. Every commit waits for the disk. A build refuses data from a newer schema rather than damage it.
- **The shell opens and writes only inside its own folders:** the app-data, logs, backups and exports folders. The packaged pages run under a Content Security Policy with no inline or remote scripts.
- **The parsers of outside bytes have fuzz tests:** the bridge's HTTP reader, the OSC reader and the Word import.
- **Tests cannot reach a device.** Test builds drop every datagram aimed at TotalMix and refuse any camera address that is not on this PC. The simulated console and the simulated cameras stand in.

The app is unsigned, by decision: it runs on one workstation its developer controls.

## The shell

- **One window, always fullscreen.** It opens on the display it was last on, else on the 2560×1440 display, else where it is. **Studio fullscreen** and **Reset the window layout** in Setup / Support put it back.
- **The engine sits beside the shell.** A release build starts `studio-control-engine.exe` from its own folder. `SSE_ENGINE_BIN` names another one.
- **Commands never block the window.** Every command that can wait runs on the blocking pool.
- **The shell watches the engine.** It polls the process every 250 ms. When the engine is gone, every waiting request is answered `ENGINE_EXITED` and the pages are told, so they can offer a restart.
- **A second launch brings the first window forward** and exits.
- **Only the main window may read the clipboard.** The Teleprompter page reads pasted text itself, so the main window is built in code with that permission (`shell_windows.rs`). Any other window, the Prompter XL's included, must be built without it.
- **The browser's own keys are off** (reload, find, print), so no key moves the screen.

## Where things live

Engine (`native/rust-engine/src/`):

- `lighting/`, `lighting_sacn_output.rs`: scenes, fixtures, the one lighting lock, held outputs, the sACN output.
- `audio/`, `rme_totalmix_osc.rs`, `rme_console_link.rs`: the console's state, metering, and the link that confirms every send.
- `prompter/`: scripts, the prompter's clock, the Prompter XL's state, imports.
- `cameras/`: the three cameras, the simulated cameras, the link guard.
- `control_surface.rs`, `control_surface_http.rs`, `exports.rs`: the Stream Deck bridge and the Companion profile. The deck's pages come from one list, `DECK_PAGES`.
- `commissioning.rs`: Setup's steps and probes.
- `storage.rs`, `storage_backups.rs`, `support.rs`: the database, migrations, backups, restore, diagnostics.
- `health.rs`, `action_log.rs`, `engine_events.rs`: the health the header shows, Recent actions, events.

Shell (`native/tauri-shell/src/`): `main.rs` (commands, the window's rules), `engine.rs` (the engine process and its watcher), `shell_windows.rs` (building windows).

Pages (`frontend/app/src/app/`): `OperatorShell.tsx` assembles the header, the tabs and the pages. Each page is a chunk of its own (`workspaceChunks.ts`). The shared parts are in `frontend/packages/design-system` and the colours and sizes in `frontend/packages/tokens`.
