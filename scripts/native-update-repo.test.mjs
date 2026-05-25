import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// plan PR 10 / workstream G2 — Tier 1 coverage for scripts/native-update-repo.mjs.
//
// Mirrors native-installer.test.mjs: drive the script as a subprocess against
// a temp-root fixture and assert against the four-bullet contract. The
// difference vs. native-installer is the output layout (release/native-updates/
// rather than release/native-installer/) and the absence of a config/config.xml
// (repogen reads packages/<id>/meta/package.xml directly).

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "native-update-repo.mjs");

function makeFakeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "sse-native-update-repo-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });

  cpSync(
    path.join(repoRoot, "scripts", "native-release-identity.json"),
    path.join(root, "scripts", "native-release-identity.json")
  );
  cpSync(path.join(repoRoot, "scripts", "qt-ifw-tools.mjs"), path.join(root, "scripts", "qt-ifw-tools.mjs"));
  cpSync(scriptPath, path.join(root, "scripts", "native-update-repo.mjs"));

  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fake", version: "9.9.9" }, null, 2), "utf8");
  writeFileSync(path.join(root, "LICENSE"), "MIT — fixture license body\n", "utf8");
  return root;
}

function seedPackagedPayload(root, target) {
  if (target === "macos") {
    const appPath = path.join(root, "release", "native", "macos", "SSE ExEd Studio Control Native.app");
    mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });
    writeFileSync(path.join(appPath, "Contents", "Info.plist"), "<plist/>", "utf8");
    writeFileSync(path.join(appPath, "Contents", "MacOS", "SSE ExEd Studio Control Native"), "binary bytes\n", "utf8");
    return appPath;
  }
  const winDir = path.join(root, "release", "native", "windows", "SSE ExEd Studio Control Native");
  mkdirSync(winDir, { recursive: true });
  writeFileSync(path.join(winDir, "SSE-ExEd-Studio-Control-Native.exe"), "binary bytes\n", "utf8");
  return winDir;
}

function runUpdateRepo(root, ...args) {
  return spawnSync("node", [path.join(root, "scripts", "native-update-repo.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SSE_QT_IFW_BINARYCREATOR: "",
      SSE_QT_IFW_REPOGEN: "",
      QT_IFW_BINARYCREATOR: "",
      QT_IFW_REPOGEN: "",
    },
  });
}

test("rejects an unsupported --target value with a non-zero exit", () => {
  const root = makeFakeRoot();
  const result = runUpdateRepo(root, "--target=foo", "--prepare-only", "--allow-staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported update repository target/);
});

test("rejects a missing --target with a non-zero exit", () => {
  const root = makeFakeRoot();
  const result = runUpdateRepo(root, "--prepare-only", "--allow-staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported update repository target/);
});

test("rejects --prepare-only without --allow-staged (plan PR 3 / C2)", () => {
  const root = makeFakeRoot();
  const result = runUpdateRepo(root, "--target=macos", "--prepare-only");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pass --allow-staged to confirm/);
  assert.match(result.stderr, /staged \(incomplete\) update repository payload/);
});

test("rejects --target=windows --prepare-only without --allow-staged", () => {
  const root = makeFakeRoot();
  const result = runUpdateRepo(root, "--target=windows", "--prepare-only");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pass --allow-staged to confirm/);
});

test("fails fast when the packaged native payload is missing on a non-matching host", () => {
  const otherTarget = process.platform === "darwin" ? "windows" : "macos";
  const root = makeFakeRoot();
  const result = runUpdateRepo(root, `--target=${otherTarget}`, "--prepare-only", "--allow-staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Packaged native payload not found/);
});

test("happy path on darwin produces the staged update-repo tree", { skip: process.platform !== "darwin" }, () => {
  const root = makeFakeRoot();
  seedPackagedPayload(root, "macos");
  const result = runUpdateRepo(root, "--target=macos", "--prepare-only", "--allow-staged");
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);

  const releaseIdentity = JSON.parse(
    readFileSync(path.join(repoRoot, "scripts", "native-release-identity.json"), "utf8")
  );
  const buildRoot = path.join(root, "release", "native-updates", "macos", "ifw");

  // package.xml + LICENSE.txt must be rendered under meta/.
  const packageXml = readFileSync(
    path.join(buildRoot, "packages", releaseIdentity.packageId, "meta", "package.xml"),
    "utf8"
  );
  assert.match(packageXml, /<Version>9\.9\.9<\/Version>/);
  assert.match(packageXml, /<Name>com\.sse\.exedstudiocontrol\.native<\/Name>/);
  assert.equal(existsSync(path.join(buildRoot, "packages", releaseIdentity.packageId, "meta", "LICENSE.txt")), true);

  // Note that — unlike native-installer — there is NO config/ dir written
  // here. repogen reads from packages/ directly.
  assert.equal(existsSync(path.join(buildRoot, "config")), false, "update-repo build should not write a config/ dir");

  // Staged payload .app should be copied into data/.
  assert.equal(
    existsSync(path.join(buildRoot, "packages", releaseIdentity.packageId, "data", releaseIdentity.payloadNames.macos)),
    true,
    "staged payload .app should exist under data/"
  );
});

test(
  "happy path on darwin logs the staged payload path and skip-repogen line",
  { skip: process.platform !== "darwin" },
  () => {
    const root = makeFakeRoot();
    seedPackagedPayload(root, "macos");
    const result = runUpdateRepo(root, "--target=macos", "--prepare-only", "--allow-staged");
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
    assert.match(result.stdout, /Prepared native update repository staging for macos/);
    assert.match(result.stdout, /Staged payload:/);
    assert.match(result.stdout, /Skipping repogen build because --prepare-only was requested\./);
  }
);
