# AGENTS.md

Entry point for Codex-assisted work in this repo. Keep it short. Follow the pointers into `docs/` for anything that needs depth.

## What this product is

`SSE ExEd Studio Control` — a native desktop studio console for a single fixed operator workstation. Planning, DMX lighting, audio mixer (OSC/TotalMix), and Stream Deck+ commissioning. Bundle id `com.sse.exedstudiocontrol`. Current published operator-rollout version is `v2.2.1` (2026-04-24) — the legacy Electron/Next.js runtime was retired in `v2.1.0`; there is no browser path.

## Architecture boundary (non-negotiable)

Two processes, separated by an IPC protocol:

- `native/tauri-shell/` + `frontend/` — selected shipping shell for the current published Tauri runtime, built on `Tauri 2 + React 19.2 + TypeScript + Vite`. **No device or DB logic in React.**
- `native/qt-shell/` — Qt 6 / QML fallback shell retained through the bounded cutover window. Owns windowing, input, and layout when explicitly selected as fallback. **No device or DB logic in QML.**
- `native/rust-engine/` — Rust. Owns state, persistence, device I/O, protocol dispatch.
- `native/protocol/` — the IPC contract between them. Changes here are contract changes.

Rule: if a change would move product state or device policy into QML or React, it is going in the wrong direction. Authoritative source: `docs/ARCHITECTURE.md`.

Qt fallback `Q_PROPERTY` / `Q_INVOKABLE` / signals live in the C++ adapter under `native/qt-shell/src/` (e.g. `EngineProcess.*`), not in the Rust engine. Engine-side additions feed those properties.

## Hardware target (binding)

- Primary operator surface: fullscreen `2560×1440` on a fixed second monitor.
- Minimum fallback: `1920×1080`.
- **No scroll during normal operation.** Dense fixed-height layouts.
- Devices currently in play: RME Fireface UFX III (audio), Litepanels Apollo Bridge / Astra Bi-Color / Aputure Infinimat / Infinibar PB12 (lighting), Stream Deck+ + Bitfocus Companion local (control).

When developing on a Retina MacBook, enforce the built-in-display review workflow from `docs/DEVELOPMENT.md`: use the BetterDisplay-backed mirrored `2560×1440` review surface for live visual inspection, and do not judge fit/layout from the default Retina logical desktop.

Authoritative source: `docs/HARDWARE_PROFILE.md`.

## Design system

One theme file, one `Console*` component library — extend additively, do not replace.

- `native/qt-shell/qml/ConsoleTheme.qml` — tokens: dark-only `studio950→050` grayscale, `#99BA92` primary green, accent reds/ambers/cyans, IBM Plex Sans / Plex Mono, spacing `4–20`, radii `6–24`, `controlHeight 36`, `toolbarHeight 44`.
- `native/qt-shell/qml/Console*.qml` — Badge, Button, ComboBox, Modal, Slider, StatCard, StatusBadge, Surface, Switch, TabButton, TextArea, TextField (plus `SafetyHoldButton.qml`).

No Quick Controls 2 style packs (Material / Fusion / Imagine). No third-party QML meta-frameworks (Kirigami / Felgo). No light mode. These choices are deliberate — don't re-open them without a delta spec.

When a workspace needs something new, add a variant to the existing component or a new `Console*` — don't bypass the tokens with ad-hoc hex literals.

## Runtime environment

- Qt floor: `qt_standard_project_setup(REQUIRES 6.5)` — `QtQuick.Effects` and modern Shapes are already available.
- C++20.
- Rust engine compiled and started by the current shell runtime.

Build & run commands live in `docs/DEVELOPMENT.md` (`npm run native:build`, `native:check`, `native:test`, `native:shell:test`, `native:foundation`, `native:acceptance`, `frontend:foundation`, `tauri:foundation`, packaging and installer lanes, etc.). Use them; don't invent new ones.

## Parity discipline

Every operator-visible change to a native surface must:

1. regenerate the deterministic offscreen `2560×1440` capture for the affected workspace,
2. produce two consecutive bit-identical runs on the same target-host verification lane before the baseline is accepted,
3. land a baseline commit with `parity: ...` in the subject so reviewers can filter.

Cross-platform pixel equivalence across lanes is not required — macOS and Windows diverge by driver. Per-lane determinism is the gate.

For live visual verification at true `2560×1440`, use `npm run native:parity:live -- --action=<name>` from `docs/DEVELOPMENT.md §2b`. Retina dev machines cannot produce a 1:1 onscreen `2560×1440`; the fixed studio workstation is the pixel-authoritative gate.

Baselines under `artifacts/parity/native/workstation/`.

During the cutover, Qt parity remains the fallback comparison gate. The Tauri shell uses Storybook, Playwright, fixture-driven smoke coverage, target-host release evidence, and the gate in `docs/FRONTEND_CUTOVER_PLAN.md` before the cutover can be declared complete.

## Testing posture

- QML structural tests: `native/qt-shell/tests/qml/tst_*.qml`. They assert wiring and behavior, not pixels. They preserve a qsettings org-identifier fix (PR #25) — keep tests hermetic.
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

| For…                                    | Go to…                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| Runtime boundaries, shell/engine rules  | `docs/ARCHITECTURE.md`                                                |
| Workstation dimensions, device list     | `docs/HARDWARE_PROFILE.md`                                            |
| Operator task flows, keyboard shortcuts | `docs/OPERATIONS.md`, `native/qt-shell/qml/OperatorShortcutLayer.qml` |
| Daily build/test/package commands       | `docs/DEVELOPMENT.md`                                                 |
| Release steps, acceptance checklist     | `docs/RELEASE.md`, `docs/PRODUCTIZATION_PLAN.md`                      |
| Current engineering truth / open items  | `docs/HANDOFF.md`                                                     |

If this file disagrees with any of the above, those docs win — this file is a pointer, not a spec.
