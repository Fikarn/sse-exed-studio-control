import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManifest,
  findVisualReviewSummary,
  manifestPathFor,
  readChecksumEntries,
  writeManifest,
} from "./write-release-manifest.mjs";

function makeChecksum(rootDir, target, fileName, lines) {
  const dir = path.join(rootDir, "release", "checksums", target);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, fileName), `${lines.join("\n")}\n`, "utf8");
}

function makeArtifact(rootDir, relativePath, contents = "x") {
  const full = path.join(rootDir, relativePath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

test("readChecksumEntries parses the Windows checksum manifest", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "sse-manifest-"));
  makeChecksum(rootDir, "windows", "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt", [
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  SSE-ExEd-Studio-Control-Native-windows-Installer.exe",
    "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210  SSE-ExEd-Studio-Control-Native-windows-UpdateRepository.zip",
  ]);

  const entries = readChecksumEntries({ rootDir });
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
  assert.deepEqual(
    entries.map((entry) => entry.target),
    ["windows", "windows"]
  );
});

test("findVisualReviewSummary returns the relative path when the file exists", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "sse-manifest-visual-"));
  const summaryDir = path.join(rootDir, "artifacts", "visual", "tauri-cutover");
  mkdirSync(summaryDir, { recursive: true });
  writeFileSync(path.join(summaryDir, "fixture-viewport-summary.json"), "{}", "utf8");

  assert.equal(
    findVisualReviewSummary({ rootDir }),
    path.join("artifacts", "visual", "tauri-cutover", "fixture-viewport-summary.json")
  );
});

test("findVisualReviewSummary returns null when no summary exists", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "sse-manifest-visual-missing-"));
  assert.equal(findVisualReviewSummary({ rootDir }), null);
});

test("buildManifest assembles every documented field defensively", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "sse-manifest-build-"));
  makeChecksum(rootDir, "windows", "SSE-ExEd-Studio-Control-Native-windows-SHA256.txt", [
    "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111  SSE-ExEd-Studio-Control-Native-windows-Installer.exe",
  ]);
  makeArtifact(rootDir, "release/native-installer/windows/SSE-ExEd-Studio-Control-Native-windows-Installer.exe", "x".repeat(123));

  const fakeRun = (command) => {
    if (command === "git") return { status: 0, stdout: "deadbeef\n" };
    if (command === "rustc") return { status: 0, stdout: "rustc 1.99.0\n" };
    // No QtIFW probes — resolver finds nothing in a clean tmpdir, so the
    // version probe doesn't even run; treat anything else as missing.
    return { status: 1, stdout: "", error: new Error("not used in this test") };
  };

  const manifest = buildManifest({
    tag: "v9.9.9",
    rootDir,
    buildStartedAt: "2026-05-25T10:00:00Z",
    buildFinishedAt: "2026-05-25T10:15:00Z",
    run: fakeRun,
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.tag, "v9.9.9");
  assert.equal(manifest.gitSha, "deadbeef");
  assert.equal(manifest.build.startedAt, "2026-05-25T10:00:00Z");
  assert.equal(manifest.build.finishedAt, "2026-05-25T10:15:00Z");
  assert.equal(manifest.build.host.node, process.version);
  assert.equal(manifest.build.host.rustc, "rustc 1.99.0");

  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.artifacts[0].sizeBytes, 123);
  assert.equal(manifest.artifacts[0].target, "windows");

  // QtIFW absent on this temp host — both null, no exception thrown.
  assert.equal(manifest.qtIfw.binaryCreator, null);
  assert.equal(manifest.qtIfw.repoGen, null);

  // Windows signing is dormant (no certificate yet); the macOS signing
  // identity and notarization ticket went with macOS (Slice SW, D22).
  assert.deepEqual(manifest.signing, { windows: null });
  assert.equal(Object.hasOwn(manifest, "notarization"), false);
});

test("buildManifest rejects an invalid tag", () => {
  assert.throws(() => buildManifest({ tag: "not-a-tag" }), /invalid tag/);
});

test("writeManifest writes JSON under release/manifests/<tag>.json", () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "sse-manifest-write-"));
  const manifest = { schemaVersion: 1, tag: "v0.0.1", probe: true };
  const written = writeManifest({ tag: "v0.0.1", manifest, rootDir });
  assert.equal(written, manifestPathFor("v0.0.1", { rootDir }));
  const parsed = JSON.parse(readFileSync(written, "utf8"));
  assert.equal(parsed.probe, true);
});
