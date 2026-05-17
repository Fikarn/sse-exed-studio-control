# Repository Professionalization Progress

Status values: `todo`, `in_progress`, `verified`, `blocked:<exact reason>`.

## Current Remediation Pass

- Date: 2026-05-17
- Branch: `codex/repo-professionalization-followup`
- Plan: follow-up from the complete repo audit; original remediation plan remains at `docs/superpowers/plans/2026-05-16-repo-professionalization-remediation.md`
- Tracking issue: https://github.com/Fikarn/sse-exed-studio-control/issues/77 (`closed`)
- Audit source: local repo plus live GitHub repository `Fikarn/sse-exed-studio-control`
- Baseline tracked status before remediation edits: clean on `main...origin/main`

## Current GitHub State

- Repository visibility is public: `private=false`, `visibility=public`.
- Merge policy is squash-only: `allow_squash_merge=true`, merge commits and rebase merges disabled.
- Branch cleanup and update branch are enabled: `delete_branch_on_merge=true`, `allow_update_branch=true`.
- Auto-merge is enabled: `allow_auto_merge=true`.
- `main` branch protection requires stale-review dismissal, code-owner review, last-push approval, one approving review, linear history, conversation resolution, and strict required status checks.
- Required status checks are `format-protocol`, `lint`, `frontend-typecheck`, and `rust`.
- Code scanning and secret scanning alerts are enabled and currently return `0` open alerts.

## Task Tracker

| Task                        | Status   | Evidence / Notes                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0 Current tracker          | verified | Plan created at `docs/superpowers/plans/2026-05-16-repo-professionalization-remediation.md`; tracker reset to current live state.                                                                                                                                                                                                                                             |
| R1 Tauri security PR        | verified | PR #78 merged as `01b0d42291eee03dc289f566913efa1555375f66`; open PR list is empty; Dependabot alert #2 (`tauri`, GHSA-7gmj-67g7-phm9) now reports `fixed`.                                                                                                                                                                                                                   |
| R2 Linux-only `glib` alert  | verified | Windows and macOS target cargo trees print no `glib` dependency path; `--target all` traces it only through unsupported Linux Tauri GTK/WebKit dependencies. Dependabot alert #1 dismissed as `not_used`.                                                                                                                                                                     |
| R3 GitHub settings blockers | verified | Former private-repo blockers are resolved. Supported settings remain enabled, repository visibility is public, branch protection is active on `main`, strict required status checks are enforced for `format-protocol`, `lint`, `frontend-typecheck`, and `rust`, code/secret scanning alert endpoints return `0`, and `allow_auto_merge=true`.                               |
| R4 Branch hygiene           | verified | Deleted 25 merged local branches, deleted 12 stale remote branches, pruned the already-removed Dependabot branch, and deleted three local squash-merged PR heads. Local branches are now only `main` and `codex/repo-professionalization-remediation`; remote branches are now only `origin/main`.                                                                            |
| R5 Current screenshots      | verified | `npm run tauri:visual:review -- --fixtures=planning-populated,lighting-populated,audio-populated,setup-ready --sizes=2560x1440 --out=artifacts/visual/repo-professionalization-screenshots` passed with 4 screenshots and 0 failures. The checked-in release screenshots were refreshed from that run, and README now describes them as current Tauri visual-review captures. |
| R6 Historical-doc banners   | verified | Added concise design/reference banners to active-looking `docs/redesign/*.md` files that lacked one.                                                                                                                                                                                                                                                                          |
| R7 Code-quality ratchet     | verified | Future ratchet items recorded below and in issue #77: tighten permissive ESLint rules incrementally, split large frontend files through scoped feature work, keep routine npm drift on Dependabot, and keep no-new-large-file discipline.                                                                                                                                     |
| R8 Final verification       | verified | `npm run format:check`, `npm run dev:check`, and `npm run release:check` exit `0`; GitHub issue #77 is updated with final remediation state.                                                                                                                                                                                                                                  |
| R9 Release-host setup       | verified | Homebrew `node@24` is installed and linked as the default `node`; Homebrew Rust/cargo linkage is repaired; `scripts/dev-doctor.mjs` auto-detects local `.tools/qt-ifw` tools; `npm run doctor` reports Node 24, cargo/rustc, and QtIFW as passing.                                                                                                                            |
| R10 GitHub merge policy     | verified | Repository merge settings now allow squash merges only: `allow_squash_merge=true`, `allow_merge_commit=false`, `allow_rebase_merge=false`; `allow_update_branch=true` and `delete_branch_on_merge=true` remain enabled.                                                                                                                                                       |
| R11 GitHub plan blockers    | verified | The repository is now public, so the previous plan blockers no longer apply. Branch protection, required PR checks, code scanning, secret scanning, and auto-merge are enabled or verified through live GitHub API responses.                                                                                                                                                 |
| R12 Public-readiness scan   | verified | Local secret-pattern scan over tracked source/docs/config paths returned no matches for common GitHub tokens, OpenAI-style keys, AWS access keys, private-key headers, or obvious inline secret assignments.                                                                                                                                                                  |
| R13 Rust 1.95 clippy drift  | verified | Homebrew Rust upgrade surfaced new strict clippy findings; fixed descending total sorts with `std::cmp::Reverse` keys and removed redundant `.into_iter()` calls from chained default settings iterators.                                                                                                                                                                     |

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
- Historical GitHub settings recheck from the private-repo state - passed/blocked as expected at the time. Superseded on 2026-05-17 by the public-repo status, active branch protection, required status checks, and enabled scanning recorded above.
- Branch cleanup - passed. Local branch list now contains only `main` and `codex/repo-professionalization-remediation`; remote branch list now contains only `origin/main`.
- `npm run tauri:visual:review -- --fixtures=planning-populated,lighting-populated,audio-populated,setup-ready --sizes=2560x1440 --out=artifacts/visual/repo-professionalization-screenshots` - passed with 4 screenshots and 0 failures.
- Release screenshot refresh - passed. Copied current Tauri visual-review captures into `docs/release-assets/`.
- Historical-doc banners - passed. Added design/reference status banners to `docs/redesign/*.md` files that lacked current-truth guidance.
- `npm run format:check` - passed. All matched files use Prettier style.
- `npm run dev:check` - passed. Format, lint, Rust formatting, strict clippy, protocol check, frontend typecheck, native check, and native tests all exit `0`; native tests report 10 Tauri-shell tests and 164 engine tests passing.
- `npm run release:check` - passed. Release metadata validates for `v2.2.1`.
- `npm run doctor` - passed with 3 warnings. Warnings are Node v25.6.1 versus Node 24 target baseline, QtIFW missing for installer/update-repository release gates, and the expected dirty remediation branch.
- GitHub issue #77 update - passed. Issue body now reflects completed remediation, verification, remaining external/account blockers, and future ratchets.
- Historical GitHub blocker recheck from the private-repo state - blocked as expected at the time. Superseded on 2026-05-17 by `allow_auto_merge=true`, active branch protection, required status checks, and code/secret scanning alert endpoints returning `0`.
- GitHub merge-policy hardening - passed. Repository now allows squash merges only and keeps branch deletion plus update-branch enabled.
- Homebrew Node 24 install/link - passed. Installed `node@24` and linked it as the global Homebrew `node`; `node --version` prints `v24.15.0` and `npm --version` prints `11.12.1`.
- Homebrew cargo repair - passed. Reinstalled `libgit2`, which upgraded Homebrew Rust to 1.95.0 and restored `cargo --version`.
- QtIFW doctor detection - passed. `npm run doctor` now finds `.tools/qt-ifw/Tools/QtInstallerFramework/4.7/bin/binarycreator` and `repogen` without env vars.
- Public-readiness secret scan - passed. No matches found in tracked source/docs/config paths outside generated/build output.
- Rust 1.95 clippy drift fix - passed locally after code update. New findings were `clippy::unnecessary_sort_by` in planning time-report sorting and `clippy::useless_conversion` in storage bootstrap iterator chaining.
- GitHub current-state audit on 2026-05-17 - passed. Open PR list and open issue list are empty; repository is public; branch protection exists on `main`; code-scanning and secret-scanning alert endpoints both return `0`.
- Required status-check enforcement - passed. `main` now requires strict `format-protocol`, `lint`, `frontend-typecheck`, and `rust` checks while preserving required review, code-owner review, last-push approval, linear history, conversation resolution, and force-push/deletion protections.
- Local cleanup - passed. `npm run clean:local` removed ignored build/evidence outputs and restored local free space from 116 MiB to 168 GiB.
- `npm run release:verify` - passed after rerunning outside the sandbox for localhost bridge binding. The run validated release metadata, formatting, native check/test, macOS package smoke, clean-start smoke, packaged acceptance, live bridge qualification, QtIFW installer generation from `.tools/qt-ifw`, update-repository generation, checksums, artifact verification, continuity, delivery acceptance, and installer install/purge/reinstall acceptance.

## Future Ratchet Items

- Tighten the intentionally permissive ESLint baseline incrementally. Start by turning `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-explicit-any`, and React static/memo warnings into errors only after focused cleanup PRs.
- Split large frontend files through normal feature work rather than broad churn. Current largest files to watch are `frontend/app/src/app/audio/AudioWorkspace.module.css`, `frontend/app/src/app/lighting/LightingWorkspace.tsx`, and `frontend/app/src/app/planning/PlanningWorkspace.tsx`.
- Keep routine npm updates on Dependabot cadence; `npm audit --json` currently reports zero npm vulnerabilities.
- Keep branch cleanup recurring. `delete_branch_on_merge=true` is now enabled, but squash-merged bot and historical branches can still require periodic pruning.
- Keep release-version metadata single-sourced. `npm run release:check` now validates the root package version against the selected frontend app, Tauri config, Tauri shell crate, and Rust engine crate.

## Remaining External Blockers

None open as of 2026-05-17. Future repository-professionalization work should be opened as focused execution issues instead of being tracked as account/visibility blockers.
