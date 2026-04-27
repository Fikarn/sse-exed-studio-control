# Qt Fallback Retirement Audit (archived 2026-04-27)

> Archived after Checkpoint D Qt fallback retirement completed and was recorded against tag `d0205ba`. The audit and removal sequence are preserved here for historical reference. Current architecture (Tauri-only) is documented in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/HANDOFF.md`](../HANDOFF.md).

## Purpose

Checkpoint D of [FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md) required a read-only impact audit and removal-sequence proposal before removing the retained Qt/QML fallback runtime.

This audit records the current dependency surface after the `v2.2.1` operator-workstation rollout passed and the bounded fallback window was closed in GitHub issue #3. It is scoped to planning the retirement work tracked in GitHub issue #5.

This document now tracks the bounded removal sequence after the initial audit. QtIFW installer/update infrastructure is intentionally retained.

## Plan Anchor

Current plan state:

- `Tauri 2 + React 19.2 + TypeScript + Vite` is the selected shipping runtime through the `native:*` release lane.
- `v2.2.1` is the current published operator-rollout build.
- The operator workstation verification passed with durable app data under `AppData\Roaming\ExEd Studio Control Native`.
- The Qt fallback source/test tree is removed through Slice 4.
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
- The same file no longer records `fallbackRuntime: "qt"`.
- `SSE_NATIVE_RELEASE_RUNTIME=qt` now fails with a retired-runtime message before release packaging starts.
- `native-release-runtime.mjs` supports `tauri` only for the release path.
- `native-release-build.mjs` runs `tauri:foundation` through the selected Tauri release runtime.

Risk if removed first:

- The fallback override becomes a broken footgun unless the selector is made Tauri-only before source deletion.

### Packaging, Installer, Update, And Acceptance

Packaging and installer files audited by Slice 3:

- `scripts/native-package.mjs`
- `scripts/native-installer.mjs`
- `scripts/native-update-repo.mjs`
- `scripts/native-installer-acceptance.mjs`
- `scripts/native-packaged-acceptance.mjs`
- `scripts/verify-native-release-artifacts.mjs`
- `scripts/verify-native-release-continuity.mjs`
- `scripts/native-delivery-acceptance.mjs`
- `native/installer-templates/tauri-installscript.qs`

Current behavior:

- `native-package.mjs` is Tauri-only for the shipping path and packages `sse-exed-tauri-shell` plus `studio-control-engine`.
- Qt deploy-tool resolution, Qt plugin staging, Qt warning suppression, and `sse_exed_native` packaging branches are removed from the shipping package script.
- `native-installer.mjs` always stages `native/installer-templates/tauri-installscript.qs` as the QtIFW package `installscript.qs`.
- The old Qt installer template `native/installer-templates/installscript.qs` is removed.
- `verify-native-release-continuity.mjs` preserves legacy release identity continuity and still contains a legacy Qt installer-description fallback for older tags.

Remaining risk before source deletion:

- Windows target-host evidence must verify the Tauri-only packaging/signing path before removing `native/qt-shell/**` or Qt-specific verification automation.

Important boundary:

- QtIFW is not the Qt shell. `binarycreator`, `repogen`, installer acceptance, update repository verification, continuity, rollback, and delivery checks remain part of the shipping release path until a separate installer/update replacement plan exists.

### Signing

Current signing files:

- `scripts/native-sign-macos.mjs`
- `scripts/native-sign-windows.mjs`

Observed state:

- macOS signing signs the packaged app path from release identity and is runtime-neutral.
- Windows signing now targets `sse-exed-tauri-shell.exe` for the packaged Tauri shell.

Risk:

- Windows signing is currently deferred because no signing certificate is configured, so this does not block unsigned controlled deployment.
- Before any signed Windows release, `native-sign-windows.mjs` must still be exercised on a Windows signing host with a real certificate configuration.

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
- historical `artifacts/reference/legacy-oracle/**` captures, now retired from the working tree and available only through git history

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

Status: complete. `npm run native:foundation` now delegates to the Tauri-first shipping foundation lane. The temporary retained Qt fallback validation path was removed in Slice 4.

Goal: make active validation Tauri-first without deleting Qt yet.

Actions:

- Introduce or rename an active Tauri/native foundation command that represents the shipping runtime.
- Stop presenting Qt shell build/test/smoke commands as the normal development path.
- Update `ci` or equivalent local validation docs so the primary path no longer depends on Qt.
- Keep explicit Qt fallback commands available only as fallback-retirement inputs until later slices remove them. Slice 4 removed them.

Required verification:

- `npm run format:check`
- `npm run release:check`
- `npm run frontend:foundation`
- `npm run tauri:foundation`
- `npm run tauri:setup-support:qualify`
- `npm run tauri:workspaces:qualify`
- `npm run tauri:visual:review`

### Slice 2: Runtime Selector Lockdown

Status: complete. The release runtime selector is Tauri-only, `fallbackRuntime` is removed from `scripts/native-release-runtime.json`, and `SSE_NATIVE_RELEASE_RUNTIME=qt` fails with a clear retired-runtime message.

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

Status: complete. The local macOS release path passes through package smoke, clean smoke, packaged acceptance, bridge verification, real QtIFW installer generation, update-repository generation, full checksum/artifact verification, continuity verification, delivery acceptance, and real installer acceptance. Windows 11 `x64` target-host evidence passed for commit `437272a4db189a4bbb38f61cf2eb05c6b86e8d0c` with summary `artifacts/native-release/windows-target-host/2026-04-24T23-42-23-439Z/summary.json`.

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

macOS verification recorded during implementation:

- `npm run native:release:mac:local` with QtIFW env and normal host permissions for localhost binding/cache access
- `npm run native:package:mac:smoke`
- `npm run native:installer:mac:local`
- `npm run native:update-repo:mac:local`
- `npm run native:checksums:mac:write`
- `npm run native:artifacts:mac:verify`
- `npm run native:continuity:mac:verify`
- `npm run native:delivery:mac:verify`
- `npm run native:installer-acceptance:mac:verify` with normal host permissions for QtIFW cache access

Windows verification recorded during implementation:

- `npm run native:release:win:evidence` on Windows 11 `x64` with QtIFW tools
- SHA256 manifest:
  - `803c7602653da45a996d7ce49267dd89cdff8505adc9be1de82ca4961182d613  SSE-ExEd-Studio-Control-Native-windows.zip`
  - `a48e6d79c255be9e95f570bc30e85465de7de02aae90cc4b9fce3be1638b1fa0  SSE-ExEd-Studio-Control-Native-windows-Installer.exe`
  - `43fc01c8d5609a98566955cb5ed7d2b84612786cfe879c191e420de23375376b  SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip`

### Slice 4: Qt Shell Source And Test Removal

Status: complete. The Qt source/test tree, root Qt CMake entrypoint, Qt-only helper scripts, package scripts, active docs references, and PR checklist entry were removed. QtIFW installer/update tooling was not removed.

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

Verification recorded during implementation:

- `git diff --check`
- `node --check scripts/native-installer-acceptance.mjs`
- `node --check scripts/native-release-runtime.mjs`
- `node --check scripts/native-runtime-harness.mjs`
- `node --check scripts/release/verify-native-release.mjs`
- `npm run format:check`
- `npm run release:check`
- `npm run frontend:storybook:build` after an initial stuck Storybook subprocess was killed and rerun cleanly
- `npm run frontend:foundation`
- `npm run tauri:foundation` after an initial stuck Vite subprocess was killed and rerun cleanly
- `npm run native:foundation`

### Slice 5: Parity Asset Retirement

Status: complete. Historical Qt parity screenshots under `artifacts/parity/native/**` and `artifacts/parity/native-onscreen/**` were removed instead of moved to another tracked archive path. The active replacement is `npm run tauri:visual:review` plus BetterDisplay/fixed-monitor human review; historical context remains in frozen docs and git history.

Goal: archive or remove Qt parity assets after the active Tauri visual lane is documented as the replacement.

Actions:

- Remove `artifacts/parity/native/**` instead of moving it under another tracked archive path.
- Keep historical legacy oracle material only if it remains useful and is clearly marked as historical.
- Update `docs/DEVELOPMENT.md` to point active visual review to `npm run tauri:visual:review` plus BetterDisplay/fixed-monitor human review.

Required verification:

- `npm run tauri:visual:review`
- active docs contain no instruction to regenerate Qt parity baselines for new work

Verification recorded during implementation:

- `npm run tauri:visual:review` passed with 10 screenshots and summary `artifacts/visual/tauri-cutover/fixture-viewport-summary.json`
- active current-truth grep found no instructions to regenerate Qt parity baselines or run removed Qt parity commands

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

Verification recorded during implementation:

- macOS `npm run native:release:mac:local` passed on commit `d0205baf52ce02d7d4d24699facd202f3bbba217`
- Windows 11 `x64` `npm run native:release:win:evidence` passed on commit `d0205baf52ce02d7d4d24699facd202f3bbba217`
- Windows evidence summary: `artifacts/native-release/windows-target-host/2026-04-25T07-32-31-463Z/summary.json`
- Windows SHA256 manifest:
  - `5ed99250f93045d9321027e48a38bff7a57b7d7313b026f4dd0d6ef1623d2392  SSE-ExEd-Studio-Control-Native-windows.zip`
  - `bc472ec40a687b39bb01dc8689c684c1e1a50578a7328a7efdc3d6fbf9d7689b  SSE-ExEd-Studio-Control-Native-windows-Installer.exe`
  - `441d84c88bc9b5139f033f16a5e52b4b3cf9b36864d9b1460da12be435693237  SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip`

## Completion Record

Checkpoint D is complete as of commit `d0205baf52ce02d7d4d24699facd202f3bbba217`.

Reason:

- Slice 1 made active validation Tauri-first.
- Slice 2 removed the release-runtime footgun.
- Slice 3 removed unused Qt packaging/signing branches while preserving QtIFW.
- Slice 4 removed Qt fallback source, tests, and launch automation.
- Slice 5 removed obsolete Qt parity assets and left active visual review on the Tauri lane.
- Slice 6 proved full macOS local shipping validation plus Windows target-host release evidence before marking Checkpoint D complete.
