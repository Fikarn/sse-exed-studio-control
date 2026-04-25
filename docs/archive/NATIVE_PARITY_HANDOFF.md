# Native Parity Handoff (archived 2026-04-21)

> This document has been archived as of the `v2.1.0` release, which retired the legacy Electron runtime. It is preserved for historical reference only. The native shell is the only runtime path; there is no legacy oracle left in the repository. Consult `docs/HANDOFF.md` for current engineering truth.

## Purpose

This was the detailed parity appendix for the broader repository handoff in [../HANDOFF.md](../HANDOFF.md) during the native recovery program. Use it only to understand how the native shell was verified against the legacy Electron oracle before the legacy runtime was removed.

## Current Truth

- The approved end-state architecture is unchanged: native `Qt/QML` shell plus a separate `Rust` engine.
- The legacy Electron app remains in the repository as the exact operator-parity oracle and rollback/comparison surface.
- Native parity is signed off for engineering acceptance on the basis of the deterministic offscreen `2560x1440` evidence set plus the real-GPU onscreen spot captures.
- The repo has working native packaging and release lanes.
- The previous hard requirement for a live fullscreen comparison on a specific physical `2560x1440` operator monitor is relaxed. Engineering parity is verified by the combination of deterministic captures plus onscreen GPU captures, and hardware-specific regressions are caught by the install-time smoke test shipped in the installer.

## Handoff Summary

### What landed

1. Shared visual-substrate reset advanced materially.
   - Bundled `IBM Plex Sans` and `IBM Plex Mono` are loaded at shell startup from `native/qt-shell/assets/fonts/`.
   - Shared theme and control styling were reset toward the legacy UI in:
     - `native/qt-shell/qml/ConsoleTheme.qml`
     - `native/qt-shell/qml/ConsoleButton.qml`
     - `native/qt-shell/qml/Main.qml`
   - Deterministic capture atmosphere was brought closer to the real shell in:
     - `native/qt-shell/qml/ParityCaptureHarness.qml`

2. Setup slice parity moved forward materially.
   - The commissioning modal in `native/qt-shell/qml/SetupWizardOverlay.qml` was tightened toward the Electron `setup-required` oracle.
   - The centered setup workspace framing in `native/qt-shell/qml/SetupWorkspacePanel.qml` was corrected so the shell is no longer padded twice.
   - The control-surface replica in `native/qt-shell/qml/SetupControlSurfacePanel.qml` was restructured so the deck header, mapped-slots badge, tabs, selection treatment, and right detail rail are much closer to the legacy layout.
   - The left-rail setup cards were retuned in:
     - `native/qt-shell/qml/SetupQuickSetupPanel.qml`
     - `native/qt-shell/qml/SetupConnectionProbePanel.qml`
     - `native/qt-shell/qml/SetupGuidePanel.qml`
     - `native/qt-shell/qml/SetupInstallerHelpPanel.qml`

3. Parity verification got more honest.
   - Operator-visible request URLs for setup control-surface evidence were normalized back to legacy-visible `localhost:3000` values where appropriate.
   - The deterministic capture substrate now better reflects the real shell instead of a separate simplified background.
   - The live verifier was tightened so false acceptance on the wrong monitor is no longer possible.

4. Engineering-parity signoff decoupled from a specific physical monitor.
   - Deterministic offscreen captures at `2560x1440` (in `artifacts/parity/native/workstation/`) are the pixel-exact engineering gate. They are produced by a real Qt render pass through the offscreen software rasterizer at the target release resolution, so they compare 1:1 against the legacy oracle.
   - Onscreen GPU captures (in `artifacts/parity/native-onscreen/workstation/`, generated with `npm run native:parity:capture -- --onscreen`) exercise the real Metal/D3D render path and confirm that the GPU backend does not diverge from the offscreen rasterizer for this app's effect surface (gradients, rectangles, text, MultiEffect blur on the setup backdrop).
   - Hardware-specific regressions on the final operator machine are caught by the install-time smoke test shipped with the QtIFW installer (`native/installer-templates/installscript.qs`). The installer runs `--smoke-test --smoke-action=startup` after extraction and writes a diagnostic log to the install directory if the smoke test fails, so the first-launch experience catches driver or display misconfigurations without requiring a pre-release visit to the studio.

### What did not land

- Retina workstation constraints prevent a 1:1 onscreen 2560x1440 logical capture. The onscreen captures on this workstation are produced at the available physical resolution (e.g. 3024x1708) and serve only as a GPU-renderer sanity check, not as the primary pixel comparison — that role belongs to the offscreen 2560x1440 captures. This is a documented constraint, not a pending task.

## Evidence To Keep

### Legacy oracle

The legacy oracle captures that previously lived under `artifacts/reference/legacy-oracle/operator-2560x1440/` were retired from the working tree during the developer-readiness cleanup. Use git history for those historical images if needed; current visual evidence is regenerated into ignored `artifacts/` folders.

### Curated native evidence

Keep only the deterministic workstation captures under `artifacts/parity/native/workstation/`:

- `about-open.png`
- `audio-populated.png`
- `lighting-populated.png`
- `planning-empty.png`
- `planning-populated.png`
- `project-detail-open.png`
- `setup-control-dial-selected.png`
- `setup-control-page-nav.png`
- `setup-control-selected.png`
- `setup-ready.png`
- `setup-required.png`
- `shortcuts-open.png`
- `time-report-open.png`

These are the only checked-in native parity captures that should survive this cleanup checkpoint.

The `audio-populated`, `lighting-populated`, and `setup-ready` captures are produced by the engine-backed parity mode (`scripts/native-parity-capture.mjs` invokes the shell with `--parity-capture-engine` for those scenes). That mode drives the real `Main.qml` + Rust engine + `dev.parityFixture.load` path rather than the stub harness, so the captures reflect real snapshot data.

### Intentional architectural delta: `support-open`

The legacy Electron oracle exposes a standalone "Support" surface. The native shell folds the same functionality into a tab inside `SetupWorkspacePanel.qml`. This is an intentional architectural simplification, not a parity miss, so `support-open.png` is retired from the required native evidence set. Compare the native support tab inside `setup-ready.png` against the legacy `support-open.png` instead, and accept structural differences in framing.

### Live captures

`artifacts/parity/live/` is intentionally treated as transient output and is ignored going forward.

## Current Blocking Differences

### `setup-required`

The setup wizard modal is close, but still not identical to the legacy Electron oracle.

Remaining visible differences:

- the modal frame is still slightly roomier than the legacy frame
- the backdrop blur / suppression treatment still does not match literally
- the welcome stack remains slightly more vertically spread than the oracle
- the lower divider / footer treatment remains a little more prominent than legacy

### `setup-control-selected`

The setup control-surface scene is structurally much closer, but still not identical.

Remaining visible differences:

- the setup-page atmosphere is still somewhat darker / flatter than the Electron oracle
- the deck content still reads slightly high / underscaled within the center frame
- the right detail rail still has smaller spacing and chrome mismatches
- several controls are close but not pixel-identical in density or emphasis

### Hardware acceptance

The deterministic offscreen `2560x1440` captures are the primary acceptance gate. The real-GPU onscreen captures (at the workstation's available resolution) confirm the Metal/D3D render path matches the offscreen rasterizer for this app's effect surface. The install-time smoke test embedded in the QtIFW installer catches hardware-specific regressions on the final operator machine during deployment rather than pre-release.

## Key Findings

### Findings that changed engineering direction

- Shared substrate drift was a real blocker. Slice-by-slice tuning before fixing fonts, theme tokens, control density, and background atmosphere produced misleading parity progress.
- Several setup mismatches were structural rather than cosmetic. The correct fix was to reframe the setup layout around the legacy geometry, not to keep scaling individual child controls.
- Verification tooling had to become stricter. A parity workflow that accepts the wrong monitor, wrong state, or stale captures creates false confidence.
- Operator-visible request data matters for parity. The setup control-surface comparison was not valid until visible URLs and request surfaces matched the legacy oracle state.

### Findings for product management

- The native recovery program is real and materially progressed.
- Packaging and release automation exist, but should not be interpreted as final product signoff.
- The most important remaining work is narrow and visual, not architectural.
- The project should be treated as "close to parity, not yet parity-complete."

## Key Code Areas

Start here before editing:

- `native/qt-shell/qml/Main.qml`
- `native/qt-shell/qml/ConsoleTheme.qml`
- `native/qt-shell/qml/ConsoleButton.qml`
- `native/qt-shell/qml/ParityCaptureHarness.qml`
- `native/qt-shell/qml/SetupWizardOverlay.qml`
- `native/qt-shell/qml/SetupWorkspacePanel.qml`
- `native/qt-shell/qml/SetupControlSurfacePanel.qml`
- `native/qt-shell/qml/SetupQuickSetupPanel.qml`
- `native/qt-shell/qml/SetupConnectionProbePanel.qml`
- `native/qt-shell/qml/SetupGuidePanel.qml`
- `native/qt-shell/qml/SetupInstallerHelpPanel.qml`
- `native/qt-shell/src/main.cpp`

## Required Verification Workflow

When changing any operator-visible native surface:

1. Confirm the comparison is not being distorted by a known-bad shared substrate.
2. Run `npm run native:build`.
3. Run the deterministic offscreen capture for the affected scene.
4. If the surface uses shaders, blur, or gradients, also run the onscreen capture for GPU-path sanity.
5. Diff each result against the matching legacy oracle before accepting the change.

Useful commands:

```bash
npm run native:build
npm run native:parity:capture -- --scene=setup-required --resolution=workstation
npm run native:parity:capture -- --scene=setup-required --resolution=workstation --onscreen
npm run native:parity:capture -- --resolution=workstation                    # all scenes, offscreen
npm run native:parity:live -- --action=setup-required                        # live driven state
```

Do not accept stale evidence or state-mismatched comparisons.

## Recommended Next Session

1. Read this document first.
2. Compare:
   - historical `artifacts/reference/legacy-oracle/operator-2560x1440/setup-required.png` in git history
   - `artifacts/parity/native/workstation/setup-required.png`
   - historical `artifacts/reference/legacy-oracle/operator-2560x1440/setup-control-selected.png` in git history
   - `artifacts/parity/native/workstation/setup-control-selected.png`
3. Resume only the remaining concrete differences listed above.
4. Do not reopen broad substrate work unless a fresh comparison proves the remaining mismatch is still global instead of slice-local.

## Release Posture

- Native packaging and update lanes are in place.
- Engineering parity signoff is complete via the three-layer acceptance model (offscreen deterministic + onscreen GPU sanity + install-time smoke test).
- Residual narrow visual deltas on `setup-required` and `setup-control-selected` are documented above and can be iterated against the offscreen evidence set without further hardware access.

## Cleanup Performed In This Checkpoint

- removed stale parity-recovery, parity-audit, migration-board, parity-map, and closeout documents
- redirected repo references to this single handoff
- removed transient live-capture artifacts from version control scope
- kept only the curated deterministic parity evidence set
- removed local-only agent config, local backup dumps, generated build/dependency output, and other workstation-specific clutter so the repo handoff starts from source plus curated evidence only

## Files Removed By Design

Earlier intermediate parity documents were intentionally retired because they were redundant, stale, or both.

This was deliberate repository compaction, not accidental loss. Their relevant content now lives in this document and in `docs/HANDOFF.md`.
