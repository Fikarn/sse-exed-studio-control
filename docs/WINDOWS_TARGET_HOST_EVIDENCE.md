# Windows Target-Host Evidence

## Purpose

This runbook collects Windows 11 `x64` evidence for the selected native release runtime. It is the Windows side of the local/target-host release gate used after the Tauri shipping switch.

It does not authorize a release by itself. It proves the Windows side of the real QtIFW package, update, purge, reinstall, and operator-data preservation gate.

## Required Host

Use a Windows 11 `x64` machine that can build and run the selected native release runtime locally.

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

Run the switched native release evidence collector. Pass the active tracking issue when the run is tied to a release or evidence task:

```powershell
npm run native:release:win:evidence -- --issue-url https://github.com/Fikarn/sse-exed-studio-control/issues/6
```

The collector writes evidence under:

```text
artifacts/native-release/windows-target-host/
```

The newest run is also copied to:

```text
artifacts/native-release/windows-target-host/latest-summary.json
```

## What The Collector Verifies

The collector records host, tool, git context, and the selected native release runtime, then runs the switched shipping release gate:

```powershell
npm run native:release:win:local
```

That gate performs:

- selected runtime build through `npm run native:release:build`
- packaged native Windows build and smoke tests
- packaged acceptance with import, restart, restore, and relaunch persistence
- packaged control-surface bridge qualification
- real QtIFW offline installer build through `binarycreator`
- real QtIFW update repository build through `repogen`
- SHA256 manifest generation
- full artifact verification
- installer identity continuity verification
- staged install/update/reinstall delivery acceptance
- install through the generated native release installer
- installed shell launch against the bundled Rust engine
- maintenance-tool package listing and repository search
- purge through the maintenance tool
- reinstall through the generated candidate installer
- dashboard relaunch with preserved operator data
- support backup export after reinstall

## Evidence To Attach

Attach or summarize these paths on the active release/evidence issue:

- `artifacts/native-release/windows-target-host/latest-summary.json`
- the corresponding timestamped `summary.json`
- `logs/native-release-win-local.combined.log`
- `packaged-acceptance/`, `bridge-acceptance/`, `delivery-acceptance/`, and `installer-acceptance/` if the run fails or if detailed acceptance logs are requested

The summary is enough for routine gate tracking when the run passes, but keep both combined logs and the full folder until the active release/evidence issue is closed.

## Failure Rules

Do not claim Windows evidence if any of these are true:

- the script was run on non-Windows hardware
- the host is not `x64`
- the checkout was dirty before the run, unless the issue explicitly records why `--allow-dirty` was used
- `scripts/native-release-runtime.json` or `SSE_NATIVE_RELEASE_RUNTIME` did not select `tauri`
- `binarycreator.exe` or `repogen.exe` came from an unknown toolchain
- `npm run native:release:win:local` failed, was skipped, or made generated/source files dirty outside Tauri's platform-specific schema output
- installer acceptance was not exercised through the generated QtIFW installer

If the run fails, attach `latest-summary.json` and the combined log to the active release/evidence issue before changing code. The failure may be a real release blocker.
