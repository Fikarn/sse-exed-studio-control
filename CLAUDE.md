# CLAUDE.md

Entry point for Claude-assisted work in this repo. Keep it short. Follow the pointers into `docs/` for anything that needs depth.

## What this product is

`SSE ExEd Studio Control` — a native desktop studio console for a single fixed operator workstation. Planning, DMX lighting, audio mixer (OSC/TotalMix), and Stream Deck+ commissioning. Bundle id `com.sse.exedstudiocontrol`. Current published operator-rollout version is `v2.2.1` (2026-04-24) — the legacy Electron/Next.js runtime was retired in `v2.1.0`; there is no browser path.

## Architecture boundary (non-negotiable)

Two processes, separated by an IPC protocol:

- `native/tauri-shell/` + `frontend/` — selected shipping shell for the current published Tauri runtime, built on `Tauri 2 + React 19.2 + TypeScript + Vite`. **No device or DB logic in React.**
- `native/rust-engine/` — Rust. Owns state, persistence, device I/O, protocol dispatch.
- `native/protocol/` — the IPC contract between them. Changes here are contract changes.

Rule: if a change would move product state, persistence, or device policy into React, it is going in the wrong direction. Authoritative source: `docs/ARCHITECTURE.md`.

## Hardware target (binding)

- Primary operator surface: fullscreen `2560×1440` on a fixed second monitor.
- Minimum fallback: `1920×1080`.
- **No scroll during normal operation.** Dense fixed-height layouts.
- Devices currently in play: RME Fireface UFX III (audio), Litepanels Apollo Bridge / Astra Bi-Color / Aputure Infinimat / Infinibar PB12 (lighting), Stream Deck+ + Bitfocus Companion local (control).

Authoritative source: `docs/HARDWARE_PROFILE.md`.

## Design system

Use the frontend token and component packages as the shared UI foundation:

- `frontend/packages/tokens/` — generated design tokens and docs
- `frontend/packages/design-system/` — shared shell primitives and layout components
- `frontend/app/src/` — selected operator surfaces

Extend tokens and shared components additively. Do not bypass the frontend design system with one-off styling unless the change is explicitly scoped and documented.

## Runtime environment

- Rust engine compiled and started by the selected Tauri shell runtime.

Build & run commands live in `docs/DEVELOPMENT.md` (`npm run native:foundation`, `native:check`, `native:test`, `native:acceptance`, `frontend:foundation`, `tauri:foundation`, packaging and installer lanes, etc.). Use them; don't invent new ones.

## Visual Review Discipline

Every operator-visible change to the selected Tauri surface must:

1. run the relevant frontend, Tauri, or native validation lane for the changed surface,
2. run `npm run tauri:visual:review` when layout or operator presentation changes,
3. inspect the result on the BetterDisplay-backed `2560×1440` review surface or the fixed studio monitor when human fit judgment matters.

Tauri visual review, Playwright, fixture-driven smoke coverage, target-host release evidence, and the gate in `docs/FRONTEND_CUTOVER_PLAN.md` are the active validation path. Historical Qt parity screenshots were retired in Checkpoint D Slice 5.

## Testing posture

- Engine tests: `cargo test` under `native/rust-engine/`.
- Smoke / acceptance / bridge-qualification lanes: see `docs/DEVELOPMENT.md §2b` and §4.
- Target-host lanes: macOS and Windows native verification are both blocking release gates. Treat a Windows target-host failure the same as a macOS failure.

## Release posture

- QtIFW offline installers for Windows + macOS, plus QtIFW maintenance-tool update-repository archives.
- Distribution: GitHub Releases (direct download) + maintenance-tool update channel.
- Trigger: a `v*` tag identifies the release; local target-host gates build and verify artifacts, then `npm run release:publish -- --tag vX.Y.Z` uploads them to GitHub Releases.
- Deployment profile: one fixed studio workstation, unsigned controlled deployment. Public signing (Windows cert + Apple Developer) is deferred — see `docs/PRODUCTIZATION_PLAN.md §3`.
- Persistence compatibility: rollback to a prior tag must remain a reinstall-away. Do not change on-disk formats without an explicit migration plan.

Authoritative source: `docs/RELEASE.md` and `docs/PRODUCTIZATION_PLAN.md`.

## Retained legacy surface

Only one piece of pre-v2.0.0 code is intentionally retained:

- `native/rust-engine/src/legacy_import.rs` — one-way importer that reads a legacy Electron `db.json` on first native launch (env var `SSE_LEGACY_DB_PATH`). Do not touch it as part of new feature work; do not extend it; do not mirror it elsewhere.

## Where to look

| For…                                    | Go to…                                           |
| --------------------------------------- | ------------------------------------------------ |
| Runtime boundaries, shell/engine rules  | `docs/ARCHITECTURE.md`                           |
| Workstation dimensions, device list     | `docs/HARDWARE_PROFILE.md`                       |
| Operator task flows, keyboard shortcuts | `docs/OPERATIONS.md`                             |
| Daily build/test/package commands       | `docs/DEVELOPMENT.md`                            |
| Release steps, acceptance checklist     | `docs/RELEASE.md`, `docs/PRODUCTIZATION_PLAN.md` |
| Current engineering truth / open items  | `docs/HANDOFF.md`                                |

If this file disagrees with any of the above, those docs win — this file is a pointer, not a spec.
