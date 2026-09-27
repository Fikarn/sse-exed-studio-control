# New pages program — the next session (the cloud: the front end and the visuals)

Written on 2026-09-26, after Slice SW landed. Rewritten on 2026-09-27 on the studio workstation, as Slice 4 landed, for the cloud sessions that now carry the program's front end and visuals end to end (the operator's decision D23).

The ledger, [`new-pages-2026-09.md`](./new-pages-2026-09.md), stays the execution record. This page covers:

- where to start and what the cloud is to do;
- what a cloud session can and cannot do;
- the contract the front end now builds on;
- the program's standing rules, which until now lived only in the operator's session prompts.

## Start here

1. `git log --oneline -5`: `main` holds Slice 4 (#225) or later.
2. Read `AGENTS.md` (`CLAUDE.md` points there).
3. In the ledger, read:
   - the `Status:` and `Tracking:` paragraphs;
   - the Decisions table (D1–D23; D23 is this arrangement);
   - `Hardware safety`;
   - `Mechanical drift guards`;
   - Part C: its common rules, Slice 4's record (the contract you build on) and Slices 5–13.
4. Read the visual system: `docs/redesign/system-a-2026-09.md` (its §10 is measured on every board by `frontend/app/tests/ui-contract.spec.ts`) and `docs/DEVELOPMENT.md` §2c (the UI contract, the front-end map, fixtures, the traps that cost time).
5. Read the design sources:
   - `docs/redesign/teleprompter-2026-09.md` (D20, with §14 answered);
   - `docs/redesign/new-pages-boards-2026-09.md` (the ten board decisions);
   - `docs/redesign/assets/concepts/A-teleprompter-1.html` (the Teleprompter, "Live mirror", D19);
   - `docs/redesign/assets/concepts/A-cameras-2.html` (the Cameras, "Hero and two", D19).

   The boards are self-contained HTML at 2560×1440 in Studio, Graphite and Bone. They load Inter and JetBrains Mono from Google Fonts; if the session cannot reach them, serve the copies in `node_modules/@fontsource-variable/{inter,jetbrains-mono}` (the last cloud session did).

## Where things stand

- **Landed on `main`:** S1 (#211), S2 (#213), SF (#214), S2b (#215), S3 (#216), SW (#221), C0 (#224) and S4 (#225: the Teleprompter's scripts and the prompter in the hardware link). Each slice's record is in the ledger, and each merge's commits are kept under a tag `archive/new-pages-<slice>-2026-09` (pushed from the workstation).
- **The cloud's mandate (D23, 2026-09-27):** the program's front end and visuals, end to end. That means:
  - both pages, the glass, every board, the header's tabs and lamps, Setup's steps and the deck pages' drawings;
  - the hardware-link and contract work they stand on, where it compiles on Linux.

  A slice that moves boards merges from the cloud once its ten checks are green, you have reviewed your own renders at 2560×1440, and the operator has given the go-ahead. The win32 captures of every board you moved are refreshed later, in one workstation catch-up.

- **Waiting on the operator's word:** the Dependabot pull requests #193, #217, #218, #219 and #220 (one go-ahead each); a low Dependabot alert (#7) on `main`; and D18's two checks, which gate Slice 13.
- **On the workstation:** the live app stays `main`'s build of `98bbb06` (schema 7) until the program's close-out. The live data then goes from schema 7 to 9, or to 10 once Slice 8 lands, in one start. The Appendix B walk happens there, on the program's last build.

## The first step: re-cut Part C for the cloud

Part C's Slices 5–13 were written for one workstation. Put a re-cut to the operator, with options, costs and a recommendation, and record the answer as a `**Rescope:**` under Part C before any code. A cut that fits D23 (a suggestion to weigh, not a decision):

- **C1, the glass** (the front-end half of Slice 5): one component that draws the Prompter XL's 1920×1080 screen from the prompter's state.
  - It lays the text out at a fixed 1,920 CSS px and scales, so the page's copy and the glass break every line alike.
  - It reports its layout for the current `layoutKey`, gives every paragraph (an empty one too) a line with a height, and draws the motion with `motion.ts`.
  - It gets its Storybook stories.
  - The Prompter XL's states (`CONNECTED`, `NOT CONNECTED`, `DUPLICATED`, `LOW RESOLUTION`, `NOT SHOWING`) go into the contract as `checks.prompter` in the health snapshot and in the fixture double. The shell will report the screen's state to the hardware link, and the Windows side of that report comes later.
- **C2, the Teleprompter page** (Slice 6): the page from board 1, against the fixture double, with its fixtures and UI-contract boards.
  - The shell's clipboard permission goes to the main window only (`WebviewWindowBuilder::enable_clipboard_access`; the window is then built in code from its `tauri.conf.json` entry). A test holds that no other window gets it.
  - The editor binds no key (D6): the browser's Ctrl+B/I/U are cancelled through `beforeinput`. Confirm that with the operator, as Slice 6 says.
- **C3, the cameras' model** (Slice 8): schema 10, `cameras.*`, `cameras.changed`, `checks.cameras`, the simulated cameras that every test and lane uses (D15 rules 1–2), Recent actions, and archive format 7. It is hardware link and contract, and it compiles on Linux.
- **C4, the Cameras page** (Slice 9): the page from board 2 against the simulated cameras, the header's five lamps, and Setup's camera step.
- **C5, the deck pages** (Slices 7 and 12): the bridge's actions and feedback, the Companion export (`exports.rs` split first), and Setup's deck steps, which draw every page the deck has.
- **On the workstation, later:**
  - S5b: the Prompter XL's window, Windows' display configuration, the "live app" rule and the `main.rs` split;
  - S10 (NDI), S11 (Bluetooth) and S13 (the BGH1s, gated on D18);
  - the captures catch-up;
  - the close-out: a new live build, the Stream Deck profile, the walk.

## What a cloud session can and cannot do

- **Runs here:** `npm ci`, then:
  - `npm run lint`, `npm run frontend:typecheck`, `npm run frontend:test` (with its coverage floors), `npm run scripts:test`, `npm run format:check` and `npm run protocol:check`;
  - `node scripts/check-operator-copy.mjs`, which holds at 0;
  - the Playwright behaviour specs and the UI contract, after `npm run build --workspace frontend/app && npm run frontend:storybook:build` (Linux Chromium: `npx playwright install --with-deps chromium`). Off Windows, Playwright compares no screenshot (`ignoreSnapshots`) and the UI contract samples no contrast; every other §10 measure runs.
- **Rust:** `cargo test -p studio-control-engine` and `cargo clippy -p studio-control-engine --all-targets -- -D warnings` need only the toolchain `native/rust-toolchain.toml` pins and a C compiler for the bundled SQLite. The shell crate (`native/tauri-shell`) also needs the Linux packages in `.github/actions/setup-tauri-linux/action.yml`; if they cannot be installed, leave the shell to CI, which compiles it on every push.
- **Your own visual review replaces the win32 captures until the catch-up.** Render each board you make or move at 2560×1440 in Studio, Graphite and Bone with a Playwright script of your own, in the scratch directory and never committed. Look at the renders, compare them with the boards, and say in the pull request what you checked.
  - The app runs without the hardware link at `/?fixture=<id>&transport=fixture&theme=graphite|bone`.
  - The fixtures are in `frontend/packages/test-fixtures/src/fixtures.json`. The prompter's double starts empty in every scenario, so the new pages need scenarios of their own.
- **Not possible here:**
  - the live app and the studio hardware;
  - Windows-only code (it compiles on the workstation only);
  - packaging and signing;
  - the qualification lanes, which run in CI only;
  - the win32 captures: do not delete, refresh or commit any `*-win32.png`;
  - pushing a tag or deleting a branch, since a cloud session can push only its own branch. List the archive tags a merge needs in the ledger, and the next workstation session pushes them.

## The contract the front end builds on (Slice 4)

`native/protocol/v1.md` › Teleprompter has all of it. The points a page or the glass must hold:

- **The clock runs in the hardware link.** Only the front end has the fonts, so the view that draws the glass reports its layout (`prompter.layout.report`). The first report for a key wins, and a report for an older key is ignored.
- **The anchor.** A view draws the motion from the anchor in `prompter.changed` and in the snapshots: `position(t) = min(position + pxPerReadWord · words(ageMs + t), endPosition)`, computed by `motion.ts`. A view with another layout places the text from `place.paragraph` and `wordOffset` (a share of the line's words).
- **The place is words, never pixels.** The prompter is paused after every start and restore, stops by itself only at `END`, and says so with `reason: "at-end"`.
- **Read what is locked from the prompter's state:** `glass`, `atEnd`, `laidOut`, `notUpdated`. Refused requests throw an `EngineRequestError` with the code and the sentence, on both transports.
- **Arming stays on the page.** Replacing what the prompter shows needs `replace: true`, which the page's second press sends; Update and Clear are armed the same way.
- **Files and pastes.** A file reaches the hardware link as its name and its base64 bytes (the page's own `<input type="file">`), and a paste as the clipboard's `text/html` and `text/plain`.
- **The fixture double behaves like the hardware link,** except that:
  - it reads no `.docx`;
  - its HTML paste reader keeps Word's tracked deletions, footnotes and comments.

  Its clock is held to the same motion cases, and its page list to `shell_settings.rs`.

## The workstation catch-up (for the next workstation session)

- **Captures.** For every board a cloud slice moved or added:
  1. `npm run build --workspace frontend/app && npm run frontend:storybook:build`;
  2. `cd frontend/app && npx playwright test --update-snapshots=changed`;
  3. inspect every changed PNG before `git add`;
  4. re-seed the UI contract's ratchets with Windows' contrast sampling (`node scripts/ui-census.mjs --write-ratchets` from `frontend/app`);
  5. land it all as `Pages (baselines): …`.
- **Tags.** Push the archive tags the cloud's merges left, as listed in the ledger.
- Then carry on with the workstation's slices.

## Standing rules (from the operator's session prompts)

- **Scripts.** Never import, require, run or `node -e import()` a packaging, signing, release or lane script. On 2026-09-25 an agent loaded `scripts/native-package.mjs` on the workstation, and it began deleting the live app's folder. Every agent brief says so, and every script keeps its main-module guard.
- **Product.**
  - D22: Windows at 2560×1440, fullscreen, and nothing else. Nothing is designed, fixed or tested for another size or system.
  - D6: Studio Control binds no key (`scripts/check-no-shortcuts.mjs`; `no-shortcuts.spec.ts` gains each new page).
  - Words on screen: never "engine", "backend", "transport", "IPC" or "snapshot" (the Console keeps its desk word "snapshot").
  - The front end shows only what the hardware link reports.
  - Talkback gets no new work, and a talkback test that flakes is re-run, not fixed.
  - Nothing sends to a camera, a Bluetooth device or the Prompter XL but the live app, and then only under the safe path's six rules (the ledger's Hardware safety, D15). The cloud never does.
- **Process** (the ledger's Tracking has the rest):
  - One pull request per slice, from `main`, and CI runs once per commit, on the push.
  - The pull request is opened at the push, and the operator's go-ahead is asked there.
  - Merges happen only with that go-ahead: squash with `--match-head-commit`. The archive tag is listed in the ledger for the workstation to push.
  - Runs are recorded in the next pushed commit, and nothing is pushed only to record runs.
  - Never `npm audit fix`; never `--include-release`.
- **Review.** Every slice gets an adversarial review right after its push, and its fixes go in before the merge. Keep it lean: two or three reviewers scoped to what CI does not cover, and a skeptic for each medium or high finding. A seven-reviewer run once hit the usage limit and returned nothing.
- **CodeQL.** Fix alerts; never dismiss them. Alerts come as review conversations and also as annotations on the `CodeQL` check (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`). Read both: in Slice 3 the annotations went unnoticed through three pushes.
- **Agents.** Use as many as the work needs, keep concurrency moderate, and never let two agents build `dist` or run Playwright at once. Workflows are allowed.
