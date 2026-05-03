import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  nativeReleaseAppIdentifier,
  nativeReleaseRuntimeLabel,
  nativeReleaseShellExecutableName,
  nativeReleaseSmokeArgs,
  resolveNativeReleaseRuntime,
} from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const smokeTest = args.has("--smoke-test");
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);
const smokeFixturePath = path.join(rootDir, "native", "rust-engine", "fixtures", "dashboard-ready-db.json");

function readFlag(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function normalizeTargetPlatform(value) {
  if (!value) {
    return process.platform;
  }

  if (value === "macos") {
    return "darwin";
  }
  if (value === "windows") {
    return "win32";
  }

  return value;
}

const targetPlatform = normalizeTargetPlatform(readFlag("--target"));

if (targetPlatform !== process.platform) {
  throw new Error(`native-package.mjs target '${targetPlatform}' must run on a matching host platform.`);
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
  return process.platform === "win32"
    ? path.join(rootDir, "native", "target", "debug", "studio-control-engine.exe")
    : path.join(rootDir, "native", "target", "debug", "studio-control-engine");
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

function writeTauriMacInfoPlist(appPath) {
  const contentsPath = path.join(appPath, "Contents");
  const version = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")).version;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>SSE ExEd Studio Control</string>
  <key>CFBundleExecutable</key>
  <string>sse-exed-tauri-shell</string>
  <key>CFBundleIdentifier</key>
  <string>${nativeReleaseAppIdentifier()}</string>
  <key>CFBundleName</key>
  <string>SSE ExEd Studio Control</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
  writeFileSync(path.join(contentsPath, "Info.plist"), plist, "utf8");
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

function smokeScenarioConfig(name) {
  switch (name) {
    case "dashboard":
      return {
        expectedTarget: "dashboard",
        env: existsSync(smokeFixturePath) ? { SSE_LEGACY_DB_PATH: smokeFixturePath } : {},
      };
    case "clean-start":
      return {
        expectedTarget: "commissioning",
        env: {
          SSE_DISABLE_AUTO_IMPORT: "1",
        },
      };
    default:
      throw new Error(`Unsupported packaged smoke scenario: ${name}`);
  }
}

function packageMacLocal() {
  if (process.platform !== "darwin") {
    throw new Error("native-package.mjs macOS packaging can only run on macOS.");
  }

  const sourceShellPath = resolveTauriShellPath("macos");
  const engineExecutablePath = resolveEngineExecutablePath();
  const outputRoot = path.join(rootDir, "release", "native", "macos");
  const packagedAppPath = path.join(outputRoot, "SSE ExEd Studio Control Native.app");
  const packagedMacOsDir = path.join(packagedAppPath, "Contents", "MacOS");
  const packagedResourcesDir = path.join(packagedAppPath, "Contents", "Resources");
  const packagedShellPath = path.join(packagedMacOsDir, "sse-exed-tauri-shell");
  const packagedEnginePath = path.join(packagedMacOsDir, "studio-control-engine");
  const packagedArchivePath = path.join(outputRoot, "SSE-ExEd-Studio-Control-Native-macOS.zip");

  assertExists(sourceShellPath, `Tauri shell executable not found at ${sourceShellPath}. Run \`npm run tauri:build\`.`);
  assertExists(
    engineExecutablePath,
    `Native engine executable not found at ${engineExecutablePath}. Run \`npm run native:engine:build\`.`
  );
  assertExists(smokeFixturePath, `Dashboard-ready smoke fixture not found at ${smokeFixturePath}.`);

  rmSync(outputRoot, { force: true, recursive: true });
  mkdirSync(packagedMacOsDir, { recursive: true });
  mkdirSync(packagedResourcesDir, { recursive: true });

  copyFileSync(sourceShellPath, packagedShellPath);
  copyFileSync(engineExecutablePath, packagedEnginePath);
  chmodSync(packagedShellPath, statSync(sourceShellPath).mode);
  chmodSync(packagedEnginePath, statSync(engineExecutablePath).mode);
  writeTauriMacInfoPlist(packagedAppPath);

  run("codesign", ["--force", "--deep", "--sign", "-", packagedAppPath]);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", packagedAppPath, packagedArchivePath]);

  console.log(`Packaged native macOS Tauri bundle: ${packagedAppPath}`);
  console.log(`Packaged native macOS archive: ${packagedArchivePath}`);

  return {
    label: "macOS",
    packagedShellPath,
    packagedEnginePath,
    runtime: releaseRuntime,
    smokeRuntimeDir: path.join(outputRoot, "smoke-runtime"),
    target: "macos",
  };
}

function packageWindowsLocal() {
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
  assertExists(smokeFixturePath, `Dashboard-ready smoke fixture not found at ${smokeFixturePath}.`);

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

function smokePackagedBundle(packaged, scenarioName) {
  const scenario = smokeScenarioConfig(scenarioName);
  rmSync(packaged.smokeRuntimeDir, { force: true, recursive: true });
  mkdirSync(packaged.smokeRuntimeDir, { recursive: true });
  const smokeStatusPath = path.join(packaged.smokeRuntimeDir, "smoke-status.json");

  const commandArgs = nativeReleaseSmokeArgs(packaged.target, packaged.runtime, smokeStatusPath);
  run(packaged.packagedShellPath, commandArgs, {
    captureOutput: true,
    env: {
      ...process.env,
      ...scenario.env,
      SSE_APP_DATA_DIR: path.join(packaged.smokeRuntimeDir, "app-data"),
      SSE_LOG_DIR: path.join(packaged.smokeRuntimeDir, "logs"),
    },
  });

  const smokeStatus = readSmokeStatus(smokeStatusPath);
  verifySmokeStatus(smokeStatus, scenario, packaged, smokeStatusPath);
  console.log(`Packaged native ${packaged.label} smoke passed for scenario '${scenarioName}'.`);
}

let packaged;

if (targetPlatform === "darwin") {
  packaged = packageMacLocal();
} else if (targetPlatform === "win32") {
  packaged = packageWindowsLocal();
} else {
  throw new Error("native-package.mjs currently supports macOS and Windows packaging only.");
}

console.log(`Native release packaging runtime: ${nativeReleaseRuntimeLabel(releaseRuntime)}.`);

if (smokeTest) {
  smokePackagedBundle(packaged, readFlag("--scenario") ?? "dashboard");
}
