# scripts/

Repository helper scripts. Most are invoked via `npm run …` from the
root `package.json` (see `scripts:test`, `release:preflight`,
`tauri:visual:review`, etc.); a few are wired into `husky` /
`lint-staged`.

## Test coverage tiering (plan PR 10 / workstream G1)

The remediation-plan audit categorised 43 scripts by risk. Tests live
as `*.test.mjs` siblings of the script under test; the
`scripts:test` lane (now glob-driven via `scripts/**/*.test.mjs`)
picks them up automatically.

### Tier 1 — release-critical

These run during the 12-stage release chain. A silent regression
here ships broken artifacts or breaks rollback.

| Script                                 | Test                                              |
| -------------------------------------- | ------------------------------------------------- |
| `native-installer.mjs`                 | `native-installer.test.mjs` (PR 10)               |
| `native-update-repo.mjs`               | `native-update-repo.test.mjs` (PR 10)             |
| `write-native-release-checksums.mjs`   | `write-native-release-checksums.test.mjs` (PR 10) |
| `verify-native-release-artifacts.mjs`  | _follow-up_                                       |
| `verify-native-release-continuity.mjs` | _follow-up_                                       |
| `release/publish-release.mjs`          | `release/publish-release.test.mjs` (PR 10)        |
| `native-sign-macos.mjs`                | _follow-up_ (requires keychain identities)        |
| `native-sign-windows.mjs`              | _follow-up_ (requires signtool + cert)            |

### Tier 2 — build / acceptance

These run during foundation and visual-review lanes.

| Script                                     | Test                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `native-acceptance.mjs`                    | _follow-up_ (covered end-to-end by CI's `rust` job) |
| `native-runtime-harness.mjs`               | _follow-up_                                         |
| `protocol/generate-protocol-artifacts.mjs` | _follow-up_ (covered by `protocol:check`)           |
| `tauri-visual-review.mjs`                  | `tauri-visual-review.test.mjs` (PR 10)              |

### Tier 3 — utility

Lower-blast-radius helpers. Tests are nice-to-have.

- `clean.mjs`
- `dev-doctor.mjs`
- `file-health.mjs` _(covered by the `file:health` lane itself)_

### Already-tested helpers (pre-PR 10)

- `disk-space.test.mjs`
- `qt-ifw-tools.test.mjs`
- `release/validate-release.test.mjs`
- `release/preflight.test.mjs` (PR 3)
- `release/write-release-manifest.test.mjs` (PR 3)
- `release/helpers.test.mjs` (PR 3)
- `check-slice-rescope.test.mjs` (PR 9)

## Per-script test contract

The plan's "high-value paths" definition for Tier 1 + Tier 2 tests:

1. **Argument parsing** — every CLI flag exercised in at least one
   test (happy + at least one rejection).
2. **Exit codes** — `process.exitCode` is 0 on success and non-zero
   on each declared failure mode.
3. **File I/O contract** — where the script reads or writes known
   paths (checksum manifests, installer dirs), a test fixture mounts
   a temp dir and asserts the produced files match the expected
   shape.
4. **External-process boundary** — for scripts that call `signtool`,
   `codesign`, `xcrun notarytool`, `binarycreator`, `repogen`, etc.,
   mock the spawn call (via `node:child_process` injection or by
   `PATH`-prepending a fixture script) and assert the right args + the
   right exit-code handling.

Target depth: ~6–10 tests per Tier 1, ~4–6 per Tier 2. Not
exhaustive branch coverage; the four bullets above are the contract.

## Running

```sh
npm run scripts:test            # all tests, spec reporter
node --test scripts/release/    # focus on a folder
node --test scripts/<file>.test.mjs   # single test file
```
