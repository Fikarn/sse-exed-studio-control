import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// plan PR 10 / workstream G2 — Tier 1 coverage for scripts/write-native-release-checksums.mjs.
//
// The script is pure file-I/O (no spawn), so we drive it as a subprocess
// against a temp-root fixture and assert:
//
//   1. Arg parsing — --target=macos/windows, --mode=staged/full; bad
//      values rejected.
//   2. Exit codes — 0 on success, non-zero when a required artifact is
//      missing or the target/mode is bad.
//   3. File I/O contract — the produced SHA256.txt is a single space-
//      separated `<digest>  <basename>` line per entry, computed over the
//      file contents (we precompute SHA-256 of the fixture body and verify
//      the manifest matches).
//   4. External-process boundary — N/A; the script never spawns anything.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "write-native-release-checksums.mjs");

function makeFakeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "sse-write-checksums-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  cpSync(
    path.join(repoRoot, "scripts", "native-release-identity.json"),
    path.join(root, "scripts", "native-release-identity.json")
  );
  cpSync(scriptPath, path.join(root, "scripts", "write-native-release-checksums.mjs"));
  return root;
}

function writeArtifact(root, relativePath, contents) {
  const full = path.join(root, relativePath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
  return full;
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runChecksums(root, ...args) {
  return spawnSync("node", [path.join(root, "scripts", "write-native-release-checksums.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

test("rejects an unsupported --target value with a non-zero exit", () => {
  const root = makeFakeRoot();
  const result = runChecksums(root, "--target=foo", "--mode=staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported target/);
});

test("rejects an unsupported --mode value with a non-zero exit", () => {
  const root = makeFakeRoot();
  // The packaged-zip needs to exist before we hit the mode parser (mode is
  // parsed first in the script though — verify either ordering works).
  writeArtifact(root, "release/native/macos/SSE-ExEd-Studio-Control-Native-macOS.zip", "bytes\n");
  const result = runChecksums(root, "--target=macos", "--mode=quick");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported mode/);
});

test("rejects a missing --target with a non-zero exit", () => {
  const root = makeFakeRoot();
  const result = runChecksums(root, "--mode=staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported target/);
});

test("fails when the packaged-zip is missing (--mode=staged, --target=macos)", () => {
  const root = makeFakeRoot();
  const result = runChecksums(root, "--target=macos", "--mode=staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /packaged native bundle archive not found/);
});

test("--mode=staged --target=macos writes a one-line SHA256 manifest", () => {
  const root = makeFakeRoot();
  const zipBody = "fake macOS zip bytes";
  writeArtifact(root, "release/native/macos/SSE-ExEd-Studio-Control-Native-macOS.zip", zipBody);

  const result = runChecksums(root, "--target=macos", "--mode=staged");
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);

  const manifestPath = path.join(
    root,
    "release",
    "checksums",
    "macos",
    "SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt"
  );
  assert.equal(existsSync(manifestPath), true);

  const manifest = readFileSync(manifestPath, "utf8");
  const expected = `${sha256Hex(zipBody)}  SSE-ExEd-Studio-Control-Native-macOS.zip\n`;
  assert.equal(manifest, expected);
  assert.match(result.stdout, /Checksummed 1 artifact\(s\)/);
});

test("--mode=full --target=macos writes a three-line SHA256 manifest covering installer + update repo", () => {
  const root = makeFakeRoot();
  const zipBody = "fake macOS zip bytes";
  const installerBody = "fake macOS installer bytes";
  const updateRepoBody = "fake macOS update repo bytes";

  writeArtifact(root, "release/native/macos/SSE-ExEd-Studio-Control-Native-macOS.zip", zipBody);
  writeArtifact(
    root,
    "release/native-installer/macos/SSE-ExEd-Studio-Control-Native-macOS-Installer.zip",
    installerBody
  );
  writeArtifact(
    root,
    "release/native-updates/macos/SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip",
    updateRepoBody
  );

  const result = runChecksums(root, "--target=macos", "--mode=full");
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);

  const manifest = readFileSync(
    path.join(root, "release", "checksums", "macos", "SSE-ExEd-Studio-Control-Native-macOS-SHA256.txt"),
    "utf8"
  );
  const lines = manifest.trimEnd().split("\n");
  assert.equal(lines.length, 3, `expected 3 lines, got ${lines.length}: ${manifest}`);
  assert.equal(lines[0], `${sha256Hex(zipBody)}  SSE-ExEd-Studio-Control-Native-macOS.zip`);
  assert.equal(lines[1], `${sha256Hex(installerBody)}  SSE-ExEd-Studio-Control-Native-macOS-Installer.zip`);
  assert.equal(lines[2], `${sha256Hex(updateRepoBody)}  SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip`);
  assert.match(result.stdout, /Checksummed 3 artifact\(s\)/);
});

test("--mode default is 'full' when --mode is omitted", () => {
  const root = makeFakeRoot();
  // Only seed the staged zip; with default mode=full the script must demand
  // the installer + update repo too.
  writeArtifact(root, "release/native/macos/SSE-ExEd-Studio-Control-Native-macOS.zip", "x");
  const result = runChecksums(root, "--target=macos");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /native installer artifact not found/);
});

test("--mode=full --target=windows expects the .exe installer (not a .zip)", () => {
  const root = makeFakeRoot();
  writeArtifact(root, "release/native/windows/SSE-ExEd-Studio-Control-Native-windows.zip", "z");
  writeArtifact(root, "release/native-installer/windows/SSE-ExEd-Studio-Control-Native-windows-Installer.exe", "exe");
  writeArtifact(
    root,
    "release/native-updates/windows/SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip",
    "u"
  );
  const result = runChecksums(root, "--target=windows", "--mode=full");
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  const manifest = readFileSync(
    path.join(root, "release", "checksums", "windows", "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt"),
    "utf8"
  );
  assert.match(manifest, /SSE-ExEd-Studio-Control-Native-windows-Installer\.exe/);
  assert.match(manifest, /SSE-ExEd-Studio-Control-Native-windows-UpdateRepository\.zip/);
});
