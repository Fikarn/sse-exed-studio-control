# Tauri Shell

This directory contains the replacement native shell foundation for the frontend replatform.

Current posture:

- single-window shell
- Rust/Tauri backend
- frontend served from `frontend/app`
- existing Rust engine remains a separate process and is launched through bridge commands
- packaged candidates expect `studio-control-engine` / `studio-control-engine.exe` beside the Tauri shell executable, with `SSE_ENGINE_BIN` still available as an explicit override
- current scope is foundation work only; the Qt shell remains the shipping runtime

Key files:

- `src/main.rs`: Tauri shell entry point and bridge command registration
- `src/engine.rs`: engine process bridge for startup, requests, responses, and event forwarding
- `tauri.conf.json`: single-window shell config and frontend build wiring
- `capabilities/default.json`: default window capability
