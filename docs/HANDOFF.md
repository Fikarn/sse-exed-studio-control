# Engineering Handoff

## Purpose

This is the top-level engineering handoff for the repository as of `2026-05-25`.

Read this first before resuming product, release, or cleanup work. Use it as the entry point into the more detailed documents linked below.

## Current Operating Truth

- The product is a native desktop application with an authoritative `Rust` engine and a selected `Tauri 2 + React 19.2 + TypeScript + Vite` shell for the shipping runtime.
- `v2.2.1` is the current published Tauri shipping runtime through the `native:*` release lane. `v2.2.0` completed Checkpoint C, then `v2.2.1` patched operator app-data defaults for workstation rollout. The bounded fallback window is closed in GitHub issue #3, and Checkpoint D retirement completed through GitHub issue #5. `scripts/native-release-runtime.json` selects `tauri` for the shipping release path; the Qt fallback source/test tree and historical parity assets have been removed through the Checkpoint D sequence.
- The legacy Electron/Next.js runtime was retired in `v2.1.0`. There is no browser-served or Electron-served path left in the repository.
- Native packaging, installer, update-repository, and release automation lanes exist, produce signed/unsigned operator-ready artifacts, and are driven from tagged releases.
- Native operator parity is engineering-complete. Acceptance is layered: deterministic offscreen `2560x1440` captures, real-GPU onscreen spot captures, and the install-time first-launch smoke test shipped in the QtIFW installer.
- Native and replacement-shell release verification are target-host gates. The `dev-checks` workflow in [.github/workflows/dev-checks.yml](../.github/workflows/dev-checks.yml) runs eight jobs on pull requests (`format-protocol`, `lint`, `frontend-typecheck`, `frontend-test`, `frontend-e2e`, `rust`, `tauri-foundation`, `qualification`) and is required merge hygiene on `main`; target-host evidence remains the release acceptance mechanism. The frontend-e2e job includes the committed `visual-review.spec.ts` + `storybook.spec.ts` baselines (Playwright `toHaveScreenshot`) and uploads the report + snapshot diffs as artifacts so reviewers can audit "visual review passed" from the PR Checks tab. The `rust` job extends to `native:acceptance` with `SSE_NATIVE_ACCEPTANCE_SKIP_AUDIO_SYNC=1` (CI has no live RME TotalMix OSC traffic); `qualification` runs both Tauri qualifications under xvfb with extended timeouts and the audio-probe skipped for the same reason.
- Responsive operator layout support landed in [PR #71](https://github.com/Fikarn/sse-exed-studio-control/pull/71) on `2026-05-03` (`4af7e8b8427cff78837054326478e1a67398154c`). Lighting now has logical CSS-pixel layout modes, mode-keyed column persistence, toolbar priority overflow, a narrow inspector drawer, separate stage zoom controls, shell-owned window layout persistence, and Scaled Studio Preview for current-hardware human review.
- Lighting fixture catalog implementation landed after the responsive pass. The Rust engine now owns fixture definitions, mode/channel metadata, DMX mapping and validation, persistence compatibility, universe-aware patching, scene `controlValues`, and catalog snapshots. React renders catalog metadata and sends explicit commands only; it is not the source of truth for fixture/DMX policy. Verified catalog entries are selectable in the Add Fixture dialog; `research-needed` entries remain non-selectable tracking metadata.
- Stage plot fixture identity implementation landed after the catalog pass. The engine-owned catalog now exposes additive visual metadata for existing fixture definitions, and React renders fixture family symbols, output footprints, live drag/rotation/value previews, render modes, and selected-scene previews from snapshots only. Fixture/device policy remains engine-owned; React does not own DMX footprint, persistence, or vendor behavior.
- Audio Phase 3 gold-standard polish landed in 8 slices (`#88`–`#95`, 2026-05-23) plus a 35-item follow-up audit pass merged via [PR #97](https://github.com/Fikarn/sse-exed-studio-control/pull/97) on `2026-05-24`. The audio page now reads one warn yellow / one engaged amber / one talkback green, mini-graph and full-graph processing surfaces share a hardware-readout vocabulary, the Playback strips no longer read as hollow, Outputs Mute lives next to "Bus level" inside the bus panel, peak-hold readouts go neutral grey in the safe zone, and one full-width banner at most renders at the top of the workspace at any time. Plan checked in at [docs/plans/audio-phase-3-gold-standard-polish.md](docs/plans/audio-phase-3-gold-standard-polish.md); follow-up ledger at [docs/plans/audio-ui-phase-3-followup-fixes.md](docs/plans/audio-ui-phase-3-followup-fixes.md); honest scoring + closeout deltas in [docs/plans/audio-ui-gold-standard-progress.md](docs/plans/audio-ui-gold-standard-progress.md).
- A one-way legacy-import path (`native/rust-engine/src/legacy_import.rs`) remains so that operators migrating from a pre-`v2.0.0` Electron installation can bring their old `db.json` forward on first native launch. This is the only legacy code that is intentionally retained.
- The 2026-05-25 test & review remediation plan completed across PRs [#99](https://github.com/Fikarn/sse-exed-studio-control/pull/99)–[#109](https://github.com/Fikarn/sse-exed-studio-control/pull/109) plus the closing PR 11. The 39-finding senior-engineer audit closed via committed Playwright + Storybook visual baselines, eight-job CI workflow (visual + Vitest + Playwright + native:acceptance + tauri-foundation + qualification all running on every PR), local release safety (`release:preflight`, chain-of-custody manifest, explicit `--allow-staged` QtIFW staging, hash-locked release notes), an `operator-shell.spec.ts` split into per-surface specs with shared helpers, an IPC-contract spec driven against both fixture transport and the real engine subprocess, Vitest component + unit + pure-logic coverage across the frontend workspaces, Rust contract-drift / GR-meter guard / storage backward-compat / concurrent-DB tests, a viewport-contract spec keying `OperatorLayoutProvider` thresholds to the documented hardware profile, and a pre-commit `scripts/check-slice-rescope.mjs` nudge that fails commits touching `docs/plans/**` with a renamed slice but no `Rescope:` paragraph. The plan and its Follow-ups audit trail live outside the repo at `~/.claude/plans/good-research-i-would-zazzy-kay.md`; PR 11 also extended the Scaled Studio Preview baseline matrix to every operator surface, added `npm run native:test:hardware` for opt-in device-bound Rust tests, and codified the studio-monitor manual sign-off + rescope check into the PR template.

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

   Scaled Studio Preview must behave like the native `2560x1440` studio surface after scaling, not like the host MacBook logical viewport. For operator-density and compact-mode CSS, prefer logical operator-root/container sizing over global viewport media queries. Keep global media rules for genuinely global concerns such as `prefers-reduced-motion`.

7. Preserve fixture-catalog ownership.
   Fixture definitions, DMX footprints, DMX labels/encoders, universe-aware overlap validation, scene serialization, and persisted compatibility live in `native/rust-engine/src/lighting/`. Frontend code may mirror catalog metadata for fixture transport tests and render controls/shapes from snapshots, but it must not own device policy. Do not add GDTF import, Sidus Bluetooth discovery, firmware update, or vendor auto-configuration without a new scoped plan.
8. Preserve stage-plot smoothness.
   Fixture drag, rotation, scene recall, and value slider edits now rely on short-lived render previews so the marker, output beam, active scene pill, and scene rail selection stay visually continuous while engine IPC catches up. Future changes should keep that preview layer render-only and clear it when authoritative snapshots match.

## Execution Queue

The current GitHub execution queue is empty as of `2026-05-20`; no open issues or pull requests are waiting for handoff. Audio meter PRs [#83](https://github.com/Fikarn/sse-exed-studio-control/pull/83) and [#84](https://github.com/Fikarn/sse-exed-studio-control/pull/84) were merged, required checks passed after rebasing #84 onto the updated `main`, and stale remote Claude branches were pruned from GitHub.

Completed repository-readiness record:

- [Issue #77: Repository professionalization audit remediation](https://github.com/Fikarn/sse-exed-studio-control/issues/77) is closed. It records the May 16, 2026 repository-readiness audit follow-up: stale dependency PR queue, Dependabot alert triage, merged-branch cleanup, current Tauri README screenshots, historical-design-doc status banners, squash-only merge policy, local release-host setup, public-repo visibility, branch protection, required PR status checks, auto-merge, code scanning, and secret scanning. The 2026-05-17 final audit pass keeps required human review gates off intentionally for solo-maintainer flow, adds CI coverage for repository scripts/release metadata/file health, and records no open GitHub issues, pull requests, or Dependabot alerts.
- release-artwork polish and optional future signing posture remain tracked in `docs/PRODUCTIZATION_PLAN.md` §3 rather than as separate execution items; public distribution is not part of the current deployment goal

Completed rollout record:

- [Issue #6: Developer readiness: onboarding, workflow, and repo hygiene](https://github.com/Fikarn/sse-exed-studio-control/issues/6)
- [Issue #3: Cutover: Tauri shipping switch evidence and fallback window](https://github.com/Fikarn/sse-exed-studio-control/issues/3)
- [Issue #4: Rollout: verify v2.2.1 published installer on operator workstation](https://github.com/Fikarn/sse-exed-studio-control/issues/4), executed through [docs/OPERATOR_WORKSTATION_ROLLOUT.md](./OPERATOR_WORKSTATION_ROLLOUT.md)
- [Issue #5: Checkpoint D: plan Qt fallback retirement](https://github.com/Fikarn/sse-exed-studio-control/issues/5), executed through [docs/QT_FALLBACK_RETIREMENT_AUDIT.md](./archive/QT_FALLBACK_RETIREMENT_AUDIT.md)

## Recent Session Record

### Audio page gold-standard and Scaled Studio Preview fidelity

Status: active local Audio gold-standard pass completed through `GS-AUD-34` on `2026-05-20`; progress ledger preserved at [docs/plans/audio-ui-gold-standard-progress.md](./plans/audio-ui-gold-standard-progress.md). `GS-AUD-27` through `GS-AUD-34` cover the RME-accurate EQ model (separate Low Cut + 3-band PEQ snapshot/request shape with legacy compatibility), the TotalMix Page 2 EQ/Low Cut OSC command path, the Pro-Q-inspired EQ inspector interaction (smooth response curve with log frequency markers and ±20 dB cues, distinct Low Cut handle, selected-band badge, single control tray), Overview EQ preview parity, fixture metering for the selected-channel review surface, the disabled Low Cut visual fix (no active left-side curtain; LC handle on the 0 dB line), and Playwright/native/visual coverage for the new EQ model.

Important facts for future sessions:

- The user confirmed the open selected Tauri shell as the authoritative visual verification surface. Treat feedback as referring to the live `sse-exed-tauri-shell` / `SSE ExEd Studio Control` window and its app-owned Scaled Studio Preview unless another artifact is explicitly named.
- The Audio audit and implementation were based only on the current implementation and live rendered behavior. Do not use `docs/redesign/**` as source material for follow-up Audio fixes.
- `2560x1440` is the primary operator target; `1920x1080` must remain no-scroll and usable, but it is not the optimization target.
- Scaled Studio Preview must emulate native `2560x1440` exactly after scaling. Host-window compact rules must not leak into `[data-review-surface="studioPreview"][data-layout-mode="studioFull"]`.
- The Audio workspace now uses the operator root as the sizing authority for compact/studio CSS behavior. Future operator-visible CSS should preserve that pattern instead of using raw viewport breakpoints for density decisions.
- Audio preamp graphics must be aspect-safe: compact input lanes preserve `640 / 213`; narrow inspector preamps preserve `426 / 640`. Avoid non-uniform bitmap stretching.
- Closed findings `GS-AUD-09` through `GS-AUD-34` cover the current local visual and EQ bug queue: rail dead-space fill, output-inspector truth, warning recovery gating by `canSync`, top route clipping, snapshot action overlap, 1920 fallback density, truth-fact readability, inspector internal fill, live shell lane-card bottom clipping, selected-channel Overview hierarchy, output-specific inspector mode, processing graph truth, sends ergonomics, safety/copy/accessibility polish, stabilized inspector meter readouts, unclipped meter scale labels, stacked full-width EQ/Dynamics previews, sticky Hardware/Software placement directly below the inspector meter, the RME TotalMix EQ model (separate Low Cut + 3-band PEQ with legacy compatibility), the TotalMix Page 2 EQ/Low Cut OSC command path, the Pro-Q-inspired EQ inspector interaction (graph + selected-band badge + control tray), Overview EQ preview parity, selected-channel fixture metering, the disabled Low Cut visual fix, and the EQ graph reference scales.
- Keep the Playwright invariants added in this pass: Studio Preview reports logical `2560x1440`, selected-route text includes destination without overflow, snapshot actions do not intersect content, 1920 remains no-scroll, output EQ/Dynamics/Sends are not false affordances, compact/inspector preamp aspects hold, lane cards remain inside their tier grids, inspector meter readout boxes stay stable, all dBFS scale labels stay inside meter bounds, EQ/Dynamics Overview previews stack full-width, the Source Overview card remains removed, and Hardware/Software remains in the selected-channel sticky stack below metering.
- Latest selected-channel inspector shape: sticky identity/route, meter, Hardware/Software card, send fader, Mute/Solo/Unity; Overview panel below is `Route / Sends`, `EQ preview`, `Dynamics preview`. Output inspector remains output-specific and does not expose disabled false tabs.
- The Tauri visual review script now supports Scaled Studio Preview capture via `operatorReview=studio`; preview screenshots are saved separately and fidelity metrics are recorded in `artifacts/visual/tauri-cutover/fixture-viewport-summary.json`.
- If a long-running `npm run tauri:dev` shell is on port `4173`, run visual review on an alternate port such as `--port=4174`. If the live shell falls into `ENGINE_READY_TIMEOUT` after broad frontend work, use the shell's own retry flow before judging the surface.
- Before further Audio edits, add new finding IDs, acceptance criteria, checklist items, validation commands, and artifact targets to [docs/plans/audio-ui-gold-standard-progress.md](./plans/audio-ui-gold-standard-progress.md).

Validation recorded for this pass:

- `npm run frontend:typecheck` passed.
- `npm run frontend:playwright:test` passed with 75 tests.
- `npm run tauri:visual:review -- --fixtures=audio-populated,audio-selected-channel,audio-1920-fallback,audio-not-verified --sizes=2560x1440,1920x1080 --port=4174` passed with 10 screenshots, including Scaled Studio Preview captures for Audio fixtures.
- `git diff --check` passed.
- Live selected Tauri shell inspection passed after `GS-AUD-26`; Audio rendered in Scaled Studio Preview, Hardware/Software sat directly below the meter card, the Source card was removed, and Route/EQ/Dynamics filled the selected-channel Overview below.
- Latest live-shell evidence was saved at `artifacts/visual/tauri-cutover/audio-live-studio-preview-after-gs-aud-26.png`; the ledger also records earlier GS-AUD evidence paths.

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

### Stage plot fixture identity and motion polish

Status: implemented on branch `codex/stage-plot-fixture-identity-polish` on `2026-05-03`.

Important facts for future sessions:

- The implementation plan is preserved at [docs/plans/stage-plot-fixture-identity-implementation.md](./plans/stage-plot-fixture-identity-implementation.md).
- The engine catalog exposes additive fixture visual metadata for existing definitions only. Do not add new fixture catalog entries as part of stage-plot rendering polish.
- Stage plot render modes use the shared design-system `SegmentedControl`.
- Fixture symbols and output footprints render from catalog metadata via frontend visual helpers. The frontend layer remains render-only and must not encode device policy, DMX validation, fixture discovery, vendor configuration, or persistence rules.
- Drag, rotation, and intensity/CCT edits use short-lived render previews so fixture symbols and output beams track the operator interaction immediately and do not snap back during IPC round trips.
- Plot rotation is free/continuous while dragging and commits/displays nearest one-degree values.
- Clicking a scene now drives a render-only scene preview immediately. The selected scene tile, active scene pill, and stage plot contents stay aligned while the engine recall snapshot catches up; the preview clears once authoritative fixtures match the scene.
- A closeout validation run exposed a fixture-transport StrictMode startup lifecycle bug: the first development-only effect cleanup could drop a startup failure event and turn `protocol-mismatch` into `ENGINE_READY_TIMEOUT`. `createShellStore` now generation-guards startup work, and the fixture transport clears delayed startup timers on dispose.
- `npm run tauri:visual:review` requires `127.0.0.1:4173` to be free. Stop stale `tauri dev` / Vite shells before running it.

Validation recorded for this pass:

- `npm run protocol:generate` passed.
- `npm run native:test` passed: 10 Tauri shell tests, 161 engine tests, and protocol/doc-tests clean.
- `npm run frontend:typecheck` passed across workspaces.
- `npm run frontend:playwright:test` passed: 42 tests.
- `npm run tauri:visual:review` passed with 30 screenshots and 0 failures; summary at `artifacts/visual/tauri-cutover/fixture-viewport-summary.json`.
- `git diff --check` passed.

### Live operator UX closeout polish

Status: implemented on branch `codex/operator-ux-closeout-polish` on `2026-05-04`.

Important facts for future sessions:

- The live operator review found and fixed a sequence of Lighting workspace issues: fixture output beams are clipped to the studio floor, talent/stage marks are labeled draggable controls, talent mark persistence uses supported `settings.update` fields, health-bar marker glow is no longer clipped, top-right monitor chips route to Setup, and Scene inspector fixture chips route to fixture settings.
- The typography pass intentionally removes default-looking text paths from app and shared design-system surfaces. UI copy uses the app UI stack, titles use the display stack, and operational labels/actions/status text use the mono stack. New visible text should choose one of those tokenized stacks explicitly instead of relying on browser defaults.
- The session normalized operator-visible letter spacing to `0`. Do not reintroduce negative or tracked letter spacing in app/design-system CSS without a specific design decision.
- Remaining `font: inherit` usage is limited to reset mechanics and inline rename controls where inheriting the already-styled surrounding text avoids layout shift.
- If a live `npm run tauri:dev` shell is kept open while broad frontend edits, `frontend:playwright:test`, or `tauri:visual:review` run, do a clean Tauri dev-shell restart before handing the app back to an operator. HMR invalidations and test/report navigations can leave the webview showing a stale Startup Recovery surface even when the Rust engine bootstrapped cleanly. The fix is to stop the old `npm run tauri:dev` process tree and start `npm run tauri:dev` again so the shell store performs a fresh engine handshake.

Validation recorded for this pass:

- `npm run frontend:typecheck` passed.
- `npm run frontend:playwright:test` passed: 42 tests.
- `npm run tauri:visual:review -- --fixtures=setup-required,setup-degraded,audio-populated,planning-populated,lighting-populated,lighting-dmx-unreachable --sizes=2560x1440,1920x1080 --port=4174` passed with 12 screenshots and 0 failures; summary at `artifacts/visual/tauri-cutover/fixture-viewport-summary.json`.
- Static typography scans found no remaining `font-family-sans`, raw `system-ui`/`sans-serif`/`monospace`, or nonzero/negative letter spacing in app/design-system source.

### Audio Phase 3 gold-standard polish + 35-item follow-up audit

Status: implemented in 9 PRs ([#88](https://github.com/Fikarn/sse-exed-studio-control/pull/88)–[#95](https://github.com/Fikarn/sse-exed-studio-control/pull/95), [#97](https://github.com/Fikarn/sse-exed-studio-control/pull/97)) on `2026-05-23`–`2026-05-24`.

Important facts for future sessions:

- The Phase 3 plan is checked in at [docs/plans/audio-phase-3-gold-standard-polish.md](./plans/audio-phase-3-gold-standard-polish.md) with a provenance note. The 35-item follow-up ledger that audited Phase 3 vs. delivered is at [docs/plans/audio-ui-phase-3-followup-fixes.md](./plans/audio-ui-phase-3-followup-fixes.md). The honest closeout deltas across Phase 2 and Phase 3 live in [docs/plans/audio-ui-gold-standard-progress.md](./plans/audio-ui-gold-standard-progress.md) under "Phase 3 closeout deltas" + "Phase 3 Validation Log".
- The audio page now uses a deliberate two-tier semantic vocabulary: `--audio-warn-fill` (warn yellow, demands action) and `--audio-engaged-fill` (warm amber, persistent engaged state). Two pre-existing near-identical yellows (`--audio-hot`, `--audio-solo`) collapsed to one warn token — every SOLO surface, OSC warning band, and clip indicator now reads through `--audio-warn-fill`. The `--audio-warn-fill` resolution is overridden locally inside `.audioShell` to keep the audio page's tuned `#ffd33d` while leaving `brand.yellow` (`#E8D561`) intact for Lighting / Planning.
- `AudioHardwareReadout` is a CSS-only wrapper for short value badges only (Outputs Bus level, Rail Monitor level, inspector Send-to-bus). The full EQ and Dynamics graphs share the same amber-backlight vocabulary at the CSS level (`::after` pseudo-elements on `.eqGraphFull` / `.dynamicsGraphFull`) — wrapping the graphs in the component would paint a bezel-in-bezel against their grid backgrounds. The inspector small preamp is deliberately not wrapped for the same reason (it's already a fully-skeuomorphic raster element).
- Talkback active state stays on `--audio-talk` green (broadcast convention for talkback "go"), even though the Slice 2 plan listed it under engaged amber. Recorded as a motivated deviation in [docs/plans/audio-ui-phase-3-followup-fixes.md](./plans/audio-ui-phase-3-followup-fixes.md) under D12.
- The TALENT identity badge stays on `--audio-group-talent` ochre — it's part of the per-group color palette (talent / line / bed / fx / remote each have a distinct color), not part of the yellow overload Slice 2 was reducing. Recorded as a motivated deviation under D13.
- `AudioToolbar.tsx` is dead code (not mounted in any active layout — preserved for a future toolbar re-mount under the GS-AUD-44 precedent). Any feature that needs to render on the toolbar surface should add the JSX to the live host in `AudioRail.tsx` instead. The Slice 7 status dot was originally added to the dead component; the follow-up moved its live render site to `AudioRail.tsx`.
- The "Rescope protocol (sliced plans)" section in [AGENTS.md](../AGENTS.md) is the canonical rule for handling plan divergences: edit the plan doc + re-number/rename the slice + open a follow-up item, instead of silently substituting different work under the same slice number. Phase 3 Slice 4 and Slice 6 are the case study.

Validation recorded for the follow-up pass:

- `npm run frontend:typecheck` passed across all workspaces.
- `npm run frontend:playwright:test` passed: **160 / 160 specs** (was 144 before Phase 3 follow-up; +16 new specs in `frontend/app/tests/audio-phase-3-followups.spec.ts`).
- Live Tauri shell visual verification via a 27-step operator checklist (recorded in the 2026-05-24 session transcript) — all surfaces verified at `2560×1440` Scaled Studio Preview.
- Open follow-ups carried forward: a pixel-diff acceptance step for `tauri:visual:review` (currently only asserts `fitsViewport`).
- Obsolete branch carried on origin: `claude/audio-meter-phase-2` is a 2026-05-20 checkpoint of an earlier Phase 1b audio meter architecture (`audio_backend.rs` refactor, protocol changes, `LiveAudioStereoMeter` + `meterStore` split, ballistics module). It sits 21,988 lines BEHIND main and removes `rme_totalmix_osc.rs` which the shipping engine depends on — Phase 2 took the meter architecture in a different direction. Safe to delete or tag-and-archive; not landable on current main without redoing the entire Phase 2 close-out on top.

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

GitHub Actions runs the four-job workflow in [.github/workflows/dev-checks.yml](../.github/workflows/dev-checks.yml) on every pull request: `format-protocol`, `lint`, `frontend-typecheck`, and `rust` (rustfmt + clippy + cargo check + cargo test). These checks are required merge hygiene on `main`. Target-host release evidence on macOS Apple Silicon and Windows 11 `x64` remains the release acceptance mechanism for this repo; CI failures are merge blockers, not release evidence.

## Repo Hygiene Rules

- Prefer one authoritative doc for current truth and link to detail docs instead of duplicating status prose everywhere.
- Do not check in workstation-specific absolute paths.
- Keep generated artifacts, transient captures, and local-only clutter out of version control.
- If a target-host release gate is red, either fix it or document precisely why the lane is intentionally non-blocking.

## Historical Note

The repository previously carried a full Electron/Next.js runtime alongside the native shell as a parity oracle. That runtime, its tests, and its CI/CD lanes were removed in `v2.1.0`. See `docs/archive/NATIVE_PARITY_HANDOFF.md` for the frozen parity appendix that drove the recovery program, and the `v2.0.1 → v2.1.0` changelog entries for the removal scope.
