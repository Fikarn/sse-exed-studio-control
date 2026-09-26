# New pages program — the next session

Written 2026-09-26, after Slice SW landed, for a session away from the studio workstation (a cloud session); brought up to date the same day, after C0's answers. The ledger, [`new-pages-2026-09.md`](./new-pages-2026-09.md), stays the execution record. This page says where to start, what a session off the workstation cannot do, and the program's standing rules that were only in the operator's session prompts.

## Start here

1. `git log --oneline -5` (`main` at `f28909e` or later).
2. Read `AGENTS.md`, then the ledger's `Status:` and `Tracking:` paragraphs, the Decisions table (D1–D22), `Hardware safety`, and Part C: its common rules and the first slice that is not `verified`. The landed slices' sections are records — skip them unless a question points there.

## Where things stand

- **Landed on `main`:** S1 (#211), S2 (#213), SF (#214), S2b (#215), S3 (#216), SW (#221, `f28909e`). Each slice's record is in the ledger; each merge's commits are kept under a tag `archive/new-pages-<slice>-2026-09`.
- **C0's answers are in** (2026-09-26, in a cloud session): D18–D21 and the ten decisions the boards raised, the operator taking every recommendation — Cameras from board 2, "Hero and two", Teleprompter from board 1, "Live mirror", the Teleprompter first — and D12 amended for the page's own copy of the glass. C0's last step is done: Part C's slices, Slices 4–13, are in the ledger in place of the provisional list, approved by the operator the same day.
- **Next: Slice 4**, the Teleprompter's scripts and the prompter in the hardware link, once C0's record has merged. Slices 4 and 8 change only the hardware link and the contract and can be done off the workstation. Slices 5, 6, 7, 9, 10 and 12 add or move boards (7 and 12 through Setup's deck steps, which draw every page the deck has), and Slices 5, 10, 11 and 13 bring Windows-only code (the screens' names, NDI, Windows' Bluetooth pairing, the LUMIX SDK) that CI's Linux runners never compile: those are finished on the workstation. Slice 13, the BGH1s' link, also waits on D18's two checks, which are the operator's. Each slice's first step names what it must settle before code (the ledger, Part C).
- **Waiting on the operator's word:** the Dependabot pull requests #193, #217, #218, #219 and #220 (one go-ahead each), and a low Dependabot alert (#7) on `main`.
- **On the workstation:** the live app stays `main`'s build of `98bbb06` (schema 7) until the program's close-out; the Appendix B walk happens there, on the program's last build.

## Off the workstation

- **Not possible here:** the live app, the studio hardware (TotalMix FX, Companion, the lighting bridge, the cameras, the Prompter XL, the Stream Deck), packaging, signing and the Tauri qualification lanes.
- **Captures are the workstation's.** The committed captures are win32 at 2560×1440 (D22). Off Windows, Playwright skips every screenshot comparison (`ignoreSnapshots`) and the UI contract samples no contrast, so CI compares no capture at all. A change that moves a board is therefore finished on the studio workstation: its win32 captures refreshed and inspected there (the ledger's Baseline refresh procedure) before it merges. Say so in the pull request, and do not delete or refresh a capture from here.
- **What runs here:** `npm ci`, then `npm run lint`, `npm run frontend:typecheck`, `npm run frontend:test`, `npm run scripts:test`, `npm run format:check`, `npm run protocol:check`. The Playwright behaviour cases run after `npm run build --workspace frontend/app && npm run frontend:storybook:build` (Linux Chromium: `npx playwright install --with-deps chromium`). The Rust workspace needs the Linux packages in `.github/actions/setup-tauri-linux/action.yml`; if they cannot be installed, leave Rust to CI. CI runs the ten required checks on every push.

## Standing rules (from the operator's session prompts)

- **Scripts.** Never import, require, run or `node -e import()` a packaging, signing, release or lane script. On 2026-09-25 an agent loaded `scripts/native-package.mjs` and it began deleting the live app's folder on the workstation. Every agent brief says so, and every script keeps its main-module guard.
- **Product.** D22: Windows at 2560×1440, fullscreen, and nothing else — nothing is designed, fixed or tested for another size or system. D6: Studio Control binds no key (`scripts/check-no-shortcuts.mjs`). Words on screen: never "engine", "backend", "transport", "IPC" or "snapshot" (the Console keeps its desk word "snapshot"). Talkback gets no new work, and a talkback test that flakes is re-run, not fixed. Nothing sends to a camera, a Bluetooth device or the Prompter XL but the live app, and then only under the safe path's six rules, agreed on 2026-09-24 (the ledger's Hardware safety, D15).
- **Process** (the ledger's Tracking has the rest). One pull request per slice, from `main`. CI runs once per commit, on the push. The pull request is opened at the push, and the operator's go-ahead is asked there. Merges happen only with that go-ahead: squash with `--match-head-commit`, after pushing the archive tag. Runs are recorded in the next pushed commit, and nothing is pushed only to record runs. Never `npm audit fix`; never `--include-release`; packaging only with the operator's go-ahead, on the workstation.
- **Review.** Every slice gets an adversarial review right after its push, and its fixes go in before the merge. Keep it lean, because the operator's usage limit is tight: two or three reviewers scoped to what CI does not cover, and a skeptic for each medium or high finding. A seven-reviewer run hit the limit on 2026-09-26 and returned nothing.
- **CodeQL.** Fix alerts; never dismiss them. Alerts come as review conversations and also as annotations on the `CodeQL` check (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`). Read both: in Slice 3 the annotations went unnoticed through three pushes.
- **Agents.** Use as many as the work needs, but keep concurrency moderate; workflows are allowed.
