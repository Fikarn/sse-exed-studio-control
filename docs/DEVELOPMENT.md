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
npm run native:release:win:evidence -- --issue-url <active-evidence-issue-url>
```

`npm run tauri:setup-support:qualify` launches the real Tauri dev shell and covers the Setup/Support pilot (including the shell staying responsive while the engine sits in a stalled lighting probe against an unrouted address, and the diagnostics export landing in the app-data `exports` folder — 2026-09 production readiness, Slice 4), persisted restart, a database backup verified and restored through the running shell (`database-restore`: the graceful restart's `shutdown` backup is verified — junk beside it is called junk — then restored; the store restarts the link on `requiresRestart`, the bootstrap moves the backup into place and keeps the old file as `replaced` — 2026-09 production readiness, Slice 7), degraded startup/recovery posture (a blocked app-data directory and a corrupt database, the latter restored from the recovery surface through the engine's recovery mode and restarted into the restored data), an engine ended from outside (`engine-crash`: `ENGINE_EXITED` on the recovery surface within two seconds, then the automatic restart with a new process — 2026-09 production readiness, Slice 5) and a second copy of the shell launched while the first is up (`second-instance`: refused by the single-instance plugin — within 5 s on Windows and macOS, on Linux only after GTK's start-up, which waits about 30 s on the AT-SPI bus lookup under xvfb — or by the engine's `engine.lock` on a Linux session without a D-Bus session bus). `npm run tauri:workspaces:qualify` launches the same real shell and covers the commissioned dashboard plus live Lighting and Audio mutations across restart persistence. Since the new pages program's Slice 1 the saved data both lanes follow through backups, restores and restarts is a snapshot slot of the Console (it was the Planning projects), and the saved page is Lighting.

Both Tauri qualification lanes and Playwright preview use the fixed local port `127.0.0.1:4173` with strict port binding. Do not run them concurrently with each other or with the frontend workspace dev/preview servers (`npm run dev --workspace frontend/app`, `npm run preview --workspace frontend/app`); a stale or competing server makes the result invalid.

Both Tauri qualification commands write a `summary.json` evidence file. By default the summary is written to a temp directory and the path is printed. For target-host evidence capture, set `SSE_TAURI_QUALIFICATION_EVIDENCE_DIR=artifacts/tauri-qualification` before running the commands; this directory is intentionally ignored by git.

The promotion gate for the Tauri shipping switch lives in [FRONTEND_CUTOVER_PLAN.md](./archive/FRONTEND_CUTOVER_PLAN.md). Do not change shipping behavior, installer paths, or target-host gate status by inference; use that checklist as the cutover authority.

`npm run tauri:cutover:candidate` is the local Checkpoint A gate. It runs protocol checking, frontend foundation, Tauri foundation, Setup/Support qualification, workspace qualification, and visual review serially. None of those lanes calls the dev parity-fixture method; a session that needs it builds the engine with `npm run native:engine:build:dev-fixtures` first.

`npm run tauri:visual:review` is the repeatable replacement-shell visual evidence lane. It builds the React app, serves the fixture transport on `127.0.0.1:4173`, captures Setup/Support recovery plus Lighting and Audio screenshots at `1280x800`, `1440x900`, `1600x960`, `1728x1117`, `1920x1080`, and `2560x1440` logical CSS pixels, writes ignored evidence under `artifacts/visual/tauri-cutover/`, and fails if any captured operator path requires page scroll. Lighting also asserts toolbar primary-control fit, compact overflow reachability, narrow inspector drawer behavior, stage minimum bounds, and CSS-viewport-driven layout mode selection. Audio visual review also captures Scaled Studio Preview evidence for the key audio fixtures with `operatorReview=studio` and records preview fidelity metrics in the summary. This complements, but does not replace, live human review with Scaled Studio Preview or the fixed studio monitor.

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

**Operator ruling, 2026-09-18: only the Windows build and only `2560x1440` matter.** The Linux and macOS captures, the macOS release-evidence runner and the smaller-viewport guards (`audio-legibility`, `viewport-contract`, the captures below `2560x1440`) stay where they are, but nobody works on them: if one turns red for a reason that is not also a Windows `2560x1440` reason, say so, record it, and move on — and ask before deleting such a guard. The win32 gates at `2560x1440` (the 81 UI-contract boards, the win32 visual-review and Storybook captures, both Tauri qualification lanes on the workstation) are the ones that count. One exception (operator decision, 2026-09-23): `frontend-e2e` is a required check, so a change that moves a board refreshes its `linux` capture too, from the branch push run's `playwright-test-results` artifact, before it merges (the production readiness ledger, Baseline refresh procedure); `darwin` and the win32 captures at other sizes stay as they are.

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
2. Open the command palette with `Ctrl+K` (`⌘K` on macOS).
3. Run `Studio Preview: Enter 2560x1440 Review`.
4. Review the proportional `2560x1440` studio canvas scaled into the current window.
5. Run `Studio Preview: Exit Review` before judging native compact/windowed behavior.

`npm run tauri:dev` starts Vite and the selected Tauri shell; it does not rebuild `studio-control-engine`. If the dev shell lands on Incident Recovery immediately after protocol or engine changes, run `npm run native:engine:build` and relaunch `npm run tauri:dev`.

Scaled Studio Preview deliberately preserves studio layout mode, aspect ratio, and proportions while reducing physical size. It is valid for composition, relative density, toolbar fit, rail/stage/inspector balance, drawer behavior, and operator flow inspection. It is not a substitute for real physical-size readability or final studio-monitor ergonomics.

When changing CSS for a studio surface, keep Scaled Studio Preview fidelity in mind. Rules that decide operator density or compactness should be scoped to the logical operator surface, for example the shell/operator root container, so the scaled preview keeps the same effective layout as native `2560x1440`. Global viewport media queries may incorrectly treat the preview host window as a compact device and distort the studio-full layout; keep global media rules for truly global concerns such as `prefers-reduced-motion`.

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

### 2c. The UI contract (visual overhaul A)

Every operator surface is built to one written visual system, and that system is
measured rather than reviewed by eye. If you change anything the operator sees,
this is the lane that tells you whether you broke it.

**The system** is `docs/redesign/system-a-2026-09.md` — the cluster rule (header ·
cluster · bay · plate · footer), five elevation levels, four role hues, a 9-step
type scale with a 12 px floor, four radii, the motion policy, and §10's measures.
`docs/plans/visual-overhaul-a-2026-09.md` is the implementation record: thirteen
slices, each with a Status line saying what landed, what moved, and what was
deliberately left. Read the slice status before changing a surface it names — it
usually explains why something is the way it is.

**The gate** is `frontend/app/tests/ui-contract.spec.ts`. It renders 66 boards —
22 fixtures × 3 themes at 2560×1440 — plus the Storybook primitive pages, and
measures each one: type floor and distinct sizes, font families, pixel-sampled
text contrast, pointer-target size, radii, shadows and blur, gradients, running
animations at idle, chrome heights, page scroll, targets off the viewport, and a
forbidden-word scan of the rendered copy. Each board's numbers are ratcheted in
`frontend/app/tests/ui-contract.ratchets.json`: a measure may fall, never rise.

```bash
# from frontend/app — measures every board and writes the report + artifacts
node scripts/ui-census.mjs

# same, and re-seeds the ratchets from what it measured
node scripts/ui-census.mjs --write-ratchets
```

The census takes about four minutes. It writes per-board JSON to
`artifacts/ui-census/*.json` (untracked) with the offenders named, not just
counted — `outerBlurOver8UnlitEls`, `gradientsOffEls`, `backdropBlurEls`,
`runningEls` — plus `artifacts/ui-census/census.md` and `contrast.md`. Read those
lists when a measure is non-zero; the counts alone will not tell you which
element is wrong.

Re-seed the ratchets only after you have looked at the diff. `git diff` on
`ui-contract.ratchets.json` is the "numbers that moved" report, and the rule is
that nothing rises. To check that mechanically:

```bash
git diff --stat frontend/app/tests/ui-contract.ratchets.json
```

**Three sibling gates** run outside the census:

```bash
node scripts/check-operator-copy.mjs                 # repo root — forbidden words in operator copy
npm run test --workspace @sse/design-system          # incl. the CSS-literal allowlist test
```

- `scripts/check-operator-copy.mjs` (repo root, **not** `frontend/app/scripts/`)
  scans source for words that must never reach the operator — "engine",
  "backend", "transport", "IPC", "snapshot" outside the Console's scene
  primitive, and a raw `AUDIO_*` code leading a sentence. It holds at 0.
- `src/__tests__/css-literals.test.ts` in `frontend/packages/design-system`
  counts raw literals per stylesheet against an allowlist that may only shrink.
  A `box-shadow` whose value does not start with `var(` counts as a literal even
  when its colour is a token, and so does a raw `999px` radius — use
  `var(--radius-pill)`. Re-seed with
  `UPDATE_CSS_LITERALS=1 npx vitest run src/__tests__/css-literals.test.ts`.
- `themes.contrast.test.ts` in `frontend/packages/tokens` checks the role and
  display inks at the token layer, in all three themes, before anything renders.

**Traps that have cost real time here:**

- Playwright serves `frontend/app/dist`. Run `npm run build --workspace @sse/frontend-app`
  before any Playwright command or you will test the previous build. The
  Storybook lanes read `storybook-static` the same way.
- Never run `npm run frontend:storybook:build` while a Playwright run is in
  flight — the Storybook contract boards 404 mid-run and seven `ui-contract`
  tests fail for no reason.
- Raising a type size breaks layouts written for the old one, and only
  measurement finds it. Slice 11's 9.5 → 12 px raise silently pushed all 38 dBFS
  meter marks off the meters and clipped `PRE FADER` on the 1920 fallback. After
  a type change, re-run the workspace spec and sweep every leaf text node for
  `range.width > content width` on each fixture at 2560 and at 1920.
- To give a control a 24 px pointer target without moving the layout, grow the
  element and pay it back with a matching negative margin, painting the visible
  part on `::before`. `ScrubSlider` and `ScrubLabel` are the worked examples.
- Style Dictionary emits kebab-case. A stylesheet asking for
  `--size-compactControlHeight` silently gets nothing; the name is
  `--size-compact-control-height`.
- A Playwright case that fails now and then is a case with a cause. Production
  readiness S13 read the traces of the five that had failed on CI and every one
  was the test: a second click expected inside the 350 ms arm dwell in real time
  (a CI runner's clicks are over a second apart — use `helpers/pageClock.ts`),
  a key sent while `audio-workspace` was still the "Loading the console…" surface
  (wait for the control the key belongs to), a field read once straight after the
  pointer came up (wait for it to move). Only a wall-clock measurement goes on the
  quarantine list — see "Quarantined Playwright cases" under §4.
- Each workspace is a chunk of its own (production readiness S14), fetched after
  the shell has drawn, so `openFixture` returning says nothing about whether the
  workspace is on screen. A spec whose first step after `openFixture` is a key or
  a one-shot DOM read calls `expectWorkspaceMounted(page, workspace)` first
  (`tests/helpers/openFixture.ts`; it waits for a mark only the mounted workspace
  draws). Since 2026-09-23 the Console's loading surface is
  `data-testid="audio-workspace-loading"`, and `audio-workspace` is drawn only
  by the mounted Console (before, the loading surface carried it too).
- A value that depends on the page's clock is pinned or driven, never waited out
  (S15). The fixture double's simulated meters are a function of `Date.now()`, and
  the four strip levels are the Console's audio state as it was fetched at start —
  they do not move with the meter ticks, only the painter's canvas does; a timer
  that ends something (the recall pulse, 1.5 s) is waited for by what it ends. Use
  `page.clock.install()` before `openFixture`, `pausePageClock(page)` once the
  workspace is mounted, then `page.clock.runFor(...)` to run the metering
  interval and the painter's frames; `audio-metering.spec.ts` and
  `audio-render-budget.spec.ts` are the worked examples.

**Fixtures.** Every board is a fixture id from
`frontend/packages/test-fixtures/src/fixtures.json`, and any of them opens in the
browser at `/?fixture=<id>&transport=fixture` (add `&theme=graphite|bone` and
`&operatorReview=studio`). That URL against a preview server is the fastest way to
look at a state by hand — no engine, no Tauri shell:

```bash
npm run build --workspace @sse/frontend-app
npm run preview --workspace @sse/frontend-app -- --host 127.0.0.1 --port 4180 --strictPort
# then http://127.0.0.1:4180/?fixture=lighting-populated&transport=fixture
```

Use a port other than `4173`: Playwright binds that one with `--strictPort` and
will fail to start if you are holding it.

**Front-end map** (after production readiness S14). The shell is
`frontend/app/src/app/OperatorShell.tsx`; each workspace is a chunk cut by the three
`import()` calls in `workspaceChunks.ts` (the active one is fetched after the
shell's first draw, the other two at idle once ready; the fallback is
`startup/WorkspaceLoadingSurface.tsx`, test id `workspace-loading`). There is
deliberately no `manualChunks` rule by folder, and `build.cssCodeSplit` is `false`
so rule order never depends on which workspace opened first. Planning, the fourth
workspace, left the screen in the new pages program's Slice 1
(`docs/plans/new-pages-2026-09.md`). The two large workspaces are assemblers:

- Lighting — `lighting/LightingWorkspace.tsx` over `lighting/useLightingEditor.ts`,
  which composes the six hooks in `lighting/editor/` (rig, session, scene editor,
  fixture editor, rig controls, commands); the render is the six components in
  `lighting/regions/` (cluster, plate, bay, quick palette, bottom strips, dialogs),
  and `lighting/lightingWorkspaceModel.ts` holds the module-level helpers.
- Setup / Support — `setup/SetupSupportPilot.tsx` over `setup/useSetupPilot.ts`,
  `setup/pilot/` (state, actions, shortcuts, chrome), the runner's four steps in
  `setup/steps/` and `setup/support/` (the support screen, the dialogs, and
  `SetupWorkstationPlate.tsx` with Recent actions and the light-outputs switch).

The Console (`audio/AudioWorkspace.tsx` and `audio/components/`) was never over
the size guard and was not split. The fixture double is
`frontend/packages/engine-client/src/transports/fixtureTransport.ts` over twelve
modules in `transports/fixture/`, one request handler per domain
(`lightingRequests.ts`, `audioRequests.ts`, `setupRequests.ts`); `scripts/check-operator-copy.mjs` skips that folder. The
boundaries are `startup/ShellErrorBoundary.tsx` (root) and
`startup/WorkspaceErrorBoundary.tsx` (per workspace).

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

The store refreshes by domain (2026-09 production readiness, Slice 9 — findings F10, F11, F32). `engine-client/src/store/domainRefresh.ts` holds the two maps: `EVENT_DOMAIN_REFRESH satisfies Record<EventName, …>` (an event added to the protocol fails the typecheck until it is mapped) and the method-prefix list behind `domainsForMethod`, which also adds a workspace's own snapshots to the `settings.update` that opens it. Write a mapping from what the engine's snapshot builder reads, not from the event's name: the DMX monitor is built from the lighting snapshot, the commissioning snapshot carries the planning counts (until the new pages program's Slice 2; `planning.changed` refreshes only the commissioning snapshot since its Slice 1), a probe decides the lighting snapshot's `reachable` and the audio capabilities — both qualification lanes failed on couplings like these while the slice was written, and `domainRefresh.test.ts` holds the rules that came out of it. Every refresh goes through one queue in `createShellStore.ts` (`refreshDomains`): one batch in flight, whatever is asked for meanwhile goes out as the next, a partial refresh writes only the snapshots it fetched, and only the bootstrap writes the lifecycle. The fixture catalog is fetched once per session. Replies pass `snapshotGuards.ts` (top-level lists and ids only). `createShellStore(transport, { development })` — the app passes `import.meta.env.DEV` — decides what a malformed reply does: a development build throws, and `useShellSnapshot` rethrows it while rendering so the root boundary names the request and the field; a production build keeps the last good snapshot and records the failure. `vite dev`, Vitest and both qualification lanes (`tauri dev`) run the development store, so a reply the guards refuse fails them loudly; Playwright runs the production build. Boundaries: `startup/ShellErrorBoundary.tsx` at the root in `main.tsx` (works with no store), `startup/WorkspaceErrorBoundary.tsx` around the bay's surface in `OperatorShell.tsx`, keyed by experience, workspace and a reload counter, adding no element of its own. `?crash=<workspace>` on a fixture URL makes that workspace throw while rendering (fixture transport only, never inside the Tauri runtime); `window.__SSE_TEST_DISARM_CRASH__()` ends the fault. Record UI failures through `startup/reportUiFailure.ts`, which keeps each error object once.

#### Engine changes

```bash
npm run native:check
npm run native:test
npm run native:engine:build
```

Tests that drive the shared console link against a fake TotalMix on loopback (`audio/tests_console_link.rs`) wait on the link's own state, never on a sleep (production readiness S15): `settle_console_link(&pump)` returns once no send is pending, no read-back is outstanding and the test pump has flushed twice more, and a pull that must end incomplete gets a quiet window its timeout cannot reach. Two of them failed under load before that — a 150 ms quiet window raced a fake that streamed every 40 ms from another thread, and a recall test slept 500 ms between phases whose read-backs could still be in flight.

`npm run native:engine:build:dev-fixtures` builds the engine with the `dev-fixtures` cargo feature — the only build that answers `dev.parityFixture.load`; release engines and every other lane run without it and answer `METHOD_UNAVAILABLE`. `npm run native:test:dev-fixtures` runs that build's clippy and tests (2026-09 production readiness, Slice 1; in CI's `rust` job since 2026-09-23) and then builds the plain engine again, because the feature build's tests leave a `dev-fixtures` engine at `native/target/debug`, the path `native:package:*` copies.

The RME metering receive ports bind by the commissioned TotalMix address (2026-09 production readiness, Slice 6 — finding F05): `127.0.0.1` for a loopback console (`127.0.0.1` or `localhost`), every interface for a console on another host, and in both cases only datagrams from that address are read (`accept_source`; a foreign datagram is dropped and logged `WARN` once a minute per source address). `SSE_OSC_BIND_HOST=<ip>` overrides the bind address for a lab bench; a value that is not an IP address is logged and ignored. Unit tests bind their slots on ephemeral loopback ports and never touch 7001–7010 (`receive_sockets_bind_loopback_for_loopback_console` takes a free four-port base from a throwaway socket), and the hardware lane's `bind_live_global_slot_for_test` follows the engine's rule. The module is split by remote generation: `rme_totalmix_osc.rs` (the meter state, both metering paths, the metering thread with its ingress rule, the console-link service), `rme_totalmix_osc/classic_eq.rs` (the classic page-2 EQ command path), `rme_totalmix_osc/global_commands.rs` (the Global OSC channel and output-mix commands with the surface ↔ hardware maps) and `rme_totalmix_osc/tests.rs`; the module's `file:health` allowlist entry is gone.

Lighting state has one lock, one preview and one render generation, all in `native/rust-engine/src/lighting/state_lock.rs` (2026-09 production readiness, Slice 10 — findings F12, F18). Every lighting mutation loads the whole editor-state value, changes it and writes the whole of it back, so every entry point that can run one takes the lock around the whole of it: `with_lighting_state(|| …)` for the plain mutations and `with_lighting_state_and_preview(|preview| …)` for the preview-aware ones — the two lighting dispatchers in `app.rs`, the Stream Deck's lighting keys in `control_surface.rs`, the archive restore and the dev parity fixture. The lighting functions themselves take no lock, so they can call each other (`*_with_preview` falls through to the plain function); `std::sync::Mutex` is not re-entrant, and a lighting function that called `with_lighting_state` would hang, not fail. Lock order, everywhere: the lighting state lock, then the shared preview (`shared_lighting_preview()`); a reader (`lighting.snapshot`, the deck's LCD) takes the preview alone through `lock_shared_lighting_preview()`, before it reads the settings. Never hold the lighting lock and `AUDIO_STATE_LOCK` together — no lighting function calls into audio and no audio function into lighting; keep it that way. A new writer of `app.lighting.*` goes through a lighting function under the lock; a new writer of something the wire depends on that is not a lighting setting (the commissioned bridge address and universe today) calls `bump_lighting_render_generation()` after its write. The sACN thread (`lighting_sacn_output.rs`, `RenderSettingsCache`) reads the database only when that generation has moved, plus once every two seconds as a safety net, and renders every 40 ms tick from the settings it kept — settings, never frames: a fade and an identify burst are timestamps inside the settings and move with the clock. Tests: the preview and the generation are process-wide, so a test that reads or writes through the shared preview starts with `let _guard = crate::lighting::shared_preview_test_guard();`, and the generation is only ever asserted to have advanced. A commit waits for the disk (about 35 ms on the studio workstation), so a test that loops over writes stays in the tens.

The action log (`native/rust-engine/src/action_log.rs`, table `event_log`, schema 7; 2026-09 production readiness, Slice 11 — finding F30) records a discrete action that changed what a device receives, with who did it. It is not `engine_events.rs`, which _sends_ protocol events. The source is known at the entry points, not inside the functions they share, so that is where a row is written: `EngineApp::handle_request` (one hook after the dispatch, source `ui`; `action_log::ui_actions` is the method → row table), `handle_control_surface_http_action` (source `deck`; `action_log::deck_actions` reads the route, the key and the reply), `audio::apply_console_activity` (source `console`), the talkback watchdog's `release_expired_hold` (`watchdog`) and the bootstrap (`launch`). Rules a change has to keep: a ride is never a row (a fader, a gain, an intensity, a dial detent — a commit waits for the disk, about 35 ms here, and a dial sends a key per detent), nor a change staged in the lighting preview, a refused action or a selection; **a new protocol method fails `action_log::tests::every_contract_method_is_classified` until it is put in `RECORDED_UI_METHODS` or `NOT_AN_ACTION_UI_METHODS`**, and a recorded method needs an example in `ui_examples()`; a row that can ride a write its entry point already makes does (`storage::set_settings_owned_and` — the deck's last-event stamp, the console flush on the metering thread), so only a screen action pays a second commit; the engine writes the sentence the operator reads, the copy gate scans front-end source only, so `sentences_avoid_the_words_the_operator_never_reads` holds the rule on this side. `support.snapshot` carries the newest fifty as `recentEvents` and must never query in recovery mode (no database). Recording raises no event: the store fetches support when Setup opens and after `lighting.output.setArmed` (`domainRefresh.ts`).

Held light outputs (`lighting/output_arming.rs`, Slice 11 — F31): `app.lighting.output_armed` is `"false"` while held and anything else — above all absent — is armed, so a default launch is unchanged. The hold is applied in the sACN output loop (`SacnOutput::tick`), not in the renderer: `read_lighting_sacn_output_state` and the DMX monitor keep answering what _would_ be sent. `SSE_SAFE_START` is read with the other variables through the injected reader in `bootstrap::resolve_runtime_paths_from` and written by `hold_or_carry_light_outputs` right after the database is initialised, before any thread exists; never `std::env::set_var` in the test binary. The flag must survive both restores unchanged (`support.rs` leaves the key out of the archive and out of the prefix delete; the bootstrap carries it across a pending database restore). The `sacn` health entry stays `ok` while held — `attention` would turn the store's recovery state to `degraded` — and the output thread raises `app.changed { reason: "health" }` itself when its detail moves, because the registry only announces changes of state. `SacnOutput` takes its destination port as a field so `held_outputs_send_nothing` can listen on a loopback port of its own: tests never bind or send to 5568, and "nothing was sent" is asserted without a sleep (a marker datagram must be the next thing read; the first packet after arming has sequence 0).

Schema migrations (`storage.rs::migrate_schema`): every step is `if schema_version < N` with its own literal `N` in the inserted row and the assignment. Never key a step to `STORAGE_SCHEMA_VERSION` — the v5 → v6 step was, and raising the constant to 7 would have re-run its palette seed on every v6 database (Slice 11; `migrate_v6_to_v7_after_snapshot` tests the fresh, v5 and v6 roads). **A build with a higher schema migrates the operator's real database the first time it is started against the default app-data directory, and older builds then refuse it: never start `tauri:dev`, a release exe or `studio-control-engine.exe` by hand without `SSE_APP_DATA_DIR` pointing at a scratch directory.** The lanes and `native:test` use temporary directories.

`storage::list_settings_by_prefix` opens a connection per call, except on a thread that called `storage::enable_thread_read_connection()` — the sACN output, the TotalMix metering and the engine's bridge workers, the three threads that live as long as the engine and read settings all day (Slice 10 — F18). Their connection is opened read-write and made `query_only` (a read-only open fails on a write-ahead-log database whose `-shm` file is gone), is replaced when the database path differs, is dropped after a failed read, and never holds a statement between calls. Do not opt a test thread or the IPC thread in: a kept connection holds the database file open, which on Windows blocks removing a test's directory and renaming the database. A test bridge's workers do not opt in (`BridgeContext::keeping_read_connections` is set by `start_control_surface_bridge` only). Because those threads never close their connection, SQLite's checkpoint-on-last-close no longer happens while the engine runs or when it exits: `main.rs` calls `storage::checkpoint_database` after the shutdown backup, and `bootstrap::apply_pending_restore` calls it before it moves the database aside and deletes the `-wal` file. Anything new that moves, copies or replaces the database file must do the same first.

The engine logs through one process-wide writer (2026-09 production readiness, Slice 8 — findings F11, F14, F16, F27): `diagnostics::init_log` is called once in `main.rs` as soon as the runtime paths resolve, `log_event(level, message)` and the older `append_log(path, level, message)` with the engine's log path both go through it, `<logs>/engine.log` rotates at 5 MiB into `engine.log.1` … `.5`, and `read_log_tail` reads only the last 64 KiB of the current file for `health.snapshot`. Slice 8's 100 MB case, `diagnostics::tests::read_log_tail_scans_only_the_tail_of_a_large_log`, is opt-in because it writes 100 MB to the temp directory: run it after any change to `diagnostics.rs` with `SSE_ENGINE_TEST_LARGE_LOG=1 npm run native:test -- read_log_tail_scans_only_the_tail_of_a_large_log` (Git Bash; in PowerShell set `$env:SSE_ENGINE_TEST_LARGE_LOG='1'` first). It must read the tail in under 50 ms. `SSE_ENGINE_LOG_LEVEL` (`DEBUG` | `INFO` | `WARN` | `ERROR`, default `INFO`) is the level; `DEBUG` turns on the one line per request (`method=… id=… ms=… ok=…`), which is otherwise absent — the lanes and their status files never depend on it. `append_log` with any other path (the tests' temp logs) opens and appends that file per call as before. Exactly two `eprintln!` sites remain in `native/rust-engine/src`, both documented in the readiness ledger: the bootstrap failure before any runtime path exists (`main.rs`) and the stderr fallback inside `log_event` for a line the file could not take; the shell keeps engine stderr in `<logs>/shell.log` (`tauri-shell/src/shell_log.rs`, same rotation), and debug shells echo it to the console too. Health: `health::report(subsystem, state, detail)` feeds the registry `health.snapshot` derives its `status` from (`checks.engine` lists the entries); a change of state raises `app.changed { reason: "health" }` — report state changes, not attempts.

#### Opt-in real-hardware lane

```bash
npm run native:test:hardware
```

`npm run native:test:hardware` runs `cargo test --workspace -- --ignored` so it executes only the Rust tests marked `#[ignore]`. Those markers are reserved for device-bound tests that need real RME UFX III + TotalMix OSC traffic, a connected Stream Deck +, or a live DMX universe — environments CI cannot supply on stock `ubuntu-latest` runners and that the maintainer's laptop only partially supplies. The default `npm run native:test` and the CI `rust` job both skip these tests by design; the operator workstation runs `npm run native:test:hardware` as part of the pre-release smoke pass and records pass/fail per device. Today the lane runs `live_totalmix_pull_round_trip` (`native/rust-engine/src/audio/tests_console_link.rs`): a real `/sendall` + `/sendstate` pull from the studio TotalMix over Global OSC remote 4, asserting the dump is ingested and the console state lands `aligned`. It is read-only and never changes desk state; since Slice 6 its Global OSC slot binds `127.0.0.1:9004` by the engine's own rule, so the studio app must be closed first. New hardware-bound tests join the lane by carrying `#[ignore]`; nothing in package.json or AGENTS.md needs to change.

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

#### Supply chain

```bash
npm run supply-chain:check
```

Two halves, which also run one by one (`supply-chain:npm`, `supply-chain:cargo`) and on every push as the `supply-chain` CI job. Both read lockfiles only and both need the network — they judge today's advisory databases, so they are deliberately **not** part of `dev:check`, which has to work offline and must not change its answer overnight.

- **npm** — `scripts/check-npm-audit.mjs` runs `npm audit` for every lockfile in the repository with its own bar: what ships inside the app (`--omit=dev`) fails from `moderate`; what builds, lints and tests it fails from `high`; the SBOM generator's own tree under `tools/sbom/` fails from `high`. An advisory at or above the bar fails unless `scripts/npm-audit-allowlist.json` names it — advisory id and package — with a reason and an `expires` date at most 90 days out. An expired or malformed entry fails by itself and covers nothing; a report that is not an audit report (offline, registry error) is exit 2, never a pass.
- **cargo** — `cargo deny check` against `native/deny.toml` (advisories, bans, licenses, sources; `cargo install cargo-deny --locked` once), preceded by `scripts/check-deny-ignores.mjs`. cargo-deny keeps no time, so every advisory `deny.toml` ignores must be written on one line as `{ id = "RUSTSEC-…", reason = "… review by YYYY-MM-DD" }`, and the script fails once that date has passed (the same 90-day rule).

When the job is red: **take the fix first** — `npm update <package>` for a transitive npm package, `cargo update -p <crate>` (or `-p` the crate that pins it) in `native/` — and re-run the lanes the moved packages can touch. Do **not** reach for `npm audit fix`: on 2026-09-17 it proposed downgrading `esbuild`, the bundler that produces the shipped `dist`. List an exception only when there is no fix to take, say why it is acceptable _here_, and date it. A new licence in the Rust tree is a decision, not a formality: `deny.toml` names, per licence, the crates that need it.

#### Coverage floors

```bash
npm run frontend:test:coverage
npm run rust:coverage
```

Floors, not targets (production readiness Slice 13 — finding F25). A floor is the figure measured when it was set, minus two points: it fails when tests rot away or a large untested file lands, and says nothing about whether the coverage is good. Raise a floor when coverage has risen; lower one only with the reason written in the commit.

- **Vitest** — `frontend:test:coverage` runs the app, the design system and the engine client with v8 coverage; each workspace's `vitest.config.ts` carries its four thresholds. Every source file counts, loaded by a test or not, which is why the app's figure is low: its behaviour is covered by the Playwright suite, not by Vitest. The tokens package (its one test reads CSS) and shared-graphics (no tests) have no floor. It is part of `dev:check` and of the `frontend-test` CI job.
- **Rust** — `rust:coverage` is `cargo llvm-cov --workspace --fail-under-lines N` with the floor in the script (`cargo install cargo-llvm-cov --locked` and, from `native/`, `rustup component add llvm-tools-preview` once). The floor is the Linux runner's figure minus two points, because the `rust-coverage` CI job is where it is enforced; the workstation measures about the same but compiles different platform code. It rebuilds the workspace instrumented (several minutes, its own target folder), so it is a CI job and not part of `dev:check`.

#### Property tests

The two parsers that read bytes from outside the process have property tests beside their example tests (production readiness Slice 13; `proptest`, a dev-dependency of the engine): `control_surface_http/fuzz.rs` (the bridge's request reader and query decoder — no panic, a bounded read, a request that says what was sent) and `rme_totalmix_osc/fuzz.rs` (arbitrary and damaged datagrams through decode, the meter state and a console link of their own — no panic, and an accepted level is a level). They run with `native:test`. A failing case is shrunk and its seed written under `native/rust-engine/proptest-regressions/`: commit that file with the fix, so the case is replayed first on every later run. The first run found one: a NaN from the wire was taken as a meter level.

#### Quarantined Playwright cases

Playwright has two projects (production readiness Slice 13 — findings F25, F03). `default` is everything except the cases named in `frontend/app/tests/quarantine.json`, and it is what the `frontend-e2e` CI job fails on (`npm run frontend:playwright:test:blocking`). `quarantine` runs the listed cases one at a time with two retries, on CI in a step that reports and never fails the job (`frontend:playwright:test:quarantine`; its report and traces are the `playwright-quarantine` artifact). `npm run frontend:playwright:test` runs both, as the workstation lane always has.

The list is the membership — there is no tag to add in a spec — and a listed case blocks nothing, so `scripts/check-playwright-quarantine.mjs` holds it to rules: every entry names exactly one existing test and says why its assertion depends on the runner's speed and where that was seen; the visual and contract gates (`visual-review.spec.ts`, `storybook.spec.ts`, `ui-contract.spec.ts`) can never be listed; at most six cases; one exit date, at most 90 days out. `scripts:test` checks all of that except the date's distance from today; the CI job checks the date too, and **fails from the day after it** until the cases are back in `default` or deleted — the same deliberate behaviour as the supply-chain dates.

Before listing a case, find out why it fails: download the run's `playwright-test-results` artifact and read the case's `trace.zip` (action timings and DOM snapshots), and reproduce it locally by throttling the page's CPU over CDP (`Emulation.setCPUThrottlingRate`, rate 6–20). Only an assertion that _is_ a wall-clock measurement belongs on the list.

**The list has been empty since production readiness S15 (2026-09-21).** The last three cases were not wall-clock measurements after all, once their cause was found: the two `audio-render-budget.spec.ts` cases read their baseline inside the Console's own start-up renders (its mount, and a recall pulse that a 1.5 s timer ends) and now wait for the pulse to end; the metering case compared four strip levels rounded to whole percent that are fixed when the Console fetches its state — at 2 % of instants they round to one value — and now compares them as they are, with the page's clock running the canvas checks. An empty list quarantines nothing: `playwright.config.ts` builds `(?!)` for it (an empty `new RegExp("")` would match every title and leave `default` with no case), `frontend:playwright:test:quarantine` passes with no tests (`--pass-with-no-tests`), and `check-playwright-quarantine.test.mjs` lists both projects with an empty and a one-case list. A case put back on the list needs an `exit` date again.

#### Pull Request CI

Every pull request, and since production readiness Slice 0 (2026-09-10) every branch push (Dependabot branches excluded — their pull requests already run), triggers the ten-job workflow at [.github/workflows/dev-checks.yml](../.github/workflows/dev-checks.yml): `format-protocol`, `lint`, `frontend-typecheck`, `frontend-test`, `supply-chain`, `frontend-e2e`, `rust`, `rust-coverage`, `tauri-foundation`, and `qualification`. `format-protocol` runs `format:check`, repository script tests, `release:check`, `file:health`, and `protocol:check`; `frontend-test` runs `frontend:test` (Vitest across the frontend workspaces) and `frontend:test:coverage` (the coverage floors, production readiness Slice 13); `supply-chain` (production readiness Slice 12) runs the npm audit gate, the date check on `native/deny.toml`'s ignored advisories and `cargo deny check` — see "Supply chain" above; it reads today's advisory databases, so it can turn red on a push that changed nothing; `frontend-e2e` checks the quarantine list, then runs Playwright's `default` project (`frontend:playwright:test:blocking`, which includes the `visual-review.spec.ts` and `storybook.spec.ts` baselines) and fails on it, then the `quarantine` project in a step that reports and never fails the job — see "Quarantined Playwright cases" above — and uploads the Playwright report plus snapshot diffs as the `playwright-report`, `playwright-test-results` and `playwright-quarantine` artifacts; `rust` runs `rust:fmt:check`, `rust:clippy`, `native:check`, `native:test`, `native:test:dev-fixtures` and `native:acceptance` (the acceptance harness runs the engine in simulated audio input mode by default, so the audio probe passes honestly, sync and recall answer from the simulated console, and nothing is ever written to a real TotalMix — the same default applies on the workstation; `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1` opts into the live lane, which binds the real Global OSC remote, confirms every write by read-back, touches only unused surfaces (Phones 2, playback 7/8) and restores them in a `finally`; `native:test` runs unsimulated so the probe's no-traffic failure test stays honest); `rust-coverage` (production readiness Slice 13) runs `rust:coverage`, the instrumented `cargo test --workspace` with its line-coverage floor; `tauri-foundation` runs `tauri:foundation` (protocol generate → engine build → Tauri build → smoke); `qualification` runs `tauri:setup-support:qualify` and `tauri:workspaces:qualify` under `xvfb` with extended timeouts and the audio-probe skipped. These jobs are required merge hygiene on `main`. A second workflow, [.github/workflows/release-evidence.yml](../.github/workflows/release-evidence.yml), runs only on a `v*` tag or by hand and builds the packaged bundle, its SHA256 manifest and its SBOMs on clean Windows and macOS runners ([RELEASE.md §Release Evidence](./RELEASE.md#release-evidence-ci)); it publishes nothing. Target-host release evidence on macOS Apple Silicon and Windows 11 `x64` remains the release acceptance gate per [HANDOFF.md §Validation Baseline](./HANDOFF.md). Treat any red CI job the same way you would treat the same command failing locally before pushing.

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

**The packaged app is kept.** `release/` is not only build output: on a workstation that runs Studio Control from the repository — the studio workstation does — `release/native/<platform>/` is the installed app, and nothing in the repository can rebuild that exact build. Both commands therefore keep the whole `release/native` folder whenever a packaged shell or engine executable is anywhere inside it (a `windows.production-keep` folder left by a packaging lane counts), remove everything else as before — the other children of `release/` included — and say what they kept, with each file's size and date. `npm run clean -- --include-release` (or `clean:local`) removes the app as well; it refuses, before removing anything at all, while a process is running from that folder or when the running processes cannot be listed. `--dry-run` prints what would happen and removes nothing. A mistyped option stops the command instead of falling back to a plain clean. Until 2026-09-18 both commands deleted `release/` whole, the installed app with it; `scripts/clean.test.mjs` holds the rule, in temporary directories only. `scripts/native-package.mjs` is a different matter and is **not** guarded: it rebuilds `release/native/<platform>` by design, so on the workstation it runs only with that folder moved aside first (the procedure in the production readiness ledger).

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

`npm run file:health` (in `dev:check` and the `format-protocol` CI job) fails any tracked `.ts`, `.tsx`, `.css`, `.mjs` or `.rs` file over 2,000 lines, and since production readiness S14 it has **no allowlist for source files** — `scripts/file-health.test.mjs` fails if one comes back. Split before a file gets there, along the lines the code already has: S14 split the three workspace orchestrators, the fixture double and the Rust lighting tests by line range, every body verbatim ("Front-end map" in §2c), and S15 moved `audio.spec.ts`'s metering cases into `audio-metering.spec.ts` the same way. The largest product source is now `native/rust-engine/src/rme_totalmix_osc.rs`.

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
