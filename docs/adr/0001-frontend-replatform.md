# ADR 0001: Frontend Replatform Foundation

Date: 2026-04-22

## Status

Accepted

Post-acceptance update, 2026-04-24: `v2.2.0` shipped the `Tauri 2 + React 19.2 + TypeScript + Vite` shell as the selected release runtime through the `native:*` release lane. The Qt/QML shell remains available only as the fallback runtime during the bounded post-release fallback window; Checkpoint D / Qt retirement is a separate follow-up and is not authorized by this ADR.

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
- after `v2.2.0`, the Tauri `native:*` release lane is authoritative while Qt remains a bounded fallback runtime until Checkpoint D
