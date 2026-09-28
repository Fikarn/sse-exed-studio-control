// The engine's test double, for the pages in a browser and for the page
// tests. `createShellEnvironment` loads this module on request, so the double
// and its test data are a chunk of their own, which the app's window never
// asks for.
import { createFixtureTransport } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

export function createFixtureDouble(fixtureId: string) {
  return createFixtureTransport(getFixtureScenario(fixtureId));
}
