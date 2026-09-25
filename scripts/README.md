# scripts/

Repository helper scripts. Most are invoked via `npm run …` from the
root `package.json` (see `scripts:test`, `release:preflight`,
`tauri:visual:review`, etc.); a few are wired into `husky` /
`lint-staged`.

## Test coverage tiering (plan PR 10 / workstream G1)

The remediation-plan audit categorised the scripts by risk (43 at the
time; 46 non-test scripts as of 2026-08-12). Tests live as
`*.test.mjs` siblings of the script under test; the `scripts:test`
lane (now glob-driven via `scripts/**/*.test.mjs`) picks them up
automatically. The glob is double-quoted in `package.json`: npm runs
scripts through `cmd.exe` on Windows, which hands single quotes to Node
literally, and that made the lane run zero tests on the workstation
until 2026-09 (production readiness, Slice 1).

The `_accepted gap_` rows below were audited 2026-08-12: each is
either exercised end-to-end by a CI lane or requires signing
identities/hardware a unit test cannot carry. They stay listed so the
gap remains visible, but no follow-up test is planned unless their
risk profile changes.

### Tier 1 — release-critical

These run during the 12-stage release chain. A silent regression
here ships broken artifacts or breaks rollback.

| Script                                 | Test                                                                                                                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `native-installer.mjs`                 | `native-installer.test.mjs` (PR 10)                                                                                                                                                        |
| `native-update-repo.mjs`               | `native-update-repo.test.mjs` (PR 10)                                                                                                                                                      |
| `write-native-release-checksums.mjs`   | `write-native-release-checksums.test.mjs` (PR 10)                                                                                                                                          |
| `verify-native-release-artifacts.mjs`  | _accepted gap_ (release:verify exercises it)                                                                                                                                               |
| `verify-native-release-continuity.mjs` | _accepted gap_ (release:verify exercises it)                                                                                                                                               |
| `release/publish-release.mjs`          | `release/publish-release.test.mjs` (PR 10)                                                                                                                                                 |
| `native-sign-macos.mjs`                | `native-sign.test.mjs` pins the dormant path (skip, exit 0, the variable named) and that half a configuration fails; signing itself stays an _accepted gap_ (requires keychain identities) |
| `native-sign-windows.mjs`              | `native-sign.test.mjs`, the same; signing itself stays an _accepted gap_ (requires signtool + cert)                                                                                        |
| `write-release-sboms.mjs`              | `write-release-sboms.test.mjs` — the plan and the refusal rule; the two generators run in `release-evidence.yml`                                                                           |

### Tier 2 — build / acceptance

These run during foundation and visual-review lanes.

| Script                                                                                                                                                                                                                                                           | Test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-acceptance.mjs`                                                                                                                                                                                                                                          | _accepted gap_ (covered end-to-end by CI's `rust` job)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `native-runtime-harness.mjs`                                                                                                                                                                                                                                     | the lanes' hardening (`hardenedLaneEnv`, `laneEnvRefusal`, and the engine start that refuses an environment without it) in `native-lanes.test.mjs` (new pages program, Slice 2b); the rest is _accepted gap_ (exercised by acceptance lanes)                                                                                                                                                                                                                                                                                            |
| `protocol/generate-protocol-artifacts.mjs`                                                                                                                                                                                                                       | _accepted gap_ (covered by `protocol:check`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tauri-visual-review.mjs`                                                                                                                                                                                                                                        | `tauri-visual-review.test.mjs` (PR 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| the hardware-link lanes: `native-acceptance.mjs`, `native-parity-acceptance.mjs`, `native-control-surface-qualification.mjs`, `native-packaged-acceptance.mjs`, `native-installer-acceptance.mjs`, `native-delivery-acceptance.mjs`, `native-release-safety.mjs` | `native-lanes.test.mjs` (new pages program, Slice 2), which reads them without running them: every request they send is a method of the contract; the bridge lane calls only routes the bridge serves and reads only LCD keys it answers                                                                                                                                                                                                                                                                                                |
| every script that starts the app for a lane: the hardware-link lanes, `native-package.mjs`, `legacy/tauri-package-candidate.mjs`, `tauri-setup-support-qualification.mjs`, `tauri-workspace-qualification.mjs`                                                   | `native-lanes.test.mjs` (Slice 2b, when the db.json import was retired): no lane names the import's variables or fixtures, and every publish carries the probe override a fresh hardware link needs; every engine or shell they start is handed its app data through `laneProcessEnv`, which refuses an environment without a bridge port of the lane's own (never the live app's 38201), `SSE_SAFE_START` and, outside the live console lane, the simulated console; only the Setup/Support lane's step 8 may leave the safe start out |

### Tier 3 — utility

Lower-blast-radius helpers. Tests are nice-to-have.

- `clean.mjs` — `clean.test.mjs` (2026-09-18). Not low-blast-radius after all: until then it deleted `release/` whole, and on the studio workstation `release/native/windows` is the installed app. It now keeps `release/native` when a packaged executable is in it, needs `--include-release` to remove it, and refuses while a process runs from the folder — one test starts a real process from a temp-dir app folder. Every test works in a temporary root; `clean()` has no default root.
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

### Supply chain (2026-09 production readiness, Slice 12 — finding F17)

| Script                    | Test                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `check-npm-audit.mjs`     | `check-npm-audit.test.mjs` — on the `npm audit --json` reports recorded under `fixtures/npm-audit/`; the tests never call the registry |
| `check-deny-ignores.mjs`  | `check-deny-ignores.test.mjs`                                                                                                          |
| `supply-chain-expiry.mjs` | the date rule both lists share; covered by the two files above                                                                         |

Neither test judges a date against today's: whether an exception has
expired is the `supply-chain` CI job's to say, so a date can never turn
`scripts:test` (and with it `dev:check`) red by itself.

### Repository guards

Tests that hold a repository-wide property rather than a script:

- `frontend/dev-server-host.test.mjs` — no local server surface (Vite,
  Playwright, Storybook, Tauri dev) or helper script binds `0.0.0.0`
  (2026-09 production readiness, Slice 1 — finding F24).

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
