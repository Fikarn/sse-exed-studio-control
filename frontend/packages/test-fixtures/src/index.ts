import fixtureMap from "./fixtures.json";

export const fixtureScenarios = fixtureMap;
export const fixtureIds = Object.keys(fixtureMap);

export function getFixtureScenario(id: string) {
  return fixtureMap[id as keyof typeof fixtureMap] ?? fixtureMap["setup-required"];
}
