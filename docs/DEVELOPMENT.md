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

`npm run native:foundation` is the active shipping-runtime foundation lane. It runs Rust engine checks/tests plus the selected Tauri foundation. `npm run native:qt:foundation` is retained only for Checkpoint D fallback-retirement work. On macOS, the Qt fallback build auto-detects common Homebrew Qt prefixes. On Windows or custom Qt installs, set `CMAKE_PREFIX_PATH`, `QT_ROOT_DIR`, `QTDIR`, `QT_DIR`, or `Qt6_DIR` if Qt is not discovered automatically.

For the parallel frontend replatform foundation:

```bash
npm run protocol:generate
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
npm run native:release:win:evidence
```

During Checkpoint D, treat the Qt shell as fallback-retirement-only unless the task is a fallback release blocker, release-verification fix, or critical operator defect.

`npm run tauri:setup-support:qualify` launches the real Tauri dev shell and covers the Setup/Support pilot, persisted restart, and degraded startup/recovery posture. `npm run tauri:workspaces:qualify` launches the same real shell and covers the commissioned dashboard plus live Lighting, Audio, and Planning mutations across restart persistence.

Both Tauri qualification lanes and Playwright preview use the fixed local port `127.0.0.1:4173` with strict port binding. Do not run them concurrently with each other, `npm run preview`, or `npm run dev`; a stale or competing server makes the result invalid.

Both Tauri qualification commands write a `summary.json` evidence file. By default the summary is written to a temp directory and the path is printed. For target-host evidence capture, set `SSE_TAURI_QUALIFICATION_EVIDENCE_DIR=artifacts/tauri-qualification` before running the commands; this directory is intentionally ignored by git.

The promotion gate for the Tauri shipping switch lives in [FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md). Do not change shipping behavior, installer paths, or target-host gate status by inference; use that checklist as the cutover authority.

`npm run tauri:cutover:candidate` is the local Checkpoint A gate. It runs protocol checking, frontend foundation, Tauri foundation, Setup/Support qualification, workspace qualification, and visual review serially.

`npm run tauri:visual:review` is the repeatable replacement-shell visual evidence lane. It builds the React app, serves the fixture transport on `127.0.0.1:4173`, captures Setup/Support recovery plus Lighting, Audio, and Planning screenshots at `2560x1440` and `1920x1080`, writes ignored evidence under `artifacts/visual/tauri-cutover/`, and fails if any captured operator path requires page scroll. This complements, but does not replace, live human review on the BetterDisplay-backed `2560x1440` surface or the fixed studio monitor.

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

Use the matching Windows QtIFW tools on a Windows 11 `x64` host for `npm run native:release:win:evidence` when collecting post-switch shipping evidence; it wraps `npm run native:release:win:local`, records host/tool/git/runtime context, writes logs, and stores the summary under `artifacts/native-release/windows-target-host/`. `npm run tauri:package:win:evidence` remains useful for candidate evidence under `artifacts/tauri-qualification/windows-target-host/`. The runbook is [WINDOWS_TARGET_HOST_EVIDENCE.md](./WINDOWS_TARGET_HOST_EVIDENCE.md).

### 2b. Visual review and retained Qt parity

When the task changes any operator-visible selected Tauri surface, do not stop at code. Run the fixture-driven visual lane and inspect the result on the BetterDisplay-backed `2560x1440` review surface or the fixed studio monitor:

```bash
npm run tauri:visual:review
```

Required selected-runtime workflow:

1. build and validate the selected Tauri shell
2. capture repeatable `2560x1440` and `1920x1080` visual evidence with `tauri:visual:review`
3. launch the real app fullscreen when human inspection is needed
4. interact with the live app directly when the workflow being checked depends on it
5. compare against the intended operator state before accepting the change

The older Qt parity commands are retained only for Checkpoint D fallback-retirement work. Do not use them as the active Tauri acceptance gate.

Retained Qt live verify actions include:

- `planning-empty`
- `planning-populated`
- `project-detail-open`
- `time-report-open`
- `open-shortcuts`
- `open-about`
- `lighting-populated`
- `lighting-add-open`
- `lighting-edit-open`
- `lighting-delete-open`
- `lighting-scene-delete-open`
- `lighting-scene-rename-open`
- `lighting-group-rename-open`
- `lighting-group-delete-open`
- `audio-populated`
- `setup-required`
- `setup-ready`
- `support-open`
- `setup-control-selected`
- `setup-control-page-nav`
- `setup-control-dial-selected`

Treat raw window width alone as an invalid authority for operator layout. The primary target is fullscreen `2560x1440` on the permanent second monitor.

Do not accept stale live evidence. If the current native screenshot does not clearly correspond to the deterministic capture being compared, regenerate it before continuing.

For the retained Qt live verification loop, use:

```bash
npm run native:parity:live -- --action=planning-populated
```

Useful variants:

```bash
npm run native:parity:live -- --action=project-detail-open
npm run native:parity:live -- --action=open-shortcuts
npm run native:parity:live -- --action=open-about
npm run native:parity:live -- --action=lighting-populated
npm run native:parity:live -- --action=lighting-add-open
npm run native:parity:live -- --action=lighting-edit-open
npm run native:parity:live -- --action=lighting-scene-delete-open
npm run native:parity:live -- --action=lighting-scene-rename-open
npm run native:parity:live -- --action=setup-control-selected
npm run native:parity:live -- --action=setup-control-page-nav
npm run native:parity:live -- --action=setup-control-dial-selected
npm run native:parity:live -- --action=planning-populated --interaction=key:N
```

That retained Qt command:

1. launches the local Qt native build
2. waits for a machine-readable ready-for-screenshot signal from the app
3. optionally drives a checked-in live interaction
4. captures the real native window

The live interaction helper targets the native app window directly. Do not rely on current mouse position as the authority for the second-monitor operator surface.

#### Built-in display review on Retina Macs

Retina MacBook panels can have enough physical pixels for the target operator surface while still exposing a much smaller logical desktop. Treat the built-in panel as a review surface only when it is explicitly configured for that purpose.

Check the current machine state with the direct Swift probe:

```bash
swift -e 'import AppKit; import CoreGraphics; for screen in NSScreen.screens { if let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber { let id = CGDirectDisplayID(truncating: number); if let mode = CGDisplayCopyDisplayMode(id) { print("id=\(id) frame=\(Int(screen.frame.width))x\(Int(screen.frame.height)) points=\(mode.width)x\(mode.height) pixels=\(mode.pixelWidth)x\(mode.pixelHeight) backing=\(Double(screen.backingScaleFactor)) builtin=\(CGDisplayIsBuiltin(id) != 0)") } } }'
```

On the current 14-inch M5 workstation, this reports the built-in panel as `1512x982` points at `2.0` backing (`3024x1964` pixels), which is why the app looks compressed without a dedicated review workflow.

Recommended built-in-display workflow:

1. **Preferred:** use `BetterDisplay` flexible scaling on the built-in display. The current vendor docs explicitly support built-in Apple Silicon panels and flexible scaling on internal displays.
2. Configure the built-in panel for an exact `2560x1440` review mode if the flexible-scaling list exposes it.
3. If flexible scaling does not produce a stable exact target, use `BetterDisplay` virtual-screen mirroring instead:
   - create a virtual screen associated with the built-in display,
   - enable HiDPI for that virtual screen,
   - include `2560x1440` in the virtual resolution list,
   - mirror the virtual screen to the built-in panel,
   - set the mirrored set as main.
4. If the virtual mirror reverses direction or loses main-display status, stop mirroring and reattach it. `BetterDisplay` documents this as a macOS display-management quirk rather than an app-specific bug.
5. Use the built-in panel only for human visual inspection. The acceptance gate remains the deterministic `2560x1440` capture set plus the checked-in live verification loop above.

Reference docs:

- Apple display resolution settings: <https://support.apple.com/en-afri/guide/mac-help/change-your-displays-resolution-mchl86d72b76/26/mac/26>
- Apple high-resolution rendering model: <https://developer.apple.com/library/archive/documentation/GraphicsAnimation/Conceptual/HighResolutionOSX/Explained/Explained.html>
- BetterDisplay flexible scaling and virtual-screen workflow: <https://github.com/waydabber/BetterDisplay/wiki/Fully-scalable-HiDPI-desktop>

For retained Qt fallback startup, lifecycle, and failure coverage during Checkpoint D:

```bash
npm run native:smoke:clean-start
npm run native:smoke:restart:clean-start
npm run native:smoke:lifecycle
npm run native:smoke:protocol-mismatch
npm run native:smoke:runtime-dir-failure
npm run native:smoke:corrupt-storage
npm run native:smoke:watchdog-timeout
```

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

#### Retained Qt fallback changes

```bash
npm run native:qt:foundation
```

#### Changes affecting native release or packaging

```bash
npm run native:acceptance
npm run release:verify
```

#### Release preparation

```bash
npm run release:verify
```

## Recommended Development Rules

### 1. Always preserve working software

Prefer incremental change over rewrites.

### 2. Follow existing domain boundaries

Keep changes in the correct layer:

- `native/qt-shell/qml/...` for operator UI
- `native/qt-shell/src/...` for fallback shell lifecycle and QML adapters
- `native/rust-engine/src/...` for domain state, persistence, and device logic
- `native/protocol/...` for IPC contract changes
- `frontend/...` for the selected React/Storybook/Playwright frontend
- `native/tauri-shell/...` for the selected native shell
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

If you want a PR, open one before merging.

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

### Use retained Qt shell QML tests for:

- QML module wiring
- fallback shell-level view-model behavior during Checkpoint D

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
