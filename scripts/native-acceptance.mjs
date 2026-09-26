import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assert, EngineHarness, resolvePathFromRoot } from "./native-runtime-harness.mjs";
import {
  acceptanceEngineEnv,
  assertAudioWorkflowParity,
  assertBackupArchiveWithoutPlanning,
  assertContinuitySentinel,
  assertCoreParityContracts,
  assertLightingWorkflowParity,
  assertSavedWorkspace,
  awaitConsoleLinkQuiet,
  createContinuitySentinel,
  moveSavedWorkspace,
  publishWithOverride,
  SAVED_DATA_MARKER_CHANGED,
  SEEDED_WORKSPACE,
  seedSavedWorkspace,
} from "./native-parity-acceptance.mjs";
import { assertSafeBundledSqlite } from "./native-release-safety.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const explicitRoot = resolvePathFromRoot(rootDir, process.env.SSE_NATIVE_ACCEPTANCE_DIR);
  const acceptanceRoot = explicitRoot ?? mkdtempSync(path.join(os.tmpdir(), "sse-native-acceptance-"));
  rmSync(acceptanceRoot, { force: true, recursive: true });
  mkdirSync(acceptanceRoot, { recursive: true });

  const appDataDir = path.join(acceptanceRoot, "runtime");
  const logsDir = path.join(acceptanceRoot, "logs");

  console.log(`Native acceptance root: ${acceptanceRoot}`);
  console.log(SAVED_DATA_MARKER_CHANGED);
  console.log(
    "Step 1: start on fresh saved data, save the page it opens on, publish the setup and export a native backup."
  );

  const firstRun = new EngineHarness({
    rootDir,
    appDataDir,
    logsDir,
    env: await acceptanceEngineEnv(),
  });

  let backupPath;
  let sentinel;

  try {
    await firstRun.start();
    await assertSafeBundledSqlite(firstRun, "native-acceptance-installed", "Native acceptance engine");
    await assertCoreParityContracts(firstRun, "native-acceptance-installed", "Native acceptance engine");

    const initialAppSnapshot = await firstRun.request("app-snapshot-initial", "app.snapshot");

    assert(
      initialAppSnapshot.startup?.targetSurface === "commissioning",
      `Expected fresh saved data to start in commissioning, got '${initialAppSnapshot.startup?.targetSurface}'.`
    );
    // The page is seeded through the app's own request: new saved data opens
    // on the Console, and Lighting is saved instead.
    await seedSavedWorkspace(firstRun, "native-acceptance-installed", "Native acceptance engine");
    // The continuity sentinel the installer and delivery lanes use, made here
    // on the same fresh, unconfigured lighting, so the one lane CI runs on
    // every push proves it survives a restart and comes back with a restore.
    sentinel = await createContinuitySentinel(
      firstRun,
      "native-acceptance-installed",
      "Acceptance Continuity Sentinel",
      "Native acceptance engine"
    );

    // No hardware on this host: publish with the explicit probe override the
    // engine now requires (2026-09 audit Slice 8) instead of pretending the
    // probes ran.
    await publishWithOverride(firstRun, "native-acceptance-installed", "Native acceptance engine");

    // The backup must carry the console's settled state, not a half-ingested one.
    await awaitConsoleLinkQuiet(firstRun, "native-acceptance-installed-audio-quiet");
    const exportSummary = await firstRun.request("support-backup-export", "support.backup.export");
    backupPath = exportSummary.path;
    assert(backupPath && existsSync(backupPath), "Expected native backup export to create an archive.");
    assertBackupArchiveWithoutPlanning(exportSummary, SEEDED_WORKSPACE, "Native acceptance engine");
  } finally {
    await firstRun.close().catch((error) => {
      throw error;
    });
  }

  console.log(
    "Step 2: restart the engine against the same runtime, verify lighting and audio workflow parity, save another page, and then verify rollback."
  );

  const secondRun = new EngineHarness({
    rootDir,
    appDataDir,
    logsDir,
    env: await acceptanceEngineEnv(),
  });

  try {
    await secondRun.start();
    await assertSafeBundledSqlite(secondRun, "native-acceptance-restarted", "Restarted native acceptance engine");

    const restartedAppSnapshot = await secondRun.request("app-snapshot-restart", "app.snapshot");

    assert(
      restartedAppSnapshot.startup?.targetSurface === "dashboard",
      `Expected restarted workstation to route to dashboard, got '${restartedAppSnapshot.startup?.targetSurface}'.`
    );
    assert(
      restartedAppSnapshot.commissioning?.stage === "ready",
      `Expected persisted commissioning stage to remain ready, got '${restartedAppSnapshot.commissioning?.stage}'.`
    );
    assertSavedWorkspace(
      restartedAppSnapshot,
      SEEDED_WORKSPACE,
      "Restarted native acceptance engine",
      "after the restart"
    );
    await assertContinuitySentinel(
      secondRun,
      "native-acceptance-restarted",
      sentinel,
      "Restarted native acceptance engine",
      "after the restart"
    );
    const restartedLightingSnapshot = await secondRun.request("lighting-snapshot-restart", "lighting.snapshot");
    const restartedAudioSnapshot = await awaitConsoleLinkQuiet(secondRun, "native-acceptance-restart-audio-quiet");

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

    // The saved data the restore must roll back besides lighting and audio:
    // the page, saved after the backup was exported.
    await moveSavedWorkspace(secondRun, "native-acceptance-restarted", "Restarted native acceptance engine");

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
    assert(
      restoreSummary.detail === undefined,
      `Expected a format-5 archive to restore without leaving anything out, got: ${restoreSummary.detail}`
    );

    const restoredLightingSnapshot = await secondRun.request("lighting-snapshot-restored", "lighting.snapshot");
    const restoredAudioSnapshot = await awaitConsoleLinkQuiet(secondRun, "native-acceptance-restored-audio-quiet");
    const restoredAppSnapshot = await secondRun.request("app-snapshot-restored", "app.snapshot");
    assertSavedWorkspace(
      restoredAppSnapshot,
      SEEDED_WORKSPACE,
      "Restored native acceptance engine",
      "after the restore"
    );
    await assertContinuitySentinel(
      secondRun,
      "native-acceptance-restored",
      sentinel,
      "Restored native acceptance engine",
      "after the restore"
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

  console.log(
    "Native acceptance passed: seeding, restart, and rollback are deterministic (saved page, lighting and audio followed)."
  );
}

// Runs only as `node scripts/native-acceptance.mjs …`: an import does nothing
// (2026-09-26; the run starts engines on scratch app data and ends the process
// when it fails). The two paths are compared as real paths — through a
// directory junction or a short 8.3 name, `process.argv[1]` and
// `import.meta.url` spell the same file differently, and a plain comparison
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
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
