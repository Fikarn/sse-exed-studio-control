import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { RELEASE_BUILD_MIN_FREE_BYTES, checkAvailableDiskSpace, getAvailableDiskSpaceBytes } from "../disk-space.mjs";
import { resolveQtIfwTools } from "../qt-ifw-tools.mjs";
import { readPackageJson, resolveRepositoryHttpUrl } from "./helpers.mjs";

// plan PR 3 / workstream C1.
//
// Read-only preflight that runs in <30 s and reports the state of every
// dependency the 12-stage release chain assumes before it commits to the
// long-running build. Anything that would otherwise fail an hour into the
// chain (missing QtIFW, no disk, GitHub Releases API unreachable) fails here
// instead.
//
// Wired into `release:verify` so the preflight runs before
// `verify-native-release.mjs`. Local maintainers can also run
// `npm run release:preflight` standalone.

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Wraps each preflight check so the report is uniform. */
function checkResult(id, label, ok, message, { skipped = false, details = null } = {}) {
  return { id, label, ok, message, skipped, details };
}

/**
 * Windows signtool probe. Just confirms `signtool sign /?` exits 0 so the
 * binary is present and runnable. Real signing still requires a cert+key
 * on the host and is exercised by `scripts/native-sign-windows.mjs`.
 */
export function checkWindowsSignTool({ platform = process.platform, run = spawnSync } = {}) {
  if (platform !== "win32") {
    return checkResult("windows-signtool", "Windows signtool", true, "Skipped on non-Windows host.", {
      skipped: true,
    });
  }

  const result = run("signtool.exe", ["sign", "/?"], { encoding: "utf8" });
  if (result.error) {
    return checkResult(
      "windows-signtool",
      "Windows signtool",
      false,
      `Failed to spawn 'signtool.exe': ${result.error.message}. Install the Windows SDK signing tools or add them to PATH.`
    );
  }
  if ((result.status ?? 1) !== 0) {
    return checkResult(
      "windows-signtool",
      "Windows signtool",
      false,
      `'signtool sign /?' exited with code ${result.status}. Verify the Windows SDK installation.`
    );
  }
  return checkResult("windows-signtool", "Windows signtool", true, "signtool resolves and responds to `sign /?`.");
}

/**
 * QtIFW tool resolution probe. Reuses the shared resolver; requires BOTH
 * binarycreator AND repogen to resolve.
 */
export function checkQtIfwTools({ rootDir: rootDirOverride = rootDir, allowStaged = false } = {}) {
  const tools = resolveQtIfwTools({ rootDir: rootDirOverride });
  if (!tools.complete) {
    const missing = [tools.binaryCreator ? null : "binarycreator", tools.repoGen ? null : "repogen"]
      .filter(Boolean)
      .join(" + ");
    if (allowStaged) {
      // The caller knows they're driving the staged-verify lane (see
      // C2 --allow-staged opt-in). Downgrade QtIFW absence from a hard
      // failure to a skip so the staged lane stays runnable.
      return checkResult(
        "qt-ifw-tools",
        "QtIFW tooling",
        true,
        `QtIFW ${missing} not found. SKIPPED (--allow-staged). Staged-verify lane only — full installer + update-repository builds need QtIFW.`,
        { skipped: true }
      );
    }
    return checkResult(
      "qt-ifw-tools",
      "QtIFW tooling",
      false,
      `QtIFW ${missing} did not resolve. Set SSE_QT_IFW_BINARYCREATOR / SSE_QT_IFW_REPOGEN or install QtIFW into .tools/qt-ifw. To run the staged-verify lane instead, pass --allow-staged.`
    );
  }
  return checkResult(
    "qt-ifw-tools",
    "QtIFW tooling",
    true,
    `binarycreator via ${tools.binaryCreator.source}; repogen via ${tools.repoGen.source}.`,
    { details: { binaryCreator: tools.binaryCreator, repoGen: tools.repoGen } }
  );
}

/**
 * Disk-space probe. Reuses the shared helper; defaults to the
 * RELEASE_BUILD_MIN_FREE_BYTES (8 GiB) threshold used by
 * verify-native-release.mjs.
 */
export function checkDiskSpace({
  targetPath = rootDir,
  requiredBytes = RELEASE_BUILD_MIN_FREE_BYTES,
  availableBytes = getAvailableDiskSpaceBytes(targetPath),
} = {}) {
  const result = checkAvailableDiskSpace({ availableBytes, label: "release build", requiredBytes });
  return checkResult(
    "disk-space",
    "Disk space",
    result.ok,
    result.message,
    { details: { availableBytes, requiredBytes, targetPath } }
  );
}

/**
 * GitHub Releases API reachability probe. Issues a HEAD against
 * api.github.com/repos/<owner>/<repo>. We don't need auth — public repos
 * respond 200; private repos respond 401. Either confirms reachability.
 */
export async function checkGithubReleasesApi({
  repoUrl = resolveRepositoryHttpUrl(),
  fetchFn = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  if (!repoUrl) {
    return checkResult(
      "github-releases-api",
      "GitHub Releases API reachable",
      false,
      "Could not resolve repository URL from package.json."
    );
  }
  const slugMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  if (!slugMatch) {
    return checkResult(
      "github-releases-api",
      "GitHub Releases API reachable",
      false,
      `Unsupported repository URL '${repoUrl}'.`
    );
  }
  const apiUrl = `https://api.github.com/repos/${slugMatch[1]}/${slugMatch[2]}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(apiUrl, { method: "HEAD", signal: controller.signal });
    if (response.status === 200 || response.status === 304 || response.status === 401) {
      return checkResult(
        "github-releases-api",
        "GitHub Releases API reachable",
        true,
        `${apiUrl} responded ${response.status}.`
      );
    }
    return checkResult(
      "github-releases-api",
      "GitHub Releases API reachable",
      false,
      `${apiUrl} responded ${response.status}.`
    );
  } catch (error) {
    return checkResult(
      "github-releases-api",
      "GitHub Releases API reachable",
      false,
      `Could not reach ${apiUrl}: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function runPreflight({
  platform = process.platform,
  rootDir: rootDirOverride = rootDir,
  fetchFn,
  run = spawnSync,
  allowStaged = false,
} = {}) {
  const results = [];
  results.push(checkDiskSpace({ targetPath: rootDirOverride }));
  results.push(checkQtIfwTools({ rootDir: rootDirOverride, allowStaged }));
  results.push(checkWindowsSignTool({ platform, run }));
  results.push(
    await checkGithubReleasesApi({
      repoUrl: resolveRepositoryHttpUrl(readPackageJson()),
      fetchFn,
    })
  );

  const ok = results.every((entry) => entry.ok);
  return {
    ok,
    platform,
    results,
    summary: results
      .map((entry) => `${entry.ok ? (entry.skipped ? "SKIP" : "PASS") : "FAIL"}  ${entry.label} — ${entry.message}`)
      .join("\n"),
  };
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
  const allowStaged = process.argv.slice(2).includes("--allow-staged");
  const result = await runPreflight({ allowStaged });
  console.log(`Release preflight on ${result.platform}${allowStaged ? " (--allow-staged)" : ""}:`);
  console.log(result.summary);
  if (!result.ok) {
    console.error("\nRelease preflight failed. Fix the FAIL entries above before invoking the release chain.");
    process.exit(1);
  }
  console.log("\nRelease preflight passed.");
}
