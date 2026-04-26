# Legacy Tauri candidate scripts

These four scripts produced the **pre-switch** Tauri candidate evidence used during the cutover from the retired Qt fallback shell to the shipping Tauri runtime. They are retained for reproducibility of the evidence recorded in [Issue #5](https://github.com/Fikarn/sse-exed-studio-control/issues/5) and the audit captured in [docs/QT_FALLBACK_RETIREMENT_AUDIT.md](../../docs/QT_FALLBACK_RETIREMENT_AUDIT.md).

They are **not** part of the active release lane. The shipping path is the `native:*` family in [package.json](../../package.json), driven by [scripts/native-release-runtime.json](../native-release-runtime.json) (which selects `tauri`).

| Script                                 | Purpose                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `tauri-package-candidate.mjs`          | Builds the pre-switch Tauri candidate payload under `release/tauri-candidate/*`. |
| `tauri-candidate-ifw.mjs`              | Wraps the candidate payload into a QtIFW installer / update-repo archive.        |
| `verify-tauri-candidate-artifacts.mjs` | Verifies hashes, manifests, and layout of candidate artifacts.                   |
| `tauri-windows-target-evidence.mjs`    | Collects the pre-switch Windows 11 x64 target-host evidence bundle.              |

These scripts are still wired into [package.json](../../package.json) under the `tauri:package:*`, `tauri:installer:*`, `tauri:update-repo:*`, `tauri:artifacts:*`, and `tauri:package:win:evidence` entries; touch them only when reproducing historical evidence. New shell-change validation should use the live qualification lanes (`tauri:setup-support:qualify`, `tauri:workspaces:qualify`, `tauri:visual:review`) instead.
