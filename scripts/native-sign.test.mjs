import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Production readiness 2026-09, Slice 12 (decision D2) — signing is wired and
// dormant. What can be pinned without a certificate: with nothing configured
// both scripts skip, say which variable would wake them, and exit 0 (the
// release-evidence job stays green and its log says why nothing was signed);
// with half a configuration they fail loudly instead of skipping. The signing
// itself has never run — no certificate exists yet (Appendix B item 7).

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const SIGNING_VARIABLES = /^SSE_(WINDOWS_SIGN|MACOS_CODESIGN|MACOS_NOTARY)/;

function runSigning(script, args = [], extraEnv = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !SIGNING_VARIABLES.test(name)));
  return spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
    encoding: "utf8",
    env: { ...env, ...extraEnv },
  });
}

for (const args of [[], ["--bundle-only"]]) {
  const mode = args.length > 0 ? " with --bundle-only" : "";

  test(`Windows signing${mode} skips with exit 0 and names the variables when no certificate is configured`, () => {
    const result = runSigning("native-sign-windows.mjs", args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Skipping native Windows signing because no signing certificate is configured/);
    assert.match(result.stdout, /SSE_WINDOWS_SIGN_CERT_PATH or SSE_WINDOWS_SIGN_CERT_BASE64/);
  });

  test(`macOS signing${mode} skips with exit 0 and names the variable when no identity is configured`, () => {
    const result = runSigning("native-sign-macos.mjs", args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Skipping native macOS signing because SSE_MACOS_CODESIGN_IDENTITY is not configured/);
  });
}

test("a blank value is no configuration", () => {
  assert.equal(runSigning("native-sign-windows.mjs", [], { SSE_WINDOWS_SIGN_CERT_BASE64: "  " }).status, 0);
  assert.equal(runSigning("native-sign-macos.mjs", [], { SSE_MACOS_CODESIGN_IDENTITY: "  " }).status, 0);
});

test("half a configuration fails loudly instead of skipping", () => {
  // A certificate without its password (on Windows), or the wrong host: never exit 0.
  const windows = runSigning("native-sign-windows.mjs", ["--bundle-only"], {
    SSE_WINDOWS_SIGN_CERT_BASE64: "bm90IGEgY2VydGlmaWNhdGU=",
  });
  assert.notEqual(windows.status, 0);
  assert.match(windows.stderr, /SSE_WINDOWS_SIGN_CERT_PASSWORD is required|can only run on Windows/);
  assert.doesNotMatch(windows.stdout, /Skipping/);

  // An identity with no packaged app to sign (on macOS), or the wrong host.
  const macos = runSigning("native-sign-macos.mjs", ["--bundle-only"], {
    SSE_MACOS_CODESIGN_IDENTITY: "Developer ID Application: Nobody (0000000000)",
  });
  assert.notEqual(macos.status, 0);
  assert.match(macos.stderr, /can only run on macOS|not found|Command failed/);
  assert.doesNotMatch(macos.stdout, /Skipping/);
});
