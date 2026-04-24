import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));
const args = process.argv.slice(2);
const smokeTest = args.includes("--smoke-test");
const keepSmokeRuntime = process.env.SSE_TAURI_KEEP_SMOKE_RUNTIME === "1";
const dashboardFixturePath = path.join(rootDir, "native", "rust-engine", "fixtures", "dashboard-ready-db.json");

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = args.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function parseTarget(value) {
  if (value === "macos" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported Tauri candidate target '${value}'. Use --target=macos or --target=windows.`);
}

function readSmokeScenarios() {
  const explicitScenario = readFlag("--scenario");
  if (explicitScenario) {
    return [explicitScenario];
  }

  const explicitScenarios = readFlag("--smoke-scenarios");
  if (explicitScenarios) {
    return explicitScenarios
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return ["clean-start"];
}

function expectedPlatform(target) {
  return target === "macos" ? "darwin" : "win32";
}

function assertExists(targetPath, message) {
  if (!existsSync(targetPath)) {
    throw new Error(message);
  }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if ((result.status ?? 1) !== 0) {
    throw new Error(`${command} ${commandArgs.join(" ")} failed with exit code ${result.status ?? 1}.`);
  }
}

function resolveGitSha() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  return result.status === 0 ? result.stdout.trim() : null;
}

function resolveTauriShellPath(target) {
  const executableName = target === "windows" ? "sse-exed-tauri-shell.exe" : "sse-exed-tauri-shell";
  return path.join(rootDir, "native", "tauri-shell", "target", "release", executableName);
}

function resolveEnginePath(target) {
  const executableName = target === "windows" ? "studio-control-engine.exe" : "studio-control-engine";
  const candidates = [
    path.join(rootDir, "native", "rust-engine", "target", "debug", executableName),
    path.join(rootDir, "native", "rust-engine", "target", "release", executableName),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

function writeMacInfoPlist(appPath) {
  const contentsPath = path.join(appPath, "Contents");
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
  <string>com.sse.exedstudiocontrol.replatform</string>
  <key>CFBundleName</key>
  <string>SSE ExEd Studio Control</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")).version}</string>
  <key>CFBundleVersion</key>
  <string>${JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8")).version}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;
  writeFileSync(path.join(contentsPath, "Info.plist"), plist, "utf8");
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

function packageMacCandidate() {
  if (process.platform !== "darwin") {
    throw new Error("Tauri macOS candidate packaging must run on macOS.");
  }

  const sourceShellPath = resolveTauriShellPath("macos");
  const sourceEnginePath = resolveEnginePath("macos");
  const outputRoot = path.join(rootDir, "release", "tauri-candidate", "macos");
  const packagedAppPath = path.join(outputRoot, releaseIdentity.payloadNames.macos);
  const packagedMacOsDir = path.join(packagedAppPath, "Contents", "MacOS");
  const packagedResourcesDir = path.join(packagedAppPath, "Contents", "Resources");
  const packagedShellPath = path.join(packagedMacOsDir, "sse-exed-tauri-shell");
  const packagedEnginePath = path.join(packagedMacOsDir, "studio-control-engine");
  const archivePath = path.join(outputRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-macOS.zip");

  assertExists(sourceShellPath, `Tauri shell executable not found at ${sourceShellPath}. Run \`npm run tauri:build\`.`);
  assertExists(
    sourceEnginePath,
    `Rust engine executable not found at ${sourceEnginePath}. Run \`npm run native:engine:build\`.`
  );

  rmSync(outputRoot, { force: true, recursive: true });
  mkdirSync(packagedMacOsDir, { recursive: true });
  mkdirSync(packagedResourcesDir, { recursive: true });

  copyFileSync(sourceShellPath, packagedShellPath);
  copyFileSync(sourceEnginePath, packagedEnginePath);
  chmodSync(packagedShellPath, statSync(sourceShellPath).mode);
  chmodSync(packagedEnginePath, statSync(sourceEnginePath).mode);
  writeMacInfoPlist(packagedAppPath);

  run("codesign", ["--force", "--deep", "--sign", "-", packagedAppPath]);
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", packagedAppPath, archivePath]);

  return {
    archivePath,
    label: "macOS",
    outputRoot,
    packagedEnginePath,
    packagedPayloadPath: packagedAppPath,
    packagedShellPath,
    target: "macos",
  };
}

function packageWindowsCandidate() {
  if (process.platform !== "win32") {
    throw new Error("Tauri Windows candidate packaging must run on Windows.");
  }

  const sourceShellPath = resolveTauriShellPath("windows");
  const sourceEnginePath = resolveEnginePath("windows");
  const outputRoot = path.join(rootDir, "release", "tauri-candidate", "windows");
  const packagedDirPath = path.join(outputRoot, releaseIdentity.payloadNames.windows);
  const packagedShellPath = path.join(packagedDirPath, "sse-exed-tauri-shell.exe");
  const packagedEnginePath = path.join(packagedDirPath, "studio-control-engine.exe");
  const archivePath = path.join(outputRoot, "SSE-ExEd-Studio-Control-Tauri-Candidate-windows.zip");

  assertExists(sourceShellPath, `Tauri shell executable not found at ${sourceShellPath}. Run \`npm run tauri:build\`.`);
  assertExists(
    sourceEnginePath,
    `Rust engine executable not found at ${sourceEnginePath}. Run \`npm run native:engine:build\`.`
  );

  rmSync(outputRoot, { force: true, recursive: true });
  mkdirSync(packagedDirPath, { recursive: true });

  copyFileSync(sourceShellPath, packagedShellPath);
  copyFileSync(sourceEnginePath, packagedEnginePath);
  chmodSync(packagedShellPath, statSync(sourceShellPath).mode);
  chmodSync(packagedEnginePath, statSync(sourceEnginePath).mode);
  archiveWindowsDirectory(packagedDirPath, archivePath);

  return {
    archivePath,
    label: "Windows",
    outputRoot,
    packagedEnginePath,
    packagedPayloadPath: packagedDirPath,
    packagedShellPath,
    target: "windows",
  };
}

function writeCandidateManifest(packaged) {
  const manifestPath = path.join(packaged.outputRoot, "candidate-manifest.json");
  const manifest = {
    archivePath: packaged.archivePath,
    createdAt: new Date().toISOString(),
    gitSha: resolveGitSha(),
    packageId: releaseIdentity.packageId,
    packagedEnginePath: packaged.packagedEnginePath,
    packagedPayloadPath: packaged.packagedPayloadPath,
    packagedShellPath: packaged.packagedShellPath,
    payloadName: releaseIdentity.payloadNames[packaged.target],
    runtime: "tauri",
    target: packaged.target,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

function normalizeForComparison(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function readJson(pathname) {
  if (!existsSync(pathname)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(pathname, "utf8"));
  } catch {
    return null;
  }
}

function createSmokeRuntime() {
  const root = mkdtempSync(path.join(tmpdir(), "sse-tauri-packaged-candidate-"));
  return {
    appDataDir: path.join(root, "app-data"),
    cleanup() {
      rmSync(root, { force: true, recursive: true });
    },
    logsDir: path.join(root, "logs"),
    root,
    statusPath: path.join(root, "smoke-status.json"),
    updateRepoDir: path.join(root, "update-repository"),
  };
}

function smokeScenarioConfig(name) {
  switch (name) {
    case "dashboard":
      assertExists(dashboardFixturePath, `Dashboard-ready smoke fixture not found at ${dashboardFixturePath}.`);
      return {
        env: {
          SSE_LEGACY_DB_PATH: dashboardFixturePath,
        },
        expectedTargetSurface: "dashboard",
      };
    case "clean-start":
      return {
        env: {
          SSE_DISABLE_AUTO_IMPORT: "1",
        },
        expectedTargetSurface: "commissioning",
      };
    default:
      throw new Error(`Unsupported Tauri packaged candidate smoke scenario '${name}'.`);
  }
}

function smokePackagedCandidate(packaged, scenarioName) {
  const runtime = createSmokeRuntime();
  const scenario = smokeScenarioConfig(scenarioName);
  mkdirSync(runtime.appDataDir, { recursive: true });
  mkdirSync(runtime.logsDir, { recursive: true });
  mkdirSync(runtime.updateRepoDir, { recursive: true });
  console.log(`Packaged Tauri smoke runtime: ${runtime.root}`);

  const result = spawnSync(packaged.packagedShellPath, ["--smoke-test", `--smoke-status-path=${runtime.statusPath}`], {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...scenario.env,
      SSE_APP_DATA_DIR: runtime.appDataDir,
      SSE_LOG_DIR: runtime.logsDir,
      SSE_UPDATE_REPOSITORY_PATH: runtime.updateRepoDir,
    },
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw result.error;
  }

  const status = readJson(runtime.statusPath);
  if (!status) {
    throw new Error(`Packaged Tauri smoke did not write ${runtime.statusPath}.`);
  }

  try {
    if ((result.status ?? 1) !== 0) {
      throw new Error(
        `Packaged Tauri ${packaged.label} smoke exited with code ${result.status ?? 1}: ${status.error ?? "unknown error"}`
      );
    }
    if (status.finished !== true || status.exitCode !== 0) {
      throw new Error(`Packaged Tauri ${packaged.label} smoke did not finish cleanly: ${JSON.stringify(status)}`);
    }
    if (status.targetSurface !== scenario.expectedTargetSurface) {
      throw new Error(
        `Packaged Tauri ${packaged.label} smoke reached target '${status.targetSurface}' instead of '${scenario.expectedTargetSurface}'.`
      );
    }
    if (normalizeForComparison(status.startedEnginePath) !== normalizeForComparison(packaged.packagedEnginePath)) {
      throw new Error(
        `Packaged Tauri ${packaged.label} smoke launched '${status.startedEnginePath}' instead of packaged engine '${packaged.packagedEnginePath}'.`
      );
    }

    console.log(
      `Packaged Tauri ${packaged.label} smoke passed for '${scenarioName}' using engine ${status.startedEnginePath}.`
    );
  } finally {
    if (keepSmokeRuntime) {
      console.log(`Preserved packaged Tauri smoke runtime: ${runtime.root}`);
    } else {
      runtime.cleanup();
    }
  }
}

const target = parseTarget(readFlag("--target"));

if (process.platform !== expectedPlatform(target)) {
  throw new Error(`Tauri candidate target '${target}' must run on a matching host platform.`);
}

const packaged = target === "macos" ? packageMacCandidate() : packageWindowsCandidate();
const manifestPath = writeCandidateManifest(packaged);

console.log(`Packaged Tauri ${packaged.label} candidate payload: ${packaged.packagedPayloadPath}`);
console.log(`Packaged Tauri ${packaged.label} candidate archive: ${packaged.archivePath}`);
console.log(`Tauri candidate manifest: ${manifestPath}`);

if (smokeTest) {
  for (const scenarioName of readSmokeScenarios()) {
    smokePackagedCandidate(packaged, scenarioName);
  }
}
