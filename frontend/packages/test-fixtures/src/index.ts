import fixtureMap from "./fixtures.json";

type FixtureScenarioRecord = (typeof fixtureMap)[keyof typeof fixtureMap];
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

function buildLightingSymbolFamiliesFixture(): FixtureScenarioRecord {
  const scenario = cloneFixture(fixtureMap["lighting-populated"]) as FixtureScenarioRecord & {
    lightingSnapshot: Record<string, unknown>;
  };
  const fixtures = (
    Array.isArray(scenario.lightingSnapshot.fixtures)
      ? (scenario.lightingSnapshot.fixtures as Array<Record<string, unknown>>)
      : []
  ).map((fixture) =>
    fixture.id === "fixture-back" ? { ...fixture, intensity: 42, on: true, spatialRotation: 180 } : fixture
  );
  scenario.lightingSnapshot.fixtures = [
    ...fixtures,
    {
      id: "fixture-soft-mat",
      name: "Soft mat",
      type: "infinimat",
      dmxStartAddress: 81,
      kind: "wash",
      groupId: "group-front",
      spatialX: 0.36,
      spatialY: 0.5,
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
      spatialX: 0.65,
      spatialY: 0.5,
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

const derivedFixtureMap: FixtureMap = {
  ...fixtureMap,
  "audio-populated": {
    ...cloneFixture(fixtureMap["audio-populated"]),
    audioMeteringActive: true,
  } as FixtureScenarioRecord,
  "audio-clipped": buildAudioClippedFixture(),
  "audio-hardware-metering": buildAudioHardwareMeteringFixture(),
  "audio-no-send": buildAudioNoSendFixture(),
  "lighting-palettes-empty": buildLightingPaletteFixture("empty"),
  "lighting-palettes-patch-disabled": buildLightingPaletteFixture("patch-disabled"),
  "lighting-palettes-preview-active": buildLightingPalettePreviewFixture(),
  "lighting-palettes-selected": buildLightingPaletteFixture("selected"),
  "lighting-preview-clean": buildLightingPreviewFixture("clean"),
  "lighting-preview-dirty": buildLightingPreviewFixture("dirty"),
  "lighting-preview-patch-conflict": buildLightingPreviewFixture("patch-conflict"),
  "lighting-symbol-families": buildLightingSymbolFamiliesFixture(),
};

export const fixtureScenarios = derivedFixtureMap;
export const fixtureIds = Object.keys(derivedFixtureMap);

export function getFixtureScenario(id: string) {
  return derivedFixtureMap[id] ?? derivedFixtureMap["setup-required"];
}
