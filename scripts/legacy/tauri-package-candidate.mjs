import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { publishWithOverride } from "../native-parity-acceptance.mjs";
import { EngineHarness, hardenedLaneEnv, laneProcessEnv } from "../native-runtime-harness.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));
const args = process.argv.slice(2);
const keepSmokeRuntime = process.env.SSE_TAURI_KEEP_SMOKE_RUNTIME === "1";

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = args.find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function parseTarget(value) {
  if (value === "windows") {
    return value;
  }

  throw new Error(`Unsupported Tauri candidate target '${value}'. Use --target=windows.`);
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

function resolveTauriShellPath() {
  return path.join(rootDir, "native", "target", "release", "sse-exed-tauri-shell.exe");
}

function resolveEnginePath() {
  const executableName = "studio-control-engine.exe";
  const candidates = [
    path.join(rootDir, "native", "target", "debug", executableName),
    path.join(rootDir, "native", "target", "release", executableName),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
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

function packageWindowsCandidate() {
  if (process.platform !== "win32") {
    throw new Error("Tauri Windows candidate packaging must run on Windows.");
  }

  const sourceShellPath = resolveTauriShellPath();
  const sourceEnginePath = resolveEnginePath();
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
    await publishWithOverride(harness, "tauri-candidate-smoke-seed", `Packaged Tauri ${packaged.label} engine`);
  } finally {
    await harness.close();
  }
}

function smokeScenarioConfig(name) {
  switch (name) {
    case "dashboard":
      return {
        seed: seedPublishedSetup,
        expectedTargetSurface: "dashboard",
      };
    case "clean-start":
      return {
        seed: null,
        expectedTargetSurface: "commissioning",
      };
    default:
      throw new Error(`Unsupported Tauri packaged candidate smoke scenario '${name}'.`);
  }
}

async function smokePackagedCandidate(packaged, scenarioName) {
  const runtime = createSmokeRuntime();
  const scenario = smokeScenarioConfig(scenarioName);
  mkdirSync(runtime.appDataDir, { recursive: true });
  mkdirSync(runtime.logsDir, { recursive: true });
  mkdirSync(runtime.updateRepoDir, { recursive: true });
  console.log(`Packaged Tauri smoke runtime: ${runtime.root}`);

  if (scenario.seed) {
    await scenario.seed(packaged, runtime);
  }

  const result = spawnSync(packaged.packagedShellPath, ["--smoke-test", `--smoke-status-path=${runtime.statusPath}`], {
    cwd: rootDir,
    encoding: "utf8",
    env: laneProcessEnv(
      await hardenedLaneEnv(),
      {
        SSE_APP_DATA_DIR: runtime.appDataDir,
        SSE_LOG_DIR: runtime.logsDir,
        SSE_UPDATE_REPOSITORY_PATH: runtime.updateRepoDir,
      },
      { label: `Packaged Tauri ${packaged.label} smoke '${scenarioName}'` }
    ),
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

async function main() {
  const smokeTest = args.includes("--smoke-test");
  const target = parseTarget(readFlag("--target"));

  if (process.platform !== "win32") {
    throw new Error(`Tauri candidate target '${target}' must run on a matching host platform.`);
  }

  const packaged = packageWindowsCandidate();
  const manifestPath = writeCandidateManifest(packaged);

  console.log(`Packaged Tauri ${packaged.label} candidate payload: ${packaged.packagedPayloadPath}`);
  console.log(`Packaged Tauri ${packaged.label} candidate archive: ${packaged.archivePath}`);
  console.log(`Tauri candidate manifest: ${manifestPath}`);

  if (smokeTest) {
    for (const scenarioName of readSmokeScenarios()) {
      await smokePackagedCandidate(packaged, scenarioName);
    }
  }
}

// Runs only as `node scripts/legacy/tauri-package-candidate.mjs …`: an import
// does nothing (2026-09-26; the run deletes and rebuilds
// release/tauri-candidate/<target> and may start the packaged app). The two
// paths are compared as real paths — through a directory junction or a short
// 8.3 name, `process.argv[1]` and `import.meta.url` spell the same file
// differently, and a plain comparison would skip the run without a word
// (scripts/dev-check-cli.mjs).
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
