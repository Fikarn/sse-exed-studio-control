# Release

## Operator Targets

Production packaging now targets:

- Windows 11 `x64` via a Qt Installer Framework offline installer
- macOS Apple Silicon via a Qt Installer Framework offline installer
- GitHub Releases as the distribution surface for installers, packaged bundle zips, and native update-repository archives

The visible product name remains `SSE ExEd Studio Control`.

## Native Status

The native runtime is the only release path:

- Native macOS and Windows jobs build packaged bundles, smoke-test them, build offline installers, and generate maintenance-tool update-repository archives.
- The legacy Electron runtime was retired in `v2.1.0`; no browser/Electron path remains in the repo.
- Release readiness depends on packaging, smoke, acceptance, bridge-qualification, and install-time smoke-test gates — plus any open blockers tracked in [docs/HANDOFF.md](./HANDOFF.md).

During the frontend replatform, the Qt shell remains the shipping native runtime. The Tauri replacement shell may only enter a release candidate through the cutover gate in [docs/FRONTEND_CUTOVER_PLAN.md](./FRONTEND_CUTOVER_PLAN.md). Unless that plan is changed by a delta spec, the replacement candidate must reuse the QtIFW installer/update posture and package the Tauri shell with the Rust engine binary staged beside the shell executable.

The replacement-shell candidate packaging path is intentionally separate from the shipping Qt release path:

- `npm run tauri:package:mac:ifw-staged`
- `npm run tauri:package:win:ifw-staged`

These commands package the Tauri shell with the side-by-side Rust engine, run the packaged Tauri smoke test, prepare QtIFW installer/update-repository staging, and verify staged payload parity. They write to `release/tauri-candidate*` roots, not `release/native*`, so the current Qt fallback artifacts remain independent during parallel acceptance.

## Native Release Artifacts

Each tagged release should publish:

- `SSE-ExEd-Studio-Control-Native-macOS-Installer.zip`
- `SSE-ExEd-Studio-Control-Native-windows-Installer.exe`
- `SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip`
- `SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip`
- `SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt`
- `SSE-ExEd-Studio-Control-Native-windows-SHA256.txt`

The release workflow may also publish packaged native bundle zips for support and smoke validation:

- `SSE-ExEd-Studio-Control-Native-macOS.zip`
- `SSE-ExEd-Studio-Control-Native-windows.zip`

## Installer And Update Strategy

The approved native packaging posture is:

- use Qt Installer Framework for installers
- ship offline installers first on both platforms
- publish maintenance-tool update repositories alongside the installers
- document the unsigned controlled-deployment posture before operator rollout
- prefer conservative maintenance-tool updates over silent background update behavior

Repo commands for the native release path:

- `npm run native:installer:mac:prepare`
- `npm run native:installer:mac:local`
- `npm run native:installer:win:prepare`
- `npm run native:installer:win:local`
- `npm run native:update-repo:mac:prepare`
- `npm run native:update-repo:mac:local`
- `npm run native:update-repo:win:prepare`
- `npm run native:update-repo:win:local`
- `npm run native:checksums:mac:write`
- `npm run native:checksums:mac:staged-write`
- `npm run native:checksums:win:write`
- `npm run native:checksums:win:staged-write`
- `npm run native:package:mac:acceptance`
- `npm run native:package:win:acceptance`
- `npm run native:bridge:mac:verify`
- `npm run native:bridge:win:verify`
- `npm run native:artifacts:mac:verify`
- `npm run native:artifacts:win:verify`
- `npm run native:continuity:mac:verify`
- `npm run native:continuity:win:verify`
- `npm run native:delivery:mac:verify`
- `npm run native:delivery:win:verify`
- `npm run native:installer-acceptance:mac:verify`
- `npm run native:installer-acceptance:win:verify`
- `npm run native:sign:mac:release`
- `npm run native:sign:win:release`

The prepare commands stage QtIFW metadata and payload layout. The local commands run `binarycreator` or `repogen` when QtIFW is installed and the tools are available on `PATH` or via `SSE_QT_IFW_BINARYCREATOR` / `SSE_QT_IFW_REPOGEN`.
The packaged acceptance commands verify that the packaged shell and bundled engine can import data, reopen against the same app-data directory, restore a support backup, and relaunch without losing operator state.
The control-surface bridge qualification commands run the packaged engine on a dedicated localhost port, fail if the bundled bridge cannot bind, and then verify real HTTP behavior for `/api/deck/context`, `/api/deck/lcd`, `/api/deck/action`, `/api/deck/light-action`, and `/api/deck/audio-action`.
The checksum commands write per-platform SHA256 manifests for the native release artifacts. Full mode covers the packaged bundle, installer, and update-repository archive; staged mode covers the packaged bundle when QtIFW tools are not present locally.
The artifact verification commands assert the expected package identity, staged payload names, final installer/update archive outputs, checksum-manifest integrity, and payload consistency across the packaged bundle plus installer/update staging after those builds complete.
The continuity verification commands compare the current native installer/update metadata against the previous lower `v*` tag and fail if the native package identity changes or the version does not advance.
The staged delivery acceptance commands simulate an install from the staged offline-installer payload, apply the staged maintenance-tool payload over the same install location, then reinstall from the staged offline-installer payload again while preserving app data and verifying operator state survives each hop.
The installer acceptance commands require the real QtIFW installer and update-repository artifacts; they install into a clean temp root, verify the installed maintenance tool can list the package and see the staged repository, purge the install root, then reinstall and confirm the operator state survives.
The native acceptance, packaged acceptance, staged delivery acceptance, and installer acceptance lanes now fail if `health.snapshot` reports a bundled SQLite version older than `3.51.3` and outside the documented safe backports `3.50.7` / `3.44.6`.
The packaged bridge qualification lane is the explicit bind/listen/HTTP release gate for the local control-surface bridge; it must run on a host that can bind `127.0.0.1` outside restrictive sandboxing.
The macOS packaging path applies ad-hoc signing and now verifies bundle signature integrity before archiving; this validates bundle structure for controlled deployment but does not make the installer publicly trusted on operator machines.
The macOS signing command re-signs the packaged app and installer bundle when `SSE_MACOS_CODESIGN_IDENTITY` is configured, then notarizes and staples them when either `SSE_MACOS_NOTARY_KEYCHAIN_PROFILE` or the Apple ID credential trio is configured.
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

7. GitHub Actions validates release metadata, creates or updates the GitHub release from the changelog section, then builds and uploads the native installers, native update-repository archives, and SHA256 manifests.

## Release Guardrails

These checks run locally or in CI:

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

## Installer Identity

The product identity is locked for operator rollout:

- visible product name: `SSE ExEd Studio Control`
- packaged app identifier: `com.sse.exedstudiocontrol`
- QtIFW package identifier: `com.sse.exedstudiocontrol.native`

Do not change these identifiers casually once installed operator builds exist. Any future change is an installer or update-migration task.

## Unsigned Controlled Deployment

The current supported rollout model is one controlled studio workstation, not public self-serve desktop distribution.

- Windows: expect SmartScreen or equivalent unsigned-publisher warnings and treat the installer as a deliberate operator-managed install
- macOS: expect Gatekeeper or notarization warnings and treat first launch as a deliberate operator-managed trust step
- both platforms: verify the published `SHA256` manifest before install, keep a support backup before upgrades, and preserve the app-data directory during reinstall/update unless intentionally resetting the workstation

## Optional Signing

The repo still includes optional signing hooks for future public-distribution hardening:

The release workflow now has optional macOS signing hooks wired in. Configure these GitHub secrets to activate them:

- `SSE_MACOS_CODESIGN_IDENTITY`
- `SSE_MACOS_NOTARY_KEYCHAIN_PROFILE`
- `SSE_MACOS_NOTARY_APPLE_ID`
- `SSE_MACOS_NOTARY_PASSWORD`
- `SSE_MACOS_NOTARY_TEAM_ID`

The release workflow now also has optional Windows signing hooks. Configure these GitHub secrets to activate them:

- `SSE_WINDOWS_SIGN_CERT_PATH`
- `SSE_WINDOWS_SIGN_CERT_BASE64`
- `SSE_WINDOWS_SIGN_CERT_PASSWORD`
- `SSE_WINDOWS_SIGN_TIMESTAMP_URL`
- `SSE_WINDOWS_SIGNTOOL_PATH`

Use the keychain-profile secret path when possible. The Apple ID credential trio is a fallback when the runner cannot rely on a preloaded keychain profile.
Prefer `SSE_WINDOWS_SIGN_CERT_BASE64` on GitHub-hosted Windows runners so the certificate can be materialized ephemerally during the signing step.

## Preflight

Before creating a release tag, confirm:

```bash
npm run release:check
npm run format:check
npm run release:verify
```

After the release is published:

```bash
npm run release:anchor:verify -- --tag v2.0.0
```

Platform-specific local verification:

On macOS hosts:

```bash
npm run native:release:mac:local
npm run native:bridge:mac:verify
```

On Windows hosts:

```bash
npm run native:release:win:local
npm run native:bridge:win:verify
```

On non-target hosts, `npm run release:verify` skips the installer and update-repository build step and prints a reminder to validate on macOS or Windows.

## Release Checklist

1. Confirm version and changelog are correct.
2. Confirm `npm run release:check` passes for the target tag.
3. Verify visible branding is `SSE ExEd Studio Control` across shell, installer, and release page.
4. Verify native startup routes correctly into commissioning or dashboard from the packaged build.
5. Verify backup export and restore on a test database.
6. Verify lighting/audio/control-surface recovery signals are visible from the native shell.
7. Verify the packaged bridge qualification lane passes on a bind-capable macOS and Windows host so localhost bridge bind/listen/HTTP behavior is proven before release.
8. Create and push a `v*` tag.
9. Wait for `.github/workflows/release.yml` to publish the native installers and native update-repository archives.
10. Run `npm run release:anchor:verify -- --tag vX.Y.Z`.
11. Verify the release includes both platform SHA256 manifests and that they match the uploaded artifacts you intend operators to use.
12. Smoke-test the generated macOS and Windows installers from GitHub Releases, including the expected unsigned trust flow.
13. Verify the release includes both platform update-repository archives.
14. Capture install and update notes for anything that would surprise the next operator or maintainer.

## Final Mile

The release pipeline and packaging lanes are in place. Residual release work is tracked in [docs/HANDOFF.md](./HANDOFF.md) and [docs/PRODUCTIZATION_PLAN.md](./PRODUCTIZATION_PLAN.md).

## Manual Rebuilds

If packaging failed after the tag already exists, rerun the `Release` workflow with `workflow_dispatch` and provide the existing `v*` tag. This rebuilds and republishes the tagged release without creating a new version.

## Post-release Smoke Test

Test on a clean machine or VM when possible:

1. Install the app from the offline installer.
2. Launch and confirm commissioning or dashboard routing is correct for that machine state.
3. Verify restart and shutdown behavior remain deterministic.
4. Reopen and confirm planning data is still present.
5. Trigger a manual support backup export.
6. Download the Companion profile and import it.
7. Apply a newer tagged release through the maintenance-tool repository or a newer offline installer and verify user data is preserved.

## Rollback

If a release is bad:

1. Pull the previous known-good installer from GitHub Releases.
2. Preserve the user data directory unless the data migration itself is the cause.
3. If needed, restore from the most recent valid support backup after reinstalling the known-good build.
4. Keep notes on any installer or update-repository issue that must be fixed before the next tag.
