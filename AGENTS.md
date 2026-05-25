# AGENTS.md

Entry point for Codex-assisted work in this repo. Keep it short. Follow the pointers into `docs/` for anything that needs depth.

## How to work here

- Inspect the repo before editing. For broad orientation, read `README.md`, `docs/DEVELOPER_QUICKSTART.md`, `docs/HANDOFF.md`, and the docs linked from the section below.
- Derive commands and conventions from checked-in files (`package.json`, workspace `package.json` files, `native/Cargo.toml`, `.github/workflows/dev-checks.yml`, and `docs/DEVELOPMENT.md`). Do not invent lanes.
- For multi-step or risky work, make a short plan after inspection and before edits.
- Keep changes inside the right layer. If a task crosses the shell/engine/protocol boundary, state the boundary impact before changing files.
- If validation cannot run, say exactly why and list the next command a human should run. Do not silently stop at partial verification.
- When the user asks to close out or publish a session, finish the GitHub workflow: commit, push, open or update the PR, wait for the advisory checks that apply, merge the approved PR, prune/delete the feature branch, and sync local `main`.

## What this product is

`SSE ExEd Studio Control` — a native desktop studio console for a single fixed operator workstation. Planning, DMX lighting, audio mixer (OSC/TotalMix), and Stream Deck+ commissioning. Bundle id `com.sse.exedstudiocontrol`. Current published operator-rollout version is `v2.2.1` (2026-04-24) — the legacy Electron/Next.js runtime was retired in `v2.1.0`; there is no browser path.

Checkpoint D is complete: the Qt/QML fallback shell, Qt-specific shell automation, and historical Qt parity assets are retired. Do not reintroduce a Qt shell path without a new architecture decision and replacement release plan.

## Architecture boundary (non-negotiable)

Two processes, separated by an IPC protocol:

- `native/tauri-shell/` + `frontend/` — selected shipping shell for the current published Tauri runtime, built on `Tauri 2 + React 19.2 + TypeScript + Vite`. **No device or DB logic in React.**
- `native/rust-engine/` — Rust. Owns state, persistence, device I/O, protocol dispatch.
- `native/protocol/` — the IPC contract between them. Changes here are contract changes.

Rule: if a change would move product state, persistence, or device policy into React, it is going in the wrong direction. Authoritative source: `docs/ARCHITECTURE.md`.

## Hardware target (binding)

- Primary operator surface: fullscreen `2560×1440` on a fixed second monitor.
- Minimum fallback: `1920×1080`.
- **No scroll during normal operation.** Dense fixed-height layouts.
- Devices currently in play: RME Fireface UFX III (audio), Litepanels Apollo Bridge / Astra Bi-Color / Aputure Infinimat / Infinibar PB12 (lighting), Stream Deck+ + Bitfocus Companion local (control).

When developing on a Retina MacBook, enforce the built-in-display review workflow from `docs/DEVELOPMENT.md`: use the app-owned Scaled Studio Preview for proportional `2560×1440` studio review, and do not judge studio-full fit/layout from the default Retina logical desktop.

Scaled Studio Preview is a scaled `2560×1440` studio canvas, not a compact host viewport. Operator-density rules must key off the logical operator surface so the preview matches native `2560×1440` after scaling.

Authoritative source: `docs/HARDWARE_PROFILE.md`.

## Design system

Use the frontend token and component packages as the shared UI foundation:

- `frontend/packages/tokens/` — generated design tokens and docs
- `frontend/packages/design-system/` — shared shell primitives and layout components
- `frontend/app/src/` — selected operator surfaces

Extend tokens and shared components additively. Do not bypass the frontend design system with one-off styling unless the change is explicitly scoped and documented.

## Runtime environment

- Rust engine compiled and started by the selected Tauri shell runtime.

Build & run commands live in `docs/DEVELOPMENT.md` (`npm run native:foundation`, `native:check`, `native:test`, `native:acceptance`, `frontend:foundation`, `tauri:foundation`, packaging and installer lanes, etc.). Use them; don't invent new ones.

## Command map

Install and environment:

- `npm install` — install root npm workspace dependencies.
- `npm run doctor` — normal local environment check.
- `npm run doctor:release` — release-host preflight; expects QtIFW tooling when release evidence is needed.

Code health:

- `npm run format:check` / `npm run format` — Prettier check/write.
- `npm run lint` / `npm run lint:fix` — ESLint check/fix.
- `npm run scripts:test` — unit tests for repository maintenance/release helper scripts (glob over `scripts/**/*.test.mjs`).
- `npm run file:health` — tracked-file size and oversized-source guard.
- `npm run frontend:typecheck` — TypeScript typecheck for all npm workspaces that expose `typecheck`.
- `npm run frontend:test` — Vitest across all frontend workspaces (`@testing-library/react` for components; pure-logic unit tests).
- `npm run rust:fmt:check` — Rust formatting check under `native/`.
- `npm run rust:clippy` — Rust clippy for the native workspace with warnings denied by the command.
- `npm run protocol:check` / `npm run protocol:generate` — check or regenerate protocol artifacts from `native/protocol/v1.contract.json`.
- `npm run dev:check` — full local code-health bundle: format, lint, script tests, file health, rustfmt, clippy, protocol, frontend typecheck, frontend tests (Vitest), native check, native tests.
- `npm run ci` — repo-local convenience gate: format, release metadata check, native foundation.

Frontend and selected shell:

- `npm run frontend:tokens:build` — regenerate design token outputs.
- `npm run frontend:foundation` — protocol generation, tokens build, typecheck, Storybook build, fixture check, Playwright.
- `npm run tauri:dev` — run the selected Tauri dev shell.
- `npm run tauri:build` — build the selected Tauri shell.
- `npm run tauri:foundation` — protocol generation, engine build, Tauri build, Tauri smoke.
- `npm run tauri:setup-support:qualify` and `npm run tauri:workspaces:qualify` — live shell qualification lanes; run serially because they bind fixed local ports.
- `npm run tauri:visual:review` — required visual evidence lane for operator-visible layout/presentation changes.

Native and release:

- `npm run native:check` — `cargo check --workspace` under `native/`.
- `npm run native:test` — `cargo test --workspace` under `native/` (excludes `#[ignore]` tests).
- `npm run native:test:hardware` — opt-in lane that runs `cargo test --workspace -- --ignored`, exercising device-bound tests against a connected RME UFX III / Stream Deck / TotalMix OSC host. CI does not run this; the operator workstation does. See `docs/DEVELOPMENT.md §Opt-in real-hardware lane`.
- `npm run native:engine:build` — build `studio-control-engine`.
- `npm run native:foundation` — native shipping foundation lane.
- `npm run native:acceptance` — native acceptance lane.
- `npm run release:preflight` — pre-12-stage-chain credential, tooling, disk, and network reachability check (run before `release:verify`).
- `npm run release:check` / `npm run release:verify` — release metadata and release verification (`release:verify` chains `release:preflight`).
- `npm run release:manifest` — write the chain-of-custody release manifest for a tag. Called from `release:publish`; standalone for evidence regeneration.
- `npm run release:notes` — emit the GitHub Release notes body (artifact hashes embedded from the manifest).
- `npm run release:publish` — publish artifacts + manifest to GitHub Releases for a tag.
- `npm run native:release:mac:local` and `npm run native:release:win:local` — target-host shipping release gates when QtIFW tools are installed.

## Visual Review Discipline

Every operator-visible change to the selected Tauri surface must:

1. run the relevant frontend, Tauri, or native validation lane for the changed surface,
2. run `npm run tauri:visual:review` when layout or operator presentation changes,
3. inspect the result with Scaled Studio Preview or on the fixed studio monitor when human fit judgment matters.

Tauri visual review, Playwright, fixture-driven smoke coverage, target-host release evidence, and the gate in `docs/archive/FRONTEND_CUTOVER_PLAN.md` are the active validation path. Historical Qt parity screenshots were retired in Checkpoint D.

The committed `visual-review.spec.ts` baselines under `frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/` are the structural patch for the silent-rescope class of bug captured in [#Rescope protocol (sliced plans)](#rescope-protocol-sliced-plans): a content-altering substitution under an existing slice title would now fail the diff gate on CI, and the missing-`Rescope:`-paragraph nudge from `scripts/check-slice-rescope.mjs` would catch the doc-side silence. Treat the two as a pair, not as substitutes.

When the selected Tauri shell is open for user inspection, that exact running shell is the authoritative surface for visual feedback. Treat user callouts as referring to the live `sse-exed-tauri-shell` / `SSE ExEd Studio Control` window unless they explicitly name another artifact. See `docs/HARDWARE_PROFILE.md`.

## Testing posture

- Engine tests: `cargo test` under `native/rust-engine/`. `#[ignore]`-marked tests are hardware-bound and skipped by default; run them via `npm run native:test:hardware` on the operator workstation.
- Frontend unit/component tests: `npm run frontend:test` (Vitest + `@testing-library/react`). Specs colocated as `*.test.ts` / `*.test.tsx` under each workspace.
- Frontend Playwright + visual baselines: `npm run frontend:playwright:test`. `visual-review.spec.ts` commits `toHaveScreenshot` baselines under `frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/` (per-platform `*-darwin.png` / `*-linux.png` files); the CI `frontend-e2e` job re-runs them and uploads diffs + the Playwright report as artifacts. `storybook.spec.ts` does the same for the Storybook static build.
- Smoke / acceptance / bridge-qualification lanes: see `docs/DEVELOPMENT.md §2b` and §4.
- Target-host lanes: macOS and Windows native verification are both blocking release gates. Treat a Windows target-host failure the same as a macOS failure.

### CI validation lanes (`.github/workflows/dev-checks.yml`)

| Job                  | Covers                                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format-protocol`    | `format:check`, `scripts:test`, `release:check`, `file:health`, `protocol:check`                                                                                                                                                                                                                 |
| `lint`               | `lint` (ESLint)                                                                                                                                                                                                                                                                                  |
| `frontend-typecheck` | `frontend:typecheck`                                                                                                                                                                                                                                                                             |
| `frontend-test`      | `frontend:test` (Vitest across all frontend workspaces)                                                                                                                                                                                                                                          |
| `frontend-e2e`       | `frontend:playwright:test` — Playwright suite + visual-review + Storybook baselines. Uploads `playwright-report` and `playwright-test-results` artifacts (including snapshot diffs and traces). Reviewers click through from the PR Checks tab; this is the visual-diff PR gate (Workstream A1). |
| `rust`               | `rust:fmt:check`, `rust:clippy`, `native:check`, `native:test`, `native:acceptance` (with `SSE_NATIVE_ACCEPTANCE_SKIP_AUDIO_SYNC=1` because CI has no real RME TotalMix on `127.0.0.1`)                                                                                                          |
| `tauri-foundation`   | `tauri:foundation` (protocol generate → engine build → Tauri build → Tauri smoke)                                                                                                                                                                                                                |
| `qualification`      | `tauri:setup-support:qualify` + `tauri:workspaces:qualify` under `xvfb`, with `SSE_TAURI_QUALIFICATION_TIMEOUT_MS=180000`, `LIBGL_ALWAYS_SOFTWARE=1`, and `SSE_TAURI_QUALIFICATION_SKIP_AUDIO_PROBE=1` (CI cannot supply live OSC). Uploads `tauri-qualification-evidence` artifact.             |

These jobs are required merge hygiene on `main`. They are **not** the release gate — `npm run native:release:{mac,win}:local` and `npm run release:verify` on the operator workstation remain the release acceptance mechanism.

## Release posture

- QtIFW offline installers for Windows + macOS, plus QtIFW maintenance-tool update-repository archives.
- Distribution: GitHub Releases (direct download) + maintenance-tool update channel.
- Trigger: a `v*` tag identifies the release; local target-host gates build and verify artifacts, then `npm run release:publish -- --tag vX.Y.Z` uploads them to GitHub Releases.
- Deployment profile: one fixed studio workstation, unsigned controlled deployment. Public signing (Windows cert + Apple Developer) is deferred — see `docs/PRODUCTIZATION_PLAN.md §3`.
- Persistence compatibility: rollback to a prior tag must remain a reinstall-away. Do not change on-disk formats without an explicit migration plan.

Authoritative source: `docs/RELEASE.md` and `docs/PRODUCTIZATION_PLAN.md`.

## Retained legacy surface

Only one piece of pre-v2.0.0 code is intentionally retained:

- `native/rust-engine/src/legacy_import.rs` — one-way importer that reads a legacy Electron `db.json` on first native launch (env var `SSE_LEGACY_DB_PATH`). Do not touch it as part of new feature work; do not extend it; do not mirror it elsewhere.

## Generated and local-only files

- Protocol source of truth: `native/protocol/v1.contract.json` and `native/protocol/v1.md`. Generated outputs are `native/protocol/generated/v1.schema.json`, `frontend/packages/engine-client/src/generated/protocol.ts`, and `frontend/packages/engine-client/src/generated/snapshots/**`; update them with `npm run protocol:generate`.
- Token source of truth: `frontend/packages/tokens/src/source/tokens.json` and `frontend/packages/tokens/src/tokens/**`. Generated outputs under `frontend/packages/tokens/src/generated/**` come from `npm run frontend:tokens:build`.
- Do not hand-edit generated outputs unless the task is explicitly about the generator or the generated diff is produced by the checked-in command.
- Keep ignored local outputs out of commits: `node_modules/`, `release/`, `artifacts/`, `.tools/`, `.DS_Store`, `.swift-module-cache/`, `native/**/target/`, `native/**/build/`, `frontend/**/dist/`, `frontend/**/storybook-static/`, Playwright reports, and test results.

## Done criteria for future Codex tasks

A task is done when:

- the implementation stays inside the architecture boundary and does not move state, persistence, hardware policy, or DB logic into React;
- relevant generated artifacts are regenerated or explicitly confirmed unchanged;
- the smallest validation lane covering the risk has run, or the blocker is stated with the exact command that still needs to run;
- operator-visible changes have Tauri visual review evidence and, when needed, human inspection on the `2560×1440` review surface;
- docs, release notes, or `CHANGELOG.md` are updated when behavior, setup, release posture, or user-visible behavior changes;
- the final handoff lists files changed, verification commands and results, blockers/unknowns, and useful follow-up.

## Rescope protocol (sliced plans)

When working through a sliced plan and a slice's premise turns out to be wrong on inspection:

- Do **not** silently substitute different work under the same slice number — that's how the Phase 3 Slice 4 and Slice 6 deltas slipped through the audit. Both shipped non-plan work under their original slice names with no doc trail until the 2026-05-24 follow-up audit.
- Instead, in the same PR or a follow-up: (1) edit the plan doc to record the rescope reason, (2) re-number or rename the slice so the title matches what landed, (3) open a new follow-up item for the original plan goal if it's still worth doing (or formally drop it with rationale).
- The commit message should call out the rescope explicitly so a reader scanning `git log --oneline` sees the divergence without opening the diff.
- If the rescope is large enough to change validation scope, re-run the wider validation lane that the original plan named — don't inherit the narrower lane the rescoped work needs.

## Where to look

| For…                                    | Go to…                                           |
| --------------------------------------- | ------------------------------------------------ |
| Runtime boundaries, shell/engine rules  | `docs/ARCHITECTURE.md`                           |
| Workstation dimensions, device list     | `docs/HARDWARE_PROFILE.md`                       |
| Operator task flows, keyboard shortcuts | `docs/OPERATIONS.md`                             |
| Cold-start developer onboarding         | `docs/DEVELOPER_QUICKSTART.md`                   |
| Daily build/test/package commands       | `docs/DEVELOPMENT.md`                            |
| Release steps, acceptance checklist     | `docs/RELEASE.md`, `docs/PRODUCTIZATION_PLAN.md` |
| Current engineering truth / open items  | `docs/HANDOFF.md`                                |

If this file disagrees with any of the above, those docs win — this file is a pointer, not a spec.
