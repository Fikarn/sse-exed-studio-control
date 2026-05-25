# Legacy Tauri candidate scripts

These four scripts produced the **pre-switch** Tauri candidate evidence used during the cutover from the retired Qt fallback shell to the shipping Tauri runtime. They are retained for reproducibility of the evidence recorded in [Issue #5](https://github.com/Fikarn/sse-exed-studio-control/issues/5) and the audit captured in [docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md](../../docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md).

They are **not** part of the active release lane. The shipping path is the `native:*` family in [package.json](../../package.json), driven by [scripts/native-release-runtime.json](../native-release-runtime.json) (which selects `tauri`).

| Script                                 | Purpose                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `tauri-package-candidate.mjs`          | Builds the pre-switch Tauri candidate payload under `release/tauri-candidate/*`. |
| `tauri-candidate-ifw.mjs`              | Wraps the candidate payload into a QtIFW installer / update-repo archive.        |
| `verify-tauri-candidate-artifacts.mjs` | Verifies hashes, manifests, and layout of candidate artifacts.                   |
| `tauri-windows-target-evidence.mjs`    | Collects the pre-switch Windows 11 x64 target-host evidence bundle.              |

## Why kept (not removed)

Checkpoint D closed in v2.2.0 (`d0205baf52ce02d7d4d24699facd202f3bbba217`); the Qt source/test surface and the Qt parity assets were removed at that point. These four scripts under `scripts/legacy/` were intentionally retained because:

1. **Audit-trail reproducibility.** Issue #5 and [`docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md`](../../docs/archive/QT_FALLBACK_RETIREMENT_AUDIT.md) cite specific candidate evidence bundles (`release/tauri-candidate*`, `artifacts/tauri-qualification/windows-target-host/`). If a future investigation contests a published release tag, these scripts are the only way to regenerate those evidence bundles in their original shape.
2. **Still wired into `package.json`.** The `tauri:package:*`, `tauri:installer:*`, `tauri:update-repo:*`, `tauri:artifacts:*`, and `tauri:package:win:evidence` entries continue to reference them. Their `--prepare-only` package.json scripts default to `--allow-staged` (added in plan PR 3 / workstream C2 so the QtIFW staged-fallback became explicit), so an operator can produce staged candidate evidence even without a full QtIFW install. Removing the scripts would orphan those entries.
3. **No active code path invokes them.** They are not called from `npm run native:release:*` (the shipping lane) or from any CI job in `.github/workflows/dev-checks.yml`. Touching them only happens when an operator deliberately runs the historical evidence commands.

## When NOT to touch them

New shell-change validation should use the live qualification lanes (`tauri:setup-support:qualify`, `tauri:workspaces:qualify`, `tauri:visual:review`) instead. Do **not** extend these legacy scripts to cover new product behavior — that surface lives in `scripts/native-*.mjs`. If a future change retires the candidate-evidence flow entirely (e.g., Issue #5 stops being a reference point), removal is acceptable, but the `package.json` entries above must be removed in the same change.
