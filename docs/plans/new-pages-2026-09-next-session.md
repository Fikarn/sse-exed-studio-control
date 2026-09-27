# New pages program — the next session (the studio workstation)

Written on 2026-09-26, after Slice SW landed. Rewritten on 2026-09-27 for the cloud sessions that carried the program's front end and visuals (the operator's decision D23), and brought up to date by them through Slice 8. Rewritten again on 2026-09-28 on the studio workstation: since the operator's handoff of 2026-09-27, evening, the workstation session carries the rest of the program (Part C's second **Rescope:**, D23 amended). The cloud's own instructions (Linux Playwright, the Windows type-check from Linux, what a cloud session could not do) are in this page's history at `4c2d4bb`.

The ledger, [`new-pages-2026-09.md`](./new-pages-2026-09.md), stays the execution record. This page covers:

- where to start and what comes next;
- the workstation's rules for the slices that are left;
- the contract the front end builds on;
- the program's standing rules, which until now lived only in the operator's session prompts.

## Start here

1. `git status && git log --oneline -10`: `main` holds Slice 8 (#229) or later; the ledger's `Status:` says which slice is open.
2. Read `AGENTS.md` (`CLAUDE.md` points there).
3. In the ledger, read:
   - the `Status:` and `Tracking:` paragraphs;
   - the Decisions table (D1–D23);
   - `Hardware safety` and `Mechanical drift guards`;
   - Part C: both of its **Rescope:** paragraphs, "The workstation catch-up", its common rules, and the slices that are not `verified`.
4. Check the live app (the ledger's Session protocol): its shell and engine running from `release\native\windows`, the engine on 127.0.0.1:38201, TotalMix FX and Companion running. Never end them.
5. For a slice that draws: the visual system, `docs/redesign/system-a-2026-09.md` (its §10 is measured on every board by `frontend/app/tests/ui-contract.spec.ts`), `docs/DEVELOPMENT.md` §2c, and the design sources — `docs/redesign/new-pages-boards-2026-09.md` (the ten board decisions), `docs/redesign/assets/concepts/A-cameras-2.html` (the Cameras, "Hero and two", D19), `A-teleprompter-1.html` (the Teleprompter, "Live mirror") and `docs/redesign/teleprompter-2026-09.md` (D20).

## Where things stand

- **Landed on `main`:** S1 (#211), S2 (#213), SF (#214), S2b (#215), S3 (#216), SW (#221), C0 (#224), S4 (#225), and the cloud's S5a (#226), S6a (#227), S6b (#228) and S8 (#229, the cameras' model and the simulated cameras, merged from the workstation on 2026-09-27). Each slice's record is in the ledger, and each merge's commits are kept under a tag `archive/new-pages-<slice>-2026-09`; the tags of S5a, S6a, S6b and S8 were pushed from the workstation on 2026-09-27.
- **The order that is left** (approved by the operator on 2026-09-28, serial): **the workstation catch-up → S9 → S7+S12 → S5b → S10 → S11 → S13** (gated on D18) **→ the close-out**.
  - The catch-up (in progress on 2026-09-28): the cloud slices' win32 captures and new captures, every UI-contract board re-seeded with Windows' contrast, the doc counts, and the operator's Windows checks at run time on a check copy (below).
  - S9, the Cameras page: its first steps were answered on 2026-09-28 (the ledger's Slice 9): one slice; the `REC` chip amber, "not read while released", whenever CAM 1 is released; a camera-only read of Recent actions; `cameras.setup.update` refusing an address with `CAMERA_NO_LINK` without a network link (answered during Slice 8's review); and the settled items listed there.
- **Waiting on the operator's word:** the Dependabot pull requests #193, #217, #218, #219 and #220 (one go-ahead each), and #223 (qs 6.15.2 → 6.16.0, opened 2026-09-26, not on the handoff's list of 2026-09-27); the Dependabot alerts on `main`, #7 (esbuild, low) and #1 (glib, medium, `native/Cargo.lock`, open since 2026-05-16, not on that list either); and D18's two checks, which gate Slice 13.
- **The live app** stays `main`'s build of `98bbb06` (schema 7) until the program's close-out. The live data then goes from schema 7 to 10 in one start. The Appendix B walk happens on the program's last build.

## The workstation's rules for the slices that are left

- **Boards are finished in-slice.** A slice that moves or adds a board refreshes and inspects its win32 captures and measures its UI-contract boards with Windows' contrast before its push (the ledger's Baseline refresh procedure), and the local Playwright lane runs before every push that moves a board.
- **Captures, step by step:**
  1. `npm run build --workspace frontend/app && npm run frontend:storybook:build`;
  2. `cd frontend/app && npx playwright test --update-snapshots=changed` (the local lane runs eight workers; after a run on Windows, end any `vite preview` left on port 4173 before a timing-sensitive run);
  3. inspect every changed PNG before `git add`;
  4. re-seed the UI contract's ratchets (`node scripts/ui-census.mjs --write-ratchets` from `frontend/app`, or `--fixtures <ids>` for new boards only): a measure may fall, never rise;
  5. land them as `Pages S<N> (baselines): …`.
- **A check copy for the operator's checks at run time.** The shell registers `tauri-plugin-single-instance`, whose Windows mutex is named after the app's identifier (`com.sse.exedstudiocontrol`): a second copy with the same identifier hands its start to the live app, which comes forward, and exits. A copy the operator tries by hand is therefore built with an identifier of its own (a build-time override, never committed) and started from its own folder with a scratch `SSE_APP_DATA_DIR`, a bridge port of its own (`SSE_CONTROL_SURFACE_PORT`, never 38201), `SSE_SAFE_START=1`, `SSE_AUDIO_SIMULATED_INPUT_MODE=1` and `SSE_CAMERAS_SIMULATED=1`. It runs beside the live app and touches nothing of it (its WebView2 data sits under its own identifier); it opens fullscreen over the live app's window until it is closed. The catch-up's record in the ledger has the recipe as it was run.
- **Windows-only code** (the Prompter XL's window, NDI, Bluetooth, the LUMIX SDK) is built and tested here (`dev:check`) before its push: CI's ten jobs run on Linux and never compile it.

## The contract the front end builds on (Slices 4, 5a and 8)

`native/protocol/v1.md` › Teleprompter and › Cameras have all of it. The points a page or the glass must hold:

- **The prompter's clock runs in the hardware link.** Only the front end has the fonts, so the view that draws the glass reports its layout (`prompter.layout.report`). The first report for a key wins, and a report for an older key is ignored.
- **The anchor.** A view draws the motion from the anchor in `prompter.changed` and in the prompter's state: `position(t) = min(position + pxPerReadWord · words(ageMs + t), endPosition)`, computed by `motion.ts`. A view with another layout places the text from `place.paragraph` and `wordOffset` (a share of the line's words).
- **The place is words, never pixels.** The prompter is paused after every start and restore, stops by itself only at `END`, and says so with `reason: "at-end"`.
- **Read what is locked from the prompter's state:** `glass`, `atEnd`, `laidOut`, `notUpdated`, and `screen.draws`: `PLAY` is refused as `PROMPTER_NOT_ON_GLASS` while nothing is drawn on the Prompter XL. Refused requests throw an `EngineRequestError` with the code and the sentence, on both transports.
- **The Prompter XL's state** is in the prompter's `screen` and in `health.snapshot`'s `checks.prompter`, which is the worse of the screen's state and `NOT UPDATED` and drives the header's lamp; `app.changed { reason: "health" }` says when it changed. Show the words and sentences as the hardware link gives them.
- **The glass** is one component, `frontend/app/src/app/teleprompter/glass/PrompterGlass`, for the Prompter XL's window (Slice 5b) and the page's copy. It is a picture (`data-picture`), which the UI contract's census skips.
- **The cameras (Slice 8).** Three fixed cameras (CAM 1, the Pocket 6K Pro, over Bluetooth; CAM 2 and CAM 3, the BGH1s, over the network); fourteen `cameras.*` methods, `cameras.changed`, `checks.cameras` (the worst camera's state, and whether CAM 1 records) and twelve refusal codes. Every `cameras.*` request reads the held cameras again first; a released camera shows no value; an unreachable one keeps its last report with `readAt`. Nothing is sent to a camera but by a press (D12). The simulated cameras (`SSE_CAMERAS_SIMULATED=1`) are the only cameras any test, lane or scratch run uses; without them a set-up camera reads `UNREACHABLE` until the real links of Slices 11 and 13.
- **Arming stays on the page.** Replacing what the prompter shows needs `replace: true`, which the page's second press sends; Update and Clear are armed the same way; the cameras' armed changes and Release send `confirm: true` on the second press.
- **Files and pastes.** A file reaches the hardware link as its name and its base64 bytes (the page's own `<input type="file">`), and a paste as the clipboard's `text/html` and `text/plain`.
- **The fixture double behaves like the hardware link,** except that it reads no `.docx`, its HTML paste reader keeps Word's tracked deletions, footnotes and comments, and its `health.snapshot` does not read the cameras again. Its clock is held to the same motion cases, its page list to `shell_settings.rs`, and its cameras' sentences to the Rust literals. A scenario in `frontend/packages/test-fixtures/src/fixtures.json` seeds the prompter (`prompter`, `prompterScreen`) and the cameras (`cameras`; with no seed every camera is NOT SET UP).

## Standing rules (from the operator's session prompts)

- **Scripts.** Never import, require, run or `node -e import()` a packaging, signing, release or lane script. On 2026-09-25 an agent loaded `scripts/native-package.mjs` on the workstation, and it began deleting the live app's folder. Every agent brief says so, and every script keeps its main-module guard. The live app (`release\native\windows`, 127.0.0.1:38201) stays untouched until the close-out.
- **Product.**
  - D22: Windows at 2560×1440, fullscreen, and nothing else. Nothing is designed, fixed or tested for another size or system.
  - D6: Studio Control binds no key (`scripts/check-no-shortcuts.mjs`; `no-shortcuts.spec.ts` gains each new page).
  - Words on screen: never "engine", "backend", "transport", "IPC" or "snapshot" (the Console keeps its desk word "snapshot").
  - The front end shows only what the hardware link reports.
  - Talkback gets no new work, and a talkback test that flakes is re-run, not fixed.
  - Nothing sends to a camera, a Bluetooth device or the Prompter XL but the live app, and then only under the safe path's six rules (the ledger's Hardware safety, D15). Every test, lane and scratch run uses the simulated cameras.
- **Process** (the ledger's Tracking has the rest):
  - One pull request per slice, from `main`, and CI runs once per commit, on the push.
  - The pull request is opened at the push, and the operator's go-ahead is asked there.
  - Merges happen only with that go-ahead: squash with `--match-head-commit`; then the slice's archive tag is pushed on its head.
  - Runs are recorded in the next pushed commit, and nothing is pushed only to record runs.
  - Before every push: `npm run dev:check` (all ten steps, `scripts:test` included), and the local Playwright lane before any push that moves a board. Every changed `*-win32.png` is inspected before `git add`.
  - Never `npm audit fix`; never `--include-release`.
- **Review.** Every slice gets an adversarial review right after its push, and its fixes go in before the merge. Keep it lean: two or three reviewers scoped to what CI does not cover, and a skeptic for each medium or high finding. A seven-reviewer run once hit the usage limit and returned nothing.
- **CodeQL.** Fix alerts; never dismiss them. Alerts come as review conversations and also as annotations on the `CodeQL` check (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`). Read both: in Slice 3 the annotations went unnoticed through three pushes.
- **Agents.** Use as many as the work needs, keep concurrency moderate, and never let two agents build `dist` or run Playwright at once. Workflows are allowed.
