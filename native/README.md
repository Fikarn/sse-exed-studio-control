# Native Workspace

This directory contains the product runtime:

- `tauri-shell/`: selected native webview shell for the shipping runtime
- `rust-engine/`: Rust control engine
- `protocol/`: transport and message contract

The native runtime is the only product runtime. The legacy Electron/Next.js path was retired in `v2.1.0`.

`scripts/native-release-runtime.json` selects the shipping release runtime. `v2.2.0` shipped with `tauri` selected, and `v2.2.1` is the current published operator-rollout build. The fallback window is closed, and the Qt shell source/test tree has been removed through completed Checkpoint D.

The completed Tauri shipping switch and completed fallback retirement are tracked in [`docs/archive/FRONTEND_CUTOVER_PLAN.md`](../docs/archive/FRONTEND_CUTOVER_PLAN.md). Checkpoint D sequencing is recorded in [`docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md`](../docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md).

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
npm run native:package:win:local
npm run native:package:win:smoke
npm run native:package:win:clean-smoke
npm run native:installer:win:prepare
npm run native:installer:win:local
npm run native:update-repo:win:prepare
npm run native:update-repo:win:local
npm run native:release:win:local
npm run native:acceptance
npm run tauri:cutover:candidate
```

The two Tauri qualification commands launch the selected Tauri shell against the Rust engine and bind `127.0.0.1:4173`. Run them serially and stop other Vite preview/dev servers first.

`npm run tauri:cutover:candidate` is the historical local Checkpoint A gate for Tauri shell readiness. It keeps the existing Tauri checks serial and does not replace the selected shipping `native:*` release lanes.

## Local Build

Rust engine:

```bash
cd native/rust-engine
cargo check
```

Notes:

- `SSE_APP_DATA_DIR` and `SSE_LOG_DIR` are respected by the shell runtime, which makes sandboxed smoke tests and isolated local runs deterministic; an engine started with neither uses `%APPDATA%\ExEd Studio Control Native`, never a path relative to its working directory
- shell settings now persist through the Rust engine, including workspace plus window size/maximized state
- the engine imports no legacy `db.json` since the new pages program's Slice 2b retired the import (`storage.importLegacyDb` and the start-up auto-import): a start that finds a file at the path `SSE_LEGACY_DB_PATH` names, or at `<app-data>/import/db.json`, writes one `WARN` line naming it, or both ("A db.json at <path> was left alone: Studio Control no longer imports db.json files."), and reads nothing, and Verify and Restore refuse a `db.json` by name (unless it is a support archive), a file that is not UTF-8 included, before anything is written. `SSE_DISABLE_AUTO_IMPORT` is no longer read
- the saved data is at schema 8 since the new pages program's Slice 2: the 7 → 8 step drops Planning's four tables and every `planning.*` setting and turns a saved Planning page into the Console, after the verified `pre-migration` copy every upgrade writes; older builds refuse schema 8
- `dev.parityFixture.load` exists only in engines built with the `dev-fixtures` cargo feature (`npm run native:engine:build:dev-fixtures`); release engines answer `METHOD_UNAVAILABLE`. Since Slice 2b a load writes its settings directly, in one transaction, and over a completed setup it needs `replaceExistingData: true`
