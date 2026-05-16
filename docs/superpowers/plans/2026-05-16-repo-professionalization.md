# Repository Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Update `docs/repo-professionalization-progress.md` after every task status change.

**Goal:** Bring the repository audit findings into a tracked remediation path that keeps release gates, docs, GitHub hygiene, and governance from drifting.

**Architecture:** Preserve the current two-process boundary: React remains an operator UI shell, while Rust owns persistence, device policy, and protocol dispatch. Repo-standard work should improve validation, documentation, and release confidence without introducing browser runtime paths or moving hardware policy into frontend code.

**Tech Stack:** Tauri 2, React 19.2, TypeScript/Vite, Rust/Cargo, GitHub Actions, GitHub repository settings, npm workspace scripts.

---

## Progress Rules

- Track task status in `docs/repo-professionalization-progress.md`.
- Allowed statuses: `todo`, `in_progress`, `verified`, `blocked:<exact reason>`.
- A task becomes `verified` only after its listed verification command exits `0`, or after an external GitHub action is confirmed through the GitHub API.
- Record exact command failures in the progress file before continuing.
- Do not mark plan-level or account-level GitHub items complete when GitHub returns a plan/permission blocker. Record them as blocked with the exact API response.
- Keep this pass scoped to audit remediation. Do not refactor large frontend files or add broad CI lanes until the release gate and documentation drift are fixed.

## Task T0: Durable Tracking

**Files:**

- Create: `docs/superpowers/plans/2026-05-16-repo-professionalization.md`
- Create: `docs/repo-professionalization-progress.md`

- [x] **Step 1: Record the baseline**

Run:

```bash
git status --short --branch
```

Expected: tracked worktree is clean before this plan is created.

- [x] **Step 2: Add progress tracker rows**

Create a table with rows for `T0` through `T6`, using the allowed statuses above.

- [x] **Step 3: Open a GitHub tracking issue**

Create one issue titled `Repository professionalization audit remediation` with the immediate and blocked task checklist from this plan.

Verification:

```bash
gh api repos/Fikarn/sse-exed-studio-control/issues/<issue-number>
```

Expected: issue exists, is open, and contains the remediation checklist.

## Task T1: Release Acceptance Pad Drift

**Root cause:** The real native engine and fixture transport intentionally reject `pad` on the current UFX III mic preamp model, but `scripts/native-parity-acceptance.mjs` still sends `pad: true` to `audio.channel.update`.

**Files:**

- Modify: `scripts/native-parity-acceptance.mjs`
- Review only unless verification requires edits: `scripts/native-packaged-acceptance.mjs`

- [x] **Step 1: Confirm the red acceptance failure**

Run:

```bash
npm run native:acceptance
```

Expected before the fix: command fails with `AUDIO_CHANNEL_FIELD_UNSUPPORTED` for `audio-input-12` pad.

- [x] **Step 2: Remove unsupported pad mutation from the shared acceptance helper**

In `assertAudioWorkflowParity`, remove `pad: true` from the `audio.channel.update` request for `audio-input-12`.

- [x] **Step 3: Keep pad covered as immutable unsupported state**

Update the `updatedFront` assertion so it expects `updatedFront.pad === baselineFront.pad` instead of `updatedFront.pad === true`.

- [x] **Step 4: Verify native acceptance is green**

Run:

```bash
npm run native:acceptance
```

Expected after the fix: command exits `0`.

## Task T2: Clippy Warning Gate

**Root cause:** `npm run dev:check` currently passes with clippy warnings because `package.json` uses `-W warnings`; the repo docs describe a stricter warning-deny posture.

**Files:**

- Modify: `native/rust-engine/src/audio/helpers.rs`
- Modify: `package.json`
- Modify if needed for consistency: `native/Cargo.toml`

- [x] **Step 1: Confirm the red strict clippy gate**

Run:

```bash
cd native && cargo clippy --workspace --all-targets -- -D warnings
```

Expected before the fix: command fails on `option_as_ref_deref` in `native/rust-engine/src/audio/helpers.rs`.

- [x] **Step 2: Fix the clippy warning**

Replace the chained `as_ref().map(String::as_str)` pattern with `as_deref()` in `apply_channel_state`.

- [x] **Step 3: Make the npm clippy lane deny warnings**

Change `package.json` `rust:clippy` from:

```json
"rust:clippy": "cd native && cargo clippy --workspace --all-targets -- -W warnings"
```

to:

```json
"rust:clippy": "cd native && cargo clippy --workspace --all-targets -- -D warnings"
```

- [x] **Step 4: Verify strict clippy**

Run:

```bash
cd native && cargo clippy --workspace --all-targets -- -D warnings
```

Expected: command exits `0`.

## Task T3: Documentation Drift

**Files:**

- Modify: `SECURITY.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/DEVELOPER_QUICKSTART.md`
- Modify if referenced text is found: `docs/HANDOFF.md`

- [x] **Step 1: Find stale baseline references**

Run:

```bash
rg -n "project-management-dashboard|Node.js 20|Node 20|TypeScript 5\\.9|issue #6|#6" SECURITY.md CONTRIBUTING.md docs README.md
```

Expected before the fix: stale security link and Node/TypeScript references are present.

- [x] **Step 2: Update vulnerability reporting**

Point security reporting at `Fikarn/sse-exed-studio-control`.

- [x] **Step 3: Update Node and TypeScript baseline docs**

Align repo docs with `.nvmrc` and the installed toolchain:

- Node.js target: 24
- TypeScript baseline: 6.0

- [x] **Step 4: Resolve issue #6 drift**

If active docs still call issue #6 open/current, update the text to show it was completed and closed on 2026-04-25, or replace it with the new remediation tracking issue created in `T0`.

- [x] **Step 5: Verify stale references are gone**

Run:

```bash
rg -n "project-management-dashboard|Node.js 20|Node 20|TypeScript 5\\.9" SECURITY.md CONTRIBUTING.md docs/DEVELOPER_QUICKSTART.md docs/HANDOFF.md README.md
```

Expected: no stale matches in active repo-facing docs.

## Task T4: Stale Dependabot PR Hygiene

**GitHub PRs:**

- `#51` `chore(frontend-deps): bump @types/react-window from 1.8.8 to 2.0.0 in /frontend/app`
- `#53` `chore(deps): bump eslint from 9.39.4 to 10.2.1`

- [x] **Step 1: Comment on stale red PRs**

Post a short comment that the PR is being closed because it is stale against the old base and red on all advisory checks.

- [x] **Step 2: Close stale red PRs**

Close PRs `#51` and `#53`.

- [x] **Step 3: Verify no stale red dependency PRs remain open**

Run:

```bash
gh pr list --repo Fikarn/sse-exed-studio-control --state open --json number,title,author,isDraft,headRefName,statusCheckRollup
```

Expected: no open stale red Dependabot dependency PR remains.

## Task T5: Supported GitHub Repository Settings

**Repository:** `Fikarn/sse-exed-studio-control`

- [x] **Step 1: Enable supported repository cleanup settings**

Attempt to set:

- `delete_branch_on_merge=true`
- `allow_update_branch=true`

- [x] **Step 2: Attempt to enable vulnerability alerts**

Call the GitHub vulnerability-alerts endpoint for this repo.

- [x] **Step 3: Record plan/permission blockers**

If branch protection, rulesets, secret scanning, Dependabot alerts, or code scanning return plan/permission blockers, record the exact blocker in the progress file and tracking issue.

- [x] **Step 4: Verify repository settings**

Run:

```bash
gh api repos/Fikarn/sse-exed-studio-control
gh api -i repos/Fikarn/sse-exed-studio-control/vulnerability-alerts
```

Expected: supported settings are enabled; unsupported settings are documented as blocked.

## Task T6: Verification And Handoff

**Commands:**

- `npm run doctor`
- `npm run dev:check`
- `npm run native:acceptance`
- `npm run release:verify`

- [x] **Step 1: Run developer readiness check**

Run `npm run doctor`.

Expected: command exits `0`; Node/QtIFW warnings may remain if the local host is not configured as a release host.

- [x] **Step 2: Run full local code-health gate**

Run `npm run dev:check`.

Expected: command exits `0` with clippy warnings denied.

- [x] **Step 3: Run native acceptance**

Run `npm run native:acceptance`.

Expected: command exits `0`.

- [x] **Step 4: Run release verification**

Run `npm run release:verify`.

Expected: command exits `0`, or records an exact environmental blocker. Product-code failures are not acceptable blockers.

- [x] **Step 5: Update progress tracker and GitHub issue**

Record final command results, remaining blocked GitHub settings, and follow-up recommendations.
