# Repository Professionalization Progress

Status values: `todo`, `in_progress`, `verified`, `blocked:<exact reason>`.

## Current Remediation Pass

- Date: 2026-05-16
- Branch: `codex/repo-professionalization-remediation`
- Plan: `docs/superpowers/plans/2026-05-16-repo-professionalization-remediation.md`
- Tracking issue: https://github.com/Fikarn/sse-exed-studio-control/issues/77
- Audit source: local repo plus live GitHub repository `Fikarn/sse-exed-studio-control`
- Baseline tracked status before remediation edits: clean on `main...origin/main`

## Task Tracker

| Task                        | Status                                                                                                                                   | Evidence / Notes                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0 Current tracker          | verified                                                                                                                                 | Plan created at `docs/superpowers/plans/2026-05-16-repo-professionalization-remediation.md`; tracker reset to current live state.                                                                                                                                                                                                                                                      |
| R1 Tauri security PR        | verified                                                                                                                                 | PR #78 merged as `01b0d42291eee03dc289f566913efa1555375f66`; open PR list is empty; Dependabot alert #2 (`tauri`, GHSA-7gmj-67g7-phm9) now reports `fixed`.                                                                                                                                                                                                                            |
| R2 Linux-only `glib` alert  | verified                                                                                                                                 | Windows and macOS target cargo trees print no `glib` dependency path; `--target all` traces it only through unsupported Linux Tauri GTK/WebKit dependencies. Dependabot alert #1 dismissed as `not_used`.                                                                                                                                                                              |
| R3 GitHub settings blockers | verified                                                                                                                                 | Supported settings remain enabled: `allow_update_branch=true`, `delete_branch_on_merge=true`, vulnerability alerts return `204`. Blockers remain external/account-level: branch protection requires GitHub Pro or public repo, code scanning is not enabled, secret scanning is unavailable, and `allow_auto_merge=false` remains blocked until branch protection/rules are available. |
| R4 Branch hygiene           | verified                                                                                                                                 | Deleted 25 merged local branches, deleted 12 stale remote branches, pruned the already-removed Dependabot branch, and deleted three local squash-merged PR heads. Local branches are now only `main` and `codex/repo-professionalization-remediation`; remote branches are now only `origin/main`.                                                                                     |
| R5 Current screenshots      | verified                                                                                                                                 | `npm run tauri:visual:review -- --fixtures=planning-populated,lighting-populated,audio-populated,setup-ready --sizes=2560x1440 --out=artifacts/visual/repo-professionalization-screenshots` passed with 4 screenshots and 0 failures. The checked-in release screenshots were refreshed from that run, and README now describes them as current Tauri visual-review captures.          |
| R6 Historical-doc banners   | verified                                                                                                                                 | Added concise design/reference banners to active-looking `docs/redesign/*.md` files that lacked one.                                                                                                                                                                                                                                                                                   |
| R7 Code-quality ratchet     | verified                                                                                                                                 | Future ratchet items recorded below and in issue #77: tighten permissive ESLint rules incrementally, split large frontend files through scoped feature work, keep routine npm drift on Dependabot, and keep no-new-large-file discipline.                                                                                                                                              |
| R8 Final verification       | verified                                                                                                                                 | `npm run format:check`, `npm run dev:check`, and `npm run release:check` exit `0`; GitHub issue #77 is updated with final remediation state.                                                                                                                                                                                                                                           |
| R9 Release-host setup       | verified                                                                                                                                 | Homebrew `node@24` is installed and linked as the default `node`; Homebrew Rust/cargo linkage is repaired; `scripts/dev-doctor.mjs` auto-detects local `.tools/qt-ifw` tools; `npm run doctor` reports Node 24, cargo/rustc, and QtIFW as passing.                                                                                                                                     |
| R10 GitHub merge policy     | verified                                                                                                                                 | Repository merge settings now allow squash merges only: `allow_squash_merge=true`, `allow_merge_commit=false`, `allow_rebase_merge=false`; `allow_update_branch=true` and `delete_branch_on_merge=true` remain enabled.                                                                                                                                                                |
| R11 GitHub plan blockers    | blocked:private repo requires public visibility or GitHub Pro/eligible plan for branch protection/rulesets/code scanning/secret scanning | Fresh API attempts confirm branch protection and rulesets return GitHub Pro/public-repo 403s, code scanning default setup returns 403, secret scanning returns 422 unavailable, and auto-merge PATCH remains `allow_auto_merge=false`. Repository visibility was not changed without explicit approval.                                                                                |
| R12 Public-readiness scan   | verified                                                                                                                                 | Local secret-pattern scan over tracked source/docs/config paths returned no matches for common GitHub tokens, OpenAI-style keys, AWS access keys, private-key headers, or obvious inline secret assignments.                                                                                                                                                                           |
| R13 Rust 1.95 clippy drift  | verified                                                                                                                                 | Homebrew Rust upgrade surfaced new strict clippy findings; fixed descending total sorts with `std::cmp::Reverse` keys and removed redundant `.into_iter()` calls from chained default settings iterators.                                                                                                                                                                              |

## Command Log

- `git status --short --branch` - passed before work: clean on `main...origin/main`.
- `git switch -c codex/repo-professionalization-remediation` - passed. Work moved off `main`.
- GitHub PR #78 inspection - passed. Scope was `native/Cargo.lock` and `native/tauri-shell/Cargo.toml`; advisory run `25962999614` passed all four jobs: `format-protocol`, `lint`, `frontend-typecheck`, and `rust`.
- Merge PR #78 - passed. Squash-merged as `01b0d42291eee03dc289f566913efa1555375f66`.
- `git fetch origin` - passed. Local `origin/main` advanced to `01b0d42`.
- Dependabot alerts check - passed. Alert #2 (`tauri`, GHSA-7gmj-67g7-phm9) reports `fixed`; alert #1 (`glib`, GHSA-wrw7-89jp-8q8g) remains open.
- `git merge --ff-only origin/main` - first attempt failed due sandbox permission on `.git/ORIG_HEAD.lock`; escalated rerun passed and fast-forwarded the remediation branch through PR #78.
- `cargo tree --target x86_64-pc-windows-msvc -i glib` - passed with no dependency path.
- `cargo tree --target aarch64-apple-darwin -i glib` - passed with no dependency path.
- `cargo tree --target all -i glib` - passed and traced `glib` only through Linux Tauri GTK/WebKit dependencies.
- Dismiss Dependabot alert #1 - passed. Alert dismissed as `not_used` with target-platform evidence.
- GitHub settings recheck - passed/blocked as expected. `allow_update_branch=true`, `delete_branch_on_merge=true`, vulnerability alerts return `204`; branch protection returns the GitHub Pro/public-repo blocker; code scanning returns `403` disabled.
- Branch cleanup - passed. Local branch list now contains only `main` and `codex/repo-professionalization-remediation`; remote branch list now contains only `origin/main`.
- `npm run tauri:visual:review -- --fixtures=planning-populated,lighting-populated,audio-populated,setup-ready --sizes=2560x1440 --out=artifacts/visual/repo-professionalization-screenshots` - passed with 4 screenshots and 0 failures.
- Release screenshot refresh - passed. Copied current Tauri visual-review captures into `docs/release-assets/`.
- Historical-doc banners - passed. Added design/reference status banners to `docs/redesign/*.md` files that lacked current-truth guidance.
- `npm run format:check` - passed. All matched files use Prettier style.
- `npm run dev:check` - passed. Format, lint, Rust formatting, strict clippy, protocol check, frontend typecheck, native check, and native tests all exit `0`; native tests report 10 Tauri-shell tests and 164 engine tests passing.
- `npm run release:check` - passed. Release metadata validates for `v2.2.1`.
- `npm run doctor` - passed with 3 warnings. Warnings are Node v25.6.1 versus Node 24 target baseline, QtIFW missing for installer/update-repository release gates, and the expected dirty remediation branch.
- GitHub issue #77 update - passed. Issue body now reflects completed remediation, verification, remaining external/account blockers, and future ratchets.
- GitHub blocker recheck - blocked as expected. Branch protection and rulesets return the GitHub Pro/public-repo 403; code scanning default setup returns 403; secret scanning returns 422 unavailable; auto-merge PATCH still leaves `allow_auto_merge=false`.
- GitHub merge-policy hardening - passed. Repository now allows squash merges only and keeps branch deletion plus update-branch enabled.
- Homebrew Node 24 install/link - passed. Installed `node@24` and linked it as the global Homebrew `node`; `node --version` prints `v24.15.0` and `npm --version` prints `11.12.1`.
- Homebrew cargo repair - passed. Reinstalled `libgit2`, which upgraded Homebrew Rust to 1.95.0 and restored `cargo --version`.
- QtIFW doctor detection - passed. `npm run doctor` now finds `.tools/qt-ifw/Tools/QtInstallerFramework/4.7/bin/binarycreator` and `repogen` without env vars.
- Public-readiness secret scan - passed. No matches found in tracked source/docs/config paths outside generated/build output.
- Rust 1.95 clippy drift fix - passed locally after code update. New findings were `clippy::unnecessary_sort_by` in planning time-report sorting and `clippy::useless_conversion` in storage bootstrap iterator chaining.

## Future Ratchet Items

- Tighten the intentionally permissive ESLint baseline incrementally. Start by turning `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-explicit-any`, and React static/memo warnings into errors only after focused cleanup PRs.
- Split large frontend files through normal feature work rather than broad churn. Current largest files to watch are `frontend/app/src/app/audio/AudioWorkspace.module.css`, `frontend/app/src/app/lighting/LightingWorkspace.tsx`, and `frontend/app/src/app/planning/PlanningWorkspace.tsx`.
- Keep routine npm updates on Dependabot cadence; `npm audit --json` currently reports zero npm vulnerabilities.
- Keep branch cleanup recurring. `delete_branch_on_merge=true` is now enabled, but squash-merged bot and historical branches can still require periodic pruning.

## Remaining External Blockers

- Branch protection / rulesets: GitHub returns a plan blocker for this private repo unless it becomes public or the account upgrades to GitHub Pro.
- Code scanning: GitHub returns `403` because code scanning is not enabled for this repository.
- Secret scanning: previously returned unavailable for this repository.
- Auto-merge: repository still reports `allow_auto_merge=false`; revisit after branch protection/rulesets are available.
