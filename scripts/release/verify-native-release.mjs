import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveNativeReleaseRuntime } from "../native-release-runtime.mjs";

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
const pathCommand = process.platform === "win32" ? "where" : "which";

function resolveExecutable(name, envNames = []) {
  for (const envName of envNames) {
    const candidate = process.env[envName];
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  const result = spawnSync(pathCommand, [name], {
    cwd: rootDir,
    encoding: "utf8",
    stdio: "pipe",
  });

  if ((result.status ?? 1) !== 0) {
    return null;
  }

  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean);
}

function runNpmScript(name) {
  run(npmCommand, ["run", name]);
}

function runReleaseRuntimeBuild() {
  runNpmScript(releaseRuntime === "tauri" ? "tauri:foundation" : "native:build");
}

if (process.platform === "darwin") {
  const binaryCreator = resolveExecutable("binarycreator", ["SSE_QT_IFW_BINARYCREATOR", "QT_IFW_BINARYCREATOR"]);
  const repoGen = resolveExecutable("repogen", ["SSE_QT_IFW_REPOGEN", "QT_IFW_REPOGEN"]);
  if (binaryCreator && repoGen) {
    console.log("Running full macOS native release verification.");
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
  const binaryCreator = resolveExecutable("binarycreator", ["SSE_QT_IFW_BINARYCREATOR", "QT_IFW_BINARYCREATOR"]);
  const repoGen = resolveExecutable("repogen", ["SSE_QT_IFW_REPOGEN", "QT_IFW_REPOGEN"]);
  if (binaryCreator && repoGen) {
    console.log("Running full Windows native release verification.");
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
