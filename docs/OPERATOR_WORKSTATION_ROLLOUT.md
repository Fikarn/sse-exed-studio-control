# Operator Workstation Rollout

## Purpose

This runbook verifies the published `v2.2.1` installer on the intended operator workstation before the bounded Qt fallback window can be closed.

It is the execution procedure for [GitHub issue #4](https://github.com/Fikarn/sse-exed-studio-control/issues/4). It does not authorize Checkpoint D or Qt retirement. Qt fallback remains retained until issue #3 is explicitly updated and a separate retirement issue is opened.

## Plan Anchor

- Cutover gate: [FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md)
- Release procedure: [RELEASE.md](./RELEASE.md)
- Operator recovery: [OPERATIONS.md](./OPERATIONS.md)
- Hardware target: [HARDWARE_PROFILE.md](./HARDWARE_PROFILE.md)
- Rollout issue: [GitHub issue #4](https://github.com/Fikarn/sse-exed-studio-control/issues/4)
- Release: [v2.2.1](https://github.com/Fikarn/sse-exed-studio-control/releases/tag/v2.2.1)
- Release tag commit: `951a2c4e1f236200f0f017121158bc9969427051`
- Superseded rollout target: `v2.2.0` reached Checkpoint C, but final operator rollout moved to `v2.2.1` after the installed Tauri shell was found to default operator app data to a temporary directory when no `SSE_APP_DATA_DIR` override was set.

## Scope

Verify the published release assets on the actual workstation that will run the studio.

This pass must use the GitHub Release assets. Do not use a local build, a copied `release/` folder, or an installer produced from a development checkout.

## Required Assets

Download the installer and matching SHA256 manifest for the platform being installed.

Windows:

- `SSE-ExEd-Studio-Control-Native-windows-Installer.exe`
- `SSE-ExEd-Studio-Control-Native-windows-SHA256.txt`

macOS:

- `SSE-ExEd-Studio-Control-Native-macOS-Installer.zip`
- `SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt`

Optional support assets:

- `SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip`
- `SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip`
- `SSE-ExEd-Studio-Control-Native-windows.zip`
- `SSE-ExEd-Studio-Control-Native-macOS.zip`

## Preflight Record

Record these before installing:

| Field                                  | Value                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| Verification date/time                 |                                                       |
| Workstation name                       |                                                       |
| Operator OS version                    |                                                       |
| CPU architecture                       |                                                       |
| Display mode and resolution            |                                                       |
| Audio interface state                  |                                                       |
| Lighting bridge state                  |                                                       |
| Companion / Stream Deck state          |                                                       |
| Existing app version, if installed     |                                                       |
| Existing app data preserved            | yes / no / not installed                              |
| Support backup exported before install | yes / no / not installed                              |
| Unsigned trust prompt observed         | none / Windows SmartScreen / macOS Gatekeeper / other |

## Hash Verification

### Windows PowerShell

From the folder containing the downloaded assets:

```powershell
Get-FileHash .\SSE-ExEd-Studio-Control-Native-windows-Installer.exe -Algorithm SHA256
Select-String -Path .\SSE-ExEd-Studio-Control-Native-windows-SHA256.txt -Pattern "Installer.exe"
```

The `Hash` value from `Get-FileHash` must match the manifest line exactly, ignoring letter case.

### macOS Terminal

From the folder containing the downloaded assets:

```bash
shasum -a 256 SSE-ExEd-Studio-Control-Native-macOS-Installer.zip
grep "Installer.zip" SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt
```

The `shasum` value must match the manifest line exactly.

Stop if the hash does not match.

## Install Procedure

1. If an existing installation is present, open Setup/Support and export a support backup first.
2. Do not delete the app-data directory unless intentionally resetting the workstation.
3. Install from the published offline installer.
4. Record any unsigned trust prompt and whether the operator would find it surprising.
5. Launch the installed app from the installed application location, not from a development checkout.
6. Confirm the visible product name is `SSE ExEd Studio Control`.
7. Confirm the installed runtime is the Tauri shipping runtime for `v2.2.1`, not the Qt fallback.

Runtime confirmation:

| Platform | Installed payload check                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| Windows  | The installed target directory contains `sse-exed-tauri-shell.exe` and `studio-control-engine.exe`.               |
| macOS    | `SSE ExEd Studio Control Native.app/Contents/MacOS/` contains `sse-exed-tauri-shell` and `studio-control-engine`. |

The exact install root can vary with the QtIFW target directory selected during install. Check the installed application payload, not the repository checkout.

Expected routing:

| Workstation state         | Expected startup target                               |
| ------------------------- | ----------------------------------------------------- |
| Clean or setup incomplete | Commissioning                                         |
| Commissioned              | Dashboard                                             |
| Degraded startup          | Recovery/support presentation, not a normal dashboard |

## Operator Checks

Run these checks from the installed app:

| Check                     | Expected result                                                                 | Pass |
| ------------------------- | ------------------------------------------------------------------------------- | ---- |
| Startup routing           | Commissioning or dashboard matches workstation state                            |      |
| Version/product posture   | Product name and release posture are visible and correct                        |      |
| App-data path             | Runtime app-data path is durable and not under `%TEMP%` / `/tmp`                |      |
| Setup/Support backup      | Support backup export succeeds                                                  |      |
| Setup/Support diagnostics | Diagnostics export succeeds                                                     |      |
| Planning persistence      | Create or edit a harmless planning item, close, reopen, and confirm it persists |      |
| Lighting recovery/status  | Lighting surface shows ready/unconfigured/degraded state honestly               |      |
| Audio recovery/status     | Audio surface shows ready/unverified/degraded state honestly                    |      |
| Control-surface bridge    | Support/health diagnostics show bridge status and base URL when available       |      |
| Close/reopen              | App quits cleanly and restores expected route/state                             |      |

Do not mark the rollout passed if a degraded engine, storage, lighting, audio, or control-surface state is hidden behind a normal dashboard presentation.

## Evidence To Post On Issue #4

Post a comment with:

- Platform and OS version.
- Workstation name.
- Display mode and resolution used for the check.
- Installer asset name and SHA256 result.
- Whether the installer came directly from the `v2.2.1` GitHub Release.
- Startup target observed on first launch.
- Product name and visible release/version posture.
- Runtime app-data path.
- Backup export result.
- Diagnostics export result.
- Planning persistence result.
- Lighting state summary.
- Audio state summary.
- Control-surface bridge summary.
- Unsigned trust prompt notes.
- Any stop condition or deviation.

If the pass succeeds, update issue #3 with a short rollout-result comment. Do not close the fallback window unless that is an explicit follow-up decision.

## Stop Conditions

Stop and record details before changing code if any of these occur:

- The downloaded installer hash does not match the SHA256 manifest.
- The installer fails.
- The installed app launches anything other than the selected Tauri runtime.
- The installed app defaults operator app data to a temporary directory.
- Startup hides degraded engine, storage, device, or recovery state behind a normal dashboard.
- Backup export or diagnostics export fails.
- Planning data is lost or requires manual database surgery.
- Qt fallback is needed during the verification.

## Issue #4 Comment Template

```markdown
Operator workstation rollout verification for `v2.2.1`.

Plan anchor:

- Issue #4 execution item.
- Checkpoint C already complete.
- Checkpoint D / Qt retirement not started.

Workstation:

- Name:
- OS:
- CPU architecture:
- Display mode:
- Audio interface:
- Lighting bridge:
- Companion / Stream Deck:

Published asset verification:

- Installer:
- SHA256 manifest:
- Hash matched: yes/no
- Downloaded from GitHub Release: yes/no

Install and launch:

- Existing app-data preserved: yes/no/not installed
- Pre-install support backup: yes/no/not installed
- Unsigned trust prompt:
- Startup target observed:
- Product name/version posture:
- Runtime observed:
- Runtime app-data path:

Operator checks:

- Support backup export:
- Diagnostics export:
- Planning persistence:
- Lighting status presentation:
- Audio status presentation:
- Control-surface bridge diagnostics:
- Close/reopen:

Result:

- Passed issue #4 rollout verification: yes/no
- Stop conditions encountered:
- Notes:
```
