import test from "node:test";
import assert from "node:assert/strict";

import { checkDiskSpace, checkGithubReleasesApi, checkQtIfwTools, checkWindowsSignTool } from "./preflight.mjs";

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

test("checkWindowsSignTool skips on non-win32 hosts", () => {
  const result = checkWindowsSignTool({ platform: "linux", run: () => ({ status: 0, stdout: "" }) });
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
