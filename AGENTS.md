# Studio Control

The one file to read before working here. `CLAUDE.md` loads it.

## What this is

A desktop app for one studio workstation: Windows 11, fullscreen on the studio display at 2560×1440. It runs the studio's lights (sACN), the audio console (RME TotalMix over OSC), the Stream Deck+ (through Bitfocus Companion), the teleprompter and the cameras.

One developer builds it, working with Claude. Nobody else installs it. There is no other machine, system or screen size to support.

## How it is built

| Part                      | Where                  | Owns                                                  |
| ------------------------- | ---------------------- | ----------------------------------------------------- |
| Engine (Rust)             | `native/rust-engine`   | State, saved data, every device                       |
| Shell (Tauri 2)           | `native/tauri-shell`   | The window; starts the engine                         |
| Pages (React, TypeScript) | `frontend/`            | What the operator sees                                |
| Contract                  | `native/protocol`      | The requests and events between engine and pages      |
| Pictures helper (Rust)    | `native/pictures-link` | The cameras' pictures; the engine starts and stops it |

Two rules hold the design together:

- **No device or saved-data logic in the pages.** The pages show what the engine reports and send what the operator presses.
- **The contract is changed at its source** (`v1.contract.json` and `v1.md`), then `npm run protocol:generate`. Generated files are never edited by hand.

## Development and the studio are separate

- **`main` is the development line.** Merging to it changes nothing in the studio.
- **The studio runs the latest verified build.** `npm run release` makes a studio build from `main` and keeps it in `builds\`, beside the repository. The owner walks `docs/CHECKLIST.md` with it on the real hardware; `npm run release:verified` then makes it the build that `builds\Studio Control.cmd` starts. Promoting a build is the owner's decision.
- **The studio is not in use during development.** Close the app when it is in the way.

## The loop

1. **Agree.** Ask the owner what only the owner can decide, once, before building, each with a recommendation. Decide everything else and say what was decided.
2. **Build** on a branch from `main`.
3. **Check** with `npm run check`. It runs what CI runs but the two shell lanes, on this machine, in a few minutes.
4. **Merge.** Push, open a pull request, merge when CI is green. No go-ahead is needed.
5. **Record.** The pull request says what changed, why, and how it was checked. `CHANGELOG.md` gets a line or two when the operator would notice the change. `docs/ROADMAP.md` is ticked.
6. **Show.** When the change is something the owner can see or the hardware does, start the app and let the owner try it.

**Review.** A change to device I/O, saved data or a migration gets one independent review before it merges. Nothing else needs one unless the owner asks.

**No other records.** No document records run numbers, commit hashes or test counts. Git and the pull requests keep them. The ledgers this project used until 2026-09-28 are in git history at the tag `archive/records-2026-09`.

## Safety

- **Tests and development runs never reach a real device and never open the real saved data.** A development build sees to it, whoever starts it: it refuses the studio's folders, holds the lights and cuts their wire, simulates the console, the cameras and their pictures, and takes a bridge port of its own. `npm run app` starts one on saved data of its own. What is left is what a person presses for: Setup's probes ask the address they are given. The one exception is `npm run app -- --vmix-pictures`, a hardware test the owner asks for and attends: its pictures come over NDI from vMix's Outputs 2 to 4 on this PC (D33).
- **Real devices are driven only by a studio build,** or by a hardware test the owner asked for and is present at. Only `npm run release` makes a studio build: every other build, a release build included, is a development build.
- **Held lights stay held** until they are armed on screen. A development run always starts held.
- **Cameras and the prompter** follow the rules in `docs/HARDWARE.md`.
- **Saved data:** a schema upgrade writes a backup first. Backups are never deleted by a script. A newer build upgrades the saved data, and an older build then refuses it: going back means restoring the backup.
- **Files that are not in git are not deleted by the assistant:** old builds, build folders, the owner's own folders. The owner gets the command.
- **Dependencies:** never `npm audit fix`. Take the fixed version.

## Product rules

- Windows at 2560×1440, fullscreen, and nothing else.
- No keyboard shortcuts. Every control has a place on screen.
- No scrolling in normal operation.
- One theme, Studio.
- Words on screen never include "engine", "backend", "transport", "IPC" or "snapshot" (the Console's own "snapshot" excepted). The screen calls the engine "the hardware link".
- The visual system is `docs/DESIGN.md`. The page tests measure it on every page.

## Commands

| Command                                | Does                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run check`                        | The whole gate: format, lint, types, unit tests, engine tests and lanes, then the page tests            |
| `npm run check:quick`                  | The same without the page tests (under a minute)                                                        |
| `npm run frontend:playwright:test`     | The page tests alone; it builds the pages first                                                         |
| `npm run dev --workspace frontend/app` | The pages in a browser, against test data (add `?fixture=<name>&transport=fixture` to the address)      |
| `npm run app`                          | The app as a development run: its own saved data, simulated devices. It can run beside the studio app   |
| `npm run release`                      | A studio build of `main`, in `builds\`, tried on scratch data. `release:verified` makes it the studio's |
| `npm run protocol:generate`            | Regenerate the contract's generated files                                                               |
| `npm run format`                       | Format everything with Prettier                                                                         |

A capture that a change moved is refreshed with `npx playwright test --update-snapshots=changed` from `frontend/app`, and looked at before it is committed.

## Where to look

| For                                   | Read                    |
| ------------------------------------- | ----------------------- |
| What is next, and the decisions taken | `docs/ROADMAP.md`       |
| The studio walk that verifies a build | `docs/CHECKLIST.md`     |
| Devices, addresses, the safety rules  | `docs/HARDWARE.md`      |
| How to run, test and debug; the traps | `docs/DEVELOPMENT.md`   |
| Engine, shell and pages in depth      | `docs/ARCHITECTURE.md`  |
| The visual system                     | `docs/DESIGN.md`        |
| The operator's manual                 | `docs/OPERATIONS.md`    |
| Every request and event               | `native/protocol/v1.md` |
