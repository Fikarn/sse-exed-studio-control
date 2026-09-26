# Developer Quickstart

This is the cold-start path for a senior engineer joining the project. It assumes no prior context beyond access to this repository.

## Goal

Within one hour, you should be able to:

- clone the repo and install dependencies
- understand the shell/engine boundary
- launch the selected Tauri app locally
- run the normal development checks
- know which release gates require the Windows target host
- avoid the historical Qt fallback path, which has been retired

## Architecture In One Minute

The app is a local-first desktop console for one fixed studio workstation: Windows, fullscreen at `2560x1440` on an external monitor, and nothing else (the operator's ruling of 2026-09-26).

- `frontend/` and `native/tauri-shell/` implement the selected Tauri 2 + React 19.2 + TypeScript + Vite operator shell.
- `native/rust-engine/` owns persistence, domain state, device policy, and device I/O.
- `native/protocol/` owns the IPC contract between shell and engine.
- React must not own product state, persistence, hardware policy, or database logic.
- Qt/QML fallback source and tests were retired in Checkpoint D. Qt Installer Framework still remains the installer/update wrapper.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) before changing runtime boundaries.

## Prerequisites

Required for normal development:

- Git
- Node.js 24 LTS recommended (`.nvmrc` is `24`; Node >=24 is accepted by the local doctor)
- npm
- Rust stable toolchain with `cargo` and `rustc`

Required for release packaging and target-host evidence:

- Qt Installer Framework tools: `binarycreator` and `repogen`
- Windows 11 `x64` host for release evidence

Public code signing is intentionally out of scope for this repo's current deployment model. GitHub Actions provides required pull-request hygiene; tagged release acceptance remains local and target-host based.

## First Clone

```bash
git clone https://github.com/Fikarn/sse-exed-studio-control.git
cd sse-exed-studio-control
nvm use 24
npm install
npm run doctor
```

If you do not use `nvm`, install Node 24 through your normal toolchain. `npm run doctor` will warn when the local Node major version differs from the target-host Node 24 baseline.

## Daily Development Loop

Start from a clean base:

```bash
git switch main
git pull --ff-only origin main
npm install
npm run doctor
```

Create a branch:

```bash
git switch -c feature-short-description
```

Run the fast local gate while working:

```bash
npm run dev:check
```

`dev:check` is the normal all-around local code-health gate. It runs the protocol artifact check, Prettier check, ESLint, repository script tests, the tracked-file health guard, Rust format check, clippy, frontend typecheck, the frontend tests with their coverage floors (Vitest, once) and native tests — side by side, at below-normal priority (`scripts/dev-check.mjs`). `npm run dev:check:serial` runs the same steps one after another at the normal priority; re-run a timing failure there before believing it.

Launch the selected app for visual review:

```bash
npm run tauri:visual:review
```

For real shell integration:

```bash
npm run tauri:foundation
npm run native:foundation
```

Do not run `tauri:setup-support:qualify`, `tauri:workspaces:qualify`, Playwright preview, or the frontend workspace dev/preview servers (`npm run dev --workspace frontend/app`, `npm run preview --workspace frontend/app`) concurrently. Those lanes use fixed localhost ports and concurrent servers make the evidence invalid.

## Visual Review

The production target is fullscreen `2560x1440` on the fixed studio monitor, and it is the only layout: judge operator-visible changes there. `npm run tauri:visual:review` is the repeatable capture lane, and `npm run frontend:playwright:test` on the studio workstation compares the win32 captures at `2560x1440` before each push (CI compares none; [DEVELOPMENT.md §2b](./DEVELOPMENT.md)).

## Validation Matrix

Use the smallest gate that covers the risk.

| Change type                       | Required local checks                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Docs/templates only               | `npm run format:check`                                                                   |
| New docs/assets or large files    | `npm run format:check`, `npm run file:health`                                            |
| Frontend package or React UI      | `npm run frontend:typecheck`, `npm run frontend:foundation` when behavior/layout changed |
| Protocol artifacts                | `npm run protocol:check`                                                                 |
| Rust engine logic                 | `npm run native:check`, `npm run native:test`                                            |
| Shell startup/integration         | `npm run tauri:foundation`, `npm run native:foundation`                                  |
| Operator-visible layout           | `npm run tauri:visual:review` plus fixed-monitor human review                            |
| Persistence/recovery/release risk | `npm run native:acceptance`, then target-host release gates if release-critical          |
| Release metadata or packaging     | `npm run release:verify` plus the Windows target-host release gates                      |

## Core Command Reference

Setup:

```bash
npm install
npm run doctor
npm run doctor:release
```

Format, lint, and typecheck:

```bash
npm run format:check
npm run format
npm run lint
npm run lint:fix
npm run file:health
npm run frontend:typecheck
npm run rust:fmt:check
npm run rust:clippy
```

Protocol and generated artifacts:

```bash
npm run protocol:check
npm run protocol:generate
```

Build and test:

```bash
npm run native:engine:build
npm run tauri:build
npm run native:shipping:build
npm run native:check
npm run native:test
npm run frontend:foundation
npm run tauri:foundation
npm run native:foundation
```

## Release And Target-Host Gates

Local development checks do not replace target-host evidence.

Use Windows 11 `x64` for:

```powershell
npm run native:release:win:evidence -- --issue-url <active-evidence-issue-url>
```

Before release evidence, run:

```bash
npm run doctor:release
```

`doctor:release` requires QtIFW tools and a clean worktree. It auto-detects the local `.tools/qt-ifw` layout; if QtIFW is somewhere else, expose it with `SSE_QT_IFW_BINARYCREATOR` and `SSE_QT_IFW_REPOGEN`.

## QtIFW Setup

Point the release lanes at the Windows QtIFW tools with these PowerShell environment variables:

```powershell
$env:SSE_QT_IFW_BINARYCREATOR = "C:\Qt\Tools\QtInstallerFramework\4.11\bin\binarycreator.exe"
$env:SSE_QT_IFW_REPOGEN = "C:\Qt\Tools\QtInstallerFramework\4.11\bin\repogen.exe"
```

## Cleanup

For normal generated build output:

```bash
npm run clean
```

For a deeper ignored-local cleanup before handoff or evidence collection:

```bash
npm run clean:local
```

`clean:local` removes ignored local debris such as generated build targets, root test results, local install logs, generated visual/evidence folders, and release output. It does not remove `.tools/`.

Both commands keep `release/native` when a packaged app is in it — on a workstation that runs Studio Control from the repository that folder is the installed app — and say so. `npm run clean -- --include-release` removes it too, and refuses while the app is running; `--dry-run` removes nothing. Details in [DEVELOPMENT.md §4a](./DEVELOPMENT.md).

## Dependency Policy

The active baseline is Node 24 LTS and TypeScript 6.0. Dependabot is allowed to propose routine npm and Cargo maintenance updates, but major TypeScript and `@types/node` upgrades are intentional engineering tasks, not background merges.

For major upgrades:

- open or use an engineering-task issue
- state the plan anchor and risk
- run `npm run dev:check`
- run affected foundation/release gates before merge
- update this quickstart when the baseline changes

## Troubleshooting

- `tauri:visual:review` or Playwright reports port conflicts: stop frontend dev/preview servers and rerun the lane serially.
- `doctor` warns about Node: use `nvm use 24` for target-host alignment.
- `doctor:release` fails on QtIFW: set `SSE_QT_IFW_BINARYCREATOR` and `SSE_QT_IFW_REPOGEN`.
- Windows evidence says the worktree is dirty: remove generated evidence or rerun only after committing/stashing source changes.

## Do Not Touch Without A Plan

- Do not move device policy, persistence, or product state into React.
- Do not reintroduce a Qt shell/fallback runtime without a new architecture decision.
- Do not change on-disk formats without an explicit migration and rollback plan.
- Do not treat GitHub Actions as release evidence; tagged release acceptance is local/target-host based.
- Do not add public code signing as part of normal feature work.
