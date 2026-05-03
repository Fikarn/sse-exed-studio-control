import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, EngineHarness, resolvePathFromRoot } from "./native-runtime-harness.mjs";
import {
  assertAudioWorkflowParity,
  assertCoreParityContracts,
  assertLightingWorkflowParity,
  assertPlanningWorkflowParity,
} from "./native-parity-acceptance.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";
import {
  nativeReleaseRequiresOperatorUiReady,
  nativeReleaseShellExecutableName,
  nativeReleaseSmokeArgs,
  resolveNativeReleaseRuntime,
} from "./native-release-runtime.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = path.join(rootDir, "native", "rust-engine", "fixtures", "commissioning-sample-db.json");
const releaseRuntime = resolveNativeReleaseRuntime(rootDir);
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

  throw new Error(`Unsupported packaged acceptance target '${value}'. Use --target=macos or --target=windows.`);
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

function resolvePackagedRuntime(target) {
  const shellName = nativeReleaseShellExecutableName(target, releaseRuntime);
  if (target === "macos") {
    const payloadPath = path.join(rootDir, "release", "native", "macos", "SSE ExEd Studio Control Native.app");
    return {
      label: "macOS",
      shellPath: path.join(payloadPath, "Contents", "MacOS", shellName),
      enginePath: path.join(payloadPath, "Contents", "MacOS", "studio-control-engine"),
      commandArgs: (statusPath) => nativeReleaseSmokeArgs(target, releaseRuntime, statusPath),
      requiresOperatorUiReady: nativeReleaseRequiresOperatorUiReady(releaseRuntime),
    };
  }

  const payloadPath = path.join(rootDir, "release", "native", "windows", "SSE ExEd Studio Control Native");
  return {
    label: "Windows",
    shellPath: path.join(payloadPath, shellName),
    enginePath: path.join(payloadPath, "studio-control-engine.exe"),
    commandArgs: (statusPath) => nativeReleaseSmokeArgs(target, releaseRuntime, statusPath),
    requiresOperatorUiReady: nativeReleaseRequiresOperatorUiReady(releaseRuntime),
  };
}

function runPackagedSmoke(packaged, acceptanceRoot, runtime, stepName, expectedTarget, env = {}) {
  const stepRoot = path.join(acceptanceRoot, stepName);
  const smokeStatusPath = path.join(stepRoot, "smoke-status.json");

  rmSync(stepRoot, { force: true, recursive: true });
  mkdirSync(stepRoot, { recursive: true });

  const result = spawnSync(packaged.shellPath, packaged.commandArgs(smokeStatusPath), {
    cwd: rootDir,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
      SSE_APP_DATA_DIR: runtime.appDataDir,
      SSE_LOG_DIR: runtime.logsDir,
    },
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
    throw new Error(`Packaged native ${packaged.label} acceptance step '${stepName}' exited with code ${exitCode}.`);
  }

  const smokeStatus = readSmokeStatus(smokeStatusPath);
  if (!smokeStatus) {
    throw new Error(
      `Packaged native ${packaged.label} acceptance step '${stepName}' did not write ${smokeStatusPath}.`
    );
  }

  assert(smokeStatus.finished, `Packaged ${packaged.label} acceptance step '${stepName}' did not finish cleanly.`);
  assert(
    smokeStatus.exitCode === 0,
    `Packaged ${packaged.label} acceptance step '${stepName}' recorded exit code ${smokeStatus.exitCode}.`
  );
  assert(
    smokeStatus.targetSurface === expectedTarget,
    `Packaged ${packaged.label} acceptance step '${stepName}' reached '${smokeStatus.targetSurface}' instead of '${expectedTarget}'.`
  );
  if (packaged.requiresOperatorUiReady) {
    assert(
      smokeStatus.operatorUiReady,
      `Packaged ${packaged.label} acceptance step '${stepName}' never reported the operator UI as ready.`
    );
  }
  assert(
    normalizeForOutputComparison(smokeStatus.startedEnginePath ?? "") ===
      normalizeForOutputComparison(packaged.enginePath),
    `Packaged ${packaged.label} acceptance step '${stepName}' launched '${smokeStatus.startedEnginePath}' instead of '${packaged.enginePath}'.`
  );
  assert(
    normalizeForOutputComparison(smokeStatus.appDataPath ?? "") === normalizeForOutputComparison(runtime.appDataDir),
    `Packaged ${packaged.label} acceptance step '${stepName}' used app data '${smokeStatus.appDataPath}' instead of '${runtime.appDataDir}'.`
  );
}

async function main() {
  const target = parseTarget(readFlag("--target"));
  const expectedPlatform = target === "macos" ? "darwin" : "win32";
  if (process.platform !== expectedPlatform) {
    throw new Error(`native-packaged-acceptance.mjs target '${target}' must run on a matching host platform.`);
  }

  assert(existsSync(fixturePath), `Fixture missing: ${fixturePath}`);

  const packaged = resolvePackagedRuntime(target);
  assert(
    existsSync(packaged.shellPath),
    `Packaged native ${packaged.label} shell not found at ${packaged.shellPath}. Run the matching package smoke command first.`
  );
  assert(
    existsSync(packaged.enginePath),
    `Packaged native ${packaged.label} engine not found at ${packaged.enginePath}. Run the matching package smoke command first.`
  );

  const explicitRoot = resolvePathFromRoot(rootDir, process.env.SSE_NATIVE_PACKAGED_ACCEPTANCE_DIR);
  const acceptanceRoot = explicitRoot ?? mkdtempSync(path.join(os.tmpdir(), "sse-native-packaged-acceptance-"));
  rmSync(acceptanceRoot, { force: true, recursive: true });
  mkdirSync(acceptanceRoot, { recursive: true });

  const runtime = {
    appDataDir: path.join(acceptanceRoot, "runtime", "app-data"),
    logsDir: path.join(acceptanceRoot, "runtime", "logs"),
  };
  mkdirSync(runtime.appDataDir, { recursive: true });
  mkdirSync(runtime.logsDir, { recursive: true });

  console.log(`Packaged native acceptance root: ${acceptanceRoot}`);
  console.log("Step 1: import legacy workstation data through the packaged shell.");
  runPackagedSmoke(packaged, acceptanceRoot, runtime, "import", "commissioning", {
    SSE_LEGACY_DB_PATH: fixturePath,
  });

  console.log("Step 2: verify imported state and export a backup through the packaged engine.");
  const firstRun = new EngineHarness({
    rootDir,
    appDataDir: runtime.appDataDir,
    logsDir: runtime.logsDir,
    engineExecutable: packaged.enginePath,
    env: {
      SSE_DISABLE_AUTO_IMPORT: "1",
    },
  });

  let backupPath;

  try {
    await firstRun.start();
    await assertSafeBundledSqlite(firstRun, "packaged-installed", `Packaged native ${packaged.label} engine`);
    await assertCoreParityContracts(firstRun, "packaged-installed", `Packaged native ${packaged.label} engine`);

    const initialAppSnapshot = await firstRun.request("packaged-app-snapshot-initial", "app.snapshot");
    const initialPlanningSnapshot = await firstRun.request("packaged-planning-snapshot-initial", "planning.snapshot");

    assert(
      initialAppSnapshot.startup?.targetSurface === "commissioning",
      `Expected packaged import to start in commissioning, got '${initialAppSnapshot.startup?.targetSurface}'.`
    );
    assert(initialPlanningSnapshot.counts?.projectCount === 2, "Expected packaged import project count to be 2.");
    assert(initialPlanningSnapshot.counts?.taskCount === 3, "Expected packaged import task count to be 3.");

    const commissioningUpdate = await firstRun.request("packaged-commissioning-ready", "commissioning.update", {
      stage: "ready",
    });
    assert(
      commissioningUpdate.startup?.targetSurface === "dashboard",
      `Expected packaged commissioning update to unlock dashboard, got '${commissioningUpdate.startup?.targetSurface}'.`
    );

    const exportSummary = await firstRun.request("packaged-support-backup-export", "support.backup.export");
    backupPath = exportSummary.path;
    assert(backupPath && existsSync(backupPath), "Expected packaged backup export to create an archive.");
  } finally {
    await firstRun.close().catch((error) => {
      throw error;
    });
  }

  console.log("Step 3: relaunch the packaged shell against the same app-data directory.");
  runPackagedSmoke(packaged, acceptanceRoot, runtime, "restart", "dashboard", {
    SSE_DISABLE_AUTO_IMPORT: "1",
  });

  console.log(
    "Step 4: verify planning workflow parity, restore the backup, and verify rollback through the packaged engine."
  );
  const secondRun = new EngineHarness({
    rootDir,
    appDataDir: runtime.appDataDir,
    logsDir: runtime.logsDir,
    engineExecutable: packaged.enginePath,
    env: {
      SSE_DISABLE_AUTO_IMPORT: "1",
    },
  });

  try {
    await secondRun.start();
    await assertSafeBundledSqlite(secondRun, "packaged-restarted", `Packaged native ${packaged.label} engine`);

    const restartedAppSnapshot = await secondRun.request("packaged-app-snapshot-restart", "app.snapshot");
    const restartedPlanningSnapshot = await secondRun.request(
      "packaged-planning-snapshot-restart",
      "planning.snapshot"
    );

    assert(
      restartedAppSnapshot.startup?.targetSurface === "dashboard",
      `Expected packaged restart to route to dashboard, got '${restartedAppSnapshot.startup?.targetSurface}'.`
    );
    assert(
      restartedAppSnapshot.commissioning?.stage === "ready",
      `Expected packaged commissioning stage to remain ready, got '${restartedAppSnapshot.commissioning?.stage}'.`
    );
    assert(
      restartedPlanningSnapshot.counts?.projectCount === 2,
      "Expected packaged restart project count to remain 2."
    );
    assert(restartedPlanningSnapshot.counts?.taskCount === 3, "Expected packaged restart task count to remain 3.");
    const restartedLightingSnapshot = await secondRun.request(
      "packaged-lighting-snapshot-restart",
      "lighting.snapshot"
    );
    const restartedAudioSnapshot = await secondRun.request("packaged-audio-snapshot-restart", "audio.snapshot");

    const workflowMutations = await assertPlanningWorkflowParity(
      secondRun,
      "packaged-restarted",
      `Packaged native ${packaged.label} engine`
    );
    const lightingMutations = await assertLightingWorkflowParity(
      secondRun,
      "packaged-restarted",
      `Packaged native ${packaged.label} engine`
    );
    const audioMutations = await assertAudioWorkflowParity(
      secondRun,
      "packaged-restarted",
      `Packaged native ${packaged.label} engine`
    );

    const mutatedPlanningSnapshot = await secondRun.request("packaged-planning-snapshot-mutated", "planning.snapshot");
    assert(
      mutatedPlanningSnapshot.counts?.projectCount === 4,
      `Expected packaged planning workflow mutations to increase project count to 4, got ${mutatedPlanningSnapshot.counts?.projectCount}.`
    );
    assert(
      workflowMutations.temporaryProjectIds.every((projectId) =>
        mutatedPlanningSnapshot.projects?.some((project) => project.id === projectId)
      ),
      "Expected packaged planning workflow mutations to leave temporary parity projects in the mutated snapshot."
    );

    const restoreSummary = await secondRun.request("packaged-support-backup-restore", "support.backup.restore", {
      path: backupPath,
    });
    assert(
      restoreSummary.sourceFormat === "native-support-backup",
      `Expected packaged restore source format to be native-support-backup, got '${restoreSummary.sourceFormat}'.`
    );
    assert(
      restoreSummary.rollbackBackupPath && existsSync(restoreSummary.rollbackBackupPath),
      "Expected packaged restore to generate a rollback archive."
    );

    const restoredPlanningSnapshot = await secondRun.request(
      "packaged-planning-snapshot-restored",
      "planning.snapshot"
    );
    const restoredLightingSnapshot = await secondRun.request(
      "packaged-lighting-snapshot-restored",
      "lighting.snapshot"
    );
    const restoredAudioSnapshot = await secondRun.request("packaged-audio-snapshot-restored", "audio.snapshot");
    const restoredAppSnapshot = await secondRun.request("packaged-app-snapshot-restored", "app.snapshot");

    assert(
      restoredPlanningSnapshot.counts?.projectCount === 2,
      "Expected packaged restore to roll project count back to 2."
    );
    assert(
      workflowMutations.temporaryProjectIds.every(
        (projectId) => !restoredPlanningSnapshot.projects?.some((project) => project.id === projectId)
      ),
      "Expected packaged restore to remove the temporary planning parity projects."
    );
    assert(
      workflowMutations.temporaryTaskIds.every(
        (taskId) => !restoredPlanningSnapshot.tasks?.some((task) => task.id === taskId)
      ),
      "Expected packaged restore to remove the temporary planning parity tasks."
    );
    assert(
      restoredLightingSnapshot.fixtures?.length === restartedLightingSnapshot.fixtures?.length,
      "Expected packaged restore to return lighting fixture count to the restart baseline."
    );
    assert(
      restoredLightingSnapshot.groups?.length === restartedLightingSnapshot.groups?.length,
      "Expected packaged restore to return lighting group count to the restart baseline."
    );
    assert(
      restoredLightingSnapshot.scenes?.length === restartedLightingSnapshot.scenes?.length,
      "Expected packaged restore to return lighting scene count to the restart baseline."
    );
    assert(
      lightingMutations.temporaryFixtureIds.every(
        (fixtureId) => !restoredLightingSnapshot.fixtures?.some((fixture) => fixture.id === fixtureId)
      ),
      "Expected packaged restore to remove the temporary lighting parity fixtures."
    );
    assert(
      lightingMutations.temporaryGroupIds.every(
        (groupId) => !restoredLightingSnapshot.groups?.some((group) => group.id === groupId)
      ),
      "Expected packaged restore to remove the temporary lighting parity groups."
    );
    assert(
      lightingMutations.temporarySceneIds.every(
        (sceneId) => !restoredLightingSnapshot.scenes?.some((scene) => scene.id === sceneId)
      ),
      "Expected packaged restore to remove the temporary lighting parity scenes."
    );
    assert(
      restoredAudioSnapshot.selectedChannelId === audioMutations.baselineSelectedChannelId &&
        restoredAudioSnapshot.selectedMixTargetId === audioMutations.baselineSelectedMixTargetId &&
        restoredAudioSnapshot.expectedPeakData === audioMutations.baselineExpectedPeakData &&
        restoredAudioSnapshot.expectedSubmixLock === audioMutations.baselineExpectedSubmixLock &&
        restoredAudioSnapshot.expectedCompatibilityMode === audioMutations.baselineExpectedCompatibilityMode,
      "Expected packaged restore to return audio operator selection and transport expectations to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.lastConsoleSyncAt === audioMutations.baselineLastConsoleSyncAt &&
        restoredAudioSnapshot.lastConsoleSyncReason === audioMutations.baselineLastConsoleSyncReason &&
        restoredAudioSnapshot.lastRecalledSnapshotId === audioMutations.baselineLastRecalledSnapshotId &&
        restoredAudioSnapshot.lastSnapshotRecallAt === audioMutations.baselineLastSnapshotRecallAt &&
        restoredAudioSnapshot.consoleStateConfidence === audioMutations.baselineConsoleStateConfidence,
      "Expected packaged restore to clear the temporary audio sync and recall markers and return console confidence to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.channels?.some(
        (channel) =>
          channel.id === "audio-input-12" &&
          channel.gain === audioMutations.baselineFront.gain &&
          channel.phantom === audioMutations.baselineFront.phantom &&
          channel.pad === audioMutations.baselineFront.pad &&
          channel.instrument === audioMutations.baselineFront.instrument &&
          channel.autoSet === audioMutations.baselineFront.autoSet &&
          channel.phase === audioMutations.baselineFront.phase
      ),
      "Expected packaged restore to return the front-preamp controls to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.channels?.some(
        (channel) =>
          channel.id === "audio-playback-1-2" &&
          channel.mute === audioMutations.baselinePlayback.mute &&
          channel.solo === audioMutations.baselinePlayback.solo &&
          channel.mixLevels?.["audio-mix-phones-a"] ===
            audioMutations.baselinePlayback.mixLevels?.["audio-mix-phones-a"]
      ),
      "Expected packaged restore to return the playback send state to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.mixTargets?.some(
        (target) =>
          target.id === "audio-mix-main" &&
          target.volume === audioMutations.baselineMainMix.volume &&
          target.dim === audioMutations.baselineMainMix.dim &&
          target.mono === audioMutations.baselineMainMix.mono &&
          target.talkback === audioMutations.baselineMainMix.talkback
      ),
      "Expected packaged restore to return the control-room mix state to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.channels?.length === restartedAudioSnapshot.channels?.length &&
        restoredAudioSnapshot.mixTargets?.length === restartedAudioSnapshot.mixTargets?.length &&
        restoredAudioSnapshot.snapshots?.length === restartedAudioSnapshot.snapshots?.length,
      "Expected packaged restore to preserve the baseline audio inventory counts."
    );
    assert(
      restoredAppSnapshot.startup?.targetSurface === "dashboard",
      `Expected packaged restore to remain on dashboard, got '${restoredAppSnapshot.startup?.targetSurface}'.`
    );
  } finally {
    await secondRun.close().catch((error) => {
      throw error;
    });
  }

  console.log("Step 5: relaunch the packaged shell after restore against preserved app data.");
  runPackagedSmoke(packaged, acceptanceRoot, runtime, "post-restore", "dashboard", {
    SSE_DISABLE_AUTO_IMPORT: "1",
  });

  console.log("Packaged native acceptance passed: import, restart, restore, and relaunch are deterministic.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
