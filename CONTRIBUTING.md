# Contributing

## Scope

This project is a production-grade local studio console. It is not a generic dashboard starter or an experimental demo. Contributions should preserve:

- live-operator reliability
- clear second-monitor ergonomics
- hardware-specific correctness
- maintainable domain boundaries

If a change improves a secondary feature but increases risk to lighting, audio, setup, startup, shutdown, or persistence, the safer path wins.

## Prerequisites

- Node.js 24
- npm
- Rust stable toolchain
- Qt Installer Framework for local release packaging

Initial setup:

```bash
npm install
npm run doctor
```

For a complete cold-start path, use [docs/DEVELOPER_QUICKSTART.md](docs/DEVELOPER_QUICKSTART.md).

## Development Entry Points

```bash
npm run doctor
npm run dev:check
npm run format:check
npm run release:check
npm run native:check
npm run native:test
npm run native:foundation
npm run frontend:foundation
```

## Validation Expectations

Choose validation based on change risk.

There are intentionally no GitHub Actions acceptance gates. Validation is local and target-host based; record the commands you ran in the PR.

### Tauri shell, React frontend, or operator layout

```bash
npm run format:check
npm run frontend:foundation
npm run tauri:foundation
```

### Engine logic, persistence, or adapters

```bash
npm run native:check
npm run native:test
npm run native:engine:build
```

### Shipping runtime, startup, layout, or commissioning

```bash
npm run native:foundation
```

### Native persistence, release, or recovery behavior

```bash
npm run native:acceptance
```

### Release preparation

```bash
npm run doctor:release
npm run release:verify
```

Release packaging and installer evidence must run on the relevant target host. macOS Apple Silicon and Windows 11 `x64` release hosts build and verify their own QtIFW installers, update repositories, checksums, and continuity evidence.

## Repo Conventions

- Keep changes inside the correct layer:
  - `frontend/*` for selected Tauri-shell operator UI
  - `native/tauri-shell/*` for selected shell windowing and Tauri integration
  - `native/rust-engine/*` for engine-owned state, persistence, and device logic
  - `native/protocol/*` for the transport contract
  - `docs/*` for durable product and engineering documentation
- Prefer extending the current domain modules over creating cross-cutting "misc" abstractions.
- Avoid accidental hardware writes on mount or view switch.
- Update docs when supported workflows or hardware assumptions change.
- Update `CHANGELOG.md` for user-facing changes.

## Dependency Upgrade Policy

The active development baseline is Node 24 LTS and TypeScript 6.0. Routine minor/patch dependency updates may be handled through Dependabot and the normal local gates. Major TypeScript and `@types/node` upgrades are intentionally not background maintenance; they need an engineering-task issue, a stated validation plan, and updated docs if the baseline changes.

## Pull Requests

Every PR should make it easy for a reviewer to answer:

1. What changed?
2. Why was it necessary?
3. What could regress?
4. How was it validated?

Use the PR template. Include screenshots or short clips for UI changes, and call out hardware/manual validation for lighting, audio, setup, or packaging behavior.

## Hardware Awareness

This repo is tuned to the current studio installation, not a generic matrix of devices. Before changing audio, lighting, or commissioning flows, read:

- [docs/HARDWARE_PROFILE.md](docs/HARDWARE_PROFILE.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
