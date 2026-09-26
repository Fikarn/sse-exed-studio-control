import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertAvailableDiskSpace } from "../disk-space.mjs";
import { resolveNativeReleaseRuntime } from "../native-release-runtime.mjs";
import { formatQtIfwToolSummary, resolveQtIfwTools } from "../qt-ifw-tools.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function runNpmScript(name) {
  run(npmCommand, ["run", name]);
}

function runReleaseRuntimeBuild() {
  if (releaseRuntime !== "tauri") {
    throw new Error(`Unsupported native release runtime: ${releaseRuntime}`);
  }
  runNpmScript("tauri:foundation");
}

function main() {
  if (process.platform === "win32") {
    assertAvailableDiskSpace({ label: "Windows release verification", targetPath: rootDir });
    const qtIfwTools = resolveQtIfwTools({ rootDir });
    if (qtIfwTools.complete) {
      console.log(`Running full Windows native release verification with ${formatQtIfwToolSummary(qtIfwTools)}.`);
      runNpmScript("native:release:win:local");
      runNpmScript("native:checksums:win:write");
    } else {
      console.log("QtIFW tools not found. Running Windows native release staging verification.");
      runReleaseRuntimeBuild();
      runNpmScript("native:package:win:smoke");
      runNpmScript("native:package:win:clean-smoke");
      runNpmScript("native:package:win:acceptance");
      runNpmScript("native:installer:win:prepare");
      runNpmScript("native:update-repo:win:prepare");
      runNpmScript("native:checksums:win:staged-write");
      runNpmScript("native:artifacts:win:staged-verify");
      runNpmScript("native:continuity:win:verify");
      runNpmScript("native:delivery:win:verify");
    }
    process.exit(0);
  }

  console.log(
    `Skipping platform-native packaging verification on ${process.platform}. Run release verification on Windows for installer and update-repository checks.`
  );
}

// Runs only as `node scripts/release/verify-native-release.mjs`: an import does
// nothing (2026-09-26; the run starts the whole native release lane, which
// rebuilds release/, and ends the process). The two paths are compared as real
// paths — through a directory junction or a short 8.3 name, `process.argv[1]`
// and `import.meta.url` spell the same file differently, and a plain comparison
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
