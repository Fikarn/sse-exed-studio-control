# Qt Fallback Retirement Audit

## Purpose

Checkpoint D of [FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md) requires a read-only impact audit and removal-sequence proposal before removing the retained Qt/QML fallback runtime.

This audit records the current dependency surface after the `v2.2.1` operator-workstation rollout passed and the bounded fallback window was closed in GitHub issue #3. It is scoped to planning the retirement work tracked in GitHub issue #5.

No Qt source, automation, installer dependency, or parity asset is removed by this audit.

## Plan Anchor

Current plan state:

- `Tauri 2 + React 19.2 + TypeScript + Vite` is the selected shipping runtime through the `native:*` release lane.
- `v2.2.1` is the current published operator-rollout build.
- The operator workstation verification passed with durable app data under `AppData\Roaming\ExEd Studio Control Native`.
- `native/qt-shell/` remains present only until Checkpoint D explicitly removes or archives it.
- QtIFW remains the installer/update wrapper unless a separate delta spec replaces it.
- Rust remains authoritative for state, persistence, device I/O, startup policy, recovery, support workflows, and protocol dispatch.

## Impact Map

### Qt Runtime Source

Tracked Qt runtime surface:

- `native/qt-shell/CMakeLists.txt`
- `native/qt-shell/src/EngineProcess.*`
- `native/qt-shell/src/main.cpp`
- `native/qt-shell/qml/**`
- `native/qt-shell/assets/**`
- `native/qt-shell/tests/qml/**`
- `native/CMakeLists.txt`, which currently only adds `qt-shell`

Observed scale:

- `native/qt-shell/` contains 114 tracked files.
- QML source plus QML tests account for 90 tracked files.

Risk if removed first:

- CMake configuration, QML tests, native smoke tests, native parity capture, and fallback runtime selection break immediately.

### Package Scripts And Local Gates

Qt-specific or Qt-dependent scripts in `package.json`:

- `native:shell:configure`
- `native:shell:build`
- `native:shell:test`
- `native:parity:capture`
- `native:parity:live`
- `native:build`
- `native:smoke`
- `native:smoke:*`
- `native:foundation`
- `ci`

Current behavior:

- `native:build` builds the Rust engine and Qt shell.
- `native:foundation` runs `native:check`, `native:test`, `native:build`, `native:shell:test`, and `native:smoke`.
- `ci` runs `format:check`, `release:check`, and `native:foundation`.

Risk if removed first:

- The default local foundation and CI scripts still expect the Qt shell. Removing `native/qt-shell` before replacing these gates would make the repository's primary validation path invalid.

### Release Runtime Selector

Current selector files:

- `scripts/native-release-runtime.json`
- `scripts/native-release-runtime.mjs`
- `scripts/native-release-build.mjs`

Current behavior:

- `scripts/native-release-runtime.json` selects `tauri` as `shippingRuntime`.
- The same file still records `fallbackRuntime: "qt"`.
- `SSE_NATIVE_RELEASE_RUNTIME=qt` can still force the old runtime before retirement lands.
- `native-release-runtime.mjs` still supports both `qt` and `tauri`.
- `native-release-build.mjs` runs `tauri:foundation` for Tauri and `native:build` for Qt.

Risk if removed first:

- The fallback override becomes a broken footgun unless the selector is made Tauri-only before source deletion.

### Packaging, Installer, Update, And Acceptance

Current packaging files with Qt branches or Qt assumptions:

- `scripts/native-package.mjs`
- `scripts/native-installer.mjs`
- `scripts/native-update-repo.mjs`
- `scripts/native-installer-acceptance.mjs`
- `scripts/native-packaged-acceptance.mjs`
- `scripts/verify-native-release-artifacts.mjs`
- `scripts/verify-native-release-continuity.mjs`
- `scripts/native-delivery-acceptance.mjs`
- `native/installer-templates/installscript.qs`
- `native/installer-templates/tauri-installscript.qs`

Current behavior:

- `native-package.mjs` has separate Qt and Tauri packaging branches.
- The Tauri branch is the current shipping path and packages `sse-exed-tauri-shell` plus `studio-control-engine`.
- The Qt branch still uses `macdeployqt`, `windeployqt`, `native/qt-shell/qml`, and `sse_exed_native`.
- `native-installer.mjs` chooses `tauri-installscript.qs` for the selected Tauri runtime and `installscript.qs` for Qt.
- `verify-native-release-continuity.mjs` preserves legacy release identity continuity and still contains a legacy Qt installer-description fallback for older tags.

Risk if removed first:

- The current Tauri release path should keep working, but stale Qt branches and fallback templates would remain and could fail only when manually selected. Retirement should remove the selector before removing these branches.

Important boundary:

- QtIFW is not the Qt shell. `binarycreator`, `repogen`, installer acceptance, update repository verification, continuity, rollback, and delivery checks remain part of the shipping release path until a separate installer/update replacement plan exists.

### Signing

Current signing files:

- `scripts/native-sign-macos.mjs`
- `scripts/native-sign-windows.mjs`

Observed state:

- macOS signing signs the packaged app path from release identity and is runtime-neutral.
- Windows signing currently hardcodes `sse_exed_native.exe` for the packaged shell.

Risk:

- Windows signing is currently deferred because no signing certificate is configured, so this does not block unsigned controlled deployment.
- Before any signed Windows release, `native-sign-windows.mjs` must be made runtime-aware and sign `sse-exed-tauri-shell.exe` for the Tauri path.

### Smoke, Parity, And Visual Evidence

Qt-specific automation:

- `scripts/native-smoke.mjs`
- `scripts/native-parity-capture.mjs`
- `scripts/native-live-parity.mjs`
- `scripts/live-operator-interact.swift` default app name `sse_exed_native`
- `scripts/native-shell-test.mjs`

Tracked parity assets:

- `artifacts/parity/native/workstation/**`
- `artifacts/parity/native/minimum/**`
- `artifacts/parity/native-onscreen/workstation/**`
- `artifacts/reference/legacy-oracle/**`

Current replacement-shell evidence:

- `npm run tauri:setup-support:qualify`
- `npm run tauri:workspaces:qualify`
- `npm run tauri:visual:review`
- `npm run frontend:foundation`
- `npm run tauri:foundation`
- target-host `native:release:*` evidence for the Tauri-selected shipping path

Risk if removed first:

- The repo would lose historical Qt parity references and the old live native verification commands before the replacement-shell validation language is fully reflected in `docs/DEVELOPMENT.md`, `CONTRIBUTING.md`, PR templates, and handoff docs.

### Docs And Governance

Docs still requiring Checkpoint D cleanup:

- `AGENTS.md`
- `CLAUDE.md`
- `CONTRIBUTING.md`
- `.github/pull_request_template.md`
- `README.md`
- `native/README.md`
- `docs/DEVELOPMENT.md`
- `docs/ARCHITECTURE.md`
- `docs/HANDOFF.md`
- `docs/FRONTEND_CUTOVER_PLAN.md`
- historical docs under `docs/archive/` and `docs/redesign/`

Current state:

- Core current-truth docs now say Tauri is selected and Qt remains only until Checkpoint D.
- Several developer workflow docs still present Qt commands as normal daily commands.
- Historical archive/redesign docs contain many Qt references that should remain archived unless they confuse active guidance.

Risk:

- Removing code before current docs are rewritten would create drift between the plan, the active commands, and the repository.

## Non-Removal Boundaries

Checkpoint D must not remove or weaken:

- `native/rust-engine/`
- `native/protocol/`
- `native/tauri-shell/`
- `frontend/`
- QtIFW installer/update tooling
- release identity and app identifiers
- app-data/log/update-repository continuity
- rollback guidance
- backup/restore/support workflows
- target-host macOS and Windows release evidence lanes

QtIFW can only be removed under a separate installer/update replacement plan with equivalent package, update, continuity, rollback, and clean-machine acceptance evidence.

## Proposed Removal Sequence

### Slice 1: Validation Lane Split

Goal: make active validation Tauri-first without deleting Qt yet.

Actions:

- Introduce or rename an active Tauri/native foundation command that represents the shipping runtime.
- Stop presenting Qt shell build/test/smoke commands as the normal development path.
- Update `ci` or equivalent local validation docs so the primary path no longer depends on Qt.
- Keep explicit Qt fallback commands available only as fallback-retirement inputs until later slices remove them.

Required verification:

- `npm run format:check`
- `npm run release:check`
- `npm run frontend:foundation`
- `npm run tauri:foundation`
- `npm run tauri:setup-support:qualify`
- `npm run tauri:workspaces:qualify`
- `npm run tauri:visual:review`

### Slice 2: Runtime Selector Lockdown

Goal: remove the ability to accidentally select Qt as a release runtime.

Actions:

- Remove `fallbackRuntime: "qt"` from `scripts/native-release-runtime.json`.
- Remove `SSE_NATIVE_RELEASE_RUNTIME=qt` support or make it fail with a clear retired-runtime message.
- Make `native-release-runtime.mjs` Tauri-only.
- Update docs that describe release-runtime selection.

Required verification:

- `npm run release:check`
- `npm run tauri:foundation`
- `npm run native:release:mac:local` on macOS with QtIFW tools
- `npm run native:release:win:evidence` on Windows 11 `x64` with QtIFW tools

### Slice 3: Packaging And Signing Cleanup

Goal: remove unused Qt packaging branches while preserving QtIFW distribution.

Actions:

- Remove Qt branches from `scripts/native-package.mjs`.
- Remove `native/installer-templates/installscript.qs` if no longer referenced.
- Keep `native/installer-templates/tauri-installscript.qs`.
- Make `native-sign-windows.mjs` sign `sse-exed-tauri-shell.exe` for the shipping payload.
- Remove stale Qt-only warning suppression and deploy-tool resolution code from Tauri-only packaging.

Required verification:

- `npm run native:release:mac:local`
- `npm run native:release:win:evidence`
- checksum verification from generated release assets
- install-time smoke status confirms durable app-data path when no `SSE_APP_DATA_DIR` is set

### Slice 4: Qt Shell Source And Test Removal

Goal: delete the fallback runtime after active lanes no longer depend on it.

Actions:

- Remove `native/qt-shell/**`.
- Remove or simplify `native/CMakeLists.txt`.
- Remove `scripts/native-build.mjs` and `scripts/native-shell-test.mjs` if no longer referenced.
- Remove `native:shell:*`, old Qt `native:build`, old Qt `native:smoke`, and old Qt parity script entries.
- Update `.gitignore`, docs, and PR checklist references.

Required verification:

- `git grep` must show no active current-truth references to removed commands or paths.
- Historical references under `docs/archive/` may remain if clearly archival.
- `npm run format:check`
- `npm run release:check`
- `npm run frontend:foundation`
- `npm run tauri:foundation`

### Slice 5: Parity Asset Retirement

Goal: archive or remove Qt parity assets after the active Tauri visual lane is documented as the replacement.

Actions:

- Decide whether `artifacts/parity/native/**` should be removed or moved under an archive path.
- Keep historical legacy oracle material only if it remains useful and is clearly marked as historical.
- Update `docs/DEVELOPMENT.md` to point active visual review to `npm run tauri:visual:review` plus BetterDisplay/fixed-monitor human review.

Required verification:

- `npm run tauri:visual:review`
- active docs contain no instruction to regenerate Qt parity baselines for new work

### Slice 6: Final Retirement Gate

Goal: prove the repository is Tauri-only while preserving release safety.

Actions:

- Run the full local shipping validation on macOS.
- Run Windows target-host release evidence on Windows 11 `x64`.
- Update `docs/FRONTEND_CUTOVER_PLAN.md`, `docs/HANDOFF.md`, `README.md`, `AGENTS.md`, and ADR notes to mark Checkpoint D complete.
- Close GitHub issue #5 only after evidence is attached.

Required verification:

- macOS `npm run native:release:mac:local`
- Windows `npm run native:release:win:evidence`
- published or draft release assets still install, launch, preserve data, and expose support backup export

## Recommended Next Slice

The next implementation slice should be Slice 1: Validation Lane Split.

Reason:

- It removes drift from the active developer workflow first.
- It does not delete fallback code prematurely.
- It creates a safe base for later selector, packaging, source, and artifact removal.
- It keeps rollback and target-host release evidence intact while the repository transitions from "Tauri selected with Qt fallback retained" to "Tauri-only".
