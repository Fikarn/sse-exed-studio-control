import test from "node:test";
import assert from "node:assert/strict";

import {
  checkDiskSpace,
  checkGithubReleasesApi,
  checkMacosCodeSigning,
  checkMacosNotarization,
  checkQtIfwTools,
  checkWindowsSignTool,
} from "./preflight.mjs";

function fakeSpawn(scenarios) {
  return (command, args = []) => {
    const key = [command, ...args].join(" ");
    const scenario = scenarios[key] ?? scenarios.default;
    if (!scenario) {
      throw new Error(`fakeSpawn: no scenario for '${key}'`);
    }
    return { status: 0, stdout: "", stderr: "", ...scenario };
  };
}

test("checkDiskSpace passes when available space exceeds the requirement", () => {
  const result = checkDiskSpace({
    targetPath: "/",
    availableBytes: 16 * 1024 ** 3,
    requiredBytes: 8 * 1024 ** 3,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.match(result.message, /release build has 16\.0 GiB/);
});

test("checkDiskSpace fails actionably when free space is below the requirement", () => {
  const result = checkDiskSpace({
    targetPath: "/",
    availableBytes: 200 * 1024 ** 2,
    requiredBytes: 8 * 1024 ** 3,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /release build requires at least 8\.0 GiB/);
  assert.match(result.message, /npm run clean:local/);
});

test("checkQtIfwTools fails when neither binary resolves and --allow-staged is not set", (t) => {
  // Use a temp rootDir with no .tools/qt-ifw; the default resolver consults
  // env vars (none in this test env) and PATH lookups (which on a CI runner
  // also lack QtIFW) and returns null. Without --allow-staged, that's FAIL.
  const result = checkQtIfwTools({ rootDir: t.fullName });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, false);
  assert.match(result.message, /binarycreator/);
  assert.match(result.message, /repogen/);
  assert.match(result.message, /--allow-staged/);
});

test("checkQtIfwTools downgrades to SKIP when --allow-staged is set", (t) => {
  const result = checkQtIfwTools({ rootDir: t.fullName, allowStaged: true });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.message, /Staged-verify lane only/);
});

test("checkMacosCodeSigning skips on non-darwin hosts", () => {
  const result = checkMacosCodeSigning({ platform: "linux", run: () => ({ status: 0, stdout: "" }) });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("checkMacosCodeSigning SKIPs when security returns no identities (unsigned-deployment posture)", () => {
  const result = checkMacosCodeSigning({
    platform: "darwin",
    run: fakeSpawn({
      default: { status: 0, stdout: "     0 valid identities found\n" },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.message, /unsigned controlled deployment/);
});

test("checkMacosCodeSigning parses the first valid identity", () => {
  const result = checkMacosCodeSigning({
    platform: "darwin",
    run: fakeSpawn({
      default: {
        status: 0,
        stdout:
          "  1) 0123456789ABCDEF0123456789ABCDEF01234567 \"Developer ID Application: SSE ExEd (TEAMID01)\"\n" +
          "     1 valid identities found\n",
      },
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.details.sha1, "0123456789ABCDEF0123456789ABCDEF01234567");
  assert.equal(result.details.commonName, "Developer ID Application: SSE ExEd (TEAMID01)");
});

test("checkWindowsSignTool skips on non-win32 hosts", () => {
  const result = checkWindowsSignTool({ platform: "darwin", run: () => ({ status: 0, stdout: "" }) });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("checkWindowsSignTool fails when signtool is missing", () => {
  const result = checkWindowsSignTool({
    platform: "win32",
    run: () => ({ status: 0, stdout: "", error: new Error("spawn ENOENT") }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /signtool\.exe/);
});

test("checkMacosNotarization SKIPs when env vars are missing (unsigned-deployment posture)", () => {
  const result = checkMacosNotarization({
    platform: "darwin",
    env: {},
    run: () => ({ status: 0, stdout: "" }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.match(result.message, /SSE_MACOS_NOTARY_APPLE_ID/);
  assert.match(result.message, /SSE_MACOS_NOTARY_KEYCHAIN_PROFILE/);
});

test("checkMacosNotarization passes when xcrun returns 0", () => {
  const result = checkMacosNotarization({
    platform: "darwin",
    env: {
      SSE_MACOS_NOTARY_APPLE_ID: "ops@sse.example",
      SSE_MACOS_NOTARY_TEAM_ID: "TEAMID01",
      SSE_MACOS_NOTARY_KEYCHAIN_PROFILE: "sse-notary",
    },
    run: fakeSpawn({
      default: { status: 0, stdout: "" },
    }),
  });
  assert.equal(result.ok, true);
  assert.match(result.message, /TEAMID01/);
});

test("checkGithubReleasesApi treats 200/401 as reachable", async () => {
  for (const status of [200, 304, 401]) {
    const result = await checkGithubReleasesApi({
      repoUrl: "https://github.com/example/repo",
      fetchFn: async () => ({ status }),
    });
    assert.equal(result.ok, true, `status ${status} should be considered reachable`);
  }
});

test("checkGithubReleasesApi fails when fetch throws", async () => {
  const result = await checkGithubReleasesApi({
    repoUrl: "https://github.com/example/repo",
    fetchFn: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /network down/);
});

test("checkGithubReleasesApi fails for non-200/401 status", async () => {
  const result = await checkGithubReleasesApi({
    repoUrl: "https://github.com/example/repo",
    fetchFn: async () => ({ status: 503 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /503/);
});

test("checkGithubReleasesApi fails when repoUrl is missing", async () => {
  const result = await checkGithubReleasesApi({
    repoUrl: null,
    fetchFn: async () => ({ status: 200 }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /package\.json/);
});
