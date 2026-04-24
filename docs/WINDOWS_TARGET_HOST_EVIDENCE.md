# Windows Target-Host Evidence

## Purpose

This runbook collects the Windows 11 `x64` evidence required by [FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md) before Checkpoint C can be claimed for the Tauri replacement shell.

It does not authorize cutover by itself. It only proves the Windows side of the real QtIFW package, update, purge, reinstall, and operator-data preservation gate.

## Required Host

Use a Windows 11 `x64` machine that can build and run the Tauri shell locally.

Required tools:

- Git
- Node.js 20 and npm
- Rust stable toolchain
- Windows build tools required by Tauri/Rust
- Qt Installer Framework with `binarycreator.exe` and `repogen.exe`

`binarycreator.exe` and `repogen.exe` must be on `PATH`, or exposed through:

```powershell
$env:SSE_QT_IFW_BINARYCREATOR = "C:\Qt\Tools\QtInstallerFramework\4.7\bin\binarycreator.exe"
$env:SSE_QT_IFW_REPOGEN = "C:\Qt\Tools\QtInstallerFramework\4.7\bin\repogen.exe"
```

Use the installed QtIFW version that matches the current macOS target-host gate unless a delta spec changes the packaging toolchain.

## Procedure

Start from a clean checkout of the candidate commit:

```powershell
git clone https://github.com/Fikarn/sse-exed-studio-control.git
cd sse-exed-studio-control
git checkout main
git pull --ff-only
npm install
```

Confirm the working tree is clean:

```powershell
git status --short
```

Run the evidence collector:

```powershell
npm run tauri:package:win:evidence
```

The collector writes evidence under:

```text
artifacts/tauri-qualification/windows-target-host/
```

The newest run is also copied to:

```text
artifacts/tauri-qualification/windows-target-host/latest-summary.json
```

## What The Collector Verifies

The collector records host, tool, and git context, then runs the target-host foundation gate:

```powershell
npm run tauri:foundation
```

That gate performs protocol generation, Rust engine build, Tauri shell build, and Tauri smoke coverage. The collector fails if the foundation gate fails or if generated files make the checkout dirty outside Tauri's platform-specific schema output under `native/tauri-shell/gen/schemas/`.

The collector then runs the real Windows package gate:

```powershell
npm run tauri:package:win:ifw-local
```

That gate performs:

- packaged Tauri candidate build and smoke test
- real QtIFW offline installer build through `binarycreator`
- real QtIFW update repository build through `repogen`
- full artifact verification
- install through the generated candidate installer
- installed shell launch against the bundled Rust engine
- maintenance-tool package listing and repository search
- purge through the maintenance tool
- reinstall through the generated candidate installer
- dashboard relaunch with preserved operator data
- support backup export after reinstall

## Evidence To Attach

Attach or summarize these paths on issue #3:

- `artifacts/tauri-qualification/windows-target-host/latest-summary.json`
- the corresponding timestamped `summary.json`
- `logs/tauri-foundation.combined.log`
- `logs/tauri-package-win-ifw-local.combined.log`
- `installer-acceptance/` if the run fails or if detailed installer logs are requested

The summary is enough for routine gate tracking when the run passes, but keep both combined logs and the full folder until the cutover issue is closed.

## Failure Rules

Do not claim Windows evidence if any of these are true:

- the script was run on non-Windows hardware
- the host is not `x64`
- the checkout was dirty before the run, unless the issue explicitly records why `--allow-dirty` was used
- `binarycreator.exe` or `repogen.exe` came from an unknown toolchain
- `npm run tauri:foundation` failed, was skipped, or made generated/source files dirty outside Tauri's platform-specific schema output
- `npm run tauri:package:win:ifw-local` failed or was skipped
- installer acceptance was not exercised through the generated QtIFW installer

If the run fails, attach `latest-summary.json` and the combined log to issue #3 before changing code. The failure may be a real cutover blocker.
