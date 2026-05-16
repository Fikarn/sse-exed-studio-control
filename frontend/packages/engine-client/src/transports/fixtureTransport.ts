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
  lightingFixtureCatalogSnapshot: JsonObject;
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

function normalizeTalentMarks(value: unknown): JsonObject[] {
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
      controlValues: asRecord(nextState.controlValues) ?? asRecord(fixture.controlValues) ?? {},
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

function buildAudioEq() {
  return {
    enabled: false,
    bands: [
      { id: "lc", label: "LC", enabled: false, frequencyHz: 80, gainDb: 0, q: 0.7, bandType: "low-cut" },
      { id: "lo", label: "LO", enabled: true, frequencyHz: 180, gainDb: 0, q: 0.9, bandType: "bell" },
      { id: "mid", label: "MID", enabled: true, frequencyHz: 1600, gainDb: 0, q: 1.2, bandType: "bell" },
      { id: "hi", label: "HI", enabled: false, frequencyHz: 8500, gainDb: 0, q: 0.8, bandType: "shelf" },
    ],
  };
}

function buildAudioDynamics() {
  return {
    compressor: { enabled: false, thresholdDb: -18, ratio: 2, attackMs: 12, releaseMs: 120, makeupDb: 0 },
    gate: { enabled: false, thresholdDb: -48, ratio: 1.5, attackMs: 4, releaseMs: 180, makeupDb: 0 },
  };
}

function buildAudioSendModes() {
  return {
    "audio-mix-main": { preFader: false, mute: false, linkStereo: true, solo: false },
    "audio-mix-phones-a": { preFader: false, mute: false, linkStereo: true, solo: false },
    "audio-mix-phones-b": { preFader: false, mute: false, linkStereo: true, solo: false },
  } satisfies JsonObject;
}

function buildAudioSnapshotPreview(hasContents = false) {
  return {
    hasContents,
    channelCount: hasContents ? 18 : 0,
    mixTargetCount: hasContents ? 3 : 0,
    changedChannels: [],
    changedMixTargets: [],
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
    pad: false,
    instrument: options.instrument === true,
    autoSet: options.autoSet === true,
    eq: buildAudioEq(),
    dynamics: buildAudioDynamics(),
    sendModes: buildAudioSendModes(),
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
    viewMode: "submix",
    capabilities: {
      canEditMixerState: true,
      canSync: true,
      canRecallConsoleSnapshot: true,
      canEditProcessing: true,
      canClearClips: true,
      canCaptureSnapshot: true,
      canUseMasterView: true,
    },
    consoleStateConfidence: "aligned",
    lastConsoleSyncAt: "2026-04-23T18:24:12+02:00",
    lastConsoleSyncReason: "manual sync",
    lastRecalledSnapshotId: "snapshot-show-open",
    lastSnapshotRecallAt: "2026-04-23T06:05:43+02:00",
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
        32,
        buildAudioMixLevels(0.7, 0.76, 0.5),
        0.72
      ),
      buildAudioChannel(
        "audio-input-10",
        "Co-host",
        "CO-HOST",
        "front-preamp",
        false,
        28,
        buildAudioMixLevels(0.68, 0.74, 0.48),
        0.64
      ),
      buildAudioChannel(
        "audio-input-11",
        "Guest 1",
        "GUEST 1",
        "front-preamp",
        false,
        45,
        buildAudioMixLevels(0.8, 0.8, 0.6),
        0.98
      ),
      buildAudioChannel(
        "audio-input-12",
        "Guest 2",
        "GUEST 2",
        "front-preamp",
        false,
        36,
        buildAudioMixLevels(0.64, 0.7, 0.52),
        0.58
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
        buildAudioMixLevels(0.9, 0.8, 0.78),
        0.78
      ),
      buildAudioChannel(
        "audio-playback-3-4",
        "FX 3/4",
        "FX",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.88, 0.6, 0.5),
        0.66,
        { solo: true }
      ),
      buildAudioChannel(
        "audio-playback-5-6",
        "N-1 5/6",
        "N-1",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.46, 0.3, 0.28),
        0.32
      ),
      buildAudioChannel(
        "audio-playback-7-8",
        "Music 7/8",
        "MUS",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.64, 0.52, 0.48),
        0.44
      ),
      buildAudioChannel(
        "audio-playback-9-10",
        "Playback 9/10",
        "PB 9/10",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.22, 0.16, 0.14),
        0.12
      ),
      buildAudioChannel(
        "audio-playback-11-12",
        "Playback 11/12",
        "PB 11/12",
        "playback-pair",
        true,
        0,
        buildAudioMixLevels(0.18, 0.12, 0.12),
        0.09
      ),
    ],
    mixTargets: [
      {
        id: "audio-mix-main",
        name: "Main Out",
        shortName: "MAIN",
        role: "main-out",
        volume: 0.78,
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
        volume: 0.56,
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
        volume: 0.42,
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
        lastRecalledAt: "2026-04-23T05:42:00+02:00",
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-show-open",
        name: "Show open",
        oscIndex: 1,
        order: 1,
        lastRecalled: true,
        lastRecalledAt: "2026-04-23T06:05:43+02:00",
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-interview-block",
        name: "Interview block",
        oscIndex: 2,
        order: 2,
        lastRecalled: false,
        lastRecalledAt: null,
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-break-bumper",
        name: "Break bumper",
        oscIndex: 3,
        order: 3,
        lastRecalled: false,
        lastRecalledAt: null,
        contents: null,
        preview: buildAudioSnapshotPreview(false),
      },
      {
        id: "snapshot-credits",
        name: "Credits",
        oscIndex: 4,
        order: 4,
        lastRecalled: false,
        lastRecalledAt: null,
        contents: null,
        preview: buildAudioSnapshotPreview(false),
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

function fixtureControl(
  id: string,
  label: string,
  min: number,
  max: number,
  defaultValue: number,
  unit?: string
): JsonObject {
  return {
    id,
    label,
    kind: "slider",
    valueType: "number",
    min,
    max,
    step: id === "cct" ? 100 : 1,
    defaultValue,
    unit: unit ?? null,
    options: [],
  };
}

function fixtureChannel(
  offset: number,
  label: string,
  controlId: string,
  valueType = "percent",
  defaultDmx = 0
): JsonObject {
  return {
    offset,
    label,
    controlId,
    valueType,
    defaultDmx,
  };
}

function fixtureMode(
  id: string,
  displayName: string,
  channels: JsonObject[],
  controls: JsonObject[],
  capabilities: string[],
  defaults: Record<string, number> = {}
): JsonObject {
  return {
    id,
    displayName,
    channelCount: channels.length,
    resolution: displayName.includes("16-bit") ? "16-bit" : "8-bit",
    capabilities,
    channels,
    controls,
    defaults,
  };
}

function fixtureDefinition(
  id: string,
  manufacturer: string,
  family: string,
  model: string,
  kind: string,
  defaultModeId: string,
  modes: JsonObject[],
  visual: JsonObject,
  status = "verified"
): JsonObject {
  const enrichedVisual = withFixtureVisualMetadata(id, family, kind, status, visual);
  return {
    id,
    manufacturer,
    family,
    model,
    displayName: `${family} ${model}`.trim(),
    status,
    sourceUrl: manufacturer === "Aputure" ? "https://help.aputure.com/" : "https://www.litepanels.com/",
    sourceVersion: status === "verified" ? "Fixture transport catalog mirror" : "Profile verification required",
    sourceDate: "2026-05-03",
    kind,
    defaultModeId,
    modes,
    visual: enrichedVisual,
  };
}

const FIXTURE_VISUAL_BEAM_ANGLES: Record<string, { max: number; min: number }> = {
  "aputure-infinibar-pb12": { min: 120, max: 120 },
  "aputure-infinimat-generic": { min: 100, max: 100 },
  "aputure-ls-600d-pro": { min: 15, max: 60 },
  "aputure-storm-1200x": { min: 12, max: 60 },
  "aputure-storm-80c": { min: 35, max: 60 },
  "litepanels-astra-bicolor": { min: 50, max: 50 },
  "litepanels-astra-ip": { min: 30, max: 30 },
  "litepanels-gemini-1x1": { min: 90, max: 90 },
  "litepanels-gemini-2x1": { min: 90, max: 90 },
  "litepanels-studio-x-bicolor": { min: 8, max: 70 },
};

function symbolKindForVisualShape(shape: string) {
  switch (shape) {
    case "bar":
      return "linear-bar";
    case "control-node":
      return "control-node";
    case "mat":
      return "soft-mat";
    case "panel":
      return "panel";
    case "fresnel":
    default:
      return "fresnel";
  }
}

function symbolVariantForFixtureDefinition(id: string, family: string, symbolKind: string) {
  switch (id) {
    case "aputure-infinibar-pb12":
      return "infinibar-pb12";
    case "aputure-infinimat-generic":
      return "infinimat";
    case "litepanels-apollo-bridge":
      return "apollo-bridge";
    case "litepanels-astra-bicolor":
      return "astra";
    case "litepanels-astra-ip":
      return "astra-ip";
    case "litepanels-gemini-1x1":
    case "litepanels-gemini-2x1":
      return "gemini";
    case "aputure-ls-600d-pro":
      return "light-storm";
    case "aputure-storm-80c":
    case "aputure-storm-1200x":
      return "storm";
    case "litepanels-studio-x-bicolor":
    case "litepanels-studio-x-daylight":
      return "studio-x";
    default:
      if (symbolKind === "panel") {
        if (family === "Astra") return "astra";
        if (family === "Astra IP") return "astra-ip";
        if (family === "Gemini") return "gemini";
        return "panel";
      }
      if (symbolKind === "fresnel") {
        if (family === "Light Storm") return "light-storm";
        if (family === "STORM") return "storm";
        if (family === "Studio X") return "studio-x";
        return "fresnel";
      }
      return symbolKind;
  }
}

function beamTypeForVisualShape(shape: string) {
  switch (shape) {
    case "bar":
      return "rectangle";
    case "control-node":
      return "none";
    case "mat":
    case "panel":
      return "wash";
    case "fresnel":
    default:
      return "fresnel";
  }
}

function visualConfidenceForFixtureDefinition(id: string, status: string) {
  if (status === "research-needed") return "fallback";
  if (id === "aputure-infinibar-pb12" || id === "litepanels-apollo-bridge") return "verified";
  return "catalogue-derived";
}

function photometricSamplesForFixtureDefinition(id: string): JsonObject[] {
  if (id !== "aputure-infinibar-pb12") return [];
  return [
    {
      cct: 5600,
      distanceMeters: 0.5,
      lux: 1600,
      modifier: "none",
      source: "Aputure INFINIBAR PB12 product page",
    },
    {
      cct: 5600,
      distanceMeters: 1.0,
      lux: 593,
      modifier: "none",
      source: "Aputure INFINIBAR PB12 product page",
    },
  ];
}

function emitterLayoutForVisual(id: string, symbolKind: string, visual: JsonObject): JsonObject | null {
  const pixelLayout = asRecord(visual.pixelLayout);
  if (!pixelLayout) return null;
  return {
    emitterKind: symbolKind === "linear-bar" ? "pixel-line" : symbolKind === "soft-mat" ? "pixel-mat" : "pixel-grid",
    rows: Math.max(1, Math.round(asNumber(pixelLayout.rows, 1))),
    columns: Math.max(1, Math.round(asNumber(pixelLayout.columns, 1))),
    segments: Math.max(1, Math.round(asNumber(pixelLayout.segments, 1))),
    physicalPixels: id === "aputure-infinibar-pb12" ? 96 : null,
    direction: asString(pixelLayout.order, "row-major"),
  };
}

function withFixtureVisualMetadata(
  id: string,
  family: string,
  kind: string,
  status: string,
  visual: JsonObject
): JsonObject {
  const shape = asString(visual.shape, kind === "panel" ? "panel" : "fresnel");
  const beamAngles = FIXTURE_VISUAL_BEAM_ANGLES[id];
  const beamAngleMin = typeof visual.beamAngleMin === "number" ? visual.beamAngleMin : (beamAngles?.min ?? null);
  const beamAngleMax = typeof visual.beamAngleMax === "number" ? visual.beamAngleMax : (beamAngles?.max ?? null);
  const symbolKind = symbolKindForVisualShape(shape);
  const beamType = beamTypeForVisualShape(shape);
  const output = {
    beamType,
    beamAngle: beamType === "none" ? null : (beamAngleMax ?? beamAngleMin),
    fieldAngle: beamType === "none" ? null : typeof visual.fieldAngle === "number" ? visual.fieldAngle : null,
    photometricSamples: photometricSamplesForFixtureDefinition(id),
  };

  return {
    ...visual,
    shape,
    symbolKind,
    symbolVariant: symbolVariantForFixtureDefinition(id, family, symbolKind),
    beamAngleMin,
    beamAngleMax,
    fieldAngle: typeof visual.fieldAngle === "number" ? visual.fieldAngle : null,
    emitterLayout: emitterLayoutForVisual(id, symbolKind, visual),
    output,
    visualConfidence: visualConfidenceForFixtureDefinition(id, status),
  };
}

function noDmxMode() {
  return fixtureMode("default", "No DMX profile", [], [], [], {});
}

function repeatedPixelChannels(pixelCount: number, labels: string[]) {
  const channels: JsonObject[] = [];
  for (let pixel = 1; pixel <= pixelCount; pixel += 1) {
    for (const label of labels) {
      channels.push(
        fixtureChannel(
          channels.length + 1,
          `Px ${pixel} ${label}`,
          label.toLowerCase().replace(/[ /]/g, "-"),
          label === "CCT" ? "kelvin" : "percent"
        )
      );
    }
  }
  return channels;
}

function buildDefaultLightingFixtureCatalogSnapshot(): JsonObject {
  const cctDefaults = (min: number, max: number, cct: number) => ({ intensity: 100, cct, cctMin: min, cctMax: max });
  const cctControls = (min: number, max: number, cct: number) => [
    fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
    fixtureControl("cct", "CCT", min, max, cct, "K"),
    fixtureControl("green-magenta", "Green/Magenta", -100, 100, 0),
    fixtureControl("fan", "Fan", 0, 255, 0),
  ];
  const hsiControls = (min: number, max: number, cct: number) => [
    ...cctControls(min, max, cct),
    fixtureControl("hue", "Hue", 0, 359, 0, "deg"),
    fixtureControl("saturation", "Saturation", 0, 100, 0, "%"),
  ];
  const visual = (
    shape: string,
    widthMm: number,
    heightMm: number,
    depthMm: number,
    pixelLayout: JsonObject | null = null
  ) => ({
    shape,
    widthMm,
    heightMm,
    depthMm,
    beamAngleMin: null,
    beamAngleMax: null,
    fieldAngle: null,
    pixelLayout,
  });
  const astraMode = fixtureMode(
    "default",
    "2 ch Dimmer + CCT",
    [fixtureChannel(1, "Dimmer", "intensity"), fixtureChannel(2, "CCT", "cct", "kelvin", 68)],
    [fixtureControl("intensity", "Intensity", 0, 100, 100, "%"), fixtureControl("cct", "CCT", 3200, 5600, 4400, "K")],
    ["intensity", "cct"],
    cctDefaults(3200, 5600, 4400)
  );
  const definitions = [
    fixtureDefinition(
      "litepanels-astra-bicolor",
      "Litepanels",
      "Astra",
      "Bi-Color",
      "profile",
      "default",
      [astraMode],
      visual("panel", 450, 300, 90)
    ),
    fixtureDefinition(
      "aputure-infinimat-generic",
      "Aputure",
      "INFINIMAT",
      "Generic mat profile",
      "wash",
      "default",
      [
        fixtureMode(
          "default",
          "4 ch Dimmer + CCT + Green/Magenta + Strobe",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 102),
            fixtureChannel(3, "+/- G/M", "green-magenta", "offset", 127),
            fixtureChannel(4, "Strobe", "strobe", "range"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2000, 10000, 5600, "K"),
            fixtureControl("green-magenta", "Green/Magenta", -100, 100, 0),
            fixtureControl("strobe", "Strobe", 0, 255, 0),
          ],
          ["intensity", "cct", "green-magenta", "strobe"],
          cctDefaults(2000, 10000, 5600)
        ),
        fixtureMode(
          "le-1x4-rgbww-8bit",
          "1x4 light-engine RGBWW 20 ch",
          repeatedPixelChannels(4, ["Dimmer", "CCT", "Red", "Green", "Blue"]),
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2000, 10000, 5600, "K"),
          ],
          ["intensity", "cct", "rgb", "pixel"],
          cctDefaults(2000, 10000, 5600)
        ),
      ],
      visual("mat", 1220, 305, 80, { pixelCount: 4, rows: 1, columns: 4, segments: 4, order: "row-major" })
    ),
    fixtureDefinition(
      "aputure-infinibar-pb12",
      "Aputure",
      "INFINIBAR",
      "PB12",
      "practical",
      "default",
      [
        fixtureMode(
          "default",
          "8 ch basic RGBWW",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 102),
            fixtureChannel(3, "Mix", "mix"),
            fixtureChannel(4, "Red", "red"),
            fixtureChannel(5, "Green", "green"),
            fixtureChannel(6, "Blue", "blue"),
            fixtureChannel(7, "FX", "fx", "range"),
            fixtureChannel(8, "Speed", "speed", "range"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2000, 10000, 5600, "K"),
            fixtureControl("red", "Red", 0, 255, 0),
            fixtureControl("green", "Green", 0, 255, 0),
            fixtureControl("blue", "Blue", 0, 255, 0),
            fixtureControl("fx", "FX", 0, 255, 0),
            fixtureControl("speed", "Speed", 0, 255, 0),
          ],
          ["intensity", "cct", "rgb", "fx"],
          cctDefaults(2000, 10000, 5600)
        ),
        fixtureMode(
          "pixel-rgb-48",
          "48 px RGB pixel map 144 ch",
          repeatedPixelChannels(48, ["Red", "Green", "Blue"]),
          [
            fixtureControl("red", "Red", 0, 255, 0),
            fixtureControl("green", "Green", 0, 255, 0),
            fixtureControl("blue", "Blue", 0, 255, 0),
          ],
          ["rgb", "pixel"],
          { red: 0, green: 0, blue: 0 }
        ),
      ],
      visual("bar", 1200, 45, 45, { pixelCount: 48, rows: 1, columns: 48, segments: 48, order: "left-to-right" })
    ),
    fixtureDefinition(
      "litepanels-apollo-bridge",
      "Litepanels",
      "Apollo",
      "Bridge",
      "control-node",
      "default",
      [noDmxMode()],
      visual("control-node", 180, 120, 40)
    ),
    fixtureDefinition(
      "aputure-ls-600d-pro",
      "Aputure",
      "Light Storm",
      "LS 600d Pro",
      "beam",
      "5ch-fx",
      [
        fixtureMode(
          "5ch-fx",
          "5 ch Dimmer + FX",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "Mode Selection", "mode", "range"),
            fixtureChannel(3, "FX Control", "fx", "range"),
            fixtureChannel(4, "FX Frequency", "speed", "range"),
            fixtureChannel(5, "FX Trigger", "trigger", "range"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("fx", "FX", 0, 255, 0),
            fixtureControl("speed", "Speed", 0, 255, 0),
          ],
          ["intensity", "fx"],
          cctDefaults(5600, 5600, 5600)
        ),
      ],
      visual("fresnel", 335, 338, 557)
    ),
    fixtureDefinition(
      "aputure-storm-80c",
      "Aputure",
      "STORM",
      "80c",
      "beam",
      "cct-rgb-8bit-7ch",
      [
        fixtureMode(
          "cct-rgb-8bit-7ch",
          "CCT & RGB 8-bit 7 ch",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 49),
            fixtureChannel(3, "+/- Green", "green-magenta", "offset", 127),
            fixtureChannel(4, "Red", "red"),
            fixtureChannel(5, "Green", "green"),
            fixtureChannel(6, "Blue", "blue"),
            fixtureChannel(7, "Color Crossfade", "mix"),
          ],
          hsiControls(1800, 20000, 5600),
          ["intensity", "cct", "rgb", "green-magenta"],
          cctDefaults(1800, 20000, 5600)
        ),
        fixtureMode(
          "hsic-control-16bit-13ch",
          "Limited HSIC+ Control 16-bit 13 ch",
          [
            fixtureChannel(1, "Dimmer coarse", "intensity"),
            fixtureChannel(2, "Dimmer fine", "intensity", "fine"),
            fixtureChannel(3, "Hue coarse", "hue", "degrees"),
            fixtureChannel(4, "Hue fine", "hue", "fine"),
            fixtureChannel(5, "Saturation coarse", "saturation"),
            fixtureChannel(6, "Saturation fine", "saturation", "fine"),
            fixtureChannel(7, "CCT coarse", "cct", "kelvin", 49),
            fixtureChannel(8, "CCT fine", "cct", "fine"),
            fixtureChannel(9, "+/- Green coarse", "green-magenta", "offset", 127),
            fixtureChannel(10, "+/- Green fine", "green-magenta", "fine"),
            fixtureChannel(11, "Control", "control", "range"),
            fixtureChannel(12, "Fan", "fan", "range"),
            fixtureChannel(13, "Dimming Curve", "dimming-curve", "range"),
          ],
          hsiControls(1800, 20000, 5600),
          ["intensity", "hsi", "cct", "green-magenta", "control"],
          cctDefaults(1800, 20000, 5600)
        ),
      ],
      visual("fresnel", 167, 225, 147)
    ),
    fixtureDefinition(
      "aputure-storm-1200x",
      "Aputure",
      "STORM",
      "1200x",
      "beam",
      "cct-plus-8bit-3ch",
      [
        fixtureMode(
          "cct-plus-8bit-3ch",
          "CCT+ 8-bit 3 ch",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 91),
            fixtureChannel(3, "+/- Green", "green-magenta", "offset", 127),
          ],
          cctControls(2500, 10000, 5600),
          ["intensity", "cct", "green-magenta"],
          cctDefaults(2500, 10000, 5600)
        ),
      ],
      visual("fresnel", 335, 338, 557)
    ),
    fixtureDefinition(
      "litepanels-astra-ip",
      "Litepanels",
      "Astra IP",
      "Astra IP",
      "profile",
      "p02-cct-8bit",
      [
        fixtureMode(
          "p01-cct-rgbw-8bit",
          "P01 CCT & RGBW 8-bit 12 ch",
          Array.from({ length: 12 }, (_, index) =>
            fixtureChannel(
              index + 1,
              [
                "Dimmer",
                "CCT",
                "Green Offset",
                "White/RGB Crossfade",
                "Red",
                "Green",
                "Blue",
                "White",
                "Fan",
                "Reserved",
                "Reserved",
                "Reserved",
              ][index]!,
              [
                "intensity",
                "cct",
                "green-magenta",
                "mix",
                "red",
                "green",
                "blue",
                "white",
                "fan",
                "reserved",
                "reserved",
                "reserved",
              ][index]!
            )
          ),
          cctControls(2700, 6500, 3200),
          ["intensity", "cct", "rgb", "fan"],
          cctDefaults(2700, 6500, 3200)
        ),
        fixtureMode(
          "p02-cct-8bit",
          "P02 CCT 8-bit 6 ch",
          Array.from({ length: 6 }, (_, index) =>
            fixtureChannel(
              index + 1,
              ["Dimmer", "CCT", "Green Offset", "Reserved", "DMX Mode Control", "Fan"][index]!,
              ["intensity", "cct", "green-magenta", "reserved", "mode", "fan"][index]!
            )
          ),
          cctControls(2700, 6500, 3200),
          ["intensity", "cct", "green-magenta", "fan"],
          cctDefaults(2700, 6500, 3200)
        ),
      ],
      visual("panel", 450, 300, 110)
    ),
    ...["1x1", "2x1"].map((model) =>
      fixtureDefinition(
        `litepanels-gemini-${model}`,
        "Litepanels",
        "Gemini",
        model,
        "wash",
        "p02-cct-8bit",
        [
          fixtureMode(
            "p02-cct-8bit",
            "P02 CCT 8-bit 6 ch",
            Array.from({ length: 6 }, (_, index) =>
              fixtureChannel(
                index + 1,
                ["Dimmer", "CCT", "Green Offset", "Reserved", "DMX Mode Control", "Fan"][index]!,
                ["intensity", "cct", "green-magenta", "reserved", "mode", "fan"][index]!
              )
            ),
            cctControls(2700, 10000, 3200),
            ["intensity", "cct", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
          fixtureMode(
            "p03-cct-hsi-8bit",
            "P03 CCT & HSI 8-bit 10 ch",
            Array.from({ length: 10 }, (_, index) =>
              fixtureChannel(
                index + 1,
                [
                  "Dimmer",
                  "CCT",
                  "Green Offset",
                  "White/HSI Crossfade",
                  "Hue",
                  "Saturation",
                  "Fan",
                  "Reserved",
                  "Reserved",
                  "Reserved",
                ][index]!,
                [
                  "intensity",
                  "cct",
                  "green-magenta",
                  "mix",
                  "hue",
                  "saturation",
                  "fan",
                  "reserved",
                  "reserved",
                  "reserved",
                ][index]!
              )
            ),
            hsiControls(2700, 10000, 3200),
            ["intensity", "cct", "hsi", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
          fixtureMode(
            "p07-cct-16bit",
            "P07 CCT 16-bit 8 ch",
            Array.from({ length: 8 }, (_, index) =>
              fixtureChannel(
                index + 1,
                [
                  "Dimmer coarse",
                  "Dimmer fine",
                  "CCT coarse",
                  "CCT fine",
                  "Green Offset coarse",
                  "Green Offset fine",
                  "DMX Mode Control",
                  "Fan",
                ][index]!,
                ["intensity", "intensity", "cct", "cct", "green-magenta", "green-magenta", "mode", "fan"][index]!
              )
            ),
            cctControls(2700, 10000, 3200),
            ["intensity", "cct", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
          fixtureMode(
            "p08-cct-hsi-16bit",
            "P08 CCT & HSI 16-bit 16 ch",
            Array.from({ length: 16 }, (_, index) =>
              fixtureChannel(
                index + 1,
                `Channel ${index + 1}`,
                [
                  "intensity",
                  "intensity",
                  "cct",
                  "cct",
                  "green-magenta",
                  "green-magenta",
                  "mix",
                  "mix",
                  "hue",
                  "hue",
                  "saturation",
                  "saturation",
                  "fan",
                  "reserved",
                  "reserved",
                  "reserved",
                ][index]!
              )
            ),
            hsiControls(2700, 10000, 3200),
            ["intensity", "cct", "hsi", "green-magenta", "fan"],
            cctDefaults(2700, 10000, 3200)
          ),
        ],
        visual("panel", 635, 305, 150)
      )
    ),
    fixtureDefinition(
      "litepanels-studio-x-bicolor",
      "Litepanels",
      "Studio X",
      "Bi-Color",
      "profile",
      "bicolor-8bit",
      [
        fixtureMode(
          "bicolor-8bit",
          "Bi-Color 8-bit 3 ch",
          [
            fixtureChannel(1, "Dimmer", "intensity"),
            fixtureChannel(2, "CCT", "cct", "kelvin", 60),
            fixtureChannel(3, "Spot/Flood", "zoom"),
          ],
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2700, 6500, 3200, "K"),
            fixtureControl("zoom", "Spot/Flood", 0, 100, 0, "%"),
          ],
          ["intensity", "cct", "zoom"],
          cctDefaults(2700, 6500, 3200)
        ),
        fixtureMode(
          "bicolor-16bit",
          "Bi-Color 16-bit 6 ch",
          Array.from({ length: 6 }, (_, index) =>
            fixtureChannel(
              index + 1,
              ["Dimmer coarse", "Dimmer fine", "CCT coarse", "CCT fine", "Spot/Flood coarse", "Spot/Flood fine"][
                index
              ]!,
              ["intensity", "intensity", "cct", "cct", "zoom", "zoom"][index]!
            )
          ),
          [
            fixtureControl("intensity", "Intensity", 0, 100, 100, "%"),
            fixtureControl("cct", "CCT", 2700, 6500, 3200, "K"),
            fixtureControl("zoom", "Spot/Flood", 0, 100, 0, "%"),
          ],
          ["intensity", "cct", "zoom"],
          cctDefaults(2700, 6500, 3200)
        ),
      ],
      visual("fresnel", 300, 300, 420)
    ),
    ...[
      ["aputure-ls-600d", "Aputure", "Light Storm", "LS 600d", "beam"],
      ["aputure-ls-600x-pro", "Aputure", "Light Storm", "LS 600x Pro", "beam"],
      ["aputure-ls-600c-pro", "Aputure", "Light Storm", "LS 600c Pro", "beam"],
      ["aputure-ls-1200d-pro", "Aputure", "Light Storm", "LS 1200d Pro", "beam"],
      ["aputure-storm-1000c", "Aputure", "STORM", "1000c", "beam"],
      ["aputure-electro-storm-cs15", "Aputure", "Electro Storm", "CS15", "beam"],
      ["aputure-electro-storm-xt26", "Aputure", "Electro Storm", "XT26", "beam"],
      ["aputure-nova-p300c", "Aputure", "NOVA", "P300c", "panel"],
      ["aputure-nova-p600c", "Aputure", "NOVA", "P600c", "panel"],
      ["aputure-nova-ii", "Aputure", "NOVA II", "Series", "panel"],
      ["aputure-nova-9", "Aputure", "NOVA", "9", "panel"],
      ["litepanels-astra-ip-half", "Litepanels", "Astra IP", "Half", "profile"],
      ["litepanels-astra-ip-2x1", "Litepanels", "Astra IP", "2x1", "profile"],
      ["litepanels-studio-x-daylight", "Litepanels", "Studio X", "Daylight", "profile"],
    ].map(([id, manufacturer, family, model, kind]) =>
      fixtureDefinition(
        id!,
        manufacturer!,
        family!,
        model!,
        kind!,
        "default",
        [noDmxMode()],
        visual(kind === "panel" ? "panel" : "fresnel", 300, 300, 150),
        "research-needed"
      )
    ),
  ];

  return { definitions };
}

function catalogDefinitions(catalog?: JsonObject | null): JsonObject[] {
  return asArray((catalog ?? DEFAULT_LIGHTING_FIXTURE_CATALOG).definitions)
    .map((definition) => asRecord(definition))
    .filter((definition): definition is JsonObject => definition !== null);
}

function resolveFixtureAlias(value: unknown): string | null {
  const cleaned = asString(value).trim().toLowerCase().replace(/[_ ]+/g, "-");
  switch (cleaned) {
    case "astra":
    case "astra-bi-color":
    case "astra-bicolor":
    case "litepanels-astra":
      return "litepanels-astra-bicolor";
    case "infinimat":
    case "aputure-infinimat":
      return "aputure-infinimat-generic";
    case "infinibar":
    case "infinibar-pb12":
    case "aputure-infinibar-pb12":
      return "aputure-infinibar-pb12";
    case "apollo-bridge":
    case "litepanels-apollo":
    case "litepanels-apollo-bridge":
      return "litepanels-apollo-bridge";
    default:
      return cleaned || null;
  }
}

function fixtureTypeForDefinition(definitionId: string) {
  switch (definitionId) {
    case "litepanels-astra-bicolor":
      return "astra-bicolor";
    case "aputure-infinimat-generic":
      return "infinimat";
    case "aputure-infinibar-pb12":
      return "infinibar-pb12";
    case "litepanels-apollo-bridge":
      return "Apollo Bridge";
    default:
      return definitionId;
  }
}

function fixtureDefinitionByIdentity(
  catalog: JsonObject | null | undefined,
  definitionId?: unknown,
  fixtureType?: unknown,
  kind?: unknown
) {
  const definitions = catalogDefinitions(catalog);
  const aliases = [
    asString(definitionId).trim().toLowerCase(),
    resolveFixtureAlias(fixtureType),
    resolveFixtureAlias(kind),
  ].filter(Boolean);
  return (
    definitions.find((definition) => aliases.includes(asString(definition.id))) ??
    definitions.find((definition) => asString(definition.id) === "litepanels-astra-bicolor") ??
    definitions[0] ??
    null
  );
}

function fixtureDefinitionSelectable(definition: JsonObject | null) {
  return asString(definition?.status) === "verified" && asString(definition?.kind) !== "control-node";
}

function fixtureModeForDefinition(definition: JsonObject | null, modeId?: unknown): JsonObject | null {
  const modes = asArray(definition?.modes)
    .map((mode) => asRecord(mode))
    .filter((mode): mode is JsonObject => mode !== null);
  const requested = asString(modeId).trim();
  return (
    modes.find((mode) => asString(mode.id) === requested) ??
    modes.find((mode) => asString(mode.id) === asString(definition?.defaultModeId)) ??
    modes[0] ??
    null
  );
}

function normalizeFixtureType(value: unknown) {
  const definition = fixtureDefinitionByIdentity(DEFAULT_LIGHTING_FIXTURE_CATALOG, undefined, value);
  return definition ? fixtureTypeForDefinition(asString(definition.id)) : asString(value).trim().toLowerCase();
}

function fixtureProfileForFixture(fixture: JsonObject, catalog: JsonObject | null = DEFAULT_LIGHTING_FIXTURE_CATALOG) {
  const definition = fixtureDefinitionByIdentity(catalog, fixture.definitionId, fixture.type, fixture.kind);
  const mode = fixtureModeForDefinition(definition, fixture.modeId);
  return {
    definition,
    mode,
    definitionId: asString(definition?.id, "litepanels-astra-bicolor"),
    modeId: asString(mode?.id, "default"),
    fixtureType: fixtureTypeForDefinition(asString(definition?.id, "litepanels-astra-bicolor")),
    kind: asString(definition?.kind, "profile"),
    channelCount: asNumber(mode?.channelCount, asArray(mode?.channels).length),
    channels: asArray(mode?.channels)
      .map((channel) => asRecord(channel))
      .filter((channel): channel is JsonObject => channel !== null),
    controls: asArray(mode?.controls)
      .map((control) => asRecord(control))
      .filter((control): control is JsonObject => control !== null),
    defaults: asRecord(mode?.defaults) ?? {},
  };
}

function lightingFixtureChannelCount(fixture: string | JsonObject) {
  if (typeof fixture === "string") {
    return fixtureProfileForFixture({ type: fixture }).channelCount;
  }
  return fixtureProfileForFixture(fixture).channelCount;
}

function lightingFixtureMaxStartAddress(fixture: string | JsonObject) {
  const channelCount = lightingFixtureChannelCount(fixture);
  return channelCount <= 0 ? 0 : 512 - channelCount + 1;
}

function lightingFixtureCctRange(fixture: string | JsonObject) {
  const profile =
    typeof fixture === "string" ? fixtureProfileForFixture({ type: fixture }) : fixtureProfileForFixture(fixture);
  return {
    max: asNumber(profile.defaults.cctMax, profile.channelCount > 0 ? 5600 : 0),
    min: asNumber(profile.defaults.cctMin, profile.channelCount > 0 ? 3200 : 0),
  };
}

function defaultLightingFixtureCct(fixture: string | JsonObject) {
  const profile =
    typeof fixture === "string" ? fixtureProfileForFixture({ type: fixture }) : fixtureProfileForFixture(fixture);
  return asNumber(profile.defaults.cct, profile.channelCount > 0 ? 5600 : 0);
}

const DEFAULT_LIGHTING_FIXTURE_CATALOG = buildDefaultLightingFixtureCatalogSnapshot();

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
  if (max <= min) return 0;
  return Math.round(((clamped - min) / (max - min)) * 255);
}

function asNumberRecord(value: unknown): Record<string, number> {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, entry]) => {
      const numeric = asNumber(entry, NaN);
      return Number.isFinite(numeric) ? [[key, numeric]] : [];
    })
  );
}

function normalizeControlValues(
  fixture: JsonObject,
  profile = fixtureProfileForFixture(fixture)
): Record<string, number> {
  const current = asNumberRecord(fixture.controlValues);
  const values: Record<string, number> = {};
  for (const control of profile.controls) {
    const id = asString(control.id);
    if (!id || id === "intensity" || id === "cct") continue;
    values[id] = clampNumber(
      Math.round(current[id] ?? asNumber(control.defaultValue, 0)),
      asNumber(control.min, 0),
      asNumber(control.max, 255)
    );
  }
  values.intensity = clampNumber(Math.round(asNumber(fixture.intensity, 0)), 0, 100);
  if (profile.channels.some((channel) => asString(channel.controlId) === "cct")) {
    const range = lightingFixtureCctRange(fixture);
    values.cct = clampNumber(
      Math.round(asNumber(fixture.cct, defaultLightingFixtureCct(fixture))),
      range.min,
      range.max
    );
  }
  return values;
}

function dmxValueForControl(
  controlId: string,
  valueType: string,
  fixture: JsonObject,
  profile: ReturnType<typeof fixtureProfileForFixture>,
  grandMaster: number
) {
  const controlValues = normalizeControlValues(fixture, profile);
  switch (controlId) {
    case "intensity":
      return asBoolean(fixture.on, false) ? Math.round(intensityToDmx(controlValues.intensity ?? 0) * grandMaster) : 0;
    case "cct": {
      const range = lightingFixtureCctRange(fixture);
      return cctToDmx(controlValues.cct ?? defaultLightingFixtureCct(fixture), range.min, range.max);
    }
    case "green-magenta":
      return (Math.round(clampNumber(controlValues["green-magenta"] ?? 0, -100, 100) + 100) * 255) / 200;
    default:
      if (valueType === "fine") return 0;
      return clampNumber(Math.round(controlValues[controlId] ?? asNumber(profile.defaults[controlId], 0)), 0, 255);
  }
}

function buildLightingDmxMonitorSnapshot(lightingSnapshot: JsonObject | null): JsonObject {
  const fixtures = asArray(lightingSnapshot?.fixtures)
    .map((fixture) => asRecord(fixture))
    .filter((fixture): fixture is JsonObject => fixture !== null);
  const grandMaster = clampNumber(asNumber(lightingSnapshot?.grandMaster, 100), 0, 100) / 100;
  const channels: JsonObject[] = [];

  for (const fixture of fixtures) {
    const profile = fixtureProfileForFixture(fixture);
    const channelCount = profile.channelCount;
    const startAddress = asNumber(fixture.dmxStartAddress, 1);
    if (channelCount <= 0 || startAddress <= 0) continue;
    const universe = asNumber(fixture.universe, asNumber(lightingSnapshot?.universe, 1));

    for (let offset = 0; offset < channelCount; offset += 1) {
      const channel = startAddress + offset;
      const catalogChannel = profile.channels[offset] ?? {};
      const controlId = asString(catalogChannel.controlId, "reserved");
      const valueType = asString(catalogChannel.valueType, "range");
      const value = dmxValueForControl(controlId, valueType, fixture, profile, grandMaster);

      channels.push({
        universe,
        channel,
        label: asString(catalogChannel.label, `Ch${offset + 1}`),
        lightName: asString(fixture.name, asString(fixture.id, "Fixture")),
        value: Math.round(clampNumber(value, 0, 255)),
      });
    }
  }

  channels.sort((left, right) => {
    const universeDelta = asNumber(left.universe, 1) - asNumber(right.universe, 1);
    return universeDelta !== 0 ? universeDelta : asNumber(left.channel, 0) - asNumber(right.channel, 0);
  });
  return { channels };
}

function buildLightingFixtureUpdateSummary(fixture: JsonObject) {
  const spatialRotation = asNumber(fixture.spatialRotation, 0);
  const spatialSummary =
    typeof fixture.spatialX === "number" && typeof fixture.spatialY === "number"
      ? `manual layout at ${fixture.spatialX.toFixed(1)}m / ${fixture.spatialY.toFixed(1)}m / ${Math.round(spatialRotation)}deg`
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

function normalizeLightingFixtureSnapshotEntry(fixture: JsonObject, fallbackUniverse: number): JsonObject {
  const profile = fixtureProfileForFixture(fixture);
  const cctRange = lightingFixtureCctRange(fixture);
  const defaultCct = defaultLightingFixtureCct(fixture);
  const channelCount = profile.channelCount;
  const normalizedStart =
    channelCount <= 0 ? 0 : clampNumber(Math.round(asNumber(fixture.dmxStartAddress, 1)), 1, 512 - channelCount + 1);
  const normalizedFixture: JsonObject = {
    ...fixture,
    type: profile.fixtureType,
    definitionId: profile.definitionId,
    modeId: profile.modeId,
    universe: Math.max(1, Math.round(asNumber(fixture.universe, fallbackUniverse))),
    dmxStartAddress: normalizedStart,
    kind: profile.kind,
    groupId: typeof fixture.groupId === "string" && fixture.groupId.trim() ? fixture.groupId : null,
    spatialX: typeof fixture.spatialX === "number" ? clampNumber(fixture.spatialX, 0, 20) : null,
    spatialY: typeof fixture.spatialY === "number" ? clampNumber(fixture.spatialY, 0, 20) : null,
    spatialRotation: asNumber(fixture.spatialRotation, 0),
    rigZ: typeof fixture.rigZ === "number" ? clampNumber(fixture.rigZ, 0, 20) : null,
    beamAngleDegrees:
      typeof fixture.beamAngleDegrees === "number" ? clampNumber(fixture.beamAngleDegrees, 1, 180) : null,
    on: asBoolean(fixture.on, false),
    intensity: clampNumber(Math.round(asNumber(fixture.intensity, 0)), 0, 100),
    cct: clampNumber(Math.round(asNumber(fixture.cct, defaultCct)), cctRange.min, cctRange.max),
    effect: asRecord(fixture.effect),
  };
  normalizedFixture.controlValues = normalizeControlValues(normalizedFixture, profile);
  return normalizedFixture;
}

function sceneFixtureStateFromFixture(fixture: JsonObject): JsonObject {
  return {
    fixtureId: asString(fixture.id),
    intensity: asNumber(fixture.intensity, 0),
    cct: asNumber(fixture.cct, 3200),
    on: asBoolean(fixture.on, false),
    controlValues: asRecord(fixture.controlValues) ?? {},
  };
}

function createMutableFixtureState(scenario: FixtureScenario): MutableFixtureState {
  const scenarioAudioSnapshot = asRecord(scenario.audioSnapshot);

  const state = {
    appSnapshot: cloneJson((scenario.appSnapshot ?? {}) as JsonObject),
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
      pad: false,
      eq: asRecord(channel.eq) ?? buildAudioEq(),
      dynamics: asRecord(channel.dynamics) ?? buildAudioDynamics(),
      sendModes: asRecord(channel.sendModes) ?? buildAudioSendModes(),
    }));
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
    ? `OSC transport is disabled in native audio settings. Last configured endpoint is ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} with receive port ${audioSnapshotRecord.receivePort}.`
    : audioSnapshotRecord.status === "ready"
      ? `OSC transport is configured for ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} with receive port ${audioSnapshotRecord.receivePort}.`
      : audioSnapshotRecord.status === "attention"
        ? `OSC transport check failed for ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} / ${audioSnapshotRecord.receivePort}.`
        : `OSC transport is configured for ${audioSnapshotRecord.sendHost}:${audioSnapshotRecord.sendPort} with receive port ${audioSnapshotRecord.receivePort} before the native audio probe runs.`;
  refreshAudioCapabilities(audioSnapshotRecord, state);
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

function ensureAudioSnapshotAvailable(state: MutableFixtureState) {
  const audioSnapshot = asRecord(state.audioSnapshot);
  if (!audioSnapshot) {
    throw new Error("Audio snapshot is not available yet.");
  }

  return audioSnapshot;
}

function refreshAudioCapabilities(audioSnapshot: JsonObject, state: MutableFixtureState) {
  const audioCheck = asRecord(
    asArray(state.commissioningSnapshot.checks)
      .map((entry) => asRecord(entry))
      .find((entry) => asString(entry?.id) === "audio")
  );
  const audioReady = asString(audioCheck?.status) === "passed" || asString(audioCheck?.status) === "ok";
  const oscEnabled = asBoolean(audioSnapshot.oscEnabled, true);
  audioSnapshot.capabilities = {
    canEditMixerState: oscEnabled,
    canSync: oscEnabled,
    canRecallConsoleSnapshot: oscEnabled && audioReady,
    canEditProcessing: oscEnabled,
    canClearClips: oscEnabled,
    canCaptureSnapshot: oscEnabled,
    canUseMasterView: oscEnabled,
  };
}

function ensureAudioEditAllowed(state: MutableFixtureState) {
  const audioSnapshot = ensureAudioSnapshotAvailable(state);
  refreshAudioCapabilities(audioSnapshot, state);

  if (!asBoolean(audioSnapshot.oscEnabled, true)) {
    throw new Error("OSC transport is disabled in native audio settings.");
  }

  return audioSnapshot;
}

function ensureAudioActionAllowed(state: MutableFixtureState) {
  const audioSnapshot = ensureAudioSnapshotAvailable(state);
  refreshAudioCapabilities(audioSnapshot, state);

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

function fixtureAudioChannel(audioSnapshot: JsonObject, channelIdValue: unknown) {
  const channelId = asString(channelIdValue).trim();
  const channel = asArray(audioSnapshot.channels)
    .map((entry) => asRecord(entry))
    .find((entry) => asString(entry?.id) === channelId);
  if (!channel) {
    throw new Error(`Audio channel '${channelId}' is not exposed by the fixture transport.`);
  }
  return channel;
}

function captureFixtureAudioScene(audioSnapshot: JsonObject) {
  const channels: JsonObject = {};
  for (const channel of asArray(audioSnapshot.channels).map((entry) => asRecord(entry))) {
    if (!channel) continue;
    channels[asString(channel.id)] = {
      name: asString(channel.name),
      gain: asNumber(channel.gain, 0),
      fader: asNumber(channel.fader, 0),
      clip: asBoolean(channel.clip, false),
      mixLevels: cloneJson(asRecord(channel.mixLevels) ?? {}),
      mute: asBoolean(channel.mute, false),
      solo: asBoolean(channel.solo, false),
      phantom: asBoolean(channel.phantom, false),
      phase: asBoolean(channel.phase, false),
      pad: false,
      instrument: asBoolean(channel.instrument, false),
      autoSet: asBoolean(channel.autoSet, false),
      eq: cloneJson(asRecord(channel.eq) ?? buildAudioEq()),
      dynamics: cloneJson(asRecord(channel.dynamics) ?? buildAudioDynamics()),
      sendModes: cloneJson(asRecord(channel.sendModes) ?? buildAudioSendModes()),
    };
  }

  const mixTargets: JsonObject = {};
  for (const mixTarget of asArray(audioSnapshot.mixTargets).map((entry) => asRecord(entry))) {
    if (!mixTarget) continue;
    mixTargets[asString(mixTarget.id)] = {
      volume: asNumber(mixTarget.volume, 0),
      mute: asBoolean(mixTarget.mute, false),
      dim: asBoolean(mixTarget.dim, false),
      mono: asBoolean(mixTarget.mono, false),
      talkback: asBoolean(mixTarget.talkback, false),
    };
  }

  return {
    capturedAt: new Date().toISOString(),
    channels,
    mixTargets,
  };
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
  let startupTimeoutId: number | null = null;
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
      case "lighting.fixtureCatalog.snapshot":
        return cloneJson(state.lightingFixtureCatalogSnapshot);
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
        let shellSettingsChanged = false;
        if (lighting && "currentSectionId" in lighting) {
          const shell = asRecord(state.appSnapshot.shell) ?? {};
          const shellLighting = asRecord(shell.lighting) ?? {};
          shellLighting.currentSectionId =
            typeof lighting.currentSectionId === "string" ? lighting.currentSectionId : null;
          shell.lighting = shellLighting;
          state.appSnapshot.shell = shell;
          shellSettingsChanged = true;
        }
        if (lighting && "sceneThumbs" in lighting) {
          const shell = asRecord(state.appSnapshot.shell) ?? {};
          const shellLighting = asRecord(shell.lighting) ?? {};
          shellLighting.sceneThumbs = asRecord(lighting.sceneThumbs) ?? {};
          shell.lighting = shellLighting;
          state.appSnapshot.shell = shell;
          shellSettingsChanged = true;
        }
        if (lighting && "talentMarks" in lighting) {
          const shell = asRecord(state.appSnapshot.shell) ?? {};
          const shellLighting = asRecord(shell.lighting) ?? {};
          shellLighting.talentMarks = normalizeTalentMarks(lighting.talentMarks);
          shell.lighting = shellLighting;
          state.appSnapshot.shell = shell;
          shellSettingsChanged = true;
        }
        if (shellSettingsChanged) {
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
        if (params.viewMode === "submix" || params.viewMode === "master") {
          audioSnapshot.viewMode = params.viewMode;
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
        refreshAudioCapabilities(audioSnapshot, state);
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
        const contents = asRecord(snapshot.contents);
        if (contents) {
          const sceneChannels = asRecord(contents.channels) ?? {};
          const sceneMixTargets = asRecord(contents.mixTargets) ?? {};
          for (const channel of asArray(audioSnapshot.channels).map((entry) => asRecord(entry))) {
            if (!channel) continue;
            const stateEntry = asRecord(sceneChannels[asString(channel.id)]);
            if (stateEntry) {
              Object.assign(channel, cloneJson(stateEntry));
            }
          }
          for (const mixTarget of asArray(audioSnapshot.mixTargets).map((entry) => asRecord(entry))) {
            if (!mixTarget) continue;
            const stateEntry = asRecord(sceneMixTargets[asString(mixTarget.id)]);
            if (stateEntry) {
              Object.assign(mixTarget, cloneJson(stateEntry));
            }
          }
        }
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
      case "audio.snapshot.create": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const name = asString(params.name).trim() || "Snapshot";
        const oscIndex = clampNumber(Math.round(asNumber(params.oscIndex, 0)), 0, 7);
        const snapshots = asArray(audioSnapshot.snapshots)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const snapshot = {
          id: `audio-snapshot-custom-${Date.now()}`,
          name,
          oscIndex,
          order: snapshots.length,
          lastRecalled: false,
          lastRecalledAt: null,
          contents: asBoolean(params.captureCurrentState, false) ? captureFixtureAudioScene(audioSnapshot) : null,
          preview: buildAudioSnapshotPreview(asBoolean(params.captureCurrentState, false)),
        };
        snapshots.push(snapshot);
        audioSnapshot.snapshots = snapshots;
        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = `Created ${name}`;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-snapshot-created" });
        return { snapshot: cloneJson(snapshot), summary: `Audio snapshot '${name}' was created.` };
      }
      case "audio.snapshot.update": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const snapshotId = asString(params.snapshotId).trim();
        const snapshots = asArray(audioSnapshot.snapshots)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const snapshot = snapshots.find((entry) => asString(entry.id) === snapshotId);
        if (!snapshot) throw new Error(`Audio snapshot '${snapshotId}' is not exposed by the fixture transport.`);
        if (typeof params.name === "string" && params.name.trim()) {
          snapshot.name = params.name.trim();
        }
        if (typeof params.oscIndex === "number") {
          snapshot.oscIndex = clampNumber(Math.round(params.oscIndex), 0, 7);
        }
        if (asBoolean(params.captureCurrentState, false)) {
          snapshot.contents = captureFixtureAudioScene(audioSnapshot);
          snapshot.preview = buildAudioSnapshotPreview(true);
        }
        audioSnapshot.snapshots = snapshots;
        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = `Updated ${asString(snapshot.name, snapshotId)}`;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-snapshot-updated" });
        return { snapshot: cloneJson(snapshot), summary: `Audio snapshot '${asString(snapshot.name)}' was updated.` };
      }
      case "audio.snapshot.delete": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const snapshotId = asString(params.snapshotId).trim();
        const snapshots = asArray(audioSnapshot.snapshots)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        audioSnapshot.snapshots = snapshots.filter((entry) => asString(entry.id) !== snapshotId);
        if (asString(audioSnapshot.lastRecalledSnapshotId) === snapshotId) {
          audioSnapshot.lastRecalledSnapshotId = null;
          audioSnapshot.lastSnapshotRecallAt = null;
        }
        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = `Deleted ${snapshotId}`;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-snapshot-deleted" });
        return { deleted: true, snapshotId, summary: `Audio snapshot '${snapshotId}' was deleted.` };
      }
      case "audio.clip.clear": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const channelId = typeof params.channelId === "string" ? params.channelId : null;
        for (const channel of asArray(audioSnapshot.channels).map((entry) => asRecord(entry))) {
          if (!channel) continue;
          if (!channelId || asString(channel.id) === channelId) {
            channel.clip = false;
          }
        }
        audioSnapshot.lastActionStatus = "succeeded";
        audioSnapshot.lastActionCode = null;
        audioSnapshot.lastActionMessage = channelId ? `Cleared clips for ${channelId}` : "Cleared clips";
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-clips-cleared" });
        return { cleared: true, channelId, summary: audioSnapshot.lastActionMessage };
      }
      case "audio.channel.update": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const channelId = asString(params.channelId).trim();
        const channels = asArray(audioSnapshot.channels)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is JsonObject => entry !== null);
        const channel = channels.find((entry) => asString(entry.id) === channelId);
        if (!channel) {
          throw new Error(`Audio channel '${channelId}' is not exposed by the fixture transport.`);
        }

        const role = asString(channel.role);
        if (typeof params.name === "string" && params.name.trim()) {
          channel.name = params.name.trim();
        }
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
          throw new Error("AUDIO_CHANNEL_FIELD_UNSUPPORTED: pad is not available on UFX III mic preamps.");
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
      case "audio.channel.eq.update": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const channel = fixtureAudioChannel(audioSnapshot, params.channelId);
        const eq = asRecord(channel.eq) ?? buildAudioEq();
        if ("enabled" in params) eq.enabled = asBoolean(params.enabled, false);
        if (typeof params.bandId === "string") {
          const bands = asArray(eq.bands)
            .map((entry) => asRecord(entry))
            .filter((entry): entry is JsonObject => entry !== null);
          const band = bands.find((entry) => asString(entry.id) === params.bandId);
          if (!band) throw new Error(`Audio EQ band '${params.bandId}' is not exposed by the fixture transport.`);
          if ("bandEnabled" in params) band.enabled = asBoolean(params.bandEnabled, false);
          if (typeof params.frequencyHz === "number") band.frequencyHz = clampNumber(params.frequencyHz, 20, 20_000);
          if (typeof params.gainDb === "number") band.gainDb = clampNumber(params.gainDb, -12, 12);
          if (typeof params.q === "number") band.q = clampNumber(params.q, 0.1, 12);
          eq.bands = bands;
        }
        channel.eq = eq;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-channel-eq-updated" });
        return cloneJson(channel);
      }
      case "audio.channel.dynamics.update": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const channel = fixtureAudioChannel(audioSnapshot, params.channelId);
        const dynamics = asRecord(channel.dynamics) ?? buildAudioDynamics();
        const key = params.section === "gate" ? "gate" : "compressor";
        const section = asRecord(dynamics[key]) ?? {};
        if ("enabled" in params) section.enabled = asBoolean(params.enabled, false);
        if (typeof params.thresholdDb === "number") section.thresholdDb = clampNumber(params.thresholdDb, -80, 0);
        if (typeof params.ratio === "number") section.ratio = clampNumber(params.ratio, 1, 20);
        if (typeof params.attackMs === "number") section.attackMs = clampNumber(params.attackMs, 0.1, 2000);
        if (typeof params.releaseMs === "number") section.releaseMs = clampNumber(params.releaseMs, 0.1, 2000);
        if (typeof params.makeupDb === "number") section.makeupDb = clampNumber(params.makeupDb, 0, 24);
        dynamics[key] = section;
        channel.dynamics = dynamics;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-channel-dynamics-updated" });
        return cloneJson(channel);
      }
      case "audio.channel.send.update": {
        const audioSnapshot = ensureAudioEditAllowed(state);
        const channel = fixtureAudioChannel(audioSnapshot, params.channelId);
        const mixTargetId = asString(params.mixTargetId).trim();
        const sendModes: JsonObject = asRecord(channel.sendModes) ?? buildAudioSendModes();
        const sendMode = asRecord(sendModes[mixTargetId]) ?? {
          preFader: false,
          mute: false,
          linkStereo: true,
          solo: false,
        };
        if ("preFader" in params) sendMode.preFader = asBoolean(params.preFader, false);
        if ("mute" in params) sendMode.mute = asBoolean(params.mute, false);
        if ("linkStereo" in params) sendMode.linkStereo = asBoolean(params.linkStereo, true);
        if ("solo" in params) sendMode.solo = asBoolean(params.solo, false);
        sendModes[mixTargetId] = sendMode;
        channel.sendModes = sendModes;
        state.audioSnapshot = audioSnapshot;
        synchronizeFixtureState(state);
        emit("audio.changed", { reason: "audio-channel-send-updated" });
        return cloneJson(channel);
      }
      case "audio.mixTarget.update": {
        const audioSnapshot = ensureAudioEditAllowed(state);
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
            controlValues: asRecord(nextState.controlValues) ?? asRecord(fixture.controlValues) ?? {},
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
                controlValues: asRecord(fixtureState.controlValues) ?? {},
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
          fixtureStates: explicitFixtureStates ?? fixtures.map((fixture) => sceneFixtureStateFromFixture(fixture)),
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
          ? fixtures.map((fixture) => sceneFixtureStateFromFixture(fixture))
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

        const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
        const definition = fixtureDefinitionByIdentity(
          state.lightingFixtureCatalogSnapshot,
          params.definitionId,
          params.type
        );
        if (!definition || !fixtureDefinitionSelectable(definition)) {
          throw new Error("definitionId or type must resolve to a selectable verified fixture catalog entry");
        }
        const mode = fixtureModeForDefinition(definition, params.modeId);
        if (!mode) {
          throw new Error("modeId must resolve to a fixture catalog mode");
        }
        const normalizedFixtureType = fixtureTypeForDefinition(asString(definition.id));
        const fixtureProfileSeed = {
          type: normalizedFixtureType,
          definitionId: asString(definition.id),
          modeId: asString(mode.id),
        };
        const profile = fixtureProfileForFixture(fixtureProfileSeed, state.lightingFixtureCatalogSnapshot);
        const universe = Math.max(1, Math.round(asNumber(params.universe, asNumber(lightingSnapshot?.universe, 1))));

        const requestedStartAddress = Math.round(asNumber(params.dmxStartAddress, Number.NaN));
        if (!Number.isFinite(requestedStartAddress)) {
          throw new Error("dmxStartAddress is required");
        }

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

        const maxDmxStartAddress = lightingFixtureMaxStartAddress(fixtureProfileSeed);
        if (profile.channelCount > 0 && (requestedStartAddress < 1 || requestedStartAddress > maxDmxStartAddress)) {
          throw new Error(
            `DMX start address must be between 1 and ${maxDmxStartAddress} for fixture definition '${asString(definition.id)}'.`
          );
        }

        const requestedEndAddress = requestedStartAddress + profile.channelCount - 1;
        const overlapFixture = fixtures.find((fixture) => {
          if (asNumber(fixture.universe, 1) !== universe) {
            return false;
          }
          const existingStartAddress = asNumber(fixture.dmxStartAddress, 1);
          const existingChannelCount = lightingFixtureChannelCount(fixture);
          if (existingChannelCount <= 0 || profile.channelCount <= 0) {
            return false;
          }
          const existingEndAddress = existingStartAddress + existingChannelCount - 1;
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
          definitionId: asString(definition.id),
          modeId: asString(mode.id),
          universe,
          dmxStartAddress: profile.channelCount <= 0 ? 0 : requestedStartAddress,
          kind: asString(definition.kind),
          groupId: groupId || null,
          spatialRotation: 0,
          spatialX: null,
          spatialY: null,
          rigZ: null,
          beamAngleDegrees: null,
          on: false,
          intensity: 100,
          cct: defaultLightingFixtureCct(fixtureProfileSeed),
          controlValues: normalizeControlValues(fixtureProfileSeed, profile),
          effect: null,
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
              cct: defaultLightingFixtureCct(createdFixture),
              on: false,
              controlValues: asRecord(createdFixture.controlValues) ?? {},
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
        const hasDefinitionId = typeof params.definitionId === "string";
        const hasModeId = typeof params.modeId === "string";
        const hasUniverse = typeof params.universe === "number";
        const hasOn = typeof params.on === "boolean";
        const hasIntensity = typeof params.intensity === "number";
        const hasCct = typeof params.cct === "number";
        const hasControlValues = Object.prototype.hasOwnProperty.call(params, "controlValues");
        const hasDmxStartAddress = typeof params.dmxStartAddress === "number";
        const hasGroupId = Object.prototype.hasOwnProperty.call(params, "groupId");
        const hasSpatialX = Object.prototype.hasOwnProperty.call(params, "spatialX");
        const hasSpatialY = Object.prototype.hasOwnProperty.call(params, "spatialY");
        const hasSpatialRotation = Object.prototype.hasOwnProperty.call(params, "spatialRotation");
        const hasRigZ = Object.prototype.hasOwnProperty.call(params, "rigZ");
        const hasBeamAngleDegrees = Object.prototype.hasOwnProperty.call(params, "beamAngleDegrees");
        if (
          !hasName &&
          !hasType &&
          !hasDefinitionId &&
          !hasModeId &&
          !hasUniverse &&
          !hasOn &&
          !hasIntensity &&
          !hasCct &&
          !hasControlValues &&
          !hasDmxStartAddress &&
          !hasGroupId &&
          !hasSpatialX &&
          !hasSpatialY &&
          !hasSpatialRotation &&
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
            hasDefinitionId ||
            hasModeId ||
            hasUniverse ||
            hasDmxStartAddress ||
            hasGroupId ||
            hasSpatialX ||
            hasSpatialY ||
            hasSpatialRotation ||
            hasRigZ ||
            hasBeamAngleDegrees
          ) {
            throw new Error("Preview mode only supports fixture power, intensity, CCT, and catalog control updates.");
          }
          const previewFixtures = lightingFixtures(lightingSnapshot, "previewFixtures");
          const editableFixtures =
            previewFixtures.length > 0 ? previewFixtures : fixtures.map((fixture) => ({ ...fixture }));
          const previewTarget = editableFixtures.find((fixture) => asString(fixture.id) === fixtureId) ?? targetFixture;
          const cctRange = lightingFixtureCctRange(targetFixture);
          const defaultCct = defaultLightingFixtureCct(targetFixture);
          const controlValues = hasControlValues
            ? {
                ...asNumberRecord(previewTarget.controlValues),
                ...asNumberRecord(params.controlValues),
              }
            : asNumberRecord(previewTarget.controlValues);
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
            ...(hasControlValues ? { controlValues } : {}),
          };
          updatedFixture.controlValues = normalizeControlValues(updatedFixture);
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

        const definition = fixtureDefinitionByIdentity(
          state.lightingFixtureCatalogSnapshot,
          hasDefinitionId ? params.definitionId : targetFixture.definitionId,
          hasType ? params.type : targetFixture.type,
          targetFixture.kind
        );
        const structuralCatalogChange = hasType || hasDefinitionId || hasModeId;
        if (
          !definition ||
          asString(definition.status) !== "verified" ||
          (structuralCatalogChange && !fixtureDefinitionSelectable(definition))
        ) {
          throw new Error("definitionId or type must resolve to a selectable verified fixture catalog entry");
        }
        const mode = fixtureModeForDefinition(definition, hasModeId ? params.modeId : targetFixture.modeId);
        if (!mode) {
          throw new Error("modeId must resolve to a fixture catalog mode");
        }
        const normalizedFixtureType = fixtureTypeForDefinition(asString(definition.id));
        const nextUniverse = hasUniverse
          ? Math.max(1, Math.round(asNumber(params.universe, asNumber(targetFixture.universe, 1))))
          : asNumber(targetFixture.universe, 1);
        const profileSeed = {
          ...targetFixture,
          type: normalizedFixtureType,
          definitionId: asString(definition.id),
          modeId: asString(mode.id),
        };
        const profile = fixtureProfileForFixture(profileSeed, state.lightingFixtureCatalogSnapshot);
        const cctRange = lightingFixtureCctRange(profileSeed);
        const defaultCct = defaultLightingFixtureCct(profileSeed);
        const maxDmxStartAddress = lightingFixtureMaxStartAddress(profileSeed);
        const nextDmxStartAddress = hasDmxStartAddress
          ? Math.round(asNumber(params.dmxStartAddress, asNumber(targetFixture.dmxStartAddress, 1)))
          : asNumber(targetFixture.dmxStartAddress, 1);
        if (profile.channelCount > 0 && (nextDmxStartAddress < 1 || nextDmxStartAddress > maxDmxStartAddress)) {
          throw new Error(
            `DMX start address must be between 1 and ${maxDmxStartAddress} for fixture definition '${asString(definition.id)}'.`
          );
        }

        const nextDmxEndAddress = nextDmxStartAddress + profile.channelCount - 1;
        const overlapFixture = fixtures.find((fixture) => {
          if (asString(fixture.id) === fixtureId) {
            return false;
          }
          if (asNumber(fixture.universe, 1) !== nextUniverse) {
            return false;
          }

          const existingStartAddress = asNumber(fixture.dmxStartAddress, 1);
          const existingChannelCount = lightingFixtureChannelCount(fixture);
          if (existingChannelCount <= 0 || profile.channelCount <= 0) {
            return false;
          }
          const existingEndAddress = existingStartAddress + existingChannelCount - 1;
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
          ...(hasType || hasDefinitionId ? { type: normalizedFixtureType } : {}),
          ...(hasType || hasDefinitionId ? { definitionId: asString(definition.id) } : {}),
          ...(hasModeId || hasType || hasDefinitionId ? { modeId: asString(mode.id) } : {}),
          ...(hasUniverse ? { universe: nextUniverse } : {}),
          ...(hasOn ? { on: params.on } : {}),
          ...(hasDmxStartAddress || hasType || hasDefinitionId || hasModeId
            ? { dmxStartAddress: profile.channelCount <= 0 ? 0 : nextDmxStartAddress }
            : {}),
          ...(hasGroupId ? { groupId: nextGroupId || null } : {}),
          ...(hasSpatialX
            ? {
                spatialX:
                  params.spatialX === null
                    ? null
                    : clampNumber(asNumber(params.spatialX, asNumber(targetFixture.spatialX, 0.5)), 0, 20),
              }
            : {}),
          ...(hasSpatialY
            ? {
                spatialY:
                  params.spatialY === null
                    ? null
                    : clampNumber(asNumber(params.spatialY, asNumber(targetFixture.spatialY, 0.5)), 0, 20),
              }
            : {}),
          ...(hasSpatialRotation
            ? {
                spatialRotation:
                  ((Math.round(asNumber(params.spatialRotation, asNumber(targetFixture.spatialRotation, 0))) % 360) +
                    360) %
                  360,
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
          ...(hasControlValues
            ? {
                controlValues: {
                  ...asNumberRecord(targetFixture.controlValues),
                  ...asNumberRecord(params.controlValues),
                },
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
        updatedFixture.controlValues = normalizeControlValues(updatedFixture, profile);
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
        startupTimeoutId = null;
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

      if (startupTimeoutId !== null) {
        window.clearTimeout(startupTimeoutId);
        startupTimeoutId = null;
      }

      if (startupDelayMs > 0) {
        startupTimeoutId = window.setTimeout(emitStartupEvent, startupDelayMs);
        return;
      }

      startupTimeoutId = window.setTimeout(emitStartupEvent, 0);
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
    async dispose() {
      if (startupTimeoutId !== null) {
        window.clearTimeout(startupTimeoutId);
        startupTimeoutId = null;
      }
      listeners.clear();
    },
  };
}
