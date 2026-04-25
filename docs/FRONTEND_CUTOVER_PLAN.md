# Frontend Cutover Plan

## Purpose

This document defines the acceptance gate for promoting the `Tauri 2 + React 19.2 + TypeScript + Vite` replacement shell from parallel migration track to shipping runtime.

It does not authorize cutover by itself. It records the conditions that must be true before the Qt shell can stop being the product runtime.

## Sources Of Authority

- [ADR 0001: Frontend Replatform Foundation](./adr/0001-frontend-replatform.md)
- [Architecture](./ARCHITECTURE.md)
- [Development](./DEVELOPMENT.md)
- [Handoff](./HANDOFF.md)
- [Hardware Profile](./HARDWARE_PROFILE.md)
- [Protocol v1](../native/protocol/v1.md)

If this document conflicts with those files, fix the conflict before continuing.

## Current State

- `scripts/native-release-runtime.json` now selects `tauri` as the shipping release runtime.
- `native/tauri-shell/` plus `frontend/` are the selected replacement shell track for the shipping release path.
- The Qt fallback source/test tree has been removed through Checkpoint D Slice 4; QtIFW remains the installer/update wrapper.
- The Rust engine remains authoritative for state, persistence, device I/O, startup policy, recovery behavior, and support workflows.
- `Setup/Support`, `Lighting`, `Audio`, and `Planning` have replacement-shell coverage in fixture, Playwright, and live Tauri qualification lanes.
- `npm run tauri:setup-support:qualify` covers clean startup, setup/support flows, persisted restart, and bootstrap-failure recovery posture.
- `npm run tauri:workspaces:qualify` covers commissioned startup plus live Lighting, Audio, and Planning mutations across restart persistence.
- `npm run tauri:visual:review` captures repeatable replacement-shell fixture screenshots at `2560x1440` and `1920x1080` for Setup/Support recovery, Lighting, Audio, and Planning, and fails on app-level scroll.
- GitHub Actions is not the acceptance mechanism for this cutover. Replacement-shell promotion is gated by local/target-host evidence captured on the macOS Apple Silicon and Windows 11 `x64` release hosts.
- The live Tauri qualification commands remain local/manual cutover-readiness gates until documented target-host evidence exists for the candidate release.
- `npm run tauri:package:mac:ifw-staged` and `npm run tauri:package:win:ifw-staged` remain historical/pre-switch candidate evidence lanes under separate `release/tauri-candidate*` roots.
- The shipping release path is now the `native:*` release lane, which packages the runtime selected by `scripts/native-release-runtime.json` into `release/native*`.
- macOS Apple Silicon and Windows 11 `x64` post-switch release evidence exists for the switched `native:*` path.
- Checkpoint C is satisfied for published release `v2.2.0` at tag commit `eb166092ad5483a00b6b59137062c86c3193ca53`; final operator-workstation rollout passed on published patch release `v2.2.1` at tag commit `951a2c4e1f236200f0f017121158bc9969427051`; the bounded fallback window is closed in [GitHub issue #3](https://github.com/Fikarn/sse-exed-studio-control/issues/3).
- Checkpoint D / Qt retirement is tracked separately in [GitHub issue #5](https://github.com/Fikarn/sse-exed-studio-control/issues/5). The read-only impact audit is recorded in [QT_FALLBACK_RETIREMENT_AUDIT.md](./QT_FALLBACK_RETIREMENT_AUDIT.md). Do not remove Qt shell code, Qt-specific verification automation, QtIFW dependencies, or Qt parity assets outside that issue and audit sequence.

## Non-Negotiables

- No product state, device policy, persistence logic, or safety behavior may move into React.
- Protocol changes remain contract changes under `native/protocol/`.
- The target operator surface remains fullscreen `2560x1440`, with `1920x1080` as the minimum fallback.
- Normal operation must not require scrolling at either supported operator size.
- Any on-disk format change requires an explicit migration and rollback plan before cutover.

## Cutover Acceptance Gate

Do not tag a release until every item below is true for the intended release commit.

### 1. Contract And Boundary Gate

- `npm run protocol:check` passes.
- Generated protocol artifacts are current.
- Every method in `native/protocol/v1.contract.json` is implemented by the Rust engine dispatch table.
- Every operator-visible write path used by React flows through an engine command, not shell-local state.
- React code derives operator surfaces from engine snapshots, fixtures, or generated protocol types.

### 2. Replacement Shell Build Gate

- `npm run frontend:foundation` passes.
- `npm run tauri:foundation` passes on macOS Apple Silicon and Windows 11 `x64` target hosts.
- Target-host build evidence is attached to the cutover issue for the candidate commit.

### 3. Live Workspace Gate

- `npm run tauri:setup-support:qualify` passes from a clean runtime directory.
- `npm run tauri:workspaces:qualify` passes from a clean runtime directory.
- The live Tauri qualification lanes have documented manual evidence from the target hosts for the candidate release.
- Port `127.0.0.1:4173` is free before each Tauri qualification run; stale dev or preview servers invalidate the result.

### 4. Visual And Operator-Fit Gate

- Storybook builds successfully for the replacement shell.
- Playwright coverage passes for Setup/Support, Lighting, Audio, Planning, shell navigation, degraded startup, backup/restore, and keyboard overlays.
- `2560x1440` visual review is performed on the BetterDisplay-backed review surface or the fixed studio monitor.
- `1920x1080` fallback fit is verified for the workspace layouts that have fallback requirements.
- No normal operator path requires page scroll at the supported sizes.
- Screenshots or review notes for the candidate are attached to the release or cutover issue before sign-off.

### 5. Startup, Recovery, And Support Gate

- Clean startup routes to commissioning when setup is incomplete.
- Commissioned startup routes to the operator dashboard with restored workspace state.
- Protocol mismatch, bootstrap failure, corrupt storage, and unavailable runtime-directory states remain operator-visible and recoverable.
- Backup export, backup restore, diagnostics export, logs, app-data reveal, and update-repository reveal remain available from support mode.
- The replacement shell never hides a degraded engine, device, storage, or recovery state behind a normal dashboard presentation.

### 6. Hardware Workflow Gate

- Lighting covers the current fixed rig and intentionally excludes pan/tilt unless the hardware profile changes.
- Audio follows the locked `Ar+ - Control-room confidence desk` posture in [docs/redesign/audio.md](./redesign/audio.md).
- Planning remains a secondary run-of-show / board workspace and does not displace live Lighting or Audio priority.
- Setup/Support remains the service-mode entry point for commissioning, Companion/Stream Deck support, diagnostics, backup, and recovery.
- Any real-hardware dry run must record the exact workstation, display mode, audio interface, lighting bridge, and Companion state used.

### 7. Packaging And Rollback Gate

- The release issue explicitly names the packaging path for the selected Tauri shell.
- Installer identity, app identifier, app-data paths, logs paths, update-repository behavior, and rollback instructions are documented before promotion.
- QtIFW remains available as the installer/update wrapper; the old Qt shell is no longer a rollback dependency after Checkpoint D source/test removal.
- Rollback to the previous shipping tag remains a reinstall-away and does not require manual database surgery.
- If QtIFW remains the installer path for the candidate, the Tauri shell must be exercised through the shipping `native:*` packaged path before release.
- If the release moves away from QtIFW, the new installer/update path must have equivalent package, update, continuity, rollback, and clean-machine acceptance evidence.

Current packaging direction:

- QtIFW remains the release wrapper unless a delta spec replaces it.
- The selected `tauri` release runtime stages the Tauri shell executable and `studio-control-engine` / `studio-control-engine.exe` side by side in the existing `release/native*` roots, or sets `SSE_ENGINE_BIN` explicitly.
- The candidate installer/update repository must preserve the existing operator app-data, logs, update-repository, and rollback expectations before Checkpoint C can be claimed.
- Real QtIFW `binarycreator` and `repogen` evidence is required on matching target hosts through `npm run native:release:mac:local` and `npm run native:release:win:local` for the switched release path.
- Rollback is now the tagged Tauri native release path; the Qt shell is no longer installable or launchable after Checkpoint D Slice 4.
- [GitHub issue #3](https://github.com/Fikarn/sse-exed-studio-control/issues/3) is the completed release/cutover issue for this gate; [GitHub issue #5](https://github.com/Fikarn/sse-exed-studio-control/issues/5) is the current Checkpoint D planning issue.

## Promotion Sequence

### Checkpoint A: Replacement Candidate

Entry condition: all migrated workspaces pass fixture, Playwright, and live Tauri qualification locally.

Exit condition: `npm run tauri:cutover:candidate` is green for the candidate commit, and current-truth docs point to this cutover gate.

### Checkpoint B: Parallel Acceptance

Entry condition: macOS and Windows target-host foundation evidence exists, and the release issue declares the bounded acceptance window.

Exit condition: Qt and Tauri are both run against the same operator-critical flows during the acceptance window, with no unresolved blocker in startup, support, lighting, audio, planning, or rollback behavior.

### Checkpoint C: Shipping Switch

Entry condition: packaging, update, rollback, and clean-machine evidence exists for the Tauri runtime.

Exit condition: the release candidate installs, launches, recovers, updates, and rolls back using the documented release path on macOS Apple Silicon and Windows 11 `x64`.

Status: satisfied for published release `v2.2.0` at tag commit `eb166092ad5483a00b6b59137062c86c3193ca53`. Evidence includes macOS Apple Silicon `npm run native:release:mac:local` exit `0`, Windows 11 `x64` target-host evidence bundle `2026-04-24T20-52-02-256Z`, GitHub Release publication, and `npm run release:anchor:verify -- --tag v2.2.0` with authenticated API access.

Operator rollout status: passed on published patch release `v2.2.1` at tag commit `951a2c4e1f236200f0f017121158bc9969427051`. `v2.2.1` keeps the selected Tauri shipping runtime, adds durable default app-data path resolution when no `SSE_APP_DATA_DIR` override is set, passed macOS `npm run native:release:mac:local`, passed Windows 11 `x64` target-host evidence bundle `2026-04-24T22-17-55-519Z`, and installed on the operator workstation with app data at `C:\Users\Stora Studion\AppData\Roaming\ExEd Studio Control Native`.

### Checkpoint D: Qt Retirement

Entry condition: the Tauri runtime has shipped successfully through the bounded fallback window.

Status: entered. The fallback window is closed in [GitHub issue #3](https://github.com/Fikarn/sse-exed-studio-control/issues/3), and Checkpoint D planning is tracked in [GitHub issue #5](https://github.com/Fikarn/sse-exed-studio-control/issues/5). The read-only impact audit and removal-sequence proposal are recorded in [QT_FALLBACK_RETIREMENT_AUDIT.md](./QT_FALLBACK_RETIREMENT_AUDIT.md).

Exit condition: Qt shell code, Qt-specific verification automation, and Qt parity assets are removed only through an explicit retirement issue and only after rollback requirements no longer depend on them. QtIFW remains the installer/update wrapper unless a separate installer replacement plan provides equivalent package, update, continuity, rollback, and clean-machine acceptance evidence.

Status: in progress. Slices 1-4 are complete with macOS and Windows target-host evidence for the packaging/signing slice and local source/test removal validation for Slice 4. Slice 5 will retire or archive historical parity assets.

## Stop Conditions

Stop cutover work and re-anchor if any of these are true:

- a Tauri qualification lane is failing or skipped
- target-host evidence is missing, stale, or captured on the wrong platform for the gate being claimed
- visual evidence is stale, not `2560x1440`, or taken from an invalid Retina logical desktop
- any operator-critical state is owned by React instead of the Rust engine
- packaging/update/rollback behavior is unspecified
- the plan requires a hardware behavior that is not in [docs/HARDWARE_PROFILE.md](./HARDWARE_PROFILE.md)

## Next Implementation Work

The next implementation slice is Checkpoint D Slice 5 from [QT_FALLBACK_RETIREMENT_AUDIT.md](./QT_FALLBACK_RETIREMENT_AUDIT.md): parity asset retirement.

Slice 4 source/test removal is complete: `native/qt-shell/**`, root Qt CMake wiring, Qt shell build/test/smoke/parity commands, and active current-truth references were removed. Local validation passed through `format:check`, `release:check`, `frontend:foundation`, `tauri:foundation`, and the stricter `native:foundation` lane. QtIFW remains the installer/update wrapper. Keep parity asset retirement for Slice 5.
