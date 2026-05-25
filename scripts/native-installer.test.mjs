import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// plan PR 10 / workstream G2 — Tier 1 coverage for scripts/native-installer.mjs.
//
// The script's top-level body runs at import time and spawns binarycreator
// when --prepare-only is absent. We can't mock spawnSync from outside, so
// these tests drive the script as a subprocess and cover:
//
//   1. Argument parsing (--target, --prepare-only, --allow-staged) — both
//      happy and rejection paths.
//   2. Exit codes — 0 on success, non-zero on each documented failure mode
//      (missing target, unsupported target, --prepare-only without
//      --allow-staged, missing packaged payload).
//   3. File I/O contract — running with --prepare-only --allow-staged
//      against a temp-root fixture produces the documented IFW staging tree
//      (config/config.xml, packages/<id>/meta/package.xml +
//      installscript.qs + LICENSE.txt, packages/<id>/data/<payload>).
//   4. External-process boundary — the rejection paths exit BEFORE
//      binarycreator would be invoked, so no QtIFW binary is required on
//      the host. The success path uses --prepare-only which the script
//      documents as skipping binarycreator.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "native-installer.mjs");

function makeFakeRoot() {
  // The script reads scripts/native-release-identity.json, package.json,
  // LICENSE, and native/installer-templates/tauri-installscript.qs from
  // its rootDir, and writes into release/native-installer/<target>/ifw/.
  // It also calls resolveQtIfwTools(), which reads .tools/qt-ifw/... — we
  // leave that directory absent so the resolver falls back to env / PATH
  // (both empty in the subprocess env we spawn).
  const root = mkdtempSync(path.join(tmpdir(), "sse-native-installer-"));
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  mkdirSync(path.join(root, "native", "installer-templates"), { recursive: true });

  // Copy the real release-identity JSON so the payloadNames map is real.
  cpSync(
    path.join(repoRoot, "scripts", "native-release-identity.json"),
    path.join(root, "scripts", "native-release-identity.json")
  );
  // qt-ifw-tools.mjs is imported by the script. Provide a real copy so the
  // ESM import resolves identically to the production layout.
  cpSync(path.join(repoRoot, "scripts", "qt-ifw-tools.mjs"), path.join(root, "scripts", "qt-ifw-tools.mjs"));
  cpSync(scriptPath, path.join(root, "scripts", "native-installer.mjs"));

  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fake", version: "9.9.9" }, null, 2), "utf8");
  writeFileSync(path.join(root, "LICENSE"), "MIT — fixture license body\n", "utf8");
  writeFileSync(
    path.join(root, "native", "installer-templates", "tauri-installscript.qs"),
    "// fixture installscript\n",
    "utf8"
  );

  return root;
}

function seedPackagedPayload(root, target) {
  // The script copies this into the IFW data dir. For macOS the path is an
  // .app directory; for windows it's a directory. cpSync handles both.
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

function runInstaller(root, ...args) {
  return spawnSync("node", [path.join(root, "scripts", "native-installer.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    // Clear QtIFW env vars so the resolver falls back to PATH; --prepare-only
    // means binarycreator is never invoked anyway, but this keeps the
    // resolver output deterministic for tests that exit early.
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
  const result = runInstaller(root, "--target=foo", "--prepare-only", "--allow-staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported installer target/);
});

test("rejects a missing --target with a non-zero exit", () => {
  const root = makeFakeRoot();
  const result = runInstaller(root, "--prepare-only", "--allow-staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported installer target/);
});

test("rejects --prepare-only without --allow-staged (plan PR 3 / C2)", () => {
  const root = makeFakeRoot();
  const result = runInstaller(root, "--target=macos", "--prepare-only");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pass --allow-staged to confirm/);
  assert.match(result.stderr, /staged \(incomplete\) installer payload/);
});

test("rejects --target=windows --prepare-only without --allow-staged with the same guard", () => {
  const root = makeFakeRoot();
  const result = runInstaller(root, "--target=windows", "--prepare-only");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Pass --allow-staged to confirm/);
});

test("fails fast when the packaged native payload is missing on a non-matching host", () => {
  // No payload seeded; the host is darwin in CI/local tests. Skip if running
  // on the same platform as the target — there the script would attempt to
  // build the payload via native-package.mjs (out of scope for unit tests).
  const otherTarget = process.platform === "darwin" ? "windows" : "macos";
  const root = makeFakeRoot();
  const result = runInstaller(root, `--target=${otherTarget}`, "--prepare-only", "--allow-staged");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Packaged native payload not found/);
});

test(
  "happy path with --target=macos --prepare-only --allow-staged produces the staged IFW tree",
  { skip: process.platform !== "darwin" },
  () => {
    const root = makeFakeRoot();
    seedPackagedPayload(root, "macos");
    const result = runInstaller(root, "--target=macos", "--prepare-only", "--allow-staged");
    assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);

    const buildRoot = path.join(root, "release", "native-installer", "macos", "ifw");
    assert.equal(existsSync(buildRoot), true, "build root should exist");

    // config.xml should be rendered with the package.json version.
    const configXml = readFileSync(path.join(buildRoot, "config", "config.xml"), "utf8");
    assert.match(configXml, /<Version>9\.9\.9<\/Version>/);
    assert.match(configXml, /<Name>SSE ExEd Studio Control Native<\/Name>/);

    // package.xml should also embed the version.
    const releaseIdentity = JSON.parse(
      readFileSync(path.join(repoRoot, "scripts", "native-release-identity.json"), "utf8")
    );
    const packageXml = readFileSync(
      path.join(buildRoot, "packages", releaseIdentity.packageId, "meta", "package.xml"),
      "utf8"
    );
    assert.match(packageXml, /<Version>9\.9\.9<\/Version>/);

    // LICENSE.txt + installscript.qs should have been copied through.
    assert.equal(existsSync(path.join(buildRoot, "packages", releaseIdentity.packageId, "meta", "LICENSE.txt")), true);
    assert.equal(
      existsSync(path.join(buildRoot, "packages", releaseIdentity.packageId, "meta", "installscript.qs")),
      true
    );

    // The packaged .app should be staged into data/.
    assert.equal(
      existsSync(
        path.join(buildRoot, "packages", releaseIdentity.packageId, "data", releaseIdentity.payloadNames.macos)
      ),
      true,
      "staged payload .app should exist under data/"
    );
  }
);

test("happy path on darwin logs the staged payload path on stdout", { skip: process.platform !== "darwin" }, () => {
  const root = makeFakeRoot();
  seedPackagedPayload(root, "macos");
  const result = runInstaller(root, "--target=macos", "--prepare-only", "--allow-staged");
  assert.equal(result.status, 0, `expected exit 0; stderr=${result.stderr}`);
  assert.match(result.stdout, /Prepared native installer staging for macos/);
  assert.match(result.stdout, /Staged payload:/);
  assert.match(result.stdout, /Skipping binarycreator build because --prepare-only was requested\./);
});
