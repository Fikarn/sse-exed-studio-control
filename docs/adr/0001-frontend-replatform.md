# ADR 0001: Frontend Replatform Foundation

Date: 2026-04-22

## Status

Accepted

## Context

The shipped product is a native desktop workstation built from a Qt/QML shell and a Rust engine. The engine boundary is correct and must remain authoritative for state, storage, device I/O, safety, and startup policy. The current QML shell is too expensive to evolve into the kind of modern, visually iterated operator surface the product now requires.

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
- Qt CI and release lanes remain authoritative until the Tauri shell proves safer to ship than the Qt shell
