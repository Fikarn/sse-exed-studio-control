import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isInside, listProcessPaths } from "./clean.mjs";
import { publishWithOverride } from "./native-parity-acceptance.mjs";
import {
  nativeReleaseRuntimeLabel,
  nativeReleaseShellExecutableName,
  nativeReleaseSmokeArgs,
  resolveNativeReleaseRuntime,
} from "./native-release-runtime.mjs";
import {
  EngineHarness,
  hardenedLaneEnv,
  LIVE_APP_CONTROL_SURFACE_PORT,
  laneProcessEnv,
} from "./native-runtime-harness.mjs";

// On the studio workstation `release/native/windows` is not build output: it
// is the installed app the studio runs, and this script deletes and rebuilds
// it. Since 2026-09-25 (the review of new pages Slice 2b, during which an
// import of this script began deleting it — only the running shell's file
// lock stopped it) the work runs only when the script is started, never when
// it is imported, and a Windows run refuses to remove that folder while
// Studio Control runs from it or answers on the live app's bridge port.
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);

function readFlag(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function normalizeTargetPlatform(value) {
  if (!value) {
    return process.platform;
  }

  if (value === "windows") {
    return "win32";
  }

  return value;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: options.captureOutput ? "utf8" : undefined,
    env: options.env ?? process.env,
    stdio: options.captureOutput ? "pipe" : "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    if (options.captureOutput) {
      if (result.stdout) {
        process.stdout.write(result.stdout);
      }
      if (result.stderr) {
        process.stderr.write(result.stderr);
      }
    }
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }

  return result;
}

function assertExists(targetPath, message) {
  if (!existsSync(targetPath)) {
    throw new Error(message);
  }
}

function readSmokeStatus(statusPath) {
  if (!existsSync(statusPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statusPath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse smoke status file at ${statusPath}: ${error.message}`, { cause: error });
  }
}

function normalizeForOutputComparison(value) {
  return value.replaceAll("\\", "/");
}

function resolveEngineExecutablePath() {
  return path.join(rootDir, "native", "target", "debug", "studio-control-engine.exe");
}

function resolveTauriShellPath(target) {
  const executableName = nativeReleaseShellExecutableName(target, releaseRuntime);
  return path.join(rootDir, "native", "target", "release", executableName);
}

function archiveWindowsDirectory(sourceDir, archivePath) {
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path @('${sourceDir.replaceAll("'", "''")}') -DestinationPath '${archivePath.replaceAll(
      "'",
      "''"
    )}' -Force`,
  ]);
}

function verifyBundledEngineStart(smokeStatus, expectedEnginePath, statusPath) {
  const startedEnginePath = smokeStatus?.startedEnginePath;
  if (!startedEnginePath) {
    throw new Error(`Packaged smoke test did not record startedEnginePath in ${statusPath}.`);
  }

  if (normalizeForOutputComparison(startedEnginePath) !== normalizeForOutputComparison(expectedEnginePath)) {
    throw new Error(
      `Packaged smoke test launched '${startedEnginePath}' instead of bundled engine '${expectedEnginePath}'.`
    );
  }
}

function verifySmokeStatus(smokeStatus, scenario, packaged, statusPath) {
  if (!smokeStatus) {
    throw new Error(`Packaged native ${packaged.label} smoke did not write ${statusPath}.`);
  }

  if (!smokeStatus.finished) {
    throw new Error(`Packaged native ${packaged.label} smoke did not mark the run as finished in ${statusPath}.`);
  }

  if (smokeStatus.exitCode !== 0) {
    throw new Error(
      `Packaged native ${packaged.label} smoke recorded exit code ${smokeStatus.exitCode} in ${statusPath}.`
    );
  }

  verifyBundledEngineStart(smokeStatus, packaged.packagedEnginePath, statusPath);

  if (smokeStatus.targetSurface !== scenario.expectedTarget) {
    throw new Error(
      `Packaged native ${packaged.label} smoke reached target '${smokeStatus.targetSurface}' instead of '${scenario.expectedTarget}'.`
    );
  }
}

// The `dashboard` scenario's saved data is a published setup, seeded through
// the packaged hardware link's own request before the shell starts (new pages
// program, Slice 2b; until then it came from a db.json fixture through the
// import, which is retired).
async function seedPublishedSetup(packaged, runtime) {
  const harness = new EngineHarness({
    rootDir,
    appDataDir: runtime.appDataDir,
    logsDir: runtime.logsDir,
    engineExecutable: packaged.packagedEnginePath,
    env: await hardenedLaneEnv(),
  });
  try {
    await harness.start();
    await publishWithOverride(harness, "package-smoke-seed", `Packaged native ${packaged.label} engine`);
  } finally {
    await harness.close();
  }
}

function smokeScenarioConfig(name) {
  switch (name) {
    case "dashboard":
      return {
        expectedTarget: "dashboard",
        seed: seedPublishedSetup,
      };
    case "clean-start":
      return {
        expectedTarget: "commissioning",
        seed: null,
      };
    default:
      throw new Error(`Unsupported packaged smoke scenario: ${name}`);
  }
}

/**
 * Whether something accepts connections on 127.0.0.1:`port`: true, false, or
 * null when that could not be told.
 */
function acceptsLocalConnections(port) {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const settle = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(2000, () => settle(null));
    socket.once("connect", () => settle(true));
    socket.once("error", (error) => settle(error.code === "ECONNREFUSED" ? false : null));
  });
}

/**
 * Refuses, before anything is removed, to replace an output folder that
 * Studio Control may be running from: a process started from inside it, or
 * anything answering on the live app's Stream Deck bridge port (38201), or
 * either of those that cannot be checked. The keep-and-restore procedure
 * moves the folder aside first; then there is nothing here to refuse.
 */
async function refuseToReplaceARunningApp(outputRoot) {
  if (!existsSync(outputRoot)) {
    return;
  }
  const folder = path.relative(rootDir, outputRoot);
  const procedure = `Nothing was removed. On the studio workstation ${folder} is the installed app: close Studio Control, move ${folder} aside and keep it as the rollback (the keep-and-restore procedure, e.g. rename it to ${folder}.<commit>-<date>), then package again.`;
  const running = listProcessPaths();
  if (running === null) {
    throw new Error(
      `Packaging stopped: the running programs could not be listed, so it is not known whether Studio Control is running from ${folder}. ${procedure}`
    );
  }
  const fromFolder = running.filter((processPath) => isInside(processPath, outputRoot));
  if (fromFolder.length > 0) {
    throw new Error(
      `Packaging stopped: Studio Control is running from ${folder} (${fromFolder.join(", ")}), and packaging would delete it. ${procedure}`
    );
  }
  const answering = await acceptsLocalConnections(LIVE_APP_CONTROL_SURFACE_PORT);
  if (answering === true) {
    throw new Error(
      `Packaging stopped: something answers on 127.0.0.1:${LIVE_APP_CONTROL_SURFACE_PORT}, the live app's Stream Deck bridge port, so Studio Control is running and may be running from ${folder}. ${procedure}`
    );
  }
  if (answering === null) {
    throw new Error(
      `Packaging stopped: it could not be checked whether anything answers on 127.0.0.1:${LIVE_APP_CONTROL_SURFACE_PORT}, the live app's Stream Deck bridge port. ${procedure}`
    );
  }
}

async function packageWindowsLocal() {
  if (process.platform !== "win32") {
    throw new Error("native-package.mjs Windows packaging can only run on Windows.");
  }

  const sourceShellPath = resolveTauriShellPath("windows");
  const engineExecutablePath = resolveEngineExecutablePath();
  const outputRoot = path.join(rootDir, "release", "native", "windows");
  const packagedDirPath = path.join(outputRoot, "SSE ExEd Studio Control Native");
  const packagedShellPath = path.join(packagedDirPath, "sse-exed-tauri-shell.exe");
  const packagedEnginePath = path.join(packagedDirPath, "studio-control-engine.exe");
  const packagedArchivePath = path.join(outputRoot, "SSE-ExEd-Studio-Control-Native-windows.zip");

  assertExists(sourceShellPath, `Tauri shell executable not found at ${sourceShellPath}. Run \`npm run tauri:build\`.`);
  assertExists(
    engineExecutablePath,
    `Native engine executable not found at ${engineExecutablePath}. Run \`npm run native:engine:build\`.`
  );

  await refuseToReplaceARunningApp(outputRoot);
  rmSync(outputRoot, { force: true, recursive: true });
  mkdirSync(packagedDirPath, { recursive: true });

  copyFileSync(sourceShellPath, packagedShellPath);
  copyFileSync(engineExecutablePath, packagedEnginePath);
  chmodSync(packagedShellPath, statSync(sourceShellPath).mode);
  chmodSync(packagedEnginePath, statSync(engineExecutablePath).mode);
  archiveWindowsDirectory(packagedDirPath, packagedArchivePath);

  console.log(`Packaged native Windows Tauri bundle: ${packagedDirPath}`);
  console.log(`Packaged native Windows archive: ${packagedArchivePath}`);

  return {
    label: "Windows",
    packagedShellPath,
    packagedEnginePath,
    runtime: releaseRuntime,
    smokeRuntimeDir: path.join(outputRoot, "smoke-runtime"),
    target: "windows",
  };
}

async function smokePackagedBundle(packaged, scenarioName) {
  const scenario = smokeScenarioConfig(scenarioName);
  rmSync(packaged.smokeRuntimeDir, { force: true, recursive: true });
  mkdirSync(packaged.smokeRuntimeDir, { recursive: true });
  const smokeStatusPath = path.join(packaged.smokeRuntimeDir, "smoke-status.json");
  const runtime = {
    appDataDir: path.join(packaged.smokeRuntimeDir, "app-data"),
    logsDir: path.join(packaged.smokeRuntimeDir, "logs"),
  };

  if (scenario.seed) {
    await scenario.seed(packaged, runtime);
  }

  const commandArgs = nativeReleaseSmokeArgs(packaged.target, packaged.runtime, smokeStatusPath);
  run(packaged.packagedShellPath, commandArgs, {
    captureOutput: true,
    env: laneProcessEnv(
      await hardenedLaneEnv(),
      {
        SSE_APP_DATA_DIR: runtime.appDataDir,
        SSE_LOG_DIR: runtime.logsDir,
      },
      { label: `Packaged native ${packaged.label} smoke '${scenarioName}'` }
    ),
  });

  const smokeStatus = readSmokeStatus(smokeStatusPath);
  verifySmokeStatus(smokeStatus, scenario, packaged, smokeStatusPath);
  console.log(`Packaged native ${packaged.label} smoke passed for scenario '${scenarioName}'.`);
}

async function main() {
  const smokeTest = process.argv.slice(2).includes("--smoke-test");
  const targetPlatform = normalizeTargetPlatform(readFlag("--target"));
  if (targetPlatform !== process.platform) {
    throw new Error(`native-package.mjs target '${targetPlatform}' must run on a matching host platform.`);
  }

  let packaged;
  if (targetPlatform === "win32") {
    packaged = await packageWindowsLocal();
  } else {
    throw new Error("native-package.mjs supports Windows packaging only.");
  }

  console.log(`Native release packaging runtime: ${nativeReleaseRuntimeLabel(releaseRuntime)}.`);

  if (smokeTest) {
    await smokePackagedBundle(packaged, readFlag("--scenario") ?? "dashboard");
  }
}

// Runs only as `node scripts/native-package.mjs …`: an import does nothing
// (2026-09-25). The two paths are compared as real paths — through a
// directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
// would skip the packaging without a word (scripts/dev-check-cli.mjs).
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
  await main();
}
