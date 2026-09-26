import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nativeReleaseRuntimeLabel, resolveNativeReleaseRuntime } from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);
const buildScript = "tauri:foundation";

function main() {
  console.log(`Building ${nativeReleaseRuntimeLabel(releaseRuntime)} shipping runtime via npm run ${buildScript}.`);

  const result = spawnSync(npmCommand, ["run", buildScript], {
    cwd: rootDir,
    shell: process.platform === "win32",
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`npm run ${buildScript} failed with exit code ${result.status ?? 1}.`);
  }
}

// Runs only as `node scripts/native-release-build.mjs`: an import does nothing
// (2026-09-26; the run starts npm run tauri:foundation, which builds the engine
// and the shell). The two paths are compared as real paths — through a
// directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
// would skip the run without a word (scripts/dev-check-cli.mjs).
function isMainModule() {
  const started = process.argv[1];
  if (!started) {
    return false;
  }
  const self = fileURLToPath(import.meta.url);
  let same = false;
  try {
    same = realpathSync.native(started) === realpathSync.native(self);
  } catch {
    // Not a file the file system resolves: not this one.
  }
  if (!same && path.basename(started) === path.basename(self)) {
    throw new Error(`${started} was started, but it could not be matched to ${self}; nothing was done.`);
  }
  return same;
}

if (isMainModule()) {
  main();
}
