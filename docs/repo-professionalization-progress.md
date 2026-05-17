# Repository Professionalization Progress

Status values: `todo`, `in_progress`, `verified`, `blocked:<exact reason>`.

## Current Remediation Pass

- Date: 2026-05-17
- Branch: `codex/repo-audit-final-remediation`
- Plan: follow-up from the complete repo audit; original remediation plan remains at `docs/superpowers/plans/2026-05-16-repo-professionalization-remediation.md`
- Tracking issue: https://github.com/Fikarn/sse-exed-studio-control/issues/77 (`closed`)
- Audit source: local repo plus live GitHub repository `Fikarn/sse-exed-studio-control`
- Baseline tracked status before final audit edits: clean after branching from `main...origin/main`

## Current GitHub State

- Repository visibility is public: `private=false`, `visibility=public`.
- Merge policy is squash-only: `allow_squash_merge=true`, merge commits and rebase merges disabled.
- Branch cleanup and update branch are enabled: `delete_branch_on_merge=true`, `allow_update_branch=true`.
- Auto-merge is enabled: `allow_auto_merge=true`.
- `main` branch protection applies to administrators and requires linear history, conversation resolution, no force pushes/deletions, and strict required status checks.
- Required human review gates are intentionally not enabled for the solo-maintainer workflow: `requiresApprovingReviews=false`, `requiresCodeOwnerReviews=false`, `dismissesStaleReviews=false`, and `requireLastPushApproval=false`. Enable them only after a real reviewer path exists.
- Required status checks are `format-protocol`, `lint`, `frontend-typecheck`, and `rust`.
- Open GitHub issues, pull requests, and Dependabot alerts currently return `0`.
- Code scanning and secret scanning alerts are enabled and currently return `0` open alerts.
- Secret scanning push protection is enabled. GitHub accepted a repository PATCH for non-provider patterns and validity checks but still reports both fields as `disabled`; treat those as unavailable until the GitHub UI or API exposes a working enable path.

## Task Tracker

| Task                        | Status   | Evidence / Notes                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R0 Current tracker          | verified | Plan created at `docs/superpowers/plans/2026-05-16-repo-professionalization-remediation.md`; tracker reset to current live state.                                                                                                                                                                                                                                                                                     |
| R1 Tauri security PR        | verified | PR #78 merged as `01b0d42291eee03dc289f566913efa1555375f66`; open PR list is empty; Dependabot alert #2 (`tauri`, GHSA-7gmj-67g7-phm9) now reports `fixed`.                                                                                                                                                                                                                                                           |
| R2 Linux-only `glib` alert  | verified | Windows and macOS target cargo trees print no `glib` dependency path; `--target all` traces it only through unsupported Linux Tauri GTK/WebKit dependencies. Dependabot alert #1 was dismissed again on 2026-05-17 as `not_used`; open Dependabot alert list now returns `0`.                                                                                                                                         |
| R3 GitHub settings blockers | verified | Former private-repo blockers are resolved. Supported settings remain enabled, repository visibility is public, branch protection is active on `main`, strict required status checks are enforced for `format-protocol`, `lint`, `frontend-typecheck`, and `rust`, code/secret scanning alert endpoints return `0`, and `allow_auto_merge=true`. Human review gates remain intentionally off for solo-maintainer flow. |
| R4 Branch hygiene           | verified | Deleted 25 merged local branches, deleted 12 stale remote branches, pruned the already-removed Dependabot branch, and deleted three local squash-merged PR heads. Current local branches are `main` and `codex/repo-audit-final-remediation`; remote branches are `origin/main` only.                                                                                                                                 |
| R5 Current screenshots      | verified | `npm run tauri:visual:review -- --fixtures=planning-populated,lighting-populated,audio-populated,setup-ready --sizes=2560x1440 --out=artifacts/visual/repo-professionalization-screenshots` passed with 4 screenshots and 0 failures. The checked-in release screenshots were refreshed from that run, and README now describes them as current Tauri visual-review captures.                                         |
| R6 Historical-doc banners   | verified | Added concise design/reference banners to active-looking `docs/redesign/*.md` files that lacked one.                                                                                                                                                                                                                                                                                                                  |
| R7 Code-quality ratchet     | verified | ESLint cleanup categories now fail as errors, and `npm run file:health` prevents new non-allowlisted oversized sources or tracked artifacts. Existing large files are explicitly allowlisted with split/retention reasons instead of silently drifting.                                                                                                                                                               |
| R8 Final verification       | verified | Final audit lane passed: `npm run file:health`, `npm run format:check`, `npm run lint`, `npm run scripts:test`, `npm run release:check`, `npm run dev:check`, `npm audit --json`, live GitHub queue/protection checks, `npm run clean:local`, and `npm run doctor` with only the expected dirty-branch warning.                                                                                                       |
| R9 Release-host setup       | verified | Homebrew `node@24` is installed and linked as the default `node`; Homebrew Rust/cargo linkage is repaired; `scripts/dev-doctor.mjs` auto-detects local `.tools/qt-ifw` tools; `npm run doctor` reports Node 24, cargo/rustc, and QtIFW as passing.                                                                                                                                                                    |
| R10 GitHub merge policy     | verified | Repository merge settings now allow squash merges only: `allow_squash_merge=true`, `allow_merge_commit=false`, `allow_rebase_merge=false`; `allow_update_branch=true` and `delete_branch_on_merge=true` remain enabled.                                                                                                                                                                                               |
| R11 GitHub plan blockers    | verified | The repository is now public, so the previous plan blockers no longer apply. Branch protection, required PR checks, code scanning, secret scanning, and auto-merge are enabled or verified through live GitHub API responses.                                                                                                                                                                                         |
| R12 Public-readiness scan   | verified | Local secret-pattern scan over tracked source/docs/config paths returned no matches for common GitHub tokens, OpenAI-style keys, AWS access keys, private-key headers, or obvious inline secret assignments.                                                                                                                                                                                                          |
| R13 Rust 1.95 clippy drift  | verified | Homebrew Rust upgrade surfaced new strict clippy findings; fixed descending total sorts with `std::cmp::Reverse` keys and removed redundant `.into_iter()` calls from chained default settings iterators.                                                                                                                                                                                                             |
| R14 Dependency drift        | verified | Direct npm dependencies were refreshed to current Node 24-compatible releases. `npm outdated --json` now reports only the intentionally deferred `@types/node` 25 major upgrade.                                                                                                                                                                                                                                      |
| R15 Community health        | verified | Added `CODE_OF_CONDUCT.md`, linked it from `CONTRIBUTING.md`, and changed active-looking completed redesign frontmatter statuses to `historical-reference`.                                                                                                                                                                                                                                                           |
| R16 GitHub governance       | verified | Enabled admin enforcement for `main` branch protection. Required signed commits and required human reviews remain deferred until local commit signing and a real reviewer path exist. Secret-scanning non-provider patterns and validity checks remain blocked by GitHub readback staying `disabled` after PATCH.                                                                                                     |
| R17 Final audit remediation | verified | Addressed the seven final audit findings: live governance/doc mismatch, Dependabot alert drift, CI coverage gaps, stale public docs, permissive lint baseline, large-file guardrails, and ignored local bloat cleanup.                                                                                                                                                                                                |

## Command Log

- `git status --short --branch` - passed before work: clean on `main...origin/main`.
- `git switch -c codex/repo-audit-final-remediation` - passed. Final audit remediation moved off `main`.
- Live GitHub final-audit recheck - passed. Open issue list, open PR list, and open Dependabot alert list return `[]`; `main` branch protection is active with strict required checks and intentionally disabled human review gates.
- Documentation hygiene scan for personal local paths and stale local-file links - passed after edits. The public-doc scan now returns no matches.
- Final audit validation - passed. `npm run file:health`, `npm run format:check`, `npm run lint`, `npm run scripts:test`, `npm run release:check`, `npm audit --json`, and `npm run dev:check` all exit `0`; `dev:check` includes 10 Tauri-shell tests and 164 engine tests passing.
- GitHub alert/security queue recheck - passed. Open issues, Dependabot alerts, code-scanning alerts, and secret-scanning alerts each return `0`.
- `npm run clean:local` - passed. Removed ignored local outputs including `native/target`, `release`, `artifacts`, root `test-results`, and `aqtinstall.log`; `.tools/` and `node_modules/` remain intentionally retained.
- `npm run doctor` - passed with one expected warning for the dirty remediation branch.
- GitHub issue #77 final comment - passed. Added a final audit-remediation closure note to the closed issue.
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
- Branch cleanup - passed. At that point, local branch list contained only `main` and `codex/repo-professionalization-remediation`; remote branch list contained only `origin/main`.
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
- Required status-check enforcement - passed. `main` now requires strict `format-protocol`, `lint`, `frontend-typecheck`, and `rust` checks, linear history, conversation resolution, and force-push/deletion protections. Required review, code-owner review, stale-review dismissal, and last-push approval remain intentionally off for solo-maintainer flow.
- Local cleanup - passed. `npm run clean:local` removed ignored build/evidence outputs and restored local free space from 116 MiB to 168 GiB.
- `npm run release:verify` - passed after rerunning outside the sandbox for localhost bridge binding. The run validated release metadata, formatting, native check/test, macOS package smoke, clean-start smoke, packaged acceptance, live bridge qualification, QtIFW installer generation from `.tools/qt-ifw`, update-repository generation, checksums, artifact verification, continuity, delivery acceptance, and installer install/purge/reinstall acceptance.
- GitHub admin-enforcement hardening - passed. `POST /branches/main/protection/enforce_admins` returned `enabled=true`, and readback confirmed `enforce_admins=true`.
- Secret scanning advanced-settings attempt - partially blocked. `PATCH /repos/Fikarn/sse-exed-studio-control` accepted the request, but repository readback still reports `secret_scanning_non_provider_patterns=disabled` and `secret_scanning_validity_checks=disabled`.
- Dependency refresh - passed. Updated direct npm dependencies to current compatible releases; `npm outdated --json` reports only `@types/node` `24.12.4` current/wanted and `25.8.0` latest, which is intentionally deferred by policy.
- Community health cleanup - passed. Added `CODE_OF_CONDUCT.md`, linked it from `CONTRIBUTING.md`, and changed completed active-looking redesign docs to `historical-reference`.

## Future Ratchet Items

- Keep the ESLint ratchet moving forward. Do not downgrade the source-cleanup categories that now fail as errors; add focused cleanup PRs for any category that still needs stricter coverage.
- Split large frontend files through normal feature work rather than broad churn. Current oversized files are explicitly tracked by `scripts/file-health.mjs`; update the allowlist reason only when there is a clear ownership decision.
- Keep routine npm updates on Dependabot cadence; `npm audit --json` currently reports zero npm vulnerabilities, and `@types/node` 25 remains intentionally deferred until the Node baseline changes.
- Keep branch cleanup recurring. `delete_branch_on_merge=true` is now enabled, but squash-merged bot and historical branches can still require periodic pruning.
- Keep release-version metadata single-sourced. `npm run release:check` now validates the root package version against the selected frontend app, Tauri config, Tauri shell crate, and Rust engine crate.
- Revisit required signed commits only after local commit signing is configured for future feature branches.

## Remaining External Blockers

GitHub still reports secret-scanning non-provider patterns and validity checks as disabled after an accepted API PATCH. Future repository-professionalization work should verify whether those controls are available in the repository UI or require GitHub plan/support changes before tracking them as executable work.
