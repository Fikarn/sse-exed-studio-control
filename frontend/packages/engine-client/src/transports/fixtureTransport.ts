import type { EventEnvelope, EventName, JsonObject, JsonValue, RequestMethod } from "../generated/protocol";
import type {
  CommissioningCheckTarget,
  CommissioningStage,
  EngineTransport,
  FixtureScenario,
  RunnerStage,
} from "../types";

interface MutableFixtureState {
  appSnapshot: JsonObject;
  healthSnapshot: JsonObject;
  commissioningSnapshot: JsonObject;
  lightingSnapshot: JsonObject;
  audioSnapshot: JsonObject | null;
  planningSnapshot: JsonObject | null;
  supportSnapshot: JsonObject;
  controlSurfaceSnapshot: JsonObject;
}

function fixtureEvent<TEvent extends EventName>(event: TEvent, payload: JsonObject = {}) {
  return {
    type: "event",
    event,
    payload,
  } satisfies EventEnvelope<TEvent>;
}

function cloneJson<T extends JsonValue>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function asArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function lightingFixtures(snapshot: JsonObject, key: "fixtures" | "previewFixtures" = "fixtures"): JsonObject[] {
  return asArray(snapshot[key])
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null);
}

function lightingScenes(snapshot: JsonObject): JsonObject[] {
  return asArray(snapshot.scenes)
    .map((scene) => asRecord(scene))
    .filter((scene): scene is JsonObject => scene !== null);
}

function lightingPalettes(snapshot: JsonObject): JsonObject[] {
  return asArray(snapshot.palettes)
    .map((palette) => asRecord(palette))
    .filter((palette): palette is JsonObject => palette !== null);
}

function lightingPreviewActive(snapshot: JsonObject): boolean {
  return asBoolean(snapshot.previewMode, false);
}

function previewFixturesFromScene(liveFixtures: readonly JsonObject[], scene: JsonObject): JsonObject[] {
  const fixtureStates = asArray(scene.fixtureStates)
    .map((fixtureState) => asRecord(fixtureState))
    .filter((fixtureState): fixtureState is JsonObject => fixtureState !== null);

  return liveFixtures.map((fixture) => {
    const nextState = fixtureStates.find((fixtureState) => asString(fixtureState.fixtureId) === asString(fixture.id));
    if (!nextState) return fixture;
    return {
      ...fixture,
      cct: asNumber(nextState.cct, asNumber(fixture.cct, 3200)),
      intensity: asNumber(nextState.intensity, asNumber(fixture.intensity, 0)),
      on: asBoolean(nextState.on, asBoolean(fixture.on, false)),
    };
  });
}

function clearLightingPreview(snapshot: JsonObject) {
  snapshot.previewMode = false;
  snapshot.previewDirty = false;
  snapshot.previewSceneId = null;
  snapshot.previewFixtures = [];
}

function normalizeRunnerStage(stage: unknown, legacyStage: unknown): RunnerStage {
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

function legacyStageFromRunnerStage(runnerStage: RunnerStage, hasCompletedSetup: boolean): CommissioningStage {
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

function ensurePaths(state: MutableFixtureState) {
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

function countControls(state: MutableFixtureState) {
  const pages = asArray(state.controlSurfaceSnapshot.pages);
  return pages.reduce<number>((total, page) => {
    const record = asRecord(page);
    if (!record) {
      return total;
    }

    return total + asArray(record.buttons).length + asArray(record.dials).length;
  }, 0);
}

function buildDefaultControlSurfaceSnapshot(): JsonObject {
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

function buildDefaultLightingSnapshot(): JsonObject {
  return {
    status: "unconfigured",
    summary: "Lighting snapshot has not been commissioned yet.",
    adapterMode: "fixture",
    bridgeIp: "",
    universe: 1,
    enabled: false,
    grandMaster: 100,
    connected: false,
    reachable: false,
    lastActionStatus: "idle",
    fixtures: [],
    groups: [],
    scenes: [],
    palettes: defaultLightingPalettes(),
    previewMode: false,
    previewDirty: false,
    previewSceneId: null,
    previewFixtures: [],
    selectedSceneId: null,
    selectedFixtureId: null,
  };
}

function buildDefaultPlanningSnapshot(): JsonObject {
  return {
    projects: [],
    tasks: [],
    activityLog: [],
    settings: {
      viewFilter: "all",
      sortBy: "manual",
      dashboardView: "kanban",
      deckMode: "project",
      modeSection: "timeline",
      timelineStartHour: 9,
      timelineEndHour: 22,
      selectedProjectId: null,
      selectedTaskId: null,
    },
    counts: {
      projectCount: 0,
      taskCount: 0,
      runningTaskCount: 0,
      completedTaskCount: 0,
    },
  };
}

function buildAudioMixLevels(main: number, phonesA: number, phonesB: number) {
  return {
    "audio-mix-main": main,
    "audio-mix-phones-a": phonesA,
    "audio-mix-phones-b": phonesB,
  };
}

function buildAudioChannel(
  id: string,
  name: string,
  shortName: string,
  role: string,
  stereo: boolean,
  gain: number,
  mixLevels: Record<string, number>,
  meterLevel: number,
  options: Partial<JsonObject> = {}
): JsonObject {
  const meterLeft = stereo ? Math.max(0, meterLevel - 0.04) : meterLevel;
  const meterRight = stereo ? meterLevel : Math.max(0, meterLevel - 0.03);

  return {
    id,
    name,
    shortName,
    role,
    stereo,
    gain,
    fader: typeof mixLevels["audio-mix-main"] === "number" ? mixLevels["audio-mix-main"] : 0,
    meterLeft,
    meterRight,
    meterLevel,
    peakHold: Math.min(1, meterLevel + 0.08),
    clip: options.clip === true,
    mixLevels,
    mute: options.mute === true,
    solo: options.solo === true,
    phantom: role === "front-preamp",
    phase: options.phase === true,
    pad: options.pad === true,
    instrument: options.instrument === true,
    autoSet: options.autoSet === true,
  };
}

function buildDefaultAudioSnapshot(): JsonObject {
  return {
    status: "ready",
    summary:
      "OSC transport is configured for 127.0.0.1:7001 with receive port 9001. Simulated inventory exposes 18 channels, 3 mix targets, and 5 snapshots for native audio development.",
    adapterMode: "simulated",
    sendHost: "127.0.0.1",
    sendPort: 7001,
    receivePort: 9001,
    oscEnabled: true,
    connected: true,
    verified: true,
    meteringState: "transport-only",
    selectedChannelId: "audio-playback-3-4",
    selectedMixTargetId: "audio-mix-main",
    expectedPeakData: true,
    expectedSubmixLock: true,
    expectedCompatibilityMode: false,
    fadersPerBank: 12,
    consoleStateConfidence: "aligned",
    lastConsoleSyncAt: "2026-04-23T18:24:12+02:00",
    lastConsoleSyncReason: "manual sync",
    lastRecalledSnapshotId: "snapshot-show-open",
    lastSnapshotRecallAt: "2026-04-23T18:05:43+02:00",
    lastActionStatus: "succeeded",
    lastActionCode: null,
    lastActionMessage: "Sync succeeded",
    channels: [
      buildAudioChannel(
        "audio-input-9",
        "Host",
        "HOST",
        "front-preamp",
        false,
        34,
        buildAudioMixLevels(0.84, 0.78, 0.62),
        0.82
      ),
      buildAudioChannel(
        "audio-input-10",
        "Guest",
        "GST",
        "front-preamp",
        false,
        34,
        buildAudioMixLevels(0.72, 0.68, 0.54),
        0.68
      ),
      buildAudioChannel(
        "audio-input-11",
        "Boom",
        "BOOM",
        "front-preamp",
        false,
        32,
        buildAudioMixLevels(0.54, 0.42, 0.34),
        0.54
      ),
      buildAudioChannel(
        "audio-input-12",
        "Guitar DI",
        "GTR",
        "front-preamp",
        false,
        24,
        buildAudioMixLevels(0.22, 0.12, 0.1),
        0.2,
        { instrument: true }
      ),
      buildAudioChannel(
        "audio-input-1",
        "Line 1",
        "L1",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.18, 0.12, 0.1),
        0.16
      ),
      buildAudioChannel(
        "audio-input-2",
        "Line 2",
        "L2",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.14, 0.1, 0.08),
        0.12
      ),
      buildAudioChannel(
        "audio-input-3",
        "Remote A",
        "REM A",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.38, 0.32, 0.26),
        0.3,
        { mute: true }
      ),
      buildAudioChannel(
        "audio-input-4",
        "Remote B",
        "REM B",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.32, 0.26, 0.22),
        0.26,
        { mute: true }
      ),
      buildAudioChannel(
        "audio-input-5",
        "Line 5",
        "L5",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.1, 0.08, 0.06),
        0.09
      ),
      buildAudioChannel(
        "audio-input-6",
        "Line 6",
        "L6",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.08, 0.06, 0.05),
        0.07
      ),
      buildAudioChannel(
        "audio-input-7",
        "Line 7",
        "L7",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.06, 0.05, 0.04),
        0.05
      ),
      buildAudioChannel(
        "audio-input-8",
        "Line 8",
        "L8",
        "rear-line",
        false,
        0,
        buildAudioMixLevels(0.05, 0.04, 0.03),
        0.04
      ),
      buildAudioChannel(
        "audio-playback-1-2",
        "Program 1/2",
        "PGM",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.86, 0.68, 0.44),
        0.84
      ),
      buildAudioChannel(
        "audio-playback-3-4",
        "FX 3/4",
        "FX",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.82, 0.72, 0.58),
        0.8,
        { solo: true }
      ),
      buildAudioChannel(
        "audio-playback-5-6",
        "N-1 5/6",
        "N-1",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.4, 0.54, 0.38),
        0.44
      ),
      buildAudioChannel(
        "audio-playback-7-8",
        "Music 7/8",
        "MUS",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.62, 0.24, 0.2),
        0.6
      ),
      buildAudioChannel(
        "audio-playback-9-10",
        "Playback 9/10",
        "PB 9/10",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.14, 0.12, 0.12),
        0.16
      ),
      buildAudioChannel(
        "audio-playback-11-12",
        "Playback 11/12",
        "PB 11/12",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.12, 0.1, 0.1),
        0.14
      ),
    ],
    mixTargets: [
      {
        id: "audio-mix-main",
        name: "Main Out",
        shortName: "MAIN",
        role: "main-out",
        volume: 0.82,
        mute: false,
        dim: false,
        mono: false,
        talkback: false,
      },
      {
        id: "audio-mix-phones-a",
        name: "Phones 1",
        shortName: "HP 1",
        role: "phones-a",
        volume: 0.64,
        mute: false,
        dim: false,
        mono: false,
        talkback: true,
      },
      {
        id: "audio-mix-phones-b",
        name: "Phones 2",
        shortName: "HP 2",
        role: "phones-b",
        volume: 0.71,
        mute: false,
        dim: false,
        mono: true,
        talkback: false,
      },
    ],
    snapshots: [
      {
        id: "snapshot-open-rehearsal",
        name: "Open rehearsal",
        oscIndex: 0,
        order: 0,
        lastRecalled: false,
        lastRecalledAt: null,
      },
      {
        id: "snapshot-show-open",
        name: "Show open",
        oscIndex: 1,
        order: 1,
        lastRecalled: true,
        lastRecalledAt: "2026-04-23T18:05:43+02:00",
      },
      {
        id: "snapshot-interview-block",
        name: "Interview block",
        oscIndex: 2,
        order: 2,
        lastRecalled: false,
        lastRecalledAt: null,
      },
      {
        id: "snapshot-break-bumper",
        name: "Break bumper",
        oscIndex: 3,
        order: 3,
        lastRecalled: false,
        lastRecalledAt: null,
      },
      {
        id: "snapshot-credits",
        name: "Credits",
        oscIndex: 4,
        order: 4,
        lastRecalled: false,
        lastRecalledAt: null,
      },
    ],
  };
}

function buildSeededPlanningSnapshot(): JsonObject {
  return {
    projects: [
      {
        id: "proj-evening-service",
        title: "evening_service",
        description: "Tuesday evening run-of-show.",
        status: "todo",
        priority: "p1",
        createdAt: "2026-04-23T08:00:00+02:00",
        lastUpdated: "2026-04-23T19:12:00+02:00",
        order: 1,
      },
      {
        id: "proj-booth-2",
        title: "booth_2",
        description: "Secondary booth deck commissioning.",
        status: "in-progress",
        priority: "p1",
        createdAt: "2026-04-23T08:10:00+02:00",
        lastUpdated: "2026-04-23T19:24:00+02:00",
        order: 2,
      },
      {
        id: "proj-audio",
        title: "audio",
        description: "Audio desk prep and tuning.",
        status: "in-progress",
        priority: "p1",
        createdAt: "2026-04-23T08:20:00+02:00",
        lastUpdated: "2026-04-23T19:18:00+02:00",
        order: 3,
      },
      {
        id: "proj-lighting",
        title: "lighting",
        description: "Lighting fixes waiting on ops.",
        status: "blocked",
        priority: "p0",
        createdAt: "2026-04-23T08:30:00+02:00",
        lastUpdated: "2026-04-23T18:52:00+02:00",
        order: 4,
      },
      {
        id: "proj-ops",
        title: "ops",
        description: "Shared operator maintenance.",
        status: "todo",
        priority: "p2",
        createdAt: "2026-04-23T08:40:00+02:00",
        lastUpdated: "2026-04-23T16:06:00+02:00",
        order: 5,
      },
    ],
    tasks: [
      {
        id: "task-import-profile",
        projectId: "proj-evening-service",
        title: "Import companion profile",
        description: "",
        priority: "p2",
        dueDate: null,
        labels: ["setup"],
        checklist: [],
        isRunning: false,
        totalSeconds: 1200,
        lastStarted: null,
        completed: true,
        order: 1,
        createdAt: "2026-04-23T09:05:00+02:00",
        scheduledStart: "2026-04-23T09:30:00+02:00",
        scheduledDurationSeconds: 1200,
      },
      {
        id: "task-probe-hardware",
        projectId: "proj-evening-service",
        title: "Probe hardware · DMX/OSC",
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["setup"],
        checklist: [],
        isRunning: false,
        totalSeconds: 2100,
        lastStarted: null,
        completed: true,
        order: 2,
        createdAt: "2026-04-23T09:50:00+02:00",
        scheduledStart: "2026-04-23T10:15:00+02:00",
        scheduledDurationSeconds: 2100,
      },
      {
        id: "task-house-light",
        projectId: "proj-evening-service",
        title: 'House-light scene "preshow"',
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["lighting"],
        checklist: [],
        isRunning: false,
        totalSeconds: 2100,
        lastStarted: null,
        completed: true,
        order: 3,
        createdAt: "2026-04-23T16:00:00+02:00",
        scheduledStart: "2026-04-23T16:35:00+02:00",
        scheduledDurationSeconds: 2100,
      },
      {
        id: "task-draft-run-of-show",
        projectId: "proj-evening-service",
        title: "Draft run-of-show · Tue",
        description: "",
        priority: "p0",
        dueDate: null,
        labels: ["planning"],
        checklist: [],
        isRunning: false,
        totalSeconds: 0,
        lastStarted: null,
        completed: false,
        order: 4,
        createdAt: "2026-04-23T18:00:00+02:00",
        scheduledStart: "2026-04-23T20:30:00+02:00",
        scheduledDurationSeconds: 7200,
      },
      {
        id: "task-verify-osc",
        projectId: "proj-booth-2",
        title: "Verify OSC bindings",
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["audio"],
        checklist: [],
        isRunning: false,
        totalSeconds: 1080,
        lastStarted: null,
        completed: true,
        order: 1,
        createdAt: "2026-04-23T16:00:00+02:00",
        scheduledStart: "2026-04-23T16:24:00+02:00",
        scheduledDurationSeconds: 1080,
      },
      {
        id: "task-commission-streamdeck",
        projectId: "proj-booth-2",
        title: "Commission Stream Deck+ · Booth 2",
        description: "",
        priority: "p0",
        dueDate: null,
        labels: ["control-surface"],
        checklist: [],
        isRunning: true,
        totalSeconds: 4680,
        lastStarted: "2026-04-23T18:24:00+02:00",
        completed: false,
        order: 2,
        createdAt: "2026-04-23T18:10:00+02:00",
        scheduledStart: "2026-04-23T18:24:00+02:00",
        scheduledDurationSeconds: 5100,
      },
      {
        id: "task-level-match",
        projectId: "proj-audio",
        title: "Level-match overflow",
        description: "",
        priority: "p1",
        dueDate: null,
        labels: ["audio"],
        checklist: [],
        isRunning: true,
        totalSeconds: 2520,
        lastStarted: "2026-04-23T19:00:00+02:00",
        completed: false,
        order: 1,
        createdAt: "2026-04-23T18:45:00+02:00",
        scheduledStart: "2026-04-23T19:00:00+02:00",
        scheduledDurationSeconds: 5400,
      },
      {
        id: "task-dmx-splitter",
        projectId: "proj-lighting",
        title: "DMX splitter · stage right",
        description: "",
        priority: "p0",
        dueDate: null,
        labels: ["lighting"],
        checklist: [],
        isRunning: false,
        totalSeconds: 0,
        lastStarted: null,
        completed: false,
        order: 1,
        createdAt: "2026-04-23T16:45:00+02:00",
        scheduledStart: "2026-04-23T17:00:00+02:00",
        scheduledDurationSeconds: 10800,
      },
      {
        id: "task-save-backup",
        projectId: "proj-ops",
        title: "Save backup · pre-service",
        description: "",
        priority: "p2",
        dueDate: null,
        labels: ["support"],
        checklist: [],
        isRunning: false,
        totalSeconds: 240,
        lastStarted: null,
        completed: true,
        order: 1,
        createdAt: "2026-04-23T15:50:00+02:00",
        scheduledStart: "2026-04-23T16:02:00+02:00",
        scheduledDurationSeconds: 240,
      },
      {
        id: "task-archive-cues",
        projectId: "proj-ops",
        title: "Archive Q3 cue library",
        description: "",
        priority: "p3",
        dueDate: null,
        labels: ["support"],
        checklist: [],
        isRunning: false,
        totalSeconds: 0,
        lastStarted: null,
        completed: false,
        order: 2,
        createdAt: "2026-04-23T10:30:00+02:00",
        scheduledStart: null,
        scheduledDurationSeconds: null,
      },
    ],
    activityLog: [
      {
        id: "planning-activity-1",
        timestamp: "2026-04-23T18:24:00+02:00",
        entityType: "task",
        entityId: "task-commission-streamdeck",
        action: "timer-started",
        detail: "Stream Deck+ booth commissioning resumed.",
      },
      {
        id: "planning-activity-2",
        timestamp: "2026-04-23T19:00:00+02:00",
        entityType: "task",
        entityId: "task-level-match",
        action: "timer-started",
        detail: "Audio level-matching is in progress.",
      },
    ],
    settings: {
      viewFilter: "all",
      sortBy: "manual",
      dashboardView: "kanban",
      deckMode: "project",
      modeSection: "timeline",
      timelineStartHour: 9,
      timelineEndHour: 22,
      selectedProjectId: "proj-booth-2",
      selectedTaskId: "task-commission-streamdeck",
    },
  };
}

function normalizePlanningModeSection(value: unknown) {
  return value === "board" ? "board" : "timeline";
}

function normalizePlanningViewFilter(value: unknown) {
  return value === "todo" || value === "in-progress" || value === "blocked" || value === "done" ? value : "all";
}

function normalizePlanningProjectStatus(value: unknown) {
  return value === "in-progress" || value === "blocked" || value === "done" ? value : "todo";
}

function normalizePlanningPriority(value: unknown) {
  return value === "p0" || value === "p1" || value === "p3" ? value : "p2";
}

function buildPlanningTimeReport(state: MutableFixtureState, projectId?: string | null): JsonObject {
  const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
  const projects = asArray(planningSnapshot.projects)
    .map((project) => asRecord(project))
    .filter((project): project is JsonObject => project !== null);
  const tasks = asArray(planningSnapshot.tasks)
    .map((task) => asRecord(task))
    .filter((task): task is JsonObject => task !== null)
    .filter((task) => (projectId ? asString(task.projectId) === projectId : true));
  const activityLog = asArray(planningSnapshot.activityLog)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null);

  const projectTotals = new Map<string, JsonObject>();
  for (const task of tasks) {
    const taskProjectId = asString(task.projectId);
    if (!taskProjectId) {
      continue;
    }

    const project = projects.find((entry) => asString(entry.id) === taskProjectId) ?? null;
    const entry = projectTotals.get(taskProjectId) ?? {
      projectId: taskProjectId,
      title: asString(project?.title, "Unknown"),
      totalSeconds: 0,
      taskCount: 0,
    };
    entry.totalSeconds = asNumber(entry.totalSeconds) + Math.max(0, asNumber(task.totalSeconds));
    entry.taskCount = asNumber(entry.taskCount) + 1;
    projectTotals.set(taskProjectId, entry);
  }

  const byProject = Array.from(projectTotals.values()).sort(
    (left, right) => asNumber(right.totalSeconds) - asNumber(left.totalSeconds)
  );

  const byTask = tasks
    .filter((task) => asNumber(task.totalSeconds) > 0)
    .map((task) => {
      const taskProjectId = asString(task.projectId);
      const project = projects.find((entry) => asString(entry.id) === taskProjectId) ?? null;
      return {
        taskId: asString(task.id),
        taskTitle: asString(task.title, "Task"),
        projectId: taskProjectId,
        projectTitle: asString(project?.title, "Unknown"),
        totalSeconds: Math.max(0, asNumber(task.totalSeconds)),
        isRunning: asBoolean(task.isRunning),
        lastStarted: typeof task.lastStarted === "string" ? task.lastStarted : null,
      };
    })
    .sort((left, right) => asNumber(right.totalSeconds) - asNumber(left.totalSeconds));

  const timerEvents = activityLog
    .filter((entry) => {
      const action = asString(entry.action);
      return (
        action === "timer-started" ||
        action === "timer-stopped" ||
        action === "timer_started" ||
        action === "timer_stopped"
      );
    })
    .slice(0, 100);

  return {
    totalSeconds: tasks.reduce((total, task) => total + Math.max(0, asNumber(task.totalSeconds)), 0),
    byProject,
    byTask,
    timerEvents,
  };
}

function normalizeFixtureType(value: unknown) {
  const normalized = asString(value).trim().toLowerCase();
  switch (normalized) {
    case "astra":
    case "astra bi-color":
    case "astra-bicolor":
      return "astra-bicolor";
    case "infinimat":
      return "infinimat";
    case "infinibar":
    case "infinibar pb12":
    case "infinibar-pb12":
      return "infinibar-pb12";
    default:
      return normalized;
  }
}

function lightingFixtureChannelCount(fixtureType: string) {
  switch (fixtureType) {
    case "infinimat":
      return 4;
    case "infinibar-pb12":
      return 8;
    default:
      return 2;
  }
}

function lightingFixtureMaxStartAddress(fixtureType: string) {
  return 512 - lightingFixtureChannelCount(fixtureType) + 1;
}

function lightingFixtureChannelLabels(fixtureType: string) {
  switch (fixtureType) {
    case "astra-bicolor":
      return ["Dimmer", "CCT"];
    case "infinimat":
      return ["Dimmer", "CCT", "±G/M", "Strobe"];
    case "infinibar-pb12":
      return ["Dimmer", "CCT", "Mix", "Red", "Green", "Blue", "FX", "Speed"];
    default:
      return [];
  }
}

function lightingFixtureCctRange(fixtureType: string) {
  switch (fixtureType) {
    case "infinimat":
    case "infinibar-pb12":
      return { max: 10_000, min: 2_000 };
    default:
      return { max: 5_600, min: 3_200 };
  }
}

function defaultLightingFixtureCct(fixtureType: string) {
  switch (fixtureType) {
    case "infinimat":
    case "infinibar-pb12":
      return 5_600;
    default:
      return 4_400;
  }
}

function defaultLightingPalettes(): JsonObject[] {
  return [
    { id: "palette-intensity-low", name: "Low", kind: "intensity", value: 10, colorIndex: 5 },
    { id: "palette-intensity-quarter", name: "Quarter", kind: "intensity", value: 25, colorIndex: 4 },
    { id: "palette-intensity-half", name: "Half", kind: "intensity", value: 50, colorIndex: 2 },
    { id: "palette-intensity-full", name: "Full", kind: "intensity", value: 100, colorIndex: 0 },
    { id: "palette-cct-warm", name: "Warm", kind: "cct", value: 2700, colorIndex: 0 },
    { id: "palette-cct-studio", name: "Studio", kind: "cct", value: 4000, colorIndex: 4 },
    { id: "palette-cct-daylight", name: "Daylight", kind: "cct", value: 5600, colorIndex: 5 },
    { id: "palette-cct-cool", name: "Cool", kind: "cct", value: 6500, colorIndex: 5 },
  ];
}

function normalizePaletteKind(value: unknown): "intensity" | "cct" | null {
  const kind = asString(value).trim();
  return kind === "intensity" || kind === "cct" ? kind : null;
}

function normalizePaletteValue(kind: "intensity" | "cct", value: unknown) {
  const raw = asNumber(value, kind === "intensity" ? 50 : 4000);
  return kind === "intensity" ? clampNumber(raw, 0, 100) : clampNumber(raw, 2000, 10000);
}

function validatePaletteValue(kind: "intensity" | "cct", value: unknown) {
  const raw = asNumber(value, NaN);
  const min = kind === "intensity" ? 0 : 2000;
  const max = kind === "intensity" ? 100 : 10000;
  if (!Number.isFinite(raw) || raw < min || raw > max) {
    throw new Error(`Palette value must be between ${min} and ${max}.`);
  }
  return raw;
}

function parseLightingColorIndex(value: unknown): number | null {
  if (value === null) return null;
  const raw = asNumber(value, NaN);
  if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
    throw new Error("colorIndex must be an integer 0..7 or null");
  }
  return raw;
}

function formatLightingPaletteValue(kind: "intensity" | "cct", value: unknown) {
  const normalized = normalizePaletteValue(kind, value);
  return kind === "intensity" ? `${Math.round(normalized)}%` : `${Math.round(normalized)}K`;
}

function applyLightingPaletteToFixture(fixture: JsonObject, palette: JsonObject): JsonObject {
  const kind = normalizePaletteKind(palette.kind);
  if (kind === "intensity") {
    const intensity = Math.round(normalizePaletteValue(kind, palette.value));
    return {
      ...fixture,
      intensity,
      on: intensity > 0,
    };
  }
  if (kind === "cct") {
    const fixtureType = normalizeFixtureType(fixture.type);
    const cctRange = lightingFixtureCctRange(fixtureType);
    return {
      ...fixture,
      cct: clampNumber(Math.round(normalizePaletteValue(kind, palette.value)), cctRange.min, cctRange.max),
    };
  }
  return fixture;
}

function defaultLightingBeamAngle(fixtureType: string) {
  switch (fixtureType) {
    case "infinibar-pb12":
      return 110;
    case "infinimat":
      return 100;
    case "apollo-bridge":
    case "astra-bicolor":
      return 50;
    default:
      return 60;
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function intensityToDmx(percent: number) {
  return Math.round(clampNumber(percent, 0, 100) * 2.55);
}

function cctToDmx(kelvin: number, min: number, max: number) {
  const clamped = clampNumber(kelvin, min, max);
  return Math.round(((clamped - min) / (max - min)) * 255);
}

function buildLightingDmxMonitorSnapshot(lightingSnapshot: JsonObject | null): JsonObject {
  const fixtures = asArray(lightingSnapshot?.fixtures)
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null);
  const grandMaster = clampNumber(asNumber(lightingSnapshot?.grandMaster, 100), 0, 100) / 100;
  const channels: JsonObject[] = [];

  for (const fixture of fixtures) {
    const fixtureType = normalizeFixtureType(fixture.type);
    const channelCount = lightingFixtureChannelCount(fixtureType);
    const labels = lightingFixtureChannelLabels(fixtureType);
    const startAddress = asNumber(fixture.dmxStartAddress, 1);
    const dimmer = asBoolean(fixture.on, false)
      ? Math.round(intensityToDmx(asNumber(fixture.intensity, 0)) * grandMaster)
      : 0;
    const cctRange = lightingFixtureCctRange(fixtureType);

    for (let offset = 0; offset < channelCount; offset += 1) {
      const channel = startAddress + offset;
      let value = 0;
      if (offset === 0) {
        value = dimmer;
      } else if (offset === 1) {
        value = cctToDmx(asNumber(fixture.cct, 3200), cctRange.min, cctRange.max);
      }

      channels.push({
        channel,
        label: labels[offset] ?? `Ch${offset + 1}`,
        lightName: asString(fixture.name, asString(fixture.id, "Fixture")),
        value,
      });
    }
  }

  channels.sort((left, right) => asNumber(left.channel, 0) - asNumber(right.channel, 0));
  return { channels };
}

function buildLightingFixtureUpdateSummary(fixture: JsonObject) {
  const spatialRotation = asNumber(fixture.spatialRotation, 0);
  const spatialSummary =
    typeof fixture.spatialX === "number" && typeof fixture.spatialY === "number"
      ? `manual layout at ${Math.round(fixture.spatialX * 100)}% / ${Math.round(fixture.spatialY * 100)}% / ${Math.round(spatialRotation)}deg`
      : `auto layout / ${Math.round(spatialRotation)}deg`;
  const beamAngle = asNumber(fixture.beamAngleDegrees, defaultLightingBeamAngle(asString(fixture.type, "fixture")));
  const rigZSummary = typeof fixture.rigZ === "number" ? `${fixture.rigZ.toFixed(1)}m rig` : "auto rig height";
  const effect = asRecord(fixture.effect);
  const effectSummary =
    effect && typeof effect.effectType === "string"
      ? `${effect.effectType} at speed ${asNumber(effect.speed, 0)}`
      : "no effect";
  const groupId = asString(fixture.groupId).trim();

  return `Lighting fixture '${asString(fixture.name, "Fixture")}' (${asString(fixture.type, "fixture")}, DMX ${asNumber(fixture.dmxStartAddress, 0)}) saved as ${asBoolean(fixture.on, false) ? "on" : "off"} at ${asNumber(fixture.intensity, 0)}% / ${asNumber(fixture.cct, 3200)}K in ${groupId || "ungrouped"} with ${spatialSummary}, ${rigZSummary}, beam ${Math.round(beamAngle)}deg, and ${effectSummary}.`;
}

function lightingFixtureKindForType(fixtureType: string) {
  switch (fixtureType) {
    case "infinimat":
      return "wash";
    case "infinibar-pb12":
      return "practical";
    default:
      return "profile";
  }
}

function nextCustomFixtureId(fixtures: JsonObject[]) {
  const usedIds = new Set(fixtures.map((fixture) => asString(fixture.id)));
  let index = 1;
  while (usedIds.has(`fixture-custom-${index}`)) {
    index += 1;
  }
  return `fixture-custom-${index}`;
}

function nextCustomGroupId(groups: JsonObject[]) {
  const usedIds = new Set(groups.map((group) => asString(group.id)));
  let index = 1;
  while (usedIds.has(`group-custom-${index}`)) {
    index += 1;
  }
  return `group-custom-${index}`;
}

function nextCustomSceneId(scenes: JsonObject[]) {
  const usedIds = new Set(scenes.map((scene) => asString(scene.id)));
  let index = 1;
  while (usedIds.has(`scene-custom-${index}`)) {
    index += 1;
  }
  return `scene-custom-${index}`;
}

function nextCustomPaletteId(palettes: JsonObject[]) {
  const usedIds = new Set(palettes.map((palette) => asString(palette.id)));
  let index = 1;
  while (usedIds.has(`palette-custom-${index}`)) {
    index += 1;
  }
  return `palette-custom-${index}`;
}

function synchronizeLightingGroupCounts(lightingSnapshot: JsonObject) {
  const fixtures = asArray(lightingSnapshot.fixtures)
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null);
  const groups = asArray(lightingSnapshot.groups)
    .map((group) => asRecord(group))
    .filter((group): group is JsonObject => group !== null);

  lightingSnapshot.groups = groups.map((group) => ({
    ...group,
    fixtureCount: fixtures.filter((fixture) => asString(fixture.groupId) === asString(group.id)).length,
  }));
}

function createMutableFixtureState(scenario: FixtureScenario): MutableFixtureState {
  const scenarioAudioSnapshot = asRecord(scenario.audioSnapshot);

  return {
    appSnapshot: cloneJson((scenario.appSnapshot ?? {}) as JsonObject),
    healthSnapshot: cloneJson((scenario.healthSnapshot ?? {}) as JsonObject),
    commissioningSnapshot: cloneJson((scenario.commissioningSnapshot ?? {}) as JsonObject),
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
}

function ensureCommissioningChecks(state: MutableFixtureState) {
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

function buildCommissioningSteps(
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

function synchronizeFixtureState(state: MutableFixtureState) {
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
  state.commissioningSnapshot.readinessSummary = hasCompletedSetup
    ? `${passedChecks} of ${checks.length} commissioning probes passed. Startup routes directly into the dashboard.`
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
  state.healthSnapshot.summary = hasCompletedSetup
    ? "System healthy and ready."
    : "Storage healthy. Operator mode locked pending setup.";
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
    "Restore from a native support backup archive or a legacy db.json export."
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
  lightingSnapshot.fixtures = asArray(lightingSnapshot.fixtures);
  lightingSnapshot.groups = asArray(lightingSnapshot.groups);
  lightingSnapshot.scenes = asArray(lightingSnapshot.scenes);
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
    : audioSnapshotRecord.verified
      ? "transport-only"
      : audioFailed
        ? "offline"
        : "disabled";
  audioSnapshotRecord.expectedPeakData = asBoolean(audioSnapshotRecord.expectedPeakData, true);
  audioSnapshotRecord.expectedSubmixLock = asBoolean(audioSnapshotRecord.expectedSubmixLock, true);
  audioSnapshotRecord.expectedCompatibilityMode = asBoolean(audioSnapshotRecord.expectedCompatibilityMode, false);
  audioSnapshotRecord.fadersPerBank = clampNumber(Math.round(asNumber(audioSnapshotRecord.fadersPerBank, 12)), 1, 24);
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
  audioSnapshotRecord.channels = asArray(audioSnapshotRecord.channels);
  audioSnapshotRecord.mixTargets = asArray(audioSnapshotRecord.mixTargets);
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
    ? `OSC transport is disabled in native audio settings. Last configured endpoint is ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} with receive port ${audioSnapshotRecord.receivePort}.`
    : audioSnapshotRecord.status === "ready"
      ? `OSC transport is configured for ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} with receive port ${audioSnapshotRecord.receivePort}.`
      : audioSnapshotRecord.status === "attention"
        ? `OSC transport check failed for ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} / ${audioSnapshotRecord.receivePort}.`
        : `OSC transport is configured for ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} with receive port ${audioSnapshotRecord.receivePort} before the native audio probe runs.`;
  state.audioSnapshot = audioSnapshotRecord;
}

function updateFixtureCheck(
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
    check.checkedAt = checkedAt;
  }

  if (target === "control-surface") {
    state.commissioningSnapshot.runnerStage =
      normalizeRunnerStage(state.commissioningSnapshot.runnerStage, state.commissioningSnapshot.stage) === "publish"
        ? "publish"
        : "probe";
  }
}

function countPlanningActivity(state: MutableFixtureState) {
  const activityEntries = asArray(asRecord(state.planningSnapshot)?.activityLog);
  return Math.max(1, activityEntries.length);
}

function validateIpv4(value: string) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value.trim());
}

function validatePort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function buildFixtureBackupEntry(state: MutableFixtureState) {
  const backupDir = asString(state.supportSnapshot.backupDir);
  const modifiedAt = Date.now();
  const timestamp = new Date(modifiedAt).toISOString().replaceAll(":", "-");
  const fileName = `native-backup-${timestamp}.json`;

  return {
    name: fileName,
    path: `${backupDir}/${fileName}`,
    sizeBytes: 4096,
    modifiedAt,
  };
}

function ensureAudioActionAllowed(state: MutableFixtureState) {
  const audioSnapshot = asRecord(state.audioSnapshot);
  if (!audioSnapshot) {
    throw new Error("Audio snapshot is not available yet.");
  }

  const audioCheck = asRecord(
    asArray(state.commissioningSnapshot.checks)
      .map((entry) => asRecord(entry))
      .find((entry) => asString(entry?.id) === "audio")
  );
  const audioReady = asString(audioCheck?.status) === "passed" || asString(audioCheck?.status) === "ok";

  if (!audioReady) {
    throw new Error(
      "Run the commissioning audio probe before syncing the console or recalling snapshots from the fixture transport."
    );
  }

  if (!asBoolean(audioSnapshot.oscEnabled, true)) {
    throw new Error("OSC transport is disabled in native audio settings.");
  }

  return audioSnapshot;
}

export function createFixtureTransport(scenario: FixtureScenario): EngineTransport {
  const listeners = new Set<(event: EventEnvelope<EventName>) => void>();
  const state = createMutableFixtureState(scenario);
  const startupDelayMs = typeof scenario.startupDelayMs === "number" ? scenario.startupDelayMs : 0;
  const startupFailure =
    scenario.startupFailure && typeof scenario.startupFailure === "object"
      ? (scenario.startupFailure as JsonObject)
      : null;
  let startupResolved = startupDelayMs <= 0 && startupFailure === null;
  let resolveStartupGate = () => {};
  let rejectStartupGate = (_error: unknown) => {};
  const startupGate = new Promise<void>((resolve, reject) => {
    resolveStartupGate = resolve;
    rejectStartupGate = reject;
  });
  synchronizeFixtureState(state);

  const emit = (event: EventName, payload: JsonObject = {}) => {
    const envelope = fixtureEvent(event, payload);
    for (const listener of listeners) {
      listener(envelope);
    }
  };

  const handleRequest = (method: RequestMethod, params: JsonObject): JsonValue => {
    switch (method) {
      case "engine.ping":
        return {
          protocol: "1",
          engineVersion: "fixture",
        };
      case "health.snapshot":
        return cloneJson(state.healthSnapshot);
      case "app.snapshot":
        return cloneJson(state.appSnapshot);
      case "commissioning.snapshot":
        return cloneJson(state.commissioningSnapshot);
      case "lighting.snapshot":
        return cloneJson(state.lightingSnapshot);
      case "lighting.dmxMonitor.snapshot":
        return buildLightingDmxMonitorSnapshot(asRecord(state.lightingSnapshot));
      case "lighting.editor.previewMode": {
        const enabled = asBoolean(params.enabled, false);
        const patchModeActive = asBoolean(params.patchModeActive, asBoolean(params.patchMode, false));
        if (enabled && patchModeActive) {
          throw new Error("Exit patch mode before enabling lighting preview mode.");
        }
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
        lightingSnapshot.previewMode = enabled;
        lightingSnapshot.previewDirty = false;
        lightingSnapshot.previewSceneId = enabled
          ? asString(lightingSnapshot.lastRecalledSceneId) || asString(lightingSnapshot.selectedSceneId) || null
          : null;
        lightingSnapshot.previewFixtures = enabled ? cloneJson(lightingFixtures(lightingSnapshot)) : [];
        state.lightingSnapshot = lightingSnapshot;
        emit("lighting.changed", { reason: "preview-mode-updated" });
        return {
          enabled,
          dirty: false,
          previewSceneId: lightingSnapshot.previewSceneId,
          summary: enabled ? "Lighting preview mode enabled." : "Lighting preview mode disabled.",
        };
      }
      case "lighting.editor.previewDiscard": {
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
        lightingSnapshot.previewMode = false;
        lightingSnapshot.previewDirty = false;
        lightingSnapshot.previewSceneId = null;
        lightingSnapshot.previewFixtures = [];
        state.lightingSnapshot = lightingSnapshot;
        emit("lighting.changed", { reason: "preview-discarded" });
        return {
          discarded: true,
          summary: "Lighting preview edits discarded.",
        };
      }
      case "lighting.palette.list": {
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
        return {
          palettes: cloneJson(lightingPalettes(lightingSnapshot)),
        };
      }
      case "lighting.palette.create": {
        const name = asString(params.name).trim();
        if (!name) {
          throw new Error("name is required");
        }
        const kind = normalizePaletteKind(params.kind);
        if (!kind) {
          throw new Error("kind must be one of intensity or cct");
        }
        const value = validatePaletteValue(kind, params.value);
        const colorIndex = Object.prototype.hasOwnProperty.call(params, "colorIndex")
          ? parseLightingColorIndex(params.colorIndex)
          : null;
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
        const palettes = lightingPalettes(lightingSnapshot);
        const createdPalette: JsonObject = {
          id: nextCustomPaletteId(palettes),
          name,
          kind,
          value,
          colorIndex,
        };
        const insertIndex =
          kind === "intensity" ? palettes.findIndex((palette) => normalizePaletteKind(palette.kind) === "cct") : -1;
        lightingSnapshot.palettes =
          insertIndex >= 0
            ? [...palettes.slice(0, insertIndex), createdPalette, ...palettes.slice(insertIndex)]
            : [...palettes, createdPalette];
        const summary = `Lighting ${kind === "cct" ? "CCT" : "intensity"} palette '${name}' was created at ${formatLightingPaletteValue(kind, value)}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "palette-created" });
        return {
          palette: cloneJson(createdPalette),
          summary,
        };
      }
      case "lighting.palette.update": {
        const paletteId = asString(params.paletteId).trim();
        if (!paletteId) {
          throw new Error("paletteId is required");
        }
        if (Object.prototype.hasOwnProperty.call(params, "kind")) {
          throw new Error("lighting.palette.update cannot change kind");
        }
        const hasName = typeof params.name === "string";
        const hasValue = typeof params.value === "number";
        const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
        const hasBefore = Object.prototype.hasOwnProperty.call(params, "beforePaletteId");
        if (!hasName && !hasValue && !hasColor && !hasBefore) {
          throw new Error("lighting.palette.update requires a name, value, colorIndex, or beforePaletteId");
        }
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
        let palettes = lightingPalettes(lightingSnapshot);
        const targetPalette = palettes.find((palette) => asString(palette.id) === paletteId);
        if (!targetPalette) {
          throw new Error(`Lighting palette '${paletteId}' is not present in the palette list.`);
        }
        const kind = normalizePaletteKind(targetPalette.kind);
        if (!kind) {
          throw new Error(`Lighting palette '${paletteId}' has an unsupported kind.`);
        }
        const nextName = hasName ? asString(params.name).trim() : asString(targetPalette.name);
        if (hasName && !nextName) {
          throw new Error("name must not be empty");
        }
        const nextValue = hasValue
          ? validatePaletteValue(kind, params.value)
          : normalizePaletteValue(kind, targetPalette.value);
        const nextColorIndex = hasColor
          ? parseLightingColorIndex(params.colorIndex)
          : ((targetPalette.colorIndex as number | null | undefined) ?? null);
        const updatedPalette: JsonObject = {
          ...targetPalette,
          name: nextName,
          value: nextValue,
          colorIndex: nextColorIndex,
        };
        palettes = palettes.map((palette) => (asString(palette.id) === paletteId ? updatedPalette : palette));
        if (hasBefore) {
          const beforePaletteId = params.beforePaletteId === null ? null : asString(params.beforePaletteId).trim();
          if (beforePaletteId === paletteId) {
            throw new Error("beforePaletteId must differ from paletteId");
          }
          if (beforePaletteId) {
            const beforePalette = palettes.find((palette) => asString(palette.id) === beforePaletteId);
            if (!beforePalette) {
              throw new Error(`Lighting palette '${beforePaletteId}' is not present in the palette list.`);
            }
            if (normalizePaletteKind(beforePalette.kind) !== kind) {
              throw new Error("Palettes can only be reordered within the same attribute pool.");
            }
          }
          const withoutTarget = palettes.filter((palette) => asString(palette.id) !== paletteId);
          if (beforePaletteId) {
            const beforeIndex = withoutTarget.findIndex((palette) => asString(palette.id) === beforePaletteId);
            palettes = [...withoutTarget.slice(0, beforeIndex), updatedPalette, ...withoutTarget.slice(beforeIndex)];
          } else {
            const sameKindEntries = withoutTarget
              .map((palette, index) => ({ index, palette }))
              .filter((entry) => normalizePaletteKind(entry.palette.kind) === kind);
            const lastSameKind = sameKindEntries[sameKindEntries.length - 1];
            const insertIndex = lastSameKind ? lastSameKind.index + 1 : withoutTarget.length;
            palettes = [...withoutTarget.slice(0, insertIndex), updatedPalette, ...withoutTarget.slice(insertIndex)];
          }
        }
        lightingSnapshot.palettes = palettes;
        const summaryParts: string[] = [];
        if (hasName) summaryParts.push(`renamed to '${nextName}'`);
        if (hasValue) summaryParts.push(`set to ${formatLightingPaletteValue(kind, nextValue)}`);
        if (hasColor) summaryParts.push(nextColorIndex === null ? "color cleared" : "recolored");
        if (hasBefore) summaryParts.push("reordered");
        const summary = `Lighting palette '${nextName}' ${summaryParts.join(" + ")}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "palette-updated" });
        return {
          palette: cloneJson(updatedPalette),
          summary,
        };
      }
      case "lighting.palette.delete": {
        const paletteId = asString(params.paletteId).trim();
        if (!paletteId) {
          throw new Error("paletteId is required");
        }
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
        const palettes = lightingPalettes(lightingSnapshot);
        const targetPalette = palettes.find((palette) => asString(palette.id) === paletteId);
        if (!targetPalette) {
          throw new Error(`Lighting palette '${paletteId}' is not present in the palette list.`);
        }
        lightingSnapshot.palettes = palettes.filter((palette) => asString(palette.id) !== paletteId);
        const summary = `Lighting palette '${asString(targetPalette.name, paletteId)}' was deleted.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "palette-deleted" });
        return {
          deleted: true,
          paletteId,
          summary,
        };
      }
      case "lighting.palette.apply": {
        const paletteId = asString(params.paletteId).trim();
        if (!paletteId) {
          throw new Error("paletteId is required");
        }
        if (asBoolean(params.patchModeActive, false) || asBoolean(params.patchMode, false)) {
          throw new Error("Exit patch mode before applying lighting palettes.");
        }
        const fixtureIds = asArray(params.fixtureIds)
          .map((id) => asString(id).trim())
          .filter(Boolean)
          .filter((id, index, ids) => ids.indexOf(id) === index);
        if (fixtureIds.length === 0) {
          throw new Error("fixtureIds must contain at least one id");
        }
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? buildDefaultLightingSnapshot();
        const palettes = lightingPalettes(lightingSnapshot);
        const palette = palettes.find((entry) => asString(entry.id) === paletteId);
        if (!palette) {
          throw new Error(`Lighting palette '${paletteId}' is not present in the palette list.`);
        }
        const kind = normalizePaletteKind(palette.kind);
        if (!kind) {
          throw new Error(`Lighting palette '${paletteId}' has an unsupported kind.`);
        }
        const previewActive = lightingPreviewActive(lightingSnapshot);
        const fixtures = previewActive
          ? lightingFixtures(lightingSnapshot, "previewFixtures")
          : lightingFixtures(lightingSnapshot);
        const missingFixtureId = fixtureIds.find(
          (fixtureId) => !fixtures.some((fixture) => asString(fixture.id) === fixtureId)
        );
        if (missingFixtureId) {
          throw new Error(`Lighting fixture '${missingFixtureId}' is not present in the fixture inventory.`);
        }
        const nextFixtures = fixtures.map((fixture) =>
          fixtureIds.includes(asString(fixture.id)) ? applyLightingPaletteToFixture(fixture, palette) : fixture
        );
        if (previewActive) {
          lightingSnapshot.previewFixtures = nextFixtures;
          lightingSnapshot.previewDirty = true;
        } else {
          lightingSnapshot.fixtures = nextFixtures;
        }
        const summary = `Lighting ${kind === "cct" ? "CCT" : "intensity"} palette '${asString(palette.name, paletteId)}' applied to ${fixtureIds.length} fixture${fixtureIds.length === 1 ? "" : "s"}${previewActive ? " in preview" : ""}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "palette-applied" });
        return {
          paletteId,
          paletteName: asString(palette.name, paletteId),
          kind,
          affectedFixtures: fixtureIds.length,
          previewMode: previewActive,
          summary,
        };
      }
      case "audio.snapshot":
        return cloneJson(state.audioSnapshot);
      case "planning.snapshot":
        return cloneJson(state.planningSnapshot);
      case "support.snapshot":
        return cloneJson(state.supportSnapshot);
      case "controlSurface.snapshot":
        return cloneJson(state.controlSurfaceSnapshot);
      case "settings.update": {
        if (typeof params.workspace === "string") {
          const shell = asRecord(state.appSnapshot.shell) ?? {};
          shell.workspace = params.workspace;
          state.appSnapshot.shell = shell;
          emit("settings.changed", { reason: "workspace-updated" });
        }
        const setup = asRecord(params.setup);
        if (typeof setup?.activeSection === "string") {
          const shell = asRecord(state.appSnapshot.shell) ?? {};
          const shellSetup = asRecord(shell.setup) ?? {};
          shellSetup.activeSection = setup.activeSection;
          shell.setup = shellSetup;
          state.appSnapshot.shell = shell;
          emit("settings.changed", { reason: "setup-section-updated" });
        }
        const lighting = asRecord(params.lighting);
        if (lighting && "currentSectionId" in lighting) {
          const shell = asRecord(state.appSnapshot.shell) ?? {};
          const shellLighting = asRecord(shell.lighting) ?? {};
          shellLighting.currentSectionId =
            typeof lighting.currentSectionId === "string" ? lighting.currentSectionId : null;
          shell.lighting = shellLighting;
          state.appSnapshot.shell = shell;
          emit("settings.changed", { reason: "lighting-shell-state-updated" });
        }
        synchronizeFixtureState(state);
        return cloneJson(state.appSnapshot);
      }
      case "audio.settings.update": {
        const audioSnapshot = asRecord(state.audioSnapshot) ?? buildDefaultAudioSnapshot();
        const audioCheck = asArray(state.commissioningSnapshot.checks)
          .map((entry) => asRecord(entry))
          .find((entry) => asString(entry?.id) === "audio");
        const transportChanged =
          "oscEnabled" in params || "sendHost" in params || "sendPort" in params || "receivePort" in params;

        if ("oscEnabled" in params) {
          audioSnapshot.oscEnabled = asBoolean(params.oscEnabled, true);
        }
        if (typeof params.sendHost === "string" && params.sendHost.trim()) {
          audioSnapshot.sendHost = params.sendHost.trim();
          state.commissioningSnapshot.audio = {
            ...(asRecord(state.commissioningSnapshot.audio) ?? {}),
            sendHost: params.sendHost.trim(),
            sendPort: asNumber(audioSnapshot.sendPort, 7001),
            receivePort: asNumber(audioSnapshot.receivePort, 9001),
          };
        }
        if (typeof params.sendPort === "number") {
          audioSnapshot.sendPort = clampNumber(Math.round(params.sendPort), 1, 65_535);
          state.commissioningSnapshot.audio = {
            ...(asRecord(state.commissioningSnapshot.audio) ?? {}),
            sendHost: asString(audioSnapshot.sendHost, "127.0.0.1"),
            sendPort: audioSnapshot.sendPort,
            receivePort: asNumber(audioSnapshot.receivePort, 9001),
          };
        }
        if (typeof params.receivePort === "number") {
          audioSnapshot.receivePort = clampNumber(Math.round(params.receivePort), 1, 65_535);
          state.commissioningSnapshot.audio = {
            ...(asRecord(state.commissioningSnapshot.audio) ?? {}),
            sendHost: asString(audioSnapshot.sendHost, "127.0.0.1"),
            sendPort: asNumber(audioSnapshot.sendPort, 7001),
            receivePort: audioSnapshot.receivePort,
          };
        }
        if ("selectedChannelId" in params) {
          audioSnapshot.selectedChannelId =
            typeof params.selectedChannelId === "string" ? params.selectedChannelId : null;
        }
        if (typeof params.selectedMixTargetId === "string") {
          audioSnapshot.selectedMixTargetId = params.selectedMixTargetId;
        }
        if ("expectedPeakData" in params) {
          audioSnapshot.expectedPeakData = asBoolean(params.expectedPeakData, true);
        }
        if ("expectedSubmixLock" in params) {
          audioSnapshot.expectedSubmixLock = asBoolean(params.expectedSubmixLock, true);
        }
        if ("expectedCompatibilityMode" in params) {
          audioSnapshot.expectedCompatibilityMode = asBoolean(params.expectedCompatibilityMode, false);
        }
        if (typeof params.fadersPerBank === "number") {
          audioSnapshot.fadersPerBank = clampNumber(Math.round(params.fadersPerBank), 1, 24);
        }

        if (transportChanged) {
          if (audioCheck) {
            audioCheck.status = "idle";
            audioCheck.message = "Not run yet.";
            audioCheck.checkedAt = null;
          }
          audioSnapshot.consoleStateConfidence = "unknown";
          audioSnapshot.lastConsoleSyncAt = null;
          audioSnapshot.lastConsoleSyncReason = null;
          audioSnapshot.lastRecalledSnapshotId = null;
          audioSnapshot.lastSnapshotRecallAt = null;
        }

        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = "Audio settings updated";
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-settings-updated" });
        return cloneJson(state.audioSnapshot);
      }
      case "audio.sync": {
        const audioSnapshot = ensureAudioActionAllowed(state);
        const syncedAt = new Date().toISOString();
        audioSnapshot.consoleStateConfidence = "aligned";
        audioSnapshot.lastConsoleSyncAt = syncedAt;
        audioSnapshot.lastConsoleSyncReason = "manual sync";
        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = "Sync succeeded";
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-sync-completed" });
        return {
          synced: true,
          syncedAt,
          summary: "Simulated console sync completed.",
          consoleStateConfidence: "aligned",
        };
      }
      case "audio.snapshot.recall": {
        const audioSnapshot = ensureAudioActionAllowed(state);
        const snapshotId = asString(params.snapshotId).trim();
        const snapshots = asArray(audioSnapshot.snapshots)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const snapshot = snapshots.find((entry) => asString(entry.id) === snapshotId);
        if (!snapshot) {
          throw new Error(`Audio snapshot '${snapshotId}' is not exposed by the fixture transport.`);
        }

        const recalledAt = new Date().toISOString();
        audioSnapshot.lastRecalledSnapshotId = snapshotId;
        audioSnapshot.lastSnapshotRecallAt = recalledAt;
        audioSnapshot.consoleStateConfidence = "assumed";
        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = `Recalled ${asString(snapshot.name, snapshotId)}`;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-snapshot-recalled" });
        return {
          recalled: true,
          snapshotId,
          snapshotName: asString(snapshot.name, snapshotId),
          recalledAt,
          summary: `Audio snapshot '${asString(snapshot.name, snapshotId)}' was recalled.`,
          consoleStateConfidence: "assumed",
        };
      }
      case "audio.channel.update": {
        const audioSnapshot = ensureAudioActionAllowed(state);
        const channelId = asString(params.channelId).trim();
        const channels = asArray(audioSnapshot.channels)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const channel = channels.find((entry) => asString(entry.id) === channelId);
        if (!channel) {
          throw new Error(`Audio channel '${channelId}' is not exposed by the fixture transport.`);
        }

        const role = asString(channel.role);
        if (typeof params.gain === "number") {
          if (role !== "front-preamp") {
            throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: gain is only available on front preamps.");
          }
          channel.gain = clampNumber(Math.round(params.gain), 0, 75);
        }
        if (typeof params.fader === "number") {
          const mixTargetId = asString(
            params.mixTargetId,
            asString(audioSnapshot.selectedMixTargetId, "audio-mix-main")
          );
          const mixLevels = asRecord(channel.mixLevels) ?? {};
          mixLevels[mixTargetId] = Math.max(0, Math.min(1, params.fader));
          channel.mixLevels = mixLevels;
          if (mixTargetId === "audio-mix-main") {
            channel.fader = mixLevels[mixTargetId];
          }
        }
        if ("mute" in params) {
          channel.mute = asBoolean(params.mute, false);
        }
        if ("solo" in params) {
          channel.solo = asBoolean(params.solo, false);
        }
        if ("phantom" in params) {
          if (role !== "front-preamp") {
            throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: phantom is only available on front preamps.");
          }
          channel.phantom = asBoolean(params.phantom, false);
        }
        if ("phase" in params) {
          if (role === "playback-pair") {
            throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: phase is not available on playback pairs.");
          }
          channel.phase = asBoolean(params.phase, false);
        }
        if ("pad" in params) {
          if (role !== "front-preamp") {
            throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: pad is only available on front preamps.");
          }
          channel.pad = asBoolean(params.pad, false);
        }
        if ("instrument" in params) {
          if (role !== "front-preamp") {
            throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: instrument is only available on front preamps.");
          }
          channel.instrument = asBoolean(params.instrument, false);
        }
        if ("autoSet" in params) {
          if (role !== "front-preamp") {
            throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: auto-set is only available on front preamps.");
          }
          channel.autoSet = asBoolean(params.autoSet, false);
        }

        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = `Updated ${asString(channel.name, channelId)}`;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-channel-updated" });
        return cloneJson(channel);
      }
      case "audio.mixTarget.update": {
        const audioSnapshot = ensureAudioActionAllowed(state);
        const mixTargetId = asString(params.mixTargetId).trim();
        const mixTargets = asArray(audioSnapshot.mixTargets)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const mixTarget = mixTargets.find((entry) => asString(entry.id) === mixTargetId);
        if (!mixTarget) {
          throw new Error(`Audio mix target '${mixTargetId}' is not exposed by the fixture transport.`);
        }

        if ("volume" in params && typeof params.volume === "number") {
          mixTarget.volume = Math.max(0, Math.min(1, params.volume));
        }
        if ("mute" in params) {
          mixTarget.mute = asBoolean(params.mute, false);
        }
        if ("dim" in params) {
          mixTarget.dim = asBoolean(params.dim, false);
        }
        if ("mono" in params) {
          mixTarget.mono = asBoolean(params.mono, false);
        }
        if ("talkback" in params) {
          mixTarget.talkback = asBoolean(params.talkback, false);
        }

        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = `Updated ${asString(mixTarget.name, mixTargetId)}`;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-mix-target-updated" });
        return cloneJson(mixTarget);
      }
      case "commissioning.update": {
        if (typeof params.stage === "string") {
          state.commissioningSnapshot.stage = params.stage as CommissioningStage;
          state.commissioningSnapshot.runnerStage = normalizeRunnerStage(
            state.commissioningSnapshot.runnerStage,
            params.stage
          );
          state.commissioningSnapshot.hasCompletedSetup = params.stage === "ready";
        }
        if (typeof params.runnerStage === "string") {
          state.commissioningSnapshot.runnerStage = normalizeRunnerStage(
            params.runnerStage,
            state.commissioningSnapshot.stage
          );
          state.commissioningSnapshot.stage =
            typeof params.stage === "string"
              ? (params.stage as CommissioningStage)
              : legacyStageFromRunnerStage(state.commissioningSnapshot.runnerStage as RunnerStage, false);
          state.commissioningSnapshot.hasCompletedSetup = state.commissioningSnapshot.stage === "ready";
        }
        if (typeof params.hardwareProfile === "string" && params.hardwareProfile.trim()) {
          state.commissioningSnapshot.hardwareProfile = params.hardwareProfile.trim();
        }
        synchronizeFixtureState(state);
        emit("app.changed", { reason: "commissioning-updated" });
        emit("commissioning.changed", { reason: "commissioning-updated" });
        return cloneJson(state.appSnapshot);
      }
      case "commissioning.check.run": {
        const target = asString(params.target) as CommissioningCheckTarget;

        if (target === "lighting") {
          const bridgeIp = asString(
            params.bridgeIp,
            asString(asRecord(state.commissioningSnapshot.lighting)?.bridgeIp)
          );
          const universe = asNumber(
            params.universe,
            asNumber(asRecord(state.commissioningSnapshot.lighting)?.universe, 1)
          );
          if (!bridgeIp || !validateIpv4(bridgeIp)) {
            throw new Error("bridgeIp is required and must be a valid IPv4 address");
          }
          if (!Number.isInteger(universe) || universe < 1 || universe > 63999) {
            throw new Error("universe must be between 1 and 63999");
          }
          state.commissioningSnapshot.lighting = { bridgeIp, universe };
          updateFixtureCheck(state, "lighting", "passed", `Bridge probe reached ${bridgeIp} on universe ${universe}.`);
        } else if (target === "audio") {
          const sendHost = asString(
            params.sendHost,
            asString(asRecord(state.commissioningSnapshot.audio)?.sendHost, "127.0.0.1")
          );
          const sendPort = asNumber(
            params.sendPort,
            asNumber(asRecord(state.commissioningSnapshot.audio)?.sendPort, 7001)
          );
          const receivePort = asNumber(
            params.receivePort,
            asNumber(asRecord(state.commissioningSnapshot.audio)?.receivePort, 9001)
          );
          if (!sendHost || (!validateIpv4(sendHost) && sendHost !== "127.0.0.1" && sendHost !== "localhost")) {
            throw new Error("sendHost must be localhost or a valid IPv4 address");
          }
          if (!validatePort(sendPort) || !validatePort(receivePort)) {
            throw new Error("sendPort and receivePort must be between 1 and 65535");
          }
          state.commissioningSnapshot.audio = { sendHost, sendPort, receivePort };
          updateFixtureCheck(
            state,
            "audio",
            "passed",
            `OSC transport config accepted for ${sendHost} (send ${sendPort}, receive ${receivePort}).`
          );
        } else if (target === "control-surface") {
          updateFixtureCheck(
            state,
            "control-surface",
            "passed",
            `Control surface bridge exposes ${countControls(state)} mapped controls across ${asArray(state.controlSurfaceSnapshot.pages).length} pages.`
          );
        } else {
          throw new Error("target must be one of: control-surface, lighting, audio");
        }

        if (
          normalizeRunnerStage(state.commissioningSnapshot.runnerStage, state.commissioningSnapshot.stage) !== "publish"
        ) {
          state.commissioningSnapshot.runnerStage = "probe";
        }

        synchronizeFixtureState(state);
        emit("commissioning.changed", { reason: "check-updated" });
        return cloneJson(state.commissioningSnapshot);
      }
      case "commissioning.seedPlanningDemo": {
        state.planningSnapshot = buildSeededPlanningSnapshot();
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "sample-planning-seeded" });
        emit("commissioning.changed", { reason: "sample-planning-seeded" });
        return cloneJson(state.commissioningSnapshot);
      }
      case "lighting.scene.recall": {
        const sceneId = asString(params.sceneId).trim();
        if (!sceneId) {
          throw new Error("sceneId is required");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const scenes = lightingScenes(lightingSnapshot);
        const targetScene = scenes.find((scene) => asString(scene.id) === sceneId);
        if (!targetScene) {
          throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
        }

        if (lightingPreviewActive(lightingSnapshot)) {
          const liveFixtures = lightingFixtures(lightingSnapshot);
          lightingSnapshot.previewSceneId = sceneId;
          lightingSnapshot.previewDirty = false;
          lightingSnapshot.previewFixtures = previewFixturesFromScene(liveFixtures, targetScene);
          state.lightingSnapshot = lightingSnapshot;
          synchronizeFixtureState(state);
          emit("lighting.changed", { reason: "scene-preview-recalled" });
          return {
            recalled: true,
            sceneId,
            sceneName: asString(targetScene.name, sceneId),
            recalledAt: null,
            fadeDurationSeconds: 0,
            fadeMs: 0,
            previewMode: true,
            summary: `Lighting scene '${asString(targetScene.name, sceneId)}' loaded into preview.`,
          };
        }

        if (!asBoolean(lightingSnapshot.reachable, false)) {
          throw new Error("Lighting scene recall requires a reachable lighting transport.");
        }

        const recalledAt = new Date().toISOString();
        const rawFadeMs =
          typeof params.fadeMs === "number"
            ? params.fadeMs
            : typeof params.fadeDurationSeconds === "number"
              ? params.fadeDurationSeconds * 1000
              : 0;
        const fadeMs = Math.max(0, Math.min(10_000, Math.round(rawFadeMs)));
        const fadeDurationSeconds = fadeMs / 1000;
        const fixtureStates = asArray(targetScene.fixtureStates)
          .map((fixtureState) => asRecord(fixtureState))
          .filter((fixtureState): fixtureState is JsonObject => fixtureState !== null);
        const previewActive = lightingPreviewActive(lightingSnapshot);
        const fixtures = previewActive
          ? lightingFixtures(lightingSnapshot, "previewFixtures")
          : lightingFixtures(lightingSnapshot);

        lightingSnapshot.selectedSceneId = sceneId;
        lightingSnapshot.lastRecalledSceneId = sceneId;
        lightingSnapshot.lastSceneRecallAt = recalledAt;
        lightingSnapshot.scenes = scenes.map((scene) => ({
          ...scene,
          lastRecalled: asString(scene.id) === sceneId,
          lastRecalledAt: asString(scene.id) === sceneId ? recalledAt : (scene.lastRecalledAt ?? null),
          fadeDurationMs: asString(scene.id) === sceneId && fadeMs > 0 ? fadeMs : null,
          fadeProgress: asString(scene.id) === sceneId && fadeMs > 0 ? 1 : null,
        }));
        lightingSnapshot.fixtures = fixtures.map((fixture) => {
          const nextState = fixtureStates.find(
            (fixtureState) => asString(fixtureState.fixtureId) === asString(fixture.id)
          );
          if (!nextState) {
            return fixture;
          }

          return {
            ...fixture,
            cct: asNumber(nextState.cct, asNumber(fixture.cct, 3200)),
            intensity: asNumber(nextState.intensity, asNumber(fixture.intensity, 0)),
            on: asBoolean(nextState.on, asBoolean(fixture.on, false)),
          };
        });

        const transitionLabel =
          fadeMs > 0
            ? `${Number.isInteger(fadeDurationSeconds) ? fadeDurationSeconds.toFixed(0) : fadeDurationSeconds.toFixed(1)} s fade`
            : "immediate transition";
        const summary = `Fixture lighting scene '${asString(targetScene.name, sceneId)}' was recalled via ${transitionLabel} on ${asString(lightingSnapshot.bridgeIp, "unconfigured")} universe ${asNumber(lightingSnapshot.universe, 1)}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "scene-recalled" });
        return {
          recalled: true,
          sceneId,
          sceneName: asString(targetScene.name, sceneId),
          recalledAt,
          fadeDurationSeconds,
          fadeMs,
          summary,
        };
      }
      case "lighting.scene.create": {
        const name = asString(params.name).trim();
        if (!name) {
          throw new Error("name is required");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const previewActive = lightingPreviewActive(lightingSnapshot);
        const fixtures = previewActive
          ? lightingFixtures(lightingSnapshot, "previewFixtures")
          : lightingFixtures(lightingSnapshot);
        if (fixtures.length === 0) {
          throw new Error("No lighting fixtures are available for scene creation.");
        }
        const hasExplicitFixtureStates = Object.prototype.hasOwnProperty.call(params, "fixtureStates");
        const explicitFixtureStates = hasExplicitFixtureStates
          ? asArray(params.fixtureStates).map((entry) => {
              const fixtureState = asRecord(entry);
              if (!fixtureState) {
                throw new Error("fixtureStates entries must be objects");
              }
              const fixtureId = asString(fixtureState.fixtureId).trim();
              if (!fixtureId) {
                throw new Error("fixtureStates.fixtureId is required");
              }
              if (!fixtures.some((fixture) => asString(fixture.id) === fixtureId)) {
                throw new Error(`Lighting fixture '${fixtureId}' is not present in the fixture list.`);
              }
              const intensity = asNumber(fixtureState.intensity, NaN);
              if (!Number.isFinite(intensity) || intensity < 0 || intensity > 100) {
                throw new Error("fixtureStates.intensity must be between 0 and 100");
              }
              const cct = asNumber(fixtureState.cct, NaN);
              if (!Number.isFinite(cct) || cct < 2000 || cct > 10_000) {
                throw new Error("fixtureStates.cct must be between 2000 and 10000");
              }
              return {
                fixtureId,
                intensity: Math.round(intensity),
                cct: Math.round(cct),
                on: asBoolean(fixtureState.on, false),
              };
            })
          : null;
        if (hasExplicitFixtureStates && explicitFixtureStates?.length === 0) {
          throw new Error("Scene fixtureStates must include at least one fixture.");
        }
        const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
        let colorIndex: number | null = null;
        if (hasColor) {
          if (params.colorIndex === null) {
            colorIndex = null;
          } else {
            const raw = asNumber(params.colorIndex, NaN);
            if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
              throw new Error("colorIndex must be an integer 0..7 or null");
            }
            colorIndex = raw;
          }
        }

        const scenes = asArray(lightingSnapshot.scenes)
          .map((scene) => asRecord(scene))
          .filter((scene): scene is JsonObject => scene !== null);
        const createdScene: JsonObject = {
          id: nextCustomSceneId(scenes),
          name,
          fixtureCount: explicitFixtureStates?.length ?? fixtures.length,
          fixtureStates:
            explicitFixtureStates ??
            fixtures.map((fixture) => ({
              fixtureId: asString(fixture.id),
              intensity: asNumber(fixture.intensity, 0),
              cct: asNumber(fixture.cct, 3200),
              on: asBoolean(fixture.on, false),
            })),
          lastRecalled: false,
          lastRecalledAt: null,
          colorIndex,
        };

        lightingSnapshot.scenes = [...scenes, createdScene];
        if (previewActive) {
          lightingSnapshot.selectedSceneId = createdScene.id;
          clearLightingPreview(lightingSnapshot);
        }
        const summary = hasExplicitFixtureStates
          ? `Lighting scene '${name}' was restored from a saved scene state.`
          : previewActive
            ? `Lighting scene '${name}' was saved from preview.`
            : `Lighting scene '${name}' was saved from the current fixture state.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "scene-created" });
        return {
          scene: cloneJson(createdScene),
          summary,
        };
      }
      case "lighting.scene.update": {
        const sceneId = asString(params.sceneId).trim();
        if (!sceneId) {
          throw new Error("sceneId is required");
        }
        const hasName = typeof params.name === "string";
        const hasCapture = params.captureCurrentState === true;
        const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
        if (!hasName && !hasCapture && !hasColor) {
          throw new Error("lighting.scene.update requires a name, captureCurrentState, or colorIndex");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const scenes = asArray(lightingSnapshot.scenes)
          .map((scene) => asRecord(scene))
          .filter((scene): scene is JsonObject => scene !== null);
        const targetScene = scenes.find((scene) => asString(scene.id) === sceneId);
        if (!targetScene) {
          throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
        }

        const previewActive = lightingPreviewActive(lightingSnapshot);
        const fixtures = previewActive
          ? lightingFixtures(lightingSnapshot, "previewFixtures")
          : lightingFixtures(lightingSnapshot);

        const nextName = hasName ? asString(params.name).trim() : asString(targetScene.name);
        if (hasName && !nextName) {
          throw new Error("name must not be empty");
        }
        const nextFixtureStates = hasCapture
          ? fixtures.map((fixture) => ({
              fixtureId: asString(fixture.id),
              intensity: asNumber(fixture.intensity, 0),
              cct: asNumber(fixture.cct, 3200),
              on: asBoolean(fixture.on, false),
            }))
          : asArray(targetScene.fixtureStates);
        let nextColorIndex: number | null = (targetScene.colorIndex as number | null | undefined) ?? null;
        if (hasColor) {
          if (params.colorIndex === null) {
            nextColorIndex = null;
          } else {
            const raw = asNumber(params.colorIndex, NaN);
            if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
              throw new Error("colorIndex must be an integer 0..7 or null");
            }
            nextColorIndex = raw;
          }
        }

        const updatedScene: JsonObject = {
          ...targetScene,
          name: nextName,
          fixtureStates: nextFixtureStates,
          fixtureCount: hasCapture ? fixtures.length : asNumber(targetScene.fixtureCount, fixtures.length),
          colorIndex: nextColorIndex,
        };

        lightingSnapshot.scenes = scenes.map((scene) => (asString(scene.id) === sceneId ? updatedScene : scene));
        if (hasCapture && previewActive) {
          clearLightingPreview(lightingSnapshot);
        }
        const summaryParts: string[] = [];
        if (hasName) summaryParts.push(`renamed to '${nextName}'`);
        if (hasCapture) summaryParts.push("captured current rig state");
        if (hasColor) summaryParts.push(nextColorIndex === null ? "color cleared" : "recolored");
        const summary = `Lighting scene '${nextName}' ${summaryParts.join(" + ")}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "scene-updated" });
        return {
          scene: cloneJson(updatedScene),
          summary,
        };
      }
      case "lighting.scene.delete": {
        const sceneId = asString(params.sceneId).trim();
        if (!sceneId) {
          throw new Error("sceneId is required");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const scenes = asArray(lightingSnapshot.scenes)
          .map((scene) => asRecord(scene))
          .filter((scene): scene is JsonObject => scene !== null);
        const targetScene = scenes.find((scene) => asString(scene.id) === sceneId);
        if (!targetScene) {
          throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
        }

        lightingSnapshot.scenes = scenes.filter((scene) => asString(scene.id) !== sceneId);
        if (asString(lightingSnapshot.selectedSceneId) === sceneId) {
          lightingSnapshot.selectedSceneId = null;
        }
        if (asString(lightingSnapshot.lastRecalledSceneId) === sceneId) {
          lightingSnapshot.lastRecalledSceneId = null;
          lightingSnapshot.lastSceneRecallAt = null;
        }

        const sceneName = asString(targetScene.name, sceneId);
        const summary = `Lighting scene '${sceneName}' was deleted.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "scene-deleted" });
        return {
          deleted: true,
          sceneId,
          summary,
        };
      }
      case "lighting.settings.update": {
        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const hasSelectedSceneId = Object.prototype.hasOwnProperty.call(params, "selectedSceneId");
        const hasSelectedFixtureId = Object.prototype.hasOwnProperty.call(params, "selectedFixtureId");

        if (!hasSelectedSceneId && !hasSelectedFixtureId) {
          throw new Error("lighting.settings.update requires one or more supported fields");
        }

        const fixtures = asArray(lightingSnapshot.fixtures)
          .map((fixture) => asRecord(fixture))
          .filter((fixture): fixture is JsonObject => fixture !== null);
        const scenes = asArray(lightingSnapshot.scenes)
          .map((scene) => asRecord(scene))
          .filter((scene): scene is JsonObject => scene !== null);
        const summaryParts: string[] = [];

        if (hasSelectedSceneId) {
          if (params.selectedSceneId === null) {
            lightingSnapshot.selectedSceneId = null;
            summaryParts.push("selected scene cleared");
          } else {
            const sceneId = asString(params.selectedSceneId).trim();
            if (!sceneId) {
              throw new Error("selectedSceneId must be a string or null");
            }

            const scene = scenes.find((entry) => asString(entry.id) === sceneId);
            if (!scene) {
              throw new Error(`Lighting scene '${sceneId}' is not present in the scene list.`);
            }

            lightingSnapshot.selectedSceneId = sceneId;
            summaryParts.push(`selected scene -> ${asString(scene.name, sceneId)}`);
          }
        }

        if (hasSelectedFixtureId) {
          if (params.selectedFixtureId === null) {
            lightingSnapshot.selectedFixtureId = null;
            summaryParts.push("selected fixture cleared");
          } else {
            const fixtureId = asString(params.selectedFixtureId).trim();
            if (!fixtureId) {
              throw new Error("selectedFixtureId must be a string or null");
            }

            const fixture = fixtures.find((entry) => asString(entry.id) === fixtureId);
            if (!fixture) {
              throw new Error(`Lighting fixture '${fixtureId}' is not present in the fixture inventory.`);
            }

            lightingSnapshot.selectedFixtureId = fixtureId;
            summaryParts.push(`selected fixture -> ${asString(fixture.name, fixtureId)}`);
          }
        }

        const summary =
          summaryParts.length > 0
            ? `Native lighting settings updated: ${summaryParts.join(", ")}.`
            : "Native lighting settings updated.";
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "settings-updated" });
        return {
          selectedSceneId: lightingSnapshot.selectedSceneId ?? null,
          selectedFixtureId: lightingSnapshot.selectedFixtureId ?? null,
          summary,
        };
      }
      case "lighting.fixture.create": {
        const name = asString(params.name).trim();
        if (!name) {
          throw new Error("name is required");
        }

        const normalizedFixtureType = normalizeFixtureType(params.type);
        if (!normalizedFixtureType) {
          throw new Error("type is required");
        }

        const requestedStartAddress = Math.round(asNumber(params.dmxStartAddress, Number.NaN));
        if (!Number.isFinite(requestedStartAddress)) {
          throw new Error("dmxStartAddress is required");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const fixtures = asArray(lightingSnapshot.fixtures)
          .map((fixture) => asRecord(fixture))
          .filter((fixture): fixture is JsonObject => fixture !== null);
        const groups = asArray(lightingSnapshot.groups)
          .map((group) => asRecord(group))
          .filter((group): group is JsonObject => group !== null);
        const scenes = asArray(lightingSnapshot.scenes)
          .map((scene) => asRecord(scene))
          .filter((scene): scene is JsonObject => scene !== null);
        const groupId = asString(params.groupId).trim();

        if (groupId && !groups.some((group) => asString(group.id) === groupId)) {
          throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
        }

        const maxDmxStartAddress = lightingFixtureMaxStartAddress(normalizedFixtureType);
        if (requestedStartAddress < 1 || requestedStartAddress > maxDmxStartAddress) {
          throw new Error(
            `DMX start address must be between 1 and ${maxDmxStartAddress} for fixture type '${normalizedFixtureType}'.`
          );
        }

        const requestedEndAddress = requestedStartAddress + lightingFixtureChannelCount(normalizedFixtureType) - 1;
        const overlapFixture = fixtures.find((fixture) => {
          const fixtureType = normalizeFixtureType(fixture.type);
          const existingStartAddress = asNumber(fixture.dmxStartAddress, 1);
          const existingEndAddress = existingStartAddress + lightingFixtureChannelCount(fixtureType) - 1;
          return requestedStartAddress <= existingEndAddress && requestedEndAddress >= existingStartAddress;
        });
        if (overlapFixture) {
          throw new Error(
            `DMX address overlaps with '${asString(overlapFixture.name, "Fixture")}' at ${asNumber(
              overlapFixture.dmxStartAddress,
              0
            )}.`
          );
        }

        const createdFixture: JsonObject = {
          id: nextCustomFixtureId(fixtures),
          name,
          type: normalizedFixtureType,
          dmxStartAddress: requestedStartAddress,
          kind: lightingFixtureKindForType(normalizedFixtureType),
          groupId: groupId || null,
          spatialRotation: 0,
          on: false,
          intensity: 100,
          cct: defaultLightingFixtureCct(normalizedFixtureType),
        };

        lightingSnapshot.fixtures = [...fixtures, createdFixture];
        synchronizeLightingGroupCounts(lightingSnapshot);
        lightingSnapshot.scenes = scenes.map((scene) => ({
          ...scene,
          fixtureCount: asArray(scene.fixtureStates).length + 1,
          fixtureStates: [
            ...asArray(scene.fixtureStates),
            {
              fixtureId: createdFixture.id,
              intensity: 100,
              cct: defaultLightingFixtureCct(normalizedFixtureType),
              on: false,
            },
          ],
        }));

        const summary = `Lighting fixture '${name}' was created as ${normalizedFixtureType} on DMX ${requestedStartAddress}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "fixture-created" });
        return {
          fixture: cloneJson(createdFixture),
          summary,
        };
      }
      case "lighting.fixture.update": {
        const fixtureId = asString(params.fixtureId).trim();
        if (!fixtureId) {
          throw new Error("fixtureId is required");
        }

        const hasName = typeof params.name === "string";
        const hasType = typeof params.type === "string";
        const hasOn = typeof params.on === "boolean";
        const hasIntensity = typeof params.intensity === "number";
        const hasCct = typeof params.cct === "number";
        const hasDmxStartAddress = typeof params.dmxStartAddress === "number";
        const hasGroupId = Object.prototype.hasOwnProperty.call(params, "groupId");
        const hasSpatialX = Object.prototype.hasOwnProperty.call(params, "spatialX");
        const hasSpatialY = Object.prototype.hasOwnProperty.call(params, "spatialY");
        const hasRigZ = Object.prototype.hasOwnProperty.call(params, "rigZ");
        const hasBeamAngleDegrees = Object.prototype.hasOwnProperty.call(params, "beamAngleDegrees");
        if (
          !hasName &&
          !hasType &&
          !hasOn &&
          !hasIntensity &&
          !hasCct &&
          !hasDmxStartAddress &&
          !hasGroupId &&
          !hasSpatialX &&
          !hasSpatialY &&
          !hasRigZ &&
          !hasBeamAngleDegrees
        ) {
          throw new Error("lighting.fixture.update requires one or more supported fields");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const previewActive = lightingPreviewActive(lightingSnapshot);
        const fixtures = lightingFixtures(lightingSnapshot);
        const groups = asArray(lightingSnapshot.groups)
          .map((group) => asRecord(group))
          .filter((group): group is JsonObject => group !== null);
        const targetFixture = fixtures.find((fixture) => asString(fixture.id) === fixtureId);
        if (!targetFixture) {
          throw new Error(`Lighting fixture '${fixtureId}' is not present in the fixture inventory.`);
        }

        if (previewActive) {
          if (
            hasName ||
            hasType ||
            hasDmxStartAddress ||
            hasGroupId ||
            hasSpatialX ||
            hasSpatialY ||
            hasRigZ ||
            hasBeamAngleDegrees
          ) {
            throw new Error("Preview mode only supports fixture power, intensity, and CCT updates.");
          }
          const previewFixtures = lightingFixtures(lightingSnapshot, "previewFixtures");
          const editableFixtures =
            previewFixtures.length > 0 ? previewFixtures : fixtures.map((fixture) => ({ ...fixture }));
          const previewTarget = editableFixtures.find((fixture) => asString(fixture.id) === fixtureId) ?? targetFixture;
          const normalizedFixtureType = normalizeFixtureType(targetFixture.type);
          const cctRange = lightingFixtureCctRange(normalizedFixtureType);
          const defaultCct = defaultLightingFixtureCct(normalizedFixtureType);
          const updatedFixture: JsonObject = {
            ...previewTarget,
            ...(hasOn ? { on: params.on } : {}),
            ...(hasIntensity
              ? {
                  intensity: Math.max(
                    0,
                    Math.min(100, Math.round(asNumber(params.intensity, asNumber(previewTarget.intensity, 0))))
                  ),
                }
              : {}),
            ...(hasCct
              ? {
                  cct: clampNumber(
                    (() => {
                      const requested = Math.round(asNumber(params.cct, asNumber(previewTarget.cct, defaultCct)));
                      return requested === 0 ? defaultCct : requested;
                    })(),
                    cctRange.min,
                    cctRange.max
                  ),
                }
              : {}),
          };
          lightingSnapshot.previewFixtures = editableFixtures.map((fixture) =>
            asString(fixture.id) === fixtureId ? updatedFixture : fixture
          );
          lightingSnapshot.previewDirty = true;
          const summary = `Preview fixture '${asString(updatedFixture.name, fixtureId)}' updated.`;
          lightingSnapshot.lastActionStatus = "succeeded";
          lightingSnapshot.lastActionCode = null;
          lightingSnapshot.lastActionMessage = summary;
          lightingSnapshot.summary = summary;
          state.lightingSnapshot = lightingSnapshot;
          synchronizeFixtureState(state);
          emit("lighting.changed", { reason: "fixture-preview-updated" });
          return {
            fixture: cloneJson(updatedFixture),
            source: "preview",
            summary,
          };
        }

        if (!asBoolean(lightingSnapshot.reachable, false)) {
          throw new Error("Lighting fixture update requires a reachable lighting transport.");
        }

        const requestedType = hasType ? normalizeFixtureType(params.type) : null;
        if (hasType && !requestedType) {
          throw new Error("type is required");
        }
        const normalizedFixtureType = requestedType ?? normalizeFixtureType(targetFixture.type);
        const cctRange = lightingFixtureCctRange(normalizedFixtureType);
        const defaultCct = defaultLightingFixtureCct(normalizedFixtureType);
        const maxDmxStartAddress = lightingFixtureMaxStartAddress(normalizedFixtureType);
        const nextDmxStartAddress = hasDmxStartAddress
          ? Math.round(asNumber(params.dmxStartAddress, asNumber(targetFixture.dmxStartAddress, 1)))
          : asNumber(targetFixture.dmxStartAddress, 1);
        if (nextDmxStartAddress < 1 || nextDmxStartAddress > maxDmxStartAddress) {
          throw new Error(
            `DMX start address must be between 1 and ${maxDmxStartAddress} for fixture type '${normalizedFixtureType}'.`
          );
        }

        const nextDmxEndAddress = nextDmxStartAddress + lightingFixtureChannelCount(normalizedFixtureType) - 1;
        const overlapFixture = fixtures.find((fixture) => {
          if (asString(fixture.id) === fixtureId) {
            return false;
          }

          const fixtureType = normalizeFixtureType(fixture.type);
          const existingStartAddress = asNumber(fixture.dmxStartAddress, 1);
          const existingEndAddress = existingStartAddress + lightingFixtureChannelCount(fixtureType) - 1;
          return nextDmxStartAddress <= existingEndAddress && nextDmxEndAddress >= existingStartAddress;
        });
        if (overlapFixture) {
          throw new Error(
            `DMX address overlaps with '${asString(overlapFixture.name, "Fixture")}' at ${asNumber(
              overlapFixture.dmxStartAddress,
              0
            )}.`
          );
        }

        const nextGroupId = hasGroupId ? asString(params.groupId).trim() : asString(targetFixture.groupId).trim();
        if (nextGroupId && !groups.some((group) => asString(group.id) === nextGroupId)) {
          throw new Error(`Lighting group '${nextGroupId}' is not present in the group list.`);
        }

        const updatedFixture: JsonObject = {
          ...targetFixture,
          ...(hasName ? { name: asString(params.name).trim() || asString(targetFixture.name) } : {}),
          ...(hasType ? { type: normalizedFixtureType } : {}),
          ...(hasOn ? { on: params.on } : {}),
          ...(hasDmxStartAddress ? { dmxStartAddress: nextDmxStartAddress } : {}),
          ...(hasGroupId ? { groupId: nextGroupId || null } : {}),
          ...(hasSpatialX
            ? {
                spatialX:
                  params.spatialX === null
                    ? null
                    : clampNumber(asNumber(params.spatialX, asNumber(targetFixture.spatialX, 0.5)), 0, 1),
              }
            : {}),
          ...(hasSpatialY
            ? {
                spatialY:
                  params.spatialY === null
                    ? null
                    : clampNumber(asNumber(params.spatialY, asNumber(targetFixture.spatialY, 0.5)), 0, 1),
              }
            : {}),
          ...(hasRigZ
            ? {
                rigZ:
                  params.rigZ === null
                    ? null
                    : clampNumber(asNumber(params.rigZ, asNumber(targetFixture.rigZ, 0)), 0, 20),
              }
            : {}),
          ...(hasBeamAngleDegrees
            ? {
                beamAngleDegrees:
                  params.beamAngleDegrees === null
                    ? null
                    : clampNumber(
                        asNumber(params.beamAngleDegrees, defaultLightingBeamAngle(normalizedFixtureType)),
                        1,
                        180
                      ),
              }
            : {}),
          ...(hasIntensity
            ? {
                intensity: Math.max(
                  0,
                  Math.min(100, Math.round(asNumber(params.intensity, asNumber(targetFixture.intensity, 0))))
                ),
              }
            : {}),
          ...(hasCct
            ? {
                cct: clampNumber(
                  (() => {
                    const requested = Math.round(asNumber(params.cct, asNumber(targetFixture.cct, defaultCct)));
                    return requested === 0 ? defaultCct : requested;
                  })(),
                  cctRange.min,
                  cctRange.max
                ),
              }
            : {}),
        };
        lightingSnapshot.fixtures = fixtures.map((fixture) =>
          asString(fixture.id) === fixtureId ? updatedFixture : fixture
        );
        synchronizeLightingGroupCounts(lightingSnapshot);

        const summary = buildLightingFixtureUpdateSummary(updatedFixture);
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "fixture-updated" });
        return {
          fixture: cloneJson(updatedFixture),
          summary,
        };
      }
      case "lighting.group.power": {
        const groupId = asString(params.groupId).trim();
        if (!groupId) {
          throw new Error("groupId is required");
        }

        const on = typeof params.on === "boolean" ? params.on : null;
        if (on === null) {
          throw new Error("on must be a boolean");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const groups = asArray(lightingSnapshot.groups)
          .map((group) => asRecord(group))
          .filter((group): group is JsonObject => group !== null);
        const targetGroup = groups.find((group) => asString(group.id) === groupId);
        if (!targetGroup) {
          throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
        }

        const previewActive = lightingPreviewActive(lightingSnapshot);
        const fixtures = previewActive
          ? lightingFixtures(lightingSnapshot, "previewFixtures")
          : lightingFixtures(lightingSnapshot);
        const affectedFixtures = fixtures.filter((fixture) => asString(fixture.groupId) === groupId).length;
        if (affectedFixtures === 0) {
          throw new Error(
            `Lighting group '${asString(targetGroup.name, groupId)}' does not currently contain fixtures.`
          );
        }

        if (!previewActive && !asBoolean(lightingSnapshot.reachable, false)) {
          throw new Error("Lighting group power requires a reachable lighting transport.");
        }

        const nextFixtures = fixtures.map((fixture) =>
          asString(fixture.groupId) === groupId ? { ...fixture, on } : fixture
        );
        if (previewActive) {
          lightingSnapshot.previewFixtures = nextFixtures;
          lightingSnapshot.previewDirty = true;
        } else {
          lightingSnapshot.fixtures = nextFixtures;
        }

        const summary = `Lighting group '${asString(targetGroup.name, groupId)}' set ${on ? "on" : "off"} across ${affectedFixtures} fixtures${previewActive ? " in preview" : ""}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: previewActive ? "group-preview-powered" : "group-powered" });
        return {
          affectedFixtures,
          groupId,
          groupName: asString(targetGroup.name, groupId),
          summary,
        };
      }
      case "lighting.group.create": {
        const name = asString(params.name).trim();
        if (!name) {
          throw new Error("name is required");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const groups = asArray(lightingSnapshot.groups)
          .map((group) => asRecord(group))
          .filter((group): group is JsonObject => group !== null);
        const createdGroup = {
          id: nextCustomGroupId(groups),
          name,
          fixtureCount: 0,
        };

        lightingSnapshot.groups = [...groups, createdGroup];
        const summary = `Lighting group '${name}' was created.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "group-created" });
        return {
          group: cloneJson(createdGroup),
          summary,
        };
      }
      case "lighting.group.update": {
        const groupId = asString(params.groupId).trim();
        if (!groupId) {
          throw new Error("groupId is required");
        }
        const hasName = typeof params.name === "string";
        const hasColor = Object.prototype.hasOwnProperty.call(params, "colorIndex");
        if (!hasName && !hasColor) {
          throw new Error("lighting.group.update requires a name or colorIndex");
        }
        const nextName = hasName ? asString(params.name).trim() : null;
        if (hasName && !nextName) {
          throw new Error("name must not be empty");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const groups = asArray(lightingSnapshot.groups)
          .map((group) => asRecord(group))
          .filter((group): group is JsonObject => group !== null);
        const targetGroup = groups.find((group) => asString(group.id) === groupId);
        if (!targetGroup) {
          throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
        }

        let nextColorIndex: number | null = (targetGroup.colorIndex as number | null | undefined) ?? null;
        if (hasColor) {
          if (params.colorIndex === null) {
            nextColorIndex = null;
          } else {
            const raw = asNumber(params.colorIndex, NaN);
            if (!Number.isInteger(raw) || raw < 0 || raw > 7) {
              throw new Error("colorIndex must be an integer 0..7 or null");
            }
            nextColorIndex = raw;
          }
        }

        const updatedGroup: JsonObject = {
          ...targetGroup,
          ...(hasName && nextName ? { name: nextName } : {}),
          colorIndex: nextColorIndex,
        };
        lightingSnapshot.groups = groups.map((group) => (asString(group.id) === groupId ? updatedGroup : group));
        const summaryParts: string[] = [];
        if (hasName && nextName) summaryParts.push(`renamed to '${nextName}'`);
        if (hasColor) summaryParts.push(nextColorIndex === null ? "color cleared" : "recolored");
        const groupName = asString(updatedGroup.name, groupId);
        const summary = `Lighting group '${groupName}' ${summaryParts.join(" + ")}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "group-updated" });
        return {
          group: cloneJson(updatedGroup),
          summary,
        };
      }
      case "lighting.group.delete": {
        const groupId = asString(params.groupId).trim();
        if (!groupId) {
          throw new Error("groupId is required");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const groups = asArray(lightingSnapshot.groups)
          .map((group) => asRecord(group))
          .filter((group): group is JsonObject => group !== null);
        const targetGroup = groups.find((group) => asString(group.id) === groupId);
        if (!targetGroup) {
          throw new Error(`Lighting group '${groupId}' is not present in the group list.`);
        }
        const groupName = asString(targetGroup.name, groupId);

        // Engine semantics: deleting a group clears its members' groupId
        // assignments but leaves the fixtures themselves in the rig.
        const fixtures = asArray(lightingSnapshot.fixtures)
          .map((fixture) => asRecord(fixture))
          .filter((fixture): fixture is JsonObject => fixture !== null)
          .map((fixture) => (asString(fixture.groupId) === groupId ? { ...fixture, groupId: null } : fixture));

        lightingSnapshot.groups = groups.filter((group) => asString(group.id) !== groupId);
        lightingSnapshot.fixtures = fixtures;
        const summary = `Lighting group '${groupName}' was deleted.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: "group-deleted" });
        return {
          groupId,
          groupName,
          summary,
        };
      }
      case "lighting.power.all": {
        const on = typeof params.on === "boolean" ? params.on : null;
        if (on === null) {
          throw new Error("on must be a boolean");
        }

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const previewActive = lightingPreviewActive(lightingSnapshot);
        const fixtures = previewActive
          ? lightingFixtures(lightingSnapshot, "previewFixtures")
          : lightingFixtures(lightingSnapshot);
        if (fixtures.length === 0) {
          throw new Error("No lighting fixtures are exposed by the fixture transport.");
        }

        const nextFixtures = fixtures.map((fixture) => ({ ...fixture, on }));
        if (previewActive) {
          lightingSnapshot.previewFixtures = nextFixtures;
          lightingSnapshot.previewDirty = true;
        } else {
          lightingSnapshot.fixtures = nextFixtures;
        }

        const summary = `All native lighting fixtures set ${on ? "on" : "off"} across ${fixtures.length} fixtures${previewActive ? " in preview" : ""}.`;
        lightingSnapshot.lastActionStatus = "succeeded";
        lightingSnapshot.lastActionCode = null;
        lightingSnapshot.lastActionMessage = summary;
        lightingSnapshot.summary = summary;
        state.lightingSnapshot = lightingSnapshot;
        synchronizeFixtureState(state);
        emit("lighting.changed", { reason: previewActive ? "all-preview-powered" : "all-powered" });
        return {
          affectedFixtures: fixtures.length,
          summary,
        };
      }
      case "support.backup.export": {
        const backupEntry = buildFixtureBackupEntry(state);
        const backups = asArray(state.supportSnapshot.backups)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        backups.unshift(backupEntry);
        state.supportSnapshot.backups = backups;
        synchronizeFixtureState(state);
        emit("support.changed", { reason: "backup-exported" });
        return {
          actionCount: countControls(state),
          activityEntryCount: countPlanningActivity(state),
          fileName: backupEntry.name,
          formatVersion: 2,
          path: backupEntry.path,
          projectCount: asNumber(state.commissioningSnapshot.planningProjectCount, 0),
          taskCount: asNumber(state.commissioningSnapshot.planningTaskCount, 0),
        };
      }
      case "planning.report.time": {
        const projectId =
          typeof params.projectId === "string" && params.projectId.trim().length > 0 ? params.projectId.trim() : null;
        return buildPlanningTimeReport(state, projectId);
      }
      case "planning.project.create": {
        const title = asString(params.title).trim();
        if (!title) {
          throw new Error("title is required");
        }

        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const projects = asArray(planningSnapshot.projects)
          .map((project) => asRecord(project))
          .filter((project): project is JsonObject => project !== null);
        const settings = asRecord(planningSnapshot.settings) ?? {};
        const nextStatus = normalizePlanningProjectStatus(params.status);
        const nextPriority = normalizePlanningPriority(params.priority);
        const nextOrder =
          projects
            .filter((project) => asString(project.status) === nextStatus)
            .reduce((highest, project) => Math.max(highest, asNumber(project.order, 0)), 0) + 1;
        const createdProject: JsonObject = {
          id: `proj-${Date.now()}`,
          title,
          description: asString(params.description),
          status: nextStatus,
          priority: nextPriority,
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          order: nextOrder,
        };

        planningSnapshot.projects = [...projects, createdProject];
        settings.selectedProjectId = asString(createdProject.id);
        settings.selectedTaskId = null;
        planningSnapshot.settings = settings;

        const activityLog = asArray(planningSnapshot.activityLog);
        activityLog.unshift({
          id: `planning-project-created-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entityType: "project",
          entityId: createdProject.id,
          action: "project-created",
          detail: `Project '${title}' was created.`,
        });
        planningSnapshot.activityLog = activityLog;

        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "project-created" });
        return {
          context: cloneJson(asRecord(state.planningSnapshot)),
          project: cloneJson(createdProject),
        };
      }
      case "planning.project.reorder": {
        const projectId = asString(params.projectId).trim();
        if (!projectId) {
          throw new Error("projectId is required");
        }

        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const projects = asArray(planningSnapshot.projects)
          .map((project) => asRecord(project))
          .filter((project): project is JsonObject => project !== null);
        const settings = asRecord(planningSnapshot.settings) ?? {};
        const targetProject = projects.find((project) => asString(project.id) === projectId);
        if (!targetProject) {
          throw new Error(`Planning project '${projectId}' was not found.`);
        }

        const currentStatus = normalizePlanningProjectStatus(targetProject.status);
        const nextStatus = "newStatus" in params ? normalizePlanningProjectStatus(params.newStatus) : currentStatus;
        const requestedIndex = "newIndex" in params ? Math.max(0, Math.round(asNumber(params.newIndex, 0))) : null;
        const nextProject: JsonObject = {
          ...targetProject,
          status: nextStatus,
          lastUpdated: new Date().toISOString(),
        };

        const remainingProjects = projects.filter((project) => asString(project.id) !== projectId);
        const nextProjects: JsonObject[] = [];
        const orderedStatuses: Array<"todo" | "in-progress" | "blocked" | "done"> = [
          "todo",
          "in-progress",
          "blocked",
          "done",
        ];

        for (const status of orderedStatuses) {
          const statusProjects = remainingProjects
            .filter((project) => normalizePlanningProjectStatus(project.status) === status)
            .sort((left, right) => asNumber(left.order, 0) - asNumber(right.order, 0));
          if (status === nextStatus) {
            const insertIndex = Math.min(statusProjects.length, requestedIndex ?? statusProjects.length);
            statusProjects.splice(insertIndex, 0, nextProject);
          }

          statusProjects.forEach((project, index) => {
            nextProjects.push({
              ...project,
              order: index,
              status,
            });
          });
        }

        planningSnapshot.projects = nextProjects;
        planningSnapshot.settings = settings;

        const activityLog = asArray(planningSnapshot.activityLog);
        activityLog.unshift({
          id: `planning-project-reordered-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entityType: "project",
          entityId: projectId,
          action: nextStatus === currentStatus ? "reordered" : "status_changed",
          detail:
            nextStatus === currentStatus
              ? `Reordered project "${asString(targetProject.title)}"`
              : `Moved project "${asString(targetProject.title)}" from ${currentStatus} to ${nextStatus}`,
        });
        planningSnapshot.activityLog = activityLog.slice(0, 40);

        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "project-reordered" });
        return {
          context: cloneJson(asRecord(state.planningSnapshot)),
          project: cloneJson(nextProjects.find((project) => asString(project.id) === projectId) ?? nextProject),
        };
      }
      case "planning.task.create": {
        const title = asString(params.title).trim();
        if (!title) {
          throw new Error("title is required");
        }

        const projectId = asString(params.projectId).trim();
        if (!projectId) {
          throw new Error("projectId is required");
        }

        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const projects = asArray(planningSnapshot.projects)
          .map((project) => asRecord(project))
          .filter((project): project is JsonObject => project !== null);
        const tasks = asArray(planningSnapshot.tasks)
          .map((task) => asRecord(task))
          .filter((task): task is JsonObject => task !== null);
        const settings = asRecord(planningSnapshot.settings) ?? {};
        const project = projects.find((entry) => asString(entry.id) === projectId);
        if (!project) {
          throw new Error(`Planning project '${projectId}' was not found.`);
        }

        const labels = asArray(params.labels)
          .map((label) => asString(label).trim())
          .filter((label) => label.length > 0);
        const timestamp = new Date().toISOString();
        const nextOrder =
          tasks
            .filter((task) => asString(task.projectId) === projectId)
            .reduce((highest, task) => Math.max(highest, asNumber(task.order, -1)), -1) + 1;
        const createdTask: JsonObject = {
          id: `task-${Date.now()}`,
          projectId,
          title,
          description: asString(params.description),
          priority: normalizePlanningPriority(params.priority),
          dueDate: typeof params.dueDate === "string" ? params.dueDate : null,
          labels,
          checklist: [],
          isRunning: false,
          totalSeconds: 0,
          lastStarted: null,
          completed: false,
          order: nextOrder,
          createdAt: timestamp,
        };

        planningSnapshot.tasks = [...tasks, createdTask];
        settings.selectedProjectId = projectId;
        settings.selectedTaskId = asString(createdTask.id);
        planningSnapshot.settings = settings;

        const activityLog = asArray(planningSnapshot.activityLog);
        activityLog.unshift({
          id: `planning-task-created-${Date.now()}`,
          timestamp,
          entityType: "task",
          entityId: createdTask.id,
          action: "created",
          detail: `Task "${title}" created`,
        });
        planningSnapshot.activityLog = activityLog.slice(0, 40);

        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "task-created" });
        return {
          context: cloneJson(asRecord(state.planningSnapshot)),
          task: cloneJson(createdTask),
        };
      }
      case "planning.task.checklist.add": {
        const taskId = asString(params.taskId).trim();
        if (!taskId) {
          throw new Error("taskId is required");
        }

        const text = asString(params.text).trim();
        if (!text) {
          throw new Error("text is required");
        }

        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const tasks = asArray(planningSnapshot.tasks)
          .map((task) => asRecord(task))
          .filter((task): task is JsonObject => task !== null);
        const targetTask = tasks.find((task) => asString(task.id) === taskId);
        if (!targetTask) {
          throw new Error(`Planning task '${taskId}' was not found.`);
        }

        const checklist = asArray(targetTask.checklist)
          .map((item) => asRecord(item))
          .filter((item): item is JsonObject => item !== null);
        const createdItem: JsonObject = {
          id: `checklist-${Date.now()}`,
          text,
          done: false,
        };
        const updatedTask: JsonObject = {
          ...targetTask,
          checklist: [...checklist, createdItem],
        };

        planningSnapshot.tasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));

        const activityLog = asArray(planningSnapshot.activityLog);
        activityLog.unshift({
          id: `planning-checklist-added-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entityType: "task",
          entityId: taskId,
          action: "checklist_added",
          detail: `Checklist item "${text}" added`,
        });
        planningSnapshot.activityLog = activityLog.slice(0, 40);

        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "task-checklist-added" });
        return {
          context: cloneJson(asRecord(state.planningSnapshot)),
          task: cloneJson(updatedTask),
        };
      }
      case "planning.task.checklist.update": {
        const taskId = asString(params.taskId).trim();
        if (!taskId) {
          throw new Error("taskId is required");
        }

        const itemId = asString(params.itemId).trim();
        if (!itemId) {
          throw new Error("itemId is required");
        }

        if (!("done" in params) && !("text" in params)) {
          throw new Error("planning.task.checklist.update requires one or more supported fields");
        }

        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const tasks = asArray(planningSnapshot.tasks)
          .map((task) => asRecord(task))
          .filter((task): task is JsonObject => task !== null);
        const targetTask = tasks.find((task) => asString(task.id) === taskId);
        if (!targetTask) {
          throw new Error(`Planning task '${taskId}' was not found.`);
        }

        const checklist = asArray(targetTask.checklist)
          .map((item) => asRecord(item))
          .filter((item): item is JsonObject => item !== null);
        const targetItem = checklist.find((item) => asString(item.id) === itemId);
        if (!targetItem) {
          throw new Error(`Planning checklist item '${itemId}' was not found.`);
        }

        const nextText = "text" in params ? asString(params.text).trim() : asString(targetItem.text);
        if (!nextText) {
          throw new Error("text must not be empty");
        }

        const nextDone = "done" in params ? asBoolean(params.done, false) : asBoolean(targetItem.done, false);
        const updatedItem: JsonObject = {
          ...targetItem,
          done: nextDone,
          text: nextText,
        };
        const updatedTask: JsonObject = {
          ...targetTask,
          checklist: checklist.map((item) => (asString(item.id) === itemId ? updatedItem : item)),
        };

        planningSnapshot.tasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));

        const activityLog = asArray(planningSnapshot.activityLog);
        activityLog.unshift({
          id: `planning-checklist-updated-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entityType: "task",
          entityId: taskId,
          action: "checklist_updated",
          detail: "done" in params ? `Checklist item ${nextDone ? "checked" : "unchecked"}` : "Checklist item updated",
        });
        planningSnapshot.activityLog = activityLog.slice(0, 40);

        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "task-checklist-updated" });
        return {
          context: cloneJson(asRecord(state.planningSnapshot)),
          task: cloneJson(updatedTask),
        };
      }
      case "planning.settings.update": {
        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const settings = asRecord(planningSnapshot.settings) ?? {};
        const projects = asArray(planningSnapshot.projects)
          .map((project) => asRecord(project))
          .filter((project): project is JsonObject => project !== null);
        const tasks = asArray(planningSnapshot.tasks)
          .map((task) => asRecord(task))
          .filter((task): task is JsonObject => task !== null);

        if ("viewFilter" in params) {
          settings.viewFilter = normalizePlanningViewFilter(params.viewFilter);
        }

        if ("modeSection" in params) {
          settings.modeSection = normalizePlanningModeSection(params.modeSection);
        }

        if ("timelineStartHour" in params) {
          settings.timelineStartHour = clampNumber(
            Math.round(asNumber(params.timelineStartHour, asNumber(settings.timelineStartHour, 9))),
            0,
            23
          );
        }

        if ("timelineEndHour" in params) {
          settings.timelineEndHour = clampNumber(
            Math.round(asNumber(params.timelineEndHour, asNumber(settings.timelineEndHour, 22))),
            1,
            23
          );
        }

        if (asNumber(settings.timelineEndHour, 22) <= asNumber(settings.timelineStartHour, 9)) {
          settings.timelineEndHour = Math.min(23, asNumber(settings.timelineStartHour, 9) + 1);
        }

        if ("selectedTaskId" in params) {
          const requestedTaskId = typeof params.selectedTaskId === "string" ? params.selectedTaskId : null;
          const selectedTask =
            requestedTaskId !== null ? (tasks.find((task) => asString(task.id) === requestedTaskId) ?? null) : null;
          settings.selectedTaskId = selectedTask ? asString(selectedTask.id) : null;
          settings.selectedProjectId = selectedTask ? asString(selectedTask.projectId) : null;
        } else if ("selectedProjectId" in params) {
          const requestedProjectId = typeof params.selectedProjectId === "string" ? params.selectedProjectId : null;
          const selectedProject =
            requestedProjectId !== null
              ? (projects.find((project) => asString(project.id) === requestedProjectId) ?? null)
              : null;
          settings.selectedProjectId = selectedProject ? asString(selectedProject.id) : null;
          if (selectedProject) {
            const firstTask = tasks
              .filter((task) => asString(task.projectId) === asString(selectedProject.id))
              .sort((left, right) => asNumber(left.order) - asNumber(right.order))[0];
            settings.selectedTaskId = firstTask ? asString(firstTask.id) : null;
          } else {
            settings.selectedTaskId = null;
          }
        }

        planningSnapshot.settings = settings;
        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "settings-updated" });
        return {
          settings: cloneJson(settings),
        };
      }
      case "planning.task.reschedule": {
        const taskId = asString(params.taskId).trim();
        if (!taskId) {
          throw new Error("taskId is required");
        }

        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const tasks = asArray(planningSnapshot.tasks)
          .map((task) => asRecord(task))
          .filter((task): task is JsonObject => task !== null);
        const targetTask = tasks.find((task) => asString(task.id) === taskId);
        if (!targetTask) {
          throw new Error(`Planning task '${taskId}' was not found.`);
        }

        const requestedProjectId =
          "projectId" in params ? asString(params.projectId).trim() : asString(targetTask.projectId);
        if (!requestedProjectId) {
          throw new Error("projectId is required");
        }

        const projects = asArray(planningSnapshot.projects)
          .map((project) => asRecord(project))
          .filter((project): project is JsonObject => project !== null);
        const targetProject = projects.find((project) => asString(project.id) === requestedProjectId);
        if (!targetProject) {
          throw new Error(`Planning project '${requestedProjectId}' was not found.`);
        }

        if (!("scheduledStart" in params) && !("scheduledDurationSeconds" in params) && !("projectId" in params)) {
          throw new Error("planning.task.reschedule requires scheduledStart, scheduledDurationSeconds, or projectId");
        }

        const nextScheduledStart =
          "scheduledStart" in params
            ? typeof params.scheduledStart === "string"
              ? params.scheduledStart
              : null
            : targetTask.scheduledStart;
        const nextScheduledDurationSeconds =
          "scheduledDurationSeconds" in params
            ? params.scheduledDurationSeconds === null
              ? null
              : Math.max(0, Math.round(asNumber(params.scheduledDurationSeconds, 0)))
            : targetTask.scheduledDurationSeconds;
        const nextProjectId = requestedProjectId;
        const currentProjectId = asString(targetTask.projectId);
        const movedAcrossProjects = nextProjectId !== currentProjectId;
        const nextOrder = movedAcrossProjects
          ? tasks
              .filter((task) => asString(task.projectId) === nextProjectId)
              .reduce((highest, task) => Math.max(highest, asNumber(task.order, -1)), -1) + 1
          : asNumber(targetTask.order, 0);

        const updatedTask: JsonObject = {
          ...targetTask,
          order: nextOrder,
          projectId: nextProjectId,
          scheduledStart: nextScheduledStart,
          scheduledDurationSeconds: nextScheduledDurationSeconds,
        };
        const nextTasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));
        if (movedAcrossProjects) {
          const sourceTasks = nextTasks
            .filter((task) => asString(task.projectId) === currentProjectId && asString(task.id) !== taskId)
            .sort((left, right) => asNumber(left.order, 0) - asNumber(right.order, 0));
          sourceTasks.forEach((task, index) => {
            task.order = index;
          });
        }
        planningSnapshot.tasks = nextTasks;

        const settings = asRecord(planningSnapshot.settings) ?? {};
        if (movedAcrossProjects) {
          settings.selectedProjectId = nextProjectId;
        }
        settings.selectedTaskId = taskId;
        planningSnapshot.settings = settings;

        const activityLog = asArray(planningSnapshot.activityLog);
        const changes: string[] = [];
        if ("projectId" in params) {
          changes.push("projectId");
        }
        if ("scheduledStart" in params) {
          changes.push("scheduledStart");
        }
        if ("scheduledDurationSeconds" in params) {
          changes.push("scheduledDurationSeconds");
        }
        activityLog.unshift({
          id: `planning-reschedule-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entityType: "task",
          entityId: taskId,
          action: "rescheduled",
          detail: `Rescheduled ${changes.join(", ")}`,
        });
        planningSnapshot.activityLog = activityLog.slice(0, 40);
        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "task-rescheduled" });
        return {
          task: cloneJson(updatedTask),
        };
      }
      case "planning.task.toggleComplete": {
        const taskId = asString(params.taskId).trim();
        if (!taskId) {
          throw new Error("taskId is required");
        }

        const planningSnapshot = asRecord(state.planningSnapshot) ?? buildDefaultPlanningSnapshot();
        const tasks = asArray(planningSnapshot.tasks)
          .map((task) => asRecord(task))
          .filter((task): task is JsonObject => task !== null);
        const targetTask = tasks.find((task) => asString(task.id) === taskId);
        if (!targetTask) {
          throw new Error(`Planning task '${taskId}' was not found.`);
        }

        const newCompleted = !asBoolean(targetTask.completed, false);
        const updatedTask = {
          ...targetTask,
          completed: newCompleted,
        };

        planningSnapshot.tasks = tasks.map((task) => (asString(task.id) === taskId ? updatedTask : task));

        const activityLog = asArray(planningSnapshot.activityLog);
        activityLog.unshift({
          id: `planning-toggle-complete-${Date.now()}`,
          timestamp: new Date().toISOString(),
          entityType: "task",
          entityId: taskId,
          action: newCompleted ? "completed" : "uncompleted",
          detail: `Task "${asString(targetTask.title)}" marked as ${newCompleted ? "completed" : "incomplete"}`,
        });
        planningSnapshot.activityLog = activityLog.slice(0, 40);
        state.planningSnapshot = planningSnapshot;
        synchronizeFixtureState(state);
        emit("planning.changed", { reason: "task-toggled-complete" });
        return {
          context: cloneJson(asRecord(state.planningSnapshot)),
          task: cloneJson(updatedTask),
        };
      }
      case "support.backup.restore": {
        const path = asString(params.path);
        const backups = asArray(state.supportSnapshot.backups)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const backupMatch = backups.find((entry) => entry.path === path);
        const legacyImport = path.endsWith("db.json");

        if (!backupMatch && !legacyImport) {
          throw new Error("Backup file was not found.");
        }

        state.planningSnapshot = buildSeededPlanningSnapshot();
        state.commissioningSnapshot.runnerStage = "publish";
        state.commissioningSnapshot.stage = "ready";
        state.commissioningSnapshot.hasCompletedSetup = true;
        updateFixtureCheck(
          state,
          "control-surface",
          "passed",
          "Control surface bridge is reachable and restored bindings are current."
        );
        updateFixtureCheck(state, "lighting", "passed", "Lighting bridge settings were restored from support backup.");
        updateFixtureCheck(state, "audio", "passed", "Audio transport settings were restored from support backup.");
        synchronizeFixtureState(state);
        emit("support.changed", { reason: "backup-restored" });
        emit("commissioning.changed", { reason: "backup-restored" });
        emit("planning.changed", { reason: "backup-restored" });
        emit("app.changed", { reason: "backup-restored" });
        return {
          activityEntryCount: countPlanningActivity(state),
          checklistItemCount: Math.max(1, Math.floor(asNumber(state.commissioningSnapshot.planningTaskCount, 0) / 2)),
          projectCount: asNumber(state.commissioningSnapshot.planningProjectCount, 0),
          rollbackBackupPath: buildFixtureBackupEntry(state).path,
          settingsRestored: 12,
          sourceFormat: legacyImport ? "legacy-db-json" : "native-support-backup",
          sourcePath: path,
          taskCount: asNumber(state.commissioningSnapshot.planningTaskCount, 0),
        };
      }
      case "exports.companion.export": {
        const runtime = asRecord(state.appSnapshot.runtime) ?? {};
        const controlSurface = asRecord(runtime.controlSurface) ?? {};
        const baseUrl = asString(params.baseUrl, asString(controlSurface.baseUrl, "http://127.0.0.1:38201"));
        const pageCount = asArray(state.controlSurfaceSnapshot.pages).length;
        return {
          actionCount: countControls(state),
          baseUrl,
          fileName: "sse-exed-studio-control-native-fixture.companionconfig",
          pageCount,
          path: `${asString(asRecord(runtime.paths)?.appDataDir)}/exports/sse-exed-studio-control-native-fixture.companionconfig`,
        };
      }
      default:
        return {};
    }
  };

  return {
    async initialize() {
      const emitStartupEvent = () => {
        startupResolved = true;
        if (startupFailure) {
          rejectStartupGate(startupFailure);
        } else {
          resolveStartupGate();
        }
        emit(
          startupFailure ? "engine.startupFailed" : "engine.ready",
          startupFailure ?? {
            protocol: "1",
            engineVersion: "fixture",
          }
        );
      };

      if (startupDelayMs > 0) {
        window.setTimeout(emitStartupEvent, startupDelayMs);
        return;
      }

      window.setTimeout(emitStartupEvent, 0);
    },
    async request(method, params = {}) {
      if (method === "engine.ping" && !startupResolved) {
        await startupGate;
      }
      return handleRequest(method, params);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
