# New pages program — the next session (the cloud: the front end and the visuals)

Written on 2026-09-26, after Slice SW landed. Rewritten on 2026-09-27 on the studio workstation, as Slice 4 landed, for the cloud sessions that now carry the program's front end and visuals end to end (the operator's decision D23). Brought up to date the same day by the first cloud session, which re-cut Part C (the ledger's Part C **Rescope:**) and built Slice 5a.

The ledger, [`new-pages-2026-09.md`](./new-pages-2026-09.md), stays the execution record. This page covers:

- where to start and what the cloud is to do;
- what a cloud session can and cannot do;
- the contract the front end now builds on;
- the program's standing rules, which until now lived only in the operator's session prompts.

## Start here

1. `git log --oneline -5`: `main` holds Slice 6a (#227) or later; the ledger's `Status:` says which slice is open.
2. Read `AGENTS.md` (`CLAUDE.md` points there).
3. In the ledger, read:
   - the `Status:` and `Tracking:` paragraphs;
   - the Decisions table (D1–D23; D23 is this arrangement);
   - `Hardware safety`;
   - `Mechanical drift guards`;
   - Part C: its **Rescope:** (the cloud's slices and the workstation's), the workstation catch-up list, its common rules, Slice 4's record (the contract you build on) and the slices after it.
4. Read the visual system: `docs/redesign/system-a-2026-09.md` (its §10 is measured on every board by `frontend/app/tests/ui-contract.spec.ts`) and `docs/DEVELOPMENT.md` §2c (the UI contract, the front-end map, fixtures, the traps that cost time).
5. Read the design sources:
   - `docs/redesign/teleprompter-2026-09.md` (D20, with §14 answered);
   - `docs/redesign/new-pages-boards-2026-09.md` (the ten board decisions);
   - `docs/redesign/assets/concepts/A-teleprompter-1.html` (the Teleprompter, "Live mirror", D19);
   - `docs/redesign/assets/concepts/A-cameras-2.html` (the Cameras, "Hero and two", D19).

   The boards are self-contained HTML at 2560×1440 in Studio, Graphite and Bone. They load Inter and JetBrains Mono from Google Fonts; if the session cannot reach them, serve the copies in `node_modules/@fontsource-variable/{inter,jetbrains-mono}` (the last cloud session did).

## Where things stand

- **Landed on `main`:** S1 (#211), S2 (#213), SF (#214), S2b (#215), S3 (#216), SW (#221), C0 (#224), S4 (#225: the Teleprompter's scripts and the prompter in the hardware link), S5a (#226: the glass, and the Prompter XL's state in the hardware link; the first cloud slice), S6a (#227: the Teleprompter page without its editor) and S6b (#228: its editor, Rename, New script and Paste). Each slice's record is in the ledger, and each merge's commits are kept under a tag `archive/new-pages-<slice>-2026-09` (pushed from the workstation).
- **The cloud's mandate (D23, 2026-09-27):** the program's front end and visuals, end to end. That means:
  - both pages, the glass, every board, the header's tabs and lamps, Setup's steps and the deck pages' drawings;
  - the hardware-link and contract work they stand on, where it compiles on Linux.

  A slice that moves boards merges from the cloud once its ten checks are green, you have reviewed your own renders at 2560×1440, and the operator has given the go-ahead. The win32 captures of every board you moved are refreshed later, in one workstation catch-up.

- **In review:** Slice 8, the cameras' model and the simulated cameras, built and pushed on 2026-09-27; its pull request waits on the review, its ten checks and the operator's go-ahead (the ledger's Slice 8 has its first steps, answered on 2026-09-27: one slice; each camera's vMix input set in Setup, 1–3 by default; a camera raises the whole status to attention at most; the simulated cameras report what board 2 assumes).
- **Next:** Slice 9, the Cameras page.
- **Waiting on the operator's word:** the Dependabot pull requests #193, #217, #218, #219 and #220 (one go-ahead each); a low Dependabot alert (#7) on `main`; and D18's two checks, which gate Slice 13.
- **On the workstation:** the live app stays `main`'s build of `98bbb06` (schema 7) until the program's close-out. The live data then goes from schema 7 to 9, or to 10 once Slice 8 lands, in one start. The Appendix B walk happens there, on the program's last build.

## Part C, re-cut for the cloud (2026-09-27)

The first cloud session put the re-cut to the operator with options and costs; the answer is Part C's **Rescope:** in the ledger. In short:

- **The cloud, in order:** S5a (the glass and the Prompter XL's state in the hardware link) → S6a (the Teleprompter page) → S6b (its editor, Rename, New script and Paste) → S8 (the cameras' model and the simulated cameras) → S9 (the Cameras page) → S7 with S12 (the two deck pages, one slice). The slice numbers stay.
- **The workstation, once those have landed (serial):** the catch-up, then S5b (the Prompter XL's window), S10, S11, S13 (gated on D18) and the close-out.
- **The shell:** a cloud slice may change `native/tauri-shell`, `cfg(windows)` code included, only when it type-checks and lints for Windows in that session (below). What it does on Windows at run time goes on the catch-up list.
- **New UI-contract boards** are seeded with `node scripts/ui-census.mjs --fixtures <its fixtures> --write-ratchets` (from `frontend/app`), so the boards seeded on Windows keep their figures.

Each cloud slice's own first steps are in its section of the ledger and are put to the operator before its code.

## What a cloud session can and cannot do

- **Runs here:** `npm ci`, then:
  - `npm run lint`, `npm run frontend:typecheck`, `npm run frontend:test` (with its coverage floors), `npm run scripts:test`, `npm run format:check` and `npm run protocol:check`;
  - `node scripts/check-operator-copy.mjs`, which holds at 0;
  - the Playwright behaviour specs and the UI contract, after `npm run build --workspace frontend/app && npm run frontend:storybook:build` (the browser: see "Playwright's browser" below; never download one here). Off Windows, Playwright compares no screenshot (`ignoreSnapshots`) and the UI contract samples no contrast; every other §10 measure runs.
- **Rust:** `cargo test -p studio-control-engine` and `cargo clippy -p studio-control-engine --all-targets -- -D warnings` need only the toolchain `native/rust-toolchain.toml` pins and a C compiler for the bundled SQLite. The shell crate (`native/tauri-shell`) also needs the Linux packages in `.github/actions/setup-tauri-linux/action.yml`; `apt-get install` of that list worked in the session of 2026-09-27, and `npm run rust:clippy` and `npm run native:test` (so `dev:check`) then run whole. Delete the `native/tauri-shell/gen/schemas/linux-schema.json` a Linux build leaves: it is not committed.
- **The shell for Windows:** `rustup target add x86_64-pc-windows-msvc`, then from `native/`: `cargo check -p sse-exed-tauri-shell --target x86_64-pc-windows-msvc` and `cargo clippy -p sse-exed-tauri-shell --target x86_64-pc-windows-msvc --all-targets -- -D warnings`. Run `rustup target add` from `native/` too, so it adds the target to the toolchain `native/rust-toolchain.toml` pins. A type-check and lint of the `cfg(windows)` code, nothing linked or run (proven on 2026-09-27; the build script's "GNU compiler is not supported" warning is harmless). Part C's **Rescope:** makes it the condition of any cloud change to the shell.
- **Playwright's browser:** the pinned Playwright wants a newer Chromium than the container's `/opt/pw-browsers` holds, and the container must not download one. Make a scratch folder with `chromium_headless_shell-<its build>/chrome-headless-shell-linux64/chrome-headless-shell`, a link to `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`, and `chromium-<its build>/chrome-linux64/chrome`, a link to `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (the build number is in the first launch error; the folders the container holds may differ), point `PLAYWRIGHT_BROWSERS_PATH` at it, and run through the npm scripts (`npm run playwright:test --workspace frontend/app -- --project=default`), never the runner script by hand: from outside npm it finds another Playwright on the path. A run on another Chromium build is a check, not proof: CI's `frontend-e2e` stays the authority.
- **Vitest** runs from the workspace's own folder (`npm run test --workspace …`, or `npx vitest run` in `frontend/app`): from the repository root, `--root frontend/app` refuses the glass's font asset import (`…woff2?url`).
- **Your own visual review replaces the win32 captures until the catch-up.** Render each board you make or move at 2560×1440 in Studio, Graphite and Bone with a Playwright script of your own, in the scratch directory and never committed. Look at the renders, compare them with the boards, and say in the pull request what you checked.
  - The app runs without the hardware link at `/?fixture=<id>&transport=fixture&theme=graphite|bone`.
  - The fixtures are in `frontend/packages/test-fixtures/src/fixtures.json`. The prompter's double starts with the Prompter XL connected in every scenario; a scenario's `prompterScreen` (a `prompter.screen.report`'s params, or `"unreported"`) says otherwise. Since Slice 6a a scenario's `prompter` seeds the scripts (by name, from `test-fixtures/src/prompterScripts.ts`), the one on the glass and its place, `NOT UPDATED` and the look, through the double's own requests (`prompterSeed.ts`); the `teleprompter-*` fixtures are the examples.
- **Not possible here:**
  - the live app and the studio hardware;
  - Windows-only code at run time: the cloud type-checks and lints the shell for Windows (above) but links and runs nothing, so NDI, Bluetooth, the LUMIX SDK and the Prompter XL's window (Slice 5b) stay on the workstation;
  - packaging and signing;
  - the qualification lanes, which run in CI only;
  - the win32 captures: do not delete, refresh or commit any `*-win32.png`;
  - pushing a tag or deleting a branch, since a cloud session can push only its own branch. List the archive tags a merge needs in the ledger, and the next workstation session pushes them.

## The contract the front end builds on (Slices 4, 5a and 8)

`native/protocol/v1.md` › Teleprompter and › Cameras have all of it. The points a page or the glass must hold:

- **The clock runs in the hardware link.** Only the front end has the fonts, so the view that draws the glass reports its layout (`prompter.layout.report`). The first report for a key wins, and a report for an older key is ignored.
- **The anchor.** A view draws the motion from the anchor in `prompter.changed` and in the snapshots: `position(t) = min(position + pxPerReadWord · words(ageMs + t), endPosition)`, computed by `motion.ts`. A view with another layout places the text from `place.paragraph` and `wordOffset` (a share of the line's words).
- **The place is words, never pixels.** The prompter is paused after every start and restore, stops by itself only at `END`, and says so with `reason: "at-end"`.
- **Read what is locked from the prompter's state:** `glass`, `atEnd`, `laidOut`, `notUpdated`, and (Slice 5a) `screen.draws`: `PLAY` is refused as `PROMPTER_NOT_ON_GLASS` while nothing is drawn on the Prompter XL. Refused requests throw an `EngineRequestError` with the code and the sentence, on both transports.
- **The Prompter XL's state (Slice 5a)** is in `prompter.snapshot`'s `screen` and in `health.snapshot`'s `checks.prompter`, which is the worse of the screen's state and `NOT UPDATED` and drives the header's lamp; `app.changed { reason: "health" }` says when it changed. Only a state the shell has reported raises the whole status, and then to attention at most; `NOT UPDATED` lights the lamp only. Show the words and sentences as the hardware link gives them.
- **The glass (Slice 5a)** is one component, `frontend/app/src/app/teleprompter/glass/PrompterGlass`, for the Prompter XL's window (Slice 5b) and the page's copy (Slice 6a). Its `onLayout` gives what `prompter.layout.report` carries: for each layout key once the fonts are ready, and again, at most once a second, when an anchor for that key has no position (the hardware link restarted, or a report was lost). It sends only a layout the hardware link would take. It measures again only when the key, the text or the look's geometry changes. It is a picture (`data-picture`): Slice 6a makes the UI contract's census skip `[data-picture]`, since the glass's type is the presenter's (the proposal §6.1), and wires `onLayout` to `prompter.layout.report`.
- **Arming stays on the page.** Replacing what the prompter shows needs `replace: true`, which the page's second press sends; Update and Clear are armed the same way.
- **Files and pastes.** A file reaches the hardware link as its name and its base64 bytes (the page's own `<input type="file">`), and a paste as the clipboard's `text/html` and `text/plain`.
- **The fixture double behaves like the hardware link,** except that:
  - it reads no `.docx`;
  - its HTML paste reader keeps Word's tracked deletions, footnotes and comments.

  Its clock is held to the same motion cases, and its page list to `shell_settings.rs`.

- **The cameras (Slice 8)** are in `cameras.snapshot` (the selection and each camera: its setup, state, what it reports and why not, the autos, recording) and in `health.snapshot`'s `checks.cameras`, which drives the Cameras lamp; `cameras.changed { reason, camera }` says what moved, and `app.changed { reason: "health" }` follows when the check changed. A camera changes only on a press: one press for the exposure, colour and focus values and starting CAM 1's recording, `confirm: true` (the page's second press) for the format, the look, Release and stopping the recording. The store does not read the cameras yet (`cameras.changed` maps to nothing): Slice 9 adds the read. The fixture double's cameras are the hardware link's, held to its sentences by `camerasWords.test.ts`; a scenario seeds them with `cameras` (`FixtureCamerasSeed`, `camerasSeed.ts`; `simulated: false` for the "no link yet" state), and with no seed every camera is NOT SET UP. Tests reach the simulated cameras through `simulatedCameras(transport)`; Playwright has no hook to them yet (Slice 9 needs one to make a camera stop answering while the page is open).

## The workstation catch-up (for the next workstation session)

- **The list** of what the cloud's slices left for it — boards, tags, Windows checks at run time — is kept in the ledger under Part C, "The workstation catch-up".
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
