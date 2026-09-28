# Development

How to run, test and debug Studio Control on the studio workstation, and the traps that have cost time. The workflow itself is in [AGENTS.md](../AGENTS.md).

## Setting up

Node 24 (`.nvmrc`), the Rust toolchain that `native/rust-toolchain.toml` pins, and WebView2 (part of Windows 11).

```bash
npm install
npm run check:quick
```

## Running it

**The pages in a browser, on test data.** The fastest way to look at a state by hand. No engine and no shell are involved; the page is drawn for 2560×1440, so look at it fullscreen (F11).

```bash
npm run dev --workspace frontend/app -- --port 4180 --strictPort --host 127.0.0.1
```

Then open `http://127.0.0.1:4180/?fixture=lighting-populated&transport=fixture`. Every state is a name in `frontend/packages/test-fixtures/src/fixtures.json`. Use any port but `4173` and `4174`: the page tests bind the first, the app's development run the second.

**The app.** `npm run app` builds the engine and the shell and starts them as a development run:

- its saved data is `.dev/app-data` in the repository, which git ignores, and it stays between runs. The first start opens Setup: publish it once, over the probes that cannot pass;
- the lights are held and their wire is cut, the console and the cameras are simulated, and the Stream Deck bridge is on port `38211`, which Companion does not talk to. Arming the lights on screen sends nothing. Setup's probes still ask the address they are given, and the Companion export asks nobody;
- it is an app of its own, with `.dev` at the end of its identifier: its own saved display and browser profile, and it runs while the studio app is open.

To work on the studio's data, copy its folder and name the copy: `npm run app -- --data=<the copy>`. The studio's own folder, and any folder inside it, is refused by the command and by every development build.

A development build started any other way is as careful: where a switch is not set it takes the safe value (`native/rust-engine/src/development.rs`), and says so in its log.

A change to the pages shows at once. After a change to the engine or the contract, close the app and start it again.

## Checking a change

| Command                            | Runs                                                                                                            | Takes               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------- |
| `npm run check:quick`              | Contract check, format, lint, script tests, file sizes, Rust format and clippy, types, unit tests, engine tests | about a minute      |
| `npm run frontend:playwright:test` | Builds the pages and Storybook, then the page tests: behaviour, the layout measures, the captures               | about three minutes |
| `npm run check`                    | Both                                                                                                            | about four minutes  |

Each step of `check:quick` logs to `node_modules/.cache/dev-check/`. A step that fails on timing is re-run alone with `npm run dev:check:serial` before it is believed.

The layers, and what each is for:

- **Engine tests** (`cargo test`, in `native/rust-engine`): behaviour. This is where a feature is tested first. The three readers of outside bytes also have fuzz tests; a failing case leaves its seed under `proptest-regressions/`, which is committed with the fix.
- **Unit tests** (Vitest, beside the source as `*.test.ts`): page logic.
- **Page tests** (Playwright, `frontend/app/tests`): what the operator does on screen, against the test double of the engine (`frontend/packages/engine-client/src/transports/fixture/`).
- **The layout measures** (`ui-contract.spec.ts`): every page against `docs/DESIGN.md` section 10.
- **Captures** (`visual-review.spec.ts`, `storybook.spec.ts`): screenshots at 2560×1440, compared on Windows only.
- **Lanes** (`native:acceptance`, `native:bridge`, `tauri:smoke`): the engine driven from outside, over its pipe and over its Stream Deck bridge, on scratch data with simulated devices. They are part of `check:quick`. `npm run release` runs the first two against the build it makes.
- **The two shell lanes** (`tauri:setup-support:qualify`, `tauri:workspaces:qualify`) run in CI only. They open the app's window, and the Setup lane connects to addresses of no network, which on this PC leave by one of its two default routes.
- **Hardware tests** (`npm run native:test:hardware`): the engine tests marked `#[ignore]`, against the real console. Only when the owner asks and is present, with the studio app closed and `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1` set (`docs/HARDWARE.md`).

## Captures

The committed captures are under `frontend/app/tests/__visual__/`. CI compares none of them, so the local run is the one that counts.

A page's capture is its workspace: the header and the footer are masked, and captured once, as strips of their own (nine headers, five footers). A change to the header moves the strips and no page.

A board that a page reaches by a press (the Teleprompter's editor, Setup's Map step on a page of the deck) has its presses in `BOARD_STEPS`, in `frontend/app/tests/helpers/ui-contract/boards.mjs`. The captures and the layout measures both make them.

When a change moves a page:

1. `npm run build --workspace frontend/app && npm run frontend:storybook:build`
2. `cd frontend/app && npx playwright test visual-review.spec.ts storybook.spec.ts --update-snapshots=changed`
3. Look at every changed picture before `git add`.

The comparison allows a hundred differing pixels, so a change of a digit or a letter can pass as no change. After a change of words or numbers, write the boards concerned again with `--update-snapshots=all`, keep the pictures that differ in more than noise, and put the others back with `git checkout`.

## The layout measures

`ui-contract.spec.ts` renders every fixture at 2560×1440 and measures it: type sizes and families, contrast sampled from the screenshot, target sizes, radii, shadows, gradients, idle animations, chrome sizes, scroll, and forbidden words.

Every page holds the same limits, `LIMITS` in `frontend/app/tests/helpers/ui-contract/boards.mjs`. The pages that differ are listed beside them, in `EXCEPTIONS`, each with its reason. A page that fails prints all its measures and its worst contrasts. A new exception needs a reason that would satisfy the owner.

Two gates run beside it: `node scripts/check-operator-copy.mjs` (forbidden words in the source, from the repository root) and the design system's `css-literals.test.ts` (raw values in stylesheets, against a list that may only shrink).

## Traps

Pages and their tests:

- **The page tests serve the built pages.** Build before running Playwright by hand, or you test the previous build. `npm run frontend:playwright:test` builds first.
- **Never build Storybook while the page tests run.** Its pages vanish mid-run and unrelated tests fail.
- **Port `4173` belongs to the page tests.** A preview server left on it after a run makes the next run fail or lie. End it first. The app's development run has `4174`, so the two can run at once.
- **A page is on screen later than its shell.** Each page is a chunk fetched after the shell has drawn. A test whose first step is a key or a one-off read calls `expectWorkspaceMounted(page, workspace)` first.
- **Time is driven, never waited out.** Use `page.clock` and `helpers/pageClock.ts`. A second press inside an arm's dwell, a meter tick, a countdown: none of them is tested with a real wait.
- **A page test reaches the simulated cameras through `window.__SSE_TEST_CAMERAS__`:** a value changed on a camera, a camera that stops answering and answers again, how many commands a camera was sent. The page drives everything else.
- **The double's deck is the hardware link's.** `deckPages.json`, beside the double, is the page model Setup draws (`build_control_surface_snapshot`), and the engine's test `the_doubles_deck_pages_are_the_page_model` fails when the two differ. Write it again from `native`, then format it: `SSE_WRITE_DECK_PAGES=1 cargo test -p studio-control-engine --bins the_doubles_deck_pages_are_the_page_model`, and `npx prettier --write` on the file.
- **A JSON file the double imports carries its attribute:** `import pages from "./deckPages.json" with { type: "json" }`. Some page tests load the double's source in Node, which refuses a JSON module without it; the pages' build and the unit tests do not notice.
- **No line is cut.** The layout measures do not see a text cut with an ellipsis. Where a line may be cut, a page test fills it with the longest value and compares `scrollWidth` with `clientWidth` (`cameras.spec.ts`, "no line is cut").
- **The app's unit tests run from the app's folder:** `npm run test --workspace frontend/app -- <file>`. Started from the repository's root with `--root`, Vitest refuses the glass's font files and `PrompterGlass.test.tsx` fails.
- **A test that fails now and then has a cause.** Every one so far was the test: a click sent before the page had drawn the state it needed. Find it; do not retry it away.
- **A test reported as flaky passed on its second try.** The workstation allows one retry, because Windows now and then refuses the browser a socket (`net::ERR_NO_BUFFER_SPACE`) and the page draws without a file. Read why the first try failed. If it was anything else, find the cause.
- **Raising a type size breaks layouts** written for the old one, and only measurement finds it. After a type change, run the layout measures.
- **A 24 px target without moving the layout:** grow the element, pay it back with a matching negative margin, and paint the visible part on `::before`. `ScrubSlider` is the worked example.
- **Tokens are kebab-case.** `--size-compactControlHeight` silently gives nothing; the name is `--size-compact-control-height`.
- **Test ids are extended, never renamed.**

The engine:

- **Lighting has one lock.** Every lighting change runs inside `with_lighting_state` (or `with_lighting_state_and_preview`), taken at the entry point: the dispatcher, the deck's keys, a restore. The lighting functions themselves take no lock, because the lock is not re-entrant: a function that took it again would hang. Lock order is always the lighting lock, then the shared preview. Never hold the lighting lock and the audio lock together.
- **What the wire depends on bumps the render generation.** The sACN thread reads the database only when `bump_lighting_render_generation()` has moved it.
- **A new request must be classified.** `action_log::tests::every_contract_method_is_classified` fails until the method is in `RECORDED_UI_METHODS` or `NOT_AN_ACTION_UI_METHODS`. A ride (a fader, a dial detent) is never a row in Recent actions. The pages' store needs the method and its event mapped in `domainRefresh.ts`.
- **A migration step names its own number.** Every step is `if schema_version < N` with a literal `N`, never the constant for the newest schema, or raising the constant re-runs the step.
- **Checkpoint before moving the database.** The long-lived threads keep a read connection open, so anything that moves, copies or replaces the database file calls `storage::checkpoint_database` first.
- **A commit waits for the disk,** about 35 ms here. A test that loops over writes stays in the tens.
- **Tests that share the console link wait on its state** (`settle_console_link`), never on a sleep.
- **The deck's tests give the moment themselves.** The cameras' keys and displays take the moment of a press from their caller (`handle_deck_action_at`, the bridge's `*_at` forms), so the dwell, the 3 s of `STOP?` and the 250 ms a page's texts are kept are tested without a wait. The prompter reads its own clock.
- **A take's start or stop changes the Cameras lamp,** so its key raises `app.changed` after `cameras.changed`.
- **Tests never bind the real ports.** TotalMix's `7001` to `7010` and sACN's `5568` are never bound or sent to by a test; test builds drop datagrams aimed at TotalMix.
- **One log writer.** `diagnostics::log_event` writes `<logs>/engine.log`, which rotates at 5 MiB. `SSE_ENGINE_LOG_LEVEL=DEBUG` adds one line per request. The shell keeps the engine's stderr in `<logs>/shell.log`.
- **Health reports changes of state, not attempts:** `health::report(subsystem, state, detail)`.
- **No file over 2,000 lines.** `npm run file:health` fails on one. Split before a file gets there.

The shell:

- **CI compiles no Windows code.** Its jobs run on Linux, so what stands under `cfg(windows)` (the display calls, WebView2's settings) is compiled and tested by the gate on this PC alone.
- **`unsafe` has a list.** The shell's crate denies `unsafe`, and lifts it for the functions `SHELL_UNSAFE` names in `scripts/check-no-shortcuts.test.mjs`, each with its reason and its number of blocks. A block says why it is sound in a `// SAFETY:` comment above it. A new block changes the list.
- **A command of the shell is named by its module** in `main.rs`'s two handler lists (`shell_commands::engine_start`): the macro that registers it lives beside the command.
- **A rule about screens is a function over plain data.** `shell_displays.rs` reads Windows once and answers a list; everything else (which screen is the Prompter XL, whether the screens changed, where the window goes) takes that list, so it is tested without a screen.
- **The watch over the screens asks the window nothing while it holds a lock.** On its thread a question to a window (its monitor, whether it is fullscreen) waits for the main thread. The main thread runs the window commands, which take the same lock (`HeldDisplay`): a question asked under the lock would stop both. The watch looks first (`see`), then locks; what it tells the window is posted.

## Where the pages' code lives

- `frontend/app/src/app/OperatorShell.tsx`: the header, the tabs, the pages.
- `lighting/`, `audio/`, `setup/`, `cameras/`, `teleprompter/`: one folder per page. Lighting and Setup are assembled from hooks (`lighting/editor/`, `setup/pilot/`) and regions (`lighting/regions/`, `setup/steps/`, `setup/support/`).
- `teleprompter/glass/`: the prompter's glass, drawn both on the page and on the Prompter XL.
- `cameras/pictures/`: the pictures' geometry (whole frame, 1:1, the loupe), the aids worked out from a picture's pixels, and the test pictures that stand in until the cameras' pictures are built.
- `frontend/packages/engine-client`: the store, the two transports (the shell's, and the test double). The double has an entry of its own, `@sse/engine-client/fixture`, and the pages load it on request (`fixtureDouble.ts`): in a browser, never in the app's window.
- `frontend/packages/design-system`, `frontend/packages/tokens`: the shared components, and the sizes and colours. Tokens are built with `npm run frontend:tokens:build`.

## Studio builds

A studio build is a folder that holds the shell and the engine, both release builds that `npm run release` marked as the studio's, and `build.json`, which names the commit and the hash of each file. Every other build is a development build and keeps off the studio, a release build made by hand included.

```bash
npm run release
```

It needs a clean working tree and a commit that is on `origin/main`. It builds, copies the two files into `builds\<day>_<commit>\` beside the repository, and then tries the copy on scratch data with simulated devices: the shell starts the engine beside it, and the acceptance lane and the bridge lane run against that engine. It takes about ten minutes. A build is never overwritten and never deleted by a script.

To make a build the studio's:

1. Close the studio app and start the new build's `sse-exed-tauri-shell.exe`. If its saved-data schema is newer, this start upgrades the studio's data, after a backup. An older build then refuses that data: going back means restoring the backup.
2. Walk `docs/CHECKLIST.md`.
3. `npm run release:verified -- <the build's name>`. It checks the folder against `build.json`, points `builds\Studio Control.cmd` at the build, adds a line to `builds\verified.txt` and tags the commit `verified/<name>`.

`builds\Studio Control.cmd` always starts the verified build. `STUDIO_BUILDS_DIR` names another builds folder.
