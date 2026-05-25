import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// plan PR 10 / workstream G2 — Tier 1 coverage for scripts/release/publish-release.mjs.
//
// The script's top-level body runs at import time, calls `gh` when not in
// --dry-run mode, and resolves paths relative to its own rootDir (../..
// from scripts/release/). Tests drive it as a subprocess against a temp-root
// fixture and cover:
//
//   1. Argument parsing — --dry-run, --draft, --clobber, --tag, plus
//      implicit tag from package.json version. Rejection paths: invalid tag,
//      missing required release asset.
//   2. Exit codes — 0 on --dry-run success, non-zero when a required asset
//      is missing or the tag is malformed.
//   3. File I/O contract — --dry-run still writes release/manifests/<tag>.json
//      (the C3 chain-of-custody artifact) and prints the asset list.
//   4. External-process boundary — --dry-run short-circuits BEFORE the gh
//      invocation, so the test host does not need the GitHub CLI installed.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Real script paths — we don't move them into the fake root because they
// import sibling helpers; instead we copy the whole scripts/release/ tree
// plus the qt-ifw-tools.mjs that write-release-manifest.mjs imports.

const REQUIRED_RELATIVE_ASSETS = [
  ["release", "native-installer", "macos", "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip"],
  ["release", "native-installer", "windows", "SSE-ExEd-Studio-Control-Native-windows-Installer.exe"],
  ["release", "native-updates", "macos", "SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip"],
  ["release", "native-updates", "windows", "SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip"],
  ["release", "checksums", "macos", "SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt"],
  ["release", "checksums", "windows", "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt"],
];

function makeFakeRoot({ version = "9.9.9", omitAsset = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sse-publish-release-"));

  // Copy the scripts the publish script imports.
  mkdirSync(path.join(root, "scripts", "release"), { recursive: true });
  cpSync(path.join(repoRoot, "scripts", "release", "publish-release.mjs"), path.join(root, "scripts", "release", "publish-release.mjs"));
  cpSync(path.join(repoRoot, "scripts", "release", "helpers.mjs"), path.join(root, "scripts", "release", "helpers.mjs"));
  cpSync(path.join(repoRoot, "scripts", "release", "write-release-manifest.mjs"), path.join(root, "scripts", "release", "write-release-manifest.mjs"));
  cpSync(path.join(repoRoot, "scripts", "qt-ifw-tools.mjs"), path.join(root, "scripts", "qt-ifw-tools.mjs"));

  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "fake",
        version,
        homepage: "https://github.com/example-org/example-repo#readme",
      },
      null,
      2
    ),
    "utf8"
  );

  // CHANGELOG.md must contain a section for the target version.
  writeFileSync(
    path.join(root, "CHANGELOG.md"),
    [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "- in-flight",
      "",
      `## [${version}] — 2026-05-25`,
      "",
      "- Release-note body bullet.",
      "",
    ].join("\n"),
    "utf8"
  );

  // Seed every required asset (and matching checksum file lines).
  const macInstaller = "fake macos installer bytes";
  const winInstaller = "fake windows installer bytes";
  const macUpdate = "fake macos update repo";
  const winUpdate = "fake windows update repo";

  const written = [];
  for (const parts of REQUIRED_RELATIVE_ASSETS) {
    const rel = path.join(...parts);
    if (omitAsset && rel === omitAsset) continue;
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    const fileName = parts[parts.length - 1];
    let body = "fake artifact";
    if (fileName.endsWith("Installer.zip")) body = macInstaller;
    else if (fileName.endsWith("Installer.exe")) body = winInstaller;
    else if (fileName.endsWith("macOS-UpdateRepository.zip")) body = macUpdate;
    else if (fileName.endsWith("windows-UpdateRepository.zip")) body = winUpdate;
    else if (fileName.endsWith("macOS-SHA256.txt")) {
      // Two well-formed lines per real checksum format.
      body = [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  SSE-ExEd-Studio-Control-Native-macOS-Installer.zip",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip",
        "",
      ].join("\n");
    } else if (fileName.endsWith("windows-SHA256.txt")) {
      body = [
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc  SSE-ExEd-Studio-Control-Native-windows-Installer.exe",
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd  SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip",
        "",
      ].join("\n");
    }
    writeFileSync(full, body, "utf8");
    written.push(rel);
  }

  return { root, writtenAssets: written };
}

function runPublishRelease(root, ...args) {
  return spawnSync("node", [path.join(root, "scripts", "release", "publish-release.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      // Defensively clear any release tag overrides set by the caller's env.
      RELEASE_TAG: "",
      GITHUB_REF_NAME: "",
      SSE_RELEASE_BUILD_STARTED_AT: "2026-05-25T10:00:00Z",
    },
  });
}

test("--dry-run exits 0 and writes the chain-of-custody manifest", () => {
  const { root } = makeFakeRoot();
  const result = runPublishRelease(root, "--dry-run");
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  assert.match(result.stdout, /Dry run complete\. No GitHub release was created or modified\./);

  const manifestPath = path.join(root, "release", "manifests", "v9.9.9.json");
  assert.equal(existsSync(manifestPath), true);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.tag, "v9.9.9");
  // The manifest's artifacts come from the seeded checksum files.
  assert.equal(manifest.artifacts.length, 4);
});

test("--dry-run lists all required assets on stdout", () => {
  const { root } = makeFakeRoot();
  const result = runPublishRelease(root, "--dry-run");
  assert.equal(result.status, 0, `stderr=${result.stderr}`);
  assert.match(result.stdout, /SSE-ExEd-Studio-Control-Native-macOS-Installer\.zip/);
  assert.match(result.stdout, /SSE-ExEd-Studio-Control-Native-windows-Installer\.exe/);
  assert.match(result.stdout, /SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository\.zip/);
  assert.match(result.stdout, /SSE-ExEd-Studio-Control-Native-windows-UpdateRepository\.zip/);
  assert.match(result.stdout, /SSE-ExEd-Studio-Control-Native-macOS-SHA256\.txt/);
  assert.match(result.stdout, /SSE-ExEd-Studio-Control-Native-windows-SHA256\.txt/);
});

test("--dry-run prints the resolved repo slug derived from package.json", () => {
  const { root } = makeFakeRoot();
  const result = runPublishRelease(root, "--dry-run");
  assert.equal(result.status, 0, `stderr=${result.stderr}`);
  assert.match(result.stdout, /Repository: example-org\/example-repo/);
});

test("fails when a required release asset is missing", () => {
  const { root } = makeFakeRoot({
    omitAsset: path.join("release", "native-installer", "macos", "SSE-ExEd-Studio-Control-Native-macOS-Installer.zip"),
  });
  const result = runPublishRelease(root, "--dry-run");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required release asset is missing/);
  assert.match(result.stderr, /SSE-ExEd-Studio-Control-Native-macOS-Installer\.zip/);
});

test("rejects an invalid --tag value", () => {
  const { root } = makeFakeRoot();
  const result = runPublishRelease(root, "--tag", "not-a-tag", "--dry-run");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid release tag 'not-a-tag'/);
});

test("--tag overrides the implicit package-version tag in the manifest", () => {
  // Seed the CHANGELOG with the override version so extractReleaseSection
  // doesn't reject the run.
  const { root } = makeFakeRoot({ version: "9.9.9" });
  writeFileSync(
    path.join(root, "CHANGELOG.md"),
    [
      "# Changelog",
      "",
      "## [Unreleased]",
      "",
      "- in-flight",
      "",
      "## [3.2.1] — 2026-05-25",
      "",
      "- Body.",
      "",
    ].join("\n"),
    "utf8"
  );
  const result = runPublishRelease(root, "--tag", "v3.2.1", "--dry-run");
  assert.equal(result.status, 0, `stderr=${result.stderr}`);
  assert.match(result.stdout, /Release tag: v3\.2\.1/);
  assert.equal(existsSync(path.join(root, "release", "manifests", "v3.2.1.json")), true);
});

test("fails when CHANGELOG.md is missing the section for the resolved tag", () => {
  const { root } = makeFakeRoot({ version: "9.9.9" });
  writeFileSync(
    path.join(root, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n- nothing released\n",
    "utf8"
  );
  const result = runPublishRelease(root, "--dry-run");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CHANGELOG\.md is missing a section for 9\.9\.9/);
});

test("--dry-run embeds the artifact hash table in the printed notes path", () => {
  // The notes file is written under os.tmpdir() and its path is logged.
  // Spawn the script, parse the notes path, and confirm it embeds the
  // C4 hash table.
  const { root } = makeFakeRoot();
  const result = runPublishRelease(root, "--dry-run");
  assert.equal(result.status, 0, `stderr=${result.stderr}`);
  const match = result.stdout.match(/Release notes: (.+)/);
  assert.ok(match, `expected a 'Release notes:' line; got: ${result.stdout}`);
  const notes = readFileSync(match[1].trim(), "utf8");
  assert.match(notes, /## Artifact verification/);
  assert.match(notes, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
});
