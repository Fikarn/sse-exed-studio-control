import { spawnSync } from "node:child_process";
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

if (process.platform === "darwin") {
  assertAvailableDiskSpace({ label: "macOS release verification", targetPath: rootDir });
  const qtIfwTools = resolveQtIfwTools({ rootDir });
  if (qtIfwTools.complete) {
    console.log(`Running full macOS native release verification with ${formatQtIfwToolSummary(qtIfwTools)}.`);
    runNpmScript("native:release:mac:local");
    runNpmScript("native:checksums:mac:write");
  } else {
    console.log("QtIFW tools not found. Running macOS native release staging verification.");
    runReleaseRuntimeBuild();
    runNpmScript("native:package:mac:smoke");
    runNpmScript("native:package:mac:clean-smoke");
    runNpmScript("native:package:mac:acceptance");
    runNpmScript("native:installer:mac:prepare");
    runNpmScript("native:update-repo:mac:prepare");
    runNpmScript("native:checksums:mac:staged-write");
    runNpmScript("native:artifacts:mac:staged-verify");
    runNpmScript("native:continuity:mac:verify");
    runNpmScript("native:delivery:mac:verify");
  }
  process.exit(0);
}

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
  `Skipping platform-native packaging verification on ${process.platform}. Run release verification on macOS or Windows for installer and update-repository checks.`
);
