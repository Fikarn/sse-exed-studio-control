// The engine's test double, for the pages in a browser and for the page
// tests. `createShellEnvironment` loads this module on request, so the double
// and its test data are a chunk of their own, which the app's window never
// asks for.
import { createFixtureTransport, simulatedCameras, type SimulatedCameraHooks } from "@sse/engine-client/fixture";
import { getFixtureScenario } from "@sse/test-fixtures";

declare global {
  interface Window {
    /**
     * The page tests' hold on the double's simulated cameras: a value changed
     * on a camera's body, a camera that stops answering and answers again.
     */
    __SSE_TEST_CAMERAS__?: SimulatedCameraHooks;
  }
}

export function createFixtureDouble(fixtureId: string) {
  const transport = createFixtureTransport(getFixtureScenario(fixtureId));
  window.__SSE_TEST_CAMERAS__ = simulatedCameras(transport);
  return transport;
}
