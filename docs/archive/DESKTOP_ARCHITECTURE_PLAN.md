# Desktop Architecture Plan (archived 2026-04-21)

> Archived as of the `v2.1.0` release. This document is preserved for historical reference only. Current architecture truth lives in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`docs/HANDOFF.md`](../HANDOFF.md). References to "current Electron app" describe the pre-migration product surface and are retained as context for the original architecture rationale.

## Decision

The approved end-state architecture for this product is:

- `Qt/QML` desktop shell
- separate `Rust` control engine process
- no browser-served renderer
- no `localhost` UI runtime
- local IPC between shell and engine

This document describes the target system, the recommended technical choices inside that architecture, and the first implementation phases.

Supporting documents:

- [Engineering Handoff](../HANDOFF.md)
- [Native Parity Handoff (archived)](./NATIVE_PARITY_HANDOFF.md)
- [IPC Protocol v1](../../native/protocol/v1.md)

## Target Outcome

The target is not a generic native prototype.

The target is a native replacement for the current Electron-delivered product:

- same core product surface
- same operator workflows
- same local-first reliability expectations
- new runtime architecture underneath

In practical terms, the end state should be "the current working app, but implemented on the approved Qt/QML + Rust engine architecture instead of the current Electron + localhost runtime model."

## Product Priorities

The architecture should optimize for these priorities in order:

1. reliable first launch after install
2. stable long-running operation
3. safe hardware control and recovery
4. durable local persistence
5. predictable install, update, and rollback behavior
6. maintainable module boundaries

## Current Product Surface To Reproduce

Based on the current application structure, the native architecture must eventually cover these areas:

- planning:
  - projects
  - tasks
  - timer and status workflows
  - activity and time reporting
- lighting:
  - fixtures
  - groups
  - scenes
  - settings
  - DMX state and monitoring
  - spatial editor / plot workflows
- audio:
  - channel state
  - metering
  - snapshots
  - sync/status/settings workflows
- setup / commissioning:
  - setup wizard
  - connection tests
  - Stream Deck / Companion-related setup flows
- support flows:
  - health
  - backup / restore
  - app settings
  - system status / view state

This list is the parity target for the architecture effort. New-native work should be evaluated against whether it helps migrate one of these surfaces or the release-critical runtime beneath them.

## Recommended Technical Shape

### Shell

Use a thin Qt 6 shell built with CMake.

Recommended Qt responsibilities:

- application bootstrap
- windowing
- tray and menu integration
- startup and shutdown state machine
- installer and updater entry points
- log export and diagnostic surfaces
- process supervision of the Rust engine
- QML-facing view models and adapters

Recommended Qt building blocks:

- `QQmlApplicationEngine` to load the app from a QML module
- `qt_add_qml_module()` to package QML and resources
- `QProcess` to supervise the Rust engine
- `QStandardPaths` for app data, config, cache, and logs

### UI

Use QML for the operator surface and keep business logic out of QML.

Recommended UI boundary:

- QML for layout, animations, and operator input
- thin C++/Qt adapter objects exposed to QML
- no direct device or database logic in QML

The QML layer should consume stable view-model state and invoke explicit commands, not reach into engine details.

### Control Engine

Run the core control logic in a separate Rust process.

Recommended Rust responsibilities:

- domain state and validation
- persistence and migrations
- backup and restore
- health checks
- DMX / OSC / local hardware protocols
- Companion and export generation
- diagnostics and structured logs

The engine should be the only writer to the primary database.

### IPC

Use `QProcess` with `stdin/stdout` IPC for v1.

Reason:

- cross-platform with no extra runtime dependency
- directly supported by Qt via `QProcess`
- simpler supervision and restart behavior than sockets for a single supervised child
- easier local diagnostics than a binary transport in the first iteration

Recommended protocol for v1:

- UTF-8
- one compact JSON envelope per line
- request / response / event message types
- explicit request ids
- no implicit shared mutable state across the boundary

If performance later requires it, keep the message schema and replace only the framing or encoding.

### Persistence

Use SQLite as the primary live store.

Recommended profile:

- one engine-owned SQLite connection pool
- WAL journaling mode
- explicit schema migrations
- startup integrity check
- JSON export/import for operator backup portability

Important implementation note:

- SQLite documents a WAL-reset corruption bug found on `2026-03-03`, fixed on `2026-03-13` in `3.51.3` and later, with backports for `3.44.6` and `3.50.7`.
- Production builds should pin SQLite to a version containing that fix before enabling final WAL-based release builds.

### Installer / Updates

Use Qt Installer Framework for installers.

Recommended packaging posture:

- offline installers first
- signed installers on both target platforms if budget and ownership exist later
- conservative update flow via the maintenance tool before attempting silent background updates

Reason:

- Qt Installer Framework supports offline and online installers, maintenance tooling, and update repositories
- operator reliability matters more than the most invisible update UX

## Rejected Internal Alternatives

### Direct Rust-to-QML binding as the primary architecture

Not recommended as the main shape.

Reason:

- tighter FFI coupling between UI and engine
- weaker fault isolation
- harder restart and recovery behavior
- less explicit ownership boundary for persistence and hardware I/O

Direct bindings may still be useful for isolated helpers later, but not for the core engine.

### Local socket or server IPC as the first transport

Deferred.

It may become useful if the engine must outlive the UI process, but `QProcess` plus stdio is the better first shape for a supervised single-user desktop product.

## Runtime Topology

### Process model

1. Qt shell starts
2. shell validates local directories and packaged assets
3. shell starts Rust engine as a child process
4. shell waits for `engine.ready`
5. shell opens the main operator window
6. shell monitors engine health and exit state for the rest of the session

### Ownership

Qt shell owns:

- UX
- process lifecycle
- desktop integration
- operator recovery surfaces

Rust engine owns:

- business logic
- hardware control
- persistence
- health and diagnostics

## Recommended Module Layout

### Qt shell

- `bootstrap`: app startup, version info, settings path resolution
- `engine`: `QProcess` supervision, transport framing, restart policy
- `models`: QML-facing list/detail models
- `ui`: QML modules, reusable controls, screens
- `diagnostics`: local logs, crash surfaces, export bundle flow

### Rust engine

- `protocol`: request / response / event schema
- `app`: startup state machine
- `storage`: SQLite, migrations, backup/restore
- `planning`: projects/tasks/timers
- `lighting`: DMX state, scenes, groups, recovery
- `audio`: OSC state, snapshots, recovery
- `health`: status aggregation and diagnostics

## Startup State Machine

Startup should be explicit and observable.

Suggested phases:

1. verify packaged assets
2. resolve writable directories
3. start engine process
4. wait for `engine.ready`
5. request `health.snapshot`
6. fail startup if any stage exceeds its watchdog timeout
7. open main UI

If any phase fails, show a dedicated recovery surface with:

- clear failure text
- retry
- open log directory
- export diagnostics
- safe quit

## Data Safety

Recommended policy:

- one engine process is the single writer
- restore and export are explicit commands
- integrity checks run on startup and before maintenance operations
- backups are periodic and operator-triggerable

SQLite notes from official docs that should shape implementation:

- `PRAGMA integrity_check` performs a low-level formatting and consistency check
- `PRAGMA journal_mode=WAL` is appropriate, but version pinning matters because of the March 2026 WAL fix noted above

## UI State Model

The Qt shell should not mirror the entire engine internals.

Recommended pattern:

- engine publishes snapshots and events
- Qt adapters translate them into QML-facing models
- QML binds to stable properties and list models

Avoid:

- QML doing protocol parsing
- QML issuing raw transport messages
- UI code writing directly to disk or devices

## First Implementation Phases

### Phase 1. Native workspace bootstrap

- add a `native/` workspace
- scaffold the Qt shell
- scaffold the Rust engine
- define the IPC envelope

Exit criteria:

- repo contains the native runtime skeleton and protocol contract
- no existing app behavior is changed yet

### Phase 2. Engine supervision and handshake

- shell can launch engine
- engine emits `engine.ready`
- shell can send `engine.ping`
- shell can show engine state in a minimal QML screen

Exit criteria:

- shell and engine can talk over the chosen transport
- failures are surfaced explicitly

### Phase 3. Storage foundation

- add SQLite database bootstrap
- add migrations table
- add integrity check on startup
- add backup/export format boundary

Exit criteria:

- engine starts with a durable local store
- empty-machine boot path is deterministic

### Phase 4. Domain slices

- planning
- lighting
- audio
- setup / commissioning

Each slice should land through the engine boundary, not directly in UI code.

## Current Status

The native work is now past the "scaffold only" stage.

Implemented so far:

- native workspace structure
- Qt shell build and local smoke-test flow
- Rust engine build and local smoke-test flow
- startup handshake and watchdog
- storage bootstrap and SQLite initialization
- recovery surface and startup diagnostics
- persisted shell settings through the engine boundary

This is useful foundation work, but it is not yet a product architecture migration.

The next work should optimize for:

1. engine-owned application state
2. explicit service boundaries
3. release-critical desktop behavior

The next work should not optimize for:

- shell-only convenience features
- UI polish unrelated to startup or recovery
- direct hardware integrations before engine service boundaries are defined

## Foundation Exit Gate

Foundation is not complete just because the native scaffold builds.

Foundation should be considered complete only when all of the following are true:

1. the native shell and engine can boot, handshake, fail, and recover deterministically in development and packaged form
2. runtime directory resolution, logging, diagnostics, and smoke-test flows are stable and documented
3. the protocol, lifecycle states, and error model are explicit enough that domain work can build on them without redesign
4. the engine owns the persistence layer and the shell is no longer inventing product state locally
5. there is a documented parity map from the current Electron app surface to native engine modules and shell screens

By that definition, foundation is not fully done yet.

What is done:

- native workspace and build system
- engine supervision and watchdogs
- startup diagnostics and recovery path
- SQLite bootstrap
- shell settings persistence through the engine
- local smoke-test workflow

What is still required before foundation can be called complete:

- packaged-app startup verification, not only local development smoke tests
- protocol/lifecycle/error contract hardening
- a written parity map from current app surfaces to native modules
- the first non-shell application snapshot owned by the engine

## Milestone Reset

The following milestones replace the previous "generic next steps" as the active execution order after foundation.

### Milestone 1. Contract Hardening

Goal:

- freeze the first meaningful engine contract before domain work expands

Deliverables:

- protocol versioning rules for backward-incompatible and additive changes
- explicit engine lifecycle states and health semantics
- structured error taxonomy for startup, storage, protocol, and adapter failures
- one documented request/response shape for shell settings, app snapshot, and commissioning state
- shell rule: no QML code issues raw protocol messages

Acceptance criteria:

- protocol document is updated to cover lifecycle, errors, and schema ownership
- shell interacts through adapter methods only
- smoke tests still pass after any protocol cleanup
- parity-map inputs for current product surfaces are captured

### Milestone 1A. Parity Mapping

Goal:

- make the migration target explicit before deep domain work begins

Deliverables:

- one inventory of current Electron-era product surfaces and supporting APIs
- one mapping from those surfaces to planned native engine modules and shell views
- one classification for each area:
  - foundation
  - early migration
  - late migration

Acceptance criteria:

- no major current product surface is left unowned
- the team can answer "where does this current feature live in the native design?"
- foundation is not marked complete until this map exists

### Milestone 2. Application Core Model

Goal:

- create the first real engine-owned application model that is not just shell state

Recommended first domain:

- project/session/config state

Scope:

- project identity and metadata
- active session or workspace selection
- commissioning/configuration state that the shell can render without inventing data locally
- engine queries and commands for loading and updating this state

Acceptance criteria:

- shell renders the first real application screen from an engine snapshot
- the engine, not the shell, owns defaults and persistence for that state
- no direct file access or JSON persistence is added to QML

### Milestone 3. Commissioning State

Goal:

- define the long-lived local setup state needed for a first-launch experience

Scope:

- workstation commissioning status
- hardware profile selection or lock-in
- setup completeness flags
- paths and local dependencies needed for safe startup

Acceptance criteria:

- engine can answer "is this workstation commissioned enough to operate?"
- shell startup can branch between recovery, commissioning, and operator UI based on engine state
- commissioning state survives restart and reinstall through the engine-owned store

### Milestone 4. Adapter Boundaries

Goal:

- define the service boundaries for lighting, audio, and external control before implementing live integrations

Scope:

- adapter interfaces in Rust
- connection lifecycle
- health/status model
- safe no-op or simulated implementations for local validation

Acceptance criteria:

- engine health can report adapter status without UI-specific logic
- shell can render adapter readiness from engine data only
- no device-specific code is introduced directly into the shell

### Milestone 5. Release Path

Goal:

- make the native runtime releasable as a desktop program, not just runnable in development

Scope:

- packaged asset resolution
- installer layout and runtime directory behavior
- diagnostic bundle export
- packaged first-launch smoke test
- controlled-deployment and update-plan readiness

Acceptance criteria:

- packaged app can start on a clean machine profile
- first-launch diagnostics are recoverable when startup fails
- release verification covers install, first launch, restart, and persisted state

## Immediate Execution Plan

The immediate next coding phase should be:

1. complete Milestone 1 by hardening protocol, lifecycle, and error ownership
2. start Milestone 2 with the first engine-owned application model
3. defer further shell expansion unless required to surface engine state or recovery

## Architectural Guardrails

Use these rules to decide whether a change is on-track:

- if the shell stores product state on its own, the change is probably off-track
- if a new UI screen cannot be driven from an engine snapshot or command, the change is probably premature
- if a hardware integration cannot report health through a stable engine boundary, it is too early
- if a change improves startup, diagnostics, packaging, or recovery, it is usually on-track

## Definition Of "On Track"

The architecture effort is on track only if each phase reduces one of these risks:

- startup uncertainty
- state ownership ambiguity
- shell/engine coupling
- hardware integration fragility
- packaged-app release risk

## Current Implementation Slice

This slice establishes the approved architecture direction:

- architecture plan in the repo
- native workspace skeleton
- Qt shell scaffold
- Rust engine scaffold
- protocol contract

It is intentionally not a migration of the existing Electron runtime.

## References

- Qt `QQmlApplicationEngine`: https://doc.qt.io/qt-6/qqmlapplicationengine.html
- Qt `qt_add_qml_module()`: https://doc.qt.io/qt-6/qt-add-qml-module.html
- Qt `QProcess`: https://doc.qt.io/qt-6/qprocess.html
- Qt `QStandardPaths`: https://doc.qt.io/qt-6/qstandardpaths.html
- Qt Quick deployment: https://doc.qt.io/qt-6/qtquick-deployment.html
- Qt Installer Framework overview: https://doc.qt.io/qtinstallerframework/ifw-overview.html
- Qt Installer Framework updates: https://doc.qt.io/qtinstallerframework/ifw-updates.html
- SQLite `PRAGMA` docs: https://www.sqlite.org/pragma.html
- SQLite WAL docs: https://sqlite.org/wal.html
