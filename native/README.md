# Native Workspace

This directory contains the product runtime:

- `tauri-shell/`: selected native webview shell for the current cutover candidate
- `qt-shell/`: Qt/QML fallback desktop shell
- `rust-engine/`: Rust control engine
- `protocol/`: transport and message contract

The native runtime is the only product runtime. The legacy Electron/Next.js path was retired in `v2.1.0`.

During the cutover, `scripts/native-release-runtime.json` selects the shipping release runtime. The current candidate selects `tauri`; `qt-shell/` remains available as fallback with `SSE_NATIVE_RELEASE_RUNTIME=qt`.

The promotion gate for completing the Tauri shipping switch lives in [`docs/FRONTEND_CUTOVER_PLAN.md`](../docs/FRONTEND_CUTOVER_PLAN.md). Do not infer cutover readiness from local Tauri success alone.

## Repo Commands

From the repo root, prefer the wrapped commands:

```bash
npm run native:check
npm run native:test
npm run native:build
npm run native:shell:test
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
npm run native:smoke
npm run native:smoke:clean-start
npm run native:smoke:bundled-engine
npm run native:smoke:restart:clean-start
npm run native:smoke:lifecycle
npm run native:smoke:failures
npm run native:acceptance
npm run tauri:foundation
npm run tauri:setup-support:qualify
npm run tauri:workspaces:qualify
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

Qt shell:

```bash
cmake -S native -B native/build -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt
cmake --build native/build --parallel 4
```

Native startup smoke test:

```bash
SSE_APP_DATA_DIR=/tmp/sse-qt-shell-smoke \
SSE_LOG_DIR=/tmp/sse-qt-shell-smoke/logs \
native/build/qt-shell/sse_exed_native.app/Contents/MacOS/sse_exed_native -platform offscreen --smoke-test
```

Notes:

- use `native/build`, not `/tmp`, for local macOS builds because `/tmp` resolves through `/private/tmp` and can break Qt-generated relative include paths
- on macOS with Homebrew Qt, `CMAKE_PREFIX_PATH=/opt/homebrew/opt/qt` is required unless your environment already exports the Qt CMake package location
- the Qt shell now auto-discovers a locally built development engine at `native/rust-engine/target/debug/` or `native/rust-engine/target/release/` before falling back to PATH lookup
- `SSE_APP_DATA_DIR` and `SSE_LOG_DIR` are respected by the shell runtime, which makes sandboxed smoke tests and isolated local runs deterministic
- shell settings now persist through the Rust engine, including workspace plus window size/maximized state
- when native planning tables are empty, the engine will auto-import a legacy `db.json` from `SSE_LEGACY_DB_PATH` or, in repo-local development, from `data/db.json`
- set `SSE_DISABLE_AUTO_IMPORT=1` to disable startup auto-import
- `npm run native:shell:test` runs the Qt Quick Test lane for shared native operator-shell logic
