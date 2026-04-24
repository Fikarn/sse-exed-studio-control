# Architecture

## Product Shape

This application is a local-first studio workstation. The primary jobs are:

- lighting control
- audio control
- Stream Deck / Companion control-surface support
- production planning as a secondary workspace

Everything assumes a single trusted machine with no cloud dependency. Supported hardware assumptions are documented in [HARDWARE_PROFILE.md](HARDWARE_PROFILE.md).

## Runtime Layers

### Tauri shell (selected shipping runtime)

- owns the native webview shell under `native/tauri-shell/` and `frontend/`
- owns native windowing, startup routing, recovery presentation, and operator-facing shell chrome when the release runtime selector points at `tauri`
- preserves the same authoritative engine boundary and IPC contract as the Qt shell
- supervises the Rust engine as a child process through the Tauri bridge
- shipped in `v2.2.0` and satisfied the [FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md) Checkpoint C shipping-switch gate for tag commit `eb166092ad5483a00b6b59137062c86c3193ca53`

### Qt shell (fallback runtime during the bounded post-release fallback window)

- owns native windowing, startup routing, recovery presentation, and operator-facing shell chrome when selected as fallback
- supervises the Rust engine as a child process
- remains maintenance-only unless the task is a fallback release blocker, release-verification fix, or critical operator defect

### Rust engine

- owns persisted state, schema migrations, and legacy import
- owns planning, commissioning, dashboard, support, lighting, audio, and control-surface contracts
- owns device-facing safety rules, diagnostics, and recovery behavior
- exposes snapshots and commands over the native protocol in `native/protocol/v1.md`

### Native adapters

- lighting adapters stay behind engine-owned health, recall, and failure contracts
- audio adapters stay behind engine-owned sync, recall, and safety contracts
- control-surface exports and bridge behavior stay engine-owned

## Legacy Import

The Electron/Next.js runtime was removed in `v2.1.0`. A one-way import path in `native/rust-engine/src/legacy_import.rs` remains so that operators migrating from a pre-`v2.0.0` installation can bring their old `db.json` forward on first native launch. The legacy runtime itself is no longer in the repository.

## Studio Module Pattern

Any native studio domain should follow the same shape:

### 1. Domain model

- keep persisted values explicit and serializable
- separate persisted configuration from transient connection or probe state
- keep storage ownership in the Rust engine

### 2. Engine contract

- expose a clear snapshot shape
- expose command handlers for every write path
- emit explicit change events when authoritative state mutates

### 3. Shell integration

- request snapshots through the engine controller
- render operator-visible state without owning business logic
- avoid recreating server-style fetch layers inside shell code
- keep both QML and React shells derived from engine snapshots and explicit commands

### 4. Operational status

- expose readiness, failure, and recovery state through engine snapshots
- keep hardware disconnect and recovery behavior visible to the operator
- keep device I/O policy in the engine, not in QML

### 5. Tests

- validate storage and command behavior at the engine boundary first
- add smoke or acceptance coverage for packaged startup, failure, and lifecycle behavior

## Current Module Ownership

- `native/rust-engine/src/planning.rs`: planning storage, snapshots, and mutations
- `native/rust-engine/src/commissioning.rs`: commissioning state and probe flows
- `native/rust-engine/src/lighting.rs`: lighting snapshot, recall, and simulated backend boundary
- `native/rust-engine/src/audio.rs`: audio snapshot, sync, recall, and simulated backend boundary
- `native/rust-engine/src/support.rs`: backup, restore, and diagnostics support flows
- `native/rust-engine/src/control_surface.rs`: Stream Deck bridge and Companion export generation
- `frontend/app/src/app/OperatorShell.tsx`: Tauri operator shell surface derived from engine state
- `native/qt-shell/qml/Main.qml`: Qt fallback operator shell surface derived from engine state

## Refactor Rule

When adding a feature, define or extend the engine contract first. Only then wire the shell and adapter layers. If a change would move product state or device policy into QML or React, it is probably going in the wrong direction.
