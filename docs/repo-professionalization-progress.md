# Repository Professionalization Progress

Status values: `todo`, `in_progress`, `verified`, `blocked:<exact reason>`.

## Baseline

- Date: 2026-05-16
- Branch: `codex/audio-control-surface-review-fixes`
- Audit source: local repo plus GitHub repository `Fikarn/sse-exed-studio-control`
- Baseline tracked status before this plan: clean on `codex/audio-control-surface-review-fixes...origin/codex/audio-control-surface-review-fixes`

## Task Tracker

| Task                                    | Status                                                                                                                                                                       | Evidence / Notes                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T0 Durable tracking                     | verified                                                                                                                                                                     | Plan and tracker created. GitHub tracking issue: https://github.com/Fikarn/sse-exed-studio-control/issues/77.                                                                                                                                                                                       |
| T1 Release acceptance pad drift         | verified                                                                                                                                                                     | `npm run native:acceptance` now exits `0`; acceptance keeps `pad` unchanged because UFX III mic preamps do not expose pad.                                                                                                                                                                          |
| T2 Clippy warning gate                  | verified                                                                                                                                                                     | `cd native && cargo clippy --workspace --all-targets -- -D warnings` exits `0`; `npm run rust:clippy` now denies warnings.                                                                                                                                                                          |
| T3 Documentation drift                  | verified                                                                                                                                                                     | Scoped stale-reference check has no matches in active repo-facing docs; `SECURITY.md`, `CONTRIBUTING.md`, quickstart, and `docs/HANDOFF.md` updated.                                                                                                                                                |
| T4 Stale Dependabot PR hygiene          | verified                                                                                                                                                                     | Commented on and closed stale red Dependabot PRs #51 and #53. Open PR list now contains only draft PR #76.                                                                                                                                                                                          |
| T5 Supported GitHub repository settings | blocked:branch protection requires GitHub Pro or public repo; secret scanning unavailable; code scanning disabled; Dependabot alert #1 open for transitive Linux-only `glib` | Enabled `delete_branch_on_merge`, `allow_update_branch`, vulnerability alerts, and Dependabot security updates. `allow_auto_merge` remains false after typed API update attempts. Code scanning default setup also returns `403`, so a workflow-only change would not enable scanning on this repo. |
| T6 Verification and handoff             | verified                                                                                                                                                                     | `npm run doctor`, `npm run dev:check`, `npm run native:acceptance`, and `npm run release:verify` all completed. Doctor still warns about Node v25 vs Node 24 target, missing QtIFW, and local changes. Release verify exits `0` through macOS staging fallback because QtIFW is not installed.      |

## Command Log

- `npm run native:acceptance` - failed before fix. `audio.channel.update` returned `AUDIO_CHANNEL_FIELD_UNSUPPORTED` because `audio-input-12` does not expose `pad`.
- GitHub issue create - passed. Created issue #77: `Repository professionalization audit remediation`.
- `cd native && cargo clippy --workspace --all-targets -- -D warnings` - passed after fixing `audio/helpers.rs`.
- `npm run native:acceptance` - passed after acceptance fix: import, restart, and rollback deterministic.
- Scoped stale-doc search - passed. No stale matches in `SECURITY.md`, `CONTRIBUTING.md`, `docs/DEVELOPER_QUICKSTART.md`, `docs/HANDOFF.md`, or `README.md`.
- Close PR #51 - passed. Commented and closed stale red Dependabot `@types/react-window` PR.
- Close PR #53 - passed. Commented and closed stale red Dependabot ESLint PR.
- Open PR verification - passed. GitHub PR search shows only open PR #76 after closing #51 and #53.
- Repo settings PATCH - partial. `delete_branch_on_merge=true` and `allow_update_branch=true` applied; `allow_auto_merge` remains false.
- Vulnerability alerts endpoint - passed. Vulnerability alerts enabled; endpoint returns `204 No Content`.
- Dependabot security updates PATCH - passed. Dependabot security updates enabled.
- Dependabot alerts list - action needed. One open medium alert: `glib` (`GHSA-wrw7-89jp-8q8g`). `cargo tree --target all -i glib` traces it through Tauri Linux/webkit GTK dependencies; macOS and Windows target trees print nothing for `glib`.
- Branch protection check - blocked. GitHub returns `403`: upgrade to GitHub Pro or make the repo public to enable branch protection.
- Secret scanning PATCH - blocked. GitHub returns `422`: secret scanning is not available for this repository.
- Code scanning alerts endpoint - blocked. GitHub returns `403`: code scanning is not enabled for this repository.
- GitHub issue #77 update - passed. Issue body reflects completed items and remaining blockers.
- `npm run doctor` - passed with warnings. Warnings: current Node v25.6.1 vs Node 24 target, QtIFW missing, and local changes present.
- `npm run dev:check` - passed. Includes format, lint, rustfmt, strict clippy, protocol check, frontend typecheck, native check, and native tests.
- `npm run native:acceptance` - passed on final run: import, restart, and rollback deterministic.
- `npm run release:verify` - passed. QtIFW missing triggered macOS native release staging verification. Existing Vite chunk warning remains; packaged control-surface bind is unavailable in sandbox but nonfatal.
- Commit and push - passed. Pushed `09cd74e` to `origin/codex/audio-control-surface-review-fixes`.
- Auto-merge retry - blocked. `gh api repos/Fikarn/sse-exed-studio-control -X PATCH -F allow_auto_merge=true` succeeds but the repository still returns `allow_auto_merge:false`.
- Code scanning default setup retry - blocked. `PATCH /repos/Fikarn/sse-exed-studio-control/code-scanning/default-setup` returns `403`: code scanning is not enabled for this repository.
