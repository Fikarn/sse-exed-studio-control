# Engineering Handoff

## Purpose

This is the top-level engineering handoff for the repository as of `2026-05-03`.

Read this first before resuming product, release, or cleanup work. Use it as the entry point into the more detailed documents linked below.

## Current Operating Truth

- The product is a native desktop application with an authoritative `Rust` engine and a selected `Tauri 2 + React 19.2 + TypeScript + Vite` shell for the shipping runtime.
- `v2.2.1` is the current published Tauri shipping runtime through the `native:*` release lane. `v2.2.0` completed Checkpoint C, then `v2.2.1` patched operator app-data defaults for workstation rollout. The bounded fallback window is closed in GitHub issue #3, and Checkpoint D retirement completed through GitHub issue #5. `scripts/native-release-runtime.json` selects `tauri` for the shipping release path; the Qt fallback source/test tree and historical parity assets have been removed through the Checkpoint D sequence.
- The legacy Electron/Next.js runtime was retired in `v2.1.0`. There is no browser-served or Electron-served path left in the repository.
- Native packaging, installer, update-repository, and release automation lanes exist, produce signed/unsigned operator-ready artifacts, and are driven from tagged releases.
- Native operator parity is engineering-complete. Acceptance is layered: deterministic offscreen `2560x1440` captures, real-GPU onscreen spot captures, and the install-time first-launch smoke test shipped in the QtIFW installer.
- Native and replacement-shell verification are target-host gates. GitHub Actions is not the acceptance mechanism for current cutover work; the advisory `dev-checks` workflow in [.github/workflows/dev-checks.yml](../.github/workflows/dev-checks.yml) runs four jobs on pull requests (format-protocol, lint, frontend-typecheck, rust) but is intentionally not a required status check, and Actions billing is not paid — failed CI runs are expected baseline noise.
- Responsive operator layout support landed in [PR #71](https://github.com/Fikarn/sse-exed-studio-control/pull/71) on `2026-05-03` (`4af7e8b8427cff78837054326478e1a67398154c`). Lighting now has logical CSS-pixel layout modes, mode-keyed column persistence, toolbar priority overflow, a narrow inspector drawer, separate stage zoom controls, shell-owned window layout persistence, and Scaled Studio Preview for current-hardware human review.
- Lighting fixture catalog implementation landed after the responsive pass. The Rust engine now owns fixture definitions, mode/channel metadata, DMX mapping and validation, persistence compatibility, universe-aware patching, scene `controlValues`, and catalog snapshots. React renders catalog metadata and sends explicit commands only; it is not the source of truth for fixture/DMX policy. Verified catalog entries are selectable in the Add Fixture dialog; `research-needed` entries remain non-selectable tracking metadata.
- A one-way legacy-import path (`native/rust-engine/src/legacy_import.rs`) remains so that operators migrating from a pre-`v2.0.0` Electron installation can bring their old `db.json` forward on first native launch. This is the only legacy code that is intentionally retained.

## Start Here

Read these in order:

1. `README.md`
2. `docs/DEVELOPER_QUICKSTART.md`
3. `docs/HANDOFF.md`
4. `docs/RELEASE.md`
5. `docs/HARDWARE_PROFILE.md`
6. `docs/ARCHITECTURE.md`
7. `docs/adr/0001-frontend-replatform.md`
8. `docs/archive/FRONTEND_CUTOVER_PLAN.md`
9. `docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md`

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
- the selected shell stack is `Tauri 2 + React 19.2 + TypeScript + Vite`; Qt fallback retirement is complete and recorded in Checkpoint D issue #5 and `docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md`

## Current Blockers

The highest-value unresolved work is:

1. Keep target-host evidence complete.
   macOS Apple Silicon and Windows 11 `x64` remain separate release hosts. Do not claim a cutover gate from a single platform, from stale local artifacts, or from a prepared-only installer layout.
2. Keep the backlog actionable.
   Do not let real execution work live only in prose documents; open execution issues or milestone items before starting the next major slice.
3. Keep current-truth docs aligned with the replatform program.
   The selected Tauri release runtime, retired Qt source/test surface, retired parity assets, and completed Checkpoint D evidence must stay described consistently in `README.md`, `docs/HANDOFF.md`, `docs/ARCHITECTURE.md`, and the ADR set.
4. Preserve the current frontend replatform checkpoint.
   `Setup/Support` is the verified pilot. `Lighting` Direction D and the premium Waves 24-34 pass are complete: D supersedes the closed `Cr — Spatial desk` pass, removes the cue model in favour of scene recall, keeps `pan/tilt` intentionally out of scope, and now includes preview editing, manual fade recall, selection chips, compact DMX, Highlight/Solo/Find, color/reorder polish, and per-attribute palette pools. All 28 premium findings in [docs/redesign/lighting-d-premium-plan.md](./redesign/lighting-d-premium-plan.md) are closed; Wave 34 PR #65 landed with macOS and Windows target-host validation, and future Lighting work should start from new issues instead of reopening the wave plan. The `Planning` pass is closed against the checked-in run-of-show timeline / board plan. The `Audio` pass is closed against the locked `Ar+ - Control-room confidence desk` spec in `docs/redesign/audio.md`, including the warning-band trust model, full-width meter bridge, banked strip desk, control-room inspector split, keyboard desk model, degraded-state matrix, and `1920x1080` fallback fit. The broader live Tauri workspace qualification lane now exists as `npm run tauri:workspaces:qualify`; it covers the commissioned dashboard plus live Lighting, Audio, and Planning mutations across restart persistence. The cutover acceptance gate is tracked in `docs/archive/FRONTEND_CUTOVER_PLAN.md`; Checkpoint C is satisfied for published tag `v2.2.0` (`eb166092ad5483a00b6b59137062c86c3193ca53`), the final operator-workstation rollout passed on published tag `v2.2.1` (`951a2c4e1f236200f0f017121158bc9969427051`), and Checkpoint D completed on commit `d0205baf52ce02d7d4d24699facd202f3bbba217`. Validation lane split, runtime selector lockdown, packaging/signing cleanup, Qt source/test removal, parity asset retirement, and the final retirement gate are complete.
5. Keep Tauri target-host posture honest.
   GitHub Actions is not the acceptance mechanism for the replacement-shell cutover. `npm run tauri:setup-support:qualify`, `npm run tauri:workspaces:qualify`, and `npm run tauri:visual:review` remain local/manual cutover-readiness gates for future shell changes. The historical `tauri:package:*` lanes remain useful pre-switch evidence under `release/tauri-candidate*`. The switched shipping path is now the `native:*` release lane selected by `scripts/native-release-runtime.json`; `npm run native:release:mac:local` passed for published `v2.2.1`, and `npm run native:release:win:evidence` passed on Windows 11 `x64` with evidence bundle `2026-04-24T22-17-55-519Z`. Checkpoint D also passed macOS `npm run native:release:mac:local` and Windows 11 `x64` evidence bundle `2026-04-25T07-32-31-463Z` on commit `d0205baf52ce02d7d4d24699facd202f3bbba217`. [GitHub issue #3](https://github.com/Fikarn/sse-exed-studio-control/issues/3) records the completed Checkpoint C evidence and closed fallback window; [GitHub issue #4](https://github.com/Fikarn/sse-exed-studio-control/issues/4) records the passed `v2.2.1` operator rollout; [GitHub issue #5](https://github.com/Fikarn/sse-exed-studio-control/issues/5) records the completed Checkpoint D / Qt retirement track.
6. Preserve responsive-layout semantics.
   The studio surface is a logical `2560x1440` operator composition whose layout decisions are driven by CSS viewport size, not physical pixels or `devicePixelRatio`. Aspect-ratio-correct Scaled Studio Preview is the normal current-hardware human review path for studio composition on the built-in MacBook display. The fixed studio monitor remains the final authority for physical-size readability and ergonomics. BetterDisplay is now optional fallback tooling, not the standard workflow.
7. Preserve fixture-catalog ownership.
   Fixture definitions, DMX footprints, DMX labels/encoders, universe-aware overlap validation, scene serialization, and persisted compatibility live in `native/rust-engine/src/lighting/`. Frontend code may mirror catalog metadata for fixture transport tests and render controls/shapes from snapshots, but it must not own device policy. Do not add GDTF import, Sidus Bluetooth discovery, firmware update, or vendor auto-configuration without a new scoped plan.

## Execution Queue

The current GitHub execution queue is:

- [Issue #6: Developer readiness: onboarding, workflow, and repo hygiene](https://github.com/Fikarn/sse-exed-studio-control/issues/6) is the active execution item for repository readiness and future-development workflow polish.
- release-artwork polish and optional future signing posture remain tracked in `docs/PRODUCTIZATION_PLAN.md` §3 rather than as separate execution items; public distribution is not part of the current deployment goal

Completed rollout record:

- [Issue #3: Cutover: Tauri shipping switch evidence and fallback window](https://github.com/Fikarn/sse-exed-studio-control/issues/3)
- [Issue #4: Rollout: verify v2.2.1 published installer on operator workstation](https://github.com/Fikarn/sse-exed-studio-control/issues/4), executed through [docs/OPERATOR_WORKSTATION_ROLLOUT.md](./OPERATOR_WORKSTATION_ROLLOUT.md)
- [Issue #5: Checkpoint D: plan Qt fallback retirement](https://github.com/Fikarn/sse-exed-studio-control/issues/5), executed through [docs/QT_FALLBACK_RETIREMENT_AUDIT.md](./archive/QT_FALLBACK_RETIREMENT_AUDIT.md)

## Recent Session Record

### Responsive operator layout, Lighting-first pass

Status: complete and merged through [PR #71](https://github.com/Fikarn/sse-exed-studio-control/pull/71).

Important facts for future sessions:

- The exact command-palette entry for built-in-display review is `Studio Preview: Enter 2560x1440 Review`; exit with `Studio Preview: Exit Review`.
- Scaled Studio Preview preserves the studio layout mode, aspect ratio, and proportions while reducing physical size. It is valid for composition, relative density, toolbar fit, rail/stage/inspector balance, drawer behavior, and operator-flow review.
- Native windowed mode on the current MacBook is still useful for `desktopCompact` and `narrowUtility` behavior. Do not judge `studioFull` from the unscaled MacBook logical viewport.
- UI scale and stage zoom are separate concepts. UI scale is the operator chrome density control; stage zoom is content/canvas framing (`Fit Room`, `Fill Desk`, `100%`, bookmarks).
- Shell/window layout preferences belong in `native/tauri-shell`; fixture/device state, hardware policy, product persistence, and DB logic remain engine-owned.
- Column widths are saved per layout mode. Future Lighting layout changes should preserve that split unless a new workspace model replaces it deliberately.
- `npm run tauri:visual:review` now covers `1280x800`, `1440x900`, `1600x960`, `1728x1117`, `1920x1080`, and `2560x1440` logical sizes, primary toolbar fit including the status chip, overflow reachability, narrow inspector drawer behavior, stage minimum bounds, DPR-invariant layout mode selection, and shell window recovery.

Validation recorded for PR #71:

- Human visual review approved in Scaled Studio Preview on current hardware.
- `npm run frontend:foundation` passed, including Storybook build and 39 Playwright tests.
- `npm run native:check` passed.
- `npm run tauri:visual:review` passed with 30 screenshots, 0 failures, and 4 shell window preference recovery tests passed.
- Advisory GitHub checks passed before merge.

### Lighting fixture catalog, engine-owned pass

Status: complete and merged through [PR #73](https://github.com/Fikarn/sse-exed-studio-control/pull/73) on `2026-05-03` (`5e3c537a7f70bb104b40519ccbb3b8fc3c710573`).

Important facts for future sessions:

- The implementation plan is preserved at [docs/plans/lighting-fixture-catalog-implementation.md](./plans/lighting-fixture-catalog-implementation.md), with the completed scope documented at the top of that file.
- `lighting.fixtureCatalog.snapshot` is a read-only protocol method returning the engine-owned catalog.
- Fixture instances now carry additive `definitionId`, `modeId`, `universe`, and `controlValues` fields while retaining legacy `type` compatibility.
- The compatibility bridge maps legacy/current aliases (`Astra`, `Infinibar`, `Apollo Bridge`, `astra-bicolor`, `infinimat`, `infinibar-pb12`) before any instance-shape logic depends on catalog identity.
- `Apollo Bridge` is modeled as a verified control node with no DMX footprint and is skipped by patch auto-advance; existing instances remain editable for power/selection compatibility.
- The Add Fixture UI exposes only `verified` non-control-node definitions. `research-needed` entries are present in catalog metadata but not selectable.
- `npm run tauri:dev` needs a current `native/target/debug/studio-control-engine`; run `npm run native:engine:build` first after protocol/engine changes to avoid the Incident Recovery surface.

Validation recorded for the fixture catalog pass:

- `npm run protocol:generate` passed.
- `npm run native:test` passed: 10 Tauri shell tests, 160 engine tests, and protocol/doc-tests clean.
- `npm run frontend:typecheck` passed across workspaces.
- `npm run frontend:playwright:test` passed: 39 tests.
- `npm run tauri:visual:review` passed with 30 screenshots and 0 failures; summary at `artifacts/visual/tauri-cutover/fixture-viewport-summary.json`.
- `npm run format:check` passed.

## Validation Baseline

Before trusting any substantial change, run the smallest command set that matches the risk.

Common baseline:

```bash
npm install
npm run doctor
npm run dev:check
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
npm run doctor:release
npm run release:verify
```

GitHub Actions runs the four-job advisory workflow in [.github/workflows/dev-checks.yml](../.github/workflows/dev-checks.yml) on every pull request — `format-protocol`, `lint`, `frontend-typecheck`, and `rust` (rustfmt + clippy + cargo check + cargo test). It is **advisory only** and intentionally not a required status check; target-host release evidence on macOS Apple Silicon and Windows 11 `x64` remains the acceptance mechanism for this repo. CI failures are early signal, never a release gate.

## Repo Hygiene Rules

- Prefer one authoritative doc for current truth and link to detail docs instead of duplicating status prose everywhere.
- Do not check in workstation-specific absolute paths.
- Keep generated artifacts, transient captures, and local-only clutter out of version control.
- If a target-host release gate is red, either fix it or document precisely why the lane is intentionally non-blocking.

## Historical Note

The repository previously carried a full Electron/Next.js runtime alongside the native shell as a parity oracle. That runtime, its tests, and its CI/CD lanes were removed in `v2.1.0`. See `docs/archive/NATIVE_PARITY_HANDOFF.md` for the frozen parity appendix that drove the recovery program, and the `v2.0.1 → v2.1.0` changelog entries for the removal scope.
