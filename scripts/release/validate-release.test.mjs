import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const validateReleasePath = path.join(repoRoot, "scripts", "release", "validate-release.mjs");

function writeFixtureFile(root, relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function createReleaseFixture({
  rootVersion = "2.2.1",
  frontendAppVersion = rootVersion,
  tauriConfigVersion = rootVersion,
  tauriShellCargoVersion = rootVersion,
  rustEngineCargoVersion = rootVersion,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sse-release-check-"));
  writeFixtureFile(
    root,
    "package.json",
    JSON.stringify(
      {
        name: "sse-exed-studio-control",
        version: rootVersion,
      },
      null,
      2
    )
  );
  writeFixtureFile(
    root,
    "CHANGELOG.md",
    `# Changelog

## [Unreleased]

## [${rootVersion}] — 2026-04-24

- Release fixture.
`
  );
  writeFixtureFile(
    root,
    "frontend/app/package.json",
    JSON.stringify(
      {
        name: "@sse/frontend-app",
        version: frontendAppVersion,
      },
      null,
      2
    )
  );
  writeFixtureFile(
    root,
    "native/tauri-shell/tauri.conf.json",
    JSON.stringify(
      {
        version: tauriConfigVersion,
      },
      null,
      2
    )
  );
  writeFixtureFile(
    root,
    "native/tauri-shell/Cargo.toml",
    `[package]
name = "sse-exed-tauri-shell"
version = "${tauriShellCargoVersion}"
`
  );
  writeFixtureFile(
    root,
    "native/rust-engine/Cargo.toml",
    `[package]
name = "studio-control-engine"
version = "${rustEngineCargoVersion}"
`
  );
  return root;
}

function runValidateRelease(cwd) {
  return spawnSync(process.execPath, [validateReleasePath, "--tag", "v2.2.1"], {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });
}

test("validate-release accepts aligned product-version surfaces", () => {
  const fixtureRoot = createReleaseFixture();
  const result = runValidateRelease(fixtureRoot);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /product version surfaces: 4 checked/);
});

test("validate-release rejects product-version drift outside the root package", () => {
  const fixtureRoot = createReleaseFixture({
    frontendAppVersion: "0.1.0",
    tauriConfigVersion: "0.1.0",
    tauriShellCargoVersion: "0.1.0",
    rustEngineCargoVersion: "0.1.0",
  });
  const result = runValidateRelease(fixtureRoot);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  assert.match(output, /frontend\/app\/package\.json version mismatch/);
  assert.match(output, /native\/tauri-shell\/tauri\.conf\.json version mismatch/);
  assert.match(output, /native\/tauri-shell\/Cargo\.toml version mismatch/);
  assert.match(output, /native\/rust-engine\/Cargo\.toml version mismatch/);
});
