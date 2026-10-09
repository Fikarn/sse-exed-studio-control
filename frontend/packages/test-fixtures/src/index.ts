import fixtureMap from "./fixtures.json";
import {
  expandCamerasRecord,
  type FixtureCameraSeedRecord,
  type FixtureCamerasSeedRecord,
  type RawCamerasRecord,
} from "./camerasSeeds";
import { expandPrompterRecord, type CompactPrompterRecord, type FixturePrompterSeedRecord } from "./prompterScripts";

export {
  expandCamerasRecord,
  type FixtureCameraSeedRecord,
  type FixtureCameraValuesSeedRecord,
  type FixtureCamerasSeedRecord,
  type RawCamerasRecord,
} from "./camerasSeeds";

export {
  INTERVIEW_INTRO,
  PROMPTER_SCRIPTS,
  expandPrompterRecord,
  paragraph,
  type CompactPrompterRecord,
  type FixtureParagraph,
  type FixturePrompterSeedRecord,
  type FixtureRun,
  type FixtureScriptSeed,
} from "./prompterScripts";

type RawScenarioRecord = (typeof fixtureMap)[keyof typeof fixtureMap];
type WithoutKey<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
// New pages program, Slice 6a: `fixtures.json` names a scenario's scripts
// (`CompactPrompterRecord`); the scenario carries the double's seed they make.
// Its cameras are read the same way: the file's numbers made the three cameras.
type FixtureScenarioRecord = WithoutKey<RawScenarioRecord, "prompter" | "cameras"> & {
  prompter?: FixturePrompterSeedRecord;
  cameras?: FixtureCamerasSeedRecord;
};
type FixtureMap = Record<string, FixtureScenarioRecord>;

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function defaultLightingPalettes() {
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

function buildLightingPreviewFixture(kind: "clean" | "dirty" | "patch-conflict"): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["lighting-populated"]) as FixtureScenarioRecord & {
    lightingSnapshot: Record<string, unknown>;
  };
  const lightingSnapshot = scenario.lightingSnapshot;
  const liveFixtures = Array.isArray(lightingSnapshot.fixtures)
    ? (cloneFixture(lightingSnapshot.fixtures) as Array<Record<string, unknown>>)
    : [];

  lightingSnapshot.previewMode = true;
  lightingSnapshot.previewSceneId = kind === "clean" ? "scene-warm-wash" : "scene-interview";
  lightingSnapshot.previewDirty = kind === "dirty";
  lightingSnapshot.previewFixtures = liveFixtures.map((fixture) => {
    if (kind !== "dirty") return fixture;
    if (fixture.id === "fixture-key") {
      return { ...fixture, intensity: 34, cct: 5600, on: true };
    }
    if (fixture.id === "fixture-back") {
      return { ...fixture, intensity: 28, on: true };
    }
    return fixture;
  });

  return scenario;
}

function buildLightingPaletteFixture(kind: "selected" | "empty" | "patch-disabled"): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["lighting-populated"]) as FixtureScenarioRecord & {
    appSnapshot: Record<string, unknown>;
    lightingSnapshot: Record<string, unknown>;
  };
  scenario.appSnapshot.shell = {
    ...((scenario.appSnapshot.shell as Record<string, unknown> | undefined) ?? {}),
    workspace: "lighting",
    lighting: {
      currentSectionId: kind === "patch-disabled" ? "palettes-patch" : "palettes",
    },
  };
  scenario.lightingSnapshot.palettes = defaultLightingPalettes();
  if (kind === "empty") {
    scenario.lightingSnapshot.selectedFixtureId = null;
  }
  return scenario;
}

function buildLightingPalettePreviewFixture(): FixtureScenarioRecord {
  const scenario = buildLightingPreviewFixture("dirty") as FixtureScenarioRecord & {
    appSnapshot: Record<string, unknown>;
    lightingSnapshot: Record<string, unknown>;
  };
  scenario.appSnapshot.shell = {
    ...((scenario.appSnapshot.shell as Record<string, unknown> | undefined) ?? {}),
    workspace: "lighting",
    lighting: {
      currentSectionId: "palettes",
    },
  };
  scenario.lightingSnapshot.palettes = defaultLightingPalettes();
  return scenario;
}

// The visual overhaul's polish (2026-10-05): as in `fixtures.json`, the rig
// stands at its real metres in the 12 × 8 m room (until then the lights held
// fractions of it, so the plot drew them all in its first metre); the two
// added lights hang either side of the talent marks, and Back keeps the
// heading the rig gives it.
function buildLightingSymbolFamiliesFixture(): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["lighting-populated"]) as FixtureScenarioRecord & {
    lightingSnapshot: Record<string, unknown>;
  };
  const fixtures = (
    Array.isArray(scenario.lightingSnapshot.fixtures)
      ? (scenario.lightingSnapshot.fixtures as Array<Record<string, unknown>>)
      : []
  ).map((fixture) => (fixture.id === "fixture-back" ? { ...fixture, intensity: 42, on: true } : fixture));
  scenario.lightingSnapshot.fixtures = [
    ...fixtures,
    {
      id: "fixture-soft-mat",
      name: "Soft mat",
      type: "infinimat",
      dmxStartAddress: 81,
      kind: "wash",
      groupId: "group-front",
      spatialX: 3,
      spatialY: 4.2,
      spatialRotation: 90,
      rigZ: 3.4,
      beamAngleDegrees: null,
      on: true,
      intensity: 48,
      cct: 5600,
    },
    {
      id: "fixture-fresnel",
      name: "Fresnel",
      type: "aputure-ls-600d-pro",
      dmxStartAddress: 101,
      kind: "beam",
      groupId: "group-back",
      spatialX: 9,
      spatialY: 4.2,
      spatialRotation: 145,
      rigZ: 4.8,
      beamAngleDegrees: null,
      on: true,
      intensity: 72,
      cct: 5600,
    },
  ];
  return scenario;
}

function buildAudioClippedFixture(): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["audio-populated"]) as FixtureScenarioRecord & {
    audioSnapshot: Record<string, unknown>;
  };
  scenario.audioSnapshot = {
    ...scenario.audioSnapshot,
    clipChannelIds: ["audio-input-11"],
  };
  return scenario;
}

function buildAudioHardwareMeteringFixture(): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["audio-populated"]) as FixtureScenarioRecord & {
    audioSnapshot: Record<string, unknown>;
  };
  scenario.audioSnapshot = {
    ...scenario.audioSnapshot,
    adapterMode: "totalmix",
    meteringSource: "rme-totalmix-osc",
    meteringState: "live",
  };
  return scenario;
}

// 2026-09-23: the probe has passed and TotalMix meters are arriving, but the
// desk has not been read since the link changed, so the console confidence is
// `unknown` and the meters wait (the Console reads SYNC NEEDED). Built here,
// not in `fixtures.json`, so it adds no UI-contract board.
function buildAudioProbePassedUnsyncedFixture(): FixtureScenarioRecord {
  const scenario = buildAudioHardwareMeteringFixture() as FixtureScenarioRecord & {
    audioSnapshot: Record<string, unknown>;
  };
  scenario.audioSnapshot = {
    ...scenario.audioSnapshot,
    consoleStateConfidence: "unknown",
    lastConsoleSyncAt: null,
    lastConsoleSyncReason: null,
    lastActionStatus: "succeeded",
    lastActionCode: null,
    lastActionMessage: "The desk probe passed.",
  };
  return scenario;
}

function buildAudioNoSendFixture(): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["audio-populated"]) as FixtureScenarioRecord & {
    audioSnapshot: Record<string, unknown>;
  };
  scenario.audioSnapshot = {
    ...scenario.audioSnapshot,
    mixLevelOverrides: [{ channelId: "audio-playback-3-4", mixTargetId: "audio-mix-main", value: 0 }],
  };
  return scenario;
}

// Every page with something on it, for the header's fullest row: a rig whose
// scene can drift, the Console's bank with a solo, a script on the prompter and
// the three cameras held. Built here, not in `fixtures.json`, so it adds no
// UI-contract board.
function buildEveryPageFixture(): FixtureScenarioRecord {
  const lighting = cloneFixture(fixtureMap["lighting-populated"]) as FixtureScenarioRecord & {
    appSnapshot: Record<string, unknown>;
  };
  const prompter = (fixtureMap["teleprompter-ready"] as { prompter: CompactPrompterRecord }).prompter;
  lighting.appSnapshot.shell = {
    ...((lighting.appSnapshot.shell as Record<string, unknown> | undefined) ?? {}),
    workspace: "cameras",
  };
  return {
    ...lighting,
    audioSnapshot: cloneFixture(fixtureMap["audio-populated"].audioSnapshot),
    prompter: expandPrompterRecord("every-page", prompter),
    cameras: expandCamerasRecord("every-page", (fixtureMap["cameras-held"] as { cameras: RawCamerasRecord }).cameras),
  } as FixtureScenarioRecord;
}

// The Overview's three moments (D47), board 3's `?state=` (`docs/design/boards/overview-3.html`).
// Built here as `every-page` is, so the layout gate measures them only where it names them.
// Each opens on the Overview with lighting-populated's rig (reachable, armed, Warm wash on
// it), the three probes passed (so no health check waits on a probe), the studio's hidden
// strips and no solo, the deck's bridge serving and the Prompter XL connected; CAM 1 is
// selected, as the double serves the full-size test card only to the selected camera.
//
// - take: the moment that reads READY. CAM 1 records, its take counted from 07:09:30Z, its
//   start row in cameras-recording's log, which is 90 s before the captures' 09:11 in
//   Stockholm; so the day's takes read 2. The script plays at ¶ 8 at 140; the meters tick.
// - landing: the first look of the day (board 3's 09:14). Nothing records and the log has no
//   camera row (no takes today); the script waits at ¶ 1; the console is assumed and not read
//   since the start, so its meters wait and the Console is the worst page.
// - fault: CAM 1 stops answering while it records; Guest 1 holds a clip, the meters tick;
//   the script plays at ¶ 11 at 145.
type OverviewMoment = "take" | "landing" | "fault";

/** Setup's list of the strips TotalMix hides in the studio (D45): the four preamps Host, Co-host, Guest 1 and Guest 2 show. */
const STUDIO_HIDDEN_STRIPS = fixtureMap["setup-console"].audioSnapshot.hiddenChannelIds;

/** The take's and the fault's last Sync from TotalMix, before the day's first take (the double's own is 18:24 that evening). */
const OVERVIEW_SYNCED_AT = "2026-04-23T08:38:12+02:00";

/** A cameras fixture's cameras with CAM 1 selected, and CAM 1 with `cam1` besides. */
function overviewCameras(
  id: string,
  source: "cameras-held" | "cameras-recording" | "cameras-lost-mid-take",
  cam1: Partial<FixtureCameraSeedRecord> = {}
): FixtureCamerasSeedRecord {
  const seed = expandCamerasRecord(id, {
    ...(fixtureMap[source] as { cameras: RawCamerasRecord }).cameras,
    selected: 1,
  });
  return { ...seed, cameras: seed.cameras?.map((camera) => (camera.camera === 1 ? { ...camera, ...cam1 } : camera)) };
}

/** teleprompter-ready's prompter (02 Interview intro on the glass) at the moment's place, pace and run. */
function overviewPrompter(id: string, moment: OverviewMoment): FixturePrompterSeedRecord {
  const ready = (fixtureMap["teleprompter-ready"] as { prompter: CompactPrompterRecord }).prompter;
  if (moment === "take") return { ...expandPrompterRecord(id, ready), playing: true };
  if (moment === "landing") return expandPrompterRecord(id, { ...ready, place: { paragraph: 0, word: 0 } });
  // The compact record has no pace: the script on the glass takes 145 here.
  const seed = expandPrompterRecord(id, { ...ready, place: { paragraph: 10, word: 0 } });
  return {
    ...seed,
    playing: true,
    scripts: seed.scripts?.map((script) => (script.name === seed.onGlass ? { ...script, speedWpm: 145 } : script)),
  };
}

function buildOverviewFixture(moment: OverviewMoment): FixtureScenarioRecord {
  const id = `overview-${moment}`;
  const lighting = cloneFixture(fixtureMap["lighting-populated"]);
  lighting.appSnapshot.shell = { ...lighting.appSnapshot.shell, workspace: "overview" };
  // The console's meters are TotalMix's (`meteringSource`), so a desk read at the last Sync
  // reads VERIFIED, as the studio's does, not SIMULATED; its `adapterMode` stays the double's
  // simulated one, so its meters still tick (`isSimulatedAudioSnapshot`).
  const desk = moment === "landing" ? fixtureMap["audio-state-assumed"] : fixtureMap["audio-populated"];
  const audioSnapshot = {
    ...cloneFixture(desk.audioSnapshot),
    meteringSource: "rme-totalmix-osc",
    lastConsoleSyncAt: moment === "landing" ? null : OVERVIEW_SYNCED_AT,
    lastConsoleSyncReason: moment === "landing" ? null : "console-pull",
    hiddenChannelIds: [...STUDIO_HIDDEN_STRIPS],
    soloChannelIds: [],
    // audio-clipped's clip: Guest 1.
    ...(moment === "fault" ? { clipChannelIds: ["audio-input-11"] } : {}),
  };
  const cameras =
    moment === "take"
      ? overviewCameras(id, "cameras-recording", { recordingForSeconds: 90 })
      : moment === "landing"
        ? overviewCameras(id, "cameras-held")
        : overviewCameras(id, "cameras-lost-mid-take");
  const supportSnapshot =
    moment === "take"
      ? cloneFixture(fixtureMap["cameras-recording"].supportSnapshot)
      : moment === "landing"
        ? { recentEvents: [] }
        : cloneFixture(fixtureMap["cameras-lost-mid-take"].supportSnapshot);
  const scenario = {
    ...lighting,
    commissioningSnapshot: cloneFixture(fixtureMap["audio-populated"].commissioningSnapshot),
    audioSnapshot,
    audioMeteringActive: moment !== "landing",
    supportSnapshot,
    prompter: overviewPrompter(id, moment),
    cameras,
  };
  return scenario as FixtureScenarioRecord;
}

// 2026-09-29: the rig as `lighting-populated`, with the bridge watch saying
// the bridge stopped answering at 10:42 UTC. Setup's probe passed, so nothing
// is locked. Built here, not in `fixtures.json`, so it adds no UI-contract
// board.
function buildLightingBridgeSilentFixture(outputsHeld = false): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["lighting-populated"]) as FixtureScenarioRecord & {
    lightingSnapshot: Record<string, unknown>;
  };
  scenario.lightingSnapshot = {
    ...scenario.lightingSnapshot,
    bridgeAnswering: false,
    bridgeSilentSince: "2026-09-29T10:42:05.000Z",
    ...(outputsHeld ? { outputArmed: false } : {}),
  };
  return scenario;
}

/** Every scenario of `fixtures.json`, its `prompter` (the scripts by name) and its `cameras` made the double's seeds. */
function expandedFixtureMap(): FixtureMap {
  return Object.fromEntries(
    Object.entries(fixtureMap).map(([id, record]) => {
      const { prompter, cameras, ...rest } = record as RawScenarioRecord & {
        prompter?: CompactPrompterRecord;
        cameras?: RawCamerasRecord;
      };
      return [
        id,
        {
          ...rest,
          ...(prompter === undefined ? {} : { prompter: expandPrompterRecord(id, prompter) }),
          ...(cameras === undefined ? {} : { cameras: expandCamerasRecord(id, cameras) }),
        } as FixtureScenarioRecord,
      ];
    })
  );
}

const derivedFixtureMap: FixtureMap = {
  ...expandedFixtureMap(),
  "audio-populated": {
    ...cloneFixture(fixtureMap["audio-populated"]),
    audioMeteringActive: true,
  } as FixtureScenarioRecord,
  "audio-selected-channel": {
    ...cloneFixture(fixtureMap["audio-selected-channel"]),
    audioMeteringActive: true,
  } as FixtureScenarioRecord,
  "audio-clipped": buildAudioClippedFixture(),
  "audio-hardware-metering": buildAudioHardwareMeteringFixture(),
  "audio-probe-passed-unsynced": buildAudioProbePassedUnsyncedFixture(),
  "audio-no-send": buildAudioNoSendFixture(),
  "every-page": buildEveryPageFixture(),
  "lighting-bridge-silent": buildLightingBridgeSilentFixture(),
  "lighting-bridge-silent-held": buildLightingBridgeSilentFixture(true),
  "lighting-palettes-empty": buildLightingPaletteFixture("empty"),
  "lighting-palettes-patch-disabled": buildLightingPaletteFixture("patch-disabled"),
  "lighting-palettes-preview-active": buildLightingPalettePreviewFixture(),
  "lighting-palettes-selected": buildLightingPaletteFixture("selected"),
  "lighting-preview-clean": buildLightingPreviewFixture("clean"),
  "lighting-preview-dirty": buildLightingPreviewFixture("dirty"),
  "lighting-preview-patch-conflict": buildLightingPreviewFixture("patch-conflict"),
  "lighting-symbol-families": buildLightingSymbolFamiliesFixture(),
  "overview-fault": buildOverviewFixture("fault"),
  "overview-landing": buildOverviewFixture("landing"),
  "overview-take": buildOverviewFixture("take"),
};

export const fixtureScenarios = derivedFixtureMap;
export const fixtureIds = Object.keys(derivedFixtureMap);

export function getFixtureScenario(id: string) {
  return derivedFixtureMap[id] ?? derivedFixtureMap["setup-required"];
}
