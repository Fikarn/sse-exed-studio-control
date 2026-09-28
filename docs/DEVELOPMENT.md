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

Then open `http://127.0.0.1:4180/?fixture=lighting-populated&transport=fixture`. Every state is a name in `frontend/packages/test-fixtures/src/fixtures.json`. Use any port but `4173`: the page tests bind that one.

**The real app.** `npm run tauri:dev` starts the pages and the shell. It opens the real saved data and the real devices unless told otherwise, so set the variables in AGENTS.md's Safety section first. It does not rebuild the engine: after a change to the engine or the contract, run `npm run native:engine:build` and start it again. If the app opens on its recovery screen straight after such a change, that is why.

## Checking a change

| Command                            | Runs                                                                                                            | Takes               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------- |
| `npm run check:quick`              | Contract check, format, lint, script tests, file sizes, Rust format and clippy, types, unit tests, engine tests | under a minute      |
| `npm run frontend:playwright:test` | Builds the pages and Storybook, then the page tests: behaviour, the layout measures, the captures               | about three minutes |
| `npm run check`                    | Both                                                                                                            | about four minutes  |

Each step of `check:quick` logs to `node_modules/.cache/dev-check/`. A step that fails on timing is re-run alone with `npm run dev:check:serial` before it is believed.

The layers, and what each is for:

- **Engine tests** (`cargo test`, in `native/rust-engine`): behaviour. This is where a feature is tested first. The three readers of outside bytes also have fuzz tests; a failing case leaves its seed under `proptest-regressions/`, which is committed with the fix.
- **Unit tests** (Vitest, beside the source as `*.test.ts`): page logic.
- **Page tests** (Playwright, `frontend/app/tests`): what the operator does on screen, against the test double of the engine (`frontend/packages/engine-client/src/transports/fixture/`).
- **The layout measures** (`ui-contract.spec.ts`): every page against `docs/DESIGN.md` section 10.
- **Captures** (`visual-review.spec.ts`, `storybook.spec.ts`): screenshots at 2560×1440, compared on Windows only.
- **Hardware tests** (`npm run native:test:hardware`): the engine tests marked `#[ignore]`, against the real console. Only when the owner asks and is present, with the studio app closed and `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1` set (`docs/HARDWARE.md`).

## Captures

The committed captures are under `frontend/app/tests/__visual__/`. CI compares none of them, so the local run is the one that counts.

When a change moves a page:

1. `npm run build --workspace frontend/app && npm run frontend:storybook:build`
2. `cd frontend/app && npx playwright test visual-review.spec.ts storybook.spec.ts --update-snapshots=changed`
3. Look at every changed picture before `git add`.

## The layout measures

`ui-contract.spec.ts` renders every fixture at 2560×1440 and measures it: type sizes and families, contrast sampled from the screenshot, target sizes, radii, shadows, gradients, idle animations, chrome sizes, scroll, and forbidden words. Each page's numbers are held in `frontend/app/tests/ui-contract.ratchets.json`: a measure may fall, never rise.

```bash
# from frontend/app: measure every page and write a report to artifacts/ui-census/
node scripts/ui-census.mjs

# the same, and write the numbers it measured as the new ratchets
node scripts/ui-census.mjs --write-ratchets
```

The report names the elements behind a number, not only the count. Write new ratchets only on Windows (contrast is sampled nowhere else), and read `git diff` on the ratchet file before committing: nothing may rise.

Two gates run beside it: `node scripts/check-operator-copy.mjs` (forbidden words in the source, from the repository root) and the design system's `css-literals.test.ts` (raw values in stylesheets, against a list that may only shrink).

## Traps

Pages and their tests:

- **The page tests serve the built pages.** Build before running Playwright by hand, or you test the previous build. `npm run frontend:playwright:test` builds first.
- **Never build Storybook while the page tests run.** Its pages vanish mid-run and unrelated tests fail.
- **Port `4173` belongs to the page tests.** A preview server left on it after a run makes the next run fail or lie. End it first.
- **A page is on screen later than its shell.** Each page is a chunk fetched after the shell has drawn. A test whose first step is a key or a one-off read calls `expectWorkspaceMounted(page, workspace)` first.
- **Time is driven, never waited out.** Use `page.clock` and `helpers/pageClock.ts`. A second press inside an arm's dwell, a meter tick, a countdown: none of them is tested with a real wait.
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
- **Tests never bind the real ports.** TotalMix's `7001` to `7010` and sACN's `5568` are never bound or sent to by a test; test builds drop datagrams aimed at TotalMix.
- **One log writer.** `diagnostics::log_event` writes `<logs>/engine.log`, which rotates at 5 MiB. `SSE_ENGINE_LOG_LEVEL=DEBUG` adds one line per request. The shell keeps the engine's stderr in `<logs>/shell.log`.
- **Health reports changes of state, not attempts:** `health::report(subsystem, state, detail)`.
- **No file over 2,000 lines.** `npm run file:health` fails on one. Split before a file gets there.

## Where the pages' code lives

- `frontend/app/src/app/OperatorShell.tsx`: the header, the tabs, the pages.
- `lighting/`, `audio/`, `setup/`, `teleprompter/`: one folder per page. Lighting and Setup are assembled from hooks (`lighting/editor/`, `setup/pilot/`) and regions (`lighting/regions/`, `setup/steps/`, `setup/support/`).
- `teleprompter/glass/`: the prompter's glass, drawn both on the page and on the Prompter XL.
- `frontend/packages/engine-client`: the store, the two transports (the shell's, and the test double).
- `frontend/packages/design-system`, `frontend/packages/tokens`: the shared components, and the sizes and colours. Tokens are built with `npm run frontend:tokens:build`.

## Studio builds

A studio build is a release build of the shell with the engine beside it. How one is made and kept is being rebuilt (`docs/ROADMAP.md`, the streamlining's builds step); until then the builds the studio has run are under `release\native\`.
