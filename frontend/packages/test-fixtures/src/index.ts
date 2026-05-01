import fixtureMap from "./fixtures.json";

type FixtureScenarioRecord = (typeof fixtureMap)[keyof typeof fixtureMap];
type FixtureMap = Record<string, FixtureScenarioRecord>;

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

const derivedFixtureMap: FixtureMap = {
  ...fixtureMap,
  "lighting-preview-clean": buildLightingPreviewFixture("clean"),
  "lighting-preview-dirty": buildLightingPreviewFixture("dirty"),
  "lighting-preview-patch-conflict": buildLightingPreviewFixture("patch-conflict"),
};

export const fixtureScenarios = derivedFixtureMap;
export const fixtureIds = Object.keys(derivedFixtureMap);

export function getFixtureScenario(id: string) {
  return derivedFixtureMap[id] ?? derivedFixtureMap["setup-required"];
}
