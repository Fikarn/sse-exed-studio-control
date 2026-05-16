# Repository Professionalization Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the concrete gaps from the May 16 repository audit so GitHub state, security posture, docs, and repo hygiene stay current instead of drifting back into prose-only tracking.

**Architecture:** This is repo-governance and documentation work. It must not move product state, persistence, hardware policy, device I/O, or DB behavior across the established Rust-engine / Tauri-shell boundary. Runtime dependency changes must keep the selected Tauri shipping path intact and use the existing validation lanes.

**Tech Stack:** GitHub Issues/PRs/Dependabot, GitHub Actions, npm workspaces, Tauri 2, Rust/Cargo, React/TypeScript/Vite, checked-in documentation under `docs/`.

---

## Progress Rules

- Track task status in `docs/repo-professionalization-progress.md`.
- Allowed statuses: `todo`, `in_progress`, `verified`, or `blocked:<exact reason>`.
- Update the progress tracker immediately after each task changes status.
- Keep GitHub issue #77 aligned with the tracker after every GitHub-state change.
- Do not mark a plan/account-level GitHub setting complete when GitHub returns a plan or permission blocker.
- Preserve local-first release posture: advisory CI is useful signal, but target-host release lanes remain the acceptance path.

## File Map

- Modify: `docs/repo-professionalization-progress.md` — current tracker and command log for this remediation pass.
- Modify: `docs/HANDOFF.md` — current queue and repo-standard blockers, if live GitHub state changes.
- Modify: `README.md` — screenshot language and release-facing first impression.
- Modify: `docs/release-assets/*.png` — current Tauri screenshots when refreshed by `npm run tauri:visual:review`.
- GitHub: issue #77 — durable external tracker for settings/security/dependency state.
- GitHub: PR #78 — Dependabot Tauri security update.
- GitHub: Dependabot alert #1 — Linux-only transitive `glib` alert.
- GitHub: stale merged branches — branch-list cleanup after merged PRs.

## Task R0: Establish Current Remediation Tracker

**Files:**

- Modify: `docs/repo-professionalization-progress.md`
- Create: `docs/superpowers/plans/2026-05-16-repo-professionalization-remediation.md`

- [x] **Step 1: Confirm branch and baseline**

Run:

```bash
git status --short --branch
```

Expected: on `codex/repo-professionalization-remediation` with only planned remediation edits.

- [x] **Step 2: Replace stale progress state**

Update `docs/repo-professionalization-progress.md` so it records:

- current branch: `codex/repo-professionalization-remediation`
- open PR state after PR #78 handling
- open Dependabot alert state after PR #78 handling
- current GitHub settings blockers
- current local validation results

- [x] **Step 3: Verify tracker formatting**

Run:

```bash
npm run format:check
```

Expected: tracker markdown is Prettier-compatible.

## Task R1: Resolve Tauri Security PR

**GitHub:**

- PR: https://github.com/Fikarn/sse-exed-studio-control/pull/78
- Alert: `GHSA-7gmj-67g7-phm9`

- [x] **Step 1: Verify PR scope**

Confirm PR #78 only changes:

```text
native/Cargo.lock
native/tauri-shell/Cargo.toml
```

- [x] **Step 2: Verify advisory CI**

Inspect PR #78 workflow run and require all `dev-checks` jobs to be green:

```text
format-protocol
lint
frontend-typecheck
rust
```

- [x] **Step 3: Merge PR #78**

Squash merge PR #78 with title:

```text
chore(native-deps): bump tauri to 2.11.1
```

- [x] **Step 4: Verify alert state**

Run:

```bash
gh api repos/Fikarn/sse-exed-studio-control/dependabot/alerts --jq '[.[] | {number, state, package: .dependency.package.name, advisory: .security_advisory.ghsa_id}]'
```

Expected: Tauri alert is `fixed`; only the documented `glib` alert remains open.

## Task R2: Resolve Or Risk-Accept Linux-Only `glib` Alert

**GitHub:**

- Alert: `GHSA-wrw7-89jp-8q8g`

- [x] **Step 1: Prove target-platform exclusion**

Run:

```bash
cd native && cargo tree --target x86_64-pc-windows-msvc -i glib
cd native && cargo tree --target aarch64-apple-darwin -i glib
cd native && cargo tree --target all -i glib
```

Expected:

- Windows target prints nothing.
- macOS target prints nothing.
- `--target all` traces `glib` through Tauri Linux GTK/WebKit dependencies only.

- [x] **Step 2: Dismiss alert with evidence**

Dismiss Dependabot alert #1 as `not_used` because the supported release targets are Windows 11 `x64` and macOS Apple Silicon, and the alert is only reachable through the unsupported Linux Tauri dependency tree.

- [x] **Step 3: Verify alert state**

Run:

```bash
gh api repos/Fikarn/sse-exed-studio-control/dependabot/alerts --jq '[.[] | {number, state, package: .dependency.package.name, dismissed_reason}]'
```

Expected: no open Dependabot alerts remain.

## Task R3: Keep GitHub Settings Blockers Honest

**GitHub:**

- Repo: `Fikarn/sse-exed-studio-control`
- Issue: #77

- [x] **Step 1: Re-check supported settings**

Run:

```bash
gh api repos/Fikarn/sse-exed-studio-control --jq '{allow_auto_merge,allow_update_branch,delete_branch_on_merge,has_wiki,private,visibility}'
gh api -i repos/Fikarn/sse-exed-studio-control/vulnerability-alerts
```

Expected:

- `allow_update_branch=true`
- `delete_branch_on_merge=true`
- vulnerability alerts endpoint returns `204`
- `allow_auto_merge=false` remains blocked until branch protection/rules are available

- [x] **Step 2: Re-check plan blockers**

Run:

```bash
gh api -i repos/Fikarn/sse-exed-studio-control/branches/main/protection
gh api repos/Fikarn/sse-exed-studio-control/code-scanning/alerts
```

Expected:

- branch protection returns GitHub Pro/public-repo blocker
- code scanning returns disabled/not-enabled blocker

- [x] **Step 3: Update GitHub issue #77**

Update issue #77 so it no longer references stale PR #76 or old bundle-size state, and so it records current blockers only.

## Task R4: Clean Merged Branch Bloat

**Local/remote branches:**

- Delete local branches that are already merged into `main`.
- Delete remote branches that are already merged into `origin/main` and are not `origin/main` / `origin/HEAD`.

- [x] **Step 1: List merged branches**

Run:

```bash
git branch --merged main --format='%(refname:short)'
git branch -r --merged origin/main --format='%(refname:short)'
```

Expected: output identifies stale merged local and remote branches.

- [x] **Step 2: Delete only merged local branches**

Run `git branch -d` only for local branches listed by `git branch --merged main`, excluding `main` and the active remediation branch.

- [x] **Step 3: Delete only merged remote branches**

Run `git push origin --delete` only for stale remote branches listed by `git branch -r --merged origin/main`, excluding `origin/main` and `origin/HEAD`.

- [x] **Step 4: Prune and verify**

Run:

```bash
git fetch --prune origin
git branch --merged main --format='%(refname:short)'
git branch -r --merged origin/main --format='%(refname:short)'
```

Expected: stale merged branches are gone.

## Task R5: Refresh README Screenshots To Current Tauri Evidence

**Files:**

- Modify: `README.md`
- Modify: `docs/release-assets/screenshot-planning.png`
- Modify: `docs/release-assets/screenshot-lighting.png`
- Modify: `docs/release-assets/screenshot-audio.png`
- Modify: `docs/release-assets/screenshot-setup-control.png`

- [x] **Step 1: Generate focused current visual evidence**

Run:

```bash
npm run tauri:visual:review -- --fixtures=planning-populated,lighting-populated,audio-populated,setup-ready --sizes=2560x1440 --out=artifacts/visual/repo-professionalization-screenshots
```

Expected: four screenshots and a summary JSON are generated with zero failures.

- [x] **Step 2: Copy current screenshots into release assets**

Map generated screenshots to checked-in release assets:

```text
planning-populated-2560x1440.png -> docs/release-assets/screenshot-planning.png
lighting-populated-2560x1440.png -> docs/release-assets/screenshot-lighting.png
audio-populated-2560x1440.png -> docs/release-assets/screenshot-audio.png
setup-ready-2560x1440.png -> docs/release-assets/screenshot-setup-control.png
```

- [x] **Step 3: Update README screenshot language**

Change the screenshot note so it says the checked-in screenshots are current Tauri visual-review captures, not historical Qt parity captures.

## Task R6: Mark Historical Docs Clearly

**Files:**

- Modify selected `docs/redesign/*.md` files only if they are active-looking and likely to confuse a new engineer.

- [x] **Step 1: Scan active-looking historical docs**

Run:

```bash
rg -n "QML|Qt shell|parity|legacy|retained unchanged|v2\\.2\\.0" docs/redesign
```

Expected: output identifies docs that need an explicit historical-status banner.

- [x] **Step 2: Add concise status banners**

Add a short banner to confusing redesign docs:

```markdown
> Historical design/reference document. Current implementation truth lives in `README.md`, `docs/HANDOFF.md`, and `docs/ARCHITECTURE.md`.
```

Do not rewrite archived design history during this pass.

## Task R7: Record Code-Quality Ratchet Follow-Ups

**Files:**

- Modify: `docs/repo-professionalization-progress.md`
- Modify: `docs/HANDOFF.md` if the execution queue needs current follow-up wording.
- GitHub: issue #77

- [x] **Step 1: Record non-blocking code-quality debt**

Record these as future ratchet items, not current blockers:

- ESLint config is intentionally permissive and should be tightened incrementally.
- Largest frontend files should be reduced only through scoped feature work.
- Routine npm updates exist but `npm audit` reports zero vulnerabilities.

- [x] **Step 2: Keep immediate queue short**

Update issue #77 so only actionable open items remain.

## Task R8: Final Verification

**Commands:**

- `npm run format:check`
- `npm run dev:check`
- `npm run release:check`
- `git status --short --branch`

- [x] **Step 1: Run format check**

Run:

```bash
npm run format:check
```

Expected: exits `0`.

- [x] **Step 2: Run full local code-health gate**

Run:

```bash
npm run dev:check
```

Expected: exits `0`.

- [x] **Step 3: Run release metadata check**

Run:

```bash
npm run release:check
```

Expected: exits `0`.

- [x] **Step 4: Record final status**

Update tracker and issue #77 with command results, remaining GitHub plan blockers, and any unexecuted external-account actions.

## Task R9: Resolve Local Release-Host Setup

**Files:**

- Modify: `scripts/dev-doctor.mjs`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/DEVELOPER_QUICKSTART.md`
- Modify: `docs/repo-professionalization-progress.md`

- [x] **Step 1: Install and link Node 24**

Run:

```bash
brew install node@24
brew unlink node
brew link --overwrite --force node@24
```

Expected: `node --version` prints Node 24.

- [x] **Step 2: Repair Homebrew Rust/cargo after dependency cleanup**

Run:

```bash
brew reinstall libgit2
cargo --version
rustc --version
```

Expected: `cargo` and `rustc` both run without dynamic-library errors.

- [x] **Step 3: Auto-detect local QtIFW tools**

Update `scripts/dev-doctor.mjs` so `.tools/qt-ifw/Tools/QtInstallerFramework/*/bin/binarycreator` and `repogen` are accepted after env vars and PATH lookup.

- [x] **Step 4: Correct QtIFW docs path**

Change local macOS QtIFW examples from `4.11` to `4.7`, matching `qt.tools.ifw.47`.

## Task R10: Tighten Safe GitHub Repository Settings

**GitHub:**

- Repository: `Fikarn/sse-exed-studio-control`

- [x] **Step 1: Keep squash-only merge policy**

Run:

```bash
gh api repos/Fikarn/sse-exed-studio-control \
  -X PATCH \
  -F allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false
```

Expected: squash merge remains enabled; merge commits and rebase merges are disabled.

## Task R11: Prove Remaining GitHub Blockers

**GitHub:**

- Repository: `Fikarn/sse-exed-studio-control`

- [x] **Step 1: Re-check blocked settings**

Run:

```bash
gh api -i repos/Fikarn/sse-exed-studio-control/branches/main/protection
gh api repos/Fikarn/sse-exed-studio-control/rulesets
gh api repos/Fikarn/sse-exed-studio-control/code-scanning/default-setup -X PATCH -f state=configured -f query_suite=default
gh api repos/Fikarn/sse-exed-studio-control -X PATCH -F 'security_and_analysis[secret_scanning][status]=enabled'
```

Expected: GitHub returns plan/account blockers while the repo remains private on the current account.

- [x] **Step 2: Do not change visibility without explicit approval**

Stop before making the repository public. Public visibility is the only non-billing path to these GitHub features, but it exposes the full repository.

## Task R12: Public-Readiness Secret Pattern Scan

**Files:**

- Read-only scan across repo source/docs/config paths.

- [x] **Step 1: Run local secret-pattern scan**

Run:

```bash
rg -n --hidden --glob '!node_modules/**' --glob '!native/**/target/**' --glob '!release/**' --glob '!artifacts/**' --glob '!frontend/**/dist/**' --glob '!frontend/**/storybook-static/**' --glob '!package-lock.json' --glob '!Cargo.lock' "(ghp_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH|EC|DSA|PRIVATE) KEY-----|(?i)(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,})"
```

Expected: no matches outside generated/build outputs.

## Task R13: Fix Rust 1.95 Strict Clippy Drift

**Files:**

- Modify: `native/rust-engine/src/planning/snapshot.rs`
- Modify: `native/rust-engine/src/storage.rs`

- [x] **Step 1: Replace descending `sort_by` comparisons**

Use `sort_by_key` with `std::cmp::Reverse` for descending `total_seconds` ordering.

- [x] **Step 2: Remove redundant iterator conversions**

Remove `.into_iter()` calls from `chain(...)` arguments that already accept `IntoIterator`.

- [x] **Step 3: Verify strict clippy through the normal gate**

Run:

```bash
npm run dev:check
```

Expected: exits `0`.
