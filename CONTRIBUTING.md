# Contributing

## Scope

This project is a production-grade local studio console. It is not a generic dashboard starter or an experimental demo. Contributions should preserve:

- live-operator reliability
- clear second-monitor ergonomics
- hardware-specific correctness
- maintainable domain boundaries

If a change improves a secondary feature but increases risk to lighting, audio, setup, startup, shutdown, or persistence, the safer path wins.

## Prerequisites

- Node.js 20
- npm
- Rust stable toolchain
- Qt Installer Framework for local release packaging

Initial setup:

```bash
npm install
```

## Development Entry Points

```bash
npm run format:check
npm run release:check
npm run native:check
npm run native:test
npm run native:foundation
npm run frontend:foundation
```

## Validation Expectations

Choose validation based on change risk.

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
npm run release:verify
```

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
