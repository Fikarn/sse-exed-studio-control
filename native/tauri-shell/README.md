# Tauri Shell

This directory contains the selected native shell for the current shipping runtime.

Current posture:

- single-window Tauri 2 shell
- React frontend served from `frontend/app` in development and bundled for production builds
- Rust engine remains a separate process and is launched through bridge commands
- packaged shipping builds expect `studio-control-engine` / `studio-control-engine.exe` beside the Tauri shell executable, with `SSE_ENGINE_BIN` still available as an explicit override
- Qt/QML fallback retirement is complete; do not add a fallback shell path without a new architecture decision and release plan

Key files:

- `src/main.rs`: Tauri shell entry point and bridge command registration
- `src/engine.rs`: engine process bridge for startup, requests, responses, and event forwarding
- `tauri.conf.json`: single-window shell config and frontend build wiring
- `capabilities/default.json`: default window capability

Repo-root commands:

```bash
npm run tauri:dev
npm run tauri:build
npm run tauri:foundation
npm run native:foundation
```

Run `npm run tauri:visual:review` for operator-visible shell or layout changes.
