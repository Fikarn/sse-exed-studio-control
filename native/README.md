# Native Workspace

This directory contains the product runtime:

- `tauri-shell/`: selected native webview shell for the shipping runtime
- `rust-engine/`: Rust control engine
- `protocol/`: transport and message contract

The native runtime is the only product runtime. The legacy Electron/Next.js path was retired in `v2.1.0`.

`scripts/native-release-runtime.json` selects the shipping release runtime. `v2.2.0` shipped with `tauri` selected, and `v2.2.1` is the current published operator-rollout build. The fallback window is closed, and the Qt shell source/test tree has been removed through Checkpoint D.

The completed Tauri shipping switch and retained fallback posture are tracked in [`docs/FRONTEND_CUTOVER_PLAN.md`](../docs/FRONTEND_CUTOVER_PLAN.md). Checkpoint D sequencing is recorded in [`docs/QT_FALLBACK_RETIREMENT_AUDIT.md`](../docs/QT_FALLBACK_RETIREMENT_AUDIT.md).

## Repo Commands

From the repo root, prefer the wrapped commands:

```bash
npm run native:check
npm run native:test
npm run native:foundation
npm run frontend:foundation
npm run tauri:foundation
npm run tauri:setup-support:qualify
npm run tauri:workspaces:qualify
npm run native:package:mac:local
npm run native:package:mac:smoke
npm run native:package:mac:clean-smoke
npm run native:package:win:local
npm run native:package:win:smoke
npm run native:package:win:clean-smoke
npm run native:installer:mac:prepare
npm run native:installer:mac:local
npm run native:installer:win:prepare
npm run native:installer:win:local
npm run native:update-repo:mac:prepare
npm run native:update-repo:mac:local
npm run native:update-repo:win:prepare
npm run native:update-repo:win:local
npm run native:release:mac:local
npm run native:release:win:local
npm run native:acceptance
npm run tauri:cutover:candidate
```

The two Tauri qualification commands launch the replacement shell against the Rust engine and bind `127.0.0.1:4173`. Run them serially and stop other Vite preview/dev servers first.

`npm run tauri:cutover:candidate` is the local Checkpoint A gate for the replacement shell. It keeps the existing Tauri checks serial and does not imply cutover readiness by itself.

## Local Build

Rust engine:

```bash
cd native/rust-engine
cargo check
```

Notes:

- `SSE_APP_DATA_DIR` and `SSE_LOG_DIR` are respected by the shell runtime, which makes sandboxed smoke tests and isolated local runs deterministic
- shell settings now persist through the Rust engine, including workspace plus window size/maximized state
- when native planning tables are empty, the engine will auto-import a legacy `db.json` from `SSE_LEGACY_DB_PATH` or, in repo-local development, from `data/db.json`
- set `SSE_DISABLE_AUTO_IMPORT=1` to disable startup auto-import
