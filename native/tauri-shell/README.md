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

Shell hardening (2026-09 production readiness, Slice 4 — findings F07, F08, F15):

- every command that can wait (`engine_start`, `engine_request`, `engine_stop`, `engine_summary`, `shell_confirm_close`, `shell_open_path`, `shell_export_diagnostics`) is an `async fn` that hands its wait to the async runtime's blocking pool, so the thread that paints the window and dispatches the next IPC call never blocks on an engine reply
- `EngineBridge::request` refuses an id that is already waiting for a response (`DUPLICATE_REQUEST_ID`); the frontend transport numbers its requests per session (`<method>:<sequence>:<session nonce>`)
- `tauri.conf.json` sets `app.security.csp` (`default-src 'self'`, no inline or remote scripts, IPC origins only in `connect-src`); Tauri injects it into the packaged document on `http://tauri.localhost` as a header and a `<meta>` tag. `devCsp` records the policy the Vite dev document would need; Tauri 2.11 does not inject a policy into a document loaded from `devUrl`. `scripts/tauri-smoke.mjs` fails if either is missing or the packaged policy loosens
- `shell_open_path` canonicalises the path and opens it only when it sits under the app-data directory (which holds `backups` and `exports`), the logs directory or the configured update repository; anything else answers `PATH_OUTSIDE_APP_DATA`, a missing path `PATH_NOT_FOUND`
- `shell_export_diagnostics(report)` writes `<app-data>/exports/diagnostics-<UTC timestamp>.json` and nowhere else; the `test-bridge` feature adds `shell_test_bridge_export_diagnostics_to(report, directory)` for the qualification lanes

Engine supervision and single instance (2026-09 production readiness, Slice 5 — findings F09, F19):

- an exit watcher polls the engine process every 250 ms (the process mutex is held only for the poll); when the process is gone, every request still waiting is answered `ENGINE_EXITED`, `engine://event` carries `engine.exited { status, graceful, generation, pid }`, and the bridge is empty for the next `engine_start`. `stop()` marks the exit expected before it closes stdin, so a restart or the close reports `graceful: true`; whichever of the watcher and `stop()` takes the process reports it, exactly once
- `engine_start` and `engine_summary` answer `pid` and `generation` (the launch number within this shell); the front-end keeps the generation to tell a stale `engine.exited` from a current one, and the test bridge's status carries `enginePid` / `engineGeneration` for the qualification lane
- `tauri-plugin-single-instance` is the first plugin registered: a second launch hands its arguments to the running shell, which unminimises, shows and focuses its window, and exits. On Linux the plugin needs a D-Bus session bus; without one it stays silent and the engine's exclusive lock on `<app-data>/engine.lock` (`ENGINE_ALREADY_RUNNING` for the second engine) is the guard

Repo-root commands:

```bash
npm run tauri:dev
npm run tauri:build
npm run tauri:foundation
npm run native:foundation
```

Run `npm run tauri:visual:review` for operator-visible shell or layout changes.
