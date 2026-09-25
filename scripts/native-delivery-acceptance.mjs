import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertContinuitySentinel,
  assertSavedWorkspace,
  createContinuitySentinel,
  publishWithOverride,
  SAVED_DATA_MARKER_CHANGED,
  SEEDED_WORKSPACE,
  seedSavedWorkspace,
} from "./native-parity-acceptance.mjs";
import {
  assert,
  EngineHarness,
  hardenedLaneEnv,
  laneProcessEnv,
  resolvePathFromRoot,
} from "./native-runtime-harness.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";
import {
  nativeReleaseRequiresOperatorUiReady,
  nativeReleaseShellExecutableName,
  nativeReleaseSmokeArgs,
  resolveNativeReleaseRuntime,
} from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseIdentity = JSON.parse(readFileSync(path.join(rootDir, "scripts", "native-release-identity.json"), "utf8"));
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);
// New pages program, Slice 2: the sentinel is a lighting group; until then it
// was a Planning project (see createContinuitySentinel).
const sentinelGroupName = "Delivery Continuity Sentinel";
const qtFontAliasWarningPatterns = [
  /^qt\.qpa\.fonts: Populating font family aliases took .*missing font family "Sans Serif" with one that exists to avoid this cost\.\s*$/,
];

function readFlag(name) {
  const prefix = `${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
}

function parseTarget(value) {
  if (value === "macos" || value === "windows") {
    return value;
  }

  throw new Error(`Unsupported delivery acceptance target '${value}'. Use --target=macos or --target=windows.`);
}

function countSuppressedLines(text, patterns, writer) {
  if (!text) {
    return 0;
  }

  let suppressed = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(line))) {
      suppressed += 1;
      continue;
    }

    writer.write(`${line}\n`);
  }

  return suppressed;
}

function emitCapturedOutput(stdout, stderr, options = {}) {
  const patterns = options.patterns ?? [];
  const summaryLabel = options.summaryLabel ?? null;
  const suppressed =
    countSuppressedLines(stdout, patterns, process.stdout) + countSuppressedLines(stderr, patterns, process.stderr);

  if (suppressed > 0 && summaryLabel) {
    console.log(`Suppressed ${suppressed} known non-fatal ${summaryLabel} line${suppressed === 1 ? "" : "s"}.`);
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

function resolveStagedPayloadPath(target, channel) {
  const rootName = channel === "installer" ? "native-installer" : "native-updates";
  return path.join(
    rootDir,
    "release",
    rootName,
    target,
    "ifw",
    "packages",
    releaseIdentity.packageId,
    "data",
    releaseIdentity.payloadNames[target]
  );
}

function resolveInstalledRuntime(target, installedPayloadPath) {
  const shellName = nativeReleaseShellExecutableName(target, releaseRuntime);
  if (target === "macos") {
    return {
      label: "macOS",
      payloadPath: installedPayloadPath,
      shellPath: path.join(installedPayloadPath, "Contents", "MacOS", shellName),
      enginePath: path.join(installedPayloadPath, "Contents", "MacOS", "studio-control-engine"),
      commandArgs: (statusPath) => nativeReleaseSmokeArgs(target, releaseRuntime, statusPath),
      requiresOperatorUiReady: nativeReleaseRequiresOperatorUiReady(releaseRuntime),
    };
  }

  return {
    label: "Windows",
    payloadPath: installedPayloadPath,
    shellPath: path.join(installedPayloadPath, shellName),
    enginePath: path.join(installedPayloadPath, "studio-control-engine.exe"),
    commandArgs: (statusPath) => nativeReleaseSmokeArgs(target, releaseRuntime, statusPath),
    requiresOperatorUiReady: nativeReleaseRequiresOperatorUiReady(releaseRuntime),
  };
}

function installPayload(sourcePath, destinationPath) {
  rmSync(destinationPath, { force: true, recursive: true });
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, { recursive: true, verbatimSymlinks: true });
}

function runInstalledSmoke(installed, acceptanceRoot, runtime, stepName, expectedTarget, env = {}) {
  const stepRoot = path.join(acceptanceRoot, stepName);
  const smokeStatusPath = path.join(stepRoot, "smoke-status.json");

  rmSync(stepRoot, { force: true, recursive: true });
  mkdirSync(stepRoot, { recursive: true });

  const result = spawnSync(installed.shellPath, installed.commandArgs(smokeStatusPath), {
    cwd: rootDir,
    encoding: "utf8",
    env: laneProcessEnv(
      env,
      {
        SSE_APP_DATA_DIR: runtime.appDataDir,
        SSE_LOG_DIR: runtime.logsDir,
      },
      { label: `Installed ${installed.label} delivery step '${stepName}'` }
    ),
  });

  emitCapturedOutput(result.stdout, result.stderr, {
    patterns: qtFontAliasWarningPatterns,
    summaryLabel: "Qt font alias warning",
  });

  if (result.error) {
    throw result.error;
  }

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    throw new Error(`Installed ${installed.label} delivery step '${stepName}' exited with code ${exitCode}.`);
  }

  const smokeStatus = readSmokeStatus(smokeStatusPath);
  if (!smokeStatus) {
    throw new Error(`Installed ${installed.label} delivery step '${stepName}' did not write ${smokeStatusPath}.`);
  }

  assert(smokeStatus.finished, `Installed ${installed.label} delivery step '${stepName}' did not finish cleanly.`);
  assert(
    smokeStatus.exitCode === 0,
    `Installed ${installed.label} delivery step '${stepName}' recorded exit code ${smokeStatus.exitCode}.`
  );
  assert(
    smokeStatus.targetSurface === expectedTarget,
    `Installed ${installed.label} delivery step '${stepName}' reached '${smokeStatus.targetSurface}' instead of '${expectedTarget}'.`
  );
  if (installed.requiresOperatorUiReady) {
    assert(
      smokeStatus.operatorUiReady,
      `Installed ${installed.label} delivery step '${stepName}' never reported the operator UI as ready.`
    );
  }
  assert(
    normalizeForOutputComparison(smokeStatus.startedEnginePath ?? "") ===
      normalizeForOutputComparison(installed.enginePath),
    `Installed ${installed.label} delivery step '${stepName}' launched '${smokeStatus.startedEnginePath}' instead of '${installed.enginePath}'.`
  );
  assert(
    normalizeForOutputComparison(smokeStatus.appDataPath ?? "") === normalizeForOutputComparison(runtime.appDataDir),
    `Installed ${installed.label} delivery step '${stepName}' used app data '${smokeStatus.appDataPath}' instead of '${runtime.appDataDir}'.`
  );
}

async function main() {
  const target = parseTarget(readFlag("--target"));
  const expectedPlatform = target === "macos" ? "darwin" : "win32";
  if (process.platform !== expectedPlatform) {
    throw new Error(`native-delivery-acceptance.mjs target '${target}' must run on a matching host platform.`);
  }

  const installerPayloadPath = resolveStagedPayloadPath(target, "installer");
  const updatePayloadPath = resolveStagedPayloadPath(target, "update");

  assert(
    existsSync(installerPayloadPath),
    `Installer staged payload missing at ${installerPayloadPath}. Run the matching installer prepare/local command first.`
  );
  assert(
    existsSync(updatePayloadPath),
    `Update staged payload missing at ${updatePayloadPath}. Run the matching update-repo prepare/local command first.`
  );

  const explicitRoot = resolvePathFromRoot(rootDir, process.env.SSE_NATIVE_DELIVERY_ACCEPTANCE_DIR);
  const acceptanceRoot = explicitRoot ?? mkdtempSync(path.join(os.tmpdir(), "sse-native-delivery-acceptance-"));
  rmSync(acceptanceRoot, { force: true, recursive: true });
  mkdirSync(acceptanceRoot, { recursive: true });

  const runtime = {
    appDataDir: path.join(acceptanceRoot, "runtime", "app-data"),
    logsDir: path.join(acceptanceRoot, "runtime", "logs"),
  };
  mkdirSync(runtime.appDataDir, { recursive: true });
  mkdirSync(runtime.logsDir, { recursive: true });

  const installedPayloadPath = path.join(acceptanceRoot, "installed", releaseIdentity.payloadNames[target]);

  console.log(`Native delivery acceptance root: ${acceptanceRoot}`);
  console.log(SAVED_DATA_MARKER_CHANGED);
  console.log("Step 1: install the staged offline-installer payload and start it on fresh saved data.");

  installPayload(installerPayloadPath, installedPayloadPath);
  let installed = resolveInstalledRuntime(target, installedPayloadPath);
  runInstalledSmoke(
    installed,
    acceptanceRoot,
    runtime,
    "install-first-launch",
    "commissioning",
    await hardenedLaneEnv()
  );

  console.log(
    "Step 2: save the page the app opens on, unlock dashboard and persist an operator sentinel (a lighting group) through the installed runtime."
  );

  let sentinel;

  const firstRun = new EngineHarness({
    rootDir,
    appDataDir: runtime.appDataDir,
    logsDir: runtime.logsDir,
    engineExecutable: installed.enginePath,
    env: await hardenedLaneEnv(),
  });

  try {
    await firstRun.start();
    await assertSafeBundledSqlite(firstRun, "delivery-installed", `Installed ${installed.label} engine`);

    const initialAppSnapshot = await firstRun.request("delivery-app-installed", "app.snapshot");

    assert(
      initialAppSnapshot.startup?.targetSurface === "commissioning",
      `Expected staged installer payload to start in commissioning, got '${initialAppSnapshot.startup?.targetSurface}'.`
    );
    // The page is seeded through the app's own request: new saved data opens
    // on the Console, and Lighting is saved instead.
    await seedSavedWorkspace(firstRun, "delivery-installed", `Installed ${installed.label} engine`);

    // No hardware on this host: the explicit probe override (2026-09 audit
    // Slice 8), without which a fresh hardware link refuses the publish.
    await publishWithOverride(firstRun, "delivery-installed", `Installed ${installed.label} engine`);

    sentinel = await createContinuitySentinel(
      firstRun,
      "delivery-installed",
      sentinelGroupName,
      `Installed ${installed.label} engine`
    );
    await assertContinuitySentinel(
      firstRun,
      "delivery-installed",
      sentinel,
      `Installed ${installed.label} engine`,
      "after the sentinel was created"
    );
  } finally {
    await firstRun.close().catch((error) => {
      throw error;
    });
  }

  console.log("Step 3: apply the staged maintenance-tool payload over the same install location.");

  installPayload(updatePayloadPath, installedPayloadPath);
  installed = resolveInstalledRuntime(target, installedPayloadPath);
  runInstalledSmoke(installed, acceptanceRoot, runtime, "update-relaunch", "dashboard", await hardenedLaneEnv());

  const secondRun = new EngineHarness({
    rootDir,
    appDataDir: runtime.appDataDir,
    logsDir: runtime.logsDir,
    engineExecutable: installed.enginePath,
    env: await hardenedLaneEnv(),
  });

  try {
    await secondRun.start();
    await assertSafeBundledSqlite(secondRun, "delivery-updated", `Updated ${installed.label} engine`);

    const updatedAppSnapshot = await secondRun.request("delivery-app-updated", "app.snapshot");

    assert(
      updatedAppSnapshot.startup?.targetSurface === "dashboard",
      `Expected staged update payload to remain on dashboard, got '${updatedAppSnapshot.startup?.targetSurface}'.`
    );
    assert(
      updatedAppSnapshot.commissioning?.stage === "ready",
      `Expected staged update payload commissioning stage to remain ready, got '${updatedAppSnapshot.commissioning?.stage}'.`
    );
    assertSavedWorkspace(updatedAppSnapshot, SEEDED_WORKSPACE, `Updated ${installed.label} engine`, "after the update");
    await assertContinuitySentinel(
      secondRun,
      "delivery-updated",
      sentinel,
      `Updated ${installed.label} engine`,
      "after the update"
    );
  } finally {
    await secondRun.close().catch((error) => {
      throw error;
    });
  }

  console.log("Step 4: reinstall from the staged offline-installer payload without wiping app data.");

  installPayload(installerPayloadPath, installedPayloadPath);
  installed = resolveInstalledRuntime(target, installedPayloadPath);
  runInstalledSmoke(installed, acceptanceRoot, runtime, "reinstall-relaunch", "dashboard", await hardenedLaneEnv());

  const thirdRun = new EngineHarness({
    rootDir,
    appDataDir: runtime.appDataDir,
    logsDir: runtime.logsDir,
    engineExecutable: installed.enginePath,
    env: await hardenedLaneEnv(),
  });

  try {
    await thirdRun.start();
    await assertSafeBundledSqlite(thirdRun, "delivery-reinstalled", `Reinstalled ${installed.label} engine`);

    const reinstalledAppSnapshot = await thirdRun.request("delivery-app-reinstalled", "app.snapshot");

    assert(
      reinstalledAppSnapshot.startup?.targetSurface === "dashboard",
      `Expected staged reinstall payload to remain on dashboard, got '${reinstalledAppSnapshot.startup?.targetSurface}'.`
    );
    assert(
      reinstalledAppSnapshot.commissioning?.stage === "ready",
      `Expected staged reinstall payload commissioning stage to remain ready, got '${reinstalledAppSnapshot.commissioning?.stage}'.`
    );
    assertSavedWorkspace(
      reinstalledAppSnapshot,
      SEEDED_WORKSPACE,
      `Reinstalled ${installed.label} engine`,
      "after the reinstall"
    );
    await assertContinuitySentinel(
      thirdRun,
      "delivery-reinstalled",
      sentinel,
      `Reinstalled ${installed.label} engine`,
      "after the reinstall"
    );

    const exportSummary = await thirdRun.request("delivery-support-backup-export", "support.backup.export");
    assert(
      exportSummary.path && existsSync(exportSummary.path),
      "Expected staged reinstall payload to export a backup."
    );
  } finally {
    await thirdRun.close().catch((error) => {
      throw error;
    });
  }

  console.log("Native delivery acceptance passed: staged install, update, and reinstall preserve operator data.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
