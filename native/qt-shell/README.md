# Qt Shell

This is the native Qt/QML shell for the approved end-state architecture.

## Responsibilities

- bootstrap the desktop app
- supervise the Rust engine process
- show startup, recovery, and operator UI surfaces
- adapt engine state into QML-facing models

## Local Development

Prerequisites:

- Qt 6.5 or later with `Core`, `Gui`, `Qml`, `Quick`, and `QuickControls2`
- Qt Quick Test for local shell test runs
- CMake 3.24 or later
- a built Rust engine binary

Environment:

- `SSE_ENGINE_PATH`: optional absolute path to the Rust engine binary for development

Suggested future flow:

1. build the Rust engine
2. configure and build this Qt shell with CMake
3. optionally use `SSE_ENGINE_PATH` or `--engine-path` if you want to override the default engine resolution

Example on macOS with Homebrew Qt:

```bash
cd /path/to/sse-exed-studio-control
cmake -S native -B native/build -DCMAKE_PREFIX_PATH=/opt/homebrew/opt/qt
cmake --build native/build --parallel 4
```

Shell test example:

```bash
cd /path/to/sse-exed-studio-control
npm run native:shell:test
```

Use `native/build` rather than `/tmp` for local builds. On macOS, `/tmp` resolves through `/private/tmp`, which can break Qt-generated relative include paths during MOC compilation.

## Run Modes

The shell resolves the engine in this order:

1. `SSE_ENGINE_PATH`
2. bundled engine next to the app or in `../Resources/bin`
3. local development builds in `native/rust-engine/target/debug` and `native/rust-engine/target/release`
4. `PATH`

Useful launch options:

- `--smoke-test`: exit `0` after healthy startup, `1` on startup failure, `2` on startup timeout
- `--no-auto-start`: launch the shell without immediately starting the engine
- `--engine-path /abs/path/to/studio-control-engine`: use an explicit engine binary for this run
- `SSE_APP_DATA_DIR` / `SSE_LOG_DIR`: override the runtime directories used by the shell and engine for isolated runs

Smoke test example:

```bash
SSE_APP_DATA_DIR=/tmp/sse-qt-shell-smoke \
SSE_LOG_DIR=/tmp/sse-qt-shell-smoke/logs \
./native/build/qt-shell/sse_exed_native.app/Contents/MacOS/sse_exed_native -platform offscreen --smoke-test
```

When the shell is running normally, it restores and persists these settings through the Rust engine:

- workspace mode
- window width
- window height
- maximized/windowed state

The shell test lane currently covers shared operator-parity helper logic used by planning search/filter/sort behavior and control-surface selection lookups. Extend that suite as more logic is split out of `Main.qml`.
