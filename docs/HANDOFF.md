# Engineering Handoff

## Purpose

This is the top-level engineering handoff for the repository as of `2026-04-25`.

Read this first before resuming product, release, or cleanup work. Use it as the entry point into the more detailed documents linked below.

## Current Operating Truth

- The product is a native desktop application with an authoritative `Rust` engine and a selected `Tauri 2 + React 19.2 + TypeScript + Vite` shell for the shipping runtime.
- `v2.2.1` is the current published Tauri shipping runtime through the `native:*` release lane. `v2.2.0` completed Checkpoint C, then `v2.2.1` patched operator app-data defaults for workstation rollout. The bounded fallback window is closed in GitHub issue #3, and Checkpoint D retirement completed through GitHub issue #5. `scripts/native-release-runtime.json` selects `tauri` for the shipping release path; the Qt fallback source/test tree and historical parity assets have been removed through the Checkpoint D sequence.
- The legacy Electron/Next.js runtime was retired in `v2.1.0`. There is no browser-served or Electron-served path left in the repository.
- Native packaging, installer, update-repository, and release automation lanes exist, produce signed/unsigned operator-ready artifacts, and are driven from tagged releases.
- Native operator parity is engineering-complete. Acceptance is layered: deterministic offscreen `2560x1440` captures, real-GPU onscreen spot captures, and the install-time first-launch smoke test shipped in the QtIFW installer.
- Native and replacement-shell verification are target-host gates. GitHub Actions is not the acceptance mechanism for current cutover work, and workflow files are intentionally absent.
- A one-way legacy-import path (`native/rust-engine/src/legacy_import.rs`) remains so that operators migrating from a pre-`v2.0.0` Electron installation can bring their old `db.json` forward on first native launch. This is the only legacy code that is intentionally retained.

## Start Here

Read these in order:

1. `README.md`
2. `docs/HANDOFF.md`
3. `docs/RELEASE.md`
4. `docs/HARDWARE_PROFILE.md`
5. `docs/ARCHITECTURE.md`
6. `docs/adr/0001-frontend-replatform.md`
7. `docs/FRONTEND_CUTOVER_PLAN.md`
8. `docs/QT_FALLBACK_RETIREMENT_AUDIT.md`

Use these for deeper context only after the above are clear:

- `docs/PRODUCTIZATION_PLAN.md`
- `native/README.md`
- `docs/archive/DESKTOP_ARCHITECTURE_PLAN.md` (historical; frozen at `v2.1.0`)
- `docs/archive/NATIVE_PARITY_HANDOFF.md` (historical; frozen at `v2.1.0`)

## Locked Decisions

Do not reopen these casually:

- product name: `SSE ExEd Studio Control`
- primary deployment profile: one fixed studio workstation
- packaging: Qt Installer Framework offline installers
- update channel: maintenance-tool update repositories
- supported primary hardware assumptions in `docs/HARDWARE_PROFILE.md`
- engine-owned persistence, safety rules, and device logic
- the native runtime is the only product runtime; do not reintroduce an Electron or Next.js path
- the selected shell stack is `Tauri 2 + React 19.2 + TypeScript + Vite`; Qt fallback retirement is complete and recorded in Checkpoint D issue #5 and `docs/QT_FALLBACK_RETIREMENT_AUDIT.md`

## Current Blockers

The highest-value unresolved work is:

1. Keep target-host evidence complete.
   macOS Apple Silicon and Windows 11 `x64` remain separate release hosts. Do not claim a cutover gate from a single platform, from stale local artifacts, or from a prepared-only installer layout.
2. Keep the backlog actionable.
   Do not let real execution work live only in prose documents; open execution issues or milestone items before starting the next major slice.
3. Keep current-truth docs aligned with the replatform program.
   The selected Tauri release runtime, retired Qt source/test surface, retired parity assets, and completed Checkpoint D evidence must stay described consistently in `README.md`, `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`, and the ADR set.
4. Preserve the current frontend replatform checkpoint.
   `Setup/Support` is the verified pilot. The `Lighting` pass is closed against the current checked-in plan for the fixed studio hardware profile, with `pan/tilt` intentionally out of scope; keep the patch inspector aligned to `dmxStartAddress`, `rigZ`, `beamAngleDegrees`, and `Identify`. The `Planning` pass is closed against the checked-in run-of-show timeline / board plan. The `Audio` pass is closed against the locked `Ar+ - Control-room confidence desk` spec in `docs/redesign/audio.md`, including the warning-band trust model, full-width meter bridge, banked strip desk, control-room inspector split, keyboard desk model, degraded-state matrix, and `1920x1080` fallback fit. The broader live Tauri workspace qualification lane now exists as `npm run tauri:workspaces:qualify`; it covers the commissioned dashboard plus live Lighting, Audio, and Planning mutations across restart persistence. The cutover acceptance gate is tracked in `docs/FRONTEND_CUTOVER_PLAN.md`; Checkpoint C is satisfied for published tag `v2.2.0` (`eb166092ad5483a00b6b59137062c86c3193ca53`) with macOS and Windows post-switch target-host release evidence, the final operator-workstation rollout passed on published tag `v2.2.1` (`951a2c4e1f236200f0f017121158bc9969427051`), and Checkpoint D completed on commit `d0205baf52ce02d7d4d24699facd202f3bbba217` with macOS `native:release:mac:local` plus Windows evidence bundle `2026-04-25T07-32-31-463Z`. Validation lane split, runtime selector lockdown, packaging/signing cleanup, Qt source/test removal, parity asset retirement, and the final retirement gate are complete.
5. Keep Tauri target-host posture honest.
   GitHub Actions is not the acceptance mechanism for the replacement-shell cutover. `npm run tauri:setup-support:qualify`, `npm run tauri:workspaces:qualify`, and `npm run tauri:visual:review` remain local/manual cutover-readiness gates for future shell changes. The historical `tauri:package:*` lanes remain useful pre-switch evidence under `release/tauri-candidate*`. The switched shipping path is now the `native:*` release lane selected by `scripts/native-release-runtime.json`; `npm run native:release:mac:local` passed for published `v2.2.1`, and `npm run native:release:win:evidence` passed on Windows 11 `x64` with evidence bundle `2026-04-24T22-17-55-519Z`. Checkpoint D also passed macOS `npm run native:release:mac:local` and Windows 11 `x64` evidence bundle `2026-04-25T07-32-31-463Z` on commit `d0205baf52ce02d7d4d24699facd202f3bbba217`. [GitHub issue #3](https://github.com/Fikarn/sse-exed-studio-control/issues/3) records the completed Checkpoint C evidence and closed fallback window; [GitHub issue #4](https://github.com/Fikarn/sse-exed-studio-control/issues/4) records the passed `v2.2.1` operator rollout; [GitHub issue #5](https://github.com/Fikarn/sse-exed-studio-control/issues/5) records the completed Checkpoint D / Qt retirement track.

## Execution Queue

The current GitHub execution queue is:

- No active Checkpoint D execution item remains. Open a new issue before beginning the next major product, release, or signing slice.
- release-artwork polish and public-distribution signing posture remain tracked in `docs/PRODUCTIZATION_PLAN.md` §3 rather than as separate execution items

Completed rollout record:

- [Issue #3: Cutover: Tauri shipping switch evidence and fallback window](https://github.com/Fikarn/sse-exed-studio-control/issues/3)
- [Issue #4: Rollout: verify v2.2.1 published installer on operator workstation](https://github.com/Fikarn/sse-exed-studio-control/issues/4), executed through [docs/OPERATOR_WORKSTATION_ROLLOUT.md](./OPERATOR_WORKSTATION_ROLLOUT.md)
- [Issue #5: Checkpoint D: plan Qt fallback retirement](https://github.com/Fikarn/sse-exed-studio-control/issues/5), executed through [docs/QT_FALLBACK_RETIREMENT_AUDIT.md](./QT_FALLBACK_RETIREMENT_AUDIT.md)

## Validation Baseline

Before trusting any substantial change, run the smallest command set that matches the risk.

Common baseline:

```bash
npm install
npm run format:check
npm run release:check
```

Native baseline:

```bash
npm run native:check
npm run native:test
npm run native:foundation
npm run frontend:foundation
npm run tauri:foundation
npm run native:acceptance
```

Full release verification (before tagging):

```bash
npm run release:verify
```

## Repo Hygiene Rules

- Prefer one authoritative doc for current truth and link to detail docs instead of duplicating status prose everywhere.
- Do not check in workstation-specific absolute paths.
- Keep generated artifacts, transient captures, and local-only clutter out of version control.
- If a target-host release gate is red, either fix it or document precisely why the lane is intentionally non-blocking.

## Historical Note

The repository previously carried a full Electron/Next.js runtime alongside the native shell as a parity oracle. That runtime, its tests, and its CI/CD lanes were removed in `v2.1.0`. See `docs/archive/NATIVE_PARITY_HANDOFF.md` for the frozen parity appendix that drove the recovery program, and the `v2.0.1 → v2.1.0` changelog entries for the removal scope.
