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

- `native/qt-shell/` remains the shipping runtime.
- `native/tauri-shell/` plus `frontend/` are the approved replacement track.
- The Rust engine remains authoritative for state, persistence, device I/O, startup policy, recovery behavior, and support workflows.
- `Setup/Support`, `Lighting`, `Audio`, and `Planning` have replacement-shell coverage in fixture, Playwright, and live Tauri qualification lanes.
- `npm run tauri:setup-support:qualify` covers clean startup, setup/support flows, persisted restart, and bootstrap-failure recovery posture.
- `npm run tauri:workspaces:qualify` covers commissioned startup plus live Lighting, Audio, and Planning mutations across restart persistence.
- `frontend-foundation`, `tauri-foundation-macos`, and `tauri-foundation-windows` are blocking CI jobs on `main`.
- The live Tauri qualification commands remain local/manual cutover-readiness gates until stable CI display/webview lanes or documented target-host evidence exist.

## Non-Negotiables

- No product state, device policy, persistence logic, or safety behavior may move into React.
- Protocol changes remain contract changes under `native/protocol/`.
- The target operator surface remains fullscreen `2560x1440`, with `1920x1080` as the minimum fallback.
- Normal operation must not require scrolling at either supported operator size.
- Qt remains available as the internal fallback during the bounded parallel-acceptance window.
- Any on-disk format change requires an explicit migration and rollback plan before cutover.

## Cutover Acceptance Gate

Do not switch the shipping runtime until every item below is true.

### 1. Contract And Boundary Gate

- `npm run protocol:check` passes.
- Generated protocol artifacts are current.
- Every method in `native/protocol/v1.contract.json` is implemented by the Rust engine dispatch table.
- Every operator-visible write path used by React flows through an engine command, not shell-local state.
- React code derives operator surfaces from engine snapshots, fixtures, or generated protocol types.

### 2. Replacement Shell Build Gate

- `npm run frontend:foundation` passes.
- `npm run tauri:foundation` passes on macOS and Windows.
- Tauri foundation CI is promoted from non-blocking to blocking before cutover.
- Frontend foundation CI is promoted from non-blocking to blocking before cutover.

### 3. Live Workspace Gate

- `npm run tauri:setup-support:qualify` passes from a clean runtime directory.
- `npm run tauri:workspaces:qualify` passes from a clean runtime directory.
- The live Tauri qualification lanes either run in stable CI on macOS and Windows or have documented manual evidence from the target hosts for the candidate release.
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

- The release issue explicitly names the packaging path for the replacement shell.
- Installer identity, app identifier, app-data paths, logs paths, update-repository behavior, and rollback instructions are documented before promotion.
- The old Qt shell remains available as the fallback runtime during the parallel-acceptance window.
- Rollback to the previous shipping tag remains a reinstall-away and does not require manual database surgery.
- If QtIFW remains the installer path for the candidate, the Tauri shell must be exercised through that packaged path before release.
- If the release moves away from QtIFW, the new installer/update path must have equivalent package, update, continuity, rollback, and clean-machine acceptance evidence.

Current packaging direction:

- QtIFW remains the candidate release wrapper unless a delta spec replaces it.
- A packaged Tauri candidate must stage the Tauri shell executable and `studio-control-engine` / `studio-control-engine.exe` side by side, or set `SSE_ENGINE_BIN` explicitly.
- The candidate installer/update repository must preserve the existing operator app-data, logs, update-repository, and rollback expectations before Checkpoint C can be claimed.
- The Qt shell must remain installable or launchable as the fallback runtime through the bounded parallel-acceptance window.

## Promotion Sequence

### Checkpoint A: Replacement Candidate

Entry condition: all migrated workspaces pass fixture, Playwright, and live Tauri qualification locally.

Exit condition: `npm run tauri:cutover:candidate` is green for the candidate commit, and current-truth docs point to this cutover gate.

### Checkpoint B: Parallel Acceptance

Entry condition: Tauri foundation jobs are blocking, and the release issue declares the bounded acceptance window.

Exit condition: Qt and Tauri are both run against the same operator-critical flows during the acceptance window, with no unresolved blocker in startup, support, lighting, audio, planning, or rollback behavior.

### Checkpoint C: Shipping Switch

Entry condition: packaging, update, rollback, and clean-machine evidence exists for the Tauri runtime.

Exit condition: the release candidate installs, launches, recovers, updates, and rolls back using the documented release path on macOS Apple Silicon and Windows 11 `x64`.

### Checkpoint D: Qt Retirement

Entry condition: the Tauri runtime has shipped successfully through the bounded fallback window.

Exit condition: Qt shell code, Qt-specific CI, QtIFW release dependencies, and Qt parity assets are removed only through an explicit retirement issue and only after rollback requirements no longer depend on them.

## Stop Conditions

Stop cutover work and re-anchor if any of these are true:

- a Tauri qualification lane is failing or skipped
- CI is still non-blocking for the gate being claimed
- visual evidence is stale, not `2560x1440`, or taken from an invalid Retina logical desktop
- any operator-critical state is owned by React instead of the Rust engine
- packaging/update/rollback behavior is unspecified
- the old Qt fallback cannot be launched during the parallel-acceptance window
- the plan requires a hardware behavior that is not in [docs/HARDWARE_PROFILE.md](./HARDWARE_PROFILE.md)

## Next Implementation Work

The next implementation slice after this document should be the smallest gate-hardening task that moves a Checkpoint A or Checkpoint B item from manual to repeatable. Candidate slices are:

- keep `npm run tauri:cutover:candidate` green as the local Checkpoint A gate
- add stable CI or scripted evidence capture for `tauri:setup-support:qualify`
- add stable CI or scripted evidence capture for `tauri:workspaces:qualify`
- define the packaged Tauri release path before any shipping-runtime switch
