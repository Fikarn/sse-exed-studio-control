import { existsSync, readFileSync } from "node:fs";

import { assert, hardenedLaneEnv, LIVE_CONSOLE } from "./native-runtime-harness.mjs";

// "Parity" here means dev-engine vs packaged-engine parity: this module holds
// the shared contract assertions that `native-acceptance.mjs` (dev-built
// engine) and `native-packaged-acceptance.mjs` (packaged engine) both run, so
// the two runtime forms cannot drift apart. It is unrelated to the retired
// Electron parity oracle (removed in v2.1.0) — audited and deliberately kept
// under this name, 2026-08-12.

// 2026-09 audit remediation, Slice 2 — the acceptance lanes and the studio
// console. By default the harness runs the engine in simulated audio input
// mode, so `npm run native:acceptance` never writes to a real TotalMix: the
// audio probe passes honestly, sync / recall answer from the simulated
// console, and the assertions cover the full control vocabulary. Setting
// `SSE_NATIVE_ACCEPTANCE_LIVE_CONSOLE=1` on the workstation opts into the
// live lane: the engine binds the real Global OSC remote, the console link
// confirms every write by read-back, only surfaces the studio does not use
// are written (Phones 2, playback 7/8), and everything is restored in a
// `finally`. Before this the plain lane pushed test values to the live desk
// (main volume / dim / mono / talkback, preamp 12 gain + 48V, a solo on the
// main mix) and left them there. The opt-in is read in
// native-runtime-harness.mjs, which holds every lane's hardening (new pages
// program, Slice 2b).
export { LIVE_CONSOLE };

/**
 * Engine environment for an acceptance run: the lanes' hardening (a bridge
 * port of its own, the light outputs held), with the simulated console
 * unless live.
 */
export async function acceptanceEngineEnv(extra = {}) {
  return { ...(await hardenedLaneEnv({ simulatedAudio: !LIVE_CONSOLE })), ...extra };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolves with an `audio.snapshot` once the engine's console link has
 * settled: no pending sends and no new confirmations / adjustments / external
 * changes across two polls. Returns immediately when no live link is bound
 * (simulated console, OSC off). On the live lane it first gives the metering
 * thread a moment to bind the Global slot so the initial `/sendall` ingest is
 * not mistaken for silence.
 */
export async function awaitConsoleLinkQuiet(harness, requestIdPrefix, { timeoutMs = 10_000 } = {}) {
  const startedAt = Date.now();
  let previous = null;
  let poll = 0;
  for (;;) {
    const snapshot = await harness.request(`${requestIdPrefix}-${poll++}`, "audio.snapshot");
    const link = snapshot.consoleLink;
    const elapsed = Date.now() - startedAt;
    if (!link || link.slotBound !== true) {
      if (LIVE_CONSOLE && elapsed < 2_000) {
        await sleep(250);
        continue;
      }
      return snapshot;
    }
    const settled =
      previous !== null &&
      link.pendingSends === 0 &&
      link.externalChanges === previous.externalChanges &&
      link.confirmedSends === previous.confirmedSends &&
      link.adjustedSends === previous.adjustedSends;
    if (settled) {
      return snapshot;
    }
    if (elapsed > timeoutMs) {
      throw new Error(
        `Console link did not settle within ${timeoutMs} ms (pending ${link.pendingSends}, unconfirmed ${link.unconfirmedSends}).`
      );
    }
    previous = link;
    await sleep(400);
  }
}

// New pages program, Slice 2 (D5): the Stream Deck's pages follow the app's
// tabs, LIGHTS (page 1) then AUDIO (page 2); PROJECTS and TASKS left with
// Planning, and so did the Planning time report (`planning.report.time`)
// this contract check opened with until then.
export const DECK_PAGE_LABELS = ["LIGHTS", "AUDIO"];

// New pages program, Slices 2 and 2b: the saved data these lanes follow
// through a restart, an update or reinstall and a backup's restore is the page
// the app opens on (`shell.workspace`). Until Slice 2 it was the imported
// Planning projects and tasks, which schema 8 no longer holds; until Slice 2b
// the page came from a db.json fixture through the import, which is retired.
// Now a lane saves it through the app's own request on fresh saved data,
// which opens on the Console (D1), so the seeded page can be seen.
/** The page new saved data opens on (`DEFAULT_WORKSPACE`, shell_settings.rs). */
export const NEW_DATA_WORKSPACE = "audio";
/** The page a lane saves on fresh saved data (`seedSavedWorkspace`). */
export const SEEDED_WORKSPACE = "lighting";
/** The page a lane saves after the backup, which the restore must undo. */
export const MOVED_WORKSPACE = "audio";
export const SAVED_DATA_MARKER_CHANGED =
  "New pages program, Slices 2 and 2b: the saved data followed is the page the app opens on, saved as Lighting through settings.update on fresh saved data (which opens on the Console); until Slice 2b it was imported from a db.json fixture, and until Slice 2 it was the imported Planning projects and tasks.";

/** Backup archive format 5 (new pages program, Slice 2 — D3): no Planning part. */
export const SUPPORT_BACKUP_FORMAT_VERSION = 5;

export async function assertCoreParityContracts(harness, requestIdPrefix, runtimeLabel) {
  const controlSurfaceSnapshot = await harness.request(`${requestIdPrefix}-control-surface`, "controlSurface.snapshot");
  const pages = Array.isArray(controlSurfaceSnapshot.pages) ? controlSurfaceSnapshot.pages : [];
  const pageLabels = pages.map((page) => page?.label);
  assert(
    JSON.stringify(pageLabels) === JSON.stringify(DECK_PAGE_LABELS),
    `${runtimeLabel} controlSurface.snapshot must expose the deck pages ${DECK_PAGE_LABELS.join(" and ")} in that order, got ${JSON.stringify(pageLabels)}.`
  );
  for (const page of pages) {
    assert(
      Array.isArray(page.buttons) && page.buttons.length > 0 && Array.isArray(page.dials) && page.dials.length > 0,
      `${runtimeLabel} controlSurface.snapshot must expose ${page.label} buttons and dials.`
    );
  }
  const [lightsPage, audioPage] = pages;
  assert(
    lightsPage.buttons.some((control) => control.isPageNav === true && control.pageNavTarget === audioPage.label),
    `${runtimeLabel} controlSurface.snapshot: the LIGHTS page has no page key to the AUDIO page.`
  );

  const lightingDmxMonitor = await harness.request(
    `${requestIdPrefix}-lighting-dmx-monitor`,
    "lighting.dmxMonitor.snapshot"
  );
  assert(
    Array.isArray(lightingDmxMonitor.channels),
    `${runtimeLabel} lighting.dmxMonitor.snapshot is missing channels.`
  );

  if (lightingDmxMonitor.channels.length > 0) {
    const firstChannel = lightingDmxMonitor.channels[0];
    assert(
      typeof firstChannel.channel === "number" &&
        typeof firstChannel.value === "number" &&
        typeof firstChannel.lightName === "string" &&
        typeof firstChannel.label === "string",
      `${runtimeLabel} lighting.dmxMonitor.snapshot returned an invalid channel entry.`
    );
  }
}

/** Asserts the page an `app.snapshot` (or a `settings.update` reply) says the app opens on. */
export function assertSavedWorkspace(appSnapshot, expected, runtimeLabel, when) {
  assert(
    appSnapshot?.shell?.workspace === expected,
    `${runtimeLabel} ${when}: expected the saved page '${expected}', got '${appSnapshot?.shell?.workspace}'.`
  );
}

/**
 * Seeds the saved data a lane follows on fresh saved data: the app opens on
 * the Console, and `settings.update` saves Lighting instead (new pages
 * program, Slice 2b; until then the page came from a db.json fixture through
 * the import, which is retired).
 */
export async function seedSavedWorkspace(harness, requestIdPrefix, runtimeLabel) {
  const fresh = await harness.request(`${requestIdPrefix}-app-snapshot-fresh`, "app.snapshot");
  assertSavedWorkspace(fresh, NEW_DATA_WORKSPACE, runtimeLabel, "on fresh saved data");
  const seeded = await harness.request(`${requestIdPrefix}-shell-workspace-seeded`, "settings.update", {
    workspace: SEEDED_WORKSPACE,
  });
  assertSavedWorkspace(seeded, SEEDED_WORKSPACE, runtimeLabel, "after settings.update");
  return seeded;
}

/**
 * Publishes the setup on a host without the studio's hardware, the way the
 * qualification lanes publish: `commissioning.update` to `ready` with the
 * explicit probe override the hardware link requires while a probe has not
 * passed (2026-09 audit Slice 8). The installer and delivery lanes published
 * without it until Slice 2b of the new pages program, which a fresh hardware
 * link refuses (COMMISSIONING_PROBES_INCOMPLETE).
 */
export async function publishWithOverride(harness, requestIdPrefix, runtimeLabel) {
  const published = await harness.request(`${requestIdPrefix}-commissioning-ready`, "commissioning.update", {
    stage: "ready",
    overrideProbes: true,
  });
  assert(
    published.startup?.targetSurface === "dashboard",
    `${runtimeLabel}: expected the publish to unlock the dashboard, got '${published.startup?.targetSurface}'.`
  );
  return published;
}

/**
 * Saves another page after the backup was exported (`settings.update`), so
 * the restore has something of the saved data to roll back. Until Slice 2 of
 * the new pages program the lanes created Planning projects and tasks here.
 */
export async function moveSavedWorkspace(harness, requestIdPrefix, runtimeLabel) {
  const moved = await harness.request(`${requestIdPrefix}-shell-workspace-moved`, "settings.update", {
    workspace: MOVED_WORKSPACE,
  });
  assertSavedWorkspace(moved, MOVED_WORKSPACE, runtimeLabel, "after settings.update");
  return moved;
}

/**
 * The exported backup archive is format 5, carries no Planning part (D3) and
 * holds the saved page, which is what lets a restore roll the page back.
 */
export function assertBackupArchiveWithoutPlanning(exportSummary, expectedWorkspace, runtimeLabel) {
  assert(
    exportSummary?.path && existsSync(exportSummary.path),
    `${runtimeLabel} support.backup.export did not create an archive.`
  );
  assert(
    exportSummary.formatVersion === SUPPORT_BACKUP_FORMAT_VERSION,
    `${runtimeLabel} support.backup.export reported format ${exportSummary.formatVersion}, expected ${SUPPORT_BACKUP_FORMAT_VERSION}.`
  );
  const text = readFileSync(exportSummary.path, "utf8");
  const archive = JSON.parse(text);
  assert(
    archive.archiveType === "native-support-backup" && archive.formatVersion === SUPPORT_BACKUP_FORMAT_VERSION,
    `${runtimeLabel} backup archive is '${archive.archiveType}' format ${archive.formatVersion}, expected native-support-backup format ${SUPPORT_BACKUP_FORMAT_VERSION}.`
  );
  assert(
    !Object.hasOwn(archive, "planning") && !/"planning\./.test(text),
    `${runtimeLabel} backup archive still carries a Planning part or a planning.* setting.`
  );
  assert(
    archive.shell?.workspace === expectedWorkspace && archive.settings?.["shell.workspace"] === expectedWorkspace,
    `${runtimeLabel} backup archive does not hold the saved page '${expectedWorkspace}' (shell ${archive.shell?.workspace}, setting ${archive.settings?.["shell.workspace"]}).`
  );
}

/**
 * The installer and delivery lanes' continuity sentinel: a lighting group,
 * made by the app's own request and kept in the saved data. Until Slice 2 of
 * the new pages program it was a Planning project.
 */
export async function createContinuitySentinel(harness, requestIdPrefix, name, runtimeLabel) {
  const created = await harness.request(`${requestIdPrefix}-continuity-sentinel-create`, "lighting.group.create", {
    name,
  });
  assert(
    typeof created?.group?.id === "string" && created.group.name === name,
    `${runtimeLabel} lighting.group.create did not create the continuity sentinel '${name}'.`
  );
  return { id: created.group.id, name };
}

export async function assertContinuitySentinel(harness, requestIdPrefix, sentinel, runtimeLabel, when) {
  const lightingSnapshot = await harness.request(`${requestIdPrefix}-continuity-sentinel-check`, "lighting.snapshot");
  assert(
    (lightingSnapshot.groups ?? []).some((group) => group.id === sentinel.id && group.name === sentinel.name),
    `${runtimeLabel} ${when}: the continuity sentinel lighting group '${sentinel.name}' (${sentinel.id}) is missing.`
  );
}

function lightingFixtureById(snapshot, fixtureId) {
  return (snapshot.fixtures ?? []).find((fixture) => fixture.id === fixtureId) ?? null;
}

function lightingGroupById(snapshot, groupId) {
  return (snapshot.groups ?? []).find((group) => group.id === groupId) ?? null;
}

function lightingSceneById(snapshot, sceneId) {
  return (snapshot.scenes ?? []).find((scene) => scene.id === sceneId) ?? null;
}

function audioChannelById(snapshot, channelId) {
  return (snapshot.channels ?? []).find((channel) => channel.id === channelId) ?? null;
}

function audioMixTargetById(snapshot, mixTargetId) {
  return (snapshot.mixTargets ?? []).find((target) => target.id === mixTargetId) ?? null;
}

export async function assertLightingWorkflowParity(harness, requestIdPrefix, runtimeLabel) {
  const lightingProbe = await harness.request(`${requestIdPrefix}-lighting-probe`, "commissioning.check.run", {
    target: "lighting",
    bridgeIp: "127.0.0.1",
    universe: 1,
  });
  const lightingCheck = lightingProbe.checks?.find((check) => check.id === "lighting");
  assert(
    lightingCheck && typeof lightingCheck.status === "string" && typeof lightingCheck.message === "string",
    `${runtimeLabel} commissioning.check.run did not return a valid lighting bridge probe record.`
  );

  const lightingSettings = await harness.request(`${requestIdPrefix}-lighting-settings`, "lighting.settings.update", {
    enabled: true,
    bridgeIp: "127.0.0.1",
    universe: 1,
    grandMaster: 72,
    cameraMarker: { x: 0.5, y: 0.84, rotation: 0 },
    subjectMarker: { x: 0.5, y: 0.46, rotation: 12 },
  });
  assert(
    lightingSettings.enabled === true &&
      lightingSettings.bridgeIp === "127.0.0.1" &&
      lightingSettings.universe === 1 &&
      lightingSettings.grandMaster === 72,
    `${runtimeLabel} lighting.settings.update did not persist the expected transport and GM state.`
  );
  const enabledLightingSnapshot = await harness.request(
    `${requestIdPrefix}-lighting-snapshot-enabled`,
    "lighting.snapshot"
  );
  // Scene recall is gated by the persisted lighting runtime status, not just the transient probe result.
  const lightingVerified = enabledLightingSnapshot.status === "ready";
  const enabledFixtureCount = enabledLightingSnapshot.fixtures?.length ?? 0;
  const enabledGroupCount = enabledLightingSnapshot.groups?.length ?? 0;
  const enabledSceneCount = enabledLightingSnapshot.scenes?.length ?? 0;

  const temporaryGroup = await harness.request(`${requestIdPrefix}-lighting-group-create`, "lighting.group.create", {
    name: "Parity Lighting Group",
  });
  const renamedGroup = await harness.request(`${requestIdPrefix}-lighting-group-rename`, "lighting.group.update", {
    groupId: temporaryGroup.group.id,
    name: "Parity Lighting Group Renamed",
  });
  assert(
    renamedGroup.group?.name === "Parity Lighting Group Renamed",
    `${runtimeLabel} lighting.group.update did not rename the parity lighting group.`
  );

  const deletedGroup = await harness.request(
    `${requestIdPrefix}-lighting-group-delete-create`,
    "lighting.group.create",
    {
      name: "Delete Lighting Group",
    }
  );
  const deletedGroupResult = await harness.request(
    `${requestIdPrefix}-lighting-group-delete`,
    "lighting.group.delete",
    {
      groupId: deletedGroup.group.id,
    }
  );
  assert(
    deletedGroupResult.deleted === true,
    `${runtimeLabel} lighting.group.delete did not remove the temporary delete-only group.`
  );

  const temporaryFixture = await harness.request(
    `${requestIdPrefix}-lighting-fixture-create`,
    "lighting.fixture.create",
    {
      name: "Parity Key Light",
      type: "astra-bicolor",
      dmxStartAddress: 481,
      groupId: temporaryGroup.group.id,
    }
  );
  const updatedFixture = await harness.request(
    `${requestIdPrefix}-lighting-fixture-update`,
    "lighting.fixture.update",
    {
      fixtureId: temporaryFixture.fixture.id,
      on: true,
      intensity: 44,
      cct: 5600,
      effect: { type: "strobe", speed: 4 },
      spatialX: 0.22,
      spatialY: 0.31,
      spatialRotation: 15,
    }
  );
  assert(
    updatedFixture.fixture?.on === true &&
      updatedFixture.fixture?.intensity === 44 &&
      updatedFixture.fixture?.cct === 5600 &&
      updatedFixture.fixture?.effect?.type === "strobe" &&
      updatedFixture.fixture?.effect?.speed === 4 &&
      updatedFixture.fixture?.spatialX === 0.22 &&
      updatedFixture.fixture?.spatialY === 0.31 &&
      updatedFixture.fixture?.spatialRotation === 15,
    `${runtimeLabel} lighting.fixture.update did not persist the expected lighting fixture state.`
  );

  const deletedFixture = await harness.request(
    `${requestIdPrefix}-lighting-fixture-delete-create`,
    "lighting.fixture.create",
    {
      name: "Delete Light",
      type: "astra-bicolor",
      dmxStartAddress: 489,
      groupId: null,
    }
  );
  const deletedFixtureResult = await harness.request(
    `${requestIdPrefix}-lighting-fixture-delete`,
    "lighting.fixture.delete",
    {
      fixtureId: deletedFixture.fixture.id,
    }
  );
  assert(
    deletedFixtureResult.deleted === true,
    `${runtimeLabel} lighting.fixture.delete did not remove the temporary delete-only fixture.`
  );

  const selectedFixtureSettings = await harness.request(
    `${requestIdPrefix}-lighting-settings-selected-fixture`,
    "lighting.settings.update",
    {
      selectedFixtureId: temporaryFixture.fixture.id,
    }
  );
  assert(
    selectedFixtureSettings.selectedFixtureId === temporaryFixture.fixture.id,
    `${runtimeLabel} lighting.settings.update did not select the temporary lighting fixture.`
  );

  const temporaryScene = await harness.request(`${requestIdPrefix}-lighting-scene-create`, "lighting.scene.create", {
    name: "Parity Lighting Scene",
  });
  const renamedScene = await harness.request(`${requestIdPrefix}-lighting-scene-rename`, "lighting.scene.update", {
    sceneId: temporaryScene.scene.id,
    name: "Parity Lighting Scene Renamed",
  });
  assert(
    renamedScene.scene?.name === "Parity Lighting Scene Renamed",
    `${runtimeLabel} lighting.scene.update did not rename the parity lighting scene.`
  );

  const deletedScene = await harness.request(
    `${requestIdPrefix}-lighting-scene-delete-create`,
    "lighting.scene.create",
    {
      name: "Delete Lighting Scene",
    }
  );
  const deletedSceneResult = await harness.request(
    `${requestIdPrefix}-lighting-scene-delete`,
    "lighting.scene.delete",
    {
      sceneId: deletedScene.scene.id,
    }
  );
  assert(
    deletedSceneResult.deleted === true,
    `${runtimeLabel} lighting.scene.delete did not remove the temporary delete-only scene.`
  );

  const selectSceneSettings = await harness.request(
    `${requestIdPrefix}-lighting-settings-selected-scene`,
    "lighting.settings.update",
    {
      selectedSceneId: temporaryScene.scene.id,
    }
  );
  assert(
    selectSceneSettings.selectedSceneId === temporaryScene.scene.id,
    `${runtimeLabel} lighting.settings.update did not select the temporary lighting scene.`
  );

  const sceneCapture = await harness.request(`${requestIdPrefix}-lighting-scene-capture`, "lighting.scene.update", {
    sceneId: temporaryScene.scene.id,
    captureCurrentState: true,
  });
  assert(
    sceneCapture.scene?.id === temporaryScene.scene.id,
    `${runtimeLabel} lighting.scene.update did not capture current scene state.`
  );

  const mutatedBeforeRecall = await harness.request(
    `${requestIdPrefix}-lighting-fixture-update-before-recall`,
    "lighting.fixture.update",
    {
      fixtureId: temporaryFixture.fixture.id,
      on: false,
      intensity: 88,
      cct: 3200,
    }
  );
  assert(
    mutatedBeforeRecall.fixture?.on === false &&
      mutatedBeforeRecall.fixture?.intensity === 88 &&
      mutatedBeforeRecall.fixture?.cct === 3200,
    `${runtimeLabel} lighting fixture could not be mutated before scene recall validation.`
  );

  if (lightingVerified) {
    const recallScene = await harness.request(`${requestIdPrefix}-lighting-scene-recall`, "lighting.scene.recall", {
      sceneId: temporaryScene.scene.id,
      fadeDurationSeconds: 2,
    });
    assert(
      recallScene.recalled === true && recallScene.sceneId === temporaryScene.scene.id,
      `${runtimeLabel} lighting.scene.recall did not recall the selected scene after the bridge probe passed.`
    );
  }

  const groupPower = await harness.request(`${requestIdPrefix}-lighting-group-power`, "lighting.group.power", {
    groupId: temporaryGroup.group.id,
    on: false,
  });
  assert(
    groupPower.groupId === temporaryGroup.group.id && groupPower.affectedFixtures >= 1,
    `${runtimeLabel} lighting.group.power did not affect the temporary lighting group.`
  );

  const allPower = await harness.request(`${requestIdPrefix}-lighting-all-power`, "lighting.power.all", {
    on: true,
  });
  assert(allPower.affectedFixtures >= 1, `${runtimeLabel} lighting.power.all did not affect any fixtures.`);

  const dmxMonitor = await harness.request(
    `${requestIdPrefix}-lighting-dmx-monitor-live`,
    "lighting.dmxMonitor.snapshot"
  );
  assert(
    dmxMonitor.channels?.some((channel) => channel.lightName === "Parity Key Light"),
    `${runtimeLabel} lighting.dmxMonitor.snapshot did not expose DMX channels for the temporary fixture.`
  );

  const lightingSnapshot = await harness.request(
    `${requestIdPrefix}-lighting-snapshot-operator-flow`,
    "lighting.snapshot"
  );
  const snapshotFixture = lightingFixtureById(lightingSnapshot, temporaryFixture.fixture.id);
  const snapshotGroup = lightingGroupById(lightingSnapshot, temporaryGroup.group.id);
  const snapshotScene = lightingSceneById(lightingSnapshot, temporaryScene.scene.id);
  const expectedFixtureIntensity = lightingVerified ? 44 : 88;
  const expectedFixtureCct = lightingVerified ? 5600 : 3200;

  assert(
    snapshotFixture &&
      snapshotFixture.name === "Parity Key Light" &&
      snapshotFixture.on === true &&
      snapshotFixture.intensity === expectedFixtureIntensity &&
      snapshotFixture.cct === expectedFixtureCct &&
      snapshotFixture.groupId === temporaryGroup.group.id,
    `${runtimeLabel} lighting snapshot did not retain the temporary parity fixture state.`
  );
  assert(
    snapshotGroup?.name === "Parity Lighting Group Renamed",
    `${runtimeLabel} lighting snapshot did not retain the renamed parity group.`
  );
  assert(
    snapshotScene?.name === "Parity Lighting Scene Renamed" &&
      lightingSnapshot.selectedSceneId === temporaryScene.scene.id &&
      lightingSnapshot.selectedFixtureId === temporaryFixture.fixture.id &&
      lightingSnapshot.grandMaster === 72 &&
      lightingSnapshot.cameraMarker?.y === 0.84 &&
      lightingSnapshot.subjectMarker?.rotation === 12,
    `${runtimeLabel} lighting snapshot did not retain the expected selection, GM, or marker state.`
  );
  if (lightingVerified) {
    assert(
      snapshotScene?.lastRecalled === true,
      `${runtimeLabel} lighting snapshot did not retain the recalled-scene marker after verification passed.`
    );
  } else {
    assert(
      enabledLightingSnapshot.status === "not-verified" ||
        enabledLightingSnapshot.status === "attention" ||
        enabledLightingSnapshot.status === "disabled",
      `${runtimeLabel} lighting snapshot reported unexpected non-ready status '${enabledLightingSnapshot.status}' after the commissioning probe returned '${lightingCheck.status}'.`
    );
  }
  assert(
    lightingSnapshot.fixtures?.length === enabledFixtureCount + 1,
    `${runtimeLabel} lighting snapshot did not add exactly one operator fixture on top of the enabled inventory.`
  );
  assert(
    lightingSnapshot.groups?.length === enabledGroupCount + 1,
    `${runtimeLabel} lighting snapshot did not add exactly one operator group on top of the enabled inventory.`
  );
  assert(
    lightingSnapshot.scenes?.length === enabledSceneCount + 1,
    `${runtimeLabel} lighting snapshot did not add exactly one operator scene on top of the enabled inventory.`
  );
  assert(
    lightingFixtureById(lightingSnapshot, deletedFixture.fixture.id) === null &&
      lightingGroupById(lightingSnapshot, deletedGroup.group.id) === null &&
      lightingSceneById(lightingSnapshot, deletedScene.scene.id) === null,
    `${runtimeLabel} lighting snapshot still contains delete-only parity entities.`
  );

  return {
    lightingVerified,
    temporaryFixtureIds: [temporaryFixture.fixture.id, deletedFixture.fixture.id],
    temporaryGroupIds: [temporaryGroup.group.id, deletedGroup.group.id],
    temporarySceneIds: [temporaryScene.scene.id, deletedScene.scene.id],
  };
}

export async function assertAudioWorkflowParity(harness, requestIdPrefix, runtimeLabel) {
  // 2026-09 audit remediation, Slice 2: with the console link active the
  // engine keeps ingesting what TotalMix reports, so every baseline and every
  // compare waits for the link to settle first.
  const baselineSnapshot = await awaitConsoleLinkQuiet(harness, `${requestIdPrefix}-audio-quiet-baseline`);

  // Surfaces under test. The default (simulated console) exercises the full
  // main / front-preamp / rear-line / playback vocabulary. The live lane picks
  // surfaces the studio desk does not use — Phones 2 and the playback pair
  // 7/8 — because the harness's writes really reach the hardware there, and
  // it never solos the main mix, never toggles 48V / phase / AutoSet on a
  // real preamp, and never recalls a snapshot (Slice 4 makes recall push).
  const targets = LIVE_CONSOLE
    ? {
        mixTargetId: "audio-mix-phones-b",
        frontChannelId: "audio-input-12",
        playbackChannelId: "audio-playback-7-8",
        playbackSendTargetId: "audio-mix-phones-b",
        playbackFader: 0.02,
      }
    : {
        mixTargetId: "audio-mix-main",
        frontChannelId: "audio-input-12",
        playbackChannelId: "audio-playback-1-2",
        playbackSendTargetId: "audio-mix-phones-a",
        playbackFader: 0.61,
      };
  const baselineFront = audioChannelById(baselineSnapshot, targets.frontChannelId);
  const baselineMixTarget = audioMixTargetById(baselineSnapshot, targets.mixTargetId);
  const baselinePlayback = audioChannelById(baselineSnapshot, targets.playbackChannelId);

  assert(baselineFront, `${runtimeLabel} audio.snapshot is missing front preamp ${targets.frontChannelId}.`);
  assert(baselineMixTarget, `${runtimeLabel} audio.snapshot is missing ${targets.mixTargetId}.`);
  assert(baselinePlayback, `${runtimeLabel} audio.snapshot is missing ${targets.playbackChannelId}.`);

  const settings = await harness.request(`${requestIdPrefix}-audio-settings`, "audio.settings.update", {
    selectedChannelId: "audio-input-12",
    selectedMixTargetId: "audio-mix-phones-a",
    expectedPeakData: false,
    expectedSubmixLock: false,
    expectedCompatibilityMode: true,
  });
  assert(
    settings.selectedChannelId === "audio-input-12" &&
      settings.selectedMixTargetId === "audio-mix-phones-a" &&
      settings.expectedPeakData === false &&
      settings.expectedSubmixLock === false &&
      settings.expectedCompatibilityMode === true,
    `${runtimeLabel} audio.settings.update did not retain the expected operator selection and transport settings.`
  );

  // 2026-09 audit remediation, Slice 1: every console write below is refused
  // until the audio probe has passed, exactly like the Stream Deck path, so the
  // probe runs first. By default the harness runs the engine in simulated
  // audio input mode (see `acceptanceEngineEnv`), where the probe passes
  // honestly; the live lane needs TotalMix streaming meters.
  const audioProbe = await harness.request(`${requestIdPrefix}-audio-probe`, "commissioning.check.run", {
    target: "audio",
    sendHost: settings.sendHost,
    sendPort: settings.sendPort,
    receivePort: settings.receivePort,
  });
  const audioCheck = audioProbe.checks?.find((check) => check.id === "audio");
  assert(
    audioCheck && typeof audioCheck.status === "string" && typeof audioCheck.message === "string",
    `${runtimeLabel} commissioning.check.run did not return a valid audio probe record.`
  );
  // There is deliberately no "bind denied" escape: if the probe cannot pass,
  // the engine refuses every console write below, so the harness stops here
  // with the probe's own reason instead of failing on the first write.
  assert(
    audioCheck.status === "passed",
    `${runtimeLabel} audio probe must pass before console writes are accepted: ${audioCheck.message}`
  );

  try {
    // Control-room mix target. On the live lane this is Phones 2: volume and
    // mute reach the (unused) hardware output, while dim / mono / talkback are
    // main-only functions the engine keeps app-local and reports as such.
    const updatedMixTarget = await harness.request(`${requestIdPrefix}-audio-mix-target`, "audio.mixTarget.update", {
      mixTargetId: targets.mixTargetId,
      volume: 0.81,
      dim: true,
      mono: true,
      talkback: true,
    });
    assert(
      updatedMixTarget.id === targets.mixTargetId &&
        updatedMixTarget.volume === 0.81 &&
        updatedMixTarget.dim === true &&
        updatedMixTarget.mono === true &&
        updatedMixTarget.talkback === true,
      `${runtimeLabel} audio.mixTarget.update did not persist the expected control-room mix state.`
    );

    if (LIVE_CONSOLE) {
      // A rename is app-local (Slice 1 keeps it ungated) and proves the
      // channel update path without touching a real preamp.
      const renamed = await harness.request(`${requestIdPrefix}-audio-front-preamp`, "audio.channel.update", {
        channelId: targets.frontChannelId,
        name: "Parity Preamp",
      });
      assert(
        renamed.id === targets.frontChannelId &&
          renamed.name === "Parity Preamp" &&
          renamed.gain === baselineFront.gain &&
          renamed.phantom === baselineFront.phantom,
        `${runtimeLabel} audio.channel.update did not persist the expected app-local rename.`
      );
    } else {
      const updatedFront = await harness.request(`${requestIdPrefix}-audio-front-preamp`, "audio.channel.update", {
        channelId: targets.frontChannelId,
        gain: 40,
        phantom: true,
        instrument: true,
        autoSet: true,
        phase: true,
      });
      assert(
        updatedFront.id === targets.frontChannelId &&
          updatedFront.gain === 40 &&
          updatedFront.phantom === true &&
          updatedFront.pad === baselineFront.pad &&
          updatedFront.instrument === true &&
          updatedFront.autoSet === true &&
          updatedFront.phase === true,
        `${runtimeLabel} audio.channel.update did not persist the expected writable front-preamp controls.`
      );

      // Line input 1 is hidden in the studio's TotalMix layout: the console
      // drops writes to it and the read-back makes the console win, so this
      // stays in the simulated lane.
      const updatedRear = await harness.request(`${requestIdPrefix}-audio-rear-line`, "audio.channel.update", {
        channelId: "audio-input-1",
        mute: true,
        phase: true,
      });
      assert(
        updatedRear.id === "audio-input-1" && updatedRear.mute === true && updatedRear.phase === true,
        `${runtimeLabel} audio.channel.update did not persist the expected rear-line operator state.`
      );
    }

    const playbackRequest = {
      channelId: targets.playbackChannelId,
      fader: targets.playbackFader,
      mixTargetId: targets.playbackSendTargetId,
      mute: true,
    };
    if (!LIVE_CONSOLE) {
      // Solo acts on the main submix; never on the live desk.
      playbackRequest.solo = true;
    }
    const updatedPlayback = await harness.request(
      `${requestIdPrefix}-audio-playback`,
      "audio.channel.update",
      playbackRequest
    );
    // A send edit on a phones mix sets that mix's level only; `fader` is the
    // channel's Main Out level and stays as it was (2026-09-23, after the
    // program: a phones edit used to overwrite it).
    assert(
      updatedPlayback.id === targets.playbackChannelId &&
        Math.abs(updatedPlayback.fader - baselinePlayback.fader) < 0.003 &&
        updatedPlayback.mute === true &&
        (LIVE_CONSOLE || updatedPlayback.solo === true) &&
        updatedPlayback.mixLevels?.[targets.playbackSendTargetId] === targets.playbackFader,
      `${runtimeLabel} audio.channel.update did not persist the expected playback send state.`
    );

    let unsupportedFieldRejected = false;
    try {
      await harness.request(`${requestIdPrefix}-audio-rear-line-unsupported`, "audio.channel.update", {
        channelId: "audio-input-1",
        phantom: true,
      });
    } catch (error) {
      unsupportedFieldRejected = String(error.message).includes("AUDIO_CHANNEL_FIELD_UNSUPPORTED");
    }
    assert(
      unsupportedFieldRejected,
      `${runtimeLabel} audio role-gating did not reject unsupported rear-line phantom changes.`
    );

    // Slice 3: sync is a console pull. Simulated: aligned by construction.
    // Live: a complete dump with real values, read-only towards the desk.
    const synced = await harness.request(`${requestIdPrefix}-audio-sync`, "audio.sync");
    assert(
      synced.synced === true && synced.consoleStateConfidence === "aligned" && synced.complete === true,
      `${runtimeLabel} audio.sync did not report an aligned, complete console pull: ${JSON.stringify(synced)}`
    );
    if (LIVE_CONSOLE) {
      assert(
        synced.pulledValues > 100 && synced.connection === "connected",
        `${runtimeLabel} live console pull returned too little: ${JSON.stringify(synced)}`
      );
    }

    if (!LIVE_CONSOLE) {
      const recalled = await harness.request(`${requestIdPrefix}-audio-snapshot-recall`, "audio.snapshot.recall", {
        snapshotId: "snapshot-panel",
      });
      // Slice 4: recall is a push. On the simulated console it is app-local
      // and stays aligned; the live lane never recalls (that would push a
      // snapshot to the real desk — operator checklist B3 covers it).
      assert(
        recalled.recalled === true &&
          recalled.snapshotId === "snapshot-panel" &&
          recalled.consoleStateConfidence === "aligned" &&
          recalled.unconfirmed === 0,
        `${runtimeLabel} audio.snapshot.recall did not report an aligned, confirmed recall: ${JSON.stringify(recalled)}`
      );
    }

    // Let the read-backs for the writes above confirm (or the console win)
    // before judging what the engine retained.
    const mutatedSnapshot = await awaitConsoleLinkQuiet(harness, `${requestIdPrefix}-audio-quiet-mutated`);
    const mutatedFront = audioChannelById(mutatedSnapshot, targets.frontChannelId);
    const mutatedRear = audioChannelById(mutatedSnapshot, "audio-input-1");
    const mutatedPlayback = audioChannelById(mutatedSnapshot, targets.playbackChannelId);
    const mutatedMixTarget = audioMixTargetById(mutatedSnapshot, targets.mixTargetId);

    assert(
      mutatedSnapshot.selectedChannelId === "audio-input-12" &&
        mutatedSnapshot.selectedMixTargetId === "audio-mix-phones-a" &&
        // Ordinary edits never write console-state confidence (Slice 1); sync
        // aligns it and, in the simulated lane, recall marks it assumed.
        mutatedSnapshot.consoleStateConfidence === "aligned" &&
        mutatedSnapshot.lastConsoleSyncReason === (LIVE_CONSOLE ? "console-pull" : "snapshot") &&
        mutatedSnapshot.lastRecalledSnapshotId === (LIVE_CONSOLE ? null : "snapshot-panel"),
      `${runtimeLabel} audio snapshot did not retain the expected selection and recall markers.`
    );
    if (LIVE_CONSOLE) {
      assert(
        mutatedFront &&
          mutatedFront.name === "Parity Preamp" &&
          mutatedFront.gain === baselineFront.gain &&
          mutatedFront.phantom === baselineFront.phantom &&
          mutatedFront.phase === baselineFront.phase,
        `${runtimeLabel} audio snapshot did not retain the expected app-local front-preamp rename.`
      );
      assert(
        mutatedSnapshot.consoleLink?.unconfirmedSends === 0,
        `${runtimeLabel} console link reported unconfirmed sends: ${JSON.stringify(mutatedSnapshot.consoleLink)}`
      );
    } else {
      assert(
        mutatedFront &&
          mutatedFront.gain === 40 &&
          mutatedFront.phantom === true &&
          mutatedFront.pad === baselineFront.pad &&
          mutatedFront.instrument === true &&
          mutatedFront.autoSet === true &&
          mutatedFront.phase === true,
        `${runtimeLabel} audio snapshot did not retain the expected front-preamp state.`
      );
      assert(
        mutatedRear && mutatedRear.mute === true && mutatedRear.phase === true,
        `${runtimeLabel} audio snapshot did not retain the expected rear-line state.`
      );
    }
    // On the live lane the sync above pulled the desk's own values back
    // through RME's fader curve, so faders compare within one console step.
    const nearFader = (actual, expected) => typeof actual === "number" && Math.abs(actual - expected) < 0.003;
    assert(
      mutatedPlayback &&
        mutatedPlayback.mute === true &&
        (LIVE_CONSOLE || mutatedPlayback.solo === true) &&
        nearFader(mutatedPlayback.mixLevels?.[targets.playbackSendTargetId], targets.playbackFader),
      `${runtimeLabel} audio snapshot did not retain the expected playback send state.`
    );
    assert(
      mutatedMixTarget &&
        nearFader(mutatedMixTarget.volume, 0.81) &&
        mutatedMixTarget.dim === true &&
        mutatedMixTarget.mono === true &&
        mutatedMixTarget.talkback === true,
      `${runtimeLabel} audio snapshot did not retain the expected control-room state.`
    );
  } finally {
    if (LIVE_CONSOLE) {
      await restoreLiveConsoleWrites(harness, requestIdPrefix, {
        targets,
        baselineMixTarget,
        baselinePlayback,
        baselineFront,
      });
    }
  }

  return {
    targets,
    baselineFront,
    baselineMixTarget,
    baselinePlayback,
    baselineSelectedChannelId: baselineSnapshot.selectedChannelId,
    baselineSelectedMixTargetId: baselineSnapshot.selectedMixTargetId,
    baselineExpectedPeakData: baselineSnapshot.expectedPeakData,
    baselineExpectedSubmixLock: baselineSnapshot.expectedSubmixLock,
    baselineExpectedCompatibilityMode: baselineSnapshot.expectedCompatibilityMode,
    baselineLastConsoleSyncAt: baselineSnapshot.lastConsoleSyncAt ?? null,
    baselineLastConsoleSyncReason: baselineSnapshot.lastConsoleSyncReason ?? null,
    baselineLastRecalledSnapshotId: baselineSnapshot.lastRecalledSnapshotId ?? null,
    baselineLastSnapshotRecallAt: baselineSnapshot.lastSnapshotRecallAt ?? null,
    baselineConsoleStateConfidence: baselineSnapshot.consoleStateConfidence,
  };
}

// Puts the live desk back exactly as the baseline saw it. Runs in `finally`,
// so a failed assertion never leaves the studio console mutated.
async function restoreLiveConsoleWrites(
  harness,
  requestIdPrefix,
  { targets, baselineMixTarget, baselinePlayback, baselineFront }
) {
  await harness.request(`${requestIdPrefix}-audio-live-restore-mix`, "audio.mixTarget.update", {
    mixTargetId: targets.mixTargetId,
    volume: baselineMixTarget.volume,
    mute: baselineMixTarget.mute,
    dim: baselineMixTarget.dim,
    mono: baselineMixTarget.mono,
    talkback: baselineMixTarget.talkback,
  });
  await harness.request(`${requestIdPrefix}-audio-live-restore-playback`, "audio.channel.update", {
    channelId: targets.playbackChannelId,
    mixTargetId: targets.playbackSendTargetId,
    fader: baselinePlayback.mixLevels?.[targets.playbackSendTargetId] ?? 0,
    mute: baselinePlayback.mute,
  });
  await harness.request(`${requestIdPrefix}-audio-live-restore-front`, "audio.channel.update", {
    channelId: targets.frontChannelId,
    name: baselineFront.name,
  });
  await awaitConsoleLinkQuiet(harness, `${requestIdPrefix}-audio-live-restore-quiet`);
}
