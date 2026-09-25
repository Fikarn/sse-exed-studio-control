# AGENTS.md

Entry point for Codex-assisted work in this repo. Keep it short. Follow the pointers into `docs/` for anything that needs depth.

## How to work here

- Inspect the repo before editing. For broad orientation, read `README.md`, `docs/DEVELOPER_QUICKSTART.md`, `docs/HANDOFF.md`, and the docs linked from the section below.
- Derive commands and conventions from checked-in files (`package.json`, workspace `package.json` files, `native/Cargo.toml`, `.github/workflows/dev-checks.yml`, and `docs/DEVELOPMENT.md`). Do not invent lanes.
- For multi-step or risky work, make a short plan after inspection and before edits.
- Keep changes inside the right layer. If a task crosses the shell/engine/protocol boundary, state the boundary impact before changing files.
- If validation cannot run, say exactly why and list the next command a human should run. Do not silently stop at partial verification.
- When the user asks to close out or publish a session, finish the GitHub workflow: commit, push, open or update the PR, wait for the ten required `dev-checks` jobs, merge the PR, prune/delete the feature branch, and sync local `main`.

## What this product is

`SSE ExEd Studio Control` — a native desktop studio console for a single fixed operator workstation. DMX lighting, audio mixer (OSC/TotalMix), and Stream Deck+ commissioning. Planning was removed in 2026-09 by the new pages program (`docs/plans/new-pages-2026-09.md`: from the screen in Slice 1, from the hardware link, the contract and the saved data in Slice 2), which then removes the keyboard shortcuts and adds Cameras and Teleprompter pages. Bundle id `com.sse.exedstudiocontrol`. Current published operator-rollout version is `v2.2.1` (2026-04-24) — the legacy Electron/Next.js runtime was retired in `v2.1.0`; there is no browser path.

Checkpoint D is complete: the Qt/QML fallback shell, Qt-specific shell automation, and historical Qt parity assets are retired. Do not reintroduce a Qt shell path without a new architecture decision and replacement release plan.

## Architecture boundary (non-negotiable)

Two processes, separated by an IPC protocol:

- `native/tauri-shell/` + `frontend/` — selected shipping shell for the current published Tauri runtime, built on `Tauri 2 + React 19.2 + TypeScript + Vite`. **No device or DB logic in React.**
- `native/rust-engine/` — Rust. Owns state, persistence, device I/O, protocol dispatch.
- `native/protocol/` — the IPC contract between them. Changes here are contract changes.

Rule: if a change would move product state, persistence, or device policy into React, it is going in the wrong direction. Authoritative source: `docs/ARCHITECTURE.md`.

## Hardware target (binding)

- Primary operator surface: fullscreen `2560×1440` on a fixed second monitor. **Operator ruling 2026-09-07 (visual overhaul A, plan D4): `2560×1440` is the only resolution that matters.** Chrome budget: header 56, footer 40, cluster 424, plate 416, gutters 16; the Console shows 4 / 6 / 3 strips.
- `1920×1080` and `1280×800` remain as fallback layouts, not deliverables: their guards stay (`audio-legibility`, `viewport-contract`, the six-size scroll check) but no design gate runs below `2560×1440`.
- **Operator ruling 2026-09-18: only the Windows build and only `2560×1440` matter.** Do no work for Linux, macOS or any other resolution (no linux or darwin captures, no fallback-viewport fixes). Leave their guards as they are; if one turns red for a reason that is not also a Windows `2560×1440` reason, say so, record it and move on — and ask before deleting such a guard. One exception (operator decision, 2026-09-23): `frontend-e2e` is a required check, so a change that moves a board refreshes its `linux` capture too, from the branch push run's `playwright-test-results` artifact, before it merges (the production readiness ledger, Baseline refresh procedure); `darwin` and the win32 captures at other sizes stay as they are.
- **No scroll during normal operation.** Dense fixed-height layouts.
- Devices currently in play: RME Fireface UFX III (audio), Litepanels Apollo Bridge / Astra Bi-Color / Aputure Infinimat / Infinibar PB12 (lighting), Stream Deck+ + Bitfocus Companion local (control).

When developing on a Retina MacBook, enforce the built-in-display review workflow from `docs/DEVELOPMENT.md`: use the app-owned Scaled Studio Preview for proportional `2560×1440` studio review, and do not judge studio-full fit/layout from the default Retina logical desktop.

Scaled Studio Preview is a scaled `2560×1440` studio canvas, not a compact host viewport. Operator-density rules must key off the logical operator surface so the preview matches native `2560×1440` after scaling.

Authoritative source: `docs/HARDWARE_PROFILE.md`.

## Design system

Every operator surface is built to one written visual system — **Concept A**,
specified in `docs/redesign/system-a-2026-09.md` and implemented across thirteen
slices recorded in `docs/plans/visual-overhaul-a-2026-09.md` (landed 2026-09-09).
Read §10 of the system doc before changing anything the operator sees: it is the
list of things that are measured on every board, and it is enforced, not advisory.

The short version: every surface is header · cluster · bay · plate · footer; the
type scale has nine steps and a 12 px floor; there are four radii (4 · 8 · 12 ·
pill) and five elevation levels; every enabled pointer target is at least 24 px;
every text node reads at 4.5:1 or better in Studio, Graphite and Bone; nothing
animates on a surface at rest; and the front-end never displays a state the engine
does not report.

Use the frontend token and component packages as the shared UI foundation:

- `frontend/packages/tokens/` — generated design tokens and docs
- `frontend/packages/design-system/` — shared shell primitives and layout components
- `frontend/app/src/` — selected operator surfaces

Extend tokens and shared components additively. Do not bypass the frontend design system with one-off styling unless the change is explicitly scoped and documented. Do not introduce a second name for a size, radius, duration or state word the A scale already names — `frontend/packages/tokens/src/validate-generated.mjs` fails the build if a retired alias comes back.

The workflow, the gate commands and the traps are in `docs/DEVELOPMENT.md §2c`.

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
- `npm run supply-chain:check` — `supply-chain:npm` (`npm audit` for every lockfile against `scripts/npm-audit-allowlist.json`, whose entries expire) then `supply-chain:cargo` (the review dates on `native/deny.toml`'s ignored advisories, then `cargo deny check`). Needs the network and `cargo-deny`; judges today's advisory databases, so it is a CI job and not part of `dev:check`. See `docs/DEVELOPMENT.md §4 Supply chain` before adding an exception — take the fix first, never `npm audit fix`.
- `npm run frontend:typecheck` — TypeScript typecheck for all npm workspaces that expose `typecheck`.
- `npm run frontend:test` — Vitest across all frontend workspaces (`@testing-library/react` for components; pure-logic unit tests).
- `npm run frontend:test:coverage` — the same suites of every frontend workspace with v8 coverage, the one run `dev:check` and CI make; fails under the floors in the app's, the design system's and the engine client's `vitest.config.ts` (measured minus two points — a ratchet, not a target; tokens and shared graphics have none yet). `scripts/frontend-test-gate.test.mjs` fails a workspace that has `test` but no `test:coverage`. See `docs/DEVELOPMENT.md §4 Coverage floors`.
- `npm run rust:fmt:check` — Rust formatting check under `native/`.
- `npm run rust:clippy` — Rust clippy for the native workspace with warnings denied by the command.
- `npm run rust:coverage` — `cargo llvm-cov --workspace` with the line-coverage floor in the script (the CI runner's figure minus two points). Needs `cargo-llvm-cov` and the `llvm-tools-preview` component; rebuilds the workspace instrumented, so it is the `rust-coverage` CI job and not part of `dev:check`.
- `npm run protocol:check` / `npm run protocol:generate` — check or regenerate protocol artifacts from `native/protocol/v1.contract.json`.
- `npm run dev:check` — full local code-health bundle, its steps side by side at below-normal priority (`scripts/dev-check.mjs`, about 20 s on the studio workstation): protocol, format, lint, script tests, file health, rustfmt, clippy, frontend typecheck, the frontend tests with their coverage floors, native tests. Each step logs to `node_modules/.cache/dev-check/`; a failed step's log tail is printed. `npm run dev:check:serial` runs the same steps one after another. (`native:check` left the bundle on 2026-09-25: `rust:clippy --workspace --all-targets` checks more.)
- `npm run ci` — repo-local convenience gate: format, release metadata check, native foundation.

Frontend and selected shell:

- `npm run frontend:tokens:build` — regenerate design token outputs.
- `npm run frontend:foundation` — protocol generation, tokens build, typecheck, Storybook build, fixture check, Playwright.
- `npm run frontend:playwright:test` — both builds, then every Playwright project. `frontend:playwright:test:blocking` is the `default` project alone (what CI fails on); `frontend:playwright:test:quarantine` is the wall-clock cases named in `frontend/app/tests/quarantine.json` (one worker, two retries, advisory on CI; the list is empty since production readiness S15, and the project then passes with no tests); `frontend:playwright:quarantine:check` holds that list short, explained and dated. See `docs/DEVELOPMENT.md §4 Quarantined Playwright cases` before listing a case — find the cause first.
- `node scripts/ui-census.mjs` (from `frontend/app`) — measure all 66 UI-contract boards; `--write-ratchets` re-seeds `frontend/app/tests/ui-contract.ratchets.json`. Takes ~4 minutes. See `docs/DEVELOPMENT.md §2c`.
- `node scripts/check-operator-copy.mjs` (from the repo root) — the operator-copy gate. Holds at 0.
- `npm run tauri:dev` — run the selected Tauri dev shell.
- `npm run tauri:build` — build the selected Tauri shell.
- `npm run tauri:foundation` — protocol generation, engine build, Tauri build, Tauri smoke.
- `npm run tauri:setup-support:qualify` and `npm run tauri:workspaces:qualify` — live shell qualification lanes; run serially because they bind fixed local ports.
- `npm run tauri:visual:review` — required visual evidence lane for operator-visible layout/presentation changes.

Native and release:

- `npm run native:check` — `cargo check --workspace` under `native/`.
- `npm run native:test` — `cargo test --workspace` under `native/` (excludes `#[ignore]` tests). Test builds drop every OSC datagram aimed at a TotalMix remote port (7001–7010), so the suite is safe to run on the studio workstation; `SSE_ENGINE_TEST_ALLOW_CONSOLE_WRITES=1` lifts that guard for a deliberate hardware-lane test only.
- `npm run native:test:dev-fixtures` — clippy and `cargo test` of the engine built with the `dev-fixtures` feature (the development parity-fixture method and its F04 guards); CI's `rust` job runs it. Its tests put a `dev-fixtures` engine at `native/target/debug`, the path packaging copies, so the lane ends by building the plain engine there again.
- `npm run native:test:hardware` — opt-in lane that runs `cargo test --workspace -- --ignored`, exercising device-bound tests against a connected RME UFX III / Stream Deck / TotalMix OSC host. CI does not run this; the operator workstation does. See `docs/DEVELOPMENT.md §Opt-in real-hardware lane`.
- `npm run native:engine:build` — build `studio-control-engine`. Run it before any lane or packaging step that uses the engine binary: `dev:check` leaves a test-time build in `native/target/debug`.
- `npm run native:engine:build:dev-fixtures` — the engine with the `dev-fixtures` cargo feature, the only build that answers `dev.parityFixture.load`; release engines and every lane but `native:test:dev-fixtures` (its own tests) run without it.
- `npm run native:package:win:local` / `native:package:mac:local` — rebuilds `release/native/<platform>/` from the built binaries, deleting what is there. On a workstation that runs the app from that folder (the studio workstation does) it is the installed app: move the folder aside first and put it back afterwards (the procedure is in `docs/plans/production-readiness-2026-09.md`). `npm run clean` keeps `release/native` whenever a packaged app is inside it; never pass `-- --include-release` there.
- `npm run native:foundation` — native shipping foundation lane.
- `npm run native:acceptance` — native acceptance lane. Runs the engine in simulated audio input mode, so it never writes to a console; `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1` is the workstation-only live lane (unused surfaces only, restored afterwards) — run it only when the studio is idle.
- `npm run release:preflight` — pre-12-stage-chain credential, tooling, disk, and network reachability check (run before `release:verify`).
- `npm run release:check` / `npm run release:verify` — release metadata and release verification (`release:verify` chains `release:preflight`).
- `npm run release:manifest` — write the chain-of-custody release manifest for a tag. Called from `release:publish`; standalone for evidence regeneration.
- `npm run release:notes` — emit the GitHub Release notes body (artifact hashes embedded from the manifest).
- `npm run release:publish` — publish artifacts + manifest to GitHub Releases for a tag.
- `npm run native:sbom:win:write` / `npm run native:sbom:mac:write` — CycloneDX SBOMs of what the packaged bundle carries, under `release/sbom/<target>/` (needs `cargo-cyclonedx` and `npm run native:sbom:tools:install`). The `release-evidence` workflow runs them; see `docs/RELEASE.md §Release Evidence`.
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

- Engine tests: `cargo test` under `native/rust-engine/`. `#[ignore]`-marked tests are hardware-bound and skipped by default; run them via `npm run native:test:hardware` on the operator workstation. The bridge's HTTP reader and the TotalMix OSC ingest also have `proptest` suites (`control_surface_http/fuzz.rs`, `rme_totalmix_osc/fuzz.rs`); a failing case leaves its seed under `native/rust-engine/proptest-regressions/` — commit it with the fix.
- Frontend unit/component tests: `npm run frontend:test` (Vitest + `@testing-library/react`). Specs colocated as `*.test.ts` / `*.test.tsx` under each workspace.
- Frontend Playwright + visual baselines: `npm run frontend:playwright:test`. `visual-review.spec.ts` commits `toHaveScreenshot` baselines under `frontend/app/tests/__visual__/visual-review.spec.ts-snapshots/` (per-platform `*-darwin.png` / `*-linux.png` / `*-win32.png` files; win32 is the studio workstation's local gate, linux is CI, darwin is refreshed on the macOS release host); the CI `frontend-e2e` job re-runs them and uploads diffs + the Playwright report as artifacts. `storybook.spec.ts` does the same for the Storybook static build. Both the behaviour specs and the visual lanes run against the built app (Playwright's `webServer` is `vite preview` over `frontend/app/dist`, reused when already running; the Storybook lane reads `storybook-static`), so after any frontend source edit run `npm run build --workspace frontend/app` (and `npm run frontend:storybook:build` for the Storybook lane) before `npx playwright test …`, or the specs exercise the previous build.
- UI contract: `frontend/app/tests/ui-contract.spec.ts` measures 66 boards (22 fixtures × 3 themes at 2560×1440) plus the Storybook primitive pages against system §10, ratcheted per board in `frontend/app/tests/ui-contract.ratchets.json` — a measure may fall, never rise. Three sibling gates run outside it: `scripts/check-operator-copy.mjs`, the design system's `css-literals.test.ts` allowlist, and the tokens package's `themes.contrast.test.ts`. `docs/DEVELOPMENT.md §2c` has the commands, the re-seed flow and the traps.
- Smoke / acceptance / bridge-qualification lanes: see `docs/DEVELOPMENT.md §2b` and §4.
- Each workspace is a chunk of its own: a spec whose first step after `openFixture` is a key or a one-shot DOM read calls `expectWorkspaceMounted(page, workspace)` first. A value that depends on the page's clock is pinned or driven with `page.clock`, never waited out with a fixed window; a Rust test that drives the shared console link waits on the link's state (`settle_console_link`), never on a sleep (`docs/DEVELOPMENT.md §2c` and "Engine changes").
- `npm run file:health` fails any source file over 2,000 lines and has no allowlist for source files (production readiness S14): split before a file gets there.
- **Never start an engine from this branch against the operator's app-data directory.** `npm run tauri:dev`, a release exe or `studio-control-engine.exe` started by hand need `SSE_APP_DATA_DIR` pointing at a scratch directory; the lanes, `native:test` and `rust:coverage` use temporary directories already. A newer build migrates the saved data (schema 7 since production readiness S11, schema 8 — Planning's tables and settings gone — since the new pages program's Slice 2) and older builds then refuse it.
- Target-host lanes: macOS and Windows native verification are both blocking release gates. Treat a Windows target-host failure the same as a macOS failure.

### CI validation lanes (`.github/workflows/dev-checks.yml`)

| Job                  | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format-protocol`    | `format:check`, `scripts:test`, `release:check`, `file:health`, `protocol:check`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `lint`               | `lint` (ESLint)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `frontend-typecheck` | `frontend:typecheck`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `frontend-test`      | `frontend:test:coverage` — Vitest across all frontend workspaces, once, with the coverage floors of the app, the design system and the engine client                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `frontend-e2e`       | The quarantine list's check, then `frontend:playwright:test:blocking` — Playwright's `default` project: every behaviour spec plus the visual-review and Storybook baselines — which is what the job fails on, then `frontend:playwright:test:quarantine` in a step that reports and never fails the job (the wall-clock cases named in `frontend/app/tests/quarantine.json` — none since production readiness S15). Uploads `playwright-report`, `playwright-test-results` (snapshot diffs and traces) and `playwright-quarantine` artifacts. Reviewers click through from the PR Checks tab; this is the visual-diff PR gate (Workstream A1). |
| `rust`               | `rust:fmt:check`, `rust:clippy`, `native:test`, `native:test:dev-fixtures`, `native:acceptance` (the harness runs the engine in simulated audio input mode by default, so the audio probe, sync and recall assertions run against the simulated console and nothing is ever written to a real TotalMix; `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1` is the workstation-only live lane, which writes only to unused surfaces and restores them)                                                                                                                                                                                                      |
| `rust-coverage`      | `rust:coverage` — the same `cargo test --workspace`, instrumented with `cargo llvm-cov`, failing under the line-coverage floor the script carries (this runner's figure minus two points). Test builds still drop every datagram aimed at a TotalMix remote port.                                                                                                                                                                                                                                                                                                                                                                              |
| `tauri-foundation`   | `tauri:foundation` (protocol generate → engine build → Tauri build → Tauri smoke)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `qualification`      | `tauri:setup-support:qualify` + `tauri:workspaces:qualify` under `xvfb`, with `SSE_TAURI_QUALIFICATION_TIMEOUT_MS=180000`, `LIBGL_ALWAYS_SOFTWARE=1`, and `SSE_TAURI_QUALIFICATION_SKIP_AUDIO_PROBE=1` (CI cannot supply live OSC). Starts with the other jobs and keeps a Rust cache of its own (the debug `test-bridge` shell the lanes run). Uploads `tauri-qualification-evidence` artifact.                                                                                                                                                                                                                                               |
| `supply-chain`       | `supply-chain:npm`, the review dates on `native/deny.toml`'s ignored advisories, and `cargo deny check` (advisories, bans, licenses, sources). Reads lockfiles only. It judges today's advisory databases, so it can turn red on a push that changed nothing — that is its job.                                                                                                                                                                                                                                                                                                                                                                |

A second workflow, `.github/workflows/release-evidence.yml`, runs on a `v*` tag or by hand: clean Windows and macOS runners build the packaged bundle, its SHA256 manifest and its CycloneDX SBOMs and keep them as run artifacts. It publishes nothing, builds no installer, and its signing step is dormant until certificate secrets exist.

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

- `native/rust-engine/src/legacy_import.rs` — one-way importer that reads a legacy Electron `db.json` on first native launch (env var `SSE_LEGACY_DB_PATH`). Do not touch it as part of new feature work; do not extend it; do not mirror it elsewhere. Since the new pages program's Slice 2 it carries only whether setup is complete and the page to open (the rest of a `db.json`, its Planning data included, is ignored), and the start-up auto-import runs only when the saved data holds no completed setup and no earlier import (an explicit `storage.importLegacyDb` over them needs `force`). It stays until that program's Slice 2b retires it together with `storage.importLegacyDb`, the start-up auto-import and `SSE_LEGACY_DB_PATH`, once the seven lanes and scripts that seed a test engine through it are seeded through the app's own requests.

## Generated and local-only files

- Protocol source of truth: `native/protocol/v1.contract.json` and `native/protocol/v1.md`. Generated outputs are `native/protocol/generated/v1.schema.json`, `frontend/packages/engine-client/src/generated/protocol.ts`, and `frontend/packages/engine-client/src/generated/snapshots/**`; update them with `npm run protocol:generate`.
- Token source of truth: `frontend/packages/tokens/src/tokens/**` (e.g. `core.json`), built by `frontend/packages/tokens/style-dictionary.config.mjs`. Generated outputs under `frontend/packages/tokens/src/generated/**` come from `npm run frontend:tokens:build`.
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

| For…                                    | Go to…                                                         |
| --------------------------------------- | -------------------------------------------------------------- |
| Runtime boundaries, shell/engine rules  | `docs/ARCHITECTURE.md`                                         |
| Workstation dimensions, device list     | `docs/HARDWARE_PROFILE.md`                                     |
| Operator task flows, keyboard shortcuts | `docs/OPERATIONS.md`                                           |
| Cold-start developer onboarding         | `docs/DEVELOPER_QUICKSTART.md`                                 |
| Daily build/test/package commands       | `docs/DEVELOPMENT.md`                                          |
| Release steps, acceptance checklist     | `docs/RELEASE.md`, `docs/PRODUCTIZATION_PLAN.md`               |
| Current engineering truth / open items  | `docs/HANDOFF.md`                                              |
| The visual system and its gates         | `docs/redesign/system-a-2026-09.md`, `docs/DEVELOPMENT.md §2c` |

If this file disagrees with any of the above, those docs win — this file is a pointer, not a spec.
