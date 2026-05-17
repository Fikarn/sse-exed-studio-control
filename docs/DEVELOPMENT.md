# Development

## Goal

This project should be developed as a production-grade local studio console, not as a casual prototype.

That means every change should aim for:

- operator reliability
- maintainable code structure
- clear UI behavior
- test coverage for meaningful risk
- disciplined Git history

## Project Priorities

When deciding what matters most, use this order:

1. Studio operations stability
2. Lighting, audio, and control-surface workflows
3. Data safety and recovery
4. UI clarity under pressure
5. Production planning features

If a change improves planning but risks studio reliability, studio reliability wins.

## Recommended Daily Workflow

### 1. Start from a clean base

Before doing any work:

```bash
git switch main
git pull origin main
npm install
npm run doctor
```

If you are starting a real feature or fix:

```bash
git switch -c feature-short-description
```

Use short branch names such as:

- `feature-lighting-scenes`
- `fix-audio-meter-polling`
- `chore-release-workflow`

### 2. Launch the app

For selected Tauri-shell visual review:

```bash
npm run tauri:visual:review
```

For shipping-runtime architecture work:

```bash
npm run native:check
npm run native:test
npm run native:foundation
npm run frontend:foundation
npm run tauri:foundation
npm run tauri:setup-support:qualify
npm run tauri:workspaces:qualify
npm run native:package:mac:local
npm run native:package:mac:smoke
npm run native:package:mac:clean-smoke
npm run native:package:win:local
npm run native:package:win:smoke
npm run native:package:win:clean-smoke
npm run native:installer:mac:prepare
npm run native:installer:mac:local
npm run native:installer:win:prepare
npm run native:installer:win:local
npm run native:update-repo:mac:prepare
npm run native:update-repo:mac:local
npm run native:update-repo:win:prepare
npm run native:update-repo:win:local
npm run native:release:mac:local
npm run native:release:win:local
npm run native:acceptance
```

`npm run native:foundation` is the active shipping-runtime foundation lane. It runs Rust engine checks/tests plus the selected Tauri foundation.

For the parallel frontend replatform foundation:

```bash
npm run protocol:generate
npm run dev:check
npm run frontend:tokens:build
npm run frontend:storybook
npm run frontend:foundation
npm run tauri:foundation
npm run tauri:setup-support:qualify
npm run tauri:workspaces:qualify
npm run tauri:visual:review
npm run tauri:cutover:candidate
npm run tauri:package:mac:ifw-staged
npm run tauri:package:mac:ifw-local
npm run tauri:package:win:ifw-staged
npm run tauri:package:win:ifw-local
npm run tauri:package:win:evidence
npm run native:release:win:evidence -- --issue-url https://github.com/Fikarn/sse-exed-studio-control/issues/6
```

`npm run tauri:setup-support:qualify` launches the real Tauri dev shell and covers the Setup/Support pilot, persisted restart, and degraded startup/recovery posture. `npm run tauri:workspaces:qualify` launches the same real shell and covers the commissioned dashboard plus live Lighting, Audio, and Planning mutations across restart persistence.

Both Tauri qualification lanes and Playwright preview use the fixed local port `127.0.0.1:4173` with strict port binding. Do not run them concurrently with each other or with the frontend workspace dev/preview servers (`npm run dev --workspace frontend/app`, `npm run preview --workspace frontend/app`); a stale or competing server makes the result invalid.

Both Tauri qualification commands write a `summary.json` evidence file. By default the summary is written to a temp directory and the path is printed. For target-host evidence capture, set `SSE_TAURI_QUALIFICATION_EVIDENCE_DIR=artifacts/tauri-qualification` before running the commands; this directory is intentionally ignored by git.

The promotion gate for the Tauri shipping switch lives in [FRONTEND_CUTOVER_PLAN.md](./archive/FRONTEND_CUTOVER_PLAN.md). Do not change shipping behavior, installer paths, or target-host gate status by inference; use that checklist as the cutover authority.

`npm run tauri:cutover:candidate` is the local Checkpoint A gate. It runs protocol checking, frontend foundation, Tauri foundation, Setup/Support qualification, workspace qualification, and visual review serially.

`npm run tauri:visual:review` is the repeatable replacement-shell visual evidence lane. It builds the React app, serves the fixture transport on `127.0.0.1:4173`, captures Setup/Support recovery plus Lighting, Audio, and Planning screenshots at `1280x800`, `1440x900`, `1600x960`, `1728x1117`, `1920x1080`, and `2560x1440` logical CSS pixels, writes ignored evidence under `artifacts/visual/tauri-cutover/`, and fails if any captured operator path requires page scroll. Lighting also asserts toolbar primary-control fit, compact overflow reachability, narrow inspector drawer behavior, stage minimum bounds, and CSS-viewport-driven layout mode selection. This complements, but does not replace, live human review with Scaled Studio Preview or the fixed studio monitor.

`npm run tauri:package:mac:ifw-staged` and `npm run tauri:package:win:ifw-staged` are Checkpoint C hardening lanes for historical/pre-switch replacement-shell evidence. They stage the Tauri shell and `studio-control-engine` side by side under `release/tauri-candidate/**`, run the packaged Tauri smoke test, prepare QtIFW installer/update-repository payloads under separate `release/tauri-candidate-installer/**` and `release/tauri-candidate-updates/**` roots, and verify staged payload parity. The switched shipping path is now the `native:*` release lane selected by `scripts/native-release-runtime.json`.

`npm run native:release:mac:local` and `npm run native:release:win:local` are the target-host shipping packaging gates for the selected runtime when QtIFW tools are installed. They build the packaged app, real offline installer with `binarycreator`, real maintenance-tool update repository with `repogen`, verify full artifacts, install through QtIFW, verify the installed shell launches against the bundled engine, verify the maintenance tool can see the package and repository, purge through the maintenance tool, reinstall, and verify operator data survives. `npm run tauri:package:mac:ifw-local` and `npm run tauri:package:win:ifw-local` remain candidate-evidence lanes under `release/tauri-candidate*`.

For local macOS QtIFW tools, install into ignored project tooling:

```bash
python3 -m venv .tools/aqtinstall-venv
.tools/aqtinstall-venv/bin/python -m pip install --upgrade pip aqtinstall
mkdir -p .tools/aqt-home
HOME="$PWD/.tools/aqt-home" .tools/aqtinstall-venv/bin/aqt install-tool mac desktop tools_ifw qt.tools.ifw.47 -O .tools/qt-ifw
export SSE_QT_IFW_BINARYCREATOR="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.7/bin/binarycreator"
export SSE_QT_IFW_REPOGEN="$PWD/.tools/qt-ifw/Tools/QtInstallerFramework/4.7/bin/repogen"
npm run native:release:mac:local
```

Use the matching Windows QtIFW tools on a Windows 11 `x64` host for `npm run native:release:win:evidence -- --issue-url <active-issue-url>` when collecting post-switch shipping evidence; it wraps `npm run native:release:win:local`, records host/tool/git/runtime context, writes logs, and stores the summary under `artifacts/native-release/windows-target-host/`. `npm run tauri:package:win:evidence -- --issue-url <active-issue-url>` remains useful for candidate evidence under `artifacts/tauri-qualification/windows-target-host/`. The runbook is [WINDOWS_TARGET_HOST_EVIDENCE.md](./WINDOWS_TARGET_HOST_EVIDENCE.md).

### 2b. Visual review

When the task changes any operator-visible selected Tauri surface, do not stop at code. Run the fixture-driven visual lane and inspect the result with the built-in scaled studio preview workflow or the fixed studio monitor:

```bash
npm run tauri:visual:review
```

Required selected-runtime workflow:

1. build and validate the selected Tauri shell
2. capture repeatable `1280x800`, `1440x900`, `1600x960`, `1728x1117`, `1920x1080`, and `2560x1440` visual evidence with `tauri:visual:review`
3. launch the real app when human inspection is needed
4. use **Studio Preview: Enter 2560x1440 Review** from the command palette to review the `2560x1440` studio canvas proportionally on the current display
5. compare against the intended operator state before accepting the change

Treat raw window width alone as an invalid authority for operator layout. The primary target is fullscreen `2560x1440` on the permanent second monitor.

Responsive operator modes are based on logical viewport/CSS pixels, not physical monitor pixels or Retina/Windows backing scale:

- `studioFull`: `>=1920x1080`, the full live-operation rail/stage/inspector layout.
- `desktopCompact`: `>=1440x900`, a compact three-pane layout with reduced chrome and overflowed secondary controls.
- `narrowUtility`: `>=1280x800`, a utility layout with rail + stage and a right inspector drawer.
- `constrained`: below `1280x800`, for development diagnostics only.

`1280x800` is supported for utility work, not as the full simultaneous show-control surface. Panel-level scroll inside rails, inspectors, or drawers is acceptable in compact modes; document-level scroll is not.

Do not accept stale live evidence. If the current Tauri visual review output or live screenshot does not clearly correspond to the operator state being checked, regenerate it before continuing.

#### Built-in display review on Retina Macs

Retina MacBook panels can have enough physical pixels for the target operator surface while still exposing a much smaller logical desktop. The current built-in 14-inch M5 display exposes roughly `1512x982` logical points at `2.0` backing scale (`3024x1964` backing pixels), so a native `2560x1440` logical Tauri window cannot fit on the desktop.

Use **Scaled Studio Preview** for normal built-in-display human review:

1. Build the Rust engine with `npm run native:engine:build` if `native/target/debug/studio-control-engine` is missing or stale, then run the app with `npm run tauri:dev`.
2. Open the command palette with `⌘K`.
3. Run `Studio Preview: Enter 2560x1440 Review`.
4. Review the proportional `2560x1440` studio canvas scaled into the current window.
5. Run `Studio Preview: Exit Review` before judging native compact/windowed behavior.

`npm run tauri:dev` starts Vite and the selected Tauri shell; it does not rebuild `studio-control-engine`. If the dev shell lands on Incident Recovery immediately after protocol or engine changes, run `npm run native:engine:build` and relaunch `npm run tauri:dev`.

Scaled Studio Preview deliberately preserves studio layout mode, aspect ratio, and proportions while reducing physical size. It is valid for composition, relative density, toolbar fit, rail/stage/inspector balance, drawer behavior, and operator flow inspection. It is not a substitute for real physical-size readability or final studio-monitor ergonomics.

Check the current machine state with the direct Swift probe:

```bash
swift -e 'import AppKit; import CoreGraphics; for screen in NSScreen.screens { if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber { let id = CGDirectDisplayID(truncating: number); if let mode = CGDisplayCopyDisplayMode(id) { print("id=\(id) frame=\(Int(screen.frame.width))x\(Int(screen.frame.height)) points=\(mode.width)x\(mode.height) pixels=\(mode.pixelWidth)x\(mode.pixelHeight) backing=\(Double(screen.backingScaleFactor)) builtin=\(CGDisplayIsBuiltin(id) != 0)") } } }'
```

Use native windowed mode on the built-in display for compact-mode interaction review. Do not sign off the `studioFull` operator composition from the unscaled native MacBook viewport; it is a compact logical surface, not the studio surface.

BetterDisplay flexible scaling or virtual-screen mirroring remains an optional fallback, not the standard workflow. Use it only when you specifically need an OS-level exact logical review surface.

Reference docs:

- Apple display resolution settings: <https://support.apple.com/en-afri/guide/mac-help/change-your-displays-resolution-mchl86d72b76/26/mac/26>
- Apple high-resolution rendering model: <https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Explained/Explained.html>
- BetterDisplay flexible scaling and virtual-screen workflow: <https://github.com/waydabber/BetterDisplay/wiki/Fully-scalable-HiDPI-desktop>

### 3. Implement in small batches

Prefer scoped, reviewable changes over sweeping rewrites. For larger work, break it into: analysis + plan, first implementation slice, validation, follow-up polish.

### 4. Run the right level of validation

Match the checks to the risk.

#### Selected Tauri shell or frontend tweaks

```bash
npm run format:check
npm run frontend:foundation
npm run tauri:foundation
```

#### Engine changes

```bash
npm run native:check
npm run native:test
npm run native:engine:build
```

#### Changes affecting operator flows

```bash
npm run native:foundation
```

#### Changes affecting native release or packaging

```bash
npm run native:acceptance
npm run release:verify
```

#### Release preparation

```bash
npm run doctor:release
npm run release:verify
```

#### Pull Request CI

Every pull request triggers the four-job workflow at [.github/workflows/dev-checks.yml](../.github/workflows/dev-checks.yml): `format-protocol`, `lint`, `frontend-typecheck`, and `rust`. `format-protocol` runs `format:check`, repository script tests, `release:check`, `file:health`, and `protocol:check`; `rust` runs `rust:fmt:check`, `rust:clippy`, `native:check`, and `native:test`. These jobs are required merge hygiene on `main`. Target-host release evidence on macOS Apple Silicon and Windows 11 `x64` remains the release acceptance gate per [HANDOFF.md §Validation Baseline](./HANDOFF.md). Treat any red CI job the same way you would treat the same command failing locally before pushing.

### 4a. Cleanup

Use the normal cleanup command for generated build and release output:

```bash
npm run clean
```

Use the deeper local cleanup before handoff or evidence collection:

```bash
npm run clean:local
```

`clean:local` removes ignored local debris such as `.DS_Store`, `.swift-module-cache`, generated build targets, root test results, local install logs, generated visual/evidence folders, and release output. It intentionally does not remove `.tools/`.

## Recommended Development Rules

### 1. Always preserve working software

Prefer incremental change over rewrites.

### 2. Follow existing domain boundaries

Keep changes in the correct layer:

- `frontend/...` for the selected React/Storybook/Playwright frontend
- `native/tauri-shell/...` for the selected native shell
- `native/rust-engine/src/...` for domain state, persistence, and device logic
- `native/protocol/...` for IPC contract changes
- `docs/...` for process and operator documentation

### 3. Validate write paths carefully

If a change mutates state:

- validate input
- handle errors clearly
- add or update tests

### 4. Protect operator workflows

Anything that touches:

- light output
- audio control
- startup
- shutdown
- backups
- setup/commissioning

should be treated as high risk and tested more carefully.

### 5. Keep files modular

If a file starts becoming hard to read, split it before it becomes a problem.

### 6. Update docs when behavior changes

Update documentation when you change:

- release flow
- startup/shutdown behavior
- setup steps
- operator recovery paths
- architecture patterns

## Definition Of Done

A change is done when:

- the code works
- the code is understandable
- the right tests pass
- the UI is coherent
- the docs are updated if needed
- Git history is clean

## Git Workflow

### Normal feature work

```bash
git switch main
git pull origin main
git switch -c feature-short-description
```

Then:

```bash
git status
git add -A
git commit -m "feat: short description"
git push -u origin feature-short-description
```

Open a PR for reviewable work. Do not consider a session fully closed just because the PR exists or is green. The normal closeout is:

1. push the branch
2. open the PR as draft while validation or human review is still in progress
3. mark the PR ready only after the relevant validation and review are complete
4. merge the approved PR through GitHub
5. prune deleted remotes, switch back to `main`, fast-forward from `origin/main`, and delete the local feature branch
6. verify `git status -sb` shows clean `main...origin/main`

### Recommended commit types

- `feat:` new capability
- `fix:` bug fix
- `refactor:` structure change without feature change
- `docs:` documentation only
- `chore:` tooling, workflow, housekeeping
- `release:` version prep

## Testing Strategy

### Use engine `cargo test` for:

- persistence behavior
- domain logic
- protocol contract validation
- regression coverage

### Use Tauri frontend and shell tests for:

- selected operator UI behavior
- selected shell integration
- fixture-driven visual review
- Playwright-covered workspace behavior

### Use Tauri smoke / native acceptance / bridge-qualification lanes for:

- startup and recovery changes
- lifecycle, routing, and clean-start coverage
- packaging or installer changes
- native diagnostics, backup, or update-path changes
- control-surface bridge bind/listen/HTTP changes

## Release Workflow

Release details live in [docs/RELEASE.md](./RELEASE.md), but the short version is:

1. bump version
2. update changelog
3. run `npm run release:verify`
4. commit release prep
5. push `main`
6. create and push tag
7. publish the locally built target-host artifacts with `npm run release:publish -- --tag vX.Y.Z`
