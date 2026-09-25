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
import type { IdentifyBursts } from "./lightingOverlay";

export interface MutableFixtureState {
  appSnapshot: JsonObject;
  audioMeterState: Record<string, AudioMeterState>;
  healthSnapshot: JsonObject;
  commissioningSnapshot: JsonObject;
  lightingFixtureCatalogSnapshot: JsonObject;
  lightingSnapshot: JsonObject;
  /** The identify flashes; they show in `lighting.snapshot` while they last, never in the stored rig. */
  lightingIdentifyBursts: IdentifyBursts;
  /** What the scenario itself said about the rig, before any default: its status
   *  stands in for a lighting probe until one runs, and an explicit `enabled`
   *  is kept (the hardware link's `app.lighting.enabled`). */
  lightingAuthored: { status: string | null; enabled: boolean | null };
  audioSnapshot: JsonObject | null;
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

/**
 * The deck's pages as the hardware link's `build_control_surface_snapshot`
 * models them (new pages program, Slice 2: PROJECTS and TASKS left with
 * Planning, so LIGHTS is page 1 and AUDIO page 2). The shape and the counts
 * are the hardware link's: LIGHTS has seven keys, at places 2–8 (place 1 held
 * `<< PROJ`); AUDIO has eight keys and four touch-strip cells, at places 1–12;
 * each page has four dials that are pressed and turned either way, three
 * controls apiece — 43 controls in all. The labels stay the double's own.
 */
export function buildDefaultControlSurfaceSnapshot(): JsonObject {
  const makeButtons = (pageId: string, prefix: string, positions: number[]) =>
    positions.map((position, index) => ({
      id: `${pageId}-btn-${position}`,
      type: "button",
      position,
      label: `${prefix} ${index + 1}`,
      description: `${prefix} action ${index + 1} is mapped through the native control-surface bridge.`,
    }));

  const dialMotions = [
    { motion: "press", type: "dial-press", label: "" },
    { motion: "left", type: "dial-turn-left", label: " left" },
    { motion: "right", type: "dial-turn-right", label: " right" },
  ];
  const makeDials = (pageId: string, prefix: string) =>
    [1, 2, 3, 4].flatMap((position) =>
      dialMotions.map(({ motion, type, label }) => ({
        id: `${pageId}-dial-${position}-${motion}`,
        type,
        position,
        label: `${prefix} ${position}${label}`,
        description: `${prefix} dial ${position} is available for live verification.`,
      }))
    );

  return {
    pages: [
      {
        id: "lights",
        label: "LIGHTS",
        buttons: makeButtons("lights", "Light", [2, 3, 4, 5, 6, 7, 8]),
        dials: makeDials("lights", "Intensity"),
      },
      {
        id: "audio",
        label: "AUDIO",
        buttons: makeButtons("audio", "Channel", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
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
    lightingIdentifyBursts: {},
    lightingAuthored: {
      status:
        typeof asRecord(scenario.lightingSnapshot)?.status === "string"
          ? asString(asRecord(scenario.lightingSnapshot)?.status)
          : null,
      enabled:
        typeof asRecord(scenario.lightingSnapshot)?.enabled === "boolean"
          ? asBoolean(asRecord(scenario.lightingSnapshot)?.enabled)
          : null,
    },
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

// The words the hardware link uses, and the state it reads them from.
// `native/rust-engine/src/`: a probe is `idle`, `passed` or `failed`
// (`commissioning.rs`); the rig is `unconfigured`, `disabled`, `ready`,
// `attention` or `not-verified` (`lighting/snapshot.rs`); the console is
// `ready`, `attention` or `not-verified` (`audio/snapshot.rs`); the Stream
// Deck bridge is `ready` or `unavailable` (`control_surface.rs`). Until
// 2026-09-22 this double said `ok` / `attention` for all of them.

type ProbeOutcome = "idle" | "passed" | "failed";

/** A probe's outcome. Scenarios written before 2026-09-22 say `ok` for a probe
 *  that passed and `attention` for one not run or not confirmed; the double's
 *  audio state has always read `attention` as not run, and so does this. */
function probeOutcome(status: unknown): ProbeOutcome {
  const value = asString(status);
  if (value === "passed" || value === "ok") return "passed";
  if (value === "failed" || value === "error") return "failed";
  return "idle";
}

/** A scenario's own rig status, standing in for a probe that has not run in this session. */
function authoredProbe(status: string | null): ProbeOutcome {
  return status === "ready" ? "passed" : status === "attention" ? "failed" : "idle";
}

/**
 * The rig's word by the hardware link's rule (`E/lighting/snapshot.rs` over
 * `resolve_lighting_config`), worked out again on every sync as the hardware
 * link does on every read: the bridge address the lighting probe stores, the
 * rig on unless it was switched off (on by default once there is an address),
 * then the probe's outcome. Until a probe runs, a scenario's own status stands
 * in for it. The probe stores the address it was given before it runs
 * (`E/commissioning.rs`), so a probe that has run means an address, even where
 * a scenario leaves it out.
 */
function rigStatusWord(state: MutableFixtureState, lightingProbe: ProbeOutcome): string {
  const addressed = rigAddressed(state, lightingProbe);
  if (!rigSwitchedOn(state, lightingProbe)) return addressed ? "disabled" : "unconfigured";
  const probe = lightingProbe === "idle" ? authoredProbe(state.lightingAuthored.status) : lightingProbe;
  return probe === "passed" ? "ready" : probe === "failed" ? "attention" : "not-verified";
}

function rigAddressed(state: MutableFixtureState, lightingProbe: ProbeOutcome): boolean {
  const probedBridge = asString(asRecord(state.commissioningSnapshot.lighting)?.bridgeIp).trim();
  const bridgeIp = probedBridge || asString(asRecord(state.lightingSnapshot)?.bridgeIp).trim();
  return bridgeIp !== "" || lightingProbe !== "idle";
}

/** Lighting is on unless the scenario switched it off, and on by default once there is an address. */
function rigSwitchedOn(state: MutableFixtureState, lightingProbe: ProbeOutcome): boolean {
  return state.lightingAuthored.enabled ?? rigAddressed(state, lightingProbe);
}

/** The console's word by the hardware link's rule (`E/audio/snapshot.rs`): the
 *  probe's outcome alone. (The double's own audio state still says
 *  `not-verified` while OSC is off; the hardware link does not.) */
function consoleStatusWord(audioProbe: ProbeOutcome): string {
  return audioProbe === "passed" ? "ready" : audioProbe === "failed" ? "attention" : "not-verified";
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
      summary: "Export the Companion profile before probing hardware.",
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
      summary: "Review the engine-owned control-surface pages before moving to live verification.",
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
        : "Commit setup, export a support backup, and return to the Console.",
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
  const startup = asRecord(state.appSnapshot.startup) ?? {};
  const commissioning = asRecord(state.appSnapshot.commissioning) ?? {};
  const lightingConfig = asRecord(state.commissioningSnapshot.lighting) ?? {};
  const lightingSnapshot = asRecord(state.lightingSnapshot) ?? {};
  const audioConfig = asRecord(state.commissioningSnapshot.audio) ?? {};
  const checks = ensureCommissioningChecks(state);
  const backups = asArray(state.supportSnapshot.backups)
    .map((entry) => asRecord(entry))
    .filter((entry): entry is JsonObject => entry !== null)
    .sort((left, right) => asNumber(right.modifiedAt) - asNumber(left.modifiedAt));

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
  state.commissioningSnapshot.lighting = {
    bridgeIp: asString(lightingConfig.bridgeIp, ""),
    universe: asNumber(lightingConfig.universe, 1),
  };
  state.commissioningSnapshot.audio = {
    sendHost: asString(audioConfig.sendHost, "127.0.0.1"),
    sendPort: asNumber(audioConfig.sendPort, 7001),
    receivePort: asNumber(audioConfig.receivePort, 9001),
  };
  // New pages program, Slice 1: the Planning counts and the sample seed left
  // the double with the page. Its summary said "Verification complete" only
  // while it held Planning data, which it no longer does, so every state that
  // held none reads as it did.
  state.commissioningSnapshot.summary = hasCompletedSetup
    ? "Commissioning complete and operator mode unlocked."
    : "Complete commissioning to unlock operator mode.";
  state.commissioningSnapshot.configSummary = `Profile '${hardwareProfile}'. Lighting bridge '${asString(state.commissioningSnapshot.lighting.bridgeIp, "unconfigured")}' on universe ${asNumber(state.commissioningSnapshot.lighting.universe, 1)}. Audio send ${asString(state.commissioningSnapshot.audio.sendHost, "127.0.0.1")}:${asNumber(state.commissioningSnapshot.audio.sendPort, 7001)} and receive ${asNumber(state.commissioningSnapshot.audio.receivePort, 9001)}.`;
  const publishOverrideAt =
    typeof state.commissioningSnapshot.publishOverrideAt === "string"
      ? state.commissioningSnapshot.publishOverrideAt
      : null;
  state.commissioningSnapshot.readinessSummary = hasCompletedSetup
    ? `${passedChecks} of ${checks.length} commissioning probes passed. Startup routes directly into the dashboard.${publishOverrideAt ? ` Published with a probe override at ${publishOverrideAt}.` : ""}`
    : `${passedChecks} of ${checks.length} commissioning probes passed. Startup remains on Setup until publish.`;
  state.commissioningSnapshot.steps = buildCommissioningSteps(
    runnerStage,
    checks.length,
    passedChecks,
    failedChecks,
    hasCompletedSetup
  );

  controlSurface.available = asBoolean(controlSurface.available, true);
  // The hardware link says whether the bridge is serving, in its own words
  // (`E/control_surface.rs`: ready / unavailable), not whether the deck has
  // been verified.
  controlSurface.status = controlSurface.available ? "ready" : "unavailable";
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
  const lightingCheckStatus = probeOutcome(lightingCheck?.status);
  const audioCheckStatus = probeOutcome(audioCheck?.status);
  const lightingReady = lightingCheckStatus === "passed";

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
  state.lightingSnapshot = lightingSnapshot;
  // The switch and the word are worked out again on every sync, as the
  // hardware link does on every read; only the fixtures' own `loading` (the
  // board where the rig has not answered yet) is kept as the scenario wrote it.
  lightingSnapshot.enabled = rigSwitchedOn(state, lightingCheckStatus);
  lightingSnapshot.connected = asBoolean(lightingSnapshot.connected, lightingReady);
  lightingSnapshot.reachable = asBoolean(lightingSnapshot.reachable, lightingReady);
  lightingSnapshot.status =
    state.lightingAuthored.status === "loading" ? "loading" : rigStatusWord(state, lightingCheckStatus);
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
    applyHealthChecks(state, lightingCheck, audioCheck, controlSurface, lightingCheckStatus, audioCheckStatus);
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
  applyHealthChecks(state, lightingCheck, audioCheck, controlSurface, lightingCheckStatus, audioCheckStatus);
}

/**
 * Each health check in the hardware link's own words, read from the rig and the
 * console as they now stand and from whether the Stream Deck bridge is serving
 * (`E/health.rs`, which copies the rig's and the console's own words and the
 * bridge's state from `control_surface.rs`; the deck's check never says
 * whether the deck was verified). The words are worked out from the probes and
 * the bridge address on every sync, never kept from an earlier one.
 */
function applyHealthChecks(
  state: MutableFixtureState,
  lightingCheck: JsonObject | undefined,
  audioCheck: JsonObject | undefined,
  controlSurface: JsonObject,
  lightingProbe: ProbeOutcome,
  audioProbe: ProbeOutcome
) {
  const lightingStatus = rigStatusWord(state, lightingProbe);
  const audioStatus = consoleStatusWord(audioProbe);
  state.healthSnapshot.checks = {
    lighting: {
      ok: lightingStatus === "ready",
      status: lightingStatus,
      summary: asString(lightingCheck?.message, "Bridge not commissioned."),
    },
    audio: {
      ok: audioStatus === "ready",
      status: audioStatus,
      summary: asString(audioCheck?.message, "Console not commissioned."),
    },
    controlSurface: {
      ok: asBoolean(controlSurface.available, true),
      status: asString(controlSurface.status, "ready"),
      summary: asString(controlSurface.summary, "Companion bridge ready."),
    },
  };
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
