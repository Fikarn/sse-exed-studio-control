import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, EngineHarness, resolvePathFromRoot } from "./native-runtime-harness.mjs";
import {
  acceptanceEngineEnv,
  assertAudioWorkflowParity,
  assertCoreParityContracts,
  assertLightingWorkflowParity,
  assertPlanningWorkflowParity,
  awaitConsoleLinkQuiet,
} from "./native-parity-acceptance.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const fixturePath = path.join(rootDir, "native", "rust-engine", "fixtures", "commissioning-sample-db.json");
  assert(existsSync(fixturePath), `Fixture missing: ${fixturePath}`);

  const explicitRoot = resolvePathFromRoot(rootDir, process.env.SSE_NATIVE_ACCEPTANCE_DIR);
  const acceptanceRoot = explicitRoot ?? mkdtempSync(path.join(os.tmpdir(), "sse-native-acceptance-"));
  rmSync(acceptanceRoot, { force: true, recursive: true });
  mkdirSync(acceptanceRoot, { recursive: true });

  const appDataDir = path.join(acceptanceRoot, "runtime");
  const logsDir = path.join(acceptanceRoot, "logs");

  console.log(`Native acceptance root: ${acceptanceRoot}`);
  console.log("Step 1: import legacy workstation data and export a native backup.");

  const firstRun = new EngineHarness({
    rootDir,
    appDataDir,
    logsDir,
    env: acceptanceEngineEnv({
      SSE_LEGACY_DB_PATH: fixturePath,
    }),
  });

  let backupPath;

  try {
    await firstRun.start();
    await assertSafeBundledSqlite(firstRun, "native-acceptance-installed", "Native acceptance engine");
    await assertCoreParityContracts(firstRun, "native-acceptance-installed", "Native acceptance engine");

    const initialAppSnapshot = await firstRun.request("app-snapshot-initial", "app.snapshot");
    const initialPlanningSnapshot = await firstRun.request("planning-snapshot-initial", "planning.snapshot");

    assert(
      initialAppSnapshot.startup?.targetSurface === "commissioning",
      `Expected imported workstation to start in commissioning, got '${initialAppSnapshot.startup?.targetSurface}'.`
    );
    assert(initialPlanningSnapshot.counts?.projectCount === 2, "Expected imported project count to be 2.");
    assert(initialPlanningSnapshot.counts?.taskCount === 3, "Expected imported task count to be 3.");

    const commissioningUpdate = await firstRun.request("commissioning-ready", "commissioning.update", {
      stage: "ready",
    });
    assert(
      commissioningUpdate.startup?.targetSurface === "dashboard",
      `Expected commissioning update to unlock dashboard, got '${commissioningUpdate.startup?.targetSurface}'.`
    );

    // The backup must carry the console's settled state, not a half-ingested one.
    await awaitConsoleLinkQuiet(firstRun, "native-acceptance-installed-audio-quiet");
    const exportSummary = await firstRun.request("support-backup-export", "support.backup.export");
    backupPath = exportSummary.path;
    assert(backupPath && existsSync(backupPath), "Expected native backup export to create an archive.");
  } finally {
    await firstRun.close().catch((error) => {
      throw error;
    });
  }

  console.log(
    "Step 2: restart the engine against the same runtime, verify planning workflow parity, and then verify rollback."
  );

  const secondRun = new EngineHarness({
    rootDir,
    appDataDir,
    logsDir,
    env: acceptanceEngineEnv({
      SSE_DISABLE_AUTO_IMPORT: "1",
    }),
  });

  try {
    await secondRun.start();
    await assertSafeBundledSqlite(secondRun, "native-acceptance-restarted", "Restarted native acceptance engine");

    const restartedAppSnapshot = await secondRun.request("app-snapshot-restart", "app.snapshot");
    const restartedPlanningSnapshot = await secondRun.request("planning-snapshot-restart", "planning.snapshot");

    assert(
      restartedAppSnapshot.startup?.targetSurface === "dashboard",
      `Expected restarted workstation to route to dashboard, got '${restartedAppSnapshot.startup?.targetSurface}'.`
    );
    assert(
      restartedAppSnapshot.commissioning?.stage === "ready",
      `Expected persisted commissioning stage to remain ready, got '${restartedAppSnapshot.commissioning?.stage}'.`
    );
    assert(restartedPlanningSnapshot.counts?.projectCount === 2, "Expected restarted project count to remain 2.");
    assert(restartedPlanningSnapshot.counts?.taskCount === 3, "Expected restarted task count to remain 3.");
    const restartedLightingSnapshot = await secondRun.request("lighting-snapshot-restart", "lighting.snapshot");
    const restartedAudioSnapshot = await awaitConsoleLinkQuiet(secondRun, "native-acceptance-restart-audio-quiet");

    const workflowMutations = await assertPlanningWorkflowParity(
      secondRun,
      "native-acceptance-restarted",
      "Restarted native acceptance engine"
    );
    const lightingMutations = await assertLightingWorkflowParity(
      secondRun,
      "native-acceptance-restarted",
      "Restarted native acceptance engine"
    );
    const audioMutations = await assertAudioWorkflowParity(
      secondRun,
      "native-acceptance-restarted",
      "Restarted native acceptance engine"
    );

    const mutatedPlanningSnapshot = await secondRun.request("planning-snapshot-mutated", "planning.snapshot");
    assert(
      mutatedPlanningSnapshot.counts?.projectCount === 4,
      `Expected planning workflow mutations to increase project count to 4, got ${mutatedPlanningSnapshot.counts?.projectCount}.`
    );
    assert(
      workflowMutations.temporaryProjectIds.every((projectId) =>
        mutatedPlanningSnapshot.projects?.some((project) => project.id === projectId)
      ),
      "Expected planning workflow mutations to leave temporary parity projects in the mutated snapshot."
    );

    const restoreSummary = await secondRun.request("support-backup-restore", "support.backup.restore", {
      path: backupPath,
    });
    assert(
      restoreSummary.sourceFormat === "native-support-backup",
      `Expected restore source format to be native-support-backup, got '${restoreSummary.sourceFormat}'.`
    );
    assert(
      restoreSummary.rollbackBackupPath && existsSync(restoreSummary.rollbackBackupPath),
      "Expected restore to generate a rollback archive."
    );

    const restoredPlanningSnapshot = await secondRun.request("planning-snapshot-restored", "planning.snapshot");
    const restoredLightingSnapshot = await secondRun.request("lighting-snapshot-restored", "lighting.snapshot");
    const restoredAudioSnapshot = await awaitConsoleLinkQuiet(secondRun, "native-acceptance-restored-audio-quiet");
    const restoredAppSnapshot = await secondRun.request("app-snapshot-restored", "app.snapshot");
    assert(restoredPlanningSnapshot.counts?.projectCount === 2, "Expected restore to roll project count back to 2.");
    assert(
      workflowMutations.temporaryProjectIds.every(
        (projectId) => !restoredPlanningSnapshot.projects?.some((project) => project.id === projectId)
      ),
      "Expected restore to remove the temporary planning parity projects."
    );
    assert(
      workflowMutations.temporaryTaskIds.every(
        (taskId) => !restoredPlanningSnapshot.tasks?.some((task) => task.id === taskId)
      ),
      "Expected restore to remove the temporary planning parity tasks."
    );
    assert(
      restoredLightingSnapshot.fixtures?.length === restartedLightingSnapshot.fixtures?.length,
      "Expected restore to return lighting fixture count to the restart baseline."
    );
    assert(
      restoredLightingSnapshot.groups?.length === restartedLightingSnapshot.groups?.length,
      "Expected restore to return lighting group count to the restart baseline."
    );
    assert(
      restoredLightingSnapshot.scenes?.length === restartedLightingSnapshot.scenes?.length,
      "Expected restore to return lighting scene count to the restart baseline."
    );
    assert(
      lightingMutations.temporaryFixtureIds.every(
        (fixtureId) => !restoredLightingSnapshot.fixtures?.some((fixture) => fixture.id === fixtureId)
      ),
      "Expected restore to remove the temporary lighting parity fixtures."
    );
    assert(
      lightingMutations.temporaryGroupIds.every(
        (groupId) => !restoredLightingSnapshot.groups?.some((group) => group.id === groupId)
      ),
      "Expected restore to remove the temporary lighting parity groups."
    );
    assert(
      lightingMutations.temporarySceneIds.every(
        (sceneId) => !restoredLightingSnapshot.scenes?.some((scene) => scene.id === sceneId)
      ),
      "Expected restore to remove the temporary lighting parity scenes."
    );
    assert(
      restoredAudioSnapshot.selectedChannelId === audioMutations.baselineSelectedChannelId &&
        restoredAudioSnapshot.selectedMixTargetId === audioMutations.baselineSelectedMixTargetId &&
        restoredAudioSnapshot.expectedPeakData === audioMutations.baselineExpectedPeakData &&
        restoredAudioSnapshot.expectedSubmixLock === audioMutations.baselineExpectedSubmixLock &&
        restoredAudioSnapshot.expectedCompatibilityMode === audioMutations.baselineExpectedCompatibilityMode,
      "Expected restore to return audio operator selection and transport expectations to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.lastConsoleSyncAt === audioMutations.baselineLastConsoleSyncAt &&
        restoredAudioSnapshot.lastConsoleSyncReason === audioMutations.baselineLastConsoleSyncReason &&
        restoredAudioSnapshot.lastRecalledSnapshotId === audioMutations.baselineLastRecalledSnapshotId &&
        restoredAudioSnapshot.lastSnapshotRecallAt === audioMutations.baselineLastSnapshotRecallAt &&
        restoredAudioSnapshot.consoleStateConfidence === audioMutations.baselineConsoleStateConfidence,
      "Expected restore to clear the temporary audio sync and recall markers and return console confidence to the restart baseline."
    );
    const { targets } = audioMutations;
    assert(
      restoredAudioSnapshot.channels?.some(
        (channel) =>
          channel.id === targets.frontChannelId &&
          channel.name === audioMutations.baselineFront.name &&
          channel.gain === audioMutations.baselineFront.gain &&
          channel.phantom === audioMutations.baselineFront.phantom &&
          channel.pad === audioMutations.baselineFront.pad &&
          channel.instrument === audioMutations.baselineFront.instrument &&
          channel.autoSet === audioMutations.baselineFront.autoSet &&
          channel.phase === audioMutations.baselineFront.phase
      ),
      "Expected restore to return the front-preamp controls to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.channels?.some(
        (channel) =>
          channel.id === targets.playbackChannelId &&
          channel.mute === audioMutations.baselinePlayback.mute &&
          channel.solo === audioMutations.baselinePlayback.solo &&
          channel.mixLevels?.[targets.playbackSendTargetId] ===
            audioMutations.baselinePlayback.mixLevels?.[targets.playbackSendTargetId]
      ),
      "Expected restore to return the playback send state to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.mixTargets?.some(
        (target) =>
          target.id === targets.mixTargetId &&
          target.volume === audioMutations.baselineMixTarget.volume &&
          target.dim === audioMutations.baselineMixTarget.dim &&
          target.mono === audioMutations.baselineMixTarget.mono &&
          target.talkback === audioMutations.baselineMixTarget.talkback
      ),
      "Expected restore to return the control-room mix state to the restart baseline."
    );
    assert(
      restoredAudioSnapshot.channels?.length === restartedAudioSnapshot.channels?.length &&
        restoredAudioSnapshot.mixTargets?.length === restartedAudioSnapshot.mixTargets?.length &&
        restoredAudioSnapshot.snapshots?.length === restartedAudioSnapshot.snapshots?.length,
      "Expected restore to preserve the baseline audio inventory counts."
    );
    assert(
      restoredAppSnapshot.startup?.targetSurface === "dashboard",
      `Expected restored workstation to remain on dashboard, got '${restoredAppSnapshot.startup?.targetSurface}'.`
    );
  } finally {
    await secondRun.close().catch((error) => {
      throw error;
    });
  }

  console.log("Native acceptance passed: import, restart, and rollback are deterministic.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
