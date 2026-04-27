# ADR 0001: Frontend Replatform Foundation

Date: 2026-04-22

## Status

Accepted

Post-acceptance update, 2026-04-25: `v2.2.0` shipped the `Tauri 2 + React 19.2 + TypeScript + Vite` shell as the selected release runtime through the `native:*` release lane, and `v2.2.1` is the current published operator-rollout build after the durable default app-data path fix. The bounded fallback window is closed; Checkpoint D issue #5 completed Qt/QML fallback retirement through the checked-in sequence, including source/test removal, Qt parity asset retirement, macOS shipping validation, and Windows target-host release evidence. Checkpoint D / Qt retirement is recorded by [QT_FALLBACK_RETIREMENT_AUDIT.md](../archive/QT_FALLBACK_RETIREMENT_AUDIT.md), not by this ADR.

## Context

At the time of this decision, the shipped product was a native desktop workstation built from a Qt/QML shell and a Rust engine. The engine boundary was correct and had to remain authoritative for state, storage, device I/O, safety, and startup policy. The QML shell was too expensive to evolve into the kind of modern, visually iterated operator surface the product required.

The repo also needs a frontend workflow that is compatible with component-driven visual development, deterministic fixtures, Playwright/Storybook review artifacts, and Codex-assisted UI iteration.

## Decision

The replacement frontend foundation is:

- native runtime remains mandatory
- new shell stack is `Tauri 2 + React 19.2 + TypeScript + Vite`
- the Rust engine remains authoritative and process-isolated
- the current Qt shell enters maintenance-only mode during the migration
- QtIFW packaging remains the shipping path until a later cutover phase
- the new shell lands the revised operator information architecture early:
  - monitor rail
  - workspace command rail
  - primary canvas
  - context rail
- `Setup/Support` is the pilot migrated workspace

## Consequences

- no new strategic UI architecture work should land in QML
- new frontend work should target `frontend/**` and `native/tauri-shell/**`
- protocol changes are contract changes and must land through `native/protocol/**`
- Storybook becomes the primary UI lab and Playwright becomes the primary flow/screenshot harness for the new shell
- after `v2.2.0`, the Tauri `native:*` release lane is authoritative; `v2.2.1` is the current published operator-rollout build, and the Qt fallback shell has been retired through completed Checkpoint D issue #5
