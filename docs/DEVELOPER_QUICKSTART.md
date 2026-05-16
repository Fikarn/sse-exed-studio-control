# Developer Quickstart

This is the cold-start path for a senior engineer joining the project. It assumes no prior context beyond access to this private repository.

## Goal

Within one hour, you should be able to:

- clone the repo and install dependencies
- understand the shell/engine boundary
- launch the selected Tauri app locally
- run the normal development checks
- know which release gates require macOS or Windows target hosts
- avoid the historical Qt fallback path, which has been retired

## Architecture In One Minute

The app is a local-first desktop console for one fixed studio workstation.

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

- Qt Installer Framework 4.7 tools: `binarycreator` and `repogen`
- macOS Apple Silicon host for macOS release evidence
- Windows 11 `x64` host for Windows release evidence

Public signing, notarization, and GitHub Actions are intentionally out of scope for this repo's current deployment model.

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

`dev:check` is the normal all-around local code-health gate. It runs Prettier check, ESLint, Rust format check, clippy, protocol artifact check, frontend typecheck, native check, and native tests.

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

## Visual Review On Retina MacBooks

The production target is fullscreen `2560x1440` on a fixed second monitor. Retina MacBook logical resolution is not a valid layout authority.

For built-in-display development, use the scaled studio preview workflow from [DEVELOPMENT.md](./DEVELOPMENT.md):

- run the app with `npm run tauri:dev`
- open `⌘K` and run `Studio Preview: Enter 2560x1440 Review`
- review the proportional `2560x1440` studio canvas scaled into the current window
- exit scaled preview before judging native compact/windowed behavior
- keep `npm run tauri:visual:review` as the repeatable capture lane
- do not accept `studioFull` composition decisions from the unscaled Retina logical desktop

## Validation Matrix

Use the smallest gate that covers the risk.

| Change type                       | Required local checks                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| Docs/templates only               | `npm run format:check`                                                                   |
| Frontend package or React UI      | `npm run frontend:typecheck`, `npm run frontend:foundation` when behavior/layout changed |
| Protocol artifacts                | `npm run protocol:check`                                                                 |
| Rust engine logic                 | `npm run native:check`, `npm run native:test`                                            |
| Shell startup/integration         | `npm run tauri:foundation`, `npm run native:foundation`                                  |
| Operator-visible layout           | `npm run tauri:visual:review` plus scaled studio preview or fixed-monitor human review   |
| Persistence/recovery/release risk | `npm run native:acceptance`, then target-host release gates if release-critical          |
| Release metadata or packaging     | `npm run release:verify` plus macOS/Windows target-host release gates                    |

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

Use macOS Apple Silicon for:

```bash
npm run native:release:mac:local
```

Use Windows 11 `x64` for:

```powershell
npm run native:release:win:evidence -- --issue-url https://github.com/Fikarn/sse-exed-studio-control/issues/6
```

Before release evidence, run:

```bash
npm run doctor:release
```

`doctor:release` requires QtIFW paths and a clean worktree. If QtIFW is missing, it prints the exact `SSE_QT_IFW_BINARYCREATOR` and `SSE_QT_IFW_REPOGEN` setup instructions.

## QtIFW Setup

For local macOS installer packaging, install QtIFW into ignored local tooling:

```bash
python3 -m venv .tools/aqtinstall-venv
.tools/aqtinstall-venv/bin/python -m pip install --upgrade pip aqtinstall
mkdir -p .tools/aqt-home
HOME="$PWD/.tools/aqt-home" .tools/aqtinstall-venv/bin/aqt install-tool mac desktop tools_ifw qt.tools.ifw.47 -O .tools/qt-ifw
export SSE_QT_IFW_BINARYCREATOR="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.11/bin/binarycreator"
export SSE_QT_IFW_REPOGEN="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.11/bin/repogen"
```

On Windows, set the equivalent PowerShell environment variables:

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

`clean:local` removes ignored local debris such as `.DS_Store`, `.swift-module-cache`, generated build targets, generated visual/evidence folders, and release output. It does not remove `.tools/`.

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
- The app looks compressed on a Retina MacBook: do not judge `studioFull` composition until `Studio Preview: Enter 2560x1440 Review` is active, or until you are on the fixed studio monitor.

## Do Not Touch Without A Plan

- Do not move device policy, persistence, or product state into React.
- Do not reintroduce a Qt shell/fallback runtime without a new architecture decision.
- Do not change on-disk formats without an explicit migration and rollback plan.
- Do not introduce GitHub Actions gates; release evidence is local/target-host based.
- Do not add public signing/notarization as part of normal feature work.
