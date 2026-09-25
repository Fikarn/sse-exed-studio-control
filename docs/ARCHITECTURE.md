# Architecture

## Product Shape

This application is a local-first studio workstation. The primary jobs are:

- lighting control
- audio control
- Stream Deck / Companion control-surface support

Production planning was a secondary workspace until the new pages program (`docs/plans/new-pages-2026-09.md`) removed it: from the screen in Slice 1, from the engine, the contract and the saved data (schema 8) in Slice 2. The same program later adds two workspaces, Cameras and Teleprompter (its Part C).

Everything assumes a single trusted machine with no cloud dependency. Supported hardware assumptions are documented in [HARDWARE_PROFILE.md](HARDWARE_PROFILE.md).

## Runtime Layers

### Tauri shell (selected shipping runtime)

- owns the native webview shell under `native/tauri-shell/` and `frontend/`
- owns native windowing, startup routing, recovery presentation, and operator-facing shell chrome when the release runtime selector points at `tauri`
- preserves the authoritative engine boundary and IPC contract
- supervises the Rust engine as a child process through the Tauri bridge
- shipped in `v2.2.0` and satisfied the [FRONTEND_CUTOVER_PLAN.md](./archive/FRONTEND_CUTOVER_PLAN.md) Checkpoint C shipping-switch gate for tag commit `eb166092ad5483a00b6b59137062c86c3193ca53`; `v2.2.1` is the current published operator-rollout build after the durable default app-data path fix

### Rust engine

- owns persisted state, schema migrations, and legacy import
- owns commissioning, dashboard, support, lighting, audio, and control-surface contracts
- owns device-facing safety rules, diagnostics, and recovery behavior
- exposes snapshots and commands over the native protocol in `native/protocol/v1.md`

### Native adapters

- lighting adapters stay behind engine-owned health, recall, fixture-catalog, DMX mapping, validation, scene serialization, and failure contracts
- audio adapters stay behind engine-owned sync, recall, and safety contracts
- control-surface exports and bridge behavior stay engine-owned

## Legacy Import

The Electron/Next.js runtime was removed in `v2.1.0`. A one-way import path in `native/rust-engine/src/legacy_import.rs` remains so that operators migrating from a pre-`v2.0.0` installation can bring their old `db.json` forward on first native launch. The legacy runtime itself is no longer in the repository.

Since the new pages program's Slice 2 the import carries only what is not Planning — whether setup is complete and the page to open — and ignores the rest of a `db.json`. It is interim: Slice 2b retires it (`storage.importLegacyDb`, the start-up auto-import and `SSE_LEGACY_DB_PATH`) once the lanes that seed a test engine through it are seeded through the app's own requests.

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
- keep React surfaces derived from engine snapshots and explicit commands

### 4. Operational status

- expose readiness, failure, and recovery state through engine snapshots
- keep hardware disconnect and recovery behavior visible to the operator
- keep device I/O policy in the engine, not in React

### 5. Tests

- validate storage and command behavior at the engine boundary first
- add smoke or acceptance coverage for packaged startup, failure, and lifecycle behavior

## Current Module Ownership

- `native/rust-engine/src/commissioning.rs`: commissioning state and probe flows
- `native/rust-engine/src/lighting/`: lighting snapshot, recall, fixture catalog, DMX mapping/validation, scene serialization, and simulated backend boundary
- `native/rust-engine/src/audio/`: audio snapshot, sync, recall, and simulated backend boundary
- `native/rust-engine/src/support.rs`: backup, restore, and diagnostics support flows
- `native/rust-engine/src/control_surface.rs`, `exports.rs`: Stream Deck bridge and Companion export generation (the deck's pages, their order and the page-follow triggers come from one list, `DECK_PAGES` in `exports.rs`)
- `native/rust-engine/src/control_surface_http.rs`: the bridge's HTTP reader, bearer-token authorization and worker pool (2026-09 production readiness, Slice 2)
- `native/rust-engine/src/storage.rs`, `storage_backups.rs`: SQLite storage, schema migrations, the integrity check at start and the verified database backups (Slice 3)
- `native/rust-engine/src/health.rs`: the health registry `health.snapshot` derives its status from (Slice 8)
- `native/rust-engine/src/lighting/state_lock.rs`, `lighting/output_arming.rs`, `lighting_sacn_output.rs`: the one lighting lock, preview and render generation; held light outputs; the sACN output (Slices 10, 11)
- `native/rust-engine/src/action_log.rs`: the action log with sources (Slice 11); `engine_events.rs` sends protocol events
- `native/rust-engine/src/rme_totalmix_osc.rs`, `rme_console_link.rs`, `audio/console_link.rs`: TotalMix metering and its ingress rule, the console link that confirms every send
- `native/tauri-shell/src/engine.rs`, `shell_log.rs`: the engine process, its exit watcher and restart hand-off, the shell's copy of its stderr (Slices 5, 8)
- `frontend/packages/engine-client/src/store/`: the shell store, the domain-scoped refresh (`domainRefresh.ts`) and the reply guards (`snapshotGuards.ts`) (Slice 9)
- `frontend/app/src/app/OperatorShell.tsx`: Tauri operator shell surface derived from engine state; each workspace is a chunk of its own (`workspaceChunks.ts`, Slice 14) — the map is in `docs/DEVELOPMENT.md` §2c, "Front-end map"

## Refactor Rule

When adding a feature, define or extend the engine contract first. Only then wire the shell and adapter layers. If a change would move product state or device policy into React, it is probably going in the wrong direction.
