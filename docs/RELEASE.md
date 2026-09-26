# Release

## Operator Targets

Production packaging now targets:

- Windows 11 `x64` via a Qt Installer Framework offline installer — the only target: Studio Control runs only on Windows (the operator's ruling of 2026-09-26; the new pages program's Slice SW removed the macOS packaging, signing and release assets)
- GitHub Releases as the distribution surface for installers, packaged bundle zips, and native update-repository archives

The visible product name remains `SSE ExEd Studio Control`.

## Native Status

The native runtime is the only release path:

- The native Windows target-host release lane builds the packaged bundle, smoke-tests it, builds the offline installer, and generates the maintenance-tool update-repository archive.
- The legacy Electron runtime was retired in `v2.1.0`; no browser/Electron path remains in the repo.
- Release readiness depends on packaging, smoke, acceptance, bridge-qualification, and install-time smoke-test gates — plus any open blockers tracked in [docs/HANDOFF.md](./HANDOFF.md).

The selected native release runtime is controlled by `scripts/native-release-runtime.json` and is Tauri-only after Checkpoint D runtime selector lockdown. `v2.2.0` shipped with `tauri` selected, and `v2.2.1` is the current published operator-rollout build after the durable default app-data path fix. The `native:*` release lanes package the Tauri shell with the Rust engine binary staged beside the shell executable while preserving the existing QtIFW installer/update posture.

The historical replacement-shell candidate packaging path remains available for pre-switch evidence under separate roots:

- `npm run tauri:package:win:ifw-staged`
- `npm run tauri:package:win:ifw-local`

Those commands write to `release/tauri-candidate*` roots and do not publish the shipping path. The shipping release path is the `native:*` lane, which writes to `release/native*`, `release/native-installer*`, and `release/native-updates*` for the runtime selected by `scripts/native-release-runtime.json`.

## Native Release Artifacts

Each tagged release should publish:

- `SSE-ExEd-Studio-Control-Native-windows-Installer.exe`
- `SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip`
- `SSE-ExEd-Studio-Control-Native-windows-SHA256.txt`

Release publication may also include the packaged native bundle zip for support and smoke validation:

- `SSE-ExEd-Studio-Control-Native-windows.zip`

Releases up to `v2.2.1` also carried macOS assets; the release tooling now requires the Windows assets only.

## Installer And Update Strategy

The approved native packaging posture is:

- use Qt Installer Framework for installers
- ship the offline installer first
- publish maintenance-tool update repositories alongside the installers
- document the unsigned controlled-deployment posture before operator rollout
- prefer conservative maintenance-tool updates over silent background update behavior

Repo commands for the native release path:

- `npm run native:installer:win:prepare`
- `npm run native:installer:win:local`
- `npm run native:update-repo:win:prepare`
- `npm run native:update-repo:win:local`
- `npm run native:checksums:win:write`
- `npm run native:checksums:win:staged-write`
- `npm run native:package:win:acceptance`
- `npm run native:bridge:win:verify`
- `npm run native:artifacts:win:verify`
- `npm run native:continuity:win:verify`
- `npm run native:delivery:win:verify`
- `npm run native:installer-acceptance:win:verify`
- `npm run native:sign:win:release`

The prepare commands stage QtIFW metadata and payload layout for the selected release runtime. The local commands run `binarycreator` or `repogen` when QtIFW is installed and the tools are available on `PATH` or via `SSE_QT_IFW_BINARYCREATOR` / `SSE_QT_IFW_REPOGEN`.
The packaged acceptance commands verify that the packaged shell selected by `scripts/native-release-runtime.json` and the bundled engine start on fresh saved data, keep what they are given across a reopen against the same app-data directory, restore a support backup, and relaunch without losing operator state. Since the new pages program's Slice 2b the lane saves the page to open with `settings.update` and publishes with the probe override (the legacy `db.json` import is gone), and the backup is a format-5 archive with no Planning.
The control-surface bridge qualification commands run the packaged engine on a dedicated localhost port, fail if the bundled bridge cannot bind, verify real HTTP behavior for `/api/deck/context`, `/api/deck/lcd`, `/api/deck/light-action`, and `/api/deck/audio-action` with the bridge token the engine wrote, prove the refusals (`401` / `403` / `400` / `413` / `408`) and the percent-decoded LCD key, and check that the exported Stream Deck profile carries the token on every request, holds the pages LIGHTS and AUDIO with a page-follow trigger for each, posts only to the lighting and audio routes, and reads only LCDs the bridge answers. (`/api/deck/action`, the PROJECTS and TASKS keys' route, left with Planning in Slice 2.)
The checksum commands write the SHA256 manifest for the native release artifacts. Full mode covers the packaged bundle, installer, and update-repository archive; staged mode covers the packaged bundle when QtIFW tools are not present locally.
The artifact verification commands assert the expected package identity, staged payload names, final installer/update archive outputs, checksum-manifest integrity, and payload consistency across the packaged bundle plus installer/update staging after those builds complete.
The continuity verification commands compare the current native installer/update metadata against the previous lower `v*` tag and fail if the native package identity changes or the version does not advance.
The staged delivery acceptance commands simulate an install from the staged offline-installer payload, apply the staged maintenance-tool payload over the same install location, then reinstall from the staged offline-installer payload again while preserving app data and verifying operator state survives each hop.
The installer acceptance commands require the real QtIFW installer and update-repository artifacts; they install into a clean temp root, verify the installed maintenance tool can list the package and see the staged repository, purge the install root, then reinstall and confirm the operator state survives.
The native acceptance, packaged acceptance, staged delivery acceptance, and installer acceptance lanes now fail if `health.snapshot` reports a bundled SQLite version older than `3.51.3` and outside the documented safe backports `3.50.7` / `3.44.6`.
The packaged bridge qualification lane is the explicit bind/listen/HTTP release gate for the local control-surface bridge; it must run on a host that can bind `127.0.0.1` outside restrictive sandboxing.
The Windows signing command signs the packaged shell, packaged engine, and final installer when a signing certificate and password are configured, then rebuilds the installer and update repository from the signed packaged payload.

## Standard Flow

The release process is changelog-driven and tag-driven:

1. Land all product and engineering changes on `main`.
2. Bump `package.json` and `package-lock.json` with:

```bash
npm version --no-git-tag-version 2.0.0
```

3. Move release notes from `[Unreleased]` into a new `## [2.0.0] — YYYY-MM-DD` section in `CHANGELOG.md`.
4. Run the local release gate:

```bash
npm run doctor:release
npm run release:verify
```

That command runs the native release gate end to end. When QtIFW tools are available on `PATH` or via `SSE_QT_IFW_BINARYCREATOR` / `SSE_QT_IFW_REPOGEN`, it verifies the real installer and update-repository outputs; otherwise it falls back to staged artifact verification against the prepared QtIFW layout.

5. Commit the release prep:

```bash
git add package.json package-lock.json CHANGELOG.md
git commit -m "release: v2.0.0"
```

6. Push `main`, then create and push the tag:

```bash
git push origin main
git tag -a v2.0.0 -m "v2.0.0"
git push origin v2.0.0
```

7. Build and verify the artifacts on the Windows release host. The exact command may be `npm run release:verify`, or the explicit lane when collecting artifacts for publication:

On Windows 11 `x64`:

```bash
npm run native:release:win:evidence -- --issue-url <active-release-issue-url>
```

8. Collect the required release artifacts under `release/native-installer/`, `release/native-updates/`, and `release/checksums/` on the publishing workstation.
9. Publish or update the GitHub Release from the local artifacts:

```bash
npm run release:publish -- --tag v2.0.0
```

Use `--dry-run` to confirm the assets that would be uploaded. Use `--clobber` only when intentionally replacing assets on an existing release after re-running the target-host gates.

## Release Guardrails

These checks run locally and on target release hosts:

```bash
npm run release:check
npm run release:anchor:verify -- --tag v2.0.0
npm run release:notes -- --tag v2.0.0 --out /tmp/release-notes.md
```

What they enforce:

- `package.json` version must match the release tag
- `CHANGELOG.md` must contain a non-empty section for that version
- the latest released changelog section must match the tagged version
- GitHub release notes come directly from the matching changelog section
- `npm run release:anchor:verify -- --tag vX.Y.Z` confirms the published GitHub release exists, is not a draft, and includes the required native installers, update repositories, and `SHA256` manifests

## Release Evidence (CI)

Pushing a `v*` tag also starts [.github/workflows/release-evidence.yml](../.github/workflows/release-evidence.yml) (production readiness 2026-09, Slice 12). On a clean `windows-latest` runner it runs `npm ci`, `npm run native:engine:build`, `npm run tauri:build` and `npm run native:package:win:local`, then writes the staged SHA256 manifest, checks the manifest against the archive, and writes three CycloneDX 1.5 SBOMs — the npm packages inside the web assets, the crates in the engine, the crates in the shell (`npm run native:sbom:win:write`, which refuses an SBOM that is empty or describes the wrong component). The runner uploads one artifact, `release-evidence-windows`, kept for 30 days: the bundle archive, `release/checksums/windows/` and `release/sbom/windows/`. The run's summary page names the commit, the toolchain versions, the digest and whether the bundle was signed.

What it is not:

- **It publishes nothing.** The workflow's whole permission set is `contents: read`; it creates or edits no GitHub Release. Publishing is still `npm run release:publish`, run by the operator from the workstation after the target-host gates.
- **It builds no installer.** QtIFW is not on a GitHub runner. The offline installers, the update repositories and the full-mode SHA256 manifests stay workstation-built, and the target-host lanes above remain the release acceptance gate. The evidence run answers a narrower question: does this tag build into a bundle from the lockfiles alone, on machines nobody has touched — it restores no build cache — and what exactly is inside it.
- **It does not sign yet.** See Optional Signing below.

A tag ending in `-evidence` (`v0.0.0-evidence`) is a rehearsal: it skips `npm run release:check`, which a real tag must pass (the tag has to match `package.json` and the changelog). Delete a rehearsal tag afterwards (`git push origin :refs/tags/v0.0.0-evidence && git tag -d v0.0.0-evidence`). The workflow can also be started by hand (`gh workflow run release-evidence.yml --ref <branch>`), which GitHub allows only once the workflow file is on the default branch.

## Supply Chain Checks

`npm run supply-chain:check` — and the `supply-chain` job on every push — audits every npm lockfile against `scripts/npm-audit-allowlist.json` and runs `cargo deny check` against `native/deny.toml` (advisories, bans, licences, sources). Exceptions in both lists carry a reason and a date at most 90 days out, and an expired one fails the job. Before tagging, the job should be green on the commit being tagged; [DEVELOPMENT.md §4 Supply chain](./DEVELOPMENT.md) says what to do when it is not.

## Installer Identity

The product identity is locked for operator rollout:

- visible product name: `SSE ExEd Studio Control`
- packaged app identifier: `com.sse.exedstudiocontrol`
- QtIFW package identifier: `com.sse.exedstudiocontrol.native`
- QtIFW product URL: `https://github.com/Fikarn/sse-exed-studio-control`

Do not change these identifiers casually once installed operator builds exist. Any future change is an installer or update-migration task.

The QtIFW product URL moved from the retired `Fikarn/project-management-dashboard` repository to `Fikarn/sse-exed-studio-control` with the 2026 repository relocation. The continuity verifier allows only that repository-url metadata relocation; package identity, bundle identity, target directories, payload names, and update package identifiers remain locked.

## Unsigned Controlled Deployment

The current supported rollout model is one controlled studio workstation, not public self-serve desktop distribution.

- expect SmartScreen or equivalent unsigned-publisher warnings and treat the installer as a deliberate operator-managed install
- verify the published `SHA256` manifest before install, keep a support backup before upgrades, and preserve the app-data directory during reinstall/update unless intentionally resetting the workstation

## Optional Signing

The repo still includes optional signing hooks for future controlled-deployment hardening if public self-serve distribution ever becomes a goal.

The local Windows release commands have optional signing hooks. Configure these environment variables or secure local secret values to activate them:

- `SSE_WINDOWS_SIGN_CERT_PATH`
- `SSE_WINDOWS_SIGN_CERT_BASE64`
- `SSE_WINDOWS_SIGN_CERT_PASSWORD`
- `SSE_WINDOWS_SIGN_TIMESTAMP_URL`
- `SSE_WINDOWS_SIGNTOOL_PATH`

On the release-evidence runner the same hooks run as `npm run native:sign:win:bundle` (`--bundle-only`: the shell, the engine and the bundle archive — there is no installer there to rebuild or sign), fed from repository secrets of the same names: `SSE_WINDOWS_SIGN_CERT_BASE64`, `SSE_WINDOWS_SIGN_CERT_PASSWORD` and optionally `SSE_WINDOWS_SIGN_TIMESTAMP_URL`. With no secret set the step prints why it skipped and the run stays green; with half a set it fails rather than skip. **The signing path has never run on a runner — no certificate exists yet.** The first evidence run after the secrets are added is its first test: expect to iterate on it, with a rehearsal tag, before relying on it for a release.

Prefer a local certificate path on the Windows release host; `SSE_WINDOWS_SIGN_CERT_BASE64` remains available when the certificate must be materialized ephemerally.

## Preflight

Before creating a release tag, confirm:

```bash
npm run release:check
npm run format:check
npm run doctor:release
npm run release:verify
```

After the release is published:

```bash
npm run release:anchor:verify -- --tag v2.0.0
```

For private or access-controlled repositories, provide a token that can read releases, for example:

```bash
GITHUB_TOKEN=$(gh auth token) npm run release:anchor:verify -- --tag v2.0.0
```

Local verification on the Windows release host:

```bash
npm run native:release:win:local
npm run native:bridge:win:verify
```

On any other host, `npm run release:verify` skips the installer and update-repository build step and prints a reminder to validate on Windows.

## Release Checklist

1. Confirm version and changelog are correct.
2. Confirm `npm run release:check` passes for the target tag.
3. Verify visible branding is `SSE ExEd Studio Control` across shell, installer, and release page.
4. Verify native startup routes correctly into commissioning or dashboard from the packaged build.
5. Verify backup export and restore on a test database.
6. Verify lighting/audio/control-surface recovery signals are visible from the native shell.
7. Verify the packaged bridge qualification lane passes on the bind-capable Windows host so localhost bridge bind/listen/HTTP behavior is proven before release.
8. Create and push a `v*` tag.
9. Run the Windows target-host release lane and collect the required artifacts on the publishing workstation.
10. Run `npm run release:publish -- --tag vX.Y.Z`.
11. Run `npm run release:anchor:verify -- --tag vX.Y.Z`.
12. Verify the release includes the Windows SHA256 manifest and that it matches the uploaded artifacts you intend operators to use.
13. Smoke-test the generated Windows installer from GitHub Releases, including the expected unsigned trust flow.
14. Verify the release includes the Windows update-repository archive.
15. Capture install and update notes for anything that would surprise the next operator or maintainer.
16. For the production workstation rollout, follow [OPERATOR_WORKSTATION_ROLLOUT.md](./OPERATOR_WORKSTATION_ROLLOUT.md) (the `v2.2.1` runbook, kept as written: its Windows steps apply, its macOS rows no longer do) and record the result on the linked rollout issue before closing any fallback window.

## Final Mile

The release pipeline and packaging lanes are in place. Residual release work is tracked in [docs/HANDOFF.md](./HANDOFF.md) and [docs/PRODUCTIZATION_PLAN.md](./PRODUCTIZATION_PLAN.md).

## Manual Rebuilds

If packaging failed after the tag already exists, rerun the appropriate local target-host release lane, copy the rebuilt artifacts back to the publishing workstation, and run `npm run release:publish -- --tag vX.Y.Z --clobber` only after the rebuilt artifacts pass verification. Do not replace release assets from an unverified local build.

## Post-release Smoke Test

Test on a clean machine or VM when possible:

1. Install the app from the offline installer.
2. Launch and confirm commissioning or dashboard routing is correct for that machine state.
3. Verify restart and shutdown behavior remain deterministic.
4. Reopen and confirm the saved data is still present — a harmless lighting group created before closing, for example (Planning, which this step used to check, left Studio Control in 2026-09).
5. Trigger a manual support backup export.
6. Download the Companion profile and import it.
7. Apply a newer tagged release through the maintenance-tool repository or a newer offline installer and verify user data is preserved.

For the actual studio operator workstation, use the Windows steps of [OPERATOR_WORKSTATION_ROLLOUT.md](./OPERATOR_WORKSTATION_ROLLOUT.md). That runbook is stricter than a generic clean-machine smoke test because it records the real display, audio, lighting, and Companion state used for rollout.

## Rollback

If a release is bad:

1. Pull the previous known-good installer from GitHub Releases.
2. Preserve the user data directory unless the data migration itself is the cause.
3. If needed, restore from the most recent valid support backup after reinstalling the known-good build.
4. Keep notes on any installer or update-repository issue that must be fixed before the next tag.
