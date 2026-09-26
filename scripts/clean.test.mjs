import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { TARGETS, clean, findPackagedExecutables, isInside, listProcessPaths, planClean } from "./clean.mjs";

// `npm run clean` used to delete `release/` whole — and on the studio
// workstation `release/native/windows` IS the operator's installed app (found
// 2026-09-18, production readiness S12 session). Everything here runs in a
// temp-dir copy of the layout: `clean()` has no default root, so no test can
// reach the repository's own `release/` by leaving an argument out.

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "clean.mjs");
const WINDOWS_APP = "release/native/windows/SSE ExEd Studio Control Native";

function write(root, relativePath, contents = "x") {
  const full = path.join(root, relativePath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents);
  return full;
}

/** A fake repository root with build output, release output and, when asked, a packaged app. */
function makeRoot({ app = null } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "sse-clean-"));
  write(root, "scripts/keep-me.mjs");
  write(root, "native/target/debug/big.bin");
  write(root, "native/build/x");
  write(root, "frontend/app/dist/index.html");
  write(root, "frontend/app/test-results/r.json");
  write(root, "release/checksums/windows/SHA256.txt");
  write(root, "release/sbom/windows/engine.cdx.json");
  write(root, "artifacts/evidence.json");
  if (app) {
    write(root, `${app}/sse-exed-tauri-shell.exe`, "SHELL-BYTES");
    write(root, `${app}/studio-control-engine.exe`, "ENGINE-BYTES");
  }
  return root;
}

const quiet = { log: () => {}, warn: () => {} };
const nothingRunning = () => [];

test("without a packaged app everything goes, release included, as it always did", async () => {
  const root = makeRoot();
  assert.deepEqual(planClean({ rootDir: root }).remove, TARGETS);
  assert.equal(await clean({ rootDir: root, ...quiet }), 0);
  for (const gone of ["native/target", "native/build", "frontend/app/dist", "frontend/app/test-results", "release"]) {
    assert.equal(existsSync(path.join(root, gone)), false, gone);
  }
  // --local's extras were not asked for.
  assert.equal(existsSync(path.join(root, "artifacts/evidence.json")), true);
  assert.equal(existsSync(path.join(root, "scripts/keep-me.mjs")), true);
});

test("a packaged app under release/native is kept, byte for byte, and the rest still goes", async () => {
  const root = makeRoot({ app: WINDOWS_APP });
  const warnings = [];
  const code = await clean({ rootDir: root, local: true, log: () => {}, warn: (line) => warnings.push(line) });
  assert.equal(code, 0);

  assert.equal(readFileSync(path.join(root, WINDOWS_APP, "sse-exed-tauri-shell.exe"), "utf8"), "SHELL-BYTES");
  assert.equal(readFileSync(path.join(root, WINDOWS_APP, "studio-control-engine.exe"), "utf8"), "ENGINE-BYTES");
  for (const gone of ["native/target", "frontend/app/dist", "release/checksums", "release/sbom", "artifacts"]) {
    assert.equal(existsSync(path.join(root, gone)), false, gone);
  }

  const said = warnings.join("\n");
  assert.match(said, /KEPT release\/native — a packaged app is in there:/);
  assert.match(
    said,
    /release\/native\/windows\/SSE ExEd Studio Control Native\/sse-exed-tauri-shell\.exe {2}\(11 bytes, /
  );
  assert.match(said, /npm run clean:local -- --include-release/);
});

test("a lane's windows.production-keep folder, and a copy kept deeper, are packaged apps too", () => {
  // A packaging lane that died half-way leaves production under this name.
  const stranded = makeRoot({ app: "release/native/windows.production-keep/SSE ExEd Studio Control Native" });
  const plan = planClean({ rootDir: stranded });
  assert.deepEqual(plan.keep, ["release/native"]);
  assert.deepEqual(plan.remove.filter((target) => target.startsWith("release")).sort(), [
    "release/checksums",
    "release/sbom",
  ]);

  // As deep as the search reaches (where the macOS bundle kept its
  // executables until the new pages program's Slice SW, D22): a copy moved
  // two folders further down is found and kept too.
  const deep = "release/native/rollback/2026-09-23/windows/SSE ExEd Studio Control Native";
  const deeper = makeRoot({ app: deep });
  assert.deepEqual(
    findPackagedExecutables(deeper).map((found) => found.relativePath),
    [`${deep}/sse-exed-tauri-shell.exe`, `${deep}/studio-control-engine.exe`]
  );
  assert.deepEqual(planClean({ rootDir: deeper }).keep, ["release/native"]);

  // An executable of another name, or a packaged name outside release/native, is nobody's installed app.
  const other = makeRoot();
  write(other, "release/native/windows/notes.txt");
  write(other, "release/native-installer/windows/sse-exed-tauri-shell.exe");
  assert.deepEqual(findPackagedExecutables(other), []);
  assert.deepEqual(planClean({ rootDir: other }).remove, TARGETS);
});

test("--include-release removes the app when nothing runs from it", async () => {
  const root = makeRoot({ app: WINDOWS_APP });
  const warnings = [];
  const code = await clean({
    rootDir: root,
    includeRelease: true,
    processPaths: nothingRunning,
    log: () => {},
    warn: (line) => warnings.push(line),
  });
  assert.equal(code, 0);
  assert.equal(existsSync(path.join(root, "release")), false);
  assert.match(warnings.join("\n"), /Removed the packaged app \(--include-release\):/);
});

test("--include-release refuses while a process runs from the folder, and removes nothing at all", async () => {
  const root = makeRoot({ app: WINDOWS_APP });
  const shell = path.join(root, WINDOWS_APP, "sse-exed-tauri-shell.exe");
  const warnings = [];
  const code = await clean({
    rootDir: root,
    local: true,
    includeRelease: true,
    processPaths: () => ["/usr/bin/unrelated", shell],
    log: () => {},
    warn: (line) => warnings.push(line),
  });
  assert.equal(code, 1);
  assert.match(
    warnings.join("\n"),
    /REFUSED\. --include-release: a process is running from release\/native .*Nothing was removed\. Close Studio Control first\./s
  );
  // Never half done: the build output is still there too.
  for (const kept of [
    `${WINDOWS_APP}/sse-exed-tauri-shell.exe`,
    "native/target/debug/big.bin",
    "release/checksums/windows/SHA256.txt",
    "artifacts/evidence.json",
  ]) {
    assert.equal(existsSync(path.join(root, kept)), true, kept);
  }

  // A process elsewhere with the same file name is not this app.
  const elsewhere = path.join(makeRoot({ app: WINDOWS_APP }), WINDOWS_APP, "sse-exed-tauri-shell.exe");
  assert.equal(planClean({ rootDir: root, includeRelease: true, processPaths: () => [elsewhere] }).refusal, null);
});

test("--include-release refuses when the running processes cannot be listed", async () => {
  const root = makeRoot({ app: WINDOWS_APP });
  const plan = planClean({ rootDir: root, includeRelease: true, processPaths: () => null });
  assert.match(plan.refusal, /could not be listed.*Nothing was removed/s);
  assert.deepEqual(plan.remove, []);
  assert.equal(await clean({ rootDir: root, includeRelease: true, processPaths: () => null, ...quiet }), 1);
  assert.equal(existsSync(path.join(root, "native/target/debug/big.bin")), true);
  // Without the flag the process list is not needed and is not read.
  assert.deepEqual(
    planClean({
      rootDir: root,
      processPaths: () => {
        throw new Error("must not be called");
      },
    }).keep,
    ["release/native"]
  );
});

test("--dry-run says what it would do and removes nothing", async () => {
  const root = makeRoot({ app: WINDOWS_APP });
  const lines = [];
  assert.equal(
    await clean({
      rootDir: root,
      local: true,
      includeRelease: true,
      dryRun: true,
      processPaths: nothingRunning,
      log: (line) => lines.push(line),
      warn: (line) => lines.push(line),
    }),
    0
  );
  assert.ok(lines.includes("would remove release"));
  assert.match(lines.join("\n"), /Would remove the packaged app/);
  for (const kept of [
    `${WINDOWS_APP}/studio-control-engine.exe`,
    "native/target/debug/big.bin",
    "artifacts/evidence.json",
  ]) {
    assert.equal(existsSync(path.join(root, kept)), true, kept);
  }
});

test("a root has to be named: there is no default that could be the repository", () => {
  assert.throws(() => planClean({}), /explicit rootDir/);
});

test("isInside compares real paths, and only the folder itself counts", () => {
  const root = realpathSync(makeRoot({ app: WINDOWS_APP }));
  const appDir = path.join(root, "release", "native");
  assert.equal(isInside(path.join(root, WINDOWS_APP, "sse-exed-tauri-shell.exe"), appDir), true);
  assert.equal(isInside(appDir, appDir), true);
  assert.equal(isInside(path.join(root, "release", "native-installer", "x.exe"), appDir), false);
  assert.equal(isInside(path.join(root, "native", "target", "release", "sse-exed-tauri-shell.exe"), appDir), false);
  if (process.platform !== "linux") {
    assert.equal(isInside(path.join(root, WINDOWS_APP).toUpperCase(), appDir), true);
  }

  // The same folder reached by another spelling — a junction or a symlink here, a mapped drive or an 8.3 short
  // name on a workstation: a process is reported by one spelling, the repository is opened by another.
  const alias = path.join(root, "alias-to-the-app-folder");
  symlinkSync(appDir, alias, "junction");
  assert.equal(
    isInside(path.join(alias, "windows", "SSE ExEd Studio Control Native", "sse-exed-tauri-shell.exe"), appDir),
    true
  );
  assert.equal(isInside(path.join(root, WINDOWS_APP, "sse-exed-tauri-shell.exe"), alias), true);
});

test("the real process list works on this platform: it contains this test's own node", () => {
  const paths = listProcessPaths();
  assert.ok(Array.isArray(paths) && paths.length > 0, "no process list");
  const own = path.dirname(process.execPath);
  assert.ok(
    paths.some((processPath) => isInside(processPath, own) && /node/i.test(path.basename(processPath))),
    `node (${process.execPath}) not found among ${paths.length} processes`
  );
});

// The command line, from a copy of the script in a fake root (the script finds
// its root from where it lies), with the real process list.
function runClean(root, ...args) {
  cpSync(scriptPath, path.join(root, "scripts", "clean.mjs"));
  return spawnSync(process.execPath, [path.join(root, "scripts", "clean.mjs"), ...args], { encoding: "utf8" });
}

test("the command keeps the app by default, and removes it with --include-release", () => {
  const root = makeRoot({ app: WINDOWS_APP });
  const kept = runClean(root);
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stderr, /KEPT release\/native/);
  assert.match(kept.stderr, /npm run clean -- --include-release/);
  assert.match(kept.stdout, /removed native\/target/);
  assert.equal(existsSync(path.join(root, WINDOWS_APP, "sse-exed-tauri-shell.exe")), true);
  assert.equal(existsSync(path.join(root, "release/checksums")), false);

  const removed = runClean(root, "--include-release");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(path.join(root, "release")), false);
});

test("for real: the command refuses while a process started from the app folder is alive", async () => {
  const root = makeRoot();
  const appDir = path.join(root, WINDOWS_APP);
  mkdirSync(appDir, { recursive: true });
  // This test's own node, under the packaged shell's name: a real process whose executable lies in the folder.
  const shell = path.join(appDir, `sse-exed-tauri-shell${process.platform === "win32" ? ".exe" : ""}`);
  try {
    linkSync(process.execPath, shell);
  } catch {
    copyFileSync(process.execPath, shell); // another volume
  }
  const child = spawn(shell, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  try {
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const refused = runClean(root, "--include-release");
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /REFUSED\. --include-release: a process is running from release\/native/);
    assert.match(refused.stderr, /sse-exed-tauri-shell/);
    assert.equal(existsSync(shell), true);
    assert.equal(existsSync(path.join(root, "native/target/debug/big.bin")), true);
  } finally {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }

  // The same command once the process is gone.
  const removed = runClean(root, "--include-release");
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(existsSync(path.join(root, "release")), false);
});

test("a mistyped option stops the command instead of falling back to a plain clean", () => {
  const root = makeRoot({ app: WINDOWS_APP });
  for (const typo of ["--include-relase", "--dryrun", "--dry-run=true"]) {
    const result = runClean(root, typo);
    assert.equal(result.status, 2, typo);
    assert.match(result.stderr, /Unknown option/);
  }
  assert.equal(existsSync(path.join(root, "native/target/debug/big.bin")), true);
});
