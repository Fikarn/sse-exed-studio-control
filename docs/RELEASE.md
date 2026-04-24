# Release

## Operator Targets

Production packaging now targets:

- Windows 11 `x64` via a Qt Installer Framework offline installer
- macOS Apple Silicon via a Qt Installer Framework offline installer
- GitHub Releases as the distribution surface for installers, packaged bundle zips, and native update-repository archives

The visible product name remains `SSE ExEd Studio Control`.

## Native Status

The native runtime is the only release path:

- Native macOS and Windows target-host release lanes build packaged bundles, smoke-test them, build offline installers, and generate maintenance-tool update-repository archives.
- The legacy Electron runtime was retired in `v2.1.0`; no browser/Electron path remains in the repo.
- Release readiness depends on packaging, smoke, acceptance, bridge-qualification, and install-time smoke-test gates — plus any open blockers tracked in [docs/HANDOFF.md](./HANDOFF.md).

The selected native release runtime is controlled by `scripts/native-release-runtime.json` and can be overridden locally with `SSE_NATIVE_RELEASE_RUNTIME=qt` or `SSE_NATIVE_RELEASE_RUNTIME=tauri` for explicit fallback testing. `v2.2.0` shipped with `tauri` selected, and `v2.2.1` is the current published operator-rollout build after the durable default app-data path fix. The `native:*` release lanes package the Tauri shell with the Rust engine binary staged beside the shell executable while preserving the existing QtIFW installer/update posture.

The historical replacement-shell candidate packaging path remains available for pre-switch evidence under separate roots:

- `npm run tauri:package:mac:ifw-staged`
- `npm run tauri:package:win:ifw-staged`
- `npm run tauri:package:mac:ifw-local`
- `npm run tauri:package:win:ifw-local`

Those commands write to `release/tauri-candidate*` roots and do not publish the shipping path. The shipping release path is the `native:*` lane, which writes to `release/native*`, `release/native-installer*`, and `release/native-updates*` for the runtime selected by `scripts/native-release-runtime.json`.

## Native Release Artifacts

Each tagged release should publish:

- `SSE-ExEd-Studio-Control-Native-macOS-Installer.zip`
- `SSE-ExEd-Studio-Control-Native-windows-Installer.exe`
- `SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip`
- `SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip`
- `SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt`
- `SSE-ExEd-Studio-Control-Native-windows-SHA256.txt`

Release publication may also include packaged native bundle zips for support and smoke validation:

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

The prepare commands stage QtIFW metadata and payload layout for the selected release runtime. The local commands run `binarycreator` or `repogen` when QtIFW is installed and the tools are available on `PATH` or via `SSE_QT_IFW_BINARYCREATOR` / `SSE_QT_IFW_REPOGEN`.
The packaged acceptance commands verify that the packaged shell selected by `scripts/native-release-runtime.json` and the bundled engine can import data, reopen against the same app-data directory, restore a support backup, and relaunch without losing operator state.
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

7. Build and verify the platform artifacts on each target release host. The exact command may be `npm run release:verify`, or the explicit platform lane when collecting artifacts for publication:

On macOS Apple Silicon:

```bash
npm run native:release:mac:local
```

On Windows 11 `x64`:

```bash
npm run native:release:win:local
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

- Windows: expect SmartScreen or equivalent unsigned-publisher warnings and treat the installer as a deliberate operator-managed install
- macOS: expect Gatekeeper or notarization warnings and treat first launch as a deliberate operator-managed trust step
- both platforms: verify the published `SHA256` manifest before install, keep a support backup before upgrades, and preserve the app-data directory during reinstall/update unless intentionally resetting the workstation

## Optional Signing

The repo still includes optional signing hooks for future public-distribution hardening.

The local macOS release commands have optional signing hooks wired in. Configure these environment variables or secure local secret values to activate them:

- `SSE_MACOS_CODESIGN_IDENTITY`
- `SSE_MACOS_NOTARY_KEYCHAIN_PROFILE`
- `SSE_MACOS_NOTARY_APPLE_ID`
- `SSE_MACOS_NOTARY_PASSWORD`
- `SSE_MACOS_NOTARY_TEAM_ID`

The local Windows release commands also have optional signing hooks. Configure these environment variables or secure local secret values to activate them:

- `SSE_WINDOWS_SIGN_CERT_PATH`
- `SSE_WINDOWS_SIGN_CERT_BASE64`
- `SSE_WINDOWS_SIGN_CERT_PASSWORD`
- `SSE_WINDOWS_SIGN_TIMESTAMP_URL`
- `SSE_WINDOWS_SIGNTOOL_PATH`

Use the keychain-profile path when possible. The Apple ID credential trio is a fallback when the release host cannot rely on a preloaded keychain profile.
Prefer a local certificate path on the Windows release host; `SSE_WINDOWS_SIGN_CERT_BASE64` remains available when the certificate must be materialized ephemerally.

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

For private or access-controlled repositories, provide a token that can read releases, for example:

```bash
GITHUB_TOKEN=$(gh auth token) npm run release:anchor:verify -- --tag v2.0.0
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
9. Run the macOS and Windows target-host release lanes and collect the required artifacts on the publishing workstation.
10. Run `npm run release:publish -- --tag vX.Y.Z`.
11. Run `npm run release:anchor:verify -- --tag vX.Y.Z`.
12. Verify the release includes both platform SHA256 manifests and that they match the uploaded artifacts you intend operators to use.
13. Smoke-test the generated macOS and Windows installers from GitHub Releases, including the expected unsigned trust flow.
14. Verify the release includes both platform update-repository archives.
15. Capture install and update notes for anything that would surprise the next operator or maintainer.
16. For the production workstation rollout, follow [OPERATOR_WORKSTATION_ROLLOUT.md](./OPERATOR_WORKSTATION_ROLLOUT.md) and record the result on the linked rollout issue before closing any fallback window.

## Final Mile

The release pipeline and packaging lanes are in place. Residual release work is tracked in [docs/HANDOFF.md](./HANDOFF.md) and [docs/PRODUCTIZATION_PLAN.md](./PRODUCTIZATION_PLAN.md).

## Manual Rebuilds

If packaging failed after the tag already exists, rerun the appropriate local target-host release lane, copy the rebuilt artifacts back to the publishing workstation, and run `npm run release:publish -- --tag vX.Y.Z --clobber` only after the rebuilt artifacts pass verification. Do not replace release assets from an unverified local build.

## Post-release Smoke Test

Test on a clean machine or VM when possible:

1. Install the app from the offline installer.
2. Launch and confirm commissioning or dashboard routing is correct for that machine state.
3. Verify restart and shutdown behavior remain deterministic.
4. Reopen and confirm planning data is still present.
5. Trigger a manual support backup export.
6. Download the Companion profile and import it.
7. Apply a newer tagged release through the maintenance-tool repository or a newer offline installer and verify user data is preserved.

For the actual studio operator workstation, use [OPERATOR_WORKSTATION_ROLLOUT.md](./OPERATOR_WORKSTATION_ROLLOUT.md). That runbook is stricter than a generic clean-machine smoke test because it records the real display, audio, lighting, and Companion state used for rollout.

## Rollback

If a release is bad:

1. Pull the previous known-good installer from GitHub Releases.
2. Preserve the user data directory unless the data migration itself is the cause.
3. If needed, restore from the most recent valid support backup after reinstalling the known-good build.
4. Keep notes on any installer or update-repository issue that must be fixed before the next tag.
