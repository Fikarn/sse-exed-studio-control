// Part of the fixture double (`../fixtureTransport.ts`): the in-memory stand-in for the
// hardware link that Playwright and the browser fixture mode run against. Test-only.
import type { JsonObject } from "../../generated/protocol";
import { type AudioMeterState, SIMULATED_AUDIO_ADAPTER_MODES, refreshFixtureAudioMetering } from "./audioMetering";
import { asArray, asRecord, asString, asNumber, cloneJson, asBoolean } from "./json";
import type { RunnerStage, CommissioningStage, FixtureScenario, CommissioningCheckTarget } from "../../types";
import { DEFAULT_LIGHTING_FIXTURE_CATALOG } from "./lightingCatalog";
import {
  buildDefaultLightingSnapshot,
  clampNumber,
  normalizeLightingFixtureSnapshotEntry,
  lightingPalettes,
  normalizePaletteKind,
  normalizePaletteValue,
  defaultLightingPalettes,
} from "./lighting";
import {
  buildDefaultAudioSnapshot,
  normalizeAudioEq,
  buildAudioDynamics,
  buildAudioSendModes,
  buildAudioSnapshotPreview,
  refreshAudioCapabilities,
} from "./audioConsole";
import { buildDefaultPlanningSnapshot, normalizePlanningViewFilter, normalizePlanningModeSection } from "./planning";

export interface MutableFixtureState {
  appSnapshot: JsonObject;
  audioMeterState: Record<string, AudioMeterState>;
  healthSnapshot: JsonObject;
  commissioningSnapshot: JsonObject;
  lightingFixtureCatalogSnapshot: JsonObject;
  lightingSnapshot: JsonObject;
  audioSnapshot: JsonObject | null;
  planningSnapshot: JsonObject | null;
  supportSnapshot: JsonObject;
  controlSurfaceSnapshot: JsonObject;
}

declare global {
  interface Window {
    __SSE_TEST_ENGINE_REQUEST_COUNTS__?: Record<string, number>;
  }
}

export function normalizeTalentMarks(value: unknown): JsonObject[] {
  return asArray(value).map((entry, index) => {
    const mark = asRecord(entry);
    if (!mark) {
      throw new Error(`lighting.talentMarks[${index}] must be an object`);
    }
    const id = asString(mark.id).trim();
    const label = asString(mark.label).trim();
    const xMeters = asNumber(mark.xMeters, Number.NaN);
    const yMeters = asNumber(mark.yMeters, Number.NaN);
    if (!id) {
      throw new Error(`lighting.talentMarks[${index}].id must be a non-empty string`);
    }
    if (!label) {
      throw new Error(`lighting.talentMarks[${index}].label must be a non-empty string`);
    }
    if (!Number.isFinite(xMeters) || xMeters < 0 || xMeters > 20) {
      throw new Error(`lighting.talentMarks[${index}].xMeters must be between 0 and 20`);
    }
    if (!Number.isFinite(yMeters) || yMeters < 0 || yMeters > 20) {
      throw new Error(`lighting.talentMarks[${index}].yMeters must be between 0 and 20`);
    }

    return {
      id,
      label,
      xMeters: Math.round(xMeters * 100) / 100,
      yMeters: Math.round(yMeters * 100) / 100,
    };
  });
}

export function normalizeRunnerStage(stage: unknown, legacyStage: unknown): RunnerStage {
  if (stage === "import" || stage === "probe" || stage === "map" || stage === "verify" || stage === "publish") {
    return stage;
  }

  if (legacyStage === "ready") {
    return "publish";
  }

  if (legacyStage === "in-progress") {
    return "probe";
  }

  return "import";
}

export function legacyStageFromRunnerStage(runnerStage: RunnerStage, hasCompletedSetup: boolean): CommissioningStage {
  if (runnerStage === "publish") {
    if (hasCompletedSetup) {
      return "ready";
    }

    return "in-progress";
  }

  if (runnerStage === "probe" || runnerStage === "map" || runnerStage === "verify") {
    return "in-progress";
  }

  return "setup-required";
}

export function ensurePaths(state: MutableFixtureState) {
  const runtime = asRecord(state.appSnapshot.runtime) ?? {};
  const paths = asRecord(runtime.paths) ?? {};
  runtime.paths = {
    appDataDir:
      typeof paths.appDataDir === "string"
        ? paths.appDataDir
        : "/Users/operator/Library/Application Support/SSE ExEd Studio Control",
    backupDir:
      typeof paths.backupDir === "string"
        ? paths.backupDir
        : "/Users/operator/Library/Application Support/SSE ExEd Studio Control/backups",
    dbPath:
      typeof paths.dbPath === "string"
        ? paths.dbPath
        : "/Users/operator/Library/Application Support/SSE ExEd Studio Control/studio-control.sqlite3",
    // 2026-09 production readiness, Slice 4 (F15): the diagnostics folder the
    // Support surfaces open; the engine reports it as `runtime.paths.exportsDir`.
    exportsDir:
      typeof paths.exportsDir === "string"
        ? paths.exportsDir
        : "/Users/operator/Library/Application Support/SSE ExEd Studio Control/exports",
    logFilePath:
      typeof paths.logFilePath === "string"
        ? paths.logFilePath
        : "/Users/operator/Library/Logs/SSE ExEd Studio Control/studio-control.log",
    logsDir: typeof paths.logsDir === "string" ? paths.logsDir : "/Users/operator/Library/Logs/SSE ExEd Studio Control",
    updateRepositoryPath:
      typeof paths.updateRepositoryPath === "string"
        ? paths.updateRepositoryPath
        : "/Users/operator/Downloads/SSE-ExEd-Studio-Control-Native-macOS-UpdateRepository.zip",
  };
  state.appSnapshot.runtime = runtime;
}

export function countControls(state: MutableFixtureState) {
  const pages = asArray(state.controlSurfaceSnapshot.pages);
  return pages.reduce<number>((total, page) => {
    const record = asRecord(page);
    if (!record) {
      return total;
    }

    return total + asArray(record.buttons).length + asArray(record.dials).length;
  }, 0);
}

export function buildDefaultControlSurfaceSnapshot(): JsonObject {
  const makeButtons = (pageId: string, prefix: string) =>
    Array.from({ length: 8 }, (_, index) => ({
      id: `${pageId}-button-${index + 1}`,
      type: "button",
      position: index + 1,
      label: `${prefix} ${index + 1}`,
      description: `${prefix} action ${index + 1} is mapped through the native control-surface bridge.`,
    }));

  const makeDials = (pageId: string, prefix: string) =>
    Array.from({ length: 4 }, (_, index) => ({
      id: `${pageId}-dial-${index + 1}`,
      type: "dial",
      position: index + 1,
      label: `${prefix} ${index + 1}`,
      description: `${prefix} dial ${index + 1} is available for live verification.`,
    }));

  return {
    pages: [
      {
        id: "projects",
        label: "PROJECTS",
        buttons: makeButtons("projects", "Project"),
        dials: makeDials("projects", "Navigate"),
      },
      {
        id: "tasks",
        label: "TASKS",
        buttons: makeButtons("tasks", "Task"),
        dials: makeDials("tasks", "Task Dial"),
      },
      {
        id: "lights",
        label: "LIGHTS",
        buttons: makeButtons("lights", "Light"),
        dials: makeDials("lights", "Intensity"),
      },
      {
        id: "audio",
        label: "AUDIO",
        buttons: makeButtons("audio", "Channel"),
        dials: makeDials("audio", "Gain"),
      },
    ],
  };
}

export function createMutableFixtureState(scenario: FixtureScenario): MutableFixtureState {
  const scenarioAudioSnapshot = asRecord(scenario.audioSnapshot);

  const state = {
    appSnapshot: cloneJson((scenario.appSnapshot ?? {}) as JsonObject),
    audioMeterState: {},
    healthSnapshot: cloneJson((scenario.healthSnapshot ?? {}) as JsonObject),
    commissioningSnapshot: cloneJson((scenario.commissioningSnapshot ?? {}) as JsonObject),
    lightingFixtureCatalogSnapshot: cloneJson(
      (scenario.lightingFixtureCatalogSnapshot ?? DEFAULT_LIGHTING_FIXTURE_CATALOG) as JsonObject
    ),
    lightingSnapshot: cloneJson((scenario.lightingSnapshot ?? buildDefaultLightingSnapshot()) as JsonObject),
    audioSnapshot:
      "audioSnapshot" in scenario
        ? scenario.audioSnapshot === null
          ? null
          : scenarioAudioSnapshot
            ? cloneJson({
                ...buildDefaultAudioSnapshot(),
                ...scenarioAudioSnapshot,
              } as JsonObject)
            : cloneJson(buildDefaultAudioSnapshot())
        : cloneJson(buildDefaultAudioSnapshot()),
    planningSnapshot:
      "planningSnapshot" in scenario
        ? cloneJson((scenario.planningSnapshot ?? null) as JsonObject | null)
        : cloneJson(buildDefaultPlanningSnapshot()),
    supportSnapshot: cloneJson((scenario.supportSnapshot ?? {}) as JsonObject),
    controlSurfaceSnapshot: cloneJson(
      (scenario.controlSurfaceSnapshot ?? buildDefaultControlSurfaceSnapshot()) as JsonObject
    ),
  };

  const fixtureClipChannelIds = asArray(asRecord(state.audioSnapshot)?.clipChannelIds)
    .map((entry) => asString(entry).trim())
    .filter(Boolean);
  if (fixtureClipChannelIds.length > 0 && state.audioSnapshot) {
    delete state.audioSnapshot.clipChannelIds;
    const clippedIds = new Set(fixtureClipChannelIds);
    for (const channel of asArray(state.audioSnapshot.channels).map((entry) => asRecord(entry))) {
      if (channel && clippedIds.has(asString(channel.id))) {
        channel.clip = true;
      }
    }
  }

  const fixtureMixLevelOverrides = asArray(asRecord(state.audioSnapshot)?.mixLevelOverrides)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);
  if (fixtureMixLevelOverrides.length > 0 && state.audioSnapshot) {
    delete state.audioSnapshot.mixLevelOverrides;
    const channels = asArray(state.audioSnapshot.channels).map((entry) => asRecord(entry));
    for (const override of fixtureMixLevelOverrides) {
      const channelId = asString(override.channelId).trim();
      const mixTargetId = asString(override.mixTargetId).trim();
      if (!channelId || !mixTargetId) continue;
      const value = clampNumber(asNumber(override.value, 0), 0, 1);
      const channel = channels.find((entry) => entry && asString(entry.id) === channelId);
      if (!channel) continue;
      const mixLevels = asRecord(channel.mixLevels) ?? {};
      mixLevels[mixTargetId] = value;
      channel.mixLevels = mixLevels;
      if (mixTargetId === "audio-mix-main") {
        channel.fader = value;
      }
    }
  }

  return state;
}

export function ensureCommissioningChecks(state: MutableFixtureState) {
  const existingChecks = asArray(state.commissioningSnapshot.checks)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);

  const defaults = [
    { id: "control-surface", label: "Control Surface Probe", status: "idle", message: "Not run yet." },
    { id: "lighting", label: "Lighting Bridge Probe", status: "idle", message: "Not run yet." },
    { id: "audio", label: "Audio OSC Probe", status: "idle", message: "Not run yet." },
  ];

  for (const fallback of defaults) {
    if (!existingChecks.some((check) => check.id === fallback.id)) {
      existingChecks.push({ ...fallback });
    }
  }

  state.commissioningSnapshot.checks = existingChecks;
  return existingChecks;
}

export function buildCommissioningSteps(
  runnerStage: RunnerStage,
  checkCount: number,
  passedChecks: number,
  failedChecks: number,
  planningProjectCount: number,
  planningTaskCount: number,
  hasCompletedSetup: boolean
) {
  const stageIndex =
    runnerStage === "probe"
      ? 1
      : runnerStage === "map"
        ? 2
        : runnerStage === "verify"
          ? 3
          : runnerStage === "publish"
            ? 4
            : 0;
  const allChecksPassed = checkCount > 0 && passedChecks === checkCount && failedChecks === 0;

  return [
    {
      id: "import",
      label: "Import profile",
      status: stageIndex > 0 ? "completed" : "current",
      summary:
        planningProjectCount > 0
          ? "Profile export and sample planning data are ready for commissioning."
          : "Export the Companion profile and seed sample planning data before probing hardware.",
    },
    {
      id: "probe",
      label: "Probe hardware",
      status:
        failedChecks > 0
          ? "attention"
          : stageIndex > 1
            ? "completed"
            : runnerStage === "probe"
              ? "current"
              : passedChecks > 0
                ? "ready"
                : "pending",
      summary: `${passedChecks} of ${checkCount} commissioning probes passed. Failed: ${failedChecks}.`,
    },
    {
      id: "map",
      label: "Map bindings",
      status: stageIndex > 2 ? "completed" : runnerStage === "map" ? "current" : allChecksPassed ? "ready" : "pending",
      summary:
        planningProjectCount > 0
          ? `Review ${planningProjectCount} projects and ${planningTaskCount} tasks across the mapped control-surface pages.`
          : "Review the engine-owned control-surface pages before moving to live verification.",
    },
    {
      id: "verify",
      label: "Verify live echo",
      status:
        stageIndex > 3 ? "completed" : runnerStage === "verify" ? "current" : allChecksPassed ? "ready" : "pending",
      summary:
        runnerStage === "verify" || stageIndex > 3
          ? "Press the physical Stream Deck+ controls and watch the matching cell pulse."
          : "Physical-button echo verification remains locked until probes and mapping are complete.",
    },
    {
      id: "publish",
      label: "Publish",
      status: hasCompletedSetup
        ? "completed"
        : runnerStage === "publish"
          ? "current"
          : allChecksPassed
            ? "ready"
            : "pending",
      summary: hasCompletedSetup
        ? "Startup is routed directly into the dashboard surface and the publish backup can be restored."
        : "Commit setup, export a support backup, and return to Planning.",
    },
  ];
}

export function synchronizeFixtureState(state: MutableFixtureState) {
  ensurePaths(state);

  const runtime = asRecord(state.appSnapshot.runtime) ?? {};
  const controlSurface = asRecord(runtime.controlSurface) ?? {};
  const shell = asRecord(state.appSnapshot.shell) ?? {};
  const shellSetup = asRecord(shell.setup) ?? {};
  const shellLighting = asRecord(shell.lighting) ?? {};
  const planningAppSnapshot = asRecord(state.appSnapshot.planning) ?? {};
  const startup = asRecord(state.appSnapshot.startup) ?? {};
  const commissioning = asRecord(state.appSnapshot.commissioning) ?? {};
  const lightingConfig = asRecord(state.commissioningSnapshot.lighting) ?? {};
  const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
  const audioConfig = asRecord(state.commissioningSnapshot.audio) ?? {};
  const checks = ensureCommissioningChecks(state);
  const planningSnapshotRecord = asRecord(state.planningSnapshot);
  const backups = asArray(state.supportSnapshot.backups)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .sort((left, right) => asNumber(right.modifiedAt) - asNumber(left.modifiedAt));
  const planningProjects = asArray(planningSnapshotRecord?.projects)
    .map((project) => asRecord(project))
    .filter((project): project is JsonObject => project !== null);
  const planningTasks = asArray(planningSnapshotRecord?.tasks)
    .map((task) => asRecord(task))
    .filter((task): task is JsonObject => task !== null);
  const planningActivityLog = asArray(planningSnapshotRecord?.activityLog);
  const planningSettings = {
    ...planningAppSnapshot,
    ...(asRecord(planningSnapshotRecord?.settings) ?? {}),
  };
  planningSettings.viewFilter = asString(planningSettings.viewFilter, "all");
  planningSettings.viewFilter = normalizePlanningViewFilter(planningSettings.viewFilter);
  planningSettings.sortBy = asString(planningSettings.sortBy, "manual");
  planningSettings.dashboardView = asString(planningSettings.dashboardView, "kanban");
  planningSettings.deckMode = asString(planningSettings.deckMode, "project");
  planningSettings.modeSection = normalizePlanningModeSection(planningSettings.modeSection);
  planningSettings.timelineStartHour = clampNumber(Math.round(asNumber(planningSettings.timelineStartHour, 9)), 0, 23);
  planningSettings.timelineEndHour = clampNumber(Math.round(asNumber(planningSettings.timelineEndHour, 22)), 1, 23);
  if (planningSettings.timelineEndHour <= planningSettings.timelineStartHour) {
    planningSettings.timelineEndHour = Math.min(23, planningSettings.timelineStartHour + 1);
  }
  planningSettings.selectedProjectId =
    typeof planningSettings.selectedProjectId === "string" ? planningSettings.selectedProjectId : null;
  planningSettings.selectedTaskId =
    typeof planningSettings.selectedTaskId === "string" ? planningSettings.selectedTaskId : null;
  if (planningSnapshotRecord) {
    planningSnapshotRecord.projects = planningProjects;
    planningSnapshotRecord.tasks = planningTasks;
    planningSnapshotRecord.activityLog = planningActivityLog;
    planningSnapshotRecord.settings = planningSettings;
    planningSnapshotRecord.counts = {
      projectCount: planningProjects.length,
      taskCount: planningTasks.length,
      runningTaskCount: planningTasks.filter((task) => asBoolean(task.isRunning, false)).length,
      completedTaskCount: planningTasks.filter((task) => asBoolean(task.completed, false)).length,
    };
    state.planningSnapshot = planningSnapshotRecord;
  } else {
    state.planningSnapshot = null;
  }

  const hardwareProfile = asString(
    state.commissioningSnapshot.hardwareProfile ?? commissioning.hardwareProfile,
    "sse-fixed-studio-v1"
  );
  const runnerStage = normalizeRunnerStage(
    state.commissioningSnapshot.runnerStage ?? commissioning.runnerStage,
    state.commissioningSnapshot.stage ?? commissioning.stage
  );
  const stage = asString(
    legacyStageFromRunnerStage(runnerStage, asBoolean(state.commissioningSnapshot.hasCompletedSetup, false)),
    "setup-required"
  ) as CommissioningStage;
  const planningProjectCount = planningProjects.length;
  const planningTaskCount = planningTasks.length;
  const passedChecks = checks.filter((check) => {
    const status = asString(check.status);
    return status === "ok" || status === "passed";
  }).length;
  const failedChecks = checks.filter((check) => {
    const status = asString(check.status);
    return status === "attention" || status === "error" || status === "failed";
  }).length;
  const hasCompletedSetup =
    asBoolean(state.commissioningSnapshot.hasCompletedSetup, stage === "ready") || stage === "ready";
  const startupTargetSurface = hasCompletedSetup ? "dashboard" : "commissioning";
  const allChecksPassed = checks.length > 0 && passedChecks === checks.length && failedChecks === 0;

  state.commissioningSnapshot.hasCompletedSetup = hasCompletedSetup;
  state.commissioningSnapshot.runnerStage = runnerStage;
  state.commissioningSnapshot.stage = stage;
  state.commissioningSnapshot.hardwareProfile = hardwareProfile;
  state.commissioningSnapshot.planningProjectCount = planningProjectCount;
  state.commissioningSnapshot.planningTaskCount = planningTaskCount;
  state.commissioningSnapshot.lighting = {
    bridgeIp: asString(lightingConfig.bridgeIp, ""),
    universe: asNumber(lightingConfig.universe, 1),
  };
  state.commissioningSnapshot.audio = {
    sendHost: asString(audioConfig.sendHost, "127.0.0.1"),
    sendPort: asNumber(audioConfig.sendPort, 7001),
    receivePort: asNumber(audioConfig.receivePort, 9001),
  };
  state.commissioningSnapshot.sampleSeedAvailable = true;
  state.commissioningSnapshot.summary = hasCompletedSetup
    ? "Commissioning complete and operator mode unlocked."
    : allChecksPassed && planningProjectCount > 0
      ? "Verification complete. Publish to unlock operator mode."
      : "Complete commissioning to unlock operator mode.";
  state.commissioningSnapshot.configSummary = `Profile '${hardwareProfile}'. Lighting bridge '${asString(state.commissioningSnapshot.lighting.bridgeIp, "unconfigured")}' on universe ${asNumber(state.commissioningSnapshot.lighting.universe, 1)}. Audio send ${asString(state.commissioningSnapshot.audio.sendHost, "127.0.0.1")}:${asNumber(state.commissioningSnapshot.audio.sendPort, 7001)} and receive ${asNumber(state.commissioningSnapshot.audio.receivePort, 9001)}.`;
  const publishOverrideAt =
    typeof state.commissioningSnapshot.publishOverrideAt === "string"
      ? state.commissioningSnapshot.publishOverrideAt
      : null;
  state.commissioningSnapshot.readinessSummary = hasCompletedSetup
    ? `${passedChecks} of ${checks.length} commissioning probes passed. Startup routes directly into the dashboard.${publishOverrideAt ? ` Published with a probe override at ${publishOverrideAt}.` : ""}`
    : `${passedChecks} of ${checks.length} commissioning probes passed. Planning store has ${planningProjectCount} projects and ${planningTaskCount} tasks. Startup remains on Setup until publish.`;
  state.commissioningSnapshot.steps = buildCommissioningSteps(
    runnerStage,
    checks.length,
    passedChecks,
    failedChecks,
    planningProjectCount,
    planningTaskCount,
    hasCompletedSetup
  );

  controlSurface.available = asBoolean(controlSurface.available, true);
  controlSurface.status = controlSurface.available ? "ok" : "attention";
  controlSurface.summary = asString(
    controlSurface.summary,
    controlSurface.available ? "Companion bridge ready." : "Companion bridge unavailable."
  );
  runtime.controlSurface = controlSurface;
  state.appSnapshot.runtime = runtime;

  commissioning.hasCompletedSetup = hasCompletedSetup;
  commissioning.runnerStage = runnerStage;
  commissioning.stage = stage;
  commissioning.hardwareProfile = hardwareProfile;
  commissioning.summary = state.commissioningSnapshot.summary;
  state.appSnapshot.commissioning = commissioning;

  state.appSnapshot.planning = {
    settingsPrefix: asString(planningAppSnapshot.settingsPrefix, "planning."),
    viewFilter: planningSettings.viewFilter,
    sortBy: planningSettings.sortBy,
    dashboardView: planningSettings.dashboardView,
    deckMode: planningSettings.deckMode,
    modeSection: planningSettings.modeSection,
    timelineStartHour: planningSettings.timelineStartHour,
    timelineEndHour: planningSettings.timelineEndHour,
    selectedProjectId: planningSettings.selectedProjectId,
    selectedTaskId: planningSettings.selectedTaskId,
  };

  shell.workspace = asString(shell.workspace, "setup");
  shellSetup.activeSection = asString(shellSetup.activeSection, "commissioning");
  shell.setup = shellSetup;
  shellLighting.currentSectionId =
    typeof shellLighting.currentSectionId === "string" ? shellLighting.currentSectionId : null;
  shellLighting.sceneThumbs = asRecord(shellLighting.sceneThumbs) ?? {};
  shellLighting.talentMarks =
    asArray(shellLighting.talentMarks).length > 0 ? normalizeTalentMarks(shellLighting.talentMarks) : [];
  shell.lighting = shellLighting;
  shell.summary = hasCompletedSetup ? "Operator surface ready." : "Commissioning required before operator mode.";
  state.appSnapshot.shell = shell;

  startup.targetSurface = startupTargetSurface;
  startup.operatorUiAllowed = hasCompletedSetup;
  state.appSnapshot.startup = startup;
  state.appSnapshot.summary = hasCompletedSetup ? "Setup ready." : "Setup required.";

  const lightingCheck = checks.find((check) => check.id === "lighting");
  const audioCheck = checks.find((check) => check.id === "audio");
  const controlSurfaceCheck = checks.find((check) => check.id === "control-surface");
  const lightingReady = asString(lightingCheck?.status) === "passed" || asString(lightingCheck?.status) === "ok";

  state.healthSnapshot.status = hasCompletedSetup && allChecksPassed ? "ok" : "attention";
  state.healthSnapshot.startupPhase = hasCompletedSetup ? "ready" : "waiting-for-app-snapshot";
  // Visual overhaul A, Slice 7: a published desk whose probes have gone off is
  // not "healthy and ready" — the summary the state display prints has to say
  // which of them needs attention, as the engine's own would.
  const unsettledCheckLabels = checks
    .filter((check) => asString(check.status) !== "passed" && asString(check.status) !== "ok")
    .map((check) => asString(check.label))
    .filter(Boolean);
  state.healthSnapshot.summary = !hasCompletedSetup
    ? "Storage healthy. Operator mode locked pending setup."
    : allChecksPassed
      ? "System healthy and ready."
      : `Operator mode is available, but ${unsettledCheckLabels.join(" and ")} need attention.`;
  state.healthSnapshot.checks = {
    lighting: {
      status:
        asString(lightingCheck?.status) === "passed" || asString(lightingCheck?.status) === "ok" ? "ok" : "attention",
      summary: asString(lightingCheck?.message, "Bridge not commissioned."),
    },
    audio: {
      status: asString(audioCheck?.status) === "passed" || asString(audioCheck?.status) === "ok" ? "ok" : "attention",
      summary: asString(audioCheck?.message, "Console not commissioned."),
    },
    controlSurface: {
      status:
        asString(controlSurfaceCheck?.status) === "passed" || asString(controlSurfaceCheck?.status) === "ok"
          ? "ok"
          : "attention",
      summary: asString(controlSurfaceCheck?.message, "Control surface not verified."),
    },
  };

  state.supportSnapshot.backups = backups;
  state.supportSnapshot.backupDir = asString(
    state.supportSnapshot.backupDir,
    asString(asRecord(runtime.paths)?.backupDir)
  );
  state.supportSnapshot.backupCount = backups.length;
  state.supportSnapshot.latestBackupPath = backups[0]?.path ?? null;
  state.supportSnapshot.restoreSummary = asString(
    state.supportSnapshot.restoreSummary,
    "Restore a backup archive or a database backup from the backups folder. A rollback backup is written first; a database backup takes effect once Studio Control has restarted its hardware link."
  );
  state.supportSnapshot.recentBackups = backups.map((entry) =>
    new Date(asNumber(entry.modifiedAt, Date.now())).toISOString()
  );
  state.supportSnapshot.summary =
    backups.length > 0
      ? `Latest backup exported ${new Intl.DateTimeFormat(undefined, {
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(asNumber(backups[0].modifiedAt, Date.now())))}.`
      : "No backup exported yet.";

  lightingSnapshot.adapterMode = asString(lightingSnapshot.adapterMode, "fixture");
  lightingSnapshot.bridgeIp = asString(
    lightingSnapshot.bridgeIp,
    asString(state.commissioningSnapshot.lighting.bridgeIp, "")
  );
  lightingSnapshot.universe = asNumber(
    lightingSnapshot.universe,
    asNumber(state.commissioningSnapshot.lighting.universe, 1)
  );
  lightingSnapshot.enabled = asBoolean(lightingSnapshot.enabled, lightingSnapshot.bridgeIp !== "");
  lightingSnapshot.connected = asBoolean(lightingSnapshot.connected, lightingReady);
  lightingSnapshot.reachable = asBoolean(lightingSnapshot.reachable, lightingReady);
  lightingSnapshot.status = asString(
    lightingSnapshot.status,
    lightingReady ? "ready" : lightingSnapshot.bridgeIp ? "attention" : "unconfigured"
  );
  lightingSnapshot.summary = asString(
    lightingSnapshot.summary,
    asString(asRecord(asRecord(state.healthSnapshot.checks)?.lighting)?.summary, "Lighting snapshot pending.")
  );
  lightingSnapshot.lastActionStatus = asString(lightingSnapshot.lastActionStatus, "idle");
  lightingSnapshot.lastActionCode =
    typeof lightingSnapshot.lastActionCode === "string" ? lightingSnapshot.lastActionCode : null;
  lightingSnapshot.lastActionMessage =
    typeof lightingSnapshot.lastActionMessage === "string" ? lightingSnapshot.lastActionMessage : null;
  lightingSnapshot.fixtures = asArray(lightingSnapshot.fixtures)
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null)
    .map((fixture) => normalizeLightingFixtureSnapshotEntry(fixture, asNumber(lightingSnapshot.universe, 1)));
  lightingSnapshot.previewFixtures = asArray(lightingSnapshot.previewFixtures)
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null)
    .map((fixture) => normalizeLightingFixtureSnapshotEntry(fixture, asNumber(lightingSnapshot.universe, 1)));
  lightingSnapshot.groups = asArray(lightingSnapshot.groups);
  lightingSnapshot.scenes = asArray(lightingSnapshot.scenes).map((scene) => {
    const sceneRecord = asRecord(scene);
    if (!sceneRecord) return scene;
    return {
      ...sceneRecord,
      fixtureStates: asArray(sceneRecord.fixtureStates)
        .map((fixtureState) => asRecord(fixtureState))
        .filter((fixtureState): fixtureState is JsonObject => fixtureState !== null)
        .map((fixtureState) => ({
          ...fixtureState,
          controlValues: asRecord(fixtureState.controlValues) ?? {},
        })),
    };
  });
  lightingSnapshot.palettes = Object.prototype.hasOwnProperty.call(lightingSnapshot, "palettes")
    ? lightingPalettes(lightingSnapshot)
        .flatMap((palette): JsonObject[] => {
          const kind = normalizePaletteKind(palette.kind);
          const id = asString(palette.id).trim();
          const name = asString(palette.name).trim();
          if (!kind || !id || !name) return [];
          return [
            {
              id,
              name,
              kind,
              value: normalizePaletteValue(kind, palette.value),
              colorIndex:
                typeof palette.colorIndex === "number" && Number.isInteger(palette.colorIndex)
                  ? clampNumber(palette.colorIndex, 0, 7)
                  : null,
            },
          ];
        })
        .sort((left, right) => {
          if (left.kind === right.kind) return 0;
          return left.kind === "intensity" ? -1 : 1;
        })
    : defaultLightingPalettes();
  lightingSnapshot.selectedSceneId =
    typeof lightingSnapshot.selectedSceneId === "string" ? lightingSnapshot.selectedSceneId : null;
  lightingSnapshot.selectedFixtureId =
    typeof lightingSnapshot.selectedFixtureId === "string" ? lightingSnapshot.selectedFixtureId : null;
  state.lightingSnapshot = lightingSnapshot;

  const audioSnapshotRecord = asRecord(state.audioSnapshot);
  if (!audioSnapshotRecord) {
    state.audioSnapshot = null;
    return;
  }

  const audioReady = asString(audioCheck?.status) === "passed" || asString(audioCheck?.status) === "ok";
  const audioFailed = asString(audioCheck?.status) === "failed" || asString(audioCheck?.status) === "error";

  audioSnapshotRecord.adapterMode = asString(audioSnapshotRecord.adapterMode, "simulated");
  audioSnapshotRecord.meteringSource = asString(
    audioSnapshotRecord.meteringSource,
    SIMULATED_AUDIO_ADAPTER_MODES.has(audioSnapshotRecord.adapterMode) ? "simulated" : "rme-totalmix-osc"
  );
  audioSnapshotRecord.sendHost = asString(
    audioSnapshotRecord.sendHost,
    asString(state.commissioningSnapshot.audio.sendHost, "127.0.0.1")
  );
  audioSnapshotRecord.sendPort = asNumber(
    audioSnapshotRecord.sendPort,
    asNumber(state.commissioningSnapshot.audio.sendPort, 7001)
  );
  audioSnapshotRecord.receivePort = asNumber(
    audioSnapshotRecord.receivePort,
    asNumber(state.commissioningSnapshot.audio.receivePort, 9001)
  );
  audioSnapshotRecord.oscEnabled = asBoolean(audioSnapshotRecord.oscEnabled, true);
  audioSnapshotRecord.status = audioSnapshotRecord.oscEnabled
    ? audioReady
      ? "ready"
      : audioFailed
        ? "attention"
        : "not-verified"
    : "not-verified";
  audioSnapshotRecord.connected = audioSnapshotRecord.status === "ready";
  audioSnapshotRecord.verified = audioSnapshotRecord.status === "ready";
  audioSnapshotRecord.meteringState = !audioSnapshotRecord.oscEnabled
    ? "disabled"
    : audioSnapshotRecord.meteringSource === "simulated"
      ? "simulated"
      : audioSnapshotRecord.verified
        ? "live"
        : audioFailed
          ? "offline"
          : "offline";
  audioSnapshotRecord.expectedPeakData = asBoolean(audioSnapshotRecord.expectedPeakData, true);
  audioSnapshotRecord.expectedSubmixLock = asBoolean(audioSnapshotRecord.expectedSubmixLock, true);
  audioSnapshotRecord.expectedCompatibilityMode = asBoolean(audioSnapshotRecord.expectedCompatibilityMode, false);
  audioSnapshotRecord.fadersPerBank = clampNumber(Math.round(asNumber(audioSnapshotRecord.fadersPerBank, 12)), 1, 24);
  audioSnapshotRecord.viewMode = audioSnapshotRecord.viewMode === "master" ? "master" : "submix";
  audioSnapshotRecord.consoleStateConfidence = (() => {
    const confidence = asString(audioSnapshotRecord.consoleStateConfidence, "unknown");
    if (confidence === "aligned" || confidence === "assumed") {
      return confidence;
    }
    return "unknown";
  })();
  audioSnapshotRecord.lastConsoleSyncAt =
    typeof audioSnapshotRecord.lastConsoleSyncAt === "string" ? audioSnapshotRecord.lastConsoleSyncAt : null;
  audioSnapshotRecord.lastConsoleSyncReason =
    typeof audioSnapshotRecord.lastConsoleSyncReason === "string" ? audioSnapshotRecord.lastConsoleSyncReason : null;
  audioSnapshotRecord.lastRecalledSnapshotId =
    typeof audioSnapshotRecord.lastRecalledSnapshotId === "string" ? audioSnapshotRecord.lastRecalledSnapshotId : null;
  audioSnapshotRecord.lastSnapshotRecallAt =
    typeof audioSnapshotRecord.lastSnapshotRecallAt === "string" ? audioSnapshotRecord.lastSnapshotRecallAt : null;
  audioSnapshotRecord.lastActionStatus = asString(audioSnapshotRecord.lastActionStatus, "idle");
  audioSnapshotRecord.lastActionCode =
    typeof audioSnapshotRecord.lastActionCode === "string" ? audioSnapshotRecord.lastActionCode : null;
  audioSnapshotRecord.lastActionMessage =
    typeof audioSnapshotRecord.lastActionMessage === "string" ? audioSnapshotRecord.lastActionMessage : null;
  audioSnapshotRecord.channels = asArray(audioSnapshotRecord.channels)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .map((channel) => ({
      ...channel,
      meterLeft: clampNumber(asNumber(channel.meterLeft, 0), 0, 1),
      meterRight: clampNumber(asNumber(channel.meterRight, 0), 0, 1),
      meterLevel: clampNumber(asNumber(channel.meterLevel, 0), 0, 1),
      peakHold: clampNumber(asNumber(channel.peakHold, asNumber(channel.meterLevel, 0)), 0, 1),
      peakHoldLeft: clampNumber(
        asNumber(channel.peakHoldLeft, asNumber(channel.peakHold, asNumber(channel.meterLeft, 0))),
        0,
        1
      ),
      peakHoldRight: clampNumber(
        asNumber(channel.peakHoldRight, asNumber(channel.peakHold, asNumber(channel.meterRight, 0))),
        0,
        1
      ),
      pad: false,
      eq: normalizeAudioEq(asRecord(channel.eq)),
      dynamics: asRecord(channel.dynamics) ?? buildAudioDynamics(),
      sendModes: asRecord(channel.sendModes) ?? buildAudioSendModes(),
    }));
  audioSnapshotRecord.mixTargets = asArray(audioSnapshotRecord.mixTargets)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .map((mixTarget) => ({
      ...mixTarget,
      meterLeft: clampNumber(asNumber(mixTarget.meterLeft, 0), 0, 1),
      meterRight: clampNumber(asNumber(mixTarget.meterRight, 0), 0, 1),
      meterLevel: clampNumber(asNumber(mixTarget.meterLevel, 0), 0, 1),
      peakHold: clampNumber(asNumber(mixTarget.peakHold, asNumber(mixTarget.meterLevel, 0)), 0, 1),
      peakHoldLeft: clampNumber(
        asNumber(mixTarget.peakHoldLeft, asNumber(mixTarget.peakHold, asNumber(mixTarget.meterLeft, 0))),
        0,
        1
      ),
      peakHoldRight: clampNumber(
        asNumber(mixTarget.peakHoldRight, asNumber(mixTarget.peakHold, asNumber(mixTarget.meterRight, 0))),
        0,
        1
      ),
    }));
  audioSnapshotRecord.snapshots = asArray(audioSnapshotRecord.snapshots)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .sort((left, right) => asNumber(left.order) - asNumber(right.order))
    .map((entry) => ({
      ...entry,
      lastRecalled: asString(audioSnapshotRecord.lastRecalledSnapshotId) === asString(entry.id),
      lastRecalledAt:
        asString(audioSnapshotRecord.lastRecalledSnapshotId) === asString(entry.id)
          ? audioSnapshotRecord.lastSnapshotRecallAt
          : null,
      contents: asRecord(entry.contents) ?? null,
      preview: asRecord(entry.preview) ?? buildAudioSnapshotPreview(Boolean(asRecord(entry.contents))),
    }));
  const mixTargets = audioSnapshotRecord.mixTargets
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);
  const channels = audioSnapshotRecord.channels
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);
  audioSnapshotRecord.selectedMixTargetId = (() => {
    const selected = asString(audioSnapshotRecord.selectedMixTargetId);
    return mixTargets.some((entry) => asString(entry.id) === selected)
      ? selected
      : asString(mixTargets[0]?.id, "audio-mix-main");
  })();
  audioSnapshotRecord.selectedChannelId = (() => {
    const selected = asString(audioSnapshotRecord.selectedChannelId);
    return channels.some((entry) => asString(entry.id) === selected) ? selected : null;
  })();
  audioSnapshotRecord.summary = !audioSnapshotRecord.oscEnabled
    ? `OSC control is switched off in Setup. The last endpoint was ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} (receive ports ${audioSnapshotRecord.receivePort}-${audioSnapshotRecord.receivePort + 2}).`
    : audioSnapshotRecord.meteringSource === "simulated"
      ? `Test mode: the console is simulated and nothing reaches TotalMix.`
      : audioSnapshotRecord.status === "ready"
        ? `TotalMix on ${audioSnapshotRecord.sendHost} is answering (send ${audioSnapshotRecord.sendPort}-${audioSnapshotRecord.sendPort + 2}, receive ${audioSnapshotRecord.receivePort}-${audioSnapshotRecord.receivePort + 2}).`
        : audioSnapshotRecord.status === "attention"
          ? `No meter data from TotalMix on ${audioSnapshotRecord.sendHost}.`
          : `TotalMix on ${audioSnapshotRecord.sendHost} is not verified yet — run the audio probe.`;
  refreshAudioCapabilities(audioSnapshotRecord, state);
  state.audioSnapshot = audioSnapshotRecord;
  refreshFixtureAudioMetering(state);
}

export function updateFixtureCheck(
  state: MutableFixtureState,
  target: CommissioningCheckTarget,
  status: "passed" | "failed",
  message: string
) {
  const checks = ensureCommissioningChecks(state);
  const checkId = target;
  const labelMap = {
    audio: "Audio OSC Probe",
    "control-surface": "Control Surface Probe",
    lighting: "Lighting Bridge Probe",
  } as const;
  const checkedAt = new Date().toISOString();

  const check = checks.find((entry) => entry.id === checkId);
  if (check) {
    check.label = labelMap[target];
    check.status = status;
    check.message = message;
    // A fresh probe result replaces the last one: a scenario that seeded its
    // own `detail` must not keep printing it after the probe has run.
    check.detail = message;
    check.checkedAt = checkedAt;
  }

  if (target === "control-surface") {
    state.commissioningSnapshot.runnerStage =
      normalizeRunnerStage(state.commissioningSnapshot.runnerStage, state.commissioningSnapshot.stage) === "publish"
        ? "publish"
        : "probe";
  }
}

export function countPlanningActivity(state: MutableFixtureState) {
  const activityEntries = asArray(asRecord(state.planningSnapshot)?.activityLog);
  return Math.max(1, activityEntries.length);
}

export function validateIpv4(value: string) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value.trim());
}

export function validatePort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function buildFixtureBackupEntry(state: MutableFixtureState) {
  const backupDir = asString(state.supportSnapshot.backupDir);
  const modifiedAt = Date.now();
  const timestamp = new Date(modifiedAt).toISOString().replaceAll(":", "-");
  const fileName = `native-backup-${timestamp}.json`;

  return {
    kind: "archive",
    name: fileName,
    path: `${backupDir}/${fileName}`,
    sizeBytes: 4096,
    modifiedAt,
  };
}

// 2026-09 production readiness, Slice 7 (F29): only a file inside the backups
// folder can be named, and it must be one the fixture lists (a legacy
// `db.json` inside the folder counts, as the engine's importer accepts it).
// The sentences mirror the engine's.
export function findFixtureBackup(state: MutableFixtureState, path: string) {
  const backupDir = asString(state.supportSnapshot.backupDir);
  if (!path.startsWith(backupDir)) {
    throw new Error(
      `Only files inside the backups folder can be restored or verified: ${path} is outside ${backupDir}.`
    );
  }
  const match = asArray(state.supportSnapshot.backups)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .find((entry) => entry.path === path);
  if (!match && !path.endsWith("db.json")) {
    throw new Error(`Backup file was not found: ${path}`);
  }
  return match ?? null;
}
